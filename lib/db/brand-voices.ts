import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandVoiceRow, BrandVoiceInsert } from './types'

export async function getBrandVoice(
  client: SupabaseClient,
  businessId: string,
): Promise<BrandVoiceRow | null> {
  const { data, error } = await client
    .from('brand_voices')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle()
  if (error) throw new Error((error as { message: string }).message)
  return (data as BrandVoiceRow | null) ?? null
}

export async function upsertBrandVoice(
  client: SupabaseClient,
  data: BrandVoiceInsert,
): Promise<BrandVoiceRow> {
  const { data: row, error } = await client
    .from('brand_voices')
    .upsert(data, { onConflict: 'business_id' })
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error('Failed to upsert brand voice')
  return row as BrandVoiceRow
}
