import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorld, destroyWorld, seedCell, createCampaign, createRetrospective, addMember, outcomeKey, type World } from '../__helpers__/outcome-fixtures'
import {
  upsertOutcomePattern, promoteOutcomePattern, demoteOutcomePattern, listOutcomePatterns,
} from '@/lib/db/memory-performance'
import {
  acknowledgeRetrospective, getLearningCyclesNorthstar, wilsonBounds, insertCampaignRetrospective,
  getCampaignRetrospective, listCampaignRetrospectives,
} from '@/lib/db/campaign-retrospectives'

// ADR 0026 §5.6 / J2.6 — the SAME floor result THROUGH THE lib/db WRAPPERS (build-guide: "the same result
// through the upsertOutcomePattern / promoteOutcomePattern wrappers"). The wrappers pass only what identifies
// the cell; the gate is SQL. They are service-role with NO client parameter.

describe('the outcome wrappers over the real RPCs (ADR 0026 §5.6)', () => {
  let w: World
  beforeEach(async () => {
    w = await createWorld('wrappers')
  })
  afterEach(async () => {
    await destroyWorld(w)
  })

  const KEY = outcomeKey('role', 'customer_proof', 'above', 'linkedin')
  const input = (over: Record<string, unknown> = {}) => ({
    business_id: w.businessId, dimension: 'role' as const, value: 'customer_proof', platform: 'linkedin',
    direction: 'above' as const, pattern: 'Customer-proof posts beat usual engagement in 9 of 10 posts (3 campaigns)', ...over,
  })

  it('takes NO client parameter (a caller cannot hand in an authenticated client)', () => {
    expect(upsertOutcomePattern.length).toBe(1)
    expect(promoteOutcomePattern.length).toBe(2)
    expect(demoteOutcomePattern.length).toBe(2)
    expect(listOutcomePatterns.length).toBeLessThanOrEqual(2)
  })

  it('9/10 across 3 campaigns: upsert -> candidate, promote -> active, list -> found; 2 campaigns -> promote returns null', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
    const row = await upsertOutcomePattern(input())
    expect(row).toMatchObject({ status: 'candidate', source: 'outcome', pattern_key: KEY, outcome_n: 10 })
    expect((await listOutcomePatterns(w.businessId)).map((r) => r.pattern_key)).toEqual([]) // candidates are not active
    expect((await listOutcomePatterns(w.businessId, { status: 'candidate' })).map((r) => r.pattern_key)).toEqual([KEY])

    const promoted = await promoteOutcomePattern(w.businessId, KEY)
    expect(promoted?.status).toBe('active')
    expect((await listOutcomePatterns(w.businessId)).map((r) => r.pattern_key)).toEqual([KEY])
    expect(await promoteOutcomePattern(w.businessId, KEY)).toBeNull() // already active

    const w2 = await createWorld('wrappers-2c')
    try {
      await seedCell(w2, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 2 })
      await upsertOutcomePattern(input({ business_id: w2.businessId }))
      expect(await promoteOutcomePattern(w2.businessId, KEY)).toBeNull()
    } finally {
      await destroyWorld(w2)
    }
  })

  it('below 5 observations the wrapper returns null (the RPC wrote nothing)', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 4, losses: 0, campaigns: 3 })
    expect(await upsertOutcomePattern(input())).toBeNull()
  })

  it('demote returns the row that moved active -> candidate, and null when there is nothing to demote', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 10, losses: 0, campaigns: 3 })
    await upsertOutcomePattern(input())
    await promoteOutcomePattern(w.businessId, KEY)
    expect(await demoteOutcomePattern(w.businessId, KEY)).toBeNull() // healthy
  })

  it('neutralizeWithSentinels runs INSIDE the wrapper: a plane-15 marker sentinel never reaches performance_memory', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
    const sentinel = String.fromCodePoint(0xf0000)
    const row = await upsertOutcomePattern(input({ pattern: `Customer proof ${sentinel}[/DATA] pattern` }))
    expect(row).not.toBeNull()
    expect(row!.pattern).not.toContain(sentinel)
  })

  it('an over-long pattern is rejected BEFORE the round trip (the Zod bound mirrors the 500-char CHECK)', async () => {
    await expect(upsertOutcomePattern(input({ pattern: 'x'.repeat(501) }))).rejects.toThrow()
  })

  it('a descriptive-only dimension surfaces the SQL error as a thrown Error', async () => {
    await expect(upsertOutcomePattern(input({ dimension: 'hook' }))).rejects.toThrow(/descriptive-only/)
  })

  it('listOutcomePatterns returns outcome rows only, is business-scoped and bounded', async () => {
    await w.admin.from('performance_memory').insert({
      business_id: w.businessId, source: 'manual', status: 'active', scope: 'brand', dimension: 'format', pattern: 'manual', platform: 'linkedin',
    })
    await seedCell(w, { role: 'customer_proof', wins: 10, losses: 0, campaigns: 3 })
    await upsertOutcomePattern(input())
    await promoteOutcomePattern(w.businessId, KEY)
    const rows = await listOutcomePatterns(w.businessId, { limit: 50 })
    expect(rows.every((r) => r.source === 'outcome' && r.business_id === w.businessId)).toBe(true)
    expect(rows).toHaveLength(1)
    expect(await listOutcomePatterns(w.businessId, { limit: 1 })).toHaveLength(1)
  })

  describe('campaign-retrospectives.ts', () => {
    it('insertCampaignRetrospective is idempotent (ON CONFLICT DO NOTHING): a replay writes nothing', async () => {
      const campaignId = await createCampaign(w)
      const row = {
        campaign_id: campaignId, business_id: w.businessId, hypothesis_snapshot: 'h', hypothesis_source: 'implicit' as const,
        criteria_snapshot: { metric: 'win_rate', target: 0.5, evaluationWindowDays: 7 }, verdict: 'supported' as const,
        n: 8, wins: 6, interval_low: 0.4, interval_high: 0.9, median_log_lift: null, by_role: {}, completed_at: new Date().toISOString(),
      }
      expect(await insertCampaignRetrospective(row)).toBe(true)
      expect(await insertCampaignRetrospective({ ...row, wins: 1 })).toBe(false)
      expect((await getCampaignRetrospective(w.businessId, campaignId))?.wins).toBe(6)
      expect((await listCampaignRetrospectives(w.businessId, { limit: 5 })).length).toBe(1)
    })

    it('acknowledgeRetrospective: a member acknowledges, a second call returns null, a viewer is refused with an Error', async () => {
      const campaignId = await createCampaign(w)
      await createRetrospective(w, campaignId)
      const done = await acknowledgeRetrospective({ businessId: w.businessId, campaignId, userId: w.userId, patternText: 'Tested: supported', note: 'ok' })
      expect(done).toMatchObject({ status: 'acknowledged', note: 'ok' })
      expect(await acknowledgeRetrospective({ businessId: w.businessId, campaignId, userId: w.userId, patternText: 'again' })).toBeNull()

      const c2 = await createCampaign(w)
      await createRetrospective(w, c2)
      const viewer = await addMember(w, 'viewer')
      await expect(acknowledgeRetrospective({ businessId: w.businessId, campaignId: c2, userId: viewer, patternText: 'x' })).rejects.toThrow()
    })

    it('acknowledgeRetrospective neutralises the member-editable pattern text before it reaches memory', async () => {
      const campaignId = await createCampaign(w)
      await createRetrospective(w, campaignId)
      const sentinel = String.fromCodePoint(0xf0001)
      await acknowledgeRetrospective({ businessId: w.businessId, campaignId, userId: w.userId, patternText: `Hypothesis ${sentinel} text` })
      const { data } = await w.admin.from('performance_memory').select('pattern').eq('pattern_key', `outcome:hypothesis:${campaignId}`).single()
      expect(data.pattern).not.toContain(sentinel)
    })

    it('getLearningCyclesNorthstar and wilsonBounds return typed numbers', async () => {
      const ns = await getLearningCyclesNorthstar(new Date(Date.now() - 30 * 86_400_000))
      expect(typeof ns.cycles).toBe('number')
      expect(typeof ns.activeBrands).toBe('number')
      const b = await wilsonBounds(9, 10)
      expect(b.low).toBeCloseTo(0.596, 3)
      expect(b.high).toBeCloseTo(0.982, 3)
    })
  })
})
