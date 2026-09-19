import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorld, destroyWorld, createCampaign, createRetrospective, addMember, seedObservation, type World } from '../__helpers__/outcome-fixtures'

// ADR 0026 §8.4 — the Tier-1 half of OUTCOME-RETROSPECTIVE-WRITES-BACK (25); closes in J2.11 with the
// action. acknowledge_campaign_retrospective is the ADR 0025 ratify shape: p_user_id is checked against
// business_members (active, non-viewer); one conditional UPDATE moves completed -> acknowledged; a
// supported / not_supported verdict writes EXACTLY ONE governed row; a second call is a no-op.

const NOT_A_MEMBER = '42501'

describe('acknowledge_campaign_retrospective (ADR 0026 §8.4)', () => {
  let w: World

  beforeEach(async () => {
    w = await createWorld('retro')
  })
  afterEach(async () => {
    await destroyWorld(w)
  })

  const ack = (campaignId: string, userId: string, text: string | null = 'Campaign tested: posts beat usual engagement in 8 of 10 (interval 0.49-0.94)', note: string | null = null) =>
    w.admin.rpc('acknowledge_campaign_retrospective', {
      p_business_id: w.businessId, p_campaign_id: campaignId, p_user_id: userId, p_pattern_text: text, p_note: note,
    })
  const memoryRows = async (campaignId: string) =>
    (await w.admin.from('performance_memory').select('*').eq('business_id', w.businessId).eq('pattern_key', `outcome:hypothesis:${campaignId}`)).data as Array<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
  const retro = async (campaignId: string) =>
    (await w.admin.from('campaign_retrospectives').select('*').eq('campaign_id', campaignId).single()).data

  it.each([
    ['a non-member', async () => '00000000-0000-4000-8000-00000000abcd'],
    ['a viewer', async () => addMember(w, 'viewer')],
    ['a REVOKED editor', async () => addMember(w, 'editor', 'revoked')],
  ])('refuses %s (42501) and changes nothing', async (_label, makeUser) => {
    const campaignId = await createCampaign(w)
    await createRetrospective(w, campaignId)
    const { error } = await ack(campaignId, await makeUser())
    expect(error).not.toBeNull()
    expect(error!.code).toBe(NOT_A_MEMBER)
    expect((await retro(campaignId)).status).toBe('completed')
    expect(await memoryRows(campaignId)).toEqual([])
  })

  it('an editor and the owner (an approver) may acknowledge', async () => {
    const editor = await addMember(w, 'editor')
    const c1 = await createCampaign(w)
    await createRetrospective(w, c1)
    expect((await ack(c1, editor)).error).toBeNull()
    const c2 = await createCampaign(w)
    await createRetrospective(w, c2)
    expect((await ack(c2, w.userId)).error).toBeNull()
  })

  it("a SUPPORTED acknowledgement writes exactly ONE governed row with ADR 0026 §8.4's values", async () => {
    const campaignId = await createCampaign(w)
    const completedAt = new Date(Date.now() - 3 * 86_400_000).toISOString()
    await createRetrospective(w, campaignId, { verdict: 'supported', n: 10, wins: 8, completed_at: completedAt })
    // rate-basis outcomes for this campaign, one seeded from the import baseline
    await seedObservation(w, { campaignId, beat: true, basis: 'rate', daysAgo: 4 })
    await seedObservation(w, { campaignId, beat: true, basis: 'rate', baselineSource: 'import_seed', daysAgo: 5 })

    const text = "Campaign 'Q3 launch' tested: 'posts beat usual engagement'. Result: supported — 8 of 10 posts beat this brand's usual engagement (interval 0.49–0.94)."
    const { data, error } = await ack(campaignId, w.userId, text, 'Reviewed with the team')
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'acknowledged', acknowledged_by: w.userId, note: 'Reviewed with the team' })
    expect(data.acknowledged_at).not.toBeNull()

    const rows = await memoryRows(campaignId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'outcome', dimension: 'hypothesis', scope: 'campaign', scope_ref: campaignId,
      status: 'active', sensitivity: 'internal', public_use_permission: false, platform: null,
      pattern: text, outcome_n: 10, outcome_wins: 8, outcome_distinct_campaigns: 1,
      metric_basis: 'rate', baseline_seeded: true,
    })
    expect(new Date(rows[0].last_confirmed_at).getTime()).toBe(new Date(completedAt).getTime())
    expect(new Date(rows[0].expires_at).getTime() - new Date(completedAt).getTime()).toBe(365 * 86_400_000)
    expect(Number(rows[0].confidence)).toBeGreaterThan(0)
    expect(Number(rows[0].interval_low)).toBeCloseTo(0.49, 2) // "stats from the retrospective"
  })

  it('a SECOND call is a no-op: nothing changes and no second row is written', async () => {
    const campaignId = await createCampaign(w)
    await createRetrospective(w, campaignId)
    const first = await ack(campaignId, w.userId)
    expect(first.data.status).toBe('acknowledged')
    const stamped = (await retro(campaignId)).acknowledged_at
    const second = await ack(campaignId, w.userId, 'a different text', 'a different note')
    expect(second.error).toBeNull()
    expect(second.data?.id ?? null).toBeNull()
    expect((await retro(campaignId)).acknowledged_at).toBe(stamped)
    expect(await memoryRows(campaignId)).toHaveLength(1)
  })

  it('an INCONCLUSIVE acknowledgement writes NO memory row (it is acknowledged, but nothing was learned)', async () => {
    const campaignId = await createCampaign(w)
    await createRetrospective(w, campaignId, { verdict: 'inconclusive', n: 3, wins: 2, interval_low: null, interval_high: null })
    const { data, error } = await ack(campaignId, w.userId, null)
    expect(error).toBeNull()
    expect(data.status).toBe('acknowledged')
    expect(await memoryRows(campaignId)).toEqual([])
  })

  it('a NOT_SUPPORTED verdict is also recorded (a disproved hypothesis is a learning too)', async () => {
    const campaignId = await createCampaign(w)
    await createRetrospective(w, campaignId, { verdict: 'not_supported', n: 10, wins: 2, interval_low: 0.06, interval_high: 0.51 })
    expect((await ack(campaignId, w.userId, 'Tested: not supported')).error).toBeNull()
    const rows = await memoryRows(campaignId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome_wins: 2, status: 'active' })
  })

  it('a supported verdict WITHOUT pattern text raises and the acknowledgement is rolled back (atomic)', async () => {
    const campaignId = await createCampaign(w)
    await createRetrospective(w, campaignId)
    const { error } = await ack(campaignId, w.userId, '   ')
    expect(error).not.toBeNull()
    expect((await retro(campaignId)).status).toBe('completed')
    expect(await memoryRows(campaignId)).toEqual([])
  })

  it("cannot acknowledge another business's retrospective: with the wrong business id the call matches nothing", async () => {
    const other = await createWorld('retro-other')
    try {
      const campaignId = await createCampaign(other)
      await createRetrospective(other, campaignId)
      const { data, error } = await ack(campaignId, w.userId) // w's member, w's business id, other's campaign
      expect(error).toBeNull()
      expect(data?.id ?? null).toBeNull()
      const { data: still } = await other.admin.from('campaign_retrospectives').select('status').eq('campaign_id', campaignId).single()
      expect(still.status).toBe('completed')
    } finally {
      await destroyWorld(other)
    }
  })
})
