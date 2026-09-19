import { parseISO, subDays } from 'date-fns'
import {
  OUTCOME_BASELINE_MIN,
  OUTCOME_LINKEDIN_BASELINE_LAST,
  OUTCOME_LOG_LIFT_CLIP,
  OUTCOME_LOG_LIFT_COUNT_FLOOR,
  OUTCOME_X_BASELINE_DAYS,
} from './constants'

// ADR 0026 §6.2, §6.3 — the deterministic normaliser. PURE: no I/O, no model call, no clock. It turns one
// matured post's day-7 metrics into the columns of a post_outcomes row.
//
//   * NULL IS NEVER ZERO (build-guide rule 6). A permanently-unavailable field (X reach; LinkedIn saves,
//     clicks, reach, impressions) is never read. An ELIGIBLE field that is null at day 7 EXCLUDES the post
//     with a typed reason — it is never coalesced to 0. An X post with impressions = 0 is excluded
//     (the rate is undefined).
//   * OWN BASELINE (L-3). Each brand is compared with its own per-platform history; pooling across brands
//     never happens here.
//   * The GATE uses beat_baseline (a win/loss, robust at small n); log_lift is descriptive only.

export type OutcomePlatform = 'twitter' | 'linkedin'
export type MetricBasis = 'rate' | 'count'

// Callers may pass a full PostMetrics row; ONLY these four fields are ever read (reach, saves and clicks
// never enter the metric — ADR 0026 §6.2 — and LinkedIn's impressions are never read either).
export interface OutcomeMetrics {
  likes?: number | null
  comments?: number | null
  shares?: number | null
  impressions?: number | null
  [other: string]: unknown
}

export type EligibleField = 'likes' | 'comments' | 'shares' | 'impressions'

export type EligibleResult =
  | { ok: true; basis: MetricBasis; value: number }
  | { ok: false; reason: 'unsupported_platform' }
  | { ok: false; reason: 'null_field'; field: EligibleField }
  | { ok: false; reason: 'zero_impressions' }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

// X -> rate = (likes + comments + shares) / impressions. LinkedIn -> count = likes + comments + shares.
export function eligibleValue(platform: string, metrics: OutcomeMetrics): EligibleResult {
  if (platform !== 'twitter' && platform !== 'linkedin') return { ok: false, reason: 'unsupported_platform' }

  const fields: EligibleField[] = platform === 'twitter' ? ['likes', 'comments', 'shares', 'impressions'] : ['likes', 'comments', 'shares']
  for (const field of fields) {
    if (!isCount(metrics[field])) return { ok: false, reason: 'null_field', field }
  }

  const engagement = (metrics.likes as number) + (metrics.comments as number) + (metrics.shares as number)
  if (platform === 'linkedin') return { ok: true, basis: 'count', value: engagement }

  const impressions = metrics.impressions as number
  if (impressions === 0) return { ok: false, reason: 'zero_impressions' }
  return { ok: true, basis: 'rate', value: engagement / impressions }
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export interface PriorOutcome {
  postId: string
  publishedAt: string
  value: number
  basis: MetricBasis
}

// The imported X engagement baseline (ADR 0026 §6.3, ruling A-4). The CALLER maps social_backfill_runs.summary's
// vocabulary ('impressions' -> 'rate', 'raw' -> 'count', 'none' -> no seed); the basis is then ENFORCED HERE at
// read time, never assumed (OUTCOME-SEED-BASIS-MATCH).
export interface BaselineSeed {
  value: number
  basis: MetricBasis
}

export interface BaselineResult {
  baseline: number
  // null for an import seed (its own sample size is not recorded).
  baselineN: number | null
  source: 'own' | 'import_seed'
}

export interface BaselineInput {
  platform: OutcomePlatform
  basis: MetricBasis
  postId: string
  publishedAt: string
  prior: readonly PriorOutcome[]
  seed: BaselineSeed | null
}

function ms(iso: string): number {
  const t = parseISO(iso).getTime()
  if (!Number.isFinite(t)) throw new Error(`normalise: non-finite timestamp ${JSON.stringify(iso)}`)
  return t
}

export function baseline(input: BaselineInput): BaselineResult | null {
  const at = ms(input.publishedAt)
  // The post is excluded from its own baseline (by id AND by being strictly earlier), and only outcomes of
  // the SAME basis are comparable.
  const earlier = input.prior
    .filter((p) => p.postId !== input.postId && p.basis === input.basis && ms(p.publishedAt) < at)
    .sort((a, b) => ms(b.publishedAt) - ms(a.publishedAt))

  const own =
    input.platform === 'twitter'
      ? earlier.filter((p) => ms(p.publishedAt) >= subDays(at, OUTCOME_X_BASELINE_DAYS).getTime())
      : earlier.slice(0, OUTCOME_LINKEDIN_BASELINE_LAST)

  if (own.length >= OUTCOME_BASELINE_MIN) {
    return { baseline: median(own.map((p) => p.value)), baselineN: own.length, source: 'own' }
  }

  // The seed is X-only, and only when it is a RATE compared with a rate.
  if (
    input.platform === 'twitter' &&
    input.basis === 'rate' &&
    input.seed !== null &&
    input.seed.basis === 'rate' &&
    Number.isFinite(input.seed.value) &&
    input.seed.value > 0
  ) {
    return { baseline: input.seed.value, baselineN: null, source: 'import_seed' }
  }
  return null
}

// log_lift = ln(value / baseline), clipped to [-CLIP, CLIP]; the baseline is floored at 1 for the COUNT basis
// (near-zero instability). beat_baseline compares against the RAW baseline. A rate baseline of 0 leaves the
// log undefined (null) while the win/loss is still defined.
export function liftAgainst(value: number, baselineValue: number, basis: MetricBasis): { logLift: number | null; beat: boolean } {
  const beat = value > baselineValue
  const floored = basis === 'count' ? Math.max(baselineValue, OUTCOME_LOG_LIFT_COUNT_FLOOR) : baselineValue
  if (!(floored > 0)) return { logLift: null, beat }
  const ratio = value / floored
  const raw = ratio <= 0 ? -Infinity : Math.log(ratio)
  return { logLift: Math.min(OUTCOME_LOG_LIFT_CLIP, Math.max(-OUTCOME_LOG_LIFT_CLIP, raw)), beat }
}

export type NormalisedOutcome =
  | { kind: 'excluded'; reason: Exclude<EligibleResult, { ok: true }> }
  | {
      kind: 'measured'
      basis: MetricBasis
      value: number
      // All NULL when there is no baseline: the row still records the measurement (skippedNoBaseline).
      baseline: number | null
      baselineN: number | null
      baselineSource: 'own' | 'import_seed' | null
      logLift: number | null
      beatBaseline: boolean | null
    }

export interface NormaliseInput {
  platform: string
  metrics: OutcomeMetrics
  postId: string
  publishedAt: string
  prior: readonly PriorOutcome[]
  seed: BaselineSeed | null
}

export function normaliseOutcome(input: NormaliseInput): NormalisedOutcome {
  const eligible = eligibleValue(input.platform, input.metrics)
  if (!eligible.ok) return { kind: 'excluded', reason: eligible }

  const base = baseline({
    platform: input.platform as OutcomePlatform,
    basis: eligible.basis,
    postId: input.postId,
    publishedAt: input.publishedAt,
    prior: input.prior,
    seed: input.seed,
  })
  if (base === null) {
    return { kind: 'measured', basis: eligible.basis, value: eligible.value, baseline: null, baselineN: null, baselineSource: null, logLift: null, beatBaseline: null }
  }
  const { logLift, beat } = liftAgainst(eligible.value, base.baseline, eligible.basis)
  return {
    kind: 'measured',
    basis: eligible.basis,
    value: eligible.value,
    baseline: base.baseline,
    baselineN: base.baselineN,
    baselineSource: base.source,
    logLift,
    beatBaseline: beat,
  }
}
