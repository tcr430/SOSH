import { describe, it, expect, afterEach } from 'vitest'
import { serverSchema, config } from '@/lib/config'

// ADR 0020 §2.2 / [sec-MEDIUM-5] — Tier-2. GITHUB_APP_PRIVATE_KEY's .refine()
// must reject a malformed base64 private key AT PARSE TIME, not first use —
// this is what makes a truncated/mis-pasted key a boot-time failure instead
// of a silent failure surfacing an hour later inside the first poller tick.

// Every other required field in serverSchema (no .default()), so
// serverSchema.parse() succeeds independent of the GITHUB_APP_* fields under
// test. Values are synthetic, shaped only to satisfy each field's own
// zod constraints (STRIPE_*'s prefix/length checks, etc.) — never real
// secrets.
function validBaseEnv(overrides: Record<string, unknown> = {}) {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
    STRIPE_SECRET_KEY: `sk_test_${'x'.repeat(20)}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${'x'.repeat(20)}`,
    STRIPE_PRICE_ID_PLUS: `price_${'x'.repeat(10)}`,
    STRIPE_PRICE_ID_PRO: `price_${'x'.repeat(10)}`,
    OAUTH_STATE_SECRET: 'x'.repeat(32),
    INVITE_TOKEN_SECRET: 'x'.repeat(32),
    ...overrides,
  }
}

const VALID_PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest\n-----END RSA PRIVATE KEY-----\n'
const VALID_PEM_NO_RSA = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANtest\n-----END PRIVATE KEY-----\n'

describe('lib/config — GITHUB_APP_* (ADR 0020 §2.2)', () => {
  it('a valid base64-encoded PEM (RSA header) parses successfully', () => {
    const result = serverSchema.safeParse(
      validBaseEnv({ GITHUB_APP_PRIVATE_KEY: Buffer.from(VALID_PEM).toString('base64') }),
    )
    expect(result.success).toBe(true)
  })

  it('a valid base64-encoded PEM (non-RSA header, the (RSA )? branch) parses successfully', () => {
    const result = serverSchema.safeParse(
      validBaseEnv({ GITHUB_APP_PRIVATE_KEY: Buffer.from(VALID_PEM_NO_RSA).toString('base64') }),
    )
    expect(result.success).toBe(true)
  })

  it('empty string (unconfigured) parses successfully — GitHub App is optional until connected', () => {
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_PRIVATE_KEY: '' }))
    expect(result.success).toBe(true)
  })

  it('FAILS parse: a truncated base64 value (mid-PEM cut) does not decode to a full PEM header', () => {
    const fullBase64 = Buffer.from(VALID_PEM).toString('base64')
    const truncated = fullBase64.slice(0, 8) // nowhere near enough to decode a full "-----BEGIN..." header
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_PRIVATE_KEY: truncated }))
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('GITHUB_APP_PRIVATE_KEY'))
      expect(issue?.message).toMatch(/base64-encoded and decode to a PEM private key/)
    }
  })

  it('FAILS parse: a non-base64 value fails the PEM-shape check', () => {
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_PRIVATE_KEY: 'not-base64-!!!@@@###' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('GITHUB_APP_PRIVATE_KEY'))
      expect(issue?.message).toMatch(/base64-encoded and decode to a PEM private key/)
    }
  })

  it('FAILS parse: valid base64 that decodes to a non-PEM string is rejected', () => {
    const notAPem = Buffer.from('hello world, this is definitely not a private key').toString('base64')
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_PRIVATE_KEY: notAPem }))
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('GITHUB_APP_PRIVATE_KEY'))
      expect(issue?.message).toMatch(/base64-encoded and decode to a PEM private key/)
    }
  })

  it('GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET are plain optional scalars', () => {
    const result = serverSchema.safeParse(validBaseEnv({
      GITHUB_APP_ID: '123456',
      GITHUB_APP_SLUG: 'sosh-signals',
      GITHUB_APP_CLIENT_ID: 'Iv1.test',
      GITHUB_APP_CLIENT_SECRET: 'secret-value',
    }))
    expect(result.success).toBe(true)
  })

  describe('serverOnly() guard — every new getter throws in browser code', () => {
    const originalWindow = (globalThis as { window?: unknown }).window

    afterEach(() => {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        ;(globalThis as { window?: unknown }).window = originalWindow
      }
    })

    it('config.server.GITHUB_APP_ID throws when window is defined', () => {
      ;(globalThis as { window?: unknown }).window = {}
      expect(() => config.server.GITHUB_APP_ID).toThrow(/accessed in browser code/)
    })

    it('config.server.GITHUB_APP_SLUG throws when window is defined', () => {
      ;(globalThis as { window?: unknown }).window = {}
      expect(() => config.server.GITHUB_APP_SLUG).toThrow(/accessed in browser code/)
    })

    it('config.server.GITHUB_APP_PRIVATE_KEY throws when window is defined', () => {
      ;(globalThis as { window?: unknown }).window = {}
      expect(() => config.server.GITHUB_APP_PRIVATE_KEY).toThrow(/accessed in browser code/)
    })

    it('config.server.GITHUB_APP_CLIENT_ID throws when window is defined', () => {
      ;(globalThis as { window?: unknown }).window = {}
      expect(() => config.server.GITHUB_APP_CLIENT_ID).toThrow(/accessed in browser code/)
    })

    it('config.server.GITHUB_APP_CLIENT_SECRET throws when window is defined', () => {
      ;(globalThis as { window?: unknown }).window = {}
      expect(() => config.server.GITHUB_APP_CLIENT_SECRET).toThrow(/accessed in browser code/)
    })
  })
})
