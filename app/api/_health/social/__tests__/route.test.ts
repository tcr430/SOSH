import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  config: {
    public: { NODE_ENV: 'development' },
    server: { HEALTHCHECK_TOKEN: '' },
  },
}))

const mockGetRegistry = vi.fn()
vi.mock('@/lib/social', () => ({
  getRegistry: () => mockGetRegistry(),
  VALID_PLATFORMS: ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'],
}))

import { GET } from '../route'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/_health/social')
}

describe('GET /api/_health/social — SOCIAL-HEALTH-PER-PLATFORM (ADR 0028 §8.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names no broker — reports a "providers" object, never a single "provider" string', async () => {
    mockGetRegistry.mockReturnValue({
      get: (platform: string) => {
        if (platform === 'linkedin') return { platform: 'linkedin' }
        throw new Error('not registered')
      },
    })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body).not.toHaveProperty('provider')
    expect(body.providers).toBeTypeOf('object')
  })

  it('reports the resolved provider per platform independently — one configured, four not', async () => {
    mockGetRegistry.mockReturnValue({
      get: (platform: string) => {
        if (platform === 'linkedin') return { platform: 'linkedin' }
        throw new Error('not registered')
      },
    })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body.providers.linkedin).toBe('linkedin')
    expect(body.providers.twitter).toBe('not_configured')
    expect(body.providers.instagram).toBe('not_configured')
    expect(body.providers.facebook).toBe('not_configured')
    expect(body.providers.threads).toBe('not_configured')
    expect(body.status).toBe('ok')
  })

  it('all five platforms configured (mock mode shape) all report a resolved value', async () => {
    mockGetRegistry.mockReturnValue({
      get: () => ({ platform: 'linkedin' }),
    })

    const response = await GET(makeRequest())
    const body = await response.json()

    for (const platform of ['linkedin', 'twitter', 'instagram', 'facebook', 'threads']) {
      expect(body.providers[platform]).not.toBe('not_configured')
    }
  })

  it('getRegistry() itself throwing yields status error with an empty providers object', async () => {
    mockGetRegistry.mockImplementation(() => {
      throw new Error('boom')
    })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body.status).toBe('error')
    expect(body.providers).toEqual({})
  })
})
