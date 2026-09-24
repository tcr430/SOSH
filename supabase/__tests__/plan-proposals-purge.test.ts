import { describe, it, expect } from 'vitest'
import { createWorld, createCampaign, addMember, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §9.3 (K2.5) — AGENCY-CASCADE-COMPLETE, constraint 46. BOTH erasure paths (the root
// DELETE FROM public.businesses AND the purge_business RPC, the Session 30-G1b.1 precedent), and
// separately: deleting the auth.users row leaves decided_by NULL and the proposal INTACT — the
// executable proof of §9.3's claim.

describe('campaign_plan_proposals GDPR cascade (ADR 0027 §9.3, constraint 46, live Postgres)', () => {
  it('the root DELETE FROM public.businesses cascades to campaign_plan_proposals', async () => {
    const w = await createWorld('plan-purge-root')
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId)
    const { data: row, error } = await insertProposal(w, { briefId, campaignId })
    if (error) throw error

    await w.admin.from('businesses').delete().eq('id', w.businessId)

    const { data: after } = await w.admin.from('campaign_plan_proposals').select('id').eq('id', row.id)
    expect(after ?? []).toHaveLength(0)

    await w.admin.auth.admin.deleteUser(w.userId)
  })

  it('the purge_business RPC cascades to campaign_plan_proposals', async () => {
    const w = await createWorld('plan-purge-rpc')
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId)
    const { data: row, error } = await insertProposal(w, { briefId, campaignId })
    if (error) throw error

    const { error: purgeErr } = await w.admin.rpc('purge_business', { p_business_id: w.businessId })
    expect(purgeErr).toBeNull()

    const { data: after } = await w.admin.from('campaign_plan_proposals').select('id').eq('id', row.id)
    expect(after ?? []).toHaveLength(0)

    await w.admin.auth.admin.deleteUser(w.userId)
  })

  it('deleting the deciding auth.users row leaves decided_by NULL and the proposal INTACT (SET NULL, not CASCADE)', async () => {
    const w: World = await createWorld('plan-purge-decider')
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId)
    const { data: row, error } = await insertProposal(w, { briefId, campaignId })
    if (error) throw error

    // The DECIDER must be a distinct user from the business OWNER (w.userId): businesses.owner_id
    // is ON DELETE RESTRICT (ADR 0010 §D2.5 header), so deleting the owner would fail the FK, not
    // exercise decided_by's SET NULL at all. addMember creates a second, deletable auth user.
    const deciderId = await addMember(w, 'approver')
    await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'accepted', decided_by: deciderId, decided_at: new Date().toISOString() })
      .eq('id', row.id)

    const { error: deleteErr } = await w.admin.auth.admin.deleteUser(deciderId)
    expect(deleteErr).toBeNull()

    const { data: after, error: afterErr } = await w.admin
      .from('campaign_plan_proposals')
      .select('id, decided_by, status')
      .eq('id', row.id)
      .single()
    expect(afterErr).toBeNull()
    expect(after.decided_by).toBeNull()
    expect(after.status).toBe('accepted')

    // w.extraUserIds still lists deciderId (already deleted above) — destroyWorld's own deleteUser
    // loop for it will error; clean up the business directly instead of calling destroyWorld.
    await w.admin.from('businesses').delete().eq('id', w.businessId)
    await w.admin.auth.admin.deleteUser(w.userId)
  })
})
