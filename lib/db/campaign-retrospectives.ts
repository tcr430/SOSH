import { z } from 'zod'
import { formatISO } from 'date-fns'
import type { CampaignRetrospectiveInsert, CampaignRetrospectiveRow } from './types'
import { getErrorMessage } from './utils'
import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'

// ADR 0026 §8 (Session 33 J2.6) — the campaign retrospective and the north-star.
//
// Every function here is SERVICE-ROLE, lazy-imported, with NO `client` parameter (CLAUDE.md): the worker
// writes retrospectives, and the human acknowledgement runs through a SECURITY DEFINER RPC that checks
// membership itself. Every list is bounded and ordered on an existing index. The statistics are
// computed in SQL (wilson_bounds, the RPCs) — nothing here re-implements the Wilson formula.

// Same 500-char bound the pattern column CHECK enforces (ADR 0018 Amd A.2, MEM-PATTERN-PROMOTER-BOUNDED).
const PATTERN_BOUND = z.string().min(1).max(500)
const NOTE_BOUND = z.string().max(500)
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

// PostgREST renders a NULL composite as an all-null object — key on the id.
function retrospectiveOrNull(data: unknown): CampaignRetrospectiveRow | null {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || (row as { id?: string | null }).id == null) return null
  return row as CampaignRetrospectiveRow
}

// The worker's write. ON CONFLICT (campaign_id) DO NOTHING: a retrospective is evaluated ONCE, so a
// replayed tick changes nothing (OUTCOME-TICK-IDEMPOTENT). Returns true when a row was written.
export async function insertCampaignRetrospective(insert: CampaignRetrospectiveInsert): Promise<boolean> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('campaign_retrospectives')
    .upsert(insert, { onConflict: 'campaign_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).length > 0
}

// Human-confirmed write-back (ADR 0026 §8.4). `userId` MUST come from supabase.auth.getUser() on the anon
// server client — never a form field; the RPC re-checks it against business_members (active, non-viewer)
// and raises 42501 otherwise. `patternText` embeds member-editable hypothesis text, so it is neutralised
// HERE, inside the wrapper, before it can reach performance_memory. Returns null when the retrospective
// was already acknowledged (a no-op) or does not exist for this business.
export async function acknowledgeRetrospective(input: {
  businessId: string
  campaignId: string
  userId: string
  patternText: string | null
  note?: string | null
}): Promise<CampaignRetrospectiveRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const patternText = input.patternText === null ? null : PATTERN_BOUND.parse(neutralizeWithSentinels(input.patternText))
  const note = input.note == null ? null : NOTE_BOUND.parse(input.note)
  const { data, error } = await client.rpc('acknowledge_campaign_retrospective', {
    p_business_id: input.businessId,
    p_campaign_id: input.campaignId,
    p_user_id: input.userId,
    p_pattern_text: patternText,
    p_note: note,
  })
  if (error) throw new Error(getErrorMessage(error))
  return retrospectiveOrNull(data)
}

export async function getCampaignRetrospective(
  businessId: string,
  campaignId: string,
): Promise<CampaignRetrospectiveRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('campaign_retrospectives')
    .select('*')
    .eq('business_id', businessId)
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignRetrospectiveRow | null) ?? null
}

// A business's retrospectives, newest acknowledgement first — bounded, ordered on
// campaign_retrospectives_business_acknowledged_idx (business_id, acknowledged_at DESC).
export async function listCampaignRetrospectives(
  businessId: string,
  options: { limit?: number } = {},
): Promise<CampaignRetrospectiveRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
  const { data, error } = await client
    .from('campaign_retrospectives')
    .select('*')
    .eq('business_id', businessId)
    .order('acknowledged_at', { ascending: false, nullsFirst: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignRetrospectiveRow[]) ?? []
}

export interface LearningCyclesNorthstar {
  cycles: number
  activeBrands: number
  cyclesPerActiveBrand: number | null
}

// ADR 0026 §8.5 — an ops aggregate (scripts/northstar-report.ts); no customer surface. Counts only.
export async function getLearningCyclesNorthstar(since: Date): Promise<LearningCyclesNorthstar> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('get_learning_cycles_northstar', { p_since: formatISO(since) })
  if (error) throw new Error(getErrorMessage(error))
  const row = (Array.isArray(data) ? data[0] : data) as
    | { cycles: number | string; active_brands: number | string; cycles_per_active_brand: number | string | null }
    | undefined
  return {
    cycles: Number(row?.cycles ?? 0),
    activeBrands: Number(row?.active_brands ?? 0),
    cyclesPerActiveBrand: row?.cycles_per_active_brand == null ? null : Number(row.cycles_per_active_brand),
  }
}

// A thin wrapper over the ONE copy of the formula (public.wilson_bounds). For a caller that must DISPLAY an
// interval (e.g. a retrospective verdict); it is never used to gate anything — the gate is SQL.
export async function wilsonBounds(wins: number, n: number): Promise<{ low: number; high: number }> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('wilson_bounds', { p_wins: wins, p_n: n, p_z: 1.96 })
  if (error) throw new Error(getErrorMessage(error))
  const row = (Array.isArray(data) ? data[0] : data) as { low: number | string; high: number | string }
  return { low: Number(row.low), high: Number(row.high) }
}

// ─── Retrospective inputs (ADR 0026 §8.2, Session 33 J2.11) ───────────────────
// Every function below is service-role (lazy import, NO client parameter), takes a businessId and filters on it,
// and is bounded and ordered on an existing index.

export interface CampaignForRetrospective {
  id: string
  name: string
}

// The business's newest campaigns that have NO retrospective yet. Bounded (default 50) and ordered by
// created_at DESC; a campaign with a retrospective row is never returned again, which is half of
// OUTCOME-TICK-IDEMPOTENT for this phase (the insert's ON CONFLICT is the other half).
export async function listCampaignsAwaitingRetrospective(businessId: string, limit = 50): Promise<CampaignForRetrospective[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const bounded = Math.min(Math.max(limit, 1), 100)
  const { data: campaigns, error } = await client
    .from('campaigns')
    .select('id, name')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(bounded)
  if (error) throw new Error(getErrorMessage(error))
  const rows = (campaigns ?? []) as CampaignForRetrospective[]
  if (rows.length === 0) return []
  const { data: done, error: doneError } = await client
    .from('campaign_retrospectives')
    .select('campaign_id')
    .eq('business_id', businessId)
    .in('campaign_id', rows.map((c) => c.id))
  if (doneError) throw new Error(getErrorMessage(doneError))
  const finished = new Set((done ?? []).map((d) => d.campaign_id as string))
  return rows.filter((c) => !finished.has(c.id))
}

export interface CampaignPostState {
  id: string
  status: string
  published_at: string | null
  role: string | null
}

export async function listCampaignPostStates(businessId: string, campaignId: string, limit = 200): Promise<CampaignPostState[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('posts')
    .select('id, status, published_at, role')
    .eq('business_id', businessId)
    .eq('campaign_id', campaignId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500))
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []) as CampaignPostState[]
}

export interface CampaignOutcomeForVerdict {
  post_id: string
  beat_baseline: boolean | null
  log_lift: number | null
  metric_basis: 'rate' | 'count'
}

// A campaign's frozen outcomes, on post_outcomes_campaign_id_idx.
export async function listOutcomesForCampaign(businessId: string, campaignId: string, limit = 200): Promise<CampaignOutcomeForVerdict[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('post_outcomes')
    .select('post_id, beat_baseline, log_lift, metric_basis')
    .eq('business_id', businessId)
    .eq('campaign_id', campaignId)
    .order('published_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500))
  if (error) throw new Error(getErrorMessage(error))
  return ((data ?? []) as Array<CampaignOutcomeForVerdict & { log_lift: number | string | null }>).map((r) => ({
    ...r,
    log_lift: r.log_lift === null ? null : Number(r.log_lift),
  }))
}

// The campaign's FROZEN brief content (hypothesis and criteria live there). null when there is none.
export async function getFrozenBriefContent(businessId: string, campaignId: string): Promise<Record<string, unknown> | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('campaign_briefs')
    .select('content')
    .eq('business_id', businessId)
    .eq('campaign_id', campaignId)
    .is('deleted_at', null)
    .not('frozen_at', 'is', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return ((data as { content: Record<string, unknown> } | null)?.content) ?? null
}
