import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mock controls ─────────────────────────────────────────────────────
const mockCronTrigger = vi.hoisted(() => ({ value: 'secret' as 'secret' | 'qstash' }))

const MockQStashAuthError = vi.hoisted(() => {
  class QStashAuthError extends Error {
    readonly reason: string
    constructor(reason: string) {
      super('Unauthorized')
      this.name = 'QStashAuthError'
      this.reason = reason
    }
  }
  return QStashAuthError
})

const mockVerifyQStash = vi.hoisted(() => vi.fn<() => Promise<void>>())

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/lib/config', () => ({
  config: {
    server: {
      CRON_SECRET: 'test-secret-that-is-at-least-32-chars!!',
      get CRON_TRIGGER() { return mockCronTrigger.value },
    },
    public: {
      get NODE_ENV() { return process.env.NODE_ENV ?? 'development' },
    },
  },
}))

vi.mock('@/lib/cron/qstash-auth', () => ({
  verifyQStashRequest: mockVerifyQStash,
  QStashAuthError: MockQStashAuthError,
}))

vi.mock('@/lib/email/triggers/trial-warnings', () => ({
  runTrialWarningsTick: vi.fn().mockResolvedValue({
    enqueuedT3: 0, enqueuedT1: 0, dedupedT3: 0, dedupedT1: 0, durationMs: 1,
  }),
}))

import { GET, POST } from '../route'
import { runTrialWarningsTick } from '@/lib/email/triggers/trial-warnings'

const SECRET = 'test-secret-that-is-at-least-32-chars!!'

function makeRequest(opts: {
  method?: string
  authorization?: string
  devTrigger?: boolean
  upstashSignature?: string
}): NextRequest {
  const headers = new Headers()
  if (opts.authorization !== undefined) headers.set('authorization', opts.authorization)
  if (opts.devTrigger) headers.set('x-cron-dev-trigger', 'true')
  if (opts.upstashSignature !== undefined) headers.set('upstash-signature', opts.upstashSignature)
  return new NextRequest('http://localhost/api/cron/trial-warnings', {
    method: opts.method ?? 'GET',
    headers,
  })
}

function getWarnLog(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | null {
  for (const call of spy.mock.calls) {
    try {
      const parsed = JSON.parse(String(call[0]))
      if (parsed?.kind === 'cron-auth-failure') return parsed as Record<string, unknown>
    } catch { /* skip */ }
  }
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockCronTrigger.value = 'secret'
  mockVerifyQStash.mockReset()
  mockVerifyQStash.mockResolvedValue(undefined)
  vi.mocked(runTrialWarningsTick).mockResolvedValue({
    enqueuedT3: 0, enqueuedT1: 0, dedupedT3: 0, dedupedT1: 0, durationMs: 1,
  })
})

// ── Bearer mode (CRON_TRIGGER=secret) ────────────────────────────────────────

describe('GET /api/cron/trial-warnings — Bearer mode', () => {
  it('returns 401 when Authorization header is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
  })

  it('returns 401 when secret is wrong value', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: `Bearer ${'x'.repeat(SECRET.length)}` }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when secret is wrong length', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: 'Bearer short' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 + OK when Authorization is correct', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
  })

  it('calls runTrialWarningsTick with triggeredBy=secret', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(vi.mocked(runTrialWarningsTick)).toHaveBeenCalledWith({ triggeredBy: 'secret' })
  })

  it('dev bypass header → 200 in dev', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
  })

  it('dev bypass header → 401 in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(401)
  })

  it('returns 200 in production with correct secret', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
  })
})

// ── Method guards ─────────────────────────────────────────────────────────────

describe('method guard (CRON_TRIGGER=secret)', () => {
  it('POST → 405 Method Not Allowed', async () => {
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(405)
    expect(await res.text()).toBe('Method Not Allowed')
  })
})

describe('method guard (CRON_TRIGGER=qstash)', () => {
  it('GET → 405 Method Not Allowed', async () => {
    mockCronTrigger.value = 'qstash'
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(405)
    expect(await res.text()).toBe('Method Not Allowed')
  })
})

// ── QStash mode (CRON_TRIGGER=qstash) ────────────────────────────────────────

describe('POST /api/cron/trial-warnings — QStash mode', () => {
  beforeEach(() => {
    mockCronTrigger.value = 'qstash'
  })

  it('valid signature → 200, runTrialWarningsTick called with triggeredBy=qstash', async () => {
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'valid-sig' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runTrialWarningsTick)).toHaveBeenCalledWith({ triggeredBy: 'qstash' })
  })

  it('missing signature → 401 + cron-auth-failure logged with route=trial-warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    const log = getWarnLog(warnSpy)
    expect(log?.route).toBe('trial-warnings')
    expect(log?.trigger).toBe('qstash')
    expect(log?.reason).toBe('qstash-missing-signature')
  })

  it('invalid signature → 401 + reason logged', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-invalid-signature'))
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'bad' }))
    expect(res.status).toBe(401)
    const log = getWarnLog(warnSpy)
    expect(log?.reason).toBe('qstash-invalid-signature')
  })

  it('[reviewer-pinned] dev bypass ignored in QStash branch → 401', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    vi.stubEnv('NODE_ENV', 'development')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST', devTrigger: true }))
    expect(res.status).toBe(401)
    const log = getWarnLog(warnSpy)
    expect(log?.reason).toBe('qstash-missing-signature')
  })
})
