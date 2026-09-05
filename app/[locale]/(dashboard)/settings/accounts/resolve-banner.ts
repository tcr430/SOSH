import { PLATFORM_CONFIGS } from '@/lib/social'
import type { Platform } from '@/lib/social'

// ADR 0028 §9.4 — exactly seven OAuth error-redirect codes, all landing on
// /{locale}/settings/accounts: invalid_state, forbidden, oauth_denied,
// exchange_failed, vault_write_failed, db_write_failed (callback/route.ts),
// connect_failed (connect/route.ts:69). 'provider_unavailable' is NOT one of
// them — it is a translation key renamed in N2.11 from the prior broker's
// equivalent (SOCIAL-I18N-NO-BROKER-KEY), but no connect/callback route emits
// error=provider_unavailable today; grepped both routes to confirm. Kept in
// the locale files (accounts-i18n.test.ts still asserts its presence) but
// deliberately absent from ERROR_KEYS, which names only reachable states.
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
