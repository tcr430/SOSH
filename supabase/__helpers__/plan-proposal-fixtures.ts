// Shared Tier-1 fixtures for the ADR 0027 campaign_plan_proposals tests (Session 34 K2.5).
//
// Deliberately OUTSIDE supabase/__tests__/: it is not a test, and ADR 0015's skip-guard flags a
// supabase/__tests__ file that executes zero tests as a false-green. Every function writes
// through the SERVICE-ROLE client — the same identity the planner orchestrator (K2.7) and its
// RPCs (K2.6) run as.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { toUtcIso } from '@/lib/utils'
import type { World } from './outcome-fixtures'

export async function createBrief(w: World, campaignId: string, over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await w.admin
    .from('campaign_briefs')
    .insert({
      business_id: w.businessId,
      campaign_id: campaignId,
      content: { roleSequence: [{ role: 'anchor_thesis', order: 0 }, { role: 'follow_up', order: 1 }] },
      status: 'draft',
      version: 1,
      ...over,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export interface ProposalSpec {
  briefId: string
  campaignId: string
  briefVersion?: number
  kind?: 'drop' | 'substitute' | 'reorder' | 'request_evidence'
  targetOrder?: number
  proposedRole?: string | null
  proposedOrder?: number | null
  reason?: string
  status?: 'pending' | 'accepted' | 'rejected' | 'superseded'
  superseded_reason?: string | null
  decidedBy?: string | null
  decidedAt?: string | null
  plannerRunId?: string
  model?: string
}

export function proposalRow(w: World, spec: ProposalSpec): Record<string, unknown> {
  const kind = spec.kind ?? 'drop'
  return {
    business_id: w.businessId,
    brief_id: spec.briefId,
    campaign_id: spec.campaignId,
    brief_version: spec.briefVersion ?? 1,
    kind,
    target_order: spec.targetOrder ?? 0,
    proposed_role: spec.proposedRole ?? null,
    proposed_order: spec.proposedOrder ?? null,
    reason: spec.reason ?? 'fixture reason',
    status: spec.status ?? 'pending',
    superseded_reason: spec.superseded_reason ?? null,
    decided_by: spec.decidedBy ?? null,
    decided_at: spec.decidedAt ?? null,
    planner_run_id: spec.plannerRunId ?? crypto.randomUUID(),
    model: spec.model ?? 'claude-sonnet-5',
  }
}

export async function insertProposal(w: World, spec: ProposalSpec) {
  return w.admin.from('campaign_plan_proposals').insert(proposalRow(w, spec)).select('*').single()
}

export const NOW_ISO = () => toUtcIso(new Date())
