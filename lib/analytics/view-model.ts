import { winShareBreakdown, type Breakdown } from './breakdowns'
import { LIVE_ONLY_BREAKDOWN_DIMENSIONS, REPORT_BREAKDOWN_DIMENSIONS, type BreakdownDimension } from './constants'
import { countExclusions, type ExclusionCounts } from './exclusions'
import { displayState, monthPairAllowed } from './floors'
import { monthOf } from './period'
import { formatPercent, formatRate, typicalOf } from './rates'
import type { AnalyticsPostRecord, MetricBasis } from './types'
import { winsOf, type WinsResult } from './wins'

// ADR 0031 §8.4, §10 — the view models the surface, the report and the email all read. They carry template KEYS and
// PARAMS, never sentences (the closed copy lives in the three locale files and is linted there), pre-formatted rate
// tokens, and nothing else:
//
//   * NO log_lift: the input type has no such field, and no key here names one.
//   * NO delta, arrow, colour or percentage change on a month pair: two months sit side by side, each with its own n.
//   * NO series of win share: win share is a per-period description (the median rate carries the trend).
//   * A figure below the display floor is the THIN state and carries only its n: the number it would have shown is
//     computed nowhere in that branch.

const THIN_KEY = 'analytics.state.thin'

export type TypicalView =
  | { state: 'thin'; key: typeof THIN_KEY; params: { n: number } }
  | {
      state: 'number'
      key: 'analytics.typical'
      params: { n: number; rate: string; lo: string; hi: string; rangeKind: 'minmax' | 'iqr' }
    }

// formatRate returns null only for a null input, which a median of finite values never is.
function token(rate: number): string {
  const text = formatRate(rate)
  if (text === null) throw new Error('analytics view-model: a rate token cannot be null here')
  return text
}

export function typicalView(values: readonly number[]): TypicalView {
  const n = values.length
  if (displayState(n) === 'thin') return { state: 'thin', key: THIN_KEY, params: { n } }
  const t = typicalOf(values)
  return {
    state: 'number',
    key: 'analytics.typical',
    params: { n, rate: token(t.median), lo: token(t.range.lo), hi: token(t.range.hi), rangeKind: t.range.kind },
  }
}

export interface MonthSide {
  period: string
  typical: TypicalView
}

/** Two months side by side. `pair` when both reach the display floor, `suppressed` otherwise. There is no delta field. */
export interface MonthPairView {
  state: 'pair' | 'suppressed'
  key: 'analytics.monthPair' | 'analytics.monthPairSuppressed'
  sides: [MonthSide, MonthSide]
}

export function monthPairView(
  a: { period: string; values: readonly number[] },
  b: { period: string; values: readonly number[] },
): MonthPairView {
  const allowed = monthPairAllowed(a.values.length, b.values.length)
  return {
    state: allowed ? 'pair' : 'suppressed',
    key: allowed ? 'analytics.monthPair' : 'analytics.monthPairSuppressed',
    sides: [
      { period: a.period, typical: typicalView(a.values) },
      { period: b.period, typical: typicalView(b.values) },
    ],
  }
}

export type WinsView =
  | { state: 'thin'; key: typeof THIN_KEY; params: { n: number } }
  | { state: 'number'; key: 'analytics.wins'; params: { wins: number; n: number }; disclosureKeys: string[] }

export function winsView(w: WinsResult): WinsView {
  if (displayState(w.of) === 'thin') return { state: 'thin', key: THIN_KEY, params: { n: w.of } }
  return {
    state: 'number',
    key: 'analytics.wins',
    params: { wins: w.wins, n: w.of },
    // "Usual" is defined beside every win count, with the sentence that says it is not a measure of progress.
    disclosureKeys: [
      'analytics.disclosure.usual',
      'analytics.disclosure.usualUpdates',
      ...(w.importSeed > 0 ? ['analytics.disclosure.importSeed'] : []),
    ],
  }
}

export interface ExclusionsView {
  key: 'analytics.exclusions.summary'
  params: { measured: number; published: number; notIncluded: number }
  /** In the ADR's sentence order; a zero count is omitted. */
  reasons: Array<{ key: string; count: number }>
}

export function exclusionsView(c: ExclusionCounts): ExclusionsView {
  const reasons = [
    { key: 'analytics.exclusions.noDataReturned', count: c.noDataReturned },
    { key: 'analytics.exclusions.fieldMissing', count: c.fieldMissing },
    { key: 'analytics.exclusions.zeroImpressions', count: c.zeroImpressions },
    { key: 'analytics.exclusions.notFinal', count: c.notFinal },
  ].filter((r) => r.count > 0)
  return {
    key: 'analytics.exclusions.summary',
    params: { measured: c.measured, published: c.published, notIncluded: c.published - c.measured },
    reasons,
  }
}

export interface BreakdownView {
  dimension: BreakdownDimension
  /** The title carries the population tag. */
  populationKey: 'analytics.population.aiOnly' | 'analytics.population.allMeasured'
  coverage: { key: 'analytics.coverage'; params: { k: number; n: number } }
  presentation: 'counts' | 'bars'
  rows: Array<{
    value: string
    key: 'analytics.breakdown.row'
    params: { wins: number; n: number }
    provisional: boolean
    interval: { key: 'analytics.interval'; params: { lo: string; hi: string } } | null
    /** wins / n, for the bar's length. The text carries the same figures as k of n. */
    share: number
    /** The Wilson interval's bounds, for the whisker; null below the compare floor. */
    bar: { lo: number; hi: number } | null
  }>
}

export function breakdownView(b: Breakdown): BreakdownView {
  return {
    dimension: b.dimension,
    populationKey: b.population === 'ai_only' ? 'analytics.population.aiOnly' : 'analytics.population.allMeasured',
    coverage: { key: 'analytics.coverage', params: { k: b.coverage.k, n: b.coverage.n } },
    presentation: b.presentation,
    rows: b.values.map((v) => ({
      value: v.value,
      key: 'analytics.breakdown.row',
      params: { wins: v.wins, n: v.of },
      provisional: v.provisional,
      interval: v.interval
        ? { key: 'analytics.interval', params: { lo: formatPercent(v.interval.lo), hi: formatPercent(v.interval.hi) } }
        : null,
      share: v.wins / v.of,
      bar: v.interval,
    })),
  }
}

export interface PlatformMonthInput {
  platform: string
  /** `YYYY-MM`, in the business timezone. */
  period: string
  timezone: string
  /** The clock, injected: this module never reads one. */
  now: string
  /** Published, non-deleted posts of ONE business (the reader's job to bound and scope). Other platforms and months are filtered here. */
  records: readonly AnalyticsPostRecord[]
  /** The live Pro page adds `hook_type`; the report never does. */
  includeLiveOnly?: boolean
}

export interface PlatformMonthView {
  platform: string
  period: string
  /** The metric basis of the measured posts, or null when none is measured. */
  basis: MetricBasis | null
  /** A typical RATE: null for a count basis (a count is never described as a rate). */
  typical: TypicalView | null
  wins: WinsView
  exclusions: ExclusionsView
  breakdowns: BreakdownView[]
}

/** One platform, one month, one business: the single composition the surface and the report both read. */
export function platformMonthView(input: PlatformMonthInput): PlatformMonthView {
  const inPeriod = input.records.filter((r) => r.post.platform === input.platform && monthOf(r.post.publishedAt, input.timezone) === input.period)
  const outcomes = inPeriod.flatMap((r) => (r.outcome ? [r.outcome] : []))

  const bases = new Set(outcomes.map((o) => o.basis))
  if (bases.size > 1) throw new Error(`analytics view-model: mixed basis on ${input.platform}; a count is never a rate`)
  const basis = outcomes.length === 0 ? null : outcomes[0].basis

  const dimensions: readonly BreakdownDimension[] = [
    ...REPORT_BREAKDOWN_DIMENSIONS,
    ...(input.includeLiveOnly ? LIVE_ONLY_BREAKDOWN_DIMENSIONS : []),
  ]

  return {
    platform: input.platform,
    period: input.period,
    basis,
    typical: basis === 'count' ? null : typicalView(outcomes.map((o) => o.value)),
    wins: winsView(winsOf(outcomes)),
    exclusions: exclusionsView(countExclusions(inPeriod, input.now)),
    breakdowns: dimensions.map((d) => breakdownView(winShareBreakdown(d, outcomes))),
  }
}
