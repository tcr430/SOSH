import { formatISO } from 'date-fns'
import type { SocialBackfillPostRow } from '@/lib/db/types'
import { recordBackfillRunSummary } from '@/lib/db/backfill-runs'

// ADR 0025 §4.1 step 2 (Session 32 I2.10) — cadence, weekday/hour
// distribution, format distribution, length distribution, and the
// engagement baseline. Written to the run row's summary jsonb ONLY —
// cadence and timing are NOT memory (no performance_memory dimension
// holds them, lib/db/types.ts:1192's PerformanceMemoryDimension union).
// NO model call anywhere in this file (ADR §4.1 step 2 is deterministic).

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export type EngagementBaselineBasis = 'impressions' | 'raw' | 'none'

export interface BackfillStatsSummary {
  totalPosts: number
  spanDays: number
  // MAJOR-12 (Session 32-D, D9) — the REAL date range the step-4 headline
  // (ADR §10.4 item 1) reads. Derived from the same earliest/latest
  // timestamps spanDays already computes, never a field nothing writes.
  dateRange: { start: string; end: string } | null
  weekdayDistribution: Record<string, number>
  hourDistribution: Record<string, number>
  formatDistribution: Record<string, number>
  lengthDistribution: { min: number; max: number; median: number; mean: number }
  engagementBaseline: number
  engagementBaselineBasis: EngagementBaselineBasis
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rawEngagement(metrics: Record<string, unknown>): number {
  return (numOrNull(metrics.likes) ?? 0) + (numOrNull(metrics.comments) ?? 0) + (numOrNull(metrics.shares) ?? 0)
}

// ADR §4.1 step 2 — "median of (likes+comments+shares)/impressions where
// impressions is non-null; otherwise median raw engagement." A RUN-WIDE
// decision, not a per-post one: if ANY staged post with metrics carries a
// non-null impressions count, the WHOLE baseline is computed on the
// impressions-normalised rate (over just the posts that have impressions);
// otherwise it falls back to raw engagement over every post with metrics.
// This is what makes `lift = engagement / baseline` (weighting.ts)
// comparable across every post in the run — a mixed-unit baseline would not be.
export function determineEngagementBasis(posts: readonly SocialBackfillPostRow[]): EngagementBaselineBasis {
  const withMetrics = posts.filter((p) => p.metrics !== null)
  if (withMetrics.length === 0) return 'none'
  const anyImpressions = withMetrics.some((p) => numOrNull((p.metrics as Record<string, unknown>).impressions) !== null)
  return anyImpressions ? 'impressions' : 'raw'
}

// The per-post engagement VALUE in whatever unit `basis` calls for — used
// both for the median (this file) and for each post's own lift numerator
// (weighting.ts), so the two can never drift into different units.
// Returns null when this specific post cannot be measured under `basis`
// (e.g. basis='impressions' but this post has no impressions, or has zero
// impressions — dividing by zero is refused, not silently Infinity).
export function postEngagementValue(post: SocialBackfillPostRow, basis: EngagementBaselineBasis): number | null {
  if (basis === 'none' || post.metrics === null) return null
  const metrics = post.metrics as Record<string, unknown>
  if (basis === 'raw') return rawEngagement(metrics)
  const impressions = numOrNull(metrics.impressions)
  if (impressions === null || impressions === 0) return null
  return rawEngagement(metrics) / impressions
}

export function computeEngagementBaseline(posts: readonly SocialBackfillPostRow[]): {
  baseline: number
  basis: EngagementBaselineBasis
} {
  const basis = determineEngagementBasis(posts)
  if (basis === 'none') return { baseline: 0, basis }
  const values: number[] = []
  for (const post of posts) {
    const value = postEngagementValue(post, basis)
    if (value !== null) values.push(value)
  }
  return { baseline: median(values), basis }
}

export function computeBackfillStats(posts: readonly SocialBackfillPostRow[]): BackfillStatsSummary {
  const weekdayDistribution: Record<string, number> = {}
  const hourDistribution: Record<string, number> = {}
  const formatDistribution: Record<string, number> = {}
  const lengths: number[] = []
  let earliestMs = Number.POSITIVE_INFINITY
  let latestMs = Number.NEGATIVE_INFINITY

  for (const post of posts) {
    const publishedAt = new Date(post.published_at)
    const weekday = WEEKDAYS[publishedAt.getUTCDay()]
    weekdayDistribution[weekday] = (weekdayDistribution[weekday] ?? 0) + 1
    const hour = String(publishedAt.getUTCHours())
    hourDistribution[hour] = (hourDistribution[hour] ?? 0) + 1
    formatDistribution[post.format] = (formatDistribution[post.format] ?? 0) + 1
    lengths.push(post.content.length)
    const t = publishedAt.getTime()
    if (t < earliestMs) earliestMs = t
    if (t > latestMs) latestMs = t
  }

  const spanDays = posts.length > 0 ? Math.max(1, Math.round((latestMs - earliestMs) / 86_400_000)) : 0
  const dateRange = posts.length > 0 ? { start: formatISO(new Date(earliestMs)), end: formatISO(new Date(latestMs)) } : null
  const { baseline, basis } = computeEngagementBaseline(posts)

  return {
    totalPosts: posts.length,
    spanDays,
    dateRange,
    weekdayDistribution,
    hourDistribution,
    formatDistribution,
    lengthDistribution: {
      min: lengths.length > 0 ? Math.min(...lengths) : 0,
      max: lengths.length > 0 ? Math.max(...lengths) : 0,
      median: median(lengths),
      mean: lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
    },
    engagementBaseline: baseline,
    engagementBaselineBasis: basis,
  }
}

// The write side — through lib/db/backfill-runs.ts, never a direct
// Supabase call from this file (CLAUDE.md's DB-access rule).
export async function writeBackfillStatsSummary(
  runId: string,
  summary: BackfillStatsSummary,
  weighting: 'weighted' | 'unweighted_no_metrics',
): Promise<void> {
  await recordBackfillRunSummary(runId, summary as unknown as Record<string, unknown>, weighting)
}
