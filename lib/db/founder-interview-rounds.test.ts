import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  FounderInterviewRpcError,
  claimInterviewExtraction,
  createInterviewRound,
  getLatestInterviewRound,
  listInterviewRoundsForBusiness,
  reconcileInterviewSpend,
  skipInterviewRound,
  snoozeInterview,
  submitInterviewRound,
  sweepInterviewData,
} from './founder-interview-rounds'
import { INTERVIEW_ROUNDS_LIMIT } from '@/lib/interview/constants'

// ADR 0029 §9.5 INTERVIEW-BOUNDED-QUERIES (Tier 2) and the wrapper half of §2.3 / §2.5. The list reads are BOUNDED (an
// explicit `limit`, default 12) and ORDERED BY created_at DESC — the column order of
// founder_interview_rounds_business_created_idx (business_id, created_at DESC). Every RPC wrapper is service-role by
// LAZY import (no `client` parameter), forwards ONLY the p_* arguments the RPC declares, and never a governance value.
//
// SHARED-FUNCTION CALLERS: none yet — M2.4 lands these files before any consumer. The sole future callers are the
// extraction orchestrator (M2.8: claim / reconcile) and the Server Actions (M2.9: create / submit / skip / snooze, and
// the two reads from the /interview page). Each gains its own caller-side test in that step; until then the caller is
// AUTHORED-NOT-EXECUTED and this file is the only executed proof.

afterEach(() => vi.clearAllMocks())

const calls = (fn: unknown) => (fn as { mock: { calls: unknown[][] } }).mock.calls

function serviceRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createServiceRoleClient>)
  return rpc
}

const GOVERNANCE = ['source', 'status', 'confidence', 'sensitivity', 'public_use_permission', 'scope', 'scope_ref', 'expires_at', 'observation_count', 'last_confirmed_at']

describe('INTERVIEW-BOUNDED-QUERIES — founder-interview-rounds reads', () => {
  it("lists a business's rounds newest-first with an explicit limit (default 12) on the caller's client", async () => {
    const { client, builder, from } = createMockClient([{ id: 'r-1' }], null)
    const rows = await listInterviewRoundsForBusiness(client, 'biz-1')
    expect(from).toHaveBeenCalledWith('founder_interview_rounds')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(calls(builder.order)).toEqual([['created_at', { ascending: false }]])
    expect(calls(builder.limit)).toEqual([[12]])
    expect(INTERVIEW_ROUNDS_LIMIT).toBe(12)
    expect(rows).toEqual([{ id: 'r-1' }])
  })

  it('honours a caller-supplied limit, and a null result is an empty list', async () => {
    const { client, builder } = createMockClient(null, null)
    expect(await listInterviewRoundsForBusiness(client, 'biz-1', 3)).toEqual([])
    expect(calls(builder.limit)).toEqual([[3]])
  })

  it('getLatestInterviewRound is the same indexed list with limit 1: the newest round, or null', async () => {
    const found = createMockClient([{ id: 'r-9' }, { id: 'r-8' }], null)
    expect(await getLatestInterviewRound(found.client, 'biz-1')).toEqual({ id: 'r-9' })
    expect(calls(found.builder.limit)).toEqual([[1]])
    expect(calls(found.builder.order)).toEqual([['created_at', { ascending: false }]])
    const none = createMockClient([], null)
    expect(await getLatestInterviewRound(none.client, 'biz-1')).toBeNull()
  })

  it('a database error throws, never returns a partial list', async () => {
    const { client } = createMockClient(null, { message: 'boom' })
    await expect(listInterviewRoundsForBusiness(client, 'biz-1')).rejects.toThrow('boom')
  })

  it('every list function declares a limit parameter (a source check that survives a refactor)', () => {
    expect(listInterviewRoundsForBusiness.length).toBe(2) // (client, businessId, limit = default): the default is not counted
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'founder-interview-rounds.ts'), 'utf8')
    expect(src).toMatch(/limit = INTERVIEW_ROUNDS_LIMIT/)
    expect(src).toMatch(/\.order\('created_at', \{ ascending: false \}\)/)
    expect(src).toMatch(/\.limit\(limit\)/)
  })
})

describe('founder-interview-rounds RPC wrappers — service-role by lazy import, p_* arguments only', () => {
  const USER = '00000000-0000-4000-8000-000000000001'
  const BIZ = '00000000-0000-4000-8000-000000000002'
  const ROUND = '00000000-0000-4000-8000-000000000003'
  const QUESTIONS = [{ questionKey: 'k1', slotType: 'brand' as const, slotCategory: 'positioning', bankVersion: 1 }]

  const CASES: { name: string; rpc: string; run: () => Promise<unknown>; expectedArgs: Record<string, unknown> }[] = [
    {
      name: 'createInterviewRound',
      rpc: 'create_interview_round',
      run: () => createInterviewRound({ userId: USER, businessId: BIZ, questions: QUESTIONS }),
      expectedArgs: { p_user_id: USER, p_business_id: BIZ, p_questions: QUESTIONS },
    },
    {
      name: 'submitInterviewRound',
      rpc: 'submit_interview_round',
      run: () => submitInterviewRound({ userId: USER, roundId: ROUND }),
      expectedArgs: { p_user_id: USER, p_round_id: ROUND },
    },
    {
      name: 'skipInterviewRound',
      rpc: 'skip_interview_round',
      run: () => skipInterviewRound({ userId: USER, roundId: ROUND }),
      expectedArgs: { p_user_id: USER, p_round_id: ROUND },
    },
    {
      name: 'snoozeInterview',
      rpc: 'snooze_interview',
      run: () => snoozeInterview({ userId: USER, businessId: BIZ }),
      expectedArgs: { p_user_id: USER, p_business_id: BIZ },
    },
    {
      name: 'claimInterviewExtraction',
      rpc: 'claim_interview_extraction',
      run: () => claimInterviewExtraction({ roundId: ROUND }),
      expectedArgs: { p_round_id: ROUND },
    },
  ]

  it.each(CASES)('$name calls $rpc with EXACTLY the declared p_* arguments — no governance value, nothing extra', async ({ rpc, run, expectedArgs }) => {
    const spy = serviceRpc({ data: { outcome: 'ok' }, error: null })
    await run()
    expect(spy).toHaveBeenCalledTimes(1)
    const [name, args] = spy.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe(rpc)
    expect(args).toEqual(expectedArgs)
    for (const key of Object.keys(args)) {
      expect(key.startsWith('p_'), key).toBe(true)
      expect(GOVERNANCE, key).not.toContain(key.replace(/^p_/, ''))
    }
  })

  it('reconcileInterviewSpend forwards the error code on failure and NULL on success', async () => {
    const spy = serviceRpc({ data: { outcome: 'reconciled', status: 'extraction_failed', spendCents: 7, clamped: false }, error: null })
    await reconcileInterviewSpend({ roundId: ROUND, attempt: 2, actualCents: 7, outcome: 'failed', errorCode: 'model_error' })
    await reconcileInterviewSpend({ roundId: ROUND, attempt: 1, actualCents: 4, outcome: 'succeeded' })
    expect(spy.mock.calls.map((c) => c[1])).toEqual([
      { p_round_id: ROUND, p_actual_cents: 7, p_outcome: 'failed', p_error_code: 'model_error', p_attempt: 2 },
      { p_round_id: ROUND, p_actual_cents: 4, p_outcome: 'succeeded', p_error_code: null, p_attempt: 1 },
    ])
  })

  it('a TYPED outcome is returned as a value, exactly as the RPC produced it (a refusal is never an exception)', async () => {
    serviceRpc({ data: { outcome: 'ceiling', spendCents: 21, ceilingCents: 30 }, error: null })
    expect(await claimInterviewExtraction({ roundId: ROUND })).toEqual({ outcome: 'ceiling', spendCents: 21, ceilingCents: 30 })
    serviceRpc({ data: { outcome: 'too_soon' }, error: null })
    expect(await createInterviewRound({ userId: USER, businessId: BIZ, questions: QUESTIONS })).toEqual({ outcome: 'too_soon' })
  })

  it('an AUTHORISATION failure (42501) is NOT a value: it throws a FounderInterviewRpcError carrying the code', async () => {
    serviceRpc({ data: null, error: { code: '42501', message: 'create_interview_round: x is not an author-level member of business y' } })
    const attempt = createInterviewRound({ userId: USER, businessId: BIZ, questions: QUESTIONS })
    await expect(attempt).rejects.toBeInstanceOf(FounderInterviewRpcError)
    await expect(attempt).rejects.toMatchObject({ code: '42501', name: 'FounderInterviewRpcError' })
    await expect(attempt).rejects.toThrow(/not an author-level member/)
  })

  it('the service-role client is acquired PER CALL, lazily — never at module load', async () => {
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    serviceRpc({ data: { outcome: 'ok' }, error: null })
    await snoozeInterview({ userId: USER, businessId: BIZ })
    expect(createServiceRoleClient).toHaveBeenCalledTimes(1)
  })

  // ADR 0029 §5.4 (M2.6) — the retention sweep wrapper. Its sole future caller is the cron route (M2.9).
  it('sweepInterviewData calls sweep_interview_data with NO arguments (no user id, no business id) and returns the six counters', async () => {
    const counters = { failedStuck: 1, expired: 2, candidatesRetired: 3, answersRedacted: 4, spansRedacted: 5, candidatesDeleted: 6 }
    const spy = serviceRpc({ data: counters, error: null })
    expect(await sweepInterviewData()).toEqual(counters)
    expect(spy).toHaveBeenCalledWith('sweep_interview_data', {})
    expect(sweepInterviewData.length).toBe(0)
  })

  it('a sweep failure throws a FounderInterviewRpcError (the cron route must not swallow it)', async () => {
    serviceRpc({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
    await expect(sweepInterviewData()).rejects.toBeInstanceOf(FounderInterviewRpcError)
  })

  it('no wrapper takes a `client` parameter, and the file has no STATIC import of the service-role client', () => {
    for (const fn of [createInterviewRound, submitInterviewRound, skipInterviewRound, snoozeInterview, claimInterviewExtraction, reconcileInterviewSpend]) {
      expect(fn.length, fn.name).toBe(1) // a single args object
    }
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'founder-interview-rounds.ts'), 'utf8')
    expect(src).not.toMatch(/^import[^\n]*@\/lib\/supabase\/service/m)
    expect(src).toMatch(/await import\('@\/lib\/supabase\/service'\)/)
  })
})
