// ADR 0023 §7.1 — the ONLY place a raw RSS/Atom item becomes a SOSH row, and
// the ONLY minter of UntrustedText on the market-responsive write path,
// mirroring parse-release.ts's exact role for GitHub releases (§7.1 draws
// this parallel explicitly).
//
// A parse failure is a per-item skip (SIGNAL-MR-FEED-ISOLATED's parser arm)
// — this function never throws, so one malformed item in a feed of 50
// cannot abort the other 49.

import { z } from 'zod'
import type { SignalInsert, UntrustedText } from '@/lib/db/types'

// Normalized shape rss-client.ts extracts from EITHER an RSS 2.0 <item> or
// an Atom <entry> — this file has no XML-parsing knowledge of its own and
// never imports xml2js: the RSS/Atom-vs-plain-object translation is
// rss-client.ts's job, keeping the parser-package import boundary
// (SIGNAL-MR-CLIENT-BOUNDED) and the UntrustedText-minting boundary in two
// separate files, same split as parse-release.ts / github-client.ts.
//
// ⚠️ STRUCTURAL, not a runtime filter (ADR §7.1): this interface has no
// author / creator / byline / email field of any kind. rss-client.ts's own
// extraction step has nowhere to put one even if a feed supplies it — the
// field has no name to be assigned to, on either side of this boundary.
export interface RawFeedItem {
  title: string | undefined
  // Canonical link, best-effort (RSS <link> text or Atom rel="alternate"
  // href) — undefined if the item has none.
  link: string | undefined
  // <guid> (RSS) or <id> (Atom) — carried through for G1b.5's dedup-key
  // fallback (external_id = 'rss:' || sha256(canonical_link), falling back
  // to guid ONLY when no link exists, ADR §3.4). Never used by this file.
  guid: string | undefined
  // Raw date string (RFC 2822 for RSS <pubDate>, ISO 8601 for Atom
  // <published>/<updated>) — `new Date()` parses both natively.
  publishedAt: string | undefined
  // Best available body text: RSS <content:encoded> or <description>;
  // Atom <content> or <summary>. rss-client.ts picks the richest available
  // field before handing off here.
  content: string | undefined
}

// §7.1 — exactly the fields a single RSS/Atom item can supply. Deliberately
// an Omit<SignalInsert, ...> rather than a hand-written sibling type, for
// the same reason parse-release.ts gives (§5.3 there, §7.1 here): omitting
// business_id / watched_feed_id / source / kind / external_id /
// ingested_via FROM SignalInsert ITSELF is what makes "this file cannot
// produce a contributor-identity field" a compile-time fact about
// SignalInsert's own shape, not merely a claim this file makes about
// itself.
//
// external_id is omitted deliberately, unlike parse-release.ts's github:
// release:{id} (a static, trivial key) — ADR §3.4 assigns the RSS dedup
// key's NORMALIZE-then-hash computation to G1b.5, not this parse boundary,
// because it needs http/https-aware canonicalization this file has no
// reason to own. `link` is carried alongside (below) so G1b.5 can hash it.
//
// is_prerelease / author_is_bot are likewise omitted: neither concept
// applies to a news article (there is no draft/prerelease state, and no
// reliable bot-authorship signal for third-party news prose) — both
// columns take their DB defaults (false), which is the correct value here,
// not a value this file computes.
export type ParsedArticle = Omit<
  SignalInsert,
  | 'id'
  | 'business_id'
  | 'watched_repo_id'
  | 'watched_feed_id'
  | 'source'
  | 'kind'
  | 'external_id'
  | 'ingested_via'
  | 'is_prerelease'
  | 'author_is_bot'
  | 'created_at'
  | 'updated_at'
> & {
  // NOT an Insert field — G1b.5 hashes this into external_id
  // ('rss:' || sha256(canonicalize(link))); never stored verbatim in a
  // column of its own. null, not undefined, matching html_url's own
  // nullability on SignalRow/SignalInsert.
  link: string | null
}

export type ParseArticleResult =
  | { status: 'ok'; article: ParsedArticle }
  | { status: 'malformed'; issues: string[] }

const rawFeedItemSchema = z.object({
  title: z.string().min(1),
  link: z.string().optional(),
  guid: z.string().optional(),
  publishedAt: z.string().optional(),
  content: z.string().optional(),
})

// §3.4/[sec-LOW-9] mirror of parse-release.ts's BODY_MAX_CHARS — a cost and
// payload-size control, not a security control (wrapSignalForPrompt's
// SIGNAL_MAX_CHARS is the actual prompt-injection defence). Same 8000
// figure as the DB's length(body) <= 8000 CHECK
// (20260731090000_signal_ingestion.sql:101), which this ADR does not widen.
export const BODY_MAX_CHARS = 8000

// Duplicated from parse-release.ts rather than imported — SIGNAL-MR-NO-
// SIXTH-SANITIZER's own precedent (source-scans.test.ts) already
// establishes per-parser-file duplication of small boundary helpers as
// house style over a shared cross-source utility, so each parser file
// stays independently auditable without a shared-helper dependency between
// the two signal sources.
function truncateMultibyteSafe(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  let end = maxChars
  const charBeforeCut = text.charCodeAt(end - 1)
  if (charBeforeCut >= 0xd800 && charBeforeCut <= 0xdbff) {
    end -= 1
  }
  return { text: text.slice(0, end), truncated: true }
}

export function parseArticleItem(raw: RawFeedItem): ParseArticleResult {
  const result = rawFeedItemSchema.safeParse(raw)
  if (!result.success) {
    return { status: 'malformed', issues: result.error.issues.map((issue) => issue.message) }
  }
  const item = result.data

  const occurredAtDate = item.publishedAt ? new Date(item.publishedAt) : null
  if (!occurredAtDate || isNaN(occurredAtDate.getTime())) {
    return { status: 'malformed', issues: ['publishedAt is missing or not a parseable date'] }
  }

  const rawBody = item.content ?? ''
  const { text: truncatedBody, truncated } = truncateMultibyteSafe(rawBody, BODY_MAX_CHARS)

  const article: ParsedArticle = {
    // §7.1 — minted here, and only here, on the market-responsive write path.
    title: item.title as UntrustedText,
    body: truncatedBody as UntrustedText,
    body_truncated: truncated,
    html_url: item.link ?? null,
    occurred_at: occurredAtDate.toISOString(),
    link: item.link ?? null,
  }
  return { status: 'ok', article }
}
