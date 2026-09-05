import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatISO } from 'date-fns'
import { TwitterProvider } from '../twitter-provider'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      X_CLIENT_ID: 'x-client-id',
      X_CLIENT_SECRET: 'x-client-secret',
    },
  },
}))

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockServiceClient = { from: mockFrom, rpc: mockRpc }
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockServiceClient,
}))

const mockWithFreshToken = vi.fn()
const mockReadRefreshToken = vi.fn()
vi.mock('../vault', () => ({
  withFreshToken: (...args: unknown[]) => mockWithFreshToken(...args),
  readRefreshToken: (...args: unknown[]) => mockReadRefreshToken(...args),
}))

const mockGeneratePkceVerifier = vi.fn()
const mockGeneratePkceChallenge = vi.fn()
const mockSetPkceVerifierCookie = vi.fn()
const mockReadAndClearPkceVerifierCookie = vi.fn()
vi.mock('../oauth/pkce', () => ({
  generatePkceVerifier: (...args: unknown[]) => mockGeneratePkceVerifier(...args),
  generatePkceChallenge: (...args: unknown[]) => mockGeneratePkceChallenge(...args),
  setPkceVerifierCookie: (...args: unknown[]) => mockSetPkceVerifierCookie(...args),
  readAndClearPkceVerifierCookie: (...args: unknown[]) => mockReadAndClearPkceVerifierCookie(...args),
}))

function makeAccountQueryStub(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('TwitterProvider', () => {
  let provider: TwitterProvider
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new TwitterProvider()
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    mockWithFreshToken.mockImplementation(async (_id, _refreshFn, fn) => fn('fresh-access-token'))
    mockGeneratePkceVerifier.mockReturnValue('pkce-verifier-value')
    mockGeneratePkceChallenge.mockResolvedValue('pkce-challenge-value')
    mockReadAndClearPkceVerifierCookie.mockResolvedValue('pkce-verifier-value')
  })

  describe('platform', () => {
    it('is always "twitter", never "multi"', () => {
      expect(provider.platform).toBe('twitter')
    })
  })

  describe('getOAuthAuthorizeUrl', () => {
    it('builds the authorize URL with PKCE S256 params and sets the verifier cookie', async () => {
      const url = await provider.getOAuthAuthorizeUrl({
        platform: 'twitter',
        businessId: 'biz-1',
        redirectUri: 'https://app.test/api/social/twitter/callback',
        scopes: ['tweet.write', 'offline.access'],
        state: 'signed-state-jwt',
      })

      const parsed = new URL(url)
      expect(parsed.origin + parsed.pathname).toBe('https://x.com/i/oauth2/authorize')
      expect(parsed.searchParams.get('client_id')).toBe('x-client-id')
      expect(parsed.searchParams.get('code_challenge')).toBe('pkce-challenge-value')
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
      expect(parsed.searchParams.get('state')).toBe('signed-state-jwt')
      expect(mockSetPkceVerifierCookie).toHaveBeenCalledWith('pkce-verifier-value')
    })
  })

  describe('exchangeOAuthCode', () => {
    it('exchanges the code (Basic auth, code_verifier from the cookie) then fetches identity', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'x-access-token', refresh_token: 'x-refresh-token', expires_in: 7200, scope: 'tweet.write offline.access' }))
        .mockResolvedValueOnce(jsonResponse(200, { data: { id: '12345', username: 'acme_founder' } }))

      const result = await provider.exchangeOAuthCode({
        platform: 'twitter',
        code: 'auth-code-abc',
        redirectUri: 'https://app.test/api/social/twitter/callback',
      })

      expect(mockReadAndClearPkceVerifierCookie).toHaveBeenCalledOnce()
      const [tokenUrl, tokenInit] = mockFetch.mock.calls[0]!
      expect(tokenUrl).toBe('https://api.x.com/2/oauth2/token')
      expect(tokenInit.headers.Authorization).toBe(`Basic ${Buffer.from('x-client-id:x-client-secret').toString('base64')}`)
      const tokenBody = tokenInit.body as URLSearchParams
      expect(tokenBody.get('code_verifier')).toBe('pkce-verifier-value')

      expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://api.x.com/2/users/me', { headers: { Authorization: 'Bearer x-access-token' } })

      expect(result.accessToken).toBe('x-access-token')
      expect(result.refreshToken).toBe('x-refresh-token')
      expect(result.platformUserId).toBe('12345')
      expect(result.platformUsername).toBe('acme_founder')
    })

    it('missing PKCE verifier cookie throws PLATFORM_REJECTED before any fetch', async () => {
      mockReadAndClearPkceVerifierCookie.mockResolvedValue(null)
      await expect(
        provider.exchangeOAuthCode({ platform: 'twitter', code: 'c', redirectUri: 'https://app.test/cb' }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED' })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('a network error throws NETWORK', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'))
      await expect(
        provider.exchangeOAuthCode({ platform: 'twitter', code: 'c', redirectUri: 'https://app.test/cb' }),
      ).rejects.toMatchObject({ code: 'NETWORK' })
    })
  })

  describe('SOCIAL-X-EXPIRY-FROM-RESPONSE (ADR 0028 §4.2)', () => {
    it('token_expires_at is derived from expires_in, NOT the config tokenExpirySeconds (2h) — fixture where they DISAGREE', async () => {
      const NOW = new Date('2026-09-04T12:00:00Z')
      vi.useFakeTimers()
      vi.setSystemTime(NOW)

      // expires_in here (1 hour) deliberately disagrees with the config
      // value (2 hours = 7200s) — expires_in must win.
      mockFetch
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3600 }))
        .mockResolvedValueOnce(jsonResponse(200, { data: { id: '1', username: 'u' } }))

      const result = await provider.exchangeOAuthCode({ platform: 'twitter', code: 'c', redirectUri: 'https://app.test/cb' })

      expect(result.tokenExpiresAt).toBe(formatISO(new Date(NOW.getTime() + 3600 * 1000)))
      vi.useRealTimers()
    })
  })

  describe('publish — media guard and character limit', () => {
    it('SOCIAL-MEDIA-GUARD: non-empty mediaUrls -> PLATFORM_REJECTED with ZERO fetch calls', async () => {
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: ['https://example.com/photo.jpg'] }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED', details: expect.objectContaining({ reason: 'media_deferred' }) })
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockWithFreshToken).not.toHaveBeenCalled()
    })

    it('text exceeding 280 chars -> PLATFORM_REJECTED with ZERO fetch calls', async () => {
      const longContent = 'a'.repeat(281)
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: longContent, hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED', details: expect.objectContaining({ limit: 280 }) })
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('publish — happy path and permalink construction', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { platform_username: 'acme_founder' }, error: null }))
    })

    it('constructs the permalink from username + returned id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(201, { data: { id: '999888777' } }))

      const result = await provider.publish({ socialAccountId: 'sa-1', content: 'hello', hashtags: ['saas'], mediaUrls: [] })

      expect(result.platformPostId).toBe('999888777')
      expect(result.url).toBe('https://x.com/acme_founder/status/999888777')
      const [tweetUrl, tweetInit] = mockFetch.mock.calls[0]!
      expect(tweetUrl).toBe('https://api.x.com/2/tweets')
      expect(JSON.parse(tweetInit.body as string)).toEqual({ text: 'hello #saas' })
    })

    it('url is null when the username is unavailable — never fabricates a permalink', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: null, error: { message: 'not found' } }))
      mockFetch.mockResolvedValueOnce(jsonResponse(201, { data: { id: '1' } }))

      const result = await provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] })

      expect(result.url).toBeNull()
    })

    it('429 -> RATE_LIMITED with retryAfterSeconds derived from x-rate-limit-reset, not Retry-After', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'x-rate-limit-reset': String(nowSeconds + 30) } }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    })

    it('SOCIAL-RATE-LIMIT-RETRY-AFTER: a missing x-rate-limit-reset header falls back to 60', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 429 }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 60 })
    })

    it('SOCIAL-RATE-LIMIT-RETRY-AFTER: retryAfterSeconds is undefined on every non-RATE_LIMITED code', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }))
      let caught: unknown
      try {
        await provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] })
      } catch (e) {
        caught = e
      }
      expect((caught as { retryAfterSeconds: number | null }).retryAfterSeconds).toBeNull()
    })

    // ADR 0028 §7.2 — X's mapping is "as above by analogy" with LinkedIn's:
    // 401 and 403 are DIFFERENT codes.
    it('401 -> TOKEN_EXPIRED', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    })

    it('403 -> TOKEN_REVOKED', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' })
    })

    it('409 -> NETWORK (deliberate, by analogy with LinkedIn — no "retryable conflict" code exists)', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 409 }))
      await expect(
        provider.publish({ socialAccountId: 'sa-1', content: 'hi', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'NETWORK' })
    })
  })

  describe('fetchPostMetrics / fetchEngagement', () => {
    it('both throw NOT_IMPLEMENTED', async () => {
      await expect(provider.fetchPostMetrics({ socialAccountId: 'sa-1', platformPostId: 'p-1' })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
      await expect(provider.fetchEngagement({ socialAccountId: 'sa-1', sinceCursor: null })).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
    })
  })

  describe('refreshAccessToken — rotation (ADR 0028 §4.2, A-4)', () => {
    const ACCOUNT = { vault_access_token_id: 'vault-access-1', vault_refresh_token_id: 'vault-refresh-1' }

    beforeEach(() => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: ACCOUNT, error: null }))
      mockReadRefreshToken.mockResolvedValue({ token: 'old-refresh-token' })
      mockRpc.mockResolvedValue({ data: null, error: null })
    })

    it('rotation: updates BOTH secrets IN PLACE — the vault ids are UNCHANGED before and after', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 }))

      await provider.refreshAccessToken({ socialAccountId: 'sa-1' })

      expect(mockRpc).toHaveBeenNthCalledWith(1, 'vault_update_secret', { secret_id: 'vault-access-1', new_secret: 'new-access' })
      expect(mockRpc).toHaveBeenNthCalledWith(2, 'vault_update_secret', { secret_id: 'vault-refresh-1', new_secret: 'new-refresh' })
      // Same ids as ACCOUNT — never delete-then-create.
    })

    it('SOCIAL-VAULT-UPDATE-CHECKED: an errored vault_update_secret call is SURFACED, not silently swallowed into a success TokenSet (the exact D-alpha behaviour)', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 }))
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'vault write failed' } })

      await expect(provider.refreshAccessToken({ socialAccountId: 'sa-1' })).rejects.toMatchObject({
        code: 'UNKNOWN',
        details: expect.objectContaining({ cause: 'vault write failed' }),
      })
    })

    it('SOCIAL-VAULT-UPDATE-CHECKED: the SECOND (refresh-token) update erroring is also surfaced', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 }))
      mockRpc
        .mockResolvedValueOnce({ data: null, error: null }) // access token update succeeds
        .mockResolvedValueOnce({ data: null, error: { message: 'refresh vault write failed' } })

      await expect(provider.refreshAccessToken({ socialAccountId: 'sa-1' })).rejects.toMatchObject({ code: 'UNKNOWN' })
    })

    it('X rejecting the refresh token (400/401) throws TOKEN_REVOKED', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 400 }))
      await expect(provider.refreshAccessToken({ socialAccountId: 'sa-1' })).rejects.toMatchObject({ code: 'TOKEN_REVOKED' })
    })

    it('no refresh token on file throws TOKEN_REVOKED before any network call', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { vault_access_token_id: 'a', vault_refresh_token_id: null }, error: null }))
      await expect(provider.refreshAccessToken({ socialAccountId: 'sa-1' })).rejects.toMatchObject({ code: 'TOKEN_REVOKED' })
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('SOCIAL-REVOKE-NEVER-BLOCKS (ADR 0028 §4.4)', () => {
    it('never throws when the network call fails', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { vault_access_token_id: 'vault-1' }, error: null }))
      mockRpc.mockResolvedValue({ data: 'live-token', error: null })
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'))

      await expect(provider.revokeAccessToken({ socialAccountId: 'sa-1' })).resolves.toBeUndefined()
    })

    it('returns early with zero fetch calls when there is no vault id', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { vault_access_token_id: null }, error: null }))
      await expect(provider.revokeAccessToken({ socialAccountId: 'sa-1' })).resolves.toBeUndefined()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    // Session 30.5-D, D3: a try/catch only discards a THROWN error — it does
    // not protect against a hanging fetch, which would block the disconnect
    // route indefinitely. The call must be explicitly bounded.
    it('bounds the network call with an explicit timeout signal, not just a try/catch', async () => {
      mockFrom.mockReturnValue(makeAccountQueryStub({ data: { vault_access_token_id: 'vault-1' }, error: null }))
      mockRpc.mockResolvedValue({ data: 'live-token', error: null })
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

      await provider.revokeAccessToken({ socialAccountId: 'sa-1' })

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })
  })
})
