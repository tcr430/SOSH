import { formatISO, addSeconds, subDays } from 'date-fns'
import type { Platform } from '@/lib/db/types'
import type {
  SocialProvider,
  OAuthAuthorizeInput,
  ExchangeCodeInput,
  TokenSet,
  PublishInput,
  PublishResult,
  FetchMetricsInput,
  PostMetrics,
  FetchEngagementInput,
  EngagementItem,
  RefreshAccessTokenInput,
  RevokeAccessTokenInput,
  SocialProviderErrorCode,
  FetchRecentPostsInput,
  RecentPostsPage,
  RecentPost,
} from './types'
import { SocialProviderError } from './errors'
import { assertRecentPostsPageSize, RECENT_POST_CONTENT_MAX_CHARS } from './constants'

// ADR 0025 §2.9 — deterministic, seeded fixture accounts keyed by
// socialAccountId. Exported so tests (and, later, the backfill orchestrator's
// own tests) can address a specific fixture by name rather than a magic
// string.
export const MOCK_FIXTURE_ACCOUNT_IDS = {
  EMPTY: 'mock-fixture-empty',
  STANDARD: 'mock-fixture-standard',
  ZERO_POST_PAGE: 'mock-fixture-zero-post-page',
  NON_TERMINATING: 'mock-fixture-non-terminating',
  MIXED_TYPES: 'mock-fixture-mixed-types',
  FAIL_ON_PAGE_N: 'mock-fixture-fail-on-page-n',
  METRICS_SEPARATE: 'mock-fixture-metrics-separate',
  OVER_LONG: 'mock-fixture-over-long',
  TWO_ACCOUNTS_FOUNDER: 'mock-fixture-two-accounts-founder',
  TWO_ACCOUNTS_COMPANY: 'mock-fixture-two-accounts-company',
} as const

// ADR 0026 J2.1 step 4 — deterministic fetchPostMetrics fixtures, addressed
// by platformPostId the way the account fixtures above are addressed by
// socialAccountId. Between them they cover what J2.7's normalisation needs: a
// permanently-null field (reach, clicks; LinkedIn's four), an ELIGIBLE field
// returned null, and an X impressions = 0 post. Any other id — including
// mock_post_* from publish() — gets the X full shape. Null is never 0.
export const MOCK_METRICS_FIXTURE_POST_IDS = {
  X_FULL: 'mock-metrics-x-full',
  X_ELIGIBLE_FIELD_NULL: 'mock-metrics-x-eligible-field-null',
  X_ZERO_IMPRESSIONS: 'mock-metrics-x-zero-impressions',
  X_NO_IMPRESSIONS: 'mock-metrics-x-no-impressions',
  LINKEDIN_COUNTS: 'mock-metrics-linkedin-counts',
  NONE: 'mock-metrics-none',
} as const

type MockMetricsBody = Omit<PostMetrics, 'fetchedAt'>

const MOCK_X_FULL_METRICS: MockMetricsBody = {
  likes: 12,
  comments: 3,
  shares: 4,
  saves: 2,
  clicks: null,
  reach: null,
  impressions: 1500,
}

const MOCK_METRICS_BY_POST_ID: Record<string, MockMetricsBody | null> = {
  [MOCK_METRICS_FIXTURE_POST_IDS.X_FULL]: MOCK_X_FULL_METRICS,
  [MOCK_METRICS_FIXTURE_POST_IDS.X_ELIGIBLE_FIELD_NULL]: { ...MOCK_X_FULL_METRICS, comments: null },
  [MOCK_METRICS_FIXTURE_POST_IDS.X_ZERO_IMPRESSIONS]: { ...MOCK_X_FULL_METRICS, impressions: 0 },
  [MOCK_METRICS_FIXTURE_POST_IDS.X_NO_IMPRESSIONS]: { ...MOCK_X_FULL_METRICS, impressions: null },
  [MOCK_METRICS_FIXTURE_POST_IDS.LINKEDIN_COUNTS]: {
    likes: 20,
    comments: 5,
    shares: 2,
    saves: null,
    clicks: null,
    reach: null,
    impressions: null,
  },
  [MOCK_METRICS_FIXTURE_POST_IDS.NONE]: null,
}

// A FIXED reference instant, never real Date.now() — determinism (ADR
// §2.9: "the same seed gives byte-identical pages twice") requires every
// fixture's publishedAt to be computed from a constant, not wall-clock time.
const FIXTURE_REFERENCE_NOW = new Date('2026-09-01T00:00:00.000Z')
const FIXTURE_FORMATS = ['text', 'image', 'video', 'link', 'multi', 'other'] as const
const STANDARD_FIXTURE_POST_COUNT = 230
const STANDARD_FIXTURE_SPAN_DAYS = 913 // ~30 months
const FAIL_ON_PAGE_N_TARGET_PAGE = 3
const CROSS_ACCOUNT_CURSOR_SEPARATOR = '::'

function buildFixtureContent(raw: string): string {
  return raw.length > RECENT_POST_CONTENT_MAX_CHARS ? raw.slice(0, RECENT_POST_CONTENT_MAX_CHARS) : raw
}

function buildFixtureMetrics(index: number): PostMetrics {
  return {
    likes: index * 3,
    comments: index,
    shares: Math.floor(index / 2),
    saves: Math.floor(index / 4),
    clicks: null,
    reach: null,
    impressions: index * 20,
    fetchedAt: formatISO(FIXTURE_REFERENCE_NOW),
  }
}

// Encodes a cursor bound to its fixture id — the mock's own opaque-cursor
// scheme, independent of whatever real providers do at I2.3. A cursor
// presented for a DIFFERENT socialAccountId than the one it was minted for
// is rejected (ADR §2.9's cross-account cursor case).
function encodeCursor(fixtureId: string, page: number): string {
  return `${fixtureId}${CROSS_ACCOUNT_CURSOR_SEPARATOR}${page}`
}

function decodeCursor(cursor: string): { fixtureId: string; page: number } | null {
  const idx = cursor.lastIndexOf(CROSS_ACCOUNT_CURSOR_SEPARATOR)
  if (idx === -1) return null
  const fixtureId = cursor.slice(0, idx)
  const pageStr = cursor.slice(idx + CROSS_ACCOUNT_CURSOR_SEPARATOR.length)
  const page = Number(pageStr)
  if (!Number.isInteger(page) || page < 1) return null
  return { fixtureId, page }
}

export interface FailureConfig {
  platform?: Platform
  errorCode: SocialProviderErrorCode
  retryAfterSeconds?: number
}

interface CallLog {
  getOAuthAuthorizeUrl: OAuthAuthorizeInput[]
  exchangeOAuthCode: ExchangeCodeInput[]
  publish: PublishInput[]
  fetchPostMetrics: FetchMetricsInput[]
  fetchEngagement: FetchEngagementInput[]
  refreshAccessToken: RefreshAccessTokenInput[]
  revokeAccessToken: RevokeAccessTokenInput[]
  fetchRecentPosts: FetchRecentPostsInput[]
}

export class MockProvider implements SocialProvider {
  readonly platform = 'multi' as const
  // ADR 0025 §2.9 — MockProvider always serves a historical read (it is the
  // system-under-test's honest double, not a platform with real limits).
  readonly historicalReadAvailable = true

  private failure: FailureConfig | undefined
  readonly calls: CallLog = {
    getOAuthAuthorizeUrl: [],
    exchangeOAuthCode: [],
    publish: [],
    fetchPostMetrics: [],
    fetchEngagement: [],
    refreshAccessToken: [],
    revokeAccessToken: [],
    fetchRecentPosts: [],
  }

  constructor(failure?: FailureConfig) {
    this.failure = failure
  }

  reset(): void {
    this.failure = undefined
    for (const key of Object.keys(this.calls) as (keyof CallLog)[]) {
      this.calls[key] = []
    }
  }

  private maybeThrow(platform?: Platform): void {
    if (!this.failure) return
    if (this.failure.platform && this.failure.platform !== platform) return
    throw new SocialProviderError({
      code: this.failure.errorCode,
      message: `MockProvider: simulated ${this.failure.errorCode}`,
      platform: this.failure.platform ?? null,
      retryAfterSeconds: this.failure.retryAfterSeconds ?? null,
    })
  }

  private uuid(): string {
    return crypto.randomUUID()
  }

  async getOAuthAuthorizeUrl(input: OAuthAuthorizeInput): Promise<string> {
    this.calls.getOAuthAuthorizeUrl.push(input)
    this.maybeThrow(input.platform)
    return `https://mock.local/authorize?state=${input.state}&platform=${input.platform}`
  }

  async exchangeOAuthCode(input: ExchangeCodeInput): Promise<TokenSet> {
    this.calls.exchangeOAuthCode.push(input)
    this.maybeThrow(input.platform)
    const id = this.uuid()
    return {
      accessToken: `mock_access_${id}`,
      refreshToken: `mock_refresh_${id}`,
      tokenExpiresAt: formatISO(addSeconds(new Date(), 3600)),
      scopesGranted: [],
      platformUserId: `mock_user_${id}`,
      platformUsername: 'mock_user',
      platformDisplayName: 'Mock User',
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    this.calls.publish.push(input)
    this.maybeThrow()
    const id = this.uuid()
    return {
      platformPostId: `mock_post_${id}`,
      publishedAt: formatISO(new Date()),
      url: `https://mock.local/p/${id}`,
    }
  }

  async fetchPostMetrics(input: FetchMetricsInput): Promise<PostMetrics | null> {
    this.calls.fetchPostMetrics.push(input)
    this.maybeThrow()
    const fixture =
      input.platformPostId in MOCK_METRICS_BY_POST_ID
        ? MOCK_METRICS_BY_POST_ID[input.platformPostId]
        : MOCK_X_FULL_METRICS
    if (fixture === null) return null
    return { ...fixture, fetchedAt: formatISO(new Date()) }
  }

  async fetchEngagement(input: FetchEngagementInput): Promise<EngagementItem[]> {
    this.calls.fetchEngagement.push(input)
    this.maybeThrow()
    return []
  }

  async refreshAccessToken(input: RefreshAccessTokenInput): Promise<TokenSet> {
    this.calls.refreshAccessToken.push(input)
    this.maybeThrow()
    const id = this.uuid()
    return {
      accessToken: `mock_access_${id}`,
      refreshToken: `mock_refresh_${id}`,
      tokenExpiresAt: formatISO(addSeconds(new Date(), 3600)),
      scopesGranted: [],
    }
  }

  async revokeAccessToken(input: RevokeAccessTokenInput): Promise<void> {
    this.calls.revokeAccessToken.push(input)
    this.maybeThrow()
  }

  // ADR 0025 §2.9. Order matches every other method: bound check first
  // (RangeError before any "I/O" — the mock has none, but the contract
  // suite asserts this ordering on every implementation alike), then the
  // generic induced-failure hook, then the fixture itself.
  async fetchRecentPosts(input: FetchRecentPostsInput): Promise<RecentPostsPage> {
    assertRecentPostsPageSize(input.pageSize)
    this.calls.fetchRecentPosts.push(input)
    this.maybeThrow(input.platform)

    const fixtureId = input.socialAccountId
    const page = input.cursor === null ? 1 : this.resolveCursorPage(input.cursor, fixtureId)

    switch (fixtureId) {
      case MOCK_FIXTURE_ACCOUNT_IDS.EMPTY:
        return { posts: [], nextCursor: null }

      case MOCK_FIXTURE_ACCOUNT_IDS.ZERO_POST_PAGE:
        if (page === 1) return { posts: [], nextCursor: encodeCursor(fixtureId, 2) }
        // The real 5-post dataset starts fresh at local page 1 regardless of
        // the outer (cursor-encoded) page number, which is 2 here.
        return { posts: this.buildPage(fixtureId, 1, input.pageSize, 5), nextCursor: null }

      case MOCK_FIXTURE_ACCOUNT_IDS.NON_TERMINATING:
        return { posts: this.buildPage(fixtureId, page, input.pageSize, input.pageSize), nextCursor: encodeCursor(fixtureId, page + 1) }

      case MOCK_FIXTURE_ACCOUNT_IDS.MIXED_TYPES:
        return this.buildMixedTypesPage(fixtureId, page, input.pageSize)

      case MOCK_FIXTURE_ACCOUNT_IDS.FAIL_ON_PAGE_N:
        if (page === FAIL_ON_PAGE_N_TARGET_PAGE) {
          throw new SocialProviderError({
            code: 'NETWORK',
            message: 'MockProvider: simulated failure on fetchRecentPosts page 3 (fail-on-page-N fixture)',
            platform: input.platform,
          })
        }
        return { posts: this.buildPage(fixtureId, page, input.pageSize, input.pageSize), nextCursor: encodeCursor(fixtureId, page + 1) }

      case MOCK_FIXTURE_ACCOUNT_IDS.METRICS_SEPARATE:
        return { posts: this.buildPage(fixtureId, page, input.pageSize, 10, { metricsNull: true }), nextCursor: page * input.pageSize < 10 ? encodeCursor(fixtureId, page + 1) : null }

      case MOCK_FIXTURE_ACCOUNT_IDS.OVER_LONG:
        return { posts: this.buildPage(fixtureId, page, input.pageSize, 5, { overLong: true }), nextCursor: null }

      case MOCK_FIXTURE_ACCOUNT_IDS.TWO_ACCOUNTS_FOUNDER:
      case MOCK_FIXTURE_ACCOUNT_IDS.TWO_ACCOUNTS_COMPANY:
        return { posts: this.buildPage(fixtureId, page, input.pageSize, 10), nextCursor: null }

      case MOCK_FIXTURE_ACCOUNT_IDS.STANDARD:
      default:
        // Any unrecognized socialAccountId (e.g. a generic 'sa-1' used by
        // tests unrelated to a specific fixture) falls back to the standard
        // fixture's shape — flag-consistency requires fetchRecentPosts to
        // never throw NOT_IMPLEMENTED for an arbitrary account on a
        // historicalReadAvailable=true provider.
        return this.buildStandardPage(fixtureId, page, input.pageSize)
    }
  }

  private resolveCursorPage(cursor: string, expectedFixtureId: string): number {
    const decoded = decodeCursor(cursor)
    if (decoded === null || decoded.fixtureId !== expectedFixtureId) {
      throw new SocialProviderError({
        code: 'PLATFORM_REJECTED',
        message: 'MockProvider: cursor is unparseable or was minted for a different account',
        details: { reason: 'cursor_invalid' },
      })
    }
    return decoded.page
  }

  private buildStandardPage(fixtureId: string, page: number, pageSize: number): RecentPostsPage {
    const start = (page - 1) * pageSize
    if (start >= STANDARD_FIXTURE_POST_COUNT) return { posts: [], nextCursor: null }
    const end = Math.min(start + pageSize, STANDARD_FIXTURE_POST_COUNT)
    const posts = this.buildPage(fixtureId, page, pageSize, STANDARD_FIXTURE_POST_COUNT)
    const nextCursor = end < STANDARD_FIXTURE_POST_COUNT ? encodeCursor(fixtureId, page + 1) : null
    return { posts, nextCursor }
  }

  // Shared original-post generator: index i (0-based, newest first) is
  // spread across STANDARD_FIXTURE_SPAN_DAYS from FIXTURE_REFERENCE_NOW, so
  // "standard" spans ~30 months and every other fixture reuses the same
  // deterministic date math for consistency.
  private buildPage(
    fixtureId: string,
    page: number,
    pageSize: number,
    totalCount: number,
    opts: { metricsNull?: boolean; overLong?: boolean } = {},
  ): RecentPost[] {
    const start = (page - 1) * pageSize
    if (start >= totalCount) return []
    const end = Math.min(start + pageSize, totalCount)
    const posts: RecentPost[] = []
    for (let i = start; i < end; i++) {
      const dayOffset = totalCount > 1 ? Math.round((i * STANDARD_FIXTURE_SPAN_DAYS) / (totalCount - 1)) : 0
      const rawContent = opts.overLong
        ? `Over-long fixture post ${i} for ${fixtureId}. `.repeat(200)
        : `Fixture post ${i} for ${fixtureId} — original, authored content.`
      posts.push({
        platformPostId: `${fixtureId}-post-${i}`,
        publishedAt: formatISO(subDays(FIXTURE_REFERENCE_NOW, dayOffset)),
        content: buildFixtureContent(rawContent),
        url: `https://mock.local/p/${fixtureId}-post-${i}`,
        format: FIXTURE_FORMATS[i % FIXTURE_FORMATS.length],
        metrics: opts.metricsNull ? null : buildFixtureMetrics(i),
      })
    }
    return posts
  }

  // ADR §2.4 — the mock applies the same "original authored post" filter a
  // real provider must: replies, reposts and quotes are generated into the
  // underlying dataset, then filtered out before any page is returned, so
  // the returned array NEVER contains one.
  private buildMixedTypesPage(fixtureId: string, page: number, pageSize: number): RecentPostsPage {
    const RAW_TOTAL = 20 // interleaved originals + excluded types
    const start = (page - 1) * pageSize
    if (start >= RAW_TOTAL) return { posts: [], nextCursor: null }
    const end = Math.min(start + pageSize, RAW_TOTAL)
    const posts: RecentPost[] = []
    for (let i = start; i < end; i++) {
      const kind = i % 4 // 0 = original, 1 = reply, 2 = repost, 3 = quote — excluded types never enter `posts`
      if (kind !== 0) continue
      const dayOffset = Math.round((i * STANDARD_FIXTURE_SPAN_DAYS) / (RAW_TOTAL - 1))
      posts.push({
        platformPostId: `${fixtureId}-post-${i}`,
        publishedAt: formatISO(subDays(FIXTURE_REFERENCE_NOW, dayOffset)),
        content: buildFixtureContent(`Fixture original post ${i} for ${fixtureId}, interleaved with excluded types.`),
        url: `https://mock.local/p/${fixtureId}-post-${i}`,
        format: FIXTURE_FORMATS[i % FIXTURE_FORMATS.length],
        metrics: buildFixtureMetrics(i),
      })
    }
    const nextCursor = end < RAW_TOTAL ? encodeCursor(fixtureId, page + 1) : null
    return { posts, nextCursor }
  }
}
