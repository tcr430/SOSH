import { cookies } from 'next/headers'

// ADR 0028 §2.3 (N2.6). X mandates PKCE (S256, verified N2.1). The verifier
// must survive the round trip from authorize to callback WITHOUT ever
// appearing in the signed-JWT state — that state is signed, not encrypted,
// and travels through the platform in a URL (browser history, referrer
// logs, a proxy can all read it). An httpOnly, Secure, SameSite=Lax,
// path-scoped cookie is the decision (ADR 0028 §2.3); SameSite=Lax is
// correct and sufficient because the callback arrives as a top-level GET
// navigation, which Lax permits — do not "harden" this to Strict.
//
// PKCE generation itself stays platform-specific (inside the provider that
// needs it, per §2.6's reasoning: moving it into the shared connect/
// callback routes would leak platform knowledge into the one layer that
// must stay platform-agnostic). This module is the shared cookie mechanism
// N2.8's TwitterProvider calls into — LinkedIn has no PKCE (N2.1, confirmed
// not required/available for SOSH's flow) and never touches this file.

const PKCE_COOKIE_NAME = 'sosh_pkce_verifier'
const PKCE_COOKIE_MAX_AGE_SECONDS = 600 // matches the state JWT's 10-minute TTL

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

// RFC 7636 §4.1: 43-128 chars of [A-Z a-z 0-9 - . _ ~]. 32 random bytes ->
// 43-char base64url output, at the minimum-length end of the allowed range.
export function generatePkceVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function generatePkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export async function setPkceVerifierCookie(verifier: string): Promise<void> {
  const store = await cookies()
  store.set(PKCE_COOKIE_NAME, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/social',
    maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
  })
}

// Cleared unconditionally by the caller reading it — "cleared on callback
// whether it succeeds or fails" (ADR 0028 §2.3) means the read itself is the
// clear, not a step that can be skipped on an error path.
export async function readAndClearPkceVerifierCookie(): Promise<string | null> {
  const store = await cookies()
  const verifier = store.get(PKCE_COOKIE_NAME)?.value ?? null
  store.delete(PKCE_COOKIE_NAME)
  return verifier
}
