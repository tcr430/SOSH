import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, addMember, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.6 (K2.6) — AGENCY-PROPOSAL-TRANSITION-ATOMIC, constraint 28. THE REAL TWO-WRITER
// RACE, shaped on signals3-triage-atomic.test.ts. A vitest mock proves the JS branch logic and the
// presence of `.eq('status', expected)` — not that Postgres itself serialises two real concurrent
// callers of decide_plan_proposal to exactly one winner. This closes that gap.

describe('decide_plan_proposal real concurrency (ADR 0027 §5.6, constraint 28, live Postgres)', () => {
  let w: World
  let deciderId: string
  let campaignId: string
  let briefId: string
  let proposalId: string

  beforeAll(async () => {
    w = await createWorld('plan-atomic')
    deciderId = await addMember(w, 'approver')
    campaignId = await createCampaign(w)
    briefId = await createBrief(w, campaignId)
    const { data, error } = await insertProposal(w, { briefId, campaignId })
    if (error) throw error
    proposalId = data.id
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  it('two concurrent decide_plan_proposal calls (accept vs reject, both from pending) — exactly one wins, the loser gets NULL', async () => {
    const [acceptResult, rejectResult] = await Promise.all([
      w.admin.rpc('decide_plan_proposal', {
        p_business_id: w.businessId,
        p_proposal_id: proposalId,
        p_user_id: deciderId,
        p_status: 'accepted',
      }),
      w.admin.rpc('decide_plan_proposal', {
        p_business_id: w.businessId,
        p_proposal_id: proposalId,
        p_user_id: deciderId,
        p_status: 'rejected',
      }),
    ])

    expect(acceptResult.error).toBeNull()
    expect(rejectResult.error).toBeNull()

    // PostgREST renders a NULL composite return as an all-null-fields object, not JSON null —
    // key on id (the same house pattern lib/db/campaign-retrospectives.ts#retrospectiveOrNull
    // uses for the acknowledge_campaign_retrospective precedent this RPC mirrors).
    const won = (r: { data: { id?: string | null } | null }) => r.data != null && r.data.id != null
    const wonCount = [acceptResult, rejectResult].filter(won).length
    const lostCount = [acceptResult, rejectResult].filter((r) => !won(r)).length
    // Real Postgres row-level locking under two genuinely concurrent
    // UPDATE ... WHERE status = 'pending' statements inside decide_plan_proposal: the second to
    // acquire the row's lock evaluates the predicate against the ALREADY-CHANGED row and matches
    // zero rows, returning NULL — the DB itself proving the race, not a hand-supplied mock.
    expect(wonCount).toBe(1)
    expect(lostCount).toBe(1)

    const { data: finalRow } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', proposalId).single()
    expect(['accepted', 'rejected']).toContain(finalRow.status)
  })
})
