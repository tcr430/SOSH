import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mockEnabled = vi.hoisted(() => ({ value: true as boolean }))

vi.mock('@/lib/config', () => ({
  config: {
    server: {
      get AUTH_RATE_LIMIT_ENABLED() {
        return mockEnabled.value
      },
    },
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import * as serviceModule from '@/lib/supabase/service'
import { resolveIp, isValidIp, consumeRateLimit } from './rate-limit'

function makeRpcClient(...results: boolean[]) {
  const rpc = vi.fn()
  for (const r of results) {
    rpc.mockResolvedValueOnce({ data: r, error: null })
  }
  rpc.mockResolvedValue({ data: true, error: null })
  const client = { rpc } as unknown as SupabaseClient
  vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
  return { rpc }
}

describe('resolveIp', () => {
  it('returns leftmost IP from x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
    expect(resolveIp(headers)).toBe('1.2.3.4')
  })

  it('returns unknown when header is missing', () => {
    expect(resolveIp(new Headers())).toBe('unknown')
  })

  it('returns unknown when leftmost entry is malformed', () => {
    const headers = new Headers({ 'x-forwarded-for': 'not-an-ip, 1.2.3.4' })
    expect(resolveIp(headers)).toBe('unknown')
  })

  it('handles single IP without comma', () => {
    const headers = new Headers({ 'x-forwarded-for': '192.168.1.1' })
    expect(resolveIp(headers)).toBe('192.168.1.1')
  })
})

describe('isValidIp', () => {
  it('accepts valid IPv4 addresses', () => {
    expect(isValidIp('1.2.3.4')).toBe(true)
    expect(isValidIp('192.168.0.1')).toBe(true)
    expect(isValidIp('255.255.255.255')).toBe(true)
  })

  it('accepts valid IPv6 addresses', () => {
    expect(isValidIp('::1')).toBe(true)
    expect(isValidIp('2001:db8::1')).toBe(true)
    expect(isValidIp('fe80::1')).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isValidIp('not-an-ip')).toBe(false)
    expect(isValidIp('')).toBe(false)
    expect(isValidIp('999.999.999.999')).toBe(false)
    expect(isValidIp('1.2.3')).toBe(false)
  })
})

describe('consumeRateLimit', () => {
  beforeEach(() => {
    mockEnabled.value = true
    vi.clearAllMocks()
  })

  it('returns true immediately when AUTH_RATE_LIMIT_ENABLED is false, no RPC call', async () => {
    mockEnabled.value = false
    const { rpc } = makeRpcClient()
    const result = await consumeRateLimit('login', '1.2.3.4', 'user@example.com')
    expect(result).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('per-IP allowed → returns true (signup has no email bucket)', async () => {
    const { rpc } = makeRpcClient(true)
    const result = await consumeRateLimit('signup', '1.2.3.4')
    expect(result).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('consume_rate_limit_token', expect.objectContaining({
      p_bucket_key: 'ip:1.2.3.4:signup',
    }))
  })

  it('per-IP denied → returns false, does NOT consult email bucket', async () => {
    const { rpc } = makeRpcClient(false)
    const result = await consumeRateLimit('login', '1.2.3.4', 'user@example.com')
    expect(result).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('per-IP allowed + per-email denied → returns false, IP token already spent (no refund)', async () => {
    const { rpc } = makeRpcClient(true, false)
    const result = await consumeRateLimit('login', '1.2.3.4', 'user@example.com')
    expect(result).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('per-IP allowed + per-email allowed → returns true', async () => {
    const { rpc } = makeRpcClient(true, true)
    const result = await consumeRateLimit('login', '1.2.3.4', 'user@example.com')
    expect(result).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('email bucket not consulted when email is not provided', async () => {
    const { rpc } = makeRpcClient(true)
    await consumeRateLimit('login', '1.2.3.4')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('email bucket key is lowercased and trimmed', async () => {
    const { rpc } = makeRpcClient(true, true)
    await consumeRateLimit('login', '1.2.3.4', '  User@Example.COM  ')
    expect(rpc).toHaveBeenNthCalledWith(2, 'consume_rate_limit_token', expect.objectContaining({
      p_bucket_key: 'email:user@example.com:login',
    }))
  })

  it('passes correct capacity and refill rate for login IP bucket', async () => {
    const { rpc } = makeRpcClient(true)
    await consumeRateLimit('login', '1.2.3.4')
    expect(rpc).toHaveBeenCalledWith('consume_rate_limit_token', {
      p_bucket_key: 'ip:1.2.3.4:login',
      p_capacity: 10,
      p_refill_per_second: 10 / 60,
    })
  })

  it('signup action has no email bucket even when email is provided', async () => {
    const { rpc } = makeRpcClient(true)
    const result = await consumeRateLimit('signup', '1.2.3.4', 'user@example.com')
    expect(result).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
