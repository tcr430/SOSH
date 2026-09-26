import { INTERVIEW_DUE_AFTER_DAYS, INTERVIEW_MIN_QUESTIONS } from './constants'

// ADR 0029 §5.1 — when a round is DUE, computed on read by a PURE function (the /interview page and the card). No cron
// creates rounds; the round row exists only when an author clicks Start (create_interview_round).
//
// due  <=>  no round created for the business in the last 30 days (ANY status)
//           AND the §3.3 selection yields >= 5 questions
//           AND businesses.interview_snoozed_until is NULL or past.
//
// The 30-day boundary matches create_interview_round, which refuses on `created_at > now() - interval '30 days'`: a
// round created exactly 30 days ago no longer blocks, one created 29 days ago still does. Likewise the snooze RPC
// treats `interview_snoozed_until <= now()` as expired, so a snooze that ends exactly now is over.

const DAY_MS = 24 * 60 * 60 * 1000

export type InterviewDueInput = {
  now: Date
  /** created_at of the business's most recent round of ANY status, or null if it has never had one. */
  lastRoundCreatedAt: string | null
  /** businesses.interview_snoozed_until. */
  snoozedUntil: string | null
  /** How many questions selectQuestions returned (0 when there is nothing thin). */
  selectedQuestionCount: number
}

function instant(value: string, label: string): number {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) throw new Error(`due: ${label} is not a valid timestamp: ${JSON.stringify(value)}`)
  return ms
}

export function isInterviewDue({ now, lastRoundCreatedAt, snoozedUntil, selectedQuestionCount }: InterviewDueInput): boolean {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('due: now is not a valid date')

  if (lastRoundCreatedAt !== null && instant(lastRoundCreatedAt, 'lastRoundCreatedAt') > nowMs - INTERVIEW_DUE_AFTER_DAYS * DAY_MS) return false
  if (snoozedUntil !== null && instant(snoozedUntil, 'snoozedUntil') > nowMs) return false
  return selectedQuestionCount >= INTERVIEW_MIN_QUESTIONS
}
