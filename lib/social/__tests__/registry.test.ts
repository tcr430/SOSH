import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SocialProviderError } from '../errors'
import type { SocialProvider } from '../types'

// Top-level mock — controls what config returns for all tests.
// Individual tests mutate serverConfig / publicConfig to simulate environments.
const serverConfig = {
  SOCIAL_PROVIDER_MODE: '',
  LINKEDIN_CLIENT_ID: '',
  LINKEDIN_CLIENT_SECRET: '',
  X_CLIENT_ID: '',
  X_CLIENT_SECRET: '',
}

const publicConfig = {
  NODE_ENV: 'development' as 'development' | 'test' | 'production',
}

vi.mock('@/lib/config', () => ({
  config: { server: serverConfig, public: publicConfig },
}))

// Import after mocks are declared so the module sees the mock.
const { getRegistry, _resetRegistry } = await import('../registry')

describe('getRegistry', () => {
  beforeEach(() => {
    _resetRegistry()
    vi.unstubAllEnvs()
    serverConfig.SOCIAL_PROVIDER_MODE = ''
    serverConfig.LINKEDIN_CLIENT_ID = ''
    serverConfig.LINKEDIN_CLIENT_SECRET = ''
    serverConfig.X_CLIENT_ID = ''
    serverConfig.X_CLIENT_SECRET = ''
    publicConfig.NODE_ENV = 'development'
  })

  describe('SOCIAL_PROVIDER_MODE=mock (unchanged — L-9)', () => {
    it('serves MockProvider for all five platforms', () => {
      serverConfig.SOCIAL_PROVIDER_MODE = 'mock'
      const registry = getRegistry()
      for (const platform of ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'] as const) {
        expect(registry.get(platform).platform).toBe('multi')
      }
    })
  })

  // ADR 0028 §8.2 (N2.10) — SOCIAL-REGISTRY-PER-PLATFORM
  describe('SOCIAL-REGISTRY-PER-PLATFORM — overrides-only, no default', () => {
    it('registers LinkedInProvider when both LinkedIn credentials are present', () => {
      serverConfig.LINKEDIN_CLIENT_ID = 'test-id'
      serverConfig.LINKEDIN_CLIENT_SECRET = 'test-secret'
      const registry = getRegistry()
      expect(registry.get('linkedin').platform).toBe('linkedin')
    })

    it('registers TwitterProvider when both X credentials are present', () => {
      serverConfig.X_CLIENT_ID = 'test-id'
      serverConfig.X_CLIENT_SECRET = 'test-secret'
      const registry = getRegistry()
      expect(registry.get('twitter').platform).toBe('twitter')
    })

    it('an unregistered platform throws PROVIDER_NOT_CONFIGURED — no default provider exists', () => {
      const registry = getRegistry()
      expect(() => registry.get('linkedin')).toThrow(SocialProviderError)
      expect(() => registry.get('linkedin')).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }))
    })

    it('a partial credential (client id present, secret absent) does not register the provider', () => {
      serverConfig.LINKEDIN_CLIENT_ID = 'test-id'
      // secret deliberately left empty
      const registry = getRegistry()
      expect(() => registry.get('linkedin')).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }))
    })

    it('per-platform absence, DIRECTION 1: LinkedIn configured, X absent — LinkedIn works, get(twitter) throws', () => {
      serverConfig.LINKEDIN_CLIENT_ID = 'test-id'
      serverConfig.LINKEDIN_CLIENT_SECRET = 'test-secret'
      const registry = getRegistry()
      expect(() => registry.get('linkedin')).not.toThrow()
      expect(() => registry.get('twitter')).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }))
    })

    it('per-platform absence, DIRECTION 2: X configured, LinkedIn absent — X works, get(linkedin) throws', () => {
      serverConfig.X_CLIENT_ID = 'test-id'
      serverConfig.X_CLIENT_SECRET = 'test-secret'
      const registry = getRegistry()
      expect(() => registry.get('twitter')).not.toThrow()
      expect(() => registry.get('linkedin')).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }))
    })
  })

  // ADR 0028 §8.2/A-1 (N2.10) — SOCIAL-META-NOT-REGISTERED
  describe('SOCIAL-META-NOT-REGISTERED — the Meta family gets no provider, ever', () => {
    it.each(['instagram', 'facebook', 'threads'] as const)(
      'get(%s) throws PROVIDER_NOT_CONFIGURED even when both LinkedIn and X are fully configured',
      (platform) => {
        serverConfig.LINKEDIN_CLIENT_ID = 'test-id'
        serverConfig.LINKEDIN_CLIENT_SECRET = 'test-secret'
        serverConfig.X_CLIENT_ID = 'test-id'
        serverConfig.X_CLIENT_SECRET = 'test-secret'
        const registry = getRegistry()
        expect(() => registry.get(platform)).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }))
      },
    )
  })

  it('register() overrides the registry for a specific platform', () => {
    serverConfig.SOCIAL_PROVIDER_MODE = 'mock'
    const registry = getRegistry()

    const customProvider: SocialProvider = {
      platform: 'linkedin' as const,
      getOAuthAuthorizeUrl: async () => 'custom-url',
      exchangeOAuthCode: async () => ({
        accessToken: 'tok',
        refreshToken: null,
        tokenExpiresAt: null,
        scopesGranted: [],
      }),
      publish: async () => ({
        platformPostId: 'p-1',
        publishedAt: new Date().toISOString(),
        url: null,
      }),
      fetchPostMetrics: async () => null,
      fetchEngagement: async () => [],
      refreshAccessToken: async () => ({
        accessToken: 'tok2',
        refreshToken: null,
        tokenExpiresAt: null,
        scopesGranted: [],
      }),
      revokeAccessToken: async () => undefined,
    }

    registry.register('linkedin', customProvider)

    expect(registry.get('linkedin')).toBe(customProvider)
    // Other platforms still return the mock-mode default.
    expect(registry.get('twitter')).not.toBe(customProvider)
  })

  it('get() returns the same MockProvider instance for all unregistered platforms in mock mode', () => {
    serverConfig.SOCIAL_PROVIDER_MODE = 'mock'
    const registry = getRegistry()

    const twitter = registry.get('twitter')
    const instagram = registry.get('instagram')
    expect(twitter).toBe(instagram)
  })

  it('getRegistry() is memoized — subsequent calls return the same instance', () => {
    serverConfig.SOCIAL_PROVIDER_MODE = 'mock'
    const r1 = getRegistry()
    const r2 = getRegistry()
    expect(r1).toBe(r2)
  })
})
