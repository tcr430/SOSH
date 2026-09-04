# Session 30.5 — Native platform providers and the removal of Postiz (ADR 0028 + ADR 0002 Amendment A) · Track N

> **Goal:** replace the brokered publishing path with **native LinkedIn and X (Twitter) provider
> implementations behind the existing `SocialProvider` interface**, and then **delete Postiz from the
> platform entirely** — the provider file, its tests, its env vars, its CSP hole, its ESLint entry, its
> health-route name and its documentation claims. `docs/launch-checklist.md` §16 is the definition of
> done and this session closes every row in it.
>
> **What this session does NOT ship, explicitly:** any **read path** — `fetchRecentPosts` and open
> decision 19D-5 belong to Session 32 (Track I) and now land as **ADR 0002 Amendment B**, not A;
> **Meta-family publishing** (Instagram, Facebook Pages, Threads), which is gated on Meta App Review, an
> external process no session can complete — those three stay `publishingAvailable: false` and the ADR
> states honestly what remains outstanding; the **engagement inbox** (`pre-launch-scope.md` T1-A);
> **founder / personal profile accounts** (T1-E) beyond naming the interaction this session creates for
> them; **media generation or upload beyond what `PublishInput.mediaUrls` already promises**; and **any
> change to the publishing worker's status machine, retry policy or idempotency model** (ADR 0005) — if a
> native provider appears to require one, that is an ADR 0005 amendment and it is **flagged, not made**.
>
> **Why this runs before Session 31 rather than after Session 34.** Two reasons, and the second is the
> load-bearing one. First, Postiz removal is already the head of the pre-launch hardening queue
> (`docs/current-phase.md:1465`, `docs/launch-checklist.md` §16) and is the only remaining item between
> the product and a truthful `docs/product-status.md:95`. Second, **Session 32 (Track I) adds a read path
> to `SocialProvider` and its own guide names the failure mode: *"a contract that quietly encodes Postiz's
> response shape"*** (`docs/build-guide/session-32.md:244`). That session budgets an entire Architect
> question (Q2, `session-32.md:241-244`) to *surviving* a migration that had not happened yet. **Running
> the migration first deletes that question instead of answering it**, and the backfill contract gets
> designed against the API it will actually call. Sessions 31, 32, 33 and 34 are reframed accordingly —
> see the dated note at the head of each.
>
> **Prerequisite, absolute.** Session 30.5 does not begin until Session 30 (Track G, ADR 0023) has closed
> — PR #9 merged and its correction pass complete. This session rewrites the provider layer that
> Session 30's eval harness reaches through in no way at all, but it touches `lib/config.ts`,
> `eslint.config.mjs` and the CSP builder, all of which Session 30's correction pass also touched. Two
> open diffs over the same three files is how a merge conflict becomes a silent revert.

---

## Reality check — to be re-verified against the live repo before the Architect runs

> Read at `b297a4a8`. **If any item has changed, correct this file before the Architect runs.** Every
> item below is load-bearing for at least one `Q` or `L`.

1. **`PostizProvider` is the only production provider, and production refuses to boot without it.**
   `lib/social/registry.ts:31-56`: `SOCIAL_PROVIDER_MODE === 'mock'` gives `MockProvider`; otherwise
   `POSTIZ_BASE_URL` + `POSTIZ_API_KEY` give a **single** `PostizProvider` registered as the *default*
   provider for every platform, and in `NODE_ENV === 'production'` their absence throws
   `PROVIDER_NOT_CONFIGURED`. The provider declares `readonly platform = 'multi'`
   (`lib/social/postiz-provider.ts:59`). **The registry's per-platform `overrides` map already exists and
   is never populated** (`registry.ts:9-20`) — native providers are what it was built for, so routing is
   a `register()` call per platform, not new machinery.

2. **Postiz brokers the OAuth handshake, and therefore SOSH owns no platform OAuth app today.**
   `postiz-provider.ts:84-91` builds `${baseUrl}/integrations/${platform}/authorize` and `:96` POSTs to
   `${baseUrl}/integrations/${platform}/callback`. **There is no `client_id`, no client secret, no PKCE
   verifier, and no platform token endpoint anywhere in the repo.** This — not the publish call — is the
   largest hidden cost of the removal, and it is what **Q1** owns. Anyone estimating this session from the
   size of `postiz-provider.ts` (379 lines) will estimate it wrong.

3. **The interface is already the right shape, with one latent defect the migration exposes.**
   `lib/social/types.ts:118-134` defines seven methods and they are provider-neutral. But
   `getOAuthAuthorizeUrl` is declared **synchronous** (`types.ts:121`, returning `string`) while its only
   call site `await`s it (`app/api/social/[platform]/connect/route.ts:56-58`) and its test mocks it with
   `mockResolvedValue` (`connect/connect.test.ts:78`). A native provider that must persist a PKCE verifier
   before redirecting **needs it async**. Q1 either changes the signature deliberately or inherits the
   mismatch.

4. **`OAuthAuthorizeInput.platform` exists only because of Postiz.** `types.ts:26-28` carries the comment
   *"Builder addition (not in ADR §2): PostizProvider needs the platform to construct its per-platform
   authorize URL."* A per-platform provider knows its own platform. Whether the field stays (compatibility)
   or goes (honesty) is a decision the ADR makes explicitly, because `Platform | 'multi'` on
   `SocialProvider.platform` (`types.ts:119`) is the same question in the other direction.

5. **Only two of the five platforms can publish at all, and the reason is external.**
   `lib/social/platforms/config.ts:17,24` set `publishingAvailable: true` for LinkedIn and X;
   `:32,40,48` set it `false` for Instagram, Facebook and Threads, each with a source comment naming
   **Meta App Review** as the blocker (`instagram_content_publish`, `pages_manage_posts`,
   `threads_content_publish` are all absent from the requested scopes). **"Remove Postiz" therefore does
   not mean "five native providers."** It means two, honestly, plus an unchanged and truthful
   `publishingAvailable: false` for the other three. L-1 says so; the ADR must not quietly widen it.

6. **There are exactly four production consumers of the provider outside `lib/social/`, and one health
   probe.** `app/api/social/[platform]/connect/route.ts:56-58` (authorize URL),
   `app/api/social/[platform]/callback/route.ts:87` (code exchange), `lib/publishing/orchestrator.ts:122-127`
   and `:210` (publish + revoke path), `lib/metrics/orchestrator.ts:56-72` (`fetchPostMetrics`), and
   `app/api/_health/social/route.ts:35-40`, which **names the provider `'postiz'` in its response body**.
   **SHARED-FUNCTION CALLERS applies to every one of them**: the ADR enumerates each caller and states,
   per caller, which test covers it.

7. **The `lib/social/` boundary is scan-enforced, and deleting the Postiz file weakens the scan unless it
   is rewritten.** `eslint.config.mjs` `SOCIAL_INTERNALS_BAN` lists `@/lib/social/postiz-provider` among
   the banned deep imports. `docs/launch-checklist.md:461` already notes the rule becomes *"moot once the
   file is gone."* **Moot is not the same as replaced** — the new provider files must be added to the ban
   list in the same change, or the removal silently opens the boundary CLAUDE.md calls non-negotiable.

8. **`social_accounts` carries exactly one identity column-set, and native publishing may need more.**
   `supabase/migrations/20260430120006_social_accounts.sql:11-27`: `platform_user_id`,
   `platform_username`, `platform_display_name`, unique on `(business_id, platform, platform_user_id)`.
   LinkedIn publishing needs an **author URN**, which differs in shape between a person and an
   organization; Facebook Pages need a Page id **and a page-scoped token**; Instagram needs the IG business
   account id. Whether `platform_user_id` carries these or a migration lands is **Q4** — and the answer
   interacts with `pre-launch-scope.md` T1-E (founder/personal profiles), which this session does not
   build but must not make harder.

9. **Token lifecycle already differs per platform in config, and the broker was hiding the consequence.**
   `platforms/config.ts:19-21` — LinkedIn: `supportsRefreshToken: false`, `tokenExpiryDays: 60`.
   `:22-27` — X: `supportsRefreshToken: true`, `tokenExpiryDays: null`, with `offline.access` in scope.
   **A LinkedIn token simply dies at 60 days and cannot be refreshed; the user must reconnect.** ADR 0002
   §8's lazy-refresh-with-5-minute-skew was written against a broker that papered over this. The surface
   that tells the user, however, **already exists**: `lib/social/connection-status.ts:5,12,26-31` returns
   `'expiring_soon'` inside a 7-day window. L-6 keeps this session inside that surface.

10. **CSP carries a Postiz-shaped hole that removal closes.** `lib/observability/csp.ts:5-7` accepts
    `postizHost?` and appends it to `connect-src`. Native platform calls are **server-side only**, so the
    extra `connect-src` origin becomes unnecessary and its removal is a net security improvement — one
    that must land with a test (`lib/observability/csp.test.ts` exists), not as a silent deletion.

11. **Config and env are a closed, enumerable surface.** `lib/config.ts:17-18` (`POSTIZ_BASE_URL`,
    `POSTIZ_API_KEY`, both `z.string().default("")`), `:34` (`SOCIAL_PROVIDER_MODE`), `:273-274`,
    `:290`, `:384-388`, `:441-442`; `.env.local.example:17-20`. Native providers need a client id and
    secret per platform — **four new variables minimum** — and CLAUDE.md permits their access **only**
    through `lib/config.ts`. `SOCIAL_PROVIDER_MODE=mock` must keep working unchanged: it is how the entire
    app-test suite avoids the network.

12. **The Postiz test surface that CI actually runs is smaller than it looks.**
    `lib/social/__tests__/postiz-provider.test.ts` runs in `app-tests`;
    `lib/social/__integration__/postiz-provider.integration.test.ts` is gated on
    `POSTIZ_INTEGRATION_TEST_ENABLED` **and is discovered by no CI job at all** — `docs/backlog.md:50`
    records this as open item **22E-integration-discovery**, a deliberate Session 22-D trade. So deleting
    the integration test costs nothing CI was running, **and writing a native replacement buys nothing
    either** until that backlog item is closed. L-9 forces the ADR to say this in those words rather than
    claiming coverage it does not have.

13. **The removal's definition of done is already written and is not this file's to invent.**
    `docs/launch-checklist.md:454-464` §16, eight rows, opening with the reason: *"a half-removal leaves
    dead code that future audits read as 'we use Postiz.'"* Row 8 is the executable one:
    *"`grep -r postiz` against the repo returns no matches outside `/docs/decisions/` historical ADRs."*
    §5 of this guide closes those rows; the ADR does not substitute a different list.

14. **Two truth documents change at close-out, and one of them is customer-facing.**
    `docs/product-status.md:95` — *"Publishing runs through Postiz, behind our own provider abstraction"* —
    and CLAUDE.md's tech-stack line, which already reads **"Social publishing: Native platform"** and is
    therefore **currently ahead of the code**. The constitution describing an unbuilt state is the drift
    ADR 0010's Evidence Pack discipline exists to prevent; this session makes the two agree.

---

## §0 — Locked decisions (binding input — adjudicated by founder, 2026-09-03)

These are decided. The Architect (N1) **encodes** them in ADR 0028 and names their losers; it does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**, exactly as an ADR
contradicting CLAUDE.md would.

**Locked (L):**

- **L-1 — Session 30.5 ships native LinkedIn and X providers and the total removal of Postiz, and nothing
  else.** *In scope:* SOSH-owned OAuth apps and their configuration surface; `LinkedInProvider` and
  `TwitterProvider` implementing the **existing** `SocialProvider` interface; per-platform registry
  routing through the `overrides` map that already exists (Reality §1); per-platform token lifecycle
  including LinkedIn's non-refreshable 60-day expiry; per-platform error and rate-limit mapping onto the
  **existing** error union; deletion of `postiz-provider.ts`, its two test files, its env vars, its CSP
  parameter, its ESLint ban entry and its health-route name; **ADR 0002 Amendment A**; and every row of
  `launch-checklist.md` §16. *Out of scope, explicitly:* **any read path** (`fetchRecentPosts` / 19D-5 —
  Session 32, as ADR 0002 Amendment **B**); **Meta-family publishing** (Reality §5 — App Review is
  external and no session can close it); the **engagement inbox** (T1-A); **founder/personal profile
  accounts** (T1-E — named in Q4, not built); **media upload beyond today's `mediaUrls` promise**;
  **threads / multi-post / scheduling changes**; and **any change to ADR 0005's status machine, retry
  policy or idempotency model**. If a step appears to need any of these, **STOP and report**.

- **L-2 — `SocialProvider` is the contract; the providers conform to it, it does not conform to them.**
  ADR 0002 §2's seven methods (`types.ts:118-134`) survive the migration. Where a platform genuinely
  cannot serve a method, the provider throws the **existing** `NOT_IMPLEMENTED` code (`types.ts:12`) and
  the ADR states, **per platform and per method**, what is honestly implemented and what is not. The loser
  is a per-platform widening of the interface: it is how a two-provider abstraction becomes two
  hard-coded branches at every call site, which is precisely what ADR 0002 was written to prevent. **The
  one signature change permitted is `getOAuthAuthorizeUrl` → `Promise<string>` (Reality §3), and only if
  Q1 argues for it.**

- **L-3 — The removal is TOTAL, lands in this session, and is proved by a scan.**
  `grep -ri postiz` over the repo returns matches only under `docs/decisions/` (historical ADRs) and
  `docs/reviews/` (immutable review history). No deprecation period, no dual-provider window, no
  feature-flagged fallback. The loser is a staged removal that leaves `postiz-provider.ts` in the tree
  behind a flag — `launch-checklist.md:456` already names the failure: *"a half-removal leaves dead code
  that future audits read as 'we use Postiz.'"* The constraint is `SOCIAL-NO-POSTIZ` and it is an
  **executable scan in the test suite**, not a review comment.

- **L-4 — SOSH now owns the OAuth apps, and every secret lives in exactly one place.** Client ids and
  client secrets are read **only** through `lib/config.ts` (Reality §11). No secret appears in a database
  table, a TypeScript type, a log line, an error message, or any client bundle. Where a platform requires
  **PKCE** (X does), the verifier's storage and lifetime are stated in the ADR with a named expiry — and
  if that storage is a new business-scoped table, L-11 applies to it in full. The existing signed-JWT
  OAuth state (`signOAuthState` / `verifyOAuthState`, ADR 0002 Reversal 3) is **reused, not replaced**.

- **L-5 — Tokens keep living in Supabase Vault, and `lib/social/vault.ts` does not move.** The vault read
  path (`readAccessToken`, `readRefreshToken`, `withFreshToken`) is already provider-agnostic and stays
  that way; native providers consume it exactly as `PostizProvider` did. CLAUDE.md's three-step disconnect
  (`is_active = false`, null the vault id columns, delete the vault secrets) is unchanged — and **the
  native providers add a fourth obligation: call the platform's own token-revocation endpoint where one
  exists**, which the broker was doing invisibly. The loser is per-provider token storage.

- **L-6 — LinkedIn's 60-day death becomes product-visible, INSIDE the surface that already exists.**
  `getConnectionStatus` already returns `'expiring_soon'` within 7 days of `token_expires_at`
  (Reality §9). This session makes that status **correct for a native LinkedIn connection** and makes the
  accounts settings page state plainly that LinkedIn requires periodic reconnection. **No new email, no
  new notification channel, no new surface** — a reconnection email is a real idea, it touches ADR 0008,
  and the ADR names it as a follow-on **with its trigger stated**, not as scope.

- **L-7 — Platform errors map onto the EXISTING `SocialProviderErrorCode` union.** `types.ts:8-16` has
  eight codes and ADR 0005 §5's error matrix plus §6's retry policy are **keyed on them**. A new code is
  therefore not a typing change — it is a change to the publishing worker's retry behaviour, and it is
  **flagged for founder adjudication**, not added. Per-platform `Retry-After` handling maps into the
  existing `RATE_LIMITED` path; the ADR states, per platform, which HTTP status and body shape produces
  which code.

- **L-8 — One shared contract test suite runs against EVERY implementation.** `MockProvider` remains the
  test-time default (`SOCIAL_PROVIDER_MODE=mock`) and is held to the same contract as LinkedIn and X. The
  loser is bespoke per-provider tests only: that is exactly how a second implementation silently diverges
  from the first, and with the broker gone there is no longer a single implementation to keep everyone
  honest. Name the suite's file and state which behaviours it asserts for all providers versus which are
  legitimately per-platform.

- **L-9 — No network in Tier 2, and no coverage claimed that CI does not run.** Native providers are
  tested against **recorded fixture responses** in the app-test suite. Any real-network suite lives in
  `lib/social/__integration__/` and the ADR states, in these words, that it is **`AUTHORED-NOT-EXECUTED`
  until `22E-integration-discovery` is closed** (`docs/backlog.md:50`). ADR 0015's whole point is that
  "covered" means *executed green in CI*; a native provider is precisely the place where a green-looking
  untested integration would be most dangerous.

- **L-10 — The removal is OBSERVABLE, not just internal.** `app/api/_health/social/route.ts:35-40` stops
  reporting `'postiz'` and reports the per-platform provider actually in use; `buildCsp` loses its
  `postizHost` parameter and the corresponding `connect-src` origin (Reality §10); `.env.local.example`
  and `launch-checklist.md` §1's env table lose their Postiz rows. Each of these has a test or a checklist
  row, and §5 closes them.

- **L-11 — GDPR, tenancy and RLS obligations in full.** No new business-scoped table is *expected*. If one
  lands anyway (PKCE verifiers are the likely candidate), it gets: RLS in the InitPlan-wrapped
  `= ANY (SELECT unnest(public.get_user_business_ids()))` form, `USING` **and** `WITH CHECK` on every
  UPDATE, `ON DELETE CASCADE` from `businesses`, **a row in ADR 0010 Amendment 2 §D2.5's cascade table**,
  and `purge_business` coverage. If Q4 lands a migration on `social_accounts`, it is **additive with an
  explicit stated backfill** and the unique constraint's new behaviour is stated. And the erasure story
  gains a step: **on business deletion, platform-side token revocation is attempted** — state what happens
  when it fails, because a failed revocation must not block erasure.

- **L-12 — Contract discipline + constitution rules, inherited by every step.** **Zod** on every route and
  Server Action input **and on every platform API response** (`postiz-provider.ts:20-51` set the precedent
  — raw `as` casts on a provider response were a named Session 17 correction); **atomic** state
  transitions; every list query **bounded + explicit `ORDER BY`** matching an index; **date-fns** and
  `toUtcIso()`, never raw `.toISOString()`; **no `any`**; **no `console.*`** outside the single canonical
  worker line; env only via `lib/config.ts`; DB only via `lib/db/`; service-role never in a user-facing
  read path; **i18n en/pt/es simultaneously** for every new string (including the LinkedIn reconnection
  copy and any new OAuth error-redirect code — `settings/accounts/page.tsx:19` shows the existing
  `postiz_unavailable` key, which is itself a Postiz leak into user-facing i18n and must go); and
  **SHARED-FUNCTION CALLERS** for all five consumers in Reality §6.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | When the migration runs | **Before Session 31, ahead of the whole quality programme** | after Session 34 (leaves Session 32 designing a read contract against a broker it will then have to re-implement — its own guide budgets Q2 to that risk, `session-32.md:241-244`); never/indefinitely (blocks §16, and leaves `product-status.md:95` contradicting CLAUDE.md's tech-stack line) |
| D-2 | Removal shape | **Total, one session, proved by scan (`SOCIAL-NO-POSTIZ`)** | staged removal behind a flag (`launch-checklist.md:456`: dead code future audits read as "we use Postiz"); provider left in tree as reference (same failure, slower) |
| D-3 | Platform coverage | **LinkedIn + X natively; Meta family stays `publishingAvailable: false`, honestly** | five native providers (three are blocked on Meta App Review — an external process, so promising them makes the session unclosable); dropping the Meta platforms from the enum (they are a locked launch platform in CLAUDE.md and their OAuth connect path already works) |
| D-4 | Interface treatment | **Conform to ADR 0002 §2; `NOT_IMPLEMENTED` where a platform cannot serve a method** | widening `SocialProvider` per platform (two implementations become two branches at five call sites, defeating ADR 0002); a second parallel interface for native providers (two abstractions over one concern) |
| D-5 | Token storage | **Vault, unchanged; `lib/social/vault.ts` untouched** | per-provider storage (multiplies the surface CLAUDE.md's Vault rule exists to keep at one) |
| D-6 | Error model | **Existing eight-code union; a new code is a founder adjudication** | per-platform error codes (ADR 0005 §5/§6 are keyed on the union — new codes silently change retry behaviour in a worker this session is out of scope to touch) |
| D-7 | Test strategy | **One shared contract suite over all implementations + fixture-based provider tests** | per-provider bespoke tests only (how the second implementation diverges undetected); real-network tests as the primary proof (L-9 — no CI job discovers them) |
| D-8 | The 60-day LinkedIn expiry | **Surfaced through the existing `connection-status` + accounts page** | a new reconnection email (real, but pulls ADR 0008 into a migration session — named as a follow-on with its trigger); silence (the broker's behaviour, and the reason a token death would first be noticed as a failed publish) |

---

## §0.1 — Questions the Architect (N1) must resolve IN the ADR (BINDING)

**N1's ADR must decide each one explicitly, name the loser, and tier the resulting constraint** (ADR 0015
§2: Tier 1 live-Postgres DB behaviour, Tier 2 app-layer vitest, Tier 3 diff-verified absence). The Builder
consumes these answers as binding. Ground every answer in the real seams — let the single
`ecc:code-explorer` sweep map them and cite `file:line` rather than remembering.

- **Q1 — The OAuth ownership model, per platform (the load-bearing question).** Reality §2 is the whole
  problem: SOSH owns no OAuth app, no client id, no PKCE machinery. For **LinkedIn** and **X**
  separately, state: the app registration and review status each platform requires before a real user can
  connect; the **exact scopes** needed to publish, checked against what `platforms/config.ts:19-27`
  already requests (if the shipped scope list is wrong for native publishing, say so — that is a
  correction, not a widening); the authorize URL construction; whether **PKCE** is required and where the
  verifier lives, with its lifetime and cleanup (L-4); the redirect URI set, enumerated, for local, preview
  and production; how the existing signed-JWT `state` (ADR 0002 Reversal 3) rides along unchanged; and the
  code-exchange request and response shapes with their **Zod schemas' field lists** (not the schema code —
  that is the Builder's). **Then answer the signature question:** does `getOAuthAuthorizeUrl` become
  `Promise<string>` (Reality §3)? Name the loser and enumerate the callers the change touches.

- **Q2 — The publish contract, per platform.** For LinkedIn and X separately: the endpoint and API
  version; the **author identity** the call requires (LinkedIn's author URN — person vs organization — and
  what X requires) and where it comes from, which is Q4's input; how `PublishInput.content` +
  `hashtags` + `mediaUrls` (`types.ts:63-68`) map onto the request, **including what happens to
  `mediaUrls` if native media upload is a second API call** — if it is, say whether it lands here or is
  deferred, and if deferred, what a post with media does instead of silently dropping it; character and
  media limits and where they are enforced (provider, or earlier); what `PublishResult.url`
  (`types.ts:71-75`) is per platform and whether it can always be constructed; and how each provider
  satisfies ADR 0005 §7's idempotency model without changing it (L-1).

- **Q3 — Token lifecycle, per platform, including the one that cannot refresh.** X's refresh flow
  (`offline.access`, rotation semantics — state whether the refresh token itself rotates, because if it
  does, ADR 0002 §8's "accepted concurrent-refresh race" gets **worse**, not equal, and the ADR must say
  whether it stays accepted). LinkedIn's absence of refresh and its 60-day death: what
  `token_expires_at` is set to at connect, how `withFreshToken` behaves when it cannot refresh, what the
  publishing worker does when a token has died mid-campaign (which of the eight error codes, and what
  ADR 0005 §5 already does with it), and what the user sees via `connection-status.ts` (L-6). Plus
  **revocation**: each platform's revoke endpoint, and what happens to CLAUDE.md's three-step disconnect
  and to `purge_business` when a revoke call fails (L-11).

- **Q4 — Platform identity and the schema question.** Reality §8. Does `social_accounts.platform_user_id`
  carry LinkedIn's author URN, or does a migration land? If a migration lands, state it additively with
  its backfill, and state what happens to the existing
  `UNIQUE (business_id, platform, platform_user_id)` when a business connects **both** a personal and an
  organization LinkedIn identity — that is `pre-launch-scope.md` **T1-E**, which this session does not
  build but must not block. Say explicitly what T1-E inherits from this answer. Also decide the fate of
  `OAuthAuthorizeInput.platform` (Reality §4) and of `SocialProvider.platform`'s `| 'multi'` member
  (`types.ts:119`), which exists solely to describe a broker.

- **Q5 — Metrics, per platform, and what `null` honestly means.** `PostMetrics` (`types.ts:78-87`) has
  seven nullable fields. State, **per platform and per field**, which the API can actually serve, which
  require an elevated access tier the product does not have, and which are permanently unavailable.
  Distinguish *"not fetched this tick"* from *"this platform will never serve it"*, because
  `lib/metrics/orchestrator.ts:56-72` writes both as `null` today and **Session 33 (Track J) builds pattern
  extraction on top of these rows** — a permanently-null field silently entering a minimum-n floor is a
  measurable defect in a later session. State whether the metrics worker's cadence survives each
  platform's rate limits, and what it does when it does not.

- **Q6 — Error and rate-limit mapping onto the existing union (L-7).** A table: platform × HTTP status ×
  response-body shape → one of the eight `SocialProviderErrorCode` values, with each mapping's
  consequence in ADR 0005 §5's error matrix and §6's retry policy stated. Handle `Retry-After` and
  platform-specific rate-limit headers explicitly. Flag — do not add — any case where **no existing code
  fits**, since that is a change to worker retry behaviour and a founder adjudication.

- **Q7 — The removal itself, as an ordered and provable operation.** The step order that keeps `master`
  green at every commit (native providers registered **before** Postiz is deleted, or the reverse — argue
  it, and name what breaks under the losing order). The `eslint.config.mjs` `SOCIAL_INTERNALS_BAN` rewrite
  (Reality §7) — the new provider modules must be banned from deep import in the **same** change that
  removes the Postiz entry. The `buildCsp` `postizHost` parameter removal and its test (Reality §10). The
  `lib/config.ts` + `.env.local.example` deltas, with the **new** per-platform variables named and their
  absence-behaviour stated (what does the registry do in production when LinkedIn is configured and X is
  not?). The health route's new provider naming (L-10). The `postiz_unavailable` i18n key across en/pt/es
  and its replacement. And the exact form of the **`SOCIAL-NO-POSTIZ` scan** — its file, what it greps,
  and which paths it legitimately exempts (`docs/decisions/`, `docs/reviews/`).

- **Q8 — Test plan across the tiers, plus the UX contract.** Map every `SOCIAL-*` constraint to a tier:
  **Tier 2** for the shared contract suite (L-8), each provider's fixture-based tests, the OAuth state and
  PKCE handling, the error mapping table, the registry's per-platform routing and its production-absence
  behaviour, the CSP delta, and the `SOCIAL-NO-POSTIZ` scan; **Tier 1** for anything Q4's migration adds
  (RLS, cascade, `purge_business`, the unique constraint's new behaviour); **Tier 3** for properties of
  absence, enumerated as such. State the `__integration__` position in L-9's exact terms. Name the fixture
  directories. State what is **honestly untestable** — a real platform's rejection behaviour cannot be
  asserted from a fixture — and say what compensates. Then the **UX contract the Builder is held to** (you
  specify it, you do not design it): the accounts settings surface's states (connected, expiring soon,
  disconnected, coming soon — the four `ConnectionStatus` values that already exist), the LinkedIn
  reconnection message, the per-platform availability copy, every OAuth error-redirect code and its
  message, the accessibility floor, Server Component page + Client interaction split, Zod on every Server
  Action, shadcn v4 / Base UI with **no `asChild`** on Button or DropdownMenu primitives, Tailwind only,
  i18n en/pt/es simultaneously.

Where an N1 answer and this build-guide disagree, **the ADR wins once written** — but N1 must not silently
contradict a §0 Locked decision; if it needs to, it **STOPS and flags for founder adjudication**.

---

## §0.2 — Founder adjudications

> **AUTHORED 2026-09-03 by the founder, recorded by the Architect (N1) after producing the eight §0.1
> answers.** The placeholder that stood here (its anticipated-escalation list a–e) is superseded; four of
> the five it anticipated were in fact raised, and two further ones it did not anticipate were.
> **This section is the Builder's gate: N2 does not start without it.** Where a ruling went against the
> Architect's recommendation, the recommendation is preserved verbatim below, as the house form requires.

| # | Question | Decision | Where encoded |
|---|---|---|---|
| **A-1** | Meta-family (Instagram / Facebook / Threads) OAuth **connect** dies with the broker. §0 D-3 settled *publishing*, never *connecting*, so the removal silently regresses a path that works today. | **Native for the platforms we already have — LinkedIn and X only.** Founder: *"we haven't put meta in yet, so ignore."* The three Meta platforms stay in the `Platform` enum with `publishingAvailable: false`; **no provider is registered for them**, `get('instagram')` throws `PROVIDER_NOT_CONFIGURED`, connect is gated, and they render `coming_soon`. | ADR 0028 Q1/Q7; `SOCIAL-META-NOT-REGISTERED` |
| **A-2** | A **migration is required**, but not the one anticipated: `public.vault_update_secret` **does not exist in any migration**, yet `postiz-provider.ts:255,262` calls `client.rpc('vault.update_secret')` — an undefined, dotted, non-exposed name — and never checks `error`, so it **fails silently** and then bumps `token_expires_at` and returns a success `TokenSet`. Token refresh has therefore never worked. | **Accepted.** A new migration adds `public.vault_update_secret` with service-role-only `EXECUTE`, plus a Tier-1 live-Postgres test, plus error-checking at every call site. Hard prerequisite: X rotates its refresh token, so without this native X publishing cannot survive its first rotation. | ADR 0028 Q3; Tier 1; `bug-912` |
| **A-3** | Native media upload in Q2 — land it now, or defer with a guard? | **Deferred: a dedicated media-integration session owns it.** A post with non-empty `mediaUrls` fails `PLATFORM_REJECTED` rather than publishing text-only, because shipping a different post than the user approved is the worst outcome for a human-in-the-loop product. | ADR 0028 Q2; backlog `30.5-MEDIA-UPLOAD` |
| **A-4** | X's refresh-token **rotation** makes ADR 0002 §8's *accepted* concurrent-refresh race worse than the race §8 reasoned about — §8 accepted a wasted retry; rotation risks an **account disconnect**. | **Accepted for MVP, and filed.** Traffic is scheduled, low-volume, one business per account, so genuine concurrency is rare. Founder: *"add to backlog that this may be an issue later."* ADR 0002 §8's own remedy (a `pg_advisory_xact_lock` keyed on `socialAccountId`) is named with an un-defer trigger. **⚠️ X's docs do not state reuse behaviour** — the Builder must confirm it empirically. | ADR 0028 Q3; backlog `30.5-X-REFRESH-ROTATION` |
| **A-5** | LinkedIn's shipped scopes are **member-only** (`w_member_social`), but CLAUDE.md sells "LinkedIn (Business and Founder)". Organization posting needs `w_organization_social`, which sits behind LinkedIn's **Community Management API** access process. | **We need both.** Founder: *"since we'll have both personal founder account and business account per client we need both."* Scopes are corrected to request member **and** organization permissions, and **the Community Management API access request is a launch gate opened now**, not an engineering step. | ADR 0028 Q1/Q4; `launch-checklist.md` §16a |
| **A-5′** | **Revised 2026-09-03, same day**, on the founder's report that *"we might have a problem with the linkedin api, as we don't have a business yet."* A-5 said the Community Management API request is "a launch gate **opened now**" — **that premise was wrong**, because the application requires a legal name, a registered address and a privacy policy the company does not yet have. | **The LinkedIn gate splits in two, and only the organization half is blocked.** Verified 2026-09-03: creating a LinkedIn developer app requires only an associated **LinkedIn Page** (creatable without a registered entity), and **"Share on LinkedIn" / "Sign In with LinkedIn" are auto-enabled on app creation with no review** — so **`w_member_social` (founder-profile posting) is available immediately**. Company-page *verification* plus the legal details gate only the **Community Management API**, i.e. `w_organization_social`. **Therefore:** the Builder proceeds with no credentials (all six default to `''`; §8.2's absence behaviour is per-platform; Tier 2 is fixture-only), the founder-profile path is live-verified as soon as a Page and app exist, and the organization path stays unverified until the entity is registered. **Both halves of A-5's ruling stand — we still need both identities**; only the *timing* of the organization half changes. A-5 is superseded by A-5′ and both are shown, per this section's own form. | ADR 0028 §14, §16.1, §16.6; `launch-checklist.md` §16a |
| **A-6** | A-5's consequence: supporting **both** identities per client requires more than a scope change. `posts` has **no `social_account_id`** (`20260430120010_posts.sql`, *"one row per (campaign, platform)"*), and `getActiveByBusinessAndPlatform` uses `.maybeSingle()` (`social-accounts.ts:137`) and **throws** on two active rows — breaking publishing, metrics and disconnect. §0 L-1 lists T1-E as explicitly **out of scope**. | **T1-E is pulled INTO Session 30.5**, overriding L-1. Founder: *"add to the session."* This materially widens the session: an additive `posts.social_account_id` migration, replacement of the single-account resolver across its **three** production callers, and an identity picker. **Architect's recommendation, preserved because the ruling went against it:** *split it — 30.5 does the irreversible half (scopes + URN plumbing, one active account per platform), a dedicated T1-E session does `posts.social_account_id` + the picker before launch.* The Architect's reasoning was that scopes are baked into the token at authorisation, so only the scope correction is genuinely urgent; the founder's reasoning is that a half-delivered identity model is not shippable to a client who has both accounts. | ADR 0028 Q4; Tier 1 + Tier 2; `SOCIAL-DUAL-IDENTITY-*` |
| **A-7** | ADR 0005 §5's error matrix claims *"The eight codes are the ADR 0002 §3 taxonomy"* but names two codes that **do not exist** (`BAD_REQUEST`, `NOT_CONFIGURED`) and omits two that do (`NOT_IMPLEMENTED`, `PROVIDER_NOT_CONFIGURED`). The **code is correct** (`publishing/orchestrator.ts:208-305`); only the ADR prose is wrong. L-1 puts ADR 0005 out of scope. | **Fixed by the Builder in this session, not deferred to an amendment nobody actions.** Founder: *"add that fix to builder, if we just make an amendment to an old adr it won't get fixed."* **Architect's recommendation, preserved because the ruling went against it:** *a follow-on ADR 0005 amendment, since L-1 puts ADR 0005 out of scope.* The founder's reasoning — that a deferred documentation fix is a fix that never happens — is recorded as the override. It lands as a numbered Builder step with its own constraint id, appended in ADR 0005's house amendment form (it already carries an "Amendment 1"); **no code changes**. | ADR 0028 Q6; `SOCIAL-ERR-MATRIX-TRUE` |
| **A-8** | **2026-09-03, superseding A-5-prime's Stage 1/Stage 2 timing.** The founder clarified that the blocker is not the LinkedIn Page — *"the linkedin problem is not creating a page is creating an actual business with legal entity and number"* — i.e. the Community Management API needs a **registered legal entity with a company number**, which does not exist and is not imminent. | **LinkedIn organization posting is DEFERRED, and LinkedIn ships member-only.** Founder: *"So lets defer."* Out of Session 30.5: the `w_organization_social` scope request, the Community Management API application, and the organization-URN author path. **In Session 30.5, unchanged:** `w_member_social` founder-profile posting, and **A-6's dual-identity model, which is retained** — see the reasoning below, because it is no longer justified by LinkedIn. **The Architect's earlier "scopes are baked in at authorisation, so get them right now" argument is WITHDRAWN as inapplicable**: an app cannot request a scope it has not been granted, so `w_organization_social` would fail in the authorize URL until the product is approved. Re-authorisation when organization access lands is therefore **unavoidable** and cannot be pre-empted. | ADR 0028 §5.3, §14.1, §16.1, §16.8 |
| **A-8a** | Does A-8 also un-do **A-6** (dual identity pulled into this session)? A-6's stated justification was LinkedIn's founder + business pair, which A-8 defers. | **No — A-6 stands, on a different justification.** CLAUDE.md's locked platforms include **"X (Business and Founder)"**, and two X connections are simply two OAuth flows against two accounts, needing no elevated tier and no approval. So a business can hold **two active X rows today**, which means `getActiveByBusinessAndPlatform`'s `.maybeSingle()` (`social-accounts.ts:137`) throws for X exactly as it would have for LinkedIn. The dual-identity schema and resolver are therefore **immediately load-bearing**, not speculative. Had A-6 rested on LinkedIn alone, A-8 would have deferred it too. | ADR 0028 §5.3 |

**Constraints these adjudications add**, beyond ADR 0028's own set: `SOCIAL-META-NOT-REGISTERED` (Tier 2),
`SOCIAL-VAULT-UPDATE-SECRET` (Tier 1), `SOCIAL-MEDIA-GUARD` (Tier 2), `SOCIAL-DUAL-IDENTITY-SCHEMA`
(Tier 1), `SOCIAL-DUAL-IDENTITY-RESOLVER` (Tier 2, **`SHARED-FUNCTION CALLERS` applies — three production
callers**: `disconnect/route.ts:41`, `metrics/orchestrator.ts:64`, `publishing/orchestrator.ts:104`, none
of which currently tests the multi-row case), and `SOCIAL-ERR-MATRIX-TRUE` (Tier 3).

**Two §0 Locked decisions are overridden by the founder and must be read as amended:** **L-1**'s
out-of-scope list no longer excludes T1-E (A-6) or ADR 0005 (A-7, documentation only — L-1's bar on
changing ADR 0005's *status machine, retry policy and idempotency model* **still stands in full**).

---

## §1 — Architect session (N1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **two documents and no code**:
`docs/decisions/0028-native-social-providers.md` (Accepted) and **ADR 0002 Amendment A** appended to
`docs/decisions/0002-social-provider.md`. No `.ts`, no `.sql`, no `.tsx`. If it writes a Zod schema body, a
provider class, a migration or a component, that output is **discarded**. The last action is a single
confirmation line, then `/exit`.

**Track and numbering, stated once so nobody re-derives it.** This session is **Track N**, inserted between
Sessions 30 (Track G) and 31 (Track H) and numbered **30.5** on the `session-13-5.md` precedent, so that
Sessions 31–34 keep their numbers and every cross-reference to them in `docs/`, `.wolf/` and the ADRs stays
valid. Its ADR is **0028** — the next unclaimed number, because 0024–0027 are already claimed by the
build-guides for Sessions 31–34. **ADR numbers record authorship order, not execution order**, and the ADR
says so in one line so no future reader treats the gap as an error.

**ECC budget for this phase — four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the **closed file list** below, then **exactly three** advisory reviewers dispatched **once, in a
single parallel batch**, after the draft answers to Q1–Q8 exist. **No iterative re-consultation.** Skills
are free and named: `ecc:architecture-decision-records` (for ADR structure and for the amendment's house
form), `claude-mem`'s `mem-search` (**prefer one `mem-search` over re-reading a closed session's build
guide**), and `ecc:documentation-lookup` for current platform API surfaces — **use it**, because LinkedIn
and X API details move faster than any model's training data and a wrong endpoint here becomes a Builder's
whole day. **Do NOT invoke `impeccable` or `taste-skill`** — the Architect *specifies* the accounts-surface
UX contract (Q8) and does not design it; the Builder runs them against that contract.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 30.5 — Native platform providers and the removal of Postiz. ARCHITECT phase (Track N, agent N1).
You produce TWO artefacts and NO code:
  (a) docs/decisions/0028-native-social-providers.md   (status: Accepted)
  (b) ADR 0002 Amendment A, appended to docs/decisions/0002-social-provider.md
No .ts, no .sql, no .tsx. If you catch yourself writing a provider class, a zod schema body, a migration
or a component, stop: that is the Builder's job (N2), and the constitution requires Architect-attempted
code to be discarded.

PREREQUISITE — verify before anything else. Session 30 (Track G, ADR 0023) must have closed: PR #9 merged
and its correction pass complete. Check docs/current-phase.md. If it has not, STOP and say so.

NUMBERING — do not re-derive this. This session is Track N, numbered 30.5 (session-13-5.md is the
precedent for a .5 insertion) so Sessions 31-34 keep their numbers and every existing cross-reference
stays valid. Its ADR is 0028 because 0024-0027 are already claimed by the build-guides for Sessions
31-34. ADR numbers record authorship order, not execution order. Say that in one line in the ADR.
IMPORTANT: your amendment to ADR 0002 is Amendment A. Session 32's read-path amendment becomes
Amendment B. Do not take B, and do not renumber Session 32's.

ECC BUDGET — FOUR subagent invocations for this whole phase. Stay inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. Ask it for file:line citations and
   the shape of each seam — nothing else.
2. Skills are free. Use ecc:architecture-decision-records so 0028 matches 0016-0023 and so the ADR 0002
   amendment follows the house form (read ADR 0005 Amendment 1 and ADR 0010 Amendment 2 for that form).
   Use claude-mem's mem-search for prior-session context instead of re-reading closed build guides. And
   USE ecc:documentation-lookup for the LinkedIn and X API surfaces — endpoints, scopes, PKCE
   requirements, token lifetimes and rate-limit headers. Do not write an endpoint from memory; if you
   cannot verify a detail, say so explicitly in the ADR and mark it for the Builder to confirm.
3. AFTER you have draft answers to all eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - security-reviewer — on Q1/Q3/Q4: SOSH now owns the OAuth apps, which it never did before. Ask
     specifically: whether client secrets can reach any client bundle, log line or error message; whether
     the PKCE verifier's storage and lifetime are sound and who can read it; whether the existing
     signed-JWT OAuth state still binds the callback to the right business after the broker is gone;
     whether any raw token can escape lib/social/vault.ts; whether revocation-on-disconnect and
     revocation-during-purge_business are complete, and what a FAILED revoke must not block; and whether
     the redirect URI set can be abused across environments.
   - ecc:typescript-reviewer — on L-2 and Q1's signature question: whether the seven-method
     SocialProvider survives two real implementations without widening; whether getOAuthAuthorizeUrl
     should become Promise<string> and what that costs at every caller; whether `Platform | 'multi'` and
     OAuthAuthorizeInput.platform should be removed now that no broker exists; and whether the error
     union genuinely covers both platforms without a new code (L-7 makes a new code a founder
     adjudication, so this matters).
   - ecc:pr-test-analyzer — on L-8/L-9 and Q8: whether ONE shared contract suite over MockProvider +
     LinkedIn + X would actually catch a divergence between implementations; whether fixture-based
     provider tests can prove anything meaningful about a real API; and whether the ADR is honest that
     lib/social/__integration__/ is discovered by NO CI job (docs/backlog.md item
     22E-integration-discovery). A migration that trades a tested broker for two untested providers is
     the failure mode — ask whether the plan actually avoids it.
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.
DO NOT invoke impeccable or taste-skill — you SPECIFY the accounts-surface UX contract (Q8), you do not
design it.

Read now, before anything else:
- docs/build-guide/session-30-5.md — the Reality block (14 items), §0 (Locked L-1..L-12 and the D-1..D-8
  ledger) and §0.1 (the eight questions Q1..Q8 you MUST resolve). This is your binding input.
- docs/decisions/0002-social-provider.md — ALL of it. §2 (the interface you must NOT widen), §3 (the
  supporting types), §4 (the registry and the default-provider pattern), §5 (the PostizProvider spec you
  are deleting), §7 (the OAuth flow contract, including Reversal 3's signed-JWT state and §7 Step 5's
  compensation-on-partial-failure), §8 (token refresh, the 5-minute skew, and the ACCEPTED concurrent-
  refresh race). Your Amendment A is appended to this file.
- docs/decisions/0005-publishing-worker.md §5 (error matrix), §6 (retry policy), §7 (idempotency) — you
  are OUT OF SCOPE to change any of them, and L-7 makes a new error code a founder adjudication.
- docs/decisions/0006-metrics-worker.md — what the metrics worker expects a provider to serve (Q5).
- docs/launch-checklist.md section 16 "Postiz removal" — the eight rows are your definition of done. Do
  not invent a different list. Also section 1's env table, which loses two rows and gains several.
- docs/build-guide/session-32.md — its Reality 3, Q2 and D-2 are written against a Postiz that will no
  longer exist. Read them, and state in your ADR what Session 32 INHERITS from your work (its read path
  becomes ADR 0002 Amendment B against native providers). Do NOT design the read path.
- docs/pre-launch-scope.md — T1-E (founder/personal profiles), which Q4's identity answer must not block,
  and T1-A (engagement inbox), which consumes fetchEngagement later.
- CLAUDE.md — the native-provider rule ("No code outside /lib/social/ ever imports provider directly"),
  the Vault rule and the three-step disconnect, the three-client rule, DB-access, Zod, i18n, atomic
  transitions, bounded queries, the UI Component patterns section (shadcn v4 is Base UI: NO asChild on
  Button or DropdownMenu primitives), and the test-execution-integrity section (the three tiers,
  PROC-REVIEW-AT-COMMIT and SHARED-FUNCTION CALLERS).

The CLOSED file list for the ONE ecc:code-explorer sweep — map these, cite file:line, nothing beyond:
- lib/social/types.ts (the seven-method interface, the error union, every input/output shape),
  lib/social/index.ts (the public surface), lib/social/registry.ts (the default-provider pattern, the
  UNUSED per-platform overrides map, and the production throw), lib/social/errors.ts,
  lib/social/constants.ts.
- lib/social/postiz-provider.ts (what you are deleting — report which of its 379 lines are Postiz-shaped
  and which are behaviours a native provider must reproduce), lib/social/mock-provider.ts (the parity
  target, L-8), lib/social/vault.ts (provider-agnostic, does NOT move — confirm that).
- lib/social/platforms/config.ts (the scopes, supportsRefreshToken and tokenExpiryDays per platform, and
  the three publishingAvailable:false entries with their Meta App Review comments),
  lib/social/platforms/guards.ts, lib/social/oauth/state.ts (the signed-JWT state you REUSE),
  lib/social/connection-status.ts (the four states and the 7-day expiring_soon window — L-6's surface).
- app/api/social/[platform]/connect/route.ts and app/api/social/[platform]/callback/route.ts — the two
  OAuth call sites, their error-redirect codes, and the Vault write sequence.
- lib/publishing/orchestrator.ts and lib/metrics/orchestrator.ts — the other two consumers. Report every
  assumption they make about the provider (SHARED-FUNCTION CALLERS).
- app/api/_health/social/route.ts (it names 'postiz' in its output), lib/observability/csp.ts (the
  postizHost parameter), lib/config.ts (POSTIZ_* and SOCIAL_PROVIDER_MODE, and the serverOnly getter
  pattern any new secret must follow), eslint.config.mjs (SOCIAL_INTERNALS_BAN).
- supabase/migrations/20260430120006_social_accounts.sql — the identity columns and the unique
  constraint (Q4).
- app/[locale]/(dashboard)/settings/accounts/page.tsx and i18n/en|pt|es/common.json — the accounts
  surface and the 'postiz_unavailable' key that leaks the broker's name into user-facing copy.
- lib/social/__tests__/*.test.ts and lib/social/__integration__/ — what exists, and which of it CI
  actually runs (L-9).

Do NOT write either document yet. First OUTPUT your answers to the eight §0.1 questions (Q1 the OAuth
ownership model per platform + the getOAuthAuthorizeUrl signature, Q2 the publish contract per platform,
Q3 token lifecycle including LinkedIn's non-refreshable 60-day death, Q4 platform identity and the schema
question, Q5 metrics per platform and what null honestly means, Q6 error and rate-limit mapping onto the
existing eight-code union, Q7 the removal as an ordered provable operation, Q8 the test plan plus the UX
contract), EACH with its named loser and its ADR 0015 tier, AND a one-line note on any place a §0 Locked
decision constrains the answer. Flag explicitly if any answer needs: a new SocialProviderErrorCode, a
social_accounts migration, native media upload inside this session, a change to ADR 0005's status machine
or retry policy, a new dependency, or a platform review process whose calendar time this session cannot
control — those are founder adjudications, not your call. Then STOP for acknowledgement.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 30.5. Write BOTH documents. Ground every claim in the real repo (cite file:line from
the ecc:code-explorer sweep) and every platform API claim in a source you actually looked up via
ecc:documentation-lookup — where you could not verify one, SAY SO in the text and mark it
"BUILDER MUST CONFIRM". You have already dispatched your ONE batch of three advisory reviewers — fold
their objections in now, or record why you rejected them. Do not re-consult them.

=== DOCUMENT A: docs/decisions/0028-native-social-providers.md (Accepted) ===

1. Context + decision summary. What exists today (a single brokered 'multi' provider that also owns the
   OAuth handshake, so SOSH holds no platform credentials at all — lib/social/registry.ts:31-56,
   postiz-provider.ts:84-96), what this replaces it with, and why the migration runs BEFORE the quality
   programme rather than after it (D-1: Session 32 otherwise designs a read contract against a broker it
   would then have to re-implement — session-32.md:241-244). One line on ADR numbering: 0028 is the next
   unclaimed number; 0024-0027 belong to the guides for Sessions 31-34; ADR numbers record authorship
   order, not execution order. Name the losers per §0 D-1..D-8.

2. The OAuth ownership model, per platform (Q1) — the load-bearing section. LinkedIn and X separately:
   app registration and review status; the EXACT publishing scopes, checked against what
   platforms/config.ts:19-27 requests today (if the shipped list is wrong for native publishing, correct
   it and say so); authorize URL construction; PKCE — required or not, and if so where the verifier
   lives, for how long, who can read it, and how it is cleaned up (L-4); the enumerated redirect URI set
   for local / preview / production; how the existing signed-JWT state (ADR 0002 Reversal 3) rides along
   unchanged; and the code-exchange request/response FIELD LISTS for the Builder's Zod schemas (field
   lists, not schema code). Then answer the signature question: does getOAuthAuthorizeUrl become
   Promise<string>? Name the loser and list every caller the change touches.

3. The publish contract, per platform (Q2). Endpoint and API version; the author identity each call needs
   (LinkedIn author URN, person vs organization) and where it comes from — which is section 5's input;
   how content + hashtags + mediaUrls map onto the request, INCLUDING what happens to mediaUrls if
   native media upload is a separate API call (if that lands here it widens the session — flag it; if it
   defers, say what a post with media does instead of silently dropping it); character and media limits
   and where they are enforced; what PublishResult.url is per platform; and how each provider satisfies
   ADR 0005 section 7's idempotency model WITHOUT changing it.

4. Token lifecycle, per platform (Q3). X's refresh flow and whether the refresh token itself rotates — if
   it does, state plainly whether ADR 0002 section 8's ACCEPTED concurrent-refresh race gets worse and
   whether it stays accepted. LinkedIn's absence of refresh and its 60-day death: what token_expires_at
   is set to at connect, how withFreshToken behaves when refresh is impossible, which of the eight error
   codes a dead token produces mid-campaign and what ADR 0005 section 5 already does with it, and what
   the user sees via connection-status.ts's existing expiring_soon window (L-6 — no new surface, no new
   email; name the email as a follow-on WITH ITS TRIGGER). Plus revocation per platform, and what a
   FAILED revoke must not block during disconnect or purge_business (L-11).

5. Platform identity and the schema question (Q4). Whether social_accounts.platform_user_id carries the
   author URN or a migration lands; if it lands, additive with its stated backfill; what happens to
   UNIQUE (business_id, platform, platform_user_id) when a business connects both a personal and an
   organization LinkedIn identity, and what pre-launch-scope.md T1-E inherits from this answer. Decide
   the fate of OAuthAuthorizeInput.platform (types.ts:26-28) and of SocialProvider.platform's | 'multi'
   member (types.ts:119) — both exist only to describe a broker.

6. Metrics per platform (Q5). A table: platform x each of the seven PostMetrics fields -> served /
   requires an access tier we do not have / permanently unavailable. Distinguish "not fetched this tick"
   from "never available", because lib/metrics/orchestrator.ts:56-72 writes both as null and Session 33
   builds pattern extraction on these rows behind a minimum-n floor. State whether the metrics worker's
   cadence survives each platform's rate limits.

7. Error and rate-limit mapping (Q6, L-7). A table: platform x HTTP status x response-body shape -> one
   of the EIGHT existing SocialProviderErrorCode values, each with its consequence in ADR 0005 section 5's
   error matrix and section 6's retry policy. Retry-After and platform rate-limit headers handled
   explicitly. FLAG, do not add, any case no existing code fits.

8. The removal, as an ordered and provable operation (Q7, L-3, L-10). The step order that keeps master
   green at EVERY commit, with the losing order's breakage named. The eslint.config.mjs
   SOCIAL_INTERNALS_BAN rewrite — the new provider modules banned from deep import in the SAME change
   that drops the postiz entry. The buildCsp postizHost removal and its test. The lib/config.ts and
   .env.local.example deltas, with every new per-platform variable named and its absence-behaviour in
   production stated (LinkedIn configured, X not — what does the registry do?). The health route's new
   provider naming. The postiz_unavailable i18n key in en/pt/es and its replacement. And the exact form
   of the SOCIAL-NO-POSTIZ scan: its file, what it greps, and the paths it legitimately exempts
   (docs/decisions/, docs/reviews/). Close by mapping each of launch-checklist.md section 16's eight rows
   to the constraint that closes it.

9. GDPR + tenancy (L-11). If section 5's migration lands: RLS in the InitPlan-wrapped form with USING and
   WITH CHECK on UPDATE, ON DELETE CASCADE, the ADR 0010 Amendment 2 section D2.5 cascade row VERBATIM,
   and purge_business coverage. If a PKCE-verifier store lands, the same in full. If NEITHER lands, say
   so explicitly and state that no D2.5 row is required — an explicit "no row needed" is the Session 28-D
   D7 precedent and it is what a reviewer checks for.

10. The UX contract the Builder is held to — you SPECIFY it, you do not design it (Q8): the accounts
    settings surface across the four existing ConnectionStatus values, the LinkedIn reconnection copy,
    per-platform availability copy for the three Meta platforms that still cannot publish, every OAuth
    error-redirect code and its message, the accessibility floor, the Server Component page + Client
    interaction split, Zod on every Server Action, shadcn v4 / Base UI with NO asChild on Button or
    DropdownMenu primitives, Tailwind only, i18n en/pt/es simultaneously. Note that the Builder runs
    impeccable against this contract.

11. Test plan across the tiers (Q8). Tier 2: the ONE shared contract suite run against MockProvider,
    LinkedInProvider and TwitterProvider (L-8) — say which behaviours it asserts for all and which are
    legitimately per-platform; each provider's fixture tests; OAuth state and PKCE; the error mapping
    table; the registry's per-platform routing and its production-absence behaviour; the CSP delta; the
    SOCIAL-NO-POSTIZ scan. Tier 1: whatever section 5's migration adds. Tier 3: properties of absence,
    enumerated as such. State lib/social/__integration__/'s position in L-9's exact words —
    AUTHORED-NOT-EXECUTED until backlog item 22E-integration-discovery is closed. Name the fixture
    directories. State what is honestly untestable (a real platform's rejection behaviour cannot be
    asserted from a fixture) and what compensates.

12. A constraint table: every named constraint (SOCIAL-*), its test tier, and the test that will prove it
    — this is the Reviewer's checklist. Cover at least: SOCIAL-NO-POSTIZ, SOCIAL-PROVIDER-BOUNDARY
    (nothing outside lib/social/ imports a provider directly), SOCIAL-INTERFACE-UNWIDENED,
    SOCIAL-CONTRACT-SUITE-ALL-PROVIDERS, SOCIAL-TOKENS-VAULT-ONLY, SOCIAL-SECRETS-SERVER-ONLY,
    SOCIAL-STATE-JWT-BOUND, SOCIAL-PKCE-BOUND (or its recorded absence, per platform),
    SOCIAL-ERRORS-EXISTING-UNION, SOCIAL-RATE-LIMIT-MAPPED, SOCIAL-LINKEDIN-EXPIRY-SURFACED,
    SOCIAL-REVOKE-ON-DISCONNECT, SOCIAL-REVOKE-FAILURE-NON-BLOCKING, SOCIAL-META-STILL-UNAVAILABLE,
    SOCIAL-CSP-NARROWED, and SOCIAL-WORKER-UNCHANGED (ADR 0005's status machine, retry policy and
    idempotency model are byte-unchanged — an executable diff scan, not a review comment).

13. Explicit "deferred" section: the read path and 19D-5 (Session 32, as ADR 0002 Amendment B — say what
    it inherits from this ADR); Meta-family publishing and the App Review process, with what is actually
    outstanding per platform; the engagement inbox (T1-A) and what fetchEngagement can serve per platform
    today; founder/personal profiles (T1-E) and what section 5 leaves them; native media upload if you
    deferred it; the reconnection email with its trigger; and closing 22E-integration-discovery.

=== DOCUMENT B: ADR 0002 Amendment A — Native providers replace the broker ===

Append to docs/decisions/0002-social-provider.md, following the house form of ADR 0005 Amendment 1 and
ADR 0010 Amendment 2. It must contain:
 (a) Why the amendment exists: section 5 specifies a PostizProvider that no longer exists, and section 4's
     default-provider pattern is replaced by per-platform registration through the overrides map that
     registry.ts:9-20 already has.
 (b) What in ADR 0002 is UNCHANGED and is load-bearing: the section 2 interface, Reversal 1 (methods take
     socialAccountId, never raw tokens), Reversal 3 (signed-JWT state), the section 7 OAuth flow contract
     including Step 5's compensation-on-partial-failure, and the Vault read pattern. Say this plainly:
     most of ADR 0002 survives the migration intact, and that is the evidence the abstraction was right.
 (c) What is SUPERSEDED: section 5 in full, and section 4's single-default assumption. Superseded text is
     marked as superseded and left in place — this repo does not rewrite landed ADRs.
 (d) Any signature change from Q1 (getOAuthAuthorizeUrl) and any type change from Q4
     (OAuthAuthorizeInput.platform, SocialProvider.platform's 'multi'), each with its caller list.
 (e) The section 8 token-lifecycle delta: refresh is now per-platform, LinkedIn cannot refresh at all, and
     the accepted concurrent-refresh race is re-stated as still-accepted or escalated (Q3).
 (f) One line reserving Amendment B for Session 32's read path, so that session does not collide with
     this one.

Do NOT write code. End with one line: "ADR 0028 written and accepted — <n> SOCIAL-* constraints, <n>
native providers, PKCE <platforms>, <n> new env vars, schema migration <yes|no>, new error code
<none|name>, ADR 0002 Amendment A supersedes sections <list>." Then /exit.
```

**Gate:** do not author §2 until **both** documents exist, ADR 0028 is Accepted, ADR 0002 Amendment A is
appended, and the eight §0.1 answers are on the record. **If any answer required founder adjudication,
that adjudication is recorded in `§0.2` above before the Builder starts** — exactly as Sessions 22–30 did,
and even if the recorded content is "no adjudications were required." Then author §2/§3/§4 below from the
accepted ADR's real `SOCIAL-*` constraint names.

---

## §2 — Builder session (N2)  ·  (paste into Claude Code · Sonnet)

> **PLACEHOLDER — authored after ADR 0028 is Accepted, ADR 0002 Amendment A is appended, and §0.2 is
> recorded.** Do not write this section speculatively: the steps must cite the ADR's *real* `SOCIAL-*`
> constraint names, and written earlier they would cite constraints that do not exist and re-derive
> decisions the ADR already made against a named loser.

**What this section will contain when authored:**

- **§2a — Builder primer** (one paste block, ending by stopping for acknowledgement): the role and its
  boundary; the ECC budget for the Builder phase; the binding §0 Locked list L-1…L-12 and the D-1…D-8
  ledger; §0.2's rulings; the ADR's constraint table as the definition of done; the verification loop
  (`npx tsc --noEmit --skipLibCheck`, `npx vitest run lib/db lib/social lib/validation`, plus the db-test
  suite if Q4's migration landed); and the commit discipline — each step green and committed before the
  next.
- **§2b — Builder steps `N2.0 … N2.n`**, one paste block each, each a self-contained
  `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle naming **the ADR constraints it closes
  and the test that proves each**. A step that closes no constraint does not exist.
- **The preamble prose**, which is not optional: the hard rules every step inherits, and the ADR decisions
  the Builder **transcribes rather than re-derives** — the scope lists, the endpoint and scope tables, the
  error-mapping table, and the removal order.

**Ordering, and why (this is the part a later session must not re-litigate):**

1. **The shared contract suite lands first, against `MockProvider` alone.** It must be green before a
   single native line exists, because it is the only artefact that can prove the two new implementations
   agree with each other and with the mock (L-8). Writing it after the providers guarantees it is shaped
   to whatever they happened to do.
2. **Then the OAuth ownership machinery** — config surface, PKCE storage if Q1 requires it, the authorize
   and callback paths — because both providers depend on it and because Q1 is the answer most likely to
   have been wrong (Reality §2).
3. **Then one provider end to end, then the second.** The first proves the seam; the second proves the
   seam is a seam and not a LinkedIn-shaped hole. Both are registered through `registry.ts`'s existing
   `overrides` map.
4. **Then Q4's migration, if one landed**, with its Tier-1 tests.
5. **Postiz is deleted LAST, in its own commit** — the file, both test files, the env vars, the CSP
   parameter, the ESLint entry, the health-route name, the i18n key — so that the removal diff is
   readable on its own and revertible on its own. The `SOCIAL-NO-POSTIZ` scan lands in the same commit
   and is what makes the deletion provable rather than asserted.
6. **`impeccable` runs against the ADR's §10 UX contract**, not before it and not instead of it, on the
   accounts settings surface only.

**Scope tripwires — each becomes an executable scan, not a review comment:**

- `SOCIAL-NO-POSTIZ` — `grep -ri postiz` over the repo, exempting `docs/decisions/` and `docs/reviews/`.
- `SOCIAL-WORKER-UNCHANGED` — a diff scan proving `lib/publishing/orchestrator.ts`'s status machine, retry
  policy and idempotency handling are unchanged (L-1 forbids touching ADR 0005; a native provider that
  needed the worker changed is a flag, not a fix).
- `SOCIAL-PROVIDER-BOUNDARY` — the rewritten `eslint.config.mjs` ban list, asserted by a test rather than
  trusted to lint config alone (the existing `lib/email/__tests__/eslint-all-bans.test.ts` is the
  precedent for asserting a ban list in a test).
- `SOCIAL-META-STILL-UNAVAILABLE` — `publishingAvailable` remains `false` for instagram, facebook and
  threads; a Builder that "helpfully" flips one has shipped a promise the platform has not granted.
- `SOCIAL-NO-READ-PATH` — no `fetchRecentPosts` / `listRecentPosts` member appears on `SocialProvider`.
  That is Session 32's, and a Builder finding it convenient to add here has widened the session.

**Process rules this section inherits:** SHARED-FUNCTION CALLERS for all five consumers in Reality §6 —
before marking any constraint on a shared function as tested, `git grep` its callers and list, per caller,
which test file exercises it; a caller with no listed test is `AUTHORED-NOT-EXECUTED` for that caller.

**✅ AUTHORED 2026-09-03 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Gate satisfied: ADR 0028 is **Accepted** (`16a96851`,
amended by `e4aafd75`, `78ae2ecb`, `54110178`), ADR 0002 Amendment A is appended, and `§0.2` records
**A-1 … A-8a** with the Architect's superseded recommendations preserved verbatim (A-6, A-7).

**Ordering rationale, restated because it is binding.** The order below is not a preference; each position
is forced by something that breaks under the alternative.

1. **`N2.0` grounds and `N2.1` verifies the platform facts — and neither writes production code.**
   ADR 0028 §13 lists **nine unverified platform facts** and says in its own words: *"No unverified
   endpoint may be written from memory. Where verification fails, the honest outcome is `NOT_IMPLEMENTED`
   and a stated gap — never a plausible-looking URL."* A provider written before §13 is closed is a
   provider written from memory. This is the largest risk in the session and it is bought down first, for
   the price of two steps that ship nothing.
2. **The shared contract suite lands next, against `MockProvider` alone** (`N2.2`). It must be green
   before a single native line exists, because it is the only artefact that can prove the two new
   implementations agree with each other and with the mock (L-8). Written after the providers, it is
   shaped to whatever they happened to do.
3. **Both migrations land before any code that depends on them** (`N2.3`, `N2.4`). `vault_update_secret`
   is a **hard prerequisite for native X**, not a cleanup: D-α means token refresh has never worked, and
   X rotates its refresh token on a two-hour access token.
4. **The dual-identity resolver (`N2.5`) precedes the providers**, because `lib/publishing/orchestrator.ts`
   must already know *which identity* it is publishing as before a provider exists that can publish.
5. **Then the OAuth ownership machinery** (`N2.6`) — the shared redirect-URI helper, PKCE, the connect and
   callback paths — because both providers depend on it and because Q1 is the answer most likely to have
   been wrong (Reality §2).
6. **Then one provider end to end, then the second** (`N2.7`, `N2.8`). The first proves the seam; the
   second proves the seam is a seam and not a LinkedIn-shaped hole.
7. **Postiz is deleted LAST, in its own commit** (`N2.11`) — the file, both test files, the env vars, the
   CSP parameter, the ESLint entry, the health-route name, the i18n key, and the surfaces `N2.0` finds
   that ADR 0028 §8.3 does not list. The removal diff must be readable on its own and revertible on its
   own.
8. **The UX surface lands after the removal** (`N2.12`), because it consumes the replacement i18n key that
   `N2.11` creates. **`taste-skill` builds it and `impeccable` reviews it, both against ADR 0028 §9.4's
   contract** — not against their own taste.

**Two orderings the ADR forces and that a Builder will get wrong unless told:**

- **`SOCIAL-NO-MULTI-PLATFORM` cannot land before `N2.11`.** `postiz-provider.ts:59` declares
  `readonly platform = 'multi'`. Removing the union member while that file exists fails `tsc`. The
  constraint is closed **in the deletion commit**, not in the interface commit.
- **`getOAuthAuthorizeUrl` becoming `Promise<string>` (`N2.2`) breaks `PostizProvider`'s signature.** It
  gets `async` added — one word — in that same commit, and nothing else. That one word is the entire cost
  of keeping `master` green across the interface change.

**A correction to ADR 0028 that `N2.0` is expected to produce.** A repo-wide `grep -ril postiz` at
`54110178` returns **Postiz surfaces §8.3's delta table does not list**: three `postiz:*` npm scripts in
`package.json`; the whole self-hosted stack under `infra/` (`docker-compose.yml`,
`caddy/Caddyfile.example`, `README.md`); **`proxy.ts:68-72`, the *only* `buildCsp` caller, which computes
`postizHost` from `POSTIZ_BASE_URL`**; comments in `vitest.config.ts:31` and `vitest.integration.config.ts`;
fifteen files under `docs/build-guide/`; and — the one that will surprise the scan — **three test fixtures
whose brand-memory content is literally the string `'We integrate natively with Postiz'`**
(`lib/memory/brand.test.ts:30`, `lib/db/memory-brand.test.ts:25`,
`supabase/__tests__/governed-memory-rls.test.ts:17`). Those three are legitimate test *data*, not a broker
reference. **`SOCIAL-NO-POSTIZ`'s exemption list in ADR 0028 §8.4 (`docs/decisions/`, `docs/reviews/`, the
scan file) is therefore insufficient.** `N2.0` publishes the full surface and `N2.11` resolves every hit as
**deleted, renamed, rewritten, or exempted with a stated reason**. The fixtures are **renamed, not
exempted** — an exemption list grown to make a scan pass is the failure `SOCIAL-NO-POSTIZ` exists to catch.

**Definition of done for every step:** `npm run typecheck` clean, `npm run test:app` green,
`npm run test:db` green where the step touches DB behaviour, each named constraint **demonstrated to
redden against the pre-fix code and then reverted**, and one commit per step naming the step id and the
constraints it closes.

**ECC budget for the Builder phase — three subagent invocations, total.** One `ecc:code-explorer` sweep in
`N2.0` over that step's closed file list and no other; **one** `ecc:database-reviewer` scoped to `N2.3`
**and** `N2.4` together, before either is committed; **one** `ecc:security-reviewer` scoped to `N2.6` alone
(PKCE, cookie attributes, redirect-URI derivation, secret egress). **No reviewer per step, and no
re-consultation.** Skills are free and do not count against the budget: `/ecc:plan`, `/ecc:tdd-workflow`,
`/ecc:verification-loop` on every step; `ecc:documentation-lookup` throughout `N2.1`;
`supabase:supabase-postgres-best-practices` while authoring the two migrations; **`taste-skill` and
`impeccable` in `N2.12` only**.

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 30.5 Track N - BUILDER phase (N2). You implement ADR 0028 and ADR 0002 Amendment A. You write
code; you do NOT make architectural decisions. Every decision you need has already been made and carries a
named loser. If you find yourself choosing between two designs, STOP and report - that is an ADR gap, not
your call.

READ FIRST, in this order:
- docs/decisions/0028-native-social-providers.md - ALL of it. Pay particular attention to Section 13
  (verified vs UNVERIFIED platform facts), Section 14.1 (staged verification, A-5-prime, superseded in
  part by A-8), and Section 16 (stated-open items). Where Section 14.1's blockquote marks an argument
  WITHDRAWN, the withdrawal wins and the original text is left standing deliberately.
- docs/decisions/0002-social-provider.md - Amendment A, plus Sections 2, 3, 7 and 8, which survive intact.
- docs/build-guide/session-30-5.md - Reality 1-14, Section 0 (Locked L-1..L-12 and ledger D-1..D-8), and
  Section 0.2 (adjudications A-1..A-8a). SECTION 0.2 IS YOUR GATE. Every row must end up encoded.
- CLAUDE.md - the /lib/social/ boundary rule, the Vault rule, the three-Supabase-client rule, the RLS and
  erasure-cascade rules, atomic transitions, Zod, i18n, bounded queries, and the test-execution-integrity
  section.

BINDING RULES YOU WILL BE REVIEWED AGAINST:

1. NO UNVERIFIED ENDPOINT IS WRITTEN FROM MEMORY. ADR 0028 Section 13 lists nine unverified facts. N2.1
   closes them against vendor documentation before any provider is implemented. Where verification fails,
   the honest outcome is a method throwing NOT_IMPLEMENTED plus a stated gap - never a plausible-looking
   URL. A fabricated endpoint that ships is the worst single outcome available in this session.

2. ORDER. N2.0 and N2.1 produce NO production code. The contract suite (N2.2) is green before any native
   provider exists. Both migrations (N2.3, N2.4) land before the code that depends on them. Postiz is
   deleted LAST, in its own commit (N2.11). Do not interleave the deletion with provider work.

3. SOCIAL-NO-MULTI-PLATFORM lands in N2.11, NOT earlier. postiz-provider.ts:59 declares
   readonly platform = 'multi'; removing the union member while that file exists fails tsc.

4. getOAuthAuthorizeUrl becomes Promise<string> in N2.2. PostizProvider gets the word `async` added and
   NOTHING else in that commit. connect/route.ts:56 already awaits it and connect.test.ts:78 already mocks
   with mockResolvedValue - the change is source-compatible at every call site (ADR 0028 Section 2.6).

5. lib/publishing/orchestrator.ts's STATUS MACHINE, RETRY POLICY and IDEMPOTENCY MODEL are NOT modified
   (L-1, unamended by A-7). You MAY change how it RESOLVES a social account (N2.5, ADR 0028 Section 5.3);
   you may NOT change what it does with a status, an attempt count or a retry. If a native provider
   appears to require that change, STOP and report - it is an ADR 0005 amendment and a founder
   adjudication, not a fix.

6. publishingAvailable stays FALSE for instagram, facebook and threads, and NO provider is registered for
   them (A-1, SOCIAL-META-NOT-REGISTERED). Flipping one to true ships a promise the platform has not
   granted.

7. NO READ PATH. No fetchRecentPosts, listRecentPosts or equivalent member appears on SocialProvider. That
   is Session 32 and it lands as ADR 0002 Amendment B.

8. SECRETS. Client ids and secrets are read ONLY through lib/config.ts's serverOnly() getters. All six
   already exist and are unused (config.ts:126-131, :325-330, :546-562) - you add ZERO new environment
   variables. This CORRECTS build-guide Reality 11, which says four are needed; the real number is zero.
   No secret appears in a database table, a TypeScript type, a log line, an error message, or any
   SocialProviderError.details payload.

9. NO CREDENTIALS EXIST AND NONE ARE NEEDED (ADR 0028 Section 14.1). All six default to ''. Registry
   absence behaviour is PER-PLATFORM, not app-wide. Every Tier-2 test runs offline under
   SOCIAL_PROVIDER_MODE=mock against recorded fixtures. If you find yourself blocked waiting for a
   credential, you have left the plan.

10. LINKEDIN SHIPS MEMBER-ONLY (A-8). Request w_member_social. Do NOT add w_organization_social - an app
    cannot request a scope it has not been granted, and the Community Management API needs a registered
    legal entity that does not exist. The dual-identity schema and resolver are STILL BUILT (A-8a): they
    stand on X, where a business can hold two active rows TODAY.

11. Every platform API response is Zod-validated before use. A parse failure is PLATFORM_REJECTED with the
    Zod message in details. Raw `as` casts on a provider response were a named Session 17 correction.

12. Contract discipline: Zod on every route and Server Action input; atomic conditional UPDATEs, never
    read-then-update; every list query bounded with an explicit ORDER BY matching an index; date-fns and
    toUtcIso(), never raw .toISOString(); no `any`; no console.* outside the single canonical worker line;
    env only via lib/config.ts; DB only via lib/db/; service-role never in a user-facing read path; i18n
    en/pt/es landed together and registered in i18n/request.ts.

13. shadcn v4 is Base UI: NO asChild on Button or DropdownMenu primitives. Use buttonVariants() for a link
    styled as a button.

14. SHARED-FUNCTION CALLERS. Before you mark any constraint on a shared function as tested, git grep its
    callers and state, PER CALLER, which test file exercises it. A caller with no listed test is
    AUTHORED-NOT-EXECUTED even if another caller is fully covered. This session has two such functions:
    getActiveByBusinessAndPlatform (three production callers - disconnect/route.ts:41,
    metrics/orchestrator.ts:64, publishing/orchestrator.ts:104, NONE of which currently tests the
    multi-row case) and the provider surface itself (five consumers, build-guide Reality 6). Both Session
    22 blockers were exactly this failure.

ECC BUDGET FOR THIS PHASE: THREE subagent invocations, total. One ecc:code-explorer in N2.0 over that
step's closed file list. One ecc:database-reviewer scoped to N2.3 AND N2.4 together. One
ecc:security-reviewer scoped to N2.6 alone. No reviewer per step, no re-consultation. Skills are free:
/ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop on every step; ecc:documentation-lookup
throughout N2.1; supabase:supabase-postgres-best-practices while authoring the migrations; taste-skill and
impeccable in N2.12 ONLY, against ADR 0028 Section 9.4.

VERIFICATION, every step: npm run typecheck ; npm run test:app ; npm run test:db (where the step touches
DB behaviour). Each named constraint must be DEMONSTRATED TO REDDEN against the pre-fix code and then
reverted - an assertion that cannot fail is not coverage. One commit per step, subject naming the step id
and the constraints it closes.

Acknowledge in one line confirming you have read ADR 0028 including Sections 13, 14.1 and 16, and that you
understand rule 1 (no endpoint written from memory) and rule 10 (LinkedIn ships member-only). Then STOP
and wait for the step list.
```

### §2b — Builder steps

Each step is one paste, one commit. **A step that closes no ADR constraint does not exist** — `N2.0` and
`N2.1` are the two deliberate exceptions, and both are risk-retirement steps that ship nothing.

| Step | What it ships | Constraints closed | Tier |
|---|---|---|---|
| **N2.0** | **Grounding pass, no code, no commit.** Re-verify Reality 1-14 and every `file:line` ADR 0028 cites; publish the full `grep -ril postiz` surface against §8.3's table. | — | — |
| **N2.1** | **Platform-fact verification, no production code.** Close ADR 0028 §13's nine unverified items against vendor docs; append the findings to §13/§14 as a Builder-attributed record. | — | — |
| **N2.2** | **The shared contract suite + the one interface change.** `provider-contract.test.ts` over `MockProvider`; `getOAuthAuthorizeUrl` becomes `Promise<string>`. | `SOCIAL-AUTHORIZE-ASYNC`, `SOCIAL-MOCK-MODE-OFFLINE` | 2 |
| **N2.3** | **Migration A — `public.vault_update_secret`** (D-α), service-role-only `EXECUTE`, in-place semantics. | `SOCIAL-VAULT-UPDATE-SECRET` | **1** |
| **N2.4** | **Migration B — `posts.social_account_id`**, nullable FK, `ON DELETE SET NULL`, cascade-table row. | `SOCIAL-DUAL-IDENTITY-SCHEMA` | **1** |
| **N2.5** | **The dual-identity resolver** across all three production callers, with `account_ambiguous`. | `SOCIAL-DUAL-IDENTITY-RESOLVER` | 2 |
| **N2.6** | **OAuth ownership machinery** — one redirect-URI helper (D-β), PKCE cookie, state binding, secret containment. | `SOCIAL-REDIRECT-URI-MATCH`, `SOCIAL-PKCE-COOKIE`, `SOCIAL-PKCE-NOT-IN-STATE`, `SOCIAL-STATE-BINDS-BUSINESS`, `SOCIAL-NO-SECRET-EGRESS` | 2 + 3 |
| **N2.7** | **`LinkedInProvider` end to end** — authorize, exchange, publish, expiry, revoke, media guard. | `SOCIAL-LI-AUTHOR-URN`, `SOCIAL-LI-POSTID-FROM-HEADER`, `SOCIAL-LI-EXPIRY-REVOKED`, `SOCIAL-MEDIA-GUARD`, `SOCIAL-REVOKE-NEVER-BLOCKS` | 1 + 2 |
| **N2.8** | **`TwitterProvider` end to end** — PKCE authorize, exchange, publish, rotation-aware refresh. | `SOCIAL-X-EXPIRY-FROM-RESPONSE`, `SOCIAL-VAULT-UPDATE-CHECKED` | 2 |
| **N2.9** | **Error and rate-limit mapping**, table-driven, one case per §7.2 row; plus ADR 0005 §5's amendment (A-7). | `SOCIAL-ERROR-MAPPING`, `SOCIAL-RATE-LIMIT-RETRY-AFTER`, `SOCIAL-ERR-MATRIX-TRUE` | 2 + 3 |
| **N2.10** | **The registry becomes overrides-only**; contract suite extended to all three implementations. | `SOCIAL-REGISTRY-PER-PLATFORM`, `SOCIAL-META-NOT-REGISTERED`, `SOCIAL-CONTRACT-ALL-PROVIDERS` | 2 |
| **N2.11** | **The removal, in its own commit** — every surface `N2.0` found, plus the scan that proves it. | `SOCIAL-NO-POSTIZ`, `SOCIAL-INTERNALS-BAN-REPLACED`, `SOCIAL-NO-MULTI-PLATFORM`, `SOCIAL-CSP-NO-POSTIZ-HOST`, `SOCIAL-HEALTH-PER-PLATFORM`, `SOCIAL-I18N-NO-BROKER-KEY` | 2 + 3 |
| **N2.12** | **The accounts surface** — five states, dual identity, seven error codes; `taste-skill` + `impeccable` against §9.4. | (renders `SOCIAL-DUAL-IDENTITY-*`, `SOCIAL-META-NOT-REGISTERED`, `SOCIAL-I18N-NO-BROKER-KEY`) | 2 |
| **N2.13** | **Scope scans and the verification pass** — four executable tripwires, the constraint-to-CI map, §5's doc updates. | `SOCIAL-INTEGRATION-NOT-EXECUTED`, plus the four tripwires below | 3 |

**Four scope tripwires, executable rather than advisory** (`N2.13`), each with a per-root vacuity guard and
each demonstrated to redden against a temporary violation:

- **`SOCIAL-WORKER-UNCHANGED`** — a diff scan proving `lib/publishing/orchestrator.ts`'s status machine,
  retry policy and idempotency handling are unchanged (L-1). **Account resolution is the one permitted
  change** (`N2.5`) and the scan is written to allow exactly that and nothing else.
- **`SOCIAL-PROVIDER-BOUNDARY`** — the rewritten `eslint.config.mjs` ban list asserted **by a test**, not
  trusted to lint config alone. `lib/email/__tests__/eslint-all-bans.test.ts` is the shipped precedent.
- **`SOCIAL-META-STILL-UNAVAILABLE`** — `publishingAvailable` remains `false` for instagram, facebook and
  threads.
- **`SOCIAL-NO-READ-PATH`** — no `fetchRecentPosts` / `listRecentPosts` member on `SocialProvider`.

**Do not claim a constraint count until it is executed green in CI at the head it is dated to.** Session 28
shipped a false *"29/29 executed green"* that took three correction steps to undo.

The fourteen pastes follow, one per step.

#### N2.0 — Grounding pass: re-verify every ADR premise and publish the real Postiz surface  ·  no code, no commit

```
BUILDER - Session 30.5 - N2.0. NO CODE, NO COMMIT. Produce a premise -> file:line -> still-true? table
before anything is built. ADR 0028 cites roughly sixty exact locations; if any has drifted, the step that
depends on it is not built until the drift is reconciled and recorded here. Session 26's C2.0 and Session
29's F1b.0 are the precedents for this step existing at all.

Invoke ecc:code-explorer ONCE over exactly this closed file list and no other - this is the phase's only
exploration sweep:
  lib/social/types.ts, registry.ts, postiz-provider.ts, mock-provider.ts, vault.ts, errors.ts,
  connection-status.ts, platforms/config.ts, oauth/state.ts
  app/api/social/[platform]/connect/route.ts, callback/route.ts, disconnect/route.ts
  app/api/_health/social/route.ts
  lib/publishing/orchestrator.ts, lib/metrics/orchestrator.ts
  lib/db/social-accounts.ts, lib/db/posts.ts
  lib/config.ts, lib/observability/csp.ts, proxy.ts, eslint.config.mjs
  supabase/migrations/20260430120006_social_accounts.sql
  supabase/migrations/20260430120010_posts.sql
  supabase/migrations/20260516180000_vault_write_helpers.sql
Ask it ONE question: "for each file, what does it currently do with the social provider, its tokens, its
identity columns, and Postiz specifically - with line numbers?" Do not ask it to propose changes.

VERIFY these premises specifically, each load-bearing for a named later step:
- D-alpha: grep the WHOLE repo for vault_update_secret. ADR 0028 Section 4.1 says
  20260516180000_vault_write_helpers.sql defines only vault_create_secret (:8) and vault_delete_secret
  (:25), and that postiz-provider.ts:255,262 calls client.rpc('vault.update_secret') - an undefined,
  dotted name - without checking error. Confirm all three facts yourself. If the function DOES exist, N2.3
  changes shape and you STOP and report.
- D-beta: connect/route.ts:53 derives redirect_uri from request.nextUrl.origin; callback/route.ts:83
  derives it from config.server.APP_URL. Confirm the mismatch is still present.
- D-gamma: postiz-provider.ts:370 writes Postiz's integrationId into platform_user_id. Confirm.
- getActiveByBusinessAndPlatform at lib/db/social-accounts.ts:137 uses .maybeSingle() and throws at :138.
  git grep its callers across the WHOLE repo including tests. ADR 0028 Section 5.3 says THREE production
  callers: disconnect/route.ts:41, metrics/orchestrator.ts:64, publishing/orchestrator.ts:104. Confirm the
  count yourself and publish the caller table. If you find a fourth, Section 5.3 is stale - STOP and
  report before building.
- Confirm NO existing test covers the multi-row case: metrics/orchestrator.test.ts:119,194 and
  publishing/orchestrator.test.ts:169,415 mock a single account or null.
- registry.ts:9-20 (the overrides map), :11 (the required default), :14 (the fallback), :31-56 (the mode
  branch and the production throw). Confirm register() is called only in registry.test.ts:88.
- types.ts:7-15 (the EIGHT error codes), :118-134 (the seven methods), :119 (platform, incl. 'multi'),
  :121 (getOAuthAuthorizeUrl declared SYNC), :26-28 (OAuthAuthorizeInput.platform and its Postiz comment),
  :63-68 (PublishInput), :71-75 (PublishResult), :78-87 (PostMetrics, seven nullable fields).
- lib/config.ts:126-131, :325-330, :546-562 - all SIX native credentials already exist and are unused.
  CONFIRM THIS. ADR 0028 Section 2.1 corrects build-guide Reality 11's claim that four new variables are
  needed; the real number is ZERO.
- platforms/config.ts:16-27 (LinkedIn 60 days / no refresh; X null expiry / refresh + offline.access) and
  :32,:40,:48 (publishingAvailable false for the Meta three, with their App Review comments).
- lib/social/vault.ts:85-89 (withFreshToken's injected refresh callback) and :104-107 (the null-expiry
  branch that disables proactive refresh - this is WHY X's tokenExpiryDays: null is a defect).
- connection-status.ts:5 - confirm there are FIVE ConnectionStatus values, not four. ADR 0028 Section 9.4
  corrects the build guide's Q8 on this.
- publishing/orchestrator.ts:208-305 - confirm all eight real error codes are handled and that
  NOT_IMPLEMENTED and PROVIDER_NOT_CONFIGURED are in the terminal group at :301-305 (A-7: the CODE is
  right, only ADR 0005 Section 5's PROSE is wrong).
- vitest.config.ts - confirm exclude contains '**/__integration__/**' (ADR 0028 Section 9.3 cites :40).
- i18n/{en,pt,es}/common.json - confirm the postiz_unavailable key and its line, in all three.

THEN PUBLISH THE FULL REMOVAL SURFACE. Run:
  grep -ril postiz --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=.wolf .
ADR 0028 Section 8.3's delta table is INCOMPLETE and this step exists partly to prove by how much. At
54110178 the scan additionally returns, and Section 8.3 does not list: three postiz:* scripts in
package.json; the self-hosted stack under infra/ (docker-compose.yml, caddy/Caddyfile.example, README.md);
proxy.ts:68-72, which is the ONLY buildCsp caller and computes postizHost from POSTIZ_BASE_URL; comments
in vitest.config.ts:31 and vitest.integration.config.ts; fifteen files under docs/build-guide/; and THREE
TEST FIXTURES whose brand-memory content is literally 'We integrate natively with Postiz'
(lib/memory/brand.test.ts:30, lib/db/memory-brand.test.ts:25,
supabase/__tests__/governed-memory-rls.test.ts:17).

Classify EVERY hit as exactly one of: DELETE, RENAME, REWRITE, or EXEMPT-with-a-stated-reason. The three
fixtures are RENAME, not EXEMPT - they are test data that happens to name the broker, and growing the
exemption list to make a scan pass is the failure SOCIAL-NO-POSTIZ exists to catch. docs/decisions/ and
docs/reviews/ are EXEMPT (historical and immutable). docs/build-guide/ needs an explicit ruling from you,
argued: those are historical planning records, but session-30-5.md itself is the live guide.

CONFIRM ABSENT: no LinkedInProvider, no TwitterProvider, no provider-contract.test.ts, no PKCE anywhere,
no social_account_id on posts, no public.vault_update_secret. Anything pre-existing here is a drift
finding.

OUTPUT: the premise table; the caller table for getActiveByBusinessAndPlatform; the full classified Postiz
surface with your ruling on docs/build-guide/; any drift found, with the affected step named; and
"Ready for N2.1." Do NOT commit. Then stop.
```

#### N2.1 — Close ADR 0028 §13's nine unverified platform facts  ·  no production code

```
BUILDER - Session 30.5 - N2.1. NO PRODUCTION CODE. This step buys down the largest risk in the session
before a single provider line is written. ADR 0028 Section 13 states: "No unverified endpoint may be
written from memory. Where verification fails, the honest outcome is NOT_IMPLEMENTED and a stated gap -
never a plausible-looking URL." Use the ecc:documentation-lookup skill and WebSearch/WebFetch against
VENDOR documentation only - not blog posts, not StackOverflow, not your own recollection.

CLOSE EACH OF THESE NINE, recording for each: the answer, the vendor URL, the date read, and whether it is
CONFIRMED or STILL-UNKNOWN.
 1. LinkedIn's authorize and token endpoint URLs. ADR 0002 Section 10's are STALE (it cites /v2/ugcPosts
    and /v2/me, both superseded by the Posts API). Section 2.2 marks both LinkedIn URLs unverified.
 2. Whether LinkedIn requires or supports PKCE.
 3. Both platforms' TOKEN REVOCATION endpoints (needed by N2.7/N2.8 for the fourth disconnect step).
 4. Client authentication at each token endpoint - HTTP Basic, or client_id/client_secret in the body.
 5. X's REFRESH-TOKEN ROTATION SEMANTICS: is the previous refresh token invalidated on use, and what is
    the penalty for presenting a consumed one? This determines whether A-4's acceptance of the
    concurrent-refresh race holds. X's docs may not state it; if so, record STILL-UNKNOWN and say what
    would confirm it empirically (it is a two-request experiment once credentials exist).
 6. X's tweet-creation path, the response id field, the permalink shape, and the character limit.
 7. X's rate-limit headers and how retryAfterSeconds is derived from them (ADR 0028 Section 7.2 notes X
    signals limits through x-rate-limit-* rather than Retry-After).
 7a. Which X billing model applies to a NEWLY CREATED account in September 2026 - pay-per-usage credits or
    a Basic/Pro subscription (Section 14.2). REPORT what you find; do NOT act on it. Section 14.3 has
    already escalated the pricing consequence to the founder and it is not yours to decide.
 8. THE ENTIRE Section 6 METRICS CAPABILITY TABLE, per platform and per field, for all seven PostMetrics
    fields. This is the largest unverified surface in the ADR. Per field state: servable, requires an
    elevated access tier we do not have, or permanently unavailable. Session 33 consumes this table to
    exclude permanently-null fields from a minimum-n floor, so "unknown" written as "null" is a defect in
    THAT session.
 9. The Linkedin-Version value to pin at implementation time. 202508 has already sunset (Section 3.1).

WRITE THE RESULTS to docs/reviews/session-30-5-platform-verification.md, and append a Builder-attributed
subsection to ADR 0028 Section 13 recording, per item, CONFIRMED-with-source or STILL-UNKNOWN-with-reason.
Appending here is explicitly sanctioned - Section 13 says "the Builder must confirm each before
implementing it, and report what it found". Do NOT edit the Architect's existing Section 13 text in place;
append below it, attributed and dated, exactly as the REVIEWER-REPORT APPEND-ONLY discipline requires of
review files.

FOR EVERY ITEM THAT COMES BACK STILL-UNKNOWN: state which later step it affects and what the honest
fallback is. The fallbacks are already decided and are not yours to invent - a metrics field with no
confirmed source means fetchPostMetrics throws NOT_IMPLEMENTED for that platform (Section 6: "until it is
populated, fetchPostMetrics throwing NOT_IMPLEMENTED is the correct and honest behaviour"); an unconfirmed
revocation endpoint means revokeAccessToken returns early without a network call, still never throwing.

Commit the two documentation files only: "N2.1 complete - ADR 0028 Section 13 platform facts verified
(<n> confirmed, <n> still unknown)".

STOP AND REPORT IF: LinkedIn's Posts API contract differs from Section 3.1 - the required headers, the 201
+ x-restli-id response, the author URN forms, or the permalink shape. Section 3.1 is marked VERIFIED and
several Tier-2 assertions rest on it; if it has moved, N2.7 changes shape.
```

#### N2.2 — The shared contract suite, and the one permitted signature change  ·  ADR 0028 §9.1, §2.6  ·  SOCIAL-AUTHORIZE-ASYNC, SOCIAL-MOCK-MODE-OFFLINE

```
BUILDER - Session 30.5 - N2.2. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No subagent
for this step.

BUILD:
- lib/social/__tests__/provider-contract.test.ts - the shared contract suite, written NOW and parameterised
  over a list of implementations that contains ONLY MockProvider today. N2.10 adds LinkedInProvider and
  TwitterProvider to that list and NOTHING ELSE CHANGES. Structure it so that adding an implementation is a
  one-line array change; if extending it later requires editing assertions, it is not a contract suite.
  Assert, for EVERY implementation (ADR 0028 Section 9.1): all seven methods present; `platform` is a real
  Platform and never 'multi'; every thrown error is a SocialProviderError whose code is in the eight-member
  union; revokeAccessToken NEVER throws; fetchPostMetrics returns PostMetrics | null or throws
  NOT_IMPLEMENTED; getOAuthAuthorizeUrl RESOLVES to an absolute URL carrying the state.
- lib/social/types.ts:121 - getOAuthAuthorizeUrl becomes Promise<string> (Section 2.6). This is the ONE
  signature change L-2 permits, and PKCE requires it: X's verifier must be generated and its cookie set
  before the redirect is issued, which is I/O. The LOSER, recorded so nobody re-opens it: keeping it sync
  and generating PKCE inside the shared route, which moves platform-specific knowledge into the one file
  that must stay platform-agnostic.
- postiz-provider.ts - add the word `async` to its getOAuthAuthorizeUrl and CHANGE NOTHING ELSE in that
  file. That one word is the entire cost of keeping master green across the interface change.
- mock-provider.ts - the same, if needed.

DO NOT in this step: remove 'multi' from SocialProvider.platform. postiz-provider.ts:59 declares it and
removal fails tsc while that file exists. SOCIAL-NO-MULTI-PLATFORM is closed in N2.11.

TEST:
- SOCIAL-AUTHORIZE-ASYNC: getOAuthAuthorizeUrl returns a promise for every implementation in the suite.
- SOCIAL-MOCK-MODE-OFFLINE: with SOCIAL_PROVIDER_MODE=mock the registry serves ALL FIVE platforms, and no
  test in lib/social/ performs network I/O. Assert the second half STRUCTURALLY, not by hope - fail the
  test if global fetch is called during the suite.
- Confirm connect/connect.test.ts:78 still passes unchanged (it already mocks with mockResolvedValue).

VERIFY: npm run typecheck ; npm run test:app. Demonstrate the contract assertions REDDEN against a
deliberately broken stub implementation, then revert. Commit: "N2.2 complete - shared provider contract
suite + getOAuthAuthorizeUrl async (ADR 0028 Sections 9.1/2.6)".
```

#### N2.3 — Migration A: `public.vault_update_secret`  ·  ADR 0028 §4.1, A-2, D-α  ·  SOCIAL-VAULT-UPDATE-SECRET

```
BUILDER - Session 30.5 - N2.3. Migration + Tier-1 DB tests ONLY. Run /ecc:plan -> /ecc:tdd-workflow ->
/ecc:verification-loop. Invoke ecc:database-reviewer ONCE with the scope "N2.3 AND N2.4 TOGETHER - both
migrations"; this is the phase's only DB review and N2.4 does NOT get a second one. Use the
supabase:supabase-postgres-best-practices skill (free) while authoring.

WHY THIS EXISTS. D-alpha: public.vault_update_secret DOES NOT EXIST in any migration, yet
postiz-provider.ts:255,262 calls client.rpc('vault.update_secret') - an undefined, dotted name in a schema
PostgREST does not expose - and never checks error. TOKEN REFRESH HAS THEREFORE NEVER WORKED: it fails
silently, then bumps token_expires_at and returns a success TokenSet, so the system believes it refreshed.
This is a HARD PREREQUISITE for native X, whose access token lives two hours and whose refresh token
rotates. Without it, native X publishing cannot survive its first rotation.

BUILD - one additive migration:
- CREATE public.vault_update_secret, SECURITY DEFINER, updating a vault secret IN PLACE so that
  social_accounts.vault_access_token_id stays STABLE. ADR 0002 Section 8 explicitly forbids
  delete-then-create for exactly this reason.
- REVOKE EXECUTE FROM PUBLIC, anon and authenticated; GRANT EXECUTE TO service_role ONLY.
- Match the shape of vault_create_secret (20260516180000_vault_write_helpers.sql:8) and vault_delete_secret
  (:25) exactly - same schema, same security posture, same argument style. A helper that differs from its
  two siblings is a helper someone will call wrongly.
- State the backfill in a comment: none, and why.

TEST - supabase/__tests__/, live Postgres, beside the existing vault-helper tests:
- SOCIAL-VAULT-UPDATE-SECRET: the function EXISTS; it updates the secret IN PLACE (same secret id before
  and after, new decrypted value); EXECUTE is DENIED to anon and authenticated and GRANTED to service_role.
  Assert the denial explicitly - a permission test that only proves the happy path proves nothing.

VERIFY: npm run typecheck ; npm run test:db. Demonstrate every assertion REDDENS against the pre-migration
schema, then restore. Commit: "N2.3 complete - public.vault_update_secret (ADR 0028 Section 4.1, A-2,
D-alpha)".

STOP AND REPORT IF: N2.0 found the function already exists. That would mean D-alpha is stale and the whole
of Section 4.1 needs re-reading before you write anything.
```

#### N2.4 — Migration B: `posts.social_account_id` and the cascade row  ·  ADR 0028 §5.3, L-11  ·  SOCIAL-DUAL-IDENTITY-SCHEMA

```
BUILDER - Session 30.5 - N2.4. Migration + Tier-1 DB tests + row types in lib/db/types.ts ONLY. No
resolver, no orchestrator change, no UI. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. NO
second database-reviewer call - N2.3's review covered both migrations.

WHY THIS EXISTS, AND WHY IT SURVIVED A-8 (A-8a). posts carries business_id + platform and NO account
reference; its own header comment reads "one row per (campaign, platform)". A-8 deferred LinkedIn
organization posting, which was A-6's original justification - but the model stands on X instead:
CLAUDE.md's locked platforms include "X (Business and Founder)", two X connections are simply two OAuth
flows against two accounts with no elevated tier and no approval, so A BUSINESS CAN HOLD TWO ACTIVE X ROWS
TODAY. This work is immediately load-bearing, not speculative.

BUILD - one additive migration:
- ALTER posts ADD social_account_id uuid NULL REFERENCES social_accounts(id) ON DELETE SET NULL.
  NULLABLE IS DELIBERATE: existing rows have no identity and must not be guessed at.
  ON DELETE SET NULL, NOT CASCADE - disconnecting an account must never delete published history. Put that
  sentence in the migration as a comment; a later reader WILL be tempted to "tighten" it to CASCADE.
- State the backfill in a comment: none, and why (D-gamma - existing platform_user_id values are Postiz
  integrationIds and mean nothing to LinkedIn or X; every existing connection must be re-authorised and no
  backfill is possible).
- ADD THE ROW TO ADR 0010 Amendment 2 Section D2.5's cascade table IN THIS SAME COMMIT (L-11). posts
  already cascades from businesses; the new row records the social_accounts reference and its SET NULL
  behaviour. A business-scoped reference omitted from the cascade table is a silent GDPR-erasure leak, and
  this is the step where it is either recorded or lost.

TEST - supabase/__tests__/, live Postgres:
- SOCIAL-DUAL-IDENTITY-SCHEMA: the FK exists; deleting a social_accounts row SETS NULL on referencing posts
  and does NOT delete them (assert the post row SURVIVES, with its published_at intact); posts RLS is
  UNCHANGED and still tenant-scoped through the new column - MIRROR THE ISOLATION TEST BOTH DIRECTIONS with
  a real signed-in owner-B session (the Session 26-D MINOR-2 precedent); deleting the business still
  CASCADEs and purge_business still SUCCEEDS. Assert erasure SUCCESS, not merely absence.

VERIFY: npm run typecheck ; npm run test:db. Demonstrate each assertion REDDENS pre-migration. Commit:
"N2.4 complete - posts.social_account_id + cascade row (ADR 0028 Section 5.3, L-11)".
```

#### N2.5 — The dual-identity resolver across all three callers  ·  ADR 0028 §5.3  ·  SOCIAL-DUAL-IDENTITY-RESOLVER

```
BUILDER - Session 30.5 - N2.5. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No subagent.

THE DEFECT YOU ARE FIXING. lib/db/social-accounts.ts:137's getActiveByBusinessAndPlatform uses
.maybeSingle() and THROWS at :138 when more than one active row matches. With two X identities that throw
breaks publishing, metrics AND disconnect. ADR 0028 Section 5.3: the function is REPLACED, NOT PATCHED - a
by-id resolver serves the publish path, and a list-returning resolver serves callers that legitimately
want every identity.

BUILD:
- lib/db/social-accounts.ts: a by-id resolver and a list-returning resolver. Both bounded, with an explicit
  ORDER BY matching an existing index. Soft-delete filtering stays in the query helper, not in RLS.
- RESOLUTION ORDER AT PUBLISH, exactly as specified: posts.social_account_id when set; otherwise the
  business's DEFAULT account for that platform; and when neither resolves to EXACTLY ONE active row, the
  post fails TOKEN_REVOKED with reason 'account_ambiguous' rather than publishing as an arbitrary identity.
  PUBLISHING AS THE WRONG IDENTITY IS WORSE THAN NOT PUBLISHING - that is the whole reason this branch
  exists, and it must not be "improved" into a first-row fallback.
- Update all THREE production callers:
    app/api/social/[platform]/disconnect/route.ts:41 - disconnects ONE NAMED identity
    lib/metrics/orchestrator.ts:64                   - resolves via the POST'S OWN account
    lib/publishing/orchestrator.ts:104               - the resolution order above
- lib/publishing/orchestrator.ts: you may change HOW IT RESOLVES AN ACCOUNT and nothing else. Its status
  machine, retry policy and idempotency handling are untouched (L-1, primer rule 5). TOKEN_REVOKED already
  has a defined consequence in ADR 0005 Section 5 - terminal failed with "Reconnect account" - and you are
  REUSING it, not adding to it.

TEST - Tier 2, and SHARED-FUNCTION CALLERS IS THE POINT OF THIS STEP:
- SOCIAL-DUAL-IDENTITY-RESOLVER, the MULTI-ROW case, in ALL THREE callers' own test files. ADR 0028
  Section 5.3 records that NO existing test covers it: metrics/orchestrator.test.ts:119,194 and
  publishing/orchestrator.test.ts:169,415 all mock a single account or null. Each of the three is
  AUTHORED-NOT-EXECUTED for two-identity behaviour until this step closes it, EVEN THOUGH each is
  otherwise fully covered. Both Session 22 blockers were precisely this.
- Assert the ambiguity case explicitly: two active rows, no posts.social_account_id, no default -> the post
  fails with reason 'account_ambiguous' and NOTHING is published.
- Assert the happy path both ways: posts.social_account_id set WINS over the default; the default is used
  when the column is null and exactly one active row exists.

IN YOUR COMMIT MESSAGE AND REPORT, publish the per-caller table: caller -> test file -> which case it now
covers. A caller with no listed test is AUTHORED-NOT-EXECUTED for that caller even if the other two are
fully covered.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. Commit: "N2.5 complete - dual-identity
resolver across three callers (ADR 0028 Section 5.3)".
```

#### N2.6 — OAuth ownership: redirect URI, PKCE, state binding, secret containment  ·  ADR 0028 §2.3-§2.7  ·  SOCIAL-REDIRECT-URI-MATCH, SOCIAL-PKCE-COOKIE, SOCIAL-PKCE-NOT-IN-STATE, SOCIAL-STATE-BINDS-BUSINESS, SOCIAL-NO-SECRET-EGRESS

```
BUILDER - Session 30.5 - N2.6. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. Invoke
ecc:security-reviewer ONCE, scoped to THIS STEP ONLY, before committing: PKCE generation and storage,
cookie attributes, redirect-URI derivation, state handling, and secret egress. This is the phase's only
security review - spend it here, because this is the step where a mistake is a vulnerability rather than a
bug.

BUILD:
- ONE redirect-URI helper, reading config.server.APP_URL, used by BOTH connect and callback. This fixes
  D-beta: connect/route.ts:53 currently derives it from request.nextUrl.origin, which is ADDITIONALLY
  ATTACKER-INFLUENCEABLE VIA THE HOST HEADER, while callback/route.ts:83 uses APP_URL. Postiz tolerated the
  mismatch; LinkedIn and X enforce EXACT MATCH and would reject every exchange.
- PKCE (X, mandatory, S256): verifier generated per authorize request and stored in an httpOnly, Secure,
  SameSite=Lax, PATH-SCOPED cookie, Max-Age 600 seconds to match the state JWT's TTL, CLEARED ON CALLBACK
  WHETHER IT SUCCEEDS OR FAILS. SameSite=Lax is correct and sufficient: the callback arrives as a top-level
  GET navigation, which Lax permits. Do NOT "harden" it to Strict - that breaks the callback.
- THE VERIFIER NEVER GOES IN THE STATE JWT. The state is SIGNED, NOT ENCRYPTED, and travels through the
  platform in a URL; its payload is base64-decodable by anyone who observes the redirect - browser history,
  referrer logs, a proxy. Publishing the verifier defeats the entire purpose of PKCE. This is a FATAL
  loser, not an inferior one.
- signOAuthState / verifyOAuthState are REUSED VERBATIM (ADR 0002 Reversal 3): HS256 via jose,
  OAUTH_STATE_SECRET, 10-minute TTL, FIVE claims (businessId, platform, nonce, locale, plus iat/exp).
  ADR 0002 lists four; the shipped implementation carries five and Amendment A records the correction.
- The callback's ownership re-verification through the ANON, RLS-ENFORCED client (callback/route.ts:67-72)
  stays exactly where it is, BEFORE any service-role work begins. That check is what actually binds the
  callback to the right business, and it survives the removal untouched.
- Code-exchange field lists (Section 2.7), with YOUR Zod schemas: request is grant_type=authorization_code,
  code, redirect_uri, client_id, plus code_verifier for X; the response validates access_token, token_type,
  expires_in, refresh_token (X only), scope. Client authentication per N2.1's finding 4.
- Identity is a SECOND call after exchange - neither token response carries it.

TEST - Tier 2, all offline:
- SOCIAL-REDIRECT-URI-MATCH: connect and callback derive an IDENTICAL redirectUri from one config source.
  Assert equality between the two code paths directly, and assert that a spoofed Host header cannot change
  it.
- SOCIAL-PKCE-COOKIE: httpOnly, Secure, SameSite=Lax, path-scoped, 600s; cleared on the success path AND on
  every failure path.
- SOCIAL-PKCE-NOT-IN-STATE (Tier 3): no verifier field appears in the state JWT claims. DECODE a real
  signed state in the test and assert the absence.
- SOCIAL-STATE-BINDS-BUSINESS: ownership is re-verified through the RLS-enforced client BEFORE any
  service-role write. Assert the ORDERING, not just the presence.
- SOCIAL-NO-SECRET-EGRESS (Tier 2 + 3): client secrets appear in no error message, no log line, and no
  SocialProviderError.details payload. The error constructor's existing redaction of
  /token|secret|authorization|cookie/i is the BACKSTOP, not the primary control - assert the primary
  control too, by constructing an error from a failed exchange and asserting the secret is absent from the
  serialised result. Plus a Tier-3 scan proving no client-reachable module imports a secret getter.

VERIFY: npm run typecheck ; npm run test:app. Demonstrate each assertion REDDENS. Commit: "N2.6 complete -
OAuth ownership, PKCE, redirect-URI parity (ADR 0028 Sections 2.3-2.7, D-beta)".

STOP AND REPORT IF: N2.1 found that LinkedIn REQUIRES PKCE. The design is unchanged - the cookie mechanism
is platform-agnostic - but Section 2.2 marks that fact unverified and a change there is worth recording
before N2.7 rather than after.
```

#### N2.7 — `LinkedInProvider`, end to end  ·  ADR 0028 §3.1, §3.4, §4.3, §4.4, §5.1  ·  SOCIAL-LI-AUTHOR-URN, SOCIAL-LI-POSTID-FROM-HEADER, SOCIAL-LI-EXPIRY-REVOKED, SOCIAL-MEDIA-GUARD, SOCIAL-REVOKE-NEVER-BLOCKS

```
BUILDER - Session 30.5 - N2.7. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. NO subagent -
N2.6's security review covered the OAuth surface this provider sits on, and re-reviewing it here is the
overlapping-scope waste this session's budget exists to avoid.

USE N2.1'S VERIFIED ENDPOINTS. If an item came back STILL-UNKNOWN, the method that needs it throws
NOT_IMPLEMENTED with a stated gap. Do not write a plausible-looking URL.

BUILD lib/social/linkedin-provider.ts implementing all seven SocialProvider methods:
- SCOPES: w_member_social ONLY (A-8). Do NOT add w_organization_social - an app cannot request a scope it
  has not been granted, and the Community Management API needs a registered legal entity that does not
  exist. Re-authorisation when organization access eventually lands is UNAVOIDABLE and cannot be
  pre-empted; ADR 0028 Section 16 item 8 records it as a customer-communication task.
- PUBLISH: POST https://api.linkedin.com/rest/posts with the REQUIRED headers Authorization: Bearer,
  Linkedin-Version: {YYYYMM}, X-Restli-Protocol-Version: 2.0.0, Content-Type: application/json. Body:
  author (URN), commentary, visibility "PUBLIC", distribution (feedDistribution MAIN_FEED, empty
  targetEntities, empty thirdPartyDistributionChannels), lifecycleState "PUBLISHED",
  isReshareDisabledByAuthor false.
- DO NOT COPY ADR 0002 Section 10's sketch. It cites /v2/ugcPosts and /v2/me, both superseded by the Posts
  API. Amendment A records this.
- THE CREATED POST ID ARRIVES IN THE x-restli-id RESPONSE HEADER ON A 201, NOT IN THE BODY (e.g.
  urn:li:share:6844785523593134080). A provider that parses the body finds NOTHING. ADR 0028 calls this
  "the single most likely native-implementation mistake" and it carries its own assertion.
- PublishResult.url is always constructible: https://www.linkedin.com/feed/update/{urn}/
- Linkedin-Version is a NAMED CONSTANT in lib/social/constants.ts with a comment recording that versions
  SUNSET (202508 already has) and that Section 16 item 2 flags the missing review mechanism.
- IDENTITY: platform_user_id holds the FULL URN - urn:li:person:{id}. The URN is SELF-DESCRIBING (its
  prefix distinguishes person from organization) so NO discriminator column exists; a derived helper reads
  the type from the prefix. The loser - a platform_account_type column - is recorded and closed.
- MEDIA GUARD (A-3): a post arriving with non-empty mediaUrls fails PLATFORM_REJECTED BEFORE ANY NETWORK
  CALL. NEVER publish text-only and drop the media - that ships something other than what the user
  approved, and they discover it on their public feed. For a human-in-the-loop product that is the worst
  available failure.
- EXPIRY: LinkedIn CANNOT refresh. refreshAccessToken THROWS TOKEN_REVOKED, NOT TOKEN_EXPIRED. This is
  deliberate and load-bearing: ADR 0005 Section 5 maps TOKEN_EXPIRED to an in-tick refresh-and-retry which
  for LinkedIn can NEVER succeed, burning the tick's refresh budget and producing reason 'refresh_loop'.
  TOKEN_REVOKED marks the post failed with the "Reconnect account" signal, which is the truth.
- token_expires_at is set from the token response at connect.
- REVOCATION: best-effort, NEVER THROWS. Return early when there is no vault id; swallow network failure;
  capture to Sentry and continue. It is a FOURTH, NON-BLOCKING step after CLAUDE.md's three-step disconnect
  - the broker was doing it invisibly. A failed revoke must NEVER block local deactivation and must NEVER
  block purge_business: erasure is a legal obligation and a third party's availability cannot gate it.
- Every response Zod-validated; a parse failure is PLATFORM_REJECTED with the Zod message in details.

TEST - Tier 2, recorded fixtures, NO NETWORK:
- SOCIAL-LI-AUTHOR-URN: person URNs accepted as author. Organization URNs go through the SAME code path and
  are asserted as such - the SCOPE to use one is deferred (A-8), the PLUMBING is not.
- SOCIAL-LI-POSTID-FROM-HEADER: platformPostId read from x-restli-id on a 201. Include a fixture whose BODY
  CONTAINS A DECOY ID and assert the header wins - that is the assertion that actually catches the mistake.
- SOCIAL-LI-EXPIRY-REVOKED: refresh throws TOKEN_REVOKED, never TOKEN_EXPIRED. Assert the CODE, and assert
  the publishing orchestrator's consequent branch is the TERMINAL one.
- SOCIAL-MEDIA-GUARD: non-empty mediaUrls -> PLATFORM_REJECTED with ZERO fetch calls. Assert the ABSENCE of
  the network call, not just the error.
- SOCIAL-REVOKE-NEVER-BLOCKS (Tier 1 + 2): a failed revoke blocks neither disconnect nor purge_business.
  The purge_business half is live-Postgres, in supabase/__tests__/.
- The contract suite must still pass; do NOT add LinkedInProvider to its implementation list yet - that is
  N2.10, once the registry can route to it.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. Demonstrate each assertion REDDENS. Commit:
"N2.7 complete - LinkedInProvider (ADR 0028 Sections 3.1/3.4/4.3/4.4/5.1)".
```

#### N2.8 — `TwitterProvider`, end to end, with rotation-aware refresh  ·  ADR 0028 §3.2, §4.2  ·  SOCIAL-X-EXPIRY-FROM-RESPONSE, SOCIAL-VAULT-UPDATE-CHECKED

```
BUILDER - Session 30.5 - N2.8. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No subagent.

BUILD lib/social/twitter-provider.ts implementing all seven methods, using N2.1's verified endpoints:
- Authorize https://x.com/i/oauth2/authorize with PKCE S256 (MANDATORY, verified); token
  https://api.x.com/2/oauth2/token. Scopes tweet.write and offline.access.
- ACCESS TOKENS LIVE TWO HOURS (verified). platforms/config.ts:23 currently sets X's tokenExpiryDays to
  null, which withFreshToken step 3 reads as "NEVER EXPIRES" and which therefore DISABLES PROACTIVE REFRESH
  ENTIRELY (vault.ts:104-107). tokenExpiryDays: number | null CANNOT EXPRESS TWO HOURS. Correct the field
  so it stops asserting a falsehood; it is an internal type inside lib/social/, so L-2 is unaffected.
- THE AUTHORITATIVE EXPIRY IS THE TOKEN RESPONSE'S expires_in, from which token_expires_at is computed - as
  postiz-provider.ts:365 already does. NOT tokenExpiryDays.
- REFRESH WITH ROTATION: both the access token AND the refresh token are updated IN PLACE in Vault via
  public.vault_update_secret (N2.3), then token_expires_at is bumped - exactly as ADR 0002 Section 8
  requires. NEVER delete-then-create: social_accounts.vault_access_token_id must stay stable.
- EVERY vault_update_secret CALL SITE CHECKS error. D-alpha was survivable only because the result was
  discarded; a native provider that repeats that pattern silently loses every rotation.
- ROTATION AND THE ACCEPTED RACE (A-4). ADR 0002 Section 8 accepts a concurrent-refresh race, reasoning
  that the loser wastes one retry. Under rotation that reasoning does not hold: both read refresh token R;
  the first consumes R for R-prime; the second presents a consumed R and is hard-rejected - and where a
  platform treats reuse as a theft signal, the whole chain can be invalidated and the account disconnected.
  SAME RACE, MATERIALLY WORSE CONSEQUENCE. It is ACCEPTED FOR MVP (scheduled, low-volume, single-business
  traffic makes genuine concurrency rare) and FILED as 30.5-X-REFRESH-ROTATION with ADR 0002 Section 8's
  own remedy named (pg_advisory_xact_lock on socialAccountId) and an un-defer trigger. DO NOT IMPLEMENT THE
  LOCK - it is deferred, and adding it here widens the session.
- REPORT WHAT N2.1 FOUND about rotation semantics (Section 13 item 5). If it came back STILL-UNKNOWN, say
  so in the commit message; it is a two-request experiment once credentials exist and belongs in Section 14.
- Media guard, revocation and Zod validation exactly as N2.7 - same rules, same reasons.
- PublishResult.url is constructed from the authenticated username and the returned id where both are
  available, else null. The field is already nullable; do NOT fabricate a permalink.

TEST - Tier 2, recorded fixtures, NO NETWORK:
- SOCIAL-X-EXPIRY-FROM-RESPONSE: token_expires_at is derived from expires_in, NOT from tokenExpiryDays.
  Include a fixture where the two would DISAGREE and assert expires_in wins.
- SOCIAL-VAULT-UPDATE-CHECKED: every vault_update_secret call site asserts on error. Drive a fixture where
  the RPC returns an error and assert the provider SURFACES it rather than returning a success TokenSet -
  that is the D-alpha behaviour, and the test exists to make it impossible to reintroduce.
- Rotation: a refresh updates BOTH secrets in place and the vault ids are UNCHANGED before and after.
- Media guard and revoke-never-throws, as N2.7.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. Demonstrate each assertion REDDENS. Commit:
"N2.8 complete - TwitterProvider with rotation-aware refresh (ADR 0028 Sections 3.2/4.2, A-4)".
```

#### N2.9 — Error and rate-limit mapping, and ADR 0005 §5's amendment  ·  ADR 0028 §7  ·  SOCIAL-ERROR-MAPPING, SOCIAL-RATE-LIMIT-RETRY-AFTER, SOCIAL-ERR-MATRIX-TRUE

```
BUILDER - Session 30.5 - N2.9. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No subagent.

BUILD - the mapping, table-driven, shared by both providers:
- Implement ADR 0028 Section 7.2's table EXACTLY, one branch per row. NO NEW SocialProviderErrorCode is
  required and NONE may be added - L-7's founder adjudication is NOT triggered, and a new code is a change
  to the publishing worker's retry behaviour, which L-1 forbids.
- 409 CONFLICT -> NETWORK is the one mapping that deserves scrutiny, and it is DELIBERATE: the union offers
  no "retryable conflict", LinkedIn documents 409 as "retry the request", and mapping a documented-retryable
  condition to a terminal code would fail posts that would otherwise have succeeded. Put that reasoning in
  a comment so a future reader sees a decision rather than an accident.
- RATE LIMITS: retryAfterSeconds parsed behind a Number.isFinite guard with a 60-SECOND FALLBACK, exactly
  as postiz-provider.ts:321-331 does. LinkedIn 429 is TOO_MANY_REQUESTS; X signals limits through
  x-rate-limit-* style headers rather than Retry-After, per N2.1's finding 7. retryAfterSeconds is
  populated ONLY when the code is RATE_LIMITED (ADR 0002 Section 3).
- Zod parse failure on any response -> PLATFORM_REJECTED with the Zod message in details.

BUILD - the ADR 0005 documentation fix (A-7). DOCUMENTATION ONLY, NO CODE CHANGES.
ADR 0005 Section 5's matrix asserts "The eight codes are the ADR 0002 Section 3 taxonomy", then names TWO
CODES THAT DO NOT EXIST (BAD_REQUEST, NOT_CONFIGURED) and OMITS TWO THAT DO (NOT_IMPLEMENTED,
PROVIDER_NOT_CONFIGURED). Both counts are eight, which is how it survived review. THE IMPLEMENTATION IS
CORRECT - publishing/orchestrator.ts:208-305 handles all eight real codes, with NOT_IMPLEMENTED and
PROVIDER_NOT_CONFIGURED in the terminal group at :301-305. Only the PROSE is wrong.
Append a numbered amendment to docs/decisions/0005-publishing-worker.md in that file's HOUSE AMENDMENT FORM
(it already carries an "Amendment 1"), correcting the matrix to the real union with the code cited as
evidence. Do NOT edit Section 5 in place - append, and mark the original as superseded where it stands.
The founder's ruling on why this is here rather than deferred: "if we just make an amendment to an old adr
it won't get fixed". The Architect's recommendation was to defer it; the ruling went the other way and both
are recorded in build-guide Section 0.2 (A-7).

TEST - Tier 2:
- SOCIAL-ERROR-MAPPING: table-driven, ONE CASE PER ROW of Section 7.2, both platforms. EVERY row, not a
  representative sample - the point of a mapping table is that it is exhaustive.
- SOCIAL-RATE-LIMIT-RETRY-AFTER: a finite header value is used; a non-finite or absent one falls back to
  60; retryAfterSeconds is set ONLY on RATE_LIMITED and is undefined on every other code.
- SOCIAL-ERR-MATRIX-TRUE (Tier 3): assert ADR 0005's amendment names the eight REAL codes and neither of
  the two phantom ones. This is diff-verified BY DECISION - state it as such.

VERIFY: npm run typecheck ; npm run test:app. Demonstrate each assertion REDDENS. Commit: "N2.9 complete -
error and rate-limit mapping + ADR 0005 Section 5 amendment (ADR 0028 Section 7, A-7)".
```

#### N2.10 — The registry becomes overrides-only  ·  ADR 0028 §8.2, §9.1, A-1  ·  SOCIAL-REGISTRY-PER-PLATFORM, SOCIAL-META-NOT-REGISTERED, SOCIAL-CONTRACT-ALL-PROVIDERS

```
BUILDER - Session 30.5 - N2.10. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No subagent.

BUILD:
- DefaultProviderRegistry currently REQUIRES a default (registry.ts:11) and falls back to it (:14). After
  this step there is NO DEFAULT IN PRODUCTION: LinkedIn and X are registered through the overrides map that
  has existed and gone unused since day one (register() is called only in registry.test.ts:88), and get()
  throws PROVIDER_NOT_CONFIGURED for anything unregistered.
- THIS IS NOT A WIDENING. ADR 0002 Section 4 already specifies exactly this behaviour: "Throws
  PROVIDER_NOT_CONFIGURED if no provider is registered and no default is set." You are making the code do
  what the ADR always said.
- ABSENCE BEHAVIOUR IS PER-PLATFORM, NOT APP-WIDE. If LINKEDIN_CLIENT_ID is set and X_CLIENT_ID is not,
  LinkedIn works and get('twitter') throws. ONE MISSING SECRET MUST NOT DARK THE WHOLE PRODUCT. This is
  what makes ADR 0028 Section 14.1's "the Builder proceeds without credentials" true rather than
  aspirational.
- SOCIAL_PROVIDER_MODE=mock is UNCHANGED and keeps MockProvider as the default for ALL FIVE platforms -
  that is how the entire app-test suite avoids the network (L-9).
- META FAMILY (A-1): instagram, facebook and threads keep their Platform enum members and
  publishingAvailable: false. NO PROVIDER IS REGISTERED for them; connect is gated on publishingAvailable;
  they render coming_soon. connection-status.ts already models this with coming_soon /
  connected_coming_soon. Do NOT delete them from the enum - they are locked launch platforms in CLAUDE.md.
- ADD LinkedInProvider AND TwitterProvider to provider-contract.test.ts's implementation list. If that
  requires editing an assertion rather than an array, N2.2 did not build a contract suite and you say so.

TEST - Tier 2:
- SOCIAL-REGISTRY-PER-PLATFORM: overrides routing returns the right provider per platform; an unregistered
  platform throws PROVIDER_NOT_CONFIGURED; per-platform absence is asserted with ONE credential present and
  the other absent, BOTH DIRECTIONS.
- SOCIAL-META-NOT-REGISTERED: get('instagram') / get('facebook') / get('threads') throw
  PROVIDER_NOT_CONFIGURED; connect is gated; publishingAvailable is still false for all three.
- SOCIAL-CONTRACT-ALL-PROVIDERS: the suite now runs over MockProvider, LinkedInProvider AND
  TwitterProvider, with every Section 9.1 assertion green for all three. WITH THE BROKER GONE THERE IS NO
  LONGER A SINGLE IMPLEMENTATION KEEPING EVERYONE HONEST - that is why the suite is the deliverable and not
  an optimisation.

VERIFY: npm run typecheck ; npm run test:app. Demonstrate a deliberately non-conforming provider REDDENS
the suite, then revert. Commit: "N2.10 complete - overrides-only registry + contract suite over all three
implementations (ADR 0028 Sections 8.2/9.1, A-1)".
```

#### N2.11 — The removal, in its own commit  ·  ADR 0028 §8.3, §8.4, L-3  ·  SOCIAL-NO-POSTIZ, SOCIAL-INTERNALS-BAN-REPLACED, SOCIAL-NO-MULTI-PLATFORM, SOCIAL-CSP-NO-POSTIZ-HOST, SOCIAL-HEALTH-PER-PLATFORM, SOCIAL-I18N-NO-BROKER-KEY

```
BUILDER - Session 30.5 - N2.11. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No subagent.
ONE COMMIT, and it contains ONLY the removal - the diff must be readable on its own and revertible on its
own. L-3: the removal is TOTAL, lands in this session, and is proved by a scan. No deprecation period, no
dual-provider window, no feature-flagged fallback. launch-checklist.md:456 names the failure being
prevented: "a half-removal leaves dead code that future audits read as 'we use Postiz.'"

DELETE / REWRITE - work from N2.0's CLASSIFIED SURFACE, not from ADR 0028 Section 8.3's table, which N2.0
established is INCOMPLETE:
- lib/social/postiz-provider.ts, lib/social/__tests__/postiz-provider.test.ts and
  lib/social/__integration__/postiz-provider.integration.test.ts - deleted.
- lib/social/types.ts - REMOVE 'multi' from SocialProvider.platform. THIS IS THE STEP WHERE IT BECOMES
  POSSIBLE (postiz-provider.ts:58 was its only producer). KEEP OAuthAuthorizeInput.platform: its comment
  attributes it to Postiz, but its real function is to let the SHARED ROUTE stay platform-agnostic while
  the provider knows what it is building for (Section 5.5). Remove one, keep the other - the losers are
  removing both (breaks the generic route) and keeping both ('multi' describes something that no longer
  exists).
- lib/social/registry.ts - the PostizProvider import and construction.
- eslint.config.mjs - REPLACE "@/lib/social/postiz-provider" in SOCIAL_INTERNALS_BAN with the two new
  provider modules, IN THIS SAME CHANGE. launch-checklist.md Section 16 row 4 says the rule is "moot once
  the file is gone" and IS WRONG - correct that row. MOOT IS NOT THE SAME AS REPLACED: removing the entry
  without adding the replacements silently opens the boundary CLAUDE.md calls non-negotiable.
- lib/observability/csp.ts - buildCsp loses the postizHost parameter and its connect-src origin. Native
  calls are SERVER-SIDE ONLY, so this is a net security improvement. UPDATE proxy.ts:68-72, THE ONLY
  buildCsp CALLER, which computes postizHost from POSTIZ_BASE_URL - ADR 0028 Section 8.3 does not name it
  and the removal does not compile without it.
- lib/config.ts - remove POSTIZ_BASE_URL and POSTIZ_API_KEY at all three sites each (:17-18, :273-274,
  :384-388). ADD NOTHING: all six native credentials already exist (Section 2.1).
- .env.local.example - the Postiz rows.
- package.json - the three postiz:* scripts.
- infra/ - docker-compose.yml, caddy/Caddyfile.example and README.md, per your N2.0 ruling on the
  self-hosted stack. If you rule that any of it stays, SAY WHY IN THE COMMIT MESSAGE.
- app/api/_health/social/route.ts:35-40 - stop computing 'postiz'; report the provider PER PLATFORM.
- i18n/{en,pt,es}/common.json - rename postiz_unavailable in ALL THREE SIMULTANEOUSLY. THE KEY LEAKS THE
  BROKER; THE MESSAGE DOES NOT - the user-facing string may well be unchanged. Update every reference,
  including app/[locale]/(dashboard)/settings/accounts/page.tsx.
- The three brand-memory test fixtures - RENAME the string 'We integrate natively with Postiz' in
  lib/memory/brand.test.ts:30, lib/db/memory-brand.test.ts:25 and
  supabase/__tests__/governed-memory-rls.test.ts:17. THEY ARE TEST DATA, NOT BROKER REFERENCES, AND THEY
  ARE RENAMED RATHER THAN EXEMPTED. An exemption list grown to make a scan pass is exactly the failure
  SOCIAL-NO-POSTIZ exists to catch.
- vitest.config.ts:31 and vitest.integration.config.ts comments.
- app/api/social/[platform]/callback/callback.test.ts and lib/social/__tests__/registry.test.ts - their
  Postiz references.

TEST:
- SOCIAL-NO-POSTIZ (Tier 2): a test that greps the repository case-insensitively for 'postiz', exempting
  EXACTLY docs/decisions/, docs/reviews/, the scan file itself, and whatever N2.0 ruled for
  docs/build-guide/ - EACH EXEMPTION CARRYING A STATED REASON IN THE TEST FILE. This is launch-checklist
  Section 16's last row made executable. DEMONSTRATE IT REDDENS by reintroducing a single reference, then
  revert. A scan that has never been shown to fail is not a scan.
- SOCIAL-INTERNALS-BAN-REPLACED (Tier 3): the two new provider modules are PRESENT in SOCIAL_INTERNALS_BAN
  and the Postiz entry is ABSENT. Assert it in a TEST, not in lint config alone -
  lib/email/__tests__/eslint-all-bans.test.ts is the shipped precedent.
- SOCIAL-NO-MULTI-PLATFORM (Tier 3): the 'multi' member is absent from SocialProvider.platform.
- SOCIAL-CSP-NO-POSTIZ-HOST (Tier 2): buildCsp has no postizHost parameter and connect-src is OTHERWISE
  UNCHANGED. Assert the second half - a CSP "cleanup" that quietly drops another origin is a regression.
  lib/observability/csp.test.ts already exists.
- SOCIAL-HEALTH-PER-PLATFORM (Tier 2): the health route names no broker and reports per platform.
- SOCIAL-I18N-NO-BROKER-KEY (Tier 2 + 3): postiz_unavailable is absent and the replacement is present in
  ALL THREE locales, registered in i18n/request.ts.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. Commit: "N2.11 complete - Postiz removed
totally (ADR 0028 Sections 8.3/8.4, L-3)".

STOP AND REPORT IF: removing the CSP parameter changes any connect-src origin other than the Postiz host,
or if a Postiz reference exists in a path none of N2.0's four classifications covers.
```

#### N2.12 — The accounts surface  ·  ADR 0028 §9.4  ·  renders SOCIAL-DUAL-IDENTITY-*, SOCIAL-META-NOT-REGISTERED, SOCIAL-I18N-NO-BROKER-KEY

```
BUILDER - Session 30.5 - N2.12. Run /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop.

DESIGN SKILLS BELONG HERE AND NOWHERE ELSE IN THIS SESSION. Invoke taste-skill for the BUILD and impeccable
for the REVIEW pass, BOTH AGAINST ADR 0028 SECTION 9.4'S UX CONTRACT - not against their own taste. The
Architect SPECIFIED this surface and did not design it; you design it, INSIDE that contract. Neither skill
may relax a constraint below: they shape hierarchy, copy, spacing, states and motion - they do not choose
the states.

BUILD app/[locale]/(dashboard)/settings/accounts - Server Component page + Client Component interactivity:
- ALL FIVE ConnectionStatus states (connection-status.ts:5): connected, connected_coming_soon,
  expiring_soon, disconnected, coming_soon. THE BUILD GUIDE'S Q8 SAYS FOUR; THERE ARE FIVE, and ADR 0028
  Section 9.4 corrects it. Render every one.
- DUAL IDENTITY: the surface lists a platform's identities SEPARATELY, each with its own status and its own
  disconnect control, and MARKS WHICH IS THE DEFAULT used when a post names no account. CONNECTING A SECOND
  IDENTITY MUST BE AN OBVIOUS ACTION, NOT A RE-CONNECT THAT APPEARS TO REPLACE THE FIRST - a user who
  believes they are adding their business account and instead replaces their founder account has been
  actively misled by the interface.
- LINKEDIN RECONNECTION: the expiring_soon state states plainly that LinkedIn access expires and must be
  renewed, WITH THE DATE. LinkedIn cannot refresh and simply dies at 60 days. NO NEW EMAIL AND NO NEW
  NOTIFICATION CHANNEL (L-6) - a reconnection email is a real idea, it touches ADR 0008, and Section 15
  names it as a follow-on with its trigger.
- PER-PLATFORM AVAILABILITY COPY for the three coming_soon platforms, TRUTHFUL ABOUT THE REASON. Do not
  write "coming soon" over a blocker that is an external review process.
- SEVEN OAuth ERROR-REDIRECT CODES, all landing on /{locale}/settings/accounts, each with a DISTINCT
  localised message: invalid_state, forbidden, oauth_denied, exchange_failed, vault_write_failed,
  db_write_failed (callback/route.ts), connect_failed (connect/route.ts:69). SEVEN DISTINCT MESSAGES, not
  one generic failure string - a user who cannot tell "you denied access" from "our database write failed"
  cannot act on either.
- Zod on every Server Action input. Disconnect is keyboard-reachable and BEHIND A CONFIRMATION STEP.
- shadcn v4 is Base UI: NO asChild on Button or DropdownMenu primitives; buttonVariants() for a link styled
  as a button. Tailwind only, no inline style except where genuinely dynamic. Any new colour is a
  globals.css token, never a hand-written hex.
- i18n en/pt/es LANDED TOGETHER and registered in i18n/request.ts.
- WCAG 2.2 AA floor.

TEST - Tier 2:
- All five states render, each with its own assertion. The two-identity case renders two rows with two
  disconnect controls and one marked default.
- Each of the seven error codes renders its own distinct message, in all three locales.
- The Meta three render coming_soon and offer no connect action.
- Any new status colour ships with a BOTH-THEMES CONTRAST ASSERTION THAT READS THE SHIPPED TOKEN FILE
  (OpportunityFeed.test.tsx:439 is the shipped mechanism) - a hand-transcribed hex is the anti-pattern that
  assertion exists to prevent.

VERIFY: npm run typecheck ; npm run test:app. Commit: "N2.12 complete - accounts surface, five states +
dual identity (ADR 0028 Section 9.4)".
```

#### N2.13 — Scope scans, the constraint-to-CI map, and the close-out docs  ·  SOCIAL-INTEGRATION-NOT-EXECUTED + the four tripwires

```
BUILDER - Session 30.5 - N2.13. Run /ecc:plan -> /ecc:verification-loop. No subagent. This step is where
the session's claims become checkable, and it is the step most likely to be rushed.

BUILD - four executable scans, EACH WITH A PER-ROOT VACUITY GUARD (a scan that passes over an empty root
proves nothing) and EACH DEMONSTRATED TO REDDEN against a temporary violation, then reverted:
- SOCIAL-WORKER-UNCHANGED: lib/publishing/orchestrator.ts's status machine, retry policy and idempotency
  handling are unchanged (L-1). ACCOUNT RESOLUTION IS THE ONE PERMITTED CHANGE (N2.5) - write the scan to
  allow exactly that and nothing else, and say in a comment why the exception exists.
- SOCIAL-PROVIDER-BOUNDARY: the rewritten eslint.config.mjs ban list asserted BY A TEST
  (lib/email/__tests__/eslint-all-bans.test.ts is the precedent), not trusted to lint config alone.
- SOCIAL-META-STILL-UNAVAILABLE: publishingAvailable remains false for instagram, facebook and threads.
- SOCIAL-NO-READ-PATH: no fetchRecentPosts / listRecentPosts member on SocialProvider. That is Session 32's
  and it lands as ADR 0002 Amendment B.

RECORD - SOCIAL-INTEGRATION-NOT-EXECUTED (Tier 3). State, in L-9's exact terms, that anything in
lib/social/__integration__/ is AUTHORED-NOT-EXECUTED until backlog item 22E-integration-discovery is
closed. vitest.config.ts's exclude contains '**/__integration__/**' and NO CI JOB DISCOVERS THAT DIRECTORY.
CLAIM NO COVERAGE FROM IT. If you wrote anything there, say explicitly that it runs nowhere.

THEN THE VERIFICATION PASS:
- Map EVERY ADR 0028 constraint to its executing CI job, with "reddens if broken" stated PER ROW. Push and
  cite REAL RUN URLs for app-tests and db-tests. DO NOT CLAIM A CONSTRAINT COUNT UNTIL IT IS EXECUTED GREEN
  IN CI AT THE HEAD IT IS DATED TO - Session 28 shipped a false "29/29 executed green" that took three
  correction steps to undo.
- Read the db-tests SKIP-GUARD line FROM THE LOG and confirm a NON-ZERO file and test count. A suite a flag
  silently empties to zero tests is a FALSE-GREEN, not coverage.
- SHARED-FUNCTION CALLERS, re-grepped at HEAD and published as TWO tables: getActiveByBusinessAndPlatform's
  three callers, and the provider surface's five consumers (build-guide Reality 6). Per caller: which test
  file exercises it, and for which case. Any caller with no listed test is marked AUTHORED-NOT-EXECUTED for
  that caller EVEN IF the others are fully covered.
- Enumerate the Tier-3 constraints AS DECISIONS, not as gaps.
- Section 14's MANUAL VERIFICATION LOG: fill any row you actually performed, or state that it is EMPTY. AN
  EMPTY TABLE IS THE HONEST STATE, NOT A FORMALITY TO BACKFILL (Section 14.1). Section 16 item 7 already
  records that merging with it empty is a stated risk.

THEN THE CLOSE-OUT DOCS - work Section 5 of docs/build-guide/session-30-5.md row by row and check each one
with its evidence: launch-checklist.md Section 16 (SEVEN rows, not eight - Section 8.3 corrects the build
guide) plus Section 1's env table and the new Section 16a LinkedIn gate; current-phase.md;
product-status.md:95; CLAUDE.md's tech-stack line; session-32.md's dated note; backlog.md
(22E-integration-discovery, 30.5-MEDIA-UPLOAD, 30.5-X-REFRESH-ROTATION); ADR 0010 Amendment 2 Section D2.5;
docs/evidence/0010-legal-evidence.md; and .wolf/anatomy.md + memory.md + cerebrum.md.

REPORT, in the commit message and to the operator: which of ADR 0028 Section 16's stated-open items this
session closed and which it did not. ITEMS 1 (LinkedIn ships member-only, against a locked strategic
decision) AND 6 (X's per-post cost against "unlimited posts") ARE FOUNDER ADJUDICATIONS THAT REMAIN OPEN -
say so plainly rather than letting them look closed by omission.

Commit: "N2.13 complete - scope scans, constraint-to-CI map, close-out docs (ADR 0028)".
```

---

## §3 — Reviewer session (N3)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored after ADR 0028 is Accepted, alongside §2.** The reviewer's checklist *is* the
> ADR's constraint table, so it can be written before the Builder runs; only the commit range is filled in
> at run time, by the Reviewer itself.

**What this section will contain when authored:**

- **§3a — Reviewer primer** (one paste block, ending by stopping for acknowledgement) and **§3b — the
  Reviewer prompt**, both paste-ready.
- **`PROC-REVIEW-AT-COMMIT`, stated as a hard requirement.** The Reviewer reads every artefact **at the
  stated commit range** — `git diff <base>..<head>`, `git show <sha>:<path>`, `git log --oneline
  <base>..<head>` — and **never at HEAD**. Its report **must open by naming that exact range**; a report
  that does not name its range is not a valid review. Reading at HEAD produced a false-positive MAJOR
  finding in Session 21B and it is the failure this rule exists to prevent.
- **`SHARED-FUNCTION CALLERS`, applied to the five consumers of Reality §6.** For every constraint written
  against the provider surface, the Reviewer enumerates the callers and states, **per caller**, which test
  covers it. Both Session 22 blockers were the same root cause: a constraint verified against one of two
  callers of a shared function across three consecutive sessions.
- **The specific traps this migration sets**, which the Reviewer is told to look for by name: a
  `SOCIAL-NO-POSTIZ` scan that passes because it greps the wrong paths or exempts too much; a "shared"
  contract suite that is in fact only run against one provider; a native provider whose Tier-2 test
  asserts against a fixture the provider itself produced; any coverage claim resting on
  `lib/social/__integration__/`, which **no CI job discovers** (L-9); a client secret reachable from a
  client bundle; and a `publishingAvailable` flipped to `true` for a Meta platform without the App Review
  that grants it.
- **The verification the Reviewer runs itself** rather than trusting the Builder's report: the two
  commands from CLAUDE.md's ECC section, the db-test suite if a migration landed, and the
  `launch-checklist.md` §16 row-by-row check.

**✅ AUTHORED 2026-09-03 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Authored **alongside §2**, per its own gate: the
Reviewer's checklist **is** ADR 0028's §10 constraint table, so it can be written before the Builder runs.
**Only the commit range is filled in at run time, by the Reviewer itself.**

**ECC budget for this phase — zero subagent invocations.** The Reviewer reads the diff itself. A
constraint-table walk against CI logs is not code analysis, and delegating it re-derives what the Reviewer
has already read — the Session 25 waste this budget exists to prevent. Skills are free; none is required.

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 30.5 Track N - REVIEWER phase (N3). You are independent. You MODIFY NOTHING: no source, no tests,
no ADR, no build guide. Your single output is docs/reviews/session-30-5-reviewer.md. This is the ONE review
pass for this session; there is no separate re-review track.

PROC-REVIEW-AT-COMMIT IS ABSOLUTE AND IS YOUR FIRST OBLIGATION.
Read every artefact AT THE STATED COMMIT RANGE - git diff <base>..<head>, git show <sha>:<path>,
git log --oneline <base>..<head>. NEVER at HEAD. Reading at HEAD produced a false-positive MAJOR finding in
Session 21B that the next session's reviewer had to withdraw. Your report MUST OPEN by naming the exact
range, e.g.:
  "Scope reviewed: <base>..<head>; all citations are git show <sha>:<path> at that range, never HEAD."
A report that does not name its range is not a valid review.

Exception you may rely on (Session 22-F, NEW-12): the ADR and build guide you audit AGAINST are read at
their own commits, which you name SEPARATELY - they predate or postdate the range and cannot be read inside
it. State both: "ADR 0028 read at <sha>; reviewed artefacts read at <base>..<head>."

WHAT YOU ARE AUDITING AGAINST:
- docs/decisions/0028-native-social-providers.md, INCLUDING Sections 13, 14.1, 14.2, 14.3, 15 and 16.
  Section 14.1's blockquote marks part of A-5-prime SUPERSEDED by A-8 and marks one argument WITHDRAWN.
  WHERE A LATER RULING CORRECTS AN EARLIER ONE, THE CORRECTION IS THE STANDARD. Do NOT raise a finding
  against superseded text that the ADR deliberately left legible.
- docs/decisions/0002-social-provider.md Amendment A, and the ADR 0005 Section 5 amendment the Builder
  appended in N2.9.
- docs/build-guide/session-30-5.md: Reality 1-14, Section 0 (L-1..L-12, D-1..D-8), Section 0.2
  (A-1..A-8a), and Section 2b's step table.
- docs/reviews/session-30-5-platform-verification.md (N2.1's output) - read at ITS OWN commit and name it.
- CLAUDE.md's test-execution-integrity section.

THE SEVEN THINGS MOST LIKELY TO BE WRONG, in the order I want them checked:

1. AN ENDPOINT WRITTEN FROM MEMORY. ADR 0028 Section 13 lists NINE unverified platform facts and forbids
   writing any of them from memory. Open N2.1's verification document, then open both providers, and check
   EVERY URL, header, scope, field name and status code against what N2.1 actually CONFIRMED. A confident
   endpoint with no source in N2.1's record is a BLOCKER, not a MINOR - it is the failure mode Section 13
   exists to prevent, and it will not surface in any offline test.

2. SOCIAL-NO-POSTIZ THAT PASSES FOR THE WRONG REASON. Three distinct ways it can be false:
   (a) it greps the wrong paths or exempts too much - read the exemption list and confirm EACH exemption
       carries a stated reason, and that the three brand-memory fixtures were RENAMED, not exempted
       (lib/memory/brand.test.ts, lib/db/memory-brand.test.ts,
       supabase/__tests__/governed-memory-rls.test.ts);
   (b) it was never demonstrated to redden - a scan that has never failed is not a scan;
   (c) N2.0's classified surface has hits the removal never resolved. RUN THE GREP YOURSELF at the head
       and reconcile it against N2.0's table. ADR 0028 Section 8.3's own delta table is INCOMPLETE - it
       omits package.json's postiz:* scripts, infra/, proxy.ts:68-72 (the only buildCsp caller), and the
       vitest config comments. Confirm each was handled.

3. A "SHARED" CONTRACT SUITE THAT IS NOT SHARED. provider-contract.test.ts must run over MockProvider,
   LinkedInProvider AND TwitterProvider (Section 9.1). Check that all three are in the parameterised list
   and that no assertion is skipped or branched per implementation. A suite that quietly excludes one
   provider from an assertion proves nothing about that provider - and with the broker gone there is no
   longer a single implementation keeping everyone honest.

4. SHARED-FUNCTION CALLERS, on TWO functions.
   (a) getActiveByBusinessAndPlatform: THREE production callers (disconnect/route.ts:41,
       metrics/orchestrator.ts:64, publishing/orchestrator.ts:104). ADR 0028 Section 5.3 records that NONE
       of them tested the multi-row case before this session. Verify by git grep AT THE RANGE, not by
       trusting the ADR, and list per caller which test file now exercises the two-identity case. A caller
       with no listed test is AUTHORED-NOT-EXECUTED EVEN IF the other two are fully covered.
   (b) The provider surface's FIVE consumers (build-guide Reality 6): connect/route.ts:56-58,
       callback/route.ts:87, publishing/orchestrator.ts:122-127 and :210, metrics/orchestrator.ts:56-72,
       and app/api/_health/social/route.ts:35-40. Same treatment.
   Both Session 22 blockers were a shared function verified against one of two callers across three
   consecutive sessions.

5. A FIXTURE THAT PROVES NOTHING. A native provider whose Tier-2 test asserts against a fixture the
   provider itself shaped is circular. Check specifically:
   - SOCIAL-LI-POSTID-FROM-HEADER: does a fixture exist whose BODY carries a decoy id, proving the header
     actually wins? Without that, the assertion passes on a provider that reads either.
   - SOCIAL-X-EXPIRY-FROM-RESPONSE: does a fixture exist where expires_in and tokenExpiryDays DISAGREE?
   - SOCIAL-MEDIA-GUARD: is the ABSENCE of the network call asserted, or only the error code?
   - SOCIAL-VAULT-UPDATE-CHECKED: is there a fixture where the RPC returns an error and the provider is
     asserted to SURFACE it? That is the D-alpha behaviour, and only that assertion prevents its return.

6. A COVERAGE CLAIM RESTING ON lib/social/__integration__/. NO CI JOB DISCOVERS THAT DIRECTORY -
   vitest.config.ts's exclude contains '**/__integration__/**', recorded as backlog item
   22E-integration-discovery. Anything there is AUTHORED-NOT-EXECUTED (L-9). If the Builder claimed
   coverage from it, that is a MAJOR at minimum.

7. SCOPE. Check each by reading the diff, not by trusting that a scan exists:
   - lib/publishing/orchestrator.ts's STATUS MACHINE, RETRY POLICY and IDEMPOTENCY handling are UNCHANGED
     (L-1). Account RESOLUTION is the one permitted change (N2.5). Read the diff and confirm the scan's
     exception is exactly that wide and no wider.
   - publishingAvailable is still FALSE for instagram, facebook and threads, and no provider is registered
     for them (A-1). A flipped flag ships a promise the platform has not granted.
   - NO read path: no fetchRecentPosts / listRecentPosts member on SocialProvider (Session 32's).
   - w_organization_social is ABSENT from LinkedIn's requested scopes (A-8). Its presence would break the
     authorize URL against an app that has not been granted it.

ALSO VERIFY, and do not take the Builder's word for any of it:
- Every constraint claimed COVERED is EXECUTED GREEN IN CI AT THE STATED HEAD, not merely authored. Open
  the runs. A claimed count that is false at its dated head is exactly what Session 28 shipped and 28-D
  spent three correction steps undoing.
- The db-tests SKIP-GUARD line shows a NON-ZERO file and test count, READ FROM THE LOG, not inferred.
- A CLIENT SECRET IS NOT REACHABLE FROM ANY CLIENT BUNDLE. All six credentials are read through
  lib/config.ts's serverOnly() getters; confirm no client-reachable module imports one, and that no secret
  appears in an error message, a log line, or a SocialProviderError.details payload.
- SOCIAL-PKCE-NOT-IN-STATE: the state JWT is SIGNED, NOT ENCRYPTED. Decode a real state from the test and
  confirm no verifier field. A verifier in the state defeats PKCE entirely.
- SOCIAL-REDIRECT-URI-MATCH: connect and callback derive redirectUri from ONE config source (D-beta), and
  request.nextUrl.origin is gone from connect/route.ts. The old form was Host-header influenceable.
- SOCIAL-INTERNALS-BAN-REPLACED: the two new provider modules are IN eslint.config.mjs's
  SOCIAL_INTERNALS_BAN. "Moot once the file is gone" is NOT the same as replaced - launch-checklist.md
  Section 16 row 4 said the former and is wrong.
- posts.social_account_id is ON DELETE SET NULL, not CASCADE, and the ADR 0010 Amendment 2 Section D2.5
  cascade row landed IN THE SAME PR. A business-scoped reference missing from that table is a silent
  GDPR-erasure leak.
- vault_update_secret's EXECUTE is granted to service_role ONLY, with the DENIAL asserted for anon and
  authenticated - not just the happy path.
- SOCIAL-CSP-NO-POSTIZ-HOST removed the Postiz origin and NOTHING ELSE from connect-src.
- i18n landed in en, pt AND es simultaneously and is registered in i18n/request.ts. All seven OAuth
  error-redirect codes have DISTINCT messages in all three.
- No asChild on Button or DropdownMenu primitives. No `any`. No console.* on a user-facing surface. No raw
  .toISOString(). Every list query bounded with an explicit ORDER BY.
- Any new status colour is a globals.css token with a both-themes contrast assertion that READS THE
  SHIPPED TOKEN FILE - a hand-transcribed hex is the anti-pattern that assertion exists to prevent.
- Section 14's manual verification log: if it is EMPTY, that is the honest state and NOT a finding against
  the Builder (Section 14.1 predicted it). A finding IS warranted if the Builder claimed a live
  verification it did not perform.

Acknowledge in one line, naming the commit range you have been given and confirming you will read at that
range and never at HEAD. Then STOP and wait for the review prompt.
```

### §3b — Reviewer prompt  (paste after the primer is acknowledged)

```
Review the Session 30.5 Track N Builder range and write docs/reviews/session-30-5-reviewer.md.

Open the report with the range line (PROC-REVIEW-AT-COMMIT), and name SEPARATELY the commits at which you
read ADR 0028, ADR 0002 Amendment A, the build guide, and N2.1's platform-verification document.

Organise findings by the ADR's own sections so a correction pass can cite them:
  1. OAuth ownership, PKCE, redirect-URI parity, secret containment (Section 2; D-beta)
  2. The publish contract per platform, and the media guard (Section 3; A-3)
  3. Token lifecycle: vault_update_secret, X rotation, LinkedIn's 60-day death, revocation (Section 4;
     A-2, A-4, D-alpha)
  4. Platform identity, the dual-identity schema and the resolver across its three callers (Section 5;
     A-6, A-8, A-8a)
  5. Metrics and what null honestly means (Section 6) - including whether Section 6's capability table was
     actually populated by N2.1 or left unverified with fetchPostMetrics throwing NOT_IMPLEMENTED
  6. Error and rate-limit mapping, and the ADR 0005 Section 5 amendment (Section 7; A-7)
  7. The removal as an ordered, provable operation (Section 8; L-3) - the scan, its exemptions, and the
     surfaces Section 8.3's table omitted
  8. The contract suite, the tiers, and what is honestly untestable (Section 9; L-8, L-9)
  9. The UX contract and the design floor (Section 9.4) - five states, dual identity, seven error codes
 10. SHARED-FUNCTION CALLERS, per caller, with the test that exercises each - BOTH functions
 11. Constraint-to-CI mapping: every Section 10 constraint, its tier, its executing job, and whether it
     REDDENS if the property breaks
 12. Scope and process: L-1's out-of-scope list not shipped; the Tier-3 constraints enumerated AS
     DECISIONS; Section 16's stated-open items correctly reported as open

Severities: BLOCKER / MAJOR / MINOR / NIT, each with a STABLE ID (BLOCKER-1, MAJOR-2, ...) the correction
pass will cite. For each finding give: what is wrong, the file:line AT THE RANGE, why it matters, and what
would prove it fixed. Do not propose patches - you write no code.

Where you believe the ADR itself is wrong rather than the implementation, say so explicitly and mark it as
an ADR finding, not a Builder finding. This ADR already carries three self-corrections (D-alpha, D-beta,
D-gamma) plus an incomplete Section 8.3 delta table found by N2.0; a fifth defect is entirely possible and
you should say so if you find one.

Two items are FOUNDER ADJUDICATIONS, not Builder defects, and must be reported as still-open rather than as
findings against the implementation: Section 16 item 1 (LinkedIn ships member-only, contradicting
CLAUDE.md's locked "LinkedIn (Business and Founder)") and Section 16 item 6 / Section 14.3 (X's
$0.200-per-linked-post cost against a EUR 125 plan advertising "unlimited posts"). Say plainly that they
remain open.

Run the verification yourself rather than trusting the Builder's report: npm run typecheck ; npm run
test:app ; npm run test:db ; the grep for postiz; and launch-checklist.md Section 16 row by row - it has
SEVEN rows, not the eight the build guide asserts (ADR 0028 Section 8.3 corrects this).

State plainly anything you could NOT verify and why - an unverified claim recorded as unverified is worth
more than a confident guess. Do not pad the report to look thorough.

End with one line: "Session 30.5 review complete - <n> findings (<b> BLOCKER, <m> MAJOR, <mi> MINOR, <ni>
NIT) over range <base>..<head>." Then /exit.
```

**Gate:** `§4` is authored **only after** this Reviewer has actually run and
`docs/reviews/session-30-5-reviewer.md` exists. A correction pass is a response to findings; there is
nothing to order or prioritise until they exist, and inventing them ahead of time produces a fictional
resolution log.

---

## §4 — Correction pass (Session 30.5-D) · (paste into Claude Code · Opus)

> **PLACEHOLDER — authored ONLY after the Reviewer has actually run and
> `docs/reviews/session-30-5-reviewer.md` exists.** A correction pass is a response to findings; there is
> nothing to order, prioritise or resolve until the findings exist, and inventing them ahead of time
> produces a fictional resolution log.

**What this section will contain when authored:** the founder adjudications the review escalated; a
summary of what the Reviewer found (with `docs/reviews/session-30-5-reviewer.md` named as authoritative);
the ordering rationale; where resolutions go; **§4.0** the correction primer; **§4.1** the correction steps
`D0 … Dn`, one paste block each; **§4.2** the resolution log; and **§4.3** the close-out.

**`REVIEWER-REPORT APPEND-ONLY` — the four conditions, all load-bearing, all inherited here:**

1. **No in-place edit, ever.** Not one character of the reviewer's text changes — no verdict flipped, no
   status column rewritten, no RESOLVED stamped onto a finding, no finding reworded, deleted or reordered.
2. **One appended, attributed section** — a single `## CORRECTION PASS (Session 30.5-D)` at the **end** of
   the reviewer's file, opening with its author, date and the commit range it fixed. A reader must be able
   to tell, from any line, which of the two wrote it.
3. **Findings are referenced, never restated as resolved** — cite each by ID and record
   *finding → fix → the test that now proves it → the commit SHA*.
4. **A disputed or withdrawn finding is argued, not erased** — say why in the appendix and let the reader
   judge against the reviewer's original text.

---

## §5 — Docs to update at close-out (Track N done)

- [ ] `docs/decisions/0028-native-social-providers.md` — Accepted, with its final `SOCIAL-*` constraint
      table and its COVERED/tier status re-verified against CI **at the head it is dated to**, not
      asserted.
- [ ] `docs/decisions/0002-social-provider.md` — Amendment A appended; §5 and §4's single-default
      assumption marked superseded **in place, not deleted**; one line reserving Amendment B for
      Session 32.
- [ ] `docs/launch-checklist.md` §16 — **all eight rows checked**, each with its evidence (the deleted
      path, the scan output, the env-var removal). §1's env table updated: Postiz rows removed, the new
      per-platform client id/secret rows added with their `vercel env ls` checks.
- [ ] `docs/current-phase.md` — the Session 30.5 entry (what shipped, the CI run URLs for `app-tests` and,
      if a migration landed, `db-tests`), the "Next up" Postiz-removal item struck, and **open decision
      19D-5 re-pointed at Session 32 as ADR 0002 Amendment B**.
- [ ] `docs/product-status.md:95` — the *"Publishing runs through Postiz"* line replaced with what is
      actually true, per platform, including that the three Meta platforms still cannot publish and why.
- [ ] `CLAUDE.md` — the tech-stack line **"Social publishing: Native platform"** is now accurate rather
      than aspirational; add the native-provider file names to the `/lib/social/` description if the
      structure section names them.
- [ ] `docs/build-guide/session-32.md` — its Reality §3, Q2 and D-2 reframed against a repo with no
      Postiz in it (append a dated note; do not rewrite in place).
- [ ] `docs/backlog.md` — `22E-integration-discovery` updated with what this session added to
      `lib/social/__integration__/` and what remains undiscovered by CI.
- [ ] **ADR 0010 Amendment 2 §D2.5 cascade table** — a row for any new business-scoped table, **or an
      explicit note that no new row was required** (the Session 28-D D7 precedent). One of the two,
      never silence.
- [ ] `docs/evidence/0010-legal-evidence.md` — check whether any legal-prose claim references the
      publishing sub-processor; if Postiz appears as a sub-processor anywhere in `content/legal/*.mdx`,
      the `evidenceRef` frontmatter is bumped or confirmed per CLAUDE.md's legal-pages rule.
- [ ] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md` — new provider files added, deleted files
      removed, and the migration's learnings recorded (particularly whatever Q1 got wrong about the
      platform APIs, which is the most valuable thing this session will discover).

**Next:** Session 31 — Generation quality core (ADR 0024, Track H), which now begins against a repo whose
publishing path is native and whose provider abstraction has been proved by two implementations rather
than asserted by one.
