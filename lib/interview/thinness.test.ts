import { describe, it, expect } from 'vitest'
import { computeSlotThinness, type SlotRow } from './thinness'

// ADR 0029 §3.2 — INTERVIEW-SELECTION-BY-THINNESS, the thinness half. [test-4]: every number below is a LITERAL written
// here, never recomputed from the module's own constants — a test that derives its expectation from the constant it
// checks passes for any value of that constant.
//
// NOW is pinned. Literal instants: 2026-03-30T12:00Z is EXACTLY 180 days before NOW, 2026-03-29T12:00Z is 181 days.

const NOW = new Date('2026-09-26T12:00:00.000Z')
const FRESH = '2026-09-01T00:00:00.000Z'
const EXACTLY_180_DAYS = '2026-03-30T12:00:00.000Z'
const DAYS_181 = '2026-03-29T12:00:00.000Z'

function row(over: Partial<SlotRow> = {}): SlotRow {
  return { type: 'brand', category: 'positioning', status: 'active', recencyAt: FRESH, expiresAt: null, deletedAt: null, ...over }
}

function slot(rows: SlotRow[], type: string, category: string) {
  const found = computeSlotThinness(rows, NOW).find((s) => s.type === type && s.category === category)
  if (!found) throw new Error(`no slot ${type}:${category}`)
  return found
}

describe('computeSlotThinness', () => {
  it('returns all eleven slots in the §3.1 order, with the §3.2 targets', () => {
    const all = computeSlotThinness([], NOW)
    expect(all.map((s) => `${s.type}:${s.category}:${s.target}`)).toEqual([
      'brand:positioning:2',
      'brand:capability:3',
      'brand:pricing:1',
      'brand:competitor:2',
      'audience:problem:3',
      'audience:objection:3',
      'audience:question:3',
      'audience:trigger:2',
      'evidence:quote:2',
      'evidence:case_study:2',
      'evidence:usage_data:2',
    ])
  })

  it('an empty memory is thinness 1.0 and thin in every slot', () => {
    for (const s of computeSlotThinness([], NOW)) {
      expect(s.effective).toBe(0)
      expect(s.thinness).toBe(1)
      expect(s.thin).toBe(true)
    }
  })

  it('positioning with effective 1 and target 2 is thinness 0.5 and THIN (the boundary is inclusive)', () => {
    const s = slot([row()], 'brand', 'positioning')
    expect(s.effective).toBe(1)
    expect(s.thinness).toBe(0.5)
    expect(s.thin).toBe(true)
  })

  it('positioning with effective 1.5 (one fresh + one stale) is thinness 0.25 and NOT thin', () => {
    const s = slot([row(), row({ recencyAt: DAYS_181 })], 'brand', 'positioning')
    expect(s.effective).toBe(1.5)
    expect(s.thinness).toBe(0.25)
    expect(s.thin).toBe(false)
  })

  it('a row exactly 180 days old weighs 1; a row 181 days old weighs 0.5', () => {
    expect(slot([row({ recencyAt: EXACTLY_180_DAYS })], 'brand', 'positioning').effective).toBe(1)
    expect(slot([row({ recencyAt: DAYS_181 })], 'brand', 'positioning').effective).toBe(0.5)
  })

  it('pricing (target 1) with one fresh active row is thinness 0', () => {
    const s = slot([row({ category: 'pricing' })], 'brand', 'pricing')
    expect(s.effective).toBe(1)
    expect(s.thinness).toBe(0)
    expect(s.thin).toBe(false)
  })

  it('thinness never goes below 0 (effective above target)', () => {
    const rows = [row(), row(), row()]
    const s = slot(rows, 'brand', 'positioning')
    expect(s.effective).toBe(3)
    expect(s.thinness).toBe(0)
  })

  it('capability (target 3): one fresh row is thin, two are not', () => {
    expect(slot([row({ category: 'capability' })], 'brand', 'capability').thin).toBe(true)
    expect(slot([row({ category: 'capability' }), row({ category: 'capability' })], 'brand', 'capability').thin).toBe(false)
  })

  it('a candidate, retired, rejected, deleted or expired row counts ZERO', () => {
    for (const over of [
      { status: 'candidate' },
      { status: 'retired' },
      { status: 'rejected' },
      { deletedAt: '2026-09-01T00:00:00.000Z' },
      { expiresAt: '2026-09-25T00:00:00.000Z' },
      { expiresAt: '2026-09-26T12:00:00.000Z' }, // expires exactly now: expired
    ] as Partial<SlotRow>[]) {
      const s = slot([row(over)], 'brand', 'positioning')
      expect(s.effective, JSON.stringify(over)).toBe(0)
      expect(s.thinness, JSON.stringify(over)).toBe(1)
    }
  })

  it('a row that expires one millisecond after now still counts', () => {
    expect(slot([row({ expiresAt: '2026-09-26T12:00:00.001Z' })], 'brand', 'positioning').effective).toBe(1)
  })

  it('counts rows of every source alike, and keeps the three types apart', () => {
    // The same category name never crosses a type: an audience "question" is not brand anything.
    const rows: SlotRow[] = [
      row({ type: 'audience', category: 'objection' }),
      row({ type: 'evidence', category: 'quote' }),
    ]
    expect(slot(rows, 'audience', 'objection').effective).toBe(1)
    expect(slot(rows, 'evidence', 'quote').effective).toBe(1)
    expect(slot(rows, 'brand', 'positioning').effective).toBe(0)
  })

  it("ignores a row in the 'other' category (no slot)", () => {
    const all = computeSlotThinness([row({ category: 'other' })], NOW)
    expect(all.every((s) => s.effective === 0)).toBe(true)
  })

  it('throws on a timestamp that does not parse instead of scoring it zero', () => {
    expect(() => computeSlotThinness([row({ recencyAt: 'not a date' })], NOW)).toThrow(/recencyAt/)
    expect(() => computeSlotThinness([row({ expiresAt: 'nope' })], NOW)).toThrow(/expiresAt/)
    expect(() => computeSlotThinness([], new Date('nope'))).toThrow(/now/)
  })

  it('has no hidden clock: the same rows and the same now give the same answer, a later now can change it', () => {
    const rows = [row({ recencyAt: EXACTLY_180_DAYS })]
    expect(computeSlotThinness(rows, NOW)).toEqual(computeSlotThinness(rows, NOW))
    const oneMinuteLater = new Date('2026-09-26T12:01:00.000Z')
    expect(slot(rows, 'brand', 'positioning').effective).toBe(1)
    expect(computeSlotThinness(rows, oneMinuteLater).find((s) => s.category === 'positioning')?.effective).toBe(0.5)
  })
})
