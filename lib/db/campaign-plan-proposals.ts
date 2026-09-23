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
