import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  config: {
    server: { APP_URL: 'http://localhost:3000' },
    public: { NODE_ENV: 'test' },
  },
}))

vi.mock('@/lib/social', () => ({
  verifyOAuthState: vi.fn(),
  getRegistry: vi.fn(),
  isPlatform: vi.fn(),
  getSocialRedirectUri: vi.fn((platform: string) => `http://localhost:3000/api/social/${platform}/callback`),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessById: vi.fn(),
}))

import { GET } from './route'
import { verifyOAuthState, getRegistry, isPlatform } from '@/lib/social'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { getBusinessById } from '@/lib/db/businesses'

const mockVerifyOAuthState = vi.mocked(verifyOAuthState)
const mockGetRegistry = vi.mocked(getRegistry)
const mockIsPlatform = vi.mocked(isPlatform)
const mockCreateClient = vi.mocked(createClient)
const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)
const mockGetBusinessById = vi.mocked(getBusinessById)

// ── Constants ──────────────────────────────────────────────────────────────

const BUSINESS_ID = '123e4567-e89b-4abc-8def-426614174000'
const VALID_STATE_JWT = 'valid.state.jwt'

const MOCK_TOKEN_SET = {
  accessToken: 'access-token-xyz',
  refreshToken: 'refresh-token-xyz',
  tokenExpiresAt: '2026-07-16T00:00:00.000Z',
  scopesGranted: ['openid', 'profile'],
  platformUserId: 'li-user-123',
  platformUsername: 'li_user',
  platformDisplayName: 'LinkedIn User',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(
  platform = 'linkedin',
  overrides: Record<string, string | null> = {},
): NextRequest {
  const url = new URL(`http://localhost:3000/api/social/${platform}/callback`)
  const combined = { state: VALID_STATE_JWT, code: 'auth-code-abc', ...overrides }
  for (const [key, value] of Object.entries(combined)) {
    if (value !== null) url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

function routeParams(platform = 'linkedin') {
  return { params: Promise.resolve({ platform }) }
}

function buildSelectChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

function buildUpsertChain(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const upsert = vi.fn().mockReturnValue({ select })
  return { upsert, select, single }
}

interface ServiceClientOptions {
  vaultResults?: (string | null)[]
  preQueryResult?: { data: unknown; error: unknown }
  upsertResult?: { data: unknown; error: unknown }
}

function makeServiceClient({
  vaultResults = ['vault-access-1', 'vault-refresh-1'],
  preQueryResult = { data: null, error: null },
  upsertResult = { data: { id: 'new-row-placeholder' }, error: null },
}: ServiceClientOptions = {}) {
  let vaultCreateCount = 0

  const rpc = vi.fn().mockImplementation(async (name: string) => {
    if (name === 'vault_create_secret') {
      const val = vaultResults[vaultCreateCount++] ?? null
      if (val === null) return { data: null, error: new Error('vault create failed') }
      return { data: val, error: null }
    }
    return { data: null, error: null }
  })

  let fromCount = 0
  const from = vi.fn().mockImplementation(() => {
    fromCount++
    if (fromCount === 1) return buildSelectChain(preQueryResult)
    return buildUpsertChain(upsertResult)
  })

  return { rpc, from }
}

function makeMockProvider(
  overrides: Partial<{ exchangeOAuthCode: ReturnType<typeof vi.fn> }> = {},
) {
  return {
    exchangeOAuthCode: vi.fn().mockResolvedValue(MOCK_TOKEN_SET),
    ...overrides,
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  mockIsPlatform.mockReturnValue(true)
  mockCreateClient.mockResolvedValue({} as never)

  mockVerifyOAuthState.mockResolvedValue({
    businessId: BUSINESS_ID,
    platform: 'linkedin',
    nonce: 'nonce-abc123',
    locale: 'en',
  })

  mockGetBusinessById.mockResolvedValue({ id: BUSINESS_ID } as never)

  mockGetRegistry.mockReturnValue({
    get: vi.fn().mockReturnValue(makeMockProvider()),
  } as never)

  mockCreateServiceRoleClient.mockReturnValue(makeServiceClient() as never)
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/social/[platform]/callback', () => {
  it('valid flow: redirects to settings with connected platform', async () => {
    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/en/settings/accounts?connected=linkedin')
  })

  it('missing state param → invalid_state', async () => {
    const response = await GET(makeRequest('linkedin', { state: null }), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
  })

  it('invalid JWT signature → invalid_state', async () => {
    mockVerifyOAuthState.mockRejectedValue(new Error('JWSInvalid'))
    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
  })

  it('expired JWT → invalid_state', async () => {
    mockVerifyOAuthState.mockRejectedValue(new Error('JWTExpired'))
    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
  })

  it('platform mismatch in JWT → invalid_state', async () => {
    mockVerifyOAuthState.mockResolvedValue({
      businessId: BUSINESS_ID,
      platform: 'twitter', // route param is 'linkedin'
      nonce: 'nonce-abc123',
      locale: 'en',
    })
    const response = await GET(makeRequest('linkedin'), routeParams('linkedin'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=invalid_state')
  })

  it('business not found (RLS returns null) → forbidden', async () => {
    mockGetBusinessById.mockRejectedValue(new Error('Business not found'))
    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=forbidden')
  })

  it('OAuth error param present → oauth_denied', async () => {
    const response = await GET(
      makeRequest('linkedin', { error: 'access_denied', code: null }),
      routeParams(),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=oauth_denied')
    expect(response.headers.get('location')).toContain('platform=linkedin')
  })

  it('exchangeOAuthCode throws → exchange_failed', async () => {
    mockGetRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue(
        makeMockProvider({
          exchangeOAuthCode: vi.fn().mockRejectedValue(new Error('network error')),
        }),
      ),
    } as never)
    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=exchange_failed')
  })

  it('vault_create_secret fails on access token → vault_write_failed, no DB write', async () => {
    const serviceClient = makeServiceClient({ vaultResults: [null] })
    mockCreateServiceRoleClient.mockReturnValue(serviceClient as never)

    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=vault_write_failed')
    expect(serviceClient.from).not.toHaveBeenCalled()
  })

  it('vault_create_secret fails on refresh token → vault_write_failed, access secret cleaned up', async () => {
    const serviceClient = makeServiceClient({ vaultResults: ['vault-access-1', null] })
    mockCreateServiceRoleClient.mockReturnValue(serviceClient as never)

    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=vault_write_failed')
    expect(serviceClient.rpc).toHaveBeenCalledWith('vault_delete_secret', {
      secret_id: 'vault-access-1',
    })
    expect(serviceClient.from).not.toHaveBeenCalled()
  })

  it('DB upsert fails → db_write_failed, both vault secrets cleaned up', async () => {
    const serviceClient = makeServiceClient({
      upsertResult: { data: null, error: new Error('db constraint violation') },
    })
    mockCreateServiceRoleClient.mockReturnValue(serviceClient as never)

    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('error=db_write_failed')
    expect(serviceClient.rpc).toHaveBeenCalledWith('vault_delete_secret', {
      secret_id: 'vault-access-1',
    })
    expect(serviceClient.rpc).toHaveBeenCalledWith('vault_delete_secret', {
      secret_id: 'vault-refresh-1',
    })
  })

  it('unknown platform → 404', async () => {
    mockIsPlatform.mockReturnValue(false)
    const response = await GET(makeRequest('reddit'), routeParams('reddit'))
    expect(response.status).toBe(404)
  })

  it('reconnect: prior vault secrets deleted, new ones stored', async () => {
    const serviceClient = makeServiceClient({
      preQueryResult: {
        data: {
          vault_access_token_id: 'old-vault-access',
          vault_refresh_token_id: 'old-vault-refresh',
        },
        error: null,
      },
      upsertResult: { data: { id: 'existing-account-id' }, error: null },
    })
    mockCreateServiceRoleClient.mockReturnValue(serviceClient as never)

    const response = await GET(makeRequest(), routeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('connected=linkedin')
    expect(serviceClient.rpc).toHaveBeenCalledWith('vault_delete_secret', {
      secret_id: 'old-vault-access',
    })
    expect(serviceClient.rpc).toHaveBeenCalledWith('vault_delete_secret', {
      secret_id: 'old-vault-refresh',
    })
  })
})

// ADR 0028 §2.4-§2.5 (N2.6) — SOCIAL-REDIRECT-URI-MATCH and SOCIAL-STATE-BINDS-BUSINESS.
describe('GET /api/social/[platform]/callback — N2.6 additions', () => {
  it('SOCIAL-REDIRECT-URI-MATCH: exchangeOAuthCode receives the SAME redirectUri connect.test.ts asserts for the same platform/config', async () => {
    const mockExchange = vi.fn().mockResolvedValue(MOCK_TOKEN_SET)
    mockGetRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue(makeMockProvider({ exchangeOAuthCode: mockExchange })),
    } as never)

    await GET(makeRequest(), routeParams())

    expect(mockExchange).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'http://localhost:3000/api/social/linkedin/callback' }),
    )
  })

  it('SOCIAL-STATE-BINDS-BUSINESS: ownership is re-verified through the RLS-enforced client BEFORE any service-role work begins (ordering, not just presence)', async () => {
    await GET(makeRequest(), routeParams())

    const businessCheckOrder = mockGetBusinessById.mock.invocationCallOrder[0]
    const serviceRoleOrder = mockCreateServiceRoleClient.mock.invocationCallOrder[0]
    expect(mockGetBusinessById).toHaveBeenCalled()
    expect(mockCreateServiceRoleClient).toHaveBeenCalled()
    expect(businessCheckOrder).toBeLessThan(serviceRoleOrder!)
  })

  it('SOCIAL-STATE-BINDS-BUSINESS: a forbidden ownership check never reaches service-role work at all', async () => {
    mockGetBusinessById.mockRejectedValue(new Error('RLS: not found'))
    await GET(makeRequest(), routeParams())
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })
})
