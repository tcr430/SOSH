import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.7 (K2.6) — AGENCY-FREEZE-SUPERSEDE-ATOMIC, constraint 34. Approving a brief holding N
// pending proposals -> ZERO pending survive, all N read superseded with
// superseded_reason='brief_frozen' and decided_by NULL; the same for a version bump with
// 'version_advanced'. THE REVIEWER'S OWN WORDS BIND HERE: "if you keep the two-statement form,
// this test is un-writable as an atomic claim" — both RPCs below do the brief UPDATE and the
// supersede UPDATE in ONE transaction, which is exactly what makes this test writable at all.

const ROLE_SEQ = [{ order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'a0' }]

describe('freeze/version-advance supersede (ADR 0027 §5.7, constraint 34, live Postgres)', () => {
  let w: World

  beforeAll(async () => {
    w = await createWorld('plan-freeze-supersede')
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  // campaign_briefs has UNIQUE(campaign_id) — a fresh campaign per brief.
  async function freshBrief(status: string) {
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, { status, content: { roleSequence: ROLE_SEQ } })
    return { briefId, campaignId }
  }

  it('approve_brief_and_supersede_proposals: N pending proposals all supersede with brief_frozen, decided_by NULL', async () => {
    const { briefId, campaignId } = await freshBrief('critiqued')
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const { data, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: i })
      if (error) throw error
      ids.push(data.id)
    }

    const result = await w.admin.rpc('approve_brief_and_supersede_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('ok')
    expect(result.data.brief.status).toBe('approved')
    expect(result.data.brief.frozen_at).not.toBeNull()

    const { data: rows } = await w.admin.from('campaign_plan_proposals').select('status, superseded_reason, decided_by').in('id', ids)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.status).toBe('superseded')
      expect(row.superseded_reason).toBe('brief_frozen')
      expect(row.decided_by).toBeNull()
    }
  })

  it('approve_brief_and_supersede_proposals refuses a non-critiqued brief with a typed outcome', async () => {
    const { briefId } = await freshBrief('draft')
    const result = await w.admin.rpc('approve_brief_and_supersede_proposals', { p_business_id: w.businessId, p_brief_id: briefId })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('invalid_state')
  })

  it('revise_brief_and_supersede_proposals: N pending proposals all supersede with version_advanced, decided_by NULL', async () => {
    const { briefId, campaignId } = await freshBrief('critiqued')
    const ids: string[] = []
    for (let i = 0; i < 2; i += 1) {
      const { data, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: i })
      if (error) throw error
      ids.push(data.id)
    }

    const result = await w.admin.rpc('revise_brief_and_supersede_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 1,
      p_content: { roleSequence: ROLE_SEQ, narrative: 'revised' },
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('ok')
    expect(result.data.brief.version).toBe(2)
    expect(result.data.brief.status).toBe('draft')

    const { data: rows } = await w.admin.from('campaign_plan_proposals').select('status, superseded_reason, decided_by').in('id', ids)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe('superseded')
      expect(row.superseded_reason).toBe('version_advanced')
      expect(row.decided_by).toBeNull()
    }
  })

  it('revise_brief_and_supersede_proposals refuses a stale expected_version with a typed outcome, mutating nothing', async () => {
    const { briefId, campaignId } = await freshBrief('critiqued')
    const { data: proposal, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (error) throw error

    const result = await w.admin.rpc('revise_brief_and_supersede_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 99,
      p_content: { roleSequence: ROLE_SEQ },
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('concurrent_edit')

    const { data: stillPending } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', proposal.id).single()
    expect(stillPending.status).toBe('pending')
  })
})
