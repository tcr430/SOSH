import {
  OUTCOME_MATURITY_DAYS,
  OUTCOME_MATURITY_GRACE_DAYS,
  OUTCOME_PROVISIONAL_N,
  OUTCOME_WILSON_Z,
} from '@/lib/outcomes/constants'

// ADR 0031 §8.1 — the floors. Display describes; promotion (ADR 0026) learns. They are different numbers on
// purpose and this module does not touch ADR 0026's.

/** Show a number (a median, a range, a "k of n") from this many measured posts. The number customers already meet on the campaign page. */
export const ANALYTICS_DISPLAY_FLOOR = OUTCOME_PROVISIONAL_N
/** Compare two values (a bar, an account against an account) only when EACH side has this many. Below it: counts, labelled provisional. */
export const ANALYTICS_COMPARE_FLOOR = 10
/** A `hook_type` value is shown on the live Pro page from this many posts. */
export const ANALYTICS_HOOK_TYPE_FLOOR = 10
/** A Wilson interval appears from this many posts. */
export const ANALYTICS_WILSON_FLOOR = 10
/** The range is min-max below this many posts and the interquartile range from it. */
export const ANALYTICS_RANGE_IQR_FROM = 10

export const ANALYTICS_WILSON_Z = OUTCOME_WILSON_Z

/** A post with no outcome row is "not final yet" until it is older than maturity plus grace: day 9 (ADR 0031 §2.5). */
export const ANALYTICS_FINAL_AFTER_DAYS = OUTCOME_MATURITY_DAYS + OUTCOME_MATURITY_GRACE_DAYS

/** The breakdowns the monthly report carries. `hook_type` is NOT one of them ([mle-6]). */
export const REPORT_BREAKDOWN_DIMENSIONS = ['role', 'format', 'origin_mode', 'length_band', 'cta_present'] as const
/** Breakdowns only the live Pro page shows. */
export const LIVE_ONLY_BREAKDOWN_DIMENSIONS = ['hook_type'] as const

export type BreakdownDimension = (typeof REPORT_BREAKDOWN_DIMENSIONS)[number] | (typeof LIVE_ONLY_BREAKDOWN_DIMENSIONS)[number]
