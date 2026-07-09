import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      INVITE_TOKEN_SECRET: 'test-invite-secret-that-is-at-least-32-chars!',
    },
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/db/business-members', () => ({
  getMemberById: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessById: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getMemberById } from '@/lib/db/business-members'
import { getBusinessById } from '@/lib/db/businesses'
import { signInviteToken } from './invite-token'
import { getInvitePreview } from './invite-preview'

const MOCK_MEMBER = {
  id: 'member-1',
  business_id: 'biz-1',
  user_id: null,
  email: 'invitee@company.com',
  role: 'editor' as const,
  is_admin: false,
  status: 'invited' as const,
  invited_by: 'owner-1',
  invited_at: '2026-07-01T00:00:00Z',
  accepted_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

const MOCK_BUSINESS = { id: 'biz-1', name: 'Acme Corp' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createServiceRoleClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { user_metadata: { full_name: 'Jamie Owner' } } },
        }),
      },
    },
  } as never)
  vi.mocked(getMemberById).mockResolvedValue(MOCK_MEMBER as never)
  vi.mocked(getBusinessById).mockResolvedValue(MOCK_BUSINESS as never)
})

describe('getInvitePreview (INV-TOKEN-VERIFY-APPSIDE)', () => {
  it('returns null for a malformed token', async () => {
    const preview = await getInvitePreview('not-a-real-token')
    expect(preview).toBeNull()
  })

  it('returns null for a token signed with a different secret (bad signature)', async () => {
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })
    const { config } = await import('@/lib/config')
    vi.mocked(config).server = {
      ...vi.mocked(config).server,
      INVITE_TOKEN_SECRET: 'a-totally-different-secret-that-is-long-enough!!',
    }
    const preview = await getInvitePreview(token)
    expect(preview).toBeNull()
  })

  it('returns null when the member row does not belong to the claimed business', async () => {
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'wrong-biz' })
    const preview = await getInvitePreview(token)
    expect(preview).toBeNull()
  })

  it('returns null when the member lookup throws (row missing / unknown id)', async () => {
    vi.mocked(getMemberById).mockRejectedValue(new Error('not found'))
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })
    const preview = await getInvitePreview(token)
    expect(preview).toBeNull()
  })

  it('returns the preview for a valid token with a matching member row', async () => {
    const token = await signInviteToken({ memberId: 'member-1', businessId: 'biz-1' })
    const preview = await getInvitePreview(token)
    expect(preview).toEqual({
      memberId: 'member-1',
      businessId: 'biz-1',
      businessName: 'Acme Corp',
      inviterName: 'Jamie Owner',
      email: 'invitee@company.com',
      role: 'editor',
    })
  })
})
