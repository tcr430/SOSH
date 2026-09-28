import { z } from 'zod'
import { INTERVIEW_BANK, type InterviewQuestion } from './bank'
import {
  INTERVIEW_ANSWERED_COOLDOWN_DAYS,
  INTERVIEW_MAX_PER_TYPE,
  INTERVIEW_MAX_QUESTIONS,
  INTERVIEW_MIN_QUESTIONS,
  INTERVIEW_SKIPPED_COOLDOWN_DAYS,
  INTERVIEW_SLOTS,
  INTERVIEW_TIEBREAK_ORDER,
  type InterviewSlot,
} from './constants'
import type { SlotThinness } from './thinness'

// ADR 0029 §3.3 / §3.6 — question selection, PURE and deterministic. Same thinness, same cooldown rows, same `now`, same
// bank: same questions, in the same order. No model, no clock, no randomness (a model choosing questions is the ADR's
// named loser, §3.5).
//
//   1. rank the THIN slots by thinness descending; ties: type brand > audience > evidence, then the category order in
//      INTERVIEW_TIEBREAK_ORDER (constants.ts explains why that is not the §3.1 listing order);
//   2. pass 1: one question per thin slot, in rank order;
//   3. pass 2: a second question for each slot at thinness = 1.0, in the same order;
//   4. at most 3 per type, stop at 8;
//   5. fewer than 5 -> no round (an EMPTY list, the "nothing thin" state).
//
// A key is ELIGIBLE only if it was not ANSWERED in the last 180 days and not SKIPPED in the last 60 (§3.3). A slot with
// no eligible key is passed over. Both windows are INCLUSIVE at the boundary, like the recency window of §3.2: an
// answer exactly 180 days old is still cooling down, one 181 days old is eligible.

const DAY_MS = 24 * 60 * 60 * 1000

/** The columns of a founder_interview_answers row the cooldown reads (see listInterviewCooldownRows). */
export type CooldownRow = { question_key: string; status: string; answered_at: string | null }

const questionSchema = z.strictObject({
  questionKey: z.string().min(1),
  type: z.enum(['brand', 'audience', 'evidence']),
  slot: z.enum(INTERVIEW_SLOTS.map((s) => s.category) as [InterviewSlot['category'], ...InterviewSlot['category'][]]),
})

/**
 * The Zod half of INTERVIEW-QUESTIONS-BOUNDED (§3.6): a round is 5..8 questions, no key twice. The other halves are the
 * `question_count` CHECK, UNIQUE (round_id, position) and the create_interview_round array check, all in SQL.
 */
export const interviewSelectionSchema = z
  .array(questionSchema)
  .min(INTERVIEW_MIN_QUESTIONS)
  .max(INTERVIEW_MAX_QUESTIONS)
  .refine((questions) => new Set(questions.map((q) => q.questionKey)).size === questions.length, {
    message: 'a question key may appear only once in a round',
  })

/** The keys inside a cooldown window as of `now`. */
export function coolingDownKeys(cooldowns: readonly CooldownRow[], now: Date): Set<string> {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('select: now is not a valid date')
  const cooling = new Set<string>()
  for (const row of cooldowns) {
    if (row.answered_at === null) continue // no clock, nothing to cool down from
    const days = row.status === 'answered' ? INTERVIEW_ANSWERED_COOLDOWN_DAYS : row.status === 'skipped' ? INTERVIEW_SKIPPED_COOLDOWN_DAYS : null
    if (days === null) continue
    const at = Date.parse(row.answered_at)
    if (!Number.isFinite(at)) throw new Error(`select: answered_at is not a valid timestamp: ${JSON.stringify(row.answered_at)}`)
    if (at >= nowMs - days * DAY_MS) cooling.add(row.question_key)
  }
  return cooling
}

function tieRank(slot: { type: string; category: string }): number {
  return INTERVIEW_TIEBREAK_ORDER.findIndex((s) => s.type === slot.type && s.category === slot.category)
}

export type SelectQuestionsInput = {
  thinness: readonly SlotThinness[]
  cooldowns: readonly CooldownRow[]
  now: Date
  /** Defaults to the authored bank; a parameter so tests can pin a small one. */
  bank?: readonly InterviewQuestion[]
}

/** The 5..8 questions of the next round, in order, or `[]` when there is nothing thin enough to ask (§3.3 rule 5). */
export function selectQuestions({ thinness, cooldowns, now, bank = INTERVIEW_BANK }: SelectQuestionsInput): InterviewQuestion[] {
  const cooling = coolingDownKeys(cooldowns, now)

  const ranked = thinness
    .filter((s) => s.thin)
    .slice()
    .sort((a, b) => b.thinness - a.thinness || tieRank(a) - tieRank(b))

  const chosen: InterviewQuestion[] = []
  const chosenKeys = new Set<string>()
  const perType = new Map<string, number>()

  const take = (slot: SlotThinness): void => {
    if (chosen.length >= INTERVIEW_MAX_QUESTIONS) return
    if ((perType.get(slot.type) ?? 0) >= INTERVIEW_MAX_PER_TYPE) return
    const next = bank.find((q) => q.type === slot.type && q.slot === slot.category && !cooling.has(q.questionKey) && !chosenKeys.has(q.questionKey))
    if (!next) return // no eligible key: the slot is passed over
    chosen.push(next)
    chosenKeys.add(next.questionKey)
    perType.set(slot.type, (perType.get(slot.type) ?? 0) + 1)
  }

  for (const slot of ranked) take(slot) // pass 1
  for (const slot of ranked) if (slot.thinness === 1) take(slot) // pass 2

  if (chosen.length < INTERVIEW_MIN_QUESTIONS) return []
  return interviewSelectionSchema.parse(chosen)
}
