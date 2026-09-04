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

  it.each(LOCALES)('%s: settings.accounts.error.provider_unavailable is present with a non-empty message', (locale) => {
    const settings = loaded[locale]!['settings'] as Record<string, unknown>
    const accounts = settings['accounts'] as Record<string, unknown>
    const error = accounts['error'] as Record<string, unknown>
    expect(typeof error['provider_unavailable']).toBe('string')
    expect((error['provider_unavailable'] as string).length).toBeGreaterThan(0)
  })

})
