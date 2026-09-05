import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn(),
}))

vi.mock('@/lib/db/social-accounts', () => ({
  listByBusiness: vi.fn(),
}))

import { GET } from './route'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { listByBusiness } from '@/lib/db/social-accounts'

const mockCreateClient = vi.mocked(createClient)
const mockGetBusinessByOwner = vi.mocked(getBusinessForUser)
const mockListByBusiness = vi.mocked(listByBusiness)

const MOCK_USER = { id: 'user-123' }
const MOCK_BUSINESS = { id: 'biz-456', owner_id: 'user-123' }

const MOCK_ACCOUNTS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    platform: 'linkedin' as const,
    platform_username: 'acme_corp',
    platform_display_name: 'Acme Corp',
    is_active: true,
    connected_at: '2026-04-30T00:00:00Z',
    token_expires_at: null,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    platform: 'twitter' as const,
    platform_username: 'acme_x',
    platform_display_name: null,
    is_active: true,
    connected_at: '2026-05-01T00:00:00Z',
    token_expires_at: '2026-08-01T00:00:00Z',
  },
]

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/social/accounts')
}

function makeAuthClient(user: typeof MOCK_USER | null = MOCK_USER) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : new Error('Not authenticated'),
      }),
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockCreateClient.mockResolvedValue(makeAuthClient() as never)
  mockGetBusinessByOwner.mockResolvedValue(MOCK_BUSINESS as never)
  mockListByBusiness.mockResolvedValue(MOCK_ACCOUNTS)
})

describe('GET /api/social/accounts', () => {
  it('returns list of accounts for authenticated user', async () => {
    const response = await GET(makeRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(MOCK_ACCOUNTS)
  })

  it('returns 401 when not authenticated', async () => {
    mockCreateClient.mockResolvedValue(makeAuthClient(null) as never)
    const response = await GET(makeRequest())
    expect(response.status).toBe(401)
    expect(mockGetBusinessByOwner).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no business', async () => {
    mockGetBusinessByOwner.mockResolvedValue(null)
    const response = await GET(makeRequest())
    expect(response.status).toBe(404)
    expect(mockListByBusiness).not.toHaveBeenCalled()
  })

  it('returns empty array when no accounts connected', async () => {
    mockListByBusiness.mockResolvedValue([])
    const response = await GET(makeRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual([])
  })

  it('response shape excludes vault IDs', async () => {
    const response = await GET(makeRequest())
    const body = await response.json() as Record<string, unknown>[]
    for (const account of body) {
      expect(account).not.toHaveProperty('vault_access_token_id')
      expect(account).not.toHaveProperty('vault_refresh_token_id')
    }
  })

  it('returns 500 when listByBusiness throws', async () => {
    mockListByBusiness.mockRejectedValue(new Error('db error'))
    const response = await GET(makeRequest())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'fetch_failed' })
  })
})
