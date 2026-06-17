import { describe, it, expect } from 'vitest'
import {
  REDACTED_KEYS,
  normaliseKey,
  isEmailLike,
  scrubString,
  scrubEvent,
  scrubObject,
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

// ── scrubObject — value-scan pass (B18-076) ───────────────────────────────────

describe('scrubObject — value-scan pass', () => {
  it('redacts email value at depth 2', () => {
    const obj = { meta: { contact: 'user@example.com' } }
    const result = scrubObject(obj) as Record<string, Record<string, unknown>>
    expect(result.meta.contact).toBe('u***@example.com')
  })

  it('redacts JWT value at depth 4', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const obj = { a: { b: { c: { d: jwt } } } }
    const result = scrubObject(obj) as Record<string, unknown>
    expect(
      ((result.a as Record<string, unknown>).b as Record<string, unknown>).c,
    ).toEqual({ d: '[REDACTED]' })
  })

  it('redacts Stripe sk_live_ key', () => {
    const obj = { key: 'sk_live_abcdefghijklmnopqrstu' }
    expect((scrubObject(obj) as Record<string, unknown>).key).toBe('[REDACTED]')
  })

  it('redacts long hex token (32+ chars) via value-scan (key not in REDACTED_KEYS)', () => {
    // key "hex_data" doesn't match key-based redaction → value-scan fires
    const obj = { hex_data: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' }
    expect((scrubObject(obj) as Record<string, unknown>).hex_data).toBe('[REDACTED]')
  })

  it('does not redact a short string that does not match any pattern', () => {
    const obj = { label: 'hello-world' }
    expect((scrubObject(obj) as Record<string, unknown>).label).toBe('hello-world')
  })

  it('handles circular references without stack overflow', () => {
    const a: Record<string, unknown> = { x: 1 }
    a.b = a // a.b → a (cycle)
    expect(() => scrubObject(a)).not.toThrow()
    const result = scrubObject(a) as Record<string, unknown>
    expect(result.b).toBe('[CIRCULAR]')
  })

  it('does not recurse past depth 5', () => {
    // Build a 7-level deep object; value at depth 6 should NOT be redacted.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const obj = { l1: { l2: { l3: { l4: { l5: { l6: jwt } } } } } }
    const result = scrubObject(obj) as Record<string, unknown>
    // l5 is at depth 5 → returned as-is (no recursion into l6)
    const l5 = ((((result.l1 as Record<string, unknown>).l2 as Record<string, unknown>).l3 as Record<string, unknown>).l4 as Record<string, unknown>).l5
    expect(typeof l5).toBe('object')
    // l6 inside l5 is not traversed — its raw value remains
    expect((l5 as Record<string, unknown>).l6).toBe(jwt)
  })

  it('truncates arrays with more than 100 elements', () => {
    const large = Array.from({ length: 101 }, (_, i) => i)
    const result = scrubObject(large)
    expect(result).toEqual(['[ARRAY_TRUNCATED]'])
  })

  it('truncates objects with more than 50 keys', () => {
    const large = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v']))
    expect(scrubObject(large)).toBe('[OBJECT_TRUNCATED]')
  })
})

// ── scrubString — inline email scrubbing (B18-008) ────────────────────────────

describe('scrubString — inline email scrubbing', () => {
  it('redacts a bare email that is the whole string', () => {
    expect(scrubString('user@example.com')).toBe('u***@example.com')
  })

  it('redacts an email embedded inside an error message', () => {
    const result = scrubString('Failed to deliver email to user@example.com: bounce')
    expect(result).toContain('u***@example.com')
    expect(result).not.toContain('user@example.com')
  })

  it('redacts multiple emails in a single string', () => {
    const result = scrubString('Sending from a@corp.io to b@other.com failed')
    expect(result).not.toContain('a@corp.io')
    expect(result).not.toContain('b@other.com')
    expect(result).toContain('a***@corp.io')
    expect(result).toContain('b***@other.com')
  })

  it('leaves plain text without an email unchanged', () => {
    expect(scrubString('something went wrong')).toBe('something went wrong')
  })
})

// ── scrubEvent — exception value scrubbing (B18-008) ─────────────────────────

describe('scrubEvent — exception value scrubbing', () => {
  it('scrubs an email embedded in exception.values[].value', () => {
    const event = {
      exception: {
        values: [{ type: 'EmailProviderError', value: 'Invalid recipient user@example.com' }],
      },
    }
    const result = scrubEvent(event)!
    expect(result.exception!.values![0].value).toContain('u***@example.com')
    expect(result.exception!.values![0].value).not.toContain('user@example.com')
  })

  it('leaves exception.values[].value without an email unchanged', () => {
    const event = {
      exception: { values: [{ type: 'Error', value: 'Something went wrong' }] },
    }
    const result = scrubEvent(event)!
    expect(result.exception!.values![0].value).toBe('Something went wrong')
  })

  it('handles missing exception gracefully', () => {
    const event = { user: { id: 'u1' } }
    expect(scrubEvent(event)).not.toBeNull()
  })

  it('preserves exception.values[].type (only value is scrubbed)', () => {
    const event = {
      exception: { values: [{ type: 'EmailProviderError', value: 'err at a@b.co' }] },
    }
    const result = scrubEvent(event)!
    expect(result.exception!.values![0].type).toBe('EmailProviderError')
  })
})
