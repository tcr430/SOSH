import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { ZodError } from 'zod'
import { differenceInDays, parseISO } from 'date-fns'
import { runPrompt } from '@/lib/ai/runner'
import { buildCustomerContext } from '@/lib/ai/context'
import { learningSummarizerPrompt } from '@/lib/ai/prompts/learning-summarizer'
import { getLastSuccessfulCallAt, countRecentCalls } from '@/lib/db/ai-usage'
import { countProcessedSignalsSince, listRecentHumanEditExcerpts } from '@/lib/db/post-edit-signals'
import { listDistilledPatternsForSummary, upsertDistilledPerformancePattern } from '@/lib/db/memory-performance'
import { getErrorMessage } from '@/lib/db/utils'
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
  // ADR 0022 §5.3, §17 item 3 (Session 29, F1b.10) — a statement rejected by
  // upsertDistilledPerformancePattern's own guards (§17.1: the 500-char
  // performance_memory.pattern CHECK, defence-in-depth on the promote-path
  // writer boundary, not a live participant in Track C) is logged and
  // skipped, not thrown — the remaining statements in this SAME batch still
  // get written. Latent, not live: no writer today can produce a
  // >200-char statement (the Zod .max at learning-summarizer.ts:16 rejects
  // at parse, long before this batch's own upsert could ever reach the
  // 500-char CHECK) — this is a correctness-of-the-guard fix, not a bug fix.
  //
  // Session 29-D, D2 (NIT-4) — narrowed to ONLY a genuine over-the-bound
  // rejection: the promoter-level ZodError (MEM-PATTERN-PROMOTER-BOUNDED)
  // or the DB CHECK's own constraint name
  // (performance_memory_pattern_length_check) in the error message. §5.3's
  // semantics reserve "rejected" for "over the bound" — a transient
  // DB/network failure on the same upsert call is a DIFFERENT thing and is
  // now counted separately, in statementsErrored below, never folded in
  // here.
  readonly statementsRejected: number
  // Session 29-D, D2 (NIT-4) — any upsertDistilledPerformancePattern
  // failure that is NOT a bound rejection (a transient DB or network
  // error). Still reported to Sentry either way; this counter exists so an
  // operator reading statementsRejected can trust it means "over the
  // bound", not "something went wrong".
  readonly statementsErrored: number
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
// [Session 25-D correction, NIT-3] The 32-bit hash space was considered and
// accepted, not overlooked. At LEARNING_SUMMARY_MAX_STATEMENTS=5 statements
// per call and LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS=8, that is at
// most 40 keys/month/business — against a 2^32 (~4.29 billion) hash space,
// the birthday-bound collision probability is on the order of
// 40^2 / (2 × 2^32) ≈ 1.9 × 10⁻⁷ per business per month (roughly 1 in
// 5 million). A collision is also not silently corrupting: it merges two
// DIFFERENT statements onto the SAME candidate row (the partial UNIQUE index
// dedupes on this key), which is a lossy-but-visible degradation — never a
// promotion-eligible false positive on its own, since a summarizer row is
// permanently candidate-only regardless (see MAJOR-2 / ADR §6.1 Amendment A).
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
    return { skipped: 'monthly_ceiling', statementsWritten: 0, statementsRejected: 0, statementsErrored: 0 }
  }

  const lastSummaryAt = await getLastSuccessfulCallAt(client, businessId, LEARNING_SUMMARIZER_PROMPT_ID)
  const newSignalCount = await countProcessedSignalsSince(client, businessId, lastSummaryAt)
  const daysSinceLastSummary = lastSummaryAt === null ? null : differenceInDays(new Date(), parseISO(lastSummaryAt))

  if (!shouldSummarize({ newSignalCount, daysSinceLastSummary })) {
    return { skipped: 'gates_not_met', statementsWritten: 0, statementsRejected: 0, statementsErrored: 0 }
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

  let statementsWritten = 0
  let statementsRejected = 0
  let statementsErrored = 0
  for (const statement of output.statements) {
    // ADR 0022 §5.3 (Session 29, F1b.10) — per-statement try/catch: a
    // rejection on ANY ONE statement must not throw the remaining
    // statements in this same batch out of the loop and into the caller's
    // per-business catch (orchestrator.ts), which would silently lose them.
    // See the SummarizeResult.statementsRejected doc comment for why this
    // is latent, not a live bug.
    try {
      await upsertDistilledPerformancePattern(client, {
        business_id: businessId,
        dimension: statement.dimension,
        pattern: statement.statement,
        pattern_key: computeSummaryPatternKey(statement.dimension, statement.statement),
        platform: null,
        scope: 'brand',
        scope_ref: null,
        // [Session 25-D correction, MAJOR-2] A summarizer row is not merely
        // unable to promote on its FIRST observation — it can never promote AT
        // ALL, on any volume, for any duration. computeConfidence(1, 0) ≈
        // 0.333 < 0.70 and observation_count=1 < 5 are both gates a REPEAT
        // observation would eventually clear (same LEARN-NO-SINGLE-DIFF-
        // PROMOTION shape Tier-0 signals get) — but promote_performance_
        // pattern's third gate, the distinct-campaign count, is a correlated
        // subquery over post_edit_signals filtered on `pes.pattern_key =
        // p_pattern_key`. This row's pattern_key is namespaced
        // `summarize:<dimension>:<hash>` (computeSummaryPatternKey, above),
        // which by construction never matches ANY post_edit_signals row (that
        // is the same property that keeps it from colliding with a Tier-0
        // key) — so the subquery is always `COUNT(DISTINCT campaign_id) = 0`,
        // and `0 >= 2` is always false, permanently. This is INTENDED and
        // recorded, not a bug: summarizer rows are candidate-only forever,
        // read back only by listDistilledPatternsForSummary (never by
        // listPerformanceMemoryCandidates, which filters status='active'). See
        // ADR 0018 §6.1 amendment and §12 Tier-3.
        confidence: computeConfidence(1, 0),
        observation_count: 1,
      })
      statementsWritten++
    } catch (err) {
      const isBoundRejection =
        err instanceof ZodError || /performance_memory_pattern_length_check/.test(getErrorMessage(err))
      if (isBoundRejection) {
        statementsRejected++
      } else {
        statementsErrored++
      }
      Sentry.captureException(err, {
        tags: {
          business_id: businessId,
          phase: 'learning-summarize-statement',
          dimension: statement.dimension,
          outcome: isBoundRejection ? 'rejected' : 'errored',
        },
      })
    }
  }

  return { skipped: null, statementsWritten, statementsRejected, statementsErrored }
}
