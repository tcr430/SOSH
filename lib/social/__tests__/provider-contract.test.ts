import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockProvider } from '../mock-provider'
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

vi.mock('../oauth/pkce', () => ({
  generatePkceVerifier: () => 'contract-test-verifier',
  generatePkceChallenge: async () => 'contract-test-challenge',
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

  it('implements all seven SocialProvider methods', () => {
    expect(typeof provider.getOAuthAuthorizeUrl).toBe('function')
    expect(typeof provider.exchangeOAuthCode).toBe('function')
    expect(typeof provider.publish).toBe('function')
    expect(typeof provider.fetchPostMetrics).toBe('function')
    expect(typeof provider.fetchEngagement).toBe('function')
    expect(typeof provider.refreshAccessToken).toBe('function')
    expect(typeof provider.revokeAccessToken).toBe('function')
  })

  // ADR 0028 §9.1 also asserts "platform is a real Platform and never
  // 'multi'". MockProvider is deliberately exempted from this one assertion:
  // the registry (registry.ts:24-57) still shares one MockProvider instance
  // across all five platforms until N2.10 makes the registry overrides-only,
  // so a fixed real-platform identity on MockProvider today would misrepresent
  // that shared role for four of the five platforms it serves. This assertion
  // becomes real and enforced the moment N2.10 adds LinkedInProvider and
  // TwitterProvider, both of which are always bound to exactly one real
  // platform.
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

  it('fetchPostMetrics returns PostMetrics | null, or throws a valid SocialProviderError coded NOT_IMPLEMENTED', async () => {
    try {
      const result = await provider.fetchPostMetrics({
        socialAccountId: 'sa-1',
        platformPostId: 'p-1',
      })
      expect(result === null || typeof result === 'object').toBe(true)
    } catch (err) {
      assertValidSocialProviderError(err)
      expect(err.code).toBe('NOT_IMPLEMENTED')
    }
  })
})

describe('SOCIAL_PROVIDER_MODE=mock (SOCIAL-MOCK-MODE-OFFLINE)', () => {
  const PLATFORMS: readonly Platform[] = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']

  it('serves all five platforms and performs zero network I/O', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({
      config: {
        server: { SOCIAL_PROVIDER_MODE: 'mock', POSTIZ_BASE_URL: '', POSTIZ_API_KEY: '' },
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
      }

      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      vi.doUnmock('@/lib/config')
      vi.resetModules()
    }
  })
})
