import { describe, it, expect } from 'vitest'
import {
  REDACTED_KEYS,
  normaliseKey,
  isEmailLike,
  scrubString,
  scrubEvent,
} from './sentry-scrub'

// ── normaliseKey ─────────────────────────────────────────────────────────────

describe('normaliseKey', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normaliseKey('Access-Token')).toBe('accesstoken')
    expect(normaliseKey('accessToken')).toBe('accesstoken')
    expect(normaliseKey('access_token')).toBe('accesstoken')
    expect(normaliseKey('ACCESS.TOKEN')).toBe('accesstoken')
  })
})

// ── REDACTED_KEYS membership ──────────────────────────────────────────────────

describe('REDACTED_KEYS', () => {
  it('contains expected post-normalisation entries', () => {
    const expected = [
      'accesstoken', 'refreshtoken',
      'vaultaccesstokenid', 'vaultrefreshtokenid',
      'stripesecretkey', 'stripewebhooksecret',
      'cronsecret', 'oauthstatesecret', 'healthchecktoken',
      'sentryauthtoken', 'sentrydsn',
      'authorization', 'cookie', 'setcookie',
      'password', 'passwordconfirmation', 'newpassword',
      'token', 'secret', 'apikey',
    ]
    for (const key of expected) {
      expect(REDACTED_KEYS.has(key), `missing: ${key}`).toBe(true)
    }
  })

  it('hits access_token via every separator permutation', () => {
    const variants = ['Access-Token', 'accessToken', 'access_token', 'ACCESS.TOKEN']
    for (const v of variants) {
      expect(REDACTED_KEYS.has(normaliseKey(v)), `should match: ${v}`).toBe(true)
    }
  })

  it('catch-all "token" redacts MY_AUTH_TOKEN_VALUE key via scrubEvent', () => {
    const event = { extra: { MY_AUTH_TOKEN_VALUE: 'secret-value' } }
    const result = scrubEvent(event)!
    expect(result.extra!.MY_AUTH_TOKEN_VALUE).toBe('[Filtered]')
  })

  it('explicit access_token entry covers its normalised form', () => {
    expect(REDACTED_KEYS.has(normaliseKey('access_token'))).toBe(true)
  })
})

// ── isEmailLike ───────────────────────────────────────────────────────────────

describe('isEmailLike', () => {
  it('returns true for valid email shapes', () => {
    expect(isEmailLike('user@example.com')).toBe(true)
    expect(isEmailLike('a@b.co')).toBe(true)
    expect(isEmailLike('foo.bar+baz@sub.domain.io')).toBe(true)
  })

  it('returns false for non-email strings', () => {
    expect(isEmailLike('not-an-email')).toBe(false)
    expect(isEmailLike('missing@tld')).toBe(false)
    expect(isEmailLike('@nodomain.com')).toBe(false)
    expect(isEmailLike('')).toBe(false)
  })
})

// ── scrubString ───────────────────────────────────────────────────────────────

describe('scrubString', () => {
  it('filters token/code/state query params', () => {
    expect(scrubString('https://x.com/cb?code=AAA&state=BBB&keep=1')).toBe(
      'https://x.com/cb?code=[Filtered]&state=[Filtered]&keep=1',
    )
  })

  it('filters token param', () => {
    expect(scrubString('https://x.com/reset?token=secret123&next=/home')).toBe(
      'https://x.com/reset?token=[Filtered]&next=/home',
    )
  })

  it('redacts email local part', () => {
    expect(scrubString('user@example.com')).toBe('u***@example.com')
    expect(scrubString('a@b.co')).toBe('a***@b.co')
  })

  it('leaves domain visible after email scrub', () => {
    const result = scrubString('admin@company.io')
    expect(result).toContain('@company.io')
    expect(result).not.toContain('admin')
  })

  it('returns plain strings unchanged', () => {
    expect(scrubString('hello world')).toBe('hello world')
    expect(scrubString('')).toBe('')
  })
})

// ── scrubEvent — route-path exclusion ────────────────────────────────────────

describe('scrubEvent — route-path exclusion', () => {
  it('drops event for /api/stripe/webhook', () => {
    expect(scrubEvent({ request: { url: 'https://app.com/api/stripe/webhook' } })).toBeNull()
  })

  it('drops event for /api/cron/publish', () => {
    expect(scrubEvent({ request: { url: 'https://app.com/api/cron/publish' } })).toBeNull()
  })

  it('drops event for /api/cron/sync-metrics', () => {
    expect(scrubEvent({ request: { url: 'https://app.com/api/cron/sync-metrics' } })).toBeNull()
  })

  it('does NOT drop /api/stripe/webhooks (trailing s)', () => {
    const event = { request: { url: 'https://app.com/api/stripe/webhooks' } }
    expect(scrubEvent(event)).not.toBeNull()
  })

  it('does NOT drop unrelated API paths', () => {
    const event = { request: { url: 'https://app.com/api/billing/session-status' } }
    expect(scrubEvent(event)).not.toBeNull()
  })
})

// ── scrubEvent — URL-query scrubbing ─────────────────────────────────────────

describe('scrubEvent — URL-query scrubbing', () => {
  it('scrubs request.url query params', () => {
    const event = {
      request: { url: 'https://app.com/cb?code=AAA&state=BBB&keep=1' },
    }
    const result = scrubEvent(event)!
    expect(result.request!.url).toBe(
      'https://app.com/cb?code=[Filtered]&state=[Filtered]&keep=1',
    )
  })

  it('scrubs breadcrumb data.url when category is fetch', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'fetch',
          data: { url: 'https://api.com/auth?token=XYZ&keep=1' },
        },
      ],
    }
    const result = scrubEvent(event)!
    expect(result.breadcrumbs![0].data.url).toBe(
      'https://api.com/auth?token=[Filtered]&keep=1',
    )
  })

  it('scrubs breadcrumb data.to when category is navigation', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'navigation',
          data: { to: '/reset-password?code=SECRET&next=home' },
        },
      ],
    }
    const result = scrubEvent(event)!
    expect(result.breadcrumbs![0].data.to).toBe(
      '/reset-password?code=[Filtered]&next=home',
    )
  })

  it('does NOT scrub breadcrumb url when category is not navigation/fetch', () => {
    const url = 'https://api.com/auth?token=XYZ'
    const event = {
      breadcrumbs: [
        { category: 'console', data: { url } },
      ],
    }
    const result = scrubEvent(event)!
    expect(result.breadcrumbs![0].data.url).toBe(url)
  })
})

// ── scrubEvent — recursive key-redaction ─────────────────────────────────────

describe('scrubEvent — recursive key-redaction', () => {
  it('redacts authorization in request.headers', () => {
    const event = {
      request: { headers: { authorization: 'Bearer tok', 'x-other': 'ok' } },
    }
    const result = scrubEvent(event)!
    expect(result.request!.headers!.authorization).toBe('[Filtered]')
    expect(result.request!.headers!['x-other']).toBe('ok')
  })

  it('redacts nested keys in event.extra', () => {
    const event = {
      extra: { meta: { access_token: 'abc', safe: 'keep' } },
    }
    const result = scrubEvent(event)!
    expect((result.extra!.meta as Record<string, unknown>).access_token).toBe('[Filtered]')
    expect((result.extra!.meta as Record<string, unknown>).safe).toBe('keep')
  })

  it('redacts password in event.user', () => {
    const event = { user: { id: 'u1', password: 'hunter2' } }
    const result = scrubEvent(event)!
    expect(result.user!.password).toBe('[Filtered]')
    expect(result.user!.id).toBe('u1')
  })

  it('redacts stripe_secret_key via catch-all "secret"', () => {
    const event = { extra: { stripe_secret_key: 'sk_live_abc' } }
    const result = scrubEvent(event)!
    expect(result.extra!.stripe_secret_key).toBe('[Filtered]')
  })
})

// ── scrubEvent — email leaf scrubbing ─────────────────────────────────────────

describe('scrubEvent — email leaf scrubbing', () => {
  it('redacts email local part in event.user', () => {
    const event = { user: { id: 'u1', email: 'user@example.com' } }
    const result = scrubEvent(event)!
    expect(result.user!.email).toBe('u***@example.com')
  })

  it('keeps domain visible', () => {
    const event = { user: { email: 'admin@corp.io' } }
    const result = scrubEvent(event)!
    expect(result.user!.email).toContain('@corp.io')
  })

  it('redacts email string leaf in event.extra', () => {
    const event = { extra: { notified: 'test@domain.org' } }
    const result = scrubEvent(event)!
    expect(result.extra!.notified).toBe('t***@domain.org')
  })
})

// ── scrubEvent — robustness / missing fields ──────────────────────────────────

describe('scrubEvent — missing fields', () => {
  it('returns the event when request is absent', () => {
    const event = { user: { id: 'u1' } }
    const result = scrubEvent(event)
    expect(result).not.toBeNull()
    expect(result!.user!.id).toBe('u1')
  })

  it('returns the event when breadcrumbs is absent', () => {
    const event = { request: { url: 'https://app.com/dashboard' } }
    expect(scrubEvent(event)).not.toBeNull()
  })

  it('handles empty event object', () => {
    expect(scrubEvent({})).not.toBeNull()
  })
})
