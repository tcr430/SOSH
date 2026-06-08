import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { PaymentFailedCourtesyEmail, PaymentFailedCourtesyPropsSchema, paymentFailedCourtesySubject } from '../payment-failed-courtesy'
import { makeTranslator, LOCALES } from './helpers'

const validProps = {
  businessName: 'Acme Corp',
  billingPortalUrl: 'https://billing.stripe.com/session/test_123',
}

describe('PaymentFailedCourtesyEmail', () => {
  it.each(LOCALES)('renders valid HTML in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<PaymentFailedCourtesyEmail {...validProps} locale={locale} t={t} />)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toMatchSnapshot()
  })

  it.each(LOCALES)('subject is < 60 chars in %s locale', (locale) => {
    const t = makeTranslator(locale)
    const subject = paymentFailedCourtesySubject(t, validProps)
    expect(subject.length).toBeGreaterThan(0)
    expect(subject.length).toBeLessThan(60)
  })

  it.each(LOCALES)('preheader is present and non-empty in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const preheader = t('payment_failed_courtesy.preheader')
    const html = await render(<PaymentFailedCourtesyEmail {...validProps} locale={locale} t={t} />)
    expect(preheader.length).toBeGreaterThan(0)
    expect(html).toContain(preheader.slice(0, 20))
  })

  it.each(LOCALES)('CTA renders as anchor link in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<PaymentFailedCourtesyEmail {...validProps} locale={locale} t={t} />)
    expect(html).toContain('<a')
    expect(html).toContain(validProps.billingPortalUrl)
  })

  it('uses empathetic copy (no threatening language)', async () => {
    const t = makeTranslator('en')
    const html = await render(<PaymentFailedCourtesyEmail {...validProps} locale="en" t={t} />)
    const lower = html.toLowerCase()
    expect(lower).not.toContain('suspend')
    expect(lower).not.toContain('cancel')
    expect(lower).not.toContain('terminate')
  })
})

describe('PaymentFailedCourtesyPropsSchema', () => {
  it('accepts valid props', () => {
    expect(() => PaymentFailedCourtesyPropsSchema.parse(validProps)).not.toThrow()
  })

  it('rejects missing businessName', () => {
    const result = PaymentFailedCourtesyPropsSchema.safeParse({ ...validProps, businessName: undefined })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('businessName')
    }
  })

  it('rejects non-URL billingPortalUrl', () => {
    const result = PaymentFailedCourtesyPropsSchema.safeParse({ ...validProps, billingPortalUrl: 'not-a-url' })
    expect(result.success).toBe(false)
  })
})
