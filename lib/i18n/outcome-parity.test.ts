import { describe, it, expect } from 'vitest'
import en from '@/i18n/en/outcome.json'
import pt from '@/i18n/pt/outcome.json'
import es from '@/i18n/es/outcome.json'

// ADR 0026 §10.4 (Session 33 J2.12) — the outcome namespace exists in en, pt AND es with IDENTICAL keys, and every
// leaf uses the same ICU placeholders in every locale (a missing {n} would silently drop the evidence from a line).
// Lives under lib/i18n/ so vitest's include glob executes it (ADR 0015).

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj }
  if (typeof obj !== 'object' || obj === null) return {}
  return Object.assign({}, ...Object.entries(obj).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
}

// The variable names an ICU string uses, including those inside a plural.
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)(?:,\s*plural)?/g)].map((m) => m[1]))].sort()
}

const E = flatten(en)
const P = flatten(pt)
const S = flatten(es)

describe('outcome i18n parity', () => {
  it('en has the expected groups', () => {
    expect(Object.keys(E).length).toBeGreaterThan(60)
    for (const group of ['retrospective.', 'observed.', 'platform.', 'role.']) {
      expect(Object.keys(E).some((k) => k.startsWith(group))).toBe(true)
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
  })

  it('no locale leaves a leaf empty', () => {
    for (const map of [E, P, S]) for (const [k, v] of Object.entries(map)) expect(v.trim().length, k).toBeGreaterThan(0)
  })

  it('pt and es are translated: the prose leaves differ from en (platform names excepted)', () => {
    const exempt = (k: string) => k.startsWith('platform.')
    for (const key of Object.keys(E).filter((k) => !exempt(k))) {
      expect(P[key], `pt ${key}`).not.toBe(E[key])
      expect(S[key], `es ${key}`).not.toBe(E[key])
    }
  })
})
