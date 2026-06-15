import type { SupabaseClient } from '@supabase/supabase-js'

export type DeletionRequestStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'abandoned'

export interface DeletionRequestRow {
  id: string
  business_id: string
  requested_at: string
  verified_at: string | null
  scheduled_purge_at: string | null
  purged_at: string | null
  status: DeletionRequestStatus
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
  updated_at: string
}

export type PurgeResult =
  | { already_purged: true; business_id: string }
  | {
      already_purged: false
      business_id: string
      vault_secrets_deleted: number
      billing_events_redacted: number
      purged_at: string
    }

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

function dbError(e: unknown): Error {
  return new Error(isPostgresError(e) ? e.message : 'Database error')
}

export async function claimDeletionRequests(
  client: SupabaseClient,
  limit: number,
  retentionDays: number,
  maxAttempts: number,
): Promise<DeletionRequestRow[]> {
  const { data, error } = await client.rpc('claim_deletion_requests', {
    p_limit: limit,
    p_retention_days: retentionDays,
    p_max_attempts: maxAttempts,
  })
  if (error) throw dbError(error)
  return (data ?? []) as DeletionRequestRow[]
}

export async function transitionDeletionRequest(
  client: SupabaseClient,
  id: string,
  update: Partial<
    Pick<
      DeletionRequestRow,
      'status' | 'attempts' | 'next_attempt_at' | 'last_error' | 'purged_at'
    >
  >,
): Promise<void> {
  const { error } = await client
    .from('business_deletion_requests')
    .update(update)
    .eq('id', id)
    .eq('status', 'processing')
  if (error) throw dbError(error)
}

export async function purgeBusiness(
  client: SupabaseClient,
  businessId: string,
): Promise<PurgeResult> {
  const { data, error } = await client.rpc('purge_business', {
    p_business_id: businessId,
  })
  if (error) throw dbError(error)
  return data as PurgeResult
}

export async function getBusinessOwnerId(
  client: SupabaseClient,
  businessId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('businesses')
    .select('owner_id')
    .eq('id', businessId)
    .maybeSingle()
  if (error) throw dbError(error)
  return (data as { owner_id: string } | null)?.owner_id ?? null
}

export async function countRemainingBusinesses(
  client: SupabaseClient,
  ownerId: string,
): Promise<number> {
  const { count, error } = await client
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
  if (error) throw dbError(error)
  return count ?? 0
}
