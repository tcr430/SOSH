import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatISO, subDays, subMonths } from 'date-fns'

vi.mock('@/lib/social', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social')>('@/lib/social')
  return { ...actual, getRegistry: vi.fn() }
})
vi.mock('@/lib/db/backfill-runs', () => ({
  getBackfillRunById: vi.fn(),
  transitionBackfillRun: vi.fn(),
  recordBackfillFetchProgress: vi.fn(),
}))
vi.mock('@/lib/db/backfill-posts', () => ({
  stageBackfillPosts: vi.fn(),
}))

import { getRegistry, SocialProviderError } from '@/lib/social'
import type { SocialProvider, RecentPost } from '@/lib/social'
import { getBackfillRunById, transitionBackfillRun, recordBackfillFetchProgress } from '@/lib/db/backfill-runs'
import { stageBackfillPosts } from '@/lib/db/backfill-posts'
import type { SocialBackfillRunRow, BackfillRunStatus } from '@/lib/db/types'
import { fetchPhase } from '../orchestrator'

const mockGetRegistry = vi.mocked(getRegistry)
const mockGetBackfillRunById = vi.mocked(getBackfillRunById)
const mockTransitionBackfillRun = vi.mocked(transitionBackfillRun)
const mockRecordBackfillFetchProgress = vi.mocked(recordBackfillFetchProgress)
const mockStageBackfillPosts = vi.mocked(stageBackfillPosts)

afterEach(() => {
  vi.clearAllMocks()
})

function makeRun(overrides: Partial<SocialBackfillRunRow> = {}): SocialBackfillRunRow {
  return {
    id: 'run-1',
    business_id: 'biz-1',
    social_account_id: 'sa-1',
    platform: 'twitter',
    status: 'queued',
    partial: false,
    account_role: null,
    weighting: null,
    posts_fetched: 0,
    posts_extracted: 0,
    platform_posts_read: 0,
    spend_cents: 0,
    ceiling_cents: 50,
    passes_done: 0,
    summary: {},
    staged_voice: null,
    voice_status: null,
    voice_applied_to: null,
    voice_applied_at: null,
    error_code: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    ratified_at: null,
    ...overrides,
  }
}

// A minimal in-memory double for the run-row's status/counters, wired
// through the SAME mocked wrapper functions the real orchestrator calls —
// this is "the existing db test double pattern" the build guide points to,
// giving STAGING ROWS AND RUN STATE assertions without touching Postgres.
function wireDb(initialRun: SocialBackfillRunRow) {
  let run = { ...initialRun }
  const stagedKeys = new Set<string>() // `${social_account_id}::${platform_post_id}`
  const stagedRows: Array<{ socialAccountId: string; post: RecentPost }> = []

  mockGetBackfillRunById.mockImplementation(async (id: string) => (id === run.id ? { ...run } : null))

  mockTransitionBackfillRun.mockImplementation(
    async (runId: string, fromStatuses: readonly BackfillRunStatus[], toStatus: BackfillRunStatus, errorCode?: string | null) => {
      if (runId !== run.id || !fromStatuses.includes(run.status)) return null
      run = {
        ...run,
        status: toStatus,
        error_code: toStatus === 'failed' ? (errorCode ?? null) : run.error_code,
        started_at: toStatus === 'fetching' && run.started_at === null ? '2026-09-14T00:00:00Z' : run.started_at,
      }
      return { ...run }
    },
  )

  mockRecordBackfillFetchProgress.mockImplementation(async (runId: string, postsFetchedDelta: number, platformPostsReadDelta: number) => {
    if (runId !== run.id || run.status !== 'fetching') return null
    run = {
      ...run,
      posts_fetched: run.posts_fetched + postsFetchedDelta,
      platform_posts_read: run.platform_posts_read + platformPostsReadDelta,
    }
    return { ...run }
  })

  mockStageBackfillPosts.mockImplementation(async (runId: string, _businessId: string, socialAccountId: string, posts: readonly RecentPost[]) => {
    let staged = 0
    for (const post of posts) {
      const key = `${socialAccountId}::${post.platformPostId}`
      if (stagedKeys.has(key)) continue
      stagedKeys.add(key)
      stagedRows.push({ socialAccountId, post })
      staged += 1
    }
    return staged
  })

  return {
    getRun: () => run,
    stagedRows,
    stagedKeys,
  }
}

function registryWith(provider: SocialProvider) {
  mockGetRegistry.mockReturnValue({ get: () => provider, register: vi.fn() })
}

// BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL (ADR 0025 §12 constraint 11) —
// lib/backfill/** may not import @/lib/social/mock-provider directly (only
// @/lib/social's barrel), and MockProvider is not barrel-exported. A plain
// SocialProvider-shaped fake, fully controlled per test via
// fetchRecentPosts overrides, serves the same purpose here.
function makeFakeProvider(historicalReadAvailable = true, platform: SocialProvider['platform'] = 'twitter'): SocialProvider {
  return {
    platform,
    historicalReadAvailable,
    getOAuthAuthorizeUrl: vi.fn(),
    exchangeOAuthCode: vi.fn(),
    publish: vi.fn(),
    fetchPostMetrics: vi.fn(),
    fetchEngagement: vi.fn(),
    refreshAccessToken: vi.fn(),
    revokeAccessToken: vi.fn(),
    fetchRecentPosts: vi.fn(),
  }
}

const NOW = new Date('2026-09-14T00:00:00Z')
function daysAgo(n: number): string {
  return formatISO(subDays(NOW, n))
}

function post(platformPostId: string, publishedAt: string): RecentPost {
  return { platformPostId, publishedAt, content: `post ${platformPostId}`, url: null, format: 'text', metrics: null }
}

describe('fetchPhase (ADR 0025 §2.3/§6.5, Session 32 I2.8)', () => {
  it('standard: stages every in-window post from a single-page provider, transitions to extracting', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)

    // A direct fetchRecentPosts spy, not a shared fixture's date math —
    // this test only needs to prove "in-window posts get staged".
    provider.fetchRecentPosts = vi.fn().mockResolvedValue({
      posts: [post('p1', daysAgo(10)), post('p2', daysAgo(20)), post('p3', daysAgo(30))],
      nextCursor: null,
    })

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'extracting', postsStaged: 3, platformPostsRead: 3 })
    expect(db.stagedRows).toHaveLength(3)
    expect(db.getRun().status).toBe('extracting')
    expect(db.getRun().posts_fetched).toBe(3)
    expect(db.getRun().platform_posts_read).toBe(3)
  })

  it('excludes posts older than the 24-month lookback, even when the provider returns them', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    const tooOld = formatISO(subMonths(NOW, 25))
    provider.fetchRecentPosts = vi
      .fn()
      .mockResolvedValue({ posts: [post('recent', daysAgo(5)), post('old', tooOld)], nextCursor: null })

    await fetchPhase('run-1')

    expect(db.stagedRows.map((r) => r.post.platformPostId)).toEqual(['recent'])
  })

  it('non-terminating: stops at BACKFILL_MAX_PAGES (5), never loops forever', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    let calls = 0
    provider.fetchRecentPosts = vi.fn().mockImplementation(async () => {
      calls += 1
      return { posts: [post(`p${calls}`, daysAgo(1))], nextCursor: `cursor-${calls}` }
    })

    const result = await fetchPhase('run-1')

    expect(calls).toBe(5)
    expect(result).toEqual({ status: 'extracting', postsStaged: 5, platformPostsRead: 5 })
    expect(db.getRun().status).toBe('extracting')
  })

  it('stops once platform_posts_read would reach BACKFILL_MAX_PLATFORM_READS (500)', async () => {
    wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    let calls = 0
    provider.fetchRecentPosts = vi.fn().mockImplementation(async () => {
      calls += 1
      // 199 of every 200 posts are outside the lookback window (so
      // postsStaged, the OTHER loop-stop bound, never trips first) — only
      // platform_posts_read climbs by 200 per page.
      const posts = [
        post(`in-window-${calls}`, daysAgo(1)),
        ...Array.from({ length: 199 }, (_, i) => post(`old-${calls}-${i}`, '2000-01-01T00:00:00Z')),
      ]
      return { posts, nextCursor: `cursor-${calls}` }
    })

    const result = await fetchPhase('run-1')

    // 200 read -> loop continues (200 < 500); 400 read -> continues (400 <
    // 500); a third page would be requested (400 < 500 still true before
    // the call), landing at 600 read — the bound is checked BEFORE each
    // page request, so exactly 3 calls happen (200, 400, 600 posts read),
    // matching "stops once it would reach" as a per-page check, not a
    // mid-page cutoff.
    expect(calls).toBe(3)
    expect(result.status).toBe('extracting')
  })

  it('zero-post-page: an empty page with a non-null cursor is NOT the end — the loop continues', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    provider.fetchRecentPosts = vi
      .fn()
      .mockResolvedValueOnce({ posts: [], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ posts: [post('p1', daysAgo(1))], nextCursor: null })

    const result = await fetchPhase('run-1')

    expect(provider.fetchRecentPosts).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ status: 'extracting', postsStaged: 1, platformPostsRead: 1 })
    expect(db.stagedRows).toHaveLength(1)
  })

  it('empty: a provider with zero posts total transitions straight to extracting with zero staged', async () => {
    wireDb(makeRun())
    registryWith(makeFakeProvider())
    const provider = getRegistry().get('twitter')
    provider.fetchRecentPosts = vi.fn().mockResolvedValue({ posts: [], nextCursor: null })

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'extracting', postsStaged: 0, platformPostsRead: 0 })
  })

  it('overlapping pages: staging the same platformPostId twice produces no duplicate rows', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    provider.fetchRecentPosts = vi
      .fn()
      .mockResolvedValueOnce({ posts: [post('p1', daysAgo(1)), post('p2', daysAgo(2))], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ posts: [post('p2', daysAgo(2)), post('p3', daysAgo(3))], nextCursor: null })

    await fetchPhase('run-1')

    expect(db.stagedRows.map((r) => r.post.platformPostId).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('fail-on-page-N with TOKEN_EXPIRED: fails (resumable), already-staged pages are kept, a re-run stages no duplicates', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    provider.fetchRecentPosts = vi
      .fn()
      .mockResolvedValueOnce({ posts: [post('p1', daysAgo(1))], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ posts: [post('p2', daysAgo(1))], nextCursor: 'page-3' })
      .mockRejectedValueOnce(new SocialProviderError({ code: 'TOKEN_EXPIRED', message: 'expired', platform: 'twitter' }))

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'failed', errorCode: 'TOKEN_EXPIRED' })
    expect(db.getRun().status).toBe('failed')
    expect(db.getRun().error_code).toBe('TOKEN_EXPIRED')
    expect(db.stagedRows).toHaveLength(2) // pages 1-2 kept

    // Resume: run is now 'failed' — simulate resume_backfill_run (I2.5)
    // putting it back to 'queued', then re-run fetchPhase from scratch.
    mockGetBackfillRunById.mockImplementation(async () => ({ ...db.getRun(), status: 'queued' }))
    mockTransitionBackfillRun.mockImplementation(async (runId, fromStatuses, toStatus, errorCode) => {
      const current = { ...db.getRun(), status: 'queued' as BackfillRunStatus }
      if (runId !== current.id || !fromStatuses.includes(current.status)) return null
      const updated = { ...current, status: toStatus, error_code: toStatus === 'failed' ? (errorCode ?? null) : current.error_code }
      mockGetBackfillRunById.mockImplementation(async (id: string) => (id === runId ? updated : null))
      return updated
    })
    provider.fetchRecentPosts = vi
      .fn()
      .mockResolvedValueOnce({ posts: [post('p1', daysAgo(1)), post('p2', daysAgo(1))], nextCursor: null })

    const secondResult = await fetchPhase('run-1')
    expect(secondResult.status).toBe('extracting')
    expect(db.stagedRows).toHaveLength(2) // still 2, no duplicates from the resume
  })

  it('RATE_LIMITED defers the run (NOT failed) — status stays fetching', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    provider.fetchRecentPosts = vi
      .fn()
      .mockRejectedValueOnce(new SocialProviderError({ code: 'RATE_LIMITED', message: 'slow down', platform: 'twitter' }))

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'deferred', reason: 'rate_limited' })
    expect(db.getRun().status).toBe('fetching')
  })

  it('NETWORK leaves the run for the next tick (NOT failed) — status stays fetching', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    provider.fetchRecentPosts = vi
      .fn()
      .mockRejectedValueOnce(new SocialProviderError({ code: 'NETWORK', message: 'timeout', platform: 'twitter' }))

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'deferred', reason: 'network' })
    expect(db.getRun().status).toBe('fetching')
  })

  it('a RangeError from the provider fails the run as caller_bug (not resumable)', async () => {
    const db = wireDb(makeRun())
    const provider = makeFakeProvider()
    registryWith(provider)
    provider.fetchRecentPosts = vi.fn().mockRejectedValueOnce(new RangeError('pageSize out of range'))

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'failed', errorCode: 'caller_bug' })
    expect(db.getRun().error_code).toBe('caller_bug')
  })

  it('a LinkedIn-platform run with historicalReadAvailable=false goes straight to unsupported, zero fetchRecentPosts calls', async () => {
    const db = wireDb(makeRun({ platform: 'linkedin' }))
    const unsupportedProvider = makeFakeProvider(false, 'linkedin')
    registryWith(unsupportedProvider)

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'unsupported' })
    expect(unsupportedProvider.fetchRecentPosts).not.toHaveBeenCalled()
    expect(db.getRun().status).toBe('unsupported')
    expect(db.getRun().platform_posts_read).toBe(0)
  })

  it('a run not in queued/fetching state (already discarded/ratified) is a no-op', async () => {
    wireDb(makeRun({ status: 'discarded' }))
    registryWith(makeFakeProvider())

    const result = await fetchPhase('run-1')

    expect(result).toEqual({ status: 'no_op' })
  })

  // MAJOR-3 (Session 32-D, D5) — the run's cumulative platform_posts_read
  // and posts_fetched MUST seed the loop-stop counters on every call, not
  // just the first. Before the fix these were local to a single call, so a
  // deferral/resume/reconnect always restarted at cursor=null with fresh
  // counters and could blow past both ceilings across repeated calls.
  describe('cumulative bounds across calls (MAJOR-3, Session 32-D D5)', () => {
    it('a run resumed already at the platform-read ceiling moves to extracting with zero provider calls', async () => {
      const db = wireDb(makeRun({ status: 'fetching', platform_posts_read: 500, posts_fetched: 10 }))
      const provider = makeFakeProvider()
      registryWith(provider)

      const result = await fetchPhase('run-1')

      expect(provider.fetchRecentPosts).not.toHaveBeenCalled()
      expect(result).toEqual({ status: 'extracting', postsStaged: 0, platformPostsRead: 0 })
      expect(db.getRun().status).toBe('extracting')
      // Cumulative totals are untouched — nothing new happened this call.
      expect(db.getRun().platform_posts_read).toBe(500)
      expect(db.getRun().posts_fetched).toBe(10)
    })

    it('a run resumed already at the posts-staged ceiling moves to extracting with zero provider calls', async () => {
      const db = wireDb(makeRun({ status: 'fetching', posts_fetched: 200, platform_posts_read: 50 }))
      const provider = makeFakeProvider()
      registryWith(provider)

      const result = await fetchPhase('run-1')

      expect(provider.fetchRecentPosts).not.toHaveBeenCalled()
      expect(result).toEqual({ status: 'extracting', postsStaged: 0, platformPostsRead: 0 })
      expect(db.getRun().status).toBe('extracting')
    })

    it('a run already at 150 staged stages at most 50 more before the 200 ceiling stops it', async () => {
      const db = wireDb(makeRun({ status: 'fetching', posts_fetched: 150, platform_posts_read: 150 }))
      const provider = makeFakeProvider()
      registryWith(provider)
      // Exactly 50 new in-window posts in one page — a page-boundary check
      // (not a mid-page cutoff) is the cleanest way to prove "at most 50
      // more" without relying on provider-side truncation.
      provider.fetchRecentPosts = vi.fn().mockResolvedValueOnce({
        posts: Array.from({ length: 50 }, (_, i) => post(`p${i}`, daysAgo(1))),
        nextCursor: 'page-2',
      })

      const result = await fetchPhase('run-1')

      expect(provider.fetchRecentPosts).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ status: 'extracting', postsStaged: 50, platformPostsRead: 50 })
      expect(db.getRun().posts_fetched).toBe(200)
    })

    it('cumulative platform_posts_read persists across a deferral and a resumed call, stopping the run near the ceiling instead of restarting at zero', async () => {
      const db = wireDb(makeRun({ status: 'fetching', platform_posts_read: 0, posts_fetched: 0 }))
      const provider = makeFakeProvider()
      registryWith(provider)
      // Every page is 199 old + 1 in-window, so postsStaged never trips
      // first — only platform_posts_read climbs, 200 per page — mirroring
      // the single-call 500-read test above.
      let calls = 0
      provider.fetchRecentPosts = vi
        .fn()
        .mockImplementationOnce(async () => {
          calls += 1
          return {
            posts: [post('in-1', daysAgo(1)), ...Array.from({ length: 199 }, (_, i) => post(`old-1-${i}`, '2000-01-01T00:00:00Z'))],
            nextCursor: 'cursor-1',
          }
        })
        .mockImplementationOnce(async () => {
          calls += 1
          return {
            posts: [post('in-2', daysAgo(1)), ...Array.from({ length: 199 }, (_, i) => post(`old-2-${i}`, '2000-01-01T00:00:00Z'))],
            nextCursor: 'cursor-2',
          }
        })
        .mockRejectedValueOnce(new SocialProviderError({ code: 'RATE_LIMITED', message: 'slow down', platform: 'twitter' }))

      const firstResult = await fetchPhase('run-1')
      expect(firstResult).toEqual({ status: 'deferred', reason: 'rate_limited' })
      expect(calls).toBe(2) // 2 successful pages; the 3rd call rejected before incrementing `calls`
      expect(db.getRun().platform_posts_read).toBe(400)
      expect(db.getRun().status).toBe('fetching')

      // Second call (a resume): seeds from the cumulative 400, requests one
      // more page (600 read after it), then stops WITHOUT another provider
      // call — proving the ceiling is enforced against the cumulative
      // total, not reset to zero for this call.
      provider.fetchRecentPosts = vi.fn().mockResolvedValueOnce({
        posts: [post('in-3', daysAgo(1)), ...Array.from({ length: 199 }, (_, i) => post(`old-3-${i}`, '2000-01-01T00:00:00Z'))],
        nextCursor: 'cursor-3',
      })

      const secondResult = await fetchPhase('run-1')
      expect(provider.fetchRecentPosts).toHaveBeenCalledTimes(1)
      expect(secondResult.status).toBe('extracting')
      expect(db.getRun().platform_posts_read).toBe(600)
      expect(db.getRun().status).toBe('extracting')
    })
  })
})
