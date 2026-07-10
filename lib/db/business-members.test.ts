import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  getMemberById,
  getMemberForUser,
  listMembers,
  countSeatUsage,
  createInvite,
  changeMemberRole,
  reissueInvite,
  revokeMember,
  acceptInvite,
} from './business-members'
import type { BusinessMemberRow } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

// Mirrors lib/db/ai-usage.test.ts's makeCountClient — countSeatUsage issues two
// sequential count queries (status='active' then status='invited'); the mock
// tracks the last .eq('status', …) call to return the right count for each.
function makeSeatCountClient(activeCount: number | null, pendingCount: number | null) {
  let lastStatus: string | undefined
  const builder: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown) => {
      const count = lastStatus === 'active' ? activeCount : pendingCount
      return Promise.resolve({ count, error: null }).then(res)
    },
  }
  builder.select = vi.fn().mockReturnValue(builder)
  builder.eq = vi.fn((col: string, val: string) => {
    if (col === 'status') lastStatus = val
    return builder
  })
  const client = { from: vi.fn().mockReturnValue(builder) }
  return client as unknown as SupabaseClient
}

const mockMember: BusinessMemberRow = {
  id: 'member-1',
  business_id: 'biz-1',
  user_id: 'user-1',
  email: 'owner@example.com',
  role: 'approver',
  is_admin: true,
  status: 'active',
  invited_by: null,
  invited_at: '2026-07-02T12:00:00Z',
  accepted_at: '2026-07-02T12:00:00Z',
  created_at: '2026-07-02T12:00:00Z',
  updated_at: '2026-07-02T12:00:00Z',
}

describe('getMemberById', () => {
  it('returns a member when found', async () => {
    const { client } = createMockClient(mockMember)
    const result = await getMemberById(client, 'member-1')
    expect(result).toEqual(mockMember)
    expect(client.from).toHaveBeenCalledWith('business_members')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getMemberById(client, 'member-1')).rejects.toThrow('DB error')
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(getMemberById(client, 'missing')).rejects.toThrow('Business member missing not found')
  })
})

describe('getMemberForUser', () => {
  it('returns the active member row for this business + user', async () => {
    const { client, builder } = createMockClient(mockMember)
    const result = await getMemberForUser(client, 'biz-1', 'user-1')
    expect(result).toEqual(mockMember)
    expect(client.from).toHaveBeenCalledWith('business_members')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'active')
  })

  it('returns null when no active membership row exists (e.g. owner fallback case)', async () => {
    const { client } = createMockClient(null, null)
    const result = await getMemberForUser(client, 'biz-1', 'user-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getMemberForUser(client, 'biz-1', 'user-1')).rejects.toThrow('DB error')
  })
})

describe('listMembers', () => {
  it('returns list of members ordered by created_at ascending, bounded by limit', async () => {
    const { client, builder } = createMockClient([mockMember])
    const result = await listMembers(client, 'biz-1')
    expect(result).toEqual([mockMember])
    expect(client.from).toHaveBeenCalledWith('business_members')
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  it('respects an explicit limit', async () => {
    const { client, builder } = createMockClient([mockMember])
    await listMembers(client, 'biz-1', 10)
    expect(builder.limit).toHaveBeenCalledWith(10)
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listMembers(client, 'biz-1')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listMembers(client, 'biz-1')).rejects.toThrow('DB error')
  })
})

describe('countSeatUsage', () => {
  it('returns active and pending counts', async () => {
    const client = makeSeatCountClient(3, 2)
    const result = await countSeatUsage(client, 'biz-1')
    expect(result).toEqual({ activeCount: 3, pendingCount: 2 })
  })

  it('defaults null counts to 0', async () => {
    const client = makeSeatCountClient(null, null)
    const result = await countSeatUsage(client, 'biz-1')
    expect(result).toEqual({ activeCount: 0, pendingCount: 0 })
  })
})

describe('createInvite', () => {
  it('inserts a reserved invited row, lower-casing the email', async () => {
    const invited: BusinessMemberRow = { ...mockMember, id: 'member-2', email: 'new@example.com', status: 'invited', user_id: null }
    const { client, builder } = createMockClient(invited)
    const result = await createInvite(client, {
      businessId: 'biz-1',
      email: 'NEW@Example.com',
      role: 'editor',
      invitedBy: 'user-1',
    })
    expect(result).toEqual(invited)
    expect(builder.insert).toHaveBeenCalledWith({
      business_id: 'biz-1',
      email: 'new@example.com',
      role: 'editor',
      is_admin: false,
      invited_by: 'user-1',
      status: 'invited',
    })
  })

  it('throws when supabase returns an error (e.g. seat cap trigger rejection)', async () => {
    const { client } = createMockClient(null, { message: 'seat cap reached for plan (10 of 10 seats used)' })
    await expect(
      createInvite(client, { businessId: 'biz-1', email: 'x@example.com', role: 'viewer', invitedBy: 'user-1' }),
    ).rejects.toThrow('seat cap reached')
  })
})

describe('changeMemberRole', () => {
  it('updates role and is_admin', async () => {
    const updated: BusinessMemberRow = { ...mockMember, role: 'approver', is_admin: true }
    const { client, builder } = createMockClient(updated)
    const result = await changeMemberRole(client, 'member-1', 'approver', true)
    expect(result).toEqual(updated)
    expect(builder.update).toHaveBeenCalledWith({ role: 'approver', is_admin: true })
  })

  it('throws when the primary-admin protection trigger rejects the update', async () => {
    const { client } = createMockClient(null, {
      message: 'primary admin membership cannot be demoted, revoked, or rebound',
    })
    await expect(changeMemberRole(client, 'member-1', 'viewer', false)).rejects.toThrow(
      'primary admin membership cannot be demoted',
    )
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(changeMemberRole(client, 'missing', 'viewer', false)).rejects.toThrow(
      'Business member missing not found',
    )
  })
})

describe('reissueInvite', () => {
  it('refreshes invited_at on the same row, scoped to status=invited', async () => {
    const reissued: BusinessMemberRow = { ...mockMember, invited_at: '2026-07-09T00:00:00Z' }
    const { client, builder } = createMockClient(reissued)
    const result = await reissueInvite(client, 'member-1')
    expect(result).toEqual(reissued)
    expect(builder.eq).toHaveBeenCalledWith('id', 'member-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'invited')
  })

  it('throws when the row is missing or not in invited status', async () => {
    const { client } = createMockClient(null, null)
    await expect(reissueInvite(client, 'member-1')).rejects.toThrow(
      'Business member member-1 not found or not in invited status',
    )
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(reissueInvite(client, 'member-1')).rejects.toThrow('DB error')
  })
})

describe('revokeMember', () => {
  it('updates status to revoked', async () => {
    const revoked: BusinessMemberRow = { ...mockMember, status: 'revoked' }
    const { client, builder } = createMockClient(revoked)
    const result = await revokeMember(client, 'member-1')
    expect(result).toEqual(revoked)
    expect(builder.update).toHaveBeenCalledWith({ status: 'revoked' })
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(revokeMember(client, 'missing')).rejects.toThrow('Business member missing not found')
  })
})

describe('acceptInvite', () => {
  it('calls the accept_invite RPC with the right params and returns outcome accepted', async () => {
    const { client } = createMockClient(mockMember)
    const result = await acceptInvite(client, 'member-1', 'biz-1')
    expect(result).toEqual({ outcome: 'accepted', row: mockMember })
    expect(client.rpc).toHaveBeenCalledWith('accept_invite', {
      p_member_id: 'member-1',
      p_business_id: 'biz-1',
    })
  })

  it('returns outcome already_member on a 23505 unique_violation', async () => {
    const { client } = createMockClient(null, {
      code: '23505',
      message: 'already an active member of this business',
    })
    const result = await acceptInvite(client, 'member-1', 'biz-1')
    expect(result).toEqual({ outcome: 'already_member' })
  })

  it('throws (anti-enum, generic) when the RPC returns any other error', async () => {
    const { client } = createMockClient(null, { message: 'invite not available' })
    await expect(acceptInvite(client, 'member-1', 'biz-1')).rejects.toThrow('invite not available')
  })
})
