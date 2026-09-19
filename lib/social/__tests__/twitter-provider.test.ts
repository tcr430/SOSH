import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatISO } from 'date-fns'
import { TwitterProvider } from '../twitter-provider'
import { SOCIAL_READ_TIMEOUT_MS } from '../constants'

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
// Split across two modules (Vercel build fix, 2026-09-06): pkce-crypto.ts
// (pure, statically imported) and pkce.ts (cookies, lazy-imported at the
// call site since it depends on next/headers).
vi.mock('../oauth/pkce-crypto', () => ({
  generatePkceVerifier: (...args: unknown[]) => mockGeneratePkceVerifier(...args),
  generatePkceChallenge: (...args: unknown[]) => mockGeneratePkceChallenge(...args),
}))
vi.mock('../oauth/pkce', () => ({
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

    it('BACKFILL-SCOPES-PERSISTED: scopes_granted is persisted on refresh, split from the space-delimited scope string', async () => {
      const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
      mockFrom.mockReturnValue({ ...makeAccountQueryStub({ data: ACCOUNT, error: null }), update: updateSpy })
      mockFetch.mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200, scope: 'tweet.read users.read offline.access' }),
      )

      await provider.refreshAccessToken({ socialAccountId: 'sa-1' })

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scopes_granted: ['tweet.read', 'users.read', 'offline.access'] }),
      )
    })

    it('an absent scope on refresh leaves scopes_granted out of the UPDATE — the prior value survives (Session 32-D D10, NIT-5)', async () => {
      const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
      mockFrom.mockReturnValue({ ...makeAccountQueryStub({ data: ACCOUNT, error: null }), update: updateSpy })
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 }))

      await provider.refreshAccessToken({ socialAccountId: 'sa-1' })

      expect(updateSpy).toHaveBeenCalled()
      expect(updateSpy.mock.calls[0]![0]).not.toHaveProperty('scopes_granted')
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

  describe('fetchRecentPosts (ADR 0025 §2, I2.3)', () => {
    const ACCOUNT_ID = 'sa-1'
    const PLATFORM_USER_ID = 'x-user-123'
    const PLATFORM_USERNAME = 'acme_founder'
    const ACCESS_TOKEN = 'fresh-access-token'
    const SENSITIVE_POST_TEXT = 'FIXTURE-POST-TEXT-that-must-never-leak-into-details'

    function identityResponse(id = PLATFORM_USER_ID) {
      return jsonResponse(200, { data: { id, username: PLATFORM_USERNAME } })
    }

    function timelineResponse(
      tweets: Array<Record<string, unknown>>,
      meta: Record<string, unknown> = {},
    ) {
      return jsonResponse(200, { data: tweets, meta })
    }

    function baseInput(overrides: Partial<Parameters<TwitterProvider['fetchRecentPosts']>[0]> = {}) {
      return {
        platform: 'twitter' as const,
        socialAccountId: ACCOUNT_ID,
        pageSize: 10,
        cursor: null,
        notBefore: null,
        ...overrides,
      }
    }

    beforeEach(() => {
      mockFrom.mockReturnValue(
        makeAccountQueryStub({
          data: { platform_user_id: PLATFORM_USER_ID, platform_username: PLATFORM_USERNAME },
          error: null,
        }),
      )
    })

    it('the timeline request URL carries exclude=replies,retweets and NO expansions param', async () => {
      mockFetch
        .mockResolvedValueOnce(identityResponse())
        .mockResolvedValueOnce(timelineResponse([]))

      await provider.fetchRecentPosts(baseInput())

      const [timelineUrl] = mockFetch.mock.calls[1]!
      const url = new URL(timelineUrl as string)
      expect(url.pathname).toBe(`/2/users/${PLATFORM_USER_ID}/tweets`)
      expect(url.searchParams.get('exclude')).toBe('replies,retweets')
      expect(url.searchParams.has('expansions')).toBe(false)
    })

    it('a page containing a quote is returned without it', async () => {
      mockFetch
        .mockResolvedValueOnce(identityResponse())
        .mockResolvedValueOnce(
          timelineResponse([
            { id: 't-original', created_at: '2026-08-01T00:00:00.000Z', text: 'An original post' },
            {
              id: 't-quote',
              created_at: '2026-08-02T00:00:00.000Z',
              text: 'A quote post',
              referenced_tweets: [{ type: 'quoted', id: 't-quoted-source' }],
            },
          ]),
        )

      const page = await provider.fetchRecentPosts(baseInput())

      expect(page.posts.map((p) => p.platformPostId)).toEqual(['t-original'])
    })

    it('page 1 calls /2/users/me first; identity mismatch fails closed with ZERO timeline calls', async () => {
      mockFetch.mockResolvedValueOnce(identityResponse('some-other-user-id'))

      await expect(provider.fetchRecentPosts(baseInput())).rejects.toMatchObject({
        code: 'PLATFORM_REJECTED',
        details: { reason: 'identity_mismatch' },
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0]![0]).toBe('https://api.x.com/2/users/me')
    })

    it('page 2 does not call /2/users/me again, and withFreshToken is invoked once per page', async () => {
      mockFetch
        .mockResolvedValueOnce(identityResponse())
        .mockResolvedValueOnce(timelineResponse([], { next_token: 'x-pagination-token-1' }))

      const page1 = await provider.fetchRecentPosts(baseInput())
      expect(mockWithFreshToken).toHaveBeenCalledTimes(1)
      expect(page1.nextCursor).not.toBeNull()

      mockFetch.mockResolvedValueOnce(timelineResponse([]))
      await provider.fetchRecentPosts(baseInput({ cursor: page1.nextCursor }))

      expect(mockWithFreshToken).toHaveBeenCalledTimes(2)
      // Only ONE fetch call on page 2 (the timeline) — no second /users/me.
      const page2Calls = mockFetch.mock.calls.slice(2)
      expect(page2Calls).toHaveLength(1)
      expect(page2Calls[0]![0]).not.toBe('https://api.x.com/2/users/me')
    })

    it('a cross-account cursor is rejected as cursor_invalid', async () => {
      mockFetch
        .mockResolvedValueOnce(identityResponse())
        .mockResolvedValueOnce(timelineResponse([], { next_token: 'x-pagination-token-1' }))
      const page1 = await provider.fetchRecentPosts(baseInput())

      await expect(
        provider.fetchRecentPosts(baseInput({ socialAccountId: 'sa-DIFFERENT-account', cursor: page1.nextCursor })),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED', details: { reason: 'cursor_invalid' } })
    })

    it('a garbage cursor is rejected as cursor_invalid, with zero fetch calls', async () => {
      await expect(
        provider.fetchRecentPosts(baseInput({ cursor: 'not-a-valid-cursor-at-all' })),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED', details: { reason: 'cursor_invalid' } })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('429 with Retry-After: 5000 => retryAfterSeconds capped at 900, no timer scheduled', async () => {
      vi.useFakeTimers()
      try {
        mockFetch
          .mockResolvedValueOnce(identityResponse())
          .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '5000' } }))

        await expect(provider.fetchRecentPosts(baseInput())).rejects.toMatchObject({
          code: 'RATE_LIMITED',
          retryAfterSeconds: 900,
        })
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('a hung response maps to NETWORK, bounded by SOCIAL_READ_TIMEOUT_MS (10000ms)', async () => {
      expect(SOCIAL_READ_TIMEOUT_MS).toBe(10_000)
      const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
      mockFetch.mockResolvedValueOnce(identityResponse()).mockRejectedValueOnce(timeoutError)

      await expect(provider.fetchRecentPosts(baseInput())).rejects.toMatchObject({ code: 'NETWORK' })
      const [, init] = mockFetch.mock.calls[1] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('a Zod parse failure maps to UNKNOWN', async () => {
      // `data` present but the wrong TYPE (a string, not an array of
      // tweets) — actually violates XTweetsListSchema, unlike an absent
      // `data` field (which the schema's own .optional() treats as zero
      // posts, not a parse failure).
      mockFetch.mockResolvedValueOnce(identityResponse()).mockResolvedValueOnce(jsonResponse(200, { data: 'not-an-array' }))
      await expect(provider.fetchRecentPosts(baseInput())).rejects.toMatchObject({ code: 'UNKNOWN' })
    })

    it('metrics map from public_metrics per the ADR table; saves/impressions null when absent, clicks/reach always null', async () => {
      mockFetch.mockResolvedValueOnce(identityResponse()).mockResolvedValueOnce(
        timelineResponse([
          {
            id: 't1',
            created_at: '2026-08-01T00:00:00.000Z',
            text: 'metrics post',
            public_metrics: { like_count: 5, reply_count: 2, retweet_count: 3, quote_count: 1 },
          },
        ]),
      )
      const page = await provider.fetchRecentPosts(baseInput())
      expect(page.posts[0]!.metrics).toEqual({
        likes: 5,
        comments: 2,
        shares: 4, // retweet_count + quote_count
        saves: null,
        impressions: null,
        clicks: null,
        reach: null,
        fetchedAt: expect.any(String),
      })
    })

    it('content truncates at 3000 chars and replaces t.co links with their visible display text', async () => {
      const longText = `check this out https://t.co/abc123 ${'x'.repeat(3200)}`
      mockFetch.mockResolvedValueOnce(identityResponse()).mockResolvedValueOnce(
        timelineResponse([
          {
            id: 't1',
            created_at: '2026-08-01T00:00:00.000Z',
            text: longText,
            entities: { urls: [{ start: 15, end: 35, url: 'https://t.co/abc123', display_url: 'example.com/page' }] },
          },
        ]),
      )
      const page = await provider.fetchRecentPosts(baseInput())
      expect(page.posts[0]!.content.length).toBe(3000)
      expect(page.posts[0]!.content).toContain('example.com/page')
      expect(page.posts[0]!.content).not.toContain('t.co')
    })

    // BACKFILL-ERROR-DETAILS-CONTENT-FREE — proven for the provider here
    // (closes at I2.9 with the tick log). Every rejection this file produces
    // is checked: JSON.stringify(err.details) must contain none of the
    // access token, the cursor string, or fixture post text.
    it('every thrown error in this file keeps details free of the access token, cursor, and post text', async () => {
      const garbageCursor = 'garbage-cursor-value-xyz'
      const caught: unknown[] = []

      mockFetch.mockResolvedValueOnce(identityResponse('mismatched-id'))
      await provider.fetchRecentPosts(baseInput()).catch((e) => caught.push(e))

      await provider.fetchRecentPosts(baseInput({ cursor: garbageCursor })).catch((e) => caught.push(e))

      mockFetch
        .mockResolvedValueOnce(identityResponse())
        .mockResolvedValueOnce(
          jsonResponse(403, { title: 'Forbidden', detail: `insufficient scope near "${SENSITIVE_POST_TEXT}"` }),
        )
      await provider.fetchRecentPosts(baseInput()).catch((e) => caught.push(e))

      expect(caught.length).toBeGreaterThan(0)
      for (const err of caught) {
        const serialized = JSON.stringify((err as { details: unknown }).details)
        expect(serialized).not.toContain(ACCESS_TOKEN)
        expect(serialized).not.toContain(garbageCursor)
        expect(serialized).not.toContain(SENSITIVE_POST_TEXT)
      }
    })
  })
})
