import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createWorld, createCampaign, destroyWorld, addMember, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.6 (K2.6) — AGENCY-PROPOSAL-DECIDE-VIA-RPC, constraint 29. No authenticated UPDATE
// grant exists on campaign_plan_proposals (K2.5) — the RPC is the only decide path. The RPC raises
// 42501 without author capability; a viewer is refused; the second actor gets NULL and the real
// current status (already_decided).

describe('decide_plan_proposal capability and already-decided signal (ADR 0027 §5.6, constraint 29, live Postgres)', () => {
  let w: World
  let campaignId: string
  let briefId: string
  let pg: Client

  beforeAll(async () => {
    w = await createWorld('plan-decide-rpc')
    campaignId = await createCampaign(w)
    briefId = await createBrief(w, campaignId)
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
  })

  afterAll(async () => {
    await destroyWorld(w)
    await pg?.end()
  })

  it('no authenticated UPDATE grant exists on campaign_plan_proposals', async () => {
    const { rows } = await pg.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'campaign_plan_proposals' AND grantee = 'authenticated'`,
    )
    expect(rows.map((r) => r.privilege_type)).not.toContain('UPDATE')
  })

  it('the RPC raises 42501 for a user with no membership at all', async () => {
    const { data, error } = await insertProposal(w, { briefId, campaignId, targetOrder: 1 })
    if (error) throw error
    const strangerId = crypto.randomUUID()
    const result = await w.admin.rpc('decide_plan_proposal', {
      p_business_id: w.businessId,
      p_proposal_id: data.id,
      p_user_id: strangerId,
      p_status: 'accepted',
    })
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe('42501')
  })

  it('the RPC raises 42501 for a viewer (member but not editor/approver)', async () => {
    const { data, error } = await insertProposal(w, { briefId, campaignId, targetOrder: 2 })
    if (error) throw error
    const viewerId = await addMember(w, 'viewer')
    const result = await w.admin.rpc('decide_plan_proposal', {
      p_business_id: w.businessId,
      p_proposal_id: data.id,
      p_user_id: viewerId,
      p_status: 'accepted',
    })
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe('42501')
  })

  it('the RPC rejects a p_status other than accepted/rejected (never superseded, never anything else)', async () => {
    const { data, error } = await insertProposal(w, { briefId, campaignId, targetOrder: 3 })
    if (error) throw error
    const approverId = await addMember(w, 'approver')
    const result = await w.admin.rpc('decide_plan_proposal', {
      p_business_id: w.businessId,
      p_proposal_id: data.id,
      p_user_id: approverId,
      p_status: 'superseded',
    })
    expect(result.error).not.toBeNull()
  })

  it('the second actor gets NULL (already_decided) and the real current status is observable', async () => {
    const { data, error } = await insertProposal(w, { briefId, campaignId, targetOrder: 4 })
    if (error) throw error
    const approverId = await addMember(w, 'approver')

    const first = await w.admin.rpc('decide_plan_proposal', {
      p_business_id: w.businessId,
      p_proposal_id: data.id,
      p_user_id: approverId,
      p_status: 'accepted',
    })
    expect(first.error).toBeNull()
    expect(first.data.status).toBe('accepted')

    const second = await w.admin.rpc('decide_plan_proposal', {
      p_business_id: w.businessId,
      p_proposal_id: data.id,
      p_user_id: approverId,
      p_status: 'rejected',
    })
    expect(second.error).toBeNull()
    // PostgREST renders a NULL composite return as an all-null-fields object, not JSON null —
    // key on id (lib/db/campaign-retrospectives.ts#retrospectiveOrNull's established pattern).
    expect(second.data == null || second.data.id == null).toBe(true)

    const { data: current } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', data.id).single()
    expect(current.status).toBe('accepted')
  })
})
