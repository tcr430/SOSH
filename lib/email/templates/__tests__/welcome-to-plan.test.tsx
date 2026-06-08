import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { WelcomeToPlanEmail, WelcomeToPlanPropsSchema, welcomeToPlanSubject } from '../welcome-to-plan'
import { makeTranslator, LOCALES } from './helpers'

const validProps = {
  businessName: 'Acme Corp',
  planName: 'Plus' as const,
  dashboardUrl: 'https://app.sosh.app/dashboard',
}

describe('WelcomeToPlanEmail', () => {
  it.each(LOCALES)('renders valid HTML in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<WelcomeToPlanEmail {...validProps} locale={locale} t={t} />)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toMatchSnapshot()
  })

  it.each(LOCALES)('subject is < 60 chars in %s locale', (locale) => {
    const t = makeTranslator(locale)
    const subject = welcomeToPlanSubject(t, validProps)
    expect(subject.length).toBeGreaterThan(0)
    expect(subject.length).toBeLessThan(60)
  })

  it.each(LOCALES)('preheader is present and non-empty in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const preheader = t('welcome_to_plan.preheader')
    const html = await render(<WelcomeToPlanEmail {...validProps} locale={locale} t={t} />)
    expect(preheader.length).toBeGreaterThan(0)
    expect(html).toContain(preheader.slice(0, 20))
  })

  it.each(LOCALES)('CTA renders as anchor link in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<WelcomeToPlanEmail {...validProps} locale={locale} t={t} />)
    expect(html).toContain('<a')
    expect(html).toContain(validProps.dashboardUrl)
  })

  it('works with Pro plan', async () => {
    const t = makeTranslator('en')
    const html = await render(<WelcomeToPlanEmail {...validProps} planName="Pro" locale="en" t={t} />)
    expect(html).toContain('Pro')
  })
})

describe('WelcomeToPlanPropsSchema', () => {
  it('accepts valid props', () => {
    expect(() => WelcomeToPlanPropsSchema.parse(validProps)).not.toThrow()
  })

  it('rejects invalid planName', () => {
    const result = WelcomeToPlanPropsSchema.safeParse({ ...validProps, planName: 'starter' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('planName')
    }
  })

  it('rejects non-URL dashboardUrl', () => {
    const result = WelcomeToPlanPropsSchema.safeParse({ ...validProps, dashboardUrl: '/dashboard' })
    expect(result.success).toBe(false)
  })
})
