import { describe, it, expect, afterEach } from 'vitest'
import { createWorld, destroyWorld, createCampaign, createRetrospective, seedObservation, type World } from '../__helpers__/outcome-fixtures'

// ADR 0026 §8.5 — OUTCOME-NORTHSTAR-COMPUTABLE (26). Tier 1.
// A learning cycle = a retrospective with a supported / not_supported verdict, ACKNOWLEDGED, WITH its
// 'outcome:hypothesis:<campaign_id>' memory row (the write-back happened). Metric = cycles acknowledged
// since p_since / active brands (businesses with >= 1 published post since p_since). The function is a
// GLOBAL aggregate, so these assertions are before/after DELTAS, never absolute counts.

describe('get_learning_cycles_northstar (ADR 0026 §8.5)', () => {
  const worlds: World[] = []
  afterEach(async () => {
    for (const w of worlds.splice(0)) await destroyWorld(w)
  })

  const northstar = async (admin: World['admin'], since: Date) => {
    const { data, error } = await admin.rpc('get_learning_cycles_northstar', { p_since: since.toISOString() })
    expect(error).toBeNull()
    return { cycles: Number(data[0].cycles), brands: Number(data[0].active_brands), ratio: data[0].cycles_per_active_brand as number | null, raw: data[0] }
  }
  const monthAgo = () => new Date(Date.now() - 30 * 86_400_000)

  it('counts ONLY an acknowledged supported/not_supported retrospective whose memory row exists; the denominator is brands with a published post', async () => {
    const w = await createWorld('north')
    worlds.push(w)
    const since = monthAgo()
    const before = await northstar(w.admin, since)

    const ack = (campaignId: string) =>
      w.admin.rpc('acknowledge_campaign_retrospective', {
        p_business_id: w.businessId, p_campaign_id: campaignId, p_user_id: w.userId, p_pattern_text: 'Tested hypothesis: supported',
      })

    // (A) acknowledged SUPPORTED, memory row present -> the ONLY one that counts
    const a = await createCampaign(w)
    await createRetrospective(w, a)
    await seedObservation(w, { campaignId: a, beat: true, daysAgo: 6 }) // makes this business ACTIVE (published in window)
    await ack(a)
    // (B) acknowledged INCONCLUSIVE -> no memory row, no cycle
    const b = await createCampaign(w)
    await createRetrospective(w, b, { verdict: 'inconclusive', n: 2, wins: 1, interval_low: null, interval_high: null })
    await ack(b)
    // (C) SUPPORTED but never acknowledged
    const c = await createCampaign(w)
    await createRetrospective(w, c)
    // (D) acknowledged SUPPORTED, but its memory row is MISSING (write-back never happened)
    const d = await createCampaign(w)
    await createRetrospective(w, d)
    await ack(d)
    await w.admin.from('performance_memory').delete().eq('business_id', w.businessId).eq('pattern_key', `outcome:hypothesis:${d}`)

    const after = await northstar(w.admin, since)
    expect(after.cycles - before.cycles).toBe(1)
    expect(after.brands - before.brands).toBe(1)
    expect(after.ratio).not.toBeNull()
  })

  it('an acknowledgement OLDER than p_since is excluded (the trailing window)', async () => {
    const w = await createWorld('north-window')
    worlds.push(w)
    const c = await createCampaign(w)
    await createRetrospective(w, c)
    await w.admin.rpc('acknowledge_campaign_retrospective', {
      p_business_id: w.businessId, p_campaign_id: c, p_user_id: w.userId, p_pattern_text: 'Tested hypothesis',
    })
    const future = new Date(Date.now() + 60_000)
    const later = await northstar(w.admin, future)
    const now = await northstar(w.admin, monthAgo())
    expect(now.cycles).toBeGreaterThan(later.cycles) // acknowledged_at < future -> excluded there, included here
  })

  it('a brand with only DRAFT / unpublished posts is not an active brand', async () => {
    const w = await createWorld('north-inactive')
    worlds.push(w)
    const since = monthAgo()
    const before = await northstar(w.admin, since)
    const c = await createCampaign(w)
    await w.admin.from('posts').insert({
      campaign_id: c, business_id: w.businessId, platform: 'linkedin', content: 'draft', hashtags: [],
      scheduled_at: new Date().toISOString(), status: 'draft',
    })
    const after = await northstar(w.admin, since)
    expect(after.brands).toBe(before.brands)
  })

  it('returns AGGREGATES ONLY — no row, identifier or text', async () => {
    const w = await createWorld('north-shape')
    worlds.push(w)
    const { raw } = await northstar(w.admin, monthAgo())
    expect(Object.keys(raw).sort()).toEqual(['active_brands', 'cycles', 'cycles_per_active_brand'])
  })

  it('the ratio is cycles / active brands, and null (not a division error) when no brand is active', async () => {
    const w = await createWorld('north-ratio')
    worlds.push(w)
    const farFuture = await northstar(w.admin, new Date(Date.now() + 365 * 86_400_000))
    expect(farFuture.brands).toBe(0)
    expect(farFuture.ratio).toBeNull()
  })
})
