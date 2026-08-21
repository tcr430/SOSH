import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0020 §8.3/§0.2 A-1 — closed twice, in OPPOSITE directions, each
// needing its own executable check (E2.8): direction A is the token getting
// PERSISTED (a FORBIDDING scan); direction B is the OAuth leg never being
// BUILT at all (a PRESENCE scan — unusual here, since every other scan in
// this session forbids something. The failure mode for B is omission, and
// omission is exactly what a forbidding scan cannot see).

const ROOT = process.cwd()

describe('SIGNAL-USER-TOKEN-UNPERSISTED (A-1, direction A — the token gets stored)', () => {
  // Scoped to the PERSISTENCE layer deliberately. The user token is
  // legitimately named inside app/api/signals/github/callback/route.ts (it
  // receives the exchanged token) and lib/signals/github-client.ts (it
  // performs the exchange and the /user/installations call) — scanning
  // those would redden on CORRECT code and the next session would delete
  // this test to make it pass, which is worse than not having it. The
  // actual guarantee is narrower and sharper: the token never reaches the
  // one place persistence would happen.
  const GITHUB_CONNECTIONS_DB_FILE = path.join(ROOT, 'lib', 'db', 'github-connections.ts')
  const DB_TYPES_FILE = path.join(ROOT, 'lib', 'db', 'types.ts')

  // access_token / user_token / refresh_token, as an identifier fragment —
  // covers snake_case columns and camelCase fields alike.
  const TOKEN_SHAPED_PATTERN = /access[_-]?token|user[_-]?token|refresh[_-]?token/i

  it('lib/db/github-connections.ts — the ONLY module that touches github_connections — never names a token-shaped field', () => {
    const source = fs.readFileSync(GITHUB_CONNECTIONS_DB_FILE, 'utf8')
    expect(TOKEN_SHAPED_PATTERN.test(source)).toBe(false)
  })

  it('the GithubConnectionRow/Insert/Update block in lib/db/types.ts never names a token-shaped field', () => {
    const source = fs.readFileSync(DB_TYPES_FILE, 'utf8')
    const startMarker = 'export type GithubConnectionRow'
    const endMarker = 'export type WatchedRepoRow'
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker)
    expect(start, 'GithubConnectionRow block not found — update the markers').toBeGreaterThanOrEqual(0)
    expect(end, 'WatchedRepoRow block not found — update the markers').toBeGreaterThan(start)

    const block = source.slice(start, end)
    expect(TOKEN_SHAPED_PATTERN.test(block)).toBe(false)
  })
})

describe('SIGNAL-OAUTH-LEG-PRESENT (A-1, direction B — the leg is never built)', () => {
  // A presence scan, not an absence scan: it asserts the OAuth code-exchange
  // call and the ownership-proof call BOTH still exist in the client that
  // performs them. Deleting either silently regresses the tenant-binding
  // fix (§8.2/§8.3) back to the pre-A-1 draft security-reviewer BLOCKED —
  // and no forbidding scan could ever catch that, because nothing forbidden
  // was added; something required was removed.
  const GITHUB_CLIENT_FILE = path.join(ROOT, 'lib', 'signals', 'github-client.ts')

  it('lib/signals/github-client.ts still performs the OAuth code exchange (step 8) and the ownership-proof call (step 9)', () => {
    const source = fs.readFileSync(GITHUB_CLIENT_FILE, 'utf8')
    expect(source).toContain('login/oauth/access_token')
    expect(source).toContain('/user/installations')
  })
})
