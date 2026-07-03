import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessMemberRow, MemberRole } from './types'
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

// Reserves a business_members row for an invite (§7.1). The seat-cap trigger
// from 21A-B4 (enforce_seat_cap) is the boundary — this insert fails if the
// business is at or over its plan's max seats.
export async function createInvite(
  client: SupabaseClient,
  input: {
    businessId: string
    email: string
    role: MemberRole
    isAdmin?: boolean
    invitedBy: string
  },
): Promise<BusinessMemberRow> {
  const { data, error } = await client
    .from('business_members')
    .insert({
      business_id: input.businessId,
      email: input.email.toLowerCase(),
      role: input.role,
      is_admin: input.isAdmin ?? false,
      invited_by: input.invitedBy,
      status: 'invited',
    })
    .select('*')
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as BusinessMemberRow
}

// Revokes a member/invite (§7.4) — a normal UPDATE under business_members_update
// (user_can(...,'manage_members')). Frees the seat; the primary-admin protection
// trigger (21A-B1) blocks revoking the primary admin.
export async function revokeMember(
  client: SupabaseClient,
  memberId: string,
): Promise<BusinessMemberRow> {
  const { data, error } = await client
    .from('business_members')
    .update({ status: 'revoked' })
    .eq('id', memberId)
    .select('*')
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error(`Business member ${memberId} not found`)
  return data as BusinessMemberRow
}

// Wraps the accept_invite SECURITY DEFINER RPC (§7.3) — the only correct
// mechanism for a not-yet-member to bind their own row.
export async function acceptInvite(
  client: SupabaseClient,
  memberId: string,
  businessId: string,
): Promise<BusinessMemberRow> {
  const { data, error } = await client.rpc('accept_invite', {
    p_member_id: memberId,
    p_business_id: businessId,
  })
  if (error) throw new Error(getErrorMessage(error))
  return data as BusinessMemberRow
}
