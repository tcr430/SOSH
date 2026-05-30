import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrialStateRow, TrialStatePublicRow } from './types'

const PUBLIC_COLUMNS =
  'id,business_id,trial_started_at,campaigns_created_count,posts_generated_count,brand_voice_inference_attempts,work_email_verified,created_at,updated_at'

export async function getTrialState(
  client: SupabaseClient,
  businessId: string,
): Promise<TrialStatePublicRow> {
  const { data, error } = await client
    .from('trial_state')
    .select(PUBLIC_COLUMNS)
    .eq('business_id', businessId)
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!data) throw new Error(`Trial state for business ${businessId} not found`)
  return data as TrialStatePublicRow
}

export async function getTrialStateMaybe(
  client: SupabaseClient,
  businessId: string,
): Promise<TrialStatePublicRow | null> {
  const { data, error } = await client
    .from('trial_state')
    .select(PUBLIC_COLUMNS)
    .eq('business_id', businessId)
    .maybeSingle()
  if (error) throw new Error((error as { message: string }).message)
  return (data as TrialStatePublicRow | null) ?? null
}

export async function incrementBrandVoiceAttempts(businessId: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client.rpc('increment_brand_voice_attempts', { p_business_id: businessId })
  if (error) throw new Error((error as { message: string }).message)
}

export async function incrementPostsGenerated(businessId: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client.rpc('increment_posts_generated', { p_business_id: businessId })
  if (error) throw new Error((error as { message: string }).message)
}

export async function incrementCampaignsCreated(businessId: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client.rpc('increment_campaigns_created', { p_business_id: businessId })
  if (error) throw new Error((error as { message: string }).message)
}

export async function incrementPostsGeneratedBy(businessId: string, amount: number): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client.rpc('increment_posts_generated_by', {
    p_business_id: businessId,
    p_amount: amount,
  })
  if (error) throw new Error((error as { message: string }).message)
}

export async function getTrialStateForBilling(
  businessId: string,
): Promise<TrialStateRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('trial_state')
    .select('*')
    .eq('business_id', businessId)
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!data) throw new Error(`Trial state for business ${businessId} not found`)
  return data as TrialStateRow
}

export async function recordTrialCardFingerprint(input: {
  businessId: string
  fingerprint: string
}): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('trial_state')
    .update({ trial_card_fingerprint: input.fingerprint })
    .eq('business_id', input.businessId)
    .is('trial_card_fingerprint', null)
  if (error) throw new Error((error as { message: string }).message)
}
