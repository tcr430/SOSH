import type { MetricBasis, OutcomeMetrics } from '@/lib/outcomes/normalise'

// Session 37 / ADR 0031 — the shapes the PURE aggregation takes. A reader (O2.4) maps database rows into these;
// nothing here knows about Supabase, a client, a business id or the clock.
//
// There is deliberately NO lift field. `post_outcomes.log_lift` is descriptive only and is rendered nowhere
// (ADR 0031 §2.4, ADR 0026 §10.3), so it is not in the input type, and a reader that selected it could not pass it
// through (ANALYTICS-NO-LOG-LIFT).

export type { MetricBasis }

export type LengthBand = 'short' | 'medium' | 'long'

/** The generator's own classification of an AI-written post (`post_dimensions`). Absent for a post written elsewhere. */
export interface PostDimensions {
  role: string
  format: string
  /** A property of the CAMPAIGN, copied onto the post's dimensions by the tagging trigger. */
  originMode: string
  hookType: string | null
}

/** One measured post: a `post_outcomes` row, written once at day 7. */
export interface AnalyticsOutcome {
  postId: string
  platform: string
  basis: MetricBasis
  /** A rate (X) or an engagement count (LinkedIn). Never compared across `basis`. */
  value: number
  publishedAt: string
  /** NULL means "no baseline yet": not a loss, and not counted in any win total. */
  beatBaseline: boolean | null
  baselineSource: 'own' | 'import_seed' | null
  /** Nullable in the table: a null is UNCLASSIFIED (counted in coverage's n, never in a bucket). */
  lengthBand: LengthBand | null
  ctaPresent: boolean | null
  hookSurvived: boolean | null
  dimensions: PostDimensions | null
}

export interface AnalyticsPost {
  postId: string
  platform: string
  publishedAt: string
}

/** One published, non-deleted post with whatever the measurement layer holds for it. */
export interface AnalyticsPostRecord {
  post: AnalyticsPost
  /** The `post_metrics` row, or null when no row exists. */
  metrics: OutcomeMetrics | null
  /** The `post_outcomes` row, or null when the extractor wrote none. */
  outcome: AnalyticsOutcome | null
}
