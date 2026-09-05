# Session 30.5 Track N — Reviewer report (N3)

**Scope reviewed: `54110178..be03c917`** — the fifteen Builder commits N2.1 → N2.13-D2. All citations of
reviewed artefacts are `git show <sha>:<path>` at that range, **never HEAD**.

**Documents audited *against*, read at their own commits** (the Session 22-F / NEW-12 exception — these
predate or postdate the reviewed range and cannot be read inside it):

| Document | Read at |
|---|---|
| `docs/decisions/0028-native-social-providers.md` | `be03c917` (it is itself modified inside the range; §13/§14/§17 were appended at `4a8329ca`, `608f3839`, `be03c917`) |
| `docs/decisions/0002-social-provider.md` Amendment A | `16a96851` |
| `docs/decisions/0005-publishing-worker.md` §5 amendment | `c857c006` (appended inside the range) |
| `docs/build-guide/session-30-5.md` | `231fee86` |
| `docs/reviews/session-30-5-platform-verification.md` (N2.1's output) | `4a8329ca` |
| `CLAUDE.md` test-execution-integrity section | `be03c917` |

**Reviewer:** independent N3 pass, 2026-09-05. No source, test, ADR, migration or build-guide file was
modified by this session. This document is its only output.

**ECC budget honoured:** zero subagent invocations. The diff was read directly.

---

## Verification I ran myself, rather than trusting the Builder's report

| Check | Result |
|---|---|
| `npx tsc --noEmit --skipLibCheck` | **GREEN**, exit 0, zero diagnostics |
| `npm run test:app` (full CI env, local) | **GREEN** — 252 files, 3518/3518 tests passed, 131s |
| `npm run test:db` | **NOT RUN LOCALLY — Docker daemon unreachable on this machine.** Assessed from CI instead (see BLOCKER-2) |
| Repo-wide `grep -i postiz` at `be03c917` | 33 hits, **every one inside a stated exemption** — reconciled below |
| `app-tests` CI at the range head | **GREEN** — [run 33970947695](https://github.com/tcr430/SOSH/actions/runs/33970947695), commit `be03c917` |
| `db-tests` CI at the range head | **RED** — [run 33970947727](https://github.com/tcr430/SOSH/actions/runs/33970947727), commit `be03c917` |
| `launch-checklist.md` §16, row by row | 7 rows, not 8 — the ADR's correction of the build guide is right |

**On the app-tests citation.** ADR §17.4 cites [run 33970367725](https://github.com/tcr430/SOSH/actions/runs/33970367725)
at `b6580b84`, one commit behind the range head. A green run **does** exist at the true head `be03c917`
([33970947695](https://github.com/tcr430/SOSH/actions/runs/33970947695)); the citation is stale only because
`be03c917` is the commit that wrote the citation. `be03c917` touches three documentation files and no code,
so the coverage claim is sound. Recorded, not raised as a finding.

---

## Summary of the range

This is a strong Builder track. The evidence discipline is materially better than Session 28's: the
provider tests carry the exact anti-circularity fixtures the ADR asked for, every scan in the range was
demonstrated to redden, and the Builder's own N2.13 closure self-reported two defects (the zero-caller
`revokeAccessToken`, the red `db-tests`) that a less honest pass would have buried. Two Session-22-class
traps — a contract suite that excludes a provider, a shared function verified against one of N callers —
are genuinely closed. My findings concentrate in one place the ADR itself named as the highest risk:
**§13's rule against writing a platform fact from memory.**

**16 findings: 2 BLOCKER, 3 MAJOR, 7 MINOR, 4 NIT**, plus 2 founder adjudications restated as open.

---

## 1. OAuth ownership, PKCE, redirect-URI parity, secret containment (ADR §2; D-β)

**Clean.** Verified at the range:

- `SOCIAL-REDIRECT-URI-MATCH` — both `connect/route.ts:54` and `callback/route.ts:82` call the single
  `getSocialRedirectUri()` helper (`lib/social/oauth/redirect-uri.ts:11`), which reads only
  `config.server.APP_URL`. `git grep nextUrl.origin be03c917 -- 'app/*'` returns **zero hits**: the
  Host-header-influenceable derivation is gone. ✅
- `SOCIAL-PKCE-NOT-IN-STATE` — `lib/social/__tests__/oauth-state.test.ts:89-104` decodes a **real signed
  state JWT** and asserts its key set is exactly `[businessId, exp, iat, locale, nonce, platform]`, then
  checks all three verifier spellings are absent. This is the right shape of assertion — it proves the
  absence against the actual payload, not against a code path. ✅
- PKCE cookie (`lib/social/oauth/pkce.ts:37-46`) — httpOnly, secure, SameSite=Lax, `path=/api/social`,
  600s matching the state TTL. The read *is* the clear (`:51-55`), so no error path can skip it. ✅
- Secret containment — all four credentials (`LINKEDIN_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET`) are read
  through `lib/config.ts:536-547`'s `serverOnly()` getters. `lib/social/oauth/no-secret-egress.test.ts`
  covers bundle/log/`details` egress. ✅
- Vault write compensation (`callback/route.ts:97-123`) — a failed refresh-secret create deletes the
  already-created access secret before returning. No orphan. ✅

## 2. The publish contract per platform, and the media guard (ADR §3; A-3)

### BLOCKER-1 — Three platform endpoint URLs are shipped that N2.1's verification record does not contain, and all three cite N2.1 for coverage it does not provide

**Where (at the range):**

- `lib/social/twitter-provider.ts:23-30` — the comment reads *"Endpoints per N2.1's vendor-doc
  verification (docs/reviews/session-30-5-platform-verification.md items 1/3/4/6/7)"*, then declares
  `X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'` (`:27`) and `X_TOKEN_URL =
  'https://api.x.com/2/oauth2/token'` (`:28`).
- `lib/social/linkedin-provider.ts:23-32` — the comment reads *"Endpoints per N2.1's vendor-doc
  verification (… items 1, 9)"*, then declares `LINKEDIN_POSTS_URL =
  'https://api.linkedin.com/rest/posts'` (`:32`).

**What is wrong.** N2.1's record (`docs/reviews/session-30-5-platform-verification.md` at `4a8329ca`)
does not contain any of those three literal URLs:

| URL shipped | Cited to | What that item actually records |
|---|---|---|
| `https://x.com/i/oauth2/authorize` | items 1/3/4/6/7 | **Item 1 is LinkedIn's authorize/token URLs.** No item records an X *authorize* URL at all. |
| `https://api.x.com/2/oauth2/token` | items 1/3/4/6/7 | Item 4 records X's token-endpoint **auth method** (HTTP Basic for confidential clients) and names its source page, but records **no URL**. |
| `https://api.linkedin.com/rest/posts` | items 1, 9 | Item 1 records the **authorize and token** URLs only. Items 1/9's *source* is the Posts API doc, and the §3.1 cross-check confirms its headers, its `201 + x-restli-id`, its URN forms and its permalink — but the **base URL is never written down**. |

A fourth and fifth, `LINKEDIN_USERINFO_URL` (`linkedin-provider.ts:31`) and `X_USERINFO_URL`
(`twitter-provider.ts:29`), are *correctly disclosed* as verified outside N2.1, in-step, against a named
source and date. Those two are the honest pattern; they are cited here only to show the contrast, and are
folded into MINOR-1 rather than this finding.

**Why it matters.** ADR §13 exists precisely because *"a confident endpoint with no source will not
surface in any offline test."* Every provider test in the range mocks `fetch`, so all of the provider
assertions pass regardless of whether these URLs are right. The first time any of them is exercised is
against the live platform, during the very first customer connection — the moment §14.1 identifies as
already the riskiest in the plan. Worse than the risk itself is that the **citation asserts verification
that does not exist**: a future reader (or correction pass) checking "is this endpoint sourced?" will
find a pointer to N2.1, open N2.1, and — unless they read carefully enough to notice item 1 is about
LinkedIn — conclude it is covered. That is a self-concealing defect, which is the class §13 was written
against.

**What would prove it fixed.** Each of the three URLs either (a) recorded in N2.1's verification log (or
a dated appendix to it) against a named vendor-doc source and read-date, with the provider comment citing
the specific item number that now contains it; or (b) explicitly marked in the provider comment as
unverified-and-why, in the exact form `X_REVOKE_URL` already uses at `twitter-provider.ts:31-41`. Either
is acceptable. What is not acceptable is the current state: an unsourced URL wearing a citation.

### The rest of §3 is clean

- `SOCIAL-LI-POSTID-FROM-HEADER` — **the decoy fixture exists.**
  `lib/social/__tests__/linkedin-provider.test.ts:201-213` returns a 201 whose *body* carries
  `{id: 'decoy-id-from-body', urn: 'urn:li:share:DECOY'}` alongside a real `x-restli-id` header, and
  asserts `result.platformPostId` is the header value and `.not.toContain('decoy')`. This is the
  assertion that distinguishes a provider that reads the header from one that reads either. ✅
  Reinforced structurally: `handlePublishResponse` never reads the body on the 201 path
  (`linkedin-provider.ts:285`).
- `SOCIAL-MEDIA-GUARD` — **the absence of the network call is asserted, not just the error code.**
  `linkedin-provider.test.ts:294-301` asserts `mockFetch` **and** `mockWithFreshToken` were both never
  called; `twitter-provider.test.ts:156-163` does the same. The guard is genuinely before token
  resolution in both providers (`linkedin-provider.ts:188`, `twitter-provider.ts:207`). ✅
- X's 280-character limit is enforced pre-network (`twitter-provider.ts:217-224`), with its own
  zero-fetch assertion. ✅
- Permalinks are never fabricated: X returns `null` when the username is unavailable
  (`twitter-provider.ts:307`), with a dedicated test at `twitter-provider.test.ts:190`. ✅

## 3. Token lifecycle (ADR §4; A-2, A-4, D-α)

### BLOCKER-2 — `SOCIAL-VAULT-UPDATE-SECRET`, a Tier-1 constraint, has never executed green in CI, and seven db-tests suites are invisible at the range head

**Where:** [db-tests run 33970947727](https://github.com/tcr430/SOSH/actions/runs/33970947727) at commit
`be03c917` — the range head — plus [33970367722](https://github.com/tcr430/SOSH/actions/runs/33970367722)
at `b6580b84` and [33969704620](https://github.com/tcr430/SOSH/actions/runs/33969704620) at `608f3839`.
Three consecutive reds across the last three commits of the range.

**I opened the run and distinguished the two causes, as ADR 0015 §5's merge-gate table requires. It is
infrastructure, not a DB-behaviour regression** — and I can state that on evidence the Builder's own
report did not cite. The PostgREST access log in the failure dump shows:

```
172.18.0.3 - anon         "POST /rpc/vault_update_secret HTTP/1.1" 503 133
172.18.0.3 - anon         "POST /rpc/vault_update_secret HTTP/1.1" 503 119
172.18.0.3 - service_role "POST /rpc/vault_update_secret HTTP/1.1" 503 119
```

All six requests return **503**, including `service_role`'s — and two identical calls **succeeded with
204 one second earlier** (14:11:55) before every subsequent call went 503 (14:11:56). A grants defect
produces 403/404 differentially by role; a 503 to every role, mid-suite, after prior success, is the
database going away underneath the suite. `FATAL: the database system is in recovery mode` (57P03)
appears in the container log at that timestamp, and `docker inspect` shows no OOM kill. **The Builder's
diagnosis is correct and I confirm it independently.** The three "failing" tests are not telling you
anything about grants.

**Why it is still a finding, and still a BLOCKER.** Cause is not the same as consequence. ADR 0015 §2's
definition is unambiguous: *"Covered = executed green in CI, never authored."* Right now:

1. `SOCIAL-VAULT-UPDATE-SECRET` is mapped **Tier 1 / db-tests** in ADR §17.4 and has **never once run
   green**. By the project's own standard it is `AUTHORED-NOT-EXECUTED`. This is the constraint proving
   D-α — the defect that meant *native token refresh has never worked* — so it is the single most
   load-bearing new Tier-1 property in the session.
2. `SOCIAL-DUAL-IDENTITY-SCHEMA` is also mapped **Tier 1 / db-tests**. It appears to have executed
   (`posts_social_account_id_fkey` violations appear in the log, which is that suite's own negative
   case), but it executed inside a job that failed, so no green record exists for it either.
3. **Seven suites reported entirely invisible** — `campaigns-social-accounts-role-policies`,
   `governed-memory-recency-column`, `learning-report-orphans`, `performance-memory-candidates-expiry`,
   `post-ai-originals-latest-per-post`, `reissue-invite`, `signals3-triage-atomic`. ADR §17.4's own text
   names only **two** of those seven. The skip-guard is doing exactly its job (this is the `FALSE-GREEN`
   case it exists to catch), but the ADR under-reports the blast radius by five suites.

The Builder's compensating evidence — a direct check against the live linked project
(`phdqfrrkbvuuklvbigoh`) confirming only `postgres` and `service_role` hold EXECUTE — is real and worth
having, and it is the right instinct. But a manual read of one environment is not a Tier-1 gate, and
recording it as though it substitutes for one is how a constraint quietly becomes permanently unexecuted.

**Mitigating, and stated plainly:** `db-tests` is **not yet a required gate** (ADR 0015 §5's promotion
rule is not enacted), so this does not block merge, and the Builder said so rather than retrying into a
false green. I am raising it BLOCKER against *the coverage claim*, not against the merge.

**What would prove it fixed.** One green `db-tests` run at a commit containing this range, with the
skip-guard line showing a non-zero file **and** test count and zero invisible suites — the count read
from the log, not inferred. Failing that, `SOCIAL-VAULT-UPDATE-SECRET` and `SOCIAL-DUAL-IDENTITY-SCHEMA`
are marked `AUTHORED-NOT-EXECUTED` in ADR §17.4's table rather than listed without qualification, and
`30.5-DBTESTS-READINESS-RACE` is amended to name all seven invisible suites.

### The rest of §4 is clean, and unusually well tested

- `SOCIAL-VAULT-UPDATE-CHECKED` — **the D-α fixture exists, in both positions.**
  `twitter-provider.test.ts:275` asserts an errored *access-token* `vault_update_secret` is surfaced, and
  `:285` asserts the same for the *second, refresh-token* call. That second one is the assertion that
  actually prevents D-α's return, and it is present. The `token_expires_at` bump is error-checked too
  (`twitter-provider.ts:450-461`). ✅
- `SOCIAL-X-EXPIRY-FROM-RESPONSE` — **the disagreement fixture exists.**
  `twitter-provider.test.ts:136-154` is explicitly titled *"fixture where they DISAGREE"* and pins the
  expiry to the response's `expires_in` against a config `tokenExpirySeconds` of 2h. ✅
- Rotation is genuinely in-place: `refreshAccessToken` calls `vault_update_secret` on both secret ids and
  the vault ids are asserted **unchanged before and after** (`:265`). Never delete-then-create. ✅
- `SOCIAL-LI-EXPIRY-REVOKED` — LinkedIn's `refreshAccessToken` throws `TOKEN_REVOKED`, asserted by code
  (`linkedin-provider.ts:325-331`, test `:312`). The reasoning in the comment (a `TOKEN_EXPIRED` would
  burn the tick's refresh budget on a refresh that can never succeed) is correct against ADR 0005 §5. ✅
- A-4's deferred advisory lock is correctly **not** implemented, and said so (`twitter-provider.ts:336-340`). ✅

### MAJOR-1 — `SOCIAL-REVOKE-NEVER-BLOCKS` is vacuously satisfied: `revokeAccessToken` has zero production callers

**Where:** `app/api/social/[platform]/disconnect/route.ts:67` calls `deactivateSocialAccount(account.id)`
and nothing else. `git grep revokeAccessToken be03c917` finds the method defined on all three providers
(`linkedin-provider.ts:340`, `twitter-provider.ts:473`, `mock-provider.ts:141`) and called only from tests.

**Credit where due: the Builder found this and reported it** in ADR §17.3, unprompted, while re-grepping
Table B. I am restating it as a finding because a self-reported defect is still a defect, and because a
correction pass needs it to carry an ID.

**Why it matters.** The constraint *as tested* ("each provider's `revokeAccessToken` never throws") is
true and proven. The constraint *as the ADR's prose means it* — a revoke is attempted during disconnect,
and a failure there does not block local cleanup — describes wiring that does not exist. §16 item 5
("A failed platform revocation leaves a live token at the platform") is accepted risk on the assumption
that a revocation is *attempted*; today none is. The user-visible consequence: a founder who disconnects
X still has a live access token sitting at X, and SOSH has deleted the vault record that would let it ever
be revoked. CLAUDE.md's three-step disconnect (deactivate, null the ids, delete the secrets) is satisfied
— `deactivateSocialAccount` does all three — so this is not a GDPR-erasure gap on our side, but it is a
live credential we told the user we let go of.

**What would prove it fixed.** `disconnect/route.ts` calls the platform's `revokeAccessToken` **before**
`deactivateSocialAccount` (the vault secret must still exist to read the token), with a Tier-2 test
asserting (a) it is called, and (b) a throwing revoke still results in a completed local disconnect —
which is what `SOCIAL-REVOKE-NEVER-BLOCKS` was always meant to assert.

## 4. Platform identity, the dual-identity schema and the resolver (ADR §5; A-6, A-8, A-8a)

### MAJOR-2 — `resolvePublishAccount`'s pinned-identity path performs no tenancy or platform check

**Where:** `lib/db/social-accounts.ts:184-187` (at the range):

```ts
if (pinnedAccountId) {
  const account = await getActiveById(client, pinnedAccountId)
  return account ? { outcome: 'resolved', account } : { outcome: 'none' }
}
```

`getActiveById` (`:135-146`) filters on `id` and `is_active` **only** — not `business_id`, not `platform`.
Both production callers pass a service-role client that bypasses RLS
(`lib/publishing/orchestrator.ts:107`, `lib/metrics/orchestrator.ts:67`), and both have `post.business_id`
and `post.platform` **in hand at the call site** and pass them — the function simply ignores them on this
branch.

**The same file already knows better.** `disconnect/route.ts:52-55` calls the same `getActiveById` and
then explicitly checks `candidate.business_id === business.id && candidate.platform === platform` before
acting. One caller was written defensively; the shared resolver — the designated guard point — was not.

**Failure scenario.** A `posts` row in business A carrying `social_account_id` pointing at an active
account in business B. `resolvePublishAccount` returns `{outcome: 'resolved'}`; the publishing worker
builds `PublishInput` with that `socialAccountId`; the provider resolves **business B's** vault token and
publishes business A's content to business B's LinkedIn or X account. There is no later check. The same
path in the metrics worker writes business B's post metrics onto business A's post.

**Reachability today is low, and I want to be precise about that.** No code in the range writes
`posts.social_account_id` — `PostUpdate` correctly excludes it (`lib/db/types.ts:360`), and I found no
insert that sets it. The DB has no cross-column constraint either (the FK is plain
`REFERENCES social_accounts(id)`). So this is **latent, not live**. But `PostInsert` *does* expose the
field (`lib/db/types.ts:342`), the identity picker that will populate it is the acknowledged next step,
and the guard costs three lines. A latent cross-tenant publish is not a defect to leave for the session
that happens to wire up the writer.

**What would prove it fixed.** `resolvePublishAccount` takes the pinned account only when
`account.business_id === businessId && account.platform === platform`, returning `'none'` otherwise
(never `'ambiguous'`, and never a silent substitution — matching the function's own documented rule at
`:176-178`). Proven by two Tier-2 cases: a pinned id belonging to another business, and one belonging to
another platform, each resolving to `'none'`. Optionally hardened at Tier 1 with a composite FK.

### The rest of §5 is clean

`getActiveByBusinessAndPlatform` — the `.maybeSingle()` function that threw on two active rows — is
**gone from source entirely** at the range (only ADR/build-guide prose and one explanatory comment mention
it). ✅ The URN is self-describing with no discriminator column, and `isOrganizationAuthorUrn`
(`linkedin-provider.ts:57`) closes that alternative explicitly. A-8 verified: **`w_organization_social` is
absent** from `PLATFORM_CONFIGS.linkedin.scopes` (`lib/social/platforms/config.ts:22`), and the
organization URN nonetheless flows through the same publish path, asserted at
`linkedin-provider.test.ts:157`. ✅ The `posts.social_account_id` FK is `ON DELETE SET NULL`, not CASCADE
(`20260904100000_posts_social_account_id.sql:23`), and the ADR 0010 Amendment 2 §D2.5 disposition landed
**in the same range** (`docs/decisions/0010-legal-surface.md:1132-1143`) as an explicit "no new row
required, and here is why" note — the Session 28-D D7 precedent, correctly applied. ✅

### MINOR-1 — Two identity endpoints are verified only in a code comment, outside the verification log

`LINKEDIN_USERINFO_URL` (`linkedin-provider.ts:31`) and `X_USERINFO_URL` (`twitter-provider.ts:29`) are
each declared with an in-line note naming the vendor source and read-date, disclosed as verified in-step
rather than by N2.1. **This is the honest pattern and I am not criticising the judgement** — §13's list of
nine did not include an identity endpoint, and the Builder said so rather than pretending otherwise. The
narrow problem is durability: the verification record now lives in two places, and the one that is a code
comment will be the first casualty of a future refactor. The LinkedIn note additionally raises a real open
question (the OIDC discovery document declares `subject_types_supported: ["pairwise"]`, so `sub` may not be
the id space `urn:li:person:` construction expects) and flags it correctly — but flags it *only in a
comment*, not in §16. **Fixed by:** folding both into N2.1's log or a dated appendix, and promoting the
pairwise-`sub` question to a §16 stated-open item.

### MINOR-2 — `X_REVOKE_URL` is an unverified guess (correctly disclosed)

`twitter-provider.ts:31-41` states plainly that N2.1 confirmed only that a revoke endpoint is
*referenced*, that the documented reference uses OAuth 1.0a (which does not fit SOSH's flow), and that
`https://api.x.com/2/oauth2/revoke` is *"the standards-compliant best guess, not a confirmed URL."*
**This is exactly what §13 asks for** and is recorded as a MINOR only so the correction pass has an ID for
it. Its blast radius is genuinely bounded — revocation never throws — though MAJOR-1 notes it is never
called at all today, so the guess is currently untested in both senses. **Fixed by:** an empirical check
once credentials exist (§14.1), or a §16 row.

## 5. Metrics, and what null honestly means (ADR §6)

§6's capability table **was** populated by N2.1, per platform and per field, for both platforms
(`session-30-5-platform-verification.md:96-140`), and `fetchPostMetrics` correctly throws
`NOT_IMPLEMENTED` on both providers pending Session 33. X's `reach` is recorded as **permanently**
unavailable — the right distinction, and the one §6 asks for. ✅

### MAJOR-3 — N2.1's `r_member_postAnalytics` scope decision was escalated, never adjudicated, and is not in §16

**Where:** N2.1 raised it as its single drift finding
(`session-30-5-platform-verification.md:116`), and ADR §13 item 8 (`0028-...md:479`) restates it as *"an
open decision for N2.7's author or the Architect, not resolved here."* N2.7 then shipped
`PLATFORM_CONFIGS.linkedin.scopes = ['openid', 'profile', 'email', 'w_member_social']`
(`lib/social/platforms/config.ts:22`) without the scope and without recording a decision. **ADR §16's
eight stated-open items do not include it.** I checked all eight.

**Why it matters, and why it is time-critical rather than merely unfinished.** Four of seven `PostMetrics`
fields — `saves`, `clicks`, `reach`, `impressions` — are permanently null for LinkedIn under the shipped
scope list. Per §6's own distinction that is *not* "the platform does not expose this", it is a SOSH scope
choice. And per §14.1's own reasoning, **the cost of this decision rises the moment a real customer
connects**: scopes are baked into the token at authorisation, so adding `r_member_postAnalytics` later
forces every connected LinkedIn user to re-authorise. §16 item 8 already plans one forced re-authorisation
for `w_organization_social`; this silently commits us to a second, or to permanently degraded LinkedIn
analytics — on a product whose Pro tier advertises "advanced analytics". No production LinkedIn OAuth app
is registered yet (§14.1), so **right now the change is free.** That window closes at first connection.

**What would prove it fixed.** Either the scope is added to `PLATFORM_CONFIGS.linkedin.scopes` before any
production OAuth app is registered, or the decision to ship without it is recorded as a §16 stated-open
item naming the consequence (four permanently-null fields, and a forced re-authorisation to undo). Silence
is the one outcome that is not acceptable — a decision N2.1 correctly escalated has been lost between
three steps.

## 6. Error and rate-limit mapping, and the ADR 0005 §5 amendment (ADR §7; A-7)

The mapping table is implemented once and shared (`lib/social/error-mapping.ts`), not duplicated per
platform. The 409 → `NETWORK` row is the one that deserves scrutiny and it is argued explicitly at
`:16-24` — the union offers no retryable-conflict code, and mapping a documented-retryable condition to a
terminal code would fail posts that would have succeeded. I agree with the reasoning, and with declining to
add a union member (which would change worker retry behaviour, which L-1 forbids). The X-by-analogy
extension is flagged as unverified rather than asserted. ✅ Both providers' mappings are tested per-status
(`linkedin-provider.test.ts:257-282`, `twitter-provider.test.ts:227-247`). The ADR 0005 §5 amendment
landed at `c857c006`. ✅

### MINOR-3 — `boundRetryAfterSeconds` does not bound anything

`lib/social/error-mapping.ts:35-37` returns `Number.isFinite(candidate) ? candidate : fallback`. The
`Number.isFinite` guard is correct and does the job the ADR asked for (LinkedIn's `Retry-After` as an
HTTP-date yields `NaN` → 60; a missing `x-rate-limit-reset` yields 0 → the caller's own 60 fallback). But
the name promises a bound that is not applied: a hostile or buggy `Retry-After: 999999999` passes through
untouched into `SocialProviderError.retryAfterSeconds`, and thence into the publishing worker's
scheduling. **Fixed by:** clamping to a stated ceiling (the worker's own max backoff is the natural one),
or renaming the function to `finiteRetryAfterSeconds` so it stops promising more than it delivers.

## 7. The removal as an ordered, provable operation (ADR §8; L-3)

**I ran the grep myself at the range head.** 33 `postiz` hits remain; **every one falls inside a stated
exemption**, and I reconciled each against the exemption list at `no-postiz.test.ts:13-79`. The surfaces
ADR §8.3's delta table omitted — which I was told to check individually — were **all** handled:

| Omitted surface | State at `be03c917` |
|---|---|
| `package.json`'s `postiz:*` scripts | **Gone** — verified against the full script block |
| `infra/` (README, Caddyfile, docker-compose) | **Deleted** — 171 lines removed |
| `proxy.ts:68-72` (the only `buildCsp` caller) | **Rewritten** — `buildCsp` no longer takes a `postizHost` parameter at all (`lib/observability/csp.ts`) |
| vitest config comments | **Cleaned** — both `vitest.config.ts` and `vitest.integration.config.ts` |

The three brand-memory fixtures I was told to check were **renamed, not exempted** — and so was a fourth
not on that list (`supabase/__tests__/governed-memory-recency-column.test.ts`). All four now read *"We
integrate natively with every platform."* ✅

`SOCIAL-CSP-NO-POSTIZ-HOST` removed the broker origin and **nothing else**: `csp.test.ts:59` asserts
`connect-src` carries *exactly the seven remaining entries*, which is the assertion that catches an
over-broad cleanup. ✅ The scan was demonstrated to redden (N2.11 commit message). ✅ The exemption list's
second test (`no-postiz.test.ts:166`) guards against the scan silently passing because an exempted path was
renamed — a good touch, and not something the ADR asked for.

`lib/social/__integration__/` **does not exist** at the range (`git ls-tree` confirms only three
`__integration__` directories remain, none under `lib/social/`). **No coverage claim in this range rests on
it**, and §17.2 says so. That trap is clean. ✅

### MINOR-4 — `__fixtures__` is an undeclared exemption in a scan whose own contract is "no exemption is silent"

`no-postiz.test.ts:107` excludes `__fixtures__` from the walk via `EXCLUDED_DIR_NAMES`, alongside
`node_modules`, `.git` and `.next`. The other three are self-evidently not source; `__fixtures__` is, and a
`postiz` string inside any fixture directory is invisible to a scan whose comment block (`:13-79`) promises
fourteen exemptions each with a stated reason. No such directory currently contains a hit, so this is a
hole in the guarantee, not a live leak. **Fixed by:** either removing `__fixtures__` from the exclusion
set, or adding it to the documented exemption list with its reason.

## 8. The contract suite, the tiers, and what is honestly untestable (ADR §9; L-8, L-9)

**The "shared suite that is not shared" trap is closed.** `provider-contract.test.ts:48-52` parameterises
over all three implementations — `MockProvider`, `LinkedInProvider`, `TwitterProvider` — via
`describe.each`, and I confirmed no assertion is branched by implementation **except one**, which is
argued: the *"platform is never 'multi'"* assertion is skipped for `MockProvider` (`:96-100`), because the
registry deliberately shares one `MockProvider` across all five platforms in mock mode. I accept the
exemption — a fixed real-platform identity on `MockProvider` would misrepresent that role — and it is the
narrowest possible carve-out.

### MINOR-5 — The contract suite's exemption comment describes N2.10 as future work; N2.10 shipped inside this range

`provider-contract.test.ts:87-95` reads *"the registry (registry.ts:24-57) still shares one MockProvider
instance across all five platforms **until N2.10 makes the registry overrides-only**"* and *"This assertion
becomes real and enforced **the moment N2.10 adds** LinkedInProvider and TwitterProvider."* N2.10 landed at
`79408992`, inside this range; the registry **is** overrides-only at the head (`registry.ts:16-34`), and
both providers **are** in the parameterised list. The comment's substantive claim is still true (mock mode
does still share one instance, `registry.ts:44-54`), but its tense makes a present-tense fact read as a
pending one — the same class of stale-comment defect that made `launch-checklist.md` §16 row 4 wrong about
the internals ban. **Fixed by:** re-tensing the comment to state the shipped state.

**A scope observation, not a finding.** The contract suite asserts five properties: method presence, a real
platform, an absolute-URL-with-state authorize, revoke-never-throws, and the `fetchPostMetrics` shape. It
does **not** exercise `publish`, `exchangeOAuthCode` or `refreshAccessToken` across implementations. That
matches ADR §9.1's specification exactly, so it is not a defect against the ADR — and per-provider coverage
of all three is genuinely thorough elsewhere. I note it only because "shared contract suite" carries more
weight in the ADR's prose than five assertions deliver, and because the property that made the broker's
single implementation "keep everyone honest" is precisely the one a thin contract cannot replace. Worth
widening in Session 32, when a third real implementation gives it something to prove.

## 9. The UX contract and the design floor (ADR §9.4)

All **five** `ConnectionStatus` states exist and are named (`lib/social/connection-status.ts:5`) — the ADR
itself corrects the build guide's "four". ✅ Dual identity is rendered per-account with a "Default" badge
mirroring the resolver rather than a stored flag (`connection-status.ts:49-52`, with the honest `null` when
two identities make "default" meaningless). ✅ Disconnect carries `accountId`
(`lib/social/disconnect-url.ts`), and the route refuses with `409 account_ambiguous` rather than guessing
when it is absent and two identities exist (`disconnect/route.ts:56-62`). ✅

**i18n verified across all three locales myself**: `settings.accounts.error` has **8 keys, identical key
sets in en/pt/es, and all 8 messages distinct within each locale.** Every error code either route can emit
has a key. ✅ No `any`, no `console.*`, no `asChild`, no raw `.toISOString()` anywhere in the range's added
`app/`, `components/`, `lib/social/` or `lib/db/` lines — I grepped the diff. ✅ List queries are bounded
with explicit `ORDER BY` (`listActiveByBusinessAndPlatform` `limit = 10` + `.order('connected_at')`;
`listByBusiness` `limit = 50` + same). ✅

### MINOR-6 — An expired token renders as `expiring_soon`, telling the user to renew something already dead

`connection-status.ts:26-31` computes `differenceInCalendarDays(token_expires_at, now)` and returns
`expiring_soon` whenever it is `<= 7` — **including negative values**. A LinkedIn account whose 60-day
token expired three days ago shows the "expires soon, renew it" state with a past date, not a "reconnect
required" state. Publishing against it fails with `TOKEN_REVOKED` (correct, per `SOCIAL-LI-EXPIRY-REVOKED`),
so the worker behaves right — but the accounts surface is telling the user their connection is
fine-for-now at the exact moment it has stopped working. Given LinkedIn's 60-day non-refreshable token is
the single most common reconnection event this product will generate, the state the user reads at that
moment matters. **Fixed by:** either a sixth state, or routing `daysUntilExpiry < 0` to `disconnected`,
with a Tier-2 case pinning it. Note this is a genuine widening of §9.4's five states, so it may be an ADR
question rather than a Builder one.

### MINOR-7 — `resolvePublishAccount`'s ambiguity is surfaced to the user as `TOKEN_REVOKED`

`lib/publishing/orchestrator.ts:108-116` marks the post failed with `errorCode: 'TOKEN_REVOKED'` and
`errorDetails.reason: 'account_ambiguous'`. The reason string is right and the *code* is the one L-1
permits (adding a union member would change worker retry behaviour). But `TOKEN_REVOKED` is the code the UI
maps to "reconnect your account" — the wrong instruction for a user whose two X identities simply need one
picked. The correct action is disambiguation; the message will say reconnect. **Fixed by:** the
failure-surface copy branching on `errorDetails.reason` rather than on `errorCode` alone, with an i18n key
for the ambiguous case in all three locales.

## 10. SHARED-FUNCTION CALLERS — both functions, per caller

**Re-grepped by me at the range, not taken from the ADR.**

**Table A — the dual-identity resolver.** Three callers, matching ADR §17.3:

| Caller (at range) | Calls | Test | Multi-row / ambiguous case covered? |
|---|---|---|---|
| `app/api/social/[platform]/disconnect/route.ts:52,57` | `getActiveById`, `listActiveByBusinessAndPlatform` | `disconnect.test.ts:153` | **Yes** — asserts 409 `account_ambiguous` |
| `lib/metrics/orchestrator.ts:67` | `resolvePublishAccount` | `lib/metrics/orchestrator.test.ts:283` | **Yes** — mocks `{outcome:'ambiguous'}`, asserts skip |
| `lib/publishing/orchestrator.ts:107` | `resolvePublishAccount` | `lib/publishing/orchestrator.test.ts:434` | **Yes** — asserts `account_ambiguous`, nothing published |

All three covered. **The Session 22 root cause does not recur here.** Caveat: none of the three exercises
the *pinned-id* branch against a foreign business or platform — which is MAJOR-2, and is a gap in the
function, not in the callers.

**Table B — the provider surface's five consumers.** Verified per caller at the range:

| Consumer | Calls | Test file |
|---|---|---|
| `app/api/social/[platform]/connect/route.ts:56-64` | `getOAuthAuthorizeUrl` | `connect.test.ts` ✅ |
| `app/api/social/[platform]/callback/route.ts:86` | `exchangeOAuthCode` | `callback.test.ts` ✅ |
| `lib/publishing/orchestrator.ts:126-131, 214-222` | `publish`, `refreshAccessToken` | `lib/publishing/orchestrator.test.ts` ✅ |
| `lib/metrics/orchestrator.ts:56-76` | `fetchPostMetrics` | `lib/metrics/orchestrator.test.ts` ✅ |
| `app/api/_health/social/route.ts:35-40` | per-platform health | `app/api/_health/social/__tests__/route.test.ts` ✅ (new in range) |

Five for five. **The sixth interface method, `revokeAccessToken`, has zero production callers** — MAJOR-1.

## 11. Constraint-to-CI mapping

ADR §17.4 maps 34 constraints, each with tier, executing job, and a reddens-if-broken column. I spot-checked
the mapping against the actual test files for 12 of them and found no misattribution. Four constraints were
**demonstrated to redden** with the transcript recorded (§17.1) — the backoff formula linearised, a banned
import removed and the violation count checked from 8 to 7, Instagram's flag flipped, the postiz scan
reintroduced. That is the standard the project asks for and it was met.

**Two corrections to the mapping's status, both flowing from BLOCKER-2:** the two rows marked **Tier 1 /
db-tests** — `SOCIAL-VAULT-UPDATE-SECRET` and `SOCIAL-DUAL-IDENTITY-SCHEMA` — are listed without
qualification, but neither has an executed-green record at any commit in this range. Under ADR 0015 §2 they
are `AUTHORED-NOT-EXECUTED` until a green `db-tests` run exists. Every `app-tests`-mapped row **did**
execute green, which I confirmed independently by running the suite (3518/3518) and by opening
[run 33970947695](https://github.com/tcr430/SOSH/actions/runs/33970947695) at the head.

## 12. Scope and process

- **L-1 held.** I read `lib/publishing/orchestrator.ts`'s diff line by line: the only change is the
  account-resolution block (`:104-117`). The 8-case error switch, the exponential backoff, the four
  state-transition primitives and the idempotency handling are untouched. `worker-unchanged.test.ts` pins
  them, and its exception is exactly `resolvePublishAccount` and no wider. ✅
- **A-1 held.** `publishingAvailable` is `false` for instagram, facebook and threads
  (`platforms/config.ts:40,48,56`); the registry registers **no provider** for any of them
  (`registry.ts:67-70`). `SOCIAL-META-STILL-UNAVAILABLE` was demonstrated to redden. ✅
- **No read path.** `SOCIAL-NO-READ-PATH` scans `lib/social/` as source text (so it also catches a
  same-named helper, not just an interface member) and is clean. Session 32's deliverable is untouched. ✅
- **A-8 held.** `w_organization_social` absent from LinkedIn's scopes. ✅
- **`SOCIAL-INTERNALS-BAN-REPLACED` — genuinely replaced, not dropped.** Both new provider modules are in
  `eslint.config.mjs`'s `SOCIAL_INTERNALS_BAN` (`:15-16`), the list carries eight entries, and
  `eslint-internals-ban.test.ts` asserts all eight fire together **and** that the deleted broker path is no
  longer banned. `launch-checklist.md` §16 row 4's "moot once the file is gone" framing was wrong and the
  range corrects it. ✅
- **Tier-3 constraints are enumerated as decisions** (§17.5), including the two with no runtime test —
  `SOCIAL-ERR-MATRIX-TRUE` and `SOCIAL-INTEGRATION-NOT-EXECUTED` — each with its reason. That is the
  recorded-decision form ADR 0015 §2 requires, not silence. ✅
- **§14's manual verification log is EMPTY, and that is the honest state, not a finding.** §14.1 predicted
  it; no production OAuth app exists at either platform; the Builder claimed no live verification it did not
  perform. I checked specifically for a fabricated live-verification claim and found none. ✅

---

## Founder adjudications — restated as OPEN, not as findings against the implementation

**1. LinkedIn ships MEMBER-ONLY, contradicting a locked strategic decision.** CLAUDE.md's locked launch
platforms read **"LinkedIn (Business and Founder)"**. A-8 defers organization posting behind a legal entity
that does not yet exist and a Community Management API approval that can still be refused. **Launch as
built delivers the Founder half only.** This needs an explicit founder ruling — launch member-only and say
so in customer-facing copy, hold launch for the entity, or amend the locked list. ADR §16 item 1 calls it
*"the most likely long pole in the whole pre-launch plan"* and I agree. **It remains open.**

**2. X's per-post cost against "unlimited posts".** §14.3 records $0.200 per linked post; the Pro plan is
€125/mo advertising unlimited posts with no stated ceiling. At ten linked posts a day that is roughly half
the plan price on one platform. N2.1 additionally found a source discrepancy on the pay-per-use read cap
(2M vs §14.3's 3M) that it flagged and did not resolve. This is a pricing decision, not an engineering one.
**It remains open.**

---

## NITs

- **NIT-1.** `provider_unavailable` exists in all three locale files but **no route emits it**;
  `resolve-banner.ts:5-12` documents this and deliberately excludes it from `ERROR_KEYS`, while
  `accounts-i18n.test.ts` still asserts its presence. A translated string no code path can produce, kept
  alive by a test. Harmless, but it will outlive everyone who remembers why.
- **NIT-2.** ADR §16's items are numbered 1,2,3,4,5,6,**8,7** — the last two are transposed.
- **NIT-3.** The Reviewer primer says *"all six credentials"*; there are **four**
  (`LINKEDIN_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET`). Same class as the build guide's "eight rows" for
  §16's seven and "four states" for §9.4's five — a build-guide arithmetic drift the ADR has been
  correcting piecemeal. Worth one sweep rather than three more corrections.
- **NIT-4.** ADR §17.4's `db-tests` paragraph names **two** invisible suites; the run shows **seven**.
  Under-reported blast radius (folded into BLOCKER-2's remedy).

---

## What I could NOT verify, and why

- **`npm run test:db` locally.** The Docker daemon is unreachable on this machine, so no local Supabase
  stack could start. I assessed `db-tests` from the CI logs instead, and was able to reach a firm conclusion
  on cause (the 503-to-every-role evidence in BLOCKER-2) — but I have **not** independently executed the
  Tier-1 suites.
- **The three platform endpoint URLs in BLOCKER-1.** I deliberately did **not** check them against my own
  recollection: doing so is the exact move §13 prohibits, and a reviewer who validates an unsourced fact
  from memory has reproduced the defect rather than found it. They are unverified in the session's record,
  and they remain unverified by me.
- **The live grants check** the Builder ran against project `phdqfrrkbvuuklvbigoh`. I did not re-run it; I
  have taken the Builder's report of it at face value, and BLOCKER-2's remedy does not depend on it.
- **Whether `db-tests`'s seven invisible suites are new to this range.** They are all pre-existing suites
  unrelated to ADR 0028, and the run that would establish a baseline (a green `db-tests` on this branch)
  does not exist. Stated as unknown rather than assumed benign.

---

Session 30.5 review complete - 16 findings (2 BLOCKER, 3 MAJOR, 7 MINOR, 4 NIT) over range 54110178..be03c917.

---

## CORRECTION PASS (Session 30.5-D)

**Author:** Correction pass (Claude Sonnet 5), 2026-09-05, following `docs/build-guide/session-30-5.md`
§4's D0–D9 step order. **Fixed at commit range:** `02a93980` (D0) onward, appended to as each step lands;
D9 will supersede this line with the final range. Nothing above this section is edited — this appendix
only adds rows, per REVIEWER-REPORT APPEND-ONLY (CLAUDE.md).

| ID | Fix | Test | SHA |
|---|---|---|---|
| BLOCKER-1 | `X_AUTHORIZE_URL`, `X_TOKEN_URL` (twitter-provider.ts) and `LINKEDIN_POSTS_URL` (linkedin-provider.ts) were independently re-verified against live vendor docs (docs.x.com; Microsoft Learn) on 2026-09-05 and recorded in `docs/reviews/session-30-5-platform-verification.md` Appendix A, items 10/11/12. Both provider files' comments now cite the appendix item that actually contains each URL, replacing the citations to §13.1 items 1/3/4/6/7 and 1/9 that did not. No URL value changed — all three were already correct; only the provenance was false. | None — §13 is a provenance rule, proven by grepping each cited appendix item for the literal URL string, not a runtime test. | (D1, pending) |
| MINOR-1 | `LINKEDIN_USERINFO_URL` and `X_USERINFO_URL` moved from a code-comment-only citation into Appendix A items 13/14 (verified 2026-09-05). The pairwise-`sub` question (LinkedIn's OIDC discovery document declares `subject_types_supported: ["pairwise"]`, confirmed verbatim) was promoted from a code comment to ADR 0028 §16 item 9. | Same — provenance, plus the new §16 row. | (D1, pending) |
| MINOR-2 | Not changed — the Reviewer's assessment stands: `X_REVOKE_URL`'s disclosure comment in `twitter-provider.ts` was already the correct, honest form and is the model D1 followed for BLOCKER-1's fix. Given a durable record instead of living only as a comment: ADR 0028 §16 item 10. D3 will make this the first production call site for the value, per the build guide's ordering rationale. | None — argued and recorded, not changed, matching the build guide's own expectation for this finding. | (D1, pending) |

Files touched by D1: `lib/social/twitter-provider.ts`, `lib/social/linkedin-provider.ts` (comments only —
no URL value, provider behaviour, or test expectation changed), `docs/reviews/session-30-5-platform-verification.md`
(new Appendix A), `docs/decisions/0028-native-social-providers.md` (new §13.2, new §16 items 9–10).
