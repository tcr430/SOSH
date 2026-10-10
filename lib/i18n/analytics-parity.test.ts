// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import en from '@/i18n/en/analytics.json'
import pt from '@/i18n/pt/analytics.json'
import es from '@/i18n/es/analytics.json'
import enCommon from '@/i18n/en/common.json'
import ptCommon from '@/i18n/pt/common.json'
import esCommon from '@/i18n/es/common.json'
import enOutcome from '@/i18n/en/outcome.json'
import ptOutcome from '@/i18n/pt/outcome.json'
import esOutcome from '@/i18n/es/outcome.json'
import { OUTCOME_PATTERN_VOCABULARY } from '@/lib/outcomes/template'
import { createTranslator } from 'next-intl'
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
  'population.aiOnly', 'population.allMeasured', 'coverage.generated', 'coverage.all', 'breakdown.row', 'interval', 'account.unrecorded',
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
    // A-15(a): the count carries an ICU plural; its `other` branch is the ADR literal byte for byte (asserted rendered, in copy-hygiene.test.ts).
    expect(E['state.immature']).toBe('Measuring. Engagement is final 7 days after a post goes out. Final for {count, plural, one {# post} other {# posts}} on {date}.')
    expect(E['state.unavailable']).toBe("{platform} doesn't share engagement data with Jemip, so we show your publishing activity there instead.")
    expect(E['state.thin']).toBe('{n, plural, one {# measured post} other {# measured posts}} so far. A typical rate appears from 5.')
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

// O2.11 (real browser): "1 publicações no LinkedIn", "1 campanhas ativas" and "1 posts published" shipped because the counted
// strings carried a bare {count}. The strings a customer can see at a count of 1 are ICU plurals now; this renders the REAL messages
// through next-intl (not a key-echo mock), at 0, 1 and 2, in all three locales. pt has an explicit =0 branch: Intl treats 0 as "one"
// in Portuguese, and "0 publicação" is wrong in pt-PT. state.immature and state.thin are NOT here: they are the ADR 0031 §8.2
// literals (pinned above), so their singular is an open ADR amendment, not something a Builder edits.
describe('analytics i18n plurals (rendered, not echoed)', () => {
  const t = (locale: 'en' | 'pt' | 'es') => {
    const messages = { analytics: { en, pt, es }[locale] }
    return createTranslator({ locale, messages }) as unknown as (key: string, values?: Record<string, unknown>) => string
  }
  const acct = { platform: 'X', account: 'a' }

  it.each([
    ['en', 0, '0 posts published on X (a).'],
    ['en', 1, '1 post published on X (a).'],
    ['en', 2, '2 posts published on X (a).'],
    ['pt', 0, '0 publicações no X (a).'],
    ['pt', 1, '1 publicação no X (a).'],
    ['pt', 2, '2 publicações no X (a).'],
    ['es', 1, '1 publicación en X (a).'],
    ['es', 2, '2 publicaciones en X (a).'],
  ] as const)('activity.line %s count=%i', (locale, count, expected) => {
    expect(t(locale)('analytics.activity.line', { count, ...acct })).toBe(expected)
  })

  it.each([
    ['en', 1, 0, '1 post published, 0 the month before.'],
    ['en', 2, 1, '2 posts published, 1 the month before.'],
    ['pt', 1, 0, '1 publicação, 0 no mês anterior.'],
    ['es', 1, 3, '1 publicación, 3 el mes anterior.'],
  ] as const)('activity.total %s %i/%i', (locale, count, prev, expected) => {
    expect(t(locale)('analytics.activity.total', { count, prev })).toBe(expected)
  })

  it.each([
    ['en', 1, 1, 'Posts came from 1 campaign. 1 campaign completed its retrospective this month.'],
    ['en', 2, 0, 'Posts came from 2 campaigns. 0 campaigns completed their retrospective this month.'],
    ['pt', 1, 1, 'As publicações vieram de 1 campanha. 1 campanha concluiu o seu veredicto este mês.'],
    ['pt', 0, 2, 'As publicações vieram de 0 campanhas. 2 campanhas concluíram o seu veredicto este mês.'],
    ['es', 1, 1, 'Las publicaciones vinieron de 1 campaña. 1 campaña completó su veredicto este mes.'],
    ['es', 2, 2, 'Las publicaciones vinieron de 2 campañas. 2 campañas completaron su veredicto este mes.'],
  ] as const)('activity.campaigns %s %i/%i', (locale, withPosts, retrospectivesCompleted, expected) => {
    expect(t(locale)('analytics.activity.campaigns', { withPosts, retrospectivesCompleted })).toBe(expected)
  })

  it('every plural message in every locale renders at 0, 1 and 2 without throwing and never prints raw ICU', () => {
    for (const [locale, flat] of [['en', E], ['pt', P], ['es', S]] as const) {
      for (const [key, text] of Object.entries(flat)) {
        if (!text.includes('plural')) continue
        for (const n of [0, 1, 2]) {
          const values = Object.fromEntries(placeholders(text).map((p) => [p, n]))
          const out = t(locale)('analytics.' + key, values)
          expect(out, locale + ' ' + key + ' n=' + n).not.toMatch(/plural|[{}#]/)
        }
      }
    }
  })
})

describe('the pattern templates over the real vocabulary (Session 37-D D6)', () => {
  const cells = OUTCOME_PATTERN_VOCABULARY.platforms.flatMap((platform) =>
    Object.entries(OUTCOME_PATTERN_VOCABULARY.subjects).flatMap(([dimension, values]) =>
      values.flatMap((value) => (['above', 'below'] as const).flatMap((direction) => (['rate', 'count'] as const).map((basis) => ({ platform, dimension, value, direction, basis })))),
    ),
  )

  // The REAL ICU formatter (next-intl), over the analytics and outcome namespaces a pattern line draws from.
  const real = (locale: 'en' | 'pt' | 'es') =>
    createTranslator({ locale, messages: { analytics: { en, pt, es }[locale], outcome: { en: enOutcome, pt: ptOutcome, es: esOutcome }[locale] } }) as unknown as (key: string, values?: Record<string, unknown>) => string

  it.each(['en', 'pt', 'es'] as const)('%s: every real cell resolves all three keys it needs and prints no raw ICU or placeholder', (locale) => {
    const a = real(locale)
    for (const c of cells) {
      const sentence = a('analytics.pattern.' + c.direction + (c.basis === 'count' ? '_count' : ''), {
        platform: a('analytics.platform.' + c.platform),
        subject: a('outcome.observed.subject.' + c.dimension + '.' + c.value),
        wins: 7,
        n: 10,
        campaigns: 3,
      })
      expect(sentence, JSON.stringify(c)).not.toMatch(/[{}#]/)
      expect(sentence).toContain('7')
      expect(sentence).toContain('10')
    }
  })

  it('noPatternYet exists in all three locales and says 10 posts and 3 campaigns', () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      const s = real(locale)('analytics.state.noPatternYet')
      expect(s).toMatch(/10/)
      expect(s).toMatch(/3/)
    }
  })
})
