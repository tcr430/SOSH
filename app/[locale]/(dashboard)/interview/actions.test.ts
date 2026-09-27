import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0029 §2.5, §5.3, §5.4, §8.4-§8.6, §9.5 (Session 35 M2.9) — the Server Actions. Every action is
// tested for: Zod bounds, p_user_id ALWAYS from getUser() (never client input), the ratify role gate
// (approver OR is_admin, not the plain AUTHOR capability), the D-4 re-check on an edited text, and the
// after()-fired orchestrator kick-off on submit/retry.

vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn() }))
vi.mock('@/lib/db/founder-interview-rounds', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/founder-interview-rounds')>('@/lib/db/founder-interview-rounds')
  return {
    FounderInterviewRpcError: actual.FounderInterviewRpcError,
    createInterviewRound: vi.fn(),
    getInterviewRoundById: vi.fn(),
    skipInterviewRound: vi.fn(),
    snoozeInterview: vi.fn(),
    submitInterviewRound: vi.fn(),
  }
})
vi.mock('@/lib/db/founder-interview-answers', () => ({
  listInterviewCooldownRows: vi.fn(),
  saveInterviewAnswer: vi.fn(),
  skipInterviewAnswer: vi.fn(),
}))
vi.mock('@/lib/memory/interview', () => ({ ratifyInterviewCandidates: vi.fn() }))
vi.mock('@/lib/memory/interview-coverage', () => ({ readInterviewSlotRows: vi.fn() }))
vi.mock('@/lib/interview/extract', () => ({ extractInterviewRound: vi.fn() }))

import { after } from 'next/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { createClient } from '@/lib/supabase/server'
import {
  FounderInterviewRpcError,
  createInterviewRound,
  getInterviewRoundById,
  skipInterviewRound,
  snoozeInterview,
  submitInterviewRound,
} from '@/lib/db/founder-interview-rounds'
import { listInterviewCooldownRows, saveInterviewAnswer, skipInterviewAnswer } from '@/lib/db/founder-interview-answers'
import { ratifyInterviewCandidates } from '@/lib/memory/interview'
import { readInterviewSlotRows } from '@/lib/memory/interview-coverage'
import { extractInterviewRound } from '@/lib/interview/extract'
import {
  ratifyInterviewRoundAction,
  retryInterviewExtractionAction,
  saveInterviewAnswerAction,
  skipInterviewQuestionAction,
  skipInterviewRoundAction,
  snoozeInterviewAction,
  startInterviewRoundAction,
  submitInterviewRoundAction,
} from './actions'

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111'
const OWNER_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = 'user-1'
const ROUND_ID = '33333333-3333-4333-8333-333333333333'
const ANSWER_ID = '44444444-4444-4444-8444-444444444444'
const CAND_ID = '55555555-5555-4555-8555-555555555555'

const authClient = { auth: { getUser: vi.fn() } }

beforeEach(() => {
  vi.resetAllMocks()
  authClient.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  vi.mocked(createClient).mockResolvedValue(authClient as never)
  vi.mocked(getBusinessForUser).mockResolvedValue({ id: BUSINESS_ID, owner_id: OWNER_ID } as never)
  vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: false } as never)
  vi.mocked(readInterviewSlotRows).mockResolvedValue([])
  vi.mocked(listInterviewCooldownRows).mockResolvedValue([])
})

describe('authentication — every action refuses an unauthenticated caller', () => {
  it.each([
    ['startInterviewRoundAction', () => startInterviewRoundAction()],
    ['saveInterviewAnswerAction', () => saveInterviewAnswerAction({ answerId: ANSWER_ID, text: 'hi' })],
    ['skipInterviewQuestionAction', () => skipInterviewQuestionAction({ answerId: ANSWER_ID })],
    ['skipInterviewRoundAction', () => skipInterviewRoundAction({ roundId: ROUND_ID })],
    ['submitInterviewRoundAction', () => submitInterviewRoundAction({ roundId: ROUND_ID })],
    ['retryInterviewExtractionAction', () => retryInterviewExtractionAction({ roundId: ROUND_ID })],
    ['snoozeInterviewAction', () => snoozeInterviewAction()],
    ['ratifyInterviewRoundAction', () => ratifyInterviewRoundAction({ roundId: ROUND_ID, decisions: [{ type: 'brand', id: CAND_ID, decision: 'reject' }] })],
  ])('%s returns unauthenticated when getUser() has no user', async (_name, run) => {
    authClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    const result = await run()
    expect(result).toEqual({ ok: false, error: 'unauthenticated' })
  })
})

describe('p_user_id is ALWAYS getUser()s id, never client input', () => {
  it('saveInterviewAnswerAction ignores a client-supplied userId and uses the authenticated one', async () => {
    vi.mocked(saveInterviewAnswer).mockResolvedValue({ outcome: 'ok', answerId: ANSWER_ID })
    await saveInterviewAnswerAction({ answerId: ANSWER_ID, text: 'hello', userId: 'attacker-id' })
    expect(saveInterviewAnswer).toHaveBeenCalledWith({ userId: USER_ID, answerId: ANSWER_ID, text: 'hello' })
  })
})

describe('Zod validation', () => {
  it('saveInterviewAnswerAction rejects text over 2000 characters', async () => {
    const result = await saveInterviewAnswerAction({ answerId: ANSWER_ID, text: 'x'.repeat(2001) })
    expect(result).toEqual({ ok: false, error: 'validation' })
    expect(saveInterviewAnswer).not.toHaveBeenCalled()
  })

  it('ratifyInterviewRoundAction rejects more than 24 decisions', async () => {
    const decisions = Array.from({ length: 25 }, (_, i) => ({ type: 'brand' as const, id: `66666666-6666-4666-8666-6666666666${String(i).padStart(2, '0')}`, decision: 'reject' as const }))
    const result = await ratifyInterviewRoundAction({ roundId: ROUND_ID, decisions })
    expect(result).toEqual({ ok: false, error: 'validation' })
    expect(ratifyInterviewCandidates).not.toHaveBeenCalled()
  })

  it('ratifyInterviewRoundAction rejects an unknown decision value (not accept/reject)', async () => {
    const result = await ratifyInterviewRoundAction({ roundId: ROUND_ID, decisions: [{ type: 'brand', id: CAND_ID, decision: 'maybe' }] })
    expect(result).toEqual({ ok: false, error: 'validation' })
  })

  it('ratifyInterviewRoundAction rejects a smuggled governance key (extra key on a decision, key set EXACT)', async () => {
    const result = await ratifyInterviewRoundAction({
      roundId: ROUND_ID,
      decisions: [{ type: 'brand', id: CAND_ID, decision: 'accept', confidence: 1.0 }],
    })
    expect(result).toEqual({ ok: false, error: 'validation' })
    expect(ratifyInterviewCandidates).not.toHaveBeenCalled()
  })

  it('ratifyInterviewRoundAction rejects an evidence edit (text on an evidence accept)', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'approver', is_admin: false } as never)
    const result = await ratifyInterviewRoundAction({
      roundId: ROUND_ID,
      decisions: [{ type: 'evidence', id: CAND_ID, decision: 'accept', text: 'edited verbatim text' }],
    })
    expect(result).toEqual({ ok: false, error: 'validation' })
    expect(ratifyInterviewCandidates).not.toHaveBeenCalled()
  })
})

describe('startInterviewRoundAction', () => {
  it('a viewer (no author capability) is forbidden', async () => {
    vi.mocked(getBusinessForUser).mockResolvedValue({ id: BUSINESS_ID, owner_id: OWNER_ID } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)
    const result = await startInterviewRoundAction()
    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(createInterviewRound).not.toHaveBeenCalled()
  })

  it('nothing thin: every bank key cooling down yields an empty selection, returning the sentinel without calling the RPC', async () => {
    const { INTERVIEW_BANK } = await import('@/lib/interview/bank')
    vi.mocked(listInterviewCooldownRows).mockResolvedValue(
      INTERVIEW_BANK.map((q) => ({ question_key: q.questionKey, status: 'answered', answered_at: new Date().toISOString() })) as never,
    )
    const result = await startInterviewRoundAction()
    expect(result).toEqual({ ok: true, result: { outcome: 'nothing_thin' } })
    expect(createInterviewRound).not.toHaveBeenCalled()
  })

  it('an author with something thin creates the round with the computed selection', async () => {
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: false } as never)
    vi.mocked(createInterviewRound).mockResolvedValue({ outcome: 'ok', roundId: ROUND_ID })
    const result = await startInterviewRoundAction()
    expect(result).toEqual({ ok: true, result: { outcome: 'ok', roundId: ROUND_ID } })
    expect(createInterviewRound).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, businessId: BUSINESS_ID }))
    const call = vi.mocked(createInterviewRound).mock.calls[0][0]
    expect(call.questions.length).toBeGreaterThanOrEqual(5)
    expect(call.questions.length).toBeLessThanOrEqual(8)
  })

  it('the owner (no member row) resolves as author via resolveMemberContext', async () => {
    vi.mocked(getMemberForUser).mockResolvedValue(null)
    authClient.auth.getUser.mockResolvedValue({ data: { user: { id: OWNER_ID } } })
    vi.mocked(createInterviewRound).mockResolvedValue({ outcome: 'ok', roundId: ROUND_ID })
    const result = await startInterviewRoundAction()
    expect(result.ok).toBe(true)
  })
})

describe('submitInterviewRoundAction', () => {
  it('on outcome ok, fires the M2.8 orchestrator via after() with the returned roundId', async () => {
    vi.mocked(submitInterviewRound).mockResolvedValue({ outcome: 'ok', roundId: ROUND_ID })
    const result = await submitInterviewRoundAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: true, result: { outcome: 'ok', roundId: ROUND_ID } })
    expect(after).toHaveBeenCalledTimes(1)
    const scheduled = vi.mocked(after).mock.calls[0][0] as () => unknown
    await scheduled()
    expect(extractInterviewRound).toHaveBeenCalledWith(ROUND_ID)
  })

  it('on a non-ok outcome (not_open), does NOT fire the orchestrator', async () => {
    vi.mocked(submitInterviewRound).mockResolvedValue({ outcome: 'not_open' })
    const result = await submitInterviewRoundAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: true, result: { outcome: 'not_open' } })
    expect(after).not.toHaveBeenCalled()
    expect(extractInterviewRound).not.toHaveBeenCalled()
  })

  it('a 42501 from the RPC maps to forbidden', async () => {
    vi.mocked(submitInterviewRound).mockRejectedValue(new FounderInterviewRpcError('nope', '42501'))
    const result = await submitInterviewRoundAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('a 22023 from the RPC maps to validation', async () => {
    vi.mocked(submitInterviewRound).mockRejectedValue(new FounderInterviewRpcError('bad', '22023'))
    const result = await submitInterviewRoundAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: false, error: 'validation' })
  })
})

describe('retryInterviewExtractionAction — the RPC it re-enters has NO membership check, so this action IS the boundary', () => {
  it('an unknown round id is not_found', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue(null)
    const result = await retryInterviewExtractionAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(after).not.toHaveBeenCalled()
  })

  it("a non-member (or viewer) of the round's business is forbidden — extraction never fires", async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID, status: 'extraction_failed' } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: true } as never)
    const result = await retryInterviewExtractionAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(after).not.toHaveBeenCalled()
  })

  it('a round not in extraction_failed returns not_open without firing after()', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID, status: 'awaiting_ratification' } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: false } as never)
    const result = await retryInterviewExtractionAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: true, result: { outcome: 'not_open' } })
    expect(after).not.toHaveBeenCalled()
  })

  it('an author-level member retrying an extraction_failed round fires the orchestrator', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID, status: 'extraction_failed' } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'approver', is_admin: false } as never)
    const result = await retryInterviewExtractionAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: true, result: { outcome: 'retrying' } })
    expect(after).toHaveBeenCalledTimes(1)
    const scheduled = vi.mocked(after).mock.calls[0][0] as () => unknown
    await scheduled()
    expect(extractInterviewRound).toHaveBeenCalledWith(ROUND_ID)
  })
})

describe('ratifyInterviewRoundAction — role gate is approver OR is_admin, NOT the plain author capability', () => {
  it('an editor is forbidden and the RPC is never reached', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: false } as never)
    const result = await ratifyInterviewRoundAction({ roundId: ROUND_ID, decisions: [{ type: 'brand', id: CAND_ID, decision: 'reject' }] })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(ratifyInterviewCandidates).not.toHaveBeenCalled()
  })

  it('a caller with no member row at all is forbidden', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID } as never)
    vi.mocked(getMemberForUser).mockResolvedValue(null)
    const result = await ratifyInterviewRoundAction({ roundId: ROUND_ID, decisions: [{ type: 'brand', id: CAND_ID, decision: 'reject' }] })
    expect(result).toEqual({ ok: false, error: 'forbidden' })
  })

  it('an admin who is not an approver is allowed (the ADR §2.5 recorded difference from hasCapability(APPROVE))', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: true } as never)
    vi.mocked(ratifyInterviewCandidates).mockResolvedValue({ outcome: 'ratified', accepted: 1, rejected: 0, edited: 0, replaced: 0 })
    const result = await ratifyInterviewRoundAction({ roundId: ROUND_ID, decisions: [{ type: 'brand', id: CAND_ID, decision: 'accept' }] })
    expect(result.ok).toBe(true)
    expect(ratifyInterviewCandidates).toHaveBeenCalledWith({ userId: USER_ID, roundId: ROUND_ID, decisions: [{ type: 'brand', id: CAND_ID, decision: 'accept' }] })
  })

  it('an edited brand text containing a performance claim ("engagement") is rejected before the RPC', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'approver', is_admin: false } as never)
    const result = await ratifyInterviewRoundAction({
      roundId: ROUND_ID,
      decisions: [{ type: 'brand', id: CAND_ID, decision: 'accept', text: 'This post got great engagement' }],
    })
    expect(result).toEqual({ ok: false, error: 'performance_claim' })
    expect(ratifyInterviewCandidates).not.toHaveBeenCalled()
  })

  it('an edit that does NOT mention performance reaches the RPC', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue({ id: ROUND_ID, business_id: BUSINESS_ID } as never)
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'approver', is_admin: false } as never)
    vi.mocked(ratifyInterviewCandidates).mockResolvedValue({ outcome: 'ratified', accepted: 1, rejected: 0, edited: 1, replaced: 0 })
    const result = await ratifyInterviewRoundAction({
      roundId: ROUND_ID,
      decisions: [{ type: 'brand', id: CAND_ID, decision: 'accept', text: 'We integrate natively with every platform' }],
    })
    expect(result.ok).toBe(true)
    expect(ratifyInterviewCandidates).toHaveBeenCalled()
  })

  it('an unknown round id is not_found', async () => {
    vi.mocked(getInterviewRoundById).mockResolvedValue(null)
    const result = await ratifyInterviewRoundAction({ roundId: ROUND_ID, decisions: [{ type: 'brand', id: CAND_ID, decision: 'reject' }] })
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('the remaining author-level actions pass through to their RPC wrappers with getUser()s id', () => {
  it('skipInterviewQuestionAction', async () => {
    vi.mocked(skipInterviewAnswer).mockResolvedValue({ outcome: 'ok', answerId: ANSWER_ID })
    const result = await skipInterviewQuestionAction({ answerId: ANSWER_ID })
    expect(result).toEqual({ ok: true, result: { outcome: 'ok', answerId: ANSWER_ID } })
    expect(skipInterviewAnswer).toHaveBeenCalledWith({ userId: USER_ID, answerId: ANSWER_ID })
  })

  it('skipInterviewRoundAction', async () => {
    vi.mocked(skipInterviewRound).mockResolvedValue({ outcome: 'ok', skippedAnswers: 3 })
    const result = await skipInterviewRoundAction({ roundId: ROUND_ID })
    expect(result).toEqual({ ok: true, result: { outcome: 'ok', skippedAnswers: 3 } })
    expect(skipInterviewRound).toHaveBeenCalledWith({ userId: USER_ID, roundId: ROUND_ID })
  })

  it('snoozeInterviewAction requires author capability and forwards businessId', async () => {
    vi.mocked(snoozeInterview).mockResolvedValue({ outcome: 'ok', snoozedUntil: '2026-10-04T00:00:00Z' })
    const result = await snoozeInterviewAction()
    expect(result).toEqual({ ok: true, result: { outcome: 'ok', snoozedUntil: '2026-10-04T00:00:00Z' } })
    expect(snoozeInterview).toHaveBeenCalledWith({ userId: USER_ID, businessId: BUSINESS_ID })
  })
})
