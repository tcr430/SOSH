import type { Platform } from '@/lib/db/types'
import type { SocialProviderErrorCode } from './types'

const SENSITIVE_KEY_PATTERN = /token|secret|authorization|cookie/i

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
    this.details = Object.freeze(
      Object.fromEntries(
        Object.entries(args.details ?? {}).map(([k, v]) =>
          SENSITIVE_KEY_PATTERN.test(k) ? [k, '[REDACTED]'] : [k, v],
        ),
      ),
    )
  }
}
