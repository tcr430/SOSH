export type {
  SocialProvider,
  ProviderRegistry,
  Platform,
  OAuthAuthorizeInput,
  ExchangeCodeInput,
  TokenSet,
  RefreshAccessTokenInput,
  RevokeAccessTokenInput,
  PublishInput,
  PublishResult,
  FetchMetricsInput,
  PostMetrics,
  FetchEngagementInput,
  EngagementItem,
  SocialProviderErrorCode,
} from './types'

export { SocialProviderError } from './errors'
export { signOAuthState, verifyOAuthState } from './oauth/state'
export type { OAuthStateClaims } from './oauth/state'
export { getSocialRedirectUri } from './oauth/redirect-uri'
export { getRegistry } from './registry'
export type { PlatformOAuthConfig } from './platforms/config'
export {
  PLATFORM_CONFIGS,
  getPlatformConfig,
  publishingAvailableFor,
  isPublishingPlatform,
} from './platforms/config'
export { VALID_PLATFORMS, isPlatform } from './platforms/guards'
export type { ConnectionStatus } from './connection-status'
export { getConnectionStatus } from './connection-status'
export type { SocialAccountPublic } from '@/lib/db/social-accounts'

export {
  TOKEN_REFRESH_SKEW_SECONDS,
  LINKEDIN_REQUIRED_SCOPES,
  TWITTER_REQUIRED_SCOPES,
  INSTAGRAM_REQUIRED_SCOPES,
  FACEBOOK_REQUIRED_SCOPES,
  THREADS_REQUIRED_SCOPES,
} from './constants'
