import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/business-members', () => ({
  createInvite: vi.fn(),
  changeMemberRole: vi.fn(),
  revokeMember: vi.fn(),
  reissueInvite: vi.fn(),
}))
vi.mock('@/lib/members/enforcement', () => ({ checkInviteAllowed: vi.fn() }))
vi.mock('@/lib/members/invite-token', () => ({ signInviteToken: vi.fn().mockResolvedValue('signed-jwt') }))
vi.mock('@/lib/email/triggers/invite', () => ({ enqueueTeamInvite: vi.fn().mockResolvedValue({ outcome: 'enqueued' }) }))
vi.mock('@/lib/members/can-server', () => ({ canServer: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { createInvite, changeMemberRole, revokeMember, reissueInvite } from '@/lib/db/business-members'
import { checkInviteAllowed } from '@/lib/members/enforcement'
import { enqueueTeamInvite } from '@/lib/email/triggers/invite'
import { canServer } from '@/lib/members/can-server'
import {
  inviteMemberAction,
  changeMemberRoleAction,
  revokeMemberAction,
  resendInviteAction,
} from './actions'

const MOCK_USER = { id: 'admin-1', user_metadata: { full_name: 'Jamie Admin' } }
const MOCK_BUSINESS = { id: 'biz-1', name: 'Acme Corp', language: 'en', owner_id: 'admin-1' }
const MOCK_MEMBER = {
  id: 'member-1',
  business_id: 'biz-1',
  user_id: null,
  email: 'invitee@company.com',
  role: 'editor' as const,
  is_admin: false,
  status: 'invited' as const,
  invited_by: 'admin-1',
  invited_at: '2026-07-01T00:00:00Z',
  accepted_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

function mockAuthClient() {
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) } }
  vi.mocked(createClient).mockResolvedValue(client as unknown as SupabaseClient)
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthClient()
  vi.mocked(getBusinessForUser).mockResolvedValue(MOCK_BUSINESS as never)
  vi.mocked(canServer).mockResolvedValue(true)
  vi.mocked(checkInviteAllowed).mockResolvedValue({
    allowed: true,
    seats: { used: 3, max: 10, remaining: 7, atCap: false, overage: 0 },
  })
  vi.mocked(createInvite).mockResolvedValue(MOCK_MEMBER as never)
  vi.mocked(reissueInvite).mockResolvedValue(MOCK_MEMBER as never)
  vi.mocked(changeMemberRole).mockResolvedValue({ ...MOCK_MEMBER, role: 'approver' } as never)
  vi.mocked(revokeMember).mockResolvedValue({ ...MOCK_MEMBER, status: 'revoked' } as never)
})

function makeInviteFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('email', 'invitee@company.com')
  fd.set('role', 'editor')
  fd.set('isAdmin', 'false')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

describe('inviteMemberAction — SEAT-INVITE-FAILFAST-ECHO (app-layer)', () => {
  it('blocks with a typed reason BEFORE createInvite when seats are at cap', async () => {
    vi.mocked(checkInviteAllowed).mockResolvedValue({
      allowed: false,
      reason: 'seat_cap_reached',
      seats: { used: 10, max: 10, remaining: 0, atCap: true, overage: 0 },
    })

    const result = await inviteMemberAction({}, makeInviteFormData())

    expect(result).toEqual({ error: 'errors.seat_cap_reached' })
    expect(createInvite).not.toHaveBeenCalled()
  })

  it('blocks with a typed reason BEFORE createInvite when overage-locked', async () => {
    vi.mocked(checkInviteAllowed).mockResolvedValue({
      allowed: false,
      reason: 'overage_locked',
      seats: { used: 15, max: 10, remaining: -5, atCap: true, overage: 5 },
    })

    const result = await inviteMemberAction({}, makeInviteFormData())

    expect(result).toEqual({ error: 'errors.overage_locked' })
    expect(createInvite).not.toHaveBeenCalled()
  })

  it('rejects a free-provider email before checking seats at all (work-email rule reused from signup)', async () => {
    const result = await inviteMemberAction({}, makeInviteFormData({ email: 'invitee@gmail.com' }))

    expect(result.error).toBe('errors.email.work_required')
    expect(checkInviteAllowed).not.toHaveBeenCalled()
    expect(createInvite).not.toHaveBeenCalled()
  })

  it('creates the invite, signs a token, and enqueues team-invite when allowed', async () => {
    const result = await inviteMemberAction({}, makeInviteFormData())

    expect(result).toEqual({ success: true })
    expect(createInvite).toHaveBeenCalledWith(expect.anything(), {
      businessId: 'biz-1',
      email: 'invitee@company.com',
      role: 'editor',
      isAdmin: false,
      invitedBy: 'admin-1',
    })
    expect(enqueueTeamInvite).toHaveBeenCalledWith({
      memberId: 'member-1',
      businessId: 'biz-1',
      recipientEmail: 'invitee@company.com',
      locale: 'en',
      inviterName: 'Jamie Admin',
      businessName: 'Acme Corp',
      roleLabelKey: 'team_invite.role.editor',
    })
  })

  it('returns a typed error when createInvite throws (e.g. the DB trigger rejects it)', async () => {
    vi.mocked(createInvite).mockRejectedValue(new Error('seat cap reached for plan'))
    const result = await inviteMemberAction({}, makeInviteFormData())
    expect(result).toEqual({ error: 'errors.invite_failed' })
    expect(enqueueTeamInvite).not.toHaveBeenCalled()
  })
})

describe('changeMemberRoleAction — UI-ROLE-CONFIRM (app-layer)', () => {
  it('updates the role and returns success', async () => {
    const fd = new FormData()
    fd.set('memberId', 'member-1')
    fd.set('role', 'approver')
    fd.set('isAdmin', 'false')

    const result = await changeMemberRoleAction({}, fd)

    expect(result).toEqual({ success: true })
    expect(changeMemberRole).toHaveBeenCalledWith(expect.anything(), 'member-1', 'approver', false)
  })

  it('returns a typed error when the primary-admin protection trigger rejects the change', async () => {
    vi.mocked(changeMemberRole).mockRejectedValue(
      new Error('primary admin membership cannot be demoted, revoked, or rebound'),
    )
    const fd = new FormData()
    fd.set('memberId', 'owner-member-id')
    fd.set('role', 'viewer')
    fd.set('isAdmin', 'false')

    const result = await changeMemberRoleAction({}, fd)
    expect(result).toEqual({ error: 'errors.role_change_failed' })
  })
})

describe('revokeMemberAction — UI-REMOVE-SOFT', () => {
  it('calls revokeMember (soft status update), never a delete-shaped call', async () => {
    const fd = new FormData()
    fd.set('memberId', 'member-1')

    const result = await revokeMemberAction({}, fd)

    expect(result).toEqual({ success: true })
    expect(revokeMember).toHaveBeenCalledWith(expect.anything(), 'member-1')
  })

  it('returns a typed error when revokeMember throws', async () => {
    vi.mocked(revokeMember).mockRejectedValue(new Error('not found'))
    const fd = new FormData()
    fd.set('memberId', 'missing')

    const result = await revokeMemberAction({}, fd)
    expect(result).toEqual({ error: 'errors.revoke_failed' })
  })
})

describe('resendInviteAction — INV-REISSUE-SAME-ROW (app-layer)', () => {
  it('reissues on the same row (no createInvite call) and re-enqueues team-invite', async () => {
    const fd = new FormData()
    fd.set('memberId', 'member-1')

    const result = await resendInviteAction({}, fd)

    expect(result).toEqual({ success: true })
    expect(reissueInvite).toHaveBeenCalledWith(expect.anything(), 'member-1')
    expect(createInvite).not.toHaveBeenCalled()
    expect(enqueueTeamInvite).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-1', businessId: 'biz-1' }),
    )
  })

  it('returns a typed error when reissueInvite throws', async () => {
    vi.mocked(reissueInvite).mockRejectedValue(new Error('not found or not in invited status'))
    const fd = new FormData()
    fd.set('memberId', 'member-1')

    const result = await resendInviteAction({}, fd)
    expect(result).toEqual({ error: 'errors.resend_failed' })
    expect(enqueueTeamInvite).not.toHaveBeenCalled()
  })
})

// m2 — app-layer capability echo (UX only, L-3: DB RLS/trigger remains the
// real boundary regardless of this check's outcome).
describe('team actions — capability echo (canServer, m2)', () => {
  beforeEach(() => {
    vi.mocked(canServer).mockResolvedValue(false)
  })

  it('inviteMemberAction denies with a typed error before checkInviteAllowed/createInvite', async () => {
    const result = await inviteMemberAction({}, makeInviteFormData())

    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(checkInviteAllowed).not.toHaveBeenCalled()
    expect(createInvite).not.toHaveBeenCalled()
  })

  it('changeMemberRoleAction denies with a typed error before changeMemberRole', async () => {
    const fd = new FormData()
    fd.set('memberId', 'member-1')
    fd.set('role', 'approver')
    fd.set('isAdmin', 'false')

    const result = await changeMemberRoleAction({}, fd)

    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(changeMemberRole).not.toHaveBeenCalled()
  })

  it('revokeMemberAction denies with a typed error before revokeMember', async () => {
    const fd = new FormData()
    fd.set('memberId', 'member-1')

    const result = await revokeMemberAction({}, fd)

    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(revokeMember).not.toHaveBeenCalled()
  })

  it('resendInviteAction denies with a typed error before reissueInvite', async () => {
    const fd = new FormData()
    fd.set('memberId', 'member-1')

    const result = await resendInviteAction({}, fd)

    expect(result).toEqual({ error: 'errors.forbidden' })
    expect(reissueInvite).not.toHaveBeenCalled()
    expect(enqueueTeamInvite).not.toHaveBeenCalled()
  })
})
