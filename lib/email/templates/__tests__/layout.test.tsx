import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { EmailLayout } from '../_layout'
import { makeTranslator } from './helpers'

const LOCALES = ['en', 'pt', 'es'] as const

describe('EmailLayout', () => {
  it('renders color-scheme meta tags', async () => {
    const html = await render(
      <EmailLayout locale="en" preheader="Test preheader">
        <p>Test</p>
      </EmailLayout>,
    )
    expect(html).toContain('color-scheme')
    expect(html).toContain('light dark')
    expect(html).toContain('supported-color-schemes')
  })

  it('logo has alt="SŌSH"', async () => {
    const html = await render(
      <EmailLayout locale="en" preheader="Test preheader">
        <p>Test</p>
      </EmailLayout>,
    )
    expect(html).toContain('alt="SŌSH"')
  })

  it('outer wrapper constrains to 600px', async () => {
    const html = await render(
      <EmailLayout locale="en" preheader="Test preheader">
        <p>Test</p>
      </EmailLayout>,
    )
    expect(html).toContain('600px')
  })

  it('body text font-size is >= 14px', async () => {
    const html = await render(
      <EmailLayout locale="en" preheader="Test preheader">
        <p>Test</p>
      </EmailLayout>,
    )
    expect(html).toMatch(/font-size:\s*(1[4-9]|[2-9]\d)\s*px/)
  })

  it.each(LOCALES)('footer renders tagline in %s', async (locale) => {
    const t = makeTranslator(locale)
    const tagline = t('footer.tagline')
    const html = await render(
      <EmailLayout locale={locale} preheader="Test">
        <p>Test</p>
      </EmailLayout>,
    )
    expect(tagline.length).toBeGreaterThan(0)
    expect(html).toContain('hello@mail.sosh.app')
  })

  it.each(LOCALES)('footer renders reply_to in %s', async (locale) => {
    const t = makeTranslator(locale)
    const replyTo = t('footer.reply_to')
    const html = await render(
      <EmailLayout locale={locale} preheader="Test">
        <p>Test</p>
      </EmailLayout>,
    )
    expect(replyTo.length).toBeGreaterThan(0)
    expect(html).toContain('support@sosh.app')
  })
})
