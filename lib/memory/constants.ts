// ADR 0016 §5.3-§5.4 — named ADR constants, not scattered magic numbers (L-4).

// Weights sum to 1.0. Confidence is weighted highest (it is the governance
// signal Track C's promotion threshold gates on); recency next (stale
// "facts" should fade); scope match least, since a brand-wide fact is
// already broadly relevant even without a tight context match (see
// scopeMatch in ./scoring.ts).
export const MEMORY_SCORE_WEIGHTS = {
  conf: 0.5,
  rec: 0.3,
  scope: 0.2,
} as const

// Hard output caps — applied AFTER scoring. Not the caller's choice past the
// ceiling (L-4). MEMORY_CANDIDATE_LIMIT (the DB-scan bound) lives in
// lib/db/memory-constants.ts — it bounds the input, these bound the output.
export const BRAND_CAP = 5
export const EVIDENCE_CAP = 5
export const AUDIENCE_CAP = 5
export const PERFORMANCE_CAP = 3
