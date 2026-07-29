// ADR 0018 §7.3/§7.4 — the promotion threshold arithmetic and the atomic
// promotion/demotion orchestration, sibling to BRIEF_QUALITY_THRESHOLD
// (ADR 0017 §6.3) and lib/memory/constants.ts's named-constant convention.
// Never a scattered literal.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Platform, PerformanceMemoryDimension, MemoryScope, PerformanceMemoryRow } from '@/lib/db/types'
import {
  countProcessedSignalsForPattern,
  upsertDistilledPerformancePattern,
  promotePerformancePattern,
  demotePerformancePattern,
} from '@/lib/db/memory-performance'

export const LEARN_PROMOTION_MIN_OBSERVATIONS = 5
export const LEARN_PROMOTION_MIN_CONFIDENCE = 0.7
export const LEARN_PROMOTION_MIN_DISTINCT_CAMPAIGNS = 2
export const LEARN_CONFIDENCE_K = 2
export const LEARN_CONFIDENCE_CEILING = 0.95
export const LEARN_DEMOTION_NET = 3
export const LEARN_PATTERN_TTL_DAYS = 90

// net = observations - contradictions; confidence = min(ceiling, net / (net + K))
// for net > 0, else 0. At exactly 5 clean observations (0 contradictions)
// this yields 0.714 — just clearing LEARN_PROMOTION_MIN_CONFIDENCE, so BOTH
// gates bind together and neither is dead code. Do NOT "tidy" K to 3: that
// makes MIN_OBSERVATIONS unreachable (5 obs would yield exactly 0.625,
// never reaching 0.70) and the constant a lie.
export function computeConfidence(observations: number, contradictions: number): number {
  const net = observations - contradictions
  if (net <= 0) return 0
  return Math.min(LEARN_CONFIDENCE_CEILING, net / (net + LEARN_CONFIDENCE_K))
}

export interface PromotionEligibility {
  readonly observationCount: number
  readonly confidence: number
  readonly distinctCampaignCount: number
}

// Pure mirror of promote_performance_pattern's SQL WHERE clause
// (20260726030000_performance_memory_promotion.sql), kept for Tier-2
// boundary testing of the three-gate arithmetic in isolation from a live
// database. The SQL function is the actual atomic enforcement — this
// function is never called as a pre-check before that UPDATE (that would be
// the read-then-update CLAUDE.md forbids); it exists so the 5/0.70/2
// interaction can be unit-tested at the exact boundary values.
export function meetsPromotionThreshold(eligibility: PromotionEligibility): boolean {
  return (
    eligibility.observationCount >= LEARN_PROMOTION_MIN_OBSERVATIONS &&
    eligibility.confidence >= LEARN_PROMOTION_MIN_CONFIDENCE &&
    eligibility.distinctCampaignCount >= LEARN_PROMOTION_MIN_DISTINCT_CAMPAIGNS
  )
}

// Pure mirror of demote_performance_pattern's `p_net < 3` guard, same
// testing rationale as meetsPromotionThreshold above.
export function meetsDemotionThreshold(net: number): boolean {
  return net < LEARN_DEMOTION_NET
}

export interface DistillationInput {
  readonly businessId: string
  readonly dimension: PerformanceMemoryDimension
  readonly pattern: string
  readonly patternKey: string
  // null for kinds with no natural opposite (lib/learning/pattern-key.ts's
  // computeContradictingPatternKey) — such a pattern can never be
  // contradicted within the fixed taxonomy, so contradictions is always 0.
  readonly contradictingPatternKey: string | null
  readonly platform: Platform | null
  readonly scope: MemoryScope
  readonly scopeRef: string | null
}

export interface DistillationResult {
  readonly row: PerformanceMemoryRow
  readonly observations: number
  readonly contradictions: number
  readonly confidence: number
  readonly promoted: PerformanceMemoryRow | null
  readonly demoted: PerformanceMemoryRow | null
}

// Orchestrates one pattern_key's tick: recompute (never increment,
// LEARN-TICK-IDEMPOTENT §9.6) → upsert the distilled row → attempt promote
// unconditionally, and attempt demote whenever `net < LEARN_DEMOTION_NET`
// (database-reviewer, C2.6 pass: the demote pre-check is a CLIENT-SIDE
// call-avoidance optimization only, using `net` this call itself just
// computed — never a read of the row's EXISTING state — so it is not the
// read-then-update shape CLAUDE.md's atomic-state-transitions rule forbids;
// the actual, sole enforcement for both transitions is each RPC's own
// atomic WHERE clause). Skipping the demote call when net is high merely
// avoids a guaranteed-no-op round trip; promotePerformancePattern is called
// every time because there is no equivalently cheap client-side pre-check
// for its three-gate threshold worth computing twice.
//
// Accepted residual (silent-failure-hunter, C2.6 pass): this function is
// three separate round trips (upsert, then promote, then maybe demote),
// not one transaction. If the row is soft-deleted or otherwise invalidated
// by a concurrent process in the narrow window between the upsert and the
// promote/demote calls, promotePerformancePattern/demotePerformancePattern
// return null exactly as they would for "guard legitimately not met yet" —
// the two cases are indistinguishable to this function's caller. No
// orchestrator drives this function in a loop yet (that is C2.7+'s tick
// worker), so today's blast radius is limited to direct callers/tests.
// Recorded here rather than silently inherited, per this track's own
// documented-drift convention, for whoever wires the tick loop next.
export async function recomputeAndUpsertPattern(
  client: SupabaseClient,
  input: DistillationInput,
): Promise<DistillationResult> {
  const observations = await countProcessedSignalsForPattern(client, input.businessId, input.patternKey)
  const contradictions = input.contradictingPatternKey
    ? await countProcessedSignalsForPattern(client, input.businessId, input.contradictingPatternKey)
    : 0
  const confidence = computeConfidence(observations, contradictions)

  const row = await upsertDistilledPerformancePattern(client, {
    business_id: input.businessId,
    dimension: input.dimension,
    pattern: input.pattern,
    pattern_key: input.patternKey,
    platform: input.platform,
    scope: input.scope,
    scope_ref: input.scopeRef,
    confidence,
    observation_count: observations,
  })

  const net = observations - contradictions

  const promoted = await promotePerformancePattern(
    client,
    input.businessId,
    input.patternKey,
    input.dimension,
    input.platform,
  )
  // [Session 25-D correction, MINOR-8] `net` is still computed here and
  // used for the client-side call-avoidance pre-check (meetsDemotionThreshold)
  // — a genuine optimization, not the read-then-update shape CLAUDE.md
  // forbids, since the RPC re-evaluates its own guard atomically regardless.
  // The RPC itself no longer trusts this `net` value: it recomputes the
  // contradiction count from `contradictingPatternKey` via a live correlated
  // subquery, so the KEY is what's passed, not the pre-computed number.
  const demoted = meetsDemotionThreshold(net)
    ? await demotePerformancePattern(
        client,
        input.businessId,
        input.patternKey,
        input.dimension,
        input.platform,
        input.contradictingPatternKey,
      )
    : null

  return { row, observations, contradictions, confidence, promoted, demoted }
}
