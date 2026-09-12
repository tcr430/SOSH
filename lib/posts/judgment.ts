import type { PostAiOriginalRow } from '@/lib/db/types'

// ADR 0024 §8.3 (Session 31, H2.12) — the four states a generated post can be
// in, derived from H2.7's write path (post_ai_originals.cleared_quality_
// threshold). `null` means no original row at all (manual/legacy origin) —
// nothing to render, not a fourth "unknown" state.
export type PostJudgment =
  | { state: 'judged-and-passed'; overall: number; candidateCount: number; dimensionScores: NonNullable<PostAiOriginalRow['dimension_scores']> }
  | { state: 'all-below-threshold'; overall: number; candidateCount: number; dimensionScores: NonNullable<PostAiOriginalRow['dimension_scores']> }
  | { state: 'judging-failed' }
  | null

// cleared_quality_threshold is the single write-once source of truth
// (§8.2): true/false only ever set alongside a real overall_score (H2.7's
// SCORED outcome); null covers BOTH the §2.3 UNSCORED outcome and every
// pre-H2.4 row (schema_version 1, written before this contract existed) —
// both are honestly "not scored", never a passing badge in disguise (§8.3).
export function resolvePostJudgment(original: PostAiOriginalRow | undefined): PostJudgment {
  if (!original) return null
  if (original.cleared_quality_threshold === null) return { state: 'judging-failed' }
  if (original.dimension_scores === null) return { state: 'judging-failed' }

  const shared = {
    overall: original.overall_score ?? 0,
    candidateCount: original.candidate_count ?? 0,
    dimensionScores: original.dimension_scores,
  }
  return original.cleared_quality_threshold
    ? { state: 'judged-and-passed', ...shared }
    : { state: 'all-below-threshold', ...shared }
}

// ADR 0024 §8.4 (A-3) — the ONLY behavioural consequence of judgment: a
// below-threshold post requires individual approval. bulkApproveDraftPosts
// itself carries no quality predicate (§8.4) — this is enforced entirely by
// the CALLER never including an excluded id in the ids it sends.
export function isExcludedFromBulkApprove(original: PostAiOriginalRow | undefined): boolean {
  return original?.cleared_quality_threshold === false
}
