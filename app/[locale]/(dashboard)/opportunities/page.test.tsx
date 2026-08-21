import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('REDIRECT') }) }))
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn().mockResolvedValue((k: string) => k) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn() }))
vi.mock('@/lib/db/insight-cards', () => ({
  listPendingCardsForBusiness: vi.fn().mockResolvedValue([]),
  listExpiredCardsForBusiness: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/db/signal-candidates', () => ({ hasTriageFailedCandidates: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/db/signal-triage-budget', () => ({ isTriageBudgetCapped: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/db/github-connections', () => ({ getGithubConnectionByBusinessId: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/config', () => ({ config: { server: { TRIAGE_DAILY_CAP_CENTS: 125 } } }))
// Session 28-D, D5 (MAJOR-6 closed) — OpportunityFeed now has its own
// dedicated render suite (OpportunityFeed.test.tsx, all ten §9.2 states).
// This mock stays: it is a deliberate PAGE-LEVEL ISOLATION BOUNDARY — this
// file tests only auth/redirect/capability-gate logic in page.tsx (a Server
// Component), which has no reason to also exercise the client component's
// render tree. Kept () => null rather than removed.
vi.mock('./OpportunityFeed', () => ({ OpportunityFeed: () => null }))

import OpportunitiesPage from './page'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import type { BusinessRow } from '@/lib/db/types'

const MOCK_USER = { id: 'user-1' }
const MOCK_BUSINESS: BusinessRow = { id: 'biz-1', name: 'Acme', website: 'https://acme.com', owner_id: MOCK_USER.id } as BusinessRow

function mockClient(user: typeof MOCK_USER | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never)
}

describe('opportunities/page.tsx', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects to login when unauthenticated', async () => {
    mockClient(null)
    await expect(
      OpportunitiesPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/en/login')
  })

  it('redirects to onboarding when no business', async () => {
    mockClient(MOCK_USER)
    vi.mocked(getBusinessForUser).mockResolvedValue(null)
    await expect(
      OpportunitiesPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/en/onboarding')
  })

  it('redirects a non-AUTHOR, non-admin member away from the feed (§5.8 capability gate)', async () => {
    mockClient(MOCK_USER)
    vi.mocked(getBusinessForUser).mockResolvedValue({ ...MOCK_BUSINESS, owner_id: 'someone-else' })
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)
    await expect(
      OpportunitiesPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/en/campaigns')
  })

  it('renders for the owner without redirecting', async () => {
    mockClient(MOCK_USER)
    vi.mocked(getBusinessForUser).mockResolvedValue(MOCK_BUSINESS)
    const result = await OpportunitiesPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    })
    expect(result).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
