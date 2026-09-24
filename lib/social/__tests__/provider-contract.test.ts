import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockProvider, MOCK_FIXTURE_ACCOUNT_IDS } from '../mock-provider'
import { LinkedInProvider } from '../linkedin-provider'
import { TwitterProvider } from '../twitter-provider'
import { SocialProviderError } from '../errors'
import type { SocialProvider, SocialProviderErrorCode } from '../types'
import type { Platform } from '@/lib/db/types'

// N2.10 additions: LinkedInProvider and TwitterProvider are real
// implementations now exercised by this suite, which needs their
// dependencies to run offline. config supplies dummy client credentials
// (only LINKEDIN_CLIENT_ID/SECRET, X_CLIENT_ID/SECRET are ever read by the
// assertions below — getOAuthAuthorizeUrl and revokeAccessToken); the
// service-role client is stubbed so TwitterProvider.revokeAccessToken's
// account lookup resolves to "no vault id" and returns early without any
// network I/O; PKCE is stubbed so TwitterProvider.getOAuthAuthorizeUrl
// doesn't need a real Next.js request context (next/headers' cookies()).
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      LINKEDIN_CLIENT_ID: 'contract-test-linkedin-client-id',
      LINKEDIN_CLIENT_SECRET: 'contract-test-linkedin-client-secret',
      X_CLIENT_ID: 'contract-test-x-client-id',
      X_CLIENT_SECRET: 'contract-test-x-client-secret',
    },
    public: { NODE_ENV: 'test' },
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  }),
}))

// Split across two modules (Vercel build fix, 2026-09-06) — see
// twitter-provider.ts / pkce.ts for why.
vi.mock('../oauth/pkce-crypto', () => ({
  generatePkceVerifier: () => 'contract-test-verifier',
  generatePkceChallenge: async () => 'contract-test-challenge',
}))
vi.mock('../oauth/pkce', () => ({
  setPkceVerifierCookie: async () => {},
  readAndClearPkceVerifierCookie: async () => null,
}))

// ADR 0028 §9.1 — the shared contract suite. Every implementation added here
// must satisfy the same assertions with zero edits below; if adding an
// implementation requires touching an assertion, it is not a contract suite.
const IMPLEMENTATIONS: { name: string; makeProvider: () => SocialProvider }[] = [
  { name: 'MockProvider', makeProvider: () => new MockProvider() },
  { name: 'LinkedInProvider', makeProvider: () => new LinkedInProvider() },
  { name: 'TwitterProvider', makeProvider: () => new TwitterProvider() },
]

const ALL_ERROR_CODES: readonly SocialProviderErrorCode[] = [
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'RATE_LIMITED',
  'PLATFORM_REJECTED',
  'NETWORK',
  'NOT_IMPLEMENTED',
  'PROVIDER_NOT_CONFIGURED',
  'UNKNOWN',
]

function assertValidSocialProviderError(err: unknown): asserts err is SocialProviderError {
  expect(err).toBeInstanceOf(SocialProviderError)
  expect(ALL_ERROR_CODES).toContain((err as SocialProviderError).code)
}

describe.each(IMPLEMENTATIONS)('SocialProvider contract: $name', ({ name, makeProvider }) => {
  let provider: SocialProvider

  beforeEach(() => {
    provider = makeProvider()
  })

  it('implements all eight SocialProvider methods', () => {
    expect(typeof provider.getOAuthAuthorizeUrl).toBe('function')
    expect(typeof provider.exchangeOAuthCode).toBe('function')
    expect(typeof provider.publish).toBe('function')
    expect(typeof provider.fetchPostMetrics).toBe('function')
    expect(typeof provider.fetchEngagement).toBe('function')
    expect(typeof provider.refreshAccessToken).toBe('function')
    expect(typeof provider.revokeAccessToken).toBe('function')
    expect(typeof provider.fetchRecentPosts).toBe('function')
  })

  // ADR 0028 §9.1 also asserts "platform is a real Platform and never
  // 'multi'". MockProvider is deliberately exempted from this one assertion:
  // the registry (registry.ts:16-34, overrides-only since N2.10, MockProvider
  // registered for all five platforms in mock mode at registry.ts:44-54)
  // still shares one MockProvider instance across all five platforms in mock
  // mode, so a fixed real-platform identity on MockProvider would misrepresent
  // that shared role for four of the five platforms it serves. The assertion
  // IS real and enforced for LinkedInProvider and TwitterProvider — both are
  // in IMPLEMENTATIONS above and always bound to exactly one real platform.
  // (Re-tensed Session 30.5-D, D7, MINOR-5: this comment previously read as
  // describing pending work; N2.10 landed inside the reviewed range.)
  if (name !== 'MockProvider') {
    it("platform is a real Platform, never 'multi'", () => {
      expect(provider.platform).not.toBe('multi')
    })
  }

  it('getOAuthAuthorizeUrl resolves to an absolute URL carrying the state', async () => {
    const state = `test-state-${crypto.randomUUID()}`
    const result = provider.getOAuthAuthorizeUrl({
      platform: 'linkedin',
      businessId: 'biz-1',
      redirectUri: 'https://app.test/api/social/linkedin/callback',
      scopes: ['openid'],
      state,
    })

    expect(result).toBeInstanceOf(Promise)

    const url = await result
    expect(() => new URL(url)).not.toThrow()
    expect(url).toContain(state)
  })

  it('revokeAccessToken never throws', async () => {
    await expect(
      provider.revokeAccessToken({ socialAccountId: 'sa-1' }),
    ).resolves.toBeUndefined()
  })

  // ADR 0026 J2.1: TwitterProvider now implements fetchPostMetrics, so with
  // this suite's stubbed service client (no account row) it fails inside
  // withFreshToken with TOKEN_REVOKED rather than NOT_IMPLEMENTED. The contract
  // is therefore "a result, or ANY valid SocialProviderError" — the same
  // widening the fetchRecentPosts assertion below got at I2.3. LinkedIn's
  // NOT_IMPLEMENTED (its counts need the restricted r_member_social_feed) is
  // pinned in linkedin-provider.test.ts, and Twitter's real behaviour in
  // twitter-provider.test.ts.
  it('fetchPostMetrics returns PostMetrics | null, or throws a valid SocialProviderError', async () => {
    try {
      const result = await provider.fetchPostMetrics({
        socialAccountId: 'sa-1',
        platformPostId: 'p-1',
      })
      expect(result === null || typeof result === 'object').toBe(true)
    } catch (err) {
      assertValidSocialProviderError(err)
    }
  })

  // BACKFILL-READ-FLAG-CONSISTENT (ADR 0025 §2.1/§12 constraint 2). The flag
  // is necessary, not sufficient: false => fetchRecentPosts throws
  // NOT_IMPLEMENTED with ZERO fetch calls; true => it never rejects
  // NOT_IMPLEMENTED, checked across every one of MockProvider's own named
  // fixtures (ADR §2.9's own wording: "across every MOCK fixture"). At I2.3,
  // TwitterProvider is ALSO true, but its real body needs the full
  // config/service-role/vault mocking twitter-provider.test.ts already
  // provides — exercising it here with none of that would make a real,
  // unmocked network attempt, which this neutral contract suite must never
  // do. So this assertion intentionally covers only the false-flag
  // implementations (LinkedIn) and MockProvider's fixtures; Twitter's
  // true-flag half of the SAME property is proven in twitter-provider.test.ts
  // instead (recorded fixtures, zero real network).
  it('historicalReadAvailable flag consistency for fetchRecentPosts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      if (!provider.historicalReadAvailable) {
        await expect(
          provider.fetchRecentPosts({
            platform: 'twitter',
            socialAccountId: 'sa-1',
            pageSize: 10,
            cursor: null,
            notBefore: null,
          }),
        ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
        expect(fetchSpy).not.toHaveBeenCalled()
      } else if (name === 'MockProvider') {
        for (const fixtureId of Object.values(MOCK_FIXTURE_ACCOUNT_IDS)) {
          await expect(
            provider.fetchRecentPosts({
              platform: 'twitter',
              socialAccountId: fixtureId,
              pageSize: 10,
              cursor: null,
              notBefore: null,
            }),
          ).resolves.toHaveProperty('posts')
        }
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })

  // BACKFILL-PROVIDER-BOUNDED (ADR 0025 §2.3/§12 constraint 3) — refuse,
  // don't clamp, on EVERY implementation regardless of its
  // historicalReadAvailable flag: an out-of-range pageSize is a caller bug,
  // checked before the flag is even consulted.
  it.each([4, 101])('fetchRecentPosts refuses pageSize=%d with a RangeError before any I/O', async (pageSize) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      await expect(
        provider.fetchRecentPosts({
          platform: 'twitter',
          socialAccountId: 'sa-1',
          pageSize,
          cursor: null,
          notBefore: null,
        }),
      ).rejects.toBeInstanceOf(RangeError)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

// I2.3 item 4 — pins the AS-SHIPPED flag table (Amendment B §B.3). This is
// what stops the I2.2 stub (Twitter false) silently surviving a future edit:
// a revert of Twitter's flag reddens here, not just in twitter-provider.test.ts.
describe('historicalReadAvailable — the as-shipped table', () => {
  it('TwitterProvider=true, LinkedInProvider=false, MockProvider=true', () => {
    expect(new TwitterProvider().historicalReadAvailable).toBe(true)
    expect(new LinkedInProvider().historicalReadAvailable).toBe(false)
    expect(new MockProvider().historicalReadAvailable).toBe(true)
  })
})

describe('SOCIAL_PROVIDER_MODE=mock (SOCIAL-MOCK-MODE-OFFLINE)', () => {
  const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']

  it('serves all five platforms and performs zero network I/O', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({
      config: {
        server: { SOCIAL_PROVIDER_MODE: 'mock' },
        public: { NODE_ENV: 'test' },
      },
    }))

    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    try {
      const { getRegistry, _resetRegistry } = await import('../registry')
      _resetRegistry()
      const registry = getRegistry()

      for (const platform of PLATFORMS) {
        const provider = registry.get(platform)
        const url = await provider.getOAuthAuthorizeUrl({
          platform,
          businessId: 'biz-1',
          redirectUri: 'https://app.test/api/social/callback',
          scopes: [],
          state: `state-${platform}`,
        })
        expect(() => new URL(url)).not.toThrow()

        // Extended at I2.2 (ADR 0025 §2.9 last line) — fetchRecentPosts
        // must also perform zero network I/O in mock mode.
        const page = await provider.fetchRecentPosts({
          platform,
          socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.STANDARD,
          pageSize: 10,
          cursor: null,
          notBefore: null,
        })
        expect(page.posts.length).toBeGreaterThan(0)
      }

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      vi.doUnmock('@/lib/config')
      vi.resetModules()
    }
  })
})
