import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'
import type { PlannerProposal } from '@/lib/ai/prompts/campaign-planner'
import { insertPlanProposals } from '@/lib/db/campaign-plan-proposals'
import type { CampaignPlanProposalInsert, CampaignPlanProposalRow } from '@/lib/db/types'
import { PLANNER_MAX_PROPOSALS, PLANNER_REASON_MAX_CHARS } from './constants'

// ADR 0027 §6.4 / §5.2 (Session 34 K2.7) — the planner's PERSISTENCE PATH, and the only place a model-authored
// proposal becomes a row.
//
// THE LAUNDERING FIX (AGENCY-PROPOSAL-PAYLOAD-NEUTRALISED, [sec-BLOCKER-2]/[db-BLOCKER-A]). A ratified
// proposal flows into a generation prompt, whose only guard on the far side is sanitizeDataField (a bare
// `[/DATA]` replace — no NFKC, no \p{Cf} strip). The planner model can emit FRESH zero-width or bidi
// characters that the storage-time neutraliser (which ran at import, on a different string) never saw. So
// EVERY proposal-derived string passes neutralizeWithSentinels() HERE, at write time. It is IMPORTED from
// lib/ai/wrap-evidence, never copied: a second copy is a sixth sanitizer (no-sixth-sanitizer scan).
//
// THIS IS THE SOLE NEUTRALISATION POINT. Corrected after the K2.7 security review: an earlier draft of this
// comment (following the build guide) claimed the K2.6 apply RPC neutralises AGAIN. It does not. The RPC
// copies only closed enum/integer fields (`proposed_role`, a computed `order`) and carries the EXISTING
// `angle` forward; it never selects `reason`, so no proposal-derived text reaches brief content today.
//
// Today the only free-text field on a proposal is `reason` (the table has no angle column). Every other
// payload field is a closed enum or an integer the model cannot use to carry text. If a text-bearing column
// is ever added — above all one the apply RPC would copy into a brief — it MUST be neutralised in
// buildProposalRows below AND in the RPC; do not assume a second layer exists.

export interface BriefEntryView {
  order: number
  role: string
}

export interface PersistTarget {
  businessId: string
  briefId: string
  campaignId: string
  briefVersion: number
  model: string
  // One fresh uuid shared by every row this run writes: the spend, and the rows it produced, are one unit.
  plannerRunId: string
  roleSequence: BriefEntryView[]
}

export interface NormalizeResult {
  kept: PlannerProposal[]
  dropped: number
}

// Drops malformed or unappliable proposals INDIVIDUALLY. A schema-level refine would fail the whole run as
// `invalid_response` over one bad proposal and turn a mostly-good plan into "plan analysis unavailable".
// Each rule mirrors a constraint the database (or the K2.6 apply RPC) would otherwise reject one stage later:
//  - targetOrder must name an entry that exists (apply RPC rule (e): a stale target_order).
//  - the per-kind payload shape (campaign_plan_proposals_payload_shape_check).
//  - one proposal per (kind, targetOrder) (the pending-slot partial unique index).
export function normalizeProposals(proposals: PlannerProposal[], roleSequence: BriefEntryView[]): NormalizeResult {
  const roleByOrder = new Map(roleSequence.map((e) => [e.order, e.role]))
  const seen = new Set<string>()
  const kept: PlannerProposal[] = []

  for (const p of proposals) {
    const currentRole = roleByOrder.get(p.targetOrder)
    if (currentRole === undefined) continue

    if (p.kind === 'substitute') {
      if (p.proposedRole === undefined || p.proposedOrder !== undefined) continue
      if (p.proposedRole === currentRole) continue
    } else if (p.kind === 'reorder') {
      if (p.proposedOrder === undefined || p.proposedRole !== undefined) continue
      if (p.proposedOrder === p.targetOrder || p.proposedOrder >= roleSequence.length) continue
    } else if (p.proposedRole !== undefined || p.proposedOrder !== undefined) {
      continue
    }

    const slot = `${p.kind}:${p.targetOrder}`
    if (seen.has(slot)) continue
    seen.add(slot)

    if (kept.length >= PLANNER_MAX_PROPOSALS) continue
    kept.push(p)
  }

  return { kept, dropped: proposals.length - kept.length }
}

// The one function every proposal-derived string passes through before it is stored. Length-bounded to the
// column CHECK by CODE POINTS (Postgres char_length counts code points, not UTF-16 units, and slicing UTF-16
// could split a surrogate pair into a lone surrogate the strip pass already ran past).
export function neutraliseProposalText(raw: string): string {
  const neutralised = neutralizeWithSentinels(raw).trim()
  return Array.from(neutralised).slice(0, PLANNER_REASON_MAX_CHARS).join('')
}

export function buildProposalRows(kept: PlannerProposal[], target: PersistTarget): CampaignPlanProposalInsert[] {
  const rows: CampaignPlanProposalInsert[] = []
  for (const p of kept) {
    const reason = neutraliseProposalText(p.reason)
    // NOT NULL does not exclude '' and the column CHECK requires >= 1 char: a reason that neutralises to
    // nothing (all zero-width) has nothing to show the human, so the proposal is not written.
    if (reason.length === 0) continue
    rows.push({
      business_id: target.businessId,
      brief_id: target.briefId,
      campaign_id: target.campaignId,
      brief_version: target.briefVersion,
      kind: p.kind,
      target_order: p.targetOrder,
      proposed_role: p.proposedRole ?? null,
      proposed_order: p.proposedOrder ?? null,
      reason,
      planner_run_id: target.plannerRunId,
      model: target.model,
    })
  }
  return rows
}

export interface PersistResult {
  inserted: CampaignPlanProposalRow[]
  dropped: number
}

export async function persistPlannerProposals(
  proposals: PlannerProposal[],
  target: PersistTarget,
): Promise<PersistResult> {
  const { kept, dropped } = normalizeProposals(proposals, target.roleSequence)
  const rows = buildProposalRows(kept, target)
  const inserted = await insertPlanProposals(rows)
  return { inserted, dropped: dropped + (kept.length - rows.length) }
}
