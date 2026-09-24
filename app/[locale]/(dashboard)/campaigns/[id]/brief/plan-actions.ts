'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { decidePlanProposalRpc, getPlanProposalById } from '@/lib/db/campaign-plan-proposals'
import { applyRatifiedProposals } from '@/lib/campaigns/apply-proposals'
import { critiqueBrief } from '@/lib/campaigns/brief'
import { hasCapability, resolveMemberContext, CAPABILITIES } from '@/lib/members/capabilities'
import type { CampaignBriefRow } from '@/lib/db/types'

// ADR 0027 §5.5/§5.6/§8.4 (Session 34 K2.10) — the Server Actions behind the planner-proposals panel. A SEPARATE
// file from actions.ts on purpose: editBriefAction is NOT widened to carry proposals (§5.5 [sec-BLOCKER-1]), and
// keeping these apart keeps that promise greppable.
//
// EVERY action is Zod-validated, re-checks campaign ownership itself (never trusts a client-supplied business id)
// and re-checks user_can(business_id,'author') as DEFENCE IN DEPTH — the security boundary is the RPC
// (assert_plan_proposal_author raises 42501), this only stops a user being invited to click a control that will
// fail (ruling A-5: the capability is REUSED, not minted).
//
// NO BULK ACCEPT-ALL, ANYWHERE. Accepting a proposal happens ONLY inside a ratification ROUND: the human
// explicitly selects the proposals and they are applied in one RPC call. A one-click accept-all is the named loser
// — a gate-shaped affordance that skips the reading the gate exists for.
//
// REJECT is the ONLY single-proposal verb, and `accepted` is deliberately NOT accepted by the decide action:
// decide_plan_proposal(…, 'accepted') would flip a proposal to accepted WITHOUT changing the brief, the exact
// "the user watches the proposal read accepted while the brief silently never reflects it" state §5.7 exists to
// prevent. Acceptance without application is unrepresentable here.

type Loaded =
  | { ok: true; userId: string; businessId: string; brief: CampaignBriefRow }
  | { ok: false; error: 'unauthorized' | 'not_found' | 'forbidden' }

async function loadForAuthor(campaignId: string): Promise<Loaded> {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  const business = await getBusinessForUser(client, user.id)
  if (!business) return { ok: false, error: 'unauthorized' }

  const campaign = await getCampaignById(client, campaignId)
  if (!campaign || campaign.business_id !== business.id) return { ok: false, error: 'not_found' }

  const memberRow = business.owner_id === user.id ? null : await getMemberForUser(client, business.id, user.id)
  const member = resolveMemberContext(business, user.id, memberRow)
  if (!hasCapability(member, CAPABILITIES.AUTHOR)) return { ok: false, error: 'forbidden' }

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const brief = await getBriefByCampaign(createServiceRoleClient(), campaignId)
  if (!brief) return { ok: false, error: 'not_found' }
  return { ok: true, userId: user.id, businessId: business.id, brief }
}

// ─── reject ONE proposal ─────────────────────────────────────────────────────────────────────────────────────

const decideSchema = z.object({
  campaignId: z.uuid(),
  proposalId: z.uuid(),
  // Deliberately a literal: see the file header.
  decision: z.literal('rejected'),
})

export type DecidePlanProposalError = 'invalid_input' | 'unauthorized' | 'forbidden' | 'not_found' | 'generic'

export type DecidePlanProposalState =
  | { status: 'idle' }
  | { status: 'rejected'; proposalId: string }
  // The second actor's UPDATE matched zero rows: re-render THAT proposal's real state, not a generic error.
  | { status: 'already_decided'; proposalId: string; currentStatus: string | null; supersededReason: string | null }
  | { status: 'error'; error: DecidePlanProposalError }

export async function decidePlanProposalAction(
  _prev: DecidePlanProposalState,
  formData: FormData,
): Promise<DecidePlanProposalState> {
  try {
    const parsed = decideSchema.safeParse({
      campaignId: formData.get('campaignId'),
      proposalId: formData.get('proposalId'),
      decision: formData.get('decision'),
    })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const loaded = await loadForAuthor(parsed.data.campaignId)
    if (!loaded.ok) return { status: 'error', error: loaded.error }

    const decided = await decidePlanProposalRpc({
      businessId: loaded.businessId,
      proposalId: parsed.data.proposalId,
      userId: loaded.userId,
      status: parsed.data.decision,
    })
    if (decided === null) {
      const client = await createClient()
      const current = await getPlanProposalById(client, parsed.data.proposalId)
      return {
        status: 'already_decided',
        proposalId: parsed.data.proposalId,
        currentStatus: current?.status ?? null,
        supersededReason: current?.superseded_reason ?? null,
      }
    }
    revalidatePath(`/[locale]/campaigns/${parsed.data.campaignId}/brief`, 'page')
    return { status: 'rejected', proposalId: parsed.data.proposalId }
  } catch {
    // TODO(logger): log the swallowed error once the project logger lands (matches actions.ts / generate-action.ts).
    return { status: 'error', error: 'generic' }
  }
}

// ─── ratify a ROUND (explicit multi-select) ──────────────────────────────────────────────────────────────────

const applySchema = z.object({
  campaignId: z.uuid(),
  expectedVersion: z.coerce.number().int().min(1),
  // An explicit list the human selected. Bounded; never "all".
  proposalIds: z.array(z.uuid()).min(1).max(50),
})

export type ApplyPlanProposalsError =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_brief_state'
  | 'already_approved'
  | 'concurrent_edit'
  | 'nothing_applied'
  | 'empty_sequence'
  | 'invalid_result'
  | 'generic'

export type ApplyPlanProposalsState =
  | { status: 'idle' }
  // `recritiqued: false` means the changes are APPLIED but the re-critique did not complete: the brief is 'draft',
  // Approve is absent, and the surface says why and offers the retry (ADR §8.2 transient state, [cr-MINOR-2]).
  | { status: 'applied'; appliedCount: number; recritiqued: boolean }
  // Two selected proposals cannot both apply (a drop and a substitute/reorder of the same post) or one names a
  // position that no longer exists: the human is told which, and re-selects.
  // 'conflicting_reorders' / 'invalid_reorder_target' (Session 34-D D5): a reorder the ratified sentence cannot
  // satisfy is refused with the offending proposal named — never silently reinterpreted.
  | {
      status: 'conflict'
      reason: 'conflicting_proposals' | 'stale_target_order' | 'conflicting_reorders' | 'invalid_reorder_target'
      proposalId: string
    }
  | { status: 'error'; error: ApplyPlanProposalsError }

export async function applyPlanProposalsAction(
  _prev: ApplyPlanProposalsState,
  formData: FormData,
): Promise<ApplyPlanProposalsState> {
  try {
    const parsed = applySchema.safeParse({
      campaignId: formData.get('campaignId'),
      expectedVersion: formData.get('expectedVersion'),
      proposalIds: formData.getAll('proposalId'),
    })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const loaded = await loadForAuthor(parsed.data.campaignId)
    if (!loaded.ok) return { status: 'error', error: loaded.error }
    // Proposals are reviewed at 'critiqued' (the human checkpoint, ADR 0017); the RPC itself only refuses a frozen brief.
    if (loaded.brief.status !== 'critiqued') return { status: 'error', error: 'invalid_brief_state' }

    const result = await applyRatifiedProposals({
      businessId: loaded.businessId,
      briefId: loaded.brief.id,
      expectedVersion: parsed.data.expectedVersion,
      userId: loaded.userId,
      proposalIds: parsed.data.proposalIds,
    })

    switch (result.outcome) {
      case 'ok': {
        // The RPC leaves the brief 'draft' (its content changed, so the persisted critique describes content that no
        // longer exists — applying in place and staying 'critiqued' would be a MODE2-CRITIQUE-GATE bypass, §5.5). It
        // is THIS action's job to re-critique, in the same request; otherwise the campaign parks in draft with a
        // stale critique and no explanation.
        let recritiqued = true
        try {
          await critiqueBrief(parsed.data.campaignId)
        } catch {
          recritiqued = false
        }
        revalidatePath(`/[locale]/campaigns/${parsed.data.campaignId}/brief`, 'page')
        return { status: 'applied', appliedCount: result.acceptedIds.length, recritiqued }
      }
      case 'frozen':
        return { status: 'error', error: 'already_approved' }
      case 'concurrent_edit':
        return { status: 'error', error: 'concurrent_edit' }
      case 'not_found':
        return { status: 'error', error: 'not_found' }
      case 'no_proposals_applied':
        return { status: 'error', error: 'nothing_applied' }
      case 'not_critiqued':
        // The RPC's own critiqued guard (MINOR-2) — the same state the pre-check above reports.
        return { status: 'error', error: 'invalid_brief_state' }
      case 'empty_sequence':
        // Every entry would be dropped (MINOR-8): refused before any write, so the brief is untouched.
        return { status: 'error', error: 'empty_sequence' }
      case 'stale_target_order':
      case 'conflicting_proposals':
      case 'conflicting_reorders':
      case 'invalid_reorder_target':
        return { status: 'conflict', reason: result.outcome, proposalId: result.proposalId }
      case 'invalid_result':
        return { status: 'error', error: 'invalid_result' }
      default: {
        const _exhaustive: never = result
        throw new Error(`Unhandled apply outcome: ${JSON.stringify(_exhaustive)}`)
      }
    }
  } catch {
    // TODO(logger): as above.
    return { status: 'error', error: 'generic' }
  }
}

// ─── re-run the critique after a ratification round ──────────────────────────────────────────────────────────

const recritiqueSchema = z.object({ campaignId: z.uuid() })

export type RecritiqueBriefState =
  | { status: 'idle' }
  | { status: 'recritiqued' }
  | { status: 'error'; error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_brief_state' | 'generic' }

export async function recritiqueBriefAction(
  _prev: RecritiqueBriefState,
  formData: FormData,
): Promise<RecritiqueBriefState> {
  try {
    const parsed = recritiqueSchema.safeParse({ campaignId: formData.get('campaignId') })
    if (!parsed.success) return { status: 'error', error: 'invalid_input' }

    const loaded = await loadForAuthor(parsed.data.campaignId)
    if (!loaded.ok) return { status: 'error', error: loaded.error }
    if (loaded.brief.status !== 'draft') return { status: 'error', error: 'invalid_brief_state' }

    await critiqueBrief(parsed.data.campaignId)
    revalidatePath(`/[locale]/campaigns/${parsed.data.campaignId}/brief`, 'page')
    return { status: 'recritiqued' }
  } catch {
    return { status: 'error', error: 'generic' }
  }
}
