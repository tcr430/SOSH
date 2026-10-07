import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ADR 0031 §5.2: the generate-reports route: both auth modes, and the ONE canonical line's key set (counts only).

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
const captureCheckIn = vi.hoisted(() => vi.fn())
vi.mock('@sentry/nextjs', () => ({ captureException, captureCheckIn }))
vi.mock('@/lib/reports/job', () => ({ runReportJob: vi.fn() }))

import { GET, POST } from './route'
import { runReportJob } from '@/lib/reports/job'

const SECRET = 'test-secret-that-is-at-least-32-chars!!'

const LINE_KEYS = [
  'kind', 'triggeredBy', 'tick', 'durationMs', 'scanned', 'notDue', 'ineligible', 'exists', 'inserted', 'stubs', 'raced', 'capped', 'reason', 'redelivered',
  'emailsEnqueued', 'emailsDeduped', 'emailsSuppressed', 'emailErrors', 'errors',
].sort()

const summary = {
  scanned: 5, notDue: 2, ineligible: 1, exists: 0, inserted: 2, stubs: 0, raced: 0, errors: 0, capped: false, reason: null, redelivered: 0,
  tick: '2026-10-10T07:20:00Z',
  emails: { recipients: 4, enqueued: 3, deduped: 1, suppressed: 0, errors: 0 },
}

function makeRequest(opts: { method?: string; authorization?: string; devTrigger?: boolean }): NextRequest {
  const headers = new Headers()
  if (opts.authorization !== undefined) headers.set('authorization', opts.authorization)
  if (opts.devTrigger) headers.set('x-cron-dev-trigger', 'true')
  return new NextRequest('http://localhost/api/cron/generate-reports', { method: opts.method ?? 'GET', headers })
}

function lines(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const call of spy.mock.calls) {
    try {
      const parsed = JSON.parse(String(call[0]))
      if (parsed?.kind === 'report.tick') out.push(parsed)
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
  vi.mocked(runReportJob).mockResolvedValue(summary as never)
})

describe('bearer mode (CRON_TRIGGER=secret)', () => {
  it('401 without a header, with a wrong secret and with a wrong length; nothing runs', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await GET(makeRequest({}))).status).toBe(401)
    expect((await GET(makeRequest({ authorization: `Bearer ${SECRET.replace(/./g, 'x')}` }))).status).toBe(401)
    expect((await GET(makeRequest({ authorization: 'Bearer short' }))).status).toBe(401)
    expect(runReportJob).not.toHaveBeenCalled()
  })

  it('200 with the right bearer, and the job runs', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(runReportJob).toHaveBeenCalledTimes(1)
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
    expect(runReportJob).not.toHaveBeenCalled()
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ kind: 'cron-auth-failure', route: 'generate-reports', reason: 'bad-signature' })
  })

  it('200 on a verified POST; GET is 405', async () => {
    expect((await POST(makeRequest({ method: 'POST' }))).status).toBe(200)
    expect(runReportJob).toHaveBeenCalledTimes(1)
    expect((await GET(makeRequest({}))).status).toBe(405)
  })
})

describe('the canonical tick line', () => {
  it('is ONE line whose key set is exactly the documented counts, with the job values', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    const found = lines(log)
    expect(found).toHaveLength(1)
    expect(Object.keys(found[0]).sort()).toEqual(LINE_KEYS)
    expect(found[0]).toMatchObject({ kind: 'report.tick', triggeredBy: 'secret', scanned: 5, inserted: 2, emailsEnqueued: 3, emailsDeduped: 1, errors: 0 })
  })

  it('cannot leak: a summary carrying a business id, an address or text still yields only the documented keys', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(runReportJob).mockResolvedValue({ ...summary, businessId: 'b-secret', recipient: 'a@secret.example', text: 'secret text' } as never)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/b-secret|a@secret|secret text/)
    expect(Object.keys(lines(log)[0]).sort()).toEqual(LINE_KEYS)
  })

  it('a throwing job is captured, still answers 200, and reports UNKNOWN counters (null), never fabricated zeros', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const boom = new Error('REPORT_MAX_PER_TICK is not a number')
    vi.mocked(runReportJob).mockRejectedValue(boom)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(captureException).toHaveBeenCalledWith(boom, { tags: { cron: 'generate-reports', phase: 'route' } })
    const line = lines(log)[0]
    expect(Object.keys(line).sort()).toEqual(LINE_KEYS)
    expect(line.errors).toBe(1)
    const counters = LINE_KEYS.filter((k) => !['kind', 'triggeredBy', 'tick', 'durationMs', 'errors'].includes(k))
    expect(counters).toHaveLength(14)
    for (const k of counters) expect(line[k], `${k} must be null (unknown)`).toBeNull()
  })

  it('a job that returns a summary is not captured and its counters pass through untouched', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(captureException).not.toHaveBeenCalled()
    expect(lines(log)[0]).toMatchObject({ scanned: 5, notDue: 2, ineligible: 1, inserted: 2, stubs: 0, emailsSuppressed: 0 })
  })
})

describe('a capped tick alerts the monitor (MAJOR-5)', () => {
  it('reports status error to the generate-reports monitor, and puts the reason on the canonical line', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(runReportJob).mockResolvedValue({ ...summary, capped: true, reason: 'scan_cap' } as never)
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(captureCheckIn).toHaveBeenCalledTimes(1)
    expect(captureCheckIn.mock.calls[0][0]).toMatchObject({ monitorSlug: 'generate-reports', status: 'error' })
    expect(lines(log)[0]).toMatchObject({ capped: true, reason: 'scan_cap' })
  })

  it('an uncapped tick sends no extra check-in, and neither does a job that threw', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    vi.mocked(runReportJob).mockRejectedValue(new Error('boom'))
    await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))
    expect(captureCheckIn).not.toHaveBeenCalled()
  })
})
