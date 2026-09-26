import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/db/memory-brand', () => ({ listBrandSlotRows: vi.fn() }))
vi.mock('@/lib/db/memory-audience', () => ({ listAudienceSlotRows: vi.fn() }))
vi.mock('@/lib/db/memory-evidence', () => ({ listEvidenceSlotRows: vi.fn() }))

import type { SupabaseClient } from '@supabase/supabase-js'
import { listAudienceSlotRows } from '@/lib/db/memory-audience'
import { listBrandSlotRows } from '@/lib/db/memory-brand'
import { listEvidenceSlotRows } from '@/lib/db/memory-evidence'
import { computeSlotThinness } from '@/lib/interview/thinness'
import { readInterviewSlotRows } from './interview-coverage'

// ADR 0029 §3.2 (Session 35 M2.7) — the memory-side read of coverage. MEM-NO-DIRECT-TABLE-ACCESS: the interview asks
// lib/memory/, which asks lib/db/memory-*.ts. Here the three db reads are mocked; what is proved is the MERGE — one flat
// SlotRow list, types kept apart, `kind` mapped to `category`, `now` passed as an ISO instant — and that the result feeds
// the pure thinness function.
// SHARED-FUNCTION CALLERS: readInterviewSlotRows has none in production yet (the /interview page and the Start action
// arrive in M2.9/M2.10); this file is the only executed proof until then.

afterEach(() => vi.clearAllMocks())

const client = {} as SupabaseClient
const NOW = new Date('2026-09-26T12:00:00.000Z')

describe('readInterviewSlotRows', () => {
  it('merges the three stores into one SlotRow list, mapping kind to category and keeping the types apart', async () => {
    vi.mocked(listBrandSlotRows).mockResolvedValue([
      { category: 'positioning', status: 'active', recency_at: '2026-09-01T00:00:00.000Z', expires_at: null, deleted_at: null },
    ])
    vi.mocked(listAudienceSlotRows).mockResolvedValue([
      { kind: 'objection', status: 'active', recency_at: '2026-08-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z', deleted_at: null },
    ])
    vi.mocked(listEvidenceSlotRows).mockResolvedValue([
      { kind: 'quote', status: 'active', recency_at: '2026-07-01T00:00:00.000Z', expires_at: null, deleted_at: null },
    ])

    const rows = await readInterviewSlotRows(client, 'biz-1', NOW)
    expect(rows).toEqual([
      { type: 'brand', category: 'positioning', status: 'active', recencyAt: '2026-09-01T00:00:00.000Z', expiresAt: null, deletedAt: null },
      { type: 'audience', category: 'objection', status: 'active', recencyAt: '2026-08-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', deletedAt: null },
      { type: 'evidence', category: 'quote', status: 'active', recencyAt: '2026-07-01T00:00:00.000Z', expiresAt: null, deletedAt: null },
    ])
  })

  it("passes the caller's client, the business id and now as an ISO instant to each store", async () => {
    vi.mocked(listBrandSlotRows).mockResolvedValue([])
    vi.mocked(listAudienceSlotRows).mockResolvedValue([])
    vi.mocked(listEvidenceSlotRows).mockResolvedValue([])
    await readInterviewSlotRows(client, 'biz-9', NOW)
    for (const fn of [listBrandSlotRows, listAudienceSlotRows, listEvidenceSlotRows]) {
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(client, 'biz-9', '2026-09-26T12:00:00.000Z')
    }
  })

  it('feeds computeSlotThinness: one fresh positioning row makes positioning thin at exactly 0.5 and the rest 1.0', async () => {
    vi.mocked(listBrandSlotRows).mockResolvedValue([
      { category: 'positioning', status: 'active', recency_at: '2026-09-01T00:00:00.000Z', expires_at: null, deleted_at: null },
    ])
    vi.mocked(listAudienceSlotRows).mockResolvedValue([])
    vi.mocked(listEvidenceSlotRows).mockResolvedValue([])
    const thinness = computeSlotThinness(await readInterviewSlotRows(client, 'biz-1', NOW), NOW)
    expect(thinness.find((s) => s.category === 'positioning')?.thinness).toBe(0.5)
    expect(thinness.find((s) => s.category === 'capability')?.thinness).toBe(1)
  })

  it('propagates a store error instead of returning a partial (falsely thin) list', async () => {
    vi.mocked(listBrandSlotRows).mockRejectedValue(new Error('brand read failed'))
    vi.mocked(listAudienceSlotRows).mockResolvedValue([])
    vi.mocked(listEvidenceSlotRows).mockResolvedValue([])
    await expect(readInterviewSlotRows(client, 'biz-1', NOW)).rejects.toThrow(/brand read failed/)
  })
})
