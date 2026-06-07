import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueEmail } from '../enqueue'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({} as SupabaseClient)),
}))

vi.mock('@/lib/db/email-suppressions', () => ({
  isEmailSuppressed: vi.fn(),
}))

vi.mock('@/lib/db/email-outbox', () => ({
  insertEmailOutboxRow: vi.fn(),
}))

import { isEmailSuppressed } from '@/lib/db/email-suppressions'
import { insertEmailOutboxRow } from '@/lib/db/email-outbox'

const BASE_ROW = {
  id: 'row-uuid-1',
  business_id: 'biz-1',
  kind: 'trial-warning-t3',
  recipient: 'user@example.com',
  locale: 'en',
  props: {},
  status: 'pending',
  dedupe_token: null,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
  attempts: 0,
  next_attempt_at: null,
  last_error: null,
  provider_message_id: null,
  sent_at: null,
}

const BASE_INPUT = {
  business_id: 'biz-1',
  kind: 'trial-warning-t3' as const,
  recipient: 'user@example.com',
  locale: 'en' as const,
  props: { businessName: 'Acme', daysRemaining: 3 },
  dedupe_token: 'tok-abc',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('enqueueEmail', () => {
  it('happy path: not suppressed → outcome enqueued, row inserted with status pending', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(insertEmailOutboxRow).mockResolvedValue({ inserted: true, row: BASE_ROW as never })

    const result = await enqueueEmail(BASE_INPUT)

    expect(result.outcome).toBe('enqueued')
    expect(result.row_id).toBe('row-uuid-1')
    expect(vi.mocked(insertEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'pending' }),
    )
  })

  it('suppression enqueue-check: recipient in suppressions → outcome suppressed, row inserted with status suppressed', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValue(true)
    vi.mocked(insertEmailOutboxRow).mockResolvedValue({
      inserted: true,
      row: { ...BASE_ROW, status: 'suppressed' } as never,
    })

    const result = await enqueueEmail(BASE_INPUT)

    expect(result.outcome).toBe('suppressed')
    expect(vi.mocked(insertEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'suppressed' }),
    )
    expect(vi.mocked(insertEmailOutboxRow)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'pending' }),
    )
  })

  it('dedupe: duplicate (business_id, kind, dedupe_token) → outcome deduped, no second row', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(insertEmailOutboxRow).mockResolvedValue({ inserted: false, row: null })

    const result = await enqueueEmail(BASE_INPUT)

    expect(result.outcome).toBe('deduped')
    expect(result.row_id).toBeNull()
  })

  it('locale snapshot invariant: locale passed to insertEmailOutboxRow matches input locale', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(insertEmailOutboxRow).mockResolvedValue({ inserted: true, row: BASE_ROW as never })

    await enqueueEmail({ ...BASE_INPUT, locale: 'pt' })

    expect(vi.mocked(insertEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locale: 'pt' }),
    )
  })

  it('recipient is lowercased and trimmed before insert', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(insertEmailOutboxRow).mockResolvedValue({ inserted: true, row: BASE_ROW as never })

    await enqueueEmail({ ...BASE_INPUT, recipient: '  User@EXAMPLE.COM  ' })

    expect(vi.mocked(isEmailSuppressed)).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
    )
    expect(vi.mocked(insertEmailOutboxRow)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipient: 'user@example.com' }),
    )
  })

  it('emits the canonical log line on every enqueue', async () => {
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(insertEmailOutboxRow).mockResolvedValue({ inserted: true, row: BASE_ROW as never })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await enqueueEmail(BASE_INPUT)

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({
        kind: 'email.enqueue',
        email_kind: BASE_INPUT.kind,
        business_id: BASE_INPUT.business_id,
        locale: BASE_INPUT.locale,
        outcome: 'enqueued',
      }),
    )
  })
})
