import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { TrialWarningT3Email, TrialWarningT3PropsSchema, trialWarningT3Subject } from '../trial-warning-t3'
import { makeTranslator, LOCALES } from './helpers'

const validProps = {
  businessName: 'Acme Corp',
  daysRemaining: 3 as const,
  expiryDateIso: '2026-07-01T00:00:00.000Z',
  upgradeUrl: 'https://sosh.app/billing',
}

describe('TrialWarningT3Email', () => {
  it.each(LOCALES)('renders valid HTML in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<TrialWarningT3Email {...validProps} locale={locale} t={t} />)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toMatchSnapshot()
  })

  it.each(LOCALES)('subject is < 60 chars in %s locale', (locale) => {
    const t = makeTranslator(locale)
    const subject = trialWarningT3Subject(t, validProps)
    expect(subject.length).toBeGreaterThan(0)
    expect(subject.length).toBeLessThan(60)
  })

  it.each(LOCALES)('preheader is present and non-empty in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const preheader = t('trial_warning_t3.preheader')
    const html = await render(<TrialWarningT3Email {...validProps} locale={locale} t={t} />)
    expect(preheader.length).toBeGreaterThan(0)
    expect(html).toContain(preheader.slice(0, 20))
  })

  it.each(LOCALES)('CTA renders as anchor link in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<TrialWarningT3Email {...validProps} locale={locale} t={t} />)
    expect(html).toContain('<a')
    expect(html).toContain(validProps.upgradeUrl)
  })
})

describe('TrialWarningT3PropsSchema', () => {
  it('accepts valid props', () => {
    expect(() => TrialWarningT3PropsSchema.parse(validProps)).not.toThrow()
  })

  it('rejects empty businessName', () => {
    const result = TrialWarningT3PropsSchema.safeParse({ ...validProps, businessName: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('businessName')
    }
  })

  it('rejects daysRemaining !== 3', () => {
    const result = TrialWarningT3PropsSchema.safeParse({ ...validProps, daysRemaining: 1 })
    expect(result.success).toBe(false)
  })

  it('rejects non-URL upgradeUrl', () => {
    const result = TrialWarningT3PropsSchema.safeParse({ ...validProps, upgradeUrl: 'not-a-url' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('upgradeUrl')
    }
  })

  it('rejects invalid ISO datetime', () => {
    const result = TrialWarningT3PropsSchema.safeParse({ ...validProps, expiryDateIso: '2026-13-01' })
    expect(result.success).toBe(false)
  })
})
