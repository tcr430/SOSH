import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { FirstPostPublishedEmail, FirstPostPublishedPropsSchema, firstPostPublishedSubject } from '../first-post-published'
import { makeTranslator, LOCALES } from './helpers'

const validProps = {
  businessName: 'Acme Corp',
  platform: 'LinkedIn' as const,
  postUrl: 'https://app.sosh.app/campaigns/1/posts',
}

describe('FirstPostPublishedEmail', () => {
  it.each(LOCALES)('renders valid HTML in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<FirstPostPublishedEmail {...validProps} locale={locale} t={t} />)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toMatchSnapshot()
  })

  it.each(LOCALES)('subject is < 60 chars in %s locale', (locale) => {
    const t = makeTranslator(locale)
    const subject = firstPostPublishedSubject(t, validProps)
    expect(subject.length).toBeGreaterThan(0)
    expect(subject.length).toBeLessThan(60)
  })

  it.each(LOCALES)('preheader is present and non-empty in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const preheader = t('first_post_published.preheader', { platform: validProps.platform })
    const html = await render(<FirstPostPublishedEmail {...validProps} locale={locale} t={t} />)
    expect(preheader.length).toBeGreaterThan(0)
    expect(html).toContain('LinkedIn')
  })

  it.each(LOCALES)('CTA renders as anchor link in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<FirstPostPublishedEmail {...validProps} locale={locale} t={t} />)
    expect(html).toContain('<a')
    expect(html).toContain(validProps.postUrl)
  })

  it('platform name is untranslated (brand noun)', async () => {
    const t = makeTranslator('pt')
    const html = await render(<FirstPostPublishedEmail {...validProps} locale="pt" t={t} />)
    expect(html).toContain('LinkedIn')
  })
})

describe('FirstPostPublishedPropsSchema', () => {
  it('accepts valid props for all platforms', () => {
    const platforms = ['LinkedIn', 'X', 'Instagram', 'Facebook', 'Threads'] as const
    for (const platform of platforms) {
      expect(() => FirstPostPublishedPropsSchema.parse({ ...validProps, platform })).not.toThrow()
    }
  })

  it('rejects unknown platform', () => {
    const result = FirstPostPublishedPropsSchema.safeParse({ ...validProps, platform: 'Reddit' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('platform')
    }
  })

  it('rejects non-URL postUrl', () => {
    const result = FirstPostPublishedPropsSchema.safeParse({ ...validProps, postUrl: '/posts' })
    expect(result.success).toBe(false)
  })
})
