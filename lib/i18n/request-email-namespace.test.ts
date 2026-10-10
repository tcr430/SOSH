import { describe, it, expect, vi } from 'vitest'
import { createTranslator } from 'next-intl'

// getRequestConfig refuses to run outside a server context; make it the identity so the REAL config body is what runs.
vi.mock('next-intl/server', () => ({ getRequestConfig: (fn: unknown) => fn }))
import requestConfig from '@/i18n/request'
import enEmail from '@/i18n/en/email.json'
import enInvite from '@/i18n/en/invite.json'
import ptEmail from '@/i18n/pt/email.json'
import ptInvite from '@/i18n/pt/invite.json'
import esEmail from '@/i18n/es/email.json'
import esInvite from '@/i18n/es/invite.json'

// Session 37 (found at O2.8, fixed before O2.12). renderTemplate (lib/email/render.tsx) asks next-intl for
// getTranslations({ locale, namespace: 'email' }). i18n/request.ts never imported email.json or invite.json, so the
// namespace did not exist in production and EVERY email kind (trial warnings, invites, welcome, payment, first post,
// monthly report) rendered raw keys such as "email.team_invite.subject". The email tests could not see it: they build
// their own dictionary (templates/__tests__/helpers.ts) and never go through the request config.
//
// This test goes through the REAL request config for each locale, then resolves every leaf of email.json and
// invite.json through next-intl under the 'email' namespace, exactly as renderTemplate does.

const FILES = {
  en: [enEmail, enInvite],
  pt: [ptEmail, ptInvite],
  es: [esEmail, esInvite],
} as const

// key -> raw message, so each placeholder can be given a value (next-intl answers a missing value with the key itself).
function leaves(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]]
  if (typeof obj !== 'object' || obj === null) return []
  return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? prefix + '.' + k : k))
}
const valuesFor = (raw: string) => Object.fromEntries([...raw.matchAll(/\{(\w+)/g)].map((m) => [m[1], 1]))

async function emailTranslator(locale: 'en' | 'pt' | 'es') {
  const config = await requestConfig({ requestLocale: Promise.resolve(locale) } as Parameters<typeof requestConfig>[0])
  const errors: string[] = []
  const t = createTranslator({
    locale,
    messages: config.messages as Parameters<typeof createTranslator>[0]['messages'],
    namespace: 'email',
    onError: (e) => errors.push(e.message),
  }) as unknown as (key: string, values?: Record<string, unknown>) => string
  return { t, errors }
}

describe('i18n/request.ts loads the email namespace (what renderTemplate reads)', () => {
  it.each(['en', 'pt', 'es'] as const)('%s: every leaf of email.json and invite.json resolves under namespace "email", none echoes its key', async (locale) => {
    const { t, errors } = await emailTranslator(locale)
    const keys = FILES[locale].flatMap((f) => leaves(f))
    expect(keys.length).toBeGreaterThan(40)
    for (const [key, raw] of keys) {
      const out = t(key, valuesFor(raw))
      expect(out, locale + ' ' + key).not.toBe('email.' + key)
      expect(out, locale + ' ' + key).not.toBe(key)
    }
    expect(errors, locale + ' next-intl errors').toEqual([])
  })

  it('the two subjects named in the bug resolve to real text in all three locales', async () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      const { t } = await emailTranslator(locale)
      expect(t('team_invite.subject', { inviterName: 'Ana', businessName: 'Acme' }), locale).not.toMatch(/^(email\.)?team_invite\./)
      expect(t('monthly_report.subject', { month: 'March 2026' }), locale).not.toMatch(/^(email\.)?monthly_report\./)
    }
  })

  it('email and invite do not share a top-level key (the spread would let one silently replace the other)', () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      const [email, invite] = FILES[locale]
      expect(Object.keys(email).filter((k) => k in invite), locale).toEqual([])
    }
  })
})
