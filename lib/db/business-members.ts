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
// member row — backfilled for pre-21A-D businesses by M7's one-time DML, and
// auto-provisioned go-forward by the ensure_owner_membership AFTER INSERT
// trigger (M9, 21A-D/MAJOR-1) — so it's counted naturally, no special-case.
// status='revoked' excluded.
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

function isPostgresError(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && typeof (e as { code: unknown }).code === 'string' &&
    'message' in e && typeof (e as { message: unknown }).message === 'string'
  )
}

export type AcceptInviteResult =
  | { outcome: 'accepted'; row: BusinessMemberRow }
  | { outcome: 'already_member' }

// Wraps the accept_invite SECURITY DEFINER RPC (§7.3) — the only correct
// mechanism for a not-yet-member to bind their own row. The RPC raises a
// distinct 23505 for "already an active member" (ADR 0014 §4.2) so the
// accept route can show a friendly message instead of the generic invalid
// state; any other RPC failure (email-mismatch / expired / claimed / unknown)
// is intentionally ambiguous and surfaces as a thrown error (§4.3 anti-enum).
export async function acceptInvite(
  client: SupabaseClient,
  memberId: string,
  businessId: string,
): Promise<AcceptInviteResult> {
  const { data, error } = await client.rpc('accept_invite', {
    p_member_id: memberId,
    p_business_id: businessId,
  })
  if (error) {
    if (isPostgresError(error) && error.code === '23505') {
      return { outcome: 'already_member' }
    }
    throw new Error(getErrorMessage(error))
  }
  return { outcome: 'accepted', row: data as BusinessMemberRow }
}
