# Session 25 — C2.9 Verification Report

**Range:** `be5779e1^..d173fa8a` (C2.1..C2.8, ADR 0018 Track C — diff-based learning capture).
**Scope:** verification only, no new features, per `docs/build-guide/session-25.md` C2.9.
**Tools used:** `ecc:pr-test-analyzer` (invoked once to sanity-check the constraint-table REDDEN judgments below — its findings are folded in, not appended separately).

---

## 1. Local verification

- `npx tsc --noEmit --skipLibCheck` — clean.
- `npm run test:app` (`vitest run app/ lib/ components/`) — **166 files, 2330 tests, all green.**
- `npm run test:db` (`vitest run supabase/__tests__ --no-file-parallelism --retry=2`) — requires `.env.local` loaded explicitly (the bare npm script does not load it; used `dotenvx run -f .env.local --`). **192 tests executed, non-zero (ADR 0015 skip-guard satisfied).**
  - First run surfaced a real regression: `governed-memory-recency-column.test.ts`'s `performance_memory: recency_at falls back to created_at when last_confirmed_at is NULL` case violated the `performance_memory_distilled_requires_pattern_key` CHECK constraint added by C2.5/C2.3 (Amendment B). The fixture predates that constraint (last touched at ADR 0016 B0/B1/B2.0, before Track C). Fixed by adding `pattern_key` to the `source='distilled'` insert for the `performance_memory` case only. Re-ran green (8/8).
  - Two failures remain, **confirmed unrelated to this range** (files last touched by commits predating C2.1, migrations they depend on predate Track C, re-run showed one was a transient Supabase-auth rate-limit, not a logic failure):
    - `get-user-business-ids-matrix.test.ts` — "active member sees the business row and its post" (ADR 0013 §3 matrix, unrelated table).
    - `rls-policy-lockdown.test.ts` — "business_deletion_requests has exactly one authenticated SELECT policy" (unrelated table, migrations from June 2026).
  - Not fixed under this session's "no new features" scope — flagged for the Reviewer / a separate fix, not swept under the rug.

---

## 2. SHARED-FUNCTION CALLERS tables

One row per caller, per CLAUDE.md's SHARED-FUNCTION CALLERS rule. A caller with no listed test is `AUTHORED-NOT-EXECUTED` for that caller even if a sibling caller is fully covered.

### `approvePost` (`lib/db/posts.ts:320`)

| Caller | `file:line` | Kind | Covering test | Status |
|---|---|---|---|---|
| `approvePostAction` | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:89` | Server Action | `actions.test.ts` — **added this session** (`describe('approvePostAction', ...)`, 3 tests) | now EXECUTED |
| `approvePostFromCalendarAction` | `app/[locale]/(dashboard)/calendar/actions.ts:280` | Server Action | `calendar/actions.test.ts` (`describe('approvePostFromCalendarAction', ...)`) | EXECUTED |

**Finding, closed:** before this session, `approvePostAction` had **zero direct test coverage**. `actions.test.ts` never imported or called it. It was referenced only as a `vi.fn()` mock in `PostCard.test.tsx` (mocked, never asserted-on) and in `ApprovalsInbox.test.tsx` (asserts the UI *calls* the mocked action with the right id — proves UI wiring, not the action's own body: Zod validation, the `approvePost` call, error mapping). This is the exact `AUTHORED-NOT-EXECUTED` shape CLAUDE.md's rule exists to catch, on the exact function pair the ADR names. Closed by adding `describe('approvePostAction', ...)` to `actions.test.ts` (success path, Zod rejection, DB-error mapping) — 3 tests, all green.

### `bulkApproveDraftPosts` (`lib/db/posts.ts:526`)

| Caller | `file:line` | Kind | Covering test |
|---|---|---|---|
| `bulkApprovePostsAction` | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:207` | Server Action | `actions.test.ts` (`describe('bulkApprovePostsAction', ...)`, 6 tests, real invocation) |
| ↳ `PostsClient` | `app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx:133` | Client Component | `PostsClient.test.tsx` (asserts the correct rendered-id set is passed) |
| ↳ `ApprovalsInbox` | `app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx:123` | Client Component | `ApprovalsInbox.test.tsx` (asserts the correct rendered-id set is passed) |

**Correction to ADR §3.4's own table:** the ADR lists `actions.context-equivalence.test.ts` as a second covering test for `bulkApprovePostsAction`. Verified false — that file imports and tests only `regeneratePostAction` (`describe('regeneratePostAction caller — context reaches the PROMPT capped (MAJOR-4)', ...)`); it contains zero references to `bulkApprovePostsAction`. Not a coverage gap (the function is still fully covered by `actions.test.ts` + the two UI test files above), but the ADR's own citation is stale/wrong and should not be trusted at face value — exactly why this audit exists.

**Note on the three Client Component rows:** per `ecc:pr-test-analyzer`'s review, these three tests (calendar action, `PostsClient`, `ApprovalsInbox`) prove their caller reaches the correct lower-level function with the correct arguments — they cannot observe the DB trigger firing (Tier-2 tests mock the Supabase client by construction). The actual proof that *any* caller's resulting `UPDATE` enqueues a `post_edit_signals` row is Tier-1's raw-`UPDATE`-from-no-app-code test (`LEARN-CAPTURE-ALL-CALLERS` below) — this is the ADR's own stated design (§3.4: "covered by construction"), not a gap.

### `createPosts` (`lib/db/posts.ts:288`)

| Caller | `file:line` | Kind | Covering test |
|---|---|---|---|
| `generatePostsForCampaign` | `lib/campaigns/generate.ts:380` | internal lib (service-role) | `generate.test.ts` (byte-identical `rendered_content`/thread-payload round-trip through `post_ai_originals`, plus a snapshot-write-failure-propagates-not-swallowed test) |

Single caller, fully covered.

### `neutralize()` (`lib/ai/wrap-evidence.ts:83`)

| Caller (enclosing function) | `file:line` | Covering test | REDDEN-if-broken confirmed |
|---|---|---|---|
| `guard()` → `wrapEvidenceForPrompt` | `lib/ai/wrap-evidence.ts:103` | `wrap-evidence.test.ts` ("neutralizes a `[/DATA]` closer embedded in evidence content") | yes |
| `briefAssemblyPrompt.buildUserMessage` | `lib/ai/prompts/brief.ts:117,124` | `brief.test.ts` (Unicode-obfuscated `[/DATA]` closer, audience + brand candidates) | yes |
| `postGenerationPrompt.buildUserMessage` | `lib/ai/prompts/post-generation.ts:179` | `post-generation.test.ts` ("neutralizes a hostile topContent pattern") | yes |
| `postRegenerationPrompt.buildUserMessage` | `lib/ai/prompts/post-regeneration.ts:147` | `post-regeneration.test.ts` ("neutralizes a hostile topContent pattern") | yes |
| `guardExcerpts` / `guardTierZeroSummaries` | `lib/ai/prompts/learning-summarizer.ts:66,78` | `learning-summarizer.test.ts` (hostile-pattern defusal for both excerpts and tier-zero summaries, plus byte-identical-for-benign-content) | yes |
| `generatePostsForCampaign` (opener scoring) | `lib/campaigns/generate.ts:266` | `generate.test.ts` ("neutralizes the opener before scoring it — a fence in the opener never reaches the rubric raw") | yes |
| `critiqueBrief` | `lib/campaigns/brief.ts:173` | `brief.test.ts` ("routes the brief's own narrative and proofPlan through neutralize() before they reach the rubric") | yes |

All 7 callers confirmed with a real hostile-input assertion (not just "the function was called") — each would fail if `neutralize()` were bypassed or weakened. `formats/native-generation-prompt.ts` — named as a third `topContent` render site in ADR §10.4 — does not actually render `topContent`/`recentPostPerformance` at all (confirmed by grep; this matches a prior-session finding that the ADR's original three-site citation was stale, only two real sites exist). No gap.

---

## 3. ADR §13's 21 `LEARN-*` constraints — constraint → test → executing CI job → tier

`app-tests` = `app-tests.yml` (`vitest run app/ lib/ components/`, every push/PR). `db-tests` = `db-tests.yml` (`vitest run supabase/__tests__`, live Postgres).

| # | Constraint | Tier | Test file(s) | CI job |
|---|---|---|---|---|
| 1 | `LEARN-SNAPSHOT-SEPARATE` | 0 / 1+3 | Table's existence is implicit in every Tier-1 `learning-capture-*.test.ts` insert. **Correction (pr-test-analyzer):** `lib/db/types.test.ts`'s `satisfies PostUpdate` assertions do **not** test this — they'd compile identically whether or not a speculative field was ever added, so citing them overclaims. The "`PostUpdate` unchanged" half is a Tier-3 prose fact (ADR §2.6), confirmed by inspection (no `ai_original`-shaped field was added to `PostUpdate`), not by a runtime or compile-time test. | db-tests (table existence only) |
| 2 | `LEARN-SNAPSHOT-WRITE-ONCE` | 1 | `learning-capture-write-once-and-erasure.test.ts` | db-tests |
| 3 | `LEARN-CAPTURE-AT-TRANSITION` | 1 | `learning-capture-trigger.test.ts` (fires on raw draft→approved UPDATE; not on unrelated UPDATE; not on other transitions; skips snapshot-less posts without failing) | db-tests |
| 4 | `LEARN-CAPTURE-ALL-CALLERS` | 1+2 | Tier-1: `learning-capture-trigger.test.ts` (raw UPDATE from no app code; bulk-UPDATE-N-rows-in-one-statement). Tier-2: the six caller tests in §2 above | db-tests + app-tests |
| 5 | `LEARN-MODE-AGNOSTIC` | 1 | `learning-capture-trigger.test.ts` (same raw-UPDATE test — keys off the transition, no origin-specific branching in the trigger body) | db-tests |
| 6 | `LEARN-HEURISTIC-FIRST` | 2 | `classify.test.ts` | app-tests |
| 7 | `LEARN-CLASSIFY-DETERMINISTIC` | 2 | `classify.test.ts` | app-tests |
| 8 | `LEARN-CORRECTION-REQUIRES-BRIEF` | 2 | `classify.test.ts` | app-tests |
| 9 | `LEARN-CORRECTION-PREFERENCE-ENFORCED` | 1+2 | Tier-2: `classify.types.test.ts` (`@ts-expect-error` compile assertion) + `rehydrate.test.ts` (Zod `.literal()` guard). Tier-1: `performance-memory-pattern-key.test.ts`'s `LEARN-VOICE-WRITE-TRIGGER` tests (same DB trigger) | app-tests + db-tests |
| 10 | `LEARN-VOICE-WRITE-TRIGGER` | 1 | `performance-memory-pattern-key.test.ts` — 5 tests, confirmed strong by `pr-test-analyzer` (real inserts against live Postgres, reject/accept both asserted, fail-closed NULL case, post-insertion-taint escape hatch) | db-tests |
| 11 | `LEARN-NO-SINGLE-DIFF-PROMOTION` | 2 | `promote.test.ts` (one diff never promotes) + `lib/db/memory-performance.ts`'s `listPerformanceMemoryCandidates` `.eq('status','active')` filter (retrieval returns active only) | app-tests |
| 12 | `LEARN-PROMOTION-THRESHOLD` | 1+2 | Tier-2: `promote.test.ts` (5/0.70/2 arithmetic incl. `K=2` vs `K=3` boundary, contradiction, demotion). Tier-1: `performance-memory-promotion.test.ts` (promotes/demotes EXACTLY ONCE under 10 concurrent calls; no-op when gate unmet) | app-tests + db-tests |
| 13 | `LEARN-TICK-IDEMPOTENT` | 1+2 | Tier-1: `learning-capture-trigger.test.ts` (UNIQUE rejects duplicate; unapprove→re-approve refreshes pending/leaves processed untouched; claim RPC disjoint under concurrency). Tier-2: `orchestrator.test.ts`'s replayed-tick test. **Note (pr-test-analyzer):** the Tier-2 half alone only proves "an empty claim batch writes nothing" — it does not itself prove a real replay against already-processed rows yields an empty batch; that's proven by the Tier-1 UNIQUE/refresh tests. The combination is sound and matches §12's own split. | db-tests + app-tests |
| 14 | `LEARN-MEMORY-THROUGH-BOUNDARY` | 2+3 | Tier-3 (grep half): confirmed by inspection this session — zero `.from('performance_memory'\|'post_ai_originals'\|'post_edit_signals')` calls in `lib/learning/*.ts` outside test files. **Tier-2 half: genuine, confirmed gap** — no test asserts this programmatically (`promote.test.ts`/`orchestrator.test.ts` mock `lib/db/memory-performance.ts`'s exported functions, so a hypothetical direct `.from(...)` call added to `lib/learning/` would pass silently). `lib/db/businesses.caller-migration.test.ts`'s `collectSourceFiles`-style pattern already exists in this codebase and could close this cheaply — not built here (verification-only scope). | unmapped (Tier-2 half) |
| 15 | `LEARN-SUMMARY-DATA-GUARDED` | 2 | `learning-summarizer.test.ts` | app-tests |
| 16 | `LEARN-PATTERN-RENDER-GUARDED` | 2 | `post-generation.test.ts` + `post-regeneration.test.ts` | app-tests |
| 17 | `LEARN-VOICE-NOT-AUTO-MUTATED` | 2+3 | Tier-3 half: no `*_voice_memory` migration (confirmed). **Tier-2 half: genuine, confirmed gap** — no test asserts `brand_voices` is never written by `lib/learning/*`; true today only by inspection (one comment-only mention in `classify.ts:116`, zero `.from('brand_voices')` calls). Same fix as #14 available. | unmapped (Tier-2 half) |
| 18 | `LEARN-RLS-ISOLATED` | 1 | `learning-capture-rls.test.ts` — 10 tests, cross-tenant SELECT/INSERT/UPDATE/DELETE denied on both new tables, `USING` and `WITH CHECK` proven separately | db-tests |
| 19 | `LEARN-CASCADE-COMPLETE` | 1+3 | Tier-1: `learning-capture-write-once-and-erasure.test.ts`'s "erasure SUCCEEDS" test. Tier-3: the two §D2.5 rows in `0010-legal-surface.md:1071-1072` (confirmed present) | db-tests |
| 20 | `LEARN-BRIEF-DIFF-DEFERRED` | 3 | no test by decision — confirmed no `campaign_brief_revisions` migration exists | n/a |
| 21 | `LEARN-VOICE-SUGGESTION-DEFERRED` | 3 | no test by decision — confirmed no suggestion-surface route/component exists under Track C | n/a |

**Result: 19/21 constraints map to an executing test in a named CI job (or are correctly Tier-3 no-test-by-decision). 2 genuine gaps found (#14, #17, both the Tier-2 half of a 2+3-tier constraint) — reported now per this task's own mandate, not fixed here (verification-only scope; a `collectSourceFiles`-style source-scan test would close both cheaply as a fast-follow).**

---

## 4. Tier-3 diff-verified properties — confirmed as recorded decisions (ADR §12)

All seven confirmed true by inspection this session:

1. **The two §D2.5 cascade rows exist** — `docs/decisions/0010-legal-surface.md:1071-1072` (`post_ai_originals`, `post_edit_signals`, both CASCADE, both annotated "cascade = erasure").
2. **No `*_voice_memory` migration** — `ls supabase/migrations/ | grep voice_memory` → empty.
3. **No new dependency in `package.json`** — `git diff be5779e1^..HEAD -- package.json` shows zero changes across the entire C2.1–C2.8 range.
4. **No Tier-2/Tier-3 agentic loop anywhere in the track** — `grep -rn "runPrompt\|anthropic\." lib/learning/*.ts` (excluding tests) returns exactly one call site, `lib/learning/summarize.ts:130`, a single one-shot `runPrompt` call per business per tick — no critique/regenerate loop, no tool-calling loop.
5. **No route under `app/[locale]/(dashboard)`** — `git diff be5779e1^..HEAD --diff-filter=A -- "app/[locale]/(dashboard)"` → no new files.
6. **No new i18n keys** — `git diff be5779e1^..HEAD --stat -- i18n/` → no changes.
7. **No `campaign_brief_revisions` table** — `grep -rl "campaign_brief_revisions" supabase/migrations/` → no matches.

---

## 5. CI — pushed and executed

See commit message for the `app-tests`/`db-tests` run URLs and the `db-tests` executed count, recorded after push per ADR 0015 ("covered" means executed green in CI, never authored). Per `docs/build-guide/session-25.md`'s own note: a `pull_request`-event run does **not** count toward the three-consecutive-green-on-`master` promotion rule — this PR's run is recorded, promotion is not claimed.
