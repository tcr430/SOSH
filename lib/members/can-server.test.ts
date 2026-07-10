import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow, BusinessMemberRow } from '@/lib/db/types'
import * as businessMembersDb from '@/lib/db/business-members'
import { canServer } from './can-server'

vi.mock('@/lib/db/business-members', () => ({
  getMemberForUser: vi.fn(),
}))

const fakeClient = {} as SupabaseClient

function makeBusiness(overrides: Partial<BusinessRow> = {}): BusinessRow {
  return {
    id: 'biz-1',
    name: 'Acme',
    website: null,
    industry: null,
    description: null,
    logo_url: null,
    owner_id: 'owner-1',
    plan: 'plus',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    language: 'en',
    timezone: 'UTC',
    onboarding_completed: true,
    total_posts_published: 0,
    deleted_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

function makeMember(overrides: Partial<BusinessMemberRow> = {}): BusinessMemberRow {
  return {
    id: 'member-1',
    business_id: 'biz-1',
    user_id: 'user-2',
    email: 'member@example.com',
    role: 'editor',
    is_admin: false,
    status: 'active',
    invited_by: null,
    invited_at: '2026-07-02T12:00:00Z',
    accepted_at: '2026-07-02T12:00:00Z',
    created_at: '2026-07-02T12:00:00Z',
    updated_at: '2026-07-02T12:00:00Z',
    ...overrides,
  }
}

describe('canServer — ADR 0014 §6 server-side echo (UX only, DB is the boundary — L-3)', () => {
  beforeEach(() => {
    vi.mocked(businessMembersDb.getMemberForUser).mockReset()
  })

  it('owner always resolves true for admin-only capabilities, without querying membership', async () => {
    const business = makeBusiness({ owner_id: 'owner-1' })
    const result = await canServer(fakeClient, business, 'owner-1', 'manage_billing')
    expect(result).toBe(true)
    expect(businessMembersDb.getMemberForUser).not.toHaveBeenCalled()
  })

  it("an editor member is denied 'approve'", async () => {
    vi.mocked(businessMembersDb.getMemberForUser).mockResolvedValue(makeMember({ role: 'editor', is_admin: false }))
    const business = makeBusiness({ owner_id: 'owner-1' })
    const result = await canServer(fakeClient, business, 'user-2', 'approve')
    expect(result).toBe(false)
  })

  it("an approver member is allowed 'approve'", async () => {
    vi.mocked(businessMembersDb.getMemberForUser).mockResolvedValue(makeMember({ role: 'approver', is_admin: false }))
    const business = makeBusiness({ owner_id: 'owner-1' })
    const result = await canServer(fakeClient, business, 'user-2', 'approve')
    expect(result).toBe(true)
  })

  it('a user with no active membership row is denied everything', async () => {
    vi.mocked(businessMembersDb.getMemberForUser).mockResolvedValue(null)
    const business = makeBusiness({ owner_id: 'owner-1' })
    const result = await canServer(fakeClient, business, 'user-2', 'author')
    expect(result).toBe(false)
  })
})
