import { AiError } from '@/lib/ai/errors'
import { buildCustomerContext } from '@/lib/ai/context'
import {
  interviewExtractionPrompt,
  type InterviewExtractionItem,
  type InterviewExtractionOutput,
} from '@/lib/ai/prompts/interview-extraction'
import { runPromptWithCost } from '@/lib/ai/runner'
import { normalizeForVerification } from '@/lib/backfill/evidence'
import { listAnsweredForExtraction } from '@/lib/db/founder-interview-answers'
import { claimInterviewExtraction, reconcileInterviewSpend } from '@/lib/db/founder-interview-rounds'
import type { ClaimInterviewExtractionResult } from '@/lib/db/types'
import { readInterviewConflictContext, recordInterviewCandidates } from '@/lib/memory'
import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'
import {
  INTERVIEW_EVIDENCE_TEXT_MAX_CHARS,
  INTERVIEW_MAX_CONFLICTS_PER_ITEM,
  INTERVIEW_MAX_ITEMS_PER_ANSWER,
  INTERVIEW_RECORD_TEXT_MAX_CHARS,
  INTERVIEW_RESERVATION_CENTS,
  INTERVIEW_SPAN_MAX_CHARS,
  type InterviewMemoryType,
} from './constants'
import { isMoreCertainThanAnswer, mentionsPerformanceClaim } from './lexicon'
import { questionTextFor } from './question-text'

// ADR 0029 §4, §5.7, §6.2, §7 (Session 35 M2.8) — the extraction ORCHESTRATOR:
//
//   claim -> read -> ONE model call -> ground / filter / intersect -> reconcile -> write
//
// WHO CALLS IT. The submit Server Action and the retry action (M2.9). It takes a round id and NOTHING ELSE: the business is
// derived from the ROUND by claim_interview_extraction (§7.2), never named by a caller, so no caller can pair a round with
// another tenant's business. It runs under service-role (the answers are raw founder text; the reads it makes are separately
// named worker functions).
//
// THE MONEY. The claim RESERVES 10 cents in one conditional UPDATE (§7.2). From that moment EXACTLY ONE settle happens on
// EVERY path — success, a thrown model error, a validation failure, an empty round, a write failure — via
// reconcile_interview_spend, so a reservation can never leak and a failure is recordable. A REFUSED claim reserved nothing,
// so it settles nothing: it is returned as a typed outcome for the UI, never swallowed and never reconciled (reconciling a
// round another worker holds would subtract THEIR reservation).
//
// THE ORDER CONTRACT (M2.5). A success is reconciled BEFORE the writer: the writer moves the round out of 'extracting',
// after which reconcile is `not_extracting`. If reconcile says `not_extracting` the round was re-claimed by a later attempt
// and this one WRITES NOTHING.
//
// THE TRIAL (§5.7, INTERVIEW-TRIAL-UNTOUCHED). This file never imports the trial-state layer, and the runner exempts the
// 'interview-extraction' prompt id from BOTH trial checks (lib/ai/runner.ts): extraction neither checks nor increments
// posts_generated_count or the trial cap, and the trial clock is untouched — a founder with no connected account can answer.

export type ExtractionRefusal = Exclude<ClaimInterviewExtractionResult, { outcome: 'claimed' }>

export type InterviewYield = { proposed: number; droppedUngrounded: number; droppedPerformanceClaim: number }

/**
 * A new record's possible conflicts with EXISTING active records of this business (§4.5), already intersected.
 * `itemIndex` is the record's position in the list handed to the writer (two records can share a span, so the span alone is
 * ambiguous). Session 35-D D5 (MAJOR-3): since D4 these ARE persisted, per record, as `interview_conflict_ids` (each id
 * re-verified in SQL to be a live row of the same table and business) — this round-level list stays only as the extraction's
 * own return value. It is never rendered from here: the ratify view reads the persisted column.
 */
export type InterviewConflict = { itemIndex: number; answerId: string; span: string; existingIds: string[] }

export type InterviewExtractionResult =
  | { outcome: 'refused'; refusal: ExtractionRefusal }
  | { outcome: 'superseded'; attempt: number }
  | { outcome: 'failed'; attempt: number; errorCode: string }
  | {
      outcome: 'written'
      attempt: number
      status: 'awaiting_ratification' | 'no_records'
      inserted: number
      costCents: number
      yield: InterviewYield
      /** How many written records carry the "more certain than your answer" marker (§4.4). A flag, never a drop. */
      hedgeFlagged: number
      conflicts: InterviewConflict[]
    }
  | { outcome: 'not_written'; attempt: number; writer: 'not_found' | 'not_extracting' }

// ─── grounding (§4.3) ────────────────────────────────────────────────────────────────────────────────────────────────────

// The model saw a NEUTRALISED copy of the answer and may have collapsed whitespace, so its span can differ from the founder's
// characters. §4.3 verifies after the SAME normalisation lib/backfill/evidence.ts applies (imported, not copied); but the
// writer re-checks in SQL with an EXACT strpos on the RAW answer (a span that fails it aborts the whole atomic write), so
// what is handed to the writer must be a substring of the raw answer. This returns that substring — the founder's own
// characters — or null when the span is not in the answer at all. Nothing is invented: the result is always a slice of the
// raw text, differing from the model's only in whitespace.
export function resolveRawSpan(rawAnswer: string, span: string): string | null {
  if (rawAnswer.includes(span)) return span
  const normalizedSpan = normalizeForVerification(span)
  if (normalizedSpan === '') return null
  const pattern = normalizedSpan
    .split(' ')
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  // The MATCH is the verbatim check: the same words in the same order, separated only by whitespace. No match = not in the answer.
  return rawAnswer.match(new RegExp(pattern))?.[0] ?? null
}

// M2.8 security review, MEDIUM: ONE item the writer refuses aborts the WHOLE atomic write, and three failed attempts make the
// round terminal (a 30-day lockout for the founder). The TS bounds above are on the RAW forms; the SQL ALSO bounds the STORED
// forms (neutralizeWithSentinels can lengthen text — NFKC expansion, a code fence becoming five characters, "[/DATA]" becoming
// "[/data-blocked]" — or blank it entirely) and jsonb rejects a NUL and a lone surrogate. So an item is checked against what
// the writer will actually store BEFORE it is sent, and one that cannot be stored is dropped and COUNTED, never allowed to
// take its neighbours down with it.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

function isStorable(type: InterviewMemoryType, text: string, span: string): boolean {
  for (const value of [text, span]) {
    if (value.includes('\u0000') || LONE_SURROGATE.test(value)) return false
  }
  const storedText = neutralizeWithSentinels(text)
  const storedSpan = neutralizeWithSentinels(span)
  const maxText = type === 'evidence' ? INTERVIEW_EVIDENCE_TEXT_MAX_CHARS : INTERVIEW_RECORD_TEXT_MAX_CHARS
  return (
    storedText.trim() !== '' &&
    storedSpan.trim() !== '' &&
    storedText.length <= maxText &&
    storedSpan.length <= INTERVIEW_SPAN_MAX_CHARS
  )
}

export type GroundedItem = {
  answerId: string
  type: InterviewMemoryType
  category: string
  text: string
  span: string
  /** §4.4: the record dropped the founder's hedge ("we think" -> "we are"). A flag, never a drop. Always false for evidence. */
  hedgeFlagged: boolean
  /** §4.5: the ids of EXISTING active records of this business the model named, intersected with the ids that were sent. */
  conflictIds: string[]
}

export type FilterResult = {
  kept: GroundedItem[]
  droppedUngrounded: number
  droppedPerformanceClaim: number
  /** NIT-2: items beyond INTERVIEW_MAX_ITEMS_PER_ANSWER for their answer. Counted (persisted as dropped_cap), never silent. */
  droppedCap: number
  hedgeFlagged: number
  conflicts: InterviewConflict[]
}

// §4.3 grounding, §4.7 D-4, §4.4 hedge flag, §4.5 conflict intersection — pure, over the model's parsed items.
//   1. the answerId must be one of THIS round's answered ids                        -> else dropped_ungrounded
//   2. the span must be a verbatim excerpt of THAT answer (resolveRawSpan), <= 500   -> else dropped_ungrounded
//   3. evidence: text must equal its span (verbatim)                                 -> else dropped_ungrounded
//   4. brand / audience whose text OR span mentions a performance claim              -> dropped_performance_claim
//   5. at most 3 kept per answer (the SQL rejects more); the excess is only in `proposed` minus what was written
//   6. conflictsWith is INTERSECTED with the ids that were SENT (this business only); an unknown id falls out
export function filterExtractedItems(
  items: readonly InterviewExtractionItem[],
  answersById: ReadonlyMap<string, string>,
  sentExistingIds: ReadonlySet<string>,
): FilterResult {
  const kept: GroundedItem[] = []
  const conflicts: InterviewConflict[] = []
  const perAnswer = new Map<string, number>()
  let droppedUngrounded = 0
  let droppedPerformanceClaim = 0
  let droppedCap = 0
  let hedgeFlagged = 0

  for (const item of items) {
    const rawAnswer = answersById.get(item.answerId)
    if (rawAnswer === undefined) {
      droppedUngrounded++
      continue
    }
    const span = resolveRawSpan(rawAnswer, item.span)
    if (span === null || span.length > INTERVIEW_SPAN_MAX_CHARS) {
      droppedUngrounded++
      continue
    }

    let text = item.text.trim()
    if (item.type === 'evidence') {
      if (normalizeForVerification(item.text) !== normalizeForVerification(item.span)) {
        droppedUngrounded++
        continue
      }
      text = span // verbatim: the record IS the founder's characters
    } else if (mentionsPerformanceClaim(text) || mentionsPerformanceClaim(span)) {
      droppedPerformanceClaim++
      continue
    }

    // What the writer would STORE must fit its bounds and jsonb, or this one item would abort the whole write.
    if (!isStorable(item.type, text, span)) {
      droppedUngrounded++
      continue
    }

    const seen = perAnswer.get(item.answerId) ?? 0
    if (seen >= INTERVIEW_MAX_ITEMS_PER_ANSWER) {
      droppedCap++ // NIT-2: counted, so proposed - dropped - written is inferable rather than a silent gap
      continue
    }
    perAnswer.set(item.answerId, seen + 1)

    const isHedgeFlagged = item.type !== 'evidence' && isMoreCertainThanAnswer(span, text)
    const existingIds = [...new Set(item.conflictsWith.filter((id) => sentExistingIds.has(id)))].slice(0, INTERVIEW_MAX_CONFLICTS_PER_ITEM)
    kept.push({ answerId: item.answerId, type: item.type, category: item.category, text, span, hedgeFlagged: isHedgeFlagged, conflictIds: existingIds })
    if (isHedgeFlagged) hedgeFlagged++
    if (existingIds.length > 0) conflicts.push({ itemIndex: kept.length - 1, answerId: item.answerId, span, existingIds })
  }

  return { kept, droppedUngrounded, droppedPerformanceClaim, droppedCap, hedgeFlagged, conflicts }
}

// ─── the orchestrator ────────────────────────────────────────────────────────────────────────────────────────────────────

// A call that COMPLETED at the provider but produced nothing usable (or never confirmed) probably still cost money, and the
// call's own cost is lost with the throw, so the reservation is kept as the estimate. A call that never ran costs nothing.
const CODES_THAT_MAY_HAVE_COST_MONEY: ReadonlySet<string> = new Set(['invalid_response', 'response_truncated', 'policy_violation', 'timeout'])

// A round with no answered question that still has text (e.g. every answer was redacted): a typed failure, not a defect.
class NoAnswersError extends Error {
  readonly code = 'no_answers'
}

function errorCodeOf(err: unknown): string {
  return err instanceof AiError || err instanceof NoAnswersError ? err.code : 'unexpected_error'
}

function estimatedCentsFor(err: unknown): number {
  return err instanceof AiError && CODES_THAT_MAY_HAVE_COST_MONEY.has(err.code) ? INTERVIEW_RESERVATION_CENTS : 0
}

// Settle a FAILED attempt. If settling itself fails, the caller's original error must not be lost: BOTH surface, as an
// AggregateError's `errors` ([original, settle failure]). The MESSAGE carries only the round id and the error code — never the
// original's message, which can contain model-controlled strings (a ZodError names the offending category and unknown keys)
// and would put them into the route's error log (M2.8 security review, LOW).
async function settleFailed(roundId: string, attempt: number, actualCents: number, errorCode: string, original: unknown): Promise<void> {
  try {
    await reconcileInterviewSpend({ roundId, attempt, actualCents, outcome: 'failed', errorCode })
  } catch (settleErr) {
    throw new AggregateError([original, settleErr], `interview extraction: could not settle round ${roundId} as failed (${errorCode})`)
  }
}

export async function extractInterviewRound(roundId: string): Promise<InterviewExtractionResult> {
  // 1. CLAIM = RESERVE. A refusal is a typed value the UI renders; nothing was reserved, so nothing is settled.
  const claim = await claimInterviewExtraction({ roundId })
  if (claim.outcome !== 'claimed') return { outcome: 'refused', refusal: claim }
  const { businessId, attempt } = claim

  // From here a reservation is held: every exit below settles it exactly once.
  let output: InterviewExtractionOutput
  let costCents: number
  let answersById: Map<string, string>
  let sentExistingIds: Set<string>
  try {
    const answers = await listAnsweredForExtraction(roundId, businessId)
    if (answers.length === 0) throw new NoAnswersError('the round has no answered question with text')
    const [existing, context] = await Promise.all([readInterviewConflictContext(businessId), buildCustomerContext(businessId)])

    answersById = new Map(answers.map((a) => [a.id, a.answer_text as string]))
    sentExistingIds = new Set(existing.map((r) => r.id))

    // 2. THE ONE MODEL CALL. The prompt neutralises every answer and record itself (interview-extraction.ts); a caller
    // cannot put raw text into it any other way. The runner records the call in ai_usage and skips the trial checks.
    const result = await runPromptWithCost(interviewExtractionPrompt, context, {
      answers: answers.map((a) => ({ answerId: a.id, questionText: questionTextFor(a.question_key, context.business.language), text: a.answer_text as string })),
      existing,
    })
    output = result.output
    costCents = result.costCents
  } catch (err) {
    // A model error, a parse failure (a smuggled key is `invalid_response`), a rate limit, a read failure: settle, then
    // either return the typed failure (an AiError the UI can name) or rethrow (a defect the route must log).
    await settleFailed(roundId, attempt, estimatedCentsFor(err), errorCodeOf(err), err)
    if (err instanceof AiError || err instanceof NoAnswersError) return { outcome: 'failed', attempt, errorCode: err.code }
    throw err
  }

  // 3. FILTER (pure).
  const filtered = filterExtractedItems(output.items, answersById, sentExistingIds)
  const counters: InterviewYield = {
    proposed: output.items.length,
    droppedUngrounded: filtered.droppedUngrounded,
    droppedPerformanceClaim: filtered.droppedPerformanceClaim,
  }
  // D5 (NIT-2): the cap drop travels to the writer beside the yield counters but is NOT part of the returned `yield` shape.
  const writerCounters = { ...counters, droppedCap: filtered.droppedCap }

  // 4. RECONCILE THE SUCCESS BEFORE THE WRITER (the order contract). Not extracting = a later attempt owns the round.
  const settled = await reconcileInterviewSpend({ roundId, attempt, actualCents: costCents, outcome: 'succeeded' })
  if (settled.outcome !== 'reconciled') return { outcome: 'superseded', attempt }

  // 5. WRITE. Only these seven keys per item cross (the five record keys plus the two COMPUTED markers, hedgeFlagged and
  // conflictIds): no governance value exists in this payload, and the writer fixes every governance column in SQL anyway.
  // If the write throws, the round is still 'extracting' with its spend already corrected, so it is failed with a NEUTRAL
  // reconcile (actual = the reservation leaves spend_cents as it is).
  try {
    const written = await recordInterviewCandidates({ roundId, items: filtered.kept, counters: writerCounters })
    if (written.outcome !== 'written') return { outcome: 'not_written', attempt, writer: written.outcome }
    return {
      outcome: 'written',
      attempt,
      status: written.status,
      inserted: written.inserted,
      costCents,
      yield: counters,
      hedgeFlagged: filtered.hedgeFlagged,
      conflicts: filtered.conflicts,
    }
  } catch (err) {
    await settleFailed(roundId, attempt, INTERVIEW_RESERVATION_CENTS, 'write_failed', err)
    throw err
  }
}
