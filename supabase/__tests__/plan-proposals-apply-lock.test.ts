import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createWorld, createCampaign, destroyWorld, addMember, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.5/§5.6 — Session 34-D D5 (database-reviewer MEDIUM): apply_brief_proposals must not apply a
// proposal a concurrent decide_plan_proposal rejected. decide_plan_proposal does not lock the brief, so without a
// row lock the apply computes the new roleSequence from a snapshot that still shows the proposal 'pending', then
// its flip skips the (now rejected) row — and the brief is written WITH a change the human rejected, while
// acceptedIds omits it. The apply now locks the would-be-accepted proposal rows FOR UPDATE before it computes.
//
// DETERMINISTIC, not a sleep race: a second connection rejects the proposal INSIDE an open transaction; the apply
// is started and must BLOCK on that row lock (it cannot settle while the reject is uncommitted); committing the
// reject releases it, and the apply must then see NOTHING to apply and leave the brief untouched.

const ROLE_SEQ = [
  { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'a0' },
  { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'a1' },
]

describe('apply_brief_proposals serialises with a concurrent decide_plan_proposal (live Postgres)', () => {
  let w: World
  let authorId: string
  let pg: Client

  beforeAll(async () => {
    w = await createWorld('plan-apply-lock')
    authorId = await addMember(w, 'editor')
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
  })

  afterAll(async () => {
    await pg?.query('ROLLBACK').catch(() => undefined)
    await pg?.end()
    await destroyWorld(w)
  })

  it('a proposal rejected concurrently is NOT applied: the apply waits, then finds nothing to apply and changes nothing', async () => {
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, { status: 'critiqued', content: { roleSequence: ROLE_SEQ } })
    const { data: proposal, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (error) throw error

    // The concurrent reject: decided inside a transaction that stays open.
    await pg.query('BEGIN')
    await pg.query('SELECT public.decide_plan_proposal($1, $2, $3, $4)', [w.businessId, proposal.id, authorId, 'rejected'])

    let settled = false
    const applying = Promise.resolve(
      w.admin.rpc('apply_brief_proposals', {
        p_business_id: w.businessId,
        p_brief_id: briefId,
        p_expected_version: 1,
        p_user_id: authorId,
        p_proposal_ids: [proposal.id],
      }),
    ).then((r) => {
      settled = true
      return r
    })

    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(settled, 'the apply completed while a reject of its proposal was still uncommitted — it did not lock the row').toBe(false)

    await pg.query('COMMIT')
    const result = await applying
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('no_proposals_applied')

    const { data: brief } = await w.admin.from('campaign_briefs').select('version, status, content').eq('id', briefId).single()
    expect(brief.version).toBe(1)
    expect(brief.status).toBe('critiqued')
    expect(brief.content.roleSequence).toEqual(ROLE_SEQ)
    const { data: row } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', proposal.id).single()
    expect(row.status).toBe('rejected')
  })
})
