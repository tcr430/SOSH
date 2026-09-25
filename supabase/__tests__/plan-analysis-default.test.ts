import { describe, it, expect, afterEach } from 'vitest'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'

// ADR 0027 §3.3 (K2.5) — AGENCY-PLAN-STATUS-DEFAULT-NOT-OK, constraint 15. THE DEFAULT IS
// 'not_run', NEVER 'ok'. If the default were 'ok', every row written by any existing or future
// path would masquerade as successfully analysed — the single highest-value assertion in this
// migration.

describe("campaign_briefs.plan_analysis_status defaults to 'not_run' (ADR 0027 §3.3, constraint 15, live Postgres)", () => {
  let w: World | undefined

  afterEach(async () => {
    await destroyWorld(w)
    w = undefined
  })

  it('a brief inserted via the existing (pre-K2.5) column set defaults to not_run, never ok', async () => {
    w = await createWorld('plan-analysis-default')
    const campaignId = await createCampaign(w)
    const { data, error } = await w.admin
      .from('campaign_briefs')
      .insert({
        business_id: w.businessId,
        campaign_id: campaignId,
        content: { roleSequence: [] },
        status: 'draft',
        version: 1,
      })
      .select('plan_analysis_status, plan_analysis_reason')
      .single()
    expect(error).toBeNull()
    expect(data.plan_analysis_status).toBe('not_run')
    expect(data.plan_analysis_reason).toBeNull()
  })

  it('the CHECK pins the vocabulary — an out-of-vocabulary value is rejected, by name', async () => {
    w = await createWorld('plan-analysis-vocab')
    const campaignId = await createCampaign(w)
    const { error } = await w.admin.from('campaign_briefs').insert({
      business_id: w.businessId,
      campaign_id: campaignId,
      content: { roleSequence: [] },
      status: 'draft',
      version: 1,
      plan_analysis_status: 'bogus',
    })
    expect(error?.message).toMatch(/campaign_briefs_plan_analysis_status_check/)
  })

  it('every real value in the vocabulary is accepted', async () => {
    w = await createWorld('plan-analysis-values')
    for (const status of ['not_run', 'ok', 'unavailable', 'capped']) {
      const campaignId = await createCampaign(w)
      const { error } = await w.admin.from('campaign_briefs').insert({
        business_id: w.businessId,
        campaign_id: campaignId,
        content: { roleSequence: [] },
        status: 'draft',
        version: 1,
        plan_analysis_status: status,
      })
      expect(error, status).toBeNull()
    }
  })
})
