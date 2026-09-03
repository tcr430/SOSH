export type { Platform } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type SocialProviderErrorCode =
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'RATE_LIMITED'
  | 'PLATFORM_REJECTED'
  | 'NETWORK'
  | 'NOT_IMPLEMENTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNKNOWN'

// ---------------------------------------------------------------------------
// OAuth and token shapes
// ---------------------------------------------------------------------------

export interface OAuthAuthorizeInput {
  // Builder addition (not in ADR §2): PostizProvider needs the platform to
  // construct its per-platform authorize URL.
  platform: import('@/lib/db/types').Platform
  businessId: string
  redirectUri: string
  scopes: readonly string[]
  // Builder addition (not in ADR §2): the signed-JWT OAuth state is built by
  // the calling Server Action (via signOAuthState) and passed in here so the
  // provider can embed it as the ?state= query parameter.
  state: string
}

export interface ExchangeCodeInput {
  platform: import('@/lib/db/types').Platform
  code: string
  redirectUri: string
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  tokenExpiresAt: string | null
  scopesGranted: readonly string[]
  platformUserId?: string
  platformUsername?: string
  platformDisplayName?: string | null
}

export interface RefreshAccessTokenInput {
  socialAccountId: string
}

export interface RevokeAccessTokenInput {
  socialAccountId: string
}

// ---------------------------------------------------------------------------
// Publish shapes
// ---------------------------------------------------------------------------

export interface PublishInput {
  socialAccountId: string
  content: string
  hashtags: readonly string[]
  mediaUrls: readonly string[]
}

export interface PublishResult {
  platformPostId: string
  publishedAt: string
  url: string | null
}

// ---------------------------------------------------------------------------
// Metrics shapes
// ---------------------------------------------------------------------------

export interface FetchMetricsInput {
  socialAccountId: string
  platformPostId: string
}

export interface PostMetrics {
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  clicks: number | null
  reach: number | null
  impressions: number | null
  fetchedAt: string
}

// ---------------------------------------------------------------------------
// Engagement shapes
// ---------------------------------------------------------------------------

export interface FetchEngagementInput {
  socialAccountId: string
  sinceCursor: string | null
}

export interface EngagementItem {
  platformItemId: string
  type: 'comment' | 'dm' | 'mention'
  authorUsername: string
  authorDisplayName: string | null
  content: string
  receivedAt: string
  postId: string | null
}

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface SocialProvider {
  readonly platform: import('@/lib/db/types').Platform | 'multi'

  getOAuthAuthorizeUrl(input: OAuthAuthorizeInput): Promise<string>

  exchangeOAuthCode(input: ExchangeCodeInput): Promise<TokenSet>

  publish(input: PublishInput): Promise<PublishResult>

  fetchPostMetrics(input: FetchMetricsInput): Promise<PostMetrics | null>

  fetchEngagement(input: FetchEngagementInput): Promise<EngagementItem[]>

  refreshAccessToken(input: RefreshAccessTokenInput): Promise<TokenSet>

  revokeAccessToken(input: RevokeAccessTokenInput): Promise<void>
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export interface ProviderRegistry {
  get(platform: import('@/lib/db/types').Platform): SocialProvider
  register(platform: import('@/lib/db/types').Platform, provider: SocialProvider): void
}
