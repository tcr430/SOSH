import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ listCampaigns: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/db/posts', () => ({
  listPendingDraftPosts: vi.fn().mockResolvedValue([]),
  countPendingDraftPosts: vi.fn().mockResolvedValue(0),
}))
vi.mock('./ApprovalsInbox', () => ({ ApprovalsInbox: vi.fn(() => null) }))

import * as serverModule from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { listPendingDraftPosts, countPendingDraftPosts } from '@/lib/db/posts'
import { ApprovalsInbox } from './ApprovalsInbox'
import ApprovalsPage from './page'

const OWNER_ID = 'owner-1'
const BUSINESS = { id: 'biz-1', owner_id: OWNER_ID, name: 'Acme' }

function mockClient(userId: string) {
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
  } as unknown as SupabaseClient
  vi.mocked(serverModule.createClient).mockResolvedValue(client)
  return client
}

describe('ApprovalsPage — ROLE-APPROVALS-GATED (ADR 0014 §9.1)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects unauthenticated users to login', async () => {
    mockClient('anon')
    vi.mocked(serverModule.createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as unknown as SupabaseClient)

    await expect(
      ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/login')
  })

  it('redirects to onboarding when the user has no business', async () => {
    mockClient(OWNER_ID)
    vi.mocked(getBusinessForUser).mockResolvedValue(null)

    await expect(
      ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/onboarding')
  })

  it('allows the owner through (owner is always approver+admin)', async () => {
    mockClient(OWNER_ID)
    vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)

    const result = await ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) })
    expect(result).toBeTruthy()
    expect(vi.mocked((await import('next/navigation')).redirect)).not.toHaveBeenCalled()
  })

  it('allows an approver member through', async () => {
    mockClient('member-1')
    vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'approver', is_admin: false } as never)

    const result = await ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) })
    expect(result).toBeTruthy()
    expect(vi.mocked((await import('next/navigation')).redirect)).not.toHaveBeenCalled()
  })

  it('allows a non-approver admin through (admin bypass, not a plain APPROVE echo)', async () => {
    mockClient('member-2')
    vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: true } as never)

    const result = await ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) })
    expect(result).toBeTruthy()
    expect(vi.mocked((await import('next/navigation')).redirect)).not.toHaveBeenCalled()
  })

  it('redirects a non-approver, non-admin member to campaigns', async () => {
    mockClient('member-3')
    vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: false } as never)

    await expect(
      ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/campaigns')
  })

  it('redirects a viewer to campaigns', async () => {
    mockClient('member-4')
    vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)

    await expect(
      ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/campaigns')
  })

  it('APV-PAGINATED: reads pending drafts through the bounded listPendingDraftPosts query', async () => {
    mockClient(OWNER_ID)
    vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)

    await ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) })

    expect(listPendingDraftPosts).toHaveBeenCalledWith(expect.anything(), { businessId: BUSINESS.id })
  })

  it('APV-OVERFLOW (m1): reads the true pending total and passes it to ApprovalsInbox', async () => {
    mockClient(OWNER_ID)
    vi.mocked(getBusinessForUser).mockResolvedValue(BUSINESS as never)
    vi.mocked(countPendingDraftPosts).mockResolvedValue(341)

    const result = await ApprovalsPage({ params: Promise.resolve({ locale: 'en' }) })

    expect(countPendingDraftPosts).toHaveBeenCalledWith(expect.anything(), BUSINESS.id)
    // ApprovalsPage is a Server Component — it returns a React element tree
    // without rendering it, so the mock is never invoked. Read the props off
    // the un-rendered <ApprovalsInbox> element instead.
    type ReactElementLike = { type: unknown; props: { totalPendingCount?: number } }
    const outer = result as unknown as { props: { children: ReactElementLike[] } }
    const inboxElement = outer.props.children.find(child => child.type === ApprovalsInbox)
    expect(inboxElement?.props.totalPendingCount).toBe(341)
  })
})
