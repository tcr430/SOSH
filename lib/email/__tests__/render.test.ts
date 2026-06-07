import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeTranslator, LOCALES } from '../templates/__tests__/helpers'
import type { TestLocale } from '../templates/__tests__/helpers'
import { renderTemplate } from '../render'
import { EmailProviderError } from '../errors'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockImplementation(
    ({ locale }: { locale: string }) =>
      Promise.resolve(makeTranslator(locale as TestLocale)),
  ),
}))

const VALID_PROPS: Record<string, Record<string, unknown>> = {
  'trial-warning-t3': {
    businessName: 'Acme Corp',
    daysRemaining: 3,
    expiryDateIso: '2026-06-10T00:00:00.000Z',
    upgradeUrl: 'https://app.sosh.app/billing',
  },
  'trial-warning-t1': {
    businessName: 'Acme Corp',
    daysRemaining: 1,
    expiryDateIso: '2026-06-08T00:00:00.000Z',
    upgradeUrl: 'https://app.sosh.app/billing',
  },
  'welcome-to-plan': {
    businessName: 'Acme Corp',
    planName: 'Plus',
    dashboardUrl: 'https://app.sosh.app/dashboard',
  },
  'payment-failed-courtesy': {
    businessName: 'Acme Corp',
    billingPortalUrl: 'https://app.sosh.app/billing',
  },
  'first-post-published': {
    businessName: 'Acme Corp',
    platform: 'LinkedIn',
    postUrl: 'https://linkedin.com/posts/123',
  },
}

describe('renderTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('renders every (kind, locale) without throwing', () => {
    for (const kind of Object.keys(VALID_PROPS)) {
      for (const locale of LOCALES) {
        it(`${kind} / ${locale}`, async () => {
          const result = await renderTemplate(
            kind as Parameters<typeof renderTemplate>[0],
            locale,
            VALID_PROPS[kind],
          )
          expect(result.html).toBeTruthy()
          expect(result.text).toBeTruthy()
          expect(result.subject).toBeTruthy()
        })
      }
    }
  })

  it('throws EmailProviderError with template_render_failed when props are invalid', async () => {
    await expect(
      renderTemplate('trial-warning-t3', 'en', { businessName: '' }),
    ).rejects.toMatchObject({
      name: 'EmailProviderError',
      code: 'template_render_failed',
    })
  })

  it('plain-text output does not contain HTML tags', async () => {
    const result = await renderTemplate(
      'trial-warning-t3',
      'en',
      VALID_PROPS['trial-warning-t3'],
    )
    expect(result.text).not.toMatch(/<[^>]+>/)
  })

  it('subject matches the en locale-translated value', async () => {
    const t = makeTranslator('en')
    const result = await renderTemplate(
      'trial-warning-t3',
      'en',
      VALID_PROPS['trial-warning-t3'],
    )
    expect(result.subject).toBe(t('trial_warning_t3.subject'))
  })

  it('subject is localised correctly for pt', async () => {
    const t = makeTranslator('pt')
    const result = await renderTemplate(
      'trial-warning-t3',
      'pt',
      VALID_PROPS['trial-warning-t3'],
    )
    expect(result.subject).toBe(t('trial_warning_t3.subject'))
  })
})
