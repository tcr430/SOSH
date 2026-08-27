// ADR 0023 §3.4/§9 — the RSS/Atom ingestion path: per-feed isolation, the
// atomic insert (reused UNCHANGED from lib/db/signals.ts), the content_hash
// near-duplicate backstop, and full observability. Mirrors lib/signals/
// orchestrator.ts's GitHub-side shape; kept in its own file so each
// source's per-item ingestion logic stays independently auditable — the
// same reasoning github-client.ts/parse-release.ts vs rss-client.ts/
// parse-article.ts already established for fetch/parse.
//
// L-1 — ZERO imports of @/lib/ai/* or @anthropic-ai/sdk anywhere in this
// file (this is still under lib/signals/, covered by scan #1's existing
// LIB_SIGNALS_DIR root — no new scan needed).

import * as Sentry from '@sentry/nextjs'
import { createHash } from 'node:crypto'
import { subDays, formatISO } from 'date-fns'
import { listActiveWatchedFeedsReadyForPoll, recordWatchedFeedPollOutcome } from '@/lib/db/watched-feeds'
import { insertSignal, listRecentSignalsByBusinessAndSource } from '@/lib/db/signals'
import type { SignalInsert, WatchedFeedRow } from '@/lib/db/types'
import { config } from '@/lib/config'
import { fetchAndParseFeed } from './rss-client'
import type { ParsedArticle } from './parse-article'
import { scoreSignal, upsertScoredCandidate } from './score'

export interface RssTickSummary {
  rssFeedsConsidered: number
  rssFeedsFetched: number
  rssFeedsNotModified: number
  rssFeedsFailed: number
  rssItemsIngested: number
  rssDuplicates: number
  rssGuardRejected: number
  rssCandidatesUpserted: number
}

export function emptyRssTickSummary(): RssTickSummary {
  return {
    rssFeedsConsidered: 0,
    rssFeedsFetched: 0,
    rssFeedsNotModified: 0,
    rssFeedsFailed: 0,
    rssItemsIngested: 0,
    rssDuplicates: 0,
    rssGuardRejected: 0,
    rssCandidatesUpserted: 0,
  }
}

// ── Dedup key: external_id = 'rss:' || sha256(canonical_link), falling
// back to guid ONLY when no link exists (ADR §3.4) ──────────────────────────

// A small, named, non-exhaustive set — extended later if a specific
// publisher's tracking params prove to matter, not intended as a general
// tracking-param blocklist.
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref']

// Normalize BEFORE hashing (§3.4): lowercase scheme and host, strip
// fragment and known tracking parameters, trim the trailing slash. Falls
// back to a lowercase-trim of the raw string for a non-URL input (a bare
// <guid> is often a URN like "urn:uuid:...", not a URL at all) — hashing
// still needs to be deterministic even when the input isn't a real URL.
function normalizeForHashing(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    for (const param of TRACKING_PARAMS) url.searchParams.delete(param)
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    let result = url.toString()
    if (result.endsWith('/')) result = result.slice(0, -1)
    return result
  } catch {
    return raw.trim().toLowerCase()
  }
}

export function computeRssExternalId(link: string | null, guid: string | null): string | null {
  const source = link ?? guid
  if (!source) return null
  const hash = createHash('sha256').update(normalizeForHashing(source), 'utf8').digest('hex')
  return `rss:${hash}`
}

// §8.2's watched_feeds.url_hash — the UNIQUE(business_id, url_hash) arbiter
// for the customer's OWN subscribed feed URL (Session 30 G1b.9). Reuses the
// EXACT SAME normalize-before-hash algorithm §3.4 established for canonical-
// link dedup above, applied to a different string. Exported (rather than
// re-implemented in the Server Action) because this is SSRF-adjacent
// normalization logic — duplicating it a third time risks drift between the
// dedup key and the uniqueness arbiter, unlike the small, non-security
// parser helpers SIGNAL-MR-NO-SIXTH-SANITIZER's precedent duplicates. No
// 'rss:' prefix: this hash is a uniqueness key, not an external_id.
export function computeWatchedFeedUrlHash(url: string): string {
  return createHash('sha256').update(normalizeForHashing(url), 'utf8').digest('hex')
}

// §7.3's sink-narrowed hash replica of the DB's generated column, IDENTICAL
// to lib/signals/orchestrator.ts's computeContentHash — duplicated rather
// than imported: each source's ingestion file stays independently
// auditable (the same house convention SIGNAL-MR-NO-SIXTH-SANITIZER
// established for small boundary helpers), and both replicas are verified
// against the same DB-generated column definition.
function computeContentHash(title: string, body: string): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(title, 'utf8'), Buffer.from([0]), Buffer.from(body, 'utf8')]))
    .digest('hex')
}

// ── Per-item ingestion ───────────────────────────────────────────────────────

async function ingestParsedArticle(
  businessId: string,
  watchedFeedId: string,
  feedWeight: number,
  article: ParsedArticle,
  now: Date,
  summary: RssTickSummary,
): Promise<void> {
  const externalId = computeRssExternalId(article.link, null)
  if (!externalId) {
    // Neither link nor guid survived parse-article.ts's validation to reach
    // here with a usable value — parse-article.ts already requires `link`
    // OR falls through with null; a null externalId means BOTH were absent,
    // which is itself a malformed item. Counted the same as any other
    // ingestion-blocking condition for this feed, not a crash.
    summary.rssGuardRejected++
    return
  }

  const body = article.body ?? ''
  const contentHash = computeContentHash(article.title, body)

  // SIGNAL-MR-DEDUP-STABLE — the near-duplicate backstop for guid/link
  // churn (§3.4's "honest residual"): a republished item with a changed
  // link/guid would otherwise compute a brand-new externalId and insert as
  // a genuinely new row, routing around upsert_signal_candidate's
  // terminal-status guard entirely (a story a human already dismissed
  // reappearing with no terminal-state memory). Checked BEFORE insertSignal
  // — if a recent signal for this business, same source, same content_hash
  // already exists, this item is a duplicate regardless of what its
  // externalId would have been.
  const windowStart = formatISO(subDays(now, config.server.RSS_CONTENT_DEDUP_WINDOW_DAYS))
  const recentSignals = await listRecentSignalsByBusinessAndSource(businessId, 'rss', windowStart)
  const nearDuplicate = recentSignals.some((s) => s.content_hash === contentHash)
  if (nearDuplicate) {
    summary.rssDuplicates++
    return
  }

  const insert: SignalInsert = {
    business_id: businessId,
    watched_feed_id: watchedFeedId,
    source: 'rss',
    kind: 'article',
    external_id: externalId,
    ingested_via: 'poll',
    title: article.title,
    body: article.body,
    body_truncated: article.body_truncated,
    html_url: article.html_url,
    occurred_at: article.occurred_at,
  }
  const result = await insertSignal(insert)
  if (result.status === 'duplicate') {
    // SIGNAL-MR-INGEST-ATOMIC — the UNIQUE(business_id, source, external_id)
    // index is the actual arbiter for a byte-identical retry or a
    // concurrent overlapping tick; this file's own pre-checks are a
    // pre-filter, never the source of truth (same reasoning as GitHub's
    // orchestrator.ts:119-124).
    summary.rssDuplicates++
    return
  }

  summary.rssItemsIngested++

  const scored = scoreSignal(
    {
      externalId: result.signal.external_id,
      occurredAt: result.signal.occurred_at,
      bodyLen: result.signal.body.length,
      isBot: result.signal.author_is_bot,
      repoWeight: feedWeight,
      kind: 'article',
    },
    now,
  )
  const candidate = await upsertScoredCandidate(businessId, result.signal.id, scored)
  if (candidate) summary.rssCandidatesUpserted++
}

// ── Per-feed poll ────────────────────────────────────────────────────────────

async function pollWatchedFeed(feed: WatchedFeedRow, now: Date, summary: RssTickSummary): Promise<void> {
  summary.rssFeedsConsidered++

  const result = await fetchAndParseFeed(feed.url, { etag: feed.etag })

  if (result.status === 'error') {
    // PER-FEED ISOLATION — a fetch error, DNS failure, guard rejection,
    // malformed document or XXE rejection marks THIS FEED with a
    // last-error state and the loop CONTINUES to the next feed. One
    // publisher's outage, or one attacker's deliberately malformed feed,
    // never stops other feeds or GitHub ingestion (a separate orchestrator
    // entirely — see lib/signals/orchestrator.ts's own try/catch per
    // connection for that half of the guarantee).
    summary.rssFeedsFailed++
    if (result.errorCode === 'xxe_rejected') summary.rssGuardRejected++
    await recordWatchedFeedPollOutcome(feed.id, feed.business_id, {
      status: 'error',
      errorCode: result.errorCode,
      consecutiveFailureCount: feed.consecutive_failure_count + 1,
    })
    // §9.4 clause 3 — IDENTIFIERS ONLY, NEVER BODY TEXT. result.message may
    // echo a URL or a header value (egress-guard errors), never feed
    // content — but even so, only the errorCode is tagged; the message
    // itself is deliberately NOT attached as `extra`, mirroring §7's
    // "never log untrusted values" discipline one level more conservative
    // than lib/signals/orchestrator.ts's own malformed-release handler
    // (which does attach parse issue STRINGS, not raw content — this file
    // omits even that for the fetch/XXE error class, since egress-guard
    // messages can echo attacker-supplied redirect targets).
    Sentry.captureException(new Error(`signals-rss: feed poll failed (${result.errorCode})`), {
      tags: { business_id: feed.business_id, watched_feed_id: feed.id, phase: 'signals-rss-fetch', error_code: result.errorCode },
    })
    return
  }

  if (result.status === 'not_modified') {
    summary.rssFeedsNotModified++
    await recordWatchedFeedPollOutcome(feed.id, feed.business_id, {
      status: 'not_modified',
      consecutiveFailureCount: 0,
    })
    return
  }

  summary.rssFeedsFetched++

  for (const article of result.articles) {
    await ingestParsedArticle(feed.business_id, feed.id, feed.weight, article, now, summary)
  }
  if (result.malformedCount > 0) {
    summary.rssGuardRejected += result.malformedCount
  }

  await recordWatchedFeedPollOutcome(feed.id, feed.business_id, {
    status: 'ok',
    etag: result.etag,
    consecutiveFailureCount: 0,
  })
}

// ── Tick entrypoint — called from lib/signals/orchestrator.ts's
// runSignalsTick, sharing its ONE canonical tick log line (§9.4 clause 4)
// and its Sentry.withMonitor wrapper. Per-feed isolation is internal to
// this function; a genuinely unexpected failure (a bug, a DB write failure
// pollWatchedFeed's own classification didn't already contain) is caught
// per-feed here too, mirroring runSignalsTick's own per-business catch —
// L-11/SIGNAL-FAILURE-ISOLATED, one level deeper (per-feed, not just
// per-business, since one business can watch several feeds). ─────────────

export async function pollWatchedFeeds(now: Date): Promise<RssTickSummary> {
  const summary = emptyRssTickSummary()
  // Real wall-clock elapsed time, deliberately NOT derived from `now`
  // (which is a logical/business timestamp used for occurred_at
  // comparisons and DB stamps, and in tests is often a fixed fixture date
  // unrelated to the real current time) — mixing the two would make this
  // budget check misfire whenever `now` differs from Date.now(), which it
  // always does in a deterministic test.
  const loopStartedAtMs = Date.now()
  const budgetMs = config.server.RSS_FEED_POLL_TICK_BUDGET_MS

  const feeds = await listActiveWatchedFeedsReadyForPoll()

  for (const feed of feeds) {
    if (Date.now() - loopStartedAtMs >= budgetMs) {
      // §16's per-tick wall-clock budget — a feed not reached this tick is
      // simply deferred to the next one (it stays at the front of
      // listActiveWatchedFeedsReadyForPoll's ORDER BY last_fetch_at ASC
      // NULLS FIRST ordering), never a failure.
      break
    }
    try {
      await pollWatchedFeed(feed, now, summary)
    } catch (err) {
      summary.rssFeedsFailed++
      Sentry.captureException(err, { tags: { business_id: feed.business_id, watched_feed_id: feed.id, phase: 'signals-rss-poll' } })
    }
  }

  return summary
}
