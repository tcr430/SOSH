import { describe, it, expect } from 'vitest'
import { OUTCOME_PROVISIONAL_N, OUTCOME_RETRO_MIN_N } from '@/lib/outcomes/constants'
import {
  ANALYTICS_DISPLAY_FLOOR,
  ANALYTICS_COMPARE_FLOOR,
  ANALYTICS_HOOK_TYPE_FLOOR,
  ANALYTICS_WILSON_FLOOR,
  ANALYTICS_RANGE_IQR_FROM,
} from '../constants'
import { displayState, compareState, monthPairAllowed } from '../floors'

// ADR 0031 §8.1 (ANALYTICS-DISPLAY-FLOOR).
describe('the floors are the ADR numbers, and the display floor IS the number customers already meet', () => {
  it('display 5 = OUTCOME_PROVISIONAL_N = OUTCOME_RETRO_MIN_N; compare 10; hook_type 10; Wilson 10; IQR from 10', () => {
    expect(ANALYTICS_DISPLAY_FLOOR).toBe(5)
    expect(ANALYTICS_DISPLAY_FLOOR).toBe(OUTCOME_PROVISIONAL_N)
    expect(ANALYTICS_DISPLAY_FLOOR).toBe(OUTCOME_RETRO_MIN_N)
    expect(ANALYTICS_COMPARE_FLOOR).toBe(10)
    expect(ANALYTICS_HOOK_TYPE_FLOOR).toBe(10)
    expect(ANALYTICS_WILSON_FLOOR).toBe(10)
    expect(ANALYTICS_RANGE_IQR_FROM).toBe(10)
  })
})

describe('displayState: a number needs 5', () => {
  it.each([
    [0, 'thin'],
    [4, 'thin'],
    [5, 'number'],
    [6, 'number'],
    [100, 'number'],
  ] as const)('n = %s is %s', (n, state) => {
    expect(displayState(n)).toBe(state)
  })

  it('a negative or fractional n THROWS (a count is a non-negative integer)', () => {
    expect(() => displayState(-1)).toThrow(/count/)
    expect(() => displayState(4.5)).toThrow(/count/)
  })
})

describe('compareState: two sides compare as bars only when BOTH have 10', () => {
  it('9 vs 9 is counts only', () => expect(compareState(9, 9)).toBe('counts'))
  it('10 vs 10 is bars', () => expect(compareState(10, 10)).toBe('bars'))
  it('10 vs 9 is counts only (one thin side makes the pair thin)', () => {
    expect(compareState(10, 9)).toBe('counts')
    expect(compareState(9, 10)).toBe('counts')
  })
  it('12 vs 30 is bars', () => expect(compareState(12, 30)).toBe('bars'))
})

describe('monthPairAllowed: the month-against-month pair is suppressed unless BOTH sides reach 5', () => {
  it('January (4) against February (5) is suppressed; February (5) against March (7) is shown', () => {
    expect(monthPairAllowed(4, 5)).toBe(false)
    expect(monthPairAllowed(5, 4)).toBe(false)
    expect(monthPairAllowed(5, 7)).toBe(true)
  })
  it('a pair does NOT need 10 per side: side-by-side text is allowed from 5', () => {
    expect(monthPairAllowed(5, 5)).toBe(true)
  })
})
