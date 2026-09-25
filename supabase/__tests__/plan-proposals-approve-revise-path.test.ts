import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.7 — AGENCY-FREEZE-SUPERSEDE-ATOMIC on the PRODUCTION path (Session 34-D D4, BLOCKER-1).
// plan-proposals-freeze-supersede.test.ts calls the RPCs directly through w.admin.rpc(...) and so proves a
// function the product never ran. THIS file goes through what the product actually calls:
//   - approveBriefIfQualified (lib/campaigns/brief.ts) — the real hard gate, then the approve wrapper;
//   - reviseBriefAndSupersedeProposals (lib/db/campaign-briefs.ts) — the wrapper rejectBriefAction and
//     editBriefAction call.
// Restore the old PostgREST UPDATE in approveBriefIfQualified and the first test goes RED (proposals stay
// pending) — that is the reddening D4 records.

const ROLE_SEQ = [{ order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'a0' }]
// freezeBrief deep-freezes the whole content, so the fixture carries every field a real brief does.
const CONTENT = { narrative: 'n', proofPlan: 'p', pinnedEvidence: [], roleSequence: ROLE_SEQ }

describe('approve / revise supersede pending proposals through the production functions (ADR 0027 §5.7, live Postgres)', () => {
  let w: World

  beforeAll(async () => {
    w = await createWorld('plan-approve-revise-path')
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  async function critiquedBrief(overallScore: number, pending: number) {
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, {
      status: 'critiqued',
      overall_score: overallScore,
      critique: { critique: ['fixture'] },
      content: CONTENT,
    })
    const proposalIds: string[] = []
    for (let i = 0; i < pending; i += 1) {
      const { data, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: i })
      if (error) throw error
      proposalIds.push(data.id)
    }
    return { campaignId, briefId, proposalIds }
  }

  async function proposalRows(ids: string[]) {
    const { data } = await w.admin.from('campaign_plan_proposals').select('status, superseded_reason, decided_by').in('id', ids)
    return data as Array<{ status: string; superseded_reason: string | null; decided_by: string | null }>
  }

  it('approveBriefIfQualified: an above-threshold critiqued brief is approved and frozen, and BOTH pending proposals supersede brief_frozen', async () => {
    const { approveBriefIfQualified } = await import('@/lib/campaigns/brief')
    const { campaignId, briefId, proposalIds } = await critiquedBrief(85, 2)

    const result = await approveBriefIfQualified(campaignId)
    expect(result.approved).toBe(true)

    const { data: brief } = await w.admin.from('campaign_briefs').select('status, frozen_at').eq('id', briefId).single()
    expect(brief.status).toBe('approved')
    expect(brief.frozen_at).not.toBeNull()

    const rows = await proposalRows(proposalIds)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe('superseded')
      expect(row.superseded_reason).toBe('brief_frozen')
      expect(row.decided_by).toBeNull()
    }
  })

  it('approveBriefIfQualified: a below-threshold brief is refused before any write — it stays critiqued, proposals stay pending', async () => {
    const { approveBriefIfQualified } = await import('@/lib/campaigns/brief')
    const { campaignId, briefId, proposalIds } = await critiquedBrief(60, 1)

    const result = await approveBriefIfQualified(campaignId)
    expect(result.approved).toBe(false)

    const { data: brief } = await w.admin.from('campaign_briefs').select('status, frozen_at').eq('id', briefId).single()
    expect(brief.status).toBe('critiqued')
    expect(brief.frozen_at).toBeNull()
    expect((await proposalRows(proposalIds))[0].status).toBe('pending')
  })

  it('reviseBriefAndSupersedeProposals: pending proposals at version N supersede version_advanced and the brief is at N+1', async () => {
    const { reviseBriefAndSupersedeProposals } = await import('@/lib/db/campaign-briefs')
    const { briefId, proposalIds } = await critiquedBrief(85, 2)

    const revised = await reviseBriefAndSupersedeProposals(w.businessId, briefId, 1, CONTENT as never)
    expect(revised).not.toBeNull()
    expect(revised?.version).toBe(2)
    expect(revised?.status).toBe('draft')

    const rows = await proposalRows(proposalIds)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.status).toBe('superseded')
      expect(row.superseded_reason).toBe('version_advanced')
      expect(row.decided_by).toBeNull()
    }
  })

  it('reviseBriefAndSupersedeProposals: a STALE expectedVersion returns null and supersedes nothing', async () => {
    const { reviseBriefAndSupersedeProposals } = await import('@/lib/db/campaign-briefs')
    const { briefId, proposalIds } = await critiquedBrief(85, 2)

    const result = await reviseBriefAndSupersedeProposals(w.businessId, briefId, 7, CONTENT as never)
    expect(result).toBeNull()

    const { data: brief } = await w.admin.from('campaign_briefs').select('status, version').eq('id', briefId).single()
    expect(brief.status).toBe('critiqued')
    expect(brief.version).toBe(1)
    for (const row of await proposalRows(proposalIds)) expect(row.status).toBe('pending')
  })
})
