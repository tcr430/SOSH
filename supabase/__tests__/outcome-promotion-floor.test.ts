import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorld, destroyWorld, seedCell, outcomeKey, type World, type CellSpec } from '../__helpers__/outcome-fixtures'

// ADR 0026 §6.4 / §5.4 — OUTCOME-MIN-N-ENFORCED (13) and OUTCOME-RECOMPUTE-NOT-TRUST (14).
// Tier 1, live Postgres, direct RPC calls over SEEDED post_outcomes / post_dimensions.
//
// The floor is k = 10 observations, >= 3 distinct campaigns and a Wilson bound clearing 0.5 — each gate
// INDEPENDENTLY load-bearing (each case below fails if exactly that gate is removed), evaluated in SQL
// from the outcome rows, never from anything the caller or the stored row says.

const DIM = 'role'
const VALUE = 'customer_proof'
const KEY = outcomeKey(DIM, VALUE, 'above', 'linkedin')

describe('the promotion floor (ADR 0026 §6.4)', () => {
  let w: World

  beforeEach(async () => {
    w = await createWorld('floor')
  })
  afterEach(async () => {
    await destroyWorld(w)
  })

  const upsert = (direction = 'above', value = VALUE, dimension = DIM) =>
    w.admin.rpc('upsert_outcome_performance_pattern', {
      p_business_id: w.businessId,
      p_dimension: dimension,
      p_value: value,
      p_platform: 'linkedin',
      p_direction: direction,
      p_pattern_text: `Observed pattern for ${value}`,
    })

  const promote = async (key: string) => {
    const { data, error } = await w.admin.rpc('promote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: key })
    expect(error).toBeNull()
    return data as Array<{ status: string }>
  }

  const rowFor = async (key: string) => {
    const { data } = await w.admin.from('performance_memory').select('*').eq('business_id', w.businessId).eq('pattern_key', key).single()
    return data
  }

  const seed = (spec: Partial<CellSpec> & Pick<CellSpec, 'wins' | 'losses' | 'campaigns'>) => seedCell(w, { role: VALUE, ...spec })

  it('(1) 9 wins of 10, 3 campaigns -> written as a candidate, then PROMOTES', async () => {
    await seed({ wins: 9, losses: 1, campaigns: 3 })
    const { data: row, error } = await upsert()
    expect(error).toBeNull()
    expect(row).toMatchObject({
      source: 'outcome', status: 'candidate', sensitivity: 'internal', public_use_permission: false,
      dimension: DIM, platform: 'linkedin', pattern_key: KEY, scope: 'platform',
      outcome_n: 10, outcome_wins: 9, outcome_distinct_campaigns: 3, metric_basis: 'count', baseline_seeded: false,
    })
    expect(Number(row.confidence)).toBe(0.3) // wilson_low 0.596 * 10 / 20
    expect(Number(row.interval_low)).toBeCloseTo(0.596, 3)
    expect((await promote(KEY))[0].status).toBe('active')
    expect((await rowFor(KEY)).status).toBe('active')
  })

  it('(2) the SAME 9/10 with only 2 campaigns does NOT promote (the only case that catches an absent campaign gate)', async () => {
    await seed({ wins: 9, losses: 1, campaigns: 2 })
    await upsert()
    expect(await promote(KEY)).toEqual([])
    expect((await rowFor(KEY)).status).toBe('candidate')
  })

  it('(3) 8 wins of 10, 3 campaigns does NOT promote (the bound: wilson low 0.490 <= 0.5)', async () => {
    await seed({ wins: 8, losses: 2, campaigns: 3 })
    await upsert()
    expect(await promote(KEY)).toEqual([])
  })

  it('(4) 9 wins of 9, 3 campaigns does NOT promote (all-win at n = 9 fails ONLY on k)', async () => {
    await seed({ wins: 9, losses: 0, campaigns: 3 })
    const { data: row } = await upsert()
    expect(row.outcome_n).toBe(9)
    expect(await promote(KEY)).toEqual([])
  })

  it("(5) fixture 4 with its STORED outcome_n forged to 10 STILL does not promote — the RPC recomputes, never trusts", async () => {
    await seed({ wins: 9, losses: 0, campaigns: 3 })
    await upsert()
    const { error } = await w.admin
      .from('performance_memory')
      .update({ outcome_n: 10, outcome_wins: 10, outcome_distinct_campaigns: 3, observation_count: 10 })
      .eq('business_id', w.businessId)
      .eq('pattern_key', KEY)
    expect(error).toBeNull()
    expect(await promote(KEY)).toEqual([])
    expect((await rowFor(KEY)).status).toBe('candidate')
  })

  it("(6) ADR 0018's promote_performance_pattern cannot promote an outcome row (its third gate counts post_edit_signals, so an outcome key matches zero)", async () => {
    await seed({ wins: 10, losses: 0, campaigns: 4 })
    await upsert()
    const { data, error } = await w.admin.rpc('promote_performance_pattern', {
      p_business_id: w.businessId, p_pattern_key: KEY, p_dimension: DIM, p_platform: 'linkedin',
    })
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
    expect((await rowFor(KEY)).status).toBe('candidate')
  })

  it('a double promotion is impossible: the second call matches nothing', async () => {
    await seed({ wins: 10, losses: 0, campaigns: 3 })
    await upsert()
    expect(await promote(KEY)).toHaveLength(1)
    expect(await promote(KEY)).toEqual([])
  })

  it("the BELOW mirror: 1 win of 10 (9 below-usual) promotes as 'below', and by symmetry the interval is the direction-matching one", async () => {
    await seed({ wins: 1, losses: 9, campaigns: 3 })
    const belowKey = outcomeKey(DIM, VALUE, 'below', 'linkedin')
    const { data: row } = await upsert('below')
    expect(row).toMatchObject({ outcome_n: 10, outcome_wins: 9, pattern_key: belowKey })
    // low(9, 10) over direction-matching wins == 1 - high(1, 10) over above-wins (the ADR's "high < 0.5" rule).
    const { data: aboveBounds } = await w.admin.rpc('wilson_bounds', { p_wins: 1, p_n: 10, p_z: 1.96 })
    expect(Number(row.interval_low)).toBeCloseTo(1 - Number(aboveBounds[0].high), 3)
    expect((await promote(belowKey))[0].status).toBe('active')
    // ...and the same data as an ABOVE pattern must not promote.
    await upsert('above')
    expect(await promote(KEY)).toEqual([])
  })

  it('n = 4 writes NO row (OUTCOME_PROVISIONAL_N is 5); n = 5 writes a candidate that can never promote', async () => {
    await seed({ wins: 4, losses: 0, campaigns: 3 })
    const { data, error } = await upsert()
    expect(error).toBeNull()
    // PostgREST renders a NULL composite as an all-null object, not null — the TS wrapper keys on id.
    expect(data?.id ?? null).toBeNull()
    const { data: rows } = await w.admin.from('performance_memory').select('id').eq('business_id', w.businessId)
    expect(rows).toEqual([])

    await seed({ wins: 1, losses: 0, campaigns: 1 }) // n is now 5 in the same cell
    const { data: five } = await upsert()
    expect(five).toMatchObject({ status: 'candidate', outcome_n: 5 })
    expect(await promote(KEY)).toEqual([])
  })

  it('a re-upsert refreshes the stats but an ACTIVE row KEEPS its status (and there is still exactly one row)', async () => {
    await seed({ wins: 10, losses: 0, campaigns: 3 })
    await upsert()
    await promote(KEY)
    await seed({ wins: 2, losses: 0, campaigns: 1 })
    const { data: again } = await upsert()
    expect(again).toMatchObject({ status: 'active', outcome_n: 12 })
    const { data: rows } = await w.admin.from('performance_memory').select('id').eq('business_id', w.businessId).eq('pattern_key', KEY)
    expect(rows).toHaveLength(1)
  })

  it('last_confirmed_at is the newest AGREEING observation and expires_at is exactly 90 days later', async () => {
    await seed({ wins: 9, losses: 1, campaigns: 3, daysAgo: (i) => 5 + i })
    const { data: row } = await upsert()
    const last = new Date(row.last_confirmed_at).getTime()
    expect(Math.abs(Date.now() - last - 5 * 86_400_000)).toBeLessThan(60_000) // observation 0 (5 days old) agrees
    expect(new Date(row.expires_at).getTime() - last).toBe(90 * 86_400_000)
  })

  it.each(['hook', 'proof_type', 'topic', 'hypothesis'])(
    "RAISES for dimension '%s' — descriptive-only and unlisted dimensions never become an outcome pattern (at the SQL boundary)",
    async (dimension) => {
      const { error } = await upsert('above', VALUE, dimension)
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/descriptive-only|not a promotable/)
    },
  )

  it('takes NO stats parameters: supplying one is rejected by the function signature', async () => {
    const { error } = await w.admin.rpc('upsert_outcome_performance_pattern', {
      p_business_id: w.businessId, p_dimension: DIM, p_value: VALUE, p_platform: 'linkedin',
      p_direction: 'above', p_pattern_text: 't', p_outcome_n: 999,
    })
    expect(error).not.toBeNull()
  })

  it("promote does not touch another business's row even with its exact key", async () => {
    await seed({ wins: 10, losses: 0, campaigns: 3 })
    await upsert()
    const other = await createWorld('floor-other')
    try {
      const { data } = await other.admin.rpc('promote_outcome_pattern', { p_business_id: other.businessId, p_pattern_key: KEY })
      expect(data ?? []).toEqual([])
      expect((await rowFor(KEY)).status).toBe('candidate')
    } finally {
      await destroyWorld(other)
    }
  })
})
