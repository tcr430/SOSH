import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessMemberRow } from './types'
import { getErrorMessage } from './utils'

export async function getMemberById(
  client: SupabaseClient,
  id: string,
): Promise<BusinessMemberRow> {
  const { data, error } = await client
    .from('business_members')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error(`Business member ${id} not found`)
  return data as BusinessMemberRow
}

export async function listMembers(
  client: SupabaseClient,
  businessId: string,
  limit = 50,
): Promise<BusinessMemberRow[]> {
  const { data, error } = await client
    .from('business_members')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as BusinessMemberRow[]) ?? []
}

// Counts active + pending (invited) members for a business. Owner is an active
// member row (backfill) → counted naturally, no special-case. status='revoked' excluded.
export async function countSeatUsage(
  client: SupabaseClient,
  businessId: string,
): Promise<{ activeCount: number; pendingCount: number }> {
  const { count: activeCount, error: activeError } = await client
    .from('business_members')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'active')
  if (activeError) throw new Error(getErrorMessage(activeError))

  const { count: pendingCount, error: pendingError } = await client
    .from('business_members')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'invited')
  if (pendingError) throw new Error(getErrorMessage(pendingError))

  return { activeCount: activeCount ?? 0, pendingCount: pendingCount ?? 0 }
}
