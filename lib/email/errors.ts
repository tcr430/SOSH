import { REDACTED_KEYS, normaliseKey, CATCH_ALL_SUBSTRINGS } from '@/lib/observability/sentry-scrub'

export { REDACTED_KEYS }

export type EmailProviderErrorCode =
  | 'provider_rate_limit'
  | 'provider_unavailable'
  | 'invalid_recipient'
  | 'template_render_failed'
  | 'unknown'

function redactSensitiveKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => {
      const n = normaliseKey(k)
      const shouldRedact =
        REDACTED_KEYS.has(n) || CATCH_ALL_SUBSTRINGS.some((s) => n.includes(s))
      return [
        k,
        shouldRedact
          ? '[REDACTED]'
          : v !== null && typeof v === 'object' && !Array.isArray(v)
            ? redactSensitiveKeys(v as Record<string, unknown>)
            : v,
      ]
    }),
  )
}

export class EmailProviderError extends Error {
  readonly code: EmailProviderErrorCode
  readonly retryAfterSeconds: number | undefined
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: EmailProviderErrorCode,
    message: string,
    details?: Record<string, unknown>,
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'EmailProviderError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.details = Object.freeze(redactSensitiveKeys(details ?? {}))
  }
}
