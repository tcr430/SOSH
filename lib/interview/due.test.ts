import { describe, it, expect } from 'vitest'
import { isInterviewDue, type InterviewDueInput } from './due'

// ADR 0029 §5.1 — INTERVIEW-DUE-COMPUTED (Tier 2). Literal instants around NOW = 2026-09-26T12:00Z:
// 2026-08-27T12:00Z is exactly 30 days earlier, 2026-08-28T12:00Z is 29 days earlier.

const NOW = new Date('2026-09-26T12:00:00.000Z')

function input(over: Partial<InterviewDueInput> = {}): InterviewDueInput {
  return { now: NOW, lastRoundCreatedAt: null, snoozedUntil: null, selectedQuestionCount: 8, ...over }
}

describe('isInterviewDue', () => {
  it('is due for a business with no round ever, no snooze and a full selection', () => {
    expect(isInterviewDue(input())).toBe(true)
  })

  it('is NOT due 29 days after the last round was created, and IS due at exactly 30', () => {
    expect(isInterviewDue(input({ lastRoundCreatedAt: '2026-08-28T12:00:00.000Z' }))).toBe(false)
    expect(isInterviewDue(input({ lastRoundCreatedAt: '2026-08-27T12:00:00.000Z' }))).toBe(true)
    expect(isInterviewDue(input({ lastRoundCreatedAt: '2026-08-01T00:00:00.000Z' }))).toBe(true)
  })

  it('a round created just now blocks it', () => {
    expect(isInterviewDue(input({ lastRoundCreatedAt: '2026-09-26T12:00:00.000Z' }))).toBe(false)
  })

  it('is NOT due while snoozed, and due once the snooze has ended (an end exactly now is over)', () => {
    expect(isInterviewDue(input({ snoozedUntil: '2026-09-27T12:00:00.000Z' }))).toBe(false)
    expect(isInterviewDue(input({ snoozedUntil: '2026-09-26T12:00:00.001Z' }))).toBe(false)
    expect(isInterviewDue(input({ snoozedUntil: '2026-09-26T12:00:00.000Z' }))).toBe(true)
    expect(isInterviewDue(input({ snoozedUntil: '2026-09-19T12:00:00.000Z' }))).toBe(true)
  })

  it('is NOT due when the selection yields fewer than 5 questions, and due at exactly 5', () => {
    expect(isInterviewDue(input({ selectedQuestionCount: 0 }))).toBe(false)
    expect(isInterviewDue(input({ selectedQuestionCount: 4 }))).toBe(false)
    expect(isInterviewDue(input({ selectedQuestionCount: 5 }))).toBe(true)
  })

  it('needs ALL three conditions', () => {
    expect(isInterviewDue(input({ lastRoundCreatedAt: '2026-09-20T00:00:00.000Z', selectedQuestionCount: 3, snoozedUntil: '2026-10-01T00:00:00.000Z' }))).toBe(false)
  })

  it('has no hidden clock: a later now can turn a not-due result into due', () => {
    const args = { lastRoundCreatedAt: '2026-08-28T12:00:00.000Z' }
    expect(isInterviewDue(input(args))).toBe(false)
    expect(isInterviewDue(input({ ...args, now: new Date('2026-09-27T12:00:00.000Z') }))).toBe(true)
  })

  it('throws on a timestamp that does not parse', () => {
    expect(() => isInterviewDue(input({ lastRoundCreatedAt: 'x' }))).toThrow(/lastRoundCreatedAt/)
    expect(() => isInterviewDue(input({ snoozedUntil: 'x' }))).toThrow(/snoozedUntil/)
    expect(() => isInterviewDue(input({ now: new Date('x') }))).toThrow(/now/)
  })
})
