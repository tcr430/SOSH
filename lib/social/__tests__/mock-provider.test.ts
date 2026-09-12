import { describe, it, expect, beforeEach } from 'vitest'
import { MockProvider } from '../mock-provider'
import { SocialProviderError } from '../errors'

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
