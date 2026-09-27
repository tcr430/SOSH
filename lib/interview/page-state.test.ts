import { describe, it, expect } from 'vitest'
import { computeInterviewPageState, isInterviewCardState, type ComputeInterviewPageStateInput } from './page-state'
import { INTERVIEW_BANK } from './bank'
import { computeSlotThinness } from './thinness'
import type { FounderInterviewRoundRow } from '@/lib/db/types'

// ADR 0029 §8.1/§8.2 (Session 35 M2.10) INTERVIEW-UI-STATES — the pure decision the page and card both
// switch on. NOW = 2026-09-26T12:00Z, matching due.test.ts's pinned instant.

const NOW = new Date('2026-09-26T12:00:00.000Z')
const ROUND_ID = '11111111-1111-4111-8111-111111111111'

function round(over: Partial<FounderInterviewRoundRow> = {}): FounderInterviewRoundRow {
  return {
    id: ROUND_ID,
    business_id: 'biz-1',
    status: 'open',
    question_count: 6,
    bank_version: 1,
    created_by: null,
    created_at: NOW.toISOString(),
    submitted_at: null,
    claimed_at: null,
    extraction_attempts: 0,
    spend_cents: 0,
    ceiling_cents: 30,
    error_code: null,
    extracted_at: null,
    ratified_at: null,
    ratified_by: null,
    terminal_at: null,
    items_proposed: 0,
    dropped_ungrounded: 0,
    dropped_performance_claim: 0,
    candidates_written_brand: 0,
    candidates_written_audience: 0,
    candidates_written_evidence: 0,
    accepted: 0,
    rejected: 0,
    edited: 0,
    replaced: 0,
    updated_at: NOW.toISOString(),
    ...over,
  }
}

// Every slot at zero rows -> thinness 1 for all eleven (thin.ts's own arithmetic): the DEFAULT input is
// "everything thin", so a test opts INTO a specific thinness only when it needs one.
const EVERYTHING_THIN = computeSlotThinness([], NOW)

function input(over: Partial<ComputeInterviewPageStateInput> = {}): ComputeInterviewPageStateInput {
  return {
    round: null,
    now: NOW,
    thinness: EVERYTHING_THIN,
    cooldowns: [],
    snoozedUntil: null,
    answers: [],
    isRatifier: false,
    candidates: null,
    ...over,
  }
}

// Every bank key cooling down forces selectQuestions() to [] regardless of thinness (§3.3): the
// cooldown/snooze half of due-ness stays whatever it is, but the thinness half always fails.
const ALL_COOLING_DOWN = INTERVIEW_BANK.map((q) => ({ question_key: q.questionKey, status: 'answered', answered_at: NOW.toISOString() }))

describe('computeInterviewPageState', () => {
  it('due: no round, nothing cooling down, empty thinness rows (every slot thin) -> due with 5..8 questions', () => {
    const state = computeInterviewPageState(input())
    expect(state.kind).toBe('due')
    if (state.kind === 'due') {
      expect(state.questionCount).toBeGreaterThanOrEqual(5)
      expect(state.questionCount).toBeLessThanOrEqual(8)
    }
  })

  it('nothing_thin: cooldown/snooze allow a new round, but the selection is empty', () => {
    const state = computeInterviewPageState(input({ cooldowns: ALL_COOLING_DOWN }))
    expect(state).toEqual({ kind: 'nothing_thin' })
  })

  it('not_due: snoozed, no round at all (nothing to reference)', () => {
    const state = computeInterviewPageState(input({ snoozedUntil: '2026-10-01T00:00:00.000Z' }))
    expect(state).toEqual({ kind: 'not_due', nextEligibleAt: '2026-10-01T00:00:00.000Z' })
  })

  it('in_progress: an open round owns the screen regardless of due-ness, carrying its answers', () => {
    const r = round({ status: 'open' })
    const answers = [{ id: 'a-1' }] as never
    const state = computeInterviewPageState(input({ round: r, answers }))
    expect(state).toEqual({ kind: 'in_progress', round: r, answers })
  })

  it('extracting: both submitted and extracting map to the same polled state', () => {
    expect(computeInterviewPageState(input({ round: round({ status: 'submitted' }) })).kind).toBe('extracting')
    expect(computeInterviewPageState(input({ round: round({ status: 'extracting' }) })).kind).toBe('extracting')
  })

  it('extraction_failed: canRetry while attempts < 3 and under the ceiling; ceilingReached is distinct from a plain retryable failure', () => {
    const retryable = computeInterviewPageState(input({ round: round({ status: 'extraction_failed', extraction_attempts: 1, spend_cents: 10, ceiling_cents: 30 }) }))
    expect(retryable).toMatchObject({ kind: 'extraction_failed', canRetry: true, ceilingReached: false })

    const outOfAttempts = computeInterviewPageState(input({ round: round({ status: 'extraction_failed', extraction_attempts: 3, spend_cents: 10, ceiling_cents: 30 }) }))
    expect(outOfAttempts).toMatchObject({ canRetry: false, ceilingReached: false })

    const atCeiling = computeInterviewPageState(input({ round: round({ status: 'extraction_failed', extraction_attempts: 1, spend_cents: 30, ceiling_cents: 30 }) }))
    expect(atCeiling).toMatchObject({ canRetry: false, ceilingReached: true })
  })

  it('failed: the terminal outcome, distinct from extraction_failed', () => {
    const state = computeInterviewPageState(input({ round: round({ status: 'failed' }) }))
    expect(state.kind).toBe('failed')
  })

  it('awaiting_ratification: carries isRatifier, the candidates (null for a plain author), and the round answers', () => {
    const r = round({ status: 'awaiting_ratification' })
    const answers = [{ id: 'a-1' }] as never
    const asAuthor = computeInterviewPageState(input({ round: r, isRatifier: false, candidates: null, answers }))
    expect(asAuthor).toEqual({ kind: 'awaiting_ratification', round: r, isRatifier: false, candidates: null, answers })

    const candidates = { brand: [], audience: [], evidence: [] }
    const asRatifier = computeInterviewPageState(input({ round: r, isRatifier: true, candidates, answers }))
    expect(asRatifier).toEqual({ kind: 'awaiting_ratification', round: r, isRatifier: true, candidates, answers })
  })

  it.each(['ratified', 'no_records', 'skipped', 'expired'] as const)(
    'a terminal round (%s) still owns the screen while its 30-day cooldown is active, distinct from every other terminal kind',
    (status) => {
      const r = round({ status })
      const state = computeInterviewPageState(input({ round: r }))
      expect(state).toEqual({ kind: status, round: r })
    },
  )

  it('no_records and extraction_failed are NEVER the same kind (the ADR Section 10.5 silent-failure pair)', () => {
    const noRecords = computeInterviewPageState(input({ round: round({ status: 'no_records' }) }))
    const extractionFailed = computeInterviewPageState(input({ round: round({ status: 'extraction_failed' }) }))
    expect(noRecords.kind).not.toBe(extractionFailed.kind)
  })

  it('a terminal round PAST its 30-day cooldown yields due/nothing_thin instead — the confirmation is not shown forever', () => {
    const oldRound = round({ status: 'ratified', created_at: '2026-08-01T00:00:00.000Z' })
    const state = computeInterviewPageState(input({ round: oldRound }))
    expect(state.kind).toBe('due')
  })

  it('not_due can only carry nextEligibleAt from a snooze, never a round (a round always resolves to its own kind first)', () => {
    const r = round({ status: 'ratified', created_at: NOW.toISOString() }) // cooldown active: created just now
    const state = computeInterviewPageState(input({ round: r, snoozedUntil: '2026-10-01T00:00:00.000Z' }))
    // The round's own cooldown is active (created today), so its TERMINAL confirmation owns the screen —
    // never 'not_due', regardless of the snooze date also being in the future.
    expect(state).toEqual({ kind: 'ratified', round: r })
  })
})

describe('isInterviewCardState — the dashboard card shows due / open / awaiting ratification only', () => {
  it('shown for due, in_progress, extracting, extraction_failed, awaiting_ratification', () => {
    expect(isInterviewCardState({ kind: 'due', questionCount: 6 })).toBe(true)
    expect(isInterviewCardState({ kind: 'in_progress', round: round(), answers: [] })).toBe(true)
    expect(isInterviewCardState({ kind: 'extracting', round: round() })).toBe(true)
    expect(isInterviewCardState({ kind: 'extraction_failed', round: round(), canRetry: true, ceilingReached: false })).toBe(true)
    expect(isInterviewCardState({ kind: 'awaiting_ratification', round: round(), isRatifier: true, candidates: null, answers: [] })).toBe(true)
  })

  it('hidden for not_due, nothing_thin, and every terminal confirmation kind', () => {
    expect(isInterviewCardState({ kind: 'not_due', nextEligibleAt: null })).toBe(false)
    expect(isInterviewCardState({ kind: 'nothing_thin' })).toBe(false)
    for (const kind of ['ratified', 'no_records', 'skipped', 'expired', 'failed'] as const) {
      expect(isInterviewCardState({ kind, round: round({ status: kind }) })).toBe(false)
    }
  })
})
