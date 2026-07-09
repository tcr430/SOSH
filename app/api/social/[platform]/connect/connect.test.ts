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

vi.mock('@/lib/social', () => ({
  signOAuthState: vi.fn().mockResolvedValue('signed-state-jwt'),
  getRegistry: vi.fn(),
  getPlatformConfig: vi.fn().mockReturnValue({ scopes: ['openid'] }),
  isPlatform: vi.fn().mockReturnValue(true),
}))

import { GET } from './route'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getRegistry, isPlatform, getPlatformConfig, signOAuthState } from '@/lib/social'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessForUser = vi.mocked(getBusinessForUser)
const mockGetRegistry = vi.mocked(getRegistry)
const mockIsPlatform = vi.mocked(isPlatform)
const mockGetPlatformConfig = vi.mocked(getPlatformConfig)
const mockSignOAuthState = vi.mocked(signOAuthState)

const MOCK_USER = { id: 'user-123' }
const MOCK_BUSINESS = { id: 'biz-456', owner_id: 'user-123' }

function makeRequest(platform = 'linkedin', locale = 'en'): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/social/${platform}/connect?locale=${locale}`,
  )
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

beforeEach(() => {
  vi.resetAllMocks()
  mockCreateClient.mockResolvedValue(makeAuthClient() as never)
  mockGetBusinessForUser.mockResolvedValue(MOCK_BUSINESS as never)
  mockIsPlatform.mockReturnValue(true)
  mockGetPlatformConfig.mockReturnValue({ scopes: ['openid'] } as never)
  mockSignOAuthState.mockResolvedValue('signed-state-jwt')
  mockGetRegistry.mockReturnValue({
    get: vi.fn().mockReturnValue({
      getOAuthAuthorizeUrl: vi.fn().mockResolvedValue('https://provider.example/authorize'),
    }),
  } as never)
})

describe('GET /api/social/[platform]/connect — app-layer capability gate (ADR 0014 §7, ROLE-CONNECT-APPLAYER-GATE)', () => {
  it('blocks a member without connect_accounts (viewer/editor) — redirects with ?error=forbidden', async () => {
    mockCreateClient.mockResolvedValue(makeAuthClient(MOCK_USER, false) as never)
    const response = await GET(makeRequest(), makeParams())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/settings/accounts?error=forbidden',
    )
    expect(mockGetRegistry).not.toHaveBeenCalled()
  })

  it('blocks with ?error=forbidden when the user_can RPC errors (fail-closed)', async () => {
    const client = makeAuthClient(MOCK_USER, false)
    client.rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('rpc failure') })
    mockCreateClient.mockResolvedValue(client as never)
    const response = await GET(makeRequest(), makeParams())
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/settings/accounts?error=forbidden',
    )
    expect(mockGetRegistry).not.toHaveBeenCalled()
  })

  it('passes through (an approver/admin) when user_can resolves true — redirects to the OAuth authorize URL', async () => {
    mockCreateClient.mockResolvedValue(makeAuthClient(MOCK_USER, true) as never)
    const response = await GET(makeRequest(), makeParams())
    expect(response.headers.get('location')).toBe('https://provider.example/authorize')
  })

  it('calls user_can with the resolved business id and connect_accounts capability', async () => {
    const client = makeAuthClient(MOCK_USER, true)
    mockCreateClient.mockResolvedValue(client as never)
    await GET(makeRequest(), makeParams())
    expect(client.rpc).toHaveBeenCalledWith('user_can', {
      p_business_id: MOCK_BUSINESS.id,
      p_capability: 'connect_accounts',
    })
  })
})
