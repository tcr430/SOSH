import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { TrialWarningT1Email, TrialWarningT1PropsSchema, trialWarningT1Subject } from '../trial-warning-t1'
import { makeTranslator, LOCALES } from './helpers'

const validProps = {
  businessName: 'Acme Corp',
  daysRemaining: 1 as const,
  expiryDateIso: '2026-07-01T00:00:00.000Z',
  upgradeUrl: 'https://sosh.app/billing',
}

describe('TrialWarningT1Email', () => {
  it.each(LOCALES)('renders valid HTML in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<TrialWarningT1Email {...validProps} locale={locale} t={t} />)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toMatchSnapshot()
  })

  it.each(LOCALES)('subject is < 60 chars in %s locale', (locale) => {
    const t = makeTranslator(locale)
    const subject = trialWarningT1Subject(t, validProps)
    expect(subject.length).toBeGreaterThan(0)
    expect(subject.length).toBeLessThan(60)
  })

  it.each(LOCALES)('preheader is present and non-empty in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const preheader = t('trial_warning_t1.preheader')
    const html = await render(<TrialWarningT1Email {...validProps} locale={locale} t={t} />)
    expect(preheader.length).toBeGreaterThan(0)
    expect(html).toContain(preheader.slice(0, 20))
  })

  it.each(LOCALES)('CTA renders as anchor link in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<TrialWarningT1Email {...validProps} locale={locale} t={t} />)
    expect(html).toContain('<a')
    expect(html).toContain(validProps.upgradeUrl)
  })
})

describe('TrialWarningT1PropsSchema', () => {
  it('accepts valid props', () => {
    expect(() => TrialWarningT1PropsSchema.parse(validProps)).not.toThrow()
  })

  it('rejects daysRemaining !== 1', () => {
    const result = TrialWarningT1PropsSchema.safeParse({ ...validProps, daysRemaining: 3 })
    expect(result.success).toBe(false)
  })

  it('rejects missing upgradeUrl', () => {
    const result = TrialWarningT1PropsSchema.safeParse({ ...validProps, upgradeUrl: undefined })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('upgradeUrl')
    }
  })
})
