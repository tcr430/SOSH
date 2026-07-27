import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import {
  countProcessedSignalsSince,
  listRecentHumanEditExcerpts,
  claimPostEditSignals,
  transitionPostEditSignal,
} from './post-edit-signals'
import type { PostEditSignalRow } from './types'

const baseRow: PostEditSignalRow = {
  id: 'sig-1',
  business_id: 'biz-1',
  post_id: 'post-1',
  campaign_id: 'camp-1',
  ai_original_id: 'origin-1',
  human_content: 'Human edited content',
  human_hashtags: [],
  approved_at: '2026-07-27T10:00:00Z',
  status: 'pending',
  attempts: 0,
  next_attempt_at: '2026-07-27T10:00:00Z',
  last_error: null,
  processed_at: null,
  class: null,
  pattern_key: null,
  signals: null,
  created_at: '2026-07-27T09:00:00Z',
  updated_at: '2026-07-27T09:00:00Z',
}

describe('countProcessedSignalsSince', () => {
  it('filters by business_id and status=processed, with no gt() when since is null', async () => {
    const { client, builder } = createMockClient(null, null)
    await countProcessedSignalsSince(client, 'biz-1', null)

    expect(client.from).toHaveBeenCalledWith('post_edit_signals')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'processed')
    expect(builder.gt).not.toHaveBeenCalled()
  })

  it('adds a gt(processed_at, since) filter when since is provided', async () => {
    const { client, builder } = createMockClient(null, null)
    await countProcessedSignalsSince(client, 'biz-1', '2026-07-01T00:00:00Z')
    expect(builder.gt).toHaveBeenCalledWith('processed_at', '2026-07-01T00:00:00Z')
  })

  it('returns 0 when count is null', async () => {
    const { client } = createMockClient(null, null)
    expect(await countProcessedSignalsSince(client, 'biz-1', null)).toBe(0)
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(countProcessedSignalsSince(client, 'biz-1', null)).rejects.toThrow('DB error')
  })
})

describe('listRecentHumanEditExcerpts', () => {
  it('filters by business_id/status=processed, orders by processed_at desc, and applies the limit', async () => {
    const { client, builder } = createMockClient([{ human_content: 'a' }, { human_content: 'b' }], null)
    const result = await listRecentHumanEditExcerpts(client, 'biz-1', null, 200)

    expect(client.from).toHaveBeenCalledWith('post_edit_signals')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'processed')
    expect(builder.order).toHaveBeenCalledWith('processed_at', { ascending: false })
    expect(builder.limit).toHaveBeenCalledWith(200)
    expect(result).toEqual(['a', 'b'])
  })

  it('adds a gt(processed_at, since) filter when since is provided', async () => {
    const { client, builder } = createMockClient([], null)
    await listRecentHumanEditExcerpts(client, 'biz-1', '2026-07-01T00:00:00Z', 200)
    expect(builder.gt).toHaveBeenCalledWith('processed_at', '2026-07-01T00:00:00Z')
  })

  it('returns an empty array when no rows match', async () => {
    const { client } = createMockClient(null, null)
    expect(await listRecentHumanEditExcerpts(client, 'biz-1', null, 200)).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listRecentHumanEditExcerpts(client, 'biz-1', null, 200)).rejects.toThrow('DB error')
  })
})

// ADR 0018 §9.3 (C2.8) — claim_post_edit_signals RPC wrapper, exact shape of
// claimEmailOutboxBatch (lib/db/email-outbox.ts:62-69).
describe('claimPostEditSignals', () => {
  it('returns claimed rows from the RPC', async () => {
    const rows = [baseRow, { ...baseRow, id: 'sig-2' }]
    const { client } = createMockClient(rows, null)
    const result = await claimPostEditSignals(client, 50)
    expect(result).toEqual(rows)
    expect(client.rpc).toHaveBeenCalledWith('claim_post_edit_signals', { batch_size: 50 })
  })

  it('returns empty array when nothing is claimable', async () => {
    const { client } = createMockClient(null, null)
    const result = await claimPostEditSignals(client, 50)
    expect(result).toEqual([])
  })

  it('throws on RPC error', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'rpc error' })
    await expect(claimPostEditSignals(client, 50)).rejects.toThrow('rpc error')
  })

  // [silent-failure-hunter, C2.8 review MAJOR-1] the orchestrator's
  // permanent/transient classifier keys off err.code — losing it here would
  // silently defeat "fail fast on a constraint violation instead of
  // burning retries."
  it('preserves the Postgres error code on the thrown Error', async () => {
    const { client } = createMockClient(null, { code: '23503', message: 'foreign key violation' })
    await expect(claimPostEditSignals(client, 50)).rejects.toMatchObject({ code: '23503' })
  })
})

// ADR 0018 §9.1 (C2.8) — atomic status re-guard, exact shape of
// transitionEmailOutboxRow (lib/db/email-outbox.ts:71-116): a SELECT to read
// current status, a LEGAL_TRANSITIONS check, then an UPDATE guarded by
// .eq('status', currentStatus) so a concurrently-moved row updates zero rows
// rather than corrupting a state it no longer owns.
describe('transitionPostEditSignal', () => {
  it('transitions processing → processed successfully', async () => {
    const processingRow = { status: 'processing' }
    const processedRow = { ...baseRow, status: 'processed' as const }
    const singleSpy = vi.fn()
      .mockResolvedValueOnce({ data: processingRow, error: null })
      .mockResolvedValueOnce({ data: processedRow, error: null })
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof transitionPostEditSignal>[0]
    ;(client.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: singleSpy,
    })
    const result = await transitionPostEditSignal(client, baseRow.id, {
      status: 'processed',
      class: 'preference',
      pattern_key: 'length_delta:shorter:linkedin',
      signals: { preferences: [], corrections: [], inconclusive: [] },
      processed_at: '2026-07-27T10:00:00Z',
    })
    expect(result).toEqual(processedRow)
  })

  it('guards the UPDATE with WHERE status = <source status> (atomic transition)', async () => {
    const processingRow = { status: 'processing' }
    const failedRow = { ...baseRow, status: 'failed' as const }
    const eqSpy = vi.fn().mockReturnThis()
    const singleSpy = vi.fn()
      .mockResolvedValueOnce({ data: processingRow, error: null })
      .mockResolvedValueOnce({ data: failedRow, error: null })
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof transitionPostEditSignal>[0]
    ;(client.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: eqSpy,
      single: singleSpy,
    })
    await transitionPostEditSignal(client, baseRow.id, {
      status: 'failed',
      attempts: 1,
      next_attempt_at: '2026-07-27T10:05:00Z',
      last_error: 'transient error',
    })
    expect(eqSpy).toHaveBeenCalledWith('status', 'processing')
  })

  it('throws on illegal transition: processed → processing', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof transitionPostEditSignal>[0]
    ;(client.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { status: 'processed' }, error: null }),
    })
    await expect(
      transitionPostEditSignal(client, baseRow.id, { status: 'processing' }),
    ).rejects.toThrow('Illegal post_edit_signals transition: processed → processing')
  })

  it('returns null when row is not found', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof transitionPostEditSignal>[0]
    ;(client.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const result = await transitionPostEditSignal(client, 'nonexistent', { status: 'processed' })
    expect(result).toBeNull()
  })

  it('returns null when UPDATE affects zero rows (atomic guard: status changed concurrently)', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof transitionPostEditSignal>[0]
    const singleSpy = vi.fn()
      .mockResolvedValueOnce({ data: { status: 'processing' }, error: null }) // SELECT
      .mockResolvedValueOnce({ data: null, error: null })                    // UPDATE — zero rows
    ;(client.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: singleSpy,
    })
    const result = await transitionPostEditSignal(client, baseRow.id, { status: 'processed' })
    expect(result).toBeNull()
  })

  it('throws on fetch DB error', async () => {
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof transitionPostEditSignal>[0]
    ;(client.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'fetch error' } }),
    })
    await expect(
      transitionPostEditSignal(client, baseRow.id, { status: 'processed' }),
    ).rejects.toThrow('fetch error')
  })
})
