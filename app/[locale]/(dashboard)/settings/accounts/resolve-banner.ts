import { PLATFORM_CONFIGS } from '@/lib/social'
import type { Platform } from '@/lib/social'

// ADR 0028 §9.4 — exactly seven OAuth error-redirect codes, all landing on
// /{locale}/settings/accounts: invalid_state, forbidden, oauth_denied,
// exchange_failed, vault_write_failed, db_write_failed (callback/route.ts),
// connect_failed (connect/route.ts:69). 'provider_unavailable' was NOT one
// of them — it was a translation key renamed in N2.11 from the prior
// broker's equivalent (SOCIAL-I18N-NO-BROKER-KEY), but no connect/callback
// route ever emitted error=provider_unavailable. NIT-1 (Session 30.5-D, D7):
// removed from all three locale files entirely, rather than kept alive by a
// test pinning its presence — a translated string no code path can produce
// is dead weight, not a defensive reserve.
export const ERROR_KEYS = [
  'invalid_state',
  'forbidden',
  'oauth_denied',
  'exchange_failed',
  'vault_write_failed',
  'db_write_failed',
  'connect_failed',
] as const

export type ErrorKey = (typeof ERROR_KEYS)[number]

export function isErrorKey(k: string): k is ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(k)
}

export type AccountsBanner = { type: 'success' | 'error'; message: string }

type Translator = (key: string, values?: Record<string, string>) => string

export function resolveAccountsBanner(
  searchParams: { connected?: string; error?: string; platform?: string },
  t: Translator,
): AccountsBanner | null {
  const { connected, error, platform: errorPlatform } = searchParams

  if (connected) {
    const config = PLATFORM_CONFIGS[connected as Platform]
    if (config) {
      return { type: 'success', message: t('success.connected', { platform: config.displayName }) }
    }
    return null
  }

  if (error) {
    const platformName = PLATFORM_CONFIGS[errorPlatform as Platform]?.displayName ?? errorPlatform ?? ''
    const message = isErrorKey(error)
      ? t(`error.${error}`, { platform: platformName })
      : t('error.exchange_failed')
    return { type: 'error', message }
  }

  return null
}
