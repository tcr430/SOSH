import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { MonthlyReportEmail, MonthlyReportPropsSchema, monthlyReportSubject, oneLine } from '../monthly-report'
import { makeTranslator, LOCALES } from './helpers'

const validProps = {
  businessName: 'Acme Corp',
  periodLabel: 'September 2026',
  summaryLines: ['12 posts published, 9 the month before.', '8 posts measured. Typical engagement rate: 4.2% (range 2.1%–6.8%).'],
  reportUrl: 'https://app.sosh.app/en/analytics/reports/2026-09',
}

describe('MonthlyReportEmail', () => {
  it.each(LOCALES)('renders in %s with the heading, every summary line and the link, and no raw i18n key', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<MonthlyReportEmail {...validProps} locale={locale} t={t} />)
    expect(html).toContain('Acme Corp')
    for (const line of validProps.summaryLines) expect(html).toContain(line.replace(/&/g, '&amp;'))
    expect(html).toContain('<a')
    expect(html).toContain(validProps.reportUrl)
    expect(html).not.toContain('monthly_report.')
  })

  it.each(LOCALES)('the subject is under 60 characters and non-empty in %s', (locale) => {
    const subject = monthlyReportSubject(makeTranslator(locale), validProps)
    expect(subject.length).toBeGreaterThan(0)
    expect(subject.length).toBeLessThan(60)
    expect(subject).not.toContain('monthly_report.')
  })

  it('has NO attachment and carries no figure of its own: the only numbers are the summary lines it was handed', async () => {
    const t = makeTranslator('en')
    const email = <MonthlyReportEmail {...validProps} summaryLines={[]} locale="en" t={t} />
    // The visible text only: the layout's inline CSS legitimately contains "100%".
    const text = await render(email, { plainText: true })
    expect(text).not.toMatch(/\d+(\.\d+)?%/)
    expect((await render(email)).toLowerCase()).not.toContain('attachment')
  })

  it('renders with no summary lines (a stub month is never mailed, but the template must not break)', async () => {
    const html = await render(<MonthlyReportEmail {...validProps} summaryLines={[]} locale="en" t={makeTranslator('en')} />)
    expect(html).toContain(validProps.reportUrl)
  })
})

describe('the subject cannot be split (CR/LF stripped from every interpolated value)', () => {
  it('a month label carrying CR, LF and a line separator yields one line', () => {
    const t = makeTranslator('en')
    const LS = String.fromCharCode(0x2028)
    const subject = monthlyReportSubject(t, { ...validProps, periodLabel: 'Sept\r\nBcc: attacker@example.com' + LS + 'x' })
    expect(subject).not.toMatch(new RegExp('[\\r\\n' + String.fromCharCode(0x2028, 0x2029) + ']'))
    expect(subject).toContain('Sept Bcc: attacker@example.com x')
  })

  it('oneLine collapses every kind of break and trims', () => {
    expect(oneLine('  a\r\nb\nc\rd' + String.fromCharCode(0x2029) + 'e  ')).toBe('a b c d e')
    // Digits are untouched (an earlier edit of this guard stripped 2, 0, 8 and 9 from the subject).
    expect(oneLine('Report 2028 and 2029')).toBe('Report 2028 and 2029')
  })
})

describe('MonthlyReportPropsSchema', () => {
  it('accepts valid props', () => {
    expect(() => MonthlyReportPropsSchema.parse(validProps)).not.toThrow()
  })

  it.each([
    ['a non-URL reportUrl', { reportUrl: '/analytics/reports/2026-09' }],
    ['an empty business name', { businessName: '' }],
    ['an empty period label', { periodLabel: '' }],
    ['more than eight summary lines', { summaryLines: Array.from({ length: 9 }, (_, i) => 'line ' + i) }],
    ['an empty summary line', { summaryLines: [''] }],
  ])('rejects %s', (_name, over) => {
    expect(MonthlyReportPropsSchema.safeParse({ ...validProps, ...over }).success).toBe(false)
  })
})
