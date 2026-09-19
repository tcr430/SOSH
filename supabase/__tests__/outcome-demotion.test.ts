import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorld, destroyWorld, seedCell, createCampaign, seedObservation, outcomeKey, type World } from '../__helpers__/outcome-fixtures'

// ADR 0026 §7 — the Tier-1 half of OUTCOME-CONTRADICTION-DEMOTES-ATOMIC (21) and
// OUTCOME-WINDOWED-DECAY (22); both close in J2.8. Direct RPC calls over seeded outcomes.
//
// A pattern that was true and stopped being true has ACCUMULATED confidence — it is more dangerous
// than one never true. demote_outcome_pattern is ONE conditional UPDATE that recomputes its own
// inputs and demotes active -> candidate (never a delete) when EITHER the window bound stops
// clearing 0.5 OR >= 4 of the cell's last 5 observations go against the direction.

const KEY = outcomeKey('role', 'customer_proof', 'above', 'linkedin')

describe('demotion (ADR 0026 §7.3)', () => {
  let w: World

  beforeEach(async () => {
    w = await createWorld('demote')
  })
  afterEach(async () => {
    await destroyWorld(w)
  })

  const upsert = () =>
    w.admin.rpc('upsert_outcome_performance_pattern', {
      p_business_id: w.businessId, p_dimension: 'role', p_value: 'customer_proof', p_platform: 'linkedin',
      p_direction: 'above', p_pattern_text: 'customer proof pattern',
    })
  const promote = async () => (await w.admin.rpc('promote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: KEY })).data as unknown[]
  const demote = async () => {
    const { data, error } = await w.admin.rpc('demote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: KEY })
    expect(error).toBeNull()
    return data as Array<{ status: string; contradicted_at: string | null }>
  }
  const row = async () => (await w.admin.from('performance_memory').select('*').eq('business_id', w.businessId).eq('pattern_key', KEY).single()).data
  const activate = async () => {
    await upsert()
    expect(await promote()).toHaveLength(1)
  }

  it('a healthy active pattern is NOT demoted (a demote on a healthy cell is a no-op)', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 10, losses: 0, campaigns: 3 })
    await activate()
    expect(await demote()).toEqual([])
    expect((await row()).status).toBe('active')
  })

  it('a WINDOW-BOUND failure demotes (the fast trigger cannot also fire: the newest five are wins)', async () => {
    // 9 of 10 promote. Then 12 OLDER losses land in the window: 9 wins of 22 -> the bound stops clearing 0.5,
    // while the cell's last five observations (the newest) are all wins.
    const campaigns = await seedCell(w, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3, daysAgo: (i) => 5 + i })
    await activate()
    for (let i = 0; i < 12; i += 1) {
      await seedObservation(w, { campaignId: campaigns[i % 3], beat: false, role: 'customer_proof', daysAgo: 40 + i })
    }
    const demoted = await demote()
    expect(demoted).toHaveLength(1)
    expect(demoted[0].status).toBe('candidate')
    expect(demoted[0].contradicted_at).not.toBeNull()
    // history survives: demoted, never deleted
    expect((await row()).status).toBe('candidate')
  })

  it('4 of the last 5 contrary demotes even though the WINDOW still passes (41 wins of 45, low ~0.79)', async () => {
    // Observations 0..3 are the four NEWEST (1..4 days old) and lose; 4 is a win; the rest are old wins.
    await seedCell(w, {
      role: 'customer_proof', wins: 41, losses: 4, campaigns: 4,
      daysAgo: (i) => (i < 5 ? 1 + i : 15 + i),
      beatAt: (i) => i >= 4,
    })
    await activate()
    const demoted = await demote()
    expect(demoted).toHaveLength(1)
    expect(demoted[0].status).toBe('candidate')
    // The window bound alone would NOT have demoted it:
    const { data: stats } = await w.admin.rpc('outcome_cell_stats', {
      p_business_id: w.businessId, p_dimension: 'role', p_value: 'customer_proof', p_platform: 'linkedin', p_direction: 'above',
    })
    expect(Number(stats[0].s_low)).toBeGreaterThan(0.5)
    expect(stats[0]).toMatchObject({ s_l5_n: 5, s_l5_against: 4 })
  })

  it('3 of the last 5 contrary does NOT demote (the boundary of the fast trigger)', async () => {
    await seedCell(w, {
      role: 'customer_proof', wins: 42, losses: 3, campaigns: 4,
      daysAgo: (i) => (i < 5 ? 1 + i : 15 + i),
      beatAt: (i) => i >= 3,
    })
    await activate()
    expect(await demote()).toEqual([])
    expect((await row()).status).toBe('active')
  })

  it('two CONCURRENT demote calls make exactly ONE transition and set contradicted_at once', async () => {
    const campaigns = await seedCell(w, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
    await activate()
    for (let i = 0; i < 12; i += 1) {
      await seedObservation(w, { campaignId: campaigns[i % 3], beat: false, role: 'customer_proof', daysAgo: 40 + i })
    }
    const [a, b] = await Promise.all([demote(), demote()])
    expect(a.length + b.length).toBe(1)
    const stamped = (a[0] ?? b[0]).contradicted_at
    expect((await row()).contradicted_at).toBe(stamped)
    expect(await demote()).toEqual([]) // and a later call changes nothing
    expect((await row()).contradicted_at).toBe(stamped)
  })

  it('observations OLDER than 180 days leave the recompute (they neither count nor keep a pattern alive)', async () => {
    // 5 fresh + 20 old (200 days): the cell is n = 5, not 25.
    await seedCell(w, { role: 'customer_proof', wins: 5, losses: 0, campaigns: 3, daysAgo: (i) => 5 + i })
    await seedCell(w, { role: 'customer_proof', wins: 20, losses: 0, campaigns: 3, daysAgo: (i) => 200 + i })
    const { data } = await upsert()
    expect(data.outcome_n).toBe(5)
  })

  it('an ACTIVE row whose evidence has ALL aged out is demoted (n = 0 -> the bound cannot clear 0.5)', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 12, losses: 0, campaigns: 4, daysAgo: (i) => 200 + i })
    const { error } = await w.admin.from('performance_memory').insert({
      business_id: w.businessId, source: 'outcome', status: 'active', scope: 'platform', scope_ref: 'linkedin',
      dimension: 'role', pattern: 'stale pattern', pattern_key: KEY, platform: 'linkedin', confidence: 0.5, observation_count: 12,
      outcome_n: 12, outcome_wins: 12, outcome_distinct_campaigns: 4, interval_low: 0.75, interval_high: 1, metric_basis: 'count', baseline_seeded: false,
    })
    expect(error).toBeNull()
    expect(await demote()).toHaveLength(1)
  })

  it('RE-PROMOTION only by clearing every gate again: a bound-demoted pattern stays demoted until the evidence supports it', async () => {
    const campaigns = await seedCell(w, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
    await activate()
    for (let i = 0; i < 12; i += 1) {
      await seedObservation(w, { campaignId: campaigns[i % 3], beat: false, role: 'customer_proof', daysAgo: 40 + i })
    }
    await demote()
    await upsert() // refresh the stored stats; the row stays a candidate
    expect((await row()).status).toBe('candidate')
    expect(await promote()).toEqual([]) // 9 of 22 does not clear the bound
    // ...but enough NEW wins clear every gate again, and only then does it promote.
    for (let i = 0; i < 40; i += 1) {
      await seedObservation(w, { campaignId: campaigns[i % 3], beat: true, role: 'customer_proof', daysAgo: 2 + (i % 30) })
    }
    await upsert()
    expect(await promote()).toHaveLength(1)
  })

  it('demote never touches a candidate, and never touches another business', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
    await upsert()
    expect(await demote()).toEqual([]) // a candidate is not active
    const other = await createWorld('demote-other')
    try {
      const { data } = await other.admin.rpc('demote_outcome_pattern', { p_business_id: other.businessId, p_pattern_key: KEY })
      expect(data ?? []).toEqual([])
    } finally {
      await destroyWorld(other)
    }
  })

  it('no demote path exists for a hypothesis row', async () => {
    const campaignId = await createCampaign(w)
    const key = `outcome:hypothesis:${campaignId}`
    await w.admin.from('performance_memory').insert({
      business_id: w.businessId, source: 'outcome', status: 'active', scope: 'campaign', scope_ref: campaignId,
      dimension: 'hypothesis', pattern: 'h', pattern_key: key, confidence: 0.4, observation_count: 8,
      outcome_n: 8, outcome_wins: 6, outcome_distinct_campaigns: 1, interval_low: 0.4, interval_high: 0.9, metric_basis: 'count', baseline_seeded: false,
    })
    const { data } = await w.admin.rpc('demote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: key })
    expect(data ?? []).toEqual([])
  })
})
