# Session 27 Reviewer — Mode 3 Part 1: GitHub signal ingestion (ADR 0020)

**Reviewer:** independent review session, 2026-08-07. No file was modified by this review.

---

## Scope and commit range (PROC-REVIEW-AT-COMMIT)

**Scope reviewed: `97bb2b76^..5b5bbb9f`** — E2.1 `97bb2b76` … E2.11 `5b5bbb9f`, eleven commits, 60 files,
+8961/−3. **Every citation in this report is `git show <sha>:<path>` or `git diff` at that range, never
HEAD.**

Documents read **outside** the range, each named per the Session 22-F / NEW-12 exception:

| Artefact | Read at | Why outside the range |
|---|---|---|
| `docs/build-guide/session-27.md` | **working tree (untracked)** | The file exists at no commit — `git status` shows `?? docs/build-guide/session-27.md`. It cannot be read at any sha. |
| CI evidence (app-tests / db-tests) | **`7b4c94e7`** (range + 3) | No CI run at the range head is green — see MAJOR-1. |
| `docs/current-phase.md` (A-2 recording) | **`7b4c94e7`** | The A-2 entry landed three commits after the range head. |

`docs/decisions/0020-mode-3-signal-ingestion.md`, `docs/decisions/0010-legal-surface.md` and
`docs/build-guide/session-28.md` are **inside** the range and are read at `5b5bbb9f`.

Three commits exist after the range head and are **not** part of the audited artefacts: `3a4a5f7a`
(eslint scope annotation on a pre-existing `require()` in `github-client.test.ts`), `08a4c1e2`
(`GITHUB_APP_*` env vars added to both CI workflows), `7b4c94e7` (docs only). Their combined diff against
`5b5bbb9f` is 4 files, +102/−0, and touches **no production source**.

---

## SHARED-FUNCTION CALLERS (H4)

Every table below is my own `git grep` at `5b5bbb9f`, not an inheritance of ADR §11.5's rows.

### (a) `signOAuthState` / `verifyOAuthState` — the ADR's original premise was **false**, and the Builder caught it

| Function | Caller | Test covering that caller |
|---|---|---|
| `signOAuthState` | `app/api/social/[platform]/connect/route.ts:52` (pre-existing, unchanged) | `connect.test.ts` + `lib/social/__tests__/oauth-state.test.ts` |
| `verifyOAuthState` | `app/api/social/[platform]/callback/route.ts:52` (pre-existing, unchanged) | `callback.test.ts` + `lib/social/__tests__/oauth-state.test.ts` |

**Session 27 added ZERO callers to this pair.** It built a separate, non-shared pair —
`signGithubConnectState` / `verifyGithubConnectState` in `lib/signals/state.ts` — mirroring the shape
(same `jose` HS256 mechanism, same `OAUTH_STATE_SECRET`) without calling into it.

**The Builder did re-grep, as §11.5 instructed.** ADR §11.5:1226-1249 records the correction explicitly,
states the original premise was *"wrong, not merely stale"*, and republishes the table. My independent
re-grep confirms every claim in it. ✅ This is the SHARED-FUNCTION CALLERS discipline working as designed.

| Session 27's own pair | Caller | Test |
|---|---|---|
| `signGithubConnectState` | `settings/signals/actions.ts:67` | `settings/signals/actions.test.ts` |
| `verifyGithubConnectState` | `api/signals/github/callback/route.ts:74` | `callback.test.ts` |

### (b) `neutralizeWithSentinels` — ✅ both callers covered

| Caller | Test covering that caller |
|---|---|
| `lib/studio/guard.ts:94` and `:123` (pre-existing) | `lib/studio/guard.test.ts`, `markers.test.ts`, `studio/actions.test.ts` |
| **`wrapSignalForPrompt` — `lib/ai/wrap-evidence.ts:245-246` (NEW)** | `lib/ai/wrap-evidence.test.ts:169-197` — four cases (chokepoint, injection payload, fenced content, over-cap) |

### (c) `getBusinessById` / `canServer` — ✅ new callers covered

`getBusinessById` — 7 call sites; the **new** one is `api/signals/github/callback/route.ts:118`.

| Caller | Test |
|---|---|
| **`api/signals/github/callback/route.ts:118` (NEW)** | `callback.test.ts` |
| `api/social/[platform]/callback/route.ts:69` | `callback.test.ts` |
| `lib/ai/context.ts:56` | `lib/ai/context.test.ts` |
| `lib/email/triggers/stripe.ts:21` | `__tests__/stripe.test.ts` |
| `lib/members/invite-preview.ts:35` | `invite-preview.test.ts` |
| `lib/publishing/orchestrator.ts:184` | `orchestrator.test.ts` |
| `lib/stripe/checkout.ts:29,80` | `checkout.test.ts` |

`canServer` — 3 caller files; the **new** ones are the signals surface and the install callback.

| Caller | Test |
|---|---|
| **`settings/signals/actions.ts:63,107,135,185,211,246` (NEW — 6 sites, all `CONNECT_ACCOUNTS`)** | `settings/signals/actions.test.ts` |
| **`api/signals/github/callback/route.ts:127` (NEW)** | `callback.test.ts:194` |
| `campaigns/page.tsx:33` | `lib/members/can-server.test.ts` |
| `settings/team/actions.ts:101,160,186,213` | `settings/team/actions.test.ts` |

### (d) `verifyQStashRequest` — ⚠️ **the new caller has NO test** (MAJOR-2)

| Caller | Test covering that caller |
|---|---|
| `api/cron/capture-learning/route.ts:13` | `capture-learning/route.test.ts` |
| `api/cron/drain-email-outbox/route.ts:14` | `__tests__/route.test.ts` |
| `api/cron/publish/route.ts:15` | `publish/route.test.ts` |
| `api/cron/sync-metrics/route.ts:14` | `sync-metrics/route.test.ts` |
| `api/cron/trial-warnings/route.ts:14` | `__tests__/route.test.ts` |
| `api/cron/process-deletions/route.ts:14` | **none** — pre-existing gap, out of this range's scope |
| **`api/cron/signals-poll/route.ts:16` (NEW, this range)** | **NONE** |

`git ls-tree 5b5bbb9f -- app/api/cron/signals-poll` returns exactly one file: `route.ts`. See MAJOR-2.

---

## Check table

### Section A — Schema, RLS, cascade, erasure

| Check | Status | File:Line | Note |
|---|---|---|---|
| A1 RLS enabled ×4, InitPlan form | ✅ | `20260731090000_signal_ingestion.sql:257-296` | All policies use `= ANY (SELECT unnest(public.get_user_business_ids()))`. No bare unwrapped call anywhere. |
| A1 WITH CHECK on every INSERT/UPDATE | ✅ | `:278-285` | One UPDATE policy exists (`watched_repos_update_own`); it has **both** USING and WITH CHECK. Tunnelling closed. |
| A1 Cross-tenant denied, both directions, live PG | ✅ | `signals-schema.test.ts:151-205` | Eight cases — A→B and B→A per table, each under a real `signInWithPassword` session, not a service-role read. Session 26-D MINOR-2 satisfied. |
| A1 Tunnelling proved | ✅ | `signals-schema.test.ts:209-233` | `.update({business_id: B})` on own row → zero rows; admin re-read confirms unchanged. Plus the USING arm at `:222`. |
| A2 No DELETE policy on `watched_repos`, + GRANT | ✅ | `:271-273`, `:307-308` | `REVOKE ALL` then `GRANT SELECT, INSERT, UPDATE` — no DELETE at either layer. Proved at `signals-schema.test.ts:235-247`. |
| A3 `business_id` NOT NULL CASCADE ×4 | ✅ | `:18`, `:54`, `:87`, `:168` | |
| A3 No BEFORE DELETE trigger | ✅ | `:192-201` | Repo-wide grep at `5b5bbb9f` returns only explanatory comments. Four triggers exist, all BEFORE UPDATE. |
| A3 `purge_business` unedited | ✅ | `20260702120700…:62` | Migration references none of the four tables. |
| A3 Delete + purge each SUCCEED, executed | ✅ | `signals-schema.test.ts:539-565`, `:567-591` | `expect(deleteErr).toBeNull()` / `expect(purgeErr).toBeNull()` **precede** the rows-are-gone loops. Correct ordering. |
| A4 Four §D2.5 cascade rows, five-column, with clauses | ✅ | `0010-legal-surface.md:1080-1083` | Carries *"no Vault secret exists to delete"* (github_connections) and *"contributor identity fields are never stored, ADR 0020 §5.3"* (signals). |
| A5 Identity trigger raises / permits | ✅ | `:132-162`; `signals-schema.test.ts:481-507` | **Both arms** tested: raises on `external_id` and `business_id`; permits title/body and recomputes `content_hash`. |
| A6 §3.6 indexes exist incl. the two bare FKs | ✅ | `:211-232` | `watched_repos_connection_id_idx`, `signals_watched_repo_id_idx` both present ([db-BLOCKER-C] shipped). |
| A6 Every list ORDER BY matches an index exactly | ⚠️ | `lib/db/signals.ts:45-61`, `lib/db/watched-repos.ts:52-69` | Two exceptions — MINOR-1, MINOR-2. |
| A7 `occurred_at` denormalised; feed index-satisfied | ✅ | `:172-177`, `signal_candidates_feed_idx :230-232` | Ordering references only `signal_candidates` columns; the join to `signals` is display-only. Single-index match confirmed. |
| A8 No `vault_*_token_id`; tripwire comment present | ✅ | `:36-44` | |
| A8 `status` CHECK IN ('new') only | ✅ | `:181` | |
| A8 No `campaigns.origin` change; no webhook secret | ✅ | range diff | Neither appears. |

### Section B — The credential model

| Check | Status | File:Line | Note |
|---|---|---|---|
| B1 No token at rest (re-derived) | ✅ | `github-client.ts`, `route.ts:148-175`, `actions.ts:256-257` | Grep of every added line in the range: no token to a table, cookie, cache, log, Sentry extra, or client-bound value. No token column exists to write to. |
| B2 `GITHUB_APP_PRIVATE_KEY` parse-time refine | ✅ | `lib/config.ts:112-122` | Decodes base64, regex-checks PEM header. Rejection genuinely exercised: `lib/config.test.ts:72-100` — truncated base64, non-base64, valid-base64-non-PEM, all asserting `success === false`. |
| B3 No `process.env.GITHUB` outside config, per-root guard | ✅ | `source-scans.test.ts:136-155` | Per-root guard at `:141-143`. |
| B4 Zero writes against api.github.com | ✅ | `github-client.ts` | Five calls enumerated: 4 GET + `POST /login/oauth/access_token` (OAuth exchange, github.com not api.github.com) + the App-auth `POST …/access_tokens` internal to `createAppAuth`. No content write. See NIT-3. |
| B5 Disconnect atomic, signals retained, structural exclusion | ✅ | `github-connections.ts:103-118`; `actions.ts:87-113` | Conditional UPDATE guarded on `is_active = true`. Poller exclusion is the claim query's `.eq('is_active', true)` at `:52`, not a loop branch. |
| B5 No uninstall API call | ✅ | `github-client.ts` | No such client function exists to call. |
| B6 Disconnect copy is truthful | ✅ | `i18n/en/signals.json` `disconnect.*` | *"It does not revoke GitHub's access."* / *"To fully revoke access, uninstall the SOSH app…"* Correct disclosure of the weaker `is_active` semantics. |
| B7 401/404 auto-deactivates within one tick | ✅ | `orchestrator.ts:141-147`; `orchestrator.test.ts:181-205`, `:426` | Fixture cases for 401-on-mint, 404-on-mint, and 401-mid-fetch. |

### Section C — The install callback

| Check | Status | File:Line | Note |
|---|---|---|---|
| C1 Ownership proof (attack re-derived) | ✅ | `route.ts:162-185` | See VERDICT Q1 for the full trace. Conditional on `installations.find(...)`, uses a **user token**, runs **before** the write. |
| C2 Business only from signed state; userId bound | ✅ | `route.ts:92,118`; `:112-114`; `state.ts:19-23` | No `searchParams.get('business…')` anywhere in the file. |
| C3 Nonce httpOnly/Lax/300s/single-use/cleared | ✅ | `actions.ts:74-80`; `route.ts:51-54` | Cleared on all post-step-3 exit paths. Replay ≡ missing (`callback.test.ts:156-164`). |
| C3 Nonce not conflated with the ownership proof | ✅ | `route.ts:11-19`, `:156-161` | The code explicitly names step 9 as *"the ONLY check in this file that proves ownership rather than mere existence"*. No misunderstanding to propagate into Session 28. |
| C4 `setup_action='request'` writes nothing | ✅ | `route.ts:137-139`; `callback.test.ts:166-173` | Distinct `awaiting_approval=1` screen; `exchangeUserCode` and the upsert both un-called. |
| C4 `'update'` and unexpected values safe | ✅ | `route.ts:140-142`; `:36` | Unexpected values never reach the branch — `z.enum` rejects at step 1. Fail-closed at the schema. |
| C5 Cross-workspace conflict is typed | ✅ | `github-connections.ts:169-186`; `signals-schema.test.ts:279-314` | 23505 → `{status:'conflict'}`; squatting arm proved on live Postgres. |
| C6 Expired session writes nothing, preserves `next` | ✅ | `route.ts:101-110`; `callback.test.ts:175-182` | |
| C7 `canServer(CONNECT_ACCOUNTS)` on all seven entry points | ✅ | `route.ts:127`; `actions.ts:63,107,135,185,211,246` | Positioned as the authoritative gate (comment at `route.ts:123-126` names the 21B precedent). |
| C7 No new capability added | ✅ | `lib/members/capabilities.ts:12` | `CONNECT_ACCOUNTS` reused verbatim. No migration, no ADR 0013 amendment. |
| C8 Zod on every param; §11.2 matrix executed | ✅ | `callback.test.ts:126-201` | Nine rejection cases, each a distinct `it()`. |

### Section D — The poller

| Check | Status | File:Line | Note |
|---|---|---|---|
| D1 Failure isolation (re-derived) | ✅ | `orchestrator.ts:314-325` | Per-connection try/catch **inside** the loop; `summary.failed++` + Sentry, loop continues. Proved at `orchestrator.test.ts:158`. |
| D1 §4.5 row by row, each operator-visible | ✅ | see below | All six rows have a counter; four also have a state change or Sentry. |
| D1 Uncounted skips | ⚠️ | `orchestrator.ts` `skipped_draft` / 90-day cutoff | MINOR-5. |
| D2 Idempotency is the index, not SELECT-then-INSERT | ✅ | `lib/db/signals.ts:98-108` | Plain `.insert()`; `23505` → `{status:'duplicate'}`, counted as `duplicates`, never an error. The in-memory map is explicitly a pre-filter, not the arbiter. |
| D2 Complementarity claim holds | ✅ | `orchestrator.ts:281-290`; `github-connections.ts:66-80` | The claim (not the index) is what serialises `releases_etag` writes — two overlapping ticks cannot both claim the same connection. |
| D3 Claim atomic, bounded, index-matching | ✅ | `github-connections.ts:66-80`, `:45-59` | `.eq('is_active',true).or(…)` re-guards the same window; `signals-schema.test.ts:326` proves exactly-once under concurrency. |
| D3 Separate started/completed columns | ✅ | `:28-31` | [db-MODERATE-B-iii] shipped. |
| D4 ETag not a `since` cursor; 304 short-circuits | ✅ | `github-client.ts:135-166`; `orchestrator.ts:214-220` | 304 intercepted before body parse; `notModified++`, **no writes at all**. Proved at `orchestrator.test.ts:319`. |
| D4 30-most-recent bound recorded as a decision | ✅ | ADR §4.4:525, §14:1342 | *"edits to releases older than the 30 most…"* — stated, not silently absent. |
| D5 Exactly one `console.log` | ✅ | `orchestrator.ts` tick line | Two `console.warn` exist in the poller route — byte-identical to `capture-learning/route.ts`'s established house pattern, on the auth-rejection path where no tick runs. Not a new exception. |
| D5 No `console.*` on the user-facing surface | ✅ | range grep | |
| D6 Untrusted body never logged | ✅ | `orchestrator.ts:236-243`; `parse-release.ts:107` | Sentry gets `repo_id`, `business_id`, and `issues` — where `issues` is `result.error.issues.map(i => i.message)`, taking **only** `.message`, not the full issue object (which carries `received`). The schema has no `z.enum`/`z.literal`, so no Zod message can embed an untrusted value. Deliberately correct narrowing. |

**§4.5 row-by-row (D1):**

| §4.5 row | Code path | Operator-visible counterpart |
|---|---|---|
| 401 on mint (revoked) | `orchestrator.ts:141-146` | `deactivateGithubConnection` + `revoked++` + Sentry + UI reconnect state |
| 404 on mint (installation gone) | same branch | as above (documented as operationally identical) |
| 403 + Retry-After (rate limited) | `:148-155` | `recordGithubConnectionRateLimited` + `rateLimited++` + UI rate-limited state |
| 5xx / unclassified (transient) | `:157-159`, `:287-289` | `failed++` in the tick line. No Sentry — acceptable: it is counted and the containment is "retry next tick". |
| 404 on repo fetch | `:270-274` | `deactivateWatchedRepo` + `notFound++` + UI repo-unavailable state |
| Malformed release | `:236-244` | `malformed++` + Sentry (repo id only) |

No row is a bare `continue`. The two uncounted `continue`s (MINOR-5) are **not** §4.5 rows.

### Section E — Stage B

| Check | Status | File:Line | Note |
|---|---|---|---|
| E1 `now` is a parameter | ✅ | `score.ts:69` | `export function scoreSignal(input: ScorableSignal, now: Date)`. No clock read inside. Asserted at `score.test.ts:81`. |
| E2 Formula matches §6.1 term for term | ✅ | `score.ts:70-86` | recency/substance/kindWeight/repoWeight/humanAuthored, each persisted in `score_inputs`. |
| E2 Total order, ties impossible | ⚠️ | `score.ts:94-105` vs `signal_candidates_feed_idx` | MINOR-4 — two divergent third keys. |
| E3 Determinism tested with a **shuffled** copy | ✅ | `score.test.ts:112-118` | Fixed permutation, not `Math.random()` — order-independence genuinely proved, not just repeat-run. |
| E4 Bots scored down, not filtered | ✅ | `score.ts:81`; `score.test.ts:53` | `humanAuthored = isBot ? 0 : 5`; never zeroes the total. |
| E5 Guarded upsert + live-PG race | ✅ | `20260806090000…:29-40`; `signals-schema.test.ts:409-479` | Positive control (`status='new'` updates) **and** the negative (`status` transitioned out of `'new'` → no resurrection). Both on live Postgres. |
| E6 No embeddings / pgvector / LLM, incl. transitively | ✅ | see VERDICT Q4 | |
| E7 One candidate per signal; clustering deferral | ✅ | `UNIQUE (signal_id) :183`; ADR §6.5 | Proved at `signals-schema.test.ts:316`. |

### Section F — Untrusted text and the types

| Check | Status | File:Line | Note |
|---|---|---|---|
| F1 Non-exported `unique symbol` on both brands | ✅ | `lib/db/types.ts:47-48`; `lib/ai/wrap-evidence.ts:199-200` | Module-private `const … : unique symbol`. The strong form. |
| F2 `RenderedEvidence` NOT reused | ✅ | `wrap-evidence.ts:184-198` | Separate `RenderedSignalText`, with the reason documented: `RenderedEvidence`'s guarantee is re-fetch-and-rescope, which `wrapSignalForPrompt` (no `client`, no `businessId` params) cannot satisfy. No false provenance baked into a type. |
| F3 Sink narrowing on parameters | ✅ | `wrap-evidence.ts:238-241`; `types.ts:510-511`; `signals.ts:117-121` | |
| F4 **Honesty check** | ✅ | `types.ts:38-46`; `wrap-evidence.ts:229-237` | **No overclaim anywhere.** Both declarations carry a "THE HONEST LIMIT" block stating that `string & brand` is assignable to any bare `string` parameter and to any template-literal hole, that a bare cast stays compile-legal, and that the residual is closed **by the source scans, not the type system**. Both add *"Do not restate this guarantee more strongly than the ADR does."* The Sessions 24/25 failure mode is not repeated. |
| F5 `wrapSignalForPrompt` reuses `neutralizeWithSentinels`; no sixth sanitizer | ✅ | `wrap-evidence.ts:245-246`; `no-sixth-sanitizer.test.ts`; `source-scans.test.ts:97-107` | Five existing copies unchanged. |
| F6 `lib/db/` returns the branded row type | ✅ | `signals.ts:18-20`; `signal-candidates.ts:29-49` | Brand originates at the data-access boundary in both directions; callers never mint ad hoc. |
| F7 `@ts-expect-error` proof is genuine | ✅ | `wrap-evidence.test.ts:214-249` | Passes `UntrustedText` where `RenderedSignalText` is required — fails for **brand mismatch**, not arity/import. Stronger still: the two adjacent cases that MUST compile (template hole, bare cast) are asserted **without** `@ts-expect-error`, so the stated limit is *proved*, not merely commented. |

### Section G — Scope, privacy and process

| Check | Status | File:Line | Note |
|---|---|---|---|
| G1 Nothing out of scope shipped | ✅ | range diff | No Stage C-F, no insight-card table, no expiry policy, no cost ceiling, no `ai_usage` write, no external source, no embeddings, no webhook route/secret, no plan gating, no status beyond `'new'`, no `campaigns.origin` change. |
| G2 Contributor identity absent **structurally** | ✅ | `parse-release.ts:57-63`; `parse-release.test.ts:37-47` | `ParsedSignal = Omit<SignalInsert, …>` — the ten fields have no home on the type, so they cannot be produced. The test asserts each of the ten absent from the parsed object. Not a runtime filter. |
| G3 A-3: no retention period in customer-facing copy | ✅ | `i18n/{en,pt,es}/signals.json` | My own grep for retain/retention/N-days/months/years across all three: zero hits. Enforced going forward by `signals-i18n.test.ts`'s scan. |
| G4 A-2 launch-blocking condition recorded | ⚠️ | `current-phase.md:67-75` **at `7b4c94e7`** | Content is correct and complete (Evidence Pack entry, Art. 6(1)(f) balancing test, `/privacy` prose, all three named as unlanded, binding on launch). But it landed **outside the audited range** — MINOR-7. |
| G5 CLAUDE.md `lib/signals/` rule in the same sentence shape | ✅ | `CLAUDE.md` +4 lines in range | |
| G5 `lib/social/**` zero diff | ✅ | range diffstat | SocialProvider untouched. |
| G6 Every folded-in `[db-*]`/`[sec-*]`/`[type-*]` shipped | ✅ | see below | Walked; all landed. |
| G7 One step, one commit; types before parser | ✅ | `git log` | E2.4 (`efa71426`, brands) precedes E2.5 (`0d4e1802`, parser). **No commit range exists in which signal text is unbranded.** |
| G8 No `any`; service-role unreachable from components; `formatISO`; Zod; i18n ×3 registered | ✅ | `i18n/request.ts` +4 | All service-role acquisition uses the lazy-import pattern. |
| G9 ECC budget | ✅ | commit messages | E2.1 database-reviewer, E2.4/E2.10 type work, E2.8 security-reviewer — within six, no evidence of an agent re-consulted to re-litigate a folded objection. |

**G6 — folded-in findings, walked:**

| Finding | Shipped? | Evidence |
|---|---|---|
| `[db-BLOCKER]` UNIQUE (signal_id) arbiter | ✅ | `:183` |
| `[db-BLOCKER-C]` bare FK indexes ×2 | ✅ | `:215-220` |
| `[db-MAJOR-C]` `occurred_at` denormalised | ✅ | `:172-177` |
| `[db-MAJOR-D]` no DELETE policy on `watched_repos` | ✅ | `:271-273` + `signals-schema.test.ts:235` |
| `[db-MODERATE-B-iii]` split poll stamps | ✅ | `:28-31` |
| `[db-MODERATE]` no `vault_*_token_id`, stated | ✅ | `:36-44` |
| `[db-MINOR]` enum-hardening CHECKs on `source`/`kind`/`length(body)` | ✅ | `:89-99` |
| `[db-D]` REVOKE + narrow GRANT per table | ✅ | `:304-314` |
| `[sec-BLOCKER-1]` tenant binding | ✅ | `route.ts:162-175` |
| `[sec-HIGH-2]` `setup_action='request'` | ✅ | `route.ts:137-139` |
| `[sec-HIGH-3]` truthful disconnect copy | ✅ | `i18n/en/signals.json` `disconnect.*` |
| `[sec-MEDIUM-5]` parse-time private-key refine | ✅ | `config.ts:112-122` |
| `[sec-MEDIUM-6]` no sixth sanitizer | ✅ | `no-sixth-sanitizer.test.ts` |
| `[sec-MEDIUM-7]` state binds userId | ✅ | `route.ts:112-114` |
| `[sec-LOW-9]` multibyte-safe truncation, cap as cost control | ✅ | `parse-release.ts:83-96` |
| `[type-a]` brand is a label of known origin, stated | ✅ | ADR §7.3:801-807 |
| `[type-§6]` sink narrowing + honest limit | ✅ | `types.ts:38-46` |

---

## Findings

### BLOCKER

**None.** All five questions this track exists to settle answer in the safe direction, each with executed
proof (see VERDICT).

### MAJOR

**MAJOR-1 — The audited range head never executed green in CI.**
At `5b5bbb9f` (the range head) **both** jobs failed: app-tests `31116039392`, db-tests `31116038037`. The
green runs are at `7b4c94e7`, three commits later. The intervening delta is 4 files / +102 / −0 and touches
no production source, so the constraints are **not** AUTHORED-NOT-EXECUTED — but the audited range itself
has no green CI evidence, and one file *inside* the range (`lib/signals/github-client.test.ts`) is not
byte-identical to what CI executed.

*Fix:* Either (a) record in `docs/current-phase.md` and in ADR 0020 §11 that the executing SHA for Session
27 is `7b4c94e7`, with the 4-file delta enumerated and its non-behavioural character stated, so a future
reader is not misled by the E2.11 commit subject; or (b) re-run both workflows against a SHA whose tree
equals the range head plus only the workflow YAMLs, and cite that. (a) is sufficient and cheaper.

**MAJOR-2 — `app/api/cron/signals-poll/route.ts` has zero test coverage; the new `verifyQStashRequest`
caller is unaudited.**
`git ls-tree 5b5bbb9f -- app/api/cron/signals-poll` returns only `route.ts`. Every other cron route that
calls `verifyQStashRequest` has a sibling `route.test.ts`. Unexercised here: the qstash-mode verification
path, the `CRON_SECRET` `timingSafeEqual` bearer fallback, the dev `x-cron-dev-trigger` bypass, the
405 method guards, and the `cron-auth-failure` warn line. `runSignalsTick` is well tested at
`lib/signals/orchestrator.test.ts` — but that is the *orchestrator*, not the route. This is precisely the
SHARED-FUNCTION CALLERS shape that produced both Session 22 blockers: one caller proven is not the function
proven.

*Fix:* Add `app/api/cron/signals-poll/route.test.ts` modelled on
`app/api/cron/capture-learning/route.test.ts`, covering at minimum: qstash mode rejects an unsigned request
with 401 and never calls `runSignalsTick`; secret mode rejects a wrong bearer with 401; secret mode accepts
the correct bearer; `GET` is 405 in qstash mode and `POST` is 405 in secret mode. Then add the row to ADR
§11.5's `verifyQStashRequest` table.

**MAJOR-3 — The five `GITHUB_APP_*` variables are unconditionally required at parse time, so every
environment lacking them fails to boot.**
`lib/config.ts:105-124` declares all five as `z.string().min(1)` inside `serverSchema`, with no
`superRefine` conditioning. `parseServerEnv()` runs on first `config.server.*` access, so **any** deployment
or CI job without all five throws. This is not hypothetical: it is exactly what reddened both jobs at the
range head, and it was fixed only at `08a4c1e2` — *outside the audited range* — by adding the vars to two
workflow YAMLs. Contrast the established pattern for optional subsystems: `QSTASH_CURRENT_SIGNING_KEY` /
`QSTASH_NEXT_SIGNING_KEY` are required **only** when `CRON_TRIGGER === 'qstash'` *and*
`NODE_ENV === 'production'` (`config.ts:125-136`), and `RESEND_API_KEY` likewise. Signal ingestion is an
opt-in feature no existing tenant uses; making its credentials a hard boot requirement couples every
unrelated environment to it.

*Fix:* Move the five `GITHUB_APP_*` variables to the same conditional shape — declare them
`.optional()` in the schema and add a `superRefine` requiring all five only when
`NODE_ENV === 'production'` (or behind an explicit `SIGNALS_ENABLED` flag, if one is wanted). Keep the
`.refine()` PEM validation attached to the value so it still fires whenever the variable *is* present —
`[sec-MEDIUM-5]`'s fail-fast contract must survive the change. Add a `lib/config.test.ts` case asserting a
non-production parse succeeds with all five absent, and that a production parse fails.

### MINOR

**MINOR-1 — `listSignalsForWatchedRepo`'s ORDER BY is not index-served and has no `id` tiebreak.**
`lib/db/signals.ts:45-61` filters `watched_repo_id, business_id`, orders `occurred_at DESC`, limit 50. The
comment at `:43-44` claims it *"matches `signals_watched_repo_id_idx` (watched_repo_id) EXACTLY"* — that
index is single-column and cannot serve the sort. Unlike every other ordered query in the file, it also
omits a trailing `id`, so rows at identical `occurred_at` are returned in non-deterministic order.
*Fix:* add `.order('id', { ascending: true })` and correct the comment to say the index serves the filter,
not the sort. (Independently found by both this reviewer and `database-reviewer`.)

**MINOR-2 — `listActiveWatchedReposForConnection`'s ORDER BY is not index-covered.**
`lib/db/watched-repos.ts:52-69` filters `connection_id, business_id, is_active`, orders `id ASC`, limit 20.
`watched_repos_connection_id_idx` is `(connection_id)` only, so `is_active` and the sort are not covered.
Low practical impact behind the 20-row cap; the comment at `:48-51` overstates the match.
*Fix:* correct the comment, or widen the index to `(connection_id, is_active, id)`.

**MINOR-3 — Dead exports, and a comment citing the wrong function.**
`upsertSignal` (`lib/db/signals.ts:72`) has no production caller — only its own test. `scoreAndSortSignals`
and `sortScoredSignals` (`score.ts:94-101`) likewise: the orchestrator calls `scoreSignal` per-signal and
never sorts. Worse, `score.ts:111` documents the edit path as *"the caller re-writes signals' content
columns first (lib/db/signals.ts's `upsertSignal`…)"* — the orchestrator actually calls
`updateSignalContent` (`orchestrator.ts:120`). A reader tracing the edit path is sent to a function that
never runs.
*Fix:* correct the `score.ts:111` citation to `updateSignalContent`. Either delete `upsertSignal` /
`scoreAndSortSignals` / `sortScoredSignals`, or annotate each as a Session 28 entry point with the ADR
section that will consume it.

**MINOR-4 — Two divergent "total orders" are both declared authoritative.**
`sortScoredSignals` (`score.ts:94-105`) breaks ties on `external_id ASC`; the DB feed contract (§13.1) and
`signal_candidates_feed_idx` break on `id ASC`. Both are deterministic, but they can order an exact tie
differently. Currently harmless only because the in-memory sorter is unused (MINOR-3).
*Fix:* state in `score.ts` that `sortScoredSignals` is a scoring-side utility whose order is *not* the feed
order, and that §13.1's `id ASC` is authoritative for anything read from `signal_candidates` — or align the
two.

**MINOR-5 — Two skip paths in the poller are invisible to the operator.**
`orchestrator.ts`: `if (parsed.status === 'skipped_draft') continue` and the 90-day first-poll cutoff
`continue` both increment nothing. A repo publishing only drafts is indistinguishable in the tick line from
a repo publishing nothing, and a first poll that discards 200 old releases reports no trace of it. Note
this is **ADR-conformant** — §4.6's field list (`:554-556`) itself omits both — so it is a design gap, not
a Builder deviation.
*Fix:* add `skippedDraft` and `skippedPreCutoff` counters to `SignalsTickSummary`, emit them in the tick
line, and add the two field names to ADR §4.6's list. Extend `orchestrator.test.ts:138`'s field-presence
assertion.

**MINOR-6 — `rate_limited_until` is written but never read by the poller.**
`recordGithubConnectionRateLimited` (`github-connections.ts:120-145`) persists it, but
`listConnectionsReadyForPoll` (`:45-59`) filters only on `is_active` and `last_poll_started_at`. A
rate-limited connection is therefore re-claimed and re-minted on the very next tick, guaranteed to 403
again. The comment at `:128-134` records this as accepted ("harmless… counted again"), so it is a
documented decision, not a silent bug — but the column is currently decorative outside the UI, and
retrying inside a known-active rate limit is what backoff exists to prevent.
*Fix:* either add a `rate_limited_until` predicate to the claim list, or amend the comment to state
explicitly that `rate_limited_until` is a **UI-only** field with no poller effect, so a future reader does
not assume backoff exists.

**MINOR-7 — A-2's launch-blocking condition was recorded outside the audited range.**
`docs/current-phase.md:67-75` at `7b4c94e7` is correct and complete, but `docs/current-phase.md` does not
appear in `97bb2b76^..5b5bbb9f`. Within the audited range, the mandatory A-2 recording is absent.
*Fix:* none to the content — note the recording SHA alongside the MAJOR-1 correction so the two are
resolved together.

### NIT

**NIT-1** — `lib/config.ts:114-118`: `Buffer.from(val, 'base64')` never throws on malformed input (Node
silently discards invalid characters), so the `try/catch` is unreachable. Rejection is carried entirely by
the PEM regex at `:119`, which is correct. Harmless; remove the dead `try/catch` or comment why it is
defensive.

**NIT-2** — `app/api/cron/signals-poll/route.ts:63-67`: the `try/catch` around `runSignalsTick` is
near-dead — `runSignalsTick` wraps its own body in `try/catch` and returns a summary rather than throwing.
Mirrors `capture-learning`, so it is house-consistent; noting only so it is not mistaken for live error
handling.

**NIT-3** — `mintInstallationToken` issues `POST /app/installations/{id}/access_tokens`, technically a
non-GET verb against `api.github.com`. It mints a credential, not a write against customer content, so it
does not contradict L-5 — but a future reviewer scanning for "any non-GET against api.github.com" should
know this one legitimate exception exists.

**NIT-4** — `parse-release.ts:44-55` records that `tag_name` is listed in §5.3 as retained but has no
`signals` column to receive it. Self-documented drift; carry it into ADR 0021's scope explicitly so it is
not rediscovered.

**NIT-5** — `lib/db/types.ts:23`: `VaultSecretId` still uses the weaker string-literal brand
(`_brand: 'VaultSecretId'`) that the new `UntrustedText` comments argue against. Pre-existing, outside this
range's scope; flagged only if a future session touches vault-adjacent types.

**NIT-6 (process, not code)** — Both the `database-reviewer` and `security-reviewer` sub-agents
independently reported that every `Read` tool result in their sessions carried appended text advertising
tools outside their toolset and offering cached "observations" in place of reading the real files. Both
correctly disregarded it and read every file directly. This is working as it should, but the pattern is
worth knowing about: an agent that *followed* it would review paraphrases instead of source. Worth a note
in the OpenWolf/claude-mem configuration.

---

## Constraint coverage (H1, H2, H5)

**Executing jobs** — `db-tests` and `app-tests`, both at `7b4c94e7` (MAJOR-1):
- db-tests **[31119937379](https://github.com/tcr430/SOSH/actions/runs/31119937379)** — skip-guard's own
  line: `skip-guard: 24 file(s) under [supabase/__tests__] all visible, zero failures — green.
  (240/240 tests passed)` → **24 files / 240 tests** (H3).
- app-tests **[31119937068](https://github.com/tcr430/SOSH/actions/runs/31119937068)** —
  `192 file(s) under [app, lib, components] … (2640/2640 tests passed)`.

**H3 promotion tally:** both runs are `event: pull_request` on branch `session-22-d`. ADR 0015 §5 counts
full-green runs **on `master`**, so this range contributes **nothing** to the three-green tally. It stands
at **0 of 3**, unchanged since Session 26-D.

| # | Constraint | Tier | Test | CI job | Reddens if broken? |
|---|---|---|---|---|---|
| 1 | `SIGNAL-NO-LLM-IN-STAGE-AB` | 2 scan | `source-scans.test.ts:62` | app-tests | ✅ per-root guard `:63-65`; demonstrated red at E2.10 |
| 2 | `SIGNAL-READ-ONLY-GITHUB` | 3 | §11.4 bullet 1 | — (decision) | n/a — recorded |
| 3 | `SIGNAL-INGEST-IDEMPOTENT` | 1+2 | `signals-schema.test.ts:251`; `orchestrator.test.ts:358` | db+app | ✅ 23505 asserted directly |
| 4 | `SIGNAL-FAILURE-ISOLATED` | 2 | `orchestrator.test.ts:158,181-316` | app-tests | ✅ per-row fixtures |
| 5 | `SIGNAL-SCORING-DETERMINISTIC` | 2 | `score.test.ts:106,112` | app-tests | ✅ shuffled + repeat |
| 6 | `SIGNAL-DEDUP-STABLE-ON-EDIT` | 1+2 | `signals-schema.test.ts:423`; `parse-release.test.ts:94` | db+app | ✅ live-PG resurrection case |
| 7 | `SIGNAL-RLS-ISOLATED` | 1 | `signals-schema.test.ts:151-233` | db-tests | ✅ 8 mirrored + 2 tunnelling |
| 8 | `SIGNAL-CASCADE-COMPLETE` | 1 | `:539` | db-tests | ✅ asserts delete SUCCEEDS first |
| 9 | `SIGNAL-PURGE-COVERED` | 1 | `:567` | db-tests | ✅ asserts purge SUCCEEDS first |
| 10 | `SIGNAL-RAW-TEXT-UNTRUSTED` | 2 | `parse-release.test.ts:121,126`; `wrap-evidence.test.ts:169` | app-tests | ✅ compile + runtime |
| 11 | `SIGNAL-PROMPT-SINK-NARROWED` | 2 | `wrap-evidence.test.ts:214`; `source-scans.test.ts:174` | app-tests | ✅ per-root guard `:184-186` |
| 12 | `SIGNAL-NO-SIXTH-SANITIZER` | 2 scan | `source-scans.test.ts:97`; `no-sixth-sanitizer.test.ts` | app-tests | ✅ per-root guard |
| 13 | `SIGNAL-CALLBACK-TENANT-BOUND` | 1+2 | `callback.test.ts:117`; `signals-schema.test.ts:279` | db+app | ✅ asserts upsert never called |
| 14 | `SIGNAL-CALLBACK-VALIDATED` | 2 | `callback.test.ts:126-201` | app-tests | ✅ nine cases |
| 15 | `SIGNAL-CAPABILITY-GATED` | 2 | `callback.test.ts:194`; `actions.test.ts` ×6 | app-tests | ✅ all seven sites |
| 16 | `SIGNAL-NO-PROVIDER-COUPLING` | 3+2 | `source-scans.test.ts:114`; §11.4 bullet 3 | app-tests | ✅ per-root guard `:118-120` |
| 17 | `SIGNAL-CONFIG-ONLY-ENV` | 2 scan | `source-scans.test.ts:140` | app-tests | ✅ per-root guard `:141-143` |
| 18 | `SIGNAL-WATCHLIST-BOUNDED` | 2 | `actions.test.ts` cap cases | app-tests | ✅ add **and** re-activate both capped |
| 19 | `SIGNAL-NO-TOKEN-AT-REST` | 2 scan | `source-scans.test.ts:242`; `token-boundary.test.ts:30` | app-tests | ✅ migration half + code half |
| 20 | `SIGNAL-USER-TOKEN-UNPERSISTED` | 2 scan | `token-boundary.test.ts:30,35`; `callback.test.ts:92` | app-tests | ✅ A-1 drift **A** |
| 21 | `SIGNAL-OAUTH-LEG-PRESENT` | 2 scan | `token-boundary.test.ts:58`; `callback.test.ts:102` | app-tests | ✅ A-1 drift **B** |
| 22 | `SIGNAL-BRAND-LIMIT-DEMONSTRATED` | 2 | `wrap-evidence.test.ts:231-248` | app-tests | ✅ the limit itself is the assertion |
| 23 | `SIGNAL-DISCONNECT-DEACTIVATES` | 1 | `signals-schema.test.ts:364` | db-tests | ✅ concurrent-disconnect race, live PG |
| 24 | `SIGNAL-REVOCATION-DETECTED` | 2 | `orchestrator.test.ts:181,194,426` | app-tests | ✅ 401/404 fixtures |
| 25 | `SIGNAL-POLL-CONDITIONAL` | 2 | `orchestrator.test.ts:319` | app-tests | ✅ asserts **no writes** on 304 |
| 26 | `SIGNAL-TICK-OBSERVABLE` | 2 | `orchestrator.test.ts:138` | app-tests | ⚠️ asserts §4.6's 16 fields — would **not** redden for MINOR-5's two missing counters, because §4.6 omits them too |
| 27 | `SIGNAL-BODY-CAPPED` | 1+2 | `signals-schema.test.ts:509,523`; `parse-release.test.ts:71` | db+app | ✅ 8000/8001 boundary |
| 28 | `SIGNAL-NO-CONTRIBUTOR-IDENTITY` | 2 | `parse-release.test.ts:18,56` | app-tests | ✅ ten fields asserted absent |
| 29 | `SIGNAL-RAW-IMMUTABLE-IDENTITY` | 1 | `signals-schema.test.ts:481,487,493` | db-tests | ✅ both arms |
| 30 | `SIGNAL-NO-EMBEDDINGS` | 3 | §11.4 bullet 5 | — (decision) | n/a — recorded |
| 31 | `SIGNAL-GATING-SEAM-NAMED` | 2 | `actions.test.ts` "the L-8 gating seam" | app-tests | ✅ corrected from Tier-3 at E2.11 |
| 32 | `SIGNAL-WEBHOOK-SEAM-CLEAN` | 2 scan | `source-scans.test.ts:261` | app-tests | ✅ added at E2.11 |
| 33 | `SIGNAL-RETENTION-UNCLAIMED` | 3 | §11.4 bullet 6 + `signals-i18n.test.ts` | app-tests (adjacent half) | ✅ regex scan over three locale files; boundary of what it sees is stated |

**33 of 33 map to a test and an executing job**, or to an enumerated Tier-3 decision. **No constraint is
BLOCKER-class uncovered.** Constraint 26 is the one weak row, and its weakness is MINOR-5's, not a false
green.

**H2 vacuity:** all four source scans use the **per-root** guard
(`for (const root of SCAN_ROOTS) { expect(collectTsFiles(root).length, …).toBeGreaterThan(0) }`) at
`source-scans.test.ts:63-65`, `:118-120`, `:141-143`, `:184-186`, each with a descriptive per-root failure
message, before flattening. Session 26-D's MINOR-1 aggregate form is **not** present. The Tier-1 cascade
tests assert erasure **SUCCEEDS** (`expect(deleteErr).toBeNull()` / `expect(purgeErr).toBeNull()`) *before*
asserting rows are gone — the assertion is genuinely reached, not stranded inside an aborting transaction.

**H5 — the six Tier-3 properties** are each enumerated as a recorded decision at
`source-scans.test.ts:279-306`, with the reason ("a property of ABSENCE, not behavior") and, for
`SIGNAL-RETENTION-UNCLAIMED`, an explicit statement of what its adjacent runtime test can and cannot see.
"No test" is a decision here, not an oversight. ✅

**H6 — §13.1's Session 28 contract shipped under its exact names:** `public.signal_candidates`; the
`business_id = $1 AND status = 'new'` filter; `ORDER BY score DESC, occurred_at DESC, id ASC`; and
`listNewCandidates(client, businessId, limit)` with default 50 in `lib/db/signal-candidates.ts:29-49`. ADR
0021 can build against it. ✅

---

## VERDICT

### Blockers before merge

**None.** The five questions all answer safely, each on executed proof.

### Must fix before Session 28 opens

- **MAJOR-1** — record the executing SHA (`7b4c94e7`) and the 4-file delta, so the range's CI status is not
  misread.
- **MAJOR-2** — add `app/api/cron/signals-poll/route.test.ts`. This is the one genuine
  AUTHORED-NOT-EXECUTED gap in the range.
- **MAJOR-3** — condition the five `GITHUB_APP_*` variables, keeping the PEM refine.

### Deferrable debt

MINOR-1 through MINOR-7 and all NITs. MINOR-5 (uncounted skips) is the most valuable of them, because it
is an observability gap that will not announce itself in production; MINOR-6 (decorative
`rate_limited_until`) is the next, because a future reader will reasonably assume backoff exists.

### The five questions

**(1) Can an attacker bind an installation they cannot administer, or squat one? — NO.**
Traced by construction: an attacker owning business X obtains a valid signed state for X, substitutes a
victim's `installation_id`, and passes Zod, state-verify, nonce, businessId shape, session re-fetch,
userId match, `canServer`, and the `setup_action` branch — because all of those concern *business X*, which
they really do control. They are stopped at `route.ts:162-175`: `getUserInstallations(userToken)` calls
`GET /user/installations` with the **user OAuth token freshly exchanged from their own `code`** — a
credential that can only represent *their own* GitHub identity — and the bind is conditional on
`installations.find(i => i.id === installationId)`. The victim's installation is not in the attacker's
list, so `matchedInstallation` is `undefined` and `upsertGithubConnection` at `:180` is **never reached**.
This is the ownership proof, not the App-JWT liveness check ADR §8.2 records as exploitable.
*Executed proof:* `callback.test.ts:117` asserts the upsert is never called. Squatting is separately closed
on live Postgres by `signals-schema.test.ts:279-314` (the `UNIQUE (installation_id)` 23505 → typed
`conflict`, never a silent rebind).

**(2) Can any token reach rest — a table, a cookie, a cache, a log? — NO.**
Two tokens exist. The installation token is minted per call (`github-client.ts:94-106`), returned to the
caller, used once, never assigned outside function scope. The user token is a local `let` in the callback
(`route.ts:148`), passed to exactly one call at `:164`, never referenced below. There is no token column to
write to: `github_connections` has none (`20260731090000_signal_ingestion.sql:15-34`, with the tripwire
comment at `:36-44`). No `console.*` or Sentry call in the range carries a token — the malformed-release
capture passes `repo_id`, `business_id`, and Zod `.message` strings only.
*Executed proof:* `token-boundary.test.ts:30,35` (no token-shaped field in the db module or the types),
`source-scans.test.ts:242` (none in the migration), `callback.test.ts:92-100` (upsert payload contains
neither a token-shaped key nor the literal token string), `actions.test.ts:213-229`
(`JSON.stringify(result)` asserted not to contain the minted token).

**(3) Can one business's failure stall the tick for the others, or can any failure class skip silently? —
NO to the first; ALMOST no to the second.**
The per-connection `try/catch` sits *inside* the claim loop (`orchestrator.ts:314-325`), counts, reports to
Sentry, and continues. All six §4.5 rows have an operator-visible counterpart — none is a bare `continue`
(table in Section D above).
*Executed proof:* `orchestrator.test.ts:158` (an unclassified mint error for business 1 does not prevent
business 2 being polled, and is counted), plus a distinct fixture case per §4.5 row at `:181-316`.
The qualification is MINOR-5: two **non-§4.5** paths — `skipped_draft` and the 90-day first-poll cutoff —
increment nothing and are invisible in the tick line. These are content filters, not failure classes, and
the omission matches ADR §4.6's own field list; but a repo publishing only drafts currently looks identical
to a silent repo.

**(4) Is any LLM call reachable from Stage A or B? — NO, including transitively.**
Zero imports of `@/lib/ai/*` or `@anthropic-ai/sdk` under `lib/signals/**`, the poller route, or the
signals settings surface. I checked transitivity by hand: every dependency of the orchestrator and the
poller — `lib/db/{github-connections,watched-repos,signals,signal-candidates,types,businesses}.ts`,
`lib/cron/qstash-auth.ts`, `lib/config.ts`, `lib/members/can-server.ts` — imports only
`@supabase/supabase-js`, `date-fns`, `zod`, `jose`, `@sentry/nextjs`, `@upstash/qstash`, `node:crypto`.
None reaches `lib/ai`. `wrapSignalForPrompt` lives in `lib/ai/wrap-evidence.ts` and is referenced by
nothing in Session 27's scope — it is Session 28's entry point.
*Executed proof:* `source-scans.test.ts:62` with the **per-root** vacuity guard at `:63-65` (not the
aggregate form Session 26-D's MINOR-1 rejected), demonstrated to redden at E2.10; plus `:80`, which asserts
nothing under the scanned roots so much as names `wrapSignalForPrompt`.

**(5) Can a signal row escape tenancy or GDPR erasure? — NO.**
RLS is enabled on all four tables with the InitPlan form throughout; the single UPDATE policy carries both
USING and WITH CHECK, so tenant tunnelling is closed; `authenticated` has no DELETE path on
`watched_repos` at either the policy or the privilege layer, so a user cannot annihilate signal history by
cascade. All four cascade from `businesses ON DELETE CASCADE`, there is **no BEFORE DELETE trigger
anywhere** (repo-wide grep at `5b5bbb9f` returns only comments explaining its deliberate absence), and
`purge_business` is unedited — so its `EXCEPTION`-less body cannot be aborted by this range.
*Executed proof, all on live Postgres in db-tests:* `signals-schema.test.ts:151-205` (eight mirrored
cross-tenant SELECTs, each under a real signed-in owner session), `:209-233` (both tunnelling arms),
`:235-247` (owner cannot DELETE own watched repo), `:539-565` (business delete **succeeds**, then all four
tables empty), `:567-591` (`purge_business` **succeeds**, then all four empty). The success assertion
precedes the emptiness assertion in both erasure tests, so neither is stranded inside an aborting
transaction. The four §D2.5 cascade rows are present at `0010-legal-surface.md:1080-1083` in the
five-column form, carrying both required clauses.

---

*Three ECC agents were consulted in one parallel batch with disjoint scopes and were not re-consulted:
`database-reviewer` (migration + db modules + Tier-1 suite), `security-reviewer` (github-client + connect +
callback + disconnect), `type-design-analyzer` (brands + wrapSignalForPrompt + db return types + scans).
All three returned no BLOCKER and no MAJOR. Sections D, E, G and H were done in this reviewer's own
context, and MAJOR-1, MAJOR-2, MAJOR-3 and MINOR-3 through MINOR-7 originate there.*

---

## CORRECTION PASS (Session 27-D)

**Author:** Session 27-D correction pass (Claude Sonnet 5). **Date:** 2026-08-07. **Commit range fixed:**
D0 = `601a49f9`; subsequent steps D1–D7 land as their own commits, one per row group below, each cited by
SHA at the point it lands. Per CLAUDE.md's REVIEWER-REPORT APPEND-ONLY rule: nothing above this line is
edited — every finding above is cited by ID, never restated as resolved, and a disputed/declined finding is
argued here, not erased.

### D1 — MAJOR-3, NIT-1, A-4

**MAJOR-3 — RESOLVED.** `lib/config.ts`'s four load-bearing `GITHUB_APP_*` fields (`GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`) are now `.optional()`, with a
`superRefine` requiring all four together when `NODE_ENV=production` and rejecting any partial set (some
present, some absent) in every environment, matching the existing `QSTASH_*`/`RESEND_*` shape exactly
(A-4's ruling — both halves shipped, not one). `GITHUB_APP_SLUG` stays independently optional via its
existing `default('')`, unchanged — it is not part of the co-required set. The PEM `.refine()` on
`GITHUB_APP_PRIVATE_KEY` stays attached to the value and fires unconditionally whenever present, in every
environment — `[sec-MEDIUM-5]` verified intact by `security-reviewer` (see below) and by
`lib/config.test.ts`'s "present-but-malformed key still FAILS in development" case.

Runtime half: `lib/signals/github-client.ts`'s `getAppAuth()` and `exchangeUserCode()` now call a new
`requireGithubAppConfig()` guard that throws a named `GithubAppNotConfiguredError` (message names the
missing variable only, never a value) rather than letting `undefined` flow into `createAppAuth()` or the
OAuth exchange body. `ADR 0020 §2.2` amended (appended, not rewritten) recording the new shape and naming
"unconditionally required" as the loser.

CI half — proved, not assumed: `GITHUB_APP_*` entries removed entirely from both
`.github/workflows/app-tests.yml` and `.github/workflows/db-tests.yml` (both run `NODE_ENV: test`, never
`production`). Full `npm run test:app` run locally with these entries absent: **192 files / 2646 tests,
all green** — this is the executed proof that A-4's optional-in-non-production half works, not merely an
assertion.

**NIT-1 — RESOLVED.** The unreachable `try/catch` around `Buffer.from(val, 'base64')` (`lib/config.ts`,
formerly `:114-118`) is deleted; a comment in its place states `Buffer.from` never throws on malformed
input and that rejection is carried entirely by the PEM regex. Nothing "restores" it going forward.

**A-4 — ADJUDICATION RECORDED.** Both halves shipped per the founder ruling: `.optional()` +
production-required + partial-is-error-everywhere (not optional-everywhere, not required-everywhere), and
the runtime seams throw a named error rather than passing `undefined` through. `security-reviewer` was
invoked once (below) specifically because it raised `[sec-MEDIUM-5]` and A-4 changes when that fail-fast
contract fires.

**Tests added (`lib/config.test.ts`, new `describe('A-4 — ...')` block, 7 cases):** non-production parse
succeeds with all four absent; production parse fails with all four absent and the message names all four;
partial config (one of four present) fails in development; partial config fails in production; all four
present succeeds in production; a present-but-malformed key still fails in development. All 21 cases in the
file pass (`npx vitest run lib/config.test.ts` → 21/21 green). `npx tsc --noEmit --skipLibCheck` clean.
Scoped suite `npx vitest run lib/signals lib/config.test.ts app/api/signals` → 9 files / 101 tests green,
with **zero** `GITHUB_APP_*` env vars set for the run — direct evidence the module graph boots without
them under a non-production `NODE_ENV`.

**`security-reviewer` (invoked once, per D1's ECC budget):** reviewed `lib/config.ts`, `lib/signals/
github-client.ts` and `lib/config.test.ts` against five specific questions (PEM fail-fast survival,
superRefine gap analysis, `undefined`-reaches-`createAppAuth`/`fetch` analysis, value-leakage in
`GithubAppNotConfiguredError`, and any other issue). **Zero CONFIRMED or PLAUSIBLE findings.** Full report:
"`.optional()` is the outermost wrapper, so `ZodOptional` only short-circuits on `undefined`; any present
value still runs the full `min(1)` + PEM-decode `.refine()` chain unconditionally, in every environment...
That's an exhaustive case split over `{0,1,2,3,4} × {prod, non-prod}` — every partial state is rejected
everywhere... `GithubAppNotConfiguredError`'s constructor takes only the variable *name*... never a value...
the error message itself never reaches a URL, log line, or user-facing surface in this diff."

**Commit:** D1 lands as its own commit immediately following this appendix entry (see `git log` for the
exact SHA — this row is written before that commit exists, consistent with the ordering hazard already
documented in `docs/build-guide/session-27.md` §4: the resolution row for a step is written, then the step
is committed, matching D0's own precedent of landing the work order before the work).

### D2 — MAJOR-2, NIT-2

**MAJOR-2 — RESOLVED.** `app/api/cron/signals-poll/route.test.ts` added, modelled directly on
`app/api/cron/capture-learning/route.test.ts`'s `vi.hoisted` mock-control shape (no new harness invented).
17 cases, covering: qstash mode unsigned/invalid request → 401 with `runSignalsTick` asserted **not
called** (mock call count checked directly, not inferred from status); qstash mode valid signature → 200,
tick called exactly once with `triggeredBy: 'qstash'`; secret mode wrong/missing/short bearer → 401, tick
not called; secret mode correct bearer → 200; secret mode dev bypass (`x-cron-dev-trigger: true`) → 200 in
development, and explicitly **401 in production** (the bypass is proven not consulted, not merely
untested); `GET` → 405 in qstash mode and `POST` → 405 in secret mode, both asserting the tick is never
called; the `cron-auth-failure` warn line asserted to carry exactly `{kind, route, reason, trigger}` — no
more keys — and a synthetic "secret-shaped" signature value asserted **absent** from the serialized log
line, closing the "carries no request body, header value or token" requirement directly rather than by
inspection.

`docs/decisions/0020-mode-3-signal-ingestion.md` §11.5 amended (appended) with the `verifyQStashRequest`
caller table naming this test against `api/cron/signals-poll/route.ts:16`, so the table the Reviewer found
false (`api/cron/signals-poll/route.ts:16 → NONE`) is now true. The pre-existing
`api/cron/process-deletions/route.ts` gap is recorded in the same table as **unaddressed, out of scope** —
it predates Session 27 and fixing it is a separate change, per the Reviewer's own note.

**Redden proof (VERIFY):** the qstash-mode auth guard was temporarily inverted (the `catch` block's
`return new NextResponse('Unauthorized', { status: 401 })` removed, so an unsigned/invalid request fell
through to the tick instead of being rejected) — `git diff` confirmed this was the only change. Re-running
the suite produced exactly 3 failures, all in the qstash-mode 401/never-called cases (invalid signature,
missing signature, dev-bypass-not-consulted), 14/17 still green. The mutation was then reverted;
`git diff app/api/cron/signals-poll/route.ts` confirmed byte-identical to pre-mutation. This is executed
proof the new suite actually exercises the auth guard, not merely asserts a status code that would pass
regardless.

**NIT-2 — ARGUED-NOT-CHANGED.** The `try/catch` around `runSignalsTick` (`route.ts`, formerly `:63-67`) is
kept, not deleted. It is near-dead — `runSignalsTick` wraps its own body and returns a summary rather than
throwing — but it is byte-consistent with `capture-learning`'s identical shape, and house consistency
across the cron routes is judged worth more than removing four lines. A one-line comment was added stating
it is defence-in-depth for a throw the orchestrator does not currently produce, so a future reader does not
mistake it for live, exercised error handling.

**Verification:** `npx tsc --noEmit --skipLibCheck` clean. `npm run test:app` → **193 files / 2663 tests,
all green** (up from D1's 192/2646 — the +1 file / +17 tests is exactly this step's new suite).

**Commit:** D2 lands as its own commit immediately following this appendix entry.

### D3 — MINOR-1, MINOR-2

**MINOR-1 — RESOLVED.** `lib/db/signals.ts`'s `listSignalsForWatchedRepo` now carries a trailing
`.order('id', { ascending: true })` after `occurred_at DESC`, so the poller's edit-detection window is
deterministic under a LIMIT when rows share an `occurred_at`. The comment no longer claims
`signals_watched_repo_id_idx` (single-column, `watched_repo_id`) serves the sort — it now states plainly
that the index serves only the filter's leading column, and that the trailing `id` order is the tiebreak.

**MINOR-2 — RESOLVED, comment-only (no migration).** `lib/db/watched-repos.ts`'s
`listActiveWatchedReposForConnection` comment corrected: `watched_repos_connection_id_idx` (`connection_id`
only) serves the filter's leading column, `is_active` and the `id ASC` sort are **not** index-covered, and
this is accepted as a full scan of a bounded (20-row) slice. Per the work order, a new migration was **not**
shipped — widening to `(connection_id, is_active, id)` is named as the deferred option, to be recorded
under ADR 0020 §3.6 if a future session's workload makes the full scan worth avoiding.

**Item 3 — comment audit of the remaining ordered queries in both files.** Re-read every `.order(...)` call
site in `lib/db/signals.ts` and `lib/db/watched-repos.ts`:
- `listRecentSignalsForBusiness` (`signals.ts`) — ORDER BY `business_id` (eq) + `occurred_at DESC, id ASC`.
  Verified against the migration (`20260731090000_signal_ingestion.sql:225-226`):
  `signals_business_id_occurred_at_idx ON signals (business_id, occurred_at DESC, id)` — exact match.
  Comment already accurate; **no change needed**.
- `listWatchedReposForBusiness` (`watched-repos.ts`) — ORDER BY `business_id` (eq) + `repo_id ASC`.
  Verified against the migration (`:70`): `UNIQUE (business_id, repo_id)` — exact match. Comment already
  accurate; **no change needed**.
- No other function in either file issues an `.order(...)` call (the remaining exports are single-row
  lookups, counts, inserts, or conditional updates with no sort). The audit did not stop at the two the
  Reviewer opened — it covered every ordered query in both files.

**Verify:** new Tier-2 case in `lib/db/signals.test.ts` asserting `listSignalsForWatchedRepo` issues both
order calls, in order (`toHaveBeenNthCalledWith(1, 'occurred_at', ...)`, `toHaveBeenNthCalledWith(2, 'id',
...)`). Shown to REDDEN against the pre-D3 query builder: the `.order('id', ...)` call was temporarily
removed, the new test failed exactly as expected (`expected "vi.fn()" to be called 2 times, but got 1
times`), then reverted — `git diff lib/db/signals.ts` confirmed no residual mutation. `npx tsc --noEmit
--skipLibCheck` clean. `npm run test:app` → **193 files / 2664 tests, all green** (up from D2's 193/2663 —
the +1 test is exactly this step's new case; no new test *file*, since the case was added to the existing
`lib/db/signals.test.ts`).

**Commit:** D3 lands as its own commit immediately following this appendix entry.

### D4 — MINOR-3, MINOR-4, NIT-4, A-6

**A-6 (item 1) — verification that made the deletion safe, done BEFORE deleting anything.** Confirmed
`SIGNAL-INGEST-IDEMPOTENT` is proved independently of `upsertSignal`:
- `supabase/__tests__/signals-schema.test.ts:251` — `"SIGNAL-INGEST-IDEMPOTENT: a second insert with the
  same (business_id, source, external_id) hits 23505"` — a live-Postgres test that inserts a row, then
  inserts a second row with the same `(business_id, source, external_id)` and asserts the DB itself rejects
  it. This exercises `insertSignal`'s INSERT-only path, never `upsertSignal`.
- `lib/signals/orchestrator.test.ts:358` — `"a retried delivery's INSERT hitting 23505 (via insertSignal's
  duplicate result) counts as duplicates, not signalsIngested"` — asserts the orchestrator correctly counts
  a duplicate result from `insertSignal` and never calls `mockUpsertScoredCandidate`.
- By contrast, `lib/db/signals.test.ts:45` (formerly `:60-76`, the deleted case) was
  `'upsertSignal targets UNIQUE(business_id, source, external_id) as the conflict arbiter'` — a **mocked**
  shape assertion (`expect(builder.upsert).toHaveBeenCalledWith(...)`) against a fake client, not a proof
  against real Postgres, and not a caller the orchestrator ever exercises.

This confirms the check comes out the way A-6 assumed: deleting `upsertSignal` and its test removes zero
executed proof of any named constraint. **A-6 applied — split, not one deletion:**

**MINOR-3 — RESOLVED, split per A-6.**
- `upsertSignal` (`lib/db/signals.ts`) **deleted**, along with its mocked-shape test case in
  `lib/db/signals.test.ts`. No barrel export existed for it (`lib/db/index.ts` does not re-export
  `lib/db/signals.ts`; confirmed by grep). The ingest path remains `insertSignal`; the edit path remains
  `updateSignalContent`.
- `scoreAndSortSignals` and `sortScoredSignals` (`lib/signals/score.ts`) **KEPT**, not deleted —
  `score.test.ts:107-122`'s shuffled-copy cases run through `scoreAndSortSignals` (which calls
  `sortScoredSignals` internally) and are `SIGNAL-SCORING-DETERMINISTIC`'s executed proof. Both annotated:
  `scoreAndSortSignals` as the ADR 0021 / Session 28 entry point for any in-memory batch-scoring path
  needing a deterministic order before persistence; `sortScoredSignals` as the total-order building block
  that proof exercises directly.
- The wrong citation: `score.ts`'s comment on `upsertScoredCandidate` (the edit-handling note) previously
  said the caller re-writes signals' content columns via `lib/db/signals.ts`'s `upsertSignal` — the
  orchestrator actually calls `updateSignalContent` (`orchestrator.ts:134`; the work order named `:120`,
  which had drifted — corrected to the verified current line). Citation corrected.

**MINOR-4 — RESOLVED.** `score.ts` now states, at `sortScoredSignals`, that it is a scoring-side utility
whose order is **not** the feed order — §13.1's `ORDER BY score DESC, occurred_at DESC, id ASC`
(`signal_candidates_feed_idx`) is authoritative for anything read from `signal_candidates`, and the two
orders (`external_id ASC` vs `id ASC` tiebreaks) can diverge on an exact tie. `ADR 0020 §6.3` amended
(appended) with the same clarification, so a future session cannot contradict §13.1's contract by importing
`sortScoredSignals` for feed-facing output.

**NIT-4 — RESOLVED.** `ADR 0020 §14` ("Explicitly deferred") gained a line naming the `tag_name` drift
explicitly: §5.3 lists it as retained, no `signals.tag_name` column exists, `parseRelease` has the raw
value in hand but nowhere to put it, and ADR 0021 must decide either the column or dropping the retention
claim. No column added here — that would be a migration, out of D4's scope and L-1's boundary.

**Verify:** `npx tsc --noEmit --skipLibCheck` clean — confirms `upsertSignal` has zero remaining importers.
`npm run test:app` → **193 files / 2663 tests, all green** (down from D3's 2664 by exactly 1 — the deleted
`upsertSignal` test case; no other count changed). `score.test.ts`'s three determinism cases
(`lib/signals/score.test.ts:106-125`) pass **UNCHANGED** — confirmed by diff, no edits made to that file,
consistent with item 3 being comment-only. `npm run test:db` could not be executed locally — `docker info`
confirms Docker is unavailable in this environment, the same pre-existing local limitation noted earlier in
this session's D1–D3 steps; D4 touches zero Tier-1 (live-Postgres) files (only `lib/db/signals.ts`'s
mocked unit test, `lib/signals/score.ts`, and two ADR sections), so this is a formality for D7's CI run to
confirm rather than a gap introduced by this step.

**Commit:** D4 lands as its own commit immediately following this appendix entry.

### D5 — MINOR-5, MINOR-6, A-5

**MINOR-5 — RESOLVED.** `SignalsTickSummary` (`orchestrator.ts`) gained two content-filter counters,
`skippedDraft` and `skippedPreCutoff`, incremented at the `skipped_draft` and pre-cutoff `continue` sites
respectively. Both are documented and enforced as **content filters, not §4.5 failures** — kept out of
`failed` and out of the failure table, with a comment explaining why (declining to ingest a draft or
pre-cutoff release is the poller working correctly). `ADR §4.6` amended (appended) with both field names
added to the canonical 18-field tick line, and an explicit note that `SIGNAL-TICK-OBSERVABLE`'s
field-presence test could not have caught their prior absence, because §4.6 itself omitted them — fixing
the ADR is what gives the constraint teeth. `orchestrator.test.ts:138`'s field-presence assertion extended
to the new 18-field list; two new behaviour cases added: a drafts-only repo reports `skippedDraft > 0` and
`signalsIngested === 0`; a first poll with a release far older than the 90-day cutoff reports
`skippedPreCutoff > 0`. Both demonstrated to REDDEN against the pre-D5 orchestrator (increments
temporarily removed, both new cases failed with `expected 0 to be greater than 0`, all 16 other cases
still green, mutation reverted — `git diff` confirmed no residual mutation).

**MINOR-6 / A-5 — RESOLVED, load-bearing option shipped (the documentation-only option is the named
loser, per adjudication).** `lib/db/github-connections.ts`'s `listConnectionsReadyForPoll` gained a
SECOND `.or()` call — `rate_limited_until.is.null,rate_limited_until.lt.${nowIso()}` — alongside the
existing `last_poll_started_at` one. `nowIso()` uses `date-fns` `formatISO`, matching house convention
(never `new Date().toISOString()`). The comment states precisely which part of
`github_connections_poll_claim_idx (is_active, last_poll_started_at)` this predicate is and isn't served
by (the `is_active` filter and the ordering, still; `rate_limited_until` itself, not — it filters the
already-narrow ≤20-row candidate window post-index), applying MINOR-2's lesson explicitly rather than
overstating the match. The prior "harmless… counted again" comment on `recordGithubConnectionRateLimited`
is KEPT, not deleted, as the record of the previous behaviour; a new paragraph states why it changed (the
403 is now guaranteed and known in advance, it burns one of the tick's ≤20 claim slots, and the expiry was
already on the row and simply unread). `ADR §4.5` amended (appended) recording `rate_limited_until` as now
a claim predicate, not an informational stamp, naming the documentation-only option as the loser and why.

**Deliberately NOT added to `claimGithubConnectionForPoll`'s WHERE clause** — only to the list query.
`database-reviewer` confirmed this is correct, not a gap: `claimGithubConnectionForPoll` is only ever
called with an id drawn from the SAME tick's already-filtered `listConnectionsReadyForPoll()` result
(`orchestrator.ts`'s claim loop), and the pre-existing `last_poll_started_at` staleness guard already
prevents any cross-tick double-processing scenario independent of `rate_limited_until`. Adding it to the
claim's WHERE would be redundant, not more correct.

**`database-reviewer` (invoked once, per D5's ECC budget):** reviewed `lib/db/github-connections.ts` (full
file) and the new/pre-existing Tier-1 tests in `signals-schema.test.ts` against five specific questions.
**Zero CONFIRMED or PLAUSIBLE findings.** Notably, the agent inspected the installed
`@supabase/postgrest-js@2.105.1` source directly (`PostgrestFilterBuilder.ts:1976-1986`) rather than
trusting documentation, confirming `.or()` calls use `searchParams.append` (not `.set`), so two `.or()`
calls genuinely AND as two separate PostgREST query params — the comment's claimed semantics are correct
at the installed version, not merely asserted. The agent also independently re-derived that the pre-existing
concurrency test at `signals-schema.test.ts:326` is unaffected (`insertConnection` never sets
`rate_limited_until`, defaults to `NULL`, and `claimGithubConnectionForPoll`'s WHERE is untouched by this
diff), and confirmed the new Tier-1 test is genuine live-Postgres coverage (both the test's `admin` client
and `listConnectionsReadyForPoll`'s internally-acquired client are service-role, so RLS is moot and the
before/after single-connection design isolates the variable cleanly).

**Tier-1 test added** (`supabase/__tests__/signals-schema.test.ts`, `"A-5/MINOR-6: rate_limited_until in
the future excludes a connection from listConnectionsReadyForPoll; in the past, it is included"`): the
same connection, `rate_limited_until` set one hour in the future then re-checked, asserted absent from a
1000-row `listConnectionsReadyForPoll` result; then set one hour in the past, re-checked, asserted present.

**Verify — HONEST STATEMENT, not asserted-green.** `npx tsc --noEmit --skipLibCheck` clean. `npm run
test:app` → **193 files / 2665 tests, all green** (+2 from D4's 2663 — exactly the two new orchestrator
behaviour cases; the new Tier-1 case does not run under `test:app`, per ADR 0015's Tier separation).
`npm run test:db` **could NOT be executed in this environment** — `docker info` confirms Docker is
unavailable locally, the same pre-existing limitation noted in D4's appendix. Per the work order's own
instruction ("it must be RE-RUN, not assumed"), this is recorded here as an **honest gap, not a silent
assumption**: the concurrency proof at `signals-schema.test.ts:326` and the new A-5 Tier-1 case have
**NOT** been executed against live Postgres by this session. The re-derivation above (mirrored
independently by `database-reviewer`) is an ARGUMENT that the concurrency proof is unaffected —
`claimGithubConnectionForPoll`'s WHERE clause is byte-for-byte unchanged by this diff, and
`insertConnection` never sets `rate_limited_until` — but an argument is not a substitute for the executed
proof ADR 0015 §2 requires. **D7 must run `npm run test:db` in CI and confirm both this pre-existing test
and the new A-5 test are green before this step's Tier-1 claim can be treated as closed**, not merely
"argued."

**Commit:** D5 lands as its own commit immediately following this appendix entry.
