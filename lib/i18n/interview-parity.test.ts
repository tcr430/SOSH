import { describe, it, expect } from 'vitest'
import en from '@/i18n/en/interview.json'
import pt from '@/i18n/pt/interview.json'
import es from '@/i18n/es/interview.json'
import { INTERVIEW_BANK } from '@/lib/interview/bank'

// ADR 0029 §3.5 / §8.7 (Session 35 M2.7) — INTERVIEW-QUESTIONS-BOUNDED's locale half and the bank half of constraint 42.
// Question text and the per-slot "why we ask" line exist in en, pt AND es SIMULTANEOUSLY with identical keys, and every
// key of the authored bank has a question in every locale. The UI strings of M2.10 join this namespace later; this file
// then carries their parity too. Lives under lib/i18n/ so vitest's include glob executes it (ADR 0015).

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj }
  if (typeof obj !== 'object' || obj === null) return {}
  return Object.assign({}, ...Object.entries(obj).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]))].sort()
}

const LOCALES = { en: flatten(en), pt: flatten(pt), es: flatten(es) } as const
const SLOTS = ['positioning', 'capability', 'pricing', 'competitor', 'problem', 'objection', 'question', 'trigger', 'quote', 'case_study', 'usage_data']

describe('interview i18n parity', () => {
  it('pt and es have EXACTLY the same key set as en', () => {
    expect(Object.keys(LOCALES.pt).sort()).toEqual(Object.keys(LOCALES.en).sort())
    expect(Object.keys(LOCALES.es).sort()).toEqual(Object.keys(LOCALES.en).sort())
  })

  it('every key of the authored bank has a non-empty question in en, pt AND es', () => {
    expect(INTERVIEW_BANK.length).toBeGreaterThanOrEqual(33)
    for (const [locale, messages] of Object.entries(LOCALES)) {
      for (const entry of INTERVIEW_BANK) {
        const text = messages[`questions.${entry.questionKey}`]
        expect(text, `${locale}: questions.${entry.questionKey}`).toBeTruthy()
        expect(text.trim().length, `${locale}: questions.${entry.questionKey}`).toBeGreaterThan(10)
      }
    }
  })

  it('every one of the eleven slots has a non-empty why-we-ask line in en, pt AND es', () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      for (const slot of SLOTS) {
        expect(messages[`why.${slot}`], `${locale}: why.${slot}`).toBeTruthy()
      }
    }
  })

  it('has no orphan question key: every questions.* entry belongs to a bank key', () => {
    const bankKeys = new Set(INTERVIEW_BANK.map((e) => `questions.${e.questionKey}`))
    for (const key of Object.keys(LOCALES.en).filter((k) => k.startsWith('questions.'))) {
      expect(bankKeys.has(key), key).toBe(true)
    }
  })

  it('every key uses the same placeholders in all three locales', () => {
    for (const key of Object.keys(LOCALES.en)) {
      const expected = placeholders(LOCALES.en[key])
      expect(placeholders(LOCALES.pt[key]), `pt ${key}`).toEqual(expected)
      expect(placeholders(LOCALES.es[key]), `es ${key}`).toEqual(expected)
    }
  })

  it('a translation is not just the English text pasted in (a missed translation)', () => {
    for (const key of Object.keys(LOCALES.en)) {
      expect(LOCALES.pt[key], `pt ${key}`).not.toBe(LOCALES.en[key])
      expect(LOCALES.es[key], `es ${key}`).not.toBe(LOCALES.en[key])
    }
  })
})
