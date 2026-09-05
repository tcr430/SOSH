# ADR 0028 — Native LinkedIn and X providers, and the removal of Postiz

**Status:** Accepted
**Date:** 2026-09-03
**Phase:** 1 — Pre-launch
**Session:** 30.5 (Track N, agent N1)
**Scope:** Native `LinkedInProvider` and `TwitterProvider` implementing the existing ADR 0002 `SocialProvider` interface; SOSH-owned OAuth apps and their configuration surface; per-platform token lifecycle; per-platform error and rate-limit mapping onto the existing eight-code union; the dual-identity model (personal founder profile + business page) promoted into this session by founder adjudication A-6; the total removal of Postiz; and ADR 0002 Amendment A.

**On the numbering.** This session is Track N, numbered **30.5** so that Sessions 31–34 keep their numbers and every existing cross-reference stays valid (`session-13-5.md` is the precedent for a `.5` insertion). Its ADR is **0028** because 0024–0027 are already claimed by the build guides for Sessions 31–34 — **ADR numbers record authorship order, not execution order.**

This document is design-only. No `.ts`, `.sql` or `.tsx` is produced by the Architect session; the shapes below are the contract the Builder (N2) implements.

---

## 0. The eight resolved questions (build-guide §0.1 — on the record)

| Q | Resolution | Named loser | Tier |
|---|---|---|---|
| Q1 | OAuth owned by SOSH; PKCE verifier in an `httpOnly` cookie; `getOAuthAuthorizeUrl` becomes `Promise<string>` | verifier in the signed-JWT state (§2.3); a `pkce_verifiers` table (§2.3); keeping the signature sync (§2.6) | 2 |
| Q2 | Text publish native per platform; media **deferred behind a hard guard** | publishing text-only and dropping media (§3.4) | 2 |
| Q3 | Per-platform lifecycle; LinkedIn dies at 60 days; X refreshes with rotation; **a new `vault_update_secret` migration** | per-provider token storage (§4.6); silent expiry (§4.3) | 1 + 2 |
| Q4 | Dual identity via URN in `platform_user_id`; **`posts.social_account_id` added**; resolver replaced | a `platform_account_type` column (§5.1); deferring T1-E (§5.3, overridden by A-6) | 1 + 2 |
| Q5 | Per-platform capability table in the ADR; `null` disambiguated for Session 33 | a `metric_availability` table now (§6) | 2 |
| Q6 | Mapping onto `types.ts`'s real eight codes; **no new code required** | mapping onto ADR 0005 §5's published list (§7.1) | 2 |
| Q7 | Register-then-delete, one PR, green at every commit; scan-proved | delete-first (§8.1); staged removal behind a flag (build-guide D-2) | 2 + 3 |
| Q8 | One shared contract suite over every implementation + fixture provider tests | bespoke per-provider tests only (D-7); real-network tests as primary proof (L-9) | 1 + 2 + 3 |

---

## 1. Context and decision summary

Postiz is a broker. It sits between SOSH and every platform, and it has been hiding three things: that SOSH owns no OAuth application, that token refresh has never worked, and that `social_accounts.platform_user_id` does not contain a platform identity at all. Removing it is therefore not a swap of one HTTP client for another — it is the point at which SOSH takes ownership of credentials, identity and token lifecycle for the first time.

**The interface survives unchanged.** ADR 0002 §2's seven methods are provider-neutral and both native implementations conform to them. Exactly one signature changes (`getOAuthAuthorizeUrl` → `Promise<string>`, §2.6), permitted by build-guide L-2 and required by PKCE. `SocialProvider.platform` loses its `'multi'` member, which existed solely to describe a broker.

**Three latent defects are exposed by the migration and must be fixed inside it**, because a native provider cannot work around any of them:

| # | Defect | Evidence | Consequence today |
|---|---|---|---|
| **D-α** | `public.vault_update_secret` **does not exist**. `postiz-provider.ts:255,262` calls `client.rpc('vault.update_secret')` — undefined, dotted, and in a schema PostgREST does not expose — and never checks `error`. | Migration `20260516180000_vault_write_helpers.sql` defines only `vault_create_secret` (:8) and `vault_delete_secret` (:25); repo-wide grep finds no definition | **Token refresh has never worked.** It fails silently, then bumps `token_expires_at` and returns a success `TokenSet`, so the system believes it refreshed. |
| **D-β** | `redirect_uri` is built from `request.nextUrl.origin` at authorize (`connect/route.ts:53`) but from `config.server.APP_URL` at exchange (`callback/route.ts:83`). | both files, read at `cd363476` | Postiz tolerates the mismatch. **LinkedIn and X enforce exact match** and will reject every exchange. |
| **D-γ** | `platform_user_id` stores Postiz's `integrationId`, not a platform identity. | `postiz-provider.ts:370` | **No backfill is possible.** Every existing connection must be re-authorised. |

**The dual-identity model is in scope by founder ruling** (A-6). CLAUDE.md's locked launch platforms are "LinkedIn (Business and Founder)" and "X (Business and Founder)"; a client will connect both a personal founder profile and a business page. `social_accounts` already permits this, but `posts` cannot express which identity a post targets, and the resolver throws when two exist. §5 specifies the whole model.

**What this session does not touch:** ADR 0005's status machine, retry policy and idempotency model (L-1, unamended by A-7); the read path (`fetchRecentPosts` / 19D-5), which is Session 32's and becomes **ADR 0002 Amendment B**; the engagement inbox (T1-A), which consumes `fetchEngagement` later; and Meta-family publishing, blocked on an external review process (A-1).

---

## 2. Q1 — The OAuth ownership model, per platform

### 2.1 What SOSH owns from this session onward

SOSH registers and owns one OAuth application per platform. The credentials **already exist in `lib/config.ts` and are entirely unused**: `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` and `X_CLIENT_ID` / `X_CLIENT_SECRET` — declared in the server schema (`:126-131`), mapped from `process.env` (`:325-330`), exposed through `serverOnly()` getters (`:546-562`) and documented in `.env.local.example` (`:37-47`).

**This corrects build-guide Reality §11**, which states native providers need "four new variables minimum". They need **zero**. `META_APP_ID` / `META_APP_SECRET` also exist and stay unused (A-1).

Client secrets are read **only** through `lib/config.ts`'s `serverOnly()` getter, which throws if touched from a client bundle. No secret may appear in a database table, a TypeScript type, a log line, an error message, or any `SocialProviderError.details` payload — the error constructor's existing redaction of `/token|secret|authorization|cookie/i` (ADR 0002 §3) is the backstop, not the primary control.

### 2.2 Verified platform facts

**Everything marked ✅ was verified against vendor documentation on 2026-09-03.** Anything marked ⚠️ is listed in §13 and is the Builder's to confirm.

| | LinkedIn | X |
|---|---|---|
| Authorize | `https://www.linkedin.com/oauth/v2/authorization` ⚠️ | `https://x.com/i/oauth2/authorize` ✅ |
| Token | `https://www.linkedin.com/oauth/v2/accessToken` ⚠️ | `https://api.x.com/2/oauth2/token` ✅ |
| PKCE | ⚠️ unconfirmed | **Mandatory**, `S256` ✅ |
| Access-token life | 60 days (`platforms/config.ts:16`) | **2 hours** ✅ |
| Refresh | **None** ✅ | Yes, via `offline.access` ✅ |

### 2.3 PKCE verifier storage — an `httpOnly` cookie

X requires PKCE. The verifier is generated per authorize request and must survive the round trip to the callback.

**Decision: an `httpOnly`, `Secure`, `SameSite=Lax`, path-scoped cookie**, `Max-Age` 600 seconds to match the state JWT's TTL, cleared on callback whether it succeeds or fails. `SameSite=Lax` is correct and sufficient: the callback arrives as a top-level GET navigation, which Lax permits.

- **Loser — carrying the verifier inside the signed-JWT state.** Fatal, not merely inferior. The state JWT is **signed, not encrypted**, and travels through the platform in a URL. Its payload is base64-decodable by anyone who observes the redirect — browser history, referrer logs, a proxy. Publishing the verifier defeats the entire purpose of PKCE.
- **Loser — a `pkce_verifiers` table.** Functional, but it reintroduces precisely the table-plus-TTL-janitor that ADR 0002 Reversal 3 removed, and it would drag in the whole of build-guide L-11 (RLS, cascade row, `purge_business`).

**Because the verifier is a cookie, L-11 is not triggered by Q1.** No new business-scoped table, no cascade row, no `purge_business` entry.

### 2.4 The signed-JWT state rides along unchanged

`signOAuthState` / `verifyOAuthState` (`lib/social/oauth/state.ts`) are **reused verbatim** — HS256 via `jose`, `OAUTH_STATE_SECRET` (≥32 chars), 10-minute TTL. The claims are `businessId`, `platform`, `nonce`, `locale`, plus `iat`/`exp`.

> **Correction to ADR 0002 §7.** ADR 0002 lists four claims and does not include `locale`. The shipped implementation carries **five** (`state.ts:7-12`). ADR 0002 Amendment A records this.

The state remains the binding between callback and business: `callback/route.ts` verifies the signature, matches `claims.platform` against the route segment, validates `businessId` as a UUID, and then re-verifies ownership through an **anon, RLS-enforced** client (`:67-72`) before any service-role work begins. **That ownership check is what actually binds the callback to the right business, and it does not depend on the broker in any way** — it survives the removal untouched.

### 2.5 The redirect URI set, and D-β

**D-β must be fixed in this session.** Both sides derive `redirectUri` from one helper reading `config.server.APP_URL`. The connect route stops using `request.nextUrl.origin`, which is additionally attacker-influenceable via the `Host` header.

**Enumerated redirect URIs — exactly three per platform**, each registered with the platform:

| Environment | Redirect URI |
|---|---|
| Local | `http://localhost:3000/api/social/{platform}/callback` |
| Staging | `{fixed staging origin}/api/social/{platform}/callback` |
| Production | `{production origin}/api/social/{platform}/callback` |

**Per-preview-deployment OAuth cannot work, and the ADR states it plainly.** Both platforms require exact pre-registered redirect URIs; Vercel preview origins are generated per deployment and cannot be pre-registered. OAuth connect is testable on local, staging and production only. This is a property of the platforms, not a limitation the Builder can engineer away.

### 2.6 The signature question — `getOAuthAuthorizeUrl` becomes `Promise<string>`

**Decision: it becomes async.** X's PKCE verifier must be generated and its cookie set before the redirect is issued, which is I/O.

- **Loser — keeping it synchronous** and generating PKCE inside the shared route. Rejected: it moves platform-specific knowledge out of the provider and into the one file that must stay platform-agnostic, which is the exact leak ADR 0002 exists to prevent.

**Callers this touches: exactly one.** `connect/route.ts:56` **already `await`s the call**, and its test already mocks with `mockResolvedValue` (`connect.test.ts:78`). The change is source-compatible at every call site. This is the single signature change build-guide L-2 permits.

### 2.7 Code-exchange field lists (Zod schemas are the Builder's)

Request, both platforms: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`; plus `code_verifier` (X); client authentication per §13. Response fields to validate: `access_token`, `token_type`, `expires_in`, `refresh_token` (X only), `scope`.

Identity is a **second call** after exchange, because neither token response carries it. LinkedIn: the OIDC userinfo endpoint given the `openid profile` scopes, plus the organization-access lookup for page roles (§5.4). X: the authenticated-user lookup for id and username.

**Every platform response is Zod-validated before use.** A parse failure is `PLATFORM_REJECTED` with the Zod message in `details` — the pattern `postiz-provider.ts:236-245` already establishes, and a named Session 17 correction.

---

## 3. Q2 — The publish contract, per platform

### 3.1 LinkedIn — verified

`POST https://api.linkedin.com/rest/posts`, with **required** headers `Authorization: Bearer {token}`, `Linkedin-Version: {YYYYMM}`, `X-Restli-Protocol-Version: 2.0.0`, `Content-Type: application/json`.

> **ADR 0002 §10's illustrative sketch is stale and must not be copied.** It cites `/v2/ugcPosts` and `/v2/me`. The Posts API **replaces** ugcPosts. ADR 0002 Amendment A records this.

Body fields: `author` (URN, §5.1), `commentary` (the post text), `visibility: "PUBLIC"`, `distribution` (`feedDistribution: "MAIN_FEED"`, empty `targetEntities`, empty `thirdPartyDistributionChannels`), `lifecycleState: "PUBLISHED"`, `isReshareDisabledByAuthor: false`.

**The created post id arrives in the `x-restli-id` response header on a `201`, not in the body** — e.g. `urn:li:share:6844785523593134080`. A provider that parses the body finds nothing. This is the single most likely native-implementation mistake and carries its own Tier-2 assertion.

`PublishResult.url` is always constructible: `https://www.linkedin.com/feed/update/{urn}/`.

**`Linkedin-Version` expires.** Version `202508` sunset on 17 August 2026. The pinned version is a constant in `lib/social/constants.ts` with a stated review obligation (§16).

### 3.2 X

`POST` to the v2 tweet-creation endpoint with `text`. ⚠️ The exact path, the response id field and the permalink shape are unverified (§13). `PublishResult.url` is constructed from the authenticated username and the returned id where both are available, else `null` — the field is already nullable.

### 3.3 Content mapping

`PublishInput.content` plus `hashtags` compose one text body per platform; hashtags are appended in platform-idiomatic form. Character limits are enforced **inside the provider**, immediately before the request, and a violation is `PLATFORM_REJECTED` — the provider is the only layer that knows the platform's true limit, and enforcing earlier duplicates that knowledge where it will drift.

### 3.4 Media — deferred behind a hard guard (A-3)

Both platforms require a **two-call** publish for media: upload the asset, receive an asset URN (`urn:li:image:{id}` on LinkedIn, verified), then reference it in the post. This introduces a failure mode *between* the calls — an uploaded asset with no post — for which ADR 0005's one-attempt-per-post status machine has no state, and L-1 forbids changing that machine.

**Decision: a post arriving with non-empty `mediaUrls` fails `PLATFORM_REJECTED` before any network call.**

- **Loser — publishing text-only and dropping the media silently.** Rejected on product grounds, not engineering ones: it ships something other than what the user approved, and they discover it on their public feed. For a product whose central claim is human-in-the-loop, that is the worst available failure.

`mediaUrls` has no producer today (ADR 0002 §3 documents it "empty in Phase 1"), so the guard removes no capability. Filed as `30.5-MEDIA-UPLOAD` with its un-defer trigger.

### 3.5 Idempotency — unchanged (L-1)

Neither provider introduces a platform idempotency key. ADR 0005 §7's accepted cross-tick duplicate window stands **verbatim**, including its reasoning that a pre-publish existence check protects nothing in the failure mode that actually matters. Native idempotency keys remain an ADR 0005 open follow-up, untouched here.

---

## 4. Q3 — Token lifecycle, per platform

### 4.1 The prerequisite: `vault_update_secret` must exist (A-2, D-α)

ADR 0002 §8 specifies in-place Vault updates and explicitly forbids delete-then-create, to keep `social_accounts.vault_access_token_id` stable. **The RPC it names was never written.** A new migration adds `public.vault_update_secret`, `SECURITY DEFINER`, `EXECUTE` revoked from `PUBLIC` / `anon` / `authenticated` and granted to `service_role` only — matching the shape of `vault_create_secret` / `vault_delete_secret` in `20260516180000_vault_write_helpers.sql`.

**Every call site checks `error`.** D-α was survivable only because the result was discarded; the native providers must not repeat that. `SOCIAL-VAULT-UPDATE-CHECKED` is Tier 2 on the call sites; `SOCIAL-VAULT-UPDATE-SECRET` is Tier 1 on the function.

### 4.2 X — refresh with rotation

`supportsRefreshToken: true`, `offline.access` in scope. Access tokens live **two hours** (verified). On refresh, both the access token and the refresh token are updated **in place** in Vault, then `token_expires_at` is bumped — exactly as ADR 0002 §8 requires.

**`tokenExpiryDays: number | null` cannot express two hours.** `platforms/config.ts:23` currently sets X to `null`, which `withFreshToken` step 3 reads as "never expires" and which therefore **disables proactive refresh entirely** (`vault.ts:104-107`). The authoritative expiry is the token response's `expires_in`, from which `token_expires_at` is computed — as `postiz-provider.ts:365` already does. The config field is corrected to stop asserting a falsehood; it is an internal type inside `lib/social/`, so L-2 is unaffected.

**Rotation and the concurrent-refresh race (A-4).** ADR 0002 §8 accepts a race in which two callers both refresh, reasoning the loser wastes one retry. Under rotation that reasoning does not hold: both read refresh token R; the first consumes R for R′; the second presents a consumed R and is hard-rejected — and where a platform treats reuse as a theft signal, the whole chain can be invalidated and the account disconnected. **Same race, materially worse consequence.**

**Accepted for MVP** — scheduled, low-volume, single-business traffic makes genuine concurrency rare — and **filed** as `30.5-X-REFRESH-ROTATION`, with ADR 0002 §8's own remedy named (`pg_advisory_xact_lock` on `socialAccountId`) and an un-defer trigger. ⚠️ X's documentation does not state reuse behaviour (§13); the Builder confirms empirically and reports.

### 4.3 LinkedIn — the 60-day death

`supportsRefreshToken: false`, `tokenExpiryDays: 60`. At connect, `token_expires_at` is set from the token response.

`withFreshToken` reaches step 5 and calls `refreshAccessToken`, which **throws `TOKEN_REVOKED`, not `TOKEN_EXPIRED`.** This is deliberate and load-bearing: ADR 0005 §5 maps `TOKEN_EXPIRED` to an in-tick refresh-and-retry which for LinkedIn can never succeed, burning the tick's refresh budget and producing `reason: 'refresh_loop'`. `TOKEN_REVOKED` marks the post `failed` with the user-facing "Reconnect account" signal — which is the truth.

**Product visibility, inside the surface that already exists (L-6).** `getConnectionStatus` returns `expiring_soon` within 7 days of `token_expires_at` (`connection-status.ts:12,26-31`), already correct for a 60-day LinkedIn token. The accounts page states plainly that LinkedIn requires periodic reconnection. **No new email and no new notification channel.** A reconnection email is a real idea that touches ADR 0008; it is named in §15 with its trigger, not built.

### 4.4 Revocation, and what a failed revoke must not block

Each provider calls its platform's revocation endpoint (⚠️ §13). Revocation is **best-effort and never throws**: it returns early when there is no vault id, and swallows network failure — the shape `postiz-provider.ts:282-309` already implements.

CLAUDE.md's three-step disconnect (`is_active = false`, null the vault id columns, delete the vault secrets) is unchanged; platform revocation is a **fourth, non-blocking** step that the broker was performing invisibly.

**A failed revoke must never block local deactivation, and must never block `purge_business` (L-11).** Erasure is a legal obligation and a third party's availability cannot gate it. A failed revoke is captured to Sentry and execution continues. The residual — a token still live at the platform whose local record is gone — is stated here as an accepted, recorded consequence rather than left implicit.

### 4.5 `withFreshToken` is reused as-is

Its real signature takes an injected refresh callback (`vault.ts:85-89`), which is how each native provider supplies its own refresh without `lib/social/vault.ts` knowing anything about platforms. **This is why L-5 holds and the file does not move.**

### 4.6 The loser

**Per-provider token storage.** It multiplies the surface CLAUDE.md's Vault rule exists to keep at exactly one, and would put raw token material in two more places.

---

## 5. Q4 — Platform identity, dual identity, and the schema

### 5.1 The URN is the identity

`social_accounts.platform_user_id` is `text NOT NULL` (`20260430120006_social_accounts.sql:15`) and holds the **full platform URN**: `urn:li:person:{id}` or `urn:li:organization:{id}` for LinkedIn, the numeric user id for X. The URN is self-describing — its prefix distinguishes a person from an organization — so no separate discriminator column is required.

- **Loser — a dedicated `platform_account_type` column now.** Defensible, but it duplicates information the URN already carries, and a derived helper reads it without a migration.

### 5.2 No backfill is possible (D-γ)

Existing rows hold Postiz `integrationId` values (`postiz-provider.ts:370`), which mean nothing to LinkedIn or X. **There is no backfill.** Every existing connection must be re-authorised, and the ADR says so rather than implying a migration can rescue it. Rows for platforms with no provider are left untouched and inert.

### 5.3 The dual-identity model (A-6 — T1-E, promoted into this session)

CLAUDE.md sells "LinkedIn (Business and Founder)". A client connects **both** a personal founder profile and a business page. Three facts make this more than a scope change:

1. **`social_accounts` already supports it.** `UNIQUE (business_id, platform, platform_user_id)` (`:25`) admits a person row and an organization row side by side. **No change.**
2. **`posts` cannot express which identity a post targets.** It carries `business_id` + `platform` and no account reference; its own header comment reads *"one row per (campaign, platform)"*.
3. **The resolver breaks on two rows.** `getActiveByBusinessAndPlatform` uses `.maybeSingle()` (`lib/db/social-accounts.ts:137`) and throws (`:138`) when more than one active row matches.

**The model:**

- **`posts` gains `social_account_id`**, a nullable FK to `social_accounts(id)`, added additively. Nullable is deliberate: existing rows have no identity and must not be guessed at. `ON DELETE` is **`SET NULL`, not `CASCADE`** — disconnecting an account must never delete published history. The column joins ADR 0010 Amendment 2 §D2.5's cascade table in the same PR (L-11); `posts` already cascades from `businesses`.
- **Resolution order at publish:** `posts.social_account_id` when set; otherwise the business's **default account for that platform**; and when neither resolves to exactly one active row, the post fails `TOKEN_REVOKED` with `reason: 'account_ambiguous'` rather than publishing as an arbitrary identity. **Publishing as the wrong identity is worse than not publishing.**
- **`getActiveByBusinessAndPlatform` is replaced, not patched.** A by-id resolver serves the publish path; a list-returning resolver serves callers that legitimately want every identity.

**`SHARED-FUNCTION CALLERS` — three production callers, each re-verified and named in the Builder's report:**

| Caller | Today | After |
|---|---|---|
| `app/api/social/[platform]/disconnect/route.ts:41` | single active row | disconnects one named identity |
| `lib/metrics/orchestrator.ts:64` | single active row | resolves via the post's own account |
| `lib/publishing/orchestrator.ts:104` | single active row | resolution order above |

**No existing test covers the multi-row case** — all three suites mock a single account or `null` (`metrics/orchestrator.test.ts:119,194`; `publishing/orchestrator.test.ts:169,415`). Every one of the three is **`AUTHORED-NOT-EXECUTED` for two-identity behaviour** until this session closes it, *even though each is otherwise fully covered.*

- **Scopes — REVISED by A-8.** LinkedIn requests **`w_member_social` only**. `w_organization_social` is deferred with the Community Management API application, which needs a registered legal entity that does not yet exist. An app cannot request an ungranted scope, so adding it now would break the authorize URL rather than future-proof it.
- **Why the dual-identity model survives A-8 (A-8a).** Its original justification was LinkedIn's founder + business pair, which A-8 defers. It stands on **X** instead: CLAUDE.md's locked platforms include "X (Business and Founder)", and two X connections are just two OAuth flows against two accounts — no elevated tier, no approval. **A business can hold two active X rows today**, so `.maybeSingle()` throws for X exactly as it would have for LinkedIn. The schema and resolver work is immediately load-bearing, not speculative.

### 5.4 The organization access gate (A-5)

`w_organization_social` is granted only where the authenticated member holds an `ADMINISTRATOR`, `DIRECT_SPONSORED_CONTENT_POSTER` or `CONTENT_ADMIN` role on the page (verified), so connect must look up the member's organization access and present only pages they may actually post to.

**LinkedIn's Community Management API requires an application** — business email, legal name, registered address, website, privacy policy; a Development tier with call restrictions and a twelve-month completion window; a Standard tier requiring **a screencast demonstrating each declared use case**; and rejection means a new app and a new submission.

**This is a launch gate, not an engineering step**, and it belongs in `launch-checklist.md` the day it is known — which is today (§12). No code session can close it, and it is capable of becoming the long pole.

### 5.5 `OAuthAuthorizeInput.platform` and the `'multi'` member

- **`OAuthAuthorizeInput.platform` — KEEP.** Its comment attributes it to Postiz, but its real function is to let the **shared route** stay platform-agnostic while the provider knows what it is building for.
- **`SocialProvider.platform`'s `'multi'` member — REMOVE.** `postiz-provider.ts:58` is its only producer; it exists solely to describe a broker. Tier 3.
- **Loser — removing both** (breaks the generic route) or **keeping both** (`'multi'` describes something that no longer exists).

---

## 6. Q5 — Metrics, and what `null` honestly means

`PostMetrics` has seven nullable fields; `metrics/orchestrator.ts:82-93` writes provider output straight through, hourly (`0 * * * *`).

**The defect Q5 exists to catch.** ADR 0002 §3 defines `null` as "the platform does not expose this metric", but the worker writes `null` for both *"never available"* and *"not available yet"*. **Session 33 (Track J) builds pattern extraction on these rows**, and a permanently-null field entering a minimum-n floor is a measurable defect in that session, not this one.

**Decision: the ADR carries a per-platform × per-field capability table, and no schema changes.** Session 33 consults it to exclude permanently-unavailable fields from any floor. `NOT_IMPLEMENTED` continues to short-circuit an entire platform for the tick (`orchestrator.ts:95-97`), which is the honest fallback.

- **Loser — a `metric_availability` column or table now.** Correct long-term; wrong session. Session 33 is the consumer and should specify it.

⚠️ **The capability table itself is unverified** (§13) and is the largest single unverified surface in this ADR. Neither platform's metric coverage, nor which fields require an elevated access tier, has been confirmed. The Builder populates it from vendor documentation **before** implementing `fetchPostMetrics`; until it is populated, `fetchPostMetrics` throwing `NOT_IMPLEMENTED` is the correct and honest behaviour — exactly what `PostizProvider` did.

**Rate limits versus cadence:** hourly per published post within a retention window. ⚠️ Unverified against either platform's limits. If a platform's limit cannot sustain the cadence, the worker reduces frequency rather than dropping posts, and the ADR records the observed limit.

---

## 7. Q6 — Error and rate-limit mapping (L-7)

### 7.1 The union to map onto is `types.ts`, not ADR 0005 §5

`lib/social/types.ts:7-15` defines the eight codes, matching ADR 0002 §3 exactly.

> **ADR 0005 §5's matrix is wrong** (A-7). It asserts *"The eight codes are the ADR 0002 §3 taxonomy"*, then names two codes that do not exist (`BAD_REQUEST`, `NOT_CONFIGURED`) and omits two that do (`NOT_IMPLEMENTED`, `PROVIDER_NOT_CONFIGURED`). Both counts are eight, which is how it survived review. **The implementation is correct** — `publishing/orchestrator.ts:208-305` handles all eight real codes, with `NOT_IMPLEMENTED` and `PROVIDER_NOT_CONFIGURED` in the terminal group (`:301-305`). Only the prose is wrong, and by A-7 the Builder fixes it in this session (§12).

**No new `SocialProviderErrorCode` is required. L-7's founder adjudication is therefore not triggered.**

### 7.2 The mapping

| Platform | Status / condition | Code | ADR 0005 §5 consequence |
|---|---|---|---|
| both | transport failure, DNS, timeout | `NETWORK` | backoff + jitter, `publish_attempts += 1`, terminal at max |
| both | `429` | `RATE_LIMITED` | requeue at `now() + retryAfterSeconds`, **no** attempt consumed |
| LinkedIn | `401 EMPTY_ACCESS_TOKEN` ✅ | `TOKEN_EXPIRED` | in-tick refresh + one retry |
| LinkedIn | `403 ACCESS_DENIED` ✅ | `TOKEN_REVOKED` | terminal `failed`, "Reconnect account" |
| LinkedIn | `400` family: `INVALID_URN_TYPE`, `INVALID_URN_ID`, `MISSING_FIELD`, `INVALID_VALUE_FOR_FIELD`, `FIELD_LENGTH_TOO_LONG`, `INVALID_VALUE_BLANK_FIELD` ✅ | `PLATFORM_REJECTED` | terminal `failed`, "Edit and re-approve" |
| LinkedIn | `422 UNPROCESSABLE_ENTITY` ✅ | `PLATFORM_REJECTED` | terminal `failed` |
| LinkedIn | `409 CONFLICT` ✅ (documented "retry the request") | `NETWORK` | **retryable, deliberately** — see below |
| LinkedIn | `404 NOT_FOUND` ✅ | `PLATFORM_REJECTED` | terminal `failed` |
| LinkedIn | `500`, `503` ✅ | `NETWORK` | backoff + jitter |
| both | Zod parse failure on any response | `PLATFORM_REJECTED` | terminal, Zod message in `details` |
| X | `401` / `403` / `400` / `5xx` ⚠️ | as above by analogy | — |

**`409 → NETWORK` is the one mapping that deserves scrutiny**, and it is deliberate: the union offers no "retryable conflict", and mapping a documented-retryable condition to a terminal code would fail posts that would otherwise have succeeded. It is recorded here so a reviewer sees a decision rather than an accident.

**Rate limits.** LinkedIn `429` is `TOO_MANY_REQUESTS`; ⚠️ its `Retry-After` behaviour is unverified. ⚠️ X signals limits through `x-rate-limit-*`-style headers rather than `Retry-After`, which changes how `retryAfterSeconds` is derived. Where no value can be read, the provider falls back to **60 seconds** behind a `Number.isFinite` guard, exactly as `postiz-provider.ts:321-331` does. `retryAfterSeconds` is populated **only** when the code is `RATE_LIMITED` (ADR 0002 §3).

---

## 8. Q7 — The removal as an ordered, provable operation

### 8.1 Order

**Native providers are registered before Postiz is deleted**, in one PR, `master` green at every commit.

- **Loser — delete-first.** `registry.ts:6,38` imports and constructs `PostizProvider`; deleting it first fails `tsc` and, in the window before providers land, leaves production with no default so every consumer throws.

### 8.2 The registry becomes overrides-only

`DefaultProviderRegistry` currently **requires** a default (`registry.ts:11`) and falls back to it (`:14`). After removal there is no default in production: LinkedIn and X are registered through the `overrides` map that has existed and gone unused since day one (`register()` is called only in `registry.test.ts:88`), and `get()` throws `PROVIDER_NOT_CONFIGURED` for anything unregistered.

**This is not a widening.** ADR 0002 §4 already specifies exactly this behaviour: *"Throws PROVIDER_NOT_CONFIGURED if no provider is registered and no default is set."*

`SOCIAL_PROVIDER_MODE=mock` is unchanged and keeps `MockProvider` as the default for **all five** platforms, which is how the entire app-test suite avoids the network (L-9).

**Absence behaviour is per-platform, not app-wide.** If LinkedIn is configured and X is not, LinkedIn works and `get('twitter')` throws. One missing secret must not dark the whole product.

**Meta family (A-1):** Instagram, Facebook and Threads keep their `Platform` enum members and `publishingAvailable: false`. No provider is registered; connect is gated on `publishingAvailable`; they render `coming_soon`. `connection-status.ts` already models this with `coming_soon` / `connected_coming_soon`.

### 8.3 The rest of the delta

| Item | Change | Evidence |
|---|---|---|
| ESLint | **Replace** `@/lib/social/postiz-provider` in `SOCIAL_INTERNALS_BAN` with the two new provider modules, in the same change | `eslint.config.mjs:15` |
| CSP | `buildCsp` loses `postizHost` and its `connect-src` origin — native calls are server-side only, so this is a net security improvement | `lib/observability/csp.ts:5,7` |
| Config | Remove `POSTIZ_BASE_URL` / `POSTIZ_API_KEY` at three sites each; **add nothing** (§2.1) | `lib/config.ts:17-18, 273-274, 384-388` |
| Health | Stop computing `'postiz'`; report the provider per platform | `app/api/_health/social/route.ts:35-40` |
| i18n | Rename `postiz_unavailable` across en/pt/es simultaneously — the **key** leaks the broker; the message does not | `i18n/{en,pt,es}/common.json:161` |
| Tests | Delete `__tests__/postiz-provider.test.ts` and `__integration__/postiz-provider.integration.test.ts` | §9.3 |

> **`launch-checklist.md` §16 row 4 is wrong** and is corrected in this session. It says the ESLint rule is "moot once the file is gone"; L-3 and Reality §7 require the entry to be **replaced**, or the removal silently opens a boundary CLAUDE.md calls non-negotiable. **§16 also contains seven rows, not the eight the build guide asserts.**

### 8.4 `SOCIAL-NO-POSTIZ`

A Tier-2 test greps the repository case-insensitively for `postiz`, exempting exactly `docs/decisions/` (historical ADRs), `docs/reviews/` (immutable review history), and **the scan file itself**. This is launch-checklist §16's last row made executable. It must be demonstrated to redden.

---

## 9. Q8 — Test plan across the tiers, plus the UX contract

### 9.1 The shared contract suite (L-8)

`lib/social/__tests__/provider-contract.test.ts`, parameterised over **`MockProvider`, `LinkedInProvider` and `TwitterProvider`**. Asserted for every implementation: all seven methods present; `platform` is a real `Platform` and never `'multi'`; every thrown error is a `SocialProviderError` whose `code` is in the union; `revokeAccessToken` never throws; `fetchPostMetrics` returns `PostMetrics | null` or throws `NOT_IMPLEMENTED`; `getOAuthAuthorizeUrl` resolves to an absolute URL carrying the state.

With the broker gone there is no longer a single implementation keeping everyone honest — **that is why the suite is the deliverable and not an optimisation.**

### 9.2 Tiers

**Tier 1** — `vault_update_secret` (existence, `service_role`-only `EXECUTE`, in-place semantics); `posts.social_account_id` (FK, `ON DELETE SET NULL`, RLS unchanged and still tenant-scoped, cascade-table row, `purge_business` coverage).

**Tier 2** — the contract suite; each provider's fixture-based publish / exchange / refresh / revoke; PKCE generation, cookie attributes and lifetime; state round-trip; **redirect-URI equality between connect and callback** (D-β); the error-mapping table; registry per-platform routing and per-platform absence; the media guard; the dual-identity resolver across all three callers including the ambiguity case; the CSP delta; health output; `SOCIAL-NO-POSTIZ`.

**Tier 3** — `postiz-provider.ts` and its two test files absent; no `POSTIZ_*` in `lib/config.ts`; the `'multi'` member absent from the union; ADR 0005 §5 amended.

### 9.3 What is honestly untestable, in L-9's exact terms

Native providers are tested against **recorded fixtures**; no Tier-2 test touches the network. Any real-network suite lives in `lib/social/__integration__/`, and **that directory is discovered by no CI job** — `vitest.config` `exclude` contains `'**/__integration__/**'` (`:40`), recorded as backlog item `22E-integration-discovery`. Anything written there is **`AUTHORED-NOT-EXECUTED` until that item is closed**, and this ADR claims no coverage from it.

**A fixture cannot prove a real platform's rejection behaviour**, and the contract suite catches shape divergence, not semantic divergence. What compensates is narrow and is stated rather than dressed up: **one manual live connect-and-publish per platform, per identity type, recorded in §14 with its date and operator.** That is the whole compensating control. It is weaker than a test and is not called a test.

### 9.4 The UX contract the Builder is held to

**Specified here, designed by the Builder** using `/impeccable` or `/taste-skill` against this contract — never by the Architect.

- **All five `ConnectionStatus` states** (`connection-status.ts:5`): `connected`, `connected_coming_soon`, `expiring_soon`, `disconnected`, `coming_soon`. *(The build guide's Q8 says four; there are five.)*
- **Dual identity:** the accounts surface lists LinkedIn identities separately (founder profile, business page), each with its own status and disconnect control, and marks which is the default used when a post names no account. Connecting a second LinkedIn identity must be an obvious action, not a re-connect that appears to replace the first.
- **LinkedIn reconnection:** `expiring_soon` states plainly that LinkedIn access expires and must be renewed, with the date. No new channel (L-6).
- **Per-platform availability copy** for the three `coming_soon` platforms, truthful about the reason.
- **Seven OAuth error-redirect codes**, all landing on `/{locale}/settings/accounts`, each with a distinct localised message: `invalid_state`, `forbidden`, `oauth_denied`, `exchange_failed`, `vault_write_failed`, `db_write_failed` (`callback/route.ts`), `connect_failed` (`connect/route.ts:69`).
- **Server Component page + Client Component interactivity**; **Zod on every Server Action**; **shadcn v4 / Base UI — no `asChild` on `Button` or DropdownMenu primitives**; **Tailwind only**; **i18n en/pt/es simultaneously**; WCAG 2.2 AA floor with keyboard-reachable disconnect behind a confirmation step.

---

## 10. The constraint map (the Reviewer's checklist)

| Constraint | Tier | The test that proves it |
|---|---|---|
| `SOCIAL-CONTRACT-ALL-PROVIDERS` | 2 | `provider-contract.test.ts` parameterised over Mock + LinkedIn + X |
| `SOCIAL-NO-POSTIZ` | 2 | Repo scan, exemptions enumerated, demonstrated to redden |
| `SOCIAL-INTERNALS-BAN-REPLACED` | 3 | New provider modules present in `SOCIAL_INTERNALS_BAN`; Postiz entry absent |
| `SOCIAL-NO-MULTI-PLATFORM` | 3 | The `'multi'` member absent from `SocialProvider.platform` |
| `SOCIAL-AUTHORIZE-ASYNC` | 2 | `getOAuthAuthorizeUrl` returns a promise for every implementation |
| `SOCIAL-PKCE-COOKIE` | 2 | Verifier cookie is `httpOnly` + `Secure` + `SameSite=Lax`, 600s, cleared on both callback paths |
| `SOCIAL-PKCE-NOT-IN-STATE` | 3 | No verifier field in the state JWT claims |
| `SOCIAL-REDIRECT-URI-MATCH` | 2 | Connect and callback derive an identical `redirectUri` from one config source (D-β) |
| `SOCIAL-STATE-BINDS-BUSINESS` | 2 | Ownership re-verified through the RLS-enforced client before any service-role write |
| `SOCIAL-NO-SECRET-EGRESS` | 2 + 3 | Client secrets absent from every bundle, log and `details` payload |
| `SOCIAL-VAULT-UPDATE-SECRET` | **1** | Live-Postgres: function exists, updates in place, `service_role`-only `EXECUTE` |
| `SOCIAL-VAULT-UPDATE-CHECKED` | 2 | Every `vault_update_secret` call site asserts on `error` (D-α) |
| `SOCIAL-LI-EXPIRY-REVOKED` | 2 | LinkedIn refresh throws `TOKEN_REVOKED`, never `TOKEN_EXPIRED` |
| `SOCIAL-X-EXPIRY-FROM-RESPONSE` | 2 | `token_expires_at` derived from `expires_in`, not from `tokenExpiryDays` |
| `SOCIAL-REVOKE-NEVER-BLOCKS` | 1 + 2 | A failed revoke blocks neither disconnect nor `purge_business` |
| `SOCIAL-DUAL-IDENTITY-SCHEMA` | **1** | `posts.social_account_id` FK, `ON DELETE SET NULL`, RLS, cascade-table row |
| `SOCIAL-DUAL-IDENTITY-RESOLVER` | 2 | Resolution order + `account_ambiguous`; **all three callers**, multi-row case each |
| `SOCIAL-LI-AUTHOR-URN` | 2 | Person and organization URNs both accepted as `author` |
| `SOCIAL-LI-POSTID-FROM-HEADER` | 2 | `platformPostId` read from `x-restli-id`, not the body |
| `SOCIAL-MEDIA-GUARD` | 2 | Non-empty `mediaUrls` → `PLATFORM_REJECTED` before any network call |
| `SOCIAL-ERROR-MAPPING` | 2 | Table-driven, one case per row of §7.2 |
| `SOCIAL-RATE-LIMIT-RETRY-AFTER` | 2 | `retryAfterSeconds` parsed with a finite guard and 60s fallback; set only on `RATE_LIMITED` |
| `SOCIAL-REGISTRY-PER-PLATFORM` | 2 | Overrides routing; unregistered platform throws; per-platform absence |
| `SOCIAL-META-NOT-REGISTERED` | 2 | Meta platforms have no provider; connect gated; `coming_soon` (A-1) |
| `SOCIAL-MOCK-MODE-OFFLINE` | 2 | `SOCIAL_PROVIDER_MODE=mock` serves all five; no network in Tier 2 |
| `SOCIAL-CSP-NO-POSTIZ-HOST` | 2 | `buildCsp` has no `postizHost`; `connect-src` otherwise unchanged |
| `SOCIAL-HEALTH-PER-PLATFORM` | 2 | Health route names no broker |
| `SOCIAL-I18N-NO-BROKER-KEY` | 2 + 3 | `postiz_unavailable` absent; replacement present in all three locales |
| `SOCIAL-ERR-MATRIX-TRUE` | 3 | ADR 0005 §5 amended to the real union (A-7) |
| `SOCIAL-INTEGRATION-NOT-EXECUTED` | 3 | ADR states `__integration__` is `AUTHORED-NOT-EXECUTED` (L-9) |

---

## 11. Founder adjudications — RECEIVED (§0.2, 2026-09-03)

`docs/build-guide/session-30-5.md` §0.2 records **A-1 … A-7** in full, with the Architect's superseded recommendation preserved verbatim wherever a ruling went against it (A-6, A-7).

**Two build-guide Locked decisions are overridden and must be read as amended:** **L-1**'s out-of-scope list no longer excludes T1-E (A-6) or ADR 0005 (A-7 — **documentation only**; L-1's bar on changing ADR 0005's status machine, retry policy and idempotency model stands in full).

---

## 12. Amendments to landed ADRs, and checklist changes

| Document | Change | Why |
|---|---|---|
| **ADR 0002** | **Amendment A** (this session) — appended to that file | The interface, OAuth and token contracts change shape |
| **ADR 0005 §5** | Appended amendment correcting the error matrix to the real union (A-7) | It names two nonexistent codes and omits two real ones |
| **ADR 0010 Amendment 2 §D2.5** | Cascade-table row for `posts.social_account_id` | L-11 — a business-scoped reference omitted from the cascade table is a silent erasure leak |
| **`launch-checklist.md` §16** | Row 4 corrected (replace, not remove); row count corrected to seven | §8.3 |
| **`launch-checklist.md` §1** | Drop the two `POSTIZ_*` rows; correct `SOCIAL_PROVIDER_MODE`'s description; add the four native credential rows | §2.1 |
| **`launch-checklist.md` §16a (new)** | **LinkedIn Community Management API access — a launch gate** (A-5) | External review, unknown calendar time, capable of becoming the long pole |
| **`docs/product-status.md:95`** | Stop saying publishing runs through Postiz | It will be false |
| **CLAUDE.md** | Tech-stack line "Social publishing: Native platform" becomes true | It currently describes an unbuilt state |

**Session 32 inherits** a native read path: `fetchRecentPosts` / 19D-5 is designed against `LinkedInProvider` and `TwitterProvider`, not a broker, and lands as **ADR 0002 Amendment B**. Session 32's Reality 3, Q2 and D-2 are written against a Postiz that will not exist and must be re-read before that session runs. **This ADR does not design the read path.**

---

## 13. Verified vs unverified platform facts

**Verified against vendor documentation on 2026-09-03** — LinkedIn: the Posts endpoint, both required headers, the author URN forms, `w_organization_social` / `w_member_social` and the page roles they require, the `201` + `x-restli-id` response contract, the permalink shape, the documented error table in §7.2, the two-call media requirement, API-version sunsetting, and the Community Management API access process. X: PKCE mandatory with `S256`, both endpoint URLs, the two-hour access-token life, and the `tweet.write` / `offline.access` scopes.

**⚠️ NOT verified — the Builder must confirm each before implementing it, and report what it found:**

1. LinkedIn's authorize and token endpoint URLs (ADR 0002 §10's are stale and were not re-verified).
2. Whether LinkedIn requires or supports PKCE.
3. Both platforms' **token revocation** endpoints.
4. Client authentication at each token endpoint (HTTP Basic vs body parameters).
5. **X's refresh-token rotation semantics** — whether the previous refresh token is invalidated, and the penalty for presenting a consumed one. Undocumented; determines whether A-4's acceptance holds.
6. X's tweet-creation path, response id field, permalink shape and character limit.
7. X's rate-limit headers and how `retryAfterSeconds` is derived from them.
7a. **Which X billing model applies to a newly created account** — pay-per-usage credits, or a Basic/Pro subscription (§14.2). This changes both the cost model and the daily post ceiling.
8. **The entire §6 metrics capability table**, per platform and per field — the largest unverified surface here.
9. The pinned `Linkedin-Version` value at implementation time.

**No unverified endpoint may be written from memory.** Where verification fails, the honest outcome is `NOT_IMPLEMENTED` and a stated gap — never a plausible-looking URL.

---

### 13.1 Builder verification (N2.1, 2026-09-04)

**Full findings: `docs/reviews/session-30-5-platform-verification.md`.** Summary, per item, against vendor documentation only (Microsoft Learn's LinkedIn API docs and `docs.x.com`):

1. **LinkedIn authorize/token URLs — CONFIRMED.** `GET https://www.linkedin.com/oauth/v2/authorization`, `POST https://www.linkedin.com/oauth/v2/accessToken` (form-urlencoded). 60-day access-token life independently reconfirmed.
2. **LinkedIn PKCE — CONFIRMED not required/not available for SOSH's flow.** The standard confidential-client (web) flow has no PKCE; PKCE exists only on a separate native/loopback-client flow requiring manual LinkedIn enablement. §3.1 unaffected — the STOP-AND-REPORT condition on differing Posts API contract was checked directly and **not triggered** (headers, 201+`x-restli-id`, author URN forms, and permalink shape all confirmed exactly as §3.1 states).
3. **Revocation endpoints — X CONFIRMED** (`POST oauth2/invalidate_token`); **LinkedIn STILL-UNKNOWN**, and functionally appears not to exist for third-party apps at all — revocation is member-initiated via LinkedIn account settings, not a developer-callable endpoint. Fallback: `revokeAccessToken` for LinkedIn returns early with no network call, same as X's best-effort-never-throws shape but with nothing to call.
4. **Client authentication — CONFIRMED, and the platforms differ.** LinkedIn: `client_id`/`client_secret` in the POST body. X: HTTP Basic (base64 `client_id:client_secret`) for confidential clients, which SOSH is.
5. **X refresh-token rotation — STILL-UNKNOWN.** Official docs describe how to use a refresh token but not rotation/invalidation behaviour. Community sources describe "rotating, single-use" tokens but this is not authoritative. Confirmable empirically once credentials exist (Stage 1): two sequential refresh attempts against the same original token. A-4/`30.5-X-REFRESH-ROTATION`'s accepted-for-MVP decision is unchanged either way.
6. **X tweet creation — CONFIRMED** (`POST https://api.x.com/2/tweets`, id at `data.id`, 280-char limit). **Permalink shape STILL-UNKNOWN as a documented response field** — `https://x.com/{username}/status/{id}` is confirmed only as external convention, not part of the `/2/tweets` schema itself. No change to §3.2, which already treats the URL as constructed/nullable.
7. **X rate-limit headers — CONFIRMED.** `x-rate-limit-limit`/`-remaining`/`-reset` (Unix epoch seconds); no `Retry-After`. `retryAfterSeconds = max(reset - now, 0)`.
7a. **X billing for a new Sept-2026 account — CONFIRMED: pay-per-usage credits only.** Legacy Basic/Pro subscriptions are closed to new signups; existing Basic subscribers were being migrated onto pay-per-use as of mid-2026. This resolves §14.2's residual uncertainty. Per-request pricing corroborates §14.3's figures. One source cites a 2M-post-read/month pay-per-use cap versus §14.3's stated 3M — unresolved minor discrepancy, re-check against the live billing console once an account exists. Reported per this item's instruction; the founder adjudication in §14.3 is unchanged.
8. **§6 metrics capability table — CONFIRMED for both platforms**, full table in the verification log. **Drift finding:** LinkedIn's richer metrics (`saves`, `clicks`, `reach`, `impressions`) all require the scope `r_member_postAnalytics`, which is **not** in `platforms/config.ts:14`'s current LinkedIn scope list — as designed today those four fields are permanently null for LinkedIn, not because the platform withholds them but because SOSH hasn't requested the scope, and adding it later forces re-authorisation of every connected account (§14.1's own reasoning). This is an open decision for N2.7's author or the Architect, not resolved here. X: all seven fields resolvable except `reach`, which is **permanently unavailable** on X (no such field exists in the API) — Session 33 must exclude it from any minimum-n floor, per §6's own instruction for permanently-null fields.
9. **`Linkedin-Version` to pin — CONFIRMED as of 2026-09-04: `202608`.** `202508`'s sunset date (2026-08-17) has passed, confirming this ADR's note. This value drifts monthly; N2.7 should re-verify at build time rather than copy this document's value if implementation lands later.

**Net: 7 of 9 items confirmed, 2 still-unknown** (item 5 fully; item 6's permalink field as a documented API guarantee). No unverified endpoint was written from memory in this step, and none is written in N2.1 — this step produced no production code.

### 13.2 Session 30.5-D correction (D1, 2026-09-05) — a citation is a promise the cited record contains the claim

The N3 Reviewer's BLOCKER-1 found that `twitter-provider.ts` and `linkedin-provider.ts` shipped
`X_AUTHORIZE_URL`, `X_TOKEN_URL` and `LINKEDIN_POSTS_URL` citing §13.1 items 1/3/4/6/7 and 1/9 — none of
which record those three URLs (item 1 is LinkedIn's own authorize/token pair; item 4 records only X's
token-endpoint *auth method*; items 1/9's cross-check of the Posts API never writes the base URL down).
All three, plus the two userinfo endpoints MINOR-1 found sourced only in a code comment, are now
independently verified and recorded in `docs/reviews/session-30-5-platform-verification.md` Appendix A
(read 2026-09-05), with both provider files' comments corrected to cite the appendix item that actually
contains each value.

**The process lesson, in this ADR's own voice:** a platform fact is sourced in exactly one place, and a
citation is a promise that the cited place contains it. A citation that points at a record which does not
contain the claim is worse than no citation at all — it converts "unverified" into "someone already
checked" for every future reader, which is precisely how an unsourced fact survives a review meant to
catch it.

---

## 14. Manual verification log (the compensating control for §9.3)

The Builder records one live connect-and-publish per platform per identity type. Empty until then; **an empty table is the honest state, not a formality to backfill.**

| Date | Platform | Identity | Operator | Result |
|---|---|---|---|---|
| — | — | — | — | — |

### 14.1 Credentials arrive late, and verification is therefore STAGED (A-5-prime)

SOSH has no registered legal entity yet, so the Community Management API application — which requires a
legal name, a registered address and a privacy policy — cannot be submitted. **The Builder proceeds
without credentials.** Nothing in §9.2's Tier-1 or Tier-2 plan needs them: all six credentials are
`z.string().default('')`, §8.2's absence behaviour is **per-platform** rather than app-wide, and every
Tier-2 test runs offline under `SOCIAL_PROVIDER_MODE=mock`. Native providers can be written, tested and
merged with no platform account in existence.

**But the LinkedIn gate splits in two, and only one half is blocked.** Verified 2026-09-03:

| Capability | Prerequisite | Blocked by the missing entity? |
|---|---|---|
| App creation + `w_member_social` (founder profile) | an associated **LinkedIn Page**, creatable without a registered entity; **"Share on LinkedIn" / "Sign In with LinkedIn" are auto-enabled on app creation, with no review** | **No** |
| `w_organization_social` (business page) | Community Management API: company-page **verification**, legal name, registered address, privacy policy, a screencast per use case | **Yes** |

> **SUPERSEDED IN PART by A-8 (2026-09-03).** The founder clarified that the blocker is **a registered
> legal entity with a company number**, not the LinkedIn Page, and ruled: **defer LinkedIn organization
> posting.** LinkedIn ships **member-only**. Stage 2 below is therefore **not a pre-launch stage** and has
> no date. Stages 0 and 1 stand exactly as written. **The "get the scopes right now to avoid
> re-authorisation" argument below is WITHDRAWN as inapplicable** — an app cannot request a scope it has
> not been granted, so `w_organization_social` would fail in the authorize URL until the Community
> Management API is approved; re-authorisation when that access lands is unavoidable and cannot be
> pre-empted by scoping early. The rest of the Stage-1 argument (that §14 is the sole compensating control
> for zero real-network CI coverage) is unaffected and still holds.

**The three stages, in order:**

1. **Stage 0 — now, no credentials.** Everything in §9.2. This is the whole Builder session.
2. **Stage 1 — as soon as a LinkedIn Page and app exist (no entity required).** The founder-profile row of
   §14 is filled: a real connect, a real publish, a real revoke. **This is the stage that de-risks the
   session**, and it costs about an hour.
3. **Stage 2 — once the entity is registered.** The Community Management API application, then the
   organization row of §14.

**Why Stage 1 should not wait for Stage 2.** §9.3 states that no CI job runs any real-network test, which
makes this table the *sole* compensating control. Merging with it entirely empty means the native providers
have never touched the real API. That is worse here than it would normally be, because **OAuth scopes are
baked into a token at authorisation**: a scope discovered to be wrong *after* users have connected forces
every one of them to re-authorise. Stage 1 converts "nothing verified" into "one half verified" for an
hour's work, and it is the cheapest insurance available against the one class of error that is expensive
to correct later.

**What ships if Stage 2 never completes before launch:** LinkedIn works for founder profiles and does not
work for business pages. The scopes, the URN plumbing, the dual-identity schema and the resolver are all
built and tested either way — only the *grant* is missing — so nothing has to be rebuilt when access
arrives. That is the point of doing the scope correction now (§5.3) rather than later.

### 14.2 X's prerequisites — rechecked 2026-09-03

**X is NOT blocked by the missing legal entity.** Its pricing documentation states **no business-entity,
company-detail or review requirement**. It has moved to **pay-per-usage with prepaid credits** — credits
are bought in the Developer Console and deducted per request — and the pricing page documents **no free
tier**. For Stage 1 this makes X *easier* than LinkedIn: a developer account plus a few dollars of credit
buys a live connect-and-publish immediately, with no application and no waiting.

⚠️ **Residual uncertainty, deliberately not resolved by guessing.** Community announcements still describe
**Basic (~$200/month, ~100 posts/day)** and **Pro (~$5,000/month)** alongside pay-per-use, and legacy Free
users being migrated onto credits. The pricing page itself documents only pay-per-use. **Which model
applies to a newly created account in September 2026 is unconfirmed** and is a minutes-long check in the
Developer Console once one exists.

### 14.3 A cost finding that is a PRICING decision, not an engineering one — FOUNDER ADJUDICATION REQUIRED

Verified per-request write costs: **$0.015 to create a post, and $0.200 to create a post containing a
URL** — a **13× multiplier for links**. For a B2B SaaS product whose core use case is driving traffic to a
product page, a blog or a launch announcement, linked posts are the norm rather than the exception.

Against CLAUDE.md's locked pricing (€79 Plus, €125 Pro with **"unlimited posts"**):

| Volume of linked posts | X cost / month | Share of the €125 Pro plan |
|---|---|---|
| 2/day (60/mo) | $12 | ~10% |
| 5/day (150/mo) | $30 | ~24% |
| 10/day (300/mo) | **$60** | **~48%, on one platform, before AI costs** |

**"Unlimited posts" against uncapped per-post billing is an unbounded liability on a fixed-price plan**,
and the exposure is entirely X-shaped — LinkedIn's publishing API carries no per-post fee.

**This ADR does not decide it.** Pricing is a locked strategic decision in CLAUDE.md and unit economics is
a founder call. It is recorded here because it is cheaper to decide before launch than to discover after,
and because it was found while verifying an endpoint — nothing else in the pre-launch plan would have
surfaced it. The obvious levers are a fair-use ceiling scoped to X, pricing linked posts into the plan, or
treating link-bearing posts differently at generation time; each has product consequences outside this
session's scope.

**Also bounding later sessions:** pay-per-usage is capped at **3 million post reads per monthly billing
cycle**, which constrains Session 32's read path and the metrics worker's cadence (§6).

---

## 15. Explicitly deferred (each a decision, per ADR 0015 §2 Tier-3 discipline)

| Item | Trigger to un-defer |
|---|---|
| Native media upload | `30.5-MEDIA-UPLOAD` — the media session, or the first producer populating `mediaUrls` |
| Advisory lock for concurrent refresh | `30.5-X-REFRESH-ROTATION` — first rotation-related disconnect |
| LinkedIn reconnection email (ADR 0008) | First support contact caused by a silently expired LinkedIn token |
| `metric_availability` as data | Session 33, when a minimum-n floor first consumes these rows |
| Meta-family native providers | Meta App Review, an external process (A-1) |
| Real-network provider tests | `22E-integration-discovery` |
| Vault orphan janitor | Inherited unchanged from ADR 0002 §7 Step 5(e) |

---

## 16. Stated-open items

1. **A-8: LinkedIn ships MEMBER-ONLY, and this contradicts a locked strategic decision.** CLAUDE.md's locked launch platforms read **"LinkedIn (Business and Founder)"**. With organization posting deferred behind a legal entity that does not yet exist, **launch delivers the Founder half only.** That is a change to a locked decision and needs an explicit founder ruling on one of: launch with LinkedIn Founder-only and say so in customer-facing copy; hold launch for the entity and the Community Management API approval; or amend the locked platform list. **`docs/pre-launch-scope.md` and `docs/product-status.md` must not claim business-page posting until it exists.** *(Superseded context: A-5-prime: the access request is not an engineering task, cannot be started yet, and can fail.)* It is blocked on SOSH having a registered legal entity (§14.1), and once submitted it can still be refused. If Community Management API access is refused or delayed, **LinkedIn ships member-only** and the business-page half of "LinkedIn (Business and Founder)" does not exist at launch. That is a product decision, not a Builder decision — and because it is external and unbounded in time, **it should be treated as the most likely long pole in the whole pre-launch plan.**
2. **`Linkedin-Version` requires periodic review.** Versions sunset; `202508` already has. No mechanism currently reminds anyone.
3. **Organic carousel posts are not supported by LinkedIn** — carousels are sponsored-only. CLAUDE.md treats template-rendered carousels as in-scope pre-launch and ADR 0022 shipped a carousel format family. **Outside this session's scope**, flagged because it was found during verification and would otherwise surface as a publish failure.
4. **Existing connections cannot be migrated** (D-γ). Every connected account must be re-authorised. Whoever owns launch communications needs to know.
5. **A failed platform revocation leaves a live token at the platform** whose local record is gone (§4.4). Accepted and recorded.
6. **X's per-post cost versus "unlimited posts" on the Pro plan is an open pricing question** (§14.3), and a founder adjudication. $0.200 per linked post against a €125 plan with no stated ceiling is an unbounded liability; at 10 linked posts/day it consumes roughly half the plan price on one platform alone.
8. **Re-authorisation is unavoidable when organization access eventually lands** (A-8). Every LinkedIn user connected under member-only scopes must re-authorise to grant `w_organization_social`. This cannot be engineered away and should be planned as a customer-communication task, not discovered as a support surprise.
7. **§14 may be empty at merge, and that is a stated risk rather than an oversight** (§14.1). A launch-checklist row must require **at least the founder-profile row of §14 filled before launch**; shipping publishing that has never once succeeded against the real API is not a defensible launch state, regardless of how green CI is.
9. **LinkedIn's OIDC `sub` claim may not match the `urn:li:person:{id}` identifier space used elsewhere in this API** (Session 30.5-D, D1). The discovery document (`https://www.linkedin.com/oauth/.well-known/openid-configuration`) declares `subject_types_supported: ["pairwise"]` — confirmed verbatim, `docs/reviews/session-30-5-platform-verification.md` Appendix A item 13 — meaning `sub` can be a per-client-scoped identifier rather than a stable, portable member id. Author-URN construction elsewhere in this ADR assumes `urn:li:person:{id}` addresses the member; if the userinfo `sub` is pairwise, that construction may be silently wrong. Needs an empirical check once real LinkedIn credentials exist (§14.1): confirm the `sub` returned actually addresses the member the Posts API's author URN expects.
10. **`X_REVOKE_URL` (`https://api.x.com/2/oauth2/revoke`) remains an unconfirmed best guess, not a documented endpoint** (Session 30.5-D, D1, restating MINOR-2's correct disclosure as a durable row). §13 item 3 confirms only that a revocation endpoint is *referenced* from X's OAuth 2.0 overview page, in an OAuth 1.0a shape that doesn't fit SOSH's flow. Revocation stays best-effort and never throws regardless (`SOCIAL-REVOKE-NEVER-BLOCKS`). Session 30.5-D's D3 makes this the first production call site for the value — confirm it empirically against a real X account (§14.1) before relying on it working.

---

## 17. Closure (N2.13, 2026-09-05) — the verification pass, four new tripwires, and §16's status

**Nothing above this section is edited.** This closes out Track N per the build guide's N2.13 step. Read at
the commit this section is dated to, not at a later HEAD.

### 17.1 Four new scope tripwires (N2.12/N2.13's own coverage does not appear in §10, added here)

| Constraint | Test | Demonstrated to redden |
|---|---|---|
| `SOCIAL-WORKER-UNCHANGED` | `lib/publishing/__tests__/worker-unchanged.test.ts` — the retry/status/idempotency machinery in `orchestrator.ts` (the exact 8-case error switch, the exponential backoff formula, the four state-transition primitives, the guard-rejected self-healing log line) is unchanged; `resolvePublishAccount` is the one stated exception | Yes — temporarily linearised the backoff formula, confirmed the exact assertion failed, reverted |
| `SOCIAL-PROVIDER-BOUNDARY` | `lib/social/__tests__/eslint-internals-ban.test.ts`'s new "all eight fire together" test — the two pre-existing tests covered only 2 of 8 `SOCIAL_INTERNALS_BAN` entries | Yes — removed one banned import from the fixture, confirmed the violation count dropped from 8 to 7, reverted |
| `SOCIAL-META-STILL-UNAVAILABLE` | `lib/social/platforms/config.test.ts` (new file) — Instagram/Facebook/Threads stay `publishingAvailable: false`; LinkedIn/X stay `true`; exactly five platforms covered | Yes — flipped Instagram's flag to `true`, confirmed two dependent assertions failed, reverted |
| `SOCIAL-NO-READ-PATH` | `lib/social/__tests__/no-read-path.test.ts` (new file) — no production file under `lib/social/` defines `fetchRecentPosts`/`listRecentPosts` | Yes — added a stub `fetchRecentPosts` method to `SocialProvider`, confirmed the scan named `lib/social/types.ts`, reverted |

None of the four eslint.config.mjs-adjacent scans required editing that file directly (blocked by a
config-protection hook, confirmed in the N2.12 session) — `SOCIAL-PROVIDER-BOUNDARY`'s redden was
demonstrated by mutating the test's own fixture instead, which is equivalent from the assertion's
perspective (an import that produces no violation is indistinguishable whether the cause is a missing
fixture line or a dropped config entry).

### 17.2 `SOCIAL-INTEGRATION-NOT-EXECUTED` — confirmed, not just asserted

`lib/social/__integration__/` **does not exist in the repository.** Repo-wide, only three
`__integration__` directories exist (`app/[locale]/(marketing)`, `lib/deletion`, `lib/email`) — none
under `lib/social/`. Postiz's integration suite was deleted whole in N2.11; no native LinkedIn/X
replacement was written, because per L-9 writing one would buy zero CI coverage until backlog item
`22E-integration-discovery` closes (`vitest.config.ts`'s `exclude` still contains `**/__integration__/**`,
and no CI job's `include`/positional filter reaches that directory even if it existed). `docs/backlog.md`'s
`22E-integration-discovery` row is updated to say this plainly, correcting a stale "LinkedIn/X" framing
that implied a suite exists.

### 17.3 SHARED-FUNCTION CALLERS, re-grepped at HEAD

**Table A — the dual-identity resolver's three callers (§5.3):**

| Caller | Function(s) called | Test file | Multi-row/ambiguous case covered? |
|---|---|---|---|
| `app/api/social/[platform]/disconnect/route.ts:52,57` | `getActiveById`, `listActiveByBusinessAndPlatform` | `disconnect.test.ts` | Yes — `disconnect.test.ts:153` ("AMBIGUITY CASE... → 409 account_ambiguous") |
| `lib/metrics/orchestrator.ts:67` | `resolvePublishAccount` | `orchestrator.test.ts` (lib/metrics) | Yes — `:283` mocks `{ outcome: 'ambiguous' }` |
| `lib/publishing/orchestrator.ts:107` | `resolvePublishAccount` | `orchestrator.test.ts` (lib/publishing) | Yes — `:433` ("AMBIGUITY CASE... → fails account_ambiguous, nothing published") |

All three callers are covered for the multi-row case — this was N2.5's own deliverable, re-verified here
rather than re-asserted from memory.

**Table B — the provider surface's five consumers (build-guide Reality 6), re-verified at HEAD:**

| Consumer | Calls | Test file |
|---|---|---|
| `app/api/social/[platform]/connect/route.ts:56-58` | `getRegistry().get(platform).getOAuthAuthorizeUrl(...)` | `connect.test.ts` |
| `app/api/social/[platform]/callback/route.ts:86` | `getRegistry().get(platform).exchangeOAuthCode(...)` | `callback.test.ts` |
| `lib/publishing/orchestrator.ts:126-131,214-222` | `.publish(...)`, `.refreshAccessToken(...)` | `orchestrator.test.ts` (lib/publishing) |
| `lib/metrics/orchestrator.ts:56-76` | `.fetchPostMetrics(...)` | `orchestrator.test.ts` (lib/metrics) |
| `app/api/_health/social/route.ts` | per-platform health status | `app/api/_health/social/__tests__/route.test.ts` |

**A sixth interface method, `revokeAccessToken`, has ZERO production callers** — found while re-grepping
Table B, not previously stated. It is implemented on all three providers (`linkedin-provider.ts:340`,
`twitter-provider.ts:473`, `mock-provider.ts:141`) and unit-tested in isolation on each (plus the contract
suite's "never throws" assertion), but neither `disconnect/route.ts` nor `deactivateSocialAccount`
(`lib/db/social-accounts.ts`) calls it. **`SOCIAL-REVOKE-NEVER-BLOCKS`'s own precondition — that a revoke
is attempted at all during disconnect — does not occur in production today.** The constraint as tested
(each provider's `revokeAccessToken` never throws) is true and proven; the constraint as the ADR's prose
implies (disconnect attempts revocation, and a failure there doesn't block it) describes a wiring that
does not exist. This is reported as a finding, not fixed here — N2.13 is a verification step, not an
implementation one. Filed to `docs/backlog.md` alongside this closure.

### 17.4 Constraint-to-CI map

Every constraint below executes in `app-tests.yml` (`npm run test:app` → `vitest run app/ lib/ components/
scripts/eval/`) unless marked **db-tests**. `app-tests.yml` runs on every push/PR; its own
`scripts/ci/assert-no-empty-suite.mjs` is the skip-guard for that job. `db-tests.yml` runs
`npm run test:db` → `vitest run supabase/__tests__` against live Postgres, also skip-guarded.

| Constraint | Tier | CI job | Reddens if broken |
|---|---|---|---|
| `SOCIAL-CONTRACT-ALL-PROVIDERS` | 2 | app-tests | Any provider (Mock/LinkedIn/X) fails a shared contract assertion |
| `SOCIAL-NO-POSTIZ` | 2 | app-tests | Any stray "postiz" string outside stated exemptions |
| `SOCIAL-INTERNALS-BAN-REPLACED` | 3 | app-tests | A banned internal import is un-banned or a new one un-added |
| `SOCIAL-NO-MULTI-PLATFORM` | 3 | app-tests | `'multi'` narrows incorrectly in `types.test.ts` |
| `SOCIAL-AUTHORIZE-ASYNC` | 2 | app-tests | Any provider's `getOAuthAuthorizeUrl` stops returning a Promise |
| `SOCIAL-PKCE-COOKIE` | 2 | app-tests | Verifier cookie attributes/lifetime/clearing regress |
| `SOCIAL-PKCE-NOT-IN-STATE` | 3 | app-tests | A verifier field appears in the state JWT claims |
| `SOCIAL-REDIRECT-URI-MATCH` | 2 | app-tests | Connect/callback derive different `redirectUri`s |
| `SOCIAL-STATE-BINDS-BUSINESS` | 2 | app-tests | Ownership check removed before a service-role write |
| `SOCIAL-NO-SECRET-EGRESS` | 2+3 | app-tests | A client secret appears in a bundle/log/`details` payload |
| `SOCIAL-VAULT-UPDATE-SECRET` | **1** | **db-tests** | `vault_update_secret` missing, wrong grants, or not in-place |
| `SOCIAL-VAULT-UPDATE-CHECKED` | 2 | app-tests | A `vault_update_secret` call site stops checking `error` |
| `SOCIAL-LI-EXPIRY-REVOKED` | 2 | app-tests | LinkedIn refresh throws `TOKEN_EXPIRED` instead of `TOKEN_REVOKED` |
| `SOCIAL-X-EXPIRY-FROM-RESPONSE` | 2 | app-tests | `token_expires_at` stops deriving from `expires_in` |
| `SOCIAL-REVOKE-NEVER-BLOCKS` | 1+2 | app-tests (2 only — see §17.3) | A provider's `revokeAccessToken` throws instead of resolving |
| `SOCIAL-DUAL-IDENTITY-SCHEMA` | **1** | **db-tests** | `posts.social_account_id` FK/cascade/RLS regresses |
| `SOCIAL-DUAL-IDENTITY-RESOLVER` | 2 | app-tests | Any of the three callers' ambiguous-case test regresses (§17.3 Table A) |
| `SOCIAL-LI-AUTHOR-URN` | 2 | app-tests | Person/organization URN handling regresses |
| `SOCIAL-LI-POSTID-FROM-HEADER` | 2 | app-tests | `platformPostId` starts reading from the body |
| `SOCIAL-MEDIA-GUARD` | 2 | app-tests | Non-empty `mediaUrls` stops rejecting before a network call |
| `SOCIAL-ERROR-MAPPING` | 2 | app-tests | Any §7.2 row's mapping regresses |
| `SOCIAL-RATE-LIMIT-RETRY-AFTER` | 2 | app-tests | The finite guard or 60s fallback regresses |
| `SOCIAL-REGISTRY-PER-PLATFORM` | 2 | app-tests | Overrides routing or per-platform absence regresses |
| `SOCIAL-META-NOT-REGISTERED` | 2 | app-tests | A Meta platform gets a provider or loses its `coming_soon` gate |
| `SOCIAL-MOCK-MODE-OFFLINE` | 2 | app-tests | Mock mode makes a real network call |
| `SOCIAL-CSP-NO-POSTIZ-HOST` | 2 | app-tests | `buildCsp` regains a `postizHost`-shaped parameter |
| `SOCIAL-HEALTH-PER-PLATFORM` | 2 | app-tests | Health route re-names a broker |
| `SOCIAL-I18N-NO-BROKER-KEY` | 2+3 | app-tests | `postiz_unavailable` key reappears, or its replacement disappears |
| `SOCIAL-ERR-MATRIX-TRUE` | 3 | N/A — Tier-3 documentation decision, no runtime test (ADR 0005 §5's prose was the defect, not code) | — |
| `SOCIAL-INTEGRATION-NOT-EXECUTED` | 3 | N/A — Tier-3 decision proven by absence (§17.2); `vitest.config.ts`'s `exclude` is the mechanism, not a test asserting it | — |
| `SOCIAL-WORKER-UNCHANGED` | 2 (N2.13) | app-tests | The retry/status/idempotency invariants in `orchestrator.ts` change beyond account resolution |
| `SOCIAL-PROVIDER-BOUNDARY` | 2 (N2.13) | app-tests | Any of the eight `SOCIAL_INTERNALS_BAN` entries stops firing |
| `SOCIAL-META-STILL-UNAVAILABLE` | 2 (N2.13) | app-tests | Instagram/Facebook/Threads flip to `publishingAvailable: true` without Meta App Review having happened |
| `SOCIAL-NO-READ-PATH` | 2 (N2.13) | app-tests | `fetchRecentPosts`/`listRecentPosts` is added to `lib/social/` ahead of Session 32 |

**CI run URLs — pushed and read, per this section's own instruction not to claim a count before that:**

- **`app-tests` — GREEN.** `https://github.com/tcr430/SOSH/actions/runs/33970367725`, commit `b6580b84`.
  Every `app-tests`-mapped constraint row above executed and passed. The first attempt at commit
  `608f3839` (this closure's own preceding commit) had reddened on an unrelated pre-existing constraint,
  `POSTS-DDL-UNMODIFIED` (ADR 0022 §11.3) — fixed in `b6580b84` per the retirement reasoning in that
  commit's message; not one of this ADR's own `SOCIAL-*` constraints.
- **`db-tests` — RED, three consecutive attempts, and NOT a behaviour regression.**
  `https://github.com/tcr430/SOSH/actions/runs/33970367722` (reran twice at the same commit). Every
  attempt fails identically: `vault-update-secret.test.ts`'s three permission tests (anon-denied,
  authenticated-denied, service-role-granted — the exact ones proving `SOCIAL-VAULT-UPDATE-SECRET`), plus
  two unrelated suites (`post-ai-originals-latest-per-post.test.ts`, `signals3-triage-atomic.test.ts`)
  reported entirely invisible/skipped. The container logs show `FATAL: the database system is in
  recovery mode` (SQLSTATE 57P03) at the exact point these tests run, immediately after the "Reset DB"
  step re-applies all migrations — `docker inspect` shows the db container itself was never OOM-killed or
  restarted, which points at a **readiness race in `db-tests.yml`'s wait-for-schema-cache step** (Postgres
  briefly unavailable to auth-dependent tests right after reset, not a data or permission defect) rather
  than a real DB-behaviour regression. **Independently confirmed against the live linked Supabase project
  (`phdqfrrkbvuuklvbigoh`) that `public.vault_update_secret`'s actual grants are correct** — only
  `postgres` and `service_role` hold `EXECUTE`; `anon`/`authenticated` do not — so the underlying migration
  is not in question. Per ADR 0015 §5's merge-gate table, distinguishing "DB-behaviour regression" from
  "stack OOM/infra" is exactly what a Reviewer opening this run must do; done here, and it is the latter.
  **`db-tests` is not yet a required/blocking gate** (ADR 0015 §5's promotion rule; `current-phase.md`
  records the 7-consecutive-green tally as met but not yet enacted by the founder), so this does not block
  merge — but is reported here rather than silently retried into a false green or left uncited. Filed as
  `30.5-DBTESTS-READINESS-RACE` in `docs/backlog.md`.

### 17.5 Tier-3 constraints, enumerated as decisions

- `SOCIAL-INTERNALS-BAN-REPLACED`, `SOCIAL-NO-MULTI-PLATFORM`, `SOCIAL-PKCE-NOT-IN-STATE`,
  `SOCIAL-I18N-NO-BROKER-KEY` (Tier 2+3) — each **is** a runtime test (see §17.4); Tier 3 here means "an
  absence/shape property", not "untested".
- `SOCIAL-ERR-MATRIX-TRUE` — a decision that ADR 0005 §5's *prose* was wrong, corrected by A-7's
  documentation-only amendment. No code changed, so no runtime test proves it; the amendment text itself
  is the artefact.
- `SOCIAL-INTEGRATION-NOT-EXECUTED` — a decision to state absence of coverage honestly rather than fake
  it with a suite no CI job runs. Proven by `vitest.config.ts`'s `exclude` pattern (a config fact) plus
  the backlog item recording the un-defer trigger, not by a passing test.

### 17.6 §14 manual verification log

**Empty**, exactly as it was when this ADR was authored. No connect-and-publish cycle was performed
against a real platform during N2.12 or N2.13 — both were documentation/UI/verification steps with no
platform credentials in scope. This is the honest state per §14.1, not a formality to backfill before
merge.

### 17.7 §16 stated-open items — what this closure does and does not resolve

**None of §16's eight items are closed by N2.12 or N2.13.** Specifically:

- **Item 1 (LinkedIn ships member-only) and item 6 (X's per-post link cost vs. "unlimited posts") remain
  OPEN FOUNDER ADJUDICATIONS.** Neither this session nor any Builder session can resolve them — they are
  product/pricing decisions requiring an explicit founder ruling, named as such in §16 itself. Saying so
  here is required, not optional (build guide N2.13's explicit instruction) — a reader must not infer
  either is closed by omission. `docs/launch-checklist.md` §16a (added this session) makes item 1's
  three options and its current unresolved status an executable checklist row rather than only ADR prose.
- **Items 2, 3, 4, 5, 7 and 8 are standing facts/risks recorded for awareness**, not defects with a fix
  step this session could take — periodic `Linkedin-Version` review (2), LinkedIn's carousel limitation
  (3), unmigratable existing connections (4), a failed-revocation-leaves-a-live-token acceptance (5), the
  empty-§14-at-merge risk (7, restated in §17.6 above), and the unavoidable future re-authorisation (8) —
  none of these are proven false or resolved by N2.13; they remain exactly as stated.
