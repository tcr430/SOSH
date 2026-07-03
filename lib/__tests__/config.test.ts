import { describe, it, expect, afterEach, vi } from 'vitest'

// publicSchema.parse() runs at module load time — stub the required public vars
// before the import executes so the module initialises without throwing.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_1234567890123456'
})

import { serverSchema } from '@/lib/config'

// Fields that are always required (no .default()) — provide minimal valid values.
const REQUIRED_FIELDS = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-test',
  STRIPE_SECRET_KEY: 'sk_test_validkeyvalue123',
  STRIPE_WEBHOOK_SECRET: 'whsec_validwebhooksecret',
  STRIPE_PRICE_ID_PLUS: 'price_plus_test',
  STRIPE_PRICE_ID_PRO: 'price_pro_test',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
  INVITE_TOKEN_SECRET: 'b'.repeat(32),
}

// CRON_SECRET needs ≥ 32 chars in production (existing refine) — include in prod tests.
const PROD_CRON_SECRET = { CRON_SECRET: 'a'.repeat(32) }

afterEach(() => { vi.unstubAllEnvs() })

describe('serverSchema — CRON_TRIGGER + QStash signing key validation', () => {
  it('CRON_TRIGGER unset → defaults to secret, valid', () => {
    const result = serverSchema.safeParse({ ...REQUIRED_FIELDS })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CRON_TRIGGER).toBe('secret')
    }
  })

  it('CRON_TRIGGER=secret in production without QSTASH keys → valid (Bearer mode)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = serverSchema.safeParse({
      ...REQUIRED_FIELDS,
      ...PROD_CRON_SECRET,
      CRON_TRIGGER: 'secret',
    })
    expect(result.success).toBe(true)
  })

  it('CRON_TRIGGER=qstash in production with both QSTASH keys → valid', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = serverSchema.safeParse({
      ...REQUIRED_FIELDS,
      ...PROD_CRON_SECRET,
      CRON_TRIGGER: 'qstash',
      QSTASH_CURRENT_SIGNING_KEY: 'cur_signing_key',
      QSTASH_NEXT_SIGNING_KEY: 'nxt_signing_key',
    })
    expect(result.success).toBe(true)
  })

  it('CRON_TRIGGER=qstash in production with only CURRENT key → ZodError naming both vars', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = serverSchema.safeParse({
      ...REQUIRED_FIELDS,
      ...PROD_CRON_SECRET,
      CRON_TRIGGER: 'qstash',
      QSTASH_CURRENT_SIGNING_KEY: 'cur_signing_key',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ')
      expect(messages).toContain('QSTASH_CURRENT_SIGNING_KEY')
      expect(messages).toContain('QSTASH_NEXT_SIGNING_KEY')
    }
  })

  it('CRON_TRIGGER=qstash in production with only NEXT key → ZodError naming both vars', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = serverSchema.safeParse({
      ...REQUIRED_FIELDS,
      ...PROD_CRON_SECRET,
      CRON_TRIGGER: 'qstash',
      QSTASH_NEXT_SIGNING_KEY: 'nxt_signing_key',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ')
      expect(messages).toContain('QSTASH_CURRENT_SIGNING_KEY')
      expect(messages).toContain('QSTASH_NEXT_SIGNING_KEY')
    }
  })

  it('CRON_TRIGGER=qstash in production with neither QSTASH key → ZodError naming both vars', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const result = serverSchema.safeParse({
      ...REQUIRED_FIELDS,
      ...PROD_CRON_SECRET,
      CRON_TRIGGER: 'qstash',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ')
      expect(messages).toContain('QSTASH_CURRENT_SIGNING_KEY')
      expect(messages).toContain('QSTASH_NEXT_SIGNING_KEY')
    }
  })

  it('CRON_TRIGGER=qstash in development without QSTASH keys → valid (soft local-dev affordance)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const result = serverSchema.safeParse({
      ...REQUIRED_FIELDS,
      CRON_TRIGGER: 'qstash',
    })
    expect(result.success).toBe(true)
  })
})
