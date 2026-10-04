import { median } from '@/lib/outcomes/normalise'
import { ANALYTICS_RANGE_IQR_FROM, ANALYTICS_WILSON_Z } from './constants'
import type { AnalyticsOutcome, MetricBasis } from './types'

// ADR 0031 §2.3 — the X headline is the MEDIAN of per-post engagement rates, "typical post", always with its n and
// its range. Pure: no I/O, no clock.
//
//   * The median is the one ADR 0026 already uses for the baseline (`median` from lib/outcomes/normalise): the same
//     function, not a second implementation.
//   * Not the mean (a few posts with tiny impressions and extreme rates would dominate it) and not a ratio of sums
//     (a different question; two "overall rates" that disagree read as an error). Ratio of sums is S37-RATIO-OF-SUMS.
//   * NOTHING here crosses `metric_basis`. A count (LinkedIn) is never a rate (X), so every aggregate is keyed by
//     platform AND basis, and there is no function that sums, averages or medians across both.

export interface RateRange {
  /** `minmax` below ANALYTICS_RANGE_IQR_FROM posts, `iqr` from it. */
  kind: 'minmax' | 'iqr'
  lo: number
  hi: number
}

export interface Typical {
  n: number
  median: number
  range: RateRange
}

function assertValues(values: readonly number[]): void {
  if (values.length === 0) throw new Error('analytics rates: empty list (apply the display floor before asking for a median)')
  for (const v of values) {
    if (!Number.isFinite(v)) throw new Error(`analytics rates: non-finite value ${v}`)
  }
}

// Linear interpolation between order statistics (the "R-7" quantile): the interquartile range of 1..10 is 3.25-7.75.
function quantile(sorted: readonly number[], p: number): number {
  const pos = (sorted.length - 1) * p
  const below = Math.floor(pos)
  const above = Math.ceil(pos)
  return sorted[below] + (sorted[above] - sorted[below]) * (pos - below)
}

export function rangeOf(values: readonly number[]): RateRange {
  assertValues(values)
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length < ANALYTICS_RANGE_IQR_FROM) return { kind: 'minmax', lo: sorted[0], hi: sorted[sorted.length - 1] }
  return { kind: 'iqr', lo: quantile(sorted, 0.25), hi: quantile(sorted, 0.75) }
}

export function typicalOf(values: readonly number[]): Typical {
  assertValues(values)
  return { n: values.length, median: median(values), range: rangeOf(values) }
}

/**
 * One decimal, two below 1%. A measured 0 is a real value ("0.0%"). NULL is NO NUMBER (null): it is never rendered
 * as 0.0% ([mle-10]). A non-finite or negative rate is a bug upstream and throws.
 */
export function formatRate(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value) || value < 0) throw new Error(`analytics rates: invalid rate ${value}`)
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)}%`
}

/** A share as a whole percent, for the plain-language interval ("likely between 25% and 80%"). */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) throw new Error(`analytics rates: invalid share ${fraction}`)
  return `${Math.round(fraction * 100)}%`
}

/** The Wilson score interval for `wins` of `n`, at the z ADR 0026 uses. Shown only from ANALYTICS_WILSON_FLOOR. */
export function wilsonInterval(wins: number, n: number): { lo: number; hi: number } {
  if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(wins) || wins < 0 || wins > n) {
    throw new Error(`analytics rates: wilson needs 0 <= wins <= n and n > 0, got ${wins} of ${n}`)
  }
  const z2 = ANALYTICS_WILSON_Z * ANALYTICS_WILSON_Z
  const p = wins / n
  const denominator = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denominator
  const half = (ANALYTICS_WILSON_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

/** Throws when a set spans more than one platform or more than one metric basis: the guard under every win and breakdown count. */
export function assertOneBasis(outcomes: readonly Pick<AnalyticsOutcome, 'platform' | 'basis'>[], what: string): void {
  const platforms = new Set(outcomes.map((o) => o.platform))
  if (platforms.size > 1) {
    throw new Error(`analytics ${what}: mixed platforms (${[...platforms].sort().join(', ')}); a figure is never pooled across them`)
  }
  const bases = new Set(outcomes.map((o) => o.basis))
  if (bases.size > 1) throw new Error(`analytics ${what}: mixed basis (${[...bases].sort().join(', ')}); a count is never a rate`)
}

export interface PlatformAggregate extends Typical {
  platform: string
  basis: MetricBasis
}

/** One result per (platform, basis). An X rate set and a LinkedIn count set give two results, never one. */
export function aggregateByPlatform(outcomes: readonly AnalyticsOutcome[]): PlatformAggregate[] {
  const groups = new Map<string, { platform: string; basis: MetricBasis; values: number[] }>()
  for (const o of outcomes) {
    const key = `${o.platform}\u0000${o.basis}`
    const group = groups.get(key) ?? { platform: o.platform, basis: o.basis, values: [] }
    group.values.push(o.value)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => (a.platform === b.platform ? a.basis.localeCompare(b.basis) : a.platform.localeCompare(b.platform)))
    .map((g) => ({ platform: g.platform, basis: g.basis, ...typicalOf(g.values) }))
}
