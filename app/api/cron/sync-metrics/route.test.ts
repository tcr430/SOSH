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

vi.mock('@/lib/metrics/orchestrator', () => ({
  runMetricsSyncTick: vi.fn(),
}))

import { GET, POST } from './route'
import { runMetricsSyncTick } from '@/lib/metrics/orchestrator'

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
  return new NextRequest('http://localhost/api/cron/sync-metrics', {
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

const metricsSummary = {
  tick: '2026-05-30T10:00:00Z',
  durationMs: 5,
  candidates: 10,
  synced: 8,
  skippedNotImplemented: 0,
  skippedNoData: 1,
  skippedNoAccount: 1,
  errors: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockCronTrigger.value = 'secret'
  mockVerifyQStash.mockReset()
  mockVerifyQStash.mockResolvedValue(undefined)
  vi.mocked(runMetricsSyncTick).mockResolvedValue(metricsSummary)
})

// ── Bearer mode tests (CRON_TRIGGER='secret') ─────────────────────────────────

describe('GET /api/cron/sync-metrics — auth (dev)', () => {
  it('returns 401 when Authorization header is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
  })

  it('returns 401 when secret is correct length but wrong value', async () => {
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

  it('returns 200 when Authorization is correct', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
  })

  it('returns 200 when X-Cron-Dev-Trigger is true (no secret needed in dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/cron/sync-metrics — auth (prod)', () => {
  it('returns 401 when Authorization header is missing in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-Cron-Dev-Trigger is true in prod (header ignored)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(401)
  })

  it('returns 200 when Authorization is correct in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/cron/sync-metrics — response shape', () => {
  it('response includes metrics summary', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    const body = await res.json()
    expect(body.metrics).toMatchObject({
      candidates: 10,
      synced: 8,
      skippedNoData: 1,
      skippedNoAccount: 1,
      errors: 0,
    })
  })

  it('returns 200 even when runMetricsSyncTick throws (no 500)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(runMetricsSyncTick).mockRejectedValue(new Error('metrics boom'))
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metrics).toHaveProperty('error', 'metrics boom')
  })

  it('GET (CRON_TRIGGER=secret) → 200 + runMetricsSyncTick called with triggeredBy: secret', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runMetricsSyncTick)).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: 'secret' }),
    )
  })
})

// ── Method-rejection tests ────────────────────────────────────────────────────

describe('GET /api/cron/sync-metrics — 405 when CRON_TRIGGER=qstash', () => {
  it('GET → 405 Method Not Allowed', async () => {
    mockCronTrigger.value = 'qstash'
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(405)
    expect(await res.text()).toBe('Method Not Allowed')
  })
})

describe('POST /api/cron/sync-metrics — 405 when CRON_TRIGGER=secret', () => {
  it('POST → 405 Method Not Allowed', async () => {
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(405)
    expect(await res.text()).toBe('Method Not Allowed')
  })
})

// ── QStash mode tests (CRON_TRIGGER=qstash) ───────────────────────────────────

describe('POST /api/cron/sync-metrics — QStash mode', () => {
  beforeEach(() => {
    mockCronTrigger.value = 'qstash'
  })

  it('POST + valid signature → 200 + runMetricsSyncTick called with triggeredBy: qstash', async () => {
    mockVerifyQStash.mockResolvedValue(undefined)
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'valid-sig' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runMetricsSyncTick)).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: 'qstash' }),
    )
  })

  it('POST + invalid signature → 401 + cron-auth-failure warn with reason=qstash-invalid-signature', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-invalid-signature'))
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'bad-sig' }))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.route).toBe('sync-metrics')
    expect(warnLog?.trigger).toBe('qstash')
    expect(warnLog?.reason).toBe('qstash-invalid-signature')
  })

  it('POST + missing Upstash-Signature → 401 + reason=qstash-missing-signature', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(401)
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.reason).toBe('qstash-missing-signature')
  })

  it('[reviewer-pinned] CRON_TRIGGER=qstash, dev env, X-Cron-Dev-Trigger=true, POST, no signature → 401 (dev-bypass NOT consulted in qstash branch)', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    vi.stubEnv('NODE_ENV', 'development')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST', devTrigger: true }))
    expect(res.status).toBe(401)
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.reason).toBe('qstash-missing-signature')
  })
})
