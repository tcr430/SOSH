import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal, proposalRow } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §9.1 (K2.5) — AGENCY-PROPOSAL-ROLE-VOCABULARY (31) and AGENCY-PROPOSAL-PROVENANCE (32):
// every CHECK by name.

describe('campaign_plan_proposals CHECK constraints (ADR 0027 §9.1, constraints 31/32, live Postgres)', () => {
  let w: World
  let campaignId: string
  let briefId: string

  beforeAll(async () => {
    w = await createWorld('plan-constraints')
    campaignId = await createCampaign(w)
    briefId = await createBrief(w, campaignId)
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  it('kind CHECK: an out-of-vocabulary kind is rejected, by name', async () => {
    const { error } = await w.admin
      .from('campaign_plan_proposals')
      .insert({ ...proposalRow(w, { briefId, campaignId }), kind: 'bogus' })
    expect(error?.message).toMatch(/campaign_plan_proposals_kind_check/)
  })

  it('status CHECK: an out-of-vocabulary status is rejected, by name', async () => {
    const { error } = await w.admin
      .from('campaign_plan_proposals')
      .insert({ ...proposalRow(w, { briefId, campaignId }), status: 'bogus' })
    expect(error?.message).toMatch(/campaign_plan_proposals_status_check/)
  })

  it('per-kind payload CHECK: substitute WITHOUT proposed_role is rejected', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, kind: 'substitute', targetOrder: 1 })
    expect(error?.message).toMatch(/campaign_plan_proposals_payload_shape_check/)
  })

  it('per-kind payload CHECK: substitute WITH proposed_order is rejected', async () => {
    const { error } = await insertProposal(w, {
      briefId, campaignId, kind: 'substitute', targetOrder: 1, proposedRole: 'follow_up', proposedOrder: 2,
    })
    expect(error?.message).toMatch(/campaign_plan_proposals_payload_shape_check/)
  })

  it('per-kind payload CHECK: substitute WITH proposed_role only is accepted', async () => {
    const { error } = await insertProposal(w, {
      briefId, campaignId, kind: 'substitute', targetOrder: 1, proposedRole: 'follow_up',
    })
    expect(error).toBeNull()
  })

  it('per-kind payload CHECK: drop WITH a proposed_order is rejected', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 2, proposedOrder: 0 })
    expect(error?.message).toMatch(/campaign_plan_proposals_payload_shape_check/)
  })

  it('per-kind payload CHECK: reorder WITHOUT proposed_order is rejected', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, kind: 'reorder', targetOrder: 3 })
    expect(error?.message).toMatch(/campaign_plan_proposals_payload_shape_check/)
  })

  it('per-kind payload CHECK: reorder WITH proposed_order only is accepted', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, kind: 'reorder', targetOrder: 3, proposedOrder: 0 })
    expect(error).toBeNull()
  })

  it('proposed_role CHECK: restricted to the posts_role_check six-value vocabulary', async () => {
    const { error } = await insertProposal(w, {
      briefId, campaignId, kind: 'substitute', targetOrder: 4, proposedRole: 'bogus_role',
    })
    expect(error?.message).toMatch(/campaign_plan_proposals_proposed_role_check/)
  })

  it('proposed_role CHECK: every one of the six real values is accepted', async () => {
    const roles = ['anchor_thesis', 'founder_perspective', 'customer_proof', 'objection_response', 'conversation_starter', 'follow_up']
    for (const [i, role] of roles.entries()) {
      const { error } = await insertProposal(w, { briefId, campaignId, kind: 'substitute', targetOrder: 10 + i, proposedRole: role })
      expect(error, role).toBeNull()
    }
  })

  it('target_order CHECK: negative is rejected', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, targetOrder: -1 })
    expect(error).not.toBeNull()
  })

  it('reason CHECK: the empty string is rejected (NOT NULL alone does not exclude it)', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, targetOrder: 5, reason: '' })
    expect(error?.message).toMatch(/campaign_plan_proposals_reason_length_check/)
  })

  it('reason CHECK: over 1000 chars is rejected', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, targetOrder: 6, reason: 'x'.repeat(1001) })
    expect(error?.message).toMatch(/campaign_plan_proposals_reason_length_check/)
  })

  it('planner_run_id and model are NOT NULL', async () => {
    const row = proposalRow(w, { briefId, campaignId, targetOrder: 7 })
    delete (row as Record<string, unknown>).planner_run_id
    const { error } = await w.admin.from('campaign_plan_proposals').insert(row)
    expect(error).not.toBeNull()

    const row2 = proposalRow(w, { briefId, campaignId, targetOrder: 8 })
    delete (row2 as Record<string, unknown>).model
    const { error: error2 } = await w.admin.from('campaign_plan_proposals').insert(row2)
    expect(error2).not.toBeNull()
  })

  it('decided_at/status pairing CHECK: a pending row carrying decided_at is rejected', async () => {
    const { error } = await insertProposal(w, { briefId, campaignId, targetOrder: 9, decidedAt: new Date().toISOString() })
    expect(error?.message).toMatch(/campaign_plan_proposals_decided_pairing_check/)
  })

  it('the partial UNIQUE: a second PENDING duplicate at the same slot is rejected', async () => {
    const first = await insertProposal(w, { briefId, campaignId, targetOrder: 20 })
    expect(first.error).toBeNull()
    const second = await insertProposal(w, { briefId, campaignId, targetOrder: 20 })
    expect(second.error?.message).toMatch(/campaign_plan_proposals_pending_slot_uq/)
  })

  it('the partial UNIQUE: a new pending row is permitted once the first is accepted', async () => {
    const first = await insertProposal(w, { briefId, campaignId, targetOrder: 21 })
    expect(first.error).toBeNull()
    const { error: acceptErr } = await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'accepted', decided_by: w.userId, decided_at: new Date().toISOString() })
      .eq('id', first.data.id)
    expect(acceptErr).toBeNull()

    const second = await insertProposal(w, { briefId, campaignId, targetOrder: 21 })
    expect(second.error).toBeNull()
  })
})
