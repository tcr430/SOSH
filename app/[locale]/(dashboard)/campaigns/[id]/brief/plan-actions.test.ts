import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0027 §5.5/§5.6/§8.4 — Session 34-D D6 (MAJOR-2, NIT-2). The three Server Actions behind the planner-proposals
// panel, exercised for real: the panel's own test (PlanReviewPanel.test.tsx) mocks them, so before this file
// removing the critiqueBrief call from the apply action, or letting the decide action reach a sibling campaign's
// proposal, would have shipped green. Capabilities are the REAL lib/members/capabilities; everything below the
// action (auth, db, the apply RPC, the critique) is a mock whose ARGUMENTS the tests assert.
//
// SHARED-FUNCTION CALLERS:
//   decidePlanProposalAction    -> PlanReviewPanel.tsx (rejects ONE proposal)         tests: the `decide` block
//   applyPlanProposalsAction    -> PlanReviewPanel.tsx (ratifies an explicit round)   tests: the `apply` block
//   recritiqueBriefAction       -> PlanReviewPanel.tsx (the transient-state retry)    tests: the `recritique` block

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ getCampaignById: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({ getBriefByCampaign: vi.fn() }))
vi.mock('@/lib/db/campaign-plan-proposals', () => ({ decidePlanProposalRpc: vi.fn(), getPlanProposalById: vi.fn() }))
vi.mock('@/lib/campaigns/apply-proposals', () => ({ applyRatifiedProposals: vi.fn() }))
vi.mock('@/lib/campaigns/brief', () => ({ critiqueBrief: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { decidePlanProposalAction, applyPlanProposalsAction, recritiqueBriefAction } from './plan-actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { decidePlanProposalRpc, getPlanProposalById } from '@/lib/db/campaign-plan-proposals'
import { applyRatifiedProposals } from '@/lib/campaigns/apply-proposals'
import { critiqueBrief } from '@/lib/campaigns/brief'
import type { BusinessRow, CampaignRow, CampaignBriefRow, CampaignPlanProposalRow } from '@/lib/db/types'

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = 'user-owner'

const BUSINESS = { id: 'biz-1', owner_id: USER_ID } as BusinessRow
const CAMPAIGN = { id: CAMPAIGN_ID, business_id: 'biz-1' } as CampaignRow
const brief = (over: Partial<CampaignBriefRow> = {}): CampaignBriefRow =>
  ({ id: 'brief-1', business_id: 'biz-1', campaign_id: CAMPAIGN_ID, status: 'critiqued', version: 1, ...over }) as CampaignBriefRow
const proposal = (over: Partial<CampaignPlanProposalRow> = {}): CampaignPlanProposalRow =>
  ({ id: PROPOSAL_ID, brief_id: 'brief-1', status: 'pending', superseded_reason: null, ...over }) as CampaignPlanProposalRow

function formDataOf(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  return fd
}

function signIn(userId = USER_ID) {
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) } } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  signIn()
  vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS)
  vi.mocked(getCampaignById).mockResolvedValue(CAMPAIGN)
  vi.mocked(getBriefByCampaign).mockResolvedValue(brief())
})

// ─── decide (reject ONE proposal) ────────────────────────────────────────────────────────────────────────────

describe('decidePlanProposalAction', () => {
  const form = (over: Record<string, string> = {}) =>
    formDataOf({ campaignId: CAMPAIGN_ID, proposalId: PROPOSAL_ID, decision: 'rejected', ...over })

  it('refuses malformed input — and `accepted`, which is unrepresentable here (acceptance without application)', async () => {
    const bads: Array<Record<string, string>> = [{ decision: 'accepted' }, { proposalId: 'not-a-uuid' }, { campaignId: 'nope' }, { decision: '' }]
    for (const bad of bads) {
      expect(await decidePlanProposalAction({ status: 'idle' }, form(bad))).toEqual({ status: 'error', error: 'invalid_input' })
    }
    expect(decidePlanProposalRpc).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller and never reaches the RPC', async () => {
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } } as never)
    expect(await decidePlanProposalAction({ status: 'idle' }, form())).toEqual({ status: 'error', error: 'unauthorized' })
    expect(decidePlanProposalRpc).not.toHaveBeenCalled()
  })

  it('CAPABILITY refusal: a member who cannot author (a viewer) is refused `forbidden` — the RPC is never called', async () => {
    signIn('user-viewer')
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)
    expect(await decidePlanProposalAction({ status: 'idle' }, form())).toEqual({ status: 'error', error: 'forbidden' })
    expect(decidePlanProposalRpc).not.toHaveBeenCalled()
  })

  it("refuses a campaign that is not the caller's business's", async () => {
    vi.mocked(getCampaignById).mockResolvedValue({ id: CAMPAIGN_ID, business_id: 'someone-else' } as CampaignRow)
    expect(await decidePlanProposalAction({ status: 'idle' }, form())).toEqual({ status: 'error', error: 'not_found' })
    expect(decidePlanProposalRpc).not.toHaveBeenCalled()
  })

  it("NIT-2: a proposal that belongs to ANOTHER campaign's brief is refused `not_found` — the RPC is never called", async () => {
    vi.mocked(getPlanProposalById).mockResolvedValue(proposal({ id: OTHER_PROPOSAL_ID, brief_id: 'a-sibling-campaigns-brief' }))
    const result = await decidePlanProposalAction({ status: 'idle' }, form({ proposalId: OTHER_PROPOSAL_ID }))
    expect(result).toEqual({ status: 'error', error: 'not_found' })
    expect(decidePlanProposalRpc).not.toHaveBeenCalled()
  })

  it('NIT-2: a proposal the caller cannot see (no row) is refused `not_found` — the RPC is never called', async () => {
    vi.mocked(getPlanProposalById).mockResolvedValue(null)
    expect(await decidePlanProposalAction({ status: 'idle' }, form())).toEqual({ status: 'error', error: 'not_found' })
    expect(decidePlanProposalRpc).not.toHaveBeenCalled()
  })

  it('happy path: the RPC is called EXACTLY ONCE with the loaded business, the proposal, the user and `rejected`', async () => {
    vi.mocked(getPlanProposalById).mockResolvedValue(proposal())
    vi.mocked(decidePlanProposalRpc).mockResolvedValue(proposal({ status: 'rejected' }) as never)

    const result = await decidePlanProposalAction({ status: 'idle' }, form())

    expect(result).toEqual({ status: 'rejected', proposalId: PROPOSAL_ID })
    expect(decidePlanProposalRpc).toHaveBeenCalledTimes(1)
    expect(decidePlanProposalRpc).toHaveBeenCalledWith({ businessId: 'biz-1', proposalId: PROPOSAL_ID, userId: USER_ID, status: 'rejected' })
  })

  it("the typed `already_decided` re-render (ADR §5.6): the second actor's null re-renders THAT proposal's real state, not a generic error", async () => {
    vi.mocked(getPlanProposalById)
      .mockResolvedValueOnce(proposal()) // the NIT-2 ownership read
      .mockResolvedValueOnce(proposal({ status: 'superseded', superseded_reason: 'brief_frozen' })) // the re-render read
    vi.mocked(decidePlanProposalRpc).mockResolvedValue(null)

    const result = await decidePlanProposalAction({ status: 'idle' }, form())

    expect(result).toEqual({ status: 'already_decided', proposalId: PROPOSAL_ID, currentStatus: 'superseded', supersededReason: 'brief_frozen' })
  })

  it('a thrown RPC error is a generic error, never an unhandled rejection', async () => {
    vi.mocked(getPlanProposalById).mockResolvedValue(proposal())
    vi.mocked(decidePlanProposalRpc).mockRejectedValue(new Error('boom'))
    expect(await decidePlanProposalAction({ status: 'idle' }, form())).toEqual({ status: 'error', error: 'generic' })
  })
})

// ─── apply (ratify an explicit ROUND) ────────────────────────────────────────────────────────────────────────

describe('applyPlanProposalsAction', () => {
  const form = (over: Record<string, string | string[]> = {}) =>
    formDataOf({ campaignId: CAMPAIGN_ID, expectedVersion: '1', proposalId: [PROPOSAL_ID], ...over })
  const run = (over?: Record<string, string | string[]>) => applyPlanProposalsAction({ status: 'idle' }, form(over))
  const okResult = { outcome: 'ok', brief: brief({ status: 'draft', version: 2 }), acceptedIds: [PROPOSAL_ID] }

  it('refuses malformed input: no proposal ids, more than 50 (never "all"), a non-uuid id, a bad version', async () => {
    expect(await run({ proposalId: [] })).toEqual({ status: 'error', error: 'invalid_input' })
    expect(await run({ proposalId: Array.from({ length: 51 }, () => PROPOSAL_ID) })).toEqual({ status: 'error', error: 'invalid_input' })
    expect(await run({ proposalId: ['nope'] })).toEqual({ status: 'error', error: 'invalid_input' })
    expect(await run({ expectedVersion: '0' })).toEqual({ status: 'error', error: 'invalid_input' })
    expect(applyRatifiedProposals).not.toHaveBeenCalled()
  })

  it('the critiqued PRE-CHECK: a brief that is not critiqued is refused `invalid_brief_state` before the RPC is reached', async () => {
    for (const status of ['draft', 'approved', 'generated'] as const) {
      vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ status }))
      expect(await run()).toEqual({ status: 'error', error: 'invalid_brief_state' })
    }
    expect(applyRatifiedProposals).not.toHaveBeenCalled()
    expect(critiqueBrief).not.toHaveBeenCalled()
  })

  it('CAPABILITY refusal: a viewer is refused `forbidden` and nothing is applied', async () => {
    signIn('user-viewer')
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)
    expect(await run()).toEqual({ status: 'error', error: 'forbidden' })
    expect(applyRatifiedProposals).not.toHaveBeenCalled()
  })

  it('passes the LOADED business, the loaded brief, the expected version, the user and ONLY the selected ids to the RPC', async () => {
    vi.mocked(applyRatifiedProposals).mockResolvedValue(okResult as never)
    vi.mocked(critiqueBrief).mockResolvedValue(undefined as never)
    await run({ proposalId: [PROPOSAL_ID, OTHER_PROPOSAL_ID], expectedVersion: '3' })
    expect(applyRatifiedProposals).toHaveBeenCalledTimes(1)
    expect(applyRatifiedProposals).toHaveBeenCalledWith({
      businessId: 'biz-1',
      briefId: 'brief-1',
      expectedVersion: 3,
      userId: USER_ID,
      proposalIds: [PROPOSAL_ID, OTHER_PROPOSAL_ID],
    })
  })

  it('ON SUCCESS the brief is RE-CRITIQUED IN THE SAME REQUEST ([cr-MINOR-2], §5.5): critiqueBrief is called once, for THIS campaign — the RPC leaves the brief `draft` with a stale critique', async () => {
    vi.mocked(applyRatifiedProposals).mockResolvedValue(okResult as never)
    vi.mocked(critiqueBrief).mockResolvedValue(undefined as never)

    const result = await run()

    expect(result).toEqual({ status: 'applied', appliedCount: 1, recritiqued: true })
    expect(critiqueBrief).toHaveBeenCalledTimes(1)
    expect(critiqueBrief).toHaveBeenCalledWith(CAMPAIGN_ID)
  })

  it('if the same-request re-critique THROWS the changes are still APPLIED and the surface says so (`recritiqued: false`, the transient state)', async () => {
    vi.mocked(applyRatifiedProposals).mockResolvedValue(okResult as never)
    vi.mocked(critiqueBrief).mockRejectedValue(new Error('critique unavailable'))
    expect(await run()).toEqual({ status: 'applied', appliedCount: 1, recritiqued: false })
    expect(critiqueBrief).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['frozen', { status: 'error', error: 'already_approved' }],
    ['concurrent_edit', { status: 'error', error: 'concurrent_edit' }],
    ['not_found', { status: 'error', error: 'not_found' }],
    ['no_proposals_applied', { status: 'error', error: 'nothing_applied' }],
    ['not_critiqued', { status: 'error', error: 'invalid_brief_state' }],
    ['empty_sequence', { status: 'error', error: 'empty_sequence' }],
  ])('typed refusal %s maps to %j — and NEVER triggers a critique (nothing changed)', async (outcome, expected) => {
    vi.mocked(applyRatifiedProposals).mockResolvedValue({ outcome } as never)
    expect(await run()).toEqual(expected)
    expect(critiqueBrief).not.toHaveBeenCalled()
  })

  it.each(['stale_target_order', 'conflicting_proposals', 'conflicting_reorders', 'invalid_reorder_target'])(
    'typed refusal %s becomes a `conflict` naming the offending proposal — and NEVER triggers a critique',
    async (outcome) => {
      vi.mocked(applyRatifiedProposals).mockResolvedValue({ outcome, proposalId: OTHER_PROPOSAL_ID } as never)
      expect(await run()).toEqual({ status: 'conflict', reason: outcome, proposalId: OTHER_PROPOSAL_ID })
      expect(critiqueBrief).not.toHaveBeenCalled()
    },
  )

  it('`invalid_result` (the applied plan fails the shared schema AFTER commit) is a terminal error and is NOT re-critiqued', async () => {
    vi.mocked(applyRatifiedProposals).mockResolvedValue({ outcome: 'invalid_result', message: 'dup' } as never)
    expect(await run()).toEqual({ status: 'error', error: 'invalid_result' })
    expect(critiqueBrief).not.toHaveBeenCalled()
  })

  it('a thrown RPC error is a generic error and no critique runs', async () => {
    vi.mocked(applyRatifiedProposals).mockRejectedValue(new Error('boom'))
    expect(await run()).toEqual({ status: 'error', error: 'generic' })
    expect(critiqueBrief).not.toHaveBeenCalled()
  })
})

// ─── recritique (the transient-state retry) ──────────────────────────────────────────────────────────────────

describe('recritiqueBriefAction', () => {
  const run = (fields: Record<string, string> = { campaignId: CAMPAIGN_ID }) => recritiqueBriefAction({ status: 'idle' }, formDataOf(fields))

  it('refuses a malformed campaign id', async () => {
    expect(await run({ campaignId: 'nope' })).toEqual({ status: 'error', error: 'invalid_input' })
    expect(critiqueBrief).not.toHaveBeenCalled()
  })

  it('its GUARD: only a `draft` brief may be re-critiqued — a critiqued or approved brief is refused `invalid_brief_state`, and no critique runs', async () => {
    for (const status of ['critiqued', 'approved', 'generated'] as const) {
      vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ status }))
      expect(await run()).toEqual({ status: 'error', error: 'invalid_brief_state' })
    }
    expect(critiqueBrief).not.toHaveBeenCalled()
  })

  it('CAPABILITY refusal: a viewer is refused `forbidden`', async () => {
    signIn('user-viewer')
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ status: 'draft' }))
    expect(await run()).toEqual({ status: 'error', error: 'forbidden' })
    expect(critiqueBrief).not.toHaveBeenCalled()
  })

  it('a draft brief is re-critiqued: critiqueBrief is called once for THIS campaign', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ status: 'draft' }))
    vi.mocked(critiqueBrief).mockResolvedValue(undefined as never)
    expect(await run()).toEqual({ status: 'recritiqued' })
    expect(critiqueBrief).toHaveBeenCalledTimes(1)
    expect(critiqueBrief).toHaveBeenCalledWith(CAMPAIGN_ID)
  })

  it('a failing critique is a generic error, not an unhandled rejection', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(brief({ status: 'draft' }))
    vi.mocked(critiqueBrief).mockRejectedValue(new Error('boom'))
    expect(await run()).toEqual({ status: 'error', error: 'generic' })
  })
})
