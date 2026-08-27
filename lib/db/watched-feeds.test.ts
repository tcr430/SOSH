import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  listWatchedFeedsForBusiness,
  countActiveWatchedFeedsForBusiness,
  addWatchedFeed,
  setWatchedFeedActive,
  listActiveWatchedFeedsReadyForPoll,
  recordWatchedFeedPollOutcome,
} from './watched-feeds'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

describe('lib/db/watched-feeds.ts (ADR 0023 §3.2/§10.1)', () => {
  it('listWatchedFeedsForBusiness is bounded and ORDER BY matches created_at ASC, id ASC', async () => {
    const { client, builder } = createMockClient([], null)
    await listWatchedFeedsForBusiness(client, 'biz-1', 20)
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('listWatchedFeedsForBusiness defaults its bound to 20 (the watch-list cap)', async () => {
    const { client, builder } = createMockClient([], null)
    await listWatchedFeedsForBusiness(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('countActiveWatchedFeedsForBusiness scopes to business_id and is_active', async () => {
    const { client, builder } = createMockClient(null, null)
    await countActiveWatchedFeedsForBusiness(client, 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('addWatchedFeed inserts the given row', async () => {
    const { client, builder } = createMockClient({ id: 'feed-1' }, null)
    await addWatchedFeed(client, {
      business_id: 'biz-1',
      url: 'https://example.com/feed.xml',
      url_hash: 'hash-1',
      label: 'Example',
      added_by: 'user-1',
    })
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: 'biz-1', url_hash: 'hash-1' }),
    )
  })

  it('setWatchedFeedActive is a tenancy-scoped conditional UPDATE (§7.6 no-DELETE-policy: unwatching is is_active=false)', async () => {
    const { client, builder } = createMockClient(null, null)
    await setWatchedFeedActive(client, 'feed-1', 'biz-1', false)
    expect(builder.update).toHaveBeenCalledWith({ is_active: false })
    expect(builder.eq).toHaveBeenCalledWith('id', 'feed-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
  })

  it('listActiveWatchedFeedsReadyForPoll filters is_active and excludes a future rate_limited_until, ordered least-recently-fetched first', async () => {
    const { client, builder } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await listActiveWatchedFeedsReadyForPoll(100)

    expect(builder.eq).toHaveBeenCalledWith('is_active', true)
    expect(builder.or).toHaveBeenCalledWith(expect.stringContaining('rate_limited_until.is.null'))
    expect(builder.order).toHaveBeenCalledWith('last_fetch_at', { ascending: true, nullsFirst: true })
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(100)
  })

  describe('recordWatchedFeedPollOutcome — last_success_at (ADR §9.4, G1b.9)', () => {
    it("an 'ok' outcome sets last_success_at alongside the other poll-state fields", async () => {
      const { client, builder } = createMockClient(null, null)
      mockCreateServiceRoleClient.mockReturnValue(client)

      await recordWatchedFeedPollOutcome('feed-1', 'biz-1', { status: 'ok', etag: '"v2"', consecutiveFailureCount: 0 })

      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ last_fetch_status: 'ok', last_success_at: expect.any(String) }),
      )
      expect(builder.eq).toHaveBeenCalledWith('id', 'feed-1')
      expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    })

    it("a 'not_modified' outcome ALSO sets last_success_at — the feed was reachable, just unchanged", async () => {
      const { client, builder } = createMockClient(null, null)
      mockCreateServiceRoleClient.mockReturnValue(client)

      await recordWatchedFeedPollOutcome('feed-1', 'biz-1', { status: 'not_modified', consecutiveFailureCount: 0 })

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ last_success_at: expect.any(String) }))
    })

    it("an 'error' outcome does NOT set last_success_at, preserving the prior success time across a failure run", async () => {
      const { client, builder } = createMockClient(null, null)
      mockCreateServiceRoleClient.mockReturnValue(client)

      await recordWatchedFeedPollOutcome('feed-1', 'biz-1', { status: 'error', errorCode: 'fetch_failed', consecutiveFailureCount: 1 })

      const call = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(call).not.toHaveProperty('last_success_at')
      expect(call).toEqual(expect.objectContaining({ last_fetch_status: 'error', last_error_code: 'fetch_failed' }))
    })
  })
})
