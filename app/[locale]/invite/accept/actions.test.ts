import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      INVITE_TOKEN_SECRET: 'test-invite-secret-that-is-at-least-32-chars!',
    },
  },
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/business-members', () => ({
  acceptInvite: vi.fn(),
}))

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { acceptInvite } from '@/lib/db/business-members'
import { signInviteToken } from '@/lib/members/invite-token'
import { processInviteAccept } from './actions'

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('token', overrides.token ?? '')
  fd.set('locale', overrides.locale ?? 'en')
  if (overrides.code) fd.set('code', overrides.code)
  return fd
}

function mockAuthClient(user: { id: string } | null) {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    },
  }
  vi.mocked(createClient).mockResolvedValue(client as never)
  return client
}

describe('processInviteAccept', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns invalid for a malformed token, without touching auth', async () => {
    mockAuthClient(null)
    const result = await processInviteAccept(
      { status: 'pending' },
      makeFormData({ token: 'garbage' }),
    )
    expect(result).toEqual({ status: 'invalid' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('unauthenticated → redirects to /signup?token=<token>', async () => {
    mockAuthClient(null)
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })
    await expect(
      processInviteAccept({ status: 'pending' }, makeFormData({ token, locale: 'en' })),
    ).rejects.toThrow(`NEXT_REDIRECT:/en/signup?token=${encodeURIComponent(token)}`)
  })

  it('exchanges the Supabase code when present before checking auth', async () => {
    const client = mockAuthClient({ id: 'user-1' })
    vi.mocked(acceptInvite).mockResolvedValue({ outcome: 'accepted' } as never)
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })

    await expect(
      processInviteAccept({ status: 'pending' }, makeFormData({ token, code: 'pkce-code-123' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code-123')
  })

  it('authenticated + accepted → redirects to /campaigns', async () => {
    mockAuthClient({ id: 'user-1' })
    vi.mocked(acceptInvite).mockResolvedValue({ outcome: 'accepted' } as never)
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })

    await expect(
      processInviteAccept({ status: 'pending' }, makeFormData({ token, locale: 'en' })),
    ).rejects.toThrow('NEXT_REDIRECT:/en/campaigns')
  })

  it('authenticated + RPC already_member → { status: "already-member" }, no redirect', async () => {
    mockAuthClient({ id: 'user-1' })
    vi.mocked(acceptInvite).mockResolvedValue({ outcome: 'already_member' } as never)
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })

    const result = await processInviteAccept({ status: 'pending' }, makeFormData({ token }))
    expect(result).toEqual({ status: 'already-member' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it.each([
    'invite not available (expired, already accepted, revoked, wrong account, or unknown)',
    'invite not available (email mismatch)',
  ])(
    'INV-ACCEPT-ANTI-ENUM: any RPC failure (%s) collapses to the same generic invalid state',
    async (message) => {
      mockAuthClient({ id: 'user-1' })
      vi.mocked(acceptInvite).mockRejectedValue(new Error(message))
      const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })

      const result = await processInviteAccept({ status: 'pending' }, makeFormData({ token }))
      expect(result).toEqual({ status: 'invalid' })
    },
  )
})
