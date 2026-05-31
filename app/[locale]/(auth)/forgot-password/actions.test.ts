import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/auth/rate-limit', () => ({
  consumeRateLimit: vi.fn().mockResolvedValue(true),
  resolveIp: vi.fn().mockReturnValue('1.2.3.4'),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/config', () => ({
  config: { server: { APP_URL: 'https://test.example.com' } },
}))

import * as rateLimitModule from '@/lib/auth/rate-limit'
import * as serverModule from '@/lib/supabase/server'
import { forgotPasswordAction } from './actions'

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('email', 'user@company.com')
  fd.set('locale', 'en')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

function mockSupabaseClient() {
  const resetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null })
  const client = { auth: { resetPasswordForEmail } } as unknown as SupabaseClient
  vi.mocked(serverModule.createClient).mockResolvedValue(client)
  return { resetPasswordForEmail }
}

describe('forgotPasswordAction — rate limiting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns rate_limit form error and does not call Supabase when rate-limited', async () => {
    vi.mocked(rateLimitModule.consumeRateLimit).mockResolvedValue(false)
    const { resetPasswordForEmail } = mockSupabaseClient()

    const result = await forgotPasswordAction({}, makeFormData())

    expect((result as Record<string, unknown>).errors).toEqual({ _form: 'errors.rate_limit' })
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('calls Supabase auth when rate limit allows', async () => {
    vi.mocked(rateLimitModule.consumeRateLimit).mockResolvedValue(true)
    const { resetPasswordForEmail } = mockSupabaseClient()

    await forgotPasswordAction({}, makeFormData())

    expect(resetPasswordForEmail).toHaveBeenCalled()
  })
})
