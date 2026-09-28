import { describe, it, expect } from 'vitest'
import {
  INTERVIEW_ANSWERED_COOLDOWN_DAYS,
  INTERVIEW_COOLDOWN_ROW_CAP,
  INTERVIEW_MAX_QUESTIONS,
  INTERVIEW_MAX_ROUNDS_PER_30_DAYS,
} from './constants'

// Session 35-D D4 (MAJOR-1's cap, re-derived under founder ruling A-7(a)): the cooldown read's row cap is DERIVED, never a
// free number. D3 derived 56 from "one round per 30 days"; A-7(a) lets a `failed` round not count, so two rounds may be
// created per 30 days and the cap becomes (2 x 6 + 1) x 8 = 104.
describe('INTERVIEW_COOLDOWN_ROW_CAP (A-7(a) re-derivation)', () => {
  it('allows two rounds per 30 days (the ceiling create_interview_round enforces in SQL)', () => {
    expect(INTERVIEW_MAX_ROUNDS_PER_30_DAYS).toBe(2)
  })

  it('is (rounds per 30 days x thirty-day periods in the cooldown window + 1) x max questions per round = 104', () => {
    expect(INTERVIEW_COOLDOWN_ROW_CAP).toBe((INTERVIEW_MAX_ROUNDS_PER_30_DAYS * Math.floor(INTERVIEW_ANSWERED_COOLDOWN_DAYS / 30) + 1) * INTERVIEW_MAX_QUESTIONS)
    expect(INTERVIEW_COOLDOWN_ROW_CAP).toBe(104)
  })

  it('is above the old bank-size bound (33) that truncated a late-sorting key, and above the pre-A-7 derivation (56)', () => {
    expect(INTERVIEW_COOLDOWN_ROW_CAP).toBeGreaterThan(56)
    expect(INTERVIEW_COOLDOWN_ROW_CAP).toBeGreaterThan(33)
  })
})
