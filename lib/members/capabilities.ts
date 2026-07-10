// ADR 0013 §4 — app-layer echo of the capability strings enforced by the
// DB-side user_can(business_id, capability) function. These constants exist so
// call sites reference a name, not a bare string, and so a typo is caught at
// compile time; the DB CASE in user_can() remains the real boundary (L-10).

import type { MemberRole } from '@/lib/db/types'

export const CAPABILITIES = {
  AUTHOR: 'author',
  RESCHEDULE: 'reschedule',
  APPROVE: 'approve',
  CONNECT_ACCOUNTS: 'connect_accounts',
  MANAGE_MEMBERS: 'manage_members',
  MANAGE_BILLING: 'manage_billing',
} as const

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

// ADR 0014 §6 — the capability-gate retrofit. This ECHOES user_can(); it is
// UX, never the security boundary (L-3). The DB (RLS + triggers) already
// denies; this only stops a user from being invited to click a control that
// will fail.

export type MemberCapabilityContext = { role: MemberRole; isAdmin: boolean }

// Mirrors the SQL CASE in user_can() exactly
// (supabase/migrations/20260702120200_user_can.sql:35-43). Keep in sync.
export function hasCapability(ctx: MemberCapabilityContext, capability: Capability): boolean {
  switch (capability) {
    case CAPABILITIES.AUTHOR:
    case CAPABILITIES.RESCHEDULE:
      return ctx.role === 'editor' || ctx.role === 'approver'
    case CAPABILITIES.APPROVE:
      return ctx.role === 'approver'
    case CAPABILITIES.CONNECT_ACCOUNTS:
      return ctx.role === 'approver' || ctx.isAdmin
    case CAPABILITIES.MANAGE_MEMBERS:
    case CAPABILITIES.MANAGE_BILLING:
      return ctx.isAdmin
    default:
      return false
  }
}

// Mirrors user_can()'s owner-override branch (SQL lines 20-22): the owner is
// always approver+admin, independent of any member row. Falls back to the
// resolved member row, else the least-privileged viewer context (should not
// normally be reached — the dashboard layout only renders for owner ∪
// active member, per ADR 0014 §2).
export function resolveMemberContext(
  business: { owner_id: string },
  userId: string,
  member: { role: MemberRole; is_admin: boolean } | null,
): MemberCapabilityContext {
  if (business.owner_id === userId) return { role: 'approver', isAdmin: true }
  if (member) return { role: member.role, isAdmin: member.is_admin }
  return { role: 'viewer', isAdmin: false }
}
