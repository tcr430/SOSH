import { vi, describe, it, expect } from 'vitest'
import { formatISO, subMinutes } from 'date-fns'
import { createMockClient } from './__test-utils__/mock-client'
import {
  insertEmailOutboxRow,
  claimEmailOutboxBatch,
  transitionEmailOutboxRow,
  reapStuckSendingRows,
} from './email-outbox'
import type { EmailOutboxRow } from './types'

const baseRow: EmailOutboxRow = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  business_id: 'bbbbbbbb-0000-0000-0000-000000000001',
  kind: 'trial-warning-t3',
  recipient: 'user@example.com',
  locale: 'en',
  props: {},
  dedupe_token: null,
  status: 'pending',
  attempts: 0,
  next_attempt_at: null,
  last_error: null,
  provider_message_id: null,
  sent_at: null,
  created_at: '2026-06-07T10:00:00.000Z',
  updated_at: '2026-06-07T10:00:00.000Z',
}

describe('insertEmailOutboxRow', () => {
  it('returns { inserted: true, row } on successful insert', async () => {
    const { client } = createMockClient(baseRow, null)
    const result = await insertEmailOutboxRow(client, {
      business_id: baseRow.business_id,
      kind: 'trial-warning-t3',
      recipient: 'user@example.com',
      locale: 'en',
      props: {},
      status: 'pending',
    })
    expect(result.inserted).toBe(true)
    expect(result.row).toEqual(baseRow)
    expect(client.from).toHaveBeenCalledWith('email_outbox')
  })

  it('returns { inserted: false, row: null } on 23505 dedupe conflict', async () => {
    const { client } = createMockClient(null, { code: '23505', message: 'duplicate key value' })
    const result = await insertEmailOutboxRow(client, {
      business_id: baseRow.business_id,
      kind: 'trial-warning-t3',
      recipient: 'user@example.com',
      locale: 'en',
      props: {},
      dedupe_token: 'trial-t3-bbbbbbbb',
      status: 'pending',
    })
    expect(result).toEqual({ inserted: false, row: null })
  })

  it('inserts with status=suppressed for enqueue-time D3 skip', async () => {
    const suppressed = { ...baseRow, status: 'suppressed' as const }
    const { client, builder } = createMockClient(suppressed, null)
    await insertEmailOutboxRow(client, {
      business_id: baseRow.business_id,
      kind: 'first-post-published',
      recipient: 'user@example.com',
      locale: 'en',
      props: {},
      status: 'suppressed',
    })
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'suppressed' }))
  })

  it('throws on non-duplicate DB errors', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'permission denied' })
    await expect(
      insertEmailOutboxRow(client, {
        business_id: baseRow.business_id,
        kind: 'welcome-to-plan',
        recipient: 'user@example.com',
        locale: 'en',
        props: {},
        status: 'pending',
      }),
    ).rejects.toThrow('permission denied')
  })

  it('stores null dedupe_token when not provided', async () => {
    const { client, builder } = createMockClient(baseRow, null)
    await insertEmailOutboxRow(client, {
      business_id: baseRow.business_id,
      kind: 'welcome-to-plan',
      recipient: 'user@example.com',
      locale: 'en',
      props: {},
      status: 'pending',
    })
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupe_token: null }),
    )
  })
})

describe('claimEmailOutboxBatch', () => {
  it('returns array of pending rows from RPC', async () => {
    const rows = [baseRow, { ...baseRow, id: 'aaaaaaaa-0000-0000-0000-000000000002' }]
    const { client } = createMockClient(rows, null)
    const result = await claimEmailOutboxBatch(client, 10)
    expect(result).toEqual(rows)
    expect(client.rpc).toHaveBeenCalledWith('claim_email_outbox', { batch_size: 10 })
  })

  it('returns empty array when no pending rows exist', async () => {
    const { client } = createMockClient(null, null)
    const result = await claimEmailOutboxBatch(client, 10)
    expect(result).toEqual([])
  })

  it('throws on RPC error', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'rpc error' })
    await expect(claimEmailOutboxBatch(client, 5)).rejects.toThrow('rpc error')
  })
})

describe('transitionEmailOutboxRow', () => {
  it('transitions pending → sending successfully', async () => {
    const pendingRow = { status: 'pending' }
    const sendingRow = { ...baseRow, status: 'sending' as const }
    const { client } = createMockClient(sendingRow, null)
    const singleSpy = vi.fn()
      .mockResolvedValueOnce({ data: pendingRow, error: null })
      .mockResolvedValueOnce({ data: sendingRow, error: null })
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: singleSpy,
    })
    const result = await transitionEmailOutboxRow(client, baseRow.id, { status: 'sending' })
    expect(result).toEqual(sendingRow)
  })

  it('throws on illegal transition: sent → pending', async () => {
    const { client } = createMockClient(null, null)
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { status: 'sent' }, error: null }),
    })
    await expect(
      transitionEmailOutboxRow(client, baseRow.id, { status: 'pending' }),
    ).rejects.toThrow('Illegal email_outbox transition: sent → pending')
  })

  it('throws on illegal transition: suppressed → sent', async () => {
    const { client } = createMockClient(null, null)
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { status: 'suppressed' }, error: null }),
    })
    await expect(
      transitionEmailOutboxRow(client, baseRow.id, { status: 'sent' }),
    ).rejects.toThrow('Illegal email_outbox transition: suppressed → sent')
  })

  it('throws on illegal transition: failed → sending', async () => {
    const { client } = createMockClient(null, null)
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { status: 'failed' }, error: null }),
    })
    await expect(
      transitionEmailOutboxRow(client, baseRow.id, { status: 'sending' }),
    ).rejects.toThrow('Illegal email_outbox transition: failed → sending')
  })

  it('returns null when row is not found', async () => {
    const { client } = createMockClient(null, null)
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const result = await transitionEmailOutboxRow(client, 'nonexistent', { status: 'sending' })
    expect(result).toBeNull()
  })

  it('throws on fetch DB error', async () => {
    const { client } = createMockClient(null, null)
    client.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'fetch error' } }),
    })
    await expect(
      transitionEmailOutboxRow(client, baseRow.id, { status: 'sending' }),
    ).rejects.toThrow('fetch error')
  })
})

describe('reapStuckSendingRows', () => {
  it('returns the count of rows reset to pending', async () => {
    const rows = [baseRow, { ...baseRow, id: 'aaaaaaaa-0000-0000-0000-000000000002' }]
    const { client } = createMockClient(rows, null)
    const count = await reapStuckSendingRows(client, 15)
    expect(count).toBe(2)
    expect(client.from).toHaveBeenCalledWith('email_outbox')
  })

  it('returns 0 when no stuck rows exist', async () => {
    const { client } = createMockClient([], null)
    const count = await reapStuckSendingRows(client, 15)
    expect(count).toBe(0)
  })

  it('uses the cutoff derived from stuckMinutes', async () => {
    const { client, builder } = createMockClient([], null)
    const now = new Date('2026-06-07T12:00:00.000Z')
    const expectedCutoff = formatISO(subMinutes(now, 15))
    await reapStuckSendingRows(client, 15, now)
    expect(builder.lt).toHaveBeenCalledWith('updated_at', expectedCutoff)
  })

  it('only targets rows with status=sending', async () => {
    const { client, builder } = createMockClient([], null)
    await reapStuckSendingRows(client, 15)
    expect(builder.eq).toHaveBeenCalledWith('status', 'sending')
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { code: '42501', message: 'db error' })
    await expect(reapStuckSendingRows(client, 15)).rejects.toThrow('db error')
  })
})
