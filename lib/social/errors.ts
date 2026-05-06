import type { Platform } from '@/lib/db/types'
import type { SocialProviderErrorCode } from './types'

const SENSITIVE_KEY_PATTERN = /token|secret|authorization|cookie/i

function redactSensitiveKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_KEY_PATTERN.test(k)
        ? '[REDACTED]'
        : v !== null && typeof v === 'object' && !Array.isArray(v)
          ? redactSensitiveKeys(v as Record<string, unknown>)
          : v,
    ]),
  )
}

export class SocialProviderError extends Error {
  readonly code: SocialProviderErrorCode
  readonly platform: Platform | null
  readonly retryAfterSeconds: number | null
  readonly details: Readonly<Record<string, unknown>>

  constructor(args: {
    code: SocialProviderErrorCode
    message: string
    platform?: Platform | null
    retryAfterSeconds?: number | null
    details?: Record<string, unknown>
  }) {
    super(args.message)
    this.name = 'SocialProviderError'
    this.code = args.code
    this.platform = args.platform ?? null
    this.retryAfterSeconds = args.retryAfterSeconds ?? null
    this.details = Object.freeze(redactSensitiveKeys(args.details ?? {}))
  }
}
