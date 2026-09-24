import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, addMember, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.5 (K2.6) — apply_brief_proposals: expected_version mismatch returns zero rows and
// mutates NOTHING; a frozen brief is refused with a TYPED OUTCOME, not a trigger exception; a
// target_order past the end of roleSequence is refused; two concurrent overlapping ratifications
// -> exactly one applies.

const ROLE_SEQ = [
  { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'a0' },
  { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'a1' },
]

describe('apply_brief_proposals (ADR 0027 §5.5, live Postgres)', () => {
  let w: World
  let authorId: string

  beforeAll(async () => {
    w = await createWorld('plan-ratify')
    authorId = await addMember(w, 'editor')
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  // campaign_briefs has UNIQUE(campaign_id) — a fresh campaign per brief, not a shared one, or
  // every second createBrief() call in this file collides on that constraint.
  async function freshBrief(status = 'critiqued') {
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, { status, content: { roleSequence: ROLE_SEQ } })
    return { briefId, campaignId }
  }

  it('expected_version mismatch returns a typed concurrent_edit outcome and mutates NOTHING', async () => {
    const { briefId, campaignId } = await freshBrief()
    const { data: proposal, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (error) throw error

    const result = await w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 99,
      p_user_id: authorId,
      p_proposal_ids: [proposal.id],
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('concurrent_edit')

    const { data: stillPending } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', proposal.id).single()
    expect(stillPending.status).toBe('pending')
    const { data: unchangedBrief } = await w.admin.from('campaign_briefs').select('version, content').eq('id', briefId).single()
    expect(unchangedBrief.version).toBe(1)
  })

  it('a frozen brief is refused with a TYPED outcome, not a raised exception', async () => {
    const { briefId, campaignId } = await freshBrief('approved')
    await w.admin.from('campaign_briefs').update({ frozen_at: new Date().toISOString() }).eq('id', briefId)
    const { data: proposal, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (error) throw error

    const result = await w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 1,
      p_user_id: authorId,
      p_proposal_ids: [proposal.id],
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('frozen')
  })

  it('a target_order past the end of roleSequence is refused with a typed outcome', async () => {
    const { briefId, campaignId } = await freshBrief()
    const { data: proposal, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 5 })
    if (error) throw error

    const result = await w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 1,
      p_user_id: authorId,
      p_proposal_ids: [proposal.id],
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('stale_target_order')
    expect(result.data.proposalId).toBe(proposal.id)
  })

  // database-reviewer finding (K2.6 pre-commit review, MAJOR): a 'drop' and a 'substitute' at the
  // same target_order, both accepted in one batch, would otherwise silently record "accepted" on
  // the substitute despite the array-rebuild's drop-wins semantics discarding its effect.
  it('a drop and a substitute at the SAME target_order in one batch is refused as conflicting_proposals, mutating nothing', async () => {
    const { briefId, campaignId } = await freshBrief()
    const { data: dropProposal, error: e1 } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (e1) throw e1
    const { data: subProposal, error: e2 } = await insertProposal(w, {
      briefId, campaignId, kind: 'substitute', targetOrder: 0, proposedRole: 'follow_up',
    })
    if (e2) throw e2

    const result = await w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 1,
      p_user_id: authorId,
      p_proposal_ids: [dropProposal.id, subProposal.id],
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('conflicting_proposals')

    const { data: rows } = await w.admin.from('campaign_plan_proposals').select('status').in('id', [dropProposal.id, subProposal.id])
    for (const row of rows) expect(row.status).toBe('pending')
    const { data: unchangedBrief } = await w.admin.from('campaign_briefs').select('version').eq('id', briefId).single()
    expect(unchangedBrief.version).toBe(1)
  })

  // database-reviewer finding (K2.6 pre-commit review, MODERATE): a batch where every id is
  // already stale (decided by a concurrent caller) must not silently succeed and bump version with
  // an unchanged roleSequence.
  it('a batch where every proposal id is already decided returns no_proposals_applied, without bumping version', async () => {
    const { briefId, campaignId } = await freshBrief()
    const { data: proposal, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (error) throw error
    await w.admin.from('campaign_plan_proposals').update({ status: 'rejected', decided_by: authorId, decided_at: new Date().toISOString() }).eq('id', proposal.id)

    const result = await w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 1,
      p_user_id: authorId,
      p_proposal_ids: [proposal.id],
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('no_proposals_applied')

    const { data: unchangedBrief } = await w.admin.from('campaign_briefs').select('version').eq('id', briefId).single()
    expect(unchangedBrief.version).toBe(1)
  })

  it('a successful apply flips the proposal to accepted, bumps version, resets status to draft', async () => {
    const { briefId, campaignId } = await freshBrief()
    const { data: proposal, error } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (error) throw error

    const result = await w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 1,
      p_user_id: authorId,
      p_proposal_ids: [proposal.id],
    })
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('ok')
    expect(result.data.brief.version).toBe(2)
    expect(result.data.brief.status).toBe('draft')
    expect(result.data.brief.content.roleSequence).toHaveLength(1)

    const { data: decided } = await w.admin.from('campaign_plan_proposals').select('status, decided_by').eq('id', proposal.id).single()
    expect(decided.status).toBe('accepted')
    expect(decided.decided_by).toBe(authorId)
  })

  it('two concurrent overlapping ratifications on the SAME brief — exactly one applies', async () => {
    const { briefId, campaignId } = await freshBrief()
    const { data: p1, error: e1 } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 0 })
    if (e1) throw e1
    const { data: p2, error: e2 } = await insertProposal(w, { briefId, campaignId, kind: 'drop', targetOrder: 1 })
    if (e2) throw e2

    const [r1, r2] = await Promise.all([
      w.admin.rpc('apply_brief_proposals', {
        p_business_id: w.businessId, p_brief_id: briefId, p_expected_version: 1, p_user_id: authorId, p_proposal_ids: [p1.id],
      }),
      w.admin.rpc('apply_brief_proposals', {
        p_business_id: w.businessId, p_brief_id: briefId, p_expected_version: 1, p_user_id: authorId, p_proposal_ids: [p2.id],
      }),
    ])
    expect(r1.error).toBeNull()
    expect(r2.error).toBeNull()

    const outcomes = [r1.data.outcome, r2.data.outcome]
    const okCount = outcomes.filter((o) => o === 'ok').length
    const concurrentCount = outcomes.filter((o) => o === 'concurrent_edit').length
    // The FOR UPDATE lock in apply_brief_proposals serialises the two callers: the first to
    // acquire the lock commits version 1 -> 2; the second, now holding a stale p_expected_version
    // against the ALREADY-BUMPED row, gets the typed concurrent_edit outcome — real Postgres
    // locking, not a hand-supplied mock response.
    expect(okCount).toBe(1)
    expect(concurrentCount).toBe(1)

    const { data: finalBrief } = await w.admin.from('campaign_briefs').select('version').eq('id', briefId).single()
    expect(finalBrief.version).toBe(2)
  })
})

// ═══ AGENCY-REORDER-RATIFIED-EXACT (Session 34-D D5: MAJOR-1, MINOR-2, MINOR-8) ═════════════════════════════
// The human ratifies one sentence — "move the post at targetOrder to proposedOrder" — and the RPC must write
// exactly that. Every case sends a real reorder THROUGH THE RPC and asserts the result EQUALS the pure
// TypeScript reference (lib/campaigns/role-sequence.ts placeRatifiedProposals) for the same input, so the SQL
// and the reference cannot drift apart. Refusals are typed and change ZERO rows.

describe('AGENCY-REORDER-RATIFIED-EXACT — apply_brief_proposals through the RPC vs the TypeScript reference (live Postgres)', () => {
  let w: World
  let authorId: string

  beforeAll(async () => {
    w = await createWorld('plan-reorder-exact')
    authorId = await addMember(w, 'editor')
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  const seq = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ order: i, role: 'anchor_thesis' as const, platform: 'linkedin' as const, angle: `r${i}` }))

  interface Spec {
    kind: 'drop' | 'substitute' | 'reorder' | 'request_evidence'
    targetOrder: number
    proposedRole?: string
    proposedOrder?: number
  }

  async function seed(n: number, specs: Spec[], status = 'critiqued') {
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, { status, content: { roleSequence: seq(n) } })
    const ids: string[] = []
    for (const s of specs) {
      const { data, error } = await insertProposal(w, {
        briefId,
        campaignId,
        kind: s.kind,
        targetOrder: s.targetOrder,
        proposedRole: s.proposedRole ?? null,
        proposedOrder: s.proposedOrder ?? null,
      })
      if (error) throw error
      ids.push(data.id)
    }
    return { briefId, ids }
  }

  const apply = (briefId: string, ids: string[]) =>
    w.admin.rpc('apply_brief_proposals', {
      p_business_id: w.businessId,
      p_brief_id: briefId,
      p_expected_version: 1,
      p_user_id: authorId,
      p_proposal_ids: ids,
    })

  // The fields the reference and the RPC both produce, in one canonical shape.
  const canon = (rs: Array<{ order: number; role: string; platform: string; angle: string }>) =>
    rs.map((e) => ({ order: e.order, role: e.role, platform: e.platform, angle: e.angle }))

  async function expectAgreement(n: number, specs: Spec[]) {
    const { briefId, ids } = await seed(n, specs)
    const result = await apply(briefId, ids)
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('ok')

    const { placeRatifiedProposals } = await import('@/lib/campaigns/role-sequence')
    const reference = placeRatifiedProposals(seq(n), specs)
    if (!reference.ok) throw new Error(`the reference refused a case the RPC accepted: ${reference.outcome}`)
    expect(canon(result.data.brief.content.roleSequence)).toEqual(canon(reference.roleSequence))
    return result.data.brief.content.roleSequence.map((e: { angle: string }) => e.angle) as string[]
  }

  it("the Reviewer's case 3 -> 0 (verbatim): r3 lands at position 0, not 1", async () => {
    expect(await expectAgreement(4, [{ kind: 'reorder', targetOrder: 3, proposedOrder: 0 }])).toEqual(['r3', 'r0', 'r1', 'r2'])
  })

  it("the Reviewer's case 0 -> 3 (verbatim): r0 lands at position 3, not 2", async () => {
    expect(await expectAgreement(4, [{ kind: 'reorder', targetOrder: 0, proposedOrder: 3 }])).toEqual(['r1', 'r2', 'r3', 'r0'])
  })

  it('a forward interior move and a backward interior move', async () => {
    expect(await expectAgreement(5, [{ kind: 'reorder', targetOrder: 1, proposedOrder: 3 }])).toEqual(['r0', 'r2', 'r3', 'r1', 'r4'])
    expect(await expectAgreement(5, [{ kind: 'reorder', targetOrder: 3, proposedOrder: 1 }])).toEqual(['r0', 'r3', 'r1', 'r2', 'r4'])
  })

  it('reorder + drop in one round: proposedOrder counts positions in the RESULT', async () => {
    expect(
      await expectAgreement(4, [
        { kind: 'drop', targetOrder: 1 },
        { kind: 'reorder', targetOrder: 3, proposedOrder: 0 },
      ]),
    ).toEqual(['r3', 'r0', 'r2'])
  })

  it('reorder + substitute in one round', async () => {
    expect(
      await expectAgreement(4, [
        { kind: 'substitute', targetOrder: 1, proposedRole: 'customer_proof' },
        { kind: 'reorder', targetOrder: 3, proposedOrder: 0 },
      ]),
    ).toEqual(['r3', 'r0', 'r1', 'r2'])
  })

  it('two reorders to DIFFERENT slots in one round compose exactly as the reference does', async () => {
    expect(
      await expectAgreement(4, [
        { kind: 'reorder', targetOrder: 3, proposedOrder: 0 },
        { kind: 'reorder', targetOrder: 0, proposedOrder: 3 },
      ]),
    ).toEqual(['r3', 'r1', 'r2', 'r0'])
  })

  async function expectRefusalChangesNothing(briefId: string, ids: string[], n: number) {
    for (const id of ids) {
      const { data } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', id).single()
      expect(data.status).toBe('pending')
    }
    const { data: brief } = await w.admin.from('campaign_briefs').select('version, status, content').eq('id', briefId).single()
    expect(brief.version).toBe(1)
    expect(brief.status).toBe('critiqued')
    expect(canon(brief.content.roleSequence)).toEqual(canon(seq(n)))
  }

  it("two reorders to ONE slot are REFUSED 'conflicting_reorders' (never guessed), naming a proposal, changing ZERO rows", async () => {
    const { briefId, ids } = await seed(4, [
      { kind: 'reorder', targetOrder: 0, proposedOrder: 2 },
      { kind: 'reorder', targetOrder: 3, proposedOrder: 2 },
    ])
    const result = await apply(briefId, ids)
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('conflicting_reorders')
    expect(ids).toContain(result.data.proposalId)
    await expectRefusalChangesNothing(briefId, ids, 4)
  })

  it("a reorder to a slot past the RESULT's end is REFUSED 'invalid_reorder_target', changing ZERO rows", async () => {
    const { briefId, ids } = await seed(4, [
      { kind: 'drop', targetOrder: 1 },
      { kind: 'reorder', targetOrder: 0, proposedOrder: 3 },
    ])
    const result = await apply(briefId, ids)
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('invalid_reorder_target')
    expect(ids).toContain(result.data.proposalId)
    await expectRefusalChangesNothing(briefId, ids, 4)
  })

  it("a draft (non-critiqued) brief is refused 'not_critiqued' — proposals still pending, version unchanged (MINOR-2)", async () => {
    const { briefId, ids } = await seed(3, [{ kind: 'drop', targetOrder: 0 }], 'draft')
    const result = await apply(briefId, ids)
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('not_critiqued')
    const { data: proposal } = await w.admin.from('campaign_plan_proposals').select('status').eq('id', ids[0]).single()
    expect(proposal.status).toBe('pending')
    const { data: brief } = await w.admin.from('campaign_briefs').select('version, status').eq('id', briefId).single()
    expect(brief.version).toBe(1)
    expect(brief.status).toBe('draft')
  })

  it("dropping EVERY entry is refused 'empty_sequence' — proposals still pending, version and roleSequence unchanged (MINOR-8)", async () => {
    const { briefId, ids } = await seed(2, [
      { kind: 'drop', targetOrder: 0 },
      { kind: 'drop', targetOrder: 1 },
    ])
    const result = await apply(briefId, ids)
    expect(result.error).toBeNull()
    expect(result.data.outcome).toBe('empty_sequence')
    await expectRefusalChangesNothing(briefId, ids, 2)
  })
})
