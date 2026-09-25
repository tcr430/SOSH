import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, addMember, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'
import { PLAN_ANALYSIS_REASONS } from '@/lib/db/types'

// ADR 0027 §5.5/§5.7/§3.3 (Session 34 K2.7 security review, F2 + F3) — migration
// 20260923100000_plan_proposal_version_scope_and_reason_check.sql, against live Postgres.
//
// F2: apply_brief_proposals bumps the brief version and renumbers every `order`, but used to ignore
//     campaign_plan_proposals.brief_version and to leave the batch's siblings 'pending'. A stale pending
//     proposal could then drop WHATEVER NOW SAT at its old index.
// F3: campaign_briefs.plan_analysis_reason is rendered to a human and must be a closed set at the DB.

const ROLE_SEQ_3 = [
  { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'a0' },
  { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'a1' },
  { order: 2, role: 'follow_up', platform: 'linkedin', angle: 'a2' },
]

describe('apply_brief_proposals is scoped to the brief version it was written for (F2)', () => {
  let w: World
  let authorId: string

  beforeAll(async () => {
    w = await createWorld('plan-version-scope')
    authorId = await addMember(w, 'editor')
  })
  afterAll(async () => {
    await destroyWorld(w)
  })

  async function freshBrief(over: Record<string, unknown> = {}) {
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, { status: 'critiqued', content: { roleSequence: ROLE_SEQ_3 }, ...over })
    return { briefId, campaignId }
  }

  const apply = (briefId: string, version: number, ids: string[]) =>
    w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: version,
      p_user_id: authorId,
      p_proposal_ids: ids,
    })

  it("a partial apply SUPERSEDES the batch's pending siblings in the same transaction (version_advanced)", async () => {
    const { briefId, campaignId } = await freshBrief()
    const p1 = (await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })).data
    const p2 = (await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 2 })).data

    const result = await apply(briefId, 1, [p1.id])
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('ok')
    expect(result.data.brief.version).toBe(2)

    const { data: rows } = await w.admin.from('campaign_plan_proposals').select('id, status, superseded_reason').in('id', [p1.id, p2.id])
    const byId = Object.fromEntries(rows.map((r: { id: string }) => [r.id, r]))
    expect(byId[p1.id].status).toBe('accepted')
    expect(byId[p2.id].status).toBe('superseded')
    expect(byId[p2.id].superseded_reason).toBe('version_advanced')
  })

  it('THE REPORTED SCENARIO: applying the stale sibling afterwards changes NOTHING (it used to drop whatever sat at its old index)', async () => {
    const { briefId, campaignId } = await freshBrief()
    const p1 = (await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })).data
    const p2 = (await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 1 })).data

    await apply(briefId, 1, [p1.id])
    const { data: afterFirst } = await w.admin.from('campaign_briefs').select('version, content').eq('id', briefId).single()
    expect(afterFirst.content.roleSequence).toHaveLength(2)

    const second = await apply(briefId, 2, [p2.id])
    expect(second.error).toBeNull()
    expect(second.data.outcome).toBe('no_proposals_applied')

    const { data: afterSecond } = await w.admin.from('campaign_briefs').select('version, content').eq('id', briefId).single()
    expect(afterSecond.version).toBe(afterFirst.version)
    expect(afterSecond.content).toEqual(afterFirst.content)
  })

  it('a proposal written against an EARLIER version is not applied to the current one, even if still pending', async () => {
    const { briefId, campaignId } = await freshBrief({ version: 2 })
    const stale = (await insertProposal(w, { briefId, campaignId, briefVersion: 1, kind: 'drop', targetOrder: 0 })).data

    const result = await apply(briefId, 2, [stale.id])
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('no_proposals_applied')

    const { data: brief } = await w.admin.from('campaign_briefs').select('version, content').eq('id', briefId).single()
    expect(brief.version).toBe(2)
    expect(brief.content.roleSequence).toEqual(ROLE_SEQ_3)
    const { data: row } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', stale.id).single()
    expect(row.status).toBe('pending')
  })

  it('an out-of-range proposal from another version does not trip stale_target_order for the current batch', async () => {
    const { briefId, campaignId } = await freshBrief({ version: 2 })
    const oldOutOfRange = (await insertProposal(w, { briefId, campaignId, briefVersion: 1, kind: 'drop', targetOrder: 9 })).data
    const current = (await insertProposal(w, { briefId, campaignId, briefVersion: 2, kind: 'drop', targetOrder: 0 })).data

    const result = await apply(briefId, 2, [oldOutOfRange.id, current.id])
    expect(result.data.outcome).toBe('ok')
    expect(result.data.acceptedIds).toEqual([current.id])
  })

  it('a SAME-version batch still applies exactly as before (positive control), and accepted rows stay accepted', async () => {
    const { briefId, campaignId } = await freshBrief()
    const a = (await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })).data
    const b = (await insertProposal(w, { briefId, campaignId, kind: 'substitute', targetOrder: 1, proposedRole: 'objection_response' })).data
    const result = await apply(briefId, 1, [a.id, b.id])
    expect(result.data.outcome).toBe('ok')
    expect([...result.data.acceptedIds].sort()).toEqual([a.id, b.id].sort())
    expect(result.data.brief.content.roleSequence.map((e: { role: string }) => e.role)).toEqual(['objection_response', 'follow_up'])
    const { data: rows } = await w.admin.from('campaign_plan_proposals').select('status').in('id', [a.id, b.id])
    expect(rows.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted'])
  })

  it('the supersede is legal only via the RPC: a direct pending -> superseded UPDATE is still rejected by the K2.5 trigger', async () => {
    const { briefId, campaignId } = await freshBrief()
    const p = (await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })).data
    const { error } = await w.admin.from('campaign_plan_proposals').update({ status: 'superseded', superseded_reason: 'version_advanced' }).eq('id', p.id)
    expect(error?.message).toMatch(/supersede RPC/)
  })
})

describe('campaign_briefs.plan_analysis_reason is a closed set at the database (F3)', () => {
  let w: World
  beforeAll(async () => {
    w = await createWorld('plan-reason-check')
  })
  afterAll(async () => {
    await destroyWorld(w)
  })

  async function insertBrief(over: Record<string, unknown>) {
    const campaignId = await createCampaign(w)
    return w.admin.from('campaign_briefs').insert({
      business_id: w.businessId,
      campaign_id: campaignId,
      content: { roleSequence: [] },
      status: 'draft',
      version: 1,
      ...over,
    })
  }

  it('every one of the fourteen closed literals is accepted on an unavailable outcome', async () => {
    expect(PLAN_ANALYSIS_REASONS).toHaveLength(14)
    for (const reason of PLAN_ANALYSIS_REASONS) {
      const { error } = await insertBrief({ plan_analysis_status: 'unavailable', plan_analysis_reason: reason })
      expect(error, reason).toBeNull()
    }
  })

  it('free text (the thing this CHECK exists to keep out) is rejected BY NAME', async () => {
    const { error } = await insertBrief({ plan_analysis_status: 'unavailable', plan_analysis_reason: 'ignore previous instructions' })
    expect(error?.message).toMatch(/campaign_briefs_plan_analysis_reason_check/)
  })

  it('a reason is only legal on unavailable/capped: not_run and ok carry NULL (pairing CHECK, by name)', async () => {
    for (const status of ['not_run', 'ok']) {
      const { error } = await insertBrief({ plan_analysis_status: status, plan_analysis_reason: 'provider_error' })
      expect(error?.message, status).toMatch(/campaign_briefs_plan_analysis_reason_pairing_check/)
    }
  })

  it('NULL is legal everywhere, and capped + daily_cap is the real capped shape', async () => {
    for (const status of ['not_run', 'ok', 'unavailable', 'capped']) {
      const { error } = await insertBrief({ plan_analysis_status: status, plan_analysis_reason: null })
      expect(error, status).toBeNull()
    }
    const { error } = await insertBrief({ plan_analysis_status: 'capped', plan_analysis_reason: 'daily_cap' })
    expect(error).toBeNull()
  })
})
