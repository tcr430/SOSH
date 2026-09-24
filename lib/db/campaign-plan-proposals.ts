import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignBriefRow, CampaignPlanProposalInsert, CampaignPlanProposalRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0027 §5.3/§9.2 (Session 34 K2.7) — the planner's persistence path. INSERT is service-role only (the
// table has no authenticated write grant at all; decide/apply/supersede go through the K2.6 RPCs), so this
// follows the lazy-import pattern: no `client` parameter, the service-role client never reaches a bundle
// that does not need it.
//
// Every string in `rows` must ALREADY be neutralised by the caller (AGENCY-PROPOSAL-PAYLOAD-NEUTRALISED —
// lib/campaigns/planner/persist.ts owns that step). This module is deliberately dumb: it writes what it is
// given, so the neutralisation lives in exactly one place and its test asserts on the STORED ROW.
export async function insertPlanProposals(rows: CampaignPlanProposalInsert[]): Promise<CampaignPlanProposalRow[]> {
  if (rows.length === 0) return []
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.from('campaign_plan_proposals').insert(rows).select()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignPlanProposalRow[] | null) ?? []
}

// Read side for the brief-review surface (K2.10) and the tests: the caller's client, so RLS applies.
// Explicit ORDER BY matches campaign_plan_proposals_review_idx (brief_id, brief_version, target_order,
// created_at, id); `limit` is required by the list-query convention.
export async function listPendingPlanProposals(
  client: SupabaseClient,
  briefId: string,
  briefVersion: number,
  limit = 50,
): Promise<CampaignPlanProposalRow[]> {
  const { data, error } = await client
    .from('campaign_plan_proposals')
    .select('*')
    .eq('brief_id', briefId)
    .eq('brief_version', briefVersion)
    .eq('status', 'pending')
    .order('target_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignPlanProposalRow[] | null) ?? []
}

// ADR 0027 §5.5 (Session 34 K2.8) — the typed wrapper over apply_brief_proposals. SERVICE-ROLE by construction
// (the RPC is granted to service_role only and verifies `p_user_id` itself — auth.uid() does not exist inside
// it), so this takes no client and acquires its own via the lazy import. The typed outcomes are the RPC's, one
// for one: a refusal is a value, never an exception.
//
// Callers go through lib/campaigns/apply-proposals.ts, which validates the resulting roleSequence against the
// shared schema. This function alone does NOT — that is deliberate: the DB layer returns what the database
// said, and the one place that judges it is the campaigns-layer wrapper.
export type ApplyBriefProposalsRpcResult =
  | { outcome: 'ok'; brief: CampaignBriefRow; acceptedIds: string[] }
  | { outcome: 'not_found' | 'frozen' | 'concurrent_edit' | 'no_proposals_applied' }
  | { outcome: 'stale_target_order' | 'conflicting_proposals'; proposalId: string }

export async function applyBriefProposalsRpc(args: {
  businessId: string
  briefId: string
  expectedVersion: number
  userId: string
  proposalIds: string[]
}): Promise<ApplyBriefProposalsRpcResult> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('apply_brief_proposals', {
    p_business_id: args.businessId,
    p_brief_id: args.briefId,
    p_expected_version: args.expectedVersion,
    p_user_id: args.userId,
    p_proposal_ids: args.proposalIds,
  })
  if (error) throw new Error(getErrorMessage(error))
  return data as ApplyBriefProposalsRpcResult
}

// ADR 0027 §8.2/§8.5 (Session 34 K2.10) — EVERY proposal state for one brief, so the review surface can render
// pending / accepted / rejected / superseded (with its superseded_reason). BOUNDED: an explicit ORDER BY that is
// ALL-ASC (target_order, created_at, id — mixing a DESC in would stop the ORDER BY matching the review index and
// satisfy the house rule only nominally) and a default `limit` of 50. The caller's client, so RLS applies (the
// table has a member-scoped SELECT policy and no authenticated write grant at all).
export const PLAN_PROPOSALS_DEFAULT_LIMIT = 50

export async function listPlanProposalsForBrief(
  client: SupabaseClient,
  briefId: string,
  limit = PLAN_PROPOSALS_DEFAULT_LIMIT,
): Promise<CampaignPlanProposalRow[]> {
  const { data, error } = await client
    .from('campaign_plan_proposals')
    .select('*')
    .eq('brief_id', briefId)
    .order('target_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignPlanProposalRow[] | null) ?? []
}

// ADR 0027 §5.6 — accept/reject ONE proposal through the RPC (which verifies the author capability itself and does
// the guarded `WHERE status = 'pending'` UPDATE). `null` is the RPC's already_decided signal — never an error.
//
// PostgREST serialises a NULL composite return as an OBJECT WITH EVERY FIELD NULL, not JSON null (the standing
// quirk lib/db/campaign-retrospectives.ts#retrospectiveOrNull already works around): keyed on `id == null`.
export async function decidePlanProposalRpc(args: {
  businessId: string
  proposalId: string
  userId: string
  status: 'accepted' | 'rejected'
}): Promise<CampaignPlanProposalRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('decide_plan_proposal', {
    p_business_id: args.businessId,
    p_proposal_id: args.proposalId,
    p_user_id: args.userId,
    p_status: args.status,
  })
  if (error) throw new Error(getErrorMessage(error))
  const row = data as CampaignPlanProposalRow | null
  return row === null || row.id == null ? null : row
}

// The proposal's CURRENT state, by id — what an `already_decided` outcome re-renders (the second actor sees THAT
// proposal's real state, never a generic error). The caller's client, so RLS applies too.
export async function getPlanProposalById(
  client: SupabaseClient,
  proposalId: string,
): Promise<CampaignPlanProposalRow | null> {
  const { data, error } = await client.from('campaign_plan_proposals').select('*').eq('id', proposalId).maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignPlanProposalRow | null) ?? null
}
