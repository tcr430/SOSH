# Jemip Backlog

Known gaps that are **committed but deferred**. Every entry names the session that filed it and the reason
for deferral; where a deferral has a condition attached, the **un-defer trigger** is named explicitly.

**What this is not:**
- **Not `docs/pre-launch-scope.md`** — that is *scope* (features to add). This is *debt* (things missing or
  imperfect in what already exists).
- **Not `docs/ideas.md`** — that is uncommitted possibility. Everything here is agreed work, just not now.
- **Not `docs/current-phase.md`** — that is live development state.

> **Reconciled 2026-09-03.** `docs/session-18-triage.md` (456 lines, 64 items, 2026-06-14) has been folded
> into this file and **deleted**. Its P0 and P1 tiers were fully closed by Session 18; its P2 tier and its
> "out of scope" list are carried below with their original IDs (`B18-*`) so historical references still
> resolve. Its `N/A — stale/superseded` items (B18-013, B18-032, B18-044, B18-082) were verified closed and
> are **not** carried forward as open work.

---

## 1. Pre-launch debt (open)

Must be resolved before the first paying customer.

> **2026-10-04 — branch `fix-qa-defects-session-36` (not yet merged):** `QA-REAL-API-SOSH-FIELD` and `QA-LOCALE-HEADER-DROPPED` are **fixed on that branch**, each with a test proven by mutation (`lib/ai/client.real-path.test.ts`: the real client path strips `_sosh` in `lib/ai/client.ts`'s adapter, so `runner.ts` / `tool-runner.ts` are unchanged; `lib/i18n/proxy-locale.test.ts`: `proxy.ts` re-sets `X-NEXT-INTL-LOCALE`). Both rows stay listed until that branch merges. Not verified: a real-model call through the fixed client, and pt/es rendering in a browser — see `S34-E2E-UNVERIFIED` and `S36-UX-UNVERIFIED-IN-BROWSER`. Also fixed there: the intermittent `corpus-v2-schema.test.ts` failure — `scripts/eval/run-triage-eval.test.ts` rewrote the checked-in `corpus.v2.json` in place while that read-only test ran in another worker; it now mutates a temp copy (`TRIAGE_EVAL_CORPUS_PATH` / `TRIAGE_EVAL_ARTEFACT_PATH`), and the checked-in file's mtime is unchanged by the run. 4 consecutive full `test:app` runs green (384 files / 5887 tests).

| ID | Area | Description | Filed |
|----|------|-------------|-------|
| **QA-REAL-API-SOSH-FIELD** | `lib/ai/runner.ts:193-220`, `lib/ai/tool-runner.ts:416-432` | **Every call through `runPrompt` fails against the real Anthropic API.** The runner attaches a `_sosh: { promptId, input }` field to the Messages request, for the mock client's fixture routing, under the comment "_sosh is stripped by the real Anthropic SDK (unknown fields ignored)". It is not: the API answers `HTTP 400 _sosh: Extra inputs are not permitted` (`@anthropic-ai/sdk` 0.91.1). Reproduced with a minimal call on `claude-haiku-4-5-20251001`: the identical request succeeds without the field and fails with it. So brief assembly and every other `runPrompt` consumer cannot reach a model in production; the tool runner sets the same field and was not run. Fix: attach `_sosh` only for the mock provider (or strip it in the real-client path of `lib/ai/client.ts`), with a test that the real path never sends it. Found by the S34-E2E smoke run; the earlier live cassette run predates this. | Session 36-D QA, 2026-10-04 |
| **QA-LOCALE-HEADER-DROPPED** | `proxy.ts` (steps 3-6) | **Every page renders English, whatever the URL's locale.** `requestHeaders` is cloned before `handleI18n(request)` runs, and the final `NextResponse.next({ request: { headers: requestHeaders } })` discards the `X-NEXT-INTL-LOCALE` request header next-intl sets, so `getRequestConfig`'s `requestLocale` is empty and falls back to `en`. `/pt/login` shows "Welcome back" (the file says "Bem-vindo de volta") under `<html lang="pt">`; `/es/login` likewise. Verified in a browser and with `curl` on `/en`, `/pt`, `/es` `/login`; adding `requestHeaders.set('X-NEXT-INTL-LOCALE', <locale from the path>)` after the `x-pathname` line made all three render translated (experiment reverted, not committed). The i18n tests check key parity and never rendering. Violates CLAUDE.md "i18n from day one"; a pt or es customer gets an English product. | Session 36-D QA, 2026-10-04 |
| **QA-MINOR-UI** | dashboard shell; sidebar | (1) The sidebar link for Team shows the raw key `nav.team` in every locale tried. (2) The dashboard shell overflows horizontally at a 320 px viewport (`scrollWidth` 367), independent of any page content (reproduced with the dismiss hint absent): the header and main are wider than a phone. | Session 36-D QA, 2026-10-04 |
| **31-A1-PRICING-COPY** | pricing copy (CLAUDE.md Locked decisions, marketing surfaces, Stripe plan copy) | Session 31 founder adjudication **A-1** caps Pro at **15 generated posts/day/business**, which makes the Locked pricing line *"Pro — unlimited posts"* false. Copy must become *"unlimited campaigns; fair-use daily post limit"* (or equivalent) **before launch**. This is a founder/copy change to a Locked decision, deliberately **out of scope for the Session 31 Builder** — shipping the cap without the copy change is a customer-facing misrepresentation. | Session 31 §0.2 A-1 |
| **B18-089** | ~15 sites across `lib/` | `formatISO(new Date())` writes **local-offset** strings to `timestamptz` columns; the `.toISOString()` ESLint ban does not catch `formatISO`. Postgres normalises `timestamptz` so live risk is low, but CLAUDE.md mandates `toUtcIso()`. **Do not fix piecemeal — one full sweep.** ~45min | 18B-5D |
| **B18-086** | `app/[locale]/(auth)/signup/actions.ts` | Account-enumeration oracle: the `already registered` branch returns a field-level `errors.email` key where every other failure returns generic `errors._form`. Collapse into the generic form error (same fix shape as the closed login oracle B18-060). ~30min | 18B-4 |
| **B18-064** | `postcss` (transitive) | XSS CVE in the Next.js dependency chain. **Blocked** on a Next.js bump — no direct remediation. Re-check on each Next upgrade. | 18B-5D |
| **13.5C-log** | `app/api/cron/publish/route.ts` | Bearer-side cron-auth failure emits no structured warn log; the QStash branch does. Add the parallel `console.warn(JSON.stringify({ kind: 'cron-auth-failure', … }))`. | Session 13.5C |
| **B18-023** | marketing bundle | Verify first-load JS ≤ 90 KB gz. **Blocked on B18-027.** | launch-checklist §11 |
| **B18-024** | marketing CWV | LCP/CLS/INP lab check on `/`. **Blocked on B18-027.** | launch-checklist §11 |

**Also pre-launch, tracked elsewhere — not duplicated here:** the legal gates (counsel ratification →
`[LEGAL ENTITY]` substitution, Anthropic DPF, cookie inventory, Svix client-verify) live in
`launch-checklist.md` §9; the broker→native publishing migration (complete in code as of Session 30.5,
ADR 0028 — production OAuth apps not yet registered) is tracked in §16; the `db-tests` promotion tally
lives in `current-phase.md`.

---

## 2. Deferred with a named un-defer trigger

**The highest-value section in this file.** Each of these has an explicit condition; none should be
actioned before its trigger fires, and each *must* be actioned when it does.

| ID | Item | Un-defer trigger |
|----|------|------------------|
| **31-DEAD-POST-GENERATION-PROMPT** | Delete `postGenerationPrompt` (`lib/ai/prompts/post-generation.ts`), its barrel re-export (`lib/ai/index.ts:4`), its five `lib/ai/__fixtures__/post-generation/*.json` fixtures and the `promptId === 'post-generation'` routing branch in `lib/ai/client.ts:61-67` — as **one** diff | **Zero production callers confirmed** during the ADR 0024 review (Session 31 §2.5, §15 MINOR-2): the only two hits are its own declaration and the barrel re-export. Deliberately NOT done in Session 31 — prompt, fixtures and mock branch must go together or the mock throws `fixture not found`. Un-defer: **the next session that touches `lib/ai/prompts/` for any other reason.** |
| **21C-pagination** | Real cursor pagination for the Approvals inbox beyond `APPROVALS_POST_LIMIT` (200) | **The first business observed with `total > 200` pending drafts.** `APV-BULK-VISIBLE-ONLY` disables bulk approve whenever the rendered set is incomplete, so overflow degrades a live affordance, not just a count. Act on the signal, not a date. |
| **22-MINOR-5** | Index covering `(business_id, status, scheduled_at) WHERE deleted_at IS NULL` for the pending-draft predicate | **Same trigger as `21C-pagination`.** Do not create the index before it. |
| **25D-MINOR-11** | `post-generation.ts:179` / `post-regeneration.ts:147` neutralise `topContent` but do not truncate it | **The first writer that puts a synthesized, unbounded value into `performance_memory.pattern`** must enforce a length bound at write time before it can reach these render sites. Session 33's outcome extractor is a candidate. |
| **30.5-DBTESTS-READINESS-RACE** | `db-tests.yml` has now failed on **six** attempts across two sessions — the original four N2.13/N3/D9 reds (`608f3839`/`b6580b84`/`be03c917`/`933a335c`), plus **two more on `session-30-5-adr-0028` at `15aeb764`** (run `34694455123`, both its first attempt and its `gh run rerun --failed` retry, Session 31-D D20/D20-addendum, 2026-09-12) — **root cause now confirmed, superseding the `pgsodium`/Vault-extension hypothesis below.** `.github/workflows/db-tests.yml:43-78`'s own comment (added after the original four reds, before the two D20 ones) names it precisely: Postgres image range **17.6.1.099-17.6.1.112 ships a broken `supautils` 3.2.0/3.2.1** — any EXECUTE-permission-**denied** call to a `SECURITY DEFINER` function SIGSEGVs the backend and takes the whole cluster into recovery, confirmed upstream at `supabase/postgres#2367`, `#2112`, `#2377`, fixed in supautils 3.2.2 (image 17.6.1.113+). This is exactly what both D20 reds hit (`reserve_ai_budget` and `vault_update_secret`, both `SECURITY DEFINER`, both crashing specifically on the anon/authenticated **denial** path a permission test exercises) and exactly what the original four reds hit (`vault_update_secret`'s denial assertions, "misdiagnosed at the time as OOM/memory pressure — it is not," per the same comment). | **Session 30.5-D, D8's memory-tuning fix did not resolve it** (proven wrong by the segfault evidence, not the fix). **A later attempt (workflow comment, pre-dates D20) pinned `supabase/setup-cli@v2.1.1` to `version: 2.117.0-beta.21` — verified in CI (run `34027147179`) that this ALSO does not fix it:** it is still the newest published 2.x release and still resolves to Postgres image 17.6.1.111. Three real fixes remain, named in the workflow comment, none yet attempted: **(a)** wait for a stable 2.x Supabase CLI release that ships image ≥17.6.1.113; **(b)** evaluate the `3.0.0-beta.x` CLI line (different internal architecture, untested against this workflow); **(c)** a CI-only Docker image-retag workaround shadowing the `17.6.1.111` tag with a verified-clean image (e.g. `17.6.1.156`) before `supabase start`. `db-tests` stays RED on any branch that exercises a `SECURITY DEFINER` denial path until one of these lands — this is not specific to `session-30-5-adr-0028`. First `db-tests` promotion attempt (ADR 0015 §5) should not proceed until a green run is observed (**separately, per `docs/current-phase.md`'s corrected 2026-09-03 entry, the promotion *tally* itself already reached 7/3 pre-this-bug and awaits only a founder branch-protection decision — do not conflate the tally with this crash: a `pull_request` run never moves the tally either way, crash or not**). |
| **30.5-REVOKE-UNWIRED** | `SocialProvider.revokeAccessToken` exists on all three providers (LinkedIn, X, Mock) and is unit-tested on each, but has **zero production callers** — neither `app/api/social/[platform]/disconnect/route.ts` nor `deactivateSocialAccount` (`lib/db/social-accounts.ts`) calls it. Found while re-grepping SHARED-FUNCTION CALLERS at N2.13 close-out (ADR 0028 §17.3). `SOCIAL-REVOKE-NEVER-BLOCKS`'s tested claim ("a provider's revoke never throws") is true; its implied claim ("disconnect attempts revocation, and a failure doesn't block it") describes wiring that does not exist today. | **Whoever next touches the disconnect flow** should wire `revokeAccessToken` into it (best-effort, never blocking `deactivateSocialAccount`, per the constraint's own name) — or, if the founder rules that best-effort platform-side revocation isn't worth doing (LinkedIn has no callable endpoint for a third-party app anyway; §4.4), amend ADR 0028 to say the interface method is provider-side-only and not part of the disconnect flow by design. |
| **22E-integration-discovery** | Three `__integration__` suites (`app/[locale]/(marketing)`, `lib/deletion`, `lib/email`) are discovered by no CI job. **`lib/social/__integration__/` does not exist** — Postiz's integration suite was deleted whole in Session 30.5 N2.11, and no native LinkedIn/X replacement was written to replace it (N2.13, ADR 0028 §9.3/L-9: writing one would have bought zero CI coverage until this item closes, so none was written). ADR 0028's compensating control is its own §14 manual verification log instead, currently empty. | **First launch-blocking dependency on a real-network path, or first LinkedIn/X/Resend defect reaching staging.** Deliberate 22-D trade (absent-and-honest beats present-and-lying); `purge_business` retains Tier-1 coverage via `db-tests`. |
| **22D-skipguard-file-floor** | Skip-guard misses a single required suite silently dropping out of collection | **A rename or glob change that alters the collected-file count.** Fix: assert a floor on collected files, or pin a manifest of required suites by name. |
| **24D-NIT-4-logger** | Three brief Server Actions swallow throws with `catch { return generic }`, marked `// TODO(logger)` | **When a project logger lands.** Same class as `BriefReviewForm.tsx:126`'s `key={i}`. |
| **S37-PDF-RATE-LIMIT** | A per-user rate limit on `GET /api/analytics/reports/[id]/pdf` (ADR 0031 §5.5, ruled in the 2026-10-04 review: **no new rate-limit primitive in Session 37**). The route's bound today is: concurrency 1 per function instance with a queue of at most 2 (a further request is a 503 with `Retry-After`), a 25 s hard timeout over launch and render, auth and the active-business binding before any launch (so the cost lands on a known tenant), and a **Vercel Firewall rate rule** (launch-checklist row, verified in the dashboard, never in CI). **Accepted residual risk:** a signed-in member can still cause repeated renders inside the firewall's allowance, and the concurrency bound is per instance, not global. | **Render cost or abuse is observed beyond the firewall rule** (Chromium minutes in the Vercel bill out of proportion to report count, a Sentry `report-pdf` or 503/504 pattern, or one tenant dominating the route). Filed Session 37 O2.9. |
| **`MODE2-REDUNDANCY-UNDEFER`** | Cross-set redundancy — *"these two posts make the same argument"* (ADR 0017 §8 item 4) | **Session 34 Q4 must answer this explicitly** — un-defer it there or leave it deferred, but not silently. It is a question about the *set*, so the campaign planner is its natural home. |
| **`EMBEDDINGS_UNDEFER_THRESHOLD`** | `audience_memory` embedding retrieval (ADR 0016 §5.3) | **200 active `audience_memory` rows.** Distinct from `SIGNAL-NO-EMBEDDINGS` — do not conflate the two (Session 29-D D11 corrected exactly this confusion). |
| **`SIGNAL-NO-EMBEDDINGS`** | Embeddings in Mode 3 Stage B scoring — **re-affirmed**, not retired (ADR 0023 §4.1) | ADR 0020 §6.5's condition (a second *unstructured* source) appears met by RSS — but it was written about **Stage B scoring**. Retrieval/exemplar use is a *different* use needing its own ruling. |
| **`30.5-X-REFRESH-ROTATION`** | X rotates its refresh token on every refresh, which makes ADR 0002 §8's *accepted* concurrent-refresh race worse than the race §8 actually reasoned about. §8 assumed the loser wastes one retry ("some platforms accept both refreshes; last write wins; no user impact"). Under rotation both callers read the same refresh token R; caller 1 consumes R for R'; caller 2 then presents an already-consumed R and is hard-rejected — and where a platform treats refresh-token reuse as a theft signal, it can invalidate the whole chain and **disconnect the account**, forcing the user to reconnect. Same race, materially worse consequence. Remedy already named by ADR 0002 §8: a Postgres advisory lock `pg_advisory_xact_lock(hashtext('refresh:' || $1))` inside `refreshAccessToken`. | **The first observed rotation-related disconnect, OR any X refresh error whose body indicates refresh-token reuse.** Founder ruling 2026-09-03 (Session 30.5 adjudication D): accepted for MVP — traffic is scheduled, low-volume, one business per account, so genuine concurrency is rare — but filed here because it is expected to bite later. **Do not treat ADR 0002 §8's "accepted" as covering this case**: §8 accepted a wasted retry, not an account disconnect. NOTE: independent of, and blocked by, the missing `public.vault_update_secret` (Session 30.5 adjudication B) — until that migration lands the rotated token is never persisted at all. |
| **`30.5-MEDIA-UPLOAD`** | Native media upload for LinkedIn and X. Both platforms require a **two-call** publish for media (upload bytes → asset id → reference the id in the post), which introduces a failure mode *between* the calls — an uploaded asset with no post — that ADR 0005's one-attempt-per-post status machine has no state for. `PublishInput.mediaUrls` exists but is documented "empty in Phase 1 (text-only)" and has no producer today. Session 30.5 therefore ships a **guard, not a capability**: a post with non-empty `mediaUrls` fails `PLATFORM_REJECTED` rather than silently publishing text-only, because shipping a different post than the user approved is the worst outcome for a human-in-the-loop product. | **Founder ruling 2026-09-03 (Session 30.5 adjudication C): a dedicated media-integration session owns this.** Un-defer when that session runs, or earlier if image generation (pre-launch per CLAUDE.md) lands a producer that populates `mediaUrls` — at which point the guard starts rejecting real posts and the upload path becomes launch-blocking. |
| **B18-015** | ADR 0010 Amendment A2 — swap §13 erasure prose to in-app wording | **Depends on B18-014** (in-app Delete Account flow). Must not land first, or `/privacy` describes a flow that does not exist. |

**Resolved (Session 32-D D12, 2026-09-19):** `30.5-DBTESTS-READINESS-RACE` — the workflow now shadows the broken `17.6.1.111` image tag with `17.6.1.113` and fails unless the DB container runs it; db-tests green at `15beb540` (run 35436865202, 62 files / 452 tests). Un-defer trigger for removing the shim: a stable CLI release whose default image is >= 17.6.1.113.

**Session 35 (ADR 0029 §12, founder input engine) — every deferral, each with its owner:**

| ID | Item | Owner | Un-defer trigger |
|----|------|-------|------------------|
| **35-CROSS-TYPE-RETRIEVAL** | Cross-type memory retrieval, widening `MemoryQueryContext`, cross-writer contradiction resolution | Track L | Track L's own ADR |
| **35-MEMORY-MGMT-UI** | A general memory-management UI (edit/retire any row) and its own gated write path | Track L or a later session | that session's ADR |
| **35-VOICE-NOTE-ANSWERS** | Voice-note and transcript answers to interview questions | T2-B (`pre-launch-scope.md` §12.3) | the T2-B session, with its own counsel line |
| **35-ANSWERS-TO-BRIEFS** | Turning interview answers into cards or briefs directly | `docs/ideas.md` §2.2 ruling R2 / `pre-launch-scope.md` §12.7's gate | that session |
| **35-EVIDENCE-PERMISSION-ON** | Enabling `public_use_permission` on interview-sourced evidence | Counsel, ADR 0025 A-6 | counsel-approved copy in three locales |
| **35-EMAIL-KIND-REMINDER** | A seventh `EmailKind` (an interview-reminder email) | A follow-on (A-5) | round completion < 40% over the first 20 due rounds |
| **35-BUDGET-PURPOSE-FIFTH** | A fifth `ai_budget_daily` purpose for interview spend | A follow-on (A-4) | interview spend observed above the §7.2 ceilings, or on-demand rounds added |
| **35-TIER-E-EXTRACTION-FIDELITY** | A Tier-E extraction-fidelity eval (does the model's extraction track what founders actually meant) | A follow-on | edit rate > 30% over >= 10 ratified rounds |
| **35-BRIEF-RETRIEVAL-INSTRUMENTATION** | Instrumenting which memory ids a campaign brief actually used, so interview-sourced retrieval becomes MEASURED rather than NOT MEASURED (ADR §10.5) | A follow-on | **Already met**: M2.0's grounding pass (2026-09-27) confirmed `lib/campaigns/brief.ts` / `lib/db/campaign-briefs.ts` record no memory ids today — the trigger condition is live, no instrumentation was added this session per the ADR's own instruction |
| **35-ON-DEMAND-ROUNDS** | On-demand ("ask me more") interview rounds outside the 30-day cadence | A follow-on | founder request; changes the §7 cost bound |
| **35D-NIT-4-NOT-DUE-COPY** | The `not_due` page state (`lib/interview/page-state.ts:96-115`) shows the last terminal confirmation (ratified / no_records / skipped / expired / failed) instead of saying when the NEXT round can start (ADR 0029 §8.2 names both). Once any round exists, `not_due` is reached on almost every subsequent render, so the gap is effectively permanent, not an edge case. Fixing it needs `due.ts` to expose the next-eligible instant and a §8.2 layout decision — a design call the correction pass's primer forbids taste-skill/impeccable from making (Session 35-D build guide primer, rule 12) | Track M follow-up | **the first tenant completes a round, or the next `/impeccable` pass over `/interview`, whichever is first** |

---

## 3. Post-launch / deferred (no trigger)

Ordered loosely by likely value.

| ID | Area | Description | Filed |
|----|------|-------------|-------|
| B18-014 | GDPR | In-app Delete Account flow. At launch the row-source for erasure is a manual insert from a `privacy@` email; the hard-delete cron (the executor) already ships. | Session 18 |
| B18-079 | `lib/stripe/webhook.ts` | Retried stale `customer.subscription.updated` could overwrite a newer plan — no `updated_at` guard. Documented accepted risk. | Session 11C |
| B18-080 | `lib/stripe/checkout.ts` | Concurrent first-checkout can create two Stripe customers (orphan). Phase-2 idempotency-key fix. | Session 11 F3 |
| B18-033 | `lib/db/social-accounts.ts` | `deactivateSocialAccount` read-then-update TOCTOU on concurrent connect/disconnect. | Session 6D |
| B18-036 | `lib/campaigns/enforcement.ts` | `countActiveCampaigns` + `createCampaign` TOCTOU could slip an extra campaign past the plan cap. | Session 7C |
| G3 | ADR 0008 §10 | T-1 window reconciliation: code uses `[now+1d, now+2d)`; ADR text says `[now, now+1d)`. Code and tests internally consistent — amend the ADR. | Session 14 Reviewer |
| C7 | ADR 0008 §14 | ADR schema block does not document that `svix-id` is the PK (idempotency anchor). Reconcile with the shipped migration. | Session 14 Reviewer |
| D3-locale / B18-007 | `lib/email/__tests__/enqueue.test.ts` | Missing test locking the locale-snapshot invariant against a live `businesses.language` mutation. | Session 14 Reviewer |
| J3 | `lib/observability/sentry-scrub.ts` | Verify `scrubEvent` catches bare email addresses inside Resend error message strings, not only key-name matches. | Session 14 Reviewer |
| B18-087 | signup + resend-confirmation | `emailRedirectTo` omitted, so confirmation links resolve to the Supabase Site URL rather than `APP_URL` — correct in prod, wrong in preview. **Fix both entry points together** or create an asymmetry. | 18B-4D |
| B18-083 | `lib/metrics/orchestrator.ts` | Catch block does not distinguish infra vs provider errors. | Session 12 |
| B18-078 | publish tests | Error-code tests do not assert `last_publish_error` / `publish_attempts`. | Session 10 |
| B18-038 | `lib/ai/prompts/post-generation.ts` | `PostGenerationOutputSchema` does not enforce per-platform hashtag/length at parse time; call sites do. | Session 8C |
| B18-039 | `lib/campaigns/schedule.ts` tests | No test for `frequency='custom'` with unusual `postsPerWeek`. | Session 8C |
| B18-028 | `lib/ai/__fixtures__/` | Key fixtures by `prompt_id` to avoid cross-version collision. Only bites when two prompts share a model. | Session 5D |
| B18-063 | `lib/db/` | Use generated Supabase row types instead of `as BusinessRow` casts. | Session 4 |
| B18-065 | `lib/db/businesses.ts` | `getBusinessById` should require a typed RLS-client wrapper (defence in depth). | Session 6 |
| B18-077 | `supabase/migrations/` | Migration hygiene: `IF NOT EXISTS` on ALTER TABLE; document apply-ordering coupling. | Session 10 |
| B18-047 | `find_trial_expiring_between.sql` | Hardcodes the 14-day trial length. Maintainability only — trial length is a locked decision. | Session 14 |
| B18-037 | campaign detail | Uses `redirect()` rather than `notFound()` on 404/unowned. Cosmetic; RLS already guards. | Session 7C |
| B18-035 | disconnect dialog | Never browser-verified across locales/themes. Manual visual QC, no known defect. | Session 6D |
| K1 | `lib/email/templates/index.ts` | Two `any` casts with `eslint-disable`. **Partially resolved** — CLAUDE.md now documents this as one of two accepted `any` carve-outs. Remaining option: a generic `KindEntry<P>` to remove them. | Session 14 Reviewer |
| SSRF-ranges | `lib/ai/website-fetcher.ts` | `0.0.0.0/8` and `fe80::/10` not yet in the blocklist. Low practical risk. | Session 5D |
| fetch_failed | error enum | Dead `fetch_failed` value in an error enum. | Session 5D |
| 21B-n4 | dashboard Server Actions | Multiple call sites each call `getBusinessForUser` independently per request. Latency/query-count only — correctness unaffected. Fix: request-scoped memo (React `cache()`). | ADR 0014 A0 |

### 3.1 Session 33 — the outcome loop (ADR 0026), filed by J2.13

**With a named un-defer trigger** (ADR 0026 §15 items that no other session owns, plus what the Builder found):

| ID | Item | Un-defer trigger |
|----|------|------------------|
| **S33-EXPERIMENT** | Deliberate experimentation: organic A/B or a randomized pattern holdout. The only route to a **causal** number for `OUTCOME-PREDICTION-ACCURACY`; excluded by L-1 today, so that number is reported only as "association, not validation". | **Volume:** enough promoted patterns and matured posts that the Tier E protocol (ADR 0026 §V.4) clears its per-arm floor of n >= 15 in each arm on real customers, i.e. after T0 (the first real customer's first published post with real metrics) plus roughly 150 days. |
| **S33-HOOK-KAPPA** | `hook_type` promotion. `hook_type` is collected and shown but never promoted; its value is the model's own self-report. | An agreement check clears: **Cohen's kappa >= 0.6 on >= 30 sampled posts** (ADR 0026 §4.1), then a follow-on amendment to ADR 0026. |
| **S33-PROOF-TYPE** | `proof_type` promotion (confounded with campaign identity). | Per-post evidence citation exists in the output schema (Session 34, claim verification). |
| **S33-LINKEDIN-RATE** | LinkedIn rate metrics and follower-count normalisation. LinkedIn stays on the count basis and `fetchPostMetrics` is still NOT_IMPLEMENTED for it. | `r_member_postAnalytics` approval (ADR 0028 §16 item 11); follower normalisation needs a follower fetch. |

**Post-launch, no trigger:**

| ID | Item | Note |
|----|------|------|
| **S33-VARIETY** | "Not enough variety" on the campaign page is computed from the brand's outcome patterns, so a value with fewer than 5 observations is invisible to it and variety can be over-reported. | Needs per-brand dimension-variety data, or a small SQL aggregate. |
| **S33-INELIGIBLE-RETRY** | A post excluded for a null eligible field writes no `post_outcomes` row, so it is re-examined every tick until it leaves the 30-day lookback, and it consumes batch budget while it does. | Record a typed exclusion, or stop re-listing posts whose day-7 sync is complete but ineligible. |
| **S33-RETRO-SCAN** | The retrospective phase looks only at a business's newest 50 campaigns without a retrospective, per tick. | Fine at launch volume; page it when a brand can hold more than 50 open campaigns. |
| **S33-TRIGGER-A** | Security review MINOR-1, accepted: `performance_memory`'s write-protection trigger branch A checks `NEW`, not the transition, so a soft-delete UPDATE can also edit content on a row no reader can see. No impact found. | Fold into the next migration that touches that trigger. |
| **S33-TOPIC** | A `topic` dimension. | Needs a controlled content-pillar vocabulary; not scheduled. |
| **S33-IMPORT-OBS** | Imported posts as observations (ADR 0026 ruling A-4 option (b)). | Declined; it would change ADR 0025 §8.3 retention and needs counsel. |
| **S33-MINING** | Comment mining; embeddings; memory-driven opportunity cards. | Excluded by L-1; unscheduled. |
| **S33-RETENTION** | Retention policy for `post_outcomes` (mirrors `post_metrics`' no-retention posture). | Belongs to the project retention ADR. |
| **S33-QSTASH** | The `extract-outcomes` QStash schedule and Sentry monitor are documented but **not created** (`docs/launch-checklist.md`). | Before the outcome loop runs unattended in production. |

Owned elsewhere and therefore not repeated here: UTM auto-tagging, conversion-event ingestion and the analytics
surface (T1-B); cross-type retrieval and any further memory writer (Session 34+).

---

### 3.2 Session 34 — agency in generation (ADR 0027), filed by K2.11

**With a named un-defer trigger** (ADR 0027 §12, plus what the Builder found):

| ID | Item | Un-defer trigger |
|----|------|------------------|
| **S34-WIRE-PLANNER** | **CLOSED at K2.12** (ADR 0027 §V.8). `prepareBriefForCampaign` runs `assembleBrief`, then the critique and the planner concurrently, from `createCampaignAction`; the form redirects to brief review. Not yet observed against a real model, so the p95 is still unmeasured. | (closed) |
| **S34-POSTS-TRIGGER-AUTHOR-WRITES** | `enforce_post_transition_capability` (`20260702120300`) gates only the grant of approval. A holder of `author` can raw-write `draft -> scheduled` and `draft -> published` on their own row through RLS (probed live at K2.11). Not a publication bypass (the worker consumes only rows `claim_posts_for_publishing` returned from `approved`), but a post can read `published` that never published. | **Before launch sign-off**, or the first migration touching that trigger, whichever comes first. Fix shape: deny any human `draft -> scheduled|published`, keeping the service-role exemption. |
| **S34-MEMORY-CARDS-AND-AGENTS** | Memory-driven opportunity cards and background proposal agents (brainstorm T2.5, §13). They belong in the EXISTING opportunity feed; a second inbox is how this class of feature dies. | Founder ruling **R2**. |
| **S34-CROSS-TYPE-RETRIEVAL** | Cross-type retrieval and additional memory writers. | Track L, memory as a platform substrate. |
| **S34-EMBEDDINGS** | Embeddings, similarity retrieval, exemplar selection. `SIGNAL-NO-EMBEDDINGS` stays in force for Mode 3 Stage B. | `pre-launch-scope.md` §12.6 unblocks it for `lib/memory/` only; not scheduled into Sessions 31-34, so a candidate for the next memory session. |
| **S34-COMMENT-MINING** | Comment mining; deliberate experimentation. | Brainstorm Part I; experimentation is `S33-EXPERIMENT`. |
| **S34-IMAGE-GEN** | Image generation. | T2-D, pre-launch, behind T1-C. |
| **S34-EGRESS-TOOL** | Any network-egress generation tool ("read the customer's site", "fetch the article by URL"). A **named non-goal** (`AGENCY-NO-EGRESS-IN-TOOLS`), not a note. | Either the customer's site is routed through the existing RSS/Atom source, or a vetted fetcher with its own SSRF review. |
| **S34-PERF-PATTERNS-TOOL** | `retrievePerformancePatterns` as a planner tool. | A tool that can reach *only* `retrieveOutcomePatterns`' minimum-n-floored arm. |
| **S34-SEMANTIC-REDUNDANCY** | Semantic cross-set redundancy (`checkSetRedundancy` is structural, not semantic). | Measured edit-distance or manual-review data showing semantic redundancy surviving both halves (ADR 0027 §5.8). |
| **S34-UNIFY-VERIFY** | Unify the three verify-then-cite modules (`lib/studio/verify.ts`, `lib/signals/triage/verify.ts`, `lib/campaigns/verify-claims.ts`). No owner; `AGENCY-VERIFY-CROSS-REFERENCED` keeps the map so it is a refactor, not archaeology. | No trigger; a refactor when a fourth instantiation is proposed. |
| **S34-RENAME-TRIAGE-CONSTS** | Rename `runToolLoop`'s `TRIAGE_*` constants now that it has a second consumer. Forbidden in Session 34 (ADR 0027 §3.1); its own tracked piece of work. | Any session that touches `lib/ai/tool-runner.ts` for a third consumer. |
| **S34-E2E-UNVERIFIED** | The whole customer path (create campaign -> brief review with the plan panel -> approve -> generate -> posts) is unit-tested and has **never been run in a browser or against a real model**. Two specifics need a real run: form-submit latency (creation now blocks on Stage A plus the slower of critique and planner; ADR 0027 §7.3 predicts +16 s p50 and 30 000 ms p95, unmeasured), and per-campaign LLM cost at creation, which now falls on every new campaign including trials before any post exists. I did not verify that Stage A or the critique carry a per-business daily cap (only the planner does, `AI_PLANNER_DAILY_CAP_CENTS`). **Partial run, 2026-10-04 (Session 36-D QA):** `assembleBrief` ran against the real model on the local stack, once with seeded memory and once as a no-memory control. With memory the brief pinned the seeded customer quote as evidence (`evidenceMemoryId`), built a `customer_proof` role around it, and respected the seeded brand rule; the control had no `customer_proof` role and hedged ("if available, early-access user feedback"). One tenant per arm, no quality measurement, and it needed a **local shim** for `QA-REAL-API-SOSH-FIELD` (the request fails without it), so the path was NOT run unmodified. Critique, post generation, the planner and the browser journey remain unrun. | **Before launch sign-off**, and the first time a real model key is available in a non-test environment. If latency or cost is unacceptable, prepare the brief in the background (`after()`) with a "preparing your brief" state on the campaign page. |

**Found in passing, out of scope for Session 34** (ADR 0027 §12; both re-verified still true at K2.11):

- **`listAiUsageByBusiness`** (`lib/db/ai-usage.ts:87-99`) has **no explicit `ORDER BY`**, against the house rule that every
  list query has one matching an index. The `.limit(limit)` is present; the ordering is implicit.
- **`lib/memory/index.ts:8-13`'s "no production consumer yet, by design" comment is stale.** `retrieveBrandMemory`,
  `retrieveEvidenceMemory` and `retrieveAudienceMemory` now have production consumers: brief assembly
  (`lib/campaigns/brief.ts`), generation (`lib/campaigns/generate.ts`), the planner and triage tools, the studio action and
  the approvals page.

**The Builder's own debt:**

- The build guide's `posts.ts` line references (`:226/:418/:492/:654`) have drifted; at HEAD the map is at `:226` and the
  approved-status guards are at `:488`, `:562`, `:724` (ADR 0027 §V.7 item 8).
- K2.6's commit subject claimed an ADR 0024 amendment that was not in the commit. Process note for the Reviewer: a
  commit-subject claim about a document is checked against the commit's file list.
- `lib/campaigns/generate.ts` has six structured `console.log` lines (five at BASE); CLAUDE.md's carve-out says one per
  invocation. The file's existing pattern was followed; if the carve-out is to be read strictly, that is a separate cleanup.

### 3.3 Session 36 — the memory substrate (ADR 0030), filed by L2.11

> **⏸ Sequencing note (2026-10-04, `docs/pre-launch-scope.md` §15):** none of the rows below is pre-launch,
> and none should be pulled into Sessions 37–40. That includes the five `S36-WRITER-*` rows and two items
> with no row of their own: the **post, plan and triage memory bundles** (`MEMORY_TASK_BUDGET` defines
> them in `lib/memory/bundle.ts`; only the brief is wired), and `S36-MEMORY-CARDS`, whose trigger
> ("founder ruling R2") is stale. R2 was ruled by `pre-launch-scope.md` §12.7 on 2026-09-03, and the real
> release is now Tier 1 closed plus real tenant memory (`docs/ideas.md` §2.2). Nothing here can be measured
> until a production account connects.

**Deferred, each with its un-defer trigger** (ADR 0030 §6.7 and §13.1). The five deferred decision writers come first: each is a human judgment the product already records, and none reaches memory yet, because none has a closed, structured reason a deterministic writer could read (L-7).

| ID | Item | Un-defer trigger |
|----|------|------------------|
| **S36-WRITER-BRIEF-REJECTION** | Brief rejection (`rejectBriefAction`) as a memory writer. Signal: the strategy was wrong (audience, brand). Free text would need a model, which L-7 forbids on a write path. | `rejectBriefAction` gains a closed-enum reason. |
| **S36-WRITER-POST-SKIP** | Post skip as a memory writer. The `skipped` status carries no reason at all. | A skip-reason enum ships. |
| **S36-WRITER-RESCHEDULE** | Reschedule as a memory writer (a timing judgment, so performance memory). Not an audience or brand fact; high noise. | T1-B analytics shows a timing signal worth learning. |
| **S36-WRITER-STUDIO-DISCARD** | Studio discard as a memory writer. ADR 0019 L-7 drops it silently by design; ADR 0018's diff loop already captures richer signal. | ADR 0019 L-7 is reversed. |
| **S36-WRITER-CLAIM-REMOVAL** | Claim removal as a memory writer ("that claim isn't defensible"). No recorded reason. | Claim verification records a closed-enum removal reason. |
| **S36-TOO-SENSITIVE-TO-BRAND** | `too_sensitive` dismissals writing `brand_memory` (brand-risk appetite). One card says nothing durable. | At least 5 `too_sensitive` dismissals from one watched source on a real tenant. |
| **S36-MEMORY-UI** | A general memory-management UI (edit or retire any row) and its gated RPC. Nothing in this session adds an edit or retire affordance. | Founder request, or the first support case needing a manual retire. |
| **S36-EMBEDDINGS** | Embeddings and semantic retrieval (`lib/memory/` only). | ADR 0016 §5.3 `EMBEDDINGS_UNDEFER_THRESHOLD = 200` active evidence + audience rows for one business. |
| **S36-MEMORY-CARDS** | Memory-driven opportunity cards (brainstorm §13). | Founder ruling **R2**. |
| **S36-RELATIONSHIP-MEMORY** | `relationship_memory`, parked. | The engagement inbox ships. |
| **S36-CROSS-TYPE-LINKS** | A cross-type link column and cross-type joins. | A writer that populates links, or embeddings. |
| **S36-FORMAT-QUERY-FIELD** | A `format` field on `MemoryQueryContext`. | A non-outcome writer that stores a format value. |
| **S36-WRITER-ENVELOPE** | The wider writer envelope for existing writers (status-on-insert, `expires_at` horizon, `scope_ref` charset). | The first writer that inserts `active` rows by a path other than its gate RPC. |
| **S36-RENDEREDMEMORY-RETROFIT** | Retrofitting the per-type retrieval guards to `RenderedMemory`. | A new per-type consumer that renders memory into a prompt outside the existing guards. |
| **S36-BRIEF-PERFORMANCE** | Performance memory in brief assembly (the brief's performance ceiling is 0). | A session specifies `briefAssemblyPrompt`'s performance section, its count rendering and its version bump. |
| **S36-TRIAGE-DISMISSAL-INJECTION** | Deterministic injection of the signal's own source dismissal row into the triage prompt (§6.8). | `SIGNAL3-TRIAGE-QUALITY` can be re-measured against a baseline that includes memory-seeded cases. |
| **S36-TRIAGE-TIER-E-ARM** | `not_relevant` rows as a Tier-E arm of `SIGNAL3-TRIAGE-QUALITY`. | The eval corpus gains memory-seeded cases. |
| **S36-CONTRADICTION-DETECTION** | Automated cross-writer contradiction detection. | At least 10 interview Replace actions on import rows observed on real tenants. |

**The Builder's own debt** (recorded in ADR 0030 V.9, V.12, V.13, V.14; none blocks the merge):

- **S36-M1-RESIDUAL-GRANTS** — `REFERENCES` / `TRIGGER` (and `MAINTAIN` on PG17) stay granted to `anon` / `authenticated` on all four memory tables via platform default privileges. Not reachable over PostgREST; ADR 0029's migration has the same residue. A single `REVOKE ALL … FROM anon, authenticated` + `GRANT SELECT` across the four tables is a small forward migration. Trigger: the next hardening pass.
- **S36-M2-PROD-PREFLIGHT** — the ceiling `VALIDATE`s abort a deploy if a live import, interview or distilled row is over its ceiling. Before the first production deploy run `SELECT count(*) … WHERE source='import' AND confidence > 0.60` (and the interview > 0.60 and distilled > 0.95 equivalents). Trigger: the first production deploy of migration `20260929120000`.
- **S36-WRITERCONFIDENCE-CAST-SCAN** — `WriterConfidence` is forgeable by `as`; the SQL ceiling CHECKs are the guard. A cast scan is a candidate. Trigger: the first cast found in review.
- **S36-IDENTIFIER-CHARSET** — the dismissal identifier charset admits an instruction-like member-chosen repo name (`ignore-previous/approve-all`). Accepted in ADR 0030 §7.1 step 5 (own tenant, confidence ≤ 0.50, neutralised and quoted at the read). Narrowing the bounds needs a migration and an ADR change. Trigger: a real tenant abuses it, or the bounds are revisited with the watched-source model.
- **S36-UX-UNVERIFIED-IN-BROWSER** — the L2.10 surfaces were verified by DOM and class assertions and measured contrast tokens only: no real browser, 200% zoom or screen-reader run. Trigger: the first browser-QA pass over the opportunities, interview, approvals and backfill surfaces. **Partly done, 2026-10-04 (Session 36-D QA):** the opportunities dismiss flow was run in a real browser (Chromium via Playwright) on the local stack at 1280, 640 (200% zoom equivalent) and 320 px: the hint shows the ruled English text only under not_relevant, is tied to the select by `aria-describedby`, sits inside the `role="status"` region, is gone under another reason, wraps to two lines at 640 px with no overflow, and a not_relevant dismissal wrote the expected `candidate` row (n=1, confidence 0.13). **Still open:** a screen-reader run; the interview, approvals and backfill surfaces; and pt/es rendering, which the browser could not show because of `QA-LOCALE-HEADER-DROPPED` (the pt and es copy is verified in the locale files only).

- **S36-FRESH-DB-RPC-ACL-AUDIT** — the same defect class (a SECURITY DEFINER function revoked `FROM public` only, so a fresh Supabase database leaves `anon` and `authenticated` with EXECUTE) may exist outside the memory writers; the W1 drift test covers only the registered memory RPCs. Audit every `SECURITY DEFINER` function in `public` on a FRESH database (`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`) and narrow each one that is not deliberately client-callable. **Before the first production deploy, run that query on the hosted project too**: this session found the three distilled RPCs failing it, and the hosted project's grants were not inspected. Trigger: before launch. Now a launch gate: launch-checklist.md section 2, Session 36-D D8.
- **S36-LOCAL-DB-NOT-FRESH** — the local development database is long-lived and its function ACLs differ from a fresh one's (its default ACL for functions in `public` omits `anon` and `authenticated`), so a local Tier-1 green does not prove a privilege property; only the `db-tests` job does. A periodic `supabase db reset --local` (which needs the user's permission) would surface this class earlier. Trigger: the next privilege-touching migration, or whenever a Tier-1 privilege test passes locally and fails in CI again.

**Not attributable to this session:** `S34-E2E-UNVERIFIED` is still open. A brief that "used no memory" on a real run must not be blamed on Session 36 until that smoke test has run.

## 4. Filed for visibility — no action intended

| ID | Item | Why it is here |
|----|------|----------------|
| **21B-member-roster** | Any co-member can read the full member roster via the API | A **locked ADR 0013 model property**, not a defect. Recorded so a future reviewer does not re-report it as a finding. |
| **22-NIT-3** | The `claude-mem` plugin appears to inject `<system-reminder>`-shaped text into subagent tool output | Not a Jemip code defect — `security-reviewer` correctly ignored it. Worth watching: a less careful agent could follow it. |

---

## 5. External / out of scope

Not ours to fix, but they block things that are.

| ID | Item | Impact |
|----|------|--------|
| **B18-027** | `npm run build` fails on ECC Remotion `tsc` errors | **Blocks B18-023 and B18-024** (the perf/CWV gates). Pre-existing ECC tooling issue, explicitly off-limits to a Builder session. Use `npm run dev` for local validation. |
| — | Email DNS/SMTP provisioning (Resend domain, SPF/DKIM/DMARC, Supabase SMTP relay) | Ops configuration, not code. |
| — | Stripe live-mode smoke tests A–F | Run at the live-flip, not as a code change. |

---

## 6. Closed — retained for audit

Struck-through IDs resolve historical references. Full closure evidence for the `B18-*` series was in
`session-18-triage.md`, now deleted; the correction-pass commits remain the authoritative record.

| ID | Description | Closed |
|----|-------------|--------|
| ~~S34-APPROVE-TO-GENERATE~~ | No production path took an approved brief to generated posts (`startGenerationAction` demanded `draft`, `generatePostsForCampaign` demanded `awaiting_brief`, `approveBriefAction` started nothing). Fixed with a separate Generate control on an approved brief plus a retry for a draft campaign whose brief failed; ADR 0027 §V.9 | K2.13 |
| ~~A4~~ | `suppressed` missing from `EmailProviderErrorCode` union | 18B-5 (B18-001) |
| ~~E5~~ | Email footer 13 px → 14 px (WCAG 1.4.4) | 18B-5 + 18B-5D (B18-002) |
| ~~L-05~~ | Atomic `WHERE status=` guard in `transitionEmailOutboxRow` | 18B-2 (B18-003) |
| ~~L-16-1~~ | Marketing skip-to-content i18n key in all 3 locales | 18B-5 (B18-004) |
| ~~S11A-cap~~ | `PLUS_CAMPAIGN_LIMIT` hardcoded → `getPlanCapabilities()` | 18B-3 (B18-010) |
| ~~21C-ci-gap~~ | No CI job ran the app-layer Vitest suite | Session 22 W1 — `app-tests.yml` |
| ~~21C-pg-oom~~ | CI Postgres OOM made the DB suite an unreliable gate | Session 22 W1 |
| ~~21C-bulk-platform~~ | Bulk approve could not honour a platform filter atomically | Session 22 W2 (A1) |
| ~~21C-dead-params~~ | `campaignId`/`platform` accepted but never passed | Session 22 W2 (A2) |
| ~~B18-085~~ | `formatISO` local-offset audit | Partial — 18B-5D; remainder is **B18-089** above |
| ~~B18-013~~ | `auth_rate_limits` TTL purge | N/A — already wired into `runJanitorTick` (Session 13 D16) |
| ~~B18-032~~ | AI rate-limit verification | N/A — wired and applied since Session 8 |
| ~~B18-044~~ | `vercel.json` cron comment | N/A — `vercel.json` is `{}`; QStash is the active trigger |
| ~~B18-082~~ | `post_metrics` RLS write over-grant | N/A — write policies dropped in migration `…016`; lockdown test added |
| ~~B18-030 / B18-070 / B18-071~~ | Error-cast cleanup, unsound cast in `RegenerateDialog`, PostCard null-metadata | 18B-3D correction pass |

---

## How an item leaves this file

1. **Fixed** — struck through in §6 with the closing session named.
2. **Trigger fired** — moves from §2 into §1, then gets scheduled.
3. **Superseded** — deleted with a one-line note saying what replaced it.
4. **Escalated to scope** — if it turns out to be a feature rather than debt, it moves to
   `pre-launch-scope.md` and is deleted here.
