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
vi.mock('@/lib/db/businesses', () => ({ getBusinessByOwner: vi.fn().mockResolvedValue({ onboarding_completed: true }) }))

import * as rateLimitModule from '@/lib/auth/rate-limit'
import * as serverModule from '@/lib/supabase/server'
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
