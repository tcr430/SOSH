import { formatISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignRow, CampaignInsert, CampaignUpdate } from './types'

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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error(`Campaign ${id} not found`)
  return row as CampaignRow
}

export async function activateCampaign(
  client: SupabaseClient,
  id: string,
  totalPostsPlanned: number,
): Promise<CampaignRow | null> {
  const { data, error } = await client
    .from('campaigns')
    .update({ status: 'active', total_posts_planned: totalPostsPlanned })
    .eq('id', id)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select()
    .maybeSingle()
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
  return (data as CampaignRow | null) ?? null
}

export async function softDeleteCampaignGuarded(
  client: SupabaseClient,
  id: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('campaigns')
    .update({ deleted_at: formatISO(new Date()) })
    .eq('id', id)
    .in('status', ['draft', 'completed'])
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
  return count ?? 0
}
