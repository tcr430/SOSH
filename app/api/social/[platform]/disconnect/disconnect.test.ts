import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  config: {
    public: {
      APP_URL: 'http://localhost:3000',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_placeholder',
      NODE_ENV: 'test',
    },
    server: {},
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessByOwner: vi.fn(),
}))

vi.mock('@/lib/db/social-accounts', () => ({
  getActiveByBusinessAndPlatform: vi.fn(),
  deactivateSocialAccount: vi.fn(),
}))

import { DELETE } from './route'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getActiveByBusinessAndPlatform, deactivateSocialAccount } from '@/lib/db/social-accounts'
import type { VaultSecretId } from '@/lib/db/types'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessByOwner = vi.mocked(getBusinessByOwner)
const mockGetActiveByBusinessAndPlatform = vi.mocked(getActiveByBusinessAndPlatform)
const mockDeactivateSocialAccount = vi.mocked(deactivateSocialAccount)

const MOCK_USER = { id: 'user-123' }
const MOCK_BUSINESS = { id: 'biz-456', owner_id: 'user-123' }
const MOCK_ACCOUNT = {
  id: 'sa-789',
  business_id: 'biz-456',
  platform: 'linkedin' as const,
  platform_user_id: 'li-123',
  platform_username: 'acme_corp',
  platform_display_name: 'Acme Corp',
  vault_access_token_id: 'vault-1' as VaultSecretId,
  vault_refresh_token_id: null,
  token_expires_at: null,
  is_active: true,
  connected_at: '2026-04-30T00:00:00Z',
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

function makeRequest(platform = 'linkedin'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/social/${platform}/disconnect`, {
    method: 'DELETE',
  })
}

function makeParams(platform = 'linkedin') {
  return { params: Promise.resolve({ platform }) }
}

function makeAuthClient(user: typeof MOCK_USER | null = MOCK_USER) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : new Error('Not authenticated'),
      }),
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockCreateClient.mockResolvedValue(makeAuthClient() as never)
  mockGetBusinessByOwner.mockResolvedValue(MOCK_BUSINESS as never)
  mockGetActiveByBusinessAndPlatform.mockResolvedValue(MOCK_ACCOUNT)
  mockDeactivateSocialAccount.mockResolvedValue(undefined)
})

describe('DELETE /api/social/[platform]/disconnect', () => {
  it('disconnects account and returns { success: true }', async () => {
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ success: true })
    expect(mockDeactivateSocialAccount).toHaveBeenCalledWith(MOCK_ACCOUNT.id)
  })

  it('returns 404 for invalid platform', async () => {
    const response = await DELETE(makeRequest('reddit'), makeParams('reddit'))
    expect(response.status).toBe(404)
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeAuthClient(null) as never)
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(401)
    expect(mockGetBusinessByOwner).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no business', async () => {
    mockGetBusinessByOwner.mockResolvedValue(null)
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(404)
    expect(mockGetActiveByBusinessAndPlatform).not.toHaveBeenCalled()
  })

  it('returns 404 when no active account for platform', async () => {
    mockGetActiveByBusinessAndPlatform.mockResolvedValue(null)
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(404)
    expect(mockDeactivateSocialAccount).not.toHaveBeenCalled()
  })

  it('returns 500 when deactivateSocialAccount throws', async () => {
    mockDeactivateSocialAccount.mockRejectedValue(new Error('vault failure'))
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'disconnect_failed' })
  })

  it('passes correct platform and business id to getActiveByBusinessAndPlatform', async () => {
    await DELETE(makeRequest('twitter'), makeParams('twitter'))
    expect(mockGetActiveByBusinessAndPlatform).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_BUSINESS.id,
      'twitter',
    )
  })
})
