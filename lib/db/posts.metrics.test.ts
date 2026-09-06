import { describe, it, expect, vi } from 'vitest'
import { formatISO, subMinutes } from 'date-fns'
import { createMockClient } from './__test-utils__/mock-client'
import { listPostsForMetricsSync } from './posts'
import type { PostRow } from './types'

const NOW = new Date('2026-05-30T10:00:00.000Z')

const mockPublishedPost: PostRow = {
  id: 'post-1',
  campaign_id: 'camp-1',
  business_id: 'biz-1',
  social_account_id: null,
  platform: 'linkedin',
  content: 'Test content',
  hashtags: [],
  media_urls: [],
  scheduled_at: '2026-05-01T10:00:00Z',
  published_at: '2026-05-01T10:05:00Z',
  platform_post_id: 'linkedin-post-123',
  platform_url: 'https://linkedin.com/test',
  status: 'published',
  role: null,
  rejection_note: null,
  ai_generation_metadata: {},
  publish_attempts: 1,
  last_publish_attempt_at: '2026-05-01T10:05:00Z',
  last_publish_error: null,
  deleted_at: null,
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-05-01T10:05:00Z',
}

// SQL function correctness (predicate, NULLS FIRST ordering, staleness window,
// MAX_AGE_DAYS exclusion, never-synced inclusion) is verified by reading the
// migration at supabase/migrations/20260530120000_metrics_worker_helper.sql.
// A TS-wrapper-layer test would require a live database and is deferred to
// integration coverage.

// ─── listPostsForMetricsSync ─────────────────────────────────────────────────

describe('listPostsForMetricsSync', () => {
  it('calls list_posts_for_metrics_sync RPC with p_now, p_stale_before, p_max_age_days, p_limit', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [mockPublishedPost], error: null } as never)

    const result = await listPostsForMetricsSync(client, {
      now: NOW,
      staleMinutes: 360,
      maxAgeDays: 90,
      limit: 50,
    })

    expect(client.rpc).toHaveBeenCalledWith('list_posts_for_metrics_sync', {
      p_now: formatISO(NOW),
      p_stale_before: formatISO(subMinutes(NOW, 360)),
      p_max_age_days: 90,
      p_limit: 50,
    })
    expect(result).toEqual([mockPublishedPost])
  })

  it('returns empty array when RPC returns null data', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: null, error: null } as never)

    const result = await listPostsForMetricsSync(client, {
      now: NOW,
      staleMinutes: 360,
      maxAgeDays: 90,
      limit: 50,
    })

    expect(result).toEqual([])
  })

  it('returns empty array when RPC returns no rows', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [], error: null } as never)

    const result = await listPostsForMetricsSync(client, {
      now: NOW,
      staleMinutes: 360,
      maxAgeDays: 90,
      limit: 50,
    })

    expect(result).toEqual([])
  })

  it('throws when RPC returns an error', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    } as never)

    await expect(
      listPostsForMetricsSync(client, { now: NOW, staleMinutes: 360, maxAgeDays: 90, limit: 50 }),
    ).rejects.toThrow('DB error')
  })

  it('p_stale_before is computed as now minus staleMinutes — drives staleness inclusion/exclusion in SQL', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [], error: null } as never)

    const staleMinutes = 180
    await listPostsForMetricsSync(client, { now: NOW, staleMinutes, maxAgeDays: 90, limit: 10 })

    expect(client.rpc).toHaveBeenCalledWith(
      'list_posts_for_metrics_sync',
      expect.objectContaining({ p_stale_before: formatISO(subMinutes(NOW, staleMinutes)) }),
    )
  })

  it('passes limit as p_limit — caps candidate batch size per tick', async () => {
    const { client } = createMockClient()
    vi.spyOn(client, 'rpc').mockResolvedValue({ data: [], error: null } as never)

    await listPostsForMetricsSync(client, { now: NOW, staleMinutes: 360, maxAgeDays: 30, limit: 25 })

    expect(client.rpc).toHaveBeenCalledWith(
      'list_posts_for_metrics_sync',
      expect.objectContaining({ p_limit: 25, p_max_age_days: 30 }),
    )
  })

})
