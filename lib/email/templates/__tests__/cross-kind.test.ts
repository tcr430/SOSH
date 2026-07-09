import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { createElement } from 'react'
import { TEMPLATES } from '../index'
import type { EmailKind } from '../../types'
import { makeTranslator } from './helpers'

const LOCALES = ['en', 'pt', 'es'] as const

const SAMPLE_PROPS: Record<EmailKind, Record<string, unknown>> = {
  'trial-warning-t3': {
    businessName: 'Acme',
    daysRemaining: 3,
    expiryDateIso: '2026-07-01T00:00:00.000Z',
    upgradeUrl: 'https://sosh.app/billing',
  },
  'trial-warning-t1': {
    businessName: 'Acme',
    daysRemaining: 1,
    expiryDateIso: '2026-07-01T00:00:00.000Z',
    upgradeUrl: 'https://sosh.app/billing',
  },
  'welcome-to-plan': {
    businessName: 'Acme',
    planName: 'Plus',
    dashboardUrl: 'https://app.sosh.app/dashboard',
  },
  'payment-failed-courtesy': {
    businessName: 'Acme',
    billingPortalUrl: 'https://billing.stripe.com/session/test',
  },
  'first-post-published': {
    businessName: 'Acme',
    platform: 'LinkedIn',
    postUrl: 'https://app.sosh.app/posts',
  },
  'team-invite': {
    inviterName: 'Jamie',
    businessName: 'Acme',
    roleLabelKey: 'team_invite.role.viewer',
    acceptUrl: 'https://app.sosh.app/en/invite/accept?token=abc',
  },
}

describe('cross-kind: subject < 60 chars for all kinds × locales', () => {
  const kinds = Object.keys(SAMPLE_PROPS) as EmailKind[]
  for (const kind of kinds) {
    for (const locale of LOCALES) {
      it(`${kind} / ${locale}`, () => {
        const t = makeTranslator(locale)
        const props = SAMPLE_PROPS[kind]
        const subject = TEMPLATES[kind].subject(t, props)
        expect(subject.length).toBeLessThan(60)
        expect(subject.length).toBeGreaterThan(0)
      })
    }
  }
})

describe('cross-kind: rendered HTML contains CTA <a> for all kinds × locales', () => {
  const kinds = Object.keys(SAMPLE_PROPS) as EmailKind[]
  for (const kind of kinds) {
    for (const locale of LOCALES) {
      it(`${kind} / ${locale}`, async () => {
        const t = makeTranslator(locale)
        const props = SAMPLE_PROPS[kind]
        const { Component } = TEMPLATES[kind]
        const html = await render(createElement(Component, { ...props, locale, t }))
        expect(html).toContain('<a')
      })
    }
  }
})
