import { describe, it, expect, beforeEach } from 'vitest'
import { differenceInDays } from 'date-fns'
import { MockProvider, MOCK_FIXTURE_ACCOUNT_IDS } from '../mock-provider'
import { SocialProviderError } from '../errors'
import { RECENT_POST_CONTENT_MAX_CHARS } from '../constants'
import type { RecentPost } from '../types'

describe('MockProvider', () => {
  let mock: MockProvider

  beforeEach(() => {
    mock = new MockProvider()
  })

  describe('getOAuthAuthorizeUrl', () => {
    it('resolves to a mock authorize URL containing state and platform', async () => {
      const url = await mock.getOAuthAuthorizeUrl({
        platform: 'linkedin',
        businessId: 'biz-1',
        redirectUri: 'https://app.local/callback',
        scopes: ['openid'],
        state: 'signed-jwt-state',
      })
      expect(url).toContain('mock.local')
      expect(url).toContain('state=signed-jwt-state')
      expect(url).toContain('platform=linkedin')
    })

    it('records the call in calls.getOAuthAuthorizeUrl', async () => {
      await mock.getOAuthAuthorizeUrl({
        platform: 'twitter',
        businessId: 'biz-1',
        redirectUri: 'https://app.local/callback',
        scopes: [],
        state: 'jwt',
      })
      expect(mock.calls.getOAuthAuthorizeUrl).toHaveLength(1)
    })
  })

  describe('exchangeOAuthCode', () => {
    it('returns a full TokenSet with identity fields', async () => {
      const result = await mock.exchangeOAuthCode({
        platform: 'linkedin',
        code: 'code123',
        redirectUri: 'https://app.local/callback',
      })
      expect(result.accessToken).toMatch(/^mock_access_/)
      expect(result.refreshToken).toMatch(/^mock_refresh_/)
      expect(result.platformUserId).toMatch(/^mock_user_/)
      expect(result.platformUsername).toBe('mock_user')
    })
  })

  describe('publish', () => {
    it('returns a PublishResult with mock IDs', async () => {
      const result = await mock.publish({
        socialAccountId: 'sa-1',
        content: 'Hello',
        hashtags: [],
        mediaUrls: [],
      })
      expect(result.platformPostId).toMatch(/^mock_post_/)
      expect(result.url).toMatch(/^https:\/\/mock.local\/p\//)
    })

    it('records calls', async () => {
      await mock.publish({ socialAccountId: 'sa-1', content: 'Hi', hashtags: [], mediaUrls: [] })
      await mock.publish({ socialAccountId: 'sa-2', content: 'Hi', hashtags: [], mediaUrls: [] })
      expect(mock.calls.publish).toHaveLength(2)
    })
  })

  describe('fetchPostMetrics', () => {
    it('returns synthetic zero metrics', async () => {
      const metrics = await mock.fetchPostMetrics({
        socialAccountId: 'sa-1',
        platformPostId: 'post-1',
      })
      expect(metrics).not.toBeNull()
      expect(metrics!.likes).toBe(0)
      expect(metrics!.impressions).toBe(0)
    })
  })

  describe('fetchEngagement', () => {
    it('returns an empty array', async () => {
      const items = await mock.fetchEngagement({ socialAccountId: 'sa-1', sinceCursor: null })
      expect(items).toEqual([])
    })
  })

  describe('refreshAccessToken', () => {
    it('returns a fresh TokenSet without identity fields', async () => {
      const result = await mock.refreshAccessToken({ socialAccountId: 'sa-1' })
      expect(result.accessToken).toMatch(/^mock_access_/)
      expect(result.platformUserId).toBeUndefined()
    })
  })

  describe('revokeAccessToken', () => {
    it('resolves void', async () => {
      await expect(mock.revokeAccessToken({ socialAccountId: 'sa-1' })).resolves.toBeUndefined()
    })
  })

  describe('failure config', () => {
    it('throws the configured error code on any method', async () => {
      const failing = new MockProvider({ errorCode: 'TOKEN_EXPIRED' })
      await expect(
        failing.publish({ socialAccountId: 'sa-1', content: 'x', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    })

    it('only fails for the configured platform', async () => {
      const failing = new MockProvider({ errorCode: 'TOKEN_REVOKED', platform: 'linkedin' })
      await expect(
        failing.exchangeOAuthCode({ platform: 'twitter', code: 'c', redirectUri: 'r' }),
      ).resolves.toBeTruthy()
      await expect(
        failing.exchangeOAuthCode({ platform: 'linkedin', code: 'c', redirectUri: 'r' }),
      ).rejects.toMatchObject({ code: 'TOKEN_REVOKED' })
    })

    it('throws RATE_LIMITED with retryAfterSeconds', async () => {
      const failing = new MockProvider({ errorCode: 'RATE_LIMITED', retryAfterSeconds: 45 })
      await expect(
        failing.publish({ socialAccountId: 'sa-1', content: 'x', hashtags: [], mediaUrls: [] }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 45 })
    })
  })

  // ADR 0025 §2.9 — one case per required fixture. BACKFILL-MOCK-FIXTURES-MEANINGFUL.
  describe('fetchRecentPosts fixtures', () => {
    async function collectAllPages(
      socialAccountId: string,
      pageSize = 100,
    ): Promise<RecentPost[]> {
      const all: RecentPost[] = []
      let cursor: string | null = null
      let guard = 0
      do {
        const page = await mock.fetchRecentPosts({
          platform: 'twitter',
          socialAccountId,
          pageSize,
          cursor,
          notBefore: null,
        })
        all.push(...page.posts)
        cursor = page.nextCursor
        guard++
      } while (cursor !== null && guard < 10) // bounded — non-terminating fixture is tested separately
      return all
    }

    it('empty: zero posts, no cursor', async () => {
      const page = await mock.fetchRecentPosts({
        platform: 'twitter',
        socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.EMPTY,
        pageSize: 10,
        cursor: null,
        notBefore: null,
      })
      expect(page.posts).toEqual([])
      expect(page.nextCursor).toBeNull()
    })

    it('standard: yields more than 200 posts across pages, spanning ~30 months', async () => {
      const posts = await collectAllPages(MOCK_FIXTURE_ACCOUNT_IDS.STANDARD)
      expect(posts.length).toBeGreaterThan(200)

      const dates = posts.map((p) => new Date(p.publishedAt).getTime())
      const spanDays = differenceInDays(new Date(Math.max(...dates)), new Date(Math.min(...dates)))
      expect(spanDays).toBeGreaterThanOrEqual(900) // ~30 months
    })

    it('zero-post-page: the first page is empty but carries a non-null cursor', async () => {
      const first = await mock.fetchRecentPosts({
        platform: 'twitter',
        socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.ZERO_POST_PAGE,
        pageSize: 10,
        cursor: null,
        notBefore: null,
      })
      expect(first.posts).toEqual([])
      expect(first.nextCursor).not.toBeNull()

      const second = await mock.fetchRecentPosts({
        platform: 'twitter',
        socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.ZERO_POST_PAGE,
        pageSize: 10,
        cursor: first.nextCursor,
        notBefore: null,
      })
      expect(second.posts.length).toBeGreaterThan(0)
    })

    it('non-terminating: every page returns a cursor (an orchestrator-side bound must stop it)', async () => {
      let cursor: string | null = null
      for (let i = 0; i < 5; i++) {
        const page = await mock.fetchRecentPosts({
          platform: 'twitter',
          socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.NON_TERMINATING,
          pageSize: 10,
          cursor,
          notBefore: null,
        })
        expect(page.nextCursor).not.toBeNull()
        cursor = page.nextCursor
      }
    })

    it('mixed-types: never returns a reply, repost or quote', async () => {
      const posts = await collectAllPages(MOCK_FIXTURE_ACCOUNT_IDS.MIXED_TYPES)
      expect(posts.length).toBeGreaterThan(0)
      for (const post of posts) {
        expect(post.content).not.toMatch(/\breply\b/i)
        expect(post.content).not.toMatch(/\brepost\b/i)
        expect(post.content).not.toMatch(/\bquote\b/i)
      }
    })

    it('fail-on-page-N: throws a configured error on page 3, enabling resume from staging', async () => {
      // Walk pages via cursor to reach page 3 deterministically (page 1 and
      // page 2 succeed; the fixture is configured to throw on page 3).
      let cursor: string | null = null
      let lastPage: Awaited<ReturnType<typeof mock.fetchRecentPosts>> | null = null
      for (let i = 0; i < 2; i++) {
        lastPage = await mock.fetchRecentPosts({
          platform: 'twitter',
          socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.FAIL_ON_PAGE_N,
          pageSize: 10,
          cursor,
          notBefore: null,
        })
        cursor = lastPage.nextCursor
      }
      await expect(
        mock.fetchRecentPosts({
          platform: 'twitter',
          socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.FAIL_ON_PAGE_N,
          pageSize: 10,
          cursor,
          notBefore: null,
        }),
      ).rejects.toBeInstanceOf(SocialProviderError)
    })

    it('metrics-separate: every post has metrics: null', async () => {
      const posts = await collectAllPages(MOCK_FIXTURE_ACCOUNT_IDS.METRICS_SEPARATE)
      expect(posts.length).toBeGreaterThan(0)
      for (const post of posts) expect(post.metrics).toBeNull()
    })

    it('over-long: content is truncated to exactly RECENT_POST_CONTENT_MAX_CHARS', async () => {
      const posts = await collectAllPages(MOCK_FIXTURE_ACCOUNT_IDS.OVER_LONG)
      expect(posts.length).toBeGreaterThan(0)
      for (const post of posts) expect(post.content.length).toBe(RECENT_POST_CONTENT_MAX_CHARS)
    })

    it('two-accounts: founder and company fixtures are independently servable', async () => {
      const founder = await collectAllPages(MOCK_FIXTURE_ACCOUNT_IDS.TWO_ACCOUNTS_FOUNDER)
      const company = await collectAllPages(MOCK_FIXTURE_ACCOUNT_IDS.TWO_ACCOUNTS_COMPANY)
      expect(founder.length).toBeGreaterThan(0)
      expect(company.length).toBeGreaterThan(0)
      expect(founder[0]!.platformPostId).not.toBe(company[0]!.platformPostId)
    })

    it('cross-account cursor: a cursor minted for one account is rejected for another', async () => {
      const standardFirst = await mock.fetchRecentPosts({
        platform: 'twitter',
        socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.STANDARD,
        pageSize: 10,
        cursor: null,
        notBefore: null,
      })
      expect(standardFirst.nextCursor).not.toBeNull()

      await expect(
        mock.fetchRecentPosts({
          platform: 'twitter',
          socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.OVER_LONG,
          pageSize: 10,
          cursor: standardFirst.nextCursor,
          notBefore: null,
        }),
      ).rejects.toMatchObject({ code: 'PLATFORM_REJECTED', details: { reason: 'cursor_invalid' } })
    })

    it('the same seed gives byte-identical pages twice', async () => {
      const first = await mock.fetchRecentPosts({
        platform: 'twitter',
        socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.STANDARD,
        pageSize: 10,
        cursor: null,
        notBefore: null,
      })
      const second = await mock.fetchRecentPosts({
        platform: 'twitter',
        socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.STANDARD,
        pageSize: 10,
        cursor: null,
        notBefore: null,
      })
      expect(second).toEqual(first)
    })

    it('records every call in calls.fetchRecentPosts', async () => {
      await mock.fetchRecentPosts({
        platform: 'twitter',
        socialAccountId: MOCK_FIXTURE_ACCOUNT_IDS.EMPTY,
        pageSize: 10,
        cursor: null,
        notBefore: null,
      })
      expect(mock.calls.fetchRecentPosts).toHaveLength(1)
    })
  })

  describe('reset()', () => {
    it('clears the call log', async () => {
      await mock.publish({ socialAccountId: 'sa-1', content: 'x', hashtags: [], mediaUrls: [] })
      expect(mock.calls.publish).toHaveLength(1)
      mock.reset()
      expect(mock.calls.publish).toHaveLength(0)
    })

    it('clears the failure config after reset', async () => {
      const failing = new MockProvider({ errorCode: 'NETWORK' })
      failing.reset()
      await expect(
        failing.publish({ socialAccountId: 'sa-1', content: 'x', hashtags: [], mediaUrls: [] }),
      ).resolves.toBeTruthy()
    })
  })
})
