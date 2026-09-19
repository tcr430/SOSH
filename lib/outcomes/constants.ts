// ADR 0026 — the outcome loop's numbers. Every constant here is a TRANSCRIPTION of
// the ADR, cited by section, and lib/outcomes/__tests__/constants.test.ts parses
// ADR 0026 §6.4's block and fails if this file drifts from it. Statistical
// constants are CODE, never env (ADR 0026 §14): a threshold an operator can tune
// per environment is a threshold that silently differs between staging and prod.
//
// SQL TWINS. The promotion floor lives in SQL and never trusts a caller (ADR 0026
// §5.4; build-guide rule 2), so each constant that an RPC also encodes has a
// twin in that RPC's migration, documented beside it (the accepted ADR 0018
// duplicate-constant trade-off). TS reads these for the UI ("n of 10 posts so
// far"), for the extractor's own cheap pre-filters, and for tests; it never
// re-implements the gate. This file imports NOTHING — in particular nothing from
// lib/ai (OUTCOME-DETERMINISTIC-NO-LLM) and nothing from lib/learning (ADR 0018
// is untouched; OUTCOME_PATTERN_TTL_DAYS is re-declared, not imported, §6.4).

// ─── §6.4 — the promotion floor, confidence, decay, contradiction ────────────

// §6.4 "k": minimum matured observations in a cell before a pattern may promote.
// Chosen so that at the floor a pattern needs 9 wins of 10: the floor and the
// Wilson interval bind together and neither is dead code.
export const OUTCOME_MIN_N = 10

// §6.4: correlated posts within one campaign are the reason for this gate. At
// the floor it still averages ~3 posts per campaign (borderline independence).
export const OUTCOME_MIN_DISTINCT_CAMPAIGNS = 3

// §6.4: Wilson interval z. Above-usual promotes on wilson_low > 0.5, below-usual
// on wilson_high < 0.5. SQL twin: public.wilson_bounds (the ONE copy, §5.4).
export const OUTCOME_WILSON_Z = 1.96

// §6.4: at n >= 5 a status='candidate' row is upserted (the UI's provisional
// state). It can never reach generation: isEligible requires status='active'.
export const OUTCOME_PROVISIONAL_N = 5

// §6.4: stored confidence = wilson_bound * n / (n + K). ~0.30 at the floor,
// deliberately modest (a Wilson bound on ten correlated posts is not the same
// kind of number as a distilled confidence).
export const OUTCOME_CONFIDENCE_SHRINK_K = 10

// §6.4 / §7.1: every recompute reads only outcomes published in this window, so
// old evidence ages out mechanically and confidence cannot accumulate forever.
export const OUTCOME_WINDOW_DAYS = 180

// §6.4 / §7.2: expires_at = newest agreeing observation + this. ADR 0018's
// constant, RE-DECLARED here (lib/learning is not imported).
export const OUTCOME_PATTERN_TTL_DAYS = 90

// §6.4 / §7.3: the fast contradiction trigger — at least MIN of the cell's LAST
// `LAST` observations (by published_at) go against the pattern's direction.
export const OUTCOME_FAST_CONTRA_LAST = 5
export const OUTCOME_FAST_CONTRA_MIN = 4

// §6.4 / §6.4 "How n reaches the prompt": outcome rows are capped among outcome
// rows only. They never enter the shared ranking (PERFORMANCE_CAP is separate).
export const OUTCOME_CAP = 3

// §6.4 / §6.1: an outcome is frozen once, from the day-7 sync; a post whose day-7
// sync never arrives within the grace gets NO row (skippedNoMetrics), never a guess.
export const OUTCOME_MATURITY_DAYS = 7
export const OUTCOME_MATURITY_GRACE_DAYS = 2

// ─── §4.2 — the dimension taxonomy ────────────────────────────────────────────

// §4.2: stamped on every post_dimensions row. Bump only with an ADR amendment.
export const OUTCOME_TAXONOMY_VERSION = 1

// §4.1: five dimensions may become promoted patterns. NAMING NOTE: §4.1 calls the
// call-to-action dimension `cta_present` (the post_dimensions/post_outcomes
// column); §5.1 widens performance_memory.dimension with `'cta'`. J2.5 owns that
// mapping; this set is §4.1's vocabulary.
export const OUTCOME_PROMOTABLE_DIMENSIONS = [
  'role',
  'format',
  'length_band',
  'cta_present',
  'origin_mode',
] as const

// §4.1: collected and shown, NEVER promoted. hook_type is the model's own
// self-report about its opening (un-defer: Cohen's kappa >= 0.6 on >= 30 sampled
// posts); proof_type is confounded with campaign identity (un-defer: per-post
// evidence citation in the output schema, Session 34).
export const OUTCOME_DESCRIPTIVE_ONLY_DIMENSIONS = ['hook_type', 'proof_type'] as const

export type OutcomePromotableDimension = (typeof OUTCOME_PROMOTABLE_DIMENSIONS)[number]
export type OutcomeDescriptiveOnlyDimension = (typeof OUTCOME_DESCRIPTIVE_ONLY_DIMENSIONS)[number]

// ─── §4.4 — measured length bands ─────────────────────────────────────────────

// §4.4: measured ONCE from the immutable published posts.content. short is
// strictly BELOW `shortBelow`; long is strictly ABOVE `longAbove`; medium is the
// inclusive range between (X single: 100–220; X thread: 4–6; LinkedIn: 600–1,300).
// Keyed by the Platform value the rest of the codebase uses ('twitter', not 'x').
export const OUTCOME_LENGTH_BANDS = {
  twitter_single: { unit: 'chars', shortBelow: 100, longAbove: 220 },
  twitter_thread: { unit: 'segments', shortBelow: 4, longAbove: 6 },
  linkedin: { unit: 'chars', shortBelow: 600, longAbove: 1300 },
} as const

// ─── §6.3 — the baseline ──────────────────────────────────────────────────────

// §6.3: a brand's own baseline needs at least this many matured outcomes.
export const OUTCOME_BASELINE_MIN = 8

// §6.3: X — median of the brand's own matured X outcomes in the 90 days before
// the post, excluding the post itself.
export const OUTCOME_X_BASELINE_DAYS = 90

// §6.3: LinkedIn — median of the brand's last 20 matured outcomes (a COUNT
// window, so audience-growth drift is chased faster; §6.2 discloses the bias).
export const OUTCOME_LINKEDIN_BASELINE_LAST = 20

// §6.3: log_lift = ln(value / baseline), clipped to [-CLIP, CLIP]. Descriptive:
// the gate uses beat_baseline, never lift magnitude.
export const OUTCOME_LOG_LIFT_CLIP = 3

// §6.3: the baseline floor for the COUNT basis (near-zero instability).
export const OUTCOME_LOG_LIFT_COUNT_FLOOR = 1

// ─── §8 — the retrospective ───────────────────────────────────────────────────

// §8.2: a verdict needs at least this many measured posts, else 'inconclusive'.
export const OUTCOME_RETRO_MIN_N = 5

// §8.4: an acknowledged hypothesis result's memory row expires after this. It is
// a dated record of ONE test, retrieved only by Stage A brief generation.
export const OUTCOME_HYPOTHESIS_TTL_DAYS = 365
