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
export { getRegistry } from './registry'

export {
  TOKEN_REFRESH_SKEW_SECONDS,
  LINKEDIN_REQUIRED_SCOPES,
  TWITTER_REQUIRED_SCOPES,
  INSTAGRAM_REQUIRED_SCOPES,
  FACEBOOK_REQUIRED_SCOPES,
  THREADS_REQUIRED_SCOPES,
} from './constants'
