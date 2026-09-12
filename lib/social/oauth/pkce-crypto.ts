// Split out of pkce.ts (Vercel build fix, 2026-09-06): pkce.ts imports
// `next/headers` at module top level for its cookie functions, which makes
// the WHOLE module unsafe to statically import from any file reachable by a
// Client Component — Turbopack's Server/Client boundary check fires on the
// mere presence of that import in the graph, regardless of which export is
// actually used. AccountsClient.tsx imports PLATFORM_CONFIGS/
// getConnectionStatus from lib/social's barrel, which also statically pulls
// in TwitterProvider -> this file's old contents -> next/headers, failing
// the production build. These two functions are pure crypto with no
// next/headers dependency, so they are safe to import statically anywhere;
// pkce.ts's cookie functions are lazy-imported at their call site instead
// (twitter-provider.ts), the same pattern this codebase already uses for
// lib/supabase/service's service-role client.

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
