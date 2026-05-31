import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      CRON_SECRET: 'test-secret-that-is-at-least-32-chars!!',
      PUBLISH_BATCH_SIZE: 25,
      PUBLISH_STUCK_MINUTES: 10,
    },
    public: {
      // Getter so vi.stubEnv('NODE_ENV', ...) is picked up at call time
      get NODE_ENV() { return process.env.NODE_ENV ?? 'development' },
    },
  },
}))

vi.mock('@/lib/publishing/orchestrator', () => ({
  runPublishTick: vi.fn(),
  runJanitorTick: vi.fn(),
}))

vi.mock('@/lib/db/posts', () => ({
  reapStuckScheduledPosts: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

import { GET } from './route'
import { runPublishTick, runJanitorTick } from '@/lib/publishing/orchestrator'
import { reapStuckScheduledPosts } from '@/lib/db/posts'

const SECRET = 'test-secret-that-is-at-least-32-chars!!'

function makeRequest(opts: {
  authorization?: string
  devTrigger?: boolean
}): NextRequest {
  const headers = new Headers()
  if (opts.authorization !== undefined) headers.set('authorization', opts.authorization)
  if (opts.devTrigger) headers.set('x-cron-dev-trigger', 'true')
  return new NextRequest('http://localhost/api/cron/publish', { headers })
}

const janitorSummary = { tick: '2026-05-25T10:00:00Z', durationMs: 1, stuckGenerationSessionsReaped: 0, authRateLimitsPruned: 0 }
const publishSummary = { tick: '2026-05-25T10:00:00Z', durationMs: 2, claimed: 0, published: 0, failed: 0, retried: 0, refreshed: 0, reaped: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(runJanitorTick).mockResolvedValue(janitorSummary)
  vi.mocked(runPublishTick).mockResolvedValue(publishSummary)
  vi.mocked(reapStuckScheduledPosts).mockResolvedValue(0)
})

describe('GET /api/cron/publish — auth (dev)', () => {
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
    const body = await res.json()
    expect(body).toHaveProperty('janitor')
    expect(body).toHaveProperty('publish')
  })

  it('returns 200 when X-Cron-Dev-Trigger is true (no secret needed in dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/cron/publish — auth (prod)', () => {
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

describe('GET /api/cron/publish — response shape', () => {
  it('response includes tick, janitor, and publish summaries', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await GET(makeRequest({ devTrigger: true }))
    const body = await res.json()
    expect(typeof body.tick).toBe('string')
    expect(body.janitor).toMatchObject({ stuckGenerationSessionsReaped: 0 })
    expect(body.publish).toMatchObject({ claimed: 0, published: 0 })
  })

  it('passes reaped count from reapStuckScheduledPosts into runPublishTick', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(reapStuckScheduledPosts).mockResolvedValue(3)
    await GET(makeRequest({ devTrigger: true }))
    expect(vi.mocked(runPublishTick)).toHaveBeenCalledWith(
      expect.objectContaining({ reaped: 3 }),
    )
  })

  it('returns 200 even when runPublishTick throws (no 500)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(runPublishTick).mockRejectedValue(new Error('publish boom'))
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.publish).toHaveProperty('error', 'publish boom')
  })

  it('returns 200 even when runJanitorTick throws (no 500)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(runJanitorTick).mockRejectedValue(new Error('janitor boom'))
    const res = await GET(makeRequest({ devTrigger: true }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.janitor).toHaveProperty('error', 'janitor boom')
  })
})
