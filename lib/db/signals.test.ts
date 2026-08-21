import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { listRecentSignalsForBusiness, listSignalsForWatchedRepo } from './signals'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

describe('lib/db/signals.ts (ADR 0020 §10.1/§7.4)', () => {
  it('listRecentSignalsForBusiness is bounded and ORDER BY matches signals_business_id_occurred_at_idx (business_id, occurred_at DESC, id)', async () => {
    const { client, builder } = createMockClient([], null)
    await listRecentSignalsForBusiness(client, 'biz-1', 50)
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.order).toHaveBeenCalledWith('occurred_at', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  it('listRecentSignalsForBusiness defaults its bound to 50', async () => {
    const { client, builder } = createMockClient([], null)
    await listRecentSignalsForBusiness(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  it('listSignalsForWatchedRepo is bounded, filters watched_repo_id (matches signals_watched_repo_id_idx), and states an explicit business_id predicate', async () => {
    const { client, builder } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await listSignalsForWatchedRepo('repo-1', 'biz-1', 50)

    expect(builder.eq).toHaveBeenCalledWith('watched_repo_id', 'repo-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  // [Session 27-D · D3, MINOR-1] listSignalsForWatchedRepo previously ordered
  // ONLY by occurred_at DESC, with no id tiebreak — non-deterministic under a
  // LIMIT when rows share an occurred_at. This asserts BOTH order calls are
  // issued, in order, so the poller's edit-detection window is deterministic.
  it('listSignalsForWatchedRepo orders occurred_at DESC then id ASC as a tiebreak (MINOR-1)', async () => {
    const { client, builder } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await listSignalsForWatchedRepo('repo-1', 'biz-1', 50)

    expect(builder.order).toHaveBeenCalledTimes(2)
    expect(builder.order).toHaveBeenNthCalledWith(1, 'occurred_at', { ascending: false })
    expect(builder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true })
  })
})
