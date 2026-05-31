import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  config: {
    public: {
      NODE_ENV: 'production',
      SENTRY_DSN: 'https://key@sentry.io/123',
    },
    server: {
      HEALTHCHECK_TOKEN: 'secret-token',
    },
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/db/cron-health', () => ({
  getCronLastSeen: vi.fn(),
}))

import * as serviceModule from '@/lib/supabase/service'
import * as cronHealthModule from '@/lib/db/cron-health'
import { GET } from '../route'

function makeRequest(token?: string): NextRequest {
  if (token !== undefined) {
    return new NextRequest('http://localhost/api/_health', {
      headers: { 'x-healthcheck-token': token },
    })
  }
  return new NextRequest('http://localhost/api/_health')
}

function setupMocks(options: {
  dbThrows?: boolean
  publishLastSeen?: string | null
  metricsLastSeen?: string | null
} = {}) {
  if (options.dbThrows) {
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockRejectedValue(new Error('db error')),
      }),
    } as unknown as ReturnType<typeof serviceModule.createServiceRoleClient>)
  } else {
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [{}], error: null }),
      }),
    } as unknown as ReturnType<typeof serviceModule.createServiceRoleClient>)
  }

  vi.mocked(cronHealthModule.getCronLastSeen).mockImplementation(async (_client, slug) => {
    if (slug === 'publish') return options.publishLastSeen ?? null
    if (slug === 'metrics-sync') return options.metricsLastSeen ?? null
    return null
  })
}

describe('GET /api/_health', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when no authorization header is provided', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(404)
  })

  it('returns 404 when wrong token is provided', async () => {
    const res = await GET(makeRequest('wrong-token'))
    expect(res.status).toBe(404)
  })

  it('returns 200 with all response keys on valid token and healthy state', async () => {
    const publishLastSeen = new Date(Date.now() - 30_000).toISOString()
    const metricsLastSeen = new Date(Date.now() - 30 * 60_000).toISOString()
    setupMocks({ publishLastSeen, metricsLastSeen })

    const res = await GET(makeRequest('secret-token'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ts: expect.any(String),
      db: 'ok',
      cron: {
        publish: { lastSeen: publishLastSeen, stale: false },
        metricsSync: { lastSeen: metricsLastSeen, stale: false },
      },
      sentry: { dsnConfigured: true },
    })
  })

  it('returns 200 with lastSeen null and stale true when cron_health is empty', async () => {
    setupMocks({ publishLastSeen: null, metricsLastSeen: null })

    const res = await GET(makeRequest('secret-token'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.cron.publish).toEqual({ lastSeen: null, stale: true })
    expect(body.cron.metricsSync).toEqual({ lastSeen: null, stale: true })
  })

  it('returns 200 with db: err when database throws', async () => {
    setupMocks({ dbThrows: true })

    const res = await GET(makeRequest('secret-token'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.db).toBe('err')
  })
})
