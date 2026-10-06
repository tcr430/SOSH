// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render as renderEmail } from '@react-email/render'
import enAnalytics from '@/i18n/en/analytics.json'
import ptAnalytics from '@/i18n/pt/analytics.json'
import esAnalytics from '@/i18n/es/analytics.json'
import enEmail from '@/i18n/en/email.json'
import ptEmail from '@/i18n/pt/email.json'
import esEmail from '@/i18n/es/email.json'

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import { makeTranslator, LOCALES, type Locale } from '@/lib/i18n/__test-utils__/translator'
import { BUSINESS_A_ID, MARCH_REPORT_OUTCOMES_THROUGH } from '@/lib/analytics/__fixtures__/portfolio'
import { assembleReport, type ReportPayload } from '@/lib/reports/assemble'
import { fixtureReaders } from '@/lib/reports/__fixtures__/readers'
import { ReportBody } from '@/components/analytics/ReportBody'
import type { T } from '@/components/analytics/shared'
import { MonthlyReportEmail } from '@/lib/email/templates/monthly-report'
import { makeTranslator as makeEmailTranslator } from '@/lib/email/templates/__tests__/helpers'

// ADR 0031 §8.4 — ANALYTICS-NO-CAUSAL-COPY (#9) and ANALYTICS-N-SHOWN (#8), Tier 2. Every user-visible analytics or report
// sentence is a closed template, a state or a methodology key; none of them may explain, advise, rank, predict, multiply or
// call a change significant, and every rate sits next to its n. Enforced over (a) the analytics namespace (which holds the
// report namespace) of all three locale files, (b) the monthly-report email strings, (c) the RENDERED ReportBody of every
// fixture month in all three locales, and (d) the rendered email. PROVEN TO REDDEN: a planted string per class per locale.

type Class = 'causal' | 'directive' | 'superlative' | 'prediction' | 'multiplier' | 'delta'

const PHRASES: Record<Class, Record<Locale, string[]>> = {
  causal: {
    en: ['causes', 'drives', 'led to', 'results in', 'because', 'due to', 'thanks to', 'boost', 'improved', 'increased', 'lifted', 'impact', 'effect', 'works', 'proves', 'shows that'],
    pt: ['causa', 'provoca', 'gera', 'leva a', 'resulta em', 'porque', 'devido a', 'graças a', 'melhorou', 'impulsiona', 'funciona'],
    es: ['causa', 'provoca', 'genera', 'lleva a', 'resulta en', 'porque', 'debido a', 'gracias a', 'mejoró', 'impulsa', 'funciona'],
  },
  directive: {
    en: ['should', 'try', 'use more', 'post more', 'we recommend', 'consider'],
    pt: ['deve', 'experimente', 'use mais', 'publique mais', 'recomendamos'],
    es: ['debería', 'prueba', 'usa más', 'publica más', 'recomendamos'],
  },
  superlative: {
    en: ['best', 'top', 'winning', 'strongest', 'worst'],
    pt: ['melhor', 'top', 'mais forte', 'pior'],
    es: ['mejor', 'top', 'más fuerte', 'peor'],
  },
  prediction: {
    en: ['will', 'expect', 'likely to', 'forecast', 'going to'],
    pt: ['vai', 'irá', 'esperamos', 'prevê'],
    es: ['va a', 'esperamos', 'prevé'],
  },
  // ADR 0026 §10.3's written forms, plus "times as" (en) and its pt/es equivalents. The numeric form is a regex below.
  multiplier: {
    en: ['times as', 'twice as', 'double', 'doubled', 'doubling', 'triple', 'tripled', 'tripling'],
    pt: ['vezes mais', 'duas vezes', 'dobro', 'dobrou', 'dobrar', 'triplo', 'triplicou', 'triplicar'],
    es: ['veces más', 'dos veces', 'doble', 'dobló', 'duplicó', 'duplicar', 'triple', 'triplicó', 'triplicar'],
  },
  delta: {
    en: ['significant', 'surge', 'jump', 'spike', 'drop', 'grew', 'fell'],
    pt: ['significativo', 'disparou', 'caiu'],
    es: ['significativo', 'se disparó', 'cayó'],
  },
}
// Patterns that are not whole words: a numeric multiplier, and "up/down N%" in each language.
const PATTERNS: Partial<Record<Class, Record<Locale, RegExp[]>>> = {
  multiplier: { en: [/\d+(\.\d+)?\s?[x×]/i], pt: [/\d+(\.\d+)?\s?[x×]/i], es: [/\d+(\.\d+)?\s?[x×]/i] },
  delta: {
    en: [/\b(up|down)\s+\d+(\.\d+)?\s?%/i],
    pt: [/\bsubiu\s+\d+(\.\d+)?\s?%/iu, /\bdesceu\s+\d+(\.\d+)?\s?%/iu],
    es: [/\bsubió\s+\d+(\.\d+)?\s?%/iu, /\bbajó\s+\d+(\.\d+)?\s?%/iu],
  },
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Whole-word and Unicode-aware: "top" does not match "stop", "vai" does not match "vaidade".
const wordRegex = (phrase: string) => new RegExp('(?<![\\p{L}\\p{N}_])' + escape(phrase).replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}_])', 'iu')

const COMPILED: Record<Class, Record<Locale, RegExp[]>> = Object.fromEntries(
  (Object.keys(PHRASES) as Class[]).map((cls) => [
    cls,
    Object.fromEntries(LOCALES.map((loc) => [loc, [...PHRASES[cls][loc].map(wordRegex), ...(PATTERNS[cls]?.[loc] ?? [])]])),
  ]),
) as never

/** Placeholders are stripped first: `{rate}` is not a word. */
const strip = (text: string) => text.replace(/\{[^}]*\}/g, ' ')

export function violations(text: string, locale: Locale): Class[] {
  const clean = strip(text)
  return (Object.keys(COMPILED) as Class[]).filter((cls) => COMPILED[cls][locale].some((re) => re.test(clean)))
}

/** The same check, naming WHAT matched and where, so a failure points at the sentence (not just the class). */
function offences(text: string, locale: Locale): string[] {
  const clean = strip(text)
  return (Object.keys(COMPILED) as Class[]).flatMap((cls) =>
    COMPILED[cls][locale].flatMap((re) => {
      const m = re.exec(clean)
      return m ? [cls + ': "' + m[0] + '" in "…' + clean.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50) + '…"'] : []
    }),
  )
}

// The ONE exempt key: the interval template says "likely between". No other key is exempt (a test asserts the set).
const EXEMPT_KEYS = new Set(['interval'])
// The SECOND named exemption, by key and for the RENDERED check only (ADR 0031 §8.4 "Known false-positive risk"): es "prueba"
// also means "proof", and the breakdown value label outcome.role.customer_proof renders as "Prueba de cliente". The class is
// not loosened: that one key's rendered text is removed before matching, and nothing else is.
const RENDERED_EXEMPT_KEYS = ['outcome.role.customer_proof'] as const
// A single post's own rate has n = 1 by construction, so its cell needs no "({n} posts)"; exempt from the n rule ONLY.
const SINGLE_POST_RATE_KEYS = new Set(['posts.value.rate'])

function leaves(obj: unknown, path = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[path, obj]]
  if (typeof obj === 'object' && obj !== null) return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? path + '.' + k : k))
  return []
}

const ANALYTICS: Record<Locale, unknown> = { en: enAnalytics, pt: ptAnalytics, es: esAnalytics }
const EMAIL: Record<Locale, unknown> = { en: enEmail, pt: ptEmail, es: esEmail }
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

// ─── the detector is proven red, per class, per locale ────────────────────────────────────────────────────────────
const PLANTED: Record<Class, Record<Locale, string>> = {
  causal: { en: 'Posting on Tuesdays drives engagement', pt: 'Publicar à terça melhorou o envolvimento', es: 'Publicar los martes provoca interacción' },
  directive: { en: 'You should post more threads', pt: 'Experimente publicar mais threads', es: 'Prueba a publicar más hilos' },
  superlative: { en: 'Your best post this month', pt: 'A melhor publicação do mês', es: 'La mejor publicación del mes' },
  prediction: { en: 'Next month will be stronger', pt: 'O próximo mês vai ser mais forte', es: 'El próximo mes va a ser mejor' },
  multiplier: { en: 'Threads get twice as much engagement', pt: 'As threads têm o dobro do envolvimento', es: 'Los hilos tienen el doble de interacción' },
  delta: { en: 'Engagement was up 12% this month', pt: 'O envolvimento subiu 12% este mês', es: 'La interacción subió 12% este mes' },
}

describe('the detector is PROVEN RED: one planted string per class per locale', () => {
  for (const cls of Object.keys(PLANTED) as Class[]) {
    it.each(LOCALES)(`${cls} / %s`, (locale) => {
      expect(violations(PLANTED[cls][locale], locale)).toContain(cls)
    })
  }

  it('every listed phrase in every class and locale is itself caught (a typo in the table would otherwise be a silent hole)', () => {
    for (const cls of Object.keys(PHRASES) as Class[]) {
      for (const locale of LOCALES) {
        for (const phrase of PHRASES[cls][locale]) expect(violations('The month: ' + phrase + ' here.', locale), `${locale} ${cls} "${phrase}"`).toContain(cls)
      }
    }
  })

  it('a numeric multiplier and "up/down N%" are caught; the same words without a number are not', () => {
    expect(violations('Threads got 2.5× the reach', 'en')).toContain('multiplier')
    expect(violations('2x more engagement', 'en')).toContain('multiplier')
    expect(violations('Engagement was down 4% on the month', 'en')).toContain('delta')
    expect(violations('{n} posts measured. Typical engagement rate: {rate} (range {lo}–{hi}).', 'en')).toEqual([])
  })
})

describe('matching is whole-word, case-insensitive and Unicode-aware', () => {
  it('"stop" does not trip "top", "vaidade" does not trip "vai", "Tryout" does not trip "try"', () => {
    expect(violations('Stop and review the month', 'en')).toEqual([])
    expect(violations('A vaidade não conta', 'pt')).toEqual([])
    expect(violations('Tryout results', 'en')).toEqual([])
    expect(violations('Foreword', 'en')).toEqual([])
  })

  it('case does not hide a violation, and a multi-word phrase matches across any whitespace', () => {
    expect(violations('BOOST in reach', 'en')).toContain('causal')
    expect(violations('This led   to more posts', 'en')).toContain('causal')
    expect(violations('Esto lleva\na más', 'es')).toContain('causal')
  })

  it('placeholders are stripped before matching: {top} and {will} are not words', () => {
    expect(violations('{top} {will} {best}', 'en')).toEqual([])
  })
})

// ─── (a) the message files ───────────────────────────────────────────────────────────────────────────────────────
describe('(a) the analytics namespace (the report namespace included) of ALL THREE locale files', () => {
  it.each(LOCALES)('%s: no key outside the exempt set trips any class', (locale) => {
    const all = leaves(ANALYTICS[locale])
    expect(all.length).toBeGreaterThan(150)
    const offenders = all.filter(([key]) => !EXEMPT_KEYS.has(key)).flatMap(([key, value]) => {
      const hits = violations(value, locale)
      return hits.length > 0 ? [key + ': ' + hits.join(', ')] : []
    })
    expect(offenders).toEqual([])
  })

  it('the exempt set is exactly the interval template, it exists in all three locales, and it is the only key that says "likely"', () => {
    expect([...EXEMPT_KEYS]).toEqual(['interval'])
    for (const locale of LOCALES) {
      const all = Object.fromEntries(leaves(ANALYTICS[locale]))
      expect(all.interval, locale).toBeTruthy()
    }
    const likely = leaves(enAnalytics).filter(([, v]) => /\blikely\b/i.test(v)).map(([k]) => k)
    expect(likely).toEqual(['interval'])
  })

  it('every methodology key, the stub, the late-outcomes sentence and the rated-posts copy pass UNEXEMPTED', () => {
    for (const locale of LOCALES) {
      const all = Object.fromEntries(leaves(ANALYTICS[locale]))
      const keys = Object.keys(all).filter((k) => k.startsWith('report.'))
      expect(keys.length).toBeGreaterThan(30)
      for (const k of keys) expect(violations(all[k], locale), `${locale} ${k}`).toEqual([])
    }
  })
})

// ─── structural rules: every rate sits next to its n, every comparison carries both ─────────────────────────────────
const N_TOKEN = /\{n\}|\(1 (post|publicação|publicación)\)/
const N2_TOKEN = /\{n2\}/

describe('ANALYTICS-N-SHOWN: structure of every template (en, pt, es)', () => {
  it.each(LOCALES)('%s: a template with a rate or a win count carries its n, and a comparison carries BOTH n values', (locale) => {
    const offenders: string[] = []
    for (const [key, value] of leaves(ANALYTICS[locale])) {
      if (EXEMPT_KEYS.has(key) || SINGLE_POST_RATE_KEYS.has(key)) continue
      const hasRate = /\{(rate|rate2|lo|hi|wins)\}/.test(value)
      if (hasRate && !N_TOKEN.test(value)) offenders.push(key + ': rate without its n')
      if (/\{rate2\}/.test(value) && !N2_TOKEN.test(value)) offenders.push(key + ': comparison without the second n')
    }
    expect(offenders).toEqual([])
  })

  it('the checker itself is red on a rate with no n and on a comparison with one n (planted)', () => {
    const bad = (value: string) => /\{(rate|rate2|lo|hi|wins)\}/.test(value) && !N_TOKEN.test(value)
    expect(bad('Typical engagement rate: {rate}.')).toBe(true)
    expect(bad('{n} posts measured. Typical engagement rate: {rate}.')).toBe(false)
    expect(bad('Engagement rate {rate} (1 post)')).toBe(false)
    const oneSided = (value: string) => /\{rate2\}/.test(value) && !N2_TOKEN.test(value)
    expect(oneSided('{month}: {rate} ({n} posts) · {month2}: {rate2}')).toBe(true)
    expect(oneSided(enAnalytics.monthPair)).toBe(false)
  })

  it('the exemptions are exactly the interval template and a single post\'s own rate cell', () => {
    expect([...SINGLE_POST_RATE_KEYS]).toEqual(['posts.value.rate'])
    for (const locale of LOCALES) expect(Object.fromEntries(leaves(ANALYTICS[locale]))['posts.value.rate']).toBe('{rate}')
  })
})

// ─── (b) the email strings and (d) the rendered email ─────────────────────────────────────────────────────────────
describe('(b) the monthly-report email strings, in all three locales', () => {
  it.each(LOCALES)('%s: no string trips any class', (locale) => {
    const mine = leaves((EMAIL[locale] as Record<string, unknown>).monthly_report)
    expect(mine.length).toBe(6)
    for (const [key, value] of mine) expect(violations(value, locale), `${locale} monthly_report.${key}`).toEqual([])
  })
})

// ─── (c) the RENDERED ReportBody of every fixture month ──────────────────────────────────────────────────────────
const NOW = MARCH_REPORT_OUTCOMES_THROUGH
const tFor = (locale: Locale): T => (key, values) => {
  const dot = key.indexOf('.')
  return makeTranslator(locale, key.slice(0, dot))(key.slice(dot + 1), values)
}
async function payload(over: { plan?: Record<string, unknown>; period: string }): Promise<ReportPayload> {
  return (
    await assembleReport({ readers: fixtureReaders({ plan: over.plan, patterns: [{ business_id: BUSINESS_A_ID, pattern_key: null, platform: 'twitter' as const, pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }] }), businessId: BUSINESS_A_ID, period: over.period, now: NOW })
  ).payload
}

describe('(c) the rendered ReportBody of every fixture month, in every locale', () => {
  it.each(LOCALES)('%s: Pro March, basic March, February and the stub month, on a Pro plan and a plan without Pro, carry none of the six classes', async (locale) => {
    const cases: Array<[string, ReportPayload, boolean]> = [
      ['March Pro, Pro plan', await payload({ period: '2026-03' }), true],
      ['March Pro, downgraded plan', await payload({ period: '2026-03' }), false],
      ['March basic, Pro plan', await payload({ period: '2026-03', plan: { [BUSINESS_A_ID]: 'plus' } }), true],
      ['March basic, basic plan', await payload({ period: '2026-03', plan: { [BUSINESS_A_ID]: 'plus' } }), false],
      ['February', await payload({ period: '2026-02' }), true],
      ['stub month', await payload({ period: '2025-11' }), true],
    ]
    for (const [name, p, pro] of cases) {
      let rendered = text(renderToStaticMarkup(React.createElement(ReportBody, { t: tFor(locale), locale, timezone: 'Europe/Lisbon', payload: p, proAllowed: pro })))
      expect(rendered, name).not.toContain('⟦missing')
      expect(rendered.length, name).toBeGreaterThan(200)
      // Only the named rendered exemption is removed (see RENDERED_EXEMPT_KEYS); every other word is matched.
      for (const key of RENDERED_EXEMPT_KEYS) rendered = rendered.replaceAll(tFor(locale)(key), ' ')
      expect(offences(rendered, locale), `${locale} / ${name}`).toEqual([])
    }
  })
})

describe('the rendered exemption is exactly one key, is LIVE (it really trips the class) and is needed only in es', () => {
  it('names one key; its es text trips "directive" and so is a real exemption; its en and pt text trip nothing', () => {
    expect([...RENDERED_EXEMPT_KEYS]).toEqual(['outcome.role.customer_proof'])
    expect(violations(tFor('es')('outcome.role.customer_proof'), 'es')).toEqual(['directive'])
    expect(violations(tFor('en')('outcome.role.customer_proof'), 'en')).toEqual([])
    expect(violations(tFor('pt')('outcome.role.customer_proof'), 'pt')).toEqual([])
  })

  it('"prueba" anywhere else is still caught in es (the class was not loosened)', () => {
    expect(violations('Prueba a publicar más', 'es')).toContain('directive')
    expect(violations('Esta prueba demuestra el resultado', 'es')).toContain('directive')
  })
})

describe('(d) the rendered monthly-report email, in every locale', () => {
  it.each(LOCALES)('%s: the heading, lead, summary lines and footnote carry none of the six classes', async (locale) => {
    const p = await payload({ period: '2026-03' })
    const t = tFor(locale)
    const summaryLines = p.summary.map((line) => t(line.key, line.params))
    const html = await renderEmail(
      React.createElement(MonthlyReportEmail, {
        locale,
        t: makeEmailTranslator(locale),
        businessName: 'Fixture A',
        periodLabel: 'March 2026',
        summaryLines,
        reportUrl: 'https://app.example.test/en/analytics/reports/2026-03',
      }),
      { plainText: true },
    )
    expect(html.length).toBeGreaterThan(100)
    expect(violations(html.replace(/\[[^\]]*\]/g, ' '), locale)).toEqual([])
  })
})
