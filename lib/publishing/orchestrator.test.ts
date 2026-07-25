import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runPublishTick, runJanitorTick } from './orchestrator'
import { SocialProviderError, getRegistry } from '@/lib/social/index'
import { markCronSeen } from '@/lib/db/cron-health'
import * as Sentry from '@sentry/nextjs'
import {
  claimPostsForPublishing,
  publishPostComplete,
  markPostFailed,
  requeueScheduledPost,
} from '@/lib/db/posts'
import { recoverStuckGenerationSessions } from '@/lib/db/post-generation-sessions'
import { getActiveByBusinessAndPlatform } from '@/lib/db/social-accounts'
import type { PostRow, SocialAccountRow, VaultSecretId, BusinessRow } from '@/lib/db/types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      PUBLISH_BATCH_SIZE: 10,
      PUBLISH_MAX_ATTEMPTS: 3,
      PUBLISH_RETRY_BACKOFF_SECONDS: 30,
      POST_GENERATION_SESSION_STALE_MINUTES: 30,
      EMAIL_SENDING_STUCK_MINUTES: 15,
    },
  },
}))

vi.mock('@/lib/db/posts', () => ({
  claimPostsForPublishing: vi.fn(),
  publishPostComplete: vi.fn(),
  markPostFailed: vi.fn(),
  requeueScheduledPost: vi.fn(),
  reapStuckScheduledPosts: vi.fn(),
}))

vi.mock('@/lib/db/email-outbox', () => ({
  reapStuckSendingRows: vi.fn().mockResolvedValue(0),
}))

const mockAfter = vi.hoisted(() => vi.fn())
vi.mock('next/server', () => ({ after: mockAfter }))

const mockIncrementBusinessPublishedCount = vi.hoisted(() => vi.fn())
const mockGetBusinessById = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/businesses', () => ({
  incrementBusinessPublishedCount: mockIncrementBusinessPublishedCount,
  getBusinessById: mockGetBusinessById,
}))

const mockEnqueueFirstPostPublished = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/triggers/publishing', () => ({
  enqueueFirstPostPublished: mockEnqueueFirstPostPublished,
}))

vi.mock('@/lib/db/post-generation-sessions', () => ({
  recoverStuckGenerationSessions: vi.fn(),
}))

vi.mock('@/lib/db/social-accounts', () => ({
  getActiveByBusinessAndPlatform: vi.fn(),
}))

vi.mock('@/lib/social/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/social/index')>()
  return { ...mod, getRegistry: vi.fn() }
})

vi.mock('@/lib/db/auth-rate-limits', () => ({
  pruneStaleAuthRateLimits: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/lib/db/cron-health', () => ({
  markCronSeen: vi.fn().mockResolvedValue(undefined),
  getCronLastSeen: vi.fn().mockResolvedValue(null),
}))

vi.mock('@sentry/nextjs', () => ({
  withMonitor: vi.fn().mockImplementation((_slug: string, fn: () => unknown) => fn()),
  captureException: vi.fn(),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-25T10:00:00Z')

const mockAccount: SocialAccountRow = {
  id: 'acct-1',
  business_id: 'biz-1',
  platform: 'linkedin',
  platform_user_id: 'li-user-1',
  platform_username: 'testuser',
  platform_display_name: 'Test User',
  vault_access_token_id: 'vault-1' as unknown as VaultSecretId,
  vault_refresh_token_id: null,
  token_expires_at: null,
  is_active: true,
  connected_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockBusiness: BusinessRow = {
  id: 'biz-1',
  name: 'Acme SaaS',
  website: null,
  industry: null,
  description: null,
  logo_url: null,
  owner_id: 'user-1',
  plan: 'plus',
  stripe_customer_id: 'cus_test',
  stripe_subscription_id: 'sub_test',
  language: 'en',
  timezone: 'UTC',
  onboarding_completed: true,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

const mockPost: PostRow = {
  id: 'post-1',
  campaign_id: 'camp-1',
  business_id: 'biz-1',
  platform: 'linkedin',
  content: 'Test content',
  hashtags: [],
  media_urls: [],
  scheduled_at: '2026-05-25T10:00:00Z',
  published_at: null,
  platform_post_id: null,
  platform_url: null,
  status: 'scheduled',
  role: null,
  rejection_note: null,
  ai_generation_metadata: {},
  publish_attempts: 0,
  last_publish_attempt_at: null,
  last_publish_error: null,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

// ─── Per-test mock provider ───────────────────────────────────────────────────

const mockPublish = vi.fn()
const mockRefreshAccessToken = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  const mockProvider = { publish: mockPublish, refreshAccessToken: mockRefreshAccessToken }
  vi.mocked(getRegistry).mockReturnValue({ get: () => mockProvider } as unknown as ReturnType<typeof getRegistry>)

  mockPublish.mockResolvedValue({ platformPostId: 'ext-123', publishedAt: '2026-05-25T10:01:00Z', url: 'https://example.com' })
  mockRefreshAccessToken.mockResolvedValue({})

  vi.mocked(claimPostsForPublishing).mockResolvedValue([])
  vi.mocked(publishPostComplete).mockResolvedValue({ id: 'post-1', campaign_id: 'camp-1' } as never)
  vi.mocked(markPostFailed).mockResolvedValue(undefined as never)
  vi.mocked(requeueScheduledPost).mockResolvedValue(undefined as never)
  vi.mocked(recoverStuckGenerationSessions).mockResolvedValue(0)
  vi.mocked(getActiveByBusinessAndPlatform).mockResolvedValue(mockAccount)
  mockIncrementBusinessPublishedCount.mockResolvedValue(2)
  mockGetBusinessById.mockResolvedValue(mockBusiness)
  mockEnqueueFirstPostPublished.mockResolvedValue(undefined)
})

// ─── runPublishTick ───────────────────────────────────────────────────────────

describe('runPublishTick', () => {
  it('returns all-zero summary with no provider calls when claim is empty', async () => {
    const summary = await runPublishTick({ now: NOW })
    expect(summary.claimed).toBe(0)
    expect(summary.published).toBe(0)
    expect(summary.failed).toBe(0)
    expect(summary.retried).toBe(0)
    expect(summary.refreshed).toBe(0)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('folds in reaped count from opts', async () => {
    const summary = await runPublishTick({ now: NOW, reaped: 7 })
    expect(summary.reaped).toBe(7)
  })

  it('successful publish: increments published and campaign counter', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    const summary = await runPublishTick({ now: NOW })
    expect(summary.published).toBe(1)
    expect(summary.failed).toBe(0)
    expect(vi.mocked(publishPostComplete)).toHaveBeenCalledWith(
      expect.anything(),
      'post-1',
      expect.objectContaining({ platformPostId: 'ext-123' }),
    )
  })

  it('treats zero-row RPC guard rejection as a no-op, not a failure or success', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    vi.mocked(publishPostComplete).mockResolvedValue(null)
    const summary = await runPublishTick({ now: NOW })
    expect(summary.published).toBe(0)
    expect(summary.failed).toBe(0)
    expect(mockEnqueueFirstPostPublished).not.toHaveBeenCalled()
  })

  it('passes socialAccountId from looked-up account to PublishInput', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    await runPublishTick({ now: NOW })
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ socialAccountId: 'acct-1' }),
    )
  })

  it('TOKEN_EXPIRED → refresh → success: refreshed=1, published=1, publish_attempts unchanged', async () => {
    const err = new SocialProviderError({ code: 'TOKEN_EXPIRED', message: 'expired' })
    mockPublish
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ platformPostId: 'ext-after', publishedAt: '2026-05-25T10:01:00Z', url: null })
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.refreshed).toBe(1)
    expect(summary.published).toBe(1)
    expect(summary.failed).toBe(0)
    expect(mockRefreshAccessToken).toHaveBeenCalledWith({ socialAccountId: 'acct-1' })
    // Token refresh does not consume a publish_attempts budget entry
    expect(vi.mocked(requeueScheduledPost)).not.toHaveBeenCalled()
  })

  it('TOKEN_EXPIRED → refresh → fail again: terminal failed with reason=refresh_failed', async () => {
    const err = new SocialProviderError({ code: 'TOKEN_EXPIRED', message: 'expired' })
    mockPublish.mockRejectedValue(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
    expect(summary.published).toBe(0)
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect(call[2].errorCode).toBe('TOKEN_REVOKED')
    expect((call[2].errorDetails as Record<string, unknown>).reason).toBe('refresh_failed')
  })

  it('TOKEN_EXPIRED refresh-loop guard: two posts same account, second hits guard', async () => {
    const post2: PostRow = { ...mockPost, id: 'post-2' }
    const err = new SocialProviderError({ code: 'TOKEN_EXPIRED', message: 'expired' })

    mockPublish
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ platformPostId: 'ext-1', publishedAt: '...', url: null })
      .mockRejectedValueOnce(err)

    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost, post2])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.refreshed).toBe(1)
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
    expect(summary.published).toBe(1)
    expect(summary.failed).toBe(1)
    const failedCall = vi.mocked(markPostFailed).mock.calls[0]
    expect((failedCall[2].errorDetails as Record<string, unknown>).reason).toBe('refresh_loop')
  })

  it('RATE_LIMITED: queues with incrementAttempts=false', async () => {
    const err = new SocialProviderError({ code: 'RATE_LIMITED', message: 'rate limited', retryAfterSeconds: 120 })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.retried).toBe(1)
    expect(summary.failed).toBe(0)
    const call = vi.mocked(requeueScheduledPost).mock.calls[0]
    expect(call[2].incrementAttempts).toBe(false)
    expect(call[2].errorCode).toBe('RATE_LIMITED')
  })

  it('RATE_LIMITED: newScheduledAt = now + retryAfterSeconds', async () => {
    const err = new SocialProviderError({ code: 'RATE_LIMITED', message: 'rate limited', retryAfterSeconds: 120 })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    await runPublishTick({ now: NOW })

    const call = vi.mocked(requeueScheduledPost).mock.calls[0]
    const newAt = call[2].newScheduledAt as Date
    expect((newAt.getTime() - NOW.getTime()) / 1000).toBe(120)
  })

  it('NETWORK (attempts < MAX): queues with incrementAttempts=true', async () => {
    const err = new SocialProviderError({ code: 'NETWORK', message: 'connection failed' })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([{ ...mockPost, publish_attempts: 0 }])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.retried).toBe(1)
    expect(summary.failed).toBe(0)
    const call = vi.mocked(requeueScheduledPost).mock.calls[0]
    expect(call[2].incrementAttempts).toBe(true)
    expect(call[2].errorCode).toBe('NETWORK')
  })

  it('NETWORK (attempts+1 === MAX): terminal failed, no requeue', async () => {
    const err = new SocialProviderError({ code: 'NETWORK', message: 'connection failed' })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([{ ...mockPost, publish_attempts: 2 }])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
    expect(summary.retried).toBe(0)
    expect(vi.mocked(requeueScheduledPost)).not.toHaveBeenCalled()
  })

  it('TOKEN_REVOKED: terminal failed', async () => {
    const err = new SocialProviderError({ code: 'TOKEN_REVOKED', message: 'revoked' })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect(call[2].errorCode).toBe('TOKEN_REVOKED')
  })

  it('PLATFORM_REJECTED: terminal failed', async () => {
    const err = new SocialProviderError({ code: 'PLATFORM_REJECTED', message: 'rejected' })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect(call[2].errorCode).toBe('PLATFORM_REJECTED')
  })

  it('NOT_IMPLEMENTED: terminal failed', async () => {
    const err = new SocialProviderError({ code: 'NOT_IMPLEMENTED', message: 'not impl' })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
  })

  it('PROVIDER_NOT_CONFIGURED: terminal failed', async () => {
    const err = new SocialProviderError({ code: 'PROVIDER_NOT_CONFIGURED', message: 'not configured' })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
  })

  it('UNKNOWN: terminal failed', async () => {
    const err = new SocialProviderError({ code: 'UNKNOWN', message: 'unknown' })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect(call[2].errorCode).toBe('UNKNOWN')
  })

  it('sequential: NETWORK failure on post-1 does not abort post-2', async () => {
    const post2: PostRow = { ...mockPost, id: 'post-2', campaign_id: 'camp-2' }
    const networkErr = new SocialProviderError({ code: 'NETWORK', message: 'fail' })
    mockPublish
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValueOnce({ platformPostId: 'ext-2', publishedAt: '...', url: null })
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost, post2])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.retried).toBe(1)
    expect(summary.published).toBe(1)
  })

  it('reaper-before-claim: stale scheduled + fresh approved → both published', async () => {
    // Row A was reaped from scheduled → approved, then claimed. Row B was directly approved.
    // Both arrive in the tick as claimed (scheduled) posts. reaped=1 reflects the pre-tick reaper run.
    const rowA: PostRow = { ...mockPost, id: 'post-reap', publish_attempts: 0 }
    const rowB: PostRow = { ...mockPost, id: 'post-fresh', publish_attempts: 0 }
    vi.mocked(claimPostsForPublishing).mockResolvedValue([rowA, rowB])
    mockPublish
      .mockResolvedValueOnce({ platformPostId: 'ext-A', publishedAt: '2026-05-25T10:01:00Z', url: null })
      .mockResolvedValueOnce({ platformPostId: 'ext-B', publishedAt: '2026-05-25T10:01:00Z', url: null })

    const summary = await runPublishTick({ now: NOW, batchSize: 25, reaped: 1 })

    expect(summary.claimed).toBe(2)
    expect(summary.published).toBe(2)
    expect(summary.reaped).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it('account_disconnected: marks failed TOKEN_REVOKED with reason=account_disconnected', async () => {
    vi.mocked(getActiveByBusinessAndPlatform).mockResolvedValue(null)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])

    const summary = await runPublishTick({ now: NOW })

    expect(summary.failed).toBe(1)
    expect(mockPublish).not.toHaveBeenCalled()
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect(call[2].errorCode).toBe('TOKEN_REVOKED')
    expect((call[2].errorDetails as Record<string, unknown>).reason).toBe('account_disconnected')
  })
})

// ─── First-post detection via TOKEN_EXPIRED refresh-retry (I3/I4) ────────────

describe('runPublishTick — first-post via refresh-retry (I3/I4)', () => {
  const tokenExpiredErr = new SocialProviderError({ code: 'TOKEN_EXPIRED', message: 'expired' })

  it('first publish via refresh-retry: increments business counter and schedules first-post email', async () => {
    mockPublish
      .mockRejectedValueOnce(tokenExpiredErr)
      .mockResolvedValueOnce({ platformPostId: 'ext-retry', url: 'https://li.com/1', publishedAt: NOW.toISOString() })
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount.mockResolvedValue(1)

    const summary = await runPublishTick({ now: NOW })

    expect(summary.published).toBe(1)
    expect(mockIncrementBusinessPublishedCount).toHaveBeenCalledTimes(1)
    expect(mockIncrementBusinessPublishedCount).toHaveBeenCalledWith(expect.anything(), 'biz-1')
    expect(mockAfter).toHaveBeenCalledTimes(1)

    const [afterCallback] = mockAfter.mock.calls[0] as [() => Promise<void>]
    await afterCallback()
    expect(mockEnqueueFirstPostPublished).toHaveBeenCalledWith(
      expect.objectContaining({ business: mockBusiness, post: mockPost }),
    )
  })

  it('second publish via refresh-retry: increments counter but does NOT schedule first-post email', async () => {
    mockPublish
      .mockRejectedValueOnce(tokenExpiredErr)
      .mockResolvedValueOnce({ platformPostId: 'ext-retry', url: null, publishedAt: NOW.toISOString() })
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount.mockResolvedValue(2)

    const summary = await runPublishTick({ now: NOW })

    expect(summary.published).toBe(1)
    expect(mockIncrementBusinessPublishedCount).toHaveBeenCalledTimes(1)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('refresh-retry: incrementBusinessPublishedCount throws → tick continues, published counted, Sentry captured', async () => {
    mockPublish
      .mockRejectedValueOnce(tokenExpiredErr)
      .mockResolvedValueOnce({ platformPostId: 'ext-retry', url: null, publishedAt: NOW.toISOString() })
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount.mockRejectedValue(new Error('DB failure'))

    const summary = await runPublishTick({ now: NOW })

    expect(summary.published).toBe(1)
    expect(vi.mocked(publishPostComplete)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1)
    expect(mockAfter).not.toHaveBeenCalled()
  })
})

// ─── runJanitorTick ───────────────────────────────────────────────────────────

describe('runJanitorTick', () => {
  it('calls recoverStuckGenerationSessions with configured staleMinutes', async () => {
    vi.mocked(recoverStuckGenerationSessions).mockResolvedValue(3)
    const summary = await runJanitorTick({ now: NOW })
    expect(summary.stuckGenerationSessionsReaped).toBe(3)
    expect(vi.mocked(recoverStuckGenerationSessions)).toHaveBeenCalledWith(
      expect.anything(),
      { now: NOW, staleMinutes: 30 },
    )
  })

  it('returns zero when no stale sessions exist', async () => {
    vi.mocked(recoverStuckGenerationSessions).mockResolvedValue(0)
    const summary = await runJanitorTick({ now: NOW })
    expect(summary.stuckGenerationSessionsReaped).toBe(0)
  })

  it('summary includes tick timestamp and durationMs', async () => {
    const summary = await runJanitorTick({ now: NOW })
    expect(typeof summary.tick).toBe('string')
    expect(typeof summary.durationMs).toBe('number')
  })
})

// ─── B6: cron health + Sentry.withMonitor ────────────────────────────────────

describe('runPublishTick — B6 observability', () => {
  it('calls markCronSeen before any DB op', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([])
    await runPublishTick({ now: NOW })
    const markOrder = vi.mocked(markCronSeen).mock.invocationCallOrder[0]
    const claimOrder = vi.mocked(claimPostsForPublishing).mock.invocationCallOrder[0]
    expect(markCronSeen).toHaveBeenCalledWith(expect.anything(), 'publish')
    expect(markOrder).toBeLessThan(claimOrder)
  })

  it('wraps tick with Sentry.withMonitor using correct ADR §3.5 config', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([])
    await runPublishTick({ now: NOW })
    expect(Sentry.withMonitor).toHaveBeenCalledWith(
      'publish-tick',
      expect.any(Function),
      {
        schedule: { type: 'crontab', value: '* * * * *' },
        checkinMargin: 2,
        maxRuntime: 1,
        failureIssueThreshold: 3,
        recoveryThreshold: 1,
      },
    )
  })

  it.each(['qstash', 'secret'] as Array<'qstash' | 'secret'>)(
    'emits publish-tick log with triggeredBy: %s',
    async (triggeredBy) => {
      const logSpy = vi.spyOn(console, 'log')
      vi.mocked(claimPostsForPublishing).mockResolvedValue([])
      await runPublishTick({ now: NOW, triggeredBy })
      const tickLine = logSpy.mock.calls
        .map(c => { try { return JSON.parse(String(c[0])) } catch { return null } })
        .find(p => p?.kind === 'publish-tick')
      expect(tickLine).toBeDefined()
      expect(tickLine!.triggeredBy).toBe(triggeredBy)
    },
  )
})

// ─── First-post detection ─────────────────────────────────────────────────────

describe('runPublishTick — first-post detection', () => {
  it('registers after() when incrementBusinessPublishedCount returns 1', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount.mockResolvedValue(1)

    await runPublishTick({ now: NOW })

    expect(mockAfter).toHaveBeenCalledTimes(1)
  })

  it('after() callback calls enqueueFirstPostPublished with business and post', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount.mockResolvedValue(1)

    await runPublishTick({ now: NOW })

    const [afterCallback] = mockAfter.mock.calls[0] as [() => Promise<void>]
    await afterCallback()

    expect(mockEnqueueFirstPostPublished).toHaveBeenCalledWith(
      expect.objectContaining({
        business: mockBusiness,
        post: mockPost,
      }),
    )
  })

  it('does NOT register after() when incrementBusinessPublishedCount returns 2', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount.mockResolvedValue(2)

    await runPublishTick({ now: NOW })

    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('after() callback captures Sentry exception and does not rethrow', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount.mockResolvedValue(1)
    mockEnqueueFirstPostPublished.mockRejectedValue(new Error('enqueue failed'))

    await runPublishTick({ now: NOW })

    const [afterCallback] = mockAfter.mock.calls[0] as [() => Promise<void>]
    await expect(afterCallback()).resolves.toBeUndefined()
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled()
  })

  it('concurrent first-publish: second call returns 2 → after() called only once total', async () => {
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    mockIncrementBusinessPublishedCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)

    await runPublishTick({ now: NOW })

    expect(mockAfter).toHaveBeenCalledTimes(1)
  })
})

// ─── redactTokens value-scan (B18-076) ───────────────────────────────────────
// Verify that value-pattern scanning (Bearer JWT, Stripe sk_, long hex) is applied
// to non-token-named keys in err.details, which flows through the PLATFORM_REJECTED branch.

describe('redactTokens — value-scan (B18-076)', () => {
  it('redacts Bearer JWT in a non-token-named key (detail)', async () => {
    const err = new SocialProviderError({
      code: 'PLATFORM_REJECTED',
      message: 'rejected',
      details: { detail: 'Bearer eyJabc.eyJdef.ghi' },
    })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    await runPublishTick({ now: NOW })
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect((call[2].errorDetails as Record<string, unknown>).detail).toBe('[REDACTED]')
  })

  it('redacts Stripe sk_live_ key in a non-token-named key (message)', async () => {
    const err = new SocialProviderError({
      code: 'PLATFORM_REJECTED',
      message: 'rejected',
      details: { message: 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWX' },
    })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    await runPublishTick({ now: NOW })
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect((call[2].errorDetails as Record<string, unknown>).message).toBe('[REDACTED]')
  })

  it('redacts 32-char hex string in a non-token-named key (hash)', async () => {
    const err = new SocialProviderError({
      code: 'PLATFORM_REJECTED',
      message: 'rejected',
      details: { hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' },
    })
    mockPublish.mockRejectedValueOnce(err)
    vi.mocked(claimPostsForPublishing).mockResolvedValue([mockPost])
    await runPublishTick({ now: NOW })
    const call = vi.mocked(markPostFailed).mock.calls[0]
    expect((call[2].errorDetails as Record<string, unknown>).hash).toBe('[REDACTED]')
  })
})
