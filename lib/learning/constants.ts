// ADR 0018 §4.2 — named ADR constants, not scattered magic numbers (L-4),
// mirroring lib/memory/constants.ts's convention.

// length_delta only fires past this threshold — a 2% trim is noise, not a
// preference signal worth counting toward a promotion decision.
export const LEARN_LENGTH_DELTA_MIN_PCT = 0.15
