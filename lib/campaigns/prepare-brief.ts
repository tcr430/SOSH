import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assembleBrief, critiqueBrief } from '@/lib/campaigns/brief'
import { planBrief } from '@/lib/campaigns/plan-brief'

// ADR 0017 §11 (Stage A -> B) + ADR 0027 §5.4/§2.7 (K2.12) — the REQUEST-PATH brief pipeline for a campaign the
// customer authored:
//
//   assembleBrief ──► [ critiqueBrief  ‖  planBrief ] ──► human brief review
//
// The critique and the planner run CONCURRENTLY (ruling A-4, about +16 s p50 rather than +16 s on top of the critique):
// both consume the Stage-A-assembled brief and neither depends on the other. They write disjoint columns of
// campaign_briefs (critique: status/overall_score/critique; the planner's recorder: plan_analysis_*), which
// setBriefPlanAnalysis documents as a single-statement UPDATE that cannot collide with the draft->critiqued transition.
//
// WHY THIS FILE EXISTS. Before K2.12 nothing on the request path produced a brief: createCampaignAction stopped at a
// 'draft' campaign, and the only assembleBrief callers were the two worker-side paths (promote.ts, seed.ts), which
// ruling A-8 gives NO planner. This module is the one place a planner is wired.
//
// AGENCY-PLANNER-REQUEST-PATH-ONLY: `client` is the caller's AUTHENTICATED client and this module acquires no
// service-role client. brief.ts acquires its own inside assembleBrief/critiqueBrief; that is not this module's
// acquisition, and the Tier-3 scan (prepare-brief.test.ts) pins that this is the ONLY production importer of the planner.
//
// FAILURE. Never throws. If Stage A fails there is no brief and the campaign stays 'draft' (`briefReady: false`); if the
// critique fails the brief exists as 'draft' and the review surface already renders that state with a retry
// (recritiqueBriefAction); the planner is fail-soft by construction (persisted `unavailable`).
export type PrepareBriefResult = { briefReady: false } | { briefReady: true; critiqued: boolean }

export async function prepareBriefForCampaign(client: SupabaseClient, campaignId: string): Promise<PrepareBriefResult> {
  try {
    await assembleBrief(campaignId)
  } catch (err) {
    Sentry.captureException(err, { tags: { campaign_id: campaignId, phase: 'prepare-brief-assemble' } })
    return { briefReady: false }
  }

  const [critique, plan] = await Promise.allSettled([critiqueBrief(campaignId), planBrief(client, campaignId)])

  if (plan.status === 'rejected') {
    // planBrief is documented never to throw; this is defence in depth so a planner fault can never fail the campaign.
    Sentry.captureException(plan.reason, { tags: { campaign_id: campaignId, phase: 'prepare-brief-plan' } })
  }
  if (critique.status === 'rejected') {
    Sentry.captureException(critique.reason, { tags: { campaign_id: campaignId, phase: 'prepare-brief-critique' } })
    return { briefReady: true, critiqued: false }
  }
  return { briefReady: true, critiqued: true }
}
