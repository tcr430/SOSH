import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
}))
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  resolveIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/lib/config', () => ({
  config: { server: { APP_URL: 'https://app.sosh.io' } },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ createBusiness: vi.fn().mockResolvedValue({ id: 'biz-id' }) }))
vi.mock('@/lib/db/brand-voices', () => ({ upsertBrandVoice: vi.fn().mockResolvedValue(undefined) }))

import { redirect } from 'next/navigation'
import * as rateLimitModule from '@/lib/auth/rate-limit'
import * as serverModule from '@/lib/supabase/server'
import { createBusiness } from '@/lib/db/businesses'
import { signupAction } from './actions'

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('name', 'Test User')
  fd.set('email', 'test@company.com')
  fd.set('password', 'Password123abc')
  fd.set('company', 'Acme Ltd')
  fd.set('locale', 'en')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

function mockSupabaseClient() {
  const signUp = vi.fn().mockResolvedValue({ data: null, error: { message: 'generic error' } })
  const client = { auth: { signUp } } as unknown as SupabaseClient
  vi.mocked(serverModule.createClient).mockResolvedValue(client)
  return { signUp }
}

function mockSuccessfulSignUp(userId = 'user-1') {
  const signUp = vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null })
  const client = { auth: { signUp } } as unknown as SupabaseClient
  vi.mocked(serverModule.createClient).mockResolvedValue(client)
  return { signUp }
}

function makeInviteFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('name', 'Invitee User')
  fd.set('email', 'invitee@company.com')
  fd.set('password', 'Password123abc')
  fd.set('token', 'signed-invite-jwt')
  fd.set('locale', 'en')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

describe('signupAction — rate limiting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rate_limit form error and does not call Supabase when rate-limited', async () => {
    vi.mocked(rateLimitModule.consumeRateLimit).mockResolvedValue(false)
    const { signUp } = mockSupabaseClient()

    const result = await signupAction({}, makeFormData())

    expect(result.errors?._form).toBe('errors.rate_limit')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('calls Supabase auth when rate limit allows', async () => {
    vi.mocked(rateLimitModule.consumeRateLimit).mockResolvedValue(true)
    const { signUp } = mockSupabaseClient()

    await signupAction({}, makeFormData())

    expect(signUp).toHaveBeenCalled()
  })
})

describe('signupAction — invite-flavored signup (ADR 0014 §4.5)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not require a company name (schema switches when token is present)', async () => {
    mockSuccessfulSignUp()
    await expect(
      signupAction({}, makeInviteFormData()),
    ).rejects.toThrow('NEXT_REDIRECT:/en/invite/accept?token=signed-invite-jwt')
  })

  it('passes emailRedirectTo pointing at /invite/accept?token=… to signUp', async () => {
    const { signUp } = mockSuccessfulSignUp()
    await expect(signupAction({}, makeInviteFormData())).rejects.toThrow('NEXT_REDIRECT')

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'invitee@company.com',
        options: expect.objectContaining({
          emailRedirectTo: 'https://app.sosh.io/en/invite/accept?token=signed-invite-jwt',
        }),
      }),
    )
  })

  it('does NOT create a business or brand voice for an invite-flavored signup', async () => {
    mockSuccessfulSignUp()
    await expect(signupAction({}, makeInviteFormData())).rejects.toThrow('NEXT_REDIRECT')

    expect(createBusiness).not.toHaveBeenCalled()
  })

  it('redirects to /invite/accept?token=… (not /onboarding) after a successful invite signup', async () => {
    mockSuccessfulSignUp()
    await expect(
      signupAction({}, makeInviteFormData()),
    ).rejects.toThrow(`NEXT_REDIRECT:/en/invite/accept?token=signed-invite-jwt`)
    expect(redirect).toHaveBeenCalledWith('/en/invite/accept?token=signed-invite-jwt')
  })

  it('a free-provider email is accepted for an invite-flavored signup (no work-email restriction)', async () => {
    mockSuccessfulSignUp()
    await expect(
      signupAction({}, makeInviteFormData({ email: 'invitee@gmail.com' })),
    ).rejects.toThrow('NEXT_REDIRECT')
  })

  it('still enforces password strength for an invite-flavored signup', async () => {
    const result = await signupAction({}, makeInviteFormData({ password: 'short' }))
    expect(result.errors?.password).toBe('errors.signup.weak_password')
  })
})
