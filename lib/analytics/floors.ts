import { ANALYTICS_COMPARE_FLOOR, ANALYTICS_DISPLAY_FLOOR } from './constants'

// ADR 0031 §8.1 — what a count of measured posts is allowed to show. Counts are non-negative integers; anything else
// is a bug upstream and throws rather than quietly rendering a state.

function assertCount(n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`analytics floors: a count is a non-negative integer, got ${n}`)
}

/** `thin` below the display floor (5): the one thin state, no mark drawn. Otherwise a number may be shown. */
export function displayState(n: number): 'thin' | 'number' {
  assertCount(n)
  return n >= ANALYTICS_DISPLAY_FLOOR ? 'number' : 'thin'
}

/** Two sides render as bars only when EACH has the compare floor (10). One thin side makes the pair counts only. */
export function compareState(a: number, b: number): 'counts' | 'bars' {
  assertCount(a)
  assertCount(b)
  return a >= ANALYTICS_COMPARE_FLOOR && b >= ANALYTICS_COMPARE_FLOOR ? 'bars' : 'counts'
}

/** The month-against-month pair is suppressed unless BOTH months reach the display floor ([mle-1]). */
export function monthPairAllowed(a: number, b: number): boolean {
  return displayState(a) === 'number' && displayState(b) === 'number'
}
