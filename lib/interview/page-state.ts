import type { FounderInterviewAnswerRow, FounderInterviewRoundRow, FounderInterviewRoundStatus } from '@/lib/db/types'
import type { InterviewCandidatesByType } from '@/lib/memory/interview'
import { INTERVIEW_BANK, type InterviewQuestion } from './bank'
import { INTERVIEW_MAX_ATTEMPTS, INTERVIEW_CEILING_CENTS } from './constants'
import { isInterviewDue } from './due'
import { isExtractionStale } from './stale'
import { type CooldownRow, selectQuestions } from './select'
import type { SlotThinness } from './thinness'

// ADR 0029 §8.1/§8.2 (Session 35 M2.10) — the /interview page's whole rendering decision, PURE. The page and
// the dashboard card both call this and switch on `kind`; no component re-derives due-ness, the lifecycle, or
// the retry/ceiling wording. `now` is a parameter — no hidden clock, same as thinness.ts / due.ts / select.ts.
//
// THE ORDER: a NON-TERMINAL round (open, submitted, extracting, extraction_failed, awaiting_ratification)
// always wins — it owns the screen, matching getLatestInterviewRound's own comment. Otherwise due-ness is
// computed FRESH (never read off a stale round): if due, `due` or `nothing_thin` (selection < 5, §3.3 rule 5);
// if not due AND a round exists, that TERMINAL round's confirmation (ratified / no_records / skipped / expired
// / failed) still owns the screen, per lib/db/founder-interview-rounds.ts's "still owns the screen for its
// confirmation" comment; if not due and no round exists at all, `not_due` (snooze only — no round to cool
// down from).
//
// `nothing_thin` vs `not_due` is disambiguated by calling isInterviewDue TWICE: once with the real selection
// count (the actual due-ness) and once with an impossibly high count (isolating the cooldown/snooze half from
// the thinness half) — reusing due.ts's own date math rather than re-deriving the 30-day/snooze rule here.

/** Exported so loadInterviewPageState (the shared orchestrator) knows when it needs the selection inputs. */
export const INTERVIEW_TERMINAL_STATUSES: ReadonlySet<FounderInterviewRoundStatus> = new Set(['ratified', 'no_records', 'skipped', 'expired', 'failed'])
const TERMINAL_STATUSES = INTERVIEW_TERMINAL_STATUSES
const IGNORE_THINNESS_COUNT = 999

export type InterviewPageState =
  | { kind: 'not_due'; nextEligibleAt: string | null }
  | { kind: 'nothing_thin' }
  | { kind: 'due'; questionCount: number }
  | { kind: 'in_progress'; round: FounderInterviewRoundRow; answers: FounderInterviewAnswerRow[] }
  // `stale` (Session 35-D D6, MAJOR-2): the claim went quiet for > INTERVIEW_EXTRACTION_STALE_MINUTES (or a submitted round was never
  // claimed), so the extraction was probably lost and the founder may Retry. Computed from `now`, never trusted as the guard.
  | { kind: 'extracting'; round: FounderInterviewRoundRow; stale: boolean }
  | { kind: 'extraction_failed'; round: FounderInterviewRoundRow; canRetry: boolean; ceilingReached: boolean }
  | { kind: 'failed'; round: FounderInterviewRoundRow }
  | { kind: 'awaiting_ratification'; round: FounderInterviewRoundRow; isRatifier: boolean; candidates: InterviewCandidatesByType | null; answers: FounderInterviewAnswerRow[] }
  | { kind: 'ratified'; round: FounderInterviewRoundRow }
  | { kind: 'no_records'; round: FounderInterviewRoundRow }
  | { kind: 'skipped'; round: FounderInterviewRoundRow }
  | { kind: 'expired'; round: FounderInterviewRoundRow }

export type ComputeInterviewPageStateInput = {
  round: FounderInterviewRoundRow | null
  now: Date
  thinness: readonly SlotThinness[]
  cooldowns: readonly CooldownRow[]
  snoozedUntil: string | null
  /** The round's answers — 'open' (for the answer panel) or 'awaiting_ratification' (to resolve each candidate's question). Ignored otherwise. */
  answers: FounderInterviewAnswerRow[]
  /** Only meaningful when `round.status === 'awaiting_ratification'`. */
  isRatifier: boolean
  candidates: InterviewCandidatesByType | null
  /** A parameter so tests can pin a small bank; defaults to the authored one. */
  bank?: readonly InterviewQuestion[]
}

export function computeInterviewPageState(input: ComputeInterviewPageStateInput): InterviewPageState {
  const { round } = input

  if (round !== null && !TERMINAL_STATUSES.has(round.status)) {
    switch (round.status) {
      case 'open':
        return { kind: 'in_progress', round, answers: input.answers }
      case 'submitted':
      case 'extracting':
        return { kind: 'extracting', round, stale: isExtractionStale(round, input.now) }
      case 'extraction_failed':
        return {
          kind: 'extraction_failed',
          round,
          canRetry: round.extraction_attempts < INTERVIEW_MAX_ATTEMPTS && round.spend_cents < round.ceiling_cents,
          ceilingReached: round.spend_cents >= INTERVIEW_CEILING_CENTS,
        }
      case 'awaiting_ratification':
        return { kind: 'awaiting_ratification', round, isRatifier: input.isRatifier, candidates: input.candidates, answers: input.answers }
      /* c8 ignore next 2 -- exhaustive over the non-terminal set above */
      default:
        throw new Error(`page-state: unreachable non-terminal status ${round.status}`)
    }
  }

  const selection = selectQuestions({ thinness: input.thinness, cooldowns: input.cooldowns, now: input.now, bank: input.bank ?? INTERVIEW_BANK })
  const lastRoundCreatedAt = round?.created_at ?? null
  const dueReal = isInterviewDue({ now: input.now, lastRoundCreatedAt, snoozedUntil: input.snoozedUntil, selectedQuestionCount: selection.length })
  if (dueReal) return { kind: 'due', questionCount: selection.length }

  const dueIgnoringThinness = isInterviewDue({ now: input.now, lastRoundCreatedAt, snoozedUntil: input.snoozedUntil, selectedQuestionCount: IGNORE_THINNESS_COUNT })
  if (dueIgnoringThinness) return { kind: 'nothing_thin' }

  if (round !== null) {
    switch (round.status) {
      case 'ratified':
        return { kind: 'ratified', round }
      case 'no_records':
        return { kind: 'no_records', round }
      case 'skipped':
        return { kind: 'skipped', round }
      case 'expired':
        return { kind: 'expired', round }
      case 'failed':
        return { kind: 'failed', round }
      /* c8 ignore next 2 -- exhaustive over the terminal set above */
      default:
        throw new Error(`page-state: unreachable terminal status ${round.status}`)
    }
  }

  // round is provably null here: a non-null round either matched the non-terminal switch above (returned) or
  // the terminal switch just above (returned) — this line is reached only when there was never a round at all.
  return { kind: 'not_due', nextEligibleAt: input.snoozedUntil }
}

/** The dashboard card (§8.1) shows a SUBSET: due, any non-terminal ("open"), or awaiting ratification — hidden otherwise. */
export function isInterviewCardState(state: InterviewPageState): boolean {
  return state.kind === 'due' || state.kind === 'in_progress' || state.kind === 'extracting' || state.kind === 'extraction_failed' || state.kind === 'awaiting_ratification'
}
