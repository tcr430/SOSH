// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import en from '@/i18n/en/analytics.json'
import pt from '@/i18n/pt/analytics.json'
import es from '@/i18n/es/analytics.json'
import enCommon from '@/i18n/en/common.json'
import ptCommon from '@/i18n/pt/common.json'
import esCommon from '@/i18n/es/common.json'
import enOutcome from '@/i18n/en/outcome.json'
import { ACTIVE_NAV, COMING_SOON_NAV } from '@/components/layout/DashboardShell'

// ADR 0031 §10.6, §10.4, build-guide O2.6 — the analytics namespace exists in en, pt AND es with IDENTICAL keys and the same
// ICU placeholders; every key the view models emit resolves in all three; nav.team exists in all three (QA-MINOR-UI (1),
// the CI half of ANALYTICS-SHELL-320); analytics is live right after campaigns and inbox stays "coming soon".
// Lives under lib/i18n/ so vitest's include glob executes it (ADR 0015).

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj }
  if (typeof obj !== 'object' || obj === null) return {}
  return Object.assign({}, ...Object.entries(obj).map(([k, v]) => flatten(v, prefix ? prefix + '.' + k : k)))
}
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)/g)].map((m) => m[1]))].sort()

const E = flatten(en)
const P = flatten(pt)
const S = flatten(es)

// Every key lib/analytics/view-model.ts and load.ts emit, less the 'analytics.' prefix (the message root).
const EMITTED = [
  'typical', 'wins', 'state.thin', 'monthPair', 'monthPairSuppressed',
  'exclusions.summary', 'exclusions.excluded', 'exclusions.noDataReturned', 'exclusions.fieldMissing', 'exclusions.zeroImpressions', 'exclusions.notFinal',
  'disclosure.usual', 'disclosure.usualUpdates', 'disclosure.importSeed', 'disclosure.engagementOnly', 'disclosure.linkedinCount',
  'population.aiOnly', 'population.allMeasured', 'coverage', 'breakdown.row', 'interval', 'account.unrecorded',
]

describe('analytics i18n parity', () => {
  it('en, pt and es have identical keys', () => {
    expect(Object.keys(E).length).toBeGreaterThan(100)
    expect(Object.keys(P).sort()).toEqual(Object.keys(E).sort())
    expect(Object.keys(S).sort()).toEqual(Object.keys(E).sort())
  })

  it('every leaf uses the same ICU placeholders in every locale', () => {
    for (const key of Object.keys(E)) {
      expect(placeholders(P[key]), 'pt ' + key).toEqual(placeholders(E[key]))
      expect(placeholders(S[key]), 'es ' + key).toEqual(placeholders(E[key]))
    }
  })

  it('no leaf is empty and none still says "TODO"', () => {
    for (const [locale, flat] of [['en', E], ['pt', P], ['es', S]] as const) {
      for (const [key, text] of Object.entries(flat)) {
        expect(text.trim().length, locale + ' ' + key).toBeGreaterThan(0)
        expect(text, locale + ' ' + key).not.toMatch(/TODO|TBD/)
      }
    }
  })

  it('every key the view models emit resolves in all three locales', () => {
    for (const key of EMITTED) for (const [locale, flat] of [['en', E], ['pt', P], ['es', S]] as const) expect(flat[key], locale + ' ' + key).toBeTruthy()
  })

  it('the retrospective keys the campaign table reuses exist in the outcome namespace', () => {
    const O = flatten(enOutcome)
    for (const key of ['retrospective.verdict_supported', 'retrospective.verdict_not_supported', 'retrospective.inconclusive', 'retrospective.posts_beat']) expect(O[key], key).toBeTruthy()
  })

  it('the LinkedIn sentence is ADR 0026 §10.2 VERBATIM in en', () => {
    expect(E['disclosure.linkedinCount']).toBe('LinkedIn results compare engagement counts, which also rise as your audience grows.')
  })

  it('the eight state strings are the ADR 8.2 literals in en', () => {
    expect(E['state.empty']).toBe('Nothing published yet. Results appear here after Jemip publishes your first post.')
    expect(E['state.immature']).toBe('Measuring. Engagement is final 7 days after a post goes out. Final for {count} posts on {date}.')
    expect(E['state.unavailable']).toBe("{platform} doesn't share engagement data with Jemip, so we show your publishing activity there instead.")
    expect(E['state.thin']).toBe('{n} measured posts so far. A typical rate appears from 5.')
    expect(E['state.error']).toBe("We couldn't load your results.")
    expect(E['state.reload']).toBe('Reload')
    expect(E['state.loading']).toBe('Loading results')
  })
})

describe('nav (QA-MINOR-UI (1) and the nav entry)', () => {
  it('nav.team exists in en, pt and es', () => {
    for (const [locale, common] of [['en', enCommon], ['pt', ptCommon], ['es', esCommon]] as const) {
      expect(typeof (common.nav as Record<string, string>).team, locale).toBe('string')
      expect((common.nav as Record<string, string>).team.length, locale).toBeGreaterThan(0)
    }
  })

  it('every ACTIVE_NAV and COMING_SOON_NAV key has a nav label in all three locales', () => {
    for (const common of [enCommon, ptCommon, esCommon]) {
      for (const key of [...ACTIVE_NAV, ...COMING_SOON_NAV].map((n) => n.key)) expect((common.nav as Record<string, string>)[key], key).toBeTruthy()
    }
  })

  it('analytics is in ACTIVE_NAV directly after campaigns, for every plan, and is no longer coming soon', () => {
    const keys = ACTIVE_NAV.map((n) => n.key) as string[]
    expect(keys.indexOf('analytics')).toBe(keys.indexOf('campaigns') + 1)
    expect(ACTIVE_NAV.find((n) => n.key === 'analytics')).toMatchObject({ href: 'analytics', capability: null })
    expect((COMING_SOON_NAV.map((n) => n.key) as string[])).not.toContain('analytics')
  })

  it('inbox stays "coming soon"', () => {
    expect(COMING_SOON_NAV.map((n) => n.key)).toEqual(['inbox'])
    expect((ACTIVE_NAV.map((n) => n.key) as string[])).not.toContain('inbox')
  })
})
