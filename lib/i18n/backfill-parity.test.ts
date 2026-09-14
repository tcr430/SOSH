import { describe, it, expect } from 'vitest'
import en from '@/i18n/en/common.json'
import pt from '@/i18n/pt/common.json'
import es from '@/i18n/es/common.json'

// ADR 0025 §10.5 (Session 32 I2.14) — BACKFILL-I18N-PARITY: every key under
// onboarding.backfill exists in en, pt AND es, and no key exists in only one.
// Lives under lib/i18n/ (not i18n/) so vitest's `include` glob
// (app/**, lib/**, components/**, ...) actually executes it — ADR 0015's
// AUTHORED-NOT-EXECUTED concern.

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('onboarding.backfill i18n parity', () => {
  const enKeys = flattenKeys(en.onboarding.backfill).sort()

  it('en has at least the expected top-level groups', () => {
    expect(enKeys.length).toBeGreaterThan(10)
  })

  it('pt has exactly the same key set as en (no missing/extra keys)', () => {
    expect(flattenKeys(pt.onboarding.backfill).sort()).toEqual(enKeys)
  })

  it('es has exactly the same key set as en (no missing/extra keys)', () => {
    expect(flattenKeys(es.onboarding.backfill).sort()).toEqual(enKeys)
  })

  it('no locale hardcodes English copy (pt/es differ from en for every leaf key)', () => {
    for (const key of enKeys) {
      const get = (obj: Record<string, unknown>) =>
        key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], obj)
      const enValue = get(en.onboarding.backfill as Record<string, unknown>)
      const ptValue = get(pt.onboarding.backfill as Record<string, unknown>)
      const esValue = get(es.onboarding.backfill as Record<string, unknown>)
      expect(ptValue, `pt.${key} should not equal the English string`).not.toBe(enValue)
      expect(esValue, `es.${key} should not equal the English string`).not.toBe(enValue)
    }
  })
})
