import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runPlannerForCampaign, type PlanAnalysisOutcome } from '@/lib/campaigns/planner/orchestrator'
import { setBriefPlanAnalysis } from '@/lib/db/campaign-briefs'

// ADR 0027 §3.3/§2.7 (Session 34 K2.7) — the REQUEST-PATH entry point for the campaign planner: runs it and
// PERSISTS its outcome on the brief. This lives outside lib/campaigns/planner/** on purpose: the planner
// module has no write path to campaign_briefs (AGENCY-PLANNER-PROPOSES-ONLY), so the one column write that
// records "did the planner run" belongs to the caller.
//
// THE STATUS IS PERSISTED, NOT RETURNED-AND-FORGOTTEN, because fail-soft is safe only if "unavailable" and
// "proposed nothing" stay distinguishable. Both write zero proposal rows; nothing downstream could tell them
// apart without this column.
//
// `client` is the caller's AUTHENTICATED client and this module acquires no service-role client — a
// service-role-acquiring module importing the planner would defeat AGENCY-PLANNER-REQUEST-PATH-ONLY (its
// Tier-3 scan fails on exactly that shape). promote.ts and seed.ts never import this module: they leave the
// column at its 'not_run' DEFAULT.
export async function planBrief(client: SupabaseClient, campaignId: string): Promise<PlanAnalysisOutcome> {
  const outcome = await runPlannerForCampaign(client, campaignId)
  try {
    await setBriefPlanAnalysis(client, campaignId, { status: outcome.status, reason: outcome.reason })
  } catch (err) {
    // Recording failed: proposals (if any) exist but the brief still reads 'not_run'. Logged, never thrown —
    // fail-soft extends to the bookkeeping.
    Sentry.captureException(err, { tags: { campaign_id: campaignId, phase: 'plan-analysis-record' } })
  }
  return outcome
}
