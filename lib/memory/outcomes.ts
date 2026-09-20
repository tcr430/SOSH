import type { Platform } from '@/lib/db/types'
import { listOutcomePatternsForGeneration } from '@/lib/db/memory-performance'
import { OUTCOME_CAP } from '@/lib/outcomes/constants'
import { isEligible, rankAndCap } from './scoring'

// ADR 0026 §6.4 (Session 33 J2.9, OUTCOME-SEPARATE-RETRIEVAL) — outcome patterns are retrieved SEPARATELY from
// every other performance record. They NEVER compete in the shared ranking: listPerformanceMemoryCandidates
// excludes source = 'outcome', so a Wilson-derived, n-shrunk confidence is never compared with a distilled
// one (the cross-type calibration question is never asked of this data — ADR §15).
//
// Reads ONLY through listOutcomePatternsForGeneration (lib/db), like every lib/memory reader (MEM-NO-DIRECT-TABLE-ACCESS).

// What reaches a prompt: the closed-template sentence plus the counts the SQL floor computed. n and campaigns
// are ALWAYS present (OUTCOME-CONFIDENCE-RENDERED) — a pattern is an observation with its evidence, never a rule.
export type OutcomeObservation = {
  readonly platform: Platform | null
  readonly pattern: string
  readonly wins: number
  readonly n: number
  readonly campaigns: number
}

// ADR 0026 §8.4 / J2.10 — a brand's acknowledged hypothesis results. Read ONLY by Stage A (brief assembly), and
// ONLY here: retrieveOutcomePatterns above excludes 'hypothesis' rows, so a result about one campaign's claim
// never reaches a post prompt. The last three, newest first, each with the n the SQL wrote on the row.
export const HYPOTHESIS_RESULTS_LIMIT = 3

export async function retrieveHypothesisResults(businessId: string): Promise<OutcomeObservation[]> {
  const rows = await listOutcomePatternsForGeneration(businessId, { status: 'active', dimension: 'hypothesis', limit: HYPOTHESIS_RESULTS_LIMIT * 4 })
  const now = new Date()
  return rows
    .filter((r) => r.dimension === 'hypothesis' && isEligible(r, now) && r.outcome_n !== null && r.outcome_wins !== null)
    .slice(0, HYPOTHESIS_RESULTS_LIMIT)
    .map((r) => ({
      platform: r.platform,
      pattern: r.pattern,
      wins: r.outcome_wins as number,
      n: r.outcome_n as number,
      campaigns: r.outcome_distinct_campaigns ?? 1,
    }))
}

export async function retrieveOutcomePatterns(
  businessId: string,
  // MemoryQueryContext.platform is a plain string, so this accepts one; a value that is not a real platform
  // simply matches no row.
  options: { platform?: string } = {},
): Promise<OutcomeObservation[]> {
  const rows = await listOutcomePatternsForGeneration(businessId, { status: 'active', platform: options.platform })
  const now = new Date()
  // 'hypothesis' rows are campaign-level retrospective results, read only by the brief stage (J2.10) — never here.
  const eligible = rows.filter(
    (r) =>
      r.dimension !== 'hypothesis' &&
      isEligible(r, now) &&
      r.outcome_n !== null &&
      r.outcome_wins !== null &&
      r.outcome_distinct_campaigns !== null,
  )
  // Ranked and capped AMONG OUTCOME ROWS ONLY.
  return rankAndCap(eligible, { platform: options.platform }, OUTCOME_CAP, now).map((r) => ({
    platform: r.platform,
    pattern: r.pattern,
    wins: r.outcome_wins as number,
    n: r.outcome_n as number,
    campaigns: r.outcome_distinct_campaigns as number,
  }))
}
