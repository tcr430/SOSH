import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      CRON_SECRET: 'test-secret-that-is-at-least-32-chars!!',
    },
    public: {
      get NODE_ENV() { return process.env.NODE_ENV ?? 'development' },
    },
  },
}))

vi.mock('@/lib/metrics/orchestrator', () => ({
  runMetricsSyncTick: vi.fn(),
}))

import { GET } from './route'
import { runMetricsSyncTick } from '@/lib/metrics/orchestrator'

const SECRET = 'test-secret-that-is-at-least-32-chars!!'

function makeRequest(opts: {
  authorization?: string
  devTrigger?: boolean
}): NextRequest {
  const headers = new Headers()
  if (opts.authorization !== undefined) headers.set('authorization', opts.authorization)
  if (opts.devTrigger) headers.set('x-cron-dev-trigger', 'true')
  return new NextRequest('http://localhost/api/cron/sync-metrics', { headers })
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
  vi.mocked(runMetricsSyncTick).mockResolvedValue(metricsSummary)
})

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
})
