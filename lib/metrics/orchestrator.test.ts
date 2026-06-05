import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatISO } from 'date-fns'
import { runMetricsSyncTick } from './orchestrator'
import { SocialProviderError, getRegistry } from '@/lib/social/index'
import { markCronSeen } from '@/lib/db/cron-health'
import * as Sentry from '@sentry/nextjs'
import type { SocialProviderErrorCode } from '@/lib/social/index'
import { listPostsForMetricsSync } from '@/lib/db/posts'
import { upsertPostMetrics } from '@/lib/db/post-metrics'
import { getActiveByBusinessAndPlatform } from '@/lib/db/social-accounts'
import type { PostRow, SocialAccountRow, VaultSecretId } from '@/lib/db/types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      METRICS_SYNC_BATCH_SIZE: 50,
      METRICS_STALE_MINUTES: 360,
      METRICS_MAX_AGE_DAYS: 90,
    },
  },
}))

vi.mock('@/lib/db/posts', () => ({
  listPostsForMetricsSync: vi.fn(),
}))

vi.mock('@/lib/db/post-metrics', () => ({
  upsertPostMetrics: vi.fn(),
}))

vi.mock('@/lib/db/social-accounts', () => ({
  getActiveByBusinessAndPlatform: vi.fn(),
}))

vi.mock('@/lib/social/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/social/index')>()
  return { ...mod, getRegistry: vi.fn() }
})

vi.mock('@/lib/db/cron-health', () => ({
  markCronSeen: vi.fn().mockResolvedValue(undefined),
  getCronLastSeen: vi.fn().mockResolvedValue(null),
}))

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation((_slug: string, fn: () => unknown) => fn()),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-30T10:00:00.000Z')

function makePost(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'post-1',
    campaign_id: 'camp-1',
    business_id: 'biz-1',
    platform: 'linkedin',
    content: 'Test content',
    hashtags: [],
    media_urls: [],
    scheduled_at: '2026-05-01T10:00:00Z',
    published_at: '2026-05-01T10:05:00Z',
    platform_post_id: 'li-post-1',
    platform_url: 'https://linkedin.com/test',
    status: 'published',
    rejection_note: null,
    ai_generation_metadata: {},
    publish_attempts: 1,
    last_publish_attempt_at: '2026-05-01T10:05:00Z',
    last_publish_error: null,
    deleted_at: null,
    created_at: '2026-04-30T00:00:00Z',
    updated_at: '2026-05-01T10:05:00Z',
    ...overrides,
  }
}

const mockAccount: SocialAccountRow = {
  id: 'acct-1',
  business_id: 'biz-1',
  platform: 'linkedin',
  platform_user_id: 'li-user-1',
  platform_username: 'testuser',
  platform_display_name: 'Test User',
  vault_access_token_id: 'vault-1' as VaultSecretId,
  vault_refresh_token_id: null,
  token_expires_at: null,
  is_active: true,
  connected_at: '2026-04-01T00:00:00Z',
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
}

// ─── Provider mock ─────────────────────────────────────────────────────────────

let mockFetchPostMetrics: ReturnType<typeof vi.fn>
let mockRefreshAccessToken: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()

  mockFetchPostMetrics = vi.fn()
  mockRefreshAccessToken = vi.fn()

  vi.mocked(getRegistry).mockReturnValue({
    get: () => ({
      fetchPostMetrics: mockFetchPostMetrics,
      refreshAccessToken: mockRefreshAccessToken,
    }),
  } as unknown as ReturnType<typeof getRegistry>)

  vi.mocked(listPostsForMetricsSync).mockResolvedValue([])
  vi.mocked(getActiveByBusinessAndPlatform).mockResolvedValue(mockAccount)
  vi.mocked(upsertPostMetrics).mockResolvedValue({} as never)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runMetricsSyncTick', () => {
  it('success: maps null and zero metric values verbatim — no coalescing (ADR §6)', async () => {
    const post = makePost()
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([post])
    mockFetchPostMetrics.mockResolvedValue({
      likes: 5,
      comments: 0,
      shares: null,
      saves: null,
      clicks: 0,
      reach: 0,
      impressions: null,
      fetchedAt: formatISO(NOW),
    })

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(summary.synced).toBe(1)
    expect(summary.errors).toBe(0)
    expect(vi.mocked(upsertPostMetrics)).toHaveBeenCalledOnce()
    expect(vi.mocked(upsertPostMetrics)).toHaveBeenCalledWith(
      expect.objectContaining({
        post_id: post.id,
        business_id: post.business_id,
        likes: 5,
        comments: 0,
        shares: null,
        saves: null,
        clicks: 0,
        reach: 0,
        impressions: null,
        last_synced_at: formatISO(NOW),
      }),
    )
  })

  it('per-platform short-circuit: NOT_IMPLEMENTED on first call marks platform; remaining posts skip without provider call (ADR §1)', async () => {
    const linkedinPosts = Array.from({ length: 5 }, (_, i) =>
      makePost({ id: `li-post-${i}`, platform: 'linkedin', platform_post_id: `li-${i}` }),
    )
    const twitterPosts = Array.from({ length: 3 }, (_, i) =>
      makePost({ id: `tw-post-${i}`, platform: 'twitter', platform_post_id: `tw-${i}` }),
    )
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([...linkedinPosts, ...twitterPosts])
    mockFetchPostMetrics.mockRejectedValue(
      new SocialProviderError({ code: 'NOT_IMPLEMENTED', message: 'Metrics not implemented' }),
    )

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(mockFetchPostMetrics).toHaveBeenCalledTimes(2)
    expect(summary.skippedNotImplemented).toBe(8)
    expect(summary.errors).toBe(0)
    expect(vi.mocked(upsertPostMetrics)).not.toHaveBeenCalled()
  })

  it('skippedNoData: provider returns null — no upsert, skippedNoData incremented', async () => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([makePost()])
    mockFetchPostMetrics.mockResolvedValue(null)

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(summary.skippedNoData).toBe(1)
    expect(summary.synced).toBe(0)
    expect(vi.mocked(upsertPostMetrics)).not.toHaveBeenCalled()
  })

  it('skippedNoAccount: no active social account — provider not called, skippedNoAccount incremented', async () => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([makePost()])
    vi.mocked(getActiveByBusinessAndPlatform).mockResolvedValue(null)

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(summary.skippedNoAccount).toBe(1)
    expect(mockFetchPostMetrics).not.toHaveBeenCalled()
    expect(vi.mocked(upsertPostMetrics)).not.toHaveBeenCalled()
  })

  it('TOKEN_EXPIRED: counted as error — no refresh attempted (ADR §5 A2)', async () => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([makePost()])
    mockFetchPostMetrics.mockRejectedValue(
      new SocialProviderError({ code: 'TOKEN_EXPIRED', message: 'Token expired' }),
    )

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(summary.errors).toBe(1)
    expect(summary.synced).toBe(0)
    expect(mockRefreshAccessToken).not.toHaveBeenCalled()
    expect(vi.mocked(upsertPostMetrics)).not.toHaveBeenCalled()
  })

  it('TOKEN_REVOKED: counted as error — no mutation', async () => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([makePost()])
    mockFetchPostMetrics.mockRejectedValue(
      new SocialProviderError({ code: 'TOKEN_REVOKED', message: 'Token revoked' }),
    )

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(summary.errors).toBe(1)
    expect(vi.mocked(upsertPostMetrics)).not.toHaveBeenCalled()
  })

  it.each<SocialProviderErrorCode>([
    'RATE_LIMITED',
    'NETWORK',
    'PLATFORM_REJECTED',
    'PROVIDER_NOT_CONFIGURED',
    'UNKNOWN',
  ])('%s: counted as error, no upsert', async (code) => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([makePost()])
    mockFetchPostMetrics.mockRejectedValue(new SocialProviderError({ code, message: 'Error' }))

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(summary.errors).toBe(1)
    expect(vi.mocked(upsertPostMetrics)).not.toHaveBeenCalled()
  })

  it('batch limit: listPostsForMetricsSync called with batchSize as limit', async () => {
    const batchSize = 5
    const posts = Array.from({ length: batchSize }, (_, i) =>
      makePost({ id: `post-${i}`, platform_post_id: `pid-${i}` }),
    )
    vi.mocked(listPostsForMetricsSync).mockResolvedValue(posts)
    mockFetchPostMetrics.mockResolvedValue({
      likes: 0, comments: 0, shares: 0, saves: 0,
      clicks: 0, reach: 0, impressions: 0, fetchedAt: formatISO(NOW),
    })

    const summary = await runMetricsSyncTick({ now: NOW, batchSize })

    expect(summary.candidates).toBe(batchSize)
    expect(vi.mocked(listPostsForMetricsSync)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: batchSize }),
    )
  })

  it('returns summary with tick ISO string and durationMs >=0', async () => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([])

    const summary = await runMetricsSyncTick({ now: NOW })

    expect(summary.tick).toBe(formatISO(NOW))
    expect(typeof summary.durationMs).toBe('number')
    expect(summary.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// ─── B6: cron health + Sentry.withMonitor ────────────────────────────────────

describe('runMetricsSyncTick — B6 observability', () => {
  it('calls markCronSeen before any DB op', async () => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([])
    await runMetricsSyncTick({ now: NOW })
    const markOrder = vi.mocked(markCronSeen).mock.invocationCallOrder[0]
    const listOrder = vi.mocked(listPostsForMetricsSync).mock.invocationCallOrder[0]
    expect(markCronSeen).toHaveBeenCalledWith(expect.anything(), 'metrics-sync')
    expect(markOrder).toBeLessThan(listOrder)
  })

  it('wraps tick with Sentry.withMonitor using correct ADR §3.5 config', async () => {
    vi.mocked(listPostsForMetricsSync).mockResolvedValue([])
    await runMetricsSyncTick({ now: NOW })
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      'metrics-sync-tick',
      expect.any(Function),
      {
        schedule: { type: 'crontab', value: '0 * * * *' },
        checkinMargin: 5,
        maxRuntime: 1,
        failureIssueThreshold: 3,
        recoveryThreshold: 1,
      },
    )
  })

  it.each(['qstash', 'secret'] as Array<'qstash' | 'secret'>)(
    'emits metrics-sync-tick log with triggeredBy: %s',
    async (triggeredBy) => {
      const logSpy = vi.spyOn(console, 'log')
      vi.mocked(listPostsForMetricsSync).mockResolvedValue([])
      await runMetricsSyncTick({ now: NOW, triggeredBy })
      const tickLine = logSpy.mock.calls
        .map(c => { try { return JSON.parse(String(c[0])) } catch { return null } })
        .find(p => p?.kind === 'metrics-sync-tick')
      expect(tickLine).toBeDefined()
      expect(tickLine!.triggeredBy).toBe(triggeredBy)
    },
  )
})
