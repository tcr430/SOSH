import { describe, it, expect, afterEach, vi } from 'vitest'
import { serverSchema, config } from '@/lib/config'

// ADR 0020 §2.2 / [sec-MEDIUM-5] — Tier-2. GITHUB_APP_PRIVATE_KEY's .refine()
// must reject a malformed base64 private key AT PARSE TIME, not first use —
// this is what makes a truncated/mis-pasted key a boot-time failure instead
// of a silent failure surfacing an hour later inside the first poller tick.

// Every other required field in serverSchema (no .default()), so
// serverSchema.parse() succeeds independent of the GITHUB_APP_* fields under
// test. Values are synthetic, shaped only to satisfy each field's own
// zod constraints (STRIPE_*'s prefix/length checks, etc.) — never real
// secrets. [E2.3] GITHUB_APP_ID/CLIENT_ID/CLIENT_SECRET/PRIVATE_KEY are now
// REQUIRED (§8.3's ownership proof) — included in the base so every test not
// specifically about one of them still gets a passing default.
const VALID_PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest\n-----END RSA PRIVATE KEY-----\n'
const VALID_PEM_NO_RSA = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANtest\n-----END PRIVATE KEY-----\n'

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
    GITHUB_APP_ID: '123456',
    GITHUB_APP_CLIENT_ID: 'Iv1.test',
    GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
    GITHUB_APP_PRIVATE_KEY: Buffer.from(VALID_PEM).toString('base64'),
    ...overrides,
  }
}

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

  it('[E2.3] FAILS parse: empty string is rejected — GITHUB_APP_PRIVATE_KEY is now REQUIRED (§8.3 ownership proof), not optional', () => {
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_PRIVATE_KEY: '' }))
    expect(result.success).toBe(false)
  })

  it('[E2.3] FAILS parse: empty GITHUB_APP_ID is rejected — required', () => {
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_ID: '' }))
    expect(result.success).toBe(false)
  })

  it('[E2.3] FAILS parse: empty GITHUB_APP_CLIENT_ID is rejected — required (§8.3 step 8, the A-1 OAuth leg)', () => {
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_CLIENT_ID: '' }))
    expect(result.success).toBe(false)
  })

  it('[E2.3] FAILS parse: empty GITHUB_APP_CLIENT_SECRET is rejected — required (§8.3 step 8, the A-1 OAuth leg)', () => {
    const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_CLIENT_SECRET: '' }))
    expect(result.success).toBe(false)
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

  it('GITHUB_APP_SLUG is the one remaining plain OPTIONAL scalar (cosmetic install-URL use, not a security boundary)', () => {
    const withoutSlug = serverSchema.safeParse(validBaseEnv())
    expect(withoutSlug.success).toBe(true)

    const withSlug = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_SLUG: 'sosh-signals' }))
    expect(withSlug.success).toBe(true)
  })

  // [Session 27-D / A-4, MAJOR-3] The four load-bearing GITHUB_APP_* fields
  // are now .optional() with a superRefine requiring them together in
  // production and rejecting any partial set in every environment. These
  // cases were shown to REDDEN against the pre-D1 schema (bare
  // z.string().min(1), no superRefine): all four absent failed parse
  // unconditionally, so "non-production succeeds with all four absent" and
  // "partial config fails in development" were both impossible to assert
  // (development already failed for a different reason).
  describe('A-4 — the four are optional, required together in production, never partial', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    function setNodeEnv(value: string) {
      vi.stubEnv('NODE_ENV', value)
    }

    function envWithoutGithubApp(overrides: Record<string, unknown> = {}) {
      const base = validBaseEnv()
      return {
        ...base,
        GITHUB_APP_ID: undefined,
        GITHUB_APP_CLIENT_ID: undefined,
        GITHUB_APP_CLIENT_SECRET: undefined,
        GITHUB_APP_PRIVATE_KEY: undefined,
        ...overrides,
      }
    }

    it('non-production parse SUCCEEDS with all four GITHUB_APP_* fields absent', () => {
      setNodeEnv('test')
      const result = serverSchema.safeParse(envWithoutGithubApp())
      expect(result.success).toBe(true)
    })

    it('production parse FAILS with all four absent, and the message names all four', () => {
      setNodeEnv('production')
      const result = serverSchema.safeParse(envWithoutGithubApp())
      expect(result.success).toBe(false)
      if (!result.success) {
        const message = result.error.issues.map((i) => i.message).join(' | ')
        expect(message).toContain('GITHUB_APP_ID')
        expect(message).toContain('GITHUB_APP_CLIENT_ID')
        expect(message).toContain('GITHUB_APP_CLIENT_SECRET')
        expect(message).toContain('GITHUB_APP_PRIVATE_KEY')
      }
    })

    it('partial configuration (exactly one of four present) FAILS in development', () => {
      setNodeEnv('development')
      const result = serverSchema.safeParse(
        envWithoutGithubApp({ GITHUB_APP_ID: '123456' }),
      )
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => /must be set together/.test(i.message))).toBe(true)
      }
    })

    it('partial configuration (exactly one of four present) FAILS in production', () => {
      setNodeEnv('production')
      const result = serverSchema.safeParse(
        envWithoutGithubApp({ GITHUB_APP_ID: '123456' }),
      )
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => /must be set together/.test(i.message))).toBe(true)
      }
    })

    it('all four present and valid SUCCEEDS in production (the fully-configured case)', () => {
      setNodeEnv('production')
      const result = serverSchema.safeParse(validBaseEnv())
      expect(result.success).toBe(true)
    })

    it('a present-but-malformed GITHUB_APP_PRIVATE_KEY still FAILS in development — [sec-MEDIUM-5] preserved', () => {
      setNodeEnv('development')
      const result = serverSchema.safeParse(validBaseEnv({ GITHUB_APP_PRIVATE_KEY: 'not-base64-!!!@@@###' }))
      expect(result.success).toBe(false)
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('GITHUB_APP_PRIVATE_KEY'))
        expect(issue?.message).toMatch(/base64-encoded and decode to a PEM private key/)
      }
    })
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
