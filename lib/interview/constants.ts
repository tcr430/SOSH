// ADR 0029 — the founder input engine. Every number here is TRANSCRIBED from the ADR, never
// re-derived, and none is read from the environment (config.ts is for secrets and deployment
// facts; these are product rules with a named ADR section and a named loser).
//
// A value that is ALSO enforced in SQL (confidence, expiry, the 5..8 CHECK, the length bounds)
// is documented here for the TypeScript callers and enforced by the migration that owns it —
// this file is never the enforcement point for a governance field.

// ─── Slots (§3.1) ────────────────────────────────────────────────────────────
// The domain enums of ADR 0016 §3.1–§3.3, less 'other'. This is the §3.1 listing order; the
// selection's tie-break is INTERVIEW_TIEBREAK_ORDER below, which is NOT this order (see there).
export const INTERVIEW_MEMORY_TYPES = ['brand', 'audience', 'evidence'] as const
export type InterviewMemoryType = (typeof INTERVIEW_MEMORY_TYPES)[number]

export const INTERVIEW_SLOTS = [
  { type: 'brand', category: 'positioning' },
  { type: 'brand', category: 'capability' },
  { type: 'brand', category: 'pricing' },
  { type: 'brand', category: 'competitor' },
  { type: 'audience', category: 'problem' },
  { type: 'audience', category: 'objection' },
  { type: 'audience', category: 'question' },
  { type: 'audience', category: 'trigger' },
  { type: 'evidence', category: 'quote' },
  { type: 'evidence', category: 'case_study' },
  { type: 'evidence', category: 'usage_data' },
] as const
export type InterviewSlot = (typeof INTERVIEW_SLOTS)[number]

// §3.3 rule 1 / §3.4 — the tie-break among slots of EQUAL thinness: type brand > audience > evidence, then a category
// order. ADR 0029 §3.3 says that category order is "the category order of §3.1", but §3.4 (and the M2.7 build-guide
// test) pin the first round over empty memory to brand positioning, capability, COMPETITOR; audience OBJECTION,
// problem, question; evidence CASE_STUDY, USAGE_DATA. The §3.1 listing order (pricing before competitor, problem
// before objection, quote first) cannot produce that under the per-type cap of 3 and the stop at 8. The two sections
// contradict each other; this constant is the order that reproduces the pinned §3.4 outcome, and the contradiction is
// reported for an ADR amendment rather than resolved here. It is a priority order, not a claim about importance.
export const INTERVIEW_TIEBREAK_ORDER: readonly InterviewSlot[] = [
  { type: 'brand', category: 'positioning' },
  { type: 'brand', category: 'capability' },
  { type: 'brand', category: 'competitor' },
  { type: 'brand', category: 'pricing' },
  { type: 'audience', category: 'objection' },
  { type: 'audience', category: 'problem' },
  { type: 'audience', category: 'question' },
  { type: 'audience', category: 'trigger' },
  { type: 'evidence', category: 'case_study' },
  { type: 'evidence', category: 'usage_data' },
  { type: 'evidence', category: 'quote' },
]

// ─── Thinness (§3.2) ─────────────────────────────────────────────────────────
// Target T(s) per slot: the effective (recency-weighted) count at which a slot is "covered".
// brand: positioning 2, capability 3, pricing 1, competitor 2
// audience: problem 3, objection 3, question 3, trigger 2
// evidence: quote 2, case_study 2, usage_data 2
export const INTERVIEW_SLOT_TARGETS: Readonly<Record<string, number>> = {
  'brand:positioning': 2,
  'brand:capability': 3,
  'brand:pricing': 1,
  'brand:competitor': 2,
  'audience:problem': 3,
  'audience:objection': 3,
  'audience:question': 3,
  'audience:trigger': 2,
  'evidence:quote': 2,
  'evidence:case_study': 2,
  'evidence:usage_data': 2,
}

/** §3.2: a row whose recency_at is within this many days (inclusive) weighs 1; older weighs 0.5. */
export const INTERVIEW_RECENCY_WINDOW_DAYS = 180
export const INTERVIEW_RECENT_WEIGHT = 1
export const INTERVIEW_STALE_WEIGHT = 0.5

/** §3.2: a slot is thin iff thinness(s) >= this. Exactly at the threshold is thin. */
export const INTERVIEW_THIN_THRESHOLD = 0.5

// ─── Selection (§3.3, §3.6) ──────────────────────────────────────────────────
/** §3.3 rule 4: at most this many questions of one memory type per round. */
export const INTERVIEW_MAX_PER_TYPE = 3
/** §3.3 rule 5 / §3.6: fewer than this many selected questions means no round. */
export const INTERVIEW_MIN_QUESTIONS = 5
/** §3.3 rule 4 / §3.6: a round never holds more than this many questions. */
export const INTERVIEW_MAX_QUESTIONS = 8
/** §3.3: a key answered inside this window is not eligible again. */
export const INTERVIEW_ANSWERED_COOLDOWN_DAYS = 180
/** §3.3: a key skipped inside this window is not eligible again. */
export const INTERVIEW_SKIPPED_COOLDOWN_DAYS = 60
/**
 * §5.1 / founder ruling A-7(a) (Session 35-D D4): at most this many rounds may be CREATED per business per 30
 * days. A `failed` round does not block a new round, but this ceiling keeps A-4's spend bound structural
 * (<= 2 x 30 cents of extraction per 30 days, no fifth budget purpose). Enforced in SQL by
 * create_interview_round (its own literal 2); the derived INTERVIEW_COOLDOWN_ROW_CAP reads this value.
 */
export const INTERVIEW_MAX_ROUNDS_PER_30_DAYS = 2

/**
 * §9.5 (Session 35-D D3, MAJOR-1) — the row bound for listInterviewCooldownRows, a DEFENSIVE cap, not the
 * correctness mechanism. The WHERE clause (answered_at >= now - INTERVIEW_ANSWERED_COOLDOWN_DAYS) is what
 * keeps the read correct; this cap only bounds how many rows a correctly-windowed read could ever return.
 * Derived from "at most INTERVIEW_MAX_ROUNDS_PER_30_DAYS rounds created per 30 days" (create_interview_round's
 * 30-day rules) and "at most 8 questions per round": floor(180 / 30) = 6 thirty-day periods fit in the 180-day
 * window, and a period boundary can straddle one more, so (2 * 6 + 1) = 13 rounds, 13 * 8 = 104. This REPLACES
 * INTERVIEW_BANK_SIZE as the bound — the old bound truncated by ROW COUNT ordered by key (question_key ASC),
 * which silently dropped a late-sorting key's recent answer past ~33 total rows (Session 35 Reviewer,
 * MAJOR-1). Session 35-D D4 (founder ruling A-7(a)) re-derived it from 56 (one round per 30 days) to 104: a
 * `failed` round no longer blocks a new one, so two rounds can be created per 30 days. A realistic history
 * (most rounds are one, and a failed round holds no answered rows) never reaches the cap, so it is never the
 * thing actually doing the truncating.
 */
export const INTERVIEW_COOLDOWN_ROW_CAP = (INTERVIEW_MAX_ROUNDS_PER_30_DAYS * Math.floor(INTERVIEW_ANSWERED_COOLDOWN_DAYS / 30) + 1) * 8

// ─── Confidence (§2.6) — documented here, ENFORCED in SQL ───────────────────
// All below LEARN_PROMOTION_MIN_CONFIDENCE (0.7, lib/learning/promote.ts:16), so a founder
// statement never reads as settled as a promoted learned pattern.
export const INTERVIEW_CONFIDENCE: Readonly<Record<InterviewMemoryType, number>> = {
  brand: 0.6,
  audience: 0.5,
  evidence: 0.4,
}

// ─── Length bounds (§4.2, §7.1, §8.4) ───────────────────────────────────────
/** §7.1 / §6.2: a stored answer is at most this many characters (Zod and SQL). */
export const INTERVIEW_ANSWER_MAX_CHARS = 2000
/** §4.2: brand / audience record text. */
export const INTERVIEW_RECORD_TEXT_MAX_CHARS = 280
/** §4.2: evidence record text (equals its span). */
export const INTERVIEW_EVIDENCE_TEXT_MAX_CHARS = 500
/** §4.2: the verbatim answer substring a record is grounded in. */
export const INTERVIEW_SPAN_MAX_CHARS = 500
/** §4.2: at most this many records from one answer. */
export const INTERVIEW_MAX_ITEMS_PER_ANSWER = 3
/** §4.2: at most this many records from one round. */
export const INTERVIEW_MAX_ITEMS_PER_ROUND = 24
/** §4.5: existing active records of each type sent to the extraction call for conflict detection. */
export const INTERVIEW_CONFLICT_CONTEXT_PER_TYPE = 10
/** §4.2: `conflictsWith` ids per item. */
export const INTERVIEW_MAX_CONFLICTS_PER_ITEM = 3

// ─── Cost and bounds (§7.1, §7.2) ───────────────────────────────────────────
/** §7.1: the extraction call's output ceiling. */
export const INTERVIEW_MAX_TOKENS = 4500
/** §7.2: cents reserved per attempt — the worst case of §7.1 (ceil of 2.61 + 6.75). */
export const INTERVIEW_RESERVATION_CENTS = 10
/** §7.2: per-round ceiling on the round row — three attempts of the reservation. */
export const INTERVIEW_CEILING_CENTS = 30
/** §7.2: extraction attempts per round. */
export const INTERVIEW_MAX_ATTEMPTS = 3
/** §5.2 / §7.2: a round stuck in `extracting` this long may be re-claimed. */
export const INTERVIEW_RECLAIM_AFTER_MINUTES = 10

// ─── Cadence (§5.1, §5.8) ────────────────────────────────────────────────────
/** §5.1: a round is due only if none was created for the business in this many days (any status). */
export const INTERVIEW_DUE_AFTER_DAYS = 30
/** §5.8: "Not now" hides the card for this many days. */
export const INTERVIEW_SNOOZE_DAYS = 7

// ─── Retention (§5.4, §6.3, A-3) ─────────────────────────────────────────────
/** §6.3: raw answer text and grounding span are redacted this many days after the round is terminal. */
export const INTERVIEW_ANSWER_TTL_DAYS = 30

// ─── Bounded lists (§9.5) ────────────────────────────────────────────────────
/** rounds for a business, `created_at DESC`. */
export const INTERVIEW_ROUNDS_LIMIT = 12
/** answers for a round, by `position`. */
export const INTERVIEW_ANSWERS_LIMIT = 8
/** candidates for a round, per table, via the `interview_answer_id` index. */
export const INTERVIEW_CANDIDATES_LIMIT_PER_TABLE = 24
/** thinness counts, per table, over one business's active rows. */
export const INTERVIEW_THINNESS_ROW_LIMIT = 500

/**
 * §9.5 (Session 35-D D5) — the row bound for the ratify view's conflict-target read, one query per memory table: a round holds
 * at most INTERVIEW_CANDIDATES_LIMIT_PER_TABLE candidates per table and each names at most INTERVIEW_MAX_CONFLICTS_PER_ITEM
 * conflict ids (the writer's column CHECK allows 5; the extraction sends at most 3), so 24 * 3 = 72 targets is the ceiling.
 */
export const INTERVIEW_CONFLICT_TARGETS_LIMIT = INTERVIEW_CANDIDATES_LIMIT_PER_TABLE * INTERVIEW_MAX_CONFLICTS_PER_ITEM
