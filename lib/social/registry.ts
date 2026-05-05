import { config } from '@/lib/config'
import type { Platform } from '@/lib/db/types'
import type { SocialProvider, ProviderRegistry } from './types'
import { SocialProviderError } from './errors'
import { MockProvider } from './mock-provider'
import { PostizProvider } from './postiz-provider'

class DefaultProviderRegistry implements ProviderRegistry {
  private readonly overrides = new Map<Platform, SocialProvider>()

  constructor(private readonly defaultProvider: SocialProvider) {}

  get(platform: Platform): SocialProvider {
    return this.overrides.get(platform) ?? this.defaultProvider
  }

  register(platform: Platform, provider: SocialProvider): void {
    this.overrides.set(platform, provider)
  }
}

let _registry: ProviderRegistry | undefined

export function getRegistry(): ProviderRegistry {
  if (_registry) return _registry

  const mode = config.server.SOCIAL_PROVIDER_MODE

  if (mode === 'mock') {
    _registry = new DefaultProviderRegistry(new MockProvider())
    return _registry
  }

  const baseUrl = config.server.POSTIZ_API_URL
  const apiKey = config.server.POSTIZ_API_KEY

  if (baseUrl && apiKey) {
    _registry = new DefaultProviderRegistry(new PostizProvider({ baseUrl, apiKey }))
    return _registry
  }

  // Dev fallback: MockProvider when Postiz config is absent
  if (process.env.NODE_ENV === 'production') {
    throw new SocialProviderError({
      code: 'PROVIDER_NOT_CONFIGURED',
      message:
        'Production requires POSTIZ_API_URL and POSTIZ_API_KEY (or SOCIAL_PROVIDER_MODE=mock for testing)',
    })
  }

  console.warn(
    '[SOSH] POSTIZ_API_URL or POSTIZ_API_KEY not configured — falling back to MockProvider. ' +
      'Set SOCIAL_PROVIDER_MODE=mock to silence this warning.',
  )
  _registry = new DefaultProviderRegistry(new MockProvider())
  return _registry
}

// Exposed for tests only — resets the memoized singleton between test cases.
export function _resetRegistry(): void {
  _registry = undefined
}
