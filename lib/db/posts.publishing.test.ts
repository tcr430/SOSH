import { describe, it, expect, vi } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  claimPostsForPublishing,
  publishPostComplete,
  markPostFailed,
  requeueScheduledPost,
  reapStuckScheduledPosts,
  incrementPublishedCountForCampaign,
} from './posts'
import type { PostRow } from './types'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      PUBLISH_MAX_ATTEMPTS: 5,
    },
  },
}))

const mockScheduledPost: PostRow = {
  id: 'post-1',
  campaign_id: 'camp-1',
  business_id: 'biz-1',
  social_account_id: null,
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
  ai_generation_metadata: { rationale: 'existing metadata' },
  publish_attempts: 1,
  last_publish_attempt_at: '2026-05-25T09:00:00Z',
  last_publish_error: null,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

// ─── claimPostsForPublishing ─────────────────────────────────────────────────

describe('claimPostsForPublishing', () => {
  it('calls claim_posts_for_publishing RPC with p_now and p_limit', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [mockScheduledPost], error: null } as never)
    const result = await claimPostsForPublishing(client, 10)
    expect(client.rpc).toHaveBeenCalledWith('claim_posts_for_publishing', {
      p_now: expect.any(String),
      p_limit: 10,
    })
    expect(result).toEqual([mockScheduledPost])
  })

  it('returns empty array when RPC returns no rows', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [], error: null } as never)
    const result = await claimPostsForPublishing(client, 5)
    expect(result).toEqual([])
  })

  it('throws when RPC returns an error', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: { message: 'RPC error' } } as never)
    await expect(claimPostsForPublishing(client, 10)).rejects.toThrow('RPC error')
  })

  it('platform gate: approved instagram post is not claimed', async () => {
    // The claim RPC's platform IN ('linkedin', 'twitter') filter excludes instagram.
    // When only an instagram post is eligible, the RPC returns empty — enforced in SQL.
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [], error: null } as never)
    const result = await claimPostsForPublishing(client, 25)
    expect(client.rpc).toHaveBeenCalledWith('claim_posts_for_publishing', expect.any(Object))
    expect(result).toEqual([])
  })
})

// ─── publishPostComplete ────────────────────────────────────────────────────

describe('publishPostComplete', () => {
  it('calls publish_post_complete RPC with post id and platform details', async () => {
    const published = { ...mockScheduledPost, status: 'published' as const, platform_post_id: 'ext-123', platform_url: 'https://ex.com' }
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [published], error: null } as never)
    const result = await publishPostComplete(client, 'post-1', {
      platformPostId: 'ext-123',
      platformUrl: 'https://ex.com',
      publishedAt: new Date('2026-05-25T10:01:00Z'),
    })
    expect(client.rpc).toHaveBeenCalledWith('publish_post_complete', {
      p_post_id: 'post-1',
      p_platform_post_id: 'ext-123',
      p_platform_url: 'https://ex.com',
      p_published_at: expect.any(String),
    })
    expect(result?.status).toBe('published')
    expect(result?.platform_post_id).toBe('ext-123')
  })

  it('returns null when the RPC returns zero rows (guard rejected the transition)', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [], error: null } as never)
    const result = await publishPostComplete(client, 'post-1', {
      platformPostId: 'ext-123',
      platformUrl: null,
      publishedAt: new Date(),
    })
    expect(result).toBeNull()
  })

  it('throws when the RPC returns an error', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: { message: 'publish error' } } as never)
    await expect(
      publishPostComplete(client, 'post-1', {
        platformPostId: 'ext-123',
        platformUrl: null,
        publishedAt: new Date(),
      })
    ).rejects.toThrow('publish error')
  })
})

// ─── markPostFailed ──────────────────────────────────────────────────────────

describe('markPostFailed', () => {
  it('does NOT increment publish_attempts (freezes at current value)', async () => {
    const failedPost = { ...mockScheduledPost, status: 'failed' as const, publish_attempts: 1 }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: {}, publish_attempts: 1 }, error: null })
      .mockResolvedValueOnce({ data: failedPost, error: null })
    await markPostFailed(client, 'post-1', { errorCode: 'PLATFORM_REJECTED', errorDetails: { msg: 'banned' } })
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg).not.toHaveProperty('publish_attempts')
  })

  it('writes last_publish_error = errorCode', async () => {
    const failedPost = { ...mockScheduledPost, status: 'failed' as const }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: {}, publish_attempts: 1 }, error: null })
      .mockResolvedValueOnce({ data: failedPost, error: null })
    await markPostFailed(client, 'post-1', { errorCode: 'TOKEN_REVOKED', errorDetails: {} })
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.last_publish_error).toBe('TOKEN_REVOKED')
  })

  it('merges errorDetails into ai_generation_metadata.publish_error preserving existing keys', async () => {
    const failedPost = { ...mockScheduledPost, status: 'failed' as const }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: { rationale: 'keep me' }, publish_attempts: 1 }, error: null })
      .mockResolvedValueOnce({ data: failedPost, error: null })
    const errorDetails = { reason: 'account suspended', code: 400 }
    await markPostFailed(client, 'post-1', { errorCode: 'PLATFORM_REJECTED', errorDetails })
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.ai_generation_metadata).toMatchObject({
      rationale: 'keep me',
      publish_error: errorDetails,
    })
  })

  it('throws when row not found or not in scheduled status', async () => {
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null, error: null })
    await expect(
      markPostFailed(client, 'post-1', { errorCode: 'UNKNOWN', errorDetails: {} })
    ).rejects.toThrow()
  })
})

// ─── requeueScheduledPost ────────────────────────────────────────────────────

describe('requeueScheduledPost', () => {
  const basePayload = {
    newScheduledAt: new Date('2026-05-25T11:00:00Z'),
    errorCode: 'NETWORK',
    errorDetails: { msg: 'connection timeout' },
    incrementAttempts: true,
  }

  it('increments publish_attempts by 1 when incrementAttempts=true (NETWORK path)', async () => {
    const requeuedPost = { ...mockScheduledPost, status: 'approved' as const, publish_attempts: 2 }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: {}, publish_attempts: 1 }, error: null })
      .mockResolvedValueOnce({ data: requeuedPost, error: null })
    await requeueScheduledPost(client, 'post-1', { ...basePayload, incrementAttempts: true })
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.publish_attempts).toBe(2)
  })

  it('does NOT include publish_attempts in update when incrementAttempts=false (RATE_LIMITED path)', async () => {
    const requeuedPost = { ...mockScheduledPost, status: 'approved' as const, publish_attempts: 1 }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: {}, publish_attempts: 1 }, error: null })
      .mockResolvedValueOnce({ data: requeuedPost, error: null })
    await requeueScheduledPost(client, 'post-1', { ...basePayload, incrementAttempts: false })
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg).not.toHaveProperty('publish_attempts')
  })

  it('transitions status scheduled → approved', async () => {
    const requeuedPost = { ...mockScheduledPost, status: 'approved' as const }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: {}, publish_attempts: 1 }, error: null })
      .mockResolvedValueOnce({ data: requeuedPost, error: null })
    await requeueScheduledPost(client, 'post-1', basePayload)
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('approved')
  })

  it('writes last_publish_error = errorCode', async () => {
    const requeuedPost = { ...mockScheduledPost, status: 'approved' as const }
    const { client, builder } = createMockClient()
    ;(builder.single as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { ai_generation_metadata: {}, publish_attempts: 1 }, error: null })
      .mockResolvedValueOnce({ data: requeuedPost, error: null })
    await requeueScheduledPost(client, 'post-1', { ...basePayload, errorCode: 'NETWORK' })
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.last_publish_error).toBe('NETWORK')
  })
})

// ─── reapStuckScheduledPosts ─────────────────────────────────────────────────

describe('reapStuckScheduledPosts', () => {
  it('calls reap_stuck_scheduled_posts RPC with correct params including PUBLISH_MAX_ATTEMPTS', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: 3, error: null } as never)
    await reapStuckScheduledPosts(client, { now: new Date('2026-05-25T10:00:00Z'), stuckMinutes: 30 })
    expect(client.rpc).toHaveBeenCalledWith('reap_stuck_scheduled_posts', {
      p_now: expect.any(String),
      p_stuck_minutes: 30,
      p_max_attempts: 5,
    })
  })

  it('returns the total rows touched (sum of both statement counts)', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: 7, error: null } as never)
    const result = await reapStuckScheduledPosts(client, { now: new Date(), stuckMinutes: 15 })
    expect(result).toBe(7)
  })

  it('returns 0 when no stale rows exist', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: 0, error: null } as never)
    const result = await reapStuckScheduledPosts(client, { now: new Date(), stuckMinutes: 15 })
    expect(result).toBe(0)
  })

  it('throws when RPC returns an error', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: { message: 'reap error' } } as never)
    await expect(
      reapStuckScheduledPosts(client, { now: new Date(), stuckMinutes: 15 })
    ).rejects.toThrow('reap error')
  })
})

// ─── incrementPublishedCountForCampaign ──────────────────────────────────────

describe('incrementPublishedCountForCampaign', () => {
  it('calls increment_published_count_for_campaign RPC with campaign id', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: null } as never)
    await incrementPublishedCountForCampaign(client, 'camp-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_published_count_for_campaign', {
      p_campaign_id: 'camp-1',
    })
  })

  it('throws when RPC returns an error', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: { message: 'increment error' } } as never)
    await expect(incrementPublishedCountForCampaign(client, 'camp-1')).rejects.toThrow('increment error')
  })
})
