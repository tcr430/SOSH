import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.6 (K2.5) — AGENCY-PROPOSAL-TRANSITION-ATOMIC's LEGALITY half, constraint 30.
// (The concurrency half, AGENCY-PROPOSAL-TRANSITION-ATOMIC constraint 28, lands in K2.6 against
// the real RPC.) Every illegal edge raises; every legal edge passes; each write-once payload
// column raises on change.

async function supersedeViaSessionFlag(id: string) {
  const pg = new Client({ connectionString: process.env.DATABASE_URL })
  await pg.connect()
  try {
    await pg.query('BEGIN')
    await pg.query("SET LOCAL app.plan_proposal_supersede = 'true'")
    await pg.query(
      "UPDATE public.campaign_plan_proposals SET superseded_reason = 'brief_frozen', status = 'superseded' WHERE id = $1",
      [id],
    )
    await pg.query('COMMIT')
  } finally {
    await pg.end()
  }
}

describe('campaign_plan_proposals legality trigger (ADR 0027 §5.6, constraint 30, live Postgres)', () => {
  let w: World
  let campaignId: string
  let briefId: string

  beforeAll(async () => {
    w = await createWorld('plan-transition')
    campaignId = await createCampaign(w)
    briefId = await createBrief(w, campaignId)
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  async function pending(targetOrder: number) {
    const { data, error } = await insertProposal(w, { briefId, campaignId, targetOrder })
    if (error) throw error
    return data
  }

  async function accepted(targetOrder: number) {
    const row = await pending(targetOrder)
    const { data, error } = await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'accepted', decided_by: w.userId, decided_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  it('legal: pending -> accepted, with decided_by/decided_at set', async () => {
    const row = await pending(1)
    const { error } = await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'accepted', decided_by: w.userId, decided_at: new Date().toISOString() })
      .eq('id', row.id)
    expect(error).toBeNull()
  })

  it('legal: pending -> rejected, with decided_by/decided_at set', async () => {
    const row = await pending(2)
    const { error } = await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'rejected', decided_by: w.userId, decided_at: new Date().toISOString() })
      .eq('id', row.id)
    expect(error).toBeNull()
  })

  it('legal: pending -> superseded, ONLY when the session-local supersede flag is set (the K2.6 RPC shape)', async () => {
    const row = await pending(3)
    await supersedeViaSessionFlag(row.id)
    const { data: after } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', row.id).single()
    expect(after.status).toBe('superseded')
  })

  it('illegal: a DIRECT pending -> superseded UPDATE, without the session-local flag, raises (human-written superseded)', async () => {
    const row = await pending(4)
    const { error } = await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'superseded', superseded_reason: 'brief_frozen' })
      .eq('id', row.id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/must go through the supersede RPC/)
  })

  it('illegal: accepted -> pending raises', async () => {
    const row = await accepted(5)
    const { error } = await w.admin.from('campaign_plan_proposals').update({ status: 'pending' }).eq('id', row.id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not permitted/)
  })

  it('illegal: rejected -> accepted raises', async () => {
    const row = await pending(6)
    await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'rejected', decided_by: w.userId, decided_at: new Date().toISOString() })
      .eq('id', row.id)
    const { error } = await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'accepted', decided_by: w.userId, decided_at: new Date().toISOString() })
      .eq('id', row.id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not permitted/)
  })

  it('illegal: superseded -> accepted raises', async () => {
    const row = await pending(7)
    await supersedeViaSessionFlag(row.id)
    const { error } = await w.admin
      .from('campaign_plan_proposals')
      .update({ status: 'accepted', decided_by: w.userId, decided_at: new Date().toISOString() })
      .eq('id', row.id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not permitted/)
  })

  it.each([
    ['reason', { reason: 'changed' }, 101],
    ['kind', { kind: 'request_evidence' }, 102],
    ['target_order', { target_order: 999 }, 103],
    ['brief_id', { brief_id: crypto.randomUUID() }, 104],
    ['brief_version', { brief_version: 2 }, 105],
    ['business_id', { business_id: crypto.randomUUID() }, 106],
    ['planner_run_id', { planner_run_id: crypto.randomUUID() }, 107],
  ] as const)('write-once: changing %s after creation raises', async (_label, patch, targetOrder) => {
    const row = await pending(targetOrder)
    const { error } = await w.admin.from('campaign_plan_proposals').update(patch).eq('id', row.id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/write-once/)
  })

  it('write-once: changing proposed_role/proposed_order after creation raises', async () => {
    const { data: row } = await insertProposal(w, { briefId, campaignId, targetOrder: 500, kind: 'substitute', proposedRole: 'follow_up' })
    const { error } = await w.admin.from('campaign_plan_proposals').update({ proposed_role: 'customer_proof' }).eq('id', row.id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/write-once/)
  })
})
