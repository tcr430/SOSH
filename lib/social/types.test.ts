import { describe, it, expectTypeOf } from 'vitest'
import type {
  SocialProvider,
  ProviderRegistry,
  Platform,
  PublishResult,
  PostMetrics,
  EngagementItem,
  TokenSet,
  SocialProviderErrorCode,
} from './types'

describe('SocialProvider type shapes', () => {
  it('Platform includes all 5 launch platforms', () => {
    expectTypeOf<'linkedin'>().toMatchTypeOf<Platform>()
    expectTypeOf<'twitter'>().toMatchTypeOf<Platform>()
    expectTypeOf<'instagram'>().toMatchTypeOf<Platform>()
    expectTypeOf<'facebook'>().toMatchTypeOf<Platform>()
    expectTypeOf<'threads'>().toMatchTypeOf<Platform>()
  })

  it('Platform excludes reddit', () => {
    expectTypeOf<'reddit'>().not.toMatchTypeOf<Platform>()
  })

  it('SocialProvider has all 7 required methods plus platform field', () => {
    expectTypeOf<SocialProvider>().toHaveProperty('platform')
    expectTypeOf<SocialProvider>().toHaveProperty('getOAuthAuthorizeUrl')
    expectTypeOf<SocialProvider>().toHaveProperty('exchangeOAuthCode')
    expectTypeOf<SocialProvider>().toHaveProperty('publish')
    expectTypeOf<SocialProvider>().toHaveProperty('fetchPostMetrics')
    expectTypeOf<SocialProvider>().toHaveProperty('fetchEngagement')
    expectTypeOf<SocialProvider>().toHaveProperty('refreshAccessToken')
    expectTypeOf<SocialProvider>().toHaveProperty('revokeAccessToken')
  })

  it('PostMetrics all metric fields are nullable — null means not exposed, not zero', () => {
    expectTypeOf<PostMetrics['likes']>().toEqualTypeOf<number | null>()
    expectTypeOf<PostMetrics['comments']>().toEqualTypeOf<number | null>()
    expectTypeOf<PostMetrics['shares']>().toEqualTypeOf<number | null>()
    expectTypeOf<PostMetrics['saves']>().toEqualTypeOf<number | null>()
    expectTypeOf<PostMetrics['clicks']>().toEqualTypeOf<number | null>()
    expectTypeOf<PostMetrics['reach']>().toEqualTypeOf<number | null>()
    expectTypeOf<PostMetrics['impressions']>().toEqualTypeOf<number | null>()
    expectTypeOf<PostMetrics['fetchedAt']>().toEqualTypeOf<string>()
  })

  it('TokenSet refresh fields are nullable', () => {
    expectTypeOf<TokenSet['refreshToken']>().toEqualTypeOf<string | null>()
    expectTypeOf<TokenSet['tokenExpiresAt']>().toEqualTypeOf<string | null>()
  })

  it('PublishResult.url is nullable', () => {
    expectTypeOf<PublishResult['url']>().toEqualTypeOf<string | null>()
  })

  it('EngagementItem.type is a closed string literal union', () => {
    expectTypeOf<EngagementItem['type']>().toEqualTypeOf<'comment' | 'dm' | 'mention'>()
  })

  it('SocialProviderErrorCode covers all 8 codes from ADR', () => {
    expectTypeOf<'TOKEN_EXPIRED'>().toMatchTypeOf<SocialProviderErrorCode>()
    expectTypeOf<'TOKEN_REVOKED'>().toMatchTypeOf<SocialProviderErrorCode>()
    expectTypeOf<'RATE_LIMITED'>().toMatchTypeOf<SocialProviderErrorCode>()
    expectTypeOf<'PLATFORM_REJECTED'>().toMatchTypeOf<SocialProviderErrorCode>()
    expectTypeOf<'NETWORK'>().toMatchTypeOf<SocialProviderErrorCode>()
    expectTypeOf<'NOT_IMPLEMENTED'>().toMatchTypeOf<SocialProviderErrorCode>()
    expectTypeOf<'PROVIDER_NOT_CONFIGURED'>().toMatchTypeOf<SocialProviderErrorCode>()
    expectTypeOf<'UNKNOWN'>().toMatchTypeOf<SocialProviderErrorCode>()
  })

  it('ProviderRegistry has get and register', () => {
    expectTypeOf<ProviderRegistry>().toHaveProperty('get')
    expectTypeOf<ProviderRegistry>().toHaveProperty('register')
  })
})
