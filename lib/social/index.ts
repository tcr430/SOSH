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
  FetchRecentPostsInput,
  RecentPostsPage,
  RecentPost,
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
export { getConnectionStatus, pickDefaultAccountId } from './connection-status'
export { buildDisconnectUrl } from './disconnect-url'
export type { SocialAccountPublic } from '@/lib/db/social-accounts'

export {
  TOKEN_REFRESH_SKEW_SECONDS,
  LINKEDIN_REQUIRED_SCOPES,
  TWITTER_REQUIRED_SCOPES,
  INSTAGRAM_REQUIRED_SCOPES,
  FACEBOOK_REQUIRED_SCOPES,
  THREADS_REQUIRED_SCOPES,
  RECENT_POSTS_PAGE_SIZE_MIN,
  RECENT_POSTS_PAGE_SIZE_MAX,
  RECENT_POST_CONTENT_MAX_CHARS,
  SOCIAL_READ_TIMEOUT_MS,
  SOCIAL_READ_RETRY_AFTER_CEILING_SECONDS,
  assertRecentPostsPageSize,
} from './constants'
