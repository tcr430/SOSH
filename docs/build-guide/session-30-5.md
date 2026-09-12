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
  lib/social/connection-status.ts (the five states and the 7-day expiring_soon window — L-6's surface).
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
- A CLIENT SECRET IS NOT REACHABLE FROM ANY CLIENT BUNDLE. All four credentials are read through
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

**Authored 2026-09-05, after the Reviewer ran.** `docs/reviews/session-30-5-reviewer.md` is the
authoritative findings document; this section is the work order derived from it. The reviewed range is
`54110178..be03c917` (the fifteen Builder commits N2.1 → N2.13-D2); the findings document itself is read
at **its own** commit, per the Session 22-F / NEW-12 exception — it is **untracked** at the range head,
which is why D0 exists and runs first. **Ten steps: D0–D9.** Correction passes are normal, not failures
(constitution). **There is no independent re-review pass this session** (the 23-D…29-D precedent): this
pass fixes the Reviewer's findings, records its own resolutions in the reviewer's own file, and the
founder adjudicates close-out.

**The Reviewer's verdict on the track is favourable, and that framing matters for how this pass is read.**
The two Session-22-class traps the primer was written to catch are genuinely closed: the contract suite
parameterises over **all three** implementations rather than excluding the real ones, and both shared
functions were re-grepped per caller with every caller covered. The anti-circularity fixtures the ADR
asked for exist and are the right shape — the LinkedIn `x-restli-id` **decoy body**, the X expiry
**disagreement** fixture, the media guard's **zero-fetch** assertion, and D-α's **second** (refresh-token)
`vault_update_secret` error check. Four scans were demonstrated to redden with the transcript recorded.
The Builder self-reported two defects (the zero-caller `revokeAccessToken`, the red `db-tests`) that a
less honest pass would have buried, and §14's manual-verification log is **empty** because no live
verification was performed — which is the honest state, not a gap.

**So this pass is not a rescue either. Its findings concentrate in exactly one place, and the ADR named
that place itself: §13's rule against writing a platform fact from memory.** BLOCKER-1, MINOR-1 and
MINOR-2 are the same defect at three degrees of honesty — an unsourced URL wearing a citation, a sourced
URL recorded only in a code comment, and a guess correctly labelled as a guess. MAJOR-3 is the same
family one level up: a platform fact N2.1 correctly **escalated**, which then fell between N2.1, §13 and
N2.7 and reached the head as silence.

**The single process lesson of this pass, and it belongs in the ADR rather than in a commit message:**
*a platform fact is sourced in exactly one place, and a citation is a promise that the cited place
contains it.* A citation that points at a record which does not contain the claim is worse than no
citation, because it converts "unverified" into "someone already checked" for every future reader.
BLOCKER-1 is that sentence.

**Founder direction — every finding is fixed, including the ones the Reviewer graded as deferrable.**
Per founder direction (as in Sessions 23-E, 24-D, 25-D, 26-D, 27-D, 28-D and 29-D), MINOR-1…7 and
NIT-1…4 are **resolved in this pass anyway**, each with its own resolution row — **including any that is
declined, deferred or argued rather than changed**. MINOR-2 is expected to be one of those (the reviewer
raised it *"only so the correction pass has an ID for it"*), and the two founder adjudications the review
restated as open get rows recording the ruling even where no code moves. An unexplained gap between
findings and resolutions is what makes the trail unreadable later; a deferral **with a row** is a
decision, a deferral **without one** is an omission.

**The tally reconciles, and this pass says so rather than assuming it.** The report's closing line reads
*"16 findings (2 BLOCKER, 3 MAJOR, 7 MINOR, 4 NIT)"* and the body carries BLOCKER-1…2, MAJOR-1…3,
MINOR-1…7 and NIT-1…4 — **sixteen IDs, and the arithmetic is right.** Add the two founder adjudications
restated as open and the resolution log carries **eighteen rows**. That row count is the check that
nothing was lost between the report and the pass. (Unlike Session 29, there is no miscount to argue in the
appendix — recorded here so a later reader knows it was checked, not skipped.)

### Adjudications A-9 … A-12 — RAISED HERE, founder rules before D4 and D6 run

The Reviewer correctly refused to choose for us in four places. **§0's L-1…L-12 and §0.2's A-1…A-8 / A-5′
/ A-8a are NOT reopened by any of them** — in particular A-8 (LinkedIn ships member-only, organization
posting deferred behind a legal entity) stands exactly as written, which is why A-9 is a *product-copy and
launch-scope* ruling and **not** a reopening of A-8.

| # | Item | Recommended ruling (founder to confirm) | Named loser | Where it lands |
|---|---|---|---|---|
| **A-9** | **Founder adjudication 1, restated open by the Reviewer** — CLAUDE.md's locked launch platforms read **"LinkedIn (Business and Founder)"**; A-8 defers organization posting behind a legal entity that does not exist and a Community Management API approval that can still be refused. **Launch as built delivers the Founder half only.** ADR §16 item 1 calls it *"the most likely long pole in the whole pre-launch plan"* | **Launch member-only, and say so in customer-facing copy.** The locked list is amended **in place with a dated note, not rewritten**: LinkedIn ships as *Founder profile at launch; Company Page when the entity and Community Management API approval land*. Pricing copy, the accounts surface and `pre-launch-scope.md` all state it. The strategic decision is not abandoned — it is **staged**, and the staging is visible to the customer before they pay. | **Silence — shipping member-only while the marketing site still promises Business.** That is a promise the product cannot keep on day one, discovered by the customer rather than disclosed by us, on the exact platform the ICP cares most about. Also rejected: **holding launch for the entity**, which makes an unbounded legal timeline the critical path for the whole product. | `CLAUDE.md` locked-decisions note; `docs/pre-launch-scope.md`; `docs/product-status.md`; `launch-checklist.md` §16a; ADR §16 item 1. **Step D4** records the ruling; no code. **⚠️ SUPERSEDED BY A-9′ — the ruling went against this recommendation, and it is preserved rather than rewritten** |
| **A-9′** | **Ruled 2026-09-05, superseding A-9.** Founder: *"I want to ship with both account types… just ignore what I said, ship both account types."* The member-only launch framing is **rejected**, and the locked list is **not** amended. **A same-day challenge to A-5′'s premise** (that LinkedIn's review gate covers member posting too, which would have meant LinkedIn could not publish at all) **was raised and then explicitly withdrawn by the founder.** It is recorded here because it was raised, not because it stands: **A-5′ and A-8 are unchanged and unreopened** | **Ship both account types; write no "member-only" copy; amend no locked decision.** Three things make this deliverable rather than aspirational, and the third is the honest part. (1) **The dual-identity model already shipped in this very session** (A-6/A-8a) — `posts.social_account_id`, the resolver, and the two-identity accounts surface are built and tested; nothing further is needed to *support* two account types. (2) **X delivers both fully at launch** — Business and Founder are two OAuth connections against two accounts, needing no elevated tier and no approval. (3) **LinkedIn Company Page posting remains gated externally** on the registered legal entity and Community Management API approval (A-8) — that is not a decision anyone can take, so the ruling cannot make it ship. **Concretely: LinkedIn Company Page renders `coming_soon`** — the pattern A-1 already established for the three Meta platforms — so the capability is visible and honestly stated rather than absent, promised, or silently broken | **Amending the locked platform list, or writing "LinkedIn: Founder profile only" into customer-facing copy** — the A-9 recommendation, rejected. It narrows a strategic decision in response to a timing problem, and bakes a temporary external gate into permanent product prose. **Also rejected: promising Company Page posting on a surface that cannot yet perform it**, which is the failure A-9 was actually trying to prevent and which `coming_soon` prevents instead | **D4** records the ruling; no code — items (1) and (2) already shipped, and (3) is a `coming_soon` state that `lib/social/connection-status.ts` and `PLATFORM_CONFIGS` already express. Touches ADR §16 item 1 and `launch-checklist.md` §16a only |
| **A-10** | **Founder adjudication 2, restated open by the Reviewer** — §14.3 records **$0.200 per linked X post** against a Pro plan advertising **unlimited posts** at €125/mo. Ten linked posts a day is roughly half the plan price on one platform. N2.1 additionally found an unresolved source discrepancy on the pay-per-use read cap (2M vs §14.3's 3M) | **Record the exposure as a stated-open pricing item with a named ceiling to be set before launch** — this is a pricing decision, not an engineering one, and this pass must not invent a number. What the pass **does** owe: the arithmetic written down where pricing is decided (`pre-launch-scope.md` / `launch-checklist.md`), the 2M/3M discrepancy carried as unresolved rather than silently resolved to either figure, and **no code-level cap introduced** — a throttle nobody adjudicated is worse than a documented exposure. **⚠️ NARROWED BY THE FOUNDER, 2026-09-05 — the ceiling is withdrawn.** The founder rejected the ten-posts-a-day figure as unrealistic — *"that's just noise"* — and is right: 300 linked posts a month is not a content strategy, a human-approval workflow will not produce it, and presenting a worst-case ceiling as a forecast was the error. **Recomputed at a realistic 2–3 linked posts a day: roughly $12–18/month against a €125 plan — under 15%, an ordinary COGS line**, and that is still the high end because not every post carries a link. **Therefore: record the cost model with THAT arithmetic, and no more.** No ceiling to be set, no stated-open pricing decision, and (unchanged) no code-level cap. **The 2M/3M read-cap discrepancy stays open** — that is a factual gap in N2.1's record, not a pricing judgement, and it costs nothing to carry. | **Treating "unlimited" as costless because no customer has connected yet.** The cost is per-post and linear; the first heavy Pro customer discovers it for us. Also rejected: **quietly capping posts in code** to protect margin, which makes the product silently different from what was sold. | `docs/pre-launch-scope.md`; `launch-checklist.md`; ADR §16. **Step D4** records the ruling; no code |
| **A-11** | **MAJOR-3** — N2.1 escalated the `r_member_postAnalytics` scope; ADR §13 item 8 restated it as *"an open decision for N2.7's author or the Architect"*; N2.7 shipped `PLATFORM_CONFIGS.linkedin.scopes = ['openid','profile','email','w_member_social']` **without it and without a decision**, and §16's eight stated-open items do not include it. Four of seven `PostMetrics` fields are permanently null for LinkedIn as a **SOSH scope choice**, not a platform limit | **Add `r_member_postAnalytics` to `PLATFORM_CONFIGS.linkedin.scopes` now, while it is free.** Scopes are baked into the token at authorisation; **no production LinkedIn OAuth app is registered yet** (§14.1), so today the change costs one line and one test. After first connection it costs a forced re-authorisation of every connected user — and §16 item 7 already plans one of those for `w_organization_social`. **The A-8 withdrawal does not apply here**: `w_organization_social` fails in the authorize URL until the *product* is approved, whereas `r_member_postAnalytics` is a member scope on the same auto-enabled product tier. **Verify that last claim against the vendor doc in-step (§13's rule), and if it turns out to sit behind a review, fall back to the loser below and say so.** **✅ CONFIRMED BY THE FOUNDER, 2026-09-05 — *"Yes."*** The in-step vendor-doc verification is **not** waived by the confirmation: the ruling is *add the scope*, and §13 still requires the scope string itself to arrive with a source and a read-date. A founder "yes" authorises the decision, never the fact. | **Recording it as a §16 stated-open item and shipping without the scope.** Acceptable only if the scope proves to be review-gated; otherwise it permanently degrades LinkedIn analytics on a Pro tier that advertises *"advanced analytics"*, or buys a second forced re-authorisation. **Silence is the one outcome that is not acceptable** — a decision N2.1 correctly escalated has already been lost between three steps once. | `lib/social/platforms/config.ts`; `lib/social/__tests__/` scope test; ADR **§6 / §16 amendment**; step **D4** |
| **A-12** | **MINOR-6** — `connection-status.ts:26-31` returns `expiring_soon` for **negative** `daysUntilExpiry`, so an account whose 60-day LinkedIn token expired three days ago renders *"expires soon, renew it"* with a past date. The worker behaves correctly (`TOKEN_REVOKED`); the **accounts surface** tells the user their dead connection is fine-for-now. The Reviewer flags that a sixth state is a genuine widening of §9.4's five, so it may be an ADR question | **Route `daysUntilExpiry < 0` to the existing `disconnected` state. Do not add a sixth state.** §9.4's five states are an ADR-level contract; an expired token *is* disconnected in every way the user can act on — the required action is identical (reconnect), and the copy and CTA already exist in all three locales. This is a **boundary correction inside the existing contract**, not a widening of it, so it needs no ADR amendment beyond a one-line §9.4 note that the boundary is `< 0 → disconnected`. **✅ CONFIRMED BY THE FOUNDER, 2026-09-05 — *"OK."*** No sixth state; D6 implements as recommended. | **A sixth `expired` state.** It duplicates `disconnected`'s copy, CTA and handling for a distinction the user cannot act on differently, and it costs three new i18n keys ×3 locales plus an ADR §9.4 amendment. Also rejected: **leaving it**, given LinkedIn's non-refreshable 60-day token makes this the single most common reconnection event the product will generate. | `lib/social/connection-status.ts`; `connection-status.test.ts`; ADR **§9.4 note**; step **D6** |

**Why A-11 is the one a Builder is most likely to get half-right.** Adding the scope string to
`PLATFORM_CONFIGS.linkedin.scopes` is one line and looks finished. It is not: `SOCIAL-LI-SCOPES` must gain
a positive assertion that the scope is **present** (today's tests only assert `w_organization_social` is
**absent**, per A-8), §6's capability table must be re-derived — the four fields stop being permanently
null and become *available-pending-Session-33* — and §13's own rule applies to the scope string itself,
which must be read from the vendor doc in-step with a source and a read-date, not typed from memory. A
scope added without those three is the same defect BLOCKER-1 raises, committed inside the fix for it.

### What the Reviewer found (summary — `session-30-5-reviewer.md` is authoritative)

| ID | Tier | One line | Fixed in |
|---|---|---|---|
| — | audit | `docs/reviews/session-30-5-reviewer.md` is **untracked** (`??`) at the range head; every step below amends or cites it | **D0** (first, deliberately) |
| BLOCKER-1 | BLOCKER | Three shipped endpoint URLs — `X_AUTHORIZE_URL`, `X_TOKEN_URL`, `LINKEDIN_POSTS_URL` — cite N2.1 items that **do not contain them**; every provider test mocks `fetch`, so the first exercise is the first real customer connection. A self-concealing defect of the exact class §13 exists against | **D1** |
| MINOR-1 | MINOR | `LINKEDIN_USERINFO_URL` / `X_USERINFO_URL` are sourced **honestly but only in a code comment**, outside N2.1's log; and LinkedIn's OIDC `subject_types_supported: ["pairwise"]` question — whether `sub` is the id space `urn:li:person:` expects — is raised **only in that comment**, not in §16 | **D1** |
| MINOR-2 | MINOR | `X_REVOKE_URL` is *"the standards-compliant best guess, not a confirmed URL"* — **correctly disclosed**, raised only so this pass has an ID for it; untested in both senses because MAJOR-1 means it is never called | **D1** (documented) / **D3** (called) |
| MAJOR-2 | MAJOR | `resolvePublishAccount`'s pinned branch calls `getActiveById`, which filters on `id` + `is_active` **only** — no `business_id`, no `platform` — under a **service-role client that bypasses RLS**, with both values in hand at the call site. Latent cross-tenant publish; `disconnect/route.ts:52-55` already checks both against the same helper | **D2** |
| MAJOR-1 | MAJOR | `revokeAccessToken` has **zero production callers**; `SOCIAL-REVOKE-NEVER-BLOCKS` is vacuously satisfied. A founder who disconnects X leaves a **live token at X**, and SOSH has deleted the vault record that could ever revoke it. §16 item 5's accepted risk assumes a revoke is *attempted* | **D3** |
| MAJOR-3 | MAJOR | `r_member_postAnalytics` was escalated by N2.1, restated as open by §13 item 8, and then **neither shipped nor recorded** — four `PostMetrics` fields permanently null as a SOSH choice, and the window in which the fix is free closes at first customer connection. A-11 | **D4** |
| — | adjud. | **Founder adjudication 1** — LinkedIn against a locked *"LinkedIn (Business and Founder)"*. **RULED 2026-09-05: ship both account types**, amend no locked decision, write no member-only copy; Company Page renders `coming_soon` while A-8's entity gate holds. A-9 → **A-9′** | **D4** |
| — | adjud. | **Founder adjudication 2** — X's **$0.200 per linked post** against Pro's *"unlimited posts"*. **RULED 2026-09-05: not material** — recomputed at 2–3 linked posts/day it is ~$12–18/mo, under 15% of a €125 plan; no ceiling, no cap. N2.1's 2M/3M read-cap discrepancy **stays open**. A-10 | **D4** |
| MINOR-3 | MINOR | `boundRetryAfterSeconds` **bounds nothing** — `Number.isFinite(c) ? c : fallback`. A hostile `Retry-After: 999999999` passes untouched into `SocialProviderError.retryAfterSeconds` and thence into worker scheduling. The `isFinite` guard is right; the **name promises more than it delivers** | **D5** |
| MINOR-4 | MINOR | `no-postiz.test.ts:107` excludes `__fixtures__` via `EXCLUDED_DIR_NAMES` alongside `node_modules`/`.git`/`.next` — but `__fixtures__` **is** source, in a scan whose own comment block promises fourteen exemptions each with a stated reason. A hole in the guarantee, not a live leak | **D5** |
| MINOR-6 | MINOR | An **expired** token renders `expiring_soon` — `differenceInCalendarDays <= 7` includes negatives — telling the user to renew something already dead, at the product's single most common reconnection event. A-12 | **D6** |
| MINOR-7 | MINOR | `resolvePublishAccount`'s `'ambiguous'` outcome surfaces as `errorCode: 'TOKEN_REVOKED'` with `errorDetails.reason: 'account_ambiguous'`. The code is the one L-1 permits; the **UI copy** it maps to says *reconnect* when the correct action is *pick an identity* | **D6** |
| MINOR-5 | MINOR | `provider-contract.test.ts:87-95`'s exemption comment describes N2.10 as future (*"until N2.10 makes the registry overrides-only"*, *"the moment N2.10 adds…"*); **N2.10 landed at `79408992` inside this range**. Substantively true, tense false — the stale-comment class that made `launch-checklist.md` §16 row 4 wrong | **D7** |
| NIT-1 | NIT | `provider_unavailable` exists in all three locale files, **no route emits it**, `resolve-banner.ts:5-12` deliberately excludes it from `ERROR_KEYS`, and `accounts-i18n.test.ts` **still asserts its presence** — a translated string no code path can produce, kept alive by a test | **D7** |
| NIT-2 | NIT | ADR §16's items are numbered 1,2,3,4,5,6,**8,7** — the last two transposed | **D7** |
| NIT-3 | NIT | The §3a Reviewer primer says *"all six credentials"*; there are **four**. Same class as the build guide's *"eight rows"* for §16's seven and *"four states"* for §9.4's five — **one sweep, not three more piecemeal corrections** | **D7** |
| BLOCKER-2 | BLOCKER | `SOCIAL-VAULT-UPDATE-SECRET` — the Tier-1 constraint proving D-α — has **never executed green in CI**; `SOCIAL-DUAL-IDENTITY-SCHEMA` has no green record either. Cause is confirmed **infrastructure, not a DB regression** (503 to *every* role incl. `service_role`, after prior 204s, `57P03` in recovery, no OOM kill) — but ADR 0015 §2's *"covered = executed green in CI, never authored"* makes both `AUTHORED-NOT-EXECUTED` regardless of cause | **D8** |
| NIT-4 | NIT | ADR §17.4's `db-tests` paragraph names **two** invisible suites; the run shows **seven** (`campaigns-social-accounts-role-policies`, `governed-memory-recency-column`, `learning-report-orphans`, `performance-memory-candidates-expiry`, `post-ai-originals-latest-per-post`, `reissue-invite`, `signals3-triage-atomic`). Under-reported blast radius | **D8** (with BLOCKER-2) |
| — | — | Re-green the corrected range; record both run URLs and the skip-guard's file/test counts **verbatim from the log**; complete the appendix; §5 close-out docs | **D9** |

### Ordering rationale (state it in the resolution log so it does not read as arbitrary)

1. **D0 runs FIRST**, the 25-D…29-D precedent. The reviewer report is untracked at the range head;
   appending a resolution row to an untracked file produces no diff and no history, and the whole value of
   `REVIEWER-REPORT APPEND-ONLY` is that the diff proves nothing above the appendix moved.
2. **D1 (provenance) comes before every code step**, and not by severity alone. BLOCKER-1, MINOR-1 and
   MINOR-2 are one defect at three degrees, and D3 and D4 both *add* platform facts (a revoke call that
   uses `X_REVOKE_URL`, a LinkedIn scope string). Fixing the provenance discipline **after** adding two
   more facts to it would mean auditing the record twice, and would invite the fix for A-11 to commit
   BLOCKER-1's defect inside it.
3. **D2 (MAJOR-2) is the first code step** because it is the only finding in the pass with a **cross-tenant
   publish** as its failure mode. It is latent — nothing in the range writes `posts.social_account_id` —
   but `PostInsert` exposes the field, the identity picker that populates it is the acknowledged next step,
   and the guard is three lines. A latent cross-tenant defect is not left for whichever session happens to
   wire up the writer.
4. **D3 (MAJOR-1) follows D2** because both touch account resolution and D2's guard changes what a caller
   can hold when the revoke runs. It also **consumes D1's output**: the revoke call is the first production
   use of `X_REVOKE_URL`, so MINOR-2's guess stops being untested-in-both-senses at exactly this step.
5. **D4 groups the three decision items (A-9, A-10, A-11)** because all three are *founder rulings recorded
   as durable decisions*, two of them with no code at all. Splitting them across three commits would make
   two documentation-only commits look like fixes and hide the one line of code inside them.
6. **D5 groups the two "guarantee weaker than its name" findings** (MINOR-3, MINOR-4). Both are the same
   shape — a guard whose contract is broader than its implementation — and both are contained, low-blast
   changes to shared helpers that everything after them runs through.
7. **D6 groups the two user-facing findings** (MINOR-6/A-12, MINOR-7) because they are one surface and one
   i18n sweep across three locales. Doing them separately means two passes over `en`/`pt`/`es` and two
   chances to leave a locale behind.
8. **D7 is the documentation-and-comment truth sweep** (MINOR-5, NIT-1, NIT-2, NIT-3) and it is not
   cosmetic: NIT-3 is explicitly *"worth one sweep rather than three more corrections"*, and every item
   here is a statement that was true when written and is false now — the same class as MINOR-5's tense and
   §16 row 4's "moot once the file is gone".
9. **D8 (BLOCKER-2) is deliberately late.** Its remedy is either a green `db-tests` run at a commit
   containing this range, or an honest `AUTHORED-NOT-EXECUTED` marking — and the *first* of those can only
   be attempted once every migration-touching change in this pass has landed. Running it early would prove
   a head that no longer exists.
10. **CI runs LAST (D9)**, and its job is not merely to re-green: it produces the green run **for the
    corrected range**, which is what makes D8's and D7's re-citations true rather than merely reworded.

### Where resolutions go (CLAUDE.md — `REVIEWER-REPORT APPEND-ONLY`, revised Session 23-D)

Directly into `docs/reviews/session-30-5-reviewer.md`, under a **single appended, attributed**
`## CORRECTION PASS (Session 30.5-D)` section at the **end** of the file — no separate corrections file.
The four conditions, all load-bearing, all inherited here:

1. **No in-place edit, ever.** Not one character of the reviewer's text changes — no verdict flipped, no
   status column rewritten, no RESOLVED stamped onto a finding, no finding reworded, deleted or reordered.
   **This explicitly includes** §1–§12's per-section ✅ verdicts, §10's two caller tables, the *"What I
   could NOT verify, and why"* section and the closing tally line, which all stand exactly as written even
   after every finding is closed. The Session 22-D failure — RESOLVED verdicts written *into* the
   reviewer's finding text — remains prohibited.
2. **One appended, attributed section** at the **end**, opening with its author, date and the commit range
   it fixed. A reader must be able to tell, from any line, which of the two wrote it.
3. **Findings are referenced, never restated as resolved** — cite each by ID and record
   *finding → fix → the test that now proves it → the commit SHA*.
4. **A disputed, declined or deferred finding is argued, not erased** — say why in the appendix and let the
   reader judge against the reviewer's original text.

**Sixteen finding IDs plus two founder adjudications exist; the appendix carries eighteen rows.**

### Standing rules for every step in this pass

- **§0's L-1…L-12 and §0.2's A-1…A-8 / A-5′ / A-8a still hold.** In particular: **L-1** — no change to
  `lib/publishing/orchestrator.ts`'s retry, backoff, error-switch or state-transition behaviour, and **no
  new member of the error-code union** (this is why MINOR-7 is a *copy* fix and not a new code); **A-1** —
  the three Meta platforms stay unregistered with `publishingAvailable: false`; **A-3** — no media upload;
  **A-4** — the advisory lock stays deferred; **A-8** — `w_organization_social` stays out of LinkedIn's
  scopes, which A-11 does **not** change. **`SOCIAL-NO-READ-PATH` is live**: Session 32's engagement-read
  deliverable is untouched by every step here. A fix that appears to need one of these is a **STOP and
  report**, not a judgement call. The scans in `lib/scope-scans.test.ts` and `no-postiz.test.ts` enforce
  several mechanically — treat a red scan as the rule working, never as a test to relax.
- **§13's rule is the spine of this pass and applies to the pass itself.** No platform fact — endpoint,
  scope string, header name, status code, limit — is written from memory or from a model's recollection,
  **including inside a fix for a finding about exactly that.** Every fact lands with a named vendor-doc
  source and a read-date, in N2.1's log or a dated appendix to it, or it is labelled unverified in
  `X_REVOKE_URL`'s disclosed form. **There is no third option.**
- **Never weaken a test to reach green, and never delete a test to tidy code.** NIT-1's fix removes an
  assertion about a string nothing emits — that is the *only* deletion this pass authorises, and it is
  paired with removing the string, not with lowering a bar.
- **New and rewritten tests must be shown to REDDEN against the pre-fix code** — mutate, observe red,
  revert — and the mutation must be **named in the commit message**. Asserted-green is not proof. This
  session's own §17.1 set that standard with four demonstrations; this pass meets it.
- **Each step:** `/ecc:plan` → `/ecc:tdd-workflow` → `/ecc:verification-loop`;
  `npx tsc --noEmit --skipLibCheck`; scoped `npx vitest run` per CLAUDE.md's invocation notes;
  `npm run test:db` wherever Tier-1 is touched. **One commit per step.**
- **ECC budget: ≤1 subagent per step, and only where the step names one** — D2 `database-reviewer` (a
  tenancy guard on a service-role query path), D3 `security-reviewer` (token revocation and disconnect
  ordering), D8 `database-reviewer` (the Tier-1 grants and the db-tests readiness race). Nothing anywhere
  else. Do not re-run §1's advisory reviewers.
- **The three highest-risk changes in this pass, named so nobody discovers them at D9:** **D2** changes
  which account the publishing **and** metrics workers resolve (a wrong fix either publishes to the wrong
  tenant — the exact defect — or makes correctly-pinned posts unpublishable); **D3** adds a **live network
  call inside the disconnect path** (a wrong fix makes disconnect fail when the platform is down, which is
  the precise thing `SOCIAL-REVOKE-NEVER-BLOCKS` forbids, and it must be ordered *before*
  `deactivateSocialAccount` because the vault secret must still exist to read the token); **D4** changes an
  OAuth **scope**, which is baked into every token issued afterwards and cannot be altered without forcing
  re-authorisation.

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
Session 30.5-D — Track N: native platform providers and the removal of Postiz (ADR 0028 + ADR 0002
Amendment A), CORRECTION pass. You are fixing the findings in docs/reviews/session-30-5-reviewer.md
(reviewed range 54110178..be03c917, N2.1…N2.13-D2). Ten steps, D0…D9, each its own commit.

Read now, before anything else:
- docs/reviews/session-30-5-reviewer.md — IN FULL. It is your work order AND the file you record
  resolutions in. Append a single `## CORRECTION PASS (Session 30.5-D)` section at the END; do NOT edit
  any finding in place, do NOT touch the per-section verdicts, the two caller tables, the "What I could
  NOT verify" section or the closing tally line, and do NOT create a separate corrections file (CLAUDE.md
  REVIEWER-REPORT APPEND-ONLY). A finding you DISPUTE, DECLINE or DEFER is argued in the appendix — never
  erased, never restated as resolved. There are SIXTEEN finding IDs (BLOCKER-1..2, MAJOR-1..3, MINOR-1..7,
  NIT-1..4) plus TWO founder adjudications restated as open; the appendix carries EIGHTEEN rows. The
  report's tally line is CORRECT — verify that for yourself, do not assume it.
- docs/build-guide/session-30-5.md §0 (L-1..L-12), §0.2 (A-1..A-8, A-5-prime, A-8a — still binding, NOT
  reopened; A-8 in particular is why A-9 is a copy-and-scope ruling and not a reopening) and §4 (this
  section — the step list, adjudications A-9/A-10/A-11/A-12, and the ordering rationale).
- docs/decisions/0028-native-social-providers.md — §2 (OAuth ownership), §3.1/§3.2 (the publish contract
  and the endpoints BLOCKER-1 hits), §4 (token lifecycle, D-alpha), §5.3 (the dual-identity resolver —
  MAJOR-2), §6 (the metrics capability table — MAJOR-3/A-11 changes it), §7.2 (rate limits — MINOR-3),
  §9.1 (the contract suite — MINOR-5), §9.4 (the five connection states — MINOR-6/A-12), §13 (the nine
  unverified platform facts — the spine of this pass), §14.1 (why the first live connection is the
  riskiest moment), §16 (the stated-open items — NIT-2's numbering, and three findings need rows here) and
  §17.3/§17.4/§17.5 (the caller tables, the constraint-to-CI map and the Tier-3 decisions — BLOCKER-2 and
  NIT-4 change §17.4).
- docs/decisions/0015-test-execution-and-ci-gates.md §1(c), §2 and §5 — "covered = executed green in CI,
  never authored" is the sentence BLOCKER-2 is an instance of, and §5's merge-gate table is why a
  correctly-diagnosed infrastructure failure is still an uncovered constraint.
- docs/reviews/session-30-5-platform-verification.md — N2.1's verification log. D1 appends to it; read
  what it actually contains BEFORE you believe any citation that points at it.

Binding rules for this pass:
- L-1..L-12 and A-1..A-8/A-5-prime/A-8a still hold. No change to the publishing worker's retry, backoff,
  error switch or state transitions; NO new member of the error-code union (that is why MINOR-7 is a copy
  fix); no Meta provider registered; no media upload; no advisory lock; w_organization_social stays OUT of
  LinkedIn's scopes. SOCIAL-NO-READ-PATH is live — Session 32's deliverable is untouched. A fix that seems
  to need one of these is a STOP.
- ADR 0028 §13 governs this pass ITSELF. Do not write ANY platform fact — endpoint URL, scope string,
  header, status code, limit — from memory or recollection, INCLUDING inside a fix for a finding about
  exactly that. Every fact lands with a named vendor-doc source and a read-date in N2.1's log or a dated
  appendix to it, OR it is labelled unverified in X_REVOKE_URL's disclosed form. There is no third option.
  If you cannot reach a vendor doc, say so and label the fact unverified — do NOT fill the gap.
- A-9, A-10, A-11 and A-12 are adjudicated in §4 above. Do NOT re-litigate them. For A-11 specifically:
  verify in-step that r_member_postAnalytics is available on the same auto-enabled product tier as
  w_member_social; if it turns out to sit behind a review process, take the named loser (a §16
  stated-open row) and SAY SO — do not ship a scope that will fail in the authorize URL.
- NEVER weaken a test to reach green, and never delete a test to tidy code. Every new or rewritten test is
  demonstrated to REDDEN against the pre-fix code (mutate, observe red, revert) and the mutation is NAMED
  in the commit message.
- Each step: /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. npx tsc --noEmit --skipLibCheck;
  scoped npx vitest run per CLAUDE.md; npm run test:db for Tier-1.
- ECC: <=1 subagent per step, and only where §4 names one — D2 database-reviewer, D3 security-reviewer,
  D8 database-reviewer. Nothing anywhere else.

Confirm these grounding facts (a wrong one is a STOP):
(1) git status — docs/reviews/session-30-5-reviewer.md is UNTRACKED (`??`). That is D0's scope.
(2) Open docs/reviews/session-30-5-platform-verification.md and confirm for yourself that the literal
    strings 'https://x.com/i/oauth2/authorize', 'https://api.x.com/2/oauth2/token' and
    'https://api.linkedin.com/rest/posts' do NOT appear in it, while lib/social/twitter-provider.ts:23-30
    and lib/social/linkedin-provider.ts:23-32 cite it for them. That is BLOCKER-1.
(3) lib/db/social-accounts.ts:184-187 — the pinnedAccountId branch calls getActiveById and returns, and
    getActiveById (:135-146) filters on .eq('id', id) and .eq('is_active', true) ONLY. Quote both. Then
    read app/api/social/[platform]/disconnect/route.ts:52-55, which checks business_id AND platform
    against the same helper. That is MAJOR-2.
(4) `git grep -n revokeAccessToken -- app lib` returns hits ONLY in the three provider implementations,
    the interface, and test files — nothing in app/api/social/[platform]/disconnect/route.ts, which calls
    deactivateSocialAccount(account.id) and nothing else at :67. That is MAJOR-1.
(5) lib/social/platforms/config.ts:22 — linkedin.scopes is exactly ['openid','profile','email',
    'w_member_social']; r_member_postAnalytics is absent; and ADR 0028 §16's eight stated-open items do
    not mention it. That is MAJOR-3 / A-11.
(6) lib/social/error-mapping.ts:35-37 — boundRetryAfterSeconds returns
    `Number.isFinite(candidateSeconds) ? candidateSeconds : fallbackSeconds` and applies no ceiling. That
    is MINOR-3.
(7) lib/social/connection-status.ts:26-31 — `daysUntilExpiry <= EXPIRY_WARNING_DAYS` with no lower bound,
    so a negative value returns 'expiring_soon'. That is MINOR-6 / A-12.
(8) lib/social/__tests__/no-postiz.test.ts:107 — EXCLUDED_DIR_NAMES contains '__fixtures__' alongside
    node_modules/.git/.next, while the comment block at :13-79 promises fourteen exemptions each with a
    stated reason. That is MINOR-4.
(9) Open db-tests run 33970947727 at be03c917 and read the skip-guard output: SEVEN suites reported
    invisible, while ADR 0028 §17.4's db-tests paragraph names TWO. That is BLOCKER-2 / NIT-4.
Output the sixteen findings plus two adjudications grouped by step (D0…D9), the four adjudications with
their rulings, and "Ready for D0." Then stop.
```

### §4.1 — Correction steps

#### D0 — audit trail: land the reviewer report in git, unmodified  ·  FIRST, by design  ·  no code

```
CORRECTION — Session 30.5-D · D0. No .ts, no .tsx, no .sql. Invoke no specialist — this is audit-trail
integrity.

THE DEFECT: docs/reviews/session-30-5-reviewer.md is UNTRACKED at the range head (git status shows `??`).
Every step below either amends it or cites it, and an appended resolution row against an untracked file
produces no diff — which destroys the one property REVIEWER-REPORT APPEND-ONLY exists to give a later
reader: proof that nothing above the appendix was touched.

DO — commit these files EXACTLY AS THEY STAND, with no edits in this commit:
- docs/reviews/session-30-5-reviewer.md   (as the Reviewer left it, before any resolution row)
- docs/build-guide/session-30-5.md        (it enters this commit WITH §4 already authored — §4 is this
                                           step's own work order, so it cannot land later. Say so in the
                                           commit message.)

Do NOT append the CORRECTION PASS section here. Do NOT fix NIT-2's numbering in ADR 0028 here — that is
D7. Do NOT touch any provider file — that is D1.

VERIFY: `git show --stat HEAD` lists exactly those two paths, and nothing else.

COMMIT: "30.5-D0: land the N3 reviewer report in git, unmodified (audit trail)" — and state in the body
that §4 of the build guide enters here because it is D0's own work order.
```

#### D1 — BLOCKER-1 + MINOR-1 + MINOR-2: every platform fact has exactly one home  ·  ADR 0028 §13  ·  no behaviour change

```
CORRECTION — Session 30.5-D · D1. Invoke no specialist. Read ADR 0028 §13 and §14.1 first, and
docs/reviews/session-30-5-platform-verification.md IN FULL before you touch anything.

THE DEFECT (BLOCKER-1): three endpoint URLs ship with a citation to a record that does not contain them.
- lib/social/twitter-provider.ts:27  X_AUTHORIZE_URL   cites "N2.1 items 1/3/4/6/7"; item 1 is LINKEDIN's
                                                       authorize/token URLs, and NO item records an X
                                                       authorize URL at all.
- lib/social/twitter-provider.ts:28  X_TOKEN_URL       cites the same; item 4 records X's token-endpoint
                                                       AUTH METHOD and its source page, and NO URL.
- lib/social/linkedin-provider.ts:32 LINKEDIN_POSTS_URL cites "items 1, 9"; item 1 records the authorize
                                                       and token URLs only. §3.1 confirms the Posts API's
                                                       headers, its 201 + x-restli-id, its URN forms and
                                                       its permalink — the BASE URL is never written down.

THE DEFECT (MINOR-1): LINKEDIN_USERINFO_URL (linkedin-provider.ts:31) and X_USERINFO_URL
(twitter-provider.ts:29) are sourced honestly but ONLY in a code comment — the first casualty of a future
refactor. The LinkedIn note additionally raises a real open question (OIDC discovery declares
subject_types_supported: ["pairwise"], so `sub` may not be the id space urn:li:person: construction
expects) and raises it ONLY in that comment.

THE DEFECT (MINOR-2): X_REVOKE_URL (twitter-provider.ts:31-41) is "the standards-compliant best guess,
not a confirmed URL". The disclosure is EXACTLY RIGHT and is the model for this whole step — it is here
only to get a durable §16 row instead of living as a comment.

DO — for EACH of the five endpoint constants, exactly one of two outcomes, and no third:
  (a) VERIFIED — read the vendor doc NOW, record the URL in a dated appendix to
      docs/reviews/session-30-5-platform-verification.md ("Appendix A — endpoints verified in Session
      30.5-D, <date>"), each entry naming the source page and the read-date, numbered so a provider
      comment can cite a specific item; then update the provider comment to cite THAT item number.
  (b) UNVERIFIED — rewrite the provider comment in X_REVOKE_URL's exact disclosed form: what IS
      confirmed, what is NOT, and that the value is a best guess. Then add a §16 stated-open row.
DO NOT invent, recall, or "sanity-check from memory" any of these URLs. If a vendor doc is unreachable,
outcome (b) is the correct answer and is not a failure of this step.

DO — additionally:
- Promote the pairwise-`sub` question from linkedin-provider.ts's comment to an ADR 0028 §16 stated-open
  item, with the consequence named (a urn:li:person: constructed from a pairwise sub may not address the
  member the token belongs to).
- Add a §16 stated-open row for X_REVOKE_URL's unconfirmed value, cross-referencing that D3 makes it a
  live call path.
- Append to §13 the process lesson, in the ADR's own voice: a platform fact is sourced in exactly one
  place, and a citation is a promise that the cited place contains it. A citation that points at a record
  which does not contain the claim converts "unverified" into "someone already checked".

MUST NOT: change any URL VALUE, any provider behaviour, or any test expectation. This step is provenance
only. `git diff` on the two provider files must show comments and nothing else — verify that literally.

VERIFY: npx tsc --noEmit --skipLibCheck; npx vitest run lib/social. For every one of the five constants,
grep the cited appendix item and show it contains the literal URL string.

COMMIT: "30.5-D1: BLOCKER-1/MINOR-1/MINOR-2 - every endpoint sourced or disclosed, none cited to a record
that lacks it (ADR 0028 §13)"
```

#### D2 — MAJOR-2: the pinned-identity branch checks tenancy and platform  ·  ADR 0028 §5.3  ·  `database-reviewer`

```
CORRECTION — Session 30.5-D · D2. ONE specialist: database-reviewer (a tenancy guard on a query path that
runs under a service-role client bypassing RLS).

THE DEFECT: lib/db/social-accounts.ts:184-187 —
    if (pinnedAccountId) {
      const account = await getActiveById(client, pinnedAccountId)
      return account ? { outcome: 'resolved', account } : { outcome: 'none' }
    }
getActiveById (:135-146) filters on .eq('id', id) and .eq('is_active', true) ONLY — not business_id, not
platform. BOTH production callers pass a SERVICE-ROLE client that bypasses RLS
(lib/publishing/orchestrator.ts:107, lib/metrics/orchestrator.ts:67) and BOTH already have
post.business_id and post.platform in hand and pass them — the function simply ignores them on this
branch. The same file already knows better: disconnect/route.ts:52-55 checks
`candidate.business_id === business.id && candidate.platform === platform` against the same helper.

FAILURE SCENARIO: a posts row in business A whose social_account_id points at an active account in
business B resolves to {outcome:'resolved'}; the publishing worker builds PublishInput with that
socialAccountId; the provider resolves BUSINESS B's vault token and publishes business A's content to
business B's LinkedIn or X. There is no later check. The metrics worker writes B's metrics onto A's post.

REACHABILITY IS LATENT, NOT LIVE, AND THAT IS NOT A REASON TO DEFER: nothing in the range writes
posts.social_account_id (PostUpdate excludes it, lib/db/types.ts:360), but PostInsert DOES expose it
(:342), the identity picker that populates it is the acknowledged next step, and the FK is a plain
REFERENCES with no cross-column constraint.

DO: resolvePublishAccount accepts the pinned account ONLY when
`account.business_id === businessId && account.platform === platform`, returning {outcome:'none'}
otherwise — NEVER 'ambiguous', and NEVER a silent substitution with a scan-resolved account. That matches
the function's own documented rule at :176-178; re-read it and keep the doc comment true. Name the
constraint (e.g. SOCIAL-PINNED-ACCOUNT-TENANT-CHECKED) and add it to ADR 0028 §17.4 with its tier and
executing job.

TESTS (Tier 2, all demonstrated to REDDEN against the pre-fix code):
- a pinned id belonging to ANOTHER BUSINESS resolves to 'none'
- a pinned id belonging to ANOTHER PLATFORM resolves to 'none'
- (regression) a correctly-owned pinned id still resolves to 'resolved' with that exact account
Optional hardening, only if database-reviewer says it is safe and additive: a Tier-1 composite FK. If it
requires a migration, that migration lands in THIS commit and D8 re-runs db-tests over it.

MUST NOT: change the non-pinned scan branch, the 'ambiguous' semantics, or either orchestrator's
behaviour beyond what the resolver returns (L-1).

VERIFY: npx tsc --noEmit --skipLibCheck; npx vitest run lib/db lib/publishing lib/metrics; npm run test:db
if a migration landed. Name the mutation used to prove each new test reddens.

COMMIT: "30.5-D2: MAJOR-2 - pinned-identity resolution checks business_id and platform (ADR 0028 §5.3)"
```

#### D3 — MAJOR-1: `revokeAccessToken` is actually called, and still never blocks  ·  ADR 0028 §16 item 5  ·  `security-reviewer`

```
CORRECTION — Session 30.5-D · D3. ONE specialist: security-reviewer (token revocation, and the ordering of
a network call against vault deletion).

THE DEFECT: app/api/social/[platform]/disconnect/route.ts:67 calls deactivateSocialAccount(account.id)
and nothing else. `git grep revokeAccessToken` finds the method on all three providers
(linkedin-provider.ts:340, twitter-provider.ts:473, mock-provider.ts:141) and called ONLY from tests.
SOCIAL-REVOKE-NEVER-BLOCKS is therefore VACUOUSLY satisfied: "each provider's revokeAccessToken never
throws" is true and proven; "a revoke is attempted during disconnect and a failure there does not block
local cleanup" describes wiring that does not exist. The Builder found and self-reported this in §17.3 —
it is restated as a finding because a self-reported defect is still a defect and needs an ID.

USER-VISIBLE CONSEQUENCE: a founder who disconnects X still has a LIVE access token sitting at X, and
SOSH has deleted the vault record that would let it ever be revoked. CLAUDE.md's three-step disconnect is
satisfied (deactivate, null the ids, delete the secrets), so this is NOT a GDPR-erasure gap on our side —
it is a live credential we told the user we let go of. §16 item 5's accepted risk ("a failed platform
revocation leaves a live token at the platform") assumes an attempt is MADE; today none is.

DO: disconnect/route.ts calls the platform's revokeAccessToken BEFORE deactivateSocialAccount — the vault
secret must still exist to read the token. The revoke's failure MUST NOT prevent the local disconnect
from completing: catch, do not propagate, and do not change the route's status codes or its 409
account_ambiguous behaviour.

TESTS (Tier 2, both demonstrated to REDDEN):
(a) revokeAccessToken IS called, with the right platform and the right account
(b) a THROWING revoke still results in a completed local disconnect (deactivateSocialAccount called,
    200 returned) — this is what SOCIAL-REVOKE-NEVER-BLOCKS was always meant to assert
Update ADR 0028 §17.3's Table B: revokeAccessToken now has a production caller; and §17.4's
SOCIAL-REVOKE-NEVER-BLOCKS row so its reddens-if-broken column describes the CALL SITE, not only the
implementations.

NOTE THE COUPLING TO D1: this is the first production use of X_REVOKE_URL. If D1 left it UNVERIFIED, that
is fine and expected — but say so in the commit body, because the guess now sits on a live path and its
§16 row must reflect that.

MUST NOT: add a new error code (L-1); block or slow disconnect on a network timeout — bound the call, and
state the bound; or introduce a retry.

VERIFY: npx tsc --noEmit --skipLibCheck; npx vitest run app/api/social lib/social. Name the mutation used
for each new test.

COMMIT: "30.5-D3: MAJOR-1 - disconnect attempts platform revocation before local cleanup, and never blocks
on it (ADR 0028 §16.5)"
```

#### D4 — MAJOR-3 + the two founder adjudications: three rulings recorded, one line of code  ·  A-9′, A-10, A-11  ·  **all three ruled 2026-09-05**

```
CORRECTION — Session 30.5-D · D4. Invoke no specialist. THREE decisions land here; two of them change no
code at all, and that is why they are grouped — so the one code change is not hidden inside two
documentation commits.

--- A-11 / MAJOR-3 (code + docs) ---
THE DEFECT: N2.1 escalated the r_member_postAnalytics scope as its single drift finding
(session-30-5-platform-verification.md:116); ADR 0028 §13 item 8 restated it as "an open decision for
N2.7's author or the Architect, not resolved here"; N2.7 then shipped
PLATFORM_CONFIGS.linkedin.scopes = ['openid','profile','email','w_member_social'] with neither the scope
nor a decision, and §16's eight stated-open items do not include it. Four of seven PostMetrics fields —
saves, clicks, reach, impressions — are permanently null for LinkedIn as a SOSH SCOPE CHOICE, not a
platform limit, on a Pro tier advertising "advanced analytics".

WHY NOW: scopes are baked into the token at authorisation. No production LinkedIn OAuth app is registered
yet (§14.1), so today the change is FREE. After the first customer connection it costs a forced
re-authorisation of every connected user, on top of the one §16 item 8 already plans for
w_organization_social.

DO — in this order:
1. VERIFY IN-STEP, per §13, against the vendor doc, with a source and a read-date recorded in D1's
   appendix: is r_member_postAnalytics available on the same auto-enabled product tier as w_member_social,
   or does it sit behind a review process? Do NOT answer this from memory.
2. IF auto-enabled: add it to PLATFORM_CONFIGS.linkedin.scopes. Then — and this is the half a Builder
   typically skips — (i) give SOCIAL-LI-SCOPES a POSITIVE assertion that the scope is PRESENT (today's
   tests only assert w_organization_social is ABSENT, per A-8), (ii) re-derive ADR 0028 §6's capability
   table so those four fields move from "permanently null" to "available, pending Session 33", and
   (iii) confirm A-8 still holds — w_organization_social stays OUT.
3. IF review-gated: take the named loser. Record a §16 stated-open row naming the consequence (four
   permanently-null fields, and a forced re-authorisation to undo) and SAY SO in the commit body. Do NOT
   ship a scope that will fail in the authorize URL.
Either way, §13 item 8 is marked adjudicated with the ruling and the date. Silence is the one outcome that
is not acceptable.

--- A-9-prime (docs only) — RULED 2026-09-05, and the ruling went AGAINST the A-9 recommendation ---
Founder: "I want to ship with both account types... just ignore what I said, ship both account types."
SHIP BOTH ACCOUNT TYPES. Do NOT amend CLAUDE.md's locked platform list. Do NOT write "member-only" or
"Founder profile only" into any customer-facing copy. The A-9 recommendation (stage it, say member-only)
is REJECTED and is preserved in §4's table as superseded — do not delete it, and do not implement it.

A same-day founder challenge to A-5-prime's premise — that LinkedIn's review gate covers MEMBER posting
too, which would have meant LinkedIn could not publish at all — was raised and then EXPLICITLY WITHDRAWN
by the founder. A-5-prime and A-8 are therefore UNCHANGED and UNREOPENED. Record that the challenge was
raised and withdrawn (one line, dated); do NOT record its content as a finding, and do NOT go verify it.

DO — three parts, and only the third is new work:
1. Nothing to build for dual identity: it ALREADY SHIPPED in this session (A-6/A-8a) —
   posts.social_account_id, resolvePublishAccount, and the two-identity accounts surface. Confirm that by
   reading them, and say so; do not rebuild.
2. Nothing to build for X: Business and Founder are two OAuth connections against two accounts, needing
   no elevated tier and no approval. Already works. Confirm and say so.
3. LinkedIn Company Page posting stays gated on the legal entity + Community Management API (A-8) — an
   EXTERNAL gate no ruling can lift. So render LinkedIn Company Page as `coming_soon`, the pattern A-1
   already established for the three Meta platforms. The capability is then visible and honestly stated
   rather than absent, promised, or silently broken.
Record the ruling in ADR 0028 §16 item 1 and launch-checklist.md §16a. That is all — pre-launch-scope.md
and product-status.md do NOT gain a member-only note, because there is no longer one to write.
MUST NOT: promise Company Page posting on any surface that cannot yet perform it. `coming_soon` is the
whole point — it is what makes "ship both account types" true rather than aspirational.

--- A-10 (docs only) — RULED 2026-09-05, NARROWED: the ceiling is withdrawn ---
§14.3 records $0.200 per linked X post against a Pro plan advertising unlimited posts at €125/mo. The
build guide's original ten-linked-posts-a-day figure was a WORST-CASE CEILING presented as a forecast,
and the founder rejected it as unrealistic — "that's just noise". He is right: 300 linked posts a month
is not a content strategy, and a human-approval workflow will not produce it.
DO: record the cost model at REALISTIC volume — 2-3 linked posts/day is roughly $12-18/month against a
€125 plan, under 15%, an ordinary COGS line, and that is the HIGH end because not every post carries a
link. Put it where pricing is decided (docs/pre-launch-scope.md and/or launch-checklist.md).
DO: carry N2.1's 2M-vs-3M pay-per-use read-cap discrepancy as UNRESOLVED — that is a factual gap in the
verification record, not a pricing judgement, and it is cheap to keep open.
MUST NOT: set a ceiling, open a stated-open pricing decision, or introduce ANY code-level post cap or
throttle. The founder ruled the exposure immaterial; recording it as an open risk anyway would be
re-litigating a decision that has been made.

VERIFY: npx tsc --noEmit --skipLibCheck; npx vitest run lib/social. If the scope landed, show the positive
assertion reddening when the scope is removed from config.ts.

COMMIT: "30.5-D4: MAJOR-3/A-9/A-10/A-11 - LinkedIn analytics scope adjudicated; member-only launch and X
per-post cost recorded as founder rulings"
```

#### D5 — MINOR-3 + MINOR-4: two guarantees narrower than their names  ·  ADR 0028 §7.2, §8.4

```
CORRECTION — Session 30.5-D · D5. Invoke no specialist. Two contained fixes to shared guards; both are
"the contract is broader than the implementation".

THE DEFECT (MINOR-3): lib/social/error-mapping.ts:35-37 —
    return Number.isFinite(candidateSeconds) ? candidateSeconds : fallbackSeconds
The Number.isFinite guard is CORRECT and does the job the ADR asked for (LinkedIn's Retry-After as an
HTTP-date yields NaN -> 60; a missing x-rate-limit-reset yields 0 -> the caller's 60 fallback). But the
NAME promises a bound that is never applied: a hostile or buggy `Retry-After: 999999999` passes through
untouched into SocialProviderError.retryAfterSeconds and thence into the publishing worker's scheduling.

DO — pick ONE and justify it in the commit body:
  (a) clamp to a stated ceiling — the publishing worker's own max backoff is the natural one; read it,
      cite it, do not invent a number; or
  (b) rename to finiteRetryAfterSeconds so it stops promising more than it delivers.
(a) is preferred IF AND ONLY IF the ceiling can be sourced from the worker's existing constant WITHOUT
changing worker retry behaviour (L-1). If reading it would couple the modules badly, take (b) — a guard
that is honestly named is better than one that is quietly re-scoped.

THE DEFECT (MINOR-4): lib/social/__tests__/no-postiz.test.ts:107 excludes '__fixtures__' from the walk via
EXCLUDED_DIR_NAMES, alongside node_modules, .git and .next. The other three are self-evidently not source;
__fixtures__ IS source, in a scan whose comment block at :13-79 promises FOURTEEN exemptions each with a
stated reason. No such directory currently contains a hit, so this is a HOLE IN THE GUARANTEE, not a live
leak — and the guarantee is the whole point of the scan.

DO — pick ONE:
  (a) remove '__fixtures__' from EXCLUDED_DIR_NAMES (preferred — the scan should see source), or
  (b) add it to the DOCUMENTED exemption list at :13-79 with its stated reason.
If (a) turns the scan red, that is a DISCOVERY, not a regression of this pass: report it, fix the hit, and
say so in the commit body. Do not re-exclude to reach green.

TESTS: both changes demonstrated to REDDEN. For MINOR-3 (a), a case at ceiling+1; for MINOR-4 (a), a
temporary fixture-directory hit proving the scan now sees it (removed before commit — say so).

VERIFY: npx tsc --noEmit --skipLibCheck; npx vitest run lib/social.

COMMIT: "30.5-D5: MINOR-3/MINOR-4 - retry-after guard matches its name; no-postiz scan sees __fixtures__"
```

#### D6 — MINOR-6 + MINOR-7: what the accounts surface tells the user  ·  ADR 0028 §9.4  ·  A-12

```
CORRECTION — Session 30.5-D · D6. Invoke no specialist. One surface, one i18n sweep across all three
locales — done together so no locale is left behind twice.

THE DEFECT (MINOR-6 / A-12): lib/social/connection-status.ts:26-31 computes
differenceInCalendarDays(token_expires_at, now) and returns 'expiring_soon' whenever it is <= 7 —
INCLUDING NEGATIVE VALUES. A LinkedIn account whose 60-day token expired three days ago shows "expires
soon, renew it" with a PAST DATE, not "reconnect required". Publishing against it correctly fails
TOKEN_REVOKED, so the worker is right — the accounts surface is telling the user their connection is
fine-for-now at the exact moment it stopped working. LinkedIn's non-refreshable 60-day token makes this
the single most common reconnection event this product will generate.

RULING (A-12, §4 above, do NOT re-litigate): route daysUntilExpiry < 0 to the EXISTING 'disconnected'
state. Do NOT add a sixth state — the required user action is identical, and the copy and CTA already
exist in all three locales. Add a one-line note to ADR 0028 §9.4 recording that the boundary is
`< 0 -> disconnected`, so a later reader sees a decision rather than an accident.
TEST (Tier 2, demonstrated to REDDEN): an account with token_expires_at three days in the PAST renders
'disconnected'; and (regression) one three days in the FUTURE still renders 'expiring_soon'. Pin the
boundary at exactly 0 too, and say which side it falls on.

THE DEFECT (MINOR-7): lib/publishing/orchestrator.ts:108-116 marks the post failed with
errorCode: 'TOKEN_REVOKED' and errorDetails.reason: 'account_ambiguous'. The reason string is RIGHT and
the CODE is the one L-1 permits — adding a union member would change worker retry behaviour and is
FORBIDDEN. But TOKEN_REVOKED is the code the UI maps to "reconnect your account", which is the wrong
instruction for a user whose two X identities simply need one picked. The correct action is
disambiguation; the message says reconnect.

DO: the FAILURE-SURFACE COPY branches on errorDetails.reason rather than on errorCode alone, with a new
i18n key for the ambiguous case added to en, pt AND es simultaneously (CLAUDE.md, i18n from day one). The
copy must name the action: pick which account this post publishes from.
MUST NOT: add an error code, change the orchestrator's control flow, or change what is written to the
posts row (L-1). This is a rendering change only — `git diff lib/publishing/orchestrator.ts` must be
empty, and verify that literally.

TESTS: a Tier-2 case asserting the ambiguous reason renders the disambiguation copy and NOT the reconnect
copy; and the existing i18n key-parity test still green across all three locales.

VERIFY: npx tsc --noEmit --skipLibCheck; npx vitest run lib/social lib/publishing app components. Name the
mutation used for each new test.

COMMIT: "30.5-D6: MINOR-6/MINOR-7 - an expired token reads as disconnected; an ambiguous identity reads as
'pick one', not 'reconnect' (ADR 0028 §9.4)"
```

#### D7 — MINOR-5 + NIT-1 + NIT-2 + NIT-3: statements that were true when written  ·  one sweep, not four

```
CORRECTION — Session 30.5-D · D7. Invoke no specialist. Four items, one theme: each was true when written
and is false now. NIT-3 is explicitly "worth one sweep rather than three more corrections" — so do the
sweep, not the three.

MINOR-5: lib/social/__tests__/provider-contract.test.ts:87-95 reads "the registry (registry.ts:24-57)
still shares one MockProvider instance across all five platforms UNTIL N2.10 makes the registry
overrides-only" and "This assertion becomes real and enforced THE MOMENT N2.10 ADDS LinkedInProvider and
TwitterProvider." N2.10 landed at 79408992 INSIDE this range; the registry IS overrides-only at the head
(registry.ts:16-34) and both providers ARE in the parameterised list. The substantive claim is still true
(mock mode does still share one instance, registry.ts:44-54) but the TENSE makes a present-tense fact read
as pending — the same class of defect that made launch-checklist.md §16 row 4 wrong about the internals
ban. DO: re-tense the comment to state the SHIPPED state, keeping the exemption's justification intact.
Re-cite the line ranges against the head; do not carry the old ones forward.

NIT-1: 'provider_unavailable' exists in all three locale files, NO route emits it,
lib/social/resolve-banner.ts:5-12 documents this and deliberately excludes it from ERROR_KEYS, and
accounts-i18n.test.ts STILL asserts its presence — a translated string no code path can produce, kept
alive by a test. DO: remove the key from en, pt and es AND remove the assertion that pins it, in the same
commit. Confirm by grep that no route, action or component can emit it. This is the ONLY test deletion
this pass authorises, and it is paired with removing the string — not with lowering a bar. If it turns out
a path CAN emit it, the fix is the opposite: keep the key and add it to ERROR_KEYS. Check before you
delete.

NIT-2: ADR 0028 §16's items are numbered 1,2,3,4,5,6,8,7 — the last two transposed. DO: renumber, and
re-point every cross-reference to §16 items 7 and 8 anywhere in the ADR and the build guide. Citations
inside the reviewer report are NOT edited — that text is immutable; if a citation there becomes stale,
that is argued in the appendix at D9, never edited in place.

NIT-3 — THE ARITHMETIC SWEEP, and it is the point of this step: §3a's Reviewer primer says "all six
credentials"; there are FOUR (LINKEDIN_CLIENT_ID/SECRET, X_CLIENT_ID/SECRET). "four states" for §9.4's
FIVE is also wrong and needs fixing. DO: sweep docs/build-guide/session-30-5.md for EVERY counted claim
about this session — credentials, §16 rows, §9.4 states, constraint counts, step counts, caller counts —
verify each against the head by grep or by opening the file, and fix all of them in this one commit. List
each corrected count in the commit body with its evidence.

CORRECTION TO THIS PARAGRAPH ITSELF, found while executing it (Session 30.5-D, D7): this paragraph's own
"eight rows for launch-checklist.md §16's SEVEN" claim, and §5's "all eight rows checked" being "the same
miscount," are BOTH WRONG. `git log -- docs/launch-checklist.md` shows §16 "Postiz removal" has held
exactly EIGHT checkbox rows since `231fee86` (N2.11) — unchanged by every commit since, confirmed by
direct enumeration (`grep -n '^\- \[' docs/launch-checklist.md`, lines 456-463). The build guide's original
"eight rows" was correct all along; it is ADR 0028 §8.3/§12 that wrongly asserts "seven" ("row count
corrected to seven") and the Reviewer's own verification table that trusted that ADR claim without an
independent recount. §5's "all eight rows checked" needs NO fix — it was already right. The ADR is
corrected in this same D7 commit (dated notes at §8.3/§12, original wrong claims left visible per this
ADR's own append-only convention). This is recorded here, in the instruction text itself, because the
instruction's premise was the thing that turned out to be false — the same class of inversion Session 29's
audit found once already (a table missing a row the prose had counted correctly all along).

MUST NOT: change any behaviour, any test expectation other than NIT-1's deleted assertion, or anything in
the reviewer's own text.

VERIFY: npx tsc --noEmit --skipLibCheck; npx vitest run lib/social app. Show the i18n key-parity test
green across all three locales after NIT-1's removal.

COMMIT: "30.5-D7: MINOR-5/NIT-1/NIT-2/NIT-3 - stale tenses, an unemittable i18n key, §16's numbering, and
one arithmetic sweep of the build guide"
```

#### D8 — BLOCKER-2 + NIT-4: a Tier-1 constraint is either executed or it is marked  ·  ADR 0015 §2, §5  ·  `database-reviewer`

```
CORRECTION — Session 30.5-D · D8. ONE specialist: database-reviewer (Tier-1 grants and the db-tests
readiness race). Read docs/decisions/0015-test-execution-and-ci-gates.md §2 and §5 BEFORE you start.

THE DEFECT: SOCIAL-VAULT-UPDATE-SECRET is mapped Tier 1 / db-tests in ADR 0028 §17.4 and has NEVER ONCE
RUN GREEN. It is the constraint proving D-alpha — the defect that meant native token refresh had never
worked — so it is the single most load-bearing new Tier-1 property in the session.
SOCIAL-DUAL-IDENTITY-SCHEMA is also Tier 1 / db-tests and appears to have executed
(posts_social_account_id_fkey violations show in the log) but inside a FAILING job, so no green record
exists for it either. Three consecutive reds: runs 33970947727 (be03c917), 33970367722 (b6580b84),
33969704620 (608f3839).

THE CAUSE IS SETTLED AND YOU DO NOT NEED TO RE-DIAGNOSE IT. The Reviewer opened the run and distinguished
the two causes as ADR 0015 §5's merge-gate table requires: ALL SIX requests return 503 INCLUDING
service_role's, two identical calls SUCCEEDED with 204 one second earlier, `FATAL: the database system is
in recovery mode` (57P03) appears in the container log at that timestamp, and docker inspect shows NO OOM
kill. A grants defect produces 403/404 differentially BY ROLE; a 503 to every role mid-suite after prior
success is the database going away underneath the suite. It is INFRASTRUCTURE, not a DB-behaviour
regression. The three "failing" tests tell you nothing about grants.

WHY IT IS STILL A BLOCKER: cause is not consequence. ADR 0015 §2 is unambiguous — "covered = executed
green in CI, never authored". The Builder's compensating evidence (a live check against project
phdqfrrkbvuuklvbigoh confirming only postgres and service_role hold EXECUTE) is real, is the right
instinct, and is NOT a Tier-1 gate. Recording a manual read of one environment as though it substitutes
for one is how a constraint quietly becomes permanently unexecuted.

DO — attempt (a) FIRST, and fall back to (b) only with the evidence in hand:
(a) GET ONE GREEN db-tests RUN at a commit containing this range (i.e. at or after D7's head, so it
    covers D2's migration if one landed). Address the readiness race itself — the stack is being used
    before it is ready. Cite the run URL, and quote the skip-guard line VERBATIM FROM THE LOG showing a
    NON-ZERO file count AND a non-zero test count AND ZERO invisible suites. Do NOT infer any of those
    three numbers; read them.
(b) IF a green run cannot be reached in this pass: mark SOCIAL-VAULT-UPDATE-SECRET and
    SOCIAL-DUAL-IDENTITY-SCHEMA as AUTHORED-NOT-EXECUTED in ADR 0028 §17.4's TABLE — explicitly, in the
    table, not in a paragraph near it — with the three red run URLs and the diagnosed cause. This is a
    RECORDED DECISION, which ADR 0015 §2 permits; an unqualified listing, which is what the table has
    today, is not.

DO — either way (NIT-4): amend §17.4's db-tests paragraph and the 30.5-DBTESTS-READINESS-RACE entry to
name ALL SEVEN invisible suites — campaigns-social-accounts-role-policies, governed-memory-recency-column,
learning-report-orphans, performance-memory-candidates-expiry, post-ai-originals-latest-per-post,
reissue-invite, signals3-triage-atomic — not the two currently named. Record the Reviewer's open question
as open: whether these seven are NEW to this range is UNKNOWN, because the green baseline that would
establish it does not exist. State it as unknown; do not assume benign.

MUST NOT: retry into a false green; relax the skip-guard; reduce what db-tests collects; or move the
db-tests three-green promotion tally on anything but genuine `master` runs.

VERIFY: npm run test:db locally if Docker is reachable (the Reviewer's was not — say which applies to
you). Whatever you run, the evidence of record is the CI log, quoted.

COMMIT: "30.5-D8: BLOCKER-2/NIT-4 - <green db-tests at <sha>> | <SOCIAL-VAULT-UPDATE-SECRET and
SOCIAL-DUAL-IDENTITY-SCHEMA marked AUTHORED-NOT-EXECUTED>; all seven invisible suites named"
```

#### D9 — close-out: the appendix, the green range, and §5's docs  ·  LAST

```
CORRECTION — Session 30.5-D · D9. Invoke no specialist. This step produces the record, and its job is not
merely to re-green — it produces the green run FOR THE CORRECTED RANGE, which is what makes D7's and D8's
re-citations true rather than merely reworded.

DO:
1. Push the corrected range. Run app-tests and db-tests at the corrected head. Record BOTH run URLs, and
   the skip-guard's file and test counts QUOTED VERBATIM FROM THE LOG — not summarised, not inferred.
2. Append the single `## CORRECTION PASS (Session 30.5-D)` section to the END of
   docs/reviews/session-30-5-reviewer.md. It opens with its author, the date, and the commit range it
   fixed. It carries EIGHTEEN rows — sixteen finding IDs plus the two founder adjudications — each
   recording finding -> fix -> the test that now proves it -> the commit SHA. A finding DECLINED, DEFERRED
   or ARGUED gets a row that says so and argues it; MINOR-2 is expected to be one (it is a correctly
   disclosed guess, and D1 gave it a §16 row rather than a value). Record the ordering rationale too, so
   the sequence does not read as arbitrary. Any §16 citation inside the reviewer's text that NIT-2's
   renumbering has made stale is noted HERE, in the appendix — never edited above it.
   NOT ONE CHARACTER above the appendix changes — including the per-section verdicts, §10's two caller
   tables, the "What I could NOT verify, and why" section and the closing tally line. Confirm with
   `git diff` that the ONLY addition to that file is the appended section, and say so in the commit body.
3. Reconcile the count out loud: the report's tally line says 16 findings (2 BLOCKER, 3 MAJOR, 7 MINOR,
   4 NIT) and the body carries exactly those sixteen IDs. Unlike Session 29 there is nothing to argue —
   record that it was CHECKED, so a later reader knows the check happened.
4. Work §5's close-out checklist, and treat its "all eight rows" for §16 as already corrected by D7.
5. Update .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md and .wolf/buglog.json — cerebrum in
   particular gets D1's process lesson (a citation is a promise that the cited place contains the claim)
   and D8's (a correctly diagnosed infrastructure failure is still an uncovered constraint), because both
   are exactly the kind of thing a fresh session re-derives from scratch.

MUST NOT: move the db-tests promotion tally on anything but genuine `master` runs; claim any live platform
verification that was not performed (§14's manual log stays EMPTY unless a real connection happened);
declare a constraint covered on the strength of a local run.

COMMIT: "30.5-D9: correction pass close-out - appendix appended (18 rows), CI re-green at <sha>, §5 docs"
```

### §4.2 — Resolution log (the appendix's index — eighteen rows, one per finding ID plus two adjudications)

The appendix in `docs/reviews/session-30-5-reviewer.md` is the authoritative record; this table is the
index a reader of the build guide uses to confirm **nothing was lost between the report and the pass**.
Fill the last two columns as each step lands.

| ID | Step | Fix in one line | Test that now proves it | SHA |
|---|---|---|---|---|
| BLOCKER-1 | D1 | Each of `X_AUTHORIZE_URL`, `X_TOKEN_URL`, `LINKEDIN_POSTS_URL` either recorded in N2.1's dated appendix against a named source and read-date with the comment citing that item, **or** disclosed as unverified in `X_REVOKE_URL`'s form | grep of each cited appendix item against the literal URL string — no runtime test (§13 is a provenance rule) | |
| MINOR-1 | D1 | Both `*_USERINFO_URL` folded into N2.1's log; the pairwise-`sub` question promoted from a code comment to an ADR §16 stated-open item | same — provenance, plus the §16 row | |
| MINOR-2 | D1 | **Correctly disclosed already** — given a durable ADR §16 row instead of a comment; D3 makes it a live path | none — argued and recorded, not changed | |
| MAJOR-2 | D2 | `resolvePublishAccount`'s pinned branch requires `business_id` **and** `platform` to match, returning `'none'` otherwise; new constraint named in §17.4 | `lib/db/social-accounts.test.ts` — foreign-business and foreign-platform pinned ids, plus the owned-id regression | |
| MAJOR-1 | D3 | `disconnect/route.ts` attempts `revokeAccessToken` **before** `deactivateSocialAccount` and never blocks on its failure; §17.3 Table B updated | `app/api/social/[platform]/__tests__/disconnect.test.ts` — called, and throwing-revoke-still-disconnects | |
| MAJOR-3 | D4 | A-11 — `r_member_postAnalytics` added with a **positive** scope assertion and §6's capability table re-derived, **or** the review-gated fallback recorded in §16 | `lib/social/__tests__/` scope test (positive assertion), or an ADR §16 row if gated | |
| adjud. 1 | D4 | **A-9′** — ship both account types; locked list unamended, no member-only copy; LinkedIn Company Page renders `coming_soon` while A-8's entity gate holds. A-9's member-only recommendation preserved as superseded | none — founder ruling recorded in ADR §16 item 1 and `launch-checklist.md` §16a; the dual-identity capability itself already shipped (A-6/A-8a) | |
| adjud. 2 | D4 | **A-10 (narrowed)** — realistic cost model recorded (~$12–18/mo at 2–3 linked posts/day); **no ceiling, no stated-open pricing decision, no code cap**. The 2M/3M read-cap discrepancy carried as **unresolved** | none — founder ruling recorded; the absence of a code change is the deliverable | |
| MINOR-3 | D5 | `boundRetryAfterSeconds` either clamps to a sourced ceiling or is renamed `finiteRetryAfterSeconds` — the name stops promising more than it delivers | `lib/social/error-mapping.test.ts` — a ceiling+1 case (or the rename, with the existing cases retained) | |
| MINOR-4 | D5 | `__fixtures__` removed from `EXCLUDED_DIR_NAMES` (or added to the documented exemption list with its reason) | `lib/social/__tests__/no-postiz.test.ts` — a temporary fixture hit proving the scan sees it | |
| MINOR-6 | D6 | A-12 — `daysUntilExpiry < 0` routes to the existing `disconnected` state; §9.4 gains a one-line boundary note. **No sixth state** | `lib/social/connection-status.test.ts` — past-expiry, future-expiry, and the exact-0 boundary | |
| MINOR-7 | D6 | Failure-surface copy branches on `errorDetails.reason`; a disambiguation key added to **en, pt and es**. Orchestrator untouched (L-1) | Tier-2 rendering case + the existing i18n key-parity test | |
| MINOR-5 | D7 | `provider-contract.test.ts`'s exemption comment re-tensed to the shipped state, with line ranges re-cited at the head | none — comment (verified by `grep -n` against `registry.ts`) | |
| NIT-1 | D7 | `provider_unavailable` removed from all three locales **and** the assertion pinning it removed — after confirming no path can emit it | `accounts-i18n.test.ts` key-parity, green across three locales | |
| NIT-2 | D7 | ADR §16 renumbered 1…8 in order; every cross-reference to items 7 and 8 re-pointed (the reviewer's own text excepted — argued at D9) | none — documentation | |
| NIT-3 | D7 | **One arithmetic sweep** of the build guide: "six credentials"→four, "four states"→five, and every other counted claim verified at the head. **Discovery, not a routine fix:** launch-checklist.md §16 has held EIGHT rows since N2.11 (verified via `git log` + direct enumeration) — the build guide's original "eight" was right; ADR 0028's own "corrected to seven" claim was wrong, and the Reviewer's verification trusted it without an independent recount. §5's "all eight rows checked" needed no fix. ADR 0028 §8.3/§12 gain dated correction notes | none — each count verified by `grep`/file read/`git log`, evidence in the commit body | |
| BLOCKER-2 | D8 | One green `db-tests` run at a commit containing the corrected range with the skip-guard's counts quoted verbatim — **or** `SOCIAL-VAULT-UPDATE-SECRET` and `SOCIAL-DUAL-IDENTITY-SCHEMA` marked `AUTHORED-NOT-EXECUTED` **in §17.4's table** with the three red run URLs and the diagnosed cause | the two Tier-1 suites themselves, executed green — or an explicit recorded non-execution | |
| NIT-4 | D8 | §17.4 and `30.5-DBTESTS-READINESS-RACE` name **all seven** invisible suites; whether they are new to this range recorded as **unknown**, not benign | none — documentation, quoted from the CI log | |

**Row-count check:** sixteen finding IDs (BLOCKER-1…2, MAJOR-1…3, MINOR-1…7, NIT-1…4) plus two founder
adjudications = **eighteen rows**, and the appendix carries eighteen. **The report's own tally line is
correct** — sixteen findings, 2/3/7/4 — so unlike Session 29 there is nothing to argue in the appendix on
that point. It is stated here so a later reader knows the arithmetic was checked rather than assumed.

### §4.3 — What this pass does NOT do

- **It does not re-review.** There is no independent N4 pass (the 23-D…29-D precedent). D9's evidence and
  the appendix are what the founder adjudicates.
- **It does not reopen L-1…L-12 or A-1…A-8 / A-5′ / A-8a.** A-8 in particular is *recorded and staged* by
  D4/A-9, not reconsidered: `w_organization_social` stays out of LinkedIn's scopes.
- **It does not widen the provider contract suite.** The Reviewer's scope observation — that the suite
  asserts five properties and exercises neither `publish`, `exchangeOAuthCode` nor `refreshAccessToken`
  across implementations — is **explicitly not a defect against the ADR**, which specified exactly those
  five (§9.1). The Reviewer's own recommendation is Session 32, *"when a third real implementation gives
  it something to prove"*. Carried as a note, not a step.
- **It does not attempt any live platform verification.** No production OAuth app exists at either
  platform (§14.1), so §14's manual verification log stays **empty**. An empty log is the honest state; a
  populated one would be the first fabricated claim in the session's record.
- **It does not close the two standing, correctly-declared gaps** — `lib/social/__integration__/` does not
  exist and no coverage claim rests on it (§17.2), and the `SOCIAL-ERR-MATRIX-TRUE` /
  `SOCIAL-INTEGRATION-NOT-EXECUTED` Tier-3 constraints remain recorded decisions rather than runtime tests
  (§17.5). Both were declared by the Builder; neither is a Session 30.5 regression. If the founder wants
  either closed, it is a named step in the next session, not an unlogged extra here.
- **It does not move the `db-tests` promotion tally by argument** — only genuine `master` runs move it,
  and D8 may well leave it exactly where it is.

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
