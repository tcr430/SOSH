import { vi, describe, it, expect } from 'vitest'
import { retrieveRelevant } from './audience'
import * as memoryAudienceDb from '@/lib/db/memory-audience'
import type { AudienceMemoryRow } from '@/lib/db/types'
import { AUDIENCE_CAP } from './constants'

vi.mock('@/lib/db/memory-audience', () => ({
  listAudienceMemoryCandidates: vi.fn(),
}))

function makeRow(overrides: Partial<AudienceMemoryRow> = {}): AudienceMemoryRow {
  return {
    id: 'au-1',
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
    segment: 'CTOs at seed-stage SaaS',
    kind: 'problem',
    statement: 'CTOs struggle to keep a consistent posting cadence',
    ...overrides,
  }
}

describe('retrieveRelevant (audience)', () => {
  it('calls listAudienceMemoryCandidates with the client, businessId, and limit', async () => {
    vi.mocked(memoryAudienceDb.listAudienceMemoryCandidates).mockResolvedValue([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    await retrieveRelevant(client, 'biz-1', {}, 20)

    expect(memoryAudienceDb.listAudienceMemoryCandidates).toHaveBeenCalledWith(client, 'biz-1', 20)
  })

  it('never returns more than AUDIENCE_CAP rows, even when the candidate query returns more', async () => {
    const candidates = Array.from({ length: AUDIENCE_CAP + 3 }, (_, i) =>
      makeRow({ id: `au-${i}`, confidence: (i + 1) / 10 }),
    )
    vi.mocked(memoryAudienceDb.listAudienceMemoryCandidates).mockResolvedValue(candidates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toHaveLength(AUDIENCE_CAP)
  })

  it('excludes non-active rows even if the (mocked) candidate source misbehaved and returned one', async () => {
    vi.mocked(memoryAudienceDb.listAudienceMemoryCandidates).mockResolvedValue([
      makeRow({ id: 'active', status: 'active' }),
      makeRow({ id: 'candidate', status: 'candidate' }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result.map(r => r.id)).toEqual(['active'])
  })
})
