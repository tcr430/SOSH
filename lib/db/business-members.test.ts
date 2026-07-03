import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { getMemberById, listMembers, countSeatUsage } from './business-members'
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
