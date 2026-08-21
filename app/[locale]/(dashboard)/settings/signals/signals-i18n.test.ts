import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ADR 0020 A-3, SIGNAL-RETENTION-UNCLAIMED — the reaper does not exist, so a
// stated retention period anywhere in customer-facing copy would be a false
// statement to a regulator. This scan is the enforcement mechanism, not a
// nicety: it fails the build the moment any locale gains a "we keep signals
// for N days" style string.

function loadLocale(locale: string): Record<string, unknown> {
  const path = join(__dirname, '..', '..', '..', '..', '..', 'i18n', locale, 'signals.json')
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

describe('signals i18n — identical key sets across locales', () => {
  const loaded = Object.fromEntries(LOCALES.map((l) => [l, loadLocale(l)]))
  const keySets = Object.fromEntries(LOCALES.map((l) => [l, keySet(loaded[l])]))

  it('has the same keys in pt as en', () => {
    expect([...keySets.pt].sort()).toEqual([...keySets.en].sort())
  })

  it('has the same keys in es as en', () => {
    expect([...keySets.es].sort()).toEqual([...keySets.en].sort())
  })
})

describe('signals i18n — no retention figure anywhere (A-3, SIGNAL-RETENTION-UNCLAIMED)', () => {
  // Deliberately broad: any digit adjacent to a time-unit word, near a
  // retention-flavoured verb, in any of the three languages. A false
  // positive here just means re-wording copy that was never claiming a
  // retention period in the first place — cheap. A false negative would
  // ship a regulator-facing lie.
  const RETENTION_PATTERN =
    /\b\d+[\s-]*(day|days|dia|dias|month|months|mes|meses|año|anos|year|years)\b/i

  it.each(LOCALES)('%s/signals.json contains no retention figure', (locale) => {
    const raw = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'i18n', locale, 'signals.json'), 'utf-8')
    expect(raw).not.toMatch(RETENTION_PATTERN)
  })
})

describe('signals i18n — namespace registered in i18n/request.ts', () => {
  const requestTs = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'i18n', 'request.ts'), 'utf-8')

  it('imports signals.json', () => {
    expect(requestTs).toMatch(/import\(`\.\/\$\{locale\}\/signals\.json`\)/)
  })

  it('exposes it as messages.signals', () => {
    expect(requestTs).toMatch(/signals:\s*signals\.default/)
  })
})
