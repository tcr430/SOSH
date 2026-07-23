import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignRow, CampaignInsert, CampaignUpdate } from './types'
import { getErrorMessage } from './utils'
import { toUtcIso } from '@/lib/utils'

export async function listCampaigns(
  client: SupabaseClient,
  businessId: string,
  limit = 100,
): Promise<CampaignRow[]> {
  const { data, error } = await client
    .from('campaigns')
    .select('*')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignRow[]) ?? []
}

export async function getCampaignById(
  client: SupabaseClient,
  id: string,
): Promise<CampaignRow> {
  const { data, error } = await client
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error(`Campaign ${id} not found`)
  return data as CampaignRow
}

export async function createCampaign(
  client: SupabaseClient,
  data: CampaignInsert,
): Promise<CampaignRow> {
  const { data: row, error } = await client
    .from('campaigns')
    .insert(data)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error('Failed to create campaign')
  return row as CampaignRow
}

export async function updateCampaign(
  client: SupabaseClient,
  id: string,
  data: CampaignUpdate,
): Promise<CampaignRow> {
  const { data: row, error } = await client
    .from('campaigns')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Campaign ${id} not found`)
  return row as CampaignRow
}

// ADR 0017 §11 — Stage A's atomic pause point: brief assembly moves a
// campaign out of the old one-shot 'draft' generation path into
// 'awaiting_brief', where it stays until the brief pipeline (B2.1-B2.5)
// approves and generates. Mirrors activateCampaign's guard shape exactly.
export async function moveCampaignToAwaitingBrief(
  client: SupabaseClient,
  id: string,
): Promise<CampaignRow | null> {
  const { data, error } = await client
    .from('campaigns')
    .update({ status: 'awaiting_brief' })
    .eq('id', id)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignRow | null) ?? null
}

// ADR 0017 §11 — sole caller is generate.ts:210 (confirmed via git grep;
// safe to change the guard in place rather than add a parallel function).
// Guard moved from 'draft' to 'awaiting_brief': generation is now gated on
// the brief pipeline (draft -[assembleBrief]-> awaiting_brief -[approved
// brief, Stage D]-> active), not the old one-shot 'draft' entry point.
export async function activateCampaign(
  client: SupabaseClient,
  id: string,
  totalPostsPlanned: number,
): Promise<CampaignRow | null> {
  const { data, error } = await client
    .from('campaigns')
    .update({ status: 'active', total_posts_planned: totalPostsPlanned })
    .eq('id', id)
    .eq('status', 'awaiting_brief')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignRow | null) ?? null
}

export async function pauseCampaign(
  client: SupabaseClient,
  id: string,
): Promise<CampaignRow | null> {
  const { data, error } = await client
    .from('campaigns')
    .update({ status: 'paused' })
    .eq('id', id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignRow | null) ?? null
}

export async function resumeCampaign(
  client: SupabaseClient,
  id: string,
): Promise<CampaignRow | null> {
  const { data, error } = await client
    .from('campaigns')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('status', 'paused')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as CampaignRow | null) ?? null
}

export async function softDeleteCampaignGuarded(
  client: SupabaseClient,
  id: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('campaigns')
    .update({ deleted_at: toUtcIso(new Date()) })
    .eq('id', id)
    .in('status', ['draft', 'completed'])
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return data !== null
}

export async function countActiveCampaigns(
  client: SupabaseClient,
  businessId: string,
): Promise<number> {
  const { count, error } = await client
    .from('campaigns')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .in('status', ['active', 'draft'])
    .is('deleted_at', null)
  if (error) throw new Error(getErrorMessage(error))
  return count ?? 0
}
