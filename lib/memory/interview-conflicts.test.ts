import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({ __service: true })) }))
vi.mock('@/lib/db/memory-brand', () => ({ listBrandMemoryCandidates: vi.fn() }))
vi.mock('@/lib/db/memory-audience', () => ({ listAudienceMemoryCandidates: vi.fn() }))
vi.mock('@/lib/db/memory-evidence', () => ({ listEvidenceMemoryCandidates: vi.fn() }))

import { listAudienceMemoryCandidates } from '@/lib/db/memory-audience'
import { listBrandMemoryCandidates } from '@/lib/db/memory-brand'
import { listEvidenceMemoryCandidates } from '@/lib/db/memory-evidence'
import { readInterviewConflictContext } from './interview-conflicts'

// ADR 0029 §4.5 (Session 35 M2.8) — the conflict context the extraction call is shown. INTERVIEW-CONFLICT-TENANT-BOUNDED's
// source set: THIS business only, ACTIVE records only, at most 10 PER TYPE, scored and capped by the shared rankAndCap.
// SHARED-FUNCTION CALLERS: readInterviewConflictContext is called only by lib/interview/extract.ts (its test mocks this
// function; this file is the executed proof of the read).

afterEach(() => vi.clearAllMocks())

const NOW = new Date('2026-09-26T12:00:00.000Z')

function row(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `rec-${i}`,
    business_id: 'biz-1',
    status: 'active',
    confidence: 0.5 + (i % 10) / 100,
    recency_at: '2026-09-01T00:00:00.000Z',
    scope: 'brand',
    scope_ref: null,
    expires_at: null,
    deleted_at: null,
    statement: `statement ${i}`,
    content: `content ${i}`,
    ...over,
  }
}
const many = (n: number, over: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => row(i, over))

describe('readInterviewConflictContext', () => {
  it("returns AT MOST 10 records per type (the interview's own cap, not the barrel's 5), even from a longer candidate list", async () => {
    vi.mocked(listBrandMemoryCandidates).mockResolvedValue(many(30) as never)
    vi.mocked(listAudienceMemoryCandidates).mockResolvedValue(many(30) as never)
    vi.mocked(listEvidenceMemoryCandidates).mockResolvedValue(many(30) as never)
    const records = await readInterviewConflictContext('biz-1', NOW)
    expect(records.filter((r) => r.type === 'brand')).toHaveLength(10)
    expect(records.filter((r) => r.type === 'audience')).toHaveLength(10)
    expect(records.filter((r) => r.type === 'evidence')).toHaveLength(10)
    expect(records).toHaveLength(30)
  })

  it('reads all three stores for THE ONE business it was given, under the service-role client it acquired itself', async () => {
    vi.mocked(listBrandMemoryCandidates).mockResolvedValue([])
    vi.mocked(listAudienceMemoryCandidates).mockResolvedValue([])
    vi.mocked(listEvidenceMemoryCandidates).mockResolvedValue([])
    await readInterviewConflictContext('biz-1', NOW)
    for (const fn of [listBrandMemoryCandidates, listAudienceMemoryCandidates, listEvidenceMemoryCandidates]) {
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith({ __service: true }, 'biz-1')
    }
    expect(readInterviewConflictContext.length).toBe(1) // (businessId, now = default): no client parameter
  })

  it("maps each store's text field: brand and audience statement, evidence content", async () => {
    vi.mocked(listBrandMemoryCandidates).mockResolvedValue([row(1)] as never)
    vi.mocked(listAudienceMemoryCandidates).mockResolvedValue([row(2)] as never)
    vi.mocked(listEvidenceMemoryCandidates).mockResolvedValue([row(3)] as never)
    expect(await readInterviewConflictContext('biz-1', NOW)).toEqual([
      { id: 'rec-1', type: 'brand', text: 'statement 1' },
      { id: 'rec-2', type: 'audience', text: 'statement 2' },
      { id: 'rec-3', type: 'evidence', text: 'content 3' },
    ])
  })

  it('ACTIVE and unexpired only: a candidate, a retired and an expired row are excluded even if the query handed them over', async () => {
    vi.mocked(listBrandMemoryCandidates).mockResolvedValue([
      row(1),
      row(2, { status: 'candidate' }),
      row(3, { status: 'retired' }),
      row(4, { expires_at: '2026-09-01T00:00:00.000Z' }),
    ] as never)
    vi.mocked(listAudienceMemoryCandidates).mockResolvedValue([])
    vi.mocked(listEvidenceMemoryCandidates).mockResolvedValue([])
    expect((await readInterviewConflictContext('biz-1', NOW)).map((r) => r.id)).toEqual(['rec-1'])
  })

  it('returns [] for a business with no active memory', async () => {
    vi.mocked(listBrandMemoryCandidates).mockResolvedValue([])
    vi.mocked(listAudienceMemoryCandidates).mockResolvedValue([])
    vi.mocked(listEvidenceMemoryCandidates).mockResolvedValue([])
    expect(await readInterviewConflictContext('biz-1', NOW)).toEqual([])
  })
})
