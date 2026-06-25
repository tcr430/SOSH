import type { SupabaseClient } from '@supabase/supabase-js'
import type { VoiceAxes } from '@/lib/validation/voice'
import type { BrandVoiceVariationRow } from './types'
import { getErrorMessage } from './utils'

function isPostgresError(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string' &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  )
}

export class VoiceVariationCapError extends Error {
  override name = 'VoiceVariationCapError'
  constructor() {
    super('Voice variation cap reached (max 5 per business)')
  }
}

export async function createVoiceVariation(params: {
  businessId: string
  name: string
  voiceAxes: VoiceAxes
}): Promise<BrandVoiceVariationRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const { data, error } = await client.rpc('create_voice_variation', {
    p_business_id: params.businessId,
    p_name: params.name,
    p_voice_axes: params.voiceAxes,
  })

  if (error) {
    if (isPostgresError(error) && error.message === 'voice_variation_cap_reached') {
      throw new VoiceVariationCapError()
    }
    throw new Error(isPostgresError(error) ? error.message : 'Database error')
  }

  return data as BrandVoiceVariationRow
}

/** Public alias for Server Action callers — cap is enforced in the RPC (D-B). */
export async function addVariation(params: {
  businessId: string
  name: string
  voiceAxes: VoiceAxes
}): Promise<BrandVoiceVariationRow> {
  return createVoiceVariation(params)
}

export async function renameVariation(
  client: SupabaseClient,
  id: string,
  name: string,
): Promise<void> {
  const { error } = await client
    .from('brand_voice_variations')
    .update({ name })
    .eq('id', id)
  if (error) throw new Error(getErrorMessage(error))
}

export async function listVariations(
  client: SupabaseClient,
  businessId: string,
): Promise<BrandVoiceVariationRow[]> {
  const { data, error } = await client
    .from('brand_voice_variations')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(getErrorMessage(error))
  return (data as BrandVoiceVariationRow[]) ?? []
}

export async function updateVariationAxes(
  client: SupabaseClient,
  id: string,
  voiceAxes: VoiceAxes,
): Promise<void> {
  const { error } = await client
    .from('brand_voice_variations')
    .update({ voice_axes: voiceAxes })
    .eq('id', id)
  if (error) throw new Error(getErrorMessage(error))
}
