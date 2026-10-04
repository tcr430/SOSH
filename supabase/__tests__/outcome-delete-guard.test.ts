import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createWorld, destroyWorld, type World } from '../__helpers__/outcome-fixtures'

// Security-reviewer MINOR-2 (Session 33 J2.11) — a member cannot hard-DELETE an outcome row from
// performance_memory; every other row is deletable as before. Tier 1, live Postgres.

describe('performance_memory DELETE policy excludes outcome rows', () => {
  let w: World
  let member: SupabaseClient
  beforeEach(async () => {
    w = await createWorld('delete-guard')
    member = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const { error } = await member.auth.signInWithPassword({ email: w.email, password: 'TestPass123!' })
    if (error) throw error
  })
  afterEach(async () => {
    await destroyWorld(w)
  })

  const base = { business_id: '', status: 'active', scope: 'brand', dimension: 'topic', confidence: 0.5, observation_count: 1, platform: 'linkedin' }

  it('the member cannot delete an outcome row (0 rows removed, the row survives)', async () => {
    const { data: row, error } = await w.admin.from('performance_memory').insert({
      ...base, business_id: w.businessId, source: 'outcome', dimension: 'role', pattern: 'p',
      pattern_key: 'outcome:role:customer_proof:above:linkedin', outcome_n: 10, outcome_wins: 9, outcome_distinct_campaigns: 3,
      interval_low: 0.6, interval_high: 0.95, metric_basis: 'rate', baseline_seeded: false,
    }).select('id').single()
    expect(error).toBeNull()
    const del = await member.from('performance_memory').delete().eq('id', row.id).select('id')
    expect(del.data ?? []).toHaveLength(0)
    const { data: still } = await w.admin.from('performance_memory').select('id').eq('id', row.id)
    expect(still).toHaveLength(1)
  })

  // AMENDED (Session 36 L2.2, ADR 0030 §2.4 / A-5): "the member can still delete a manual row" no longer holds. The whole
  // member write path on performance_memory is closed at the GRANT layer, so the delete is refused with 42501 and the
  // row survives. Amended, not deleted. The outcome-row case above still passes, now for the stronger reason that NO
  // member DELETE reaches the table (the delete guard it was written for is kept, unreachable, as defence in depth).
  it('the member can no longer delete a manual row either: refused with 42501, the row survives (ADR 0030 §2.4, A-5)', async () => {
    const { data: row } = await w.admin.from('performance_memory').insert({
      ...base, business_id: w.businessId, source: 'manual', pattern: 'manual pattern',
    }).select('id').single()
    const del = await member.from('performance_memory').delete().eq('id', row.id).select('id')
    expect(del.error?.code).toBe('42501')
    expect(del.data ?? []).toHaveLength(0)
    const { data: still } = await w.admin.from('performance_memory').select('id').eq('id', row.id)
    expect(still).toHaveLength(1)
  })
})
