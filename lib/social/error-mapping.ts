import type { SocialProviderErrorCode } from './types'

// ADR 0028 §7.2 (N2.9) — the error-mapping table, implemented as code and
// SHARED by both providers so the reasoning behind each row lives in
// exactly one place, not duplicated per platform. Covers only the PUBLISH
// response mapping; refresh/exchange endpoints have their own distinct
// semantics (a refresh-token rejection means TOKEN_REVOKED, not
// TOKEN_EXPIRED) and are NOT routed through this table.
//
// No new SocialProviderErrorCode is required or permitted here — L-7's
// founder adjudication is not triggered, and adding one would change the
// publishing worker's retry behaviour, which L-1 forbids.
export function mapHttpStatusToErrorCode(status: number): SocialProviderErrorCode {
  if (status === 401) return 'TOKEN_EXPIRED'
  if (status === 403) return 'TOKEN_REVOKED'
  // 409 CONFLICT -> NETWORK is the one mapping that deserves scrutiny, and
  // it is DELIBERATE: the union offers no "retryable conflict" code,
  // LinkedIn documents 409 as "retry the request" (ADR 0028 §7.2), and
  // mapping a documented-retryable condition to a terminal code would fail
  // posts that would otherwise have succeeded. Applied to X too, by
  // analogy — ADR 0028 §7.2's table row for X states its 4xx/5xx mapping
  // is "as above by analogy"; X's own 409 semantics are unverified, but
  // the union-shape reasoning (no retryable-conflict code exists) holds
  // regardless of platform.
  if (status === 409) return 'NETWORK'
  if (status >= 500) return 'NETWORK'
  return 'PLATFORM_REJECTED'
}

// retryAfterSeconds is populated ONLY when the code is RATE_LIMITED (ADR
// 0002 §3). Each platform derives its own raw candidate differently —
// LinkedIn from a Retry-After header, X from an x-rate-limit-reset epoch
// timestamp (ADR 0028 §7.2, N2.1 finding 7) — this is the shared guard+
// fallback both apply to that candidate.
//
// MINOR-3 (Session 30.5-D, D5): named finiteRetryAfterSeconds, not
// boundRetryAfterSeconds — the Number.isFinite guard is correct, but "bound"
// promises a ceiling this function never applied. A hostile or buggy
// `Retry-After: 999999999` passes through untouched. No worker-side
// duration ceiling exists to clamp against (PUBLISH_MAX_ATTEMPTS is an
// attempt COUNT, not a time bound) — inventing one would violate ADR 0028
// §13's "no platform fact from memory", so the guard is honestly named
// instead of quietly re-scoped.
export function finiteRetryAfterSeconds(candidateSeconds: number, fallbackSeconds = 60): number {
  return Number.isFinite(candidateSeconds) ? candidateSeconds : fallbackSeconds
}
