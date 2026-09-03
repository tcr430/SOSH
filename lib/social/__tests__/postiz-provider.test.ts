import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostizProvider } from '../postiz-provider'
import { SocialProviderError } from '../errors'

// Mock vault and service client to isolate PostizProvider logic
const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockServiceClient = { rpc: mockRpc, from: mockFrom }

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockServiceClient,
}))

vi.mock('../vault', () => ({
  withFreshToken: vi.fn(),
  readRefreshToken: vi.fn(),
  readAccessToken: vi.fn(),
}))

function makeQueryStub(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

describe('PostizProvider', () => {
  const BASE_URL = 'https://postiz.test'
  const API_KEY = 'test_api_key'
  let provider: PostizProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new PostizProvider({ baseUrl: BASE_URL, apiKey: API_KEY })
  })

  describe('constructor', () => {
    it('throws PROVIDER_NOT_CONFIGURED when baseUrl is missing', () => {
      expect(() => new PostizProvider({ baseUrl: '', apiKey: 'key' })).toThrow(
        SocialProviderError,
      )
    })

    it('throws PROVIDER_NOT_CONFIGURED when apiKey is missing', () => {
      expect(() => new PostizProvider({ baseUrl: BASE_URL, apiKey: '' })).toThrow(
        SocialProviderError,
      )
    })

    it('throws PROVIDER_NOT_CONFIGURED when baseUrl is not a valid URL', () => {
      expect(() => new PostizProvider({ baseUrl: 'not-a-url', apiKey: 'key' })).toThrow(
        SocialProviderError,
      )
    })

    it('sets platform to "multi"', () => {
      expect(provider.platform).toBe('multi')
    })
  })

  describe('getOAuthAuthorizeUrl', () => {
    it('resolves to the correct Postiz authorize URL', async () => {
      const url = await provider.getOAuthAuthorizeUrl({
        platform: 'linkedin',
        businessId: 'biz-1',
        redirectUri: 'https://app.test/callback',
        scopes: ['openid', 'profile'],
        state: 'signed-jwt',
      })

      expect(url).toBe(
        `${BASE_URL}/integrations/linkedin/authorize?redirect_uri=https%3A%2F%2Fapp.test%2Fcallback&scope=openid+profile&state=signed-jwt`,
      )
    })

    it('strips trailing slash from baseUrl', async () => {
      const p = new PostizProvider({ baseUrl: `${BASE_URL}/`, apiKey: API_KEY })
      const url = await p.getOAuthAuthorizeUrl({
        platform: 'twitter',
        businessId: 'biz-1',
        redirectUri: 'https://app.test/cb',
        scopes: [],
        state: 'jwt',
      })
      expect(url).toContain(`${BASE_URL}/integrations/twitter/authorize`)
    })
  })

  describe('fetchPostMetrics', () => {
    it('throws NOT_IMPLEMENTED', async () => {
      await expect(
        provider.fetchPostMetrics({ socialAccountId: 'sa-1', platformPostId: 'p-1' }),
      ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
    })
  })

  describe('fetchEngagement', () => {
    it('throws NOT_IMPLEMENTED', async () => {
      await expect(
        provider.fetchEngagement({ socialAccountId: 'sa-1', sinceCursor: null }),
      ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
    })
  })

  describe('exchangeOAuthCode', () => {
    it('calls Postiz callback endpoint with correct headers and body', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            accessToken: 'acc',
            refreshToken: 'ref',
            expiresIn: 3600,
            scopesGranted: ['openid'],
            integrationId: 'postiz-int-id',
            username: 'user1',
            displayName: 'User One',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

      const result = await provider.exchangeOAuthCode({
        platform: 'linkedin',
        code: 'auth-code',
        redirectUri: 'https://app.test/callback',
      })

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/integrations/linkedin/callback`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${API_KEY}`,
          }),
        }),
      )
      expect(result.accessToken).toBe('acc')
      expect(result.refreshToken).toBe('ref')
      expect(result.platformUserId).toBe('postiz-int-id')
      expect(result.platformUsername).toBe('user1')

      fetchMock.mockRestore()
    })

    it('throws NETWORK on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

      await expect(
        provider.exchangeOAuthCode({
          platform: 'linkedin',
          code: 'code',
          redirectUri: 'https://app.test/cb',
        }),
      ).rejects.toMatchObject({ code: 'NETWORK' })
    })

    it('throws PLATFORM_REJECTED on non-2xx response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_code' }), { status: 400 }),
      )

      await expect(
        provider.exchangeOAuthCode({
          platform: 'linkedin',
          code: 'bad-code',
          redirectUri: 'https://app.test/cb',
        }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED' })
    })
  })

  describe('revokeAccessToken', () => {
    it('calls the Postiz revoke endpoint and ignores errors', async () => {
      mockFrom.mockReturnValue(
        makeQueryStub({
          data: { platform: 'linkedin', vault_access_token_id: 'vault-1' },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'tok-abc', error: null })

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 200 }),
      )

      await provider.revokeAccessToken({ socialAccountId: 'sa-1' })

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/integrations/linkedin/revoke`,
        expect.objectContaining({ method: 'POST' }),
      )

      fetchMock.mockRestore()
    })

    it('swallows network errors on revoke (best-effort)', async () => {
      mockFrom.mockReturnValue(
        makeQueryStub({
          data: { platform: 'linkedin', vault_access_token_id: 'vault-1' },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'tok', error: null })
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

      await expect(provider.revokeAccessToken({ socialAccountId: 'sa-1' })).resolves.toBeUndefined()
    })
  })
})
