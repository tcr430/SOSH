// ADR 0018 §4.2 — named ADR constants, not scattered magic numbers (L-4),
// mirroring lib/memory/constants.ts's convention.

// length_delta only fires past this threshold — a 2% trim is noise, not a
// preference signal worth counting toward a promotion decision.
export const LEARN_LENGTH_DELTA_MIN_PCT = 0.15

// ADR 0018 §6.2/§6.4 — the Tier-1 batch summarizer's cadence, ceilings, and
// output bound. The cadence is a FLOOR, not a schedule: both gates must
// hold, so this is at most weekly per business, and frequently never.
export const LEARNING_SUMMARY_MIN_SIGNALS = 20
export const LEARNING_SUMMARY_MIN_INTERVAL_DAYS = 7
export const LEARNING_SUMMARY_MAX_INPUT_TOKENS = 12000
export const LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS = 8
export const LEARNING_SUMMARY_MAX_STATEMENTS = 5
export const LEARNING_SUMMARY_MAX_STATEMENT_CHARS = 200

// The prompt.id used everywhere this call must be identified: ai_usage
// rows (cadence + monthly ceiling, both counted FROM this table), and the
// runner's per-prompt routing.
export const LEARNING_SUMMARIZER_PROMPT_ID = 'learning-summarizer'
