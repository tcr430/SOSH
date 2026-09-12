import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Mirrors house convention (e.g. connect.test.ts) — mocking the '@/lib/social'
// barrel avoids pulling in lib/config.ts's Zod env validation, which throws
// outside a fully-configured runtime. Only PLATFORM_CONFIGS' shape matters here.
vi.mock('@/lib/social', () => ({
  PLATFORM_CONFIGS: {
    linkedin: { displayName: 'LinkedIn' },
    twitter: { displayName: 'X (Twitter)' },
    instagram: { displayName: 'Instagram' },
    facebook: { displayName: 'Facebook' },
    threads: { displayName: 'Threads' },
  },
}))

const { ERROR_KEYS, isErrorKey, resolveAccountsBanner } = await import('./resolve-banner')

function loadCommon(locale: string): Record<string, unknown> {
  const path = join(__dirname, '..', '..', '..', '..', '..', 'i18n', locale, 'common.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

function makeTranslator(locale: string) {
  const common = loadCommon(locale)
  const settings = common['settings'] as Record<string, unknown>
  const accounts = settings['accounts'] as Record<string, unknown>
  return (key: string, values?: Record<string, string>) => {
    const parts = key.split('.')
    let node: unknown = accounts
    for (const part of parts) {
      node = (node as Record<string, unknown>)[part]
    }
    let message = node as string
    for (const [k, v] of Object.entries(values ?? {})) {
      message = message.replaceAll(`{${k}}`, v)
    }
    return message
  }
}

const LOCALES = ['en', 'pt', 'es'] as const

describe('ERROR_KEYS — ADR 0028 §9.4, exactly seven reachable OAuth error codes', () => {
  it('has exactly seven entries, matching the connect/callback route surface', () => {
    expect(ERROR_KEYS).toHaveLength(7)
    expect(ERROR_KEYS).toEqual([
      'invalid_state',
      'forbidden',
      'oauth_denied',
      'exchange_failed',
      'vault_write_failed',
      'db_write_failed',
      'connect_failed',
    ])
  })

  it('does not include provider_unavailable — no route emits it', () => {
    expect((ERROR_KEYS as readonly string[]).includes('provider_unavailable')).toBe(false)
  })

  it('isErrorKey accepts every ERROR_KEYS member and rejects unknown/dead keys', () => {
    for (const key of ERROR_KEYS) {
      expect(isErrorKey(key)).toBe(true)
    }
    expect(isErrorKey('provider_unavailable')).toBe(false)
    expect(isErrorKey('not_a_real_code')).toBe(false)
  })
})

describe.each(LOCALES)('resolveAccountsBanner — %s locale', (locale) => {
  const t = makeTranslator(locale)

  it.each(ERROR_KEYS)('renders a distinct, non-empty message for error=%s', (key) => {
    const banner = resolveAccountsBanner({ error: key, platform: 'linkedin' }, t)
    expect(banner).not.toBeNull()
    expect(banner!.type).toBe('error')
    expect(banner!.message.length).toBeGreaterThan(0)
  })

  it('all seven error messages are mutually distinct', () => {
    const messages = ERROR_KEYS.map(
      (key) => resolveAccountsBanner({ error: key, platform: 'linkedin' }, t)!.message,
    )
    expect(new Set(messages).size).toBe(ERROR_KEYS.length)
  })

  it('falls back to exchange_failed for an unknown error code', () => {
    const banner = resolveAccountsBanner({ error: 'not_a_real_code' }, t)
    expect(banner!.message).toBe(t('error.exchange_failed'))
  })

  it('renders a success banner naming the connected platform', () => {
    const banner = resolveAccountsBanner({ connected: 'twitter' }, t)
    expect(banner!.type).toBe('success')
    expect(banner!.message).toContain('X (Twitter)')
  })

  it('returns null when neither connected nor error is present', () => {
    expect(resolveAccountsBanner({}, t)).toBeNull()
  })

  it('returns null for an unknown connected platform', () => {
    expect(resolveAccountsBanner({ connected: 'not_a_platform' }, t)).toBeNull()
  })
})
