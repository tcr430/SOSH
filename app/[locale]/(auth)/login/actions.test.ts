import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  resolveIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn().mockResolvedValue({ owner_id: 'user-1', onboarding_completed: true }),
}))

import * as rateLimitModule from '@/lib/auth/rate-limit'
import * as serverModule from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { loginAction } from './actions'

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('email', 'user@company.com')
  fd.set('password', 'Password123abc')
  fd.set('locale', 'en')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

function mockSupabaseClient() {
  const signInWithPassword = vi.fn().mockResolvedValue({ data: null, error: { message: 'invalid credentials' } })
  const client = { auth: { signInWithPassword } } as unknown as SupabaseClient
  vi.mocked(serverModule.createClient).mockResolvedValue(client)
  return { signInWithPassword }
}

function mockSuccessfulSignIn(userId = 'user-1') {
  const signInWithPassword = vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null })
  const client = { auth: { signInWithPassword } } as unknown as SupabaseClient
  vi.mocked(serverModule.createClient).mockResolvedValue(client)
  return { signInWithPassword }
}

describe('loginAction — rate limiting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rate_limit form error and does not call Supabase when rate-limited', async () => {
    vi.mocked(rateLimitModule.consumeRateLimit).mockResolvedValue(false)
    const { signInWithPassword } = mockSupabaseClient()

    const result = await loginAction({}, makeFormData())

    expect(result.errors?._form).toBe('errors.rate_limit')
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('calls Supabase auth when rate limit allows', async () => {
    vi.mocked(rateLimitModule.consumeRateLimit).mockResolvedValue(true)
    const { signInWithPassword } = mockSupabaseClient()

    await loginAction({}, makeFormData())

    expect(signInWithPassword).toHaveBeenCalled()
  })
})

describe('loginAction — post-login redirect (ADR 0014 §2.4)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('RES-LOGIN-MEMBER-NO-LOCKOUT: a member (owns no business, onboarding_completed=false on that business) lands on /campaigns, never /onboarding', async () => {
    mockSuccessfulSignIn('member-1')
    vi.mocked(getBusinessForUser).mockResolvedValue({
      owner_id: 'owner-1',
      onboarding_completed: false,
    } as never)

    await expect(loginAction({}, makeFormData())).rejects.toThrow('NEXT_REDIRECT')

    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/campaigns')
  })

  it('RES-ONBOARDING-OWNER-SCOPED: the owner of a not-yet-onboarded business is sent to /onboarding', async () => {
    mockSuccessfulSignIn('owner-1')
    vi.mocked(getBusinessForUser).mockResolvedValue({
      owner_id: 'owner-1',
      onboarding_completed: false,
    } as never)

    await expect(loginAction({}, makeFormData())).rejects.toThrow('NEXT_REDIRECT')

    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/onboarding')
  })

  it('RES-ONBOARDING-OWNER-SCOPED: an owner who already finished onboarding lands on /campaigns', async () => {
    mockSuccessfulSignIn('owner-1')
    vi.mocked(getBusinessForUser).mockResolvedValue({
      owner_id: 'owner-1',
      onboarding_completed: true,
    } as never)

    await expect(loginAction({}, makeFormData())).rejects.toThrow('NEXT_REDIRECT')

    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/campaigns')
  })

  it('no business at all (fresh owner mid-signup) is sent to /onboarding', async () => {
    mockSuccessfulSignIn('fresh-owner')
    vi.mocked(getBusinessForUser).mockResolvedValue(null)

    await expect(loginAction({}, makeFormData())).rejects.toThrow('NEXT_REDIRECT')

    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/onboarding')
  })

  it('a safe redirectTo always wins, regardless of business/onboarding state', async () => {
    mockSuccessfulSignIn('owner-1')
    vi.mocked(getBusinessForUser).mockResolvedValue({
      owner_id: 'owner-1',
      onboarding_completed: false,
    } as never)

    await expect(
      loginAction({}, makeFormData({ redirectTo: '/en/settings/accounts' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(vi.mocked((await import('next/navigation')).redirect)).toHaveBeenCalledWith('/en/settings/accounts')
  })
})
