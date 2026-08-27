// ADR 0023 §3.1/§7.1 — the ONE module that may import the RSS/Atom parser
// package (xml2js), mirroring github-client.ts's exact role for @octokit/*.
// Every consumer imports from lib/signals/index.ts instead; no other file
// under lib/signals/** or anywhere else names xml2js directly (enforced by
// a source scan, SIGNAL-MR-SCANS-EXTENDED part 2's new scan #2 parallel).
//
// This file does the fetch (via G1b.3's egress guard), the XXE check
// (BEFORE any xml2js call, on the raw body), and the RSS-vs-Atom tree
// navigation, translating either shape into the same normalized
// RawFeedItem shape parse-article.ts consumes. It never mints UntrustedText
// itself — that stays parse-article.ts's exclusive job.

import { parseStringPromise } from 'xml2js'
import { config } from '@/lib/config'
import { fetchWithEgressGuard, rejectIfDeclaresDoctype, XxeRejectedError, type EgressGuardErrorCode } from './rss-egress-guard'
import { parseArticleItem, type RawFeedItem, type ParsedArticle } from './parse-article'

export type RssClientErrorCode = EgressGuardErrorCode | 'xxe_rejected' | 'malformed_document' | 'unrecognized_format'

export type FetchAndParseFeedResult =
  | { status: 'not_modified' }
  | { status: 'ok'; articles: ParsedArticle[]; malformedCount: number; etag: string | null; lastModified: string | null }
  | { status: 'error'; errorCode: RssClientErrorCode; message: string }

export interface FetchAndParseFeedOptions {
  etag?: string | null
  lastModified?: string | null
}

// ── xml2js tree navigation helpers ──────────────────────────────────────────
//
// xml2js's parseStringPromise with explicitArray:false collapses a
// single-child element to a plain object/string, and a multi-child element
// to an array — asArray() normalizes both to an array uniformly. Text
// content of an element WITH attributes lands under the `_` key
// (attrkey defaults to `$`); an element with no attributes and only text
// parses to a plain string.

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function extractText(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined
  if (typeof node === 'string') {
    const trimmed = node.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof node === 'object' && '_' in (node as Record<string, unknown>)) {
    const text = (node as Record<string, unknown>)._
    if (typeof text === 'string') {
      const trimmed = text.trim()
      return trimmed.length > 0 ? trimmed : undefined
    }
  }
  return undefined
}

interface AtomLinkNode {
  $?: { href?: string; rel?: string }
}

// Atom's <link> is self-closing with an href ATTRIBUTE, never text content,
// and a single entry may carry several (rel="alternate", rel="self", ...).
// Prefer rel="alternate" (the canonical human-readable page) or the first
// href-bearing link if no rel="alternate" is present, over any other rel
// (e.g. "self", which points at the feed XML itself, not the article).
function extractAtomLink(node: unknown): string | undefined {
  const links = asArray(node as AtomLinkNode | AtomLinkNode[] | undefined)
  const alternate = links.find((l) => l?.$?.href && (l.$.rel === 'alternate' || !l.$.rel))
  if (alternate?.$?.href) return alternate.$.href
  const anyHref = links.find((l) => l?.$?.href)
  return anyHref?.$?.href
}

function itemsFromRss(channel: Record<string, unknown> | undefined): RawFeedItem[] {
  const items = asArray(channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined)
  return items.map((item) => ({
    title: extractText(item.title),
    link: extractText(item.link),
    guid: extractText(item.guid),
    publishedAt: extractText(item.pubDate),
    // <content:encoded> (the full-text convention many publishers use)
    // preferred over <description> (often just a short summary) when both
    // are present.
    content: extractText(item['content:encoded']) ?? extractText(item.description),
  }))
}

function itemsFromAtom(feed: Record<string, unknown> | undefined): RawFeedItem[] {
  const entries = asArray(feed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined)
  return entries.map((entry) => ({
    title: extractText(entry.title),
    link: extractAtomLink(entry.link),
    guid: extractText(entry.id),
    publishedAt: extractText(entry.published) ?? extractText(entry.updated),
    content: extractText(entry.content) ?? extractText(entry.summary),
  }))
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function fetchAndParseFeed(
  url: string,
  options: FetchAndParseFeedOptions = {},
): Promise<FetchAndParseFeedResult> {
  const headers: Record<string, string> = {}
  if (options.etag) headers['If-None-Match'] = options.etag
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified

  const fetchResult = await fetchWithEgressGuard(url, { headers })
  if (!fetchResult.ok) {
    return { status: 'error', errorCode: fetchResult.errorCode, message: fetchResult.message }
  }
  if (fetchResult.status === 304) {
    return { status: 'not_modified' }
  }

  // §8.3 clause 8 — the XXE check runs on the RAW body, BEFORE it is ever
  // handed to xml2js. This is the one place in this file that check is
  // skippable-by-omission, so it is the very first thing done with the body.
  try {
    rejectIfDeclaresDoctype(fetchResult.body)
  } catch (err) {
    if (err instanceof XxeRejectedError) {
      return { status: 'error', errorCode: 'xxe_rejected', message: err.message }
    }
    throw err
  }

  // SIGNAL-MR-FEED-ISOLATED's parser arm: a malformed document fails
  // CLOSED — a caught, typed error result, never an uncaught throw that
  // could abort a caller's per-feed loop over multiple watched feeds.
  let parsed: unknown
  try {
    parsed = await parseStringPromise(fetchResult.body, { explicitArray: false, trim: true })
  } catch (err) {
    return { status: 'error', errorCode: 'malformed_document', message: err instanceof Error ? err.message : String(err) }
  }

  const root = parsed as { rss?: { channel?: Record<string, unknown> }; feed?: Record<string, unknown> }
  let rawItems: RawFeedItem[]
  if (root?.rss?.channel) {
    rawItems = itemsFromRss(root.rss.channel)
  } else if (root?.feed) {
    rawItems = itemsFromAtom(root.feed)
  } else {
    return { status: 'error', errorCode: 'unrecognized_format', message: 'document root is neither <rss> nor <feed> — not a recognized RSS 2.0 or Atom document' }
  }

  // ADR §3.4/§16 — per-tick item bound, never a literal: the N most recent
  // items/entries, bounding parse/mint cost against a feed with thousands
  // of historical items.
  const bounded = rawItems.slice(0, config.server.RSS_FEED_MAX_ITEMS_PER_FETCH)

  const articles: ParsedArticle[] = []
  let malformedCount = 0
  for (const raw of bounded) {
    const result = parseArticleItem(raw)
    if (result.status === 'ok') {
      articles.push(result.article)
    } else {
      malformedCount += 1
    }
  }

  return {
    status: 'ok',
    articles,
    malformedCount,
    etag: fetchResult.headers.etag,
    lastModified: fetchResult.headers.lastModified,
  }
}
