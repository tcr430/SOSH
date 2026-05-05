import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SocialProviderError } from '../errors'

// Mock the service client lazily to avoid env-var parsing at module load time.
const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockServiceClient = { rpc: mockRpc, from: mockFrom }

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockServiceClient,
}))

// Helper to build a chainable Supabase query stub
function makeQueryStub(result: { data: unknown; error: unknown }) {
  const stub = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  return stub
}

describe('vault helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-import to avoid module-level caching of the service client
    vi.resetModules()
  })

  describe('readAccessToken', () => {
    it('returns token and expiry when account is active', async () => {
      const { readAccessToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'vault-uuid-1',
            vault_refresh_token_id: null,
            token_expires_at: '2030-01-01T00:00:00Z',
          },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'the-access-token', error: null })

      const result = await readAccessToken('sa-123')

      expect(result.token).toBe('the-access-token')
      expect(result.tokenExpiresAt).toBe('2030-01-01T00:00:00Z')
      expect(mockRpc).toHaveBeenCalledWith('get_vault_secret', { secret_id: 'vault-uuid-1' })
    })

    it('throws TOKEN_REVOKED when account is inactive', async () => {
      const { readAccessToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: false,
            vault_access_token_id: 'vault-uuid-1',
            vault_refresh_token_id: null,
            token_expires_at: null,
          },
          error: null,
        }),
      )

      await expect(readAccessToken('sa-123')).rejects.toMatchObject({
        code: 'TOKEN_REVOKED',
      })
    })

    it('throws TOKEN_REVOKED when vault_access_token_id is null', async () => {
      const { readAccessToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: null,
            vault_refresh_token_id: null,
            token_expires_at: null,
          },
          error: null,
        }),
      )

      await expect(readAccessToken('sa-123')).rejects.toMatchObject({
        code: 'TOKEN_REVOKED',
      })
    })

    it('throws TOKEN_REVOKED when the vault secret is missing', async () => {
      const { readAccessToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'vault-uuid-1',
            vault_refresh_token_id: null,
            token_expires_at: null,
          },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: null, error: null })

      await expect(readAccessToken('sa-123')).rejects.toMatchObject({
        code: 'TOKEN_REVOKED',
      })
    })
  })

  describe('readRefreshToken', () => {
    it('throws TOKEN_REVOKED when vault_refresh_token_id is null', async () => {
      const { readRefreshToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'v-1',
            vault_refresh_token_id: null,
            token_expires_at: null,
          },
          error: null,
        }),
      )

      await expect(readRefreshToken('sa-123')).rejects.toMatchObject({
        code: 'TOKEN_REVOKED',
      })
    })

    it('returns the refresh token', async () => {
      const { readRefreshToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'v-1',
            vault_refresh_token_id: 'v-refresh-1',
            token_expires_at: null,
          },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'the-refresh-token', error: null })

      const result = await readRefreshToken('sa-123')
      expect(result.token).toBe('the-refresh-token')
    })
  })

  describe('withFreshToken', () => {
    it('invokes fn with access token when token is not near expiry', async () => {
      const { withFreshToken } = await import('../vault')

      // Token expires far in the future
      const farFuture = new Date(Date.now() + 7200 * 1000).toISOString()
      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'v-access',
            vault_refresh_token_id: null,
            token_expires_at: farFuture,
          },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'fresh-token', error: null })

      const refreshFn = vi.fn().mockResolvedValue(undefined)
      const fn = vi.fn().mockResolvedValue('done')

      const result = await withFreshToken('sa-1', refreshFn, fn)

      expect(refreshFn).not.toHaveBeenCalled()
      expect(fn).toHaveBeenCalledWith('fresh-token')
      expect(result).toBe('done')
    })

    it('calls refreshFn when token expires within the skew window (4m59s)', async () => {
      const { withFreshToken } = await import('../vault')

      // Token expires in 4 minutes 59 seconds — within the 5-minute skew
      const nearExpiry = new Date(Date.now() + 299 * 1000).toISOString()
      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'v-access',
            vault_refresh_token_id: null,
            token_expires_at: nearExpiry,
          },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'refreshed-token', error: null })

      const refreshFn = vi.fn().mockResolvedValue(undefined)
      const fn = vi.fn().mockResolvedValue('done')

      await withFreshToken('sa-1', refreshFn, fn)

      expect(refreshFn).toHaveBeenCalledWith('sa-1')
    })

    it('does NOT call refreshFn when token expires just outside the skew window (5m01s)', async () => {
      const { withFreshToken } = await import('../vault')

      const justOutside = new Date(Date.now() + 301 * 1000).toISOString()
      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'v-access',
            vault_refresh_token_id: null,
            token_expires_at: justOutside,
          },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'token', error: null })

      const refreshFn = vi.fn().mockResolvedValue(undefined)
      const fn = vi.fn().mockResolvedValue(undefined)

      await withFreshToken('sa-1', refreshFn, fn)

      expect(refreshFn).not.toHaveBeenCalled()
    })

    it('does NOT call refreshFn when token_expires_at is null (never expires)', async () => {
      const { withFreshToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: true,
            vault_access_token_id: 'v-access',
            vault_refresh_token_id: null,
            token_expires_at: null,
          },
          error: null,
        }),
      )
      mockRpc.mockResolvedValue({ data: 'token', error: null })

      const refreshFn = vi.fn().mockResolvedValue(undefined)
      const fn = vi.fn().mockResolvedValue(undefined)

      await withFreshToken('sa-1', refreshFn, fn)

      expect(refreshFn).not.toHaveBeenCalled()
    })

    it('throws TOKEN_REVOKED when account is inactive', async () => {
      const { withFreshToken } = await import('../vault')

      mockFrom.mockReturnValue(
        makeQueryStub({
          data: {
            is_active: false,
            vault_access_token_id: 'v-1',
            vault_refresh_token_id: null,
            token_expires_at: null,
          },
          error: null,
        }),
      )

      const refreshFn = vi.fn()
      const fn = vi.fn()

      await expect(withFreshToken('sa-1', refreshFn, fn)).rejects.toMatchObject({
        code: 'TOKEN_REVOKED',
      })
    })
  })
})
