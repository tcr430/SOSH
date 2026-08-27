import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mock controls ─────────────────────────────────────────────────────
// [Session 27-D · D2, MAJOR-2] Modelled directly on
// app/api/cron/capture-learning/route.test.ts's vi.hoisted mock-control shape
// — this route reuses that route's exact auth structure (ADR 0020 §4.1), so
// the test harness mirrors it rather than inventing a new one.
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

vi.mock('@/lib/signals/orchestrator', () => ({
  runSignalsTick: vi.fn(),
}))

import { GET, POST } from './route'
import { runSignalsTick } from '@/lib/signals/orchestrator'

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
  return new NextRequest('http://localhost/api/cron/signals-poll', {
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

const tickSummary = {
  tick: '2026-08-07T13:00:00Z',
  triggeredBy: 'secret' as const,
  durationMs: 5,
  connectionsClaimed: 2,
  reposPolled: 3,
  notModified: 1,
  signalsIngested: 4,
  signalsUpdated: 0,
  duplicates: 0,
  candidatesUpserted: 4,
  revoked: 0,
  rateLimited: 0,
  notFound: 0,
  malformed: 0,
  failed: 0,
  skippedDraft: 0,
  skippedPreCutoff: 0,
  rssFeedsConsidered: 0,
  rssFeedsFetched: 0,
  rssFeedsNotModified: 0,
  rssFeedsFailed: 0,
  rssItemsIngested: 0,
  rssDuplicates: 0,
  rssGuardRejected: 0,
  rssCandidatesUpserted: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockCronTrigger.value = 'secret'
  mockVerifyQStash.mockReset()
  mockVerifyQStash.mockResolvedValue(undefined)
  vi.mocked(runSignalsTick).mockResolvedValue(tickSummary)
})

// ── Bearer mode tests (CRON_TRIGGER='secret') ─────────────────────────────────

describe('GET /api/cron/signals-poll — secret mode (dev)', () => {
  it('returns 401 when Authorization header is missing, and runSignalsTick is NOT called', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
  })

  it('returns 401 when the bearer is the wrong value, and runSignalsTick is NOT called', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const wrongSecret = SECRET.replace(/./g, 'x')
    const res = await GET(makeRequest({ authorization: `Bearer ${wrongSecret}` }))
    expect(res.status).toBe(401)
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
  })

  it('returns 401 when the bearer is the wrong length', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: 'Bearer short' }))
    expect(res.status).toBe(401)
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
  })

  it('returns 200 when the bearer is correct, tick called exactly once', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runSignalsTick)).toHaveBeenCalledTimes(1)
  })

  it('returns 200 when X-Cron-Dev-Trigger is true (no secret needed in dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runSignalsTick)).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/cron/signals-poll — secret mode (prod) — dev bypass NOT available', () => {
  it('returns 401 when Authorization header is missing in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(401)
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
  })

  it('returns 401 when X-Cron-Dev-Trigger is true in prod — the dev bypass is NOT consulted', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(401)
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
  })

  it('returns 200 when Authorization is correct in prod', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runSignalsTick)).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/cron/signals-poll — response shape', () => {
  it('response includes the tick summary under `signals`', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    const body = await res.json()
    expect(body.signals).toMatchObject({
      connectionsClaimed: 2,
      reposPolled: 3,
      signalsIngested: 4,
      candidatesUpserted: 4,
    })
  })

  it('returns 200 even when runSignalsTick throws (no 500)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(runSignalsTick).mockRejectedValue(new Error('tick boom'))
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signals).toHaveProperty('error', 'tick boom')
  })

  it('GET (CRON_TRIGGER=secret) → 200 + runSignalsTick called with triggeredBy: secret', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runSignalsTick)).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: 'secret' }),
    )
  })
})

// ── Method-rejection tests ────────────────────────────────────────────────────

describe('GET /api/cron/signals-poll — 405 when CRON_TRIGGER=qstash', () => {
  it('GET → 405 Method Not Allowed, runSignalsTick NOT called', async () => {
    mockCronTrigger.value = 'qstash'
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(405)
    expect(await res.text()).toBe('Method Not Allowed')
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
  })
})

describe('POST /api/cron/signals-poll — 405 when CRON_TRIGGER=secret', () => {
  it('POST → 405 Method Not Allowed, runSignalsTick NOT called', async () => {
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(405)
    expect(await res.text()).toBe('Method Not Allowed')
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
  })
})

// ── QStash mode tests (CRON_TRIGGER=qstash) ───────────────────────────────────

describe('POST /api/cron/signals-poll — QStash mode', () => {
  beforeEach(() => {
    mockCronTrigger.value = 'qstash'
  })

  it('POST + valid signature → 200 + runSignalsTick called with triggeredBy: qstash', async () => {
    mockVerifyQStash.mockResolvedValue(undefined)
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'valid-sig' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(runSignalsTick)).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: 'qstash' }),
    )
  })

  it('POST + invalid signature → 401, runSignalsTick NOT called, cron-auth-failure warn carries no body/header/token', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-invalid-signature'))
    const res = await POST(makeRequest({ method: 'POST', upstashSignature: 'super-secret-signature-value' }))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.route).toBe('signals-poll')
    expect(warnLog?.trigger).toBe('qstash')
    expect(warnLog?.reason).toBe('qstash-invalid-signature')
    // The warn line must carry only the four fixed fields — no request body,
    // no header value, no token/signature anywhere in the payload.
    expect(Object.keys(warnLog ?? {}).sort()).toEqual(['kind', 'reason', 'route', 'trigger'])
    const serialized = JSON.stringify(warnLog)
    expect(serialized).not.toContain('super-secret-signature-value')
  })

  it('POST + missing Upstash-Signature → 401 + reason=qstash-missing-signature, tick NOT called', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(401)
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.reason).toBe('qstash-missing-signature')
  })

  it('CRON_TRIGGER=qstash, dev env, X-Cron-Dev-Trigger=true, POST, no signature → 401 (dev-bypass NOT consulted in qstash branch)', async () => {
    const warnSpy = vi.spyOn(console, 'warn')
    vi.stubEnv('NODE_ENV', 'development')
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('qstash-missing-signature'))
    const res = await POST(makeRequest({ method: 'POST', devTrigger: true }))
    expect(res.status).toBe(401)
    expect(vi.mocked(runSignalsTick)).not.toHaveBeenCalled()
    const warnLog = getWarnLog(warnSpy)
    expect(warnLog?.reason).toBe('qstash-missing-signature')
  })
})
