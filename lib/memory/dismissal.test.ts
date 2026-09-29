import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ADR 0030 §6.5 (TS half) and §6.8, Session 36 L2.6 — SUBSTRATE-DISMISSAL-SCOPED-CONSUMER (28), Tier 2 half, and SUBSTRATE-DISMISS-MAPPING's TS wiring.
//
// SHARED-FUNCTION CALLERS. listAudienceMemoryCandidates now excludes source = 'dismissal' IN THE QUERY. Every reader that inherits the exclusion is
// proved here against a client that APPLIES the query's own filters over an in-memory table holding BOTH a dismissal row and an import row, both
// ACTIVE and unexpired (so the dismissal row is excluded only because of the source predicate, never for being inactive):
//
//   reader                                      reached from                                            proved by
//   listAudienceMemoryCandidates                (the shared read)                                       case 1
//   retrieveAudienceMemory (audience.ts)        brief assembly (the bundle, L2.8), planner tools,       case 2
//                                               Studio (studio/actions.ts)
//   readInterviewConflictContext                interview extraction (lib/interview/extract.ts)         case 3 — a dismissal row is never a conflict
//                                                                                                        candidate, so it can never be offered for Replace
//   listSourceDismissalCandidates / retrieve-   triage list_audience_notes (L2.9)                       cases 4-5 — the ONLY readers that return it
//   SourceDismissals

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/db/memory-audience', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/memory-audience')>()
  return { ...actual, recomputeDismissalAudienceSignal: vi.fn() }
})

import { createServiceRoleClient } from '@/lib/supabase/service'
import { listAudienceMemoryCandidates, listSourceDismissalCandidates, recomputeDismissalAudienceSignal } from '@/lib/db/memory-audience'
import { retrieveRelevant as retrieveAudienceMemory } from './audience'
import { readInterviewConflictContext } from './interview-conflicts'
import { recomputeDismissalSignal, retrieveSourceDismissals } from './dismissal'
import { SOURCE_DISMISSAL_CAP } from './constants'
import * as barrel from './index'

type Row = Record<string, unknown>

function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  const build = (rows: Row[]) => {
    const filters: Array<(r: Row) => boolean> = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b }
    b.neq = (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return b }
    b.is = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b }
    b.order = () => b
    b.limit = () => b
    b.then = (res: (v: unknown) => unknown) => res({ data: rows.filter((r) => filters.every((f) => f(r))), error: null })
    return b
  }
  return { from: (table: string) => build(tables[table] ?? []) } as unknown as SupabaseClient
}

const base = {
  business_id: 'biz-1', status: 'active', sensitivity: 'internal', scope: 'brand', scope_ref: null, kind: 'objection', segment: null,
  last_confirmed_at: '2026-09-25T00:00:00Z', recency_at: '2026-09-25T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', deleted_at: null,
  created_at: '2026-09-01T00:00:00Z', observation_count: 3,
}
const importRow = { ...base, id: 'a-import', source: 'import', statement: 'IMPORTED-AUDIENCE-FACT', confidence: 0.3 }
const dismissalRow = { ...base, id: 'a-dismissal', source: 'dismissal', kind: 'other', statement: 'DISMISSED-SOURCE-NOTE', confidence: 0.4, decision_key: 'dismissal:not_relevant:github:r1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dismissal rows are excluded from EVERY shared audience reader (SHARED-FUNCTION CALLERS, ADR 0030 §3.4/§6.8)', () => {
  const client = () => fakeClient({ audience_memory: [importRow, dismissalRow] })

  it('case 1 — the shared reader itself: only the import row, although the dismissal row is active, unexpired and MORE confident', async () => {
    const out = await listAudienceMemoryCandidates(client(), 'biz-1')
    expect(out.map((r) => r.id)).toEqual(['a-import'])
  })

  it('case 2 — retrieveAudienceMemory (brief, planner tools, Studio): the import row and never the dismissal row', async () => {
    const out = await retrieveAudienceMemory(client(), 'biz-1', {})
    expect(out.map((r) => r.id)).toEqual(['a-import'])
    expect(out.some((r) => (r as { source: string }).source === 'dismissal')).toBe(false)
  })

  it('case 3 — readInterviewConflictContext: a dismissal row is NEVER a conflict candidate (so it can never be offered for Replace)', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(client() as never)
    const out = await readInterviewConflictContext('biz-1')
    const audience = out.filter((r) => r.type === 'audience')
    expect(audience.map((r) => r.id)).toEqual(['a-import'])
    expect(JSON.stringify(out)).not.toContain('DISMISSED-SOURCE-NOTE')
  })

  it('with ONLY a dismissal row the shared readers return nothing (the exclusion is real, not incidental)', async () => {
    const only = fakeClient({ audience_memory: [dismissalRow] })
    expect(await listAudienceMemoryCandidates(only, 'biz-1')).toEqual([])
    expect(await retrieveAudienceMemory(only, 'biz-1', {})).toEqual([])
  })

  it('case 4 — listSourceDismissalCandidates returns ONLY the dismissal row', async () => {
    const out = await listSourceDismissalCandidates(client(), 'biz-1')
    expect(out.map((r) => r.id)).toEqual(['a-dismissal'])
  })
})

describe('retrieveSourceDismissals (ADR 0030 §6.8)', () => {
  it('case 5 — returns only dismissal rows, ranked and capped at SOURCE_DISMISSAL_CAP = 3', async () => {
    expect(SOURCE_DISMISSAL_CAP).toBe(3)
    const many = Array.from({ length: 5 }, (_, i) => ({ ...dismissalRow, id: `d-${i}`, confidence: 0.1 + i * 0.05, decision_key: `dismissal:not_relevant:github:r${i}` }))
    const out = await retrieveSourceDismissals(fakeClient({ audience_memory: [importRow, ...many] }), 'biz-1')
    expect(out).toHaveLength(3)
    expect(out.every((r) => (r as { source: string }).source === 'dismissal')).toBe(true)
    // the three MOST confident of five, highest first
    expect(out.map((r) => r.id)).toEqual(['d-4', 'd-3', 'd-2'])
  })

  it("is tenant-bounded: another business's dismissal row is never returned", async () => {
    const foreign = { ...dismissalRow, id: 'd-foreign', business_id: 'biz-2' }
    const out = await retrieveSourceDismissals(fakeClient({ audience_memory: [dismissalRow, foreign] }), 'biz-1')
    expect(out.map((r) => r.id)).toEqual(['a-dismissal'])
  })

  it('returns [] when the business has none', async () => {
    expect(await retrieveSourceDismissals(fakeClient({ audience_memory: [importRow] }), 'biz-1')).toEqual([])
  })
})

describe('recomputeDismissalSignal (ADR 0030 §6.5)', () => {
  it("delegates to the db wrapper with the card id and NOTHING else, and returns the wrapper's outcome", async () => {
    vi.mocked(recomputeDismissalAudienceSignal).mockResolvedValue('upserted')
    expect(await recomputeDismissalSignal('card-1')).toBe('upserted')
    expect(recomputeDismissalAudienceSignal).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recomputeDismissalAudienceSignal).mock.calls[0]).toEqual(['card-1'])
  })

  it('does not swallow a failure: the Server Action owns the try/catch and its one console.error (ADR 0030 §6.5, R-7)', async () => {
    vi.mocked(recomputeDismissalAudienceSignal).mockRejectedValue(new Error('boom'))
    await expect(recomputeDismissalSignal('card-1')).rejects.toThrow('boom')
  })

  it('takes exactly one argument (no client, no options, no governance field)', () => {
    expect(recomputeDismissalSignal.length).toBe(1)
  })
})

describe('the public surface (lib/memory/index.ts)', () => {
  it('exports both entry points, and nothing that reads or writes a dismissal row by another route', () => {
    expect(typeof barrel.recomputeDismissalSignal).toBe('function')
    expect(typeof barrel.retrieveSourceDismissals).toBe('function')
    expect(Object.keys(barrel)).not.toContain('listSourceDismissalCandidates')
    expect(Object.keys(barrel)).not.toContain('recomputeDismissalAudienceSignal')
  })
})
