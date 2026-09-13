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
  // Lets the SHARED, platform-agnostic connect route pass through which
  // platform it is building for, without the route itself knowing
  // anything about that platform's authorize-URL shape — the provider
  // reads this to construct its own URL (ADR 0028 §5.5).
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
// Read shapes (ADR 0002 Amendment B / ADR 0025 §2.2) — the historical-read
// contract added at Session 32 I2.2. Platform-neutral vocabulary (§3): no
// account type, author identity, referenced post, mention target, media URL
// or engagement actor appears on any of these types — that omission is
// structural (there is no field to put them in), not an oversight.
// ---------------------------------------------------------------------------

export interface FetchRecentPostsInput {
  platform: import('@/lib/db/types').Platform
  // The contract is account-shaped (L-11) — there is no business- or
  // organisation-level read.
  socialAccountId: string
  // Must satisfy RECENT_POSTS_PAGE_SIZE_MIN <= pageSize <=
  // RECENT_POSTS_PAGE_SIZE_MAX (constants.ts). Out-of-range is refused with
  // a RangeError before any I/O — never clamped.
  pageSize: number
  // null for the first page; otherwise exactly a nextCursor this method
  // previously returned for the SAME socialAccountId. One cursor per run is
  // an orchestrator discipline (cursors live in memory for one tick and are
  // never persisted) — the provider only enforces the account binding.
  cursor: string | null
  // An ISO timestamp HINT, not a guarantee — a provider may use it to stop
  // early. The orchestrator enforces the lookback on publishedAt itself.
  notBefore: string | null
}

export interface RecentPostsPage {
  // Possibly empty even when nextCursor is non-null — a page whose items
  // were all filtered out (e.g. all replies/reposts/quotes) is legitimate.
  posts: readonly RecentPost[]
  // null means the platform has no further page.
  nextCursor: string | null
}

export interface RecentPost {
  platformPostId: string
  // ISO, validated finite by the provider before return.
  publishedAt: string
  // Plain text: markup stripped, entities decoded, whitespace collapsed,
  // links and mentions kept as their visible text; truncated at
  // RECENT_POST_CONTENT_MAX_CHARS.
  content: string
  // The post's public permalink.
  url: string | null
  // Derived from attachment TYPES only.
  format: 'text' | 'image' | 'video' | 'link' | 'multi' | 'other'
  // null means "not included in this read — fetch separately" (A-3), never
  // "the platform does not expose it".
  metrics: PostMetrics | null
}

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface SocialProvider {
  // 'multi' is NOT a broker-specific concept, despite ADR 0028 §8.3's
  // premise that a single now-deleted provider file was its only producer
  // — it wasn't. MockProvider legitimately shares ONE instance across all
  // five platforms in SOCIAL_PROVIDER_MODE=mock (registry.ts), unrelated
  // to any broker. 'multi' stays as the honest description of a provider
  // instance that serves more than one platform; LinkedInProvider and
  // TwitterProvider are both always bound to exactly one real platform
  // (asserted in the contract suite), and MockProvider is the sole
  // remaining, deliberate exception.
  readonly platform: import('@/lib/db/types').Platform | 'multi'

  // ADR 0025 §2.1 — a static, per-implementation fact, not a per-call
  // capability probe. Flag-consistency is part of the contract: false =>
  // fetchRecentPosts throws NOT_IMPLEMENTED with zero fetch calls; true =>
  // it never throws NOT_IMPLEMENTED (an account missing a scope still
  // surfaces as a thrown error, never as this flag going false).
  readonly historicalReadAvailable: boolean

  getOAuthAuthorizeUrl(input: OAuthAuthorizeInput): Promise<string>

  exchangeOAuthCode(input: ExchangeCodeInput): Promise<TokenSet>

  publish(input: PublishInput): Promise<PublishResult>

  fetchPostMetrics(input: FetchMetricsInput): Promise<PostMetrics | null>

  fetchEngagement(input: FetchEngagementInput): Promise<EngagementItem[]>

  refreshAccessToken(input: RefreshAccessTokenInput): Promise<TokenSet>

  revokeAccessToken(input: RevokeAccessTokenInput): Promise<void>

  fetchRecentPosts(input: FetchRecentPostsInput): Promise<RecentPostsPage>
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export interface ProviderRegistry {
  get(platform: import('@/lib/db/types').Platform): SocialProvider
  register(platform: import('@/lib/db/types').Platform, provider: SocialProvider): void
}
