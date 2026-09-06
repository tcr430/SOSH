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
//
// Vercel build fix (2026-09-06): the pure crypto functions
// (generatePkceVerifier/generatePkceChallenge) moved to ./pkce-crypto,
// which has no next/headers dependency. This file's top-level `cookies`
// import makes the WHOLE module unsafe to import statically from anything
// reachable by a Client Component (Turbopack's Server/Client boundary
// check flags the import's mere presence, not just its usage) — that is
// exactly what broke production builds via
// AccountsClient.tsx -> lib/social (barrel) -> TwitterProvider -> here.
// twitter-provider.ts now lazy-imports THIS file only at the two call
// sites that actually run server-side (getOAuthAuthorizeUrl,
// exchangeOAuthCode), and imports the crypto functions from ./pkce-crypto
// statically since that module is safe everywhere.

const PKCE_COOKIE_NAME = 'sosh_pkce_verifier'
const PKCE_COOKIE_MAX_AGE_SECONDS = 600 // matches the state JWT's 10-minute TTL

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
