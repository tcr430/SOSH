import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { TeamInviteEmail, TeamInvitePropsSchema, teamInviteSubject } from '../team-invite'
import { makeTranslator, LOCALES } from './helpers'

const validProps = {
  inviterName: 'Jamie',
  businessName: 'Acme Corp',
  roleLabelKey: 'team_invite.role.viewer',
  acceptUrl: 'https://app.sosh.app/en/invite/accept?token=signed-jwt',
}

describe('TeamInviteEmail', () => {
  it.each(LOCALES)('renders valid HTML in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<TeamInviteEmail {...validProps} locale={locale} t={t} />)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toMatchSnapshot()
  })

  it.each(LOCALES)('subject is < 60 chars in %s locale', (locale) => {
    const t = makeTranslator(locale)
    const subject = teamInviteSubject(t, validProps)
    expect(subject.length).toBeGreaterThan(0)
    expect(subject.length).toBeLessThan(60)
  })

  it.each(LOCALES)('preheader is present and non-empty in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const preheader = t('team_invite.preheader', { businessName: validProps.businessName })
    const html = await render(<TeamInviteEmail {...validProps} locale={locale} t={t} />)
    expect(preheader.length).toBeGreaterThan(0)
    expect(html).toContain('Acme Corp')
  })

  it.each(LOCALES)('CTA renders as anchor link in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<TeamInviteEmail {...validProps} locale={locale} t={t} />)
    expect(html).toContain('<a')
    expect(html).toContain(validProps.acceptUrl)
  })

  it.each(LOCALES)('resolves roleLabelKey to a translated role label, not the raw key, in %s locale', async (locale) => {
    const t = makeTranslator(locale)
    const html = await render(<TeamInviteEmail {...validProps} locale={locale} t={t} />)
    expect(html).not.toContain('team_invite.role.viewer')
  })
})

describe('TeamInvitePropsSchema', () => {
  it('accepts valid props', () => {
    expect(() => TeamInvitePropsSchema.parse(validProps)).not.toThrow()
  })

  it('rejects a non-URL acceptUrl', () => {
    const result = TeamInvitePropsSchema.safeParse({ ...validProps, acceptUrl: '/invite/accept' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty roleLabelKey', () => {
    const result = TeamInvitePropsSchema.safeParse({ ...validProps, roleLabelKey: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty inviterName', () => {
    const result = TeamInvitePropsSchema.safeParse({ ...validProps, inviterName: '' })
    expect(result.success).toBe(false)
  })
})
