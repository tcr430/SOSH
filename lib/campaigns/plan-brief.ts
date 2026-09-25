import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runPlannerForCampaign, type PlanAnalysisOutcome } from '@/lib/campaigns/planner/orchestrator'
import { setBriefPlanAnalysis, getBriefByCampaign } from '@/lib/db/campaign-briefs'

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
  // Session 34-D D10 (MINOR-3): THREE outcomes of the record, each distinguishable in the alert stream.
  //   WRITTEN  — the row was updated (non-null).
  //   FAILED   — the write threw: proposals (if any) exist but the brief still reads 'not_run'.
  //   NO-OP    — the write returned null: the atomic guard (`plan_analysis_status = 'not_run'`) excluded the row, so
  //              it was ALREADY recorded (a duplicate or racing recorder) or the brief is gone. Nothing was written
  //              — and before this fix nothing even noticed.
  // The panel no longer trusts the status alone (it renders proposals whenever rows exist), but an operator must
  // still be able to see that the bookkeeping did not land. Never thrown: fail-soft extends to the bookkeeping.
  try {
    const recorded = await setBriefPlanAnalysis(client, campaignId, { status: outcome.status, reason: outcome.reason })
    if (recorded === null) {
      // Include the status that was already there. Best-effort: a failed read must not turn a no-op alert into a throw.
      let existingStatus = 'unknown'
      try {
        existingStatus = (await getBriefByCampaign(client, campaignId))?.plan_analysis_status ?? 'no_brief'
      } catch {
        // keep 'unknown'
      }
      Sentry.captureException(new Error('plan-analysis record was a no-op: the not_run guard excluded the brief row'), {
        tags: { campaign_id: campaignId, phase: 'plan-analysis-record-noop', existing_status: existingStatus },
      })
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { campaign_id: campaignId, phase: 'plan-analysis-record-failed' } })
  }
  return outcome
}
