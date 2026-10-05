import { formatISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessMemberRow, MemberRole, ReportEmailSetting } from './types'
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

// Resolves the caller's own active membership row for a business (ADR 0014
// §6 — the capability-gate echo). Returns null when the user has no active
// membership row (e.g. the owner before/without a backfilled row — callers
// fall back to owner semantics via resolveMemberContext).
export async function getMemberForUser(
  client: SupabaseClient,
  businessId: string,
  userId: string,
): Promise<BusinessMemberRow | null> {
  const { data, error } = await client
    .from('business_members')
    .select('*')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as BusinessMemberRow) ?? null
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

// Changes a member's role/admin flag (§5.3) — a normal UPDATE under
// business_members_update (user_can(...,'manage_members')). The primary-admin
// protection trigger (21A-B1) blocks demoting the owner's own row.
export async function changeMemberRole(
  client: SupabaseClient,
  memberId: string,
  role: MemberRole,
  isAdmin: boolean,
): Promise<BusinessMemberRow> {
  const { data, error } = await client
    .from('business_members')
    .update({ role, is_admin: isAdmin })
    .eq('id', memberId)
    .select('*')
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error(`Business member ${memberId} not found`)
  return data as BusinessMemberRow
}

// Re-issues an invite on the SAME reserved row (§4.4 resend) — refreshes
// invited_at so the RPC's own DB-side expiry guard (invited_at > now()-7d,
// accept_invite.sql) doesn't still reject an app-side-refreshed token. Status
// stays 'invited'; no new row is inserted (would double-count the seat and
// trip the (business_id, lower(email)) partial unique index).
export async function reissueInvite(
  client: SupabaseClient,
  memberId: string,
): Promise<BusinessMemberRow> {
  const { data, error } = await client
    .from('business_members')
    .update({ invited_at: formatISO(new Date()) })
    .eq('id', memberId)
    .eq('status', 'invited')
    .select('*')
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error(`Business member ${memberId} not found or not in invited status`)
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

// ADR 0031 §5.4, REPORT-MEMBERS-ONLY — the ONE source of a monthly report's recipients. Service-role (the report worker
// has no user), lazy-imported, no client parameter. The address comes from the member row and nowhere else: ONE business,
// status 'active' and bound to a user (an invited or revoked row, or an address with no account behind it, never
// receives a report). 'admins' (the default) is the active admins, owner included; 'all_members' widens to every active
// member; 'off' and any unrecognised value return nobody and do not query (fail closed). Call it immediately before
// enqueue so a member revoked after the report was generated is not mailed.
export const REPORT_RECIPIENT_MAX = 200

export interface ReportRecipient {
  /** The immutable `business_members.id`: the dedupe token uses it, never the email (no PII in the index). */
  id: string
  email: string
}

export async function resolveReportRecipients(
  businessId: string,
  setting: ReportEmailSetting,
): Promise<ReportRecipient[]> {
  if (setting !== 'admins' && setting !== 'all_members') return []
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  let query = client
    .from('business_members')
    .select('id, email')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .not('user_id', 'is', null)
  if (setting === 'admins') query = query.eq('is_admin', true)
  const { data, error } = await query.order('created_at', { ascending: true }).limit(REPORT_RECIPIENT_MAX)
  if (error) throw new Error(getErrorMessage(error))
  return ((data as Array<{ id: string; email: string }> | null) ?? []).map((m) => ({ id: m.id, email: m.email }))
}
