import { describe, it, expect } from 'vitest'
import en from '@/i18n/en/agency.json'
import pt from '@/i18n/pt/agency.json'
import es from '@/i18n/es/agency.json'

// ADR 0027 §4.6 / §4.8 (Session 34 K2.9) — AGENCY-CLAIM-CITED-NOT-SUPPORTED (21), the keys half. K2.10 renders them.
// The agency namespace exists in en, pt AND es SIMULTANEOUSLY with identical keys and placeholders, and the claim
// copy says "CITED" — never "verified" or "supported" — because verification proves PROVENANCE (the cited id was in
// the set sent to the model), not that the sentence follows from that evidence. Lives under lib/i18n/ so vitest's
// include glob executes it (ADR 0015).

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj }
  if (typeof obj !== 'object' || obj === null) return {}
  return Object.assign({}, ...Object.entries(obj).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)(?:,\s*plural)?/g)].map((m) => m[1]))].sort()
}

const E = flatten(en)
const P = flatten(pt)
const S = flatten(es)

// "verified"/"supported" and their pt/es stems. Applied to EVERY leaf, including the explainer: the one line that
// explains the difference must not itself use the word it is warning against.
const FORBIDDEN: Record<'en' | 'pt' | 'es', RegExp> = {
  en: /verif|support/i,
  pt: /verific|comprov|suport|valid/i,
  es: /verific|comprob|respald|soport|valid/i,
}

describe('agency i18n parity (claims)', () => {
  it('en has the expected claim keys', () => {
    for (const key of ['claims.heading', 'claims.cited', 'claims.uncited', 'claims.cited_unknown', 'claims.no_corpus', 'claims.not_checked', 'claims.no_claims', 'claims.cited_explainer', 'claims.summary', 'claims.actions.accept', 'claims.actions.edit', 'claims.actions.cite', 'claims.actions.dismiss']) {
      expect(E[key], key).toBeTruthy()
    }
  })

  it('pt and es have EXACTLY the same key set as en', () => {
    expect(Object.keys(P).sort()).toEqual(Object.keys(E).sort())
    expect(Object.keys(S).sort()).toEqual(Object.keys(E).sort())
  })

  it('every key uses the same placeholders in all three locales', () => {
    for (const key of Object.keys(E)) {
      expect(placeholders(P[key]), `pt ${key}`).toEqual(placeholders(E[key]))
      expect(placeholders(S[key]), `es ${key}`).toEqual(placeholders(E[key]))
    }
    expect(placeholders(E['claims.summary'])).toEqual(['cited', 'uncited', 'unknown'])
  })

  it('no locale leaves a leaf empty, and pt/es are actually translated', () => {
    for (const map of [E, P, S]) for (const [k, v] of Object.entries(map)) expect(v.trim().length, k).toBeGreaterThan(0)
    for (const key of Object.keys(E)) {
      expect(P[key], `pt ${key}`).not.toBe(E[key])
      expect(S[key], `es ${key}`).not.toBe(E[key])
    }
  })
})

describe('AGENCY-CLAIM-CITED-NOT-SUPPORTED — the vocabulary is "cited", in all three locales at once', () => {
  it.each([
    ['en', E, FORBIDDEN.en],
    ['pt', P, FORBIDDEN.pt],
    ['es', S, FORBIDDEN.es],
  ] as const)('%s: no leaf uses verified/supported vocabulary', (_l, map, forbidden) => {
    for (const [key, value] of Object.entries(map)) expect(forbidden.test(value), `${_l} ${key}: "${value}"`).toBe(false)
  })

  it('the positive label is the "cited" word in each locale', () => {
    expect(E['claims.cited']).toBe('Cited')
    expect(P['claims.cited']).toMatch(/^Citada$/)
    expect(S['claims.cited']).toMatch(/^Citada$/)
  })

  it('the affordance explains the difference in ONE line: cited means "given to the AI", not "confirmed by it"', () => {
    for (const [locale, map] of [['en', E], ['pt', P], ['es', S]] as const) {
      const line = map['claims.cited_explainer']
      expect(line.split('\n'), locale).toHaveLength(1)
      expect(line.length, locale).toBeLessThan(220)
    }
    expect(E['claims.cited_explainer']).toMatch(/given to the AI/)
    expect(E['claims.cited_explainer']).toMatch(/does not guarantee/)
  })

  it('the empty-corpus copy is its own state and never reads as a count of unsupported claims', () => {
    expect(E['claims.no_corpus']).toMatch(/claims not checked/)
    for (const map of [E, P, S]) {
      expect(map['claims.no_corpus']).not.toMatch(/\d|\{/)
      expect(map['claims.no_corpus']).not.toBe(map['claims.uncited'])
    }
  })

  it('the four human actions are all present: accept, edit, cite EXISTING evidence, dismiss (no "create")', () => {
    for (const map of [E, P, S]) {
      for (const a of ['accept', 'edit', 'cite', 'dismiss']) expect(map[`claims.actions.${a}`]).toBeTruthy()
    }
    expect(E['claims.actions.cite']).toMatch(/existing/i)
    expect(P['claims.actions.cite']).toMatch(/existente/i)
    expect(S['claims.actions.cite']).toMatch(/existente/i)
  })
})
