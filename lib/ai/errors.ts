export type AiErrorCode =
  | 'quota_exceeded'    // trial cap hit; no SDK call made
  | 'rate_limited'      // per-business per-minute cap hit; no SDK call made
  | 'invalid_response'  // SDK returned 200 but output failed Zod parse
  | 'provider_error'    // 5xx after retry
  | 'rate_limit'        // 429 after retry
  | 'timeout'           // SDK call exceeded timeout
  | 'fetch_failed'      // website-fetcher could not retrieve

export class AiError extends Error {
  constructor(public readonly code: AiErrorCode, message: string) {
    super(message)
    this.name = 'AiError'
  }
}
