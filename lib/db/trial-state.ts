import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrialStateRow, TrialStatePublicRow } from './types'

const PUBLIC_COLUMNS =
  'id,business_id,trial_started_at,campaigns_created_count,posts_generated_count,work_email_verified,created_at,updated_at'

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
