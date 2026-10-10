import { describe, it, expect } from 'vitest'
import { createTranslator } from 'next-intl'
import enAnalytics from '@/i18n/en/analytics.json'
import ptAnalytics from '@/i18n/pt/analytics.json'
import esAnalytics from '@/i18n/es/analytics.json'
import ptEmail from '@/i18n/pt/email.json'
import esEmail from '@/i18n/es/email.json'

// Session 37-D D9: copy hygiene in all three locales (MINOR-5, MINOR-9, NIT-4, NIT-5; MINOR-2 is rendered in analytics-surfaces.test.tsx).
// The formatter is next-intl's REAL one, so a plural is proven by what it renders, not by what the JSON says.

type L = 'en' | 'pt' | 'es'
const FILES = { en: enAnalytics, pt: ptAnalytics, es: esAnalytics }
const t = (locale: L) => createTranslator({ locale, messages: { analytics: FILES[locale] } }) as unknown as (key: string, values?: Record<string, unknown>) => string
const leaves = (value: unknown): string[] => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [])

describe('NIT-4 under A-15(a): the two count literals are plural-correct, and the en other branch is the ADR 8.2 literal byte for byte', () => {
  it('en: n != 1 renders the ADR literal exactly; n = 1 is singular', () => {
    expect(t('en')('analytics.state.thin', { n: 4 })).toBe('4 measured posts so far. A typical rate appears from 5.')
    expect(t('en')('analytics.state.thin', { n: 0 })).toBe('0 measured posts so far. A typical rate appears from 5.')
    expect(t('en')('analytics.state.thin', { n: 1 })).toBe('1 measured post so far. A typical rate appears from 5.')
    expect(t('en')('analytics.state.immature', { count: 5, date: '12 Apr' })).toBe('Measuring. Engagement is final 7 days after a post goes out. Final for 5 posts on 12 Apr.')
    expect(t('en')('analytics.state.immature', { count: 1, date: '12 Apr' })).toBe('Measuring. Engagement is final 7 days after a post goes out. Final for 1 post on 12 Apr.')
  })

  it('pt: 0 and 1 are spelled out (pt counts 0 as "one"), and n = 1 reads "1 publicação"', () => {
    expect(t('pt')('analytics.state.thin', { n: 1 })).toBe('1 publicação medida até agora. A taxa típica aparece a partir de 5.')
    expect(t('pt')('analytics.state.thin', { n: 0 })).toBe('0 publicações medidas até agora. A taxa típica aparece a partir de 5.')
    expect(t('pt')('analytics.state.thin', { n: 4 })).toBe('4 publicações medidas até agora. A taxa típica aparece a partir de 5.')
    expect(t('pt')('analytics.state.immature', { count: 1, date: '12 abr' })).toBe('A medir. A interação fica final 7 dias depois de cada publicação. Final para 1 publicação a 12 abr.')
    expect(t('pt')('analytics.state.immature', { count: 0, date: '12 abr' })).toContain('Final para 0 publicações a 12 abr.')
    expect(t('pt')('analytics.state.immature', { count: 3, date: '12 abr' })).toContain('Final para 3 publicações a 12 abr.')
  })

  it('es: n = 1 reads "1 publicación"', () => {
    expect(t('es')('analytics.state.thin', { n: 1 })).toBe('1 publicación medida hasta ahora. La tasa típica aparece a partir de 5.')
    expect(t('es')('analytics.state.thin', { n: 4 })).toBe('4 publicaciones medidas hasta ahora. La tasa típica aparece a partir de 5.')
    expect(t('es')('analytics.state.immature', { count: 1, date: '12 abr' })).toContain('Definitiva para 1 publicación el 12 abr.')
    expect(t('es')('analytics.state.immature', { count: 2, date: '12 abr' })).toContain('Definitiva para 2 publicaciones el 12 abr.')
  })
})

describe('MINOR-5: the learning-floor sentence is in report.methodology.floors, in every locale', () => {
  it('en is the ADR 8.1 sentence verbatim', () => {
    expect(enAnalytics.report.methodology.floors).toContain('Jemip only learns a pattern from at least 10 posts across 3 campaigns; numbers shown here are descriptions, not lessons.')
  })
  it.each(['en', 'pt', 'es'] as const)('%s: names 10 posts, 3 campaigns and the description-not-lesson clause', (locale) => {
    const floors = FILES[locale].report.methodology.floors
    expect(floors).toMatch(/\b10\b/)
    expect(floors).toMatch(/\b3\b/)
    expect(floors).toMatch({ en: /descriptions, not lessons/, pt: /descrições, não lições/, es: /descripciones, no lecciones/ }[locale])
  })
})

describe('MINOR-9: one engagement term per locale', () => {
  it('pt analytics and email use "interação": no "envolvimento" anywhere in them', () => {
    for (const s of [...leaves(ptAnalytics), ...leaves(ptEmail)]) expect(s).not.toMatch(/envolvimento/i)
    expect(ptAnalytics.report.ratedPosts.row).toContain('taxa de interação')
  })
  it('es analytics and email use "interacción": no "engagement" anywhere in them', () => {
    for (const s of [...leaves(esAnalytics), ...leaves(esEmail)]) expect(s).not.toMatch(/\bengagement\b/i)
    expect(esEmail.monthly_report.supporting).toContain('Mide la interacción')
  })
})

describe('MINOR-2: the all-measured coverage line says nothing about classification', () => {
  it.each(['en', 'pt', 'es'] as const)('%s: coverage.all has no mention of the generator; coverage.generated keeps it', (locale) => {
    const f = FILES[locale].coverage
    expect(f.all).not.toMatch(/generator|gerador|generador|Jemip/i)
    expect(f.generated).toMatch(/Jemip/)
    expect(t(locale)('analytics.coverage.all', { k: 7, n: 7 })).toMatch(/7\D+7/)
  })
})

describe('NIT-5: the stub sentence names the noun once', () => {
  it('pt and es', () => {
    expect(ptAnalytics.report.stub.match(/publica/g)).toHaveLength(1)
    expect(esAnalytics.report.stub.match(/publica/g)).toHaveLength(1)
    expect(ptAnalytics.report.stub).toBe('Não foi feita nenhuma publicação em {month}, por isso não há nada para medir.')
    expect(esAnalytics.report.stub).toBe('No se hizo ninguna publicación en {month}, así que no hay nada que medir.')
  })
})
