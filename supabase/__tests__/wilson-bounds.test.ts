import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { createWorld, destroyWorld, type World } from '../__helpers__/outcome-fixtures'

// ADR 0026 §5.4 / §12.2 — wilson_bounds is THE ONE COPY of the formula, and it is proven THROUGH THE
// REAL SQL FUNCTION. A TypeScript re-implementation is not accepted as proof of the gate (build-guide
// rule 2), so the expected values below are literal reference numbers for z = 1.96, not computed here.
// This file also proves the grants on EVERY new function: authenticated may not EXECUTE any of them.

const Z = 1.96
// [wins, n, low, high] — literal Wilson reference values for z = 1.96 (4 dp).
const TABLE: Array<[number, number, number, number]> = [
  [9, 10, 0.5958, 0.9821], // the ADR's promoting case: low ~ 0.596
  [8, 10, 0.4902, 0.9433], // the ADR's non-promoting case: low ~ 0.490
  [5, 10, 0.2366, 0.7634],
  [10, 10, 0.7225, 1.0],
  [0, 10, 0.0, 0.2775],
  [50, 100, 0.4038, 0.5962],
  [1, 1, 0.2065, 1.0],
]

describe('wilson_bounds (ADR 0026 §5.4)', () => {
  let w: World
  let pg: Client
  let authed: SupabaseClient

  beforeAll(async () => {
    w = await createWorld('wilson')
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
    authed = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error } = await authed.auth.signInWithPassword({ email: w.email, password: 'TestPass123!' })
    if (error) throw error
  })
  afterAll(async () => {
    if (pg) await pg.end()
    await destroyWorld(w)
  })

  const bounds = async (wins: number, n: number) => {
    const { data, error } = await w.admin.rpc('wilson_bounds', { p_wins: wins, p_n: n, p_z: Z })
    expect(error).toBeNull()
    return { low: Number(data[0].low), high: Number(data[0].high) }
  }

  it.each(TABLE)('(%i, %i) -> low %f, high %f', async (wins, n, low, high) => {
    const b = await bounds(wins, n)
    expect(b.low).toBeCloseTo(low, 3)
    expect(b.high).toBeCloseTo(high, 3)
  })

  it('n = 0 is the vacuous interval (0, 1): low = 0 fails every "low > 0.5" gate', async () => {
    expect(await bounds(0, 0)).toEqual({ low: 0, high: 1 })
  })

  it('wins outside 0..n RAISES rather than returning nonsense', async () => {
    expect((await w.admin.rpc('wilson_bounds', { p_wins: 11, p_n: 10, p_z: Z })).error).not.toBeNull()
    expect((await w.admin.rpc('wilson_bounds', { p_wins: -1, p_n: 10, p_z: Z })).error).not.toBeNull()
  })

  it('the symmetry the below-usual rule relies on holds: low(k, n) = 1 - high(n - k, n)', async () => {
    for (const [k, n] of [[9, 10], [3, 12], [1, 10], [40, 45]]) {
      const a = await bounds(k, n)
      const b = await bounds(n - k, n)
      expect(a.low).toBeCloseTo(1 - b.high, 9)
      expect(a.high).toBeCloseTo(1 - b.low, 9)
    }
  })

  it('the interval is monotone in wins and always inside [0, 1]', async () => {
    let prev = -1
    for (let k = 0; k <= 10; k += 1) {
      const b = await bounds(k, 10)
      expect(b.low).toBeGreaterThanOrEqual(prev)
      expect(b.low).toBeGreaterThanOrEqual(0)
      expect(b.high).toBeLessThanOrEqual(1)
      expect(b.low).toBeLessThanOrEqual(b.high)
      prev = b.low
    }
  })

  it('is IMMUTABLE, SECURITY DEFINER and search_path-pinned', async () => {
    const { rows } = await pg.query<{ provolatile: string; prosecdef: boolean; proconfig: string[] }>(
      `SELECT provolatile, prosecdef, proconfig FROM pg_proc WHERE proname = 'wilson_bounds' AND pronamespace = 'public'::regnamespace`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].provolatile).toBe('i')
    expect(rows[0].prosecdef).toBe(true)
    expect(rows[0].proconfig.join(',')).toMatch(/search_path=public, pg_temp/)
  })
})

describe('grants on every outcome function (a missing REVOKE on a SECURITY DEFINER function is a privilege escalation)', () => {
  const FUNCTIONS = [
    'wilson_bounds',
    'outcome_cell_stats',
    'upsert_outcome_performance_pattern',
    'promote_outcome_pattern',
    'demote_outcome_pattern',
    'acknowledge_campaign_retrospective',
    'get_learning_cycles_northstar',
  ]
  let pg: Client

  beforeAll(async () => {
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
  })
  afterAll(async () => {
    if (pg) await pg.end()
  })

  it.each(FUNCTIONS)('%s: service_role may EXECUTE; authenticated, anon and PUBLIC may not; DEFINER with a pinned search_path', async (name) => {
    const { rows } = await pg.query<{
      prosecdef: boolean; proconfig: string[] | null; svc: boolean; auth: boolean; anon: boolean; public_exec: boolean
    }>(
      `SELECT p.prosecdef, p.proconfig,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE'), false) AS public_exec
         FROM pg_proc p WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`,
      [name],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ prosecdef: true, svc: true, auth: false, anon: false, public_exec: false })
    expect((rows[0].proconfig ?? []).join(',')).toMatch(/search_path=public, pg_temp/)
  })

  it('an AUTHENTICATED client calling any of them over the API is refused (permission denied)', async () => {
    const w = await createWorld('grants')
    try {
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      await client.auth.signInWithPassword({ email: w.email, password: 'TestPass123!' })
      const calls: Array<[string, Record<string, unknown>]> = [
        ['wilson_bounds', { p_wins: 9, p_n: 10, p_z: 1.96 }],
        ['promote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: 'outcome:role:x:above:linkedin' }],
        ['demote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: 'outcome:role:x:above:linkedin' }],
        ['get_learning_cycles_northstar', { p_since: new Date().toISOString() }],
        ['acknowledge_campaign_retrospective', { p_business_id: w.businessId, p_campaign_id: w.businessId, p_user_id: w.userId, p_pattern_text: 't' }],
        ['upsert_outcome_performance_pattern', { p_business_id: w.businessId, p_dimension: 'role', p_value: 'x', p_platform: 'linkedin', p_direction: 'above', p_pattern_text: 't' }],
        ['outcome_cell_stats', { p_business_id: w.businessId, p_dimension: 'role', p_value: 'x', p_platform: 'linkedin', p_direction: 'above' }],
      ]
      for (const [fn, args] of calls) {
        const { error } = await client.rpc(fn, args)
        expect(error, fn).not.toBeNull()
        expect(error!.code, fn).toBe('42501')
      }
    } finally {
      await destroyWorld(w)
    }
  })
})
