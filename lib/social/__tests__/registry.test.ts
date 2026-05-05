import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SocialProviderError } from '../errors'
import type { SocialProvider } from '../types'

// Top-level mock — controls what config returns for all tests.
// Individual tests mutate serverConfig to simulate different environments.
const serverConfig = {
  SOCIAL_PROVIDER_MODE: '',
  POSTIZ_API_URL: '',
  POSTIZ_API_KEY: '',
}

vi.mock('@/lib/config', () => ({
  config: { server: serverConfig },
}))

// Import after mocks are declared so the module sees the mock.
const { getRegistry, _resetRegistry } = await import('../registry')

describe('getRegistry', () => {
  beforeEach(() => {
    _resetRegistry()
    vi.unstubAllEnvs()
    serverConfig.SOCIAL_PROVIDER_MODE = ''
    serverConfig.POSTIZ_API_URL = ''
    serverConfig.POSTIZ_API_KEY = ''
  })

  it('returns a provider when SOCIAL_PROVIDER_MODE=mock', () => {
    serverConfig.SOCIAL_PROVIDER_MODE = 'mock'
    const registry = getRegistry()
    expect(registry.get('linkedin').platform).toBe('multi')
  })

  it('returns MockProvider as fallback when Postiz config is absent (non-production)', () => {
    const registry = getRegistry()
    expect(registry.get('twitter').platform).toBe('multi')
  })

  it('throws PROVIDER_NOT_CONFIGURED in production without Postiz config', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => getRegistry()).toThrow(SocialProviderError)
    expect(() => getRegistry()).toThrow(expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }))
  })

  it('returns PostizProvider when both POSTIZ_API_URL and POSTIZ_API_KEY are set', () => {
    serverConfig.POSTIZ_API_URL = 'https://postiz.test'
    serverConfig.POSTIZ_API_KEY = 'test-key'
    const registry = getRegistry()
    const provider = registry.get('linkedin')
    expect(provider.platform).toBe('multi')
  })

  it('register() overrides the default for a specific platform', () => {
    serverConfig.SOCIAL_PROVIDER_MODE = 'mock'
    const registry = getRegistry()

    const customProvider: SocialProvider = {
      platform: 'linkedin' as const,
      getOAuthAuthorizeUrl: () => 'custom-url',
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
    // Other platforms still return the default
    expect(registry.get('twitter')).not.toBe(customProvider)
  })

  it('get() returns the same default provider for all unregistered platforms', () => {
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
