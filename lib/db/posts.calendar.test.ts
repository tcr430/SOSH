import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  listPostsForCalendar,
  reschedulePost,
  reschedulePostsBatch,
  CALENDAR_POST_LIMIT,
} from './posts'
import type { Platform, PostStatus } from './types'

// ─── helpers ────────────────────────────────────────────────────────────────

const BIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const POST_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const POST_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CAMPAIGN_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const RANGE_START = '2026-06-01T00:00:00Z'
const RANGE_END = '2026-07-01T00:00:00Z'

function makeRawRow(
  id: string,
  scheduledAt: string,
  metricsOrNull: Record<string, unknown>[] | null = null,
) {
  return {
    id,
    campaign_id: CAMPAIGN_1,
    platform: 'linkedin' as Platform,
    status: 'draft' as PostStatus,
    content: 'Test content',
    hashtags: ['#test'],
    scheduled_at: scheduledAt,
    published_at: null,
    platform_post_id: null,
    campaigns: [{ name: 'Test Campaign' }],
    post_metrics: metricsOrNull,
  }
}

const METRICS_ROW = {
  likes: 10,
  comments: 5,
  shares: null,
  saves: null,
  clicks: null,
  reach: 300,
  impressions: 1000,
  last_synced_at: '2026-06-15T12:00:00Z',
}

// ─── listPostsForCalendar ────────────────────────────────────────────────────

describe('listPostsForCalendar', () => {
  it('filters by scheduled_at range (gte start, lt end)', async () => {
    const { client, builder } = createMockClient([], null)

    await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(builder.gte).toHaveBeenCalledWith('scheduled_at', RANGE_START)
    expect(builder.lt).toHaveBeenCalledWith('scheduled_at', RANGE_END)
  })

  it('orders by scheduled_at ascending', async () => {
    const { client, builder } = createMockClient([], null)

    await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(builder.order).toHaveBeenCalledWith('scheduled_at', { ascending: true })
  })

  it('passes LIMIT+1 and sets overflow=true when extra row returned', async () => {
    const limit = 3
    const rows = [
      makeRawRow(POST_1, '2026-06-10T10:00:00Z'),
      makeRawRow(POST_2, '2026-06-11T10:00:00Z'),
      makeRawRow('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-06-12T10:00:00Z'),
      makeRawRow('ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-06-13T10:00:00Z'),
    ]
    const { client, builder } = createMockClient(rows, null)

    const result = await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
      limit,
    })

    expect(builder.limit).toHaveBeenCalledWith(limit + 1)
    expect(result.overflow).toBe(true)
    expect(result.rows).toHaveLength(limit)
  })

  it('sets overflow=false when returned rows at or below limit', async () => {
    const rows = [
      makeRawRow(POST_1, '2026-06-10T10:00:00Z'),
      makeRawRow(POST_2, '2026-06-11T10:00:00Z'),
    ]
    const { client } = createMockClient(rows, null)

    const result = await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
      limit: 5,
    })

    expect(result.overflow).toBe(false)
    expect(result.rows).toHaveLength(2)
  })

  it('applies soft-delete filter (deleted_at IS NULL)', async () => {
    const { client, builder } = createMockClient([], null)

    await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
  })

  it('maps campaign_name from joined campaigns object', async () => {
    const rawRow = {
      ...makeRawRow(POST_1, '2026-06-10T10:00:00Z'),
      campaigns: [{ name: 'My Launch Campaign' }],
    }
    const { client } = createMockClient([rawRow], null)

    const { rows } = await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(rows[0].campaign_name).toBe('My Launch Campaign')
  })

  it('sets metrics=null when post_metrics is null (never synced)', async () => {
    const rawRow = makeRawRow(POST_1, '2026-06-10T10:00:00Z', null)
    const { client } = createMockClient([rawRow], null)

    const { rows } = await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(rows[0].metrics).toBeNull()
  })

  it('sets metrics=null for empty metrics array (never synced)', async () => {
    const rawRow = makeRawRow(POST_1, '2026-06-10T10:00:00Z', [])
    const { client } = createMockClient([rawRow], null)

    const { rows } = await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(rows[0].metrics).toBeNull()
  })

  it('populates metrics from post_metrics row when present — null fields preserved', async () => {
    const rawRow = makeRawRow(POST_1, '2026-06-10T10:00:00Z', [METRICS_ROW])
    const { client } = createMockClient([rawRow], null)

    const { rows } = await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(rows[0].metrics).not.toBeNull()
    expect(rows[0].metrics?.likes).toBe(10)
    expect(rows[0].metrics?.shares).toBeNull()
  })

  it('uses CALENDAR_POST_LIMIT as default when no limit provided', async () => {
    const { client, builder } = createMockClient([], null)

    await listPostsForCalendar(client, {
      businessId: BIZ,
      rangeStartUtc: RANGE_START,
      rangeEndUtc: RANGE_END,
    })

    expect(builder.limit).toHaveBeenCalledWith(CALENDAR_POST_LIMIT + 1)
  })

  it('throws on Supabase error', async () => {
    const { client } = createMockClient(null, { message: 'db error' })

    await expect(
      listPostsForCalendar(client, {
        businessId: BIZ,
        rangeStartUtc: RANGE_START,
        rangeEndUtc: RANGE_END,
      }),
    ).rejects.toThrow('db error')
  })
})

// ─── reschedulePost ──────────────────────────────────────────────────────────

describe('reschedulePost', () => {
  const NEW_TIME = '2026-06-20T09:00:00Z'

  it('returns {updated: true} when one row is affected', async () => {
    const { client } = createMockClient([{ id: POST_1 }], null)

    const result = await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(result).toEqual({ updated: true })
  })

  it('returns {updated: false} when zero rows affected (null data)', async () => {
    const { client } = createMockClient(null, null)

    const result = await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(result).toEqual({ updated: false })
  })

  it('returns {updated: false} when zero rows affected (empty array)', async () => {
    const { client } = createMockClient([], null)

    const result = await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(result).toEqual({ updated: false })
  })

  it('guards by status IN (draft, approved)', async () => {
    const { client, builder } = createMockClient([{ id: POST_1 }], null)

    await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(builder.in).toHaveBeenCalledWith('status', ['draft', 'approved'])
  })

  it('guards by business_id', async () => {
    const { client, builder } = createMockClient([{ id: POST_1 }], null)

    await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(builder.eq).toHaveBeenCalledWith('business_id', BIZ)
  })

  it('guards published_at IS NULL', async () => {
    const { client, builder } = createMockClient([{ id: POST_1 }], null)

    await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(builder.is).toHaveBeenCalledWith('published_at', null)
  })

  it('guards deleted_at IS NULL', async () => {
    const { client, builder } = createMockClient([{ id: POST_1 }], null)

    await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
  })

  it('uses a single guarded UPDATE — client.from called exactly once', async () => {
    const { client } = createMockClient([{ id: POST_1 }], null)

    await reschedulePost(client, {
      postId: POST_1,
      businessId: BIZ,
      newScheduledAtUtc: NEW_TIME,
    })

    expect(client.from).toHaveBeenCalledTimes(1)
    expect(client.from).toHaveBeenCalledWith('posts')
  })

  it('throws on Supabase error — {updated:false} is never thrown for 0 rows', async () => {
    const { client } = createMockClient(null, { message: 'update failed' })

    await expect(
      reschedulePost(client, {
        postId: POST_1,
        businessId: BIZ,
        newScheduledAtUtc: NEW_TIME,
      }),
    ).rejects.toThrow('update failed')
  })
})

// ─── reschedulePostsBatch (20C MAJOR-1 / D-N: one atomic statement) ─────────

describe('reschedulePostsBatch', () => {
  const NEW_TIME = '2026-06-20T09:00:00Z'

  it('calls reschedule_posts_batch RPC exactly once for a multi-row group — no per-post loop', async () => {
    const { client } = createMockClient([POST_1, POST_2], null)

    await reschedulePostsBatch(client, {
      businessId: BIZ,
      moves: [
        { id: POST_1, newScheduledAtUtc: '2026-06-20T09:00:00.000Z' },
        { id: POST_2, newScheduledAtUtc: '2026-06-20T11:00:00.000Z' },
      ],
    })

    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('reschedule_posts_batch', {
      p_business_id: BIZ,
      p_moves: [
        { id: POST_1, ts: '2026-06-20T09:00:00.000Z' },
        { id: POST_2, ts: '2026-06-20T11:00:00.000Z' },
      ],
    })
  })

  it('returns the moved ids from the RPC result', async () => {
    const { client } = createMockClient([POST_1, POST_2], null)

    const result = await reschedulePostsBatch(client, {
      businessId: BIZ,
      moves: [
        { id: POST_1, newScheduledAtUtc: NEW_TIME },
        { id: POST_2, newScheduledAtUtc: NEW_TIME },
      ],
    })

    expect(result).toEqual([POST_1, POST_2])
  })

  it('a post claimed mid-flight (status flipped) is absent from the returned ids', async () => {
    // The RPC's own WHERE guard (status IN draft/approved) rejects the claimed
    // row server-side — the mock simulates that by returning only POST_1.
    const { client } = createMockClient([POST_1], null)

    const result = await reschedulePostsBatch(client, {
      businessId: BIZ,
      moves: [
        { id: POST_1, newScheduledAtUtc: NEW_TIME },
        { id: POST_2, newScheduledAtUtc: NEW_TIME },
      ],
    })

    expect(result).toEqual([POST_1])
  })

  it('is a no-op and does not call the RPC when moves is empty', async () => {
    const { client } = createMockClient(null, null)

    const result = await reschedulePostsBatch(client, { businessId: BIZ, moves: [] })

    expect(result).toEqual([])
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('returns [] when the RPC returns null data', async () => {
    const { client } = createMockClient(null, null)

    const result = await reschedulePostsBatch(client, {
      businessId: BIZ,
      moves: [{ id: POST_1, newScheduledAtUtc: NEW_TIME }],
    })

    expect(result).toEqual([])
  })

  it('throws on Supabase error', async () => {
    const { client } = createMockClient(null, { message: 'rpc failed' })

    await expect(
      reschedulePostsBatch(client, {
        businessId: BIZ,
        moves: [{ id: POST_1, newScheduledAtUtc: NEW_TIME }],
      }),
    ).rejects.toThrow('rpc failed')
  })

  it('always passes p_business_id — the RPC guard is the only cross-business defense at this layer (RLS + SECURITY INVOKER enforce it server-side)', async () => {
    const { client } = createMockClient([POST_1], null)
    const OTHER_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

    await reschedulePostsBatch(client, {
      businessId: OTHER_BIZ,
      moves: [{ id: POST_1, newScheduledAtUtc: NEW_TIME }],
    })

    expect(client.rpc).toHaveBeenCalledWith(
      'reschedule_posts_batch',
      expect.objectContaining({ p_business_id: OTHER_BIZ }),
    )
  })
})
