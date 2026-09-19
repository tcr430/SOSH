# Session 32 Track I — Reviewer report (I3)

**Scope reviewed: `4f3e7129..3914a31c`; all citations are `git show 3914a31c:<path>` at that range, never HEAD.**

ADR 0025 and ADR 0002 Amendment B read at `4f3e7129` (sections 0–13); ADR 0025's appended Builder section 14 is a reviewed artefact, read at `3914a31c`; build guide read at `4f3e7129` (unchanged in the range); reviewed artefacts read at `4f3e7129..3914a31c`.

**Precondition.** ADR 0025 entered git at `4f3e7129`, a docs-only commit ("Session 32 I1: record founder sign-off, ADR 0002 Amendment B, and ADR 0025"), which is the range base. Precondition met. The local `HEAD` equalled `3914a31c` with a clean tree throughout, so the local test runs below executed the range head.

**Reviewer modifications.** None, except this file. Scan and Tier-3 reddening was done in an out-of-repo copy (`git archive 3914a31c`) or on synthetic input piped to the same grep, never on the working tree.

---

## What I ran, and what came back

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run test:app` (local, no env) | 278 files: 273 passed, 5 failed at collection (`ZodError` from real `lib/config.ts`); 3722 tests passed. The 5 are `lib/config.test.ts`, `lib/campaigns/generate.test.ts`, `lib/signals/orchestrator.test.ts`, **`lib/backfill/__tests__/fetch-phase.test.ts`** and **`lib/backfill/__tests__/tick.test.ts`**. |
| The same 5 files, with `app-tests.yml`'s CI dummy env | 5/5 files, 115/115 tests passed. The failures are env-only. |
| `npm run lint` (the `app-tests` Lint step) | **exit 1: 2 errors, 107 warnings.** Both errors were introduced in the range (BLOCKER-2). |
| `npm run test:db` | **Not run.** Docker is unavailable (`docker` exit 127; `supabase status` could not reach the Docker engine). No Tier-1 file was executed by me. |
| CI runs for `3914a31c` | **None exist.** `gh run list --commit` returns nothing for `3914a31c`, `70773e87`, `9359a708`, `f6539e19`, `893e8b67` or `fd2d59ea`. The branch is 17 commits ahead of `origin/session-30-5-adr-0028` (`7202da89`). No db-tests skip-guard line exists to read (BLOCKER-1). |
| I2.1 scans, reddened in a sandbox copy | Four of five plants reddened; **one did not** (MAJOR-6, §7). |
| ESLint boundary, via `eslint --stdin --stdin-filename lib/backfill/probe.ts` | A direct `@/lib/social/twitter-provider` import → `no-restricted-imports` error. A barrel import → clean. `eslint-internals-ban.test.ts`: 4/4 pass. |
| Tier-3 five, re-run at the range | **#52's recorded command returns 33 hits, not the "Zero hits" §14.1 claims** (MAJOR-7, §10). |

**Could not verify in this session, and why:**
- Any CI result, and the skip-guard file/test counts. No run exists.
- Tier-1 behaviour. No live Postgres. Every Tier-1 judgement below is from reading source at the range.
- The live X API response shape. Only recorded fixtures exist.
- The LinkedIn read body. No coverage is claimed for it, correctly.
- The 10-minute latency target (operational).
- What the `ecc:database-reviewer` and `ecc:security-reviewer` invocations actually reported, beyond the commit bodies' summaries.

---

## 1. The read contract and Amendment B (§2; A-1, A-2, A-3; L-2, L-11)

**Verified (not findings):**
- `TwitterProvider.historicalReadAvailable = true` (`lib/social/twitter-provider.ts:147`), with no stub marker. `LinkedInProvider` is `false` (`lib/social/linkedin-provider.ts:108`) and throws `NOT_IMPLEMENTED` after the page-size check, before any I/O (`:389-393`).
- The as-shipped pin (Twitter true, LinkedIn false, Mock true) is in `provider-contract.test.ts` and fails if the Twitter flag is set `false`.
- The eight-method assertion is present, and `SOCIAL-NO-READ-PATH` is inverted rather than deleted.
- `RecentPost` has exactly the six ADR §2.2 fields.
- The X request is `exclude=replies,retweets` with no `expansions`. Quotes are dropped on the non-expanded `referenced_tweets[].type`. `non_public_metrics` is not requested (test `twitter-provider.test.ts:404`, `:418`).
- Page 1 calls `/2/users/me`, and a mismatch fails closed with exactly one fetch (`:438-447`).
- Cursors are account-bound, and a foreign or garbage cursor is rejected (`:468`, `:479`).
- Page size is refused with `RangeError` before I/O on all three implementations.
- `Retry-After` is capped at 900 with no timer scheduled, under fake timers (`:486-501`).
- The 10 s timeout is in place, and `withFreshToken` runs per page (`:449`).
- The `get_vault_secret` call-site count is pinned at 2.
- `details` is checked by string search against the token, cursor and post text (`:568-600`).
- The §2.9 mock fixtures are all present and deterministic (`mock-provider.test.ts:134-319`).

- **NIT-3.** `X_TIMELINE_TWEET_FIELDS` requests `entities` and `referenced_tweets` (`twitter-provider.ts:63`). Both are dropped before `RecentPost` is built, but `entities.mentions` carries third-party ids and handles in transit. *Proof of fix:* the field set is narrowed to what the parser reads, or the ADR records the exposure.
- **NIT-5.** Refresh writes `scopes_granted: []` when X omits `scope` (`twitter-provider.ts:537`), overwriting a known value with "unknown" (pinned as intended at `twitter-provider.test.ts:319`). *Proof of fix:* the column is left untouched when scope is absent, or the ADR accepts it.

## 2. Contract neutrality (§3)

No X-shaped field is on any exported type. `pagination_token` lives only inside the opaque cursor, and `quote_count` is folded into `shares`. The ESLint probe under `lib/backfill/` exists and I reddened it. **No findings.**

## 3. Extraction per memory type (§4; L-6, L-8)

**Verified:**
- `importedConfidence = min(0.6, 0.6·n/(n+5))` is one helper (`lib/backfill/patterns/format.ts:214-216`), reused by the insights pass (`extract.ts:270`).
- Fabricated backing ids are discarded, and n and lift are recomputed (`extract.ts:250-261`). The schema is `strictObject`, with no n or confidence field.
- Audience needs ≥ 2 posts at 0.3. Evidence must be a verbatim substring ≤ 500 chars at 0.5 (`lib/backfill/evidence.ts:168-189`).
- Voice uses the new id `backfill-voice-synthesis` on Sonnet and is staged only.
- Brand examples are capped at 3 by Zod. Founder voice is written axes-only.
- No brand row is written.
- Post text is wrapped in `[DATA]…[/DATA]`.
- There is no `fetch(` and no website-fetcher import in `lib/backfill/` (both scans reddened).

- **MAJOR-5 — performance (15) and audience (25) caps are not enforced on any write path.**
  - *What:* `writeInsightsOutput` (`lib/backfill/extract.ts:250-294`) and `writeFormatPatterns` (`patterns/format.ts:263-282`) write every candidate. `import_audience_memory` and `import_performance_memory` (`20260913150000_backfill_review_fixes.sql:99-195`) have no per-run count. Only evidence has `< 40` (`20260914050000_backfill_evidence_rpcs.sql:77-80`).
  - *Also:* the review readers `.limit(25)` and `.limit(15)`, which hides overflow candidates from the founder.
  - *Why it matters:* WRITE-CAPS is claimed closed. ADR §6.4 relies on these caps to bound a re-run pass, and the Evidence Pack states them as fact.
  - *Proof of fix:* a test where more than 15 patterns and more than 25 statements qualify for one run, leaving exactly 15 and 25 rows.
- **MAJOR-11 — any evidence-pass failure permanently fails the batch, and the run finalises `partial: false`.**
  - *What:* the bare `catch {}` (`extract.ts:205-215`) treats network, 429/529, timeout and quota errors as invalid output and marks up to 20 posts `failed` for good. The final transition (`:187-189`) sets `partial: false` regardless of how many posts failed.
  - *Why it matters:* this is §6.4's named failure mode, "a half-imported memory that looks complete".
  - *Proof of fix:* a test where a transient error leaves the batch retryable (or marks the run `partial`), and failed posts never allow `partial: false`.
- **MINOR-1 — a thrown voice or insights pass never reconciles its reservation, and each tick re-reserves.**
  - *What:* `extract.ts:129`, `:164`. `updated_at` is bumped by `set_updated_at`, so the stall sweep never fires, and the 50¢ run and 150¢ daily budgets drain until the run goes partial.
  - *Proof of fix:* after a thrown pass, `spend_cents` returns to its prior value.
- **MINOR-2 — `reconcileSpend` reads the business's latest usage row for the prompt id, not the call's.**
  - *What:* `extract.ts:85`. Two runs on one business (L-11) can cross-read each other's cost.
  - *Proof of fix:* the cost is tied to the call that was actually made.

## 4. Provenance, recency and promotion (§5; L-3)

**Verified:**
- All four memory tables have both CHECKs and the `ON DELETE NO ACTION` FK (`20260913140000_memory_import_provenance.sql:31-65`).
- The `BEFORE UPDATE` trigger covers all three columns and fires for service-role (`:73-109`); tested on all four tables (`memory-import-provenance.test.ts:141-168`).
- The colliding distilled upsert is tested (`memory-import-promotion.test.ts:78`).
- Ratify touches neither `source` nor `last_confirmed_at`.
- `last_confirmed_at` is the source date, and non-finite dates are rejected in TS and in SQL.

**No Builder findings.** See MINOR-9.

## 5. Ceilings, cost, resumability, where it runs, stall sweep, disconnect (§6; L-7′)

**Verified:**
- `reserve_backfill_spend` is one conditional UPDATE, tested concurrently (`backfill-spend.test.ts:87`).
- The purpose CHECK is looked up by definition and raises unless exactly one matches (`20260913130000:302-326`). All three purposes are tested through `reserve_ai_budget` (`ai-budget-purpose.test.ts:45`).
- Resume is `failed → queued` on the same row, and `caller_bug` is not resumable (`backfill-once-per-account.test.ts:67`, `:121`).
- The Tier-1 idempotency test re-invokes the SQL RPCs directly (`memory-import-rpcs.test.ts:91-153`).
- Enqueue happens in the callback with `after()`. The cron route follows the sync-metrics pattern, and its log line is string-searched (`tick.test.ts:165`).
- Disconnect discards a live run (`social-accounts.test.ts:168-205`).
- The trial trigger is untouched.

- **MAJOR-3 — the fetch bounds are per call, not per run.**
  - *What:* the local counters (`lib/backfill/orchestrator.ts:111-117`) reset on every `fetchPhase` call. Three paths re-enter with fresh counters, each restarting from `cursor = null`:
    - a `RATE_LIMITED` or `NETWORK` deferral (`:62-65`), which leaves the run `fetching`;
    - a resume;
    - a reconnect-triggered resume.
  - *Consequence:* `platform_posts_read` accumulates past 500, and staged posts can exceed 200, because `stage_backfill_posts` counts only new inserts.
  - *Evidence the tests miss it:* every fetch-phase test is a single call (`fetch-phase.test.ts:187`, `:204`).
  - *ADR note:* §6.4's "restarts from `cursor = null`" does not say the bounds are cumulative.
  - *Proof of fix:* repeated deferrals and resumes still leave `platform_posts_read ≤ 500` and ≤ 200 staged rows per run.
- **MAJOR-4 — `BACKFILL-RESUMABLE-OR-DISCARDED` has no test that can fail on duplicate memory.**
  - *What:* no test writes memory, crashes between the writes and `increment_backfill_passes_done`, resumes the same run id, and counts memory rows. `fetch-phase.test.ts:274` checks staging only, against mocks.
  - *Proof of fix:* an orchestrator test that fails mid-fetch and mid-extraction, resumes, and asserts zero duplicate memory rows.
- **MINOR-3 — the import RPCs don't require the run to be `extracting`.**
  - *What:* a pass already in flight writes candidates to a run that has since been discarded or disconnected, and nothing retires them.
  - *Proof of fix:* the RPCs refuse unless the run is `extracting`, tested by discarding mid-pass.
- **NIT-1.** The purpose-CHECK lookup filters `relname` without a namespace (`20260913130000:310`, `:321`). It fails loud if ambiguous. *Proof of fix:* the lookup uses the regclass.
- **NIT-2.** `.neq('error_code', 'caller_bug')` (`lib/db/backfill-runs.ts:316`) excludes NULL-code failed runs on reconnect. *Proof of fix:* the filter behaves as `IS DISTINCT FROM`.

## 6. Token scope, Vault, identity lock, `scopes_granted` (§7; L-5)

**Verified:**
- The table-level `REVOKE UPDATE` is followed by a column allowlist `GRANT` (`20260913120000_social_accounts_identity_lock.sql:58-65`).
- The Tier-1 test performs the UPDATE as authenticated and expects `42501` for each of nine locked columns; an allowlisted column still updates (`social-accounts-identity-lock.test.ts:94-117`).
- `SocialAccountUpdate` is narrowed (`lib/db/types.ts:246-248`).
- `updateSocialAccount` has zero callers.
- Every locked-column writer uses service-role.
- No new `SECURITY DEFINER` function writes `social_accounts`.
- `scopes_granted` is written by the callback and by the refresh.

- **NIT-4.** The lock test omits `id`. *Proof of fix:* an `id` case expecting `42501`.
- **MINOR-8 (ADR finding) — the lock closes UPDATE only.**
  - *What:* `authenticated` keeps INSERT and DELETE under `connect_accounts` policies (`20260702120400_campaigns_social_accounts_role_policies.sql:40-50`). DELETE plus INSERT with a chosen `platform_user_id` reaches the forbidden state.
  - *Why MINOR:* the backfill is only enqueued by the service-role callback, and the identity check fails closed.
  - *Proof of fix:* an ADR amendment on the INSERT/DELETE posture, then a Tier-1 test.

## 7. Legal posture (§8)

**Verified:**
- Evidence Pack Amendment A3 is present.
- The `/privacy` prose is present with a counsel flag (`privacy.en.mdx:80-81`).
- `evidenceRef` points to `70773e87`.
- `[LEGAL ENTITY]` is **not** substituted.
- The launch checklist lists the QStash backfill schedule, the X quota, the latency observation and the counsel list.
- Sentinels are applied at the `lib/db` import writers.
- Import wrappers are imported only from `lib/memory/` (scan at `lib/memory/import.test.ts:224`).

**Scan reddening:**

| Plant | Result |
|---|---|
| `liking_users` inside `fetchRecentPosts` | red |
| `fetch(` in `lib/backfill` | red |
| website-fetcher import in `lib/backfill` | red |
| `fetchEngagement` in `lib/backfill` | red |
| **`liking_users` URL in the private helper `fetchTimelinePage`** | **still green, 3/3** |

- **MAJOR-6 — the provider half of NO-COMMENT-READ scans only `fetchRecentPosts`'s own body (`source-scans.test.ts:107`), but every X URL lives in private helpers.**
  - *Why it matters:* L-2's only proof cannot redden for a comment or like endpoint added to the helper that actually calls X.
  - *Proof of fix:* the helper plant reddens.
- **MAJOR-8 — the `/privacy` prose and the Evidence Pack contradict the code.**
  - (a) `privacy.en.mdx:114` says "up to 12 months for a specific quoted excerpt", but `quote`/`case_study` rows get `expires_at = NULL` (`lib/memory/import.ts:66-70`).
  - (b) Evidence Pack `:745` says evidence expires after 12 months. That is only true for `usage_data`.
  - (c) `:748` states the audience and performance caps, which are unenforced (MAJOR-5).
  - (d) `:749` says "Nothing is retained 'candidate' indefinitely", but unratified candidates have no expiry.
  - (e) "5 pages / 500 reads per run" does not hold across resumes (MAJOR-3).
  - *Proof of fix:* the code matches the prose, or the prose is corrected with a new `evidenceRef`, and each statement is tested.
- **MINOR-9 (ADR finding).** The §8.3 retention table has no rule for candidate memory from a run that is never ratified. *Proof of fix:* an amendment, a sweep and a test.

## 8. GDPR and tenancy (§9; L-9)

**Verified:**
- Both tables cascade from `businesses`.
- Runs have member SELECT only; staging has no authenticated policy and a `REVOKE ALL`. Both are tested (`backfill-runs-rls.test.ts:101-148`).
- The §D2.5 rows are verbatim (`0010-legal-surface.md:1087-1088`) and landed in the migration's own commit (`9db35d8e`).
- The purge test holds active import rows on all four memory tables.
- Ratify grants `EXECUTE` to `service_role` only, with the authenticated refusal tested.
- `p_user_id` comes from `getUser()` (`backfill-actions.ts:98-112`, `:145-151`).
- A viewer is refused, and another run's rows and a `summarize:` candidate are left untouched (all tested).
- `staged_voice` is left untouched.

- **MAJOR-2 — ratify activates memory and deletes staging before any status check.**
  - *What:* the memory UPDATEs (`20260913150000:239-257`) and the staging DELETE (`:259`) run before the guarded run-row UPDATE (`:268-269`). The action doesn't check status either (`backfill-actions.ts:138-156`).
  - *Consequence:* ratify on an `extracting` run activates partial memory and purges staging while the run keeps extracting.
  - *Proof of fix:* a Tier-1 case on an `extracting` run where no rows change.
- **MINOR-4 — a viewer can discard a run** (`20260913150000:295-305`; `backfill-actions.ts:115-136`). *Proof of fix:* the ADR states the discard role, and a viewer case is tested.

## 9. The UX contract (§10), including taste-skill and impeccable

Per the I2.14 commit body, `taste-skill` was declined (out of its scope) and `impeccable` replaced raw amber classes with `text-destructive` and added focus management. No contract breach resulted. There is no `asChild` or raw colour, and no new token. Step-4 remains the completion page with its CTA intact. Step-2 without `?run` is unchanged. `unsupported` shows no progress. Patterns carry observation counts. i18n parity is non-vacuous.

- **BLOCKER-3 — `posts_extracted` is never written, so every real run renders "nothing to learn".**
  - *What:* `BackfillPanel.tsx:255` shows nothing-to-learn when `run.posts_extracted === 0`. `git grep posts_extracted` at the range finds only the column default (`20260913130000:27`), the type, and the panel's reads. The counts at `:204`, `:271` and `:281` always show 0.
  - *Consequence:* there are no candidates, no role declaration and no ratify button, so nothing can become active and Tier E is structurally zero.
  - *Evidence the tests miss it:* the tests pass only because fixtures hand-set `posts_extracted`.
  - *Proof of fix:* a real writer (or an independent condition), plus a test from real extraction to a ratifiable panel.
- **MAJOR-1 — voice can be applied before ratification, to a role chosen on the form.**
  - *What:* `stage_backfill_voice` sets `voice_status = 'pending'` during extraction (`20260914040000:60`). `applyBackfillVoiceAction` checks neither `status === 'ratified'` nor `run.account_role`, and branches on form `accountRole` (`backfill-actions.ts:189-231`).
  - *Reachability:* the "Review voice" link sits in the pre-ratify view (`BackfillPanel.tsx:286-296`). Step-2 renders it for any status, with an editable role defaulting to `founder` (`BackfillVoiceReview.tsx:48`).
  - *Consequence:* founder voice can overwrite `brand_voices`.
  - *Proof of fix:* action tests refusing non-ratified runs and a role mismatch.
- **MAJOR-12 — §10.4 is incomplete.** The voice descriptor and axes are not rendered, cadence and format mix are not rendered, and the headline date range reads `summary.date_range`, which is never written. *Proof of fix:* tests asserting all six items in order.
- **MINOR-6 — step-2 ships a separate `BackfillVoiceReview` instead of reusing `VoiceEditor`.** This contradicts ADR §0 interpretation note 1, although it is disclosed in the commit body. *Proof of fix:* reuse `VoiceEditor`, or record a founder adjudication.
- **MINOR-10 (ADR finding).** §9.4 gives no ratify status precondition, and §10.4 (voice review offered pre-ratify) conflicts with §4.2's ordering. *Proof of fix:* an amendment.

## 10. The test plan (§11)

- **BLOCKER-1 — no CI run exists for the range.**
  - *Consequence:* 0 constraints are executed green and there is no skip-guard to read. The Builder disclosed this in §14.4.
  - *Proof of fix:* pushed runs at the corrected head, read, with skip-guard counts recorded. If db-tests is red, distinguish a DB regression from the supautils SIGSEGV (31-D D20).
- **BLOCKER-2 — `npm run lint` exits 1.**
  - `components/onboarding/BackfillBanner.tsx:20` (`9359a708`): `setState` synchronously inside an effect.
  - `lib/social/linkedin-provider.ts:74` (`0b92f079`): restricted `toISOString()`.
  - `app-tests` would be red.
  - *Proof of fix:* lint exits 0 and `app-tests` is green.
- **MAJOR-7 — the Tier-3 #52 verification claims "Zero hits" but its command returns 33 at the range (`0025-social-read-path-and-backfill.md:1149`).**
  - *Blind spot:* the command only inspects signature lines, so a function-body cross-business aggregate passes it.
  - *#50:* now self-matches the ADR prose (`:1127`, `:1129`).
  - The property holds on manual reading of all ten migrations.
  - *Proof of fix:* correct commands and a correction in an appended section.
- **MAJOR-9 — ACCOUNTS-SEPARATE's only test is `mock-provider.test.ts:262`.** No end-to-end two-account test exists. *Proof of fix:* one through fetch, extract, ratify and apply-voice.
- **MAJOR-10 — STAGING-PURGED rests on a regex over SQL (`staging-lifecycle.test.ts:13-58`).** Only ratify's purge is executed; discard, both TTL sweeps and disconnect are not. *Proof of fix:* Tier-1 cases for each.
- **MINOR-5 — runner classification.** The pre-existing ids `brief-assembly`, `learning-summarizer`, `post-regeneration`, `studio-suggestion` and `native-generation-carousel` are not individually asserted (`runner.test.ts:980-1000`). *Proof of fix:* a table-driven case over all ten.
- **MINOR-7 — `app-tests.yml:31` still says "THREE files".** `fetch-phase.test.ts` and `tick.test.ts` also import the real config.
- **NIT-6.** A missing `fetchRecentPosts` body passes the scan (`source-scans.test.ts:108`).

**Tier 3 re-run:**

| # | Result | Reddened |
|---|---|---|
| 13 | Hits are benign; the property holds | yes |
| 25 | One comment hit; the property holds | yes |
| 50 | Two self-hits in ADR prose; the property holds | yes |
| 51 | `context.ts` untouched; the property holds | no (would require a tree edit) |
| 52 | **33 hits, contrary to the record** | partial |

**Tier 3: 4/5 diff-verified.** **Tier E:** recorded, not run, and MEASURED-framed. `corpus.v2.json` is untouched.

## 11. SHARED-FUNCTION CALLERS (§11.5)

| Function | Callers | Tests |
|---|---|---|
| `upsertBrandVoice` | Six: `signup/actions.ts:155`, `infer-brand-voice/actions.ts:36`, `step-2/actions.ts:30`, `settings/voice/actions.ts:57`, `settings/voice/refine-from-posts-action.ts:51`, `step-4/backfill-actions.ts:207` (new). The ADR listed three. | The function is unchanged. The new caller is tested (mocked) at `backfill-actions.test.ts:211`; there is no pre-ratify test (MAJOR-1). |
| `runPrompt` classification | 10 pre-existing ids + 3 new | Partial (MINOR-5) |
| `updateSocialAccount` | None | Unit test only; all locked writers are service-role |
| `TwitterProvider.refreshAccessToken` | `twitter-provider.ts:309`, `:615`; `publishing/orchestrator.ts:216` | `twitter-provider.test.ts:305`, `:319`, `:449` |
| OAuth callback | One handler serves both entry points | `callback.test.ts` enqueue/resume/scopes |
| `deactivateSocialAccount` | `disconnect/route.ts:80` | `social-accounts.test.ts:168-205` (mocked) |
| Purpose writers | `generation-budget.ts:29`, `signal-triage-budget.ts:30`/`:75`, `backfill-daily-budget.ts:24` | Tier 1 via `reserve_ai_budget` (`ai-budget-purpose.test.ts:45`, `:55`) |

## 12. Scope (L-1)

Not shipped: comment mining, embeddings, exemplar selection, the outcome loop, retrieval or `CustomerContext` changes, LinkedIn `fetchPostMetrics`, widening of variations or examples, `relationship_memory`. **No findings.** Every migration has a single commit, and the DB-reviewer fixes were forward. The ECC budget shows invocations 2 of 3 and 3 of 3 in commit bodies; "1 of 3" is unrecorded, and there is no evidence of excess.

---

## Index

| ID | § | Summary |
|---|---|---|
| BLOCKER-1 | 10 | No CI runs for the range |
| BLOCKER-2 | 10 | Lint errors: `app-tests` red |
| BLOCKER-3 | 9 | `posts_extracted` never written; ratify unreachable |
| MAJOR-1 | 9 | Voice applied pre-ratify, with the form's role |
| MAJOR-2 | 8 | Ratify activates before its status guard |
| MAJOR-3 | 5 | Fetch bounds reset per call |
| MAJOR-4 | 5 | No resume duplicate-memory test |
| MAJOR-5 | 3 | Performance and audience caps unenforced |
| MAJOR-6 | 7 | Comment-read scan blind to helpers |
| MAJOR-7 | 10 | Tier-3 #52 "Zero hits" false |
| MAJOR-8 | 7 | Legal prose / Evidence Pack drift |
| MAJOR-9 | 10 | ACCOUNTS-SEPARATE unproven |
| MAJOR-10 | 10 | STAGING-PURGED only regex-checked |
| MAJOR-11 | 3 | Evidence errors fail the batch; `partial: false` |
| MAJOR-12 | 9 | §10.4 hierarchy incomplete |
| MINOR-1 | 3 | Unreconciled reservation on throw |
| MINOR-2 | 3 | Reconcile cross-reads |
| MINOR-3 | 5 | Import RPCs lack a status guard |
| MINOR-4 | 8 | Viewer can discard |
| MINOR-5 | 10 | Prompt ids not enumerated |
| MINOR-6 | 9 | Second voice editor |
| MINOR-7 | 10 | Stale CI comment |
| MINOR-8 | 6 | ADR: lock covers UPDATE only |
| MINOR-9 | 7 | ADR: unratified-candidate retention |
| MINOR-10 | 9 | ADR: ratify / voice ordering |
| NIT-1 | 5 | relname without namespace |
| NIT-2 | 5 | `.neq` excludes NULL |
| NIT-3 | 1 | Fields in transit |
| NIT-4 | 6 | Lock test omits `id` |
| NIT-5 | 1 | Refresh overwrites scopes |
| NIT-6 | 10 | Missing method passes scan |

Session 32 review complete - 31 findings (3 BLOCKER, 12 MAJOR, 10 MINOR, 6 NIT) over range 4f3e7129..3914a31c; 4/55 non-E BACKFILL-* constraints verified executed green in CI (Tier 1 0/16, Tier 2 0/34, Tier 3 4/5 diff-verified); Tier E recorded not run.

## CORRECTION PASS (Session 32-D)

**Author:** Session 32-D correction pass · **Date:** 2026-09-15 · **Range fixed:** `3914a31c..<D12-sha>`
**Reviewed head:** `3914a31c` — the head the Reviewer read; only this pass's section 4 landed after it, at D0
(`0038e94c`).
**Founder adjudications consumed:** A-7 = _pending_ (not required at this step; D9 gates on it), A-8 = _pending_
(not required at this step; D3 gates on it) (build-guide section 4).
**Everything above this line is the Reviewer's. Everything below it is this pass's.**

### D1 — BLOCKER-2: the two lint errors

| Field | Detail |
|---|---|
| **Finding** | BLOCKER-2 |
| **Fix** | `components/onboarding/BackfillBanner.tsx`: replaced `useState` + `useEffect(() => setDismissed(...))` with `useSyncExternalStore` over a per-`storageKey` external store (`getServerSnapshot` always returns `true`, so server and first client render match — no hydration mismatch, no synchronous setState in an effect). `lib/social/linkedin-provider.ts:74`: `new Date(v).toISOString()` replaced with `toUtcIso(new Date(v))`, imported from `@/lib/utils`. |
| **Proof** | `app/[locale]/(dashboard)/layout.test.tsx` (30 tests, unchanged, green — BackfillBanner is mocked there) and `lib/social/__tests__/linkedin-provider.test.ts` (green). Full `npm run test:app` (CI env block, `--no-file-parallelism`): 3837/3837 green — identical count to pre-fix HEAD, confirming zero regressions. `npx tsc --noEmit --skipLibCheck`: clean. `npm run lint`: 0 errors, 107 warnings (unchanged count). |
| **Reddening** | Two separate mutations, one file at a time, each followed by `git diff --stat` confirmed empty after restore: (1) restored original `linkedin-provider.ts:74` (`new Date(v).toISOString()`, no `toUtcIso` import) → `npx eslint lib/social/linkedin-provider.ts` failed at `74:96` naming `no-restricted-properties` ("'toISOString' is restricted..."). (2) restored original `BackfillBanner.tsx` (`useState(true)` + `useEffect(() => setDismissed(...))`) → `npx eslint components/onboarding/BackfillBanner.tsx` failed at `20:7` naming `react-hooks/set-state-in-effect` ("Calling setState synchronously within an effect..."). Both restored to the fix; `git diff --stat` matched the pre-mutation diff exactly each time. |
| **Commit** | `<D1-sha>` |

**Verification note (not a finding, not fixed by this step):** a parallel `npm run test:app` run intermittently fails `lib/signals/__fixtures__/eval/corpus-v2-schema.test.ts` ("the 40 GitHub examples are unchanged in count..." — expects 24 `card` verdicts, observes 0). Root cause: `scripts/eval/run-triage-eval.test.ts` writes the shared fixture `lib/signals/__fixtures__/eval/corpus.v2.json` to disk mid-test and restores it only in `afterEach`; under Vitest's default file-parallelism this races against `corpus-v2-schema.test.ts` reading the same path from a concurrent worker. This is a pre-existing test-isolation defect, out of L-1 scope and not one of the 31 findings — confirmed pre-existing and diff-independent: (a) `npm run test:app --no-file-parallelism` is green at 3837/3837 both at D0 HEAD and with D1's diff applied; (b) the identical failure shape was independently observed and traced to the same root cause under a wholly unrelated Session 31-D D1 diff (different files entirely), i.e. it is triggered by scheduling nondeterminism, not by what changed. This step's gate uses the serial (`--no-file-parallelism`) run as its evidence, matching `db-tests.yml`'s own precedent for a suite with shared on-disk fixture state.

**What I did NOT touch:** the 107 pre-existing lint warnings.

### D2 — MAJOR-6 + NIT-6: make the L-2 boundary scan able to fail

| Field | Detail |
|---|---|
| **Finding** | MAJOR-6, NIT-6 |
| **Fix** | `lib/backfill/__tests__/source-scans.test.ts`: `extractMethodBody` (body-only) replaced with `extractMethodDeclaration` (signature through matching closing brace). The second `BACKFILL-NO-COMMENT-READ` test no longer scopes its scan to `fetchRecentPosts`'s own body; it now scans the WHOLE provider file (`lib/social/twitter-provider.ts`, `lib/social/linkedin-provider.ts`), excising only the two separately declared, always-`NOT_IMPLEMENTED` stub methods' full declarations (`fetchEngagement`, `fetchPostMetrics`) before matching `COMMENT_READ_PATTERNS`. Chose "whole file minus two named carve-outs" over "`fetchRecentPosts` plus an enumerated callee list" per BUILD item 1: an enumerated list can silently shrink when a new private helper is added and the list isn't updated; "the rest of the file" cannot shrink that way — any new helper is scanned by construction. NIT-6: a missing/renamed `fetchRecentPosts` (`extractMethodDeclaration(...) === null`) is now collected into `missingFetchRecentPosts` and asserted `toEqual([])`, instead of the old `if (body === null) continue` silently treating absence as clean. |
| **Proof** | `lib/backfill/__tests__/source-scans.test.ts` (3/3 tests green on the clean tree). Full `npm run test:app` (CI env block, `--no-file-parallelism`): 3837/3837 green. `npx tsc --noEmit --skipLibCheck`: clean. `npm run lint`: 0 errors, 107 warnings (unchanged). |
| **Reddening** | Six plants, one at a time on the working tree, each followed by `git diff --stat` confirmed empty after restore: **P1** (the Reviewer's own finding) — `const _plantP1DoNotCommit = 'https://api.x.com/2/tweets/1/liking_users'` inside `TwitterProvider.fetchTimelinePage` → RED (`offenders: ['lib/social/twitter-provider.ts']`), previously green under the old scan. **P2** — the same literal inside `fetchRecentPosts` itself → RED. **P3** — `fetch('https://example.com')` added to `lib/backfill/orchestrator.ts` → RED (`BACKFILL-NO-URL-FETCH`). **P4** — a `website-fetcher` import added to `lib/backfill/extract.ts` → RED (`BACKFILL-NO-URL-FETCH`). **P5** — the string `'fetchEngagement'` added to `lib/backfill/extract.ts` → RED (`BACKFILL-NO-COMMENT-READ`, the unchanged `lib/backfill/**` half). **P6** (NIT-6) — `fetchRecentPosts` renamed to `fetchRecentPostsRenamedP6DoNotCommit` in `twitter-provider.ts` → RED (`missingFetchRecentPosts: ['lib/social/twitter-provider.ts']`), previously silently passing under `if (body === null) continue`. All six restored; `git diff --stat` showed zero change outside `lib/backfill/__tests__/source-scans.test.ts` after each restore. |
| **Commit** | `<D2-sha>` |

**What I did NOT touch:** the `lib/backfill/**` half of `BACKFILL-NO-COMMENT-READ` (P5's target) and `BACKFILL-NO-URL-FETCH` (P3/P4's target) — both unchanged in meaning, as the Reviewer's finding and BUILD item 3 required.

### D3 — the SQL: MAJOR-2, MAJOR-5, MINOR-3, MINOR-4, MINOR-8, MINOR-9, NIT-4, BLOCKER-3's writer · THE ONLY MIGRATION

**Gate:** A-8's Decision cell (build-guide section 4) was filled 2026-09-15 — founder accepted the recommendation:
retire unratified import candidates at `BACKFILL_STAGING_TTL_DAYS = 30` after the owning run's `completed_at`,
delete retired candidates 30 days after that (i.e. 2×TTL from `completed_at`). D3 proceeded on that ruling.

| Field | Detail |
|---|---|
| **Finding** | MAJOR-2, MAJOR-5, MINOR-3, MINOR-4, MINOR-8, MINOR-9 (per A-8), NIT-4, BLOCKER-3 (writer only — the panel surface is D4) |
| **Fix** | ONE forward migration, `supabase/migrations/20260915120000_backfill_correction_pass.sql` (never edits `20260913120000..20260914060000`): (1) **MAJOR-2** — `ratify_backfill_run`'s `status = 'awaiting_ratification'` guard now runs immediately after the `FOR UPDATE` lock/read, before any of the six memory UPDATEs or the staging DELETE (previously only the final UPDATE's WHERE clause checked it, after the mutations had already run). (2) **MINOR-4** — `discard_backfill_run`'s non-null `p_user_id` path now requires `business_members.status='active' AND (role='approver' OR is_admin)`, replacing "any active member OR the raw business owner"; the owner-fallback branch is redundant given `trg_ensure_owner_membership` (20260702120800) always gives the owner an `is_admin=true` row. The NULL-`p_user_id` system path (`deactivateSocialAccount`) is unchanged. (3) **MAJOR-5 + MINOR-3** — `import_evidence_memory`/`import_audience_memory`/`import_performance_memory` each gained, atomically inside the INSERT's own WHERE (never count-then-insert): a run-status='extracting' guard (MINOR-3), and MAJOR-5's per-run caps (audience<25, performance<15 — evidence's existing <40 from 20260914050000 is untouched except for adding the status guard to it). (4) **MINOR-8** — `REVOKE INSERT, DELETE ON public.social_accounts FROM authenticated, anon`, after a repo-wide grep (below) found no authenticated-role INSERT/DELETE caller. (5) **MINOR-9 per A-8** — new `sweep_expired_backfill_candidates(p_ttl_days integer)`: retires import candidate rows (`status 'candidate'->'retired'`) whose owning run is still `'awaiting_ratification'` with `completed_at` older than `p_ttl_days`, then deletes rows already `'retired'` whose owning run is STILL `'awaiting_ratification'` with `completed_at` older than `2*p_ttl_days` — the run-status re-check in stage 2 is what keeps a row retired via ratification-rejection or discard (whose owning run is `'ratified'`/`'discarded'`) permanently out of this sweep's delete path. Wired into `runBackfillTick` (`lib/backfill/orchestrator.ts`) as a fourth sweep via `sweepExpiredBackfillCandidates` (`lib/db/backfill-runs.ts`), reusing `BACKFILL_STAGING_TTL_DAYS = 30` — no new constant. (6) **NIT-4** — added the missing `id` case to `social-accounts-identity-lock.test.ts`'s `LOCKED_COLUMN_CASES` (no SQL change; the lock already covered `id`, only the test case was missing). (7) **BLOCKER-3's writer** — `resolve_backfill_posts` rewritten `LANGUAGE sql -> plpgsql`: increments `social_backfill_runs.posts_extracted` by rows moved to `'extracted'` or `'skipped'` (never `'failed'`, never merely staged), grouped per `run_id` via `WITH resolved AS (UPDATE ... RETURNING run_id) SELECT array_agg(run_id), count(*) INTO v_run_ids, v_count FROM resolved` (array_agg and count computed in the SAME statement that declares the CTE) followed by a second statement `UPDATE social_backfill_runs ... FROM (SELECT run_id, count(*) FROM unnest(v_run_ids) GROUP BY run_id) rc` — this two-variable shape exists because an earlier draft tried to reference a CTE across two separate top-level statements in one function body, which fails at runtime ("relation ... does not exist"); the database-reviewer independently re-derived this rewrite and confirmed it correct (zero-rows, multi-run, and 'failed'-status cases all handled). |
| **MINOR-8 grep, verbatim** | `git grep -n "from('social_accounts')\|INTO public.social_accounts\|DELETE FROM public.social_accounts" -- app lib supabase/migrations` returned every touchpoint in `app/api/social/[platform]/callback/route.ts` (service-role `serviceClient.upsert(...)`), `lib/db/social-accounts.ts` (all callers take a caller-supplied `client` param, but the only production caller of the one INSERT-capable function, `createSocialAccount`, is its own test file — zero production callers), `lib/social/{linkedin,twitter}-provider.ts` and `lib/social/vault.ts` (all reads/updates, no INSERT/DELETE with a caller client). No authenticated-role INSERT or DELETE caller exists anywhere in the codebase. Independently re-verified by the security-reviewer in D3's specialist pass (below). |
| **Specialist reviews (both invoked once, in parallel, before commit, per the D3 gate)** | **security-reviewer:** no BLOCKER/MAJOR. Confirmed the GRANT/REVOKE triad is consistent across all 6 new/replaced functions; `(p_ttl_days \|\| ' days')::interval` is not an injection vector (p_ttl_days is typed `integer`, coerced before the function body runs, no dynamic SQL anywhere); ratify/discard authorization is business-scoped via the locked run row, not caller input; independently re-confirmed the MINOR-8 grep; independently re-derived `sweep_expired_backfill_candidates`'s stage-1/stage-2 run-scoping and confirmed no cross-run/cross-business leakage is possible. Two non-blocking observations, both explicitly framed as out of this pass's 8-finding scope: (a) a **latent orphan case** — if stage 1 retires a run's candidates and the founder later ratifies that same run anyway, `ratify_backfill_run` only touches rows still `status='candidate'`, so the already-retired rows are silently skipped and become permanently unreachable by stage 2 (whose filter requires the run to STILL be `'awaiting_ratification'`, which it no longer is) — not exploitable, not a tenant-isolation issue, just a permanent-orphan retention edge worth a follow-up ticket if founder-facing SLAs ever depend on it; (b) a NIT on the sweep's six-CTE count-sum re-materializing each RETURNING set, acceptable at current scale (bounded by this same migration's 40/25/15 import caps). **database-reviewer:** no BLOCKER/MAJOR. Verified the `array_agg`/`unnest` rewrite is correct with no subtler version of the original CTE-scoping bug (explicit zero-rows/multi-run/'failed'-status analysis, see Fix above); verified all 6 functions follow the house SECURITY DEFINER pattern; verified migration idempotency (`CREATE OR REPLACE` / no-op `REVOKE`, confirmed via a real `supabase db reset` rerun); verified the retire/delete two-stage design has no unsafe race (row-level MVCC serializes a concurrent ratify against the sweep; whichever commits second simply no longer matches its own `status='candidate'` WHERE predicate). Two MINOR index-coverage findings, both explicitly framed as follow-up material, not blockers: **MINOR-idx-1** — `sweep_expired_backfill_candidates`'s `social_backfill_runs` filter (`status='awaiting_ratification' AND completed_at < ...`) has no supporting index (the only status-touching index, `social_backfill_runs_claim_idx`, is a partial index whose WHERE clause structurally excludes `'awaiting_ratification'`); every cron-tick invocation does a full sequential scan, invisible today given table size but a real regression risk as run history accumulates — candidate follow-up: `CREATE INDEX ... ON social_backfill_runs (completed_at) WHERE status = 'awaiting_ratification'`. **MINOR-idx-2** — the `*_memory` tables' `import_run_id` index is a bare btree, not composite with `status`; acceptable today because the outer CTE (`retire_runs`/`delete_runs`) is normally a tiny set of stale run ids, same shape as ratify/discard's own existing UPDATEs. One NIT: no test calls `resolve_backfill_posts` with zero matching ids to directly exercise the NULL-`array_agg` path (code is provably safe by inspection per the array_agg verdict; not directly asserted). Neither reviewer's findings required a code change to close MAJOR-2/MAJOR-5/MINOR-3/MINOR-4/MINOR-8/MINOR-9/NIT-4/BLOCKER-3-writer — all deferred as genuinely out-of-scope follow-ups, per the same precedent 20260913150000's own migration header used for its own deferred LOW/INFO items. |
| **Proof** | `npm run test:db` (local Docker Postgres, CLI 2.118.0-beta.46, the 17.6.1.111 image tag locally re-pointed at the known-good 17.6.1.113 digest to avoid the documented supautils SIGSEGV — db-tests.yml's own unresolved blocker, not a fix committed here): 59/59 files, 444/444 tests green, including every pre-existing Tier-1 file. `npx tsc --noEmit --skipLibCheck`: clean. `npm run lint`: 0 errors, 107 warnings (unchanged). `npm run test:app` (CI env block): 278/278 files, 3839/3839 tests green. |
| **Reddening** | All 7 SQL-level items reverted one at a time directly against the live local Postgres (via `CREATE OR REPLACE`/`REVOKE`/`DROP FUNCTION`, never editing the migration file itself), each followed by a targeted `vitest run` and then `npx supabase db reset` to restore: **MAJOR-2** — reverted to the pre-D3 guard-at-final-UPDATE-only shape → `ratify-backfill-run.test.ts`'s new "ratifying an 'extracting' run" test RED (`afterCandidate.status` was `'active'`, expected `'candidate'`). **MAJOR-5** — reverted audience/performance caps only (kept the status guard) → `memory-import-rpcs.test.ts`'s cap test RED (26 audience rows written, expected 25). **MINOR-3** — reverted the status guard only (kept the caps) → the same file's "discard, then each import RPC writes zero rows" test RED (evidence RPC wrote 1 row after discard, expected 0). **MINOR-4** — reverted to the pre-D3 "any active member OR owner" check → `backfill-discard-guard.test.ts`'s "a viewer discard raises" test RED (`error` was `null`). **MINOR-8** — re-GRANTed INSERT/DELETE to authenticated/anon → `social-accounts-identity-lock.test.ts`'s two new 42501 tests RED (both succeeded instead of erroring; the DELETE actually removed the fixture row, cascading a third test's failure too — further proof the revert took effect). **MINOR-9** — dropped `sweep_expired_backfill_candidates` entirely → all 5 non-EXECUTE-refusal tests in `backfill-candidate-retention.test.ts` RED ("Could not find the function ... in the schema cache"). **BLOCKER-3's writer** — reverted `resolve_backfill_posts` to its pre-D3 `LANGUAGE sql` form with no `posts_extracted` write → `backfill-resolve-posts.test.ts`'s main test RED (`posts_extracted` was 0, expected 5). **NIT-4** has no SQL to revert (the lock migration already existed; only the test case was missing), so no revert-RED applies — its coverage is additive by construction. Every revert was restored via `npx supabase db reset` (reapplying the committed migration set including this one), and the full 59-file/444-test suite was confirmed green again after each restore and once more at the end. `git diff --stat` against the migration file itself: empty throughout (all reverts were applied directly to the running Postgres instance, never to the file on disk). |
| **Commit** | `<D3-sha>` |

**What I did NOT touch:** `BLOCKER-3`'s panel-reachability half (D4); the two MINOR index-coverage gaps and the one latent-orphan retention edge both reviewers raised, all explicitly deferred as follow-ups outside this pass's 8 findings; the ADR §8.3/§7.3/§9.4 documentation amendments for MINOR-4/-8/-9 (D11, per the disposition table).

### D4 — BLOCKER-3: make the founder's review surface reachable

**D3's commit:** `98753597` (the SHA `<D3-sha>` above resolved to, filled in now that it's known).

| Field | Detail |
|---|---|
| **Finding** | BLOCKER-3 (panel-reachability half — the writer half closed at D3) |
| **Fix** | `app/[locale]/(dashboard)/onboarding/step-4/BackfillPanel.tsx:255`: the "nothing to learn" condition changed from `run.posts_extracted === 0 \|\| totalCandidates === 0` to `totalCandidates === 0 && run.staged_voice == null` — zero candidates in all three groups AND no staged voice, never a bare counter. The old condition had two independent bugs: (a) before D3, `posts_extracted` was never written, so it was always 0, making every real run with real candidates render "nothing to learn"; (b) even after D3 writes it correctly, `posts_extracted` can be legitimately nonzero with zero candidates (every processed post skipped) or, separately, a run can have zero memory candidates but a genuinely staged voice pending review — the OLD condition hid the voice-review link in exactly that case (`totalCandidates === 0` alone triggered nothing-to-learn regardless of `staged_voice`). `lib/backfill/extract.ts` needed NO call-site change — `runEvidenceBatch`'s existing `resolveBackfillPosts(extractedIds, 'extracted')` / `resolveBackfillPosts(skippedIds, 'skipped')` calls already flow through D3's fixed writer. |
| **Proof** | New `app/[locale]/(dashboard)/onboarding/step-4/BackfillPanel.pipeline.test.tsx` (2 tests, both green): the real-path test drives the ACTUAL `fetchPhase`/`runExtractionUnit` orchestrator/extractor (only their `lib/db`/`lib/ai`/`lib/social` boundaries mocked — same boundary `lib/backfill/__tests__/fetch-phase.test.ts`/`extract.test.ts` already use) through all four passes to `awaiting_ratification` with NO hand-set `posts_extracted` anywhere in the test, then renders `BackfillPanel` from the resulting real `run`/candidate state and asserts the ratify control and role fieldset are present. `BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL` (ADR §12 constraint 11) forbids importing `@/lib/social/mock-provider` from outside `lib/social/**`, so this uses a plain `SocialProvider`-shaped fake (the same pattern `fetch-phase.test.ts` already uses for the same reason), not the `MockProvider` class itself — `MockProvider`'s "standard" fixture is a fixed 230-post/913-day shape meant for `fetchPhase`'s own boundary tests; reproducing its exact shape here would add nothing the panel-reachability proof needs, so a smaller 6-post fake fixture is used instead, sized to exercise every pass (stats/voice/insights/evidence) and both the extracted and skipped resolution paths. `BackfillPanel.test.tsx` (13 tests, all green): added one new test proving zero candidates + a staged voice is NOT nothing-to-learn (the voice-review-link bug); removed `posts_extracted: 12` from the "complete" fixture (masked the old defect, asserted on nothing) while KEEPING `posts_extracted: 4` in the "partial" fixture (asserted via `"extracted":4` — genuinely about the count copy). `npx tsc --noEmit --skipLibCheck`: clean. `npm run lint`: 0 errors, 107 warnings (unchanged — the one pre-existing `BackfillPanel.tsx` warning, `onDismiss` unused, predates this change). `npm run test:app` (CI env block): 279/279 files, 3841/3841 tests green (was 278/3839 at D3). `npm run test:db`: 59/59 files, 444/444 tests green (D4 touches no SQL; re-run as a sanity check per the step's own VERIFY instruction). |
| **Reddening** | Two mutations, each followed by `git diff --stat` confirmed empty after restore: (1) restored the original `run.posts_extracted === 0 \|\| totalCandidates === 0` condition → the real-path pipeline test RED (`nothing-to-learn` rendered instead of `awaiting-ratification`; the "complete" and the new voice-link test in `BackfillPanel.test.tsx` also went RED, 2 failures). (2) stubbed D3's `posts_extracted` increment out inside the pipeline test's own mock `resolveBackfillPosts` (`if (false && n > 0 && ...)`) → the real-path test's `expect(runState.posts_extracted).toBe(6)` RED (`0` received) — proving the test genuinely depends on D3's writer being wired, not vacuously passing. Both restored; `git diff --stat` matched the pre-mutation diff exactly each time. |
| **Commit** | `<D4-sha>` |

**What I did NOT touch:** whether voice synthesis should gate on staged-post count (a real question the pipeline test's design surfaced — a truly-zero-post run still stages a non-null voice output today, so it can never reach the "nothing to learn" state through the full pipeline; not exploitable, not in BLOCKER-3's scope, no ticket filed); D5 onward.

### Backfilled blocks D5–D8 (written at D11 close-out)

**Author's note, not the D-steps' own record.** D5–D8 were committed without their appendix blocks (§4.2 requires
one block per step). The four blocks below were written afterwards, at D11, **from each step's commit body and diff**,
not from the sessions' own working notes. The **Reddening** cells therefore restate what each commit body says was
done; the D11 close-out did **not** re-execute those mutations (D7 and D8's need the local Postgres stack). What the
close-out did re-run is stated in each row's Proof cell: the app-layer proof files, green at HEAD.

### D5 — MAJOR-3 + NIT-2: fetch bounds are cumulative

| Field | Detail |
|---|---|
| **Finding** | MAJOR-3, NIT-2 |
| **Fix** | `lib/backfill/orchestrator.ts` `fetchPhase` bounds reads (500) and staged posts (200) against the run's cumulative totals across deferrals, resumes and reconnects, not per-call counters. `lib/db/backfill-runs.ts`: the resumable lookup includes runs with a NULL `error_code` (`error_code.is.null` OR `error_code.neq.caller_bug`), never a bare `.neq()`. |
| **Proof** | `lib/backfill/__tests__/fetch-phase.test.ts:427` (cumulative `platform_posts_read` persists across a deferral and a resumed call); `lib/db/backfill-runs.test.ts:49` (filter string) and `:61` (a NULL-code failed run is resumable). Re-run at close-out: green. |
| **Reddening** | Per commit body: the `:427` test RED against per-call counters; the `:49` test RED against a bare `.neq()`. |
| **Commit** | `d4755442` |

### D6 — MAJOR-11 + MINOR-1 + MINOR-2: a failed pass never looks complete, and never leaks spend

| Field | Detail |
|---|---|
| **Finding** | MAJOR-11, MINOR-1, MINOR-2 |
| **Fix** | `lib/backfill/extract.ts`: only output-validation failures fail an evidence batch; transient errors release the batch and reservation; any failed post marks the run `partial`. `lib/ai/runner.ts` and `lib/db/backfill-posts.ts`: every reservation reconciles on every exit path (a `finally`) against the call's own cost. |
| **Proof** | `lib/backfill/__tests__/extract.test.ts:199` (reconcile to actual cost), `:241` (throwing voice pass reconciles to 0), `:259` (two runs each reconcile their own cost), `:469` (either evidence-error kind reconciles to 0), `:485` (a failed evidence post finalizes `partial=true` with a reason); `BackfillPanel.pipeline.test.tsx` updated. Re-run at close-out: green. |
| **Reddening** | Per commit body: the bare `catch` restored → RED against the new transient-error test; the `finally` removed → RED against the reconcile-to-0 tests. |
| **Commit** | `ef76a1af` |

### D7 — MAJOR-4 + MAJOR-10: resume and staging purge executed, not regexed

| Field | Detail |
|---|---|
| **Finding** | MAJOR-4, MAJOR-10 |
| **Fix** | Tier-1 tests replace the SQL-regex "coverage": `supabase/__tests__/backfill-resume.test.ts` and `backfill-staging-purge.test.ts` added; the regex block removed from `lib/backfill/__tests__/staging-lifecycle.test.ts`. **Out-of-scope production bug found and fixed, disclosed in the commit body:** `deactivateSocialAccount` crashed on every real disconnect because `vault_access_token_id` was NOT NULL in the live schema; migration `20260917100000_social_accounts_vault_id_nullable.sql` drops the constraint, matching CLAUDE.md's disconnect spec. |
| **Proof** | `backfill-resume.test.ts:230` (crash between insights writes and `passes_done`, resumed with differently worded output: no duplicate or over-cap memory), `:170`, `:323`; `backfill-staging-purge.test.ts:103` (discard), `:115` (staging TTL sweep), `:131` (staged-voice TTL sweep), `:157` (disconnect). Tier-1: **not** re-run at close-out. |
| **Reddening** | Per commit body: D3's audience cap removed → RED on the duplicate/cap test; discard's staging DELETE dropped in a scratch migration applied locally only → RED on both discard-purge cases; each reverted, `git diff --stat` empty on the correction-pass migration. |
| **Commit** | `8042870f` |

### D8 — MAJOR-1 + MAJOR-9 + MINOR-10 (code half): voice only after ratify, only to the ratified role

| Field | Detail |
|---|---|
| **Finding** | MAJOR-1, MAJOR-9, MINOR-10 (code half; ADR half is D11) |
| **Fix** | `step-4/backfill-actions.ts` and `lib/validation/backfill.ts`: apply/decline require a `ratified` run and use the role recorded at ratification; a client-supplied `accountRole` is rejected at the Zod boundary. `BackfillPanel.tsx` and `step-2/page.tsx`: "Review voice" appears only after ratify. Two latent field-name bugs fixed in the same functions (disclosed in the commit body): `staged_voice` is written camelCase (`voiceAxes`, `examples`) but was read snake_case. |
| **Proof** | `backfill-actions.test.ts:239` (client `accountRole` rejected), `:268` (null role refused), `:302` (ratified founder run never calls `upsertBrandVoice`); `supabase/__tests__/backfill-accounts-separate.test.ts:206` (two accounts never cross-contaminate corpora, candidates or voices; Tier-1, **not** re-run at close-out). |
| **Reddening** | Per commit body: the ratified/role status check removed → RED on both guard tests; routing by a hardcoded branch instead of `run.account_role` → RED on both brand-routing tests. |
| **Commit** | `62516773` |

### D9 — MAJOR-12 + MINOR-6: the §10.4 hierarchy, on the editor A-7 rules on

**Gate:** A-7's Decision cell was filled 2026-09-17 — founder accepted the recommendation: reuse `VoiceEditor`
(axes-only founder mode, ≤3-example brand chooser), retire `BackfillVoiceReview.tsx`. D9 proceeded on that ruling.
**D9's code commit:** `458eb55f`. This block, and the step-2 page test it cites, were written afterwards (see "What
the commit did not carry").

| Field | Detail |
|---|---|
| **Finding** | MAJOR-12 |
| **Fix** | `lib/backfill/stats.ts`: `BackfillStatsSummary` gains `dateRange: { start, end } \| null`, derived from the same earliest/latest timestamps `spanDays` already uses. `app/[locale]/(dashboard)/onboarding/step-4/BackfillPanel.tsx`: the headline reads `summary.dateRange` via `formatDateRange` (never `summary.date_range`); item 2 renders the descriptor plus three strongest axes (`lib/voice/axis-labels.ts`, new); item 6 (cadence and format mix) is rendered from the run's own summary. All six §10.4 items render in order. i18n keys added in en, pt and es. |
| **Proof** | `BackfillPanel.test.tsx:295` builds its summary by calling `computeBackfillStats` (not a hand-written fixture) and asserts a non-empty date range, the voice section, `"count":7` on the pattern, the cadence section, and the six titles in ascending DOM position. `lib/backfill/__tests__/stats.test.ts:76` asserts `dateRange` carries the exact earliest and latest `published_at`; `:92` asserts `null` for no posts. |
| **Reddening** | Re-run at close-out against the committed tree, one at a time: (1) headline changed back to `(run.summary).date_range ?? ''` → `BackfillPanel.test.tsx:295` RED. (2) item 6 guard changed to `{false && (` → `BackfillPanel.test.tsx:295` RED. Each restored from a backup copy; `git status` afterwards showed no change to `BackfillPanel.tsx`. |
| **Commit** | `458eb55f` |

| Field | Detail |
|---|---|
| **Finding** | MINOR-6 |
| **Fix** | Per A-7: `step-2/BackfillVoiceReview.tsx` deleted. `components/voice/VoiceEditor.tsx` gains a `review` mode (locked axes for founder, ≤3-example chooser for brand). New `step-2/VoiceReviewHost.tsx` wires it to D8's gated apply/decline actions. `step-2/page.tsx` renders the host for a `ratified` run with a `pending`/`refused_cap`/`failed` voice, `Step2Form` otherwise. |
| **Proof** | `app/[locale]/(dashboard)/onboarding/step-2/page.test.tsx` (new, 6 cases): a ratified run with a pending voice renders `VoiceReviewHost`; `applied`, `declined` and `null` voice_status, an `awaiting_ratification` run, and no `?run` all render `Step2Form`. |
| **Reddening** | Removed `run.status === 'ratified' &&` from `step-2/page.tsx` → `page.test.tsx` "an un-ratified run falls through to Step2Form" RED. Restored from backup; `git status` afterwards showed no change to `page.tsx`. |
| **Commit** | `458eb55f` (code); the close-out commit carrying `page.test.tsx` and this block |

**What `/impeccable` changed, file by file** (one invocation, against ADR 0025 §10; `taste-skill` stays declined per
I2.14):
- `BackfillPanel.tsx`: the headline `<p>` became `<h2>`; each subsection title and `CandidateGroup`'s title became
  `<h3>`, so the six-item hierarchy is a screen-reader landmark. The voice-summary section's lone `bg-muted` box
  was dropped, matching the page's otherwise unboxed rhythm. No new tokens.
- No other file changed as a result of the audit; spacing, contrast pattern and responsive behaviour were recorded as clean.

**What the commit did not carry (disclosed, not a finding):** at `458eb55f` the VERIFY line "step-2 renders the A-7
editor for a ratified run and Step2Form otherwise" had no test, and this appendix block had not been written. Both
were closed afterwards, in the close-out commit. `VoiceEditor`'s new `review` mode has no direct component test; it
is exercised only through the host, which `page.test.tsx` mocks. That is a coverage gap left open, not asserted closed.

**Verification at close-out:** `npx tsc --noEmit --skipLibCheck` clean; `npm run lint` 0 errors, 108 warnings;
`npm run test:app` with the `app-tests.yml` env block: 1 failing file, `lib/signals/__fixtures__/eval/corpus-v2-schema.test.ts`
("the 40 GitHub examples are unchanged in count…"), the parallel-run race already recorded under D1's verification
note (`scripts/eval/run-triage-eval.test.ts` rewriting the shared fixture). Not caused by D9.

**What I did NOT touch:** D10 onward; the corpus fixture race.

### D10 — MINOR-5 + MINOR-7 + NIT-3 + NIT-5: the residue

| Field | Detail |
|---|---|
| **Finding** | MINOR-5 |
| **Fix** | `lib/ai/runner.test.ts`: a table-driven block over all ten pre-existing prompt ids, built from the real prompt objects (`brandVoiceInferencePrompt`, `briefAssemblyPrompt`, `learningSummarizerPrompt`, `postGenerationPrompt`, `postRegenerationPrompt`, `rubricPrompt`, `studioSuggestionPrompt`, `createNativeGenerationPrompt('single'\|'thread'\|'carousel')`). Only `outputSchema`, `useToolOutput` and the two message builders are swapped so the shared mock input and response validate; id, modelKey and temperature are the real ones. No production change. |
| **Proof** | `runner.test.ts:1126` — per id: Step-1 refuses under an exhausted trial; Step-8 increments the classified counter under a trial with quota (`brand-voice` for brand-voice-inference; `posts` for brief-assembly, learning-summarizer, post-regeneration, studio-suggestion, native-generation-carousel; none for post-generation, rubric, native-generation-single, native-generation-thread); a paid context is never refused and never increments. A guard case asserts exactly ten distinct ids. |
| **Reddening** | `RUBRIC_PROMPT_ID` changed to `'brief-assembly'` in `runner.ts` → the `brief-assembly` and `rubric` rows RED (plus three pre-existing classification tests). Restored; `git status` showed no change to `runner.ts`. |
| **Commit** | `b54c8ec4` |

| Field | Detail |
|---|---|
| **Finding** | MINOR-7 |
| **Fix** | `lib/backfill/__tests__/fetch-phase.test.ts:6` and `tick.test.ts:5` mock `'@/lib/config'`. `.github/workflows/app-tests.yml` comment corrected from "THREE files" to **FOUR**, not two-plus-three: with those two mocked, the files still loading the real config are `lib/config.test.ts`, `lib/signals/orchestrator.test.ts`, `lib/campaigns/generate.test.ts` and `BackfillPanel.pipeline.test.tsx`; the last was missing from the comment. |
| **Proof** | Both backfill files pass in a shell with none of the CI env vars (23 tests); before the change they failed to load there. |
| **Reddening** | Deleted the mock line from `tick.test.ts` → the file failed to load in the bare shell. Restored from backup. |
| **Commit** | `b54c8ec4` |

| Field | Detail |
|---|---|
| **Finding** | NIT-3 |
| **Fix** | **Recorded, not narrowed** — the spec's own fallback. X's `tweet.fields` selects whole objects, so `entities` cannot be reduced to `entities.urls`, and the parser needs `urls` to decode t.co links. `referenced_tweets` stays (ADR §2.4 quote-dropping). `entities.mentions` therefore transits; it is stripped at `XTweetEntitiesSchema` (declares `urls` only) before any `RecentPost` exists. Comment at `twitter-provider.ts` above `X_TIMELINE_TWEET_FIELDS` records this. **For D11: the ADR amendment must record the in-transit exposure.** No expansion added. |
| **Proof** | Unchanged request test `twitter-provider.test.ts:404` still asserts `exclude=replies,retweets` and no `expansions`; full suite green. No new test: a claim of absence is not made here, the exposure is recorded. |
| **Reddening** | None applicable; no behaviour changed. |
| **Commit** | `b54c8ec4` |

| Field | Detail |
|---|---|
| **Finding** | NIT-5 |
| **Fix** | `lib/social/twitter-provider.ts` refresh UPDATE spreads `scopes_granted` only when X returns `scope`. |
| **Proof** | `twitter-provider.test.ts:319` now asserts the UPDATE payload has no `scopes_granted` key when scope is absent; `:305` (scope present → persisted) unchanged and green. |
| **Reddening** | Restored `scopes_granted: parsed.scope ? … : []` → `:319` RED. Restored from backup. |
| **Commit** | `b54c8ec4` |

**Process note (disclosed):** my first NIT-5 edit was blocked by a hook and I misread the tool output as applied; the
first mutation run therefore "reddened" code that never had the fix. Caught when the full suite failed on clean code;
the fix was applied and the NIT-5 reddening redone against it. The row above is the second, valid run.

**Verification:** `npx tsc --noEmit --skipLibCheck` clean; `npm run lint` 0 errors, 108 warnings; `npm run test:app`
(CI env block, `--no-file-parallelism`) 280/280 files, 3894/3894 tests.

**What I did NOT touch:** classification logic in `runner.ts`; no new CLAUDE.md carve-out; the `entities` field set.

### D11 — documentation truth: MAJOR-7, MAJOR-8, NIT-1, and the ADR halves of MINOR-4/-8/-9/-10  ·  no code

| Field | Detail |
|---|---|
| **Finding** | MAJOR-7 |
| **Fix** | `docs/decisions/0025-social-read-path-and-backfill.md` §15.1 (appended; §§0–14 untouched): states that §14.1's "Zero hits" for constraint 52 was wrong — the command printed 33 signature lines and cannot see bodies — and that the property held on manual reading. #50 is corrected to exclude `docs/` (it matched the ADR's own prose). #52 is replaced by a body-aware script (text after the first `AS`; flags an unscoped SELECT over a `*_memory` or `social_backfill_*` table), with the two service-role TTL sweeps allow-listed by name and reasoned. |
| **Proof** | Commands and outputs pasted in ADR §15.1. #50: `0` clean; planted `-- relationship_memory placeholder` → `17751:+-- relationship_memory placeholder`. #52: `files=12 hits=0` clean; planted unscoped VIEW → `hits=1`; planted function with `p_business_id` in its signature but an ignoring body → `hits=1` (the case the old grep passed by construction). |
| **Reddening** | Both plants applied to `20260915120000_backfill_correction_pass.sql` one at a time and restored from a backup copy; `git diff --stat` on that file was empty afterwards. |
| **Commit** | `747246b3` |

| Field | Detail |
|---|---|
| **Finding** | MAJOR-8 |
| **Fix** | `content/legal/privacy.en.mdx` retention rows (lines 113–114) now say what the code does: unreviewed imported items are retired at 30 days and deleted 30 days after (A-8); `usage_data` excerpts expire 12 months after the source post, other saved excerpts stay until deleted, removed per post, or the account is deleted. `docs/evidence/0010-legal-evidence.md` gains **Amendment A3.1**, correcting A3's four statements (evidence expiry; caps, enforced only since D3; no indefinite candidates, true only since D3/A-8; "5 pages / 500 reads", true only since D5). A3 is unedited. |
| **Proof** | A3.1 cites `lib/memory/import.ts:66-70`, `memory-import-rpcs.test.ts:241`, `backfill-candidate-retention.test.ts:100/:128`, `fetch-phase.test.ts:427`. `git diff 70773e87 -- docs/evidence/0010-legal-evidence.md` shows 0 deletions; `git diff 3914a31c` on ADR 0025 shows 0 deletions; `grep -c "LEGAL ENTITY" privacy.en.mdx` is 2 before and after; the `AWAITING COUNSEL REVIEW` comment is retained. |
| **Reddening** | Not applicable (documentation). |
| **Commit** | `747246b3`; `evidenceRef` bumped in the follow-up commit (two-commit form, as I2.15 did: the SHA that carries A3.1 cannot be inside itself). |

| Field | Detail |
|---|---|
| **Finding** | NIT-1 — **recorded closure** |
| **Fix** | ADR §15.5: the lookup is in a committed, applied migration whose DO block already executed; no forward migration can alter it; the `v_count <> 1` guard turns ambiguity into a loud failure at apply time. No code change. |
| **Commit** | `747246b3` |

**The ADR half of MINOR-4, MINOR-8, MINOR-9, MINOR-10:** ADR §15.4 (discard needs approver/admin, proved `backfill-discard-guard.test.ts:89`; voice needs a ratified run and `run.account_role`, "Review voice" placement in §10.4 superseded), §15.2 (identity lock covers INSERT and DELETE, `social-accounts-identity-lock.test.ts:130/:145`), §15.3 (A-8 rule verbatim plus the new §8.3 row, `backfill-candidate-retention.test.ts:100/:117/:128/:139`). Also in §15: §11.5's `upsertBrandVoice` row corrected to six callers (§15.6), and D10's NIT-3 exposure recorded (§15.7). §14.2's CI column is not filled — D12's.

**Verification:** `lib/db/__tests__/d2.5-backfill-rows.test.ts` green. **Not run:** Tier-1 (`supabase/__tests__`) — Docker is not running on this machine; D11 changes no `.ts`, `.tsx` or `.sql`, so no Tier-1 behaviour can have moved.

**What I did NOT touch:** ADR §§0–14 and A3; §14.2's CI column; `[LEGAL ENTITY]`; any `.ts`/`.tsx`/`.sql`.

### D12 — BLOCKER-1: pushed, CI read; the appendix closing block

| Field | Detail |
|---|---|
| **Finding** | BLOCKER-1 |
| **Fix** | The branch (`origin` was at `7202da89`, 33 commits behind) was pushed to `origin/session-30-5-adr-0028` at `c6f087d2`, non-force. Three workflows ran on PR #9 (`pull_request` event). |
| **Proof** | **app-tests** [35436353104](https://github.com/tcr430/SOSH/actions/runs/35436353104) green; skip-guard quoted from the log: `277 file(s) under [app, lib, components] all visible, zero failures — green. (3894/3894 tests passed)`. **eval** [35436353102](https://github.com/tcr430/SOSH/actions/runs/35436353102) green. **db-tests** [35436353116](https://github.com/tcr430/SOSH/actions/runs/35436353116) **RED**: `skip-guard: 7 failing test(s)` and three suites skipped as invisible; the container log shows `server process (PID 3717) was terminated by signal 11: Segmentation fault` inside the test window, `OOMKilled=false`. Analysis and what it does not establish: ADR 0025 §15.10. |
| **Reddening** | Not applicable. |
| **Commit** | `c6f087d2` (head pushed) |

**BLOCKER-1 is closed for what it asked: the range was pushed and the runs exist and were read. It is NOT closed to
"green" for db-tests.** The rule of this pass is that Tier 1 stays uncovered unless db-tests itself is green; it is
not, so it stays uncovered.

#### All 31 findings

| Finding | Disposition | Proving test | SHA(s) |
|---|---|---|---|
| BLOCKER-1 | Pushed; app-tests and eval green, db-tests red (crash), Tier 1 uncovered | CI runs above | `c6f087d2` |
| BLOCKER-2 | Fixed | `npm run lint` 0 errors; `linkedin-provider.test.ts`; each original line reintroduced and shown to fail lint | `2867dd34` |
| BLOCKER-3 | Fixed (writer, then panel reachability) | `BackfillPanel.pipeline.test.tsx`; `backfill-resolve-posts.test.ts` | `98753597`, `661d8240` |
| MAJOR-1 | Fixed | `backfill-actions.test.ts:239/:268/:302` | `62516773` |
| MAJOR-2 | Fixed | `ratify-backfill-run.test.ts:258` | `98753597` |
| MAJOR-3 | Fixed | `fetch-phase.test.ts:427` | `d4755442` |
| MAJOR-4 | Fixed | `backfill-resume.test.ts:230` | `8042870f` |
| MAJOR-5 | Fixed | `memory-import-rpcs.test.ts:241` | `98753597` |
| MAJOR-6 | Fixed | `source-scans.test.ts` (six plants shown RED) | `aa69063b` |
| MAJOR-7 | Fixed (documentation) | ADR §15.1 commands with planted violations | `747246b3` |
| MAJOR-8 | Fixed (documentation) | Evidence Pack A3.1; `privacy.en.mdx` rows | `747246b3`, `c6f087d2` |
| MAJOR-9 | Fixed | `backfill-accounts-separate.test.ts:206` | `62516773` |
| MAJOR-10 | Fixed | `backfill-staging-purge.test.ts:103/:115/:131/:157` | `8042870f` |
| MAJOR-11 | Fixed | `extract.test.ts:199/:241/:469/:485` | `ef76a1af` |
| MAJOR-12 | Fixed | `BackfillPanel.test.tsx:295`; `stats.test.ts:76` | `458eb55f`, `c9b81b4f` |
| MINOR-1 | Fixed | `extract.test.ts:485` | `ef76a1af` |
| MINOR-2 | Fixed | `extract.test.ts:199/:259` | `ef76a1af` |
| MINOR-3 | Fixed | `memory-import-rpcs.test.ts` (discard-then-import) | `98753597` |
| MINOR-4 | Fixed (code and ADR) | `backfill-discard-guard.test.ts:89`; ADR §15.4 | `98753597`, `747246b3` |
| MINOR-5 | Fixed | `runner.test.ts:1126` | `b54c8ec4` |
| MINOR-6 | Fixed per founder ruling A-7 (reuse `VoiceEditor`) | `step-2/page.test.tsx` | `458eb55f`, `c9b81b4f` |
| MINOR-7 | Fixed | `fetch-phase.test.ts:6`, `tick.test.ts:5` pass in a bare shell | `b54c8ec4` |
| MINOR-8 | Fixed (code and ADR) | `social-accounts-identity-lock.test.ts:130/:145`; ADR §15.2 | `98753597`, `747246b3` |
| MINOR-9 | Fixed per founder ruling A-8 (code and ADR) | `backfill-candidate-retention.test.ts:100/:128`; ADR §15.3 | `98753597`, `747246b3` |
| MINOR-10 | Fixed (code half D8, ADR half D11) | `backfill-accounts-separate.test.ts:206`; ADR §15.4 | `62516773`, `747246b3` |
| NIT-1 | **Recorded closure** — no code change can express it | ADR §15.5 | `747246b3` |
| NIT-2 | Fixed | `backfill-runs.test.ts:49/:61` | `d4755442` |
| NIT-3 | Recorded, not narrowed (X cannot select `entities.urls` alone) | ADR §15.7 | `b54c8ec4`, `747246b3` |
| NIT-4 | Fixed | `social-accounts-identity-lock.test.ts` (`id` case) | `98753597` |
| NIT-5 | Fixed | `twitter-provider.test.ts:319` | `b54c8ec4` |
| NIT-6 | Fixed | `source-scans.test.ts` (missing `fetchRecentPosts` RED) | `aa69063b` |

Count check (run at close-out over this table): **31 rows, 31 distinct IDs**. The single recorded closure is NIT-1;
NIT-3 is a recorded decision rather than a code change. The adjudicated executions are MINOR-6 (A-7) and MINOR-9
(A-8). The four code-plus-ADR closures are MINOR-4, MINOR-8, MINOR-9 and MINOR-10.

#### The Reviewer's "could NOT verify" list

- **CI results and skip-guard counts** — now cited above. app-tests: 277 files, 3894/3894. db-tests: red, so its
  skip-guard counts are a failure report, not coverage.
- **Tier-1 execution** — db-tests ran and crashed (§15.10). Local Tier-1 runs are recorded in the D3, D7 and D8
  blocks but are not CI coverage. Still unverified in CI.
- **Live X API response shape; the LinkedIn read body; the 10-minute latency target** — still unverifiable. No live
  call was made in this pass.
- **What `ecc:database-reviewer` and `ecc:security-reviewer` reported** — D3's reviews are recorded in full in its
  block above. The I2.4 and I2.6 reviews remain known only from their commit-body summaries.

#### Reviewer "Verified" entries that have since changed (the entries themselves are untouched)

- **§14.1's "Zero hits" for constraint 52** is superseded by ADR §15.1.
- **Every entry that described the disconnect path or `social_accounts` grants** now sits over a changed schema:
  `vault_access_token_id` is nullable (D7's migration) and INSERT/DELETE are revoked from `authenticated` (D3).
- **Entries on `scopes_granted` refresh behaviour (§6)** are changed by D10: an absent `scope` no longer writes `[]`.
- **Entries on the step-2 voice surface and the §10.4 hierarchy** are changed by D8/D9: `BackfillVoiceReview.tsx`
  no longer exists.

#### Not solved, not run

LinkedIn cold start is **not solved** (A-1; the provider still reports `historicalReadAvailable = false`). Tier E
(#55, `BACKFILL-POPULATED-MEMORY-EVAL`) is **MEASURED — NOT YET RUN**, though it is now performable through the
product. No claim is made here about the quality or memory yield of the backfill.

#### D12 addendum — db-tests fixed and re-read (author: correction pass, after `ed14894b`)

The closing block above records db-tests as RED at `c6f087d2` and Tier 1 as uncovered; that stays as written. Cause
per the workflow's own comment and the log's `signal 11`: Postgres image `17.6.1.111` (broken supautils). Fix
`15beb540`: shadow the tag with `17.6.1.113`, and fail the job unless the DB container's image ID matches. Re-read at
`15beb540`: db-tests [35436865202](https://github.com/tcr430/SOSH/actions/runs/35436865202) **green** —
`skip-guard: 62 file(s) under [supabase/__tests__] all visible, zero failures — green. (452/452 tests passed)`;
app-tests [35436865152](https://github.com/tcr430/SOSH/actions/runs/35436865152) green (277 files, 3894/3894); eval
[35436865175](https://github.com/tcr430/SOSH/actions/runs/35436865175) green. The seven tests that failed pass with no
change to them. **Tier 1 is now executed green in CI** (ADR 0025 §15.11); "Tier-1 execution" in the Reviewer's could-not-verify
list is answered. All three runs are `pull_request` events, so the promotion tally is unchanged.
