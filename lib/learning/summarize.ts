import type { SupabaseClient } from '@supabase/supabase-js'
import { differenceInDays, parseISO } from 'date-fns'
import { runPrompt } from '@/lib/ai/runner'
import { buildCustomerContext } from '@/lib/ai/context'
import { learningSummarizerPrompt } from '@/lib/ai/prompts/learning-summarizer'
import { getLastSuccessfulCallAt, countRecentCalls } from '@/lib/db/ai-usage'
import { countProcessedSignalsSince, listRecentHumanEditExcerpts } from '@/lib/db/post-edit-signals'
import { listDistilledPatternsForSummary, upsertDistilledPerformancePattern } from '@/lib/db/memory-performance'
import { computeConfidence } from '@/lib/learning/promote'
import {
  LEARNING_SUMMARIZER_PROMPT_ID,
  LEARNING_SUMMARY_MIN_SIGNALS,
  LEARNING_SUMMARY_MIN_INTERVAL_DAYS,
  LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS,
} from '@/lib/learning/constants'

const EXCERPT_QUERY_LIMIT = 200
const MONTHLY_CEILING_WINDOW_SECONDS = 30 * 24 * 60 * 60

export type SummarizeSkipReason = 'monthly_ceiling' | 'gates_not_met'

export interface SummarizeResult {
  readonly skipped: SummarizeSkipReason | null
  readonly statementsWritten: number
}

export interface SummarizeGateInput {
  readonly newSignalCount: number
  // null = no prior successful summarization for this business — the
  // interval gate is trivially satisfied (ADR §6.2: nothing to wait for).
  readonly daysSinceLastSummary: number | null
}

// ADR 0018 §6.2 — THE TWO-GATE FLOOR, both required. Pure so the boundary
// arithmetic (19 signals + 8 days -> no call; 25 signals + 3 days -> no
// call; both pass -> one call) is testable without a database.
export function shouldSummarize(input: SummarizeGateInput): boolean {
  const signalsGatePasses = input.newSignalCount >= LEARNING_SUMMARY_MIN_SIGNALS
  const intervalGatePasses =
    input.daysSinceLastSummary === null || input.daysSinceLastSummary >= LEARNING_SUMMARY_MIN_INTERVAL_DAYS
  return signalsGatePasses && intervalGatePasses
}

// Deterministic, templated — matches Tier-0's own "arithmetic, not
// generation" posture (§6.1) for the half of the summarizer's input that
// isn't raw human copy.
export function renderTierZeroSummary(pattern: string, observationCount: number): string {
  return `${pattern} (${observationCount} observation${observationCount === 1 ? '' : 's'})`
}

// The summarizer's output has no signal-table linkage to recompute
// observation_count FROM (unlike Tier-0's kind:direction:platform keys,
// which post_edit_signals.pattern_key ties directly back to) — its
// pattern_key is therefore a content hash, namespaced `summarize:` so it
// can never collide with a Tier-0 key (which never starts with that
// prefix). Two summarizer runs producing the same dimension + normalized
// statement text dedupe onto the same row (ON CONFLICT DO UPDATE, C2.6);
// two different phrasings are two separate candidate rows — an accepted,
// recorded simplification given the ADR does not specify a summarizer-side
// recompute mechanism (there is nothing in post_edit_signals to recompute
// FROM for LLM-synthesized, cross-signal clustering output).
export function computeSummaryPatternKey(dimension: string, statement: string): string {
  const normalized = statement.trim().toLowerCase().replace(/\s+/g, ' ')
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = (Math.imul(31, hash) + normalized.charCodeAt(i)) | 0
  }
  return `summarize:${dimension}:${(hash >>> 0).toString(36)}`
}

// ADR 0018 §6/§10.3 — ONE business per call, no exceptions. Every input
// query below takes `businessId` as an explicit parameter (never a
// closed-over loop variable — the classic loop-capture leak Session 24-D's
// MAJOR-1 closed for wrapEvidenceForPrompt), and every OUTPUT write below
// passes that SAME `businessId` parameter, never anything derived from the
// LLM's response or a shared variable. A future orchestrator (C2.9) calling
// this once per business in a loop is therefore safe by construction: this
// function never reads a business_id from anywhere but its own parameter.
export async function summarizeBusinessLearning(
  client: SupabaseClient,
  businessId: string,
): Promise<SummarizeResult> {
  // ADR §6.2 — the monthly ceiling, hard-capped regardless of usage,
  // counted from the existing ai_usage table (no new tracking state).
  //
  // Accepted residual (cost-aware-llm-pipeline review, C2.7 pass): this
  // count-then-proceed is NOT atomic against a genuinely concurrent second
  // invocation for the SAME business (e.g. an overlapping retry) — both
  // could read "under ceiling" before either records its ai_usage row,
  // exceeding 8/month by the number of true concurrent callers. No
  // orchestrator drives concurrent calls for one business today (the
  // two-gate floor below also requires 7+ days between successful calls,
  // narrowing the realistic window further); recorded here rather than
  // silently assumed away, for whoever builds the C2.9 tick worker that
  // will actually invoke this at scale.
  const monthlyCalls = await countRecentCalls(
    client,
    businessId,
    MONTHLY_CEILING_WINDOW_SECONDS,
    LEARNING_SUMMARIZER_PROMPT_ID,
  )
  if (monthlyCalls >= LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS) {
    return { skipped: 'monthly_ceiling', statementsWritten: 0 }
  }

  const lastSummaryAt = await getLastSuccessfulCallAt(client, businessId, LEARNING_SUMMARIZER_PROMPT_ID)
  const newSignalCount = await countProcessedSignalsSince(client, businessId, lastSummaryAt)
  const daysSinceLastSummary = lastSummaryAt === null ? null : differenceInDays(new Date(), parseISO(lastSummaryAt))

  if (!shouldSummarize({ newSignalCount, daysSinceLastSummary })) {
    return { skipped: 'gates_not_met', statementsWritten: 0 }
  }

  const [tierZeroRows, editExcerpts, context] = await Promise.all([
    listDistilledPatternsForSummary(client, businessId),
    listRecentHumanEditExcerpts(client, businessId, lastSummaryAt, EXCERPT_QUERY_LIMIT),
    buildCustomerContext(businessId),
  ])

  const tierZeroSummaries = tierZeroRows.map((row) => renderTierZeroSummary(row.pattern, row.observation_count))

  // The summarizer is a background, non-user-facing feature — it must
  // never be gated by the CUSTOMER-FACING post-generation trial quota
  // (rubric.ts:113-121 names the same runner.ts STEP-1 gap for its own
  // scoring-only call; here it is closed by simply never presenting a
  // trialState to check, rather than modifying shared runner.ts behaviour
  // for every caller).
  const summarizerContext = { ...context, trialState: null }

  const output = await runPrompt(learningSummarizerPrompt, summarizerContext, {
    tierZeroSummaries,
    editExcerpts,
  })

  for (const statement of output.statements) {
    await upsertDistilledPerformancePattern(client, {
      business_id: businessId,
      dimension: statement.dimension,
      pattern: statement.statement,
      pattern_key: computeSummaryPatternKey(statement.dimension, statement.statement),
      platform: null,
      scope: 'brand',
      scope_ref: null,
      // A single summarizer statement is exactly one observation — never a
      // shortcut into 'active' (§6.1: "gets no shortcut into active"; the
      // upsert itself never sets status, C2.6). computeConfidence(1, 0) =
      // 1/(1+2) ≈ 0.333, structurally below LEARN_PROMOTION_MIN_CONFIDENCE
      // (0.70) AND observation_count=1 is structurally below
      // LEARN_PROMOTION_MIN_OBSERVATIONS (5) — a fresh statement can never
      // promote on its own on EITHER gate, the same LEARN-NO-SINGLE-DIFF-
      // PROMOTION property Tier-0 signals get.
      confidence: computeConfidence(1, 0),
      observation_count: 1,
    })
  }

  return { skipped: null, statementsWritten: output.statements.length }
}
