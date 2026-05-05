import { formatISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CampaignRow, CampaignInsert, CampaignUpdate } from './types'

export async function listCampaigns(
  client: SupabaseClient,
  businessId: string,
): Promise<CampaignRow[]> {
  const { data, error } = await client
    .from('campaigns')
    .select('*')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
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

export async function softDeleteCampaign(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from('campaigns')
    .update({ deleted_at: formatISO(new Date()) })
    .eq('id', id)
  if (error) throw new Error((error as { message: string }).message)
}
