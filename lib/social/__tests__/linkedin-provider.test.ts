import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LinkedInProvider, isOrganizationAuthorUrn } from '../linkedin-provider'
import { SocialProviderError } from '../errors'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      LINKEDIN_CLIENT_ID: 'li-client-id',
      LINKEDIN_CLIENT_SECRET: 'li-client-secret',
    },
  },
}))

const mockFrom = vi.fn()
const mockServiceClient = { from: mockFrom }
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockServiceClient,
}))

const mockWithFreshToken = vi.fn()
vi.mock('../vault', () => ({
  withFreshToken: (...args: unknown[]) => mockWithFreshToken(...args),
}))

function makeAccountQueryStub(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('LinkedInProvider', () => {
  let provider: LinkedInProvider
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new LinkedInProvider()
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    // withFreshToken's real contract: given a token, run the callback.
    mockWithFreshToken.mockImplementation(async (_id, _refreshFn, fn) => fn('fresh-access-token'))
  })

  describe('platform', () => {
    it('is always "linkedin", never "multi"', () => {
      expect(provider.platform).toBe('linkedin')
    })
  })

  describe('getOAuthAuthorizeUrl', () => {
    it('builds the authorize URL with client_id, redirect_uri, state, and scope — no PKCE params', async () => {
      const url = await provider.getOAuthAuthorizeUrl({
        platform: 'linkedin',
        businessId: 'biz-1',
        redirectUri: 'https://app.test/api/social/linkedin/callback',
        scopes: ['openid', 'profile', 'email', 'w_member_social'],
        state: 'signed-state-jwt',
      })

      const parsed = new URL(url)
      expect(parsed.origin + parsed.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization')
      expect(parsed.searchParams.get('response_type')).toBe('code')
      expect(parsed.searchParams.get('client_id')).toBe('li-client-id')
      expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.test/api/social/linkedin/callback')
      expect(parsed.searchParams.get('state')).toBe('signed-state-jwt')
      expect(parsed.searchParams.get('scope')).toBe('openid profile email w_member_social')
      expect(parsed.searchParams.has('code_challenge')).toBe(false)
      expect(parsed.searchParams.has('code_challenge_method')).toBe(false)
    })
  })

  describe('exchangeOAuthCode', () => {
    it('exchanges the code (client_secret in the BODY, not Basic auth) then fetches identity via the OIDC userinfo endpoint', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'li-access-token', expires_in: 5184000, scope: 'openid profile w_member_social' }))
        .mockResolvedValueOnce(jsonResponse(200, { sub: '782bbtaQ', name: 'Acme Founder' }))

      const result = await provider.exchangeOAuthCode({
        platform: 'linkedin',
        code: 'auth-code-abc',
        redirectUri: 'https://app.test/api/social/linkedin/callback',
      })

      expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://www.linkedin.com/oauth/v2/accessToken', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }))
      const tokenCallBody = mockFetch.mock.calls[0]![1].body as URLSearchParams
      expect(tokenCallBody.get('client_secret')).toBe('li-client-secret')
      expect(tokenCallBody.get('grant_type')).toBe('authorization_code')

      expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: 'Bearer li-access-token' },
      })

      expect(result.accessToken).toBe('li-access-token')
      expect(result.refreshToken).toBeNull()
      expect(result.platformUserId).toBe('urn:li:person:782bbtaQ')
      expect(result.platformUsername).toBe('782bbtaQ')
      expect(result.platformDisplayName).toBe('Acme Founder')
      expect(result.scopesGranted).toEqual(['openid', 'profile', 'w_member_social'])
    })

    it('a token-endpoint network failure throws NETWORK', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'))
      await expect(
        provider.exchangeOAuthCode({ platform: 'linkedin', code: 'c', redirectUri: 'https://app.test/cb' }),
      ).rejects.toMatchObject({ code: 'NETWORK' })
    })

    it('a non-ok token response throws PLATFORM_REJECTED', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }))
      await expect(
        provider.exchangeOAuthCode({ platform: 'linkedin', code: 'c', redirectUri: 'https://app.test/cb' }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED' })
    })

    it('an unexpected token response shape (Zod failure) throws PLATFORM_REJECTED with the Zod message', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { not_a_token_response: true }))
      await expect(
        provider.exchangeOAuthCode({ platform: 'linkedin', code: 'c', redirectUri: 'https://app.test/cb' }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED', details: expect.objectContaining({ zodError: expect.any(String) }) })
    })

    it('a non-ok userinfo response throws PLATFORM_REJECTED', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 100 }))
        .mockResolvedValueOnce(jsonResponse(401, {}))
      await expect(
        provider.exchangeOAuthCode({ platform: 'linkedin', code: 'c', redirectUri: 'https://app.test/cb' }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED' })
    })
  })

  describe('SOCIAL-LI-AUTHOR-URN (ADR 0028 §5.1)', () => {
    it('isOrganizationAuthorUrn reads the type from the URN prefix — no discriminator column needed', () => {
      expect(isOrganizationAuthorUrn('urn:li:organization:12345')).toBe(true)
      expect(isOrganizationAuthorUrn('urn:li:person:782bbtaQ')).toBe(false)
    })

    it('a person URN is accepted as the publish author', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { platform_user_id: 'urn:li:person:782bbtaQ' }, error: null }))
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } }))

      await provider.publish({ socialAccountId: 'sa-1', content: 'hello', hashtags: [], mediaUrls: [] })

      const publishBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
      expect(publishBody.author).toBe('urn:li:person:782bbtaQ')
    })

    it('an organization URN goes through the SAME code path and is asserted as such — plumbing is not deferred, only the scope to request one is (A-8)', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { platform_user_id: 'urn:li:organization:999' }, error: null }))
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:2' } }))

      await provider.publish({ socialAccountId: 'sa-2', content: 'hello', hashtags: [], mediaUrls: [] })

      const publishBody = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
      expect(publishBody.author).toBe('urn:li:organization:999')
    })
  })

  describe('publish — required headers and body shape (ADR 0028 §3.1)', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { platform_user_id: 'urn:li:person:782bbtaQ' }, error: null }))
    })

    it('sends the four required headers and the exact body shape', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } }))

      await provider.publish({ socialAccountId: 'sa-1', content: 'Launch day!', hashtags: ['saas', '#launch'], mediaUrls: [] })

      const [url, init] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.linkedin.com/rest/posts')
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer fresh-access-token',
        'Linkedin-Version': expect.any(String),
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      })
      const body = JSON.parse(init.body as string)
      expect(body.author).toBe('urn:li:person:782bbtaQ')
      expect(body.commentary).toBe('Launch day!\n\n#saas #launch')
      expect(body.visibility).toBe('PUBLIC')
      expect(body.distribution).toEqual({ feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] })
      expect(body.lifecycleState).toBe('PUBLISHED')
      expect(body.isReshareDisabledByAuthor).toBe(false)
    })
  })

  describe('SOCIAL-LI-POSTID-FROM-HEADER (ADR 0028 §3.1 — "the single most likely native-implementation mistake")', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { platform_user_id: 'urn:li:person:782bbtaQ' }, error: null }))
    })

    it('platformPostId is read from the x-restli-id HEADER; a DECOY id in the body is ignored', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'decoy-id-from-body', urn: 'urn:li:share:DECOY' }), {
          status: 201,
          headers: { 'x-restli-id': 'urn:li:share:6844785523593134080', 'Content-Type': 'application/json' },
        }),
      )

      const result = await provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] })

      expect(result.platformPostId).toBe('urn:li:share:6844785523593134080')
      expect(result.platformPostId).not.toContain('decoy')
      expect(result.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:6844785523593134080/')
    })

    it('a 201 with no x-restli-id header throws PLATFORM_REJECTED', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 201 }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED' })
    })
  })

  describe('publish — error mapping', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { platform_user_id: 'urn:li:person:782bbtaQ' }, error: null }))
    })

    it('429 -> RATE_LIMITED with retryAfterSeconds from the header', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '42' } }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 42 })
    })

    it('401/403 -> TOKEN_EXPIRED', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    })

    it('a network error throws NETWORK', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'NETWORK' })
    })

    it('an unresolvable social account throws TOKEN_REVOKED', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: null, error: { message: 'not found' } }))
      await expect(
        provider.publish({ socialAccountId: 'sa-missing', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' })
    })
  })

  describe('SOCIAL-MEDIA-GUARD (A-3, ADR 0028 §3.4)', () => {
    it('non-empty mediaUrls -> PLATFORM_REJECTED with ZERO fetch calls', async () => {
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: ['https://example.com/photo.jpg'] }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED', details: expect.objectContaining({ reason: 'media_deferred' }) })

      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockWithFreshToken).not.toHaveBeenCalled()
    })
  })

  describe('fetchPostMetrics / fetchEngagement', () => {
    it('both throw NOT_IMPLEMENTED', async () => {
      await expect(provider.fetchPostMetrics({ socialAccountId: 'sa-1', platformPostId: 'p-1' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
      await expect(provider.fetchEngagement({ socialAccountId: 'sa-1', sinceCursor: null })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
    })
  })

  describe('SOCIAL-LI-EXPIRY-REVOKED (ADR 0028 §4.3)', () => {
    it('refreshAccessToken throws TOKEN_REVOKED, never TOKEN_EXPIRED — asserted by CODE. The publishing orchestrator\'s terminal handling of TOKEN_REVOKED is already proven generically in lib/publishing/orchestrator.test.ts ("TOKEN_REVOKED: terminal failed"), which this provider now feeds via the exact same code.', async () => {
      let caught: unknown
      try {
        await provider.refreshAccessToken({ socialAccountId: 'sa-1' })
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(SocialProviderError)
      expect((caught as SocialProviderError).code).toBe('TOKEN_REVOKED')
      expect((caught as SocialProviderError).code).not.toBe('TOKEN_EXPIRED')
    })
  })

  describe('SOCIAL-REVOKE-NEVER-BLOCKS (Tier 2 half — ADR 0028 §4.4)', () => {
    it('never throws and makes zero network calls — LinkedIn has no callable revocation endpoint (N2.1 finding 3)', async () => {
      await expect(provider.revokeAccessToken({ socialAccountId: 'sa-1' })).resolves.toBeUndefined()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
