import {
  INTERVIEW_RECENCY_WINDOW_DAYS,
  INTERVIEW_RECENT_WEIGHT,
  INTERVIEW_SLOTS,
  INTERVIEW_SLOT_TARGETS,
  INTERVIEW_STALE_WEIGHT,
  INTERVIEW_THIN_THRESHOLD,
  type InterviewMemoryType,
  type InterviewSlot,
} from './constants'

// ADR 0029 §3.2 — the thinness function, PURE. `now` is a parameter: there is no hidden clock, so the same rows and the
// same instant always give the same answer (and the tests pin literal instants).
//
//   effective(s) = Σ w(row) over the ACTIVE, undeleted, unexpired rows of slot s, from EVERY source;
//                  w = 1 if recency_at ≥ now − 180 days, else 0.5
//   thinness(s)  = max(0, 1 − effective(s) / T(s))          thin iff thinness(s) ≥ 0.5
//
// The database read (lib/db/memory-*.ts, reached through lib/memory/interview-coverage.ts) already filters to active,
// undeleted, unexpired rows; this function filters AGAIN. That is deliberate: the count must be right even if a caller
// hands it an unfiltered set, and a candidate, retired, expired or deleted row counts ZERO here regardless of what the
// query did (INTERVIEW-SELECTION-BY-THINNESS).
//
// A timestamp that does not parse THROWS rather than being treated as old or absent — a silent zero weight would make a
// slot look thinner than it is and quietly re-ask a founder a question their memory already answers (the same rule
// lib/memory applies to recency).

const DAY_MS = 24 * 60 * 60 * 1000

/** One memory row reduced to the columns thinness reads. `category` is `category` (brand) or `kind` (audience, evidence). */
export type SlotRow = {
  type: InterviewMemoryType
  category: string
  status: string
  recencyAt: string
  expiresAt: string | null
  deletedAt: string | null
}

export type SlotThinness = {
  type: InterviewSlot['type']
  category: InterviewSlot['category']
  /** Σ w(row), a multiple of 0.5. */
  effective: number
  target: number
  thinness: number
  thin: boolean
}

function instant(value: string, label: string): number {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) throw new Error(`thinness: ${label} is not a valid timestamp: ${JSON.stringify(value)}`)
  return ms
}

function slotKey(type: string, category: string): string {
  return `${type}:${category}`
}

/** The weight of one row, or 0 if it does not count at all. */
export function rowWeight(row: SlotRow, nowMs: number): number {
  if (row.status !== 'active') return 0
  if (row.deletedAt !== null) return 0
  if (row.expiresAt !== null && instant(row.expiresAt, 'expiresAt') <= nowMs) return 0
  const recentSince = nowMs - INTERVIEW_RECENCY_WINDOW_DAYS * DAY_MS
  return instant(row.recencyAt, 'recencyAt') >= recentSince ? INTERVIEW_RECENT_WEIGHT : INTERVIEW_STALE_WEIGHT
}

/** thinness for every one of the eleven slots, in §3.1 order. A row in no slot (`other`) is ignored. */
export function computeSlotThinness(rows: readonly SlotRow[], now: Date): SlotThinness[] {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('thinness: now is not a valid date')

  const effective = new Map<string, number>()
  for (const row of rows) {
    const key = slotKey(row.type, row.category)
    if (!(key in INTERVIEW_SLOT_TARGETS)) continue
    effective.set(key, (effective.get(key) ?? 0) + rowWeight(row, nowMs))
  }

  return INTERVIEW_SLOTS.map((slot) => {
    const key = slotKey(slot.type, slot.category)
    const target = INTERVIEW_SLOT_TARGETS[key]
    const sum = effective.get(key) ?? 0
    const thinness = Math.max(0, 1 - sum / target)
    return { type: slot.type, category: slot.category, effective: sum, target, thinness, thin: thinness >= INTERVIEW_THIN_THRESHOLD }
  })
}
