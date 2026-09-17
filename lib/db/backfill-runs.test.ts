import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import { getResumableFailedRunForAccount } from './backfill-runs'
import type { SocialBackfillRunRow } from './types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

function makeRun(overrides: Partial<SocialBackfillRunRow> = {}): SocialBackfillRunRow {
  return {
    id: 'run-1',
    business_id: 'biz-1',
    social_account_id: 'sa-1',
    platform: 'twitter',
    status: 'failed',
    partial: false,
    account_role: null,
    weighting: null,
    posts_fetched: 0,
    posts_extracted: 0,
    platform_posts_read: 0,
    spend_cents: 0,
    ceiling_cents: 50,
    passes_done: 0,
    summary: {},
    staged_voice: null,
    voice_status: null,
    voice_applied_to: null,
    voice_applied_at: null,
    error_code: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    ratified_at: null,
    ...overrides,
  }
}

// NIT-2 (Session 32-D, D5) — `.neq('error_code', 'caller_bug')` excludes
// NULL-code failed runs, since SQL's three-valued logic makes
// `NULL <> 'caller_bug'` unknown, not true. The fix expresses IS DISTINCT
// FROM via `.or()`. Reddens if `.neq()` is restored: this exact string
// assertion demands the `.or()` predicate, and the `.neq('error_code', ...)`
// call this replaced is asserted to never be issued at all.
describe('getResumableFailedRunForAccount (NIT-2, Session 32-D D5)', () => {
  it('filters via error_code.is.null OR error_code.neq.caller_bug — never a bare .neq()', async () => {
    const { client, builder } = createMockClient(makeRun({ error_code: null }))
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await getResumableFailedRunForAccount('sa-1')

    expect(builder.or).toHaveBeenCalledWith('error_code.is.null,error_code.neq.caller_bug')
    expect(builder.neq).not.toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('social_account_id', 'sa-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'failed')
  })

  it('returns a NULL-error_code failed run (a stalled/unresolved failure) as resumable', async () => {
    const row = makeRun({ error_code: null })
    const { client } = createMockClient(row)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    const result = await getResumableFailedRunForAccount('sa-1')

    expect(result).toEqual(row)
  })

  it('returns a non-caller_bug-coded failed run as resumable', async () => {
    const row = makeRun({ error_code: 'TOKEN_EXPIRED' })
    const { client } = createMockClient(row)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    const result = await getResumableFailedRunForAccount('sa-1')

    expect(result).toEqual(row)
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'boom' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)

    await expect(getResumableFailedRunForAccount('sa-1')).rejects.toThrow('boom')
  })
})
