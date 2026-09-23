import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignPlanProposalInsert, CampaignPlanProposalRow } from './types'
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
