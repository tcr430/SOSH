# ADR 0002 — SocialProvider Abstraction (Phase 1 MVP)

**Status:** Accepted
**Date:** 2026-05-03
**Phase:** 1 — MVP
**Scope:** The `SocialProvider` interface, the Phase 1 `PostizProvider` and `MockProvider` implementations, the `ProviderRegistry`, the OAuth flow contract (signed-JWT state, vault write sequence, `social_accounts` insert), the token lifecycle (vault-backed read, lazy in-place refresh, revoke), the error model, the configuration surface, and the testing strategy. Successor to ADR 0001 (database schema). Prerequisite for the publishing worker, metrics worker, and engagement-ingestion sessions.

This document is design-only. No `.ts` or `.sql` files are produced in this session — TypeScript signatures appear in code blocks below as the contract; the Builder session writes the actual files.

---

## 1. Reversals (read first)

These reverse decisions discussed verbally or implied in earlier session notes. They are surfaced at the top so they cannot be re-introduced silently in a future session.

### Reversal 1 — Provider methods accept `socialAccountId`, never raw tokens

Earlier sketches considered passing `accessToken: string` (and sometimes `refreshToken: string`) into `publish`, `fetchPostMetrics`, `fetchEngagement`, `refreshAccessToken`, and `revokeAccessToken`.

**Reversed.** Provider methods take a `socialAccountId` (or, for the OAuth-callback-only `exchangeOAuthCode`, an authorization `code`). The provider reads `vault.decrypted_secrets` internally via a lazy-imported service-role client. Raw token material never leaves `/lib/social/` except as the return value of `exchangeOAuthCode`, which is consumed inside the same callback route handler that produced it and persisted to Vault before the response is returned.

**Rationale:** matches the CLAUDE.md rule that the rest of the codebase sees only opaque vault IDs. Eliminates an entire class of token-leakage bugs at the type level — a Server Action cannot accidentally persist or log a token it was never given.

### Reversal 2 — `fetchEngagement` and `fetchPostMetrics` are in the v1 interface

Earlier sketches considered deferring engagement-ingestion and metrics methods to a Phase 1.5 sub-interface added later.

**Reversed.** Both methods are part of `SocialProvider` from day one. `PostizProvider` stubs them to throw `NotImplementedError` (mapped to `SocialProviderError` code `NOT_IMPLEMENTED`). `MockProvider` returns synthetic success responses for both.

**Rationale:** interface evolution mid-phase is worse than a stub that throws. Workers being built later (metrics worker, engagement worker) compile against a stable contract from day one.

### Reversal 3 — OAuth state is a signed JWT, not a database row

Earlier sketches considered an `oauth_states` table with a TTL janitor.

**Reversed.** State is a signed JWT carrying `business_id`, `platform`, `nonce`, and `iat`/`exp`. No table, no migration, no janitor. Signed with a dedicated `OAUTH_STATE_SECRET` env var — **not** the Supabase JWT secret.

**Rationale:** different concerns and different rotation schedules. Rotating the Supabase JWT secret invalidates user sessions; rotating an OAuth state secret should be cost-free. See §7 for the full split.

---

## 2. Core interface

A single, flat interface in `/lib/social/types.ts`. No sub-interfaces, no method grouping. Callers see seven methods.

```typescript
export interface SocialProvider {
  readonly platform: Platform | 'multi'   // PostizProvider returns 'multi'; native providers return their platform

  // Pure URL builder. No I/O.
  getOAuthAuthorizeUrl(input: OAuthAuthorizeInput): string

  // Exchanges an authorization code for tokens. Returns raw token material
  // to the callback route — the SOLE place in the codebase where raw tokens
  // are visible. The callback handler must persist them to Vault before
  // the response leaves the server.
  exchangeOAuthCode(input: ExchangeCodeInput): Promise<TokenSet>

  // Publishes a single post for a single platform. Reads the access token
  // from Vault internally.
  publish(input: PublishInput): Promise<PublishResult>

  // Latest metrics for a previously published post. Returns null if the
  // platform has not yet exposed metrics for this post.
  // Phase 1 PostizProvider: throws NOT_IMPLEMENTED.
  fetchPostMetrics(input: FetchMetricsInput): Promise<PostMetrics | null>

  // New engagement items (comments, DMs, mentions) for the account.
  // Phase 1 PostizProvider: throws NOT_IMPLEMENTED.
  fetchEngagement(input: FetchEngagementInput): Promise<EngagementItem[]>

  // Refreshes the access token in place. Reads the refresh token from Vault,
  // calls the platform's refresh endpoint, updates the existing Vault secret
  // (vault.update_secret), bumps social_accounts.token_expires_at.
  refreshAccessToken(input: RefreshAccessTokenInput): Promise<TokenSet>

  // Best-effort revocation at the platform. Does NOT delete Vault rows or
  // flip is_active — that is the caller's job (deactivateSocialAccount in
  // /lib/db/social-accounts.ts).
  revokeAccessToken(input: RevokeAccessTokenInput): Promise<void>
}
```

---

## 3. Supporting types

### Platform

Mirrors the database CHECK constraint (ADR 0001 §B.3):

```typescript
export type Platform = 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads'
```

Reddit is intentionally absent (excluded by strategic decision in CLAUDE.md).

### OAuth and token shapes

```typescript
export interface OAuthAuthorizeInput {
  businessId: string
  redirectUri: string                  // absolute callback URL, must match exchange step
  scopes: readonly string[]            // platform-specific scope strings
}

export interface ExchangeCodeInput {
  platform: Platform
  code: string
  redirectUri: string                  // must match the authorize step exactly
}

// Returned by exchangeOAuthCode and refreshAccessToken.
// The ONLY exported type in /lib/social/ that contains raw token material.
// Consumers must persist to Vault and discard the in-memory copy immediately.
export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  tokenExpiresAt: string | null        // ISO-8601 UTC; null = never expires
  scopesGranted: readonly string[]
  // Identity fields populated only by exchangeOAuthCode (not refreshAccessToken,
  // which targets an existing account whose identity is already known).
  platformUserId?: string
  platformUsername?: string
  platformDisplayName?: string | null
}

export interface RefreshAccessTokenInput {
  socialAccountId: string
}

export interface RevokeAccessTokenInput {
  socialAccountId: string
}
```

### Publish shapes

```typescript
export interface PublishInput {
  socialAccountId: string              // provider reads token from Vault by ID
  content: string
  hashtags: readonly string[]
  mediaUrls: readonly string[]         // empty in Phase 1 (text-only)
}

export interface PublishResult {
  platformPostId: string
  publishedAt: string                  // ISO-8601 UTC, platform-confirmed
  url: string | null                   // permalink to the published post, when the platform exposes one
}
```

### Metrics shapes

Every metric is nullable. **`null` means "platform does not expose this metric"; `0` is a real value (post with no likes).** The UI must distinguish.

```typescript
export interface FetchMetricsInput {
  socialAccountId: string
  platformPostId: string
}

export interface PostMetrics {
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  clicks: number | null
  reach: number | null
  impressions: number | null
  fetchedAt: string                    // ISO-8601 UTC
}
```

### Engagement shapes

```typescript
export interface FetchEngagementInput {
  socialAccountId: string
  sinceCursor: string | null           // opaque, provider-defined; null = first fetch
}

export interface EngagementItem {
  platformItemId: string
  type: 'comment' | 'dm' | 'mention'
  authorUsername: string
  authorDisplayName: string | null
  content: string
  receivedAt: string                   // ISO-8601 UTC
  postId: string | null                // SOSH posts.id, if the engagement is on a SOSH-published post
}
```

`fetchEngagement` returns the item array directly (per the confirmed signature). Cursor / pagination state is owned by the caller (the future engagement worker), persisted in worker state, and passed back via `sinceCursor`. The provider is stateless on this call.

### Error model

```typescript
export type SocialProviderErrorCode =
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'RATE_LIMITED'
  | 'PLATFORM_REJECTED'
  | 'NETWORK'
  | 'NOT_IMPLEMENTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNKNOWN'

export class SocialProviderError extends Error {
  readonly code: SocialProviderErrorCode
  readonly platform: Platform | null
  readonly retryAfterSeconds: number | null   // populated only when code === 'RATE_LIMITED'
  readonly details: Readonly<Record<string, unknown>>

  constructor(args: {
    code: SocialProviderErrorCode
    message: string
    platform?: Platform | null
    retryAfterSeconds?: number | null
    details?: Record<string, unknown>
  })
}
```

The constructor sanitises `details`: any field whose name matches `/token|secret|authorization|cookie/i` is replaced with `'[REDACTED]'` before storage. This makes it safe to pass an entire fetch response into `details` without leaking credentials in logs.

**Caller mapping (informative):**

| Code | Likely caller action |
|---|---|
| `TOKEN_EXPIRED` | Worker calls `refreshAccessToken`, retries the original call once. |
| `TOKEN_REVOKED` | Worker flips `posts.status = 'failed'` and surfaces a "reconnect" prompt. |
| `RATE_LIMITED` | Worker re-queues the post for `now() + retryAfterSeconds`. Provider does NOT absorb the wait. |
| `PLATFORM_REJECTED` | Worker flips `posts.status = 'failed'`; records `details.platform_message` in `ai_generation_metadata`. |
| `NETWORK` | Worker retries with exponential backoff up to N attempts (worker config). |
| `NOT_IMPLEMENTED` | Bug — should never reach production for non-stub methods. |
| `PROVIDER_NOT_CONFIGURED` | App boot failure — surfaces in logs and Sentry. |
| `UNKNOWN` | Logged with full sanitised `details`; treated like `PLATFORM_REJECTED` by workers. |

---

## 4. Provider registry

```typescript
export interface ProviderRegistry {
  // Returns the provider for a given platform. Throws PROVIDER_NOT_CONFIGURED
  // if no provider is registered and no default is set.
  get(platform: Platform): SocialProvider

  // Registers a per-platform override. Phase 2 native providers use this:
  //   registry.register('linkedin', new LinkedInNativeProvider(config))
  // Subsequent get('linkedin') calls return the LinkedIn-native provider.
  // get() for un-overridden platforms continues to return the default.
  register(platform: Platform, provider: SocialProvider): void
}
```

### Default-provider pattern

The registry is constructed with a single default provider (Phase 1: `PostizProvider`; tests / no-Postiz dev: `MockProvider`). Lookups for any platform that has not been overridden via `register` fall back to the default.

In Phase 1, `register` is never called in production code paths. The map is empty; every `get(platform)` returns the singleton default.

In Phase 2, when a native LinkedIn provider lands, app boot will call `registry.register('linkedin', new LinkedInNativeProvider(...))`. Callers (`getProvider('linkedin').publish(...)`) need no change. Postiz continues to handle the other four platforms via the default.

### Why a registry rather than `getProvider(platform)` direct dispatch

A `Map<Platform, SocialProvider>` plus a default slot is the simplest data structure that supports per-platform substitution without conditional logic at the call site. The alternative (a switch statement inside `getProvider`) would require editing one file each time a platform gets a native provider; the registry pushes that to a single `register()` call at boot.

---

## 5. PostizProvider specification

`/lib/social/postiz-provider.ts` implements `SocialProvider`.

### Constructor

```typescript
new PostizProvider({ baseUrl, apiKey }: PostizConfig)
```

Throws `SocialProviderError` with code `PROVIDER_NOT_CONFIGURED` if either field is missing or `baseUrl` is not a valid URL. Construction also performs no network I/O — credentials are validated structurally, not against a live Postiz instance.

The singleton is constructed lazily by `getRegistry()` (§9), so `PROVIDER_NOT_CONFIGURED` surfaces on the first call to a provider, not at module import. This avoids exploding boot of unrelated routes when Postiz config is missing in dev.

### Endpoint mapping

The exact Postiz endpoint surface is checked against Postiz docs at https://docs.postiz.com/ during the Builder session. The mapping below is the Phase 1 contract; if Postiz endpoints differ from these names, Builder updates the implementation but not the SocialProvider interface.

| SocialProvider method | Postiz endpoint(s) | Notes |
|---|---|---|
| `getOAuthAuthorizeUrl` | `GET {baseUrl}/integrations/{platform}/authorize` (or local URL builder using Postiz client-id config) | Returns a URL; no network call. `state` query param is the signed JWT from §7. |
| `exchangeOAuthCode` | `POST {baseUrl}/integrations/{platform}/callback` with `{ code, redirectUri }` | Returns Postiz's normalised token + identity payload. |
| `publish` | `POST {baseUrl}/posts` with `{ providers: [{ id: <postiz-integration-id>, content, media }] }` | Postiz normalises per-platform formatting. Returned `platformPostId` is extracted from the per-provider response sub-object. |
| `refreshAccessToken` | `POST {baseUrl}/integrations/{platform}/refresh` with `{ refreshToken }` | Postiz returns a fresh token set. Provider then calls `vault.update_secret` and bumps `social_accounts.token_expires_at`. |
| `revokeAccessToken` | `POST {baseUrl}/integrations/{platform}/revoke` with `{ accessToken }` | Best-effort. A non-2xx response is logged and discarded; the caller still completes local cleanup. |
| `fetchPostMetrics` | (deferred) | Throws `NOT_IMPLEMENTED`. |
| `fetchEngagement` | (deferred) | Throws `NOT_IMPLEMENTED`. |

All Postiz calls send `Authorization: Bearer {POSTIZ_API_KEY}`.

### Vault read pattern

Methods that need a token (`publish`, `refreshAccessToken`, `revokeAccessToken`, future `fetchPostMetrics` / `fetchEngagement`) use this helper, kept inside the provider module:

```typescript
async function readAccessToken(socialAccountId: string): Promise<{ token: string; tokenExpiresAt: string | null }> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  // Single round-trip joining social_accounts to vault.decrypted_secrets.
  // Returns the access token plus the row's expiry, or throws TOKEN_REVOKED
  // if the account is inactive or the vault row is missing.
  // ...
}
```

The lazy `await import(...)` pattern matches the lazy-import rule from CLAUDE.md (and the precedent in `recordAiUsage`, `deactivateSocialAccount`, etc.) — service-role code is never bundled into client builds.

`readRefreshToken(socialAccountId)` is the symmetric helper for refresh-token reads, used by `refreshAccessToken` and `revokeAccessToken`.

### Method-by-method behaviour

- **`publish`** — wraps the Postiz POST in `withFreshToken` (§8). On Postiz HTTP responses: `2xx` → return `PublishResult`; `401` / `403` → `TOKEN_EXPIRED` (let the worker retry after refresh) or `TOKEN_REVOKED` (if the platform indicates permanent invalidation); `429` → `RATE_LIMITED` with `retryAfterSeconds` parsed from the `Retry-After` header (defaulting to `60` if absent); `4xx` other → `PLATFORM_REJECTED` with the platform's error body in sanitised `details`; `5xx` / fetch failure → `NETWORK`.

- **`refreshAccessToken`** — reads the refresh token from Vault, calls the Postiz refresh endpoint, calls `vault.update_secret` for the access token (and the refresh token if Postiz rotates it), updates `social_accounts.token_expires_at` and `updated_at`. Returns the new `TokenSet` (without identity fields). On `401` / `403` from the platform: throws `TOKEN_REVOKED`.

- **`revokeAccessToken`** — reads the access token from Vault (separately from the request flow, because we still want to call the platform even if Vault read seems racy with disconnect cleanup), POSTs to the Postiz revoke endpoint, returns. Errors are logged and swallowed — local cleanup still runs.

- **`getOAuthAuthorizeUrl`** — synchronous URL builder. Composes Postiz's authorize endpoint, adds `state={signedJwt}` (built by the caller via `/lib/social/oauth/state.ts`), `redirect_uri`, `scope`. No network I/O.

- **`exchangeOAuthCode`** — POSTs to the Postiz callback endpoint, normalises the response into `TokenSet` with identity fields populated. Returns raw token material to the caller (the OAuth callback route, which is the sole authorised consumer).

- **`fetchPostMetrics`** — `throw new SocialProviderError({ code: 'NOT_IMPLEMENTED', message: 'PostizProvider.fetchPostMetrics is not implemented in Phase 1', details: { method: 'fetchPostMetrics' } })`.

- **`fetchEngagement`** — same shape, `details.method === 'fetchEngagement'`.

---

## 6. MockProvider specification

`/lib/social/mock-provider.ts` implements `SocialProvider` with deterministic, in-memory behaviour. Zero network calls. Used by every unit test and by local dev when `POSTIZ_BASE_URL` is unset.

### Constructor

```typescript
export interface FailureConfig {
  platform?: Platform              // if set, only fail for this platform
  errorCode: SocialProviderErrorCode
  retryAfterSeconds?: number       // for RATE_LIMITED
}

new MockProvider(failure?: FailureConfig)
```

When `failure` is set, every method that would normally succeed throws a `SocialProviderError` matching the config (filtered by `platform` if specified). Tests instantiate `new MockProvider({ errorCode: 'TOKEN_EXPIRED' })` to drive the worker's refresh-and-retry path, etc.

### Default success responses

| Method | Synthetic response |
|---|---|
| `getOAuthAuthorizeUrl` | `https://mock.local/authorize?state={state}&platform={platform}` |
| `exchangeOAuthCode` | `{ accessToken: 'mock_access_<uuid>', refreshToken: 'mock_refresh_<uuid>', tokenExpiresAt: now+3600s, scopesGranted: input.scopes ?? [], platformUserId: 'mock_user_<uuid>', platformUsername: 'mock_user', platformDisplayName: 'Mock User' }` |
| `publish` | `{ platformPostId: 'mock_post_<uuid>', publishedAt: now, url: 'https://mock.local/p/<uuid>' }` |
| `fetchPostMetrics` | `{ likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, reach: 0, impressions: 0, fetchedAt: now }` |
| `fetchEngagement` | `[]` (empty array) |
| `refreshAccessToken` | `{ accessToken: 'mock_access_<uuid>', refreshToken: 'mock_refresh_<uuid>', tokenExpiresAt: now+3600s, scopesGranted: [] }` |
| `revokeAccessToken` | resolves `void` |

### Call log

The mock records every call on a public `calls` property keyed by method name. Tests assert against this log (e.g. `expect(mock.calls.publish).toHaveLength(1)`). `mock.reset()` clears the log and the failure config between tests.

### What the mock does NOT do

- Does not read or write Vault.
- Does not read or write `social_accounts`.
- Does not generate signed JWTs (the synthetic authorize URL uses the caller's `state` value verbatim).
- Does not validate input shapes beyond what TypeScript enforces — error-input tests target real validation code at the route layer, not the provider.

---

## 7. OAuth flow contract

The Builder session implements the route handler. This ADR defines the contract.

### Step 1 — Authorize redirect

A Server Action (Builder session) calls:

```typescript
const url = registry.get('linkedin').getOAuthAuthorizeUrl({
  businessId,
  redirectUri: `${appBaseUrl}/api/social/linkedin/callback`,
  scopes: LINKEDIN_REQUIRED_SCOPES,   // defined in /lib/social/constants.ts
})
// then: redirect(url)
```

Before building the URL, the Server Action signs an OAuth state JWT (see §7.4) and embeds it as the `state` query parameter that the provider's URL builder appends.

### Step 2 — Callback request shape

Route file (NOT built in this session): `/app/api/social/[platform]/callback/route.ts`.

```
GET /api/social/{platform}/callback?code={code}&state={signedJwt}
GET /api/social/{platform}/callback?error={error}&error_description={msg}&state={signedJwt}
```

### Step 3 — Validation sequence

1. Read `state` query param. If absent → redirect to `/dashboard/connections?error=invalid_state`.
2. Verify JWT signature with `OAUTH_STATE_SECRET`. On failure → redirect with `?error=invalid_state`.
3. Verify `exp` is in the future. Expired → redirect with `?error=invalid_state`.
4. Decode JWT claims: `{ businessId, platform, nonce, iat, exp }`.
5. Confirm `state.platform` matches the route's `[platform]` segment. Mismatch → redirect with `?error=invalid_state`.
6. Confirm `businessId` is a syntactically valid UUID.
7. Verify the authenticated session's user owns `businessId` (call `/lib/db/businesses.ts:getBusinessById` against the user-scoped client; RLS enforces ownership). On failure → redirect with `?error=forbidden`.
8. If `error` query param is present → redirect with `?error=oauth_denied&platform={platform}`. No vault or DB writes.
9. Acquire the service-role client.
10. Call `registry.get(platform).exchangeOAuthCode({ platform, code, redirectUri })`. On `SocialProviderError` → redirect with `?error=exchange_failed`.

### Step 4 — Vault write sequence

Ordered, with explicit compensation. There is no cross-store transaction (Vault and `social_accounts` cannot share one).

```
a. Generate a placeholder social_account UUID locally (uuid v4) for vault secret naming.
b. SELECT vault.create_secret(
     new_secret => tokenSet.accessToken,
     new_name => 'sosh_token_' || placeholderId || '_access',
     new_description => 'SOSH access token for ' || platform
   )
   → vault_access_token_id
c. If tokenSet.refreshToken !== null:
     SELECT vault.create_secret(
       new_secret => tokenSet.refreshToken,
       new_name => 'sosh_token_' || placeholderId || '_refresh',
       new_description => 'SOSH refresh token for ' || platform
     )
     → vault_refresh_token_id
d. INSERT INTO social_accounts (
     id,                       ← placeholderId
     business_id,              ← state.businessId
     platform,                 ← state.platform
     platform_user_id,         ← tokenSet.platformUserId
     platform_username,        ← tokenSet.platformUsername
     platform_display_name,    ← tokenSet.platformDisplayName
     vault_access_token_id,    ← from step b
     vault_refresh_token_id,   ← from step c, or NULL
     token_expires_at,         ← tokenSet.tokenExpiresAt
     is_active,                ← true
     connected_at              ← now()
   )
   ON CONFLICT (business_id, platform, platform_user_id)
     DO UPDATE SET
       vault_access_token_id  = EXCLUDED.vault_access_token_id,
       vault_refresh_token_id = EXCLUDED.vault_refresh_token_id,
       token_expires_at       = EXCLUDED.token_expires_at,
       is_active              = true,
       updated_at             = now()
     RETURNING id, (xmax <> 0) AS was_update,
              <prior vault_access_token_id>, <prior vault_refresh_token_id>;
e. If was_update: delete the PRIOR vault secrets that the row used to point to.
   (Reconnection rotates credentials — old vault secrets become orphans.)
f. The trial-clock trigger (start_trial_on_first_social_account, ADR 0001 §F)
   fires automatically on first INSERT per business and sets trial_started_at.
g. Redirect to /dashboard/connections?connected={platform}.
```

### Step 5 — Compensation on partial failure

| Step that fails | Compensation |
|---|---|
| (b) `create_secret` access | None — no state to clean up. Redirect `?error=vault_write_failed`. |
| (c) `create_secret` refresh | Delete the access secret created in (b). Redirect `?error=vault_write_failed`. |
| (d) `social_accounts` insert (non-conflict failure) | Delete both vault secrets created in (b)/(c). Redirect `?error=db_write_failed`. |
| (e) old-secret cleanup after conflict-update | Log and continue. The new credentials are live; the old secrets are leaked. A future Vault janitor (open follow-up) will sweep orphans by name prefix. |

### Step 6 — Error-redirect codes

```
?error=invalid_state         → JWT verification or claim check failed
?error=forbidden             → authenticated user does not own the business in state
?error=oauth_denied          → platform returned error= on the callback URL
?error=exchange_failed       → exchangeOAuthCode threw (network, platform-side error)
?error=vault_write_failed    → vault.create_secret threw
?error=db_write_failed       → social_accounts insert threw
```

The dashboard's `/connections` page renders a localised message per code.

### OAUTH_STATE_SECRET — separate from Supabase JWT secret

A signed JWT with the following claims:

```
{
  "businessId": "<uuid>",
  "platform": "linkedin" | "twitter" | "instagram" | "facebook" | "threads",
  "nonce": "<base64url, 16 bytes from crypto.randomBytes>",
  "iat": <unix seconds>,
  "exp": <unix seconds = iat + 600>     // 10-minute TTL
}
```

Algorithm: HS256. Library: `jose`. Secret: `OAUTH_STATE_SECRET` (server-only, min 32 bytes).

**Why a dedicated secret, not the Supabase JWT secret:**

- **Different rotation schedules.** Rotating the Supabase JWT secret invalidates every active user session (forced re-login). Rotating `OAUTH_STATE_SECRET` invalidates only OAuth flows in flight (a 10-minute window) — a near-zero cost operation we want to be able to do casually.
- **Different blast radius.** Leaking the Supabase JWT secret is catastrophic (an attacker can mint authenticated user sessions for any account). Leaking `OAUTH_STATE_SECRET` lets an attacker forge OAuth state tokens, which only matters if combined with a separately-stolen authorization `code` from the platform — the practical exploit is bounded.
- **Different consumers.** The Supabase JWT secret is shared with the Supabase service. `OAUTH_STATE_SECRET` is owned exclusively by our callback handler. Mixing them couples our codebase to Supabase's secret-rotation operations.
- **Defence in depth.** Even within our own code, segregating secrets by purpose makes it possible to scope `OAUTH_STATE_SECRET` to the OAuth handler module via process-level isolation in the future (e.g. dedicated OAuth functions on Vercel) without re-architecting auth.

---

## 8. Token refresh lifecycle

### Lazy refresh — 5-minute skew window

`/lib/social/postiz-provider.ts` exposes an internal `withFreshToken(socialAccountId, fn)` helper used by `publish` (and, when implemented, `fetchPostMetrics` / `fetchEngagement`):

```
1. Read social_accounts row (token_expires_at, is_active, vault_access_token_id).
2. If is_active = false or vault_access_token_id IS NULL → throw TOKEN_REVOKED.
3. If token_expires_at IS NULL (platform tokens never expire) → read access token, invoke fn(token), return.
4. If token_expires_at > now() + 300 seconds → read access token, invoke fn(token), return.
5. Otherwise → call refreshAccessToken({ socialAccountId }) first, then read fresh token, invoke fn(token), return.
```

The 5-minute skew (`TOKEN_REFRESH_SKEW_SECONDS = 300`) lives in `/lib/social/constants.ts`. The window absorbs clock skew between our server, the platform's expiry timestamp, and the time the request actually arrives at the platform.

### In-place Vault update

`refreshAccessToken` calls `vault.update_secret(secret_id => vault_access_token_id, new_secret => freshToken)` — **not** `delete_secret + create_secret`. Updating in place keeps the FK in `social_accounts.vault_access_token_id` stable and avoids an interim period where the row points to a deleted secret. (Same rationale as ADR 0001 §D.)

If the platform rotates the refresh token on refresh (some do), the refresh secret is updated in place as well via `vault.update_secret(secret_id => vault_refresh_token_id, ...)`.

### `social_accounts` bump

After a successful refresh:

```sql
UPDATE social_accounts
SET token_expires_at = $newExpiry,
    updated_at = now()
WHERE id = $socialAccountId;
```

`updated_at` is also bumped automatically by the `set_updated_at` trigger (ADR 0001 §F), so the explicit assignment is belt-and-braces and would be removed if the trigger is verified to fire on this UPDATE.

### Concurrent refresh race — accepted Phase 1 tech debt

Two concurrent invocations of `withFreshToken` for the same `socialAccountId` near the expiry boundary may both decide to refresh. Both call the platform's refresh endpoint. Platform behaviour varies:

- **Some accept both refreshes.** Two valid access tokens are returned; the last `vault.update_secret` wins; the loser's token is silently discarded. No user impact.
- **Some reject the second refresh** as "refresh token already used." The second concurrent caller sees a `TOKEN_EXPIRED`-shaped or `PLATFORM_REJECTED`-shaped error, which the worker translates into one retried `publish` (which then succeeds with the freshly-stored token).

Phase 1 accepts this. The traffic profile (single business per account in MVP, low post volume, scheduled publishing rather than burst) makes the race rare and the user-visible cost (at most one extra retry) negligible.

> **Phase 2** — consider a Postgres advisory lock keyed on `socialAccountId` (`SELECT pg_advisory_xact_lock(hashtext('refresh:' || $1))`) inside `refreshAccessToken` if refresh volume becomes large enough that the race becomes user-visible. The lock is per-database, not per-region, which is acceptable because Vault writes are serialised through the same database anyway.

### Revoke is symmetric but not coupled to local cleanup

`revokeAccessToken` only calls the platform's revoke endpoint. The local cleanup — flipping `is_active = false`, deleting Vault secrets, nulling the vault ID columns — is owned by `deactivateSocialAccount` in `/lib/db/social-accounts.ts` (already implemented per ADR 0001 §D). Disconnect Server Actions call both, in either order. Webhook-driven revocations (the platform tells us a token was revoked elsewhere) skip the platform call.

---

## 9. Singleton factory

`/lib/social/index.ts` exposes the **only** import surface for the rest of the codebase. Nothing outside `/lib/social/` imports `postiz-provider`, `mock-provider`, or any internal helper directly.

### Public exports

```typescript
export type {
  SocialProvider,
  ProviderRegistry,
  Platform,
  PublishInput, PublishResult,
  PostMetrics, EngagementItem,
  TokenSet,
  OAuthAuthorizeInput, ExchangeCodeInput,
  FetchMetricsInput, FetchEngagementInput,
  RefreshAccessTokenInput, RevokeAccessTokenInput,
  SocialProviderErrorCode,
} from './types'

export { SocialProviderError } from './errors'
export { signOAuthState, verifyOAuthState } from './oauth/state'
export { getRegistry } from './registry'
```

### `getRegistry()` selection rule

```
function getRegistry(): ProviderRegistry
```

- Memoised singleton — first call constructs the registry and the default provider; subsequent calls return the same instance.
- Default provider selection at construction time:
  - If `SOCIAL_PROVIDER_MODE === 'mock'` (test env or explicit override) → `MockProvider`.
  - Else if `POSTIZ_BASE_URL` and `POSTIZ_API_KEY` are both set in `/lib/config.ts` → `PostizProvider`.
  - Else (Postiz config missing in dev) → `MockProvider`, with a one-time `console.warn` in the server log explaining the fallback. Production builds fail boot validation if the production env is detected with mock fallback active (Builder adds the guard).

### Why memoisation matters

Provider construction is cheap (no network I/O) but the registry holds the per-platform override map. If `getRegistry()` returned a fresh registry on each call, Phase 2 native-provider registrations done at boot would silently disappear. The singleton ensures `register('linkedin', new LinkedInNativeProvider(...))` at boot is visible to every subsequent `get('linkedin')`.

### Caller pattern

```typescript
// In a Server Action, route handler, or worker:
import { getRegistry } from '@/lib/social'

const provider = getRegistry().get('linkedin')
const result = await provider.publish({ socialAccountId, content, hashtags, mediaUrls })
```

No other path into `/lib/social/` is supported. ESLint can enforce this by banning imports of `@/lib/social/postiz-provider`, `@/lib/social/mock-provider`, etc., from anywhere except `/lib/social/**` (Builder configures the rule).

---

## 10. Future native provider proof

Demonstration that the interface holds without Postiz semantics leaking. This implementation is **not built in Phase 1**; it is illustrative.

```typescript
// /lib/social/linkedin-native-provider.ts (Phase 2)
export class LinkedInNativeProvider implements SocialProvider {
  readonly platform: Platform = 'linkedin'

  constructor(private readonly config: { clientId: string; clientSecret: string }) {
    if (!config.clientId || !config.clientSecret) {
      throw new SocialProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'LinkedInNativeProvider requires clientId and clientSecret',
        platform: 'linkedin',
      })
    }
  }

  getOAuthAuthorizeUrl(input: OAuthAuthorizeInput): string {
    // https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=...&redirect_uri=...&state=...&scope=...
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      scope: input.scopes.join(' '),
      // state is appended by the caller (the Server Action) using the signed-JWT helper
    })
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`
  }

  async exchangeOAuthCode(input: ExchangeCodeInput): Promise<TokenSet> {
    // POST https://www.linkedin.com/oauth/v2/accessToken with grant_type=authorization_code
    // GET  https://api.linkedin.com/v2/me to populate platformUserId / platformUsername
    // Map response → TokenSet
    // ...
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    // withFreshToken(input.socialAccountId, async (accessToken) => {
    //   POST https://api.linkedin.com/v2/ugcPosts with the LinkedIn UGC payload shape
    //   Return { platformPostId: response.id, publishedAt: now, url: 'https://www.linkedin.com/feed/update/' + response.id }
    // })
    // ...
  }

  async fetchPostMetrics(input: FetchMetricsInput): Promise<PostMetrics | null> {
    // GET https://api.linkedin.com/v2/socialActions/{platformPostId}
    // Map → PostMetrics. Fields LinkedIn doesn't expose stay null.
    // ...
  }

  async fetchEngagement(input: FetchEngagementInput): Promise<EngagementItem[]> {
    // GET https://api.linkedin.com/v2/socialActions/{urn}/comments?since={cursor}
    // Map → EngagementItem[]. type='comment' for all (LinkedIn doesn't expose DMs/mentions via this API).
    // ...
  }

  async refreshAccessToken(input: RefreshAccessTokenInput): Promise<TokenSet> {
    // POST https://www.linkedin.com/oauth/v2/accessToken with grant_type=refresh_token
    // vault.update_secret + bump social_accounts.token_expires_at
    // ...
  }

  async revokeAccessToken(input: RevokeAccessTokenInput): Promise<void> {
    // POST https://www.linkedin.com/oauth/v2/revoke with token={accessToken}
    // ...
  }
}
```

**What this proves:**

- Every `SocialProvider` method maps cleanly to LinkedIn's native REST API. No Postiz-specific shapes leak (e.g. no `providers: [{ id: ... }]` envelope from Postiz's batch endpoint shape).
- Per-platform error mapping (LinkedIn `401` → `TOKEN_EXPIRED`, etc.) happens inside the provider; the discriminated-union `SocialProviderError` is the same.
- The `withFreshToken` Vault-read pattern is reusable — it is platform-agnostic and lives in a shared helper (`/lib/social/vault.ts`) imported by both `PostizProvider` and `LinkedInNativeProvider`.
- `register('linkedin', new LinkedInNativeProvider(...))` at boot is the only boot-time change; no caller code changes.

The same exercise was mentally walked for X (POST `https://api.twitter.com/2/tweets`), Instagram Graph (POST `/{ig-user-id}/media` then `/{ig-user-id}/media_publish`), Facebook Pages (POST `/{page-id}/feed`), and Threads (POST `/{user-id}/threads`). All five fit. The interface holds.

---

## 11. Testing strategy

Implementation is **not** part of this ADR. The Builder + test sessions follow this strategy.

### Unit tests — workers and Server Actions

Workers (publishing worker, future metrics worker, future engagement worker) consume `SocialProvider` via the registry. Their tests construct `MockProvider` directly and inject it into the test registry.

Each worker test asserts:

- The right provider method is called with the right arguments.
- Each error branch (`TOKEN_EXPIRED` → refresh+retry, `RATE_LIMITED` → re-queue with `retryAfterSeconds`, `PLATFORM_REJECTED` → mark `posts.status = 'failed'`, `NETWORK` → exponential backoff) executes correctly.
- No real network calls.

`MockProvider` is the only provider tests exercise. Tests that touch Postiz-specific shapes belong to PostizProvider's own test file (next section).

### Provider tests — `PostizProvider`

`PostizProvider` tests use a fake `fetch` implementation (`vi.spyOn(global, 'fetch')` or `msw` — Builder picks). Each test:

- Constructs `PostizProvider` with test config (`{ baseUrl: 'http://test.local', apiKey: 'test_key' }`).
- Mocks the Vault read helper via dependency injection or module-level `vi.mock`.
- Mocks the next `fetch` call to return a canned Postiz response.
- Asserts request shape (URL, headers including `Authorization: Bearer test_key`, body) and response normalisation (Postiz JSON → `PublishResult`, etc.).

No live Postiz hits in CI. Provider tests run on every PR; integration tests against a live Postiz instance run only when explicitly requested.

### Integration tests — gated on `POSTIZ_BASE_URL`

`/lib/social/__integration__/` (Builder creates) holds tests that talk to a real Postiz instance:

```typescript
describe.skipIf(!process.env.POSTIZ_INTEGRATION_TEST_ENABLED)('PostizProvider integration', () => {
  // ...
})
```

These run manually against a staging Postiz, not in CI. They are the only tests in the project allowed to reach the network.

### OAuth state tests

`/lib/social/oauth/state.ts` (`signOAuthState`, `verifyOAuthState`) gets pure unit tests covering:

- Round-trip correctness (sign then verify yields the same claims).
- Signature mismatch (verify with a different secret) → throws.
- Expired token (`exp` in the past) → throws.
- Tampered claims (modify the payload after signing) → throws.
- Malformed input (not a JWT, two segments instead of three) → throws.

### Vault helper tests

`readAccessToken` / `readRefreshToken` / `withFreshToken` are tested against a mocked Supabase client. The mock returns canned join results; assertions verify:

- Throw paths (`is_active = false` → `TOKEN_REVOKED`, missing vault row → `TOKEN_REVOKED`).
- The lazy-refresh decision logic (token within skew → refresh called; token outside skew → no refresh).
- The 5-minute skew boundary (token expiring in 4m59s triggers refresh; token expiring in 5m01s does not).

### Coverage target

The 80% project-wide minimum applies. `/lib/social/` is expected to land above 90% because the module is tightly typed and heavily branching; the only gaps are the stubbed `fetchPostMetrics` / `fetchEngagement` methods on `PostizProvider`, each covered by a single "throws `NOT_IMPLEMENTED`" test.

---

## Out of scope

Explicitly **not** decided in this ADR — separate sessions:

- The publishing worker itself (polls `posts WHERE status = 'approved' AND scheduled_at <= now()`, calls `provider.publish`, transitions row state). Vercel Cron wiring, retry budget, deadletter handling.
- The metrics worker implementation.
- The engagement webhook ingestion endpoint (or the polling worker that replaces it pre-Phase 2).
- Per-platform character limits, link-card behaviour, hashtag normalisation, mention validation — these will live in `/lib/social/validation/` if the surface grows; for Phase 1 the publishing worker validates inline before calling `provider.publish`.
- The image / video upload pipeline. Phase 1 is text-only per CLAUDE.md.
- Multi-account-per-platform-per-business UX. The schema permits it via the UNIQUE on `(business_id, platform, platform_user_id)`; the dashboard is single-account in Phase 1.
- Postiz-specific webhook receivers (publish-completed, token-revoked-upstream). Polling is the Phase 1 model.

---

## Open follow-ups

- Vercel Cron schedule for the publishing worker (separate session).
- Native per-platform providers when Postiz is rate-limiting or unreliable (Phase 2+).
- Distributed lock for token refresh if races become user-visible (Phase 2 — see §8).
- Webhook receivers for platforms that push events instead of requiring polling (Phase 2).
- A Vault-secret janitor: scheduled job that lists `vault.secrets` whose name prefix doesn't match a current `social_accounts.id` and deletes orphans. Catches the post-conflict-update leak in §7 step (e) and any other compensation gap.
- An ESLint rule banning imports of `/lib/social/{postiz,mock}-provider` from outside `/lib/social/**` (Builder adds during file creation).
- Sanitised debug logging — `SocialProviderError.toJSON()` and a `redactTokens(obj)` helper that the publishing worker uses before writing `details` into `posts.ai_generation_metadata`.
