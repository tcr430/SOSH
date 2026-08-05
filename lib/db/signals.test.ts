import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { listRecentSignalsForBusiness, listSignalsForWatchedRepo, upsertSignal } from './signals'
import type { SignalInsert } from './types'

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

  it('upsertSignal targets UNIQUE(business_id, source, external_id) as the conflict arbiter (§4.3 idempotency)', async () => {
    const { client, builder } = createMockClient(null, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const insert: SignalInsert = {
      business_id: 'biz-1',
      watched_repo_id: 'repo-1',
      source: 'github',
      kind: 'release',
      external_id: 'github:release:1',
      title: 'v1' as SignalInsert['title'],
      occurred_at: '2026-07-01T00:00:00Z',
    }
    await upsertSignal(insert)

    expect(builder.upsert).toHaveBeenCalledWith(insert, { onConflict: 'business_id,source,external_id' })
  })
})
