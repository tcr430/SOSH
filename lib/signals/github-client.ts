// ADR 0020 §10.1 — the ONE module that may import a GitHub client. Every
// consumer imports from lib/signals/index.ts instead; this file's exports
// are re-exported there and nowhere else in the codebase names @octokit/*
// directly (enforced by a source scan, ADR §11.3 scan #2).
//
// Server-only, mandatorily. Every function here does network I/O against
// api.github.com using credentials that must never reach a browser.

import { createAppAuth } from '@octokit/auth-app'
import { request as octokitRequest } from '@octokit/request'
import { config } from '@/lib/config'

// ─── Typed errors (§4.5's failure classes) ─────────────────────────────────

export type GithubErrorCode = 'revoked' | 'rate_limited' | 'not_found' | 'transient'

export class GithubClientError extends Error {
  constructor(
    public readonly code: GithubErrorCode,
    message: string,
    // Only ever set for 'rate_limited', parsed from the response's
    // Retry-After header — never a guessed/computed backoff (ADR §4.5).
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'GithubClientError'
  }
}

function parseRetryAfterSeconds(headers: Record<string, string> | undefined): number | undefined {
  const raw = headers?.['retry-after']
  if (!raw) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds : undefined
}

// §4.5 — 401 (revoked), 403 + Retry-After (rate limited), 404 (repo gone),
// 5xx (transient). Anything else (network failure, unexpected status) also
// collapses to 'transient' — the poller's containment for that class is
// "count, retry next tick", which is the safe default for an unclassified
// failure too.
function mapError(err: unknown): GithubClientError {
  const status = (err as { status?: number } | undefined)?.status
  const headers = (err as { response?: { headers?: Record<string, string> } } | undefined)?.response?.headers

  if (status === 401) {
    return new GithubClientError('revoked', 'GitHub installation access revoked or credentials invalid')
  }
  if (status === 403) {
    return new GithubClientError('rate_limited', 'GitHub rate limit exceeded', parseRetryAfterSeconds(headers))
  }
  if (status === 404) {
    return new GithubClientError('not_found', 'GitHub resource not found')
  }
  if (typeof status === 'number' && status >= 500) {
    return new GithubClientError('transient', `GitHub server error (${status})`)
  }
  return new GithubClientError('transient', err instanceof Error ? err.message : 'Unknown GitHub client error')
}

// ─── App auth (JWT minting + installation-token exchange) ──────────────────

// createAppAuth signs the App JWT (RS256) internally and, for
// type:'installation', exchanges it via POST /app/installations/{id}/
// access_tokens using the `request` instance we pass in — the exact
// @octokit/request package pinned by package.json, not a second HTTP client.
function getAppAuth() {
  const privateKey = Buffer.from(config.server.GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf8')
  return createAppAuth({
    appId: config.server.GITHUB_APP_ID,
    privateKey,
    clientId: config.server.GITHUB_APP_CLIENT_ID,
    clientSecret: config.server.GITHUB_APP_CLIENT_SECRET,
    request: octokitRequest,
  })
}

export interface InstallationToken {
  token: string
  expiresAt: string
}

// ADR §2.4 — SIGNAL-NO-TOKEN-AT-REST. Minted PER TICK, held in process
// memory for the duration of that tick, NEVER persisted, never written to
// any table, never cached across ticks. Proven by construction: this
// function does exactly one thing — return the token to its caller. It
// contains no DB write, no cache, no log statement that could leak it.
//
// *Loser: persist-with-expiry (in Vault).* Genuinely viable — it would save
// one request per hour per installation — but reintroduces the
// long-lived-credential-at-rest problem the GitHub App model exists to
// avoid, for a saving of ~0.02 requests/hour against a 5,000/hour budget
// (§2.4). Rejected.
export async function mintInstallationToken(installationId: number): Promise<InstallationToken> {
  try {
    const auth = getAppAuth()
    // The { type: 'installation' } overload's return type is guaranteed
    // InstallationAccessTokenAuthentication (token field present) by
    // @octokit/auth-app's own types — no runtime narrowing needed.
    const result = await auth({ type: 'installation', installationId })
    return { token: result.token, expiresAt: result.expiresAt }
  } catch (err) {
    if (err instanceof GithubClientError) throw err
    throw mapError(err)
  }
}

// ─── Releases (conditional, ETag-over-page-1) ───────────────────────────────

export interface GithubReleaseAuthor {
  type: string
}

export interface GithubRelease {
  id: number
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string | null
  prerelease: boolean
  draft: boolean
  author: GithubReleaseAuthor | null
}

export type ReleasesResult =
  | { status: 'not_modified' }
  | { status: 'ok'; releases: GithubRelease[]; etag: string | null }

// ⚠️ CONDITIONAL via If-None-Match, NOT a `since` cursor (ADR §4.4). GitHub's
// release object has NO reliable `updated_at` field, so "releases newer than
// X" can never surface an EDIT to an OLDER release — a `since` cursor is
// permanently blind to that case. The ETag-over-page-1 mechanism is what
// makes edit detection possible at all: a 304 means nothing on page 1
// changed (including edits); a 200 means something did, and every returned
// release is diffed by (external_id, content_hash) to tell new from edited.
// Do not "optimise" this back into a since-based cursor — it would silently
// reintroduce the exact gap this mechanism exists to close.
export async function getReleases(
  installationToken: string,
  owner: string,
  repo: string,
  etag: string | null,
): Promise<ReleasesResult> {
  try {
    const response = await octokitRequest('GET /repos/{owner}/{repo}/releases', {
      owner,
      repo,
      per_page: 30,
      page: 1,
      headers: {
        authorization: `token ${installationToken}`,
        ...(etag ? { 'if-none-match': etag } : {}),
      },
    })
    const responseEtag = (response.headers as Record<string, string> | undefined)?.etag ?? null
    return { status: 'ok', releases: response.data as GithubRelease[], etag: responseEtag }
  } catch (err) {
    const status = (err as { status?: number } | undefined)?.status
    // A 304 is not a body to parse — @octokit/request throws for any
    // non-2xx, including 304, so it is intercepted here before general
    // error mapping and short-circuits without ever touching a response body.
    if (status === 304) return { status: 'not_modified' }
    throw mapError(err)
  }
}

// ─── OAuth code exchange (§8.3 step 8 — the A-1 user-authorization leg) ────

export interface UserTokenExchangeResult {
  accessToken: string
}

// §8.3 step 8. A distinct host (github.com, not api.github.com) and a
// distinct credential pair (GITHUB_APP_CLIENT_ID/SECRET, the OAuth leg —
// not the App's RS256 private key), so this is a plain fetch rather than
// the @octokit/request instance used everywhere else in this file, which is
// configured for the API host. The returned token is used exactly ONCE, by
// the callback, for step 9's ownership proof (GET /user/installations) —
// never persisted (§0.2 A-1, SIGNAL-USER-TOKEN-UNPERSISTED).
export async function exchangeUserCode(code: string): Promise<UserTokenExchangeResult> {
  let response: Response
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: config.server.GITHUB_APP_CLIENT_ID,
        client_secret: config.server.GITHUB_APP_CLIENT_SECRET,
        code,
      }),
    })
  } catch (err) {
    throw mapError(err)
  }
  if (!response.ok) {
    throw new GithubClientError('transient', `GitHub OAuth token exchange failed (${response.status})`)
  }
  const data = (await response.json()) as { access_token?: string; error?: string }
  if (!data.access_token) {
    // A well-formed 200 with an `error` field (e.g. bad_verification_code,
    // an expired or already-redeemed `code`) — GitHub's OAuth token
    // endpoint returns these as 200s, not error statuses.
    throw new GithubClientError('transient', data.error ?? 'GitHub OAuth token exchange returned no access_token')
  }
  return { accessToken: data.access_token }
}

// ─── User installations (§8.3 ownership proof — used once, at callback time) ─

export interface GithubInstallationAccount {
  login: string
  type: string
}

export interface GithubInstallationSummary {
  id: number
  account: GithubInstallationAccount | null
}

export async function getUserInstallations(userAccessToken: string): Promise<GithubInstallationSummary[]> {
  try {
    const response = await octokitRequest('GET /user/installations', {
      headers: { authorization: `token ${userAccessToken}` },
    })
    const data = response.data as { installations?: GithubInstallationSummary[] }
    return data.installations ?? []
  } catch (err) {
    throw mapError(err)
  }
}

// ─── Installation repositories (the watch-list repo picker) ────────────────

export interface GithubRepoOwner {
  login: string
}

export interface GithubRepoSummary {
  id: number
  owner: GithubRepoOwner
  name: string
}

export async function getInstallationRepositories(installationToken: string): Promise<GithubRepoSummary[]> {
  try {
    const response = await octokitRequest('GET /installation/repositories', {
      headers: { authorization: `token ${installationToken}` },
    })
    const data = response.data as { repositories?: GithubRepoSummary[] }
    return data.repositories ?? []
  } catch (err) {
    throw mapError(err)
  }
}
