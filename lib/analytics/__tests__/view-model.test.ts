import { describe, it, expect } from 'vitest'
import * as viewModelModule from '../view-model'
import { typicalView, monthPairView, winsView, exclusionsView, breakdownView, platformMonthView } from '../view-model'
import { fixtureRecords } from '../__fixtures__/adapters'
import { BUSINESS_A_ID, BUSINESS_B_ID, EXPECTED, FIXTURE_NOW } from '../__fixtures__/portfolio'
import { makeTranslator, LOCALES, type Locale } from '@/lib/i18n/__test-utils__/translator'
import type { AnalyticsOutcome } from '../types'

const FEB = [0.022, 0.028, 0.03, 0.036, 0.044]
const MARCH = [0, 0.018, 0.025, 0.031, 0.04, 0.047, 0.064]
const JAN = [0.015, 0.02, 0.026, 0.033]

// Every string a view model carries is a template KEY, a pre-formatted token, a period or a closed enum word:
// never a sentence. A sentence has whitespace, so a leaf with whitespace is a sentence.
function leaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => leaves(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => leaves(v, out))
  return out
}
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k)
      keysDeep(v, out)
    }
  }
  return out
}

describe('typicalView', () => {
  it('March: a number, with its n and range, as pre-formatted tokens', () => {
    expect(typicalView(MARCH)).toEqual({
      state: 'number',
      key: 'analytics.typical',
      params: { n: 7, rate: '3.1%', lo: '0.0%', hi: '6.4%', rangeKind: 'minmax' },
    })
  })

  it('January (n = 4) is the THIN state: its median (2.3%) appears nowhere in it', () => {
    const v = typicalView(JAN)
    expect(v).toEqual({ state: 'thin', key: 'analytics.state.thin', params: { n: 4 } })
    const text = JSON.stringify(v)
    expect(text).not.toContain('0.023')
    expect(text).not.toContain('2.3%')
    expect(Object.keys(v)).not.toContain('median')
  })

  it('exactly 5 is a number, 4 is thin', () => {
    expect(typicalView(FEB).state).toBe('number')
    expect(typicalView(FEB.slice(0, 4)).state).toBe('thin')
  })

  it('no values at all is thin with n = 0', () => {
    expect(typicalView([])).toEqual({ state: 'thin', key: 'analytics.state.thin', params: { n: 0 } })
  })
})

describe('monthPairView: two months side by side, each with its own n; NO delta (ADR 0031 §2.3)', () => {
  const feb = { period: '2026-02', values: FEB }
  const march = { period: '2026-03', values: MARCH }
  const jan = { period: '2026-01', values: JAN }

  it('February (5) beside March (7): shown, each side carrying its own n and range', () => {
    const v = monthPairView(feb, march)
    expect(v.state).toBe('pair')
    expect(v.sides.map((s) => s.period)).toEqual(['2026-02', '2026-03'])
    expect(v.sides[0].typical).toMatchObject({ state: 'number', params: { n: 5, rate: '3.0%', lo: '2.2%', hi: '4.4%' } })
    expect(v.sides[1].typical).toMatchObject({ state: 'number', params: { n: 7, rate: '3.1%' } })
  })

  it('January (4) beside February (5): SUPPRESSED, though February alone is still a number', () => {
    const v = monthPairView(jan, feb)
    expect(v.state).toBe('suppressed')
    expect(v.sides[0].typical.state).toBe('thin')
    expect(v.sides[1].typical.state).toBe('number')
  })

  it('there is NO delta, change, difference, direction, arrow, colour or percentage-change key anywhere in either state', () => {
    for (const v of [monthPairView(feb, march), monthPairView(jan, feb)]) {
      const bad = keysDeep(v).filter((k) => /delta|diff|change|direction|arrow|trend|colou?r|pct|percent|improv|declin/i.test(k))
      expect(bad).toEqual([])
    }
  })

  it('the view model is typed without a delta: adding one is a compile error', () => {
    const v = monthPairView(feb, march)
    // @ts-expect-error a month pair carries no delta
    void v.delta
    expect(Object.keys(v).sort()).toEqual(['key', 'sides', 'state'])
  })

  it('the two sides keep the order given (earlier or later first), never reordered by size', () => {
    expect(monthPairView(march, feb).sides.map((s) => s.period)).toEqual(['2026-03', '2026-02'])
  })
})

describe('winsView: "{wins} of {n}", per platform, with its disclosures', () => {
  it('4 of 6: a number, with "usual" defined and the "updates as you post" sentence keyed beside it', () => {
    const v = winsView({ wins: 4, of: 6, importSeed: 1 })
    expect(v).toEqual({
      state: 'number',
      key: 'analytics.wins',
      params: { wins: 4, n: 6 },
      disclosureKeys: ['analytics.disclosure.usual', 'analytics.disclosure.usualUpdates', 'analytics.disclosure.importSeed'],
    })
  })

  it('without an imported baseline the import disclosure is absent', () => {
    expect(winsView({ wins: 4, of: 6, importSeed: 0 })).toMatchObject({ disclosureKeys: ['analytics.disclosure.usual', 'analytics.disclosure.usualUpdates'] })
  })

  it('below 5 it is THIN and shows no "k of n"', () => {
    const v = winsView({ wins: 3, of: 4, importSeed: 0 })
    // Its own key (A-9(a)): the n is the BASELINE count, so the shared "measured posts so far" key must not carry it.
    expect(v).toMatchObject({ state: 'thin', key: 'analytics.state.thinWins', params: { n: 4 } })
    expect(JSON.stringify(v)).not.toContain('"wins"')
  })
})

describe('exclusionsView: "{measured} of {published} posts measured. {k} not included: ..." as keys and params', () => {
  it('March: 7 of 10 measured, 3 not included, three reasons of 1; "not final yet" (0) is omitted', () => {
    const v = exclusionsView({ published: 10, measured: 7, noDataReturned: 1, fieldMissing: 1, zeroImpressions: 1, notFinal: 0 })
    expect(v).toEqual({
      key: 'analytics.exclusions.summary',
      params: { measured: 7, published: 10, notIncluded: 3 },
      reasons: [
        { key: 'analytics.exclusions.noDataReturned', count: 1 },
        { key: 'analytics.exclusions.fieldMissing', count: 1 },
        { key: 'analytics.exclusions.zeroImpressions', count: 1 },
      ],
    })
  })

  it('nothing excluded: no reasons at all', () => {
    expect(exclusionsView({ published: 5, measured: 5, noDataReturned: 0, fieldMissing: 0, zeroImpressions: 0, notFinal: 0 }).reasons).toEqual([])
  })
})

describe('platformMonthView: one platform, one month, one business: the composition the surface and the report both read', () => {
  const records = () => fixtureRecords(BUSINESS_A_ID)
  const march = () => platformMonthView({ platform: 'twitter', period: '2026-03', timezone: 'Europe/Lisbon', now: FIXTURE_NOW, records: records() })

  it('March, X: the literals of EXPECTED, end to end', () => {
    const v = march()
    expect(v.platform).toBe('twitter')
    expect(v.period).toBe('2026-03')
    expect(v.typical).toEqual({ state: 'number', key: 'analytics.typical', params: { n: 7, rate: '3.1%', lo: '0.0%', hi: '6.4%', rangeKind: 'minmax' } })
    expect(v.wins).toMatchObject({ state: 'number', params: { wins: 4, n: 6 } })
    expect(v.exclusions.params).toEqual({ measured: 7, published: 10, notIncluded: 3 })
    expect(v.exclusions.reasons.map((r) => r.count)).toEqual([1, 1, 1])
    expect(EXPECTED.march.x.medianRate).toBe(0.031)
  })

  it('carries the five report breakdowns, each tagged with its population and coverage', () => {
    const v = march()
    expect(v.breakdowns.map((b) => b.dimension)).toEqual(['role', 'format', 'origin_mode', 'length_band', 'cta_present'])
    expect(v.breakdowns.find((b) => b.dimension === 'role')).toMatchObject({
      populationKey: 'analytics.population.aiOnly',
      coverage: { key: 'analytics.coverage', params: { k: 5, n: 7 } },
    })
    expect(v.breakdowns.find((b) => b.dimension === 'length_band')).toMatchObject({ populationKey: 'analytics.population.allMeasured' })
  })

  it('a live Pro page adds hook_type; the report does not', () => {
    const live = platformMonthView({ platform: 'twitter', period: '2026-03', timezone: 'Europe/Lisbon', now: FIXTURE_NOW, records: records(), includeLiveOnly: true })
    expect(live.breakdowns.map((b) => b.dimension)).toContain('hook_type')
    expect(march().breakdowns.map((b) => b.dimension)).not.toContain('hook_type')
  })

  it('April for A: 1 measured post is THIN (the day-2 posts are "not final yet", counted)', () => {
    const v = platformMonthView({ platform: 'twitter', period: '2026-04', timezone: 'Europe/Lisbon', now: FIXTURE_NOW, records: records() })
    expect(v.typical).toEqual({ state: 'thin', key: 'analytics.state.thin', params: { n: 1 } })
    expect(v.exclusions.params).toEqual({ measured: 1, published: 3, notIncluded: 2 })
    expect(v.exclusions.reasons).toEqual([{ key: 'analytics.exclusions.notFinal', count: 2 }])
  })

  it('LinkedIn is a COUNT basis: it never gets a typical RATE, and its win count is thin (no baselines)', () => {
    const v = platformMonthView({ platform: 'linkedin', period: '2026-03', timezone: 'Europe/Lisbon', now: FIXTURE_NOW, records: records() })
    expect(v.typical).toBeNull()
    expect(v.basis).toBe('count')
    expect(v.wins).toMatchObject({ state: 'thin', params: { n: 0 } })
    expect(JSON.stringify(v)).not.toContain('%')
  })

  it('a month with no posts of the platform has no basis and is thin, not an error', () => {
    const v = platformMonthView({ platform: 'twitter', period: '2025-11', timezone: 'Europe/Lisbon', now: FIXTURE_NOW, records: records() })
    expect(v.basis).toBeNull()
    expect(v.typical).toEqual({ state: 'thin', key: 'analytics.state.thin', params: { n: 0 } })
    expect(v.exclusions.params).toEqual({ measured: 0, published: 0, notIncluded: 0 })
  })

  it('the post of the OTHER platform is not counted: X published is 10, not 13', () => {
    expect(march().exclusions.params.published).toBe(10)
  })
})

describe('a view model carries KEYS and PARAMS, never sentences, and NEVER a log_lift (constraints 11, 13)', () => {
  const v = platformMonthView({ platform: 'twitter', period: '2026-03', timezone: 'Europe/Lisbon', now: FIXTURE_NOW, records: fixtureRecords(BUSINESS_A_ID), includeLiveOnly: true })
  const pair = monthPairView({ period: '2026-02', values: FEB }, { period: '2026-03', values: MARCH })

  it('no string anywhere in a view model contains whitespace (a sentence does)', () => {
    for (const model of [v, pair]) {
      expect(leaves(model).filter((s) => /\s/.test(s))).toEqual([])
    }
  })

  it('every string is a template key, a formatted token, a period or a closed enum word', () => {
    const ok = /^(analytics\.[A-Za-z.]+|\d+(\.\d+)?%|\d{4}-\d{2}|[a-z_]+|true|false)$/
    expect(leaves(v).filter((s) => !ok.test(s))).toEqual([])
  })

  it('no key at any depth names log_lift or its camelCase', () => {
    expect(keysDeep(v).filter((k) => /log_?lift/i.test(k))).toEqual([])
    expect(JSON.stringify(v)).not.toMatch(/log_?lift/i)
  })

  it('the INPUT type refuses a logLift field (compile-time), and an outcome carrying one at runtime does not leak it', () => {
    const base = fixtureRecords(BUSINESS_A_ID).find((r) => r.outcome)!.outcome as AnalyticsOutcome
    // @ts-expect-error an analytics outcome has no lift field
    const withLift: AnalyticsOutcome = { ...base, logLift: 1.7 }
    const leaked = platformMonthView({
      platform: 'twitter',
      period: '2026-03',
      timezone: 'Europe/Lisbon',
      now: FIXTURE_NOW,
      records: [{ post: { postId: base.postId, platform: 'twitter', publishedAt: base.publishedAt }, metrics: null, outcome: withLift }],
    })
    expect(JSON.stringify(leaked)).not.toMatch(/log_?lift|1\.7/i)
  })

  it('the module exports no function that returns win share as a series', () => {
    expect(Object.keys(viewModelModule).sort()).toEqual(['breakdownView', 'exclusionsView', 'monthPairView', 'platformMonthView', 'typicalView', 'winsView'])
  })
})

describe('breakdownView', () => {
  it('rows carry wins, n and a provisional flag; the title tags carry population and coverage', () => {
    const v = breakdownView({
      dimension: 'role',
      population: 'ai_only',
      coverage: { k: 5, n: 7 },
      presentation: 'counts',
      values: [{ value: 'anchor_thesis', wins: 3, of: 6, provisional: true, interval: null }],
    })
    expect(v).toEqual({
      dimension: 'role',
      populationKey: 'analytics.population.aiOnly',
      coverage: { key: 'analytics.coverage', params: { k: 5, n: 7 } },
      presentation: 'counts',
      thinValues: [],
      rows: [{ value: 'anchor_thesis', key: 'analytics.breakdown.row', params: { wins: 3, n: 6 }, provisional: true, interval: null, share: 0.5, bar: null }],
    })
  })

  it('an interval is two whole-percent tokens, and only when the breakdown has one', () => {
    const v = breakdownView({
      dimension: 'role',
      population: 'ai_only',
      coverage: { k: 22, n: 22 },
      presentation: 'bars',
      values: [{ value: 'anchor_thesis', wins: 9, of: 12, provisional: false, interval: { lo: 0.4677, hi: 0.9111 } }],
    })
    expect(v.rows[0].interval).toEqual({ key: 'analytics.interval', params: { lo: '47%', hi: '91%' } })
  })
})

const bd = (values: Array<{ value: string; wins: number; of: number }>) =>
  breakdownView({ dimension: 'role', population: 'ai_only', coverage: { k: 9, n: 9 }, presentation: 'counts', values: values.map((v) => ({ ...v, provisional: true, interval: null })) })

describe('MINOR-6 under A-11(a): a breakdown value below 5 posts is THIN and carries no k and no n (literal n = 4 and n = 5)', () => {
  it('n = 4: the value is only NAMED in thinValues; no row, no k, no n, no share is in the view model', () => {
    const v = bd([{ value: 'anchor_thesis', wins: 0, of: 4 }])
    expect(v.thinValues).toEqual(['anchor_thesis'])
    expect(v.rows).toEqual([])
    expect(JSON.stringify(v)).not.toMatch(/"wins"|"share"|"of"/)
  })

  it('n = 5: the value is a row with its k of n', () => {
    const v = bd([{ value: 'anchor_thesis', wins: 3, of: 5 }])
    expect(v.thinValues).toEqual([])
    expect(v.rows).toHaveLength(1)
    expect(v.rows[0]).toMatchObject({ key: 'analytics.breakdown.row', params: { wins: 3, n: 5 } })
  })

  it('the two sides of the floor in one breakdown', () => {
    const v = bd([{ value: 'anchor_thesis', wins: 0, of: 1 }, { value: 'follow_up', wins: 3, of: 5 }])
    expect(v.thinValues).toEqual(['anchor_thesis'])
    expect(v.rows.map((r) => r.value)).toEqual(['follow_up'])
  })
})

describe('MAJOR-9 under A-10(a): the spread is "range" below 10 posts and "middle half of posts" from 10 (literal n = 9 and n = 10)', () => {
  const nine = [0.01, 0.02, 0.03, 0.03, 0.05, 0.06, 0.07, 0.07, 0.09]
  const ten = [0.01, 0.02, 0.03, 0.03, 0.05, 0.06, 0.07, 0.07, 0.09, 0.1]
  const render = (locale: Locale, v: ReturnType<typeof typicalView>) => {
    if (v.state !== 'number') throw new Error('expected a number')
    return makeTranslator(locale, 'analytics')(v.key.replace('analytics.', ''), v.params)
  }

  it('n = 9 is the range template, with the literal sentence', () => {
    const v = typicalView(nine)
    expect(v).toMatchObject({ state: 'number', key: 'analytics.typical', params: { n: 9, rangeKind: 'minmax' } })
    expect(render('en', v)).toBe('9 posts measured. Typical engagement rate: 5.0% (range 1.0%–9.0%).')
  })

  it('n = 10 is the middle-half template, with the literal sentence in en, pt and es', () => {
    const v = typicalView(ten)
    expect(v).toMatchObject({ state: 'number', key: 'analytics.typicalIqr', params: { n: 10, rangeKind: 'iqr' } })
    expect(render('en', v)).toBe('10 posts measured. Typical engagement rate: 5.5% (middle half of posts 3.0%–7.0%).')
    expect(render('pt', v)).toBe('10 publicações medidas. Taxa de interação típica: 5.5% (metade central das publicações 3.0%–7.0%).')
    expect(render('es', v)).toBe('10 publicaciones medidas. Tasa de interacción típica: 5.5% (mitad central de las publicaciones 3.0%–7.0%).')
  })

  it('no sentence that is the IQR calls itself a "range", in any locale', () => {
    const v = typicalView(ten)
    for (const locale of LOCALES) expect(render(locale, v)).not.toMatch(/\b(range|intervalo|rango)\b/i)
  })

  it('the methodology median sentence says the switch, in every locale', () => {
    const median = (l: Locale) => makeTranslator(l, 'analytics')('report.methodology.median')
    expect(median('en')).toContain('Below 10 posts the range is lowest to highest; from 10 it is the middle half of posts.')
    expect(median('pt')).toContain('metade central das publicações')
    expect(median('es')).toContain('mitad central de las publicaciones')
  })
})

describe('MAJOR-8 under A-9(a): the wins thin state names its own n, never the measured count (business B, March, Sao Paulo)', () => {
  const b = () => platformMonthView({ platform: 'twitter', period: '2026-03', timezone: 'America/Sao_Paulo', now: FIXTURE_NOW, records: fixtureRecords(BUSINESS_B_ID) })

  it('B: 2 measured posts, 1 with a usual: the typical line and the exclusions line say 2 measured; the wins line says 1 had a usual and never the word "measured"', () => {
    const v = b()
    expect(v.exclusions.params.measured).toBe(2)
    expect(v.typical).toMatchObject({ state: 'thin', params: { n: 2 } })
    expect(v.wins).toMatchObject({ state: 'thin', key: 'analytics.state.thinWins', params: { n: 1 } })
    const a = (l: Locale) => makeTranslator(l, 'analytics')
    if (v.wins.state !== 'thin') throw new Error('expected thin')
    expect(a('en')('state.thinWins', v.wins.params)).toBe('1 post had a usual to compare against. A win count appears from 5.')
    expect(a('pt')('state.thinWins', v.wins.params)).toBe('Publicações com um habitual para comparar: 1. A contagem de vitórias aparece a partir de 5.')
    expect(a('es')('state.thinWins', v.wins.params)).toBe('Publicaciones con un habitual para comparar: 1. El recuento de victorias aparece a partir de 5.')
    for (const l of LOCALES) expect(a(l)('state.thinWins', v.wins.params)).not.toMatch(/measur|medid/i)
  })

  it('the old contradiction is gone: the same set is never "2 of 2 measured" and "1 measured so far"', () => {
    const v = b()
    const lines = LOCALES.map((l) => {
      const a = makeTranslator(l, 'analytics')
      if (v.typical?.state !== 'thin' || v.wins.state !== 'thin') throw new Error('expected thin')
      return [a('state.thin', v.typical.params), a('state.thinWins', v.wins.params)]
    })
    for (const [typical, wins] of lines) {
      expect(typical).toMatch(/2/)
      expect(wins).not.toBe(typical)
    }
  })
})
