import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import { upsertPostMetrics } from './post-metrics'
import type { PostMetricsInsert, PostMetricsRow } from './types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

// ─── upsertPostMetrics ───────────────────────────────────────────────────────

describe('upsertPostMetrics', () => {
  it('calls upsert on post_metrics with onConflict post_id', async () => {
    const mockRow: PostMetricsRow = {
      id: 'pm-1',
      post_id: 'p-1',
      business_id: 'b-1',
      likes: 10,
      comments: 2,
      shares: null,
      saves: null,
      clicks: null,
      reach: 500,
      impressions: 1000,
      last_synced_at: '2026-05-30T10:00:00Z',
      created_at: '2026-05-30T10:00:00Z',
      updated_at: '2026-05-30T10:00:00Z',
    }
    const { client, builder } = createMockClient(mockRow, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    const input: PostMetricsInsert = {
      post_id: 'p-1',
      business_id: 'b-1',
      likes: 10,
      comments: 2,
      shares: null,
      saves: null,
      clicks: null,
      reach: 500,
      impressions: 1000,
      last_synced_at: '2026-05-30T10:00:00Z',
    }
    await upsertPostMetrics(input)

    expect(client.from).toHaveBeenCalledWith('post_metrics')
    expect(builder.upsert).toHaveBeenCalledWith(input, { onConflict: 'post_id' })
  })

  describe('null-vs-zero round-trip (ADR 0006 §6 — load-bearing invariant)', () => {
    it('preserves null, 0, and positive values verbatim — no coalescing', async () => {
      const mockRow: PostMetricsRow = {
        id: 'pm-2',
        post_id: 'p-2',
        business_id: 'b-2',
        likes: 5,
        comments: 0,
        shares: null,
        saves: null,
        clicks: 7,
        reach: 0,
        impressions: null,
        last_synced_at: '2026-05-30T10:00:00Z',
        created_at: '2026-05-30T10:00:00Z',
        updated_at: '2026-05-30T10:00:00Z',
      }
      const { client, builder } = createMockClient(mockRow, null)
      vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

      const input: PostMetricsInsert = {
        post_id: 'p-2',
        business_id: 'b-2',
        likes: 5,
        comments: 0,
        shares: null,
        saves: null,
        clicks: 7,
        reach: 0,
        impressions: null,
        last_synced_at: '2026-05-30T10:00:00Z',
      }

      const result = await upsertPostMetrics(input)

      expect(builder.upsert).toHaveBeenCalledWith(input, { onConflict: 'post_id' })

      expect(result.shares).toBeNull()
      expect(result.saves).toBeNull()
      expect(result.impressions).toBeNull()

      expect(result.comments).toBe(0)
      expect(result.reach).toBe(0)

      expect(result.likes).toBe(5)
      expect(result.clicks).toBe(7)
    })

    it('shares: null is explicitly not 0', async () => {
      const mockRow: PostMetricsRow = {
        id: 'pm-3', post_id: 'p-3', business_id: 'b-3',
        likes: 1, comments: 0, shares: null, saves: null,
        clicks: null, reach: null, impressions: null,
        last_synced_at: '2026-05-30T10:00:00Z',
        created_at: '2026-05-30T10:00:00Z',
        updated_at: '2026-05-30T10:00:00Z',
      }
      const { client } = createMockClient(mockRow, null)
      vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

      const result = await upsertPostMetrics({
        post_id: 'p-3', business_id: 'b-3',
        likes: 1, comments: 0, shares: null, saves: null,
        clicks: null, reach: null, impressions: null,
        last_synced_at: '2026-05-30T10:00:00Z',
      })

      expect(result.shares).toBeNull()
      expect(result.shares).not.toBe(0)
    })
  })

  it('throws when upsert returns an error', async () => {
    const { client } = createMockClient(null, { message: 'constraint violation' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await expect(
      upsertPostMetrics({ post_id: 'p-err', business_id: 'b-err', last_synced_at: '2026-05-30T10:00:00Z' }),
    ).rejects.toThrow('constraint violation')
  })
})
