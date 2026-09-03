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
