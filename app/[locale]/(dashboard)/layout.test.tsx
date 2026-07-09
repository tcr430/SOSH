import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import * as Sentry from '@sentry/nextjs'

vi.mock('@sentry/nextjs', () => ({ setUser: vi.fn() }))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => '/en/dashboard' }),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/brand-voices', () => ({ getBrandVoice: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db/social-accounts', () => ({
  listActiveSocialAccounts: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/db/trial-state', () => ({
  getTrialStateMaybe: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/contexts/business-context', () => ({
  BusinessProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))
vi.mock('@/components/layout/DashboardShell', () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

import * as serverModule from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import DashboardLayout from './layout'

const MOCK_USER = { id: 'user-abc-123' }
const MOCK_BUSINESS = {
  id: 'biz-1',
  owner_id: 'user-abc-123',
  plan: 'plus',
  onboarding_completed: true,
  trial_started_at: null,
}

function mockAuthClient(user: { id: string } | null) {
  const getUser = vi.fn().mockResolvedValue({ data: { user } })
  vi.mocked(serverModule.createClient).mockResolvedValue(
    { auth: { getUser } } as never,
  )
}

describe('DashboardLayout — Sentry.setUser (ADR 0007 §3.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBusinessForUser).mockResolvedValue(MOCK_BUSINESS as never)
  })

  it('calls Sentry.setUser with { id: user.id } when user is present', async () => {
    mockAuthClient(MOCK_USER)

    await DashboardLayout({
      children: React.createElement('div'),
      params: Promise.resolve({ locale: 'en' }),
    })

    expect(Sentry.setUser).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(Sentry.setUser).mock.calls[0][0]!
    expect(Object.keys(arg)).toHaveLength(1)
    expect(arg).toHaveProperty('id', MOCK_USER.id)
  })

  it('setUser argument contains exactly the key "id" and nothing else', async () => {
    mockAuthClient(MOCK_USER)

    await DashboardLayout({
      children: React.createElement('div'),
      params: Promise.resolve({ locale: 'en' }),
    })

    const arg = vi.mocked(Sentry.setUser).mock.calls[0][0]!
    expect(Object.keys(arg)).toStrictEqual(['id'])
  })

  it('does NOT call Sentry.setUser when getUser returns null', async () => {
    mockAuthClient(null)

    await expect(
      DashboardLayout({
        children: React.createElement('div'),
        params: Promise.resolve({ locale: 'en' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(Sentry.setUser).not.toHaveBeenCalled()
  })
})

describe('DashboardLayout — owner-scoped onboarding guard (ADR 0014 §2.4, RES-ONBOARDING-OWNER-SCOPED)', () => {
  const MOCK_MEMBER = { id: 'member-1' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects the owner of a not-yet-onboarded business to /onboarding', async () => {
    mockAuthClient(MOCK_USER)
    vi.mocked(getBusinessForUser).mockResolvedValue({
      ...MOCK_BUSINESS,
      owner_id: MOCK_USER.id,
      onboarding_completed: false,
    } as never)

    await expect(
      DashboardLayout({
        children: React.createElement('div'),
        params: Promise.resolve({ locale: 'en' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT')

    const { redirect } = await import('next/navigation')
    expect(vi.mocked(redirect)).toHaveBeenCalledWith('/en/onboarding')
  })

  it('does NOT redirect a member of a not-yet-onboarded owner business — renders the dashboard instead', async () => {
    mockAuthClient(MOCK_MEMBER)
    vi.mocked(getBusinessForUser).mockResolvedValue({
      ...MOCK_BUSINESS,
      owner_id: MOCK_USER.id,
      onboarding_completed: false,
    } as never)

    const result = await DashboardLayout({
      children: React.createElement('div'),
      params: Promise.resolve({ locale: 'en' }),
    })

    expect(result).toBeTruthy()
    const { redirect } = await import('next/navigation')
    expect(vi.mocked(redirect)).not.toHaveBeenCalled()
  })
})
