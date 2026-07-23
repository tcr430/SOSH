import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignBriefContent, CampaignBriefRow } from './types'
import { getErrorMessage } from './utils'
import { getCampaignById } from './campaigns'
import { toUtcIso } from '@/lib/utils'

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

export async function approveBrief(
  client: SupabaseClient,
  id: string,
): Promise<CampaignBriefRow | null> {
  const { data, error } = await client
    .from('campaign_briefs')
    .update({ status: 'approved', frozen_at: toUtcIso(new Date()) })
    .eq('id', id)
    .eq('status', 'critiqued')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignBriefRow | null) ?? null
}

// Human revise (critiqued -> draft). version is caller-supplied as the
// EXPECTED current version (mirroring activateCampaign's caller-precomputed
// totalPostsPlanned) and doubles as an optimistic-concurrency guard: the
// conditional UPDATE matches only status=critiqued AND version=expectedVersion,
// so a concurrent revise loses the race safely (returns null) instead of
// silently clobbering or double-bumping. frozen_at is never touched here —
// revise only ever happens pre-freeze, so it is already NULL.
export async function reviseBrief(
  client: SupabaseClient,
  id: string,
  expectedVersion: number,
  content: CampaignBriefContent,
): Promise<CampaignBriefRow | null> {
  const { data, error } = await client
    .from('campaign_briefs')
    .update({ status: 'draft', version: expectedVersion + 1, content })
    .eq('id', id)
    .eq('status', 'critiqued')
    .eq('version', expectedVersion)
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
