import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { listBrandMemoryCandidates } from './memory-brand'
import type { BrandMemoryRow } from './types'

function makeRow(overrides: Partial<BrandMemoryRow> = {}): BrandMemoryRow {
  return {
    id: 'bm-1',
    business_id: 'biz-1',
    source: 'manual',
    confidence: 0.8,
    observation_count: 3,
    status: 'active',
    sensitivity: 'internal',
    public_use_permission: false,
    scope: 'brand',
    scope_ref: null,
    last_confirmed_at: '2026-07-01T00:00:00Z',
    recency_at: '2026-07-01T00:00:00Z',
    expires_at: null,
    deleted_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    category: 'positioning',
    statement: 'We integrate natively with Postiz',
    ...overrides,
  }
}

describe('listBrandMemoryCandidates', () => {
  it('queries brand_memory filtered by business_id, status=active, deleted_at null, ordered and limited', async () => {
    const rows = [makeRow()]
    const { client, builder } = createMockClient(rows, null)

    await listBrandMemoryCandidates(client, 'biz-1')

    expect(client.from).toHaveBeenCalledWith('brand_memory')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    // Ordering must match brand_memory_retrieval_idx: (confidence DESC, recency_at DESC).
    expect(builder.order).toHaveBeenNthCalledWith(1, 'confidence', { ascending: false })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'recency_at', { ascending: false })
    // Never orders on the raw nullable column directly — recency_at is the
    // COALESCE-generated column that keeps NULL-last_confirmed_at rows
    // correctly positioned (ADR 0016 §5.3).
    expect(builder.order).not.toHaveBeenCalledWith('last_confirmed_at', expect.anything())
  })

  it('applies the given limit, defaulting to MEMORY_CANDIDATE_LIMIT', async () => {
    const { client, builder } = createMockClient([makeRow()], null)

    await listBrandMemoryCandidates(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)

    await listBrandMemoryCandidates(client, 'biz-1', 10)
    expect(builder.limit).toHaveBeenCalledWith(10)
  })

  it('a fresh, never-confirmed row (last_confirmed_at NULL) still lands in the candidate window', async () => {
    // ADR 0016 §5.3: a freshly-distilled row with no last_confirmed_at must
    // not be silently excluded by this layer's query — it is present in the
    // result here because the query has no filter that would drop it.
    // Actual COALESCE-ranking is a DB-level guarantee (the recency_at
    // generated column, migration 20260719020000), not something this
    // mocked-client test can prove — that needs a Tier-1 live-Postgres test.
    const freshRow = makeRow({
      id: 'bm-fresh',
      source: 'distilled',
      last_confirmed_at: null,
      recency_at: '2026-07-10T00:00:00Z', // = created_at, per the generated column
      created_at: '2026-07-10T00:00:00Z',
      confidence: 0.9,
    })
    const { client } = createMockClient([freshRow], null)

    const result = await listBrandMemoryCandidates(client, 'biz-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('bm-fresh')
    expect(result[0].last_confirmed_at).toBeNull()
  })

  it('throws when the query returns an error', async () => {
    const { client } = createMockClient(null, { message: 'connection reset' })
    await expect(listBrandMemoryCandidates(client, 'biz-1')).rejects.toThrow('connection reset')
  })

  it('returns an empty array when no rows match', async () => {
    const { client } = createMockClient([], null)
    const result = await listBrandMemoryCandidates(client, 'biz-1')
    expect(result).toEqual([])
  })
})
