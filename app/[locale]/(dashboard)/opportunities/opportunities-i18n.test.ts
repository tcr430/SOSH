import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ADR 0021 §5.4/§9.3 (L-13) — the dismissal enum's five values, and every
// other opportunities string, must exist in all three locales SIMULTANEOUSLY.

function loadLocale(locale: string): Record<string, unknown> {
  const path = join(__dirname, '..', '..', '..', '..', 'i18n', locale, 'opportunities.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

function keySet(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const keys = new Set<string>()
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of keySet(v as Record<string, unknown>, path)) keys.add(nested)
    } else {
      keys.add(path)
    }
  }
  return keys
}

const LOCALES = ['en', 'pt', 'es']
const EXPECTED_DISMISS_REASONS = [
  'dismissReason.not_relevant',
  'dismissReason.already_covered',
  'dismissReason.too_sensitive',
  'dismissReason.wrong_timing',
  'dismissReason.weak_evidence',
]

describe('opportunities i18n — identical key sets across locales', () => {
  const loaded = Object.fromEntries(LOCALES.map(l => [l, loadLocale(l)]))
  const keySets = Object.fromEntries(LOCALES.map(l => [l, keySet(loaded[l])]))

  it('has the same keys in pt as en', () => {
    expect([...keySets.pt].sort()).toEqual([...keySets.en].sort())
  })

  it('has the same keys in es as en', () => {
    expect([...keySets.es].sort()).toEqual([...keySets.en].sort())
  })

  it.each(LOCALES)('%s carries all five dismissReason.* keys (§5.4 closed enum)', locale => {
    for (const key of EXPECTED_DISMISS_REASONS) {
      expect(keySets[locale].has(key)).toBe(true)
    }
  })
})

describe('opportunities i18n — namespace registered in i18n/request.ts', () => {
  const requestTs = readFileSync(join(__dirname, '..', '..', '..', '..', 'i18n', 'request.ts'), 'utf-8')

  it('imports opportunities.json', () => {
    expect(requestTs).toMatch(/import\(`\.\/\$\{locale\}\/opportunities\.json`\)/)
  })

  it('exposes it as messages.opportunities', () => {
    expect(requestTs).toMatch(/opportunities:\s*opportunities\.default/)
  })
})

describe('nav.opportunities key present in common.json for all locales', () => {
  it.each(LOCALES)('%s/common.json has nav.opportunities', locale => {
    const common = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '..', 'i18n', locale, 'common.json'), 'utf-8'),
    ) as { nav?: { opportunities?: string } }
    expect(typeof common.nav?.opportunities).toBe('string')
  })
})
