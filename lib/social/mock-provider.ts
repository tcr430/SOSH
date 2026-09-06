import { formatISO, addSeconds } from 'date-fns'
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
} from './types'
import { SocialProviderError } from './errors'

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
}

export class MockProvider implements SocialProvider {
  readonly platform = 'multi' as const

  private failure: FailureConfig | undefined
  readonly calls: CallLog = {
    getOAuthAuthorizeUrl: [],
    exchangeOAuthCode: [],
    publish: [],
    fetchPostMetrics: [],
    fetchEngagement: [],
    refreshAccessToken: [],
    revokeAccessToken: [],
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
    return {
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      clicks: 0,
      reach: 0,
      impressions: 0,
      fetchedAt: formatISO(new Date()),
    }
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
}
