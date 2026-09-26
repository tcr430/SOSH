import type { InterviewMemoryType, InterviewSlot } from './constants'

// ADR 0029 §3.5 — the AUTHORED question bank. A typed constant, never model-written (the ADR's named loser: a model
// ahead of the human, three locales nobody can verify, a per-round cost, and an injection path from memory rows into
// the question itself). The bank holds only { questionKey, type, slot }; the question text and the per-slot "why we
// ask" line live in the next-intl namespace i18n/{en,pt,es}/interview.json under `questions.<questionKey>` and
// `why.<slot>`. An answer row stores `question_key` and `bank_version`.
//
// A question key is a STABLE identifier: it is what the cooldown (§3.3) and the answer rows refer to, so once shipped
// it is never renamed or reused for a different question. Changing a question's MEANING means a new key and a bump of
// INTERVIEW_BANK_VERSION; a wording fix in a locale file does not.
//
// Every slot category is unique across the three types (brand/audience/evidence share none), so `slot` alone names
// the "why we ask" line. Within a slot, ORDER IS PRIORITY: the selection (select.ts) offers the first eligible key
// first, so the first entry of each slot is the one a first-time founder sees.

export const INTERVIEW_BANK_VERSION = 1

export type InterviewQuestion = {
  questionKey: string
  type: InterviewMemoryType
  slot: InterviewSlot['category']
}

function slotKeys(type: InterviewMemoryType, slot: InterviewSlot['category'], keys: readonly string[]): InterviewQuestion[] {
  return keys.map((questionKey) => ({ questionKey, type, slot }))
}

export const INTERVIEW_BANK: readonly InterviewQuestion[] = [
  ...slotKeys('brand', 'positioning', ['positioning_one_line', 'positioning_different', 'positioning_not_for']),
  ...slotKeys('brand', 'capability', ['capability_core', 'capability_underrated', 'capability_recent']),
  ...slotKeys('brand', 'pricing', ['pricing_model', 'pricing_who_pays', 'pricing_change']),
  ...slotKeys('brand', 'competitor', ['competitor_alternatives', 'competitor_switch', 'competitor_wrong']),
  ...slotKeys('audience', 'problem', ['problem_before', 'problem_cost', 'problem_workaround']),
  ...slotKeys('audience', 'objection', ['objection_lost_deal', 'objection_hesitation', 'objection_answer']),
  ...slotKeys('audience', 'question', ['question_first_call', 'question_repeated', 'question_misunderstood']),
  ...slotKeys('audience', 'trigger', ['trigger_moment', 'trigger_event', 'trigger_search']),
  ...slotKeys('evidence', 'quote', ['quote_customer_words', 'quote_praise', 'quote_review']),
  ...slotKeys('evidence', 'case_study', ['case_study_win', 'case_study_before_after', 'case_study_surprise']),
  ...slotKeys('evidence', 'usage_data', ['usage_data_number', 'usage_data_trend', 'usage_data_behaviour']),
]

/** §9.5: the cooldown lookup (listInterviewCooldownRows) is bounded at the size of the bank. */
export const INTERVIEW_BANK_SIZE = INTERVIEW_BANK.length

/** The next-intl message paths (relative to the `interview` namespace) for a bank entry. */
export function questionMessagePath(questionKey: string): string {
  return `questions.${questionKey}`
}
export function whyMessagePath(slot: InterviewSlot['category']): string {
  return `why.${slot}`
}
