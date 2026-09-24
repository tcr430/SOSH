import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignBriefContent, CampaignBriefRow, PlanAnalysisReason } from './types'
import { getErrorMessage } from './utils'
import { getCampaignById } from './campaigns'

// ADR 0017 §2.1 — UNIQUE(campaign_id) means zero-or-one row per campaign;
// this IS the by-campaign lookup index, so a plain eq + maybeSingle suffices.
export async function getBriefByCampaign(
  client: SupabaseClient,
  campaignId: string,
): Promise<CampaignBriefRow | null> {
  const { data, error } = await client
    .from('campaign_briefs')
    .select('*')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignBriefRow | null) ?? null
}

// business_id is read from the campaign row, never accepted as a parameter
// (ADR §2.1 [db-MAJOR-1] tenant-consistency note) — the one call site that
// can silently mislabel a brief's tenant is exactly the one this function
// removes by construction.
export async function createBrief(
  client: SupabaseClient,
  campaignId: string,
  content: CampaignBriefContent,
): Promise<CampaignBriefRow> {
  const campaign = await getCampaignById(client, campaignId)
  const { data, error } = await client
    .from('campaign_briefs')
    .insert({
      business_id: campaign.business_id,
      campaign_id: campaignId,
      content,
      status: 'draft',
    })
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error('Failed to create campaign brief')
  return data as CampaignBriefRow
}

// ADR §2.4 state machine — four atomic conditional-UPDATE transitions,
// mirroring lib/db/campaigns.ts's activateCampaign/pauseCampaign pattern.
// No business logic here: the HARD critique-score gate lives in B2.5: these
// helpers only perform the guarded transition and report success (row) or
// failure (null — the WHERE clause excluded the row because it wasn't in the
// expected status).

// B2.5: extended to persist the rubric's score/critique in the SAME atomic
// UPDATE as the status transition — score is co-produced with the
// transition (Stage B runs the rubric, then transitions), not written
// separately in a second call. Safe to extend: this function has zero
// production callers before B2.5 (only its own B2.1 tests, updated here).
export async function submitBriefForCritique(
  client: SupabaseClient,
  id: string,
  score: { overallScore: number; critique: Record<string, unknown> },
): Promise<CampaignBriefRow | null> {
  const { data, error } = await client
    .from('campaign_briefs')
    .update({ status: 'critiqued', overall_score: score.overallScore, critique: score.critique })
    .eq('id', id)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignBriefRow | null) ?? null
}

// ADR 0027 §5.7 (Session 34-D D4, BLOCKER-1) — the ONLY two paths that approve a brief or advance its version.
// Each is ONE Postgres function body (approve_/revise_brief_and_supersede_proposals): the guarded
// campaign_briefs UPDATE and the supersede of the brief's pending proposals commit in ONE transaction, so a
// frozen or version-advanced brief can never leave a proposal `pending` behind it (AGENCY-FREEZE-SUPERSEDE-ATOMIC).
// They REPLACE the former PostgREST approveBrief/reviseBrief, which superseded nothing; a Tier-3 scan
// (lib/campaigns/__tests__/brief-write-paths.test.ts) forbids a replacement writer.
//
// Both RPCs are service_role-only (supabase/__tests__/plan-proposals-rpc-grants.test.ts), so — CLAUDE.md's
// lazy-import pattern — these take NO client parameter: a caller cannot pass an authenticated client and hit a
// silent permission failure. `businessId` is the LOADED brief row's business_id, never an action input.
//
// Return contract is the predecessors': the updated row, or null when the guard excluded the row ('invalid_state'
// / 'concurrent_edit'), so callers' existing concurrency handling is unchanged. Any other outcome throws.
function readSupersedeRpcResult(data: unknown, refusedOutcome: string): CampaignBriefRow | null {
  const result = data as { outcome?: string; brief?: unknown } | null
  if (result?.outcome === 'ok' && result.brief) return result.brief as CampaignBriefRow
  if (result?.outcome === refusedOutcome) return null
  throw new Error(`unexpected outcome from brief supersede RPC: ${String(result?.outcome)}`)
}

// critiqued -> approved + frozen_at, superseding every pending proposal 'brief_frozen'.
export async function approveBriefAndSupersedeProposals(
  businessId: string,
  briefId: string,
): Promise<CampaignBriefRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('approve_brief_and_supersede_proposals', {
    p_business_id: businessId,
    p_brief_id: briefId,
  })
  if (error) throw new Error(getErrorMessage(error))
  return readSupersedeRpcResult(data, 'invalid_state')
}

// Human revise (critiqued -> draft, version + 1), superseding every pending proposal 'version_advanced'.
// expectedVersion doubles as the optimistic-concurrency guard: the conditional UPDATE inside the RPC matches only
// status=critiqued AND version=expectedVersion, so a concurrent revise loses the race safely (null).
export async function reviseBriefAndSupersedeProposals(
  businessId: string,
  briefId: string,
  expectedVersion: number,
  content: CampaignBriefContent,
): Promise<CampaignBriefRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('revise_brief_and_supersede_proposals', {
    p_business_id: businessId,
    p_brief_id: briefId,
    p_expected_version: expectedVersion,
    p_content: content,
  })
  if (error) throw new Error(getErrorMessage(error))
  return readSupersedeRpcResult(data, 'concurrent_edit')
}

// ADR 0027 §3.3 (Session 34 K2.7) — records whether/why the campaign planner ran. The ONLY writer of these two
// columns. The atomic guard is `plan_analysis_status = 'not_run'`: an outcome is recorded ONCE, so a duplicate
// or racing recorder can never overwrite an 'ok' with 'unavailable' (or the reverse). It touches neither
// `status` nor `content`, so it cannot collide with critiqueBrief's draft->critiqued transition running
// concurrently (each is a single-statement UPDATE of disjoint columns), and it never touches a frozen brief's
// content. Returns null when the guard excluded the row (already recorded).
export async function setBriefPlanAnalysis(
  client: SupabaseClient,
  campaignId: string,
  analysis: { status: 'ok' | 'unavailable' | 'capped'; reason: PlanAnalysisReason | null },
): Promise<CampaignBriefRow | null> {
  const { data, error } = await client
    .from('campaign_briefs')
    .update({ plan_analysis_status: analysis.status, plan_analysis_reason: analysis.reason })
    .eq('campaign_id', campaignId)
    .eq('plan_analysis_status', 'not_run')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignBriefRow | null) ?? null
}

export async function markBriefGenerated(
  client: SupabaseClient,
  id: string,
): Promise<CampaignBriefRow | null> {
  const { data, error } = await client
    .from('campaign_briefs')
    .update({ status: 'generated' })
    .eq('id', id)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignBriefRow | null) ?? null
}
