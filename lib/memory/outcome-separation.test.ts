import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrieveRelevant, retrieveStudioPerformancePatterns } from './performance'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'

// OUTCOME-SEPARATE-RETRIEVAL (ADR 0026 §6.4, constraint 17). SHARED-FUNCTION CALLERS: the shared
// listPerformanceMemoryCandidates has TWO call paths — lib/memory/performance.ts retrieveRelevant (-> lib/ai/context.ts)
// and retrieveStudioPerformancePatterns (-> studio/actions.ts:136). Each is proved here against a client that
// APPLIES the query's own filters over an in-memory table holding BOTH a distilled row and an outcome row, both
// active and unexpired. The outcome row is excluded only because of the source predicate.

type Row = Record<string, unknown>

function fakeClient(rows: Row[]): SupabaseClient {
  const build = () => {
    const filters: Array<(r: Row) => boolean> = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b }
    b.neq = (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return b }
    b.is = (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b }
    b.or = () => b
    b.order = () => b
    b.limit = () => b
    b.then = (res: (v: unknown) => unknown) => res({ data: rows.filter((r) => filters.every((f) => f(r))), error: null })
    return b
  }
  return { from: () => build() } as unknown as SupabaseClient
}

const base = {
  business_id: 'biz-1', status: 'active', sensitivity: 'internal', public_use_permission: false,
  scope: 'brand', scope_ref: null, last_confirmed_at: '2026-09-10T00:00:00Z', recency_at: '2026-09-10T00:00:00Z',
  expires_at: '2099-01-01T00:00:00Z', deleted_at: null, created_at: '2026-09-01T00:00:00Z', platform: 'twitter',
  observation_count: 5,
}
const distilled = { ...base, id: 'd1', source: 'distilled', pattern: 'DISTILLED-PATTERN', confidence: 0.5 }
const outcome = { ...base, id: 'o1', source: 'outcome', pattern: 'OUTCOME-PATTERN', confidence: 0.99 }

describe('outcome rows never appear in the shared performance retrieval (OUTCOME-SEPARATE-RETRIEVAL)', () => {
  it('the shared reader itself excludes source = outcome', async () => {
    const out = await listPerformanceMemoryCandidates(fakeClient([distilled, outcome]), 'biz-1')
    expect(out.map((r) => r.id)).toEqual(['d1'])
  })

  it('call path 1: retrieveRelevant (-> lib/ai/context.ts) returns the distilled row and never the outcome row', async () => {
    const out = await retrieveRelevant(fakeClient([distilled, outcome]), 'biz-1', {})
    expect(out.map((p) => p.topContent)).toEqual(['DISTILLED-PATTERN'])
  })

  it('call path 2: retrieveStudioPerformancePatterns (-> studio/actions.ts) never returns the outcome row, even at higher confidence', async () => {
    const out = await retrieveStudioPerformancePatterns(fakeClient([distilled, outcome]), 'biz-1', {})
    expect(out.map((p) => p.pattern)).toEqual(['DISTILLED-PATTERN'])
    expect(out.some((p) => p.rowId === 'o1')).toBe(false)
  })

  it('with ONLY outcome rows, the shared reader returns nothing', async () => {
    expect(await listPerformanceMemoryCandidates(fakeClient([outcome]), 'biz-1')).toEqual([])
  })
})
