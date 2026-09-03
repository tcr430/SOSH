import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { WatchedFeedRow, SignalRow } from '@/lib/db/types'
import type { ParsedArticle } from './parse-article'

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

vi.mock('@/lib/db/watched-feeds', () => ({
  listActiveWatchedFeedsReadyForPoll: vi.fn(),
  recordWatchedFeedPollOutcome: vi.fn(),
}))

vi.mock('@/lib/db/signals', () => ({
  insertSignal: vi.fn(),
  listRecentSignalsByBusinessAndSource: vi.fn(),
}))

vi.mock('./rss-client', () => ({
  fetchAndParseFeed: vi.fn(),
}))

vi.mock('./score', () => ({
  scoreSignal: vi.fn(),
  upsertScoredCandidate: vi.fn(),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      RSS_CONTENT_DEDUP_WINDOW_DAYS: 3,
      RSS_FEED_POLL_TICK_BUDGET_MS: 20_000,
    },
  },
}))

import { pollWatchedFeeds, computeRssExternalId } from './rss-orchestrator'
import { listActiveWatchedFeedsReadyForPoll, recordWatchedFeedPollOutcome } from '@/lib/db/watched-feeds'
import { insertSignal, listRecentSignalsByBusinessAndSource } from '@/lib/db/signals'
import { fetchAndParseFeed } from './rss-client'
import { scoreSignal, upsertScoredCandidate } from './score'
import * as Sentry from '@sentry/nextjs'
import { config } from '@/lib/config'

const mockList = vi.mocked(listActiveWatchedFeedsReadyForPoll)
const mockRecord = vi.mocked(recordWatchedFeedPollOutcome)
const mockInsert = vi.mocked(insertSignal)
const mockRecentSignals = vi.mocked(listRecentSignalsByBusinessAndSource)
const mockFetchAndParse = vi.mocked(fetchAndParseFeed)
const mockScoreSignal = vi.mocked(scoreSignal)
const mockUpsertCandidate = vi.mocked(upsertScoredCandidate)
const mockCaptureException = vi.mocked(Sentry.captureException)

function makeFeed(overrides: Partial<WatchedFeedRow> = {}): WatchedFeedRow {
  return {
    id: 'feed-1',
    business_id: 'biz-1',
    url: 'https://example.com/feed.xml',
    url_hash: 'hash-1',
    label: 'Example Feed',
    is_active: true,
    weight: 10,
    added_by: null,
    last_fetch_at: null,
    last_fetch_status: null,
    last_error_code: null,
    consecutive_failure_count: 0,
    rate_limited_until: null,
    etag: null,
    last_success_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function makeArticle(overrides: Partial<ParsedArticle> = {}): ParsedArticle {
  return {
    title: 'A competitor launches a thing' as ParsedArticle['title'],
    body: 'Some body text about the launch.' as ParsedArticle['body'],
    body_truncated: false,
    html_url: 'https://competitor.example.com/launch',
    occurred_at: '2026-08-01T09:00:00Z',
    link: 'https://competitor.example.com/launch',
    guid: null,
    ...overrides,
  }
}

function makeSignalRow(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    id: 'sig-1',
    business_id: 'biz-1',
    watched_repo_id: null,
    watched_feed_id: 'feed-1',
    source: 'rss',
    kind: 'article',
    external_id: 'rss:abc',
    title: 'A competitor launches a thing' as SignalRow['title'],
    body: 'Some body text about the launch.' as SignalRow['body'],
    body_truncated: false,
    html_url: 'https://competitor.example.com/launch',
    occurred_at: '2026-08-01T09:00:00Z',
    is_prerelease: false,
    author_is_bot: false,
    ingested_via: 'poll',
    content_hash: 'contenthash-1',
    created_at: '2026-08-01T09:05:00Z',
    updated_at: '2026-08-01T09:05:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecentSignals.mockResolvedValue([])
  mockScoreSignal.mockReturnValue({
    score: 42,
    scoreInputs: { recency: 40, substance: 20, kindWeight: 15, repoWeight: 10, humanAuthored: 5 },
  } as never)
  mockUpsertCandidate.mockResolvedValue({ id: 'cand-1' } as never)
  mockInsert.mockResolvedValue({ status: 'inserted', signal: makeSignalRow() })
})

const NOW = new Date('2026-08-01T10:00:00Z')

// ── computeRssExternalId — dedup key ────────────────────────────────────────

describe('computeRssExternalId — dedup key (ADR §3.4)', () => {
  it('hashes the canonical link when present, prefixed rss:', () => {
    const id = computeRssExternalId('https://example.com/article', null)
    expect(id).toMatch(/^rss:[a-f0-9]{64}$/)
  })

  it('normalizes before hashing: same result for tracking-param and non-tracking-param variants', () => {
    const a = computeRssExternalId('https://Example.com/article?utm_source=x', null)
    const b = computeRssExternalId('https://example.com/article', null)
    expect(a).toBe(b)
  })

  it('normalizes trailing slash: same result with and without', () => {
    const a = computeRssExternalId('https://example.com/article/', null)
    const b = computeRssExternalId('https://example.com/article', null)
    expect(a).toBe(b)
  })

  it('normalizes fragment away: same result with and without a #fragment', () => {
    const a = computeRssExternalId('https://example.com/article#section-2', null)
    const b = computeRssExternalId('https://example.com/article', null)
    expect(a).toBe(b)
  })

  it('falls back to guid ONLY when no link exists', () => {
    const id = computeRssExternalId(null, 'urn:uuid:11111111-1111-1111-1111-111111111111')
    expect(id).toMatch(/^rss:[a-f0-9]{64}$/)
  })

  it('link and guid produce DIFFERENT hashes (link is preferred, not merged)', () => {
    const withLink = computeRssExternalId('https://example.com/article', 'urn:uuid:different')
    const guidOnly = computeRssExternalId(null, 'urn:uuid:different')
    expect(withLink).not.toBe(guidOnly)
  })

  it('returns null when neither link nor guid exists', () => {
    expect(computeRssExternalId(null, null)).toBeNull()
  })

  it('a non-URL guid (URN) still hashes deterministically without throwing', () => {
    expect(() => computeRssExternalId(null, 'urn:uuid:abc')).not.toThrow()
    const a = computeRssExternalId(null, 'urn:uuid:abc')
    const b = computeRssExternalId(null, 'urn:uuid:abc')
    expect(a).toBe(b)
  })
})

// ── SIGNAL-MR-FEED-ISOLATED — one failing feed does not halt others ────────

describe('SIGNAL-MR-FEED-ISOLATED — per-feed isolation', () => {
  it('a fetch error on one feed does not stop the next feed from being polled', async () => {
    const feedA = makeFeed({ id: 'feed-a', business_id: 'biz-a' })
    const feedB = makeFeed({ id: 'feed-b', business_id: 'biz-b' })
    mockList.mockResolvedValue([feedA, feedB])

    mockFetchAndParse
      .mockResolvedValueOnce({ status: 'error', errorCode: 'address_blocked', message: 'blocked' })
      .mockResolvedValueOnce({ status: 'ok', articles: [makeArticle()], malformedCount: 0, etag: null, lastModified: null })

    const summary = await pollWatchedFeeds(NOW)

    expect(summary.rssFeedsConsidered).toBe(2)
    expect(summary.rssFeedsFailed).toBe(1)
    expect(summary.rssFeedsFetched).toBe(1)
    expect(summary.rssItemsIngested).toBe(1)
    expect(mockFetchAndParse).toHaveBeenCalledTimes(2)
  })

  it('an XXE rejection on one feed does not stop the next feed, and is counted as guard-rejected', async () => {
    const feedA = makeFeed({ id: 'feed-a' })
    const feedB = makeFeed({ id: 'feed-b' })
    mockList.mockResolvedValue([feedA, feedB])

    mockFetchAndParse
      .mockResolvedValueOnce({ status: 'error', errorCode: 'xxe_rejected', message: 'rejected' })
      .mockResolvedValueOnce({ status: 'not_modified' })

    const summary = await pollWatchedFeeds(NOW)

    expect(summary.rssFeedsFailed).toBe(1)
    expect(summary.rssGuardRejected).toBe(1)
    expect(summary.rssFeedsNotModified).toBe(1)
  })

  it('a genuinely unexpected throw for one feed (e.g. a DB write failure) does not stop the next feed', async () => {
    const feedA = makeFeed({ id: 'feed-a' })
    const feedB = makeFeed({ id: 'feed-b' })
    mockList.mockResolvedValue([feedA, feedB])
    mockFetchAndParse.mockResolvedValue({ status: 'not_modified' })
    mockRecord.mockRejectedValueOnce(new Error('db write failed')).mockResolvedValue(undefined)

    const summary = await pollWatchedFeeds(NOW)

    expect(summary.rssFeedsConsidered).toBe(2)
    expect(summary.rssFeedsFailed).toBe(1)
    expect(mockCaptureException).toHaveBeenCalled()
  })
})

// ── Tick line carries every counter ─────────────────────────────────────────

describe('the returned summary carries every named counter (§9.4 clause 4)', () => {
  it('feeds considered, fetched, 304-unchanged, failed, items ingested, duplicates, guard-rejected', async () => {
    const feeds = [
      makeFeed({ id: 'f1' }), // ok, 1 item ingested
      makeFeed({ id: 'f2' }), // not_modified
      makeFeed({ id: 'f3' }), // error
    ]
    mockList.mockResolvedValue(feeds)
    mockFetchAndParse
      .mockResolvedValueOnce({ status: 'ok', articles: [makeArticle()], malformedCount: 1, etag: '"e1"', lastModified: null })
      .mockResolvedValueOnce({ status: 'not_modified' })
      .mockResolvedValueOnce({ status: 'error', errorCode: 'timeout', message: 'timed out' })

    const summary = await pollWatchedFeeds(NOW)

    expect(summary).toMatchObject({
      rssFeedsConsidered: 3,
      rssFeedsFetched: 1,
      rssFeedsNotModified: 1,
      rssFeedsFailed: 1,
      rssItemsIngested: 1,
      rssGuardRejected: 1, // the malformedCount:1 from the ok feed
    })
  })

  it('SIGNAL-MR-DEDUP-STABLE: a near-duplicate content_hash within the window is counted, not inserted', async () => {
    const feed = makeFeed()
    mockList.mockResolvedValue([feed])
    mockFetchAndParse.mockResolvedValue({ status: 'ok', articles: [makeArticle()], malformedCount: 0, etag: null, lastModified: null })
    // A recent signal with the SAME content_hash the new article would compute.
    mockRecentSignals.mockResolvedValue([makeSignalRow({ content_hash: expectedContentHash(makeArticle()) })])

    const summary = await pollWatchedFeeds(NOW)

    expect(summary.rssDuplicates).toBe(1)
    expect(summary.rssItemsIngested).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('SIGNAL-MR-INGEST-ATOMIC: a 23505 duplicate from insertSignal itself is counted as a duplicate, not an error', async () => {
    const feed = makeFeed()
    mockList.mockResolvedValue([feed])
    mockFetchAndParse.mockResolvedValue({ status: 'ok', articles: [makeArticle()], malformedCount: 0, etag: null, lastModified: null })
    mockInsert.mockResolvedValue({ status: 'duplicate' })

    const summary = await pollWatchedFeeds(NOW)

    expect(summary.rssDuplicates).toBe(1)
    expect(summary.rssItemsIngested).toBe(0)
  })
})

// ── D4 (Session 30-D, MAJOR-3) — the guid dedup fallback ADR §3.4
// specifies, wired at the call site ──────────────────────────────────────────

describe('D4 — the guid dedup fallback (ADR §3.4)', () => {
  it('an item with a guid and NO link INGESTS via the guid fallback, computing external_id = rss:sha256(guid) — not a guard rejection', async () => {
    const feed = makeFeed()
    mockList.mockResolvedValue([feed])
    const guidOnlyArticle = makeArticle({ link: null, html_url: null, guid: 'urn:uuid:guid-only-item' })
    mockFetchAndParse.mockResolvedValue({ status: 'ok', articles: [guidOnlyArticle], malformedCount: 0, etag: null, lastModified: null })

    const summary = await pollWatchedFeeds(NOW)

    expect(summary.rssItemsIngested).toBe(1)
    expect(summary.rssGuardRejected).toBe(0)
    expect(summary.rssMissingDedupKey).toBe(0)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: computeRssExternalId(null, 'urn:uuid:guid-only-item') }),
    )
  })

  it('an item with NEITHER link NOR guid is the genuine residual: counted as rssMissingDedupKey, never rssGuardRejected', async () => {
    const feed = makeFeed()
    mockList.mockResolvedValue([feed])
    const identitylessArticle = makeArticle({ link: null, html_url: null, guid: null })
    mockFetchAndParse.mockResolvedValue({ status: 'ok', articles: [identitylessArticle], malformedCount: 0, etag: null, lastModified: null })

    const summary = await pollWatchedFeeds(NOW)

    expect(summary.rssMissingDedupKey).toBe(1)
    expect(summary.rssGuardRejected).toBe(0)
    expect(summary.rssItemsIngested).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

// ── Sentry receives identifiers and NO body text ───────────────────────────

describe('Sentry receives identifiers only, never body text (§9.4 clause 3)', () => {
  it('a fetch/XXE failure reports only business_id, watched_feed_id, phase, error_code — never the article title/body', async () => {
    const feed = makeFeed({ id: 'feed-secret', business_id: 'biz-secret' })
    mockList.mockResolvedValue([feed])
    mockFetchAndParse.mockResolvedValue({ status: 'error', errorCode: 'xxe_rejected', message: 'a message that could echo attacker text' })

    await pollWatchedFeeds(NOW)

    expect(mockCaptureException).toHaveBeenCalledOnce()
    const [, context] = mockCaptureException.mock.calls[0]!
    const tags = (context as { tags: Record<string, unknown> }).tags
    expect(tags).toEqual({
      business_id: 'biz-secret',
      watched_feed_id: 'feed-secret',
      phase: 'signals-rss-fetch',
      error_code: 'xxe_rejected',
    })
    // No `extra` key carrying the raw error message/body at all.
    expect(context).not.toHaveProperty('extra')
  })
})

// ── Per-tick wall-clock budget ───────────────────────────────────────────────

describe('per-tick wall-clock budget (§16)', () => {
  it('stops polling once the budget is exhausted, without marking the remaining feeds as failed', async () => {
    const feeds = [makeFeed({ id: 'f1' }), makeFeed({ id: 'f2' })]
    mockList.mockResolvedValue(feeds)
    mockFetchAndParse.mockResolvedValue({ status: 'not_modified' })

    // Zero budget: the deadline check (Date.now() - loopStartedAtMs >=
    // budgetMs) is true from the very first iteration regardless of real
    // elapsed time, so every feed is deferred to the next tick rather than
    // polled — this exercises the SAME code path a genuinely exhausted
    // budget would, without needing to actually burn wall-clock time in a
    // unit test.
    const originalBudget = config.server.RSS_FEED_POLL_TICK_BUDGET_MS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(config.server as any).RSS_FEED_POLL_TICK_BUDGET_MS = 0
    try {
      const summary = await pollWatchedFeeds(NOW)
      expect(summary.rssFeedsConsidered).toBe(0)
      expect(summary.rssFeedsFailed).toBe(0)
      expect(mockFetchAndParse).not.toHaveBeenCalled()
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(config.server as any).RSS_FEED_POLL_TICK_BUDGET_MS = originalBudget
    }
  })
})

// Local replica of the content-hash function under test, so the dedup test
// above can construct a matching "existing" row without importing a
// private function from the module under test.
function expectedContentHash(article: ParsedArticle): string {
  const body = article.body ?? ''
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(article.title, 'utf8'), Buffer.from([0]), Buffer.from(body, 'utf8')]))
    .digest('hex')
}
