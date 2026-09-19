import { config } from '@/lib/config'
import type { Platform } from '@/lib/db/types'
import type { SocialProvider, ProviderRegistry } from './types'
import { SocialProviderError } from './errors'
import { MockProvider } from './mock-provider'
import { LinkedInProvider } from './linkedin-provider'
import { TwitterProvider } from './twitter-provider'
import { VALID_PLATFORMS } from './platforms/guards'

// ADR 0028 §8.2 (N2.10). No default in production: LinkedIn and X are
// registered through this overrides map — the same map that has existed
// and gone unused since day one. get() throws PROVIDER_NOT_CONFIGURED for
// anything unregistered. This is not a widening: ADR 0002 §4 already
// specified exactly this behaviour ("Throws PROVIDER_NOT_CONFIGURED if no
// provider is registered and no default is set") — the code now does it.
class DefaultProviderRegistry implements ProviderRegistry {
  private readonly overrides = new Map<Platform, SocialProvider>()

  get(platform: Platform): SocialProvider {
    const provider = this.overrides.get(platform)
    if (!provider) {
      throw new SocialProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `No provider registered for platform: ${platform}`,
        platform,
      })
    }
    return provider
  }

  register(platform: Platform, provider: SocialProvider): void {
    this.overrides.set(platform, provider)
  }
}

let _registry: ProviderRegistry | undefined

export function getRegistry(): ProviderRegistry {
  if (_registry) return _registry

  const registry = new DefaultProviderRegistry()
  const mode = config.server.SOCIAL_PROVIDER_MODE

  if (mode === 'mock') {
    // SOCIAL_PROVIDER_MODE=mock is unchanged: MockProvider is registered
    // for ALL FIVE platforms, which is how the entire app-test suite
    // avoids the network (L-9).
    const mock = new MockProvider()
    for (const platform of VALID_PLATFORMS) {
      registry.register(platform, mock)
    }
    _registry = registry
    return _registry
  }

  // Absence behaviour is PER-PLATFORM, not app-wide. If LINKEDIN_CLIENT_ID
  // is set and X_CLIENT_ID is not, LinkedIn works and get('twitter')
  // throws — one missing secret must not dark the whole product (ADR 0028
  // §14.1: "the Builder proceeds without credentials" is true because of
  // this, not aspirational).
  if (config.server.LINKEDIN_CLIENT_ID && config.server.LINKEDIN_CLIENT_SECRET) {
    registry.register('linkedin', new LinkedInProvider())
  }
  if (config.server.X_CLIENT_ID && config.server.X_CLIENT_SECRET) {
    registry.register('twitter', new TwitterProvider())
  }
  // Meta family (A-1): instagram, facebook, threads get NO provider
  // registered. They keep their Platform enum members and
  // publishingAvailable: false; connect is gated on that flag; the
  // accounts UI renders coming_soon. No provider to construct here.

  _registry = registry
  return _registry
}

// Exposed for tests only — resets the memoized singleton between test cases.
export function _resetRegistry(): void {
  _registry = undefined
}
