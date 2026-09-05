import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// SOCIAL-I18N-NO-BROKER-KEY (ADR 0028 §8.3, N2.11). The KEY leaked the
// broker; the MESSAGE never did. postiz_unavailable is renamed to
// provider_unavailable in all three locales simultaneously — the
// user-facing string is unchanged, only the key that a codebase audit
// would read as "we use Postiz" is gone.

function loadCommon(locale: string): Record<string, unknown> {
  const path = join(__dirname, '..', '..', '..', '..', '..', 'i18n', locale, 'common.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

const LOCALES = ['en', 'pt', 'es'] as const

describe('accounts i18n — SOCIAL-I18N-NO-BROKER-KEY', () => {
  const loaded = Object.fromEntries(LOCALES.map((l) => [l, loadCommon(l)]))

  it.each(LOCALES)('%s: settings.accounts.error has no postiz_unavailable key', (locale) => {
    const settings = loaded[locale]!['settings'] as Record<string, unknown>
    const accounts = settings['accounts'] as Record<string, unknown>
    const error = accounts['error'] as Record<string, unknown>
    expect(error).not.toHaveProperty('postiz_unavailable')
  })

  // NIT-1 (Session 30.5-D, D7): the "provider_unavailable is present" test
  // that lived here is REMOVED, not just changed — the key itself is deleted
  // from all three locale files in this commit. No route emits
  // error=provider_unavailable (it is deliberately absent from
  // resolve-banner.ts's ERROR_KEYS, confirmed by grep), so pinning the
  // translated string's presence kept a dead key alive. This is the ONLY
  // test deletion this correction pass authorises, and it is paired with
  // removing the string — not with lowering a bar.
  it.each(LOCALES)('%s: settings.accounts.error has no provider_unavailable key (removed, unemittable — NIT-1)', (locale) => {
    const settings = loaded[locale]!['settings'] as Record<string, unknown>
    const accounts = settings['accounts'] as Record<string, unknown>
    const error = accounts['error'] as Record<string, unknown>
    expect(error).not.toHaveProperty('provider_unavailable')
  })
})
