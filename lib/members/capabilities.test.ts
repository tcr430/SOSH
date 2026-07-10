import { describe, it, expect } from 'vitest'
import { CAPABILITIES, hasCapability, resolveMemberContext } from './capabilities'
import type { MemberCapabilityContext } from './capabilities'

describe('CAPABILITIES', () => {
  it('mirrors the exact capability strings enforced by user_can() (ADR 0013 §4)', () => {
    expect(Object.values(CAPABILITIES).sort()).toEqual(
      [
        'author',
        'reschedule',
        'approve',
        'connect_accounts',
        'manage_members',
        'manage_billing',
      ].sort(),
    )
  })
})

// ADR 0014 §6 — hasCapability mirrors the SQL CASE in user_can() exactly
// (supabase/migrations/20260702120200_user_can.sql:35-43). This is the UI
// echo, never the security boundary (L-3) — but it must match the DB truth
// table row for row so the affordance map is never wrong.
describe('hasCapability', () => {
  const viewer: MemberCapabilityContext = { role: 'viewer', isAdmin: false }
  const editor: MemberCapabilityContext = { role: 'editor', isAdmin: false }
  const approver: MemberCapabilityContext = { role: 'approver', isAdmin: false }
  const adminEditor: MemberCapabilityContext = { role: 'editor', isAdmin: true }
  const ownerLike: MemberCapabilityContext = { role: 'approver', isAdmin: true }

  it('author: editor + approver only', () => {
    expect(hasCapability(viewer, 'author')).toBe(false)
    expect(hasCapability(editor, 'author')).toBe(true)
    expect(hasCapability(approver, 'author')).toBe(true)
  })

  it('reschedule: editor + approver only', () => {
    expect(hasCapability(viewer, 'reschedule')).toBe(false)
    expect(hasCapability(editor, 'reschedule')).toBe(true)
    expect(hasCapability(approver, 'reschedule')).toBe(true)
  })

  it('approve: approver role only (editor denied — the disabled-tooltip case)', () => {
    expect(hasCapability(viewer, 'approve')).toBe(false)
    expect(hasCapability(editor, 'approve')).toBe(false)
    expect(hasCapability(approver, 'approve')).toBe(true)
  })

  it('connect_accounts: approver role OR is_admin (union, 0013 D-4)', () => {
    expect(hasCapability(viewer, 'connect_accounts')).toBe(false)
    expect(hasCapability(editor, 'connect_accounts')).toBe(false)
    expect(hasCapability(approver, 'connect_accounts')).toBe(true)
    expect(hasCapability(adminEditor, 'connect_accounts')).toBe(true)
  })

  it('manage_members: is_admin only', () => {
    expect(hasCapability(approver, 'manage_members')).toBe(false)
    expect(hasCapability(adminEditor, 'manage_members')).toBe(true)
    expect(hasCapability(ownerLike, 'manage_members')).toBe(true)
  })

  it('manage_billing: is_admin only', () => {
    expect(hasCapability(approver, 'manage_billing')).toBe(false)
    expect(hasCapability(adminEditor, 'manage_billing')).toBe(true)
    expect(hasCapability(ownerLike, 'manage_billing')).toBe(true)
  })
})

// resolveMemberContext mirrors user_can()'s owner-override branch (SQL lines
// 20-22): the owner is always approver+admin regardless of any member row.
describe('resolveMemberContext', () => {
  it('owner always resolves to approver + admin, even with a divergent or missing member row', () => {
    expect(
      resolveMemberContext({ owner_id: 'user-1' }, 'user-1', null),
    ).toEqual({ role: 'approver', isAdmin: true })
    expect(
      resolveMemberContext({ owner_id: 'user-1' }, 'user-1', { role: 'viewer', is_admin: false }),
    ).toEqual({ role: 'approver', isAdmin: true })
  })

  it('a non-owner member resolves to their own role/is_admin', () => {
    expect(
      resolveMemberContext({ owner_id: 'owner-1' }, 'user-2', { role: 'editor', is_admin: false }),
    ).toEqual({ role: 'editor', isAdmin: false })
  })

  it('a non-owner with no member row resolves to the least-privileged viewer context', () => {
    expect(
      resolveMemberContext({ owner_id: 'owner-1' }, 'user-2', null),
    ).toEqual({ role: 'viewer', isAdmin: false })
  })
})
