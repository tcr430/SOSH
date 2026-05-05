import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import {
  upsertPostMetrics,
  getPostMetricsByPostId,
  listStalePostMetrics,
} from './post-metrics'
import type { PostMetricsRow, PostMetricsInsert } from './types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

const mockMetrics: PostMetricsRow = {
  id: 'pm-1',
  post_id: 'post-1',
  business_id: 'biz-1',
  likes: 10,
  comments: 2,
  shares: 1,
  saves: null,
  clicks: null,
  reach: null,
  impressions: 500,
  last_synced_at: '2026-04-30T12:00:00Z',
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T12:00:00Z',
}

describe('upsertPostMetrics', () => {
  const insertData: PostMetricsInsert = {
    post_id: 'post-1',
    business_id: 'biz-1',
    likes: 10,
  }

  it('returns the upserted post metrics', async () => {
    const { client } = createMockClient(mockMetrics)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await upsertPostMetrics(insertData)
    expect(result).toEqual(mockMetrics)
    expect(client.from).toHaveBeenCalledWith('post_metrics')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Upsert error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(upsertPostMetrics(insertData)).rejects.toThrow('Upsert error')
  })
})

describe('getPostMetricsByPostId', () => {
  it('returns post metrics when found', async () => {
    const { client } = createMockClient(mockMetrics)
    const result = await getPostMetricsByPostId(client, 'post-1')
    expect(result).toEqual(mockMetrics)
    expect(client.from).toHaveBeenCalledWith('post_metrics')
  })

  it('returns null when not found', async () => {
    const { client } = createMockClient(null, null)
    const result = await getPostMetricsByPostId(client, 'post-missing')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getPostMetricsByPostId(client, 'post-1')).rejects.toThrow('DB error')
  })
})

describe('listStalePostMetrics', () => {
  it('returns list of stale post metrics', async () => {
    const { client } = createMockClient([mockMetrics])
    const result = await listStalePostMetrics(client, '2026-04-29T00:00:00Z')
    expect(result).toEqual([mockMetrics])
    expect(client.from).toHaveBeenCalledWith('post_metrics')
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listStalePostMetrics(client, '2026-04-29T00:00:00Z')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listStalePostMetrics(client, '2026-04-29T00:00:00Z')).rejects.toThrow('DB error')
  })
})
