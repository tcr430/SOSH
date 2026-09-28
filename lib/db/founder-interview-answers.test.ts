import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { formatISO, subDays } from 'date-fns'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { FounderInterviewRpcError } from './founder-interview-rounds'
import { listAnsweredForExtraction, listAnswersForRound, listInterviewCooldownRows, saveInterviewAnswer, skipInterviewAnswer } from './founder-interview-answers'
import { INTERVIEW_ANSWERED_COOLDOWN_DAYS, INTERVIEW_ANSWERS_LIMIT } from '@/lib/interview/constants'

// ADR 0029 §9.5 INTERVIEW-BOUNDED-QUERIES (Tier 2) and the wrapper half of §2.5. The answer reads are BOUNDED and ORDERED
// on an index: the answers of a round by `position` (founder_interview_answers_round_position_uq), the cooldown rows by
// (question_key ASC, answered_at DESC) — the column order of founder_interview_answers_cooldown_idx. The save / skip
// wrappers are service-role by lazy import and can name NO business (the RPCs derive it from the answer).
//
// SHARED-FUNCTION CALLERS: none yet — the Server Actions (M2.9: save / skip) and the /interview page (M2.10: the answer
// list) are the future callers, and the pure selection (M2.7) is the sole caller of listInterviewCooldownRows. Until
// those steps land, every caller is AUTHORED-NOT-EXECUTED and this file is the only executed proof.

afterEach(() => vi.clearAllMocks())

const calls = (fn: unknown) => (fn as { mock: { calls: unknown[][] } }).mock.calls

function serviceRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createServiceRoleClient>)
  return rpc
}

describe('INTERVIEW-BOUNDED-QUERIES — founder-interview-answers reads', () => {
  it("lists ONE round's answers in question order with an explicit limit (default 8)", async () => {
    const { client, builder, from } = createMockClient([{ id: 'a-1' }], null)
    const rows = await listAnswersForRound(client, 'round-1')
    expect(from).toHaveBeenCalledWith('founder_interview_answers')
    expect(builder.eq).toHaveBeenCalledWith('round_id', 'round-1')
    expect(calls(builder.order)).toEqual([['position', { ascending: true }]])
    expect(calls(builder.limit)).toEqual([[8]])
    expect(INTERVIEW_ANSWERS_LIMIT).toBe(8)
    expect(rows).toEqual([{ id: 'a-1' }])
  })

  it('honours a caller-supplied limit, and a database error throws', async () => {
    const ok = createMockClient(null, null)
    expect(await listAnswersForRound(ok.client, 'round-1', 4)).toEqual([])
    expect(calls(ok.builder.limit)).toEqual([[4]])
    const bad = createMockClient(null, { message: 'boom' })
    await expect(listAnswersForRound(bad.client, 'round-1')).rejects.toThrow('boom')
  })

  it('the cooldown lookup reads ONE business, only answered / skipped rows that carry a clock, WITHIN the cooldown window, ordered (question_key ASC, answered_at DESC)', async () => {
    const { client, builder, from } = createMockClient([{ question_key: 'k1', status: 'answered', answered_at: '2026-09-01T00:00:00Z' }], null)
    const now = new Date('2026-09-27T00:00:00.000Z')
    const rows = await listInterviewCooldownRows(client, 'biz-1', now, 40)
    expect(from).toHaveBeenCalledWith('founder_interview_answers')
    expect(builder.select).toHaveBeenCalledWith('question_key, status, answered_at')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.in).toHaveBeenCalledWith('status', ['answered', 'skipped'])
    expect(builder.not).toHaveBeenCalledWith('answered_at', 'is', null)
    // Session 35-D · D3 (MAJOR-1) — WINDOWED BY TIME: 180 days before `now`, via date-fns, never a raw
    // toISOString comparison. The expected cutoff is computed with the SAME date-fns call, not a hardcoded
    // literal, so the assertion doesn't depend on the test runner's local timezone (email-outbox.test.ts's
    // idiom for the same pattern).
    expect(builder.gte).toHaveBeenCalledWith('answered_at', formatISO(subDays(now, INTERVIEW_ANSWERED_COOLDOWN_DAYS)))
    expect(calls(builder.order)).toEqual([
      ['question_key', { ascending: true }],
      ['answered_at', { ascending: false }],
    ])
    expect(calls(builder.limit)).toEqual([[40]])
    expect(rows).toHaveLength(1)
  })

  it('the cooldown lookup has NO default limit — the bound is required and is the derived row cap, not the bank size (§9.5, D3)', () => {
    expect(listInterviewCooldownRows.length).toBe(4) // (client, businessId, now, limit): no default value, so all four count
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'founder-interview-answers.ts'), 'utf8')
    expect(src).toMatch(/listInterviewCooldownRows\(client: SupabaseClient, businessId: string, now: Date, limit: number\)/)
    expect(src).toMatch(/\.limit\(limit\)/)
    expect(src).toMatch(/subDays\(now, INTERVIEW_ANSWERED_COOLDOWN_DAYS\)/)
  })
})

describe('founder-interview-answers RPC wrappers — service-role by lazy import, no business id, p_* only', () => {
  const USER = '00000000-0000-4000-8000-000000000001'
  const ANSWER = '00000000-0000-4000-8000-000000000004'

  it('saveInterviewAnswer calls save_interview_answer with EXACTLY (p_user_id, p_answer_id, p_text) and returns the typed outcome', async () => {
    const spy = serviceRpc({ data: { outcome: 'not_open' }, error: null })
    const result = await saveInterviewAnswer({ userId: USER, answerId: ANSWER, text: 'we ship weekly' })
    expect(spy).toHaveBeenCalledWith('save_interview_answer', { p_user_id: USER, p_answer_id: ANSWER, p_text: 'we ship weekly' })
    expect(result).toEqual({ outcome: 'not_open' })
  })

  it('skipInterviewAnswer calls skip_interview_answer with EXACTLY (p_user_id, p_answer_id)', async () => {
    const spy = serviceRpc({ data: { outcome: 'ok', answerId: ANSWER }, error: null })
    expect(await skipInterviewAnswer({ userId: USER, answerId: ANSWER })).toEqual({ outcome: 'ok', answerId: ANSWER })
    expect(spy).toHaveBeenCalledWith('skip_interview_answer', { p_user_id: USER, p_answer_id: ANSWER })
  })

  it('neither wrapper forwards a business id or a governance value', async () => {
    const spy = serviceRpc({ data: { outcome: 'ok' }, error: null })
    await saveInterviewAnswer({ userId: USER, answerId: ANSWER, text: 'x' })
    await skipInterviewAnswer({ userId: USER, answerId: ANSWER })
    for (const [, args] of spy.mock.calls as [string, Record<string, unknown>][]) {
      expect(Object.keys(args).every((k) => ['p_user_id', 'p_answer_id', 'p_text'].includes(k))).toBe(true)
    }
  })

  it('an AUTHORISATION failure (42501) throws a FounderInterviewRpcError carrying the code, from BOTH wrappers', async () => {
    serviceRpc({ data: null, error: { code: '42501', message: "save_interview_answer: x is not an author-level member of the answer's business" } })
    await expect(saveInterviewAnswer({ userId: USER, answerId: ANSWER, text: 'x' })).rejects.toMatchObject({ code: '42501' })
    await expect(skipInterviewAnswer({ userId: USER, answerId: ANSWER })).rejects.toBeInstanceOf(FounderInterviewRpcError)
  })

  it('no wrapper takes a `client` parameter, and the file never imports the service-role client itself', () => {
    expect(saveInterviewAnswer.length).toBe(1)
    expect(skipInterviewAnswer.length).toBe(1)
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'founder-interview-answers.ts'), 'utf8')
    // it reaches the service-role client ONLY through founder-interview-rounds' callInterviewRpc (lazy import)
    expect(src).not.toMatch(/@\/lib\/supabase\/service/)
  })
})

// ADR 0029 §4 / §9.5 (Session 35 M2.8) — the WORKER read of a round's answered questions, for the extraction. Separately named,
// service-role by the shared lazy helper, no `client` parameter, bounded, ordered, and scoped by the round AND the business the
// claim derived from the round. SHARED-FUNCTION CALLERS: lib/interview/extract.ts is the only caller (tested in
// lib/interview/extract.test.ts with this function mocked; this file is the executed proof of the query itself).
describe('listAnsweredForExtraction (M2.8, the worker read)', () => {
  function serviceReads(rows: unknown, error: unknown = null) {
    const mock = createMockClient(rows, error)
    vi.mocked(createServiceRoleClient).mockReturnValue(mock.client as unknown as ReturnType<typeof createServiceRoleClient>)
    return mock
  }

  it('reads ONE round, scoped to the round AND its business, only ANSWERED rows that still have text, by position, limit 8', async () => {
    const { builder, from } = serviceReads([{ id: 'a-1', question_key: 'k1', position: 1, answer_text: 'hello' }])
    const rows = await listAnsweredForExtraction('round-1', 'biz-1')
    expect(from).toHaveBeenCalledWith('founder_interview_answers')
    expect(builder.select).toHaveBeenCalledWith('id, question_key, position, answer_text')
    expect(builder.eq).toHaveBeenCalledWith('round_id', 'round-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'answered')
    expect(builder.not).toHaveBeenCalledWith('answer_text', 'is', null)
    expect(calls(builder.order)).toEqual([['position', { ascending: true }]])
    expect(builder.limit).toHaveBeenCalledWith(INTERVIEW_ANSWERS_LIMIT)
    expect(rows).toEqual([{ id: 'a-1', question_key: 'k1', position: 1, answer_text: 'hello' }])
  })

  it('takes NO client parameter (it acquires service-role itself) and returns [] for a null result', async () => {
    expect(listAnsweredForExtraction.length).toBe(2)
    serviceReads(null)
    expect(await listAnsweredForExtraction('round-1', 'biz-1')).toEqual([])
  })

  it('throws the database error rather than returning an empty list (an empty list would fail the round as no_answers)', async () => {
    serviceReads(null, { message: 'boom' })
    await expect(listAnsweredForExtraction('round-1', 'biz-1')).rejects.toThrow(/boom/)
  })
})
