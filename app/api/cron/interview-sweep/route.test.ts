import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ADR 0029 §5.4 (Session 35 M2.9) INTERVIEW-SWEEP-CRON-AUTHED — dual auth, copied from the extract-outcomes
// precedent, and the canonical tick line's key set.

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

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      CRON_SECRET: 'test-secret-that-is-at-least-32-chars!!',
      get CRON_TRIGGER() { return mockCronTrigger.value },
    },
    public: { get NODE_ENV() { return process.env.NODE_ENV ?? 'development' } },
  },
}))
vi.mock('@/lib/cron/qstash-auth', () => ({ verifyQStashRequest: mockVerifyQStash, QStashAuthError: MockQStashAuthError }))
const captureException = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => ({ captureException }))
vi.mock('@/lib/db/founder-interview-rounds', () => ({ sweepInterviewData: vi.fn() }))

import { GET, POST } from './route'
import { sweepInterviewData } from '@/lib/db/founder-interview-rounds'

const SECRET = 'test-secret-that-is-at-least-32-chars!!'

const SWEEP_KEYS = [
  'kind', 'triggeredBy', 'tick', 'durationMs', 'failedStuck', 'expired', 'candidatesRetired', 'answersRedacted',
  'spansRedacted', 'candidatesDeleted', 'errors',
].sort()

const summary = { failedStuck: 1, expired: 2, candidatesRetired: 3, answersRedacted: 4, spansRedacted: 5, candidatesDeleted: 6 }

function makeRequest(opts: { method?: string; authorization?: string; devTrigger?: boolean }): NextRequest {
  const headers = new Headers()
  if (opts.authorization !== undefined) headers.set('authorization', opts.authorization)
  if (opts.devTrigger) headers.set('x-cron-dev-trigger', 'true')
  return new NextRequest('http://localhost/api/cron/interview-sweep', { method: opts.method ?? 'GET', headers })
}

function tickLines(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const call of spy.mock.calls) {
    try {
      const parsed = JSON.parse(String(call[0]))
      if (parsed?.kind === 'interview.sweep.tick') out.push(parsed)
    } catch { /* skip */ }
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mockCronTrigger.value = 'secret'
  mockVerifyQStash.mockReset()
  mockVerifyQStash.mockResolvedValue(undefined)
  vi.mocked(sweepInterviewData).mockResolvedValue(summary)
})

describe('bearer mode (CRON_TRIGGER=secret)', () => {
  it('401 without a header, with a wrong secret, and with a wrong length; nothing runs', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await GET(makeRequest({}))).status).toBe(401)
    expect((await GET(makeRequest({ authorization: `Bearer ${SECRET.replace(/./g, 'x')}` }))).status).toBe(401)
    expect((await GET(makeRequest({ authorization: 'Bearer short' }))).status).toBe(401)
    expect(sweepInterviewData).not.toHaveBeenCalled()
  })

  it('200 with the right bearer, calling the sweep', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(sweepInterviewData).toHaveBeenCalledWith()
  })

  it('the dev trigger header works outside production and is IGNORED in production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await GET(makeRequest({ devTrigger: true }))).status).toBe(200)
    vi.stubEnv('NODE_ENV', 'production')
    expect((await GET(makeRequest({ devTrigger: true }))).status).toBe(401)
  })

  it('POST is 405 in bearer mode', async () => {
    expect((await POST(makeRequest({ method: 'POST' }))).status).toBe(405)
  })
})

describe('QStash mode (CRON_TRIGGER=qstash)', () => {
  beforeEach(() => { mockCronTrigger.value = 'qstash' })

  it('401 when the signature fails, and nothing runs', async () => {
    mockVerifyQStash.mockRejectedValue(new MockQStashAuthError('bad-signature'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(401)
    expect(sweepInterviewData).not.toHaveBeenCalled()
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ kind: 'cron-auth-failure', route: 'interview-sweep', reason: 'bad-signature' })
  })

  it('200 on a verified POST, with triggeredBy qstash; GET is 405', async () => {
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(200)
    expect(sweepInterviewData).toHaveBeenCalledWith()
    expect((await GET(makeRequest({}))).status).toBe(405)
  })
})

describe('the canonical tick line', () => {
  it('is ONE line whose key set equals the sweep result shape exactly, with the values', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    const lines = tickLines(log)
    expect(lines).toHaveLength(1)
    expect(Object.keys(lines[0]).sort()).toEqual(SWEEP_KEYS)
    expect(lines[0]).toMatchObject({ kind: 'interview.sweep.tick', triggeredBy: 'secret', errors: 0, ...summary })
  })

  it('a throwing sweep is captured, still answers 200, and its line reports UNKNOWN counters (null), never fabricated zeros', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const boom = new Error('boom')
    vi.mocked(sweepInterviewData).mockRejectedValue(boom)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { cron: 'interview-sweep', phase: 'route' } })

    const lines = tickLines(log)
    expect(lines).toHaveLength(1)
    const line = lines[0]
    expect(line).toMatchObject({ kind: 'interview.sweep.tick', errors: 1 })
    const counters = SWEEP_KEYS.filter((k) => !['kind', 'triggeredBy', 'tick', 'durationMs', 'errors'].includes(k))
    expect(counters).toHaveLength(6)
    for (const k of counters) expect(line[k], `${k} must be null (unknown), not a fabricated number`).toBeNull()
  })
})
