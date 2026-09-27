import { describe, it, expect } from 'vitest'
import { INTERVIEW_BANK, type InterviewQuestion } from './bank'
import { coolingDownKeys, interviewSelectionSchema, selectQuestions, type CooldownRow } from './select'
import { computeSlotThinness, type SlotThinness } from './thinness'

// ADR 0029 §3.3 / §3.4 / §3.6 — INTERVIEW-SELECTION-BY-THINNESS, INTERVIEW-NO-REPEAT and the Zod half of
// INTERVIEW-QUESTIONS-BOUNDED (Tier 2). [test-4]: LITERAL expectations — the first round is written out slot by slot, the
// cap of 3 and the stop at 8 are asserted as the numbers 3 and 8, not read back from constants.
//
// NOW = 2026-09-26T12:00Z. 2026-03-30T12:00Z is EXACTLY 180 days earlier (181 days: 2026-03-29T12:00Z);
// 2026-07-28T12:00Z is EXACTLY 60 days earlier (61 days: 2026-07-27T12:00Z).

const NOW = new Date('2026-09-26T12:00:00.000Z')

function thin(type: SlotThinness['type'], category: SlotThinness['category'], thinness: number): SlotThinness {
  return { type, category, effective: 0, target: 1, thinness, thin: thinness >= 0.5 }
}

// Every slot NOT thin, so a test names only the slots it wants thin.
const COVERED = computeSlotThinness([], NOW).map((s) => ({ ...s, thinness: 0, thin: false }))
function only(...thinSlots: SlotThinness[]): SlotThinness[] {
  return COVERED.map((s) => thinSlots.find((t) => t.type === s.type && t.category === s.category) ?? s)
}

const slotsOf = (qs: InterviewQuestion[]) => qs.map((q) => q.slot)
const keysOf = (qs: InterviewQuestion[]) => qs.map((q) => q.questionKey)

describe('selectQuestions — the first round over empty memory (§3.4)', () => {
  it('is EXACTLY brand positioning, capability, competitor; audience objection, problem, question; evidence case_study, usage_data', () => {
    const first = selectQuestions({ thinness: computeSlotThinness([], NOW), cooldowns: [], now: NOW })
    expect(slotsOf(first)).toEqual(['positioning', 'capability', 'competitor', 'objection', 'problem', 'question', 'case_study', 'usage_data'])
    expect(first.map((q) => q.type)).toEqual(['brand', 'brand', 'brand', 'audience', 'audience', 'audience', 'evidence', 'evidence'])
    expect(keysOf(first)).toEqual([
      'positioning_one_line',
      'capability_core',
      'competitor_alternatives',
      'objection_lost_deal',
      'problem_before',
      'question_first_call',
      'case_study_win',
      'usage_data_number',
    ])
  })

  it('is deterministic: the same inputs give the same questions in the same order', () => {
    const args = { thinness: computeSlotThinness([], NOW), cooldowns: [], now: NOW }
    expect(selectQuestions(args)).toEqual(selectQuestions(args))
  })
})

describe('selectQuestions — thin slots, ranking and the bounds', () => {
  it('four thin slots below thinness 1.0 give NO round (fewer than 5)', () => {
    const t = only(thin('brand', 'positioning', 0.5), thin('brand', 'competitor', 0.5), thin('audience', 'problem', 0.5), thin('evidence', 'quote', 0.5))
    expect(selectQuestions({ thinness: t, cooldowns: [], now: NOW })).toEqual([])
  })

  it('five thin slots below 1.0 give exactly five questions, one per slot', () => {
    const t = only(
      thin('brand', 'positioning', 0.5),
      thin('brand', 'competitor', 0.5),
      thin('audience', 'problem', 0.5),
      thin('audience', 'question', 0.5),
      thin('evidence', 'quote', 0.5),
    )
    expect(slotsOf(selectQuestions({ thinness: t, cooldowns: [], now: NOW }))).toEqual(['positioning', 'competitor', 'problem', 'question', 'quote'])
  })

  it('nothing thin gives no round', () => {
    expect(selectQuestions({ thinness: only(), cooldowns: [], now: NOW })).toEqual([])
  })

  it('ranks by thinness descending: an evidence slot at 0.75 comes before brand slots at 0.5', () => {
    const t = only(
      thin('brand', 'positioning', 0.5),
      thin('brand', 'capability', 0.5),
      thin('audience', 'problem', 0.5),
      thin('audience', 'question', 0.5),
      thin('evidence', 'quote', 0.75),
    )
    expect(slotsOf(selectQuestions({ thinness: t, cooldowns: [], now: NOW }))).toEqual(['quote', 'positioning', 'capability', 'problem', 'question'])
  })

  it('breaks a thinness tie brand -> audience -> evidence, whatever order the slots arrive in', () => {
    const t = only(
      thin('evidence', 'quote', 0.5),
      thin('audience', 'trigger', 0.5),
      thin('brand', 'pricing', 0.5),
      thin('evidence', 'usage_data', 0.5),
      thin('audience', 'question', 0.5),
    )
    const reversed = [...t].reverse()
    const expected = ['pricing', 'question', 'trigger', 'usage_data', 'quote']
    expect(slotsOf(selectQuestions({ thinness: t, cooldowns: [], now: NOW }))).toEqual(expected)
    expect(slotsOf(selectQuestions({ thinness: reversed, cooldowns: [], now: NOW }))).toEqual(expected)
  })

  it('caps a type at 3 questions per round: a fourth thin brand slot is dropped', () => {
    const t = only(
      thin('brand', 'positioning', 0.5),
      thin('brand', 'capability', 0.5),
      thin('brand', 'competitor', 0.5),
      thin('brand', 'pricing', 0.5),
      thin('audience', 'problem', 0.5),
      thin('audience', 'question', 0.5),
    )
    const picked = selectQuestions({ thinness: t, cooldowns: [], now: NOW })
    expect(picked.filter((q) => q.type === 'brand')).toHaveLength(3)
    expect(slotsOf(picked)).toEqual(['positioning', 'capability', 'competitor', 'problem', 'question'])
    expect(slotsOf(picked)).not.toContain('pricing')
  })

  it('pass 2 asks a SECOND question for slots at exactly thinness 1.0, in rank order, still under the per-type cap of 3', () => {
    const t = only(thin('brand', 'positioning', 1), thin('brand', 'capability', 1), thin('audience', 'objection', 1), thin('evidence', 'case_study', 1))
    // Pass 1 takes 4 (brand 2, audience 1, evidence 1). Pass 2, in rank order: positioning's second (brand now 3),
    // capability's second is REFUSED by the cap of 3, objection's second, case_study's second = 7.
    expect(keysOf(selectQuestions({ thinness: t, cooldowns: [], now: NOW }))).toEqual([
      'positioning_one_line',
      'capability_core',
      'objection_lost_deal',
      'case_study_win',
      'positioning_different',
      'objection_hesitation',
      'case_study_before_after',
    ])
  })

  it('pass 2 does NOT apply to a slot below 1.0', () => {
    const t = only(
      thin('brand', 'positioning', 0.75),
      thin('brand', 'capability', 0.75),
      thin('audience', 'objection', 0.75),
      thin('evidence', 'case_study', 0.75),
      thin('evidence', 'quote', 1),
    )
    const picked = selectQuestions({ thinness: t, cooldowns: [], now: NOW })
    // 4 at 0.75 + quote at 1.0 in pass 1, then quote's second in pass 2 = 6.
    expect(picked).toHaveLength(6)
    expect(picked.filter((q) => q.slot === 'positioning')).toHaveLength(1)
    expect(picked.filter((q) => q.slot === 'quote')).toHaveLength(2)
  })

  it('never exceeds 8 questions, even with all eleven slots thin and pass 2 available', () => {
    expect(selectQuestions({ thinness: computeSlotThinness([], NOW), cooldowns: [], now: NOW })).toHaveLength(8)
  })

  it('never repeats a key within a round', () => {
    const t = only(thin('brand', 'positioning', 1), thin('brand', 'capability', 1), thin('audience', 'objection', 1), thin('evidence', 'case_study', 1))
    const keys = keysOf(selectQuestions({ thinness: t, cooldowns: [], now: NOW }))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('selectQuestions — cooldowns (INTERVIEW-NO-REPEAT)', () => {
  const answered = (key: string, at: string): CooldownRow => ({ question_key: key, status: 'answered', answered_at: at })
  const skipped = (key: string, at: string): CooldownRow => ({ question_key: key, status: 'skipped', answered_at: at })
  const firstKey = (cooldowns: CooldownRow[]) =>
    keysOf(selectQuestions({ thinness: computeSlotThinness([], NOW), cooldowns, now: NOW })).find((k) => k.startsWith('positioning_'))

  it('a key answered exactly 180 days ago is still cooling down; at 181 days it is eligible again', () => {
    expect(firstKey([answered('positioning_one_line', '2026-03-30T12:00:00.000Z')])).toBe('positioning_different')
    expect(firstKey([answered('positioning_one_line', '2026-03-29T12:00:00.000Z')])).toBe('positioning_one_line')
  })

  it('a key skipped exactly 60 days ago is still cooling down; at 61 days it is eligible again', () => {
    expect(firstKey([skipped('positioning_one_line', '2026-07-28T12:00:00.000Z')])).toBe('positioning_different')
    expect(firstKey([skipped('positioning_one_line', '2026-07-27T12:00:00.000Z')])).toBe('positioning_one_line')
  })

  it('the two windows differ: a key answered 100 days ago is cooling, one skipped 100 days ago is not', () => {
    expect(firstKey([answered('positioning_one_line', '2026-06-18T12:00:00.000Z')])).toBe('positioning_different')
    expect(firstKey([skipped('positioning_one_line', '2026-06-18T12:00:00.000Z')])).toBe('positioning_one_line')
  })

  it('a slot whose EVERY key is cooling down is passed over, and the round is filled from the next thin slot', () => {
    const cooldowns = ['positioning_one_line', 'positioning_different', 'positioning_not_for'].map((k) => answered(k, '2026-09-01T00:00:00.000Z'))
    const picked = selectQuestions({ thinness: computeSlotThinness([], NOW), cooldowns, now: NOW })
    expect(slotsOf(picked)).not.toContain('positioning')
    // brand still gets its 3 (capability, competitor, pricing), audience 3, evidence 2 = 8.
    expect(slotsOf(picked)).toEqual(['capability', 'competitor', 'pricing', 'objection', 'problem', 'question', 'case_study', 'usage_data'])
  })

  it('ignores a cooldown row with no answered_at, and any status that is not answered or skipped', () => {
    expect(firstKey([{ question_key: 'positioning_one_line', status: 'answered', answered_at: null }])).toBe('positioning_one_line')
    expect(firstKey([{ question_key: 'positioning_one_line', status: 'pending', answered_at: '2026-09-25T00:00:00.000Z' }])).toBe('positioning_one_line')
  })

  it('a key with several rows cools down if ANY row is inside its window', () => {
    expect(
      firstKey([answered('positioning_one_line', '2025-01-01T00:00:00.000Z'), answered('positioning_one_line', '2026-09-01T00:00:00.000Z')]),
    ).toBe('positioning_different')
  })

  it('coolingDownKeys returns exactly the keys inside a window', () => {
    const cooling = coolingDownKeys(
      [answered('a', '2026-09-01T00:00:00.000Z'), skipped('b', '2026-09-01T00:00:00.000Z'), skipped('c', '2026-01-01T00:00:00.000Z'), answered('d', '2025-01-01T00:00:00.000Z')],
      NOW,
    )
    expect([...cooling].sort()).toEqual(['a', 'b'])
  })

  it('throws on an answered_at that does not parse', () => {
    expect(() => coolingDownKeys([answered('a', 'garbage')], NOW)).toThrow(/answered_at/)
  })
})

describe('interviewSelectionSchema — the Zod half of INTERVIEW-QUESTIONS-BOUNDED', () => {
  const q = (i: number) => ({ questionKey: `k${i}`, type: 'brand' as const, slot: 'positioning' as const })
  const n = (count: number) => Array.from({ length: count }, (_, i) => q(i))

  it('accepts 5 through 8 questions', () => {
    for (const count of [5, 6, 7, 8]) expect(interviewSelectionSchema.safeParse(n(count)).success, `${count}`).toBe(true)
  })

  it('rejects 0, 4 and 9 questions', () => {
    for (const count of [0, 4, 9]) expect(interviewSelectionSchema.safeParse(n(count)).success, `${count}`).toBe(false)
  })

  it('rejects a repeated key', () => {
    expect(interviewSelectionSchema.safeParse([...n(4), q(0)]).success).toBe(false)
  })

  it('rejects an unknown slot, an unknown type and an extra field', () => {
    expect(interviewSelectionSchema.safeParse([...n(4), { ...q(9), slot: 'other' }]).success).toBe(false)
    expect(interviewSelectionSchema.safeParse([...n(4), { ...q(9), type: 'performance' }]).success).toBe(false)
    expect(interviewSelectionSchema.safeParse([...n(4), { ...q(9), confidence: 0.9 }]).success).toBe(false)
  })

  it('every selection the function returns passes the schema', () => {
    const picked = selectQuestions({ thinness: computeSlotThinness([], NOW), cooldowns: [], now: NOW })
    expect(interviewSelectionSchema.safeParse(picked).success).toBe(true)
  })
})

describe('selectQuestions — the bank is a parameter', () => {
  it('draws only from the bank it is given', () => {
    const tiny: InterviewQuestion[] = INTERVIEW_BANK.filter((e) => e.slot === 'positioning' || e.slot === 'capability')
    // Two slots with three keys each, all-thin at 1.0: pass 1 -> 2, pass 2 -> 2 more = 4 (< 5): no round.
    const t = only(thin('brand', 'positioning', 1), thin('brand', 'capability', 1))
    expect(selectQuestions({ thinness: t, cooldowns: [], now: NOW, bank: tiny })).toEqual([])
  })
})

// ═══ MAJOR-1 (Session 35-D · D3): the cooldown query's REAL shape, not just a row-count limit ═══════════════
// Reviewer: past ~33 total answered/skipped rows (about five monthly rounds), a row-count-only LIMIT ordered
// by question_key ASC drops a late-sorting key's row entirely, so selectQuestions wrongly treats it as never
// asked. This drives the REAL selectQuestions through TEN monthly rounds (the real one-round-per-30-days
// cadence), with the cooldown rows re-derived EACH round by applying the query's real WHERE/ORDER BY/LIMIT
// shape to the accumulated history — literal 180 and literal limits, never imported from constants.ts (this
// file's own [test-4] rule) — and proves the OLD shape re-selects usage_data_number 31 days after its own
// answer, while the FIXED shape (a time WHERE before the LIMIT) does not.
describe('MAJOR-1 fix — a late-sorting key (usage_data_number) survives a >33-row history', () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const START = new Date('2025-01-01T00:00:00.000Z')
  const ALWAYS_THIN = computeSlotThinness([], START) // rows=[] -> thinness 1 for every slot, independent of `now`

  function byKeyAscThenRecencyDesc(a: CooldownRow, b: CooldownRow): number {
    if (a.question_key !== b.question_key) return a.question_key < b.question_key ? -1 : 1
    return Date.parse(b.answered_at as string) - Date.parse(a.answered_at as string)
  }

  /** The BUGGY shape the Reviewer found: ROW-COUNT limit only, no time filter. */
  function oldRowLimitedQuery(history: readonly CooldownRow[], limit: number): CooldownRow[] {
    return history.slice().sort(byKeyAscThenRecencyDesc).slice(0, limit)
  }

  /** The FIXED shape (lib/db/founder-interview-answers.ts, D3): a time WHERE, THEN the row limit. */
  function fixedWindowedQuery(history: readonly CooldownRow[], now: Date, limit: number): CooldownRow[] {
    const cutoffMs = now.getTime() - 180 * MS_PER_DAY // literal: mirrors INTERVIEW_ANSWERED_COOLDOWN_DAYS
    return history
      .filter((r) => r.answered_at !== null && Date.parse(r.answered_at) >= cutoffMs)
      .sort(byKeyAscThenRecencyDesc)
      .slice(0, limit)
  }

  function driveTenMonthlyRounds(query: (history: CooldownRow[], now: Date) => CooldownRow[]): { history: CooldownRow[]; lastAnsweredAt: Record<string, string> } {
    const history: CooldownRow[] = []
    const lastAnsweredAt: Record<string, string> = {}
    for (let round = 0; round < 10; round++) {
      const now = new Date(START.getTime() + round * 30 * MS_PER_DAY)
      const cooldowns = query(history, now)
      const selected = selectQuestions({ thinness: ALWAYS_THIN, cooldowns, now })
      for (const q of selected) {
        history.push({ question_key: q.questionKey, status: 'answered', answered_at: now.toISOString() })
        lastAnsweredAt[q.questionKey] = now.toISOString()
      }
    }
    return { history, lastAnsweredAt }
  }

  it('reproduces the bug: the OLD row-count-only LIMIT (33) wrongly re-selects usage_data_number 31 days after its own recent answer', () => {
    const { history, lastAnsweredAt } = driveTenMonthlyRounds((h) => oldRowLimitedQuery(h, 33))
    expect(history.length, 'the seeded history must exceed the old 33-row bound').toBeGreaterThan(33)
    expect(lastAnsweredAt.usage_data_number, 'usage_data_number must have been answered at least once').toBeDefined()

    const recheckNow = new Date(Date.parse(lastAnsweredAt.usage_data_number) + 31 * MS_PER_DAY)
    const cooldowns = oldRowLimitedQuery(history, 33)
    const reselected = selectQuestions({ thinness: ALWAYS_THIN, cooldowns, now: recheckNow })
    expect(keysOf(reselected)).toContain('usage_data_number')
  })

  it('the fix: a time-windowed query (180d WHERE, THEN the row limit) correctly excludes usage_data_number 31 days after its own recent answer', () => {
    const { history, lastAnsweredAt } = driveTenMonthlyRounds((h, now) => fixedWindowedQuery(h, now, 56))
    expect(history.length, 'the seeded history must exceed the old 33-row bound').toBeGreaterThan(33)
    expect(lastAnsweredAt.usage_data_number, 'usage_data_number must have been answered at least once').toBeDefined()

    const recheckNow = new Date(Date.parse(lastAnsweredAt.usage_data_number) + 31 * MS_PER_DAY)
    const cooldowns = fixedWindowedQuery(history, recheckNow, 56)
    const reselected = selectQuestions({ thinness: ALWAYS_THIN, cooldowns, now: recheckNow })
    expect(keysOf(reselected)).not.toContain('usage_data_number')
  })
})
