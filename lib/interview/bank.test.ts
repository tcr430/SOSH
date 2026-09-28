import { describe, it, expect } from 'vitest'
import { INTERVIEW_BANK, INTERVIEW_BANK_SIZE, INTERVIEW_BANK_VERSION, questionMessagePath, whyMessagePath } from './bank'

// ADR 0029 §3.5 — the authored bank (structure). The locale half — every key has a question AND a why-line in en, pt AND
// es — is lib/i18n/interview-parity.test.ts; the two together are the bank half of constraint 42, which closes in M2.10
// with the UI strings. LITERAL: the eleven slots and their types are written out here, not read from constants.ts.

const SLOTS: Record<string, string> = {
  positioning: 'brand',
  capability: 'brand',
  pricing: 'brand',
  competitor: 'brand',
  problem: 'audience',
  objection: 'audience',
  question: 'audience',
  trigger: 'audience',
  quote: 'evidence',
  case_study: 'evidence',
  usage_data: 'evidence',
}

describe('the interview bank', () => {
  it('is version 1', () => {
    expect(INTERVIEW_BANK_VERSION).toBe(1)
  })

  it('has at least 3 keys for each of the eleven slots', () => {
    expect(Object.keys(SLOTS)).toHaveLength(11)
    for (const slot of Object.keys(SLOTS)) {
      expect(INTERVIEW_BANK.filter((e) => e.slot === slot).length, slot).toBeGreaterThanOrEqual(3)
    }
  })

  it('has at least 33 keys in total, and INTERVIEW_BANK_SIZE is that count', () => {
    expect(INTERVIEW_BANK.length).toBeGreaterThanOrEqual(33)
    expect(INTERVIEW_BANK_SIZE).toBe(INTERVIEW_BANK.length)
  })

  it('has no duplicate question key', () => {
    const keys = INTERVIEW_BANK.map((e) => e.questionKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("files every entry under a real slot with that slot's own type", () => {
    for (const e of INTERVIEW_BANK) {
      expect(SLOTS[e.slot], e.questionKey).toBe(e.type)
    }
  })

  it('uses only stable lowercase snake_case keys, each starting with its slot name', () => {
    for (const e of INTERVIEW_BANK) {
      expect(e.questionKey, e.questionKey).toMatch(/^[a-z]+(_[a-z]+)+$/)
      expect(e.questionKey.startsWith(`${e.slot}_`), e.questionKey).toBe(true)
    }
  })

  it('maps a key and a slot to their next-intl message paths', () => {
    expect(questionMessagePath('positioning_one_line')).toBe('questions.positioning_one_line')
    expect(whyMessagePath('positioning')).toBe('why.positioning')
  })
})
