export type AiErrorCode =
  | 'quota_exceeded'      // trial cap hit; no SDK call made
  | 'rate_limited'        // per-business per-minute cap hit; no SDK call made
  | 'invalid_response'    // SDK returned 200 but output failed Zod parse
  | 'provider_error'      // 5xx after retry
  | 'rate_limit'          // 429 after retry
  | 'timeout'             // SDK call exceeded timeout
  // ADR 0017 §4.2 [type-3] — a Tier-0 POLICY failure (safeParse succeeded,
  // shape is valid, but a structural rule the schema can't express was
  // violated, e.g. a thread's role sequence). Distinguishable from
  // invalid_response so generate-native.ts's re-prompt (§4.4) can send a
  // targeted correction instead of a generic retry.
  | 'policy_violation'

export class AiError extends Error {
  constructor(public readonly code: AiErrorCode, message: string) {
    super(message)
    this.name = 'AiError'
  }
}
