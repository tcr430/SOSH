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

vi.mock('@/lib/email/orchestrator', () => ({
  runEmailDrainTick: vi.fn().mockResolvedValue({
    claimed: 0, sent: 0, retried: 0, failed: 0, suppressed: 0, durationMs: 1,
  }),
}))

import { GET, POST } from '../route'
import { runEmailDrainTick } from '@/lib/email/orchestrator'

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
  return new NextRequest('http://localhost/api/cron/drain-email-outbox', {
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
  vi.mocked(runEmailDrainTick).mockResolvedValue({
    claimed: 0, sent: 0, retried: 0, failed: 0, suppressed: 0, durationMs: 1,
  })
})

// ── Bearer mode tests (CRON_TRIGGER='secret') ─────────────────────────────────

describe('GET /api/cron/drain-email-outbox — Bearer mode', () => {
  it('returns 401 when Authorization header is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
  })

  it('returns 401 when secret is wrong value', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const wrongSecret = SECRET.replace(/./g, 'x')
    const res = await GET(makeRequest({ authorization: `Bearer ${wrongSecret}` }))
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

  it('calls runEmailDrainTick with triggeredBy=secret', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(vi.mocked(runEmailDrainTick)).toHaveBeenCalledWith({ triggeredBy: 'secret' })
  })

  it('dev bypass header → 200 (no secret needed in dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
  })

  it('dev bypass header → 401 in production (header ignored)', async () => {
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

// ── Method-rejection tests ─────────────────────────────────────────────────────

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

// ── QStash mode tests (CRON_TRIGGER=qstash) ───────────────────────────────────

describe('POST /api/cron/drain-email-outbox — QStash mode', () => {
  beforeEach(() => {
    mockCronTrigger.value = 'qstash'
  })

  it('POST + valid signature → 200, runEmailDrainTick called with triggeredBy=qstash', async () => {
    mockVerifyQStash.mockResolvedValue(undefined)
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'valid-sig' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runEmailDrainTick)).toHaveBeenCalledWith({ triggeredBy: 'qstash' })
  })

  it('POST + missing signature → 401 + cron-auth-failure warn logged', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.route).toBe('drain-email-outbox')
    expect(warnLog?.trigger).toBe('qstash')
    expect(warnLog?.reason).toBe('qstash-missing-signature')
  })

  it('POST + invalid signature → 401 + reason logged', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-invalid-signature'))
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'bad-sig' }))
    expect(res.status).toBe(401)
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.reason).toBe('qstash-invalid-signature')
  })

  it('[reviewer-pinned] dev bypass header ignored in QStash branch → 401 without signature', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    vi.stubEnv('NODE_ENV', 'development')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST', devTrigger: true }))
    expect(res.status).toBe(401)
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.reason).toBe('qstash-missing-signature')
  })
})
