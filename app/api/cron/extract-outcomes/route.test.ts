import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ADR 0026 §14 — the extract-outcomes route: both auth modes, and the canonical tick line's key set.

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
vi.mock('@/lib/outcomes/orchestrator', () => ({ runOutcomeTick: vi.fn() }))

import { GET, POST } from './route'
import { runOutcomeTick } from '@/lib/outcomes/orchestrator'

const SECRET = 'test-secret-that-is-at-least-32-chars!!'

// EXACTLY ADR 0026 §14's keys — no more, no fewer.
const ADR_14_KEYS = [
  'kind', 'triggeredBy', 'tick', 'durationMs', 'candidates', 'matured', 'outcomesWritten', 'skippedNoMetrics',
  'skippedNoBaseline', 'skippedIneligibleField', 'cellsRecomputed', 'candidatesUpserted', 'promoted', 'demoted',
  'retrospectivesCompleted', 'errors',
].sort()

const summary = {
  triggeredBy: 'secret' as const, tick: '2026-09-19T04:00:00Z', durationMs: 9, candidates: 4, matured: 3,
  outcomesWritten: 2, skippedNoMetrics: 1, skippedNoBaseline: 1, skippedIneligibleField: 1, cellsRecomputed: 10,
  candidatesUpserted: 2, promoted: 1, demoted: 1, retrospectivesCompleted: 0, errors: 0,
}

function makeRequest(opts: { method?: string; authorization?: string; devTrigger?: boolean }): NextRequest {
  const headers = new Headers()
  if (opts.authorization !== undefined) headers.set('authorization', opts.authorization)
  if (opts.devTrigger) headers.set('x-cron-dev-trigger', 'true')
  return new NextRequest('http://localhost/api/cron/extract-outcomes', { method: opts.method ?? 'GET', headers })
}

function tickLines(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const call of spy.mock.calls) {
    try {
      const parsed = JSON.parse(String(call[0]))
      if (parsed?.kind === 'outcome.tick') out.push(parsed)
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
  vi.mocked(runOutcomeTick).mockResolvedValue(summary)
})

describe('bearer mode (CRON_TRIGGER=secret)', () => {
  it('401 without a header, with a wrong secret, and with a wrong length; nothing runs', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await GET(makeRequest({}))).status).toBe(401)
    expect((await GET(makeRequest({ authorization: `Bearer ${SECRET.replace(/./g, 'x')}` }))).status).toBe(401)
    expect((await GET(makeRequest({ authorization: 'Bearer short' }))).status).toBe(401)
    expect(runOutcomeTick).not.toHaveBeenCalled()
  })

  it('200 with the right bearer, calling the tick with triggeredBy secret', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(runOutcomeTick).toHaveBeenCalledWith({ triggeredBy: 'secret' })
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
    expect(runOutcomeTick).not.toHaveBeenCalled()
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ kind: 'cron-auth-failure', route: 'extract-outcomes', reason: 'bad-signature' })
  })

  it('200 on a verified POST, with triggeredBy qstash; GET is 405', async () => {
    const res = await POST(makeRequest({ method: 'POST' }))
    expect(res.status).toBe(200)
    expect(runOutcomeTick).toHaveBeenCalledWith({ triggeredBy: 'qstash' })
    expect((await GET(makeRequest({}))).status).toBe(405)
  })
})

describe('the canonical tick line', () => {
  it('is ONE line whose key set EQUALS ADR 0026 §14 exactly, with the tick values', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    const lines = tickLines(log)
    expect(lines).toHaveLength(1)
    expect(Object.keys(lines[0]).sort()).toEqual(ADR_14_KEYS)
    expect(lines[0]).toMatchObject({ kind: 'outcome.tick', candidates: 4, outcomesWritten: 2, errors: 0 })
  })

  it('cannot leak extra fields: a summary carrying a business id or text still yields only the ADR keys', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(runOutcomeTick).mockResolvedValue({ ...summary, businessId: 'b-secret', hypothesis: 'secret text' } as never)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    const raw = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(raw).not.toMatch(/b-secret|secret text/)
    expect(Object.keys(tickLines(log)[0]).sort()).toEqual(ADR_14_KEYS)
  })

  it('a throwing tick still answers 200 and logs a zeroed line with errors 1', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(runOutcomeTick).mockRejectedValue(new Error('tick boom'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(Object.keys(tickLines(log)[0]).sort()).toEqual(ADR_14_KEYS)
    expect(tickLines(log)[0]).toMatchObject({ errors: 1, outcomesWritten: 0 })
  })
})
