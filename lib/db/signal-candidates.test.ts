import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { listNewCandidates, upsertSignalCandidate } from './signal-candidates'
import type { SignalCandidateInsert } from './types'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

describe('lib/db/signal-candidates.ts (ADR 0020 §13.1)', () => {
  it('listNewCandidates matches §13.1 EXACTLY: filter business_id + status=new, ORDER BY score DESC, occurred_at DESC, id ASC, bounded', async () => {
    const { client, builder } = createMockClient([], null)

    await listNewCandidates(client, 'biz-1', 50)

    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'new')
    expect(builder.order).toHaveBeenCalledWith('score', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('occurred_at', { ascending: false })
    expect(builder.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  it('listNewCandidates defaults its bound to 50 (§13.1)', async () => {
    const { client, builder } = createMockClient([], null)
    await listNewCandidates(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(50)
  })

  it('listNewCandidates joins signals(title, body, html_url, occurred_at, author_is_bot) — §13.1 minus tag_name (no backing column, recorded in-code)', async () => {
    const { client, builder } = createMockClient([], null)
    await listNewCandidates(client, 'biz-1')
    expect(builder.select).toHaveBeenCalledWith('*, signals(title, body, html_url, occurred_at, author_is_bot)')
  })

  it('upsertSignalCandidate targets UNIQUE(signal_id) as the arbiter (§3.4 blocker, closed)', async () => {
    const { client, builder } = createMockClient(null, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    const insert: SignalCandidateInsert = {
      business_id: 'biz-1',
      signal_id: 'sig-1',
      score: 42,
      occurred_at: '2026-07-01T00:00:00Z',
    }
    await upsertSignalCandidate(insert)

    expect(builder.upsert).toHaveBeenCalledWith(insert, { onConflict: 'signal_id' })
  })
})
