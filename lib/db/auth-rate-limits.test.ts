import { vi, describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pruneStaleAuthRateLimits } from './auth-rate-limits'

function makeDeleteClient(count: number | null) {
  const lt = vi.fn().mockResolvedValue({ data: null, error: null, count })
  const del = vi.fn().mockReturnValue({ lt })
  const client = {
    from: vi.fn().mockReturnValue({ delete: del }),
  } as unknown as SupabaseClient
  return { client, del, lt }
}

describe('pruneStaleAuthRateLimits', () => {
  it('deletes rows older than 24h and returns count', async () => {
    const { client, del, lt } = makeDeleteClient(2)

    const result = await pruneStaleAuthRateLimits(client)

    expect(result).toBe(2)
    expect(client.from).toHaveBeenCalledWith('auth_rate_limits')
    expect(del).toHaveBeenCalledWith({ count: 'exact' })
    expect(lt).toHaveBeenCalledWith('updated_at', expect.any(String))
  })

  it('returns 0 when count is null', async () => {
    const { client } = makeDeleteClient(null)
    const result = await pruneStaleAuthRateLimits(client)
    expect(result).toBe(0)
  })

  it('threshold is approximately 24h ago', async () => {
    const before = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const { client, lt } = makeDeleteClient(0)

    await pruneStaleAuthRateLimits(client)

    const [, threshold] = lt.mock.calls[0] as [string, string]
    const thresholdMs = new Date(threshold).getTime()
    expect(Math.abs(thresholdMs - before.getTime())).toBeLessThan(1000)
  })
})
