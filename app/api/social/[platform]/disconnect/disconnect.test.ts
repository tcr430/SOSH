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
  getBusinessForUser: vi.fn(),
}))

vi.mock('@/lib/db/social-accounts', () => ({
  listActiveByBusinessAndPlatform: vi.fn(),
  getActiveById: vi.fn(),
  deactivateSocialAccount: vi.fn(),
}))

// Session 30.5-D, D3 (MAJOR-1): disconnect must attempt platform revocation
// before local cleanup. Only getRegistry is mocked; every other export
// (isPlatform, etc.) is the real implementation.
vi.mock('@/lib/social', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/social')>()
  return { ...actual, getRegistry: vi.fn() }
})

import { DELETE } from './route'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listActiveByBusinessAndPlatform, getActiveById, deactivateSocialAccount } from '@/lib/db/social-accounts'
import { getRegistry } from '@/lib/social'
import type { VaultSecretId } from '@/lib/db/types'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessByOwner = vi.mocked(getBusinessForUser)
const mockListActiveByBusinessAndPlatform = vi.mocked(listActiveByBusinessAndPlatform)
const mockGetActiveById = vi.mocked(getActiveById)
const mockDeactivateSocialAccount = vi.mocked(deactivateSocialAccount)
const mockGetRegistry = vi.mocked(getRegistry)
const mockRevokeAccessToken = vi.fn()
const mockRegistryGet = vi.fn()

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

function makeRequest(platform = 'linkedin', accountId?: string): NextRequest {
  const url = `http://localhost:3000/api/social/${platform}/disconnect${accountId ? `?accountId=${accountId}` : ''}`
  return new NextRequest(url, { method: 'DELETE' })
}

function makeParams(platform = 'linkedin') {
  return { params: Promise.resolve({ platform }) }
}

function makeAuthClient(user: typeof MOCK_USER | null = MOCK_USER, canConnect = true) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : new Error('Not authenticated'),
      }),
    },
    rpc: vi.fn().mockResolvedValue({ data: canConnect, error: null }),
  }
}

const SECOND_ACCOUNT = { ...MOCK_ACCOUNT, id: 'sa-999', platform_user_id: 'li-999' }

beforeEach(() => {
  vi.resetAllMocks()
  mockCreateClient.mockResolvedValue(makeAuthClient() as never)
  mockGetBusinessByOwner.mockResolvedValue(MOCK_BUSINESS as never)
  mockListActiveByBusinessAndPlatform.mockResolvedValue([MOCK_ACCOUNT])
  mockGetActiveById.mockResolvedValue(MOCK_ACCOUNT)
  mockDeactivateSocialAccount.mockResolvedValue(undefined)
  mockRevokeAccessToken.mockResolvedValue(undefined)
  mockRegistryGet.mockReturnValue({ revokeAccessToken: mockRevokeAccessToken })
  mockGetRegistry.mockReturnValue({ get: mockRegistryGet } as never)
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
    expect(mockListActiveByBusinessAndPlatform).not.toHaveBeenCalled()
  })

  it('returns 404 when no active account for platform', async () => {
    mockListActiveByBusinessAndPlatform.mockResolvedValue([])
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

  it('passes correct platform and business id to listActiveByBusinessAndPlatform', async () => {
    await DELETE(makeRequest('twitter'), makeParams('twitter'))
    expect(mockListActiveByBusinessAndPlatform).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_BUSINESS.id,
      'twitter',
    )
  })
})

// ─── SOCIAL-DUAL-IDENTITY-RESOLVER (ADR 0028 §5.3, N2.5) ──────────────────────
// AUTHORED-NOT-EXECUTED until this suite: the multi-row case, closed here.
// "disconnects ONE NAMED identity": accountId names it explicitly; without
// it, more than one active account is refused (409), never guessed at.

describe('DELETE /api/social/[platform]/disconnect — dual-identity resolution (ADR 0028 §5.3)', () => {
  it('AMBIGUITY CASE: two active accounts, no accountId param -> 409 account_ambiguous, nothing deactivated', async () => {
    mockListActiveByBusinessAndPlatform.mockResolvedValue([MOCK_ACCOUNT, SECOND_ACCOUNT])
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body).toEqual({ error: 'account_ambiguous' })
    expect(mockDeactivateSocialAccount).not.toHaveBeenCalled()
  })

  it('a named accountId disconnects exactly that identity, even when two active accounts exist', async () => {
    mockListActiveByBusinessAndPlatform.mockResolvedValue([MOCK_ACCOUNT, SECOND_ACCOUNT])
    mockGetActiveById.mockResolvedValue(SECOND_ACCOUNT)
    const response = await DELETE(makeRequest('linkedin', SECOND_ACCOUNT.id), makeParams())
    expect(response.status).toBe(200)
    expect(mockDeactivateSocialAccount).toHaveBeenCalledWith(SECOND_ACCOUNT.id)
    // Named resolution never touches the list-returning path.
    expect(mockListActiveByBusinessAndPlatform).not.toHaveBeenCalled()
  })

  it('a named accountId belonging to a different business is refused (404), not deactivated', async () => {
    mockGetActiveById.mockResolvedValue({ ...MOCK_ACCOUNT, business_id: 'other-biz' })
    const response = await DELETE(makeRequest('linkedin', MOCK_ACCOUNT.id), makeParams())
    expect(response.status).toBe(404)
    expect(mockDeactivateSocialAccount).not.toHaveBeenCalled()
  })

  it('a named accountId for the wrong platform is refused (404), not deactivated', async () => {
    mockGetActiveById.mockResolvedValue({ ...MOCK_ACCOUNT, platform: 'twitter' })
    const response = await DELETE(makeRequest('linkedin', MOCK_ACCOUNT.id), makeParams())
    expect(response.status).toBe(404)
    expect(mockDeactivateSocialAccount).not.toHaveBeenCalled()
  })
})

// MAJOR-1 (Session 30.5-D, D3): revokeAccessToken had zero production
// callers — SOCIAL-REVOKE-NEVER-BLOCKS was vacuously satisfied. These two
// cases prove the call happens, and that a throwing revoke still lets local
// disconnect complete.
describe('DELETE /api/social/[platform]/disconnect — platform revocation (ADR 0028 §16 item 5, MAJOR-1)', () => {
  it('attempts revocation on the right platform, for the right account, before local cleanup', async () => {
    const response = await DELETE(makeRequest('linkedin'), makeParams('linkedin'))
    expect(response.status).toBe(200)
    expect(mockRegistryGet).toHaveBeenCalledWith('linkedin')
    expect(mockRevokeAccessToken).toHaveBeenCalledWith({ socialAccountId: MOCK_ACCOUNT.id })
    expect(mockRevokeAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeactivateSocialAccount.mock.invocationCallOrder[0],
    )
  })

  it('a throwing revoke still results in a completed local disconnect (SOCIAL-REVOKE-NEVER-BLOCKS)', async () => {
    mockRevokeAccessToken.mockRejectedValue(new Error('platform unreachable'))
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ success: true })
    expect(mockDeactivateSocialAccount).toHaveBeenCalledWith(MOCK_ACCOUNT.id)
  })

  it('an unconfigured provider (getRegistry().get throws) still results in a completed local disconnect', async () => {
    mockRegistryGet.mockImplementation(() => {
      throw new Error('PROVIDER_NOT_CONFIGURED')
    })
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(200)
    expect(mockDeactivateSocialAccount).toHaveBeenCalledWith(MOCK_ACCOUNT.id)
  })
})

describe('DELETE /api/social/[platform]/disconnect — app-layer capability gate (ADR 0014 §7, ROLE-DISCONNECT-APPLAYER-GATE)', () => {
  it('blocks a member without connect_accounts (viewer/editor) with 403 and does not touch the account', async () => {
    mockCreateClient.mockResolvedValue(makeAuthClient(MOCK_USER, false) as never)
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(403)
    expect(mockListActiveByBusinessAndPlatform).not.toHaveBeenCalled()
    expect(mockDeactivateSocialAccount).not.toHaveBeenCalled()
  })

  it('blocks with 403 when the user_can RPC errors (fail-closed)', async () => {
    const client = makeAuthClient(MOCK_USER, false)
    client.rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('rpc failure') })
    mockCreateClient.mockResolvedValue(client as never)
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(403)
    expect(mockDeactivateSocialAccount).not.toHaveBeenCalled()
  })

  it('passes through (an approver/admin) when user_can resolves true', async () => {
    mockCreateClient.mockResolvedValue(makeAuthClient(MOCK_USER, true) as never)
    const response = await DELETE(makeRequest(), makeParams())
    expect(response.status).toBe(200)
    expect(mockDeactivateSocialAccount).toHaveBeenCalledWith(MOCK_ACCOUNT.id)
  })

  it('calls user_can with the resolved business id and connect_accounts capability', async () => {
    const client = makeAuthClient(MOCK_USER, true)
    mockCreateClient.mockResolvedValue(client as never)
    await DELETE(makeRequest(), makeParams())
    expect(client.rpc).toHaveBeenCalledWith('user_can', {
      p_business_id: MOCK_BUSINESS.id,
      p_capability: 'connect_accounts',
    })
  })
})
