import { isIP } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import { config } from '@/lib/config'

export type AuthAction = 'signup' | 'login' | 'forgot-password' | 'reset-password'

interface BucketConfig {
  capacity: number
  refillPerSecond: number
}

export const RATE_LIMITS: Record<AuthAction, { ip: BucketConfig; email?: BucketConfig }> = {
  'signup':          { ip: { capacity: 5,  refillPerSecond: 5 / 60 } },
  'login':           { ip: { capacity: 10, refillPerSecond: 10 / 60 },      email: { capacity: 5, refillPerSecond: 5 / (15 * 60) } },
  'forgot-password': { ip: { capacity: 5,  refillPerSecond: 5 / 60 },       email: { capacity: 3, refillPerSecond: 3 / (15 * 60) } },
  'reset-password':  { ip: { capacity: 5,  refillPerSecond: 5 / 60 } },
}

export function isValidIp(value: string): boolean {
  return isIP(value) !== 0
}

export function resolveIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (!xff) return 'unknown'
  const leftmost = xff.split(',')[0].trim()
  return isValidIp(leftmost) ? leftmost : 'unknown'
}

async function rpcConsume(
  client: SupabaseClient,
  key: string,
  capacity: number,
  refillPerSecond: number,
): Promise<boolean> {
  const { data } = await client.rpc('consume_rate_limit_token', {
    p_bucket_key: key,
    p_capacity: capacity,
    p_refill_per_second: refillPerSecond,
  })
  return data as boolean
}

export async function consumeRateLimit(
  action: AuthAction,
  ip: string,
  email?: string,
): Promise<boolean> {
  if (!config.server.AUTH_RATE_LIMIT_ENABLED) return true

  const cfg = RATE_LIMITS[action]
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const ipOk = await rpcConsume(client, `ip:${ip}:${action}`, cfg.ip.capacity, cfg.ip.refillPerSecond)
  if (!ipOk) return false

  // Per ADR 0007 §5.2 E4: per-IP token already spent, no refund on email failure.
  if (cfg.email && email) {
    const emailKey = `email:${email.toLowerCase().trim()}:${action}`
    const emailOk = await rpcConsume(client, emailKey, cfg.email.capacity, cfg.email.refillPerSecond)
    if (!emailOk) return false
  }

  return true
}
