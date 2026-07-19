import { vi, describe, it, expect } from 'vitest'
import { retrieveRelevant } from './evidence'
import * as memoryEvidenceDb from '@/lib/db/memory-evidence'
import type { EvidenceMemoryRow } from '@/lib/db/types'
import { EVIDENCE_CAP } from './constants'

vi.mock('@/lib/db/memory-evidence', () => ({
  listEvidenceMemoryCandidates: vi.fn(),
}))

function makeRow(overrides: Partial<EvidenceMemoryRow> = {}): EvidenceMemoryRow {
  return {
    id: 'ev-1',
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
    kind: 'quote',
    content: 'This tool saved us hours every week',
    source_url: null,
    ...overrides,
  }
}

describe('retrieveRelevant (evidence)', () => {
  it('calls listEvidenceMemoryCandidates with the client, businessId, and limit', async () => {
    vi.mocked(memoryEvidenceDb.listEvidenceMemoryCandidates).mockResolvedValue([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    await retrieveRelevant(client, 'biz-1', {}, 20)

    expect(memoryEvidenceDb.listEvidenceMemoryCandidates).toHaveBeenCalledWith(client, 'biz-1', 20)
  })

  it('never returns more than EVIDENCE_CAP rows, even when the candidate query returns more', async () => {
    const candidates = Array.from({ length: EVIDENCE_CAP + 3 }, (_, i) =>
      makeRow({ id: `ev-${i}`, confidence: (i + 1) / 10 }),
    )
    vi.mocked(memoryEvidenceDb.listEvidenceMemoryCandidates).mockResolvedValue(candidates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result).toHaveLength(EVIDENCE_CAP)
  })

  it('excludes non-active rows even if the (mocked) candidate source misbehaved and returned one', async () => {
    vi.mocked(memoryEvidenceDb.listEvidenceMemoryCandidates).mockResolvedValue([
      makeRow({ id: 'active', status: 'active' }),
      makeRow({ id: 'retired', status: 'retired' }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = {} as any

    const result = await retrieveRelevant(client, 'biz-1', {})

    expect(result.map(r => r.id)).toEqual(['active'])
  })
})
