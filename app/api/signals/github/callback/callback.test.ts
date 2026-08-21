import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessById: vi.fn() }))
vi.mock('@/lib/members/can-server', () => ({ canServer: vi.fn() }))
vi.mock('@/lib/db/github-connections', () => ({ upsertGithubConnection: vi.fn() }))
vi.mock('@/lib/signals/state', () => ({ verifyGithubConnectState: vi.fn() }))
vi.mock('@/lib/signals', () => ({
  exchangeUserCode: vi.fn(),
  getUserInstallations: vi.fn(),
}))

import { GET } from './route'
import { createClient } from '@/lib/supabase/server'
import { getBusinessById } from '@/lib/db/businesses'
import { canServer } from '@/lib/members/can-server'
import { upsertGithubConnection } from '@/lib/db/github-connections'
import { verifyGithubConnectState } from '@/lib/signals/state'
import { exchangeUserCode, getUserInstallations } from '@/lib/signals'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessById = vi.mocked(getBusinessById)
const mockCanServer = vi.mocked(canServer)
const mockUpsertGithubConnection = vi.mocked(upsertGithubConnection)
const mockVerifyGithubConnectState = vi.mocked(verifyGithubConnectState)
const mockExchangeUserCode = vi.mocked(exchangeUserCode)
const mockGetUserInstallations = vi.mocked(getUserInstallations)

const BUSINESS_ID = '123e4567-e89b-4abc-8def-426614174000'
const USER_ID = 'user-1'
const NONCE = 'nonce-abc123'
const INSTALLATION_ID = 555

function makeSupabaseStub(user: { id: string } | null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  }
}

function makeRequest(overrides: Record<string, string | null> = {}, cookieValue: string | null = NONCE): NextRequest {
  const url = new URL('http://localhost:3000/api/signals/github/callback')
  const combined = {
    installation_id: String(INSTALLATION_ID),
    setup_action: 'install',
    state: 'signed.state.jwt',
    code: 'oauth-code-abc',
    ...overrides,
  }
  for (const [key, value] of Object.entries(combined)) {
    if (value !== null) url.searchParams.set(key, value)
  }
  const headers: Record<string, string> = {}
  if (cookieValue !== null) headers.cookie = `github_connect_nonce=${cookieValue}`
  return new NextRequest(url, { headers })
}

function validClaims() {
  return { businessId: BUSINESS_ID, userId: USER_ID, nonce: NONCE }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateClient.mockResolvedValue(makeSupabaseStub({ id: USER_ID }) as never)
  mockGetBusinessById.mockResolvedValue({ id: BUSINESS_ID } as never)
  mockCanServer.mockResolvedValue(true)
  mockVerifyGithubConnectState.mockResolvedValue(validClaims())
  mockExchangeUserCode.mockResolvedValue({ accessToken: 'user-token-xyz' })
  mockGetUserInstallations.mockResolvedValue([
    { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization' } },
  ])
  mockUpsertGithubConnection.mockResolvedValue({
    status: 'claimed',
    connection: { id: 'conn-1', business_id: BUSINESS_ID, installation_id: INSTALLATION_ID } as never,
  })
})

describe('GitHub install callback — the happy path', () => {
  it('a fully valid flow claims the connection and redirects with connected=github', async () => {
    const response = await GET(makeRequest())
    expect(response.status).toBe(307)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('connected=github')
    expect(mockUpsertGithubConnection).toHaveBeenCalledWith({
      business_id: BUSINESS_ID,
      installation_id: INSTALLATION_ID,
      account_login: 'acme',
      is_active: true,
    })
  })

  it('SIGNAL-USER-TOKEN-UNPERSISTED: the object passed to the upsert carries no token-shaped field', async () => {
    await GET(makeRequest())
    const call = mockUpsertGithubConnection.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).toBeDefined()
    for (const key of Object.keys(call)) {
      expect(key.toLowerCase()).not.toContain('token')
    }
    expect(JSON.stringify(call)).not.toContain('user-token-xyz')
  })

  it('SIGNAL-OAUTH-LEG-PRESENT: both the code-exchange (step 8) and the ownership-proof (step 9) legs run', async () => {
    await GET(makeRequest())
    expect(mockExchangeUserCode).toHaveBeenCalledWith('oauth-code-abc')
    expect(mockGetUserInstallations).toHaveBeenCalledWith('user-token-xyz')
  })

  it('a conflict (installation already owned by a different business) redirects with a typed error, no rebind', async () => {
    mockUpsertGithubConnection.mockResolvedValue({ status: 'conflict' })
    const response = await GET(makeRequest())
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=already_connected')
  })
})

describe('SIGNAL-CALLBACK-TENANT-BOUND ([sec-BLOCKER-1]) — the tenant-confusion vector', () => {
  it("an installation NOT in the authenticated user's own list is rejected; nothing is written", async () => {
    mockGetUserInstallations.mockResolvedValue([{ id: 999999, account: { login: 'someone-else', type: 'Organization' } }])
    const response = await GET(makeRequest())
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=not_your_installation')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
  })
})

describe('SIGNAL-CALLBACK-VALIDATED — the rejection matrix', () => {
  it('an unparseable installation_id is rejected before any write', async () => {
    const response = await GET(makeRequest({ installation_id: 'not-a-number' }))
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=invalid_request')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
  })

  it('an invalid/unverifiable state is rejected', async () => {
    mockVerifyGithubConnectState.mockRejectedValue(new Error('bad signature'))
    const response = await GET(makeRequest())
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=invalid_state')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
  })

  it('a missing nonce cookie is rejected', async () => {
    const response = await GET(makeRequest({}, null))
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=invalid_state')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
  })

  it('a nonce that does not match the state claim is rejected', async () => {
    const response = await GET(makeRequest({}, 'a-different-nonce'))
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=invalid_state')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
  })

  it('a replayed nonce (already cleared by a prior attempt) is rejected identically to a missing cookie', async () => {
    // The route's OWN mechanism for making a nonce single-use is clearing
    // the cookie on the response of the first (successful-past-step-3)
    // attempt; a second request whose browser already dropped it looks
    // exactly like "no cookie" to the route, which is the correct rejection.
    const response = await GET(makeRequest({}, null))
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=invalid_state')
  })

  it("setup_action='request' writes nothing and redirects to a distinct awaiting-approval screen", async () => {
    const response = await GET(makeRequest({ setup_action: 'request', code: null }))
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('awaiting_approval=1')
    expect(location).not.toContain('error=')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
    expect(mockExchangeUserCode).not.toHaveBeenCalled()
  })

  it('a signed-out user is redirected to login, preserving the callback URL as next', async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseStub(null) as never)
    const response = await GET(makeRequest())
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/en/login')
    expect(location).toContain('next=')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
  })

  it('a userId mismatch against the state claim is rejected as forbidden', async () => {
    mockCreateClient.mockResolvedValue(makeSupabaseStub({ id: 'a-different-user' }) as never)
    const response = await GET(makeRequest())
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=forbidden')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
  })
})

describe('SIGNAL-CAPABILITY-GATED (the callback half)', () => {
  it('canServer(CONNECT_ACCOUNTS) denial rejects before any write', async () => {
    mockCanServer.mockResolvedValue(false)
    const response = await GET(makeRequest())
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('error=forbidden')
    expect(mockUpsertGithubConnection).not.toHaveBeenCalled()
    expect(mockExchangeUserCode).not.toHaveBeenCalled()
  })
})
