import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  resolveIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ createBusiness: vi.fn().mockResolvedValue({ id: 'biz-id' }) }))
vi.mock('@/lib/db/brand-voices', () => ({ upsertBrandVoice: vi.fn().mockResolvedValue(undefined) }))

import * as rateLimitModule from '@/lib/auth/rate-limit'
import * as serverModule from '@/lib/supabase/server'
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
