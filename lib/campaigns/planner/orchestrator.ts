import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runToolLoop, type ToolLoopFailureReason } from '@/lib/ai/tool-runner'
import { MODELS } from '@/lib/ai/models'
import { buildCustomerContext } from '@/lib/ai/context'
import {
  PLANNER_MODEL_KEY,
  PLANNER_PROMPT_ID,
  PLANNER_PROMPT_VERSION,
  PlannerDecisionSchema,
  buildPlannerSystemPrompt,
  buildPlannerUserMessage,
} from '@/lib/ai/prompts/campaign-planner'
import type { PlanAnalysisReason } from '@/lib/db/types'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { reservePlannerBudget, reconcilePlannerBudget } from '@/lib/db/planner-budget'
import { PLANNER_LOOP_BOUNDS, PLANNER_RESERVATION_CENTS } from './constants'
import { buildPlannerTools } from './tools'
import { persistPlannerProposals } from './persist'

// ADR 0027 §2.7/§3.3/§5.10/§7.2/§7.4 (Session 34 K2.7) — the campaign planner orchestrator.
//
// REQUEST-PATH ONLY (AGENCY-PLANNER-REQUEST-PATH-ONLY, founder ruling A-8). `client` is the CALLER'S
// authenticated client and is threaded straight into buildPlannerTools: the tools' tenant boundary is
// `.eq('business_id', …)` plus RLS, and both premises are FALSE for a worker holding a service-role client
// (ADR 0021 §2.3's reasoning would apply verbatim). This module never acquires a service-role client for the
// tools. The only service-role work is behind lib/db/planner-budget.ts and lib/db/campaign-plan-proposals.ts,
// which own their own lazy acquisition. Nothing under lib/campaigns/planner/** may be imported by
// lib/campaigns/promote.ts or lib/signals/seed.ts — those two leave plan_analysis_status at 'not_run'.
//
// PROPOSES ONLY (AGENCY-PLANNER-PROPOSES-ONLY). This module's only writes are campaign_plan_proposals rows
// (via persist.ts) and the budget reservation. It has NO write path to campaign_briefs: the sole writer of
// brief content is the K2.6 apply RPC, behind a human, and plan_analysis_status is recorded by the CALLER
// (lib/campaigns/plan-brief.ts) from the outcome this function returns. Tier-3 scan: planner/__tests__/
// source-scans.test.ts.
//
// TOOLS ONCE PER CAMPAIGN (AGENCY-TOOLS-ONCE-PER-CAMPAIGN). buildPlannerTools is called exactly once, here,
// before the loop — never per candidate inside generate.ts's fan-out, where a 6-post campaign would carry 18
// tool loops (~200 cents of lookups against ~60 cents of generation).

// Why the planner produced no usable plan. A closed set, never free text: it is persisted to
// campaign_briefs.plan_analysis_reason and rendered to a human, so it must not be able to carry model output.
// Re-exported from lib/db/types.ts, which owns the closed list (the recorder's parameter type).
export type { PlanAnalysisReason }

export type PlanAnalysisOutcome =
  // 'ok' with proposalCount 0 is the LEGITIMATE "the planner proposed nothing". It is distinguishable from
  // 'unavailable' only because the status is persisted — both produce zero rows.
  | { status: 'ok'; reason: null; proposalCount: number; droppedCount: number }
  | { status: 'unavailable'; reason: PlanAnalysisReason; proposalCount: 0; droppedCount: 0 }
  | { status: 'capped'; reason: 'daily_cap'; proposalCount: 0; droppedCount: 0 }

// FAIL-SOFT (AGENCY-BOUND-FAILURE-DEFINED, ADR 0027 §3.3). ALL ELEVEN non-decision outcomes map to
// 'unavailable'; NONE maps to 'ok'. Exhaustive BY `satisfies` over K2.2's runtime array: a twelfth reason added
// to TOOL_LOOP_FAILURE_REASONS without a row here fails to COMPILE, instead of falling through a default arm
// into "the planner proposed nothing". The value type is the literal 'unavailable', so mapping a reason to
// 'ok' (or 'capped') is also a compile error, not merely a test failure.
export const PLAN_STATUS_FOR_LOOP_FAILURE = {
  quota_exceeded: 'unavailable',
  rate_limited: 'unavailable',
  wall_clock_exceeded: 'unavailable',
  input_token_cap_exceeded: 'unavailable',
  output_token_per_turn_exceeded: 'unavailable',
  output_token_cap_exceeded: 'unavailable',
  retry_budget_exhausted: 'unavailable',
  max_turns_exceeded: 'unavailable',
  response_truncated: 'unavailable',
  invalid_response: 'unavailable',
  provider_error: 'unavailable',
} as const satisfies Record<ToolLoopFailureReason, 'unavailable'>

function unavailable(reason: PlanAnalysisReason): PlanAnalysisOutcome {
  return { status: 'unavailable', reason, proposalCount: 0, droppedCount: 0 }
}

// Never throws: fail-soft means a planner problem must not surface as a campaign-creation error. Every
// non-decision path returns an 'unavailable'/'capped' outcome and writes ZERO proposals.
export async function runPlannerForCampaign(client: SupabaseClient, campaignId: string): Promise<PlanAnalysisOutcome> {
  let businessId: string | null = null
  // True from the moment a reservation is held until the loop's actual cost has been reconciled (or an
  // attempt to reconcile it has been made). Guards the catch-path refund from double-refunding.
  let reservationHeld = false

  try {
    const campaign = await getCampaignById(client, campaignId)
    businessId = campaign.business_id
    const brief = await getBriefByCampaign(client, campaignId)
    if (!brief) return unavailable('no_brief')

    const { config } = await import('@/lib/config')
    const reserved = await reservePlannerBudget(
      campaign.business_id,
      PLANNER_RESERVATION_CENTS,
      config.server.AI_PLANNER_DAILY_CAP_CENTS,
    )
    if (!reserved) {
      // At the cap the model is never called and the campaign PROCEEDS with an unplanned brief. Nothing was
      // reserved, so there is nothing to reconcile.
      return { status: 'capped', reason: 'daily_cap', proposalCount: 0, droppedCount: 0 }
    }
    reservationHeld = true

    const context = await buildCustomerContext(campaign.business_id, campaign.voice_variation_id)
    const tools = buildPlannerTools(client, campaign.business_id, campaignId)

    const result = await runToolLoop({
      context,
      systemPrompt: buildPlannerSystemPrompt(context),
      userMessage: buildPlannerUserMessage({
        objective: campaign.objective,
        platforms: campaign.platforms,
        brief: {
          narrative: brief.content.narrative,
          proofPlan: brief.content.proofPlan,
          roleSequence: brief.content.roleSequence,
        },
      }),
      tools,
      bounds: PLANNER_LOOP_BOUNDS,
      promptId: PLANNER_PROMPT_ID,
      promptVersion: PLANNER_PROMPT_VERSION,
      model: PLANNER_MODEL_KEY,
      // A planner run is not a post: charging the trial post quota would burn a post per plan
      // (AGENCY-PLANNER-TRIAL-EXEMPT).
      enforceTrialQuota: false,
      outputSchema: PlannerDecisionSchema,
    })

    // §3.3 — reconcile on EVERY outcome, including failure (a failed loop still burns tokens). A reconcile
    // failure is NOT allowed to discard a good plan or abort the caller: the reservation simply stays at its
    // worst-case figure, which over-counts spend for the day (the safe direction).
    reservationHeld = false
    try {
      await reconcilePlannerBudget(campaign.business_id, PLANNER_RESERVATION_CENTS, result.costCents)
    } catch (reconcileErr) {
      Sentry.captureException(reconcileErr, {
        tags: { business_id: campaign.business_id, campaign_id: campaignId, phase: 'planner-reconcile' },
      })
    }

    if (result.outcome !== 'decision') {
      // Reason is a closed literal, never model output; ids only, never a body.
      Sentry.captureException(new Error(`campaign planner failed: ${result.reason}`), {
        tags: { business_id: campaign.business_id, campaign_id: campaignId, reason: result.reason },
      })
      return {
        status: PLAN_STATUS_FOR_LOOP_FAILURE[result.reason],
        reason: result.reason,
        proposalCount: 0,
        droppedCount: 0,
      }
    }

    const { inserted, dropped } = await persistPlannerProposals(result.decision.proposals, {
      businessId: campaign.business_id,
      briefId: brief.id,
      campaignId,
      briefVersion: brief.version,
      model: MODELS[PLANNER_MODEL_KEY].id,
      plannerRunId: crypto.randomUUID(),
      roleSequence: brief.content.roleSequence,
    })
    return { status: 'ok', reason: null, proposalCount: inserted.length, droppedCount: dropped }
  } catch (err) {
    // A failure BEFORE the loop returned (brief/campaign read, context build, tool construction) or in the
    // post-loop persistence. If a reservation is still held, nothing was spent: give it back, best-effort.
    if (reservationHeld && businessId !== null) {
      await reconcilePlannerBudget(businessId, PLANNER_RESERVATION_CENTS, 0).catch(() => undefined)
    }
    // Class and SQLSTATE only, never the message: a Postgres CHECK/unique violation carries a "Failing row
    // contains (...)" detail that would put the (neutralised) proposal text into the log pipeline.
    Sentry.captureException(new Error('campaign planner internal error'), {
      tags: {
        business_id: businessId ?? 'unknown',
        campaign_id: campaignId,
        phase: 'campaign-planner',
        error_name: err instanceof Error ? err.name : 'unknown',
      },
    })
    return unavailable('internal_error')
  }
}
