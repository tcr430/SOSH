import { vi, describe, it, expect } from 'vitest'
import { retrieveRelevant } from './brand'
import * as memoryBrandDb from '@/lib/db/memory-brand'
import type { BrandMemoryRow } from '@/lib/db/types'
import { BRAND_CAP } from './constants'

vi.mock('@/lib/db/memory-brand', () => ({
  listBrandMemoryCandidates: vi.fn(),
}))

function makeRow(overrides: Partial<BrandMemoryRow> = {}): BrandMemoryRow {
  return {
    id: 'bm-1',
    business_id: 'biz-1',
    source: 'manual',
    confidence: 0.5,
    observation_count: 1,
    status: 'active',
    sensitivity: 'internal',
    public_use_permission: false,
    scope: 'brand',
    scope_ref: null,
    last_confirmed_at: '2026-07-19T00:00:00Z',
    recency_at: '2026-07-19T00:00:00Z',
    expires_at: null,
    deleted_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-19T00:00:00Z',
    category: 'positioning',
    statement: 'We integrate natively with every platform',
    ...overrides,
  }
}

describe('retrieveRelevant (brand)', () => {
  it('calls listBrandMemoryCandidates with the client, businessId, and limit', async () => {
    vi.mocked(memoryBrandDb.listBrandMemoryCandidates).mockResolvedValue([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    await retrieveRelevant(client, 'biz-1', {}, 20)

    expect(memoryBrandDb.listBrandMemoryCandidates).toHaveBeenCalledWith(client, 'biz-1', 20)
  })

  it('never returns more than BRAND_CAP rows, even when the candidate query returns more', async () => {
    const candidates = Array.from({ length: BRAND_CAP + 3 }, (_, i) =>
      makeRow({ id: `bm-${i}`, confidence: (i + 1) / 10 }),
    )
    vi.mocked(memoryBrandDb.listBrandMemoryCandidates).mockResolvedValue(candidates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toHaveLength(BRAND_CAP)
  })

  it('excludes non-active rows even if the (mocked) candidate source misbehaved and returned one', async () => {
    vi.mocked(memoryBrandDb.listBrandMemoryCandidates).mockResolvedValue([
      makeRow({ id: 'active', status: 'active' }),
      makeRow({ id: 'candidate', status: 'candidate' }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result.map(r => r.id)).toEqual(['active'])
  })
})
