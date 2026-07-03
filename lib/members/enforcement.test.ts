import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow } from '@/lib/db/types'
import * as businessMembersDb from '@/lib/db/business-members'
import { checkInviteAllowed, upgradeCtaTargetFor } from './enforcement'

vi.mock('@/lib/db/business-members', () => ({
  countSeatUsage: vi.fn(),
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

describe('checkInviteAllowed', () => {
  beforeEach(() => {
    vi.mocked(businessMembersDb.countSeatUsage).mockReset()
  })

  it('allows when below cap', async () => {
    vi.mocked(businessMembersDb.countSeatUsage).mockResolvedValue({
      activeCount: 3,
      pendingCount: 1,
    })
    const result = await checkInviteAllowed(fakeClient, makeBusiness({ plan: 'plus' }))
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('returns seat_cap_reached when at cap but not over', async () => {
    vi.mocked(businessMembersDb.countSeatUsage).mockResolvedValue({
      activeCount: 8,
      pendingCount: 2,
    })
    const result = await checkInviteAllowed(fakeClient, makeBusiness({ plan: 'trial' }))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('seat_cap_reached')
  })

  it('returns overage_locked when used > max (post plan-downgrade)', async () => {
    vi.mocked(businessMembersDb.countSeatUsage).mockResolvedValue({
      activeCount: 12,
      pendingCount: 3,
    })
    const result = await checkInviteAllowed(fakeClient, makeBusiness({ plan: 'plus' }))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('overage_locked')
  })

  it('allows unlimited plans regardless of usage', async () => {
    vi.mocked(businessMembersDb.countSeatUsage).mockResolvedValue({
      activeCount: 500,
      pendingCount: 10,
    })
    const result = await checkInviteAllowed(fakeClient, makeBusiness({ plan: 'pro' }))
    expect(result.allowed).toBe(true)
  })
})

describe('upgradeCtaTargetFor', () => {
  it('routes both seat reasons to /billing (matches campaigns/enforcement.ts shape)', () => {
    expect(upgradeCtaTargetFor('seat_cap_reached')).toBe('/billing')
    expect(upgradeCtaTargetFor('overage_locked')).toBe('/billing')
  })
})
