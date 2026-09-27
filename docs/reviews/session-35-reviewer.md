# Session 35 — Track M — Reviewer (M3) report

**Scope reviewed: `bfb3bf72..5431fa84`; all citations are `git show <sha>:<path>` at that range, never HEAD.**
(Mechanically: every file was read from a detached worktree checked out at `5431fa84`, with LF line endings. Every
suite and mutation ran in scratch worktrees at that SHA, never in the working branch.)

**ADR 0029 read at `bfb3bf72`; `docs/build-guide/session-35.md` read at `bfb3bf72`; reviewed artefacts read at
`bfb3bf72..5431fa84`.** `bfb3bf72` is docs-only: it adds exactly those two files (2 files, 3222 insertions). The
Section 2 precondition holds, so this is not a finding. Neither document changes inside the range.

Commits in range (11): `f1f33632` M2.1 · `38b2371e` M2.2 · `2b6cb4b4` M2.3 · `d8b2010a` M2.4 · `4a96fdfa` M2.5 ·
`23394ba3` M2.6 · `8607fff4` M2.7 · `4f59f496` M2.8 · `4dcdd623` M2.9 · `9c3a5cc7` M2.10 · `5431fa84` M2.11.
Each of the six migrations is touched by exactly one commit (`git log --follow`). No migration was edited after it
was committed; the review fixes are the forward migration `20260925150000`.

---

## 0. What I ran, and what it showed

| Check | Result |
|---|---|
| **CI at `5431fa84`** (PR #15, `pull_request` runs) | **`app-tests` RED** (run 36336820699): Typecheck ✓ → **Lint ✗** → vitest **skipped** → skip-guard ✗ (`/tmp/app-results.json` ENOENT). **`db-tests` GREEN** (run 36336820707). The skip-guard line read from the log: `skip-guard: 107 file(s) under [supabase/__tests__] all visible, zero failures — green. (1091/1091 tests passed)`. `pull_request` runs do not move the db-tests promotion tally. |
| `npm run typecheck` | clean |
| `npx eslint` | **1 error**: `InterviewPanel.tsx:391:22 react-hooks/set-state-in-effect`. The same error CI reports. |
| `npm run test:app` (CI dummy env) | 370 files / 5427 tests green (LF checkout). On a `core.autocrlf=true` checkout, 1 test fails; see NIT-1. |
| `npm run test:db` (CI-equivalent env from `supabase status -o env`) | 107 files / 1091 tests green. Same totals as CI. |
| The `42501` member-write test, re-run | `interview-member-write-closed.test.ts` + `interview-ratify.test.ts`: 66/66. The assertion is `error.code === '42501'` **and** `/permission denied/` (`:149-150`, `:161-162`), not "a non-null error". |
| Concurrent ratify | `interview-ratify.test.ts:210-228` uses **two real `pg.Client` connections**. It asserts outcomes `['not_awaiting','ratified']`, the round counters, and **every memory row's status** (`:224`). This is Tier 1 and discharges #10. |
| Governance keys smuggled into `p_items`, live Postgres, rolled back | Envelope, item and counters carried `business_id` (another tenant), `status`, `confidence`, `source`, `sensitivity`, `public_use_permission`, `scope`, `scope_ref`, `expires_at`, `observation_count` and `last_confirmed_at`. Written rows: brand `interview / candidate / 0.60 / internal / brand / NULL / 1`, `last_confirmed_at = answered_at`, expiry +540 d; evidence `0.40 / public_use_permission false`. Foreign-tenant rows: **0**. A regex over `pg_proc.prosrc` of the writer and ratify RPCs finds **no jsonb read of any governance key**. |
| A form field carrying another id, sent to every Server Action (scratch test) | save / skip-question / skip-round / submit / ratify all call their wrapper with `getUser()`'s id; `userId` / `p_user_id` / `businessId` are stripped. |
| Thinness `>=` → `>` (scratch) | Reddens: `thinness.test.ts` "effective 1 / target 2 is 0.5 and THIN" fails (1 of 40). Restored clean. |
| The Tier-3 scans, reddened by me | One planted violation per scan, in different roots from the Builder's plants: `lib/db/memory-interview.ts` (21), `app/api/cron/interview-sweep/route.ts` (23), `app/[locale]/(dashboard)/interview/page.tsx` (24, via `@/lib/signals`), a dynamic `await import` of the writer under `app/` (5), a `.from('evidence_memory')` under `app/` (4), and one migration carrying a fifth purpose, a `user_can` re-definition, `REVOKE … ON performance_memory` and `SET public_use_permission = true` (32, 34, 14, 20), plus an `EmailKind` member (33) and a sixth `sanitizeDataField` (43). **11 failed / 35 passed**, each failure naming its constraint. Reverted: 46/46. The five-roots floor (`source-scans.test.ts:152-162`) asserts all five roots non-empty at `5431fa84`. Every scan has a planted positive and negative in-file. |
| `sanitizeDataField` baseline | `git grep 'function sanitizeDataField'` over production `lib/` + `app/`: **5 at `bfb3bf72`, 5 at `5431fa84`**. This matches the M2.0 number the scan pins (`source-scans.test.ts:360`), not the guide's authoring-time eight. |
| `pg_constraint` on the four memory tables | Exactly **one** `source` CHECK per table, validated. brand/evidence/audience admit `'interview'`; **`performance_memory_source_check` is still `manual, distilled, import, outcome`**. No stale CHECK survives. All four interview CHECKs per table are present (plus a span-length CHECK). |
| Grants | brand/evidence/audience: `authenticated` and `anon` hold only SELECT, REFERENCES and TRIGGER (no INSERT, UPDATE, DELETE or TRUNCATE). New tables: `anon` holds **nothing**; `authenticated` holds SELECT, REFERENCES and TRIGGER. `performance_memory` grants are unchanged. Policies: exactly one `*_select_own` per table, InitPlan form. |
| EXECUTE on the 11 interview RPCs | `postgres`, `service_role` only, on every one. All are `SECURITY DEFINER`, `search_path=public, pg_temp`. |
| `silent-failure-hunter` (my one subagent) | Its output is used as evidence below (MAJOR-2, NIT-2). One of its claims is **wrong**, and I say so at NIT-2. |

**Could NOT verify, and why.** Whether founders actually answer (no tenant has run a round). Whether extraction is
faithful to real multi-locale answers (no live model call; every extraction test mocks the provider). Whether a human
reads the span before accepting an adversarial record (human behaviour). Whether interview memory improves any post
(`S34-E2E-UNVERIFIED` is still open; nothing in this range claims otherwise, correctly). Whether `after()` with a
voided promise is actually cut off on Vercel Fluid (MAJOR-2 does not depend on it). A `supabase db reset`: I did not
reset the author's local DB. The local run is corroborating; **CI's fresh-chain db-tests run is the authority** for
Tier 1. I did not run `/impeccable`: the §8 audit below is my own read of the rendered component source, not a
browser session.

---

## 1. Provenance, the writer and write access (§2; L-4, L-5, L-7, D-7, A-2)

**Verified correct.**
- **Governance on the written row (item 1).** In `write_interview_candidates` (`20260925150000:369-610`, the live
  definition) every one of `source`, `status`, `confidence`, `sensitivity`, `public_use_permission`, `scope`,
  `scope_ref`, `observation_count` and `business_id` is a SQL literal or `v_business_id`. `last_confirmed_at` is read
  from the answer row (`:534`); `expires_at` is computed from category and `answered_at` (`:537-560`). The function
  reads only `answerId, type, category, text, span, storedText, storedSpan` and three counters from `p_items`. The
  extraction schema (`lib/ai/prompts/interview-extraction.ts:34-63`), the memory layer
  (`lib/memory/interview.ts:45-88, 116-160`) and every Server Action schema (`lib/validation/interview.ts`) carry no
  governance field. `z.strictObject` is used at every model-output and memory-layer level.
- **Member closure (item 2).** `20260925100000` drops exactly the nine `*_insert_own`, `*_update_own` and
  `*_delete_own` policies, REVOKEs INSERT, UPDATE, DELETE and TRUNCATE from `authenticated, anon`, and keeps
  `*_select_own`. No `performance_memory` object is named. The M2.2 body carries **both** REDDEN directions
  (pre-migration 15 failed, with writes succeeding; post-migration 24 passed).
- **SHARED-FUNCTION CALLERS for the policy change.** Every `.from('brand_memory'|'evidence_memory'|'audience_memory')`
  at `5431fa84` lives in `lib/db/memory-{brand,evidence,audience}.ts`, and all are reads.

  | Reader | Client | Executed test at or after `38b2371e` |
  |---|---|---|
  | `listBrandMemoryCandidates` | passed (service role on generation) | `lib/memory/brand.test.ts` (mocked); Tier 1 `planner-tools-tenancy`, `studio-promote-brief-end-to-end` |
  | `listEvidenceMemoryCandidates`, `getEvidenceMemoryByIds` | passed / service role | `lib/memory/evidence.test.ts`, `wrap-evidence*.test.ts`, `verify-claims`, triage (mocked); Tier 1 `signals3-*`, `planner-tools-tenancy` |
  | `listAudienceMemoryCandidates` | passed | `lib/memory/audience.test.ts` (mocked); Tier 1 `planner-tools-tenancy` |
  | `listEvidenceCandidatesForRun`, `listAudienceCandidatesForRun` | **member RLS client** | **no page test** (see MINOR-8); DB half executed by the candidate-SELECT control in `interview-member-write-closed.test.ts` |
  | new: `list{Brand,Audience,Evidence}InterviewCandidates`, slot-row reads | member RLS client | Tier 2 mocked only; the DB half (member SELECT) is Tier 1 via `interview-rls-cascade` / `member-write-closed` |
  | `readInterviewConflictContext` → the three `list*MemoryCandidates` | service role, business-scoped | `interview-conflicts.test.ts` (mocked) |
- **`enforce_memory_import_immutable`, `ratify_backfill_run`, `discard_backfill_run`, `user_can` and
  `purge_business`** do not appear in any `CREATE … FUNCTION` line of the range's migration diff. Their existing
  Tier-1 files run green in the CI run. `neutralize` and `neutralizeWithSentinels`: `lib/ai/wrap-evidence.ts`
  is unchanged in the range.
- The barrel (`lib/memory/index.ts`) only adds exports, and the stale §1.5 comment is corrected. Step 4 gains one
  line (`step-4/page.tsx`, the pointer).
- The sibling trigger `enforce_memory_interview_immutable` (`20260925110000:347-382`) permits span → NULL only
  together with the stamp.
- `lib/ai/runner.ts` is a shared function **not listed in §11.1**. The change widens `isBackfillPass` to one new
  prompt id and leaves every other id's behaviour unchanged (covered by `runner.test.ts`). Noted, not a finding.

Findings for this section: **MINOR-4** (stored forms are not SQL-verified) and **MINOR-8** (step-4 reader).

## 2. Question selection (§3; L-2, L-3, D-1, D-2)

Verified: thinness and selection tests use **literal** numbers and instants and import no threshold from
`constants.ts` (`thinness.test.ts:8-13, 51-67`; `select.test.ts:28-33`). The boundary pairs 0.5 thin / 0.25 not
and 180 d weight 1 / 181 d weight 0.5 are present. The first round is pinned to the exact eight keys in order.
The `>=`→`>` mutant reddens. 5..8 is enforced three times: Zod (`select.ts` `interviewSelectionSchema`), SQL
`question_count` CHECK plus `UNIQUE (round_id, position)` plus position 1..8, and `create_interview_round`
(`20260925150000:312-315`).

- **MAJOR-1**: `INTERVIEW-NO-REPEAT` breaks once a business's history passes 33 rows.
- **MINOR-7** (ADR finding): the §3.3 / §3.4 tie-break contradiction.

## 3. Extraction (§4; D-3, D-4)

Verified:
- There is one Sonnet 4.6 call (`interview-extraction.ts:78-79`, `maxTokens: 4500`).
- Grounding (`extract.ts:86-96, 156-178`) resolves the model's span to a **raw** substring of the raw answer,
  which is what the SQL `strpos` then checks (`20260925150000:513`).
- The stored forms are neutralised at the single choke point (`lib/db/memory-interview.ts:112-122`).
- Evidence text equals span in TS (`extract.ts:169-174`; `lib/memory/interview.ts:62`) and in SQL (`:519`).
- A redacted answer raises (`:507-510`).
- Ungrounded and D-4 drops are counted and persisted (`:594-596`).
- The hedge check is a flag, never a drop (`extract.ts:191`).
- D-4 is a drop (`:175-177`).
- Both lexicons are tested per locale with a negative per locale (`lexicon.test.ts:34-43, 108-112`).
- Trial counters are neither read nor written: the runner exempts the prompt id (`runner.ts:79-81, 129, 316`) and
  `extract.ts` imports no trial layer.

Findings:
- **MAJOR-3**: hedge, conflict and replace are never shown.
- **NIT-2**: the per-answer cap drop is uncounted.

## 4. Cadence and delivery (§5; D-5, A-5)

Verified:
- Due is computed on read (`due.ts`). No cron creates rounds.
- Every non-terminal status has a path to terminal via the sweep (`20260925140000:384-399`, including `submitted`,
  a Builder fix).
- The sweep route has the dual auth of `extract-outcomes`, makes no model call, and emits exactly one canonical
  `interview.sweep.tick` line with `null` (not zero) counters on a throw (`route.ts`).
- The QStash row and the counsel line are in `docs/launch-checklist.md`.
- No `EmailKind` was added; the `EmailKind` scan reddens on a plant.

Findings:
- **MAJOR-2**: the stuck-extraction safety net is unreachable.
- **MINOR-2**: the card and badge ignore role.
- **MINOR-6** (ADR finding): a `failed` round locks the founder out for 30 days.
- **NIT-4**: the `not_due` state is effectively unreachable.

## 5. Injection, personal data, retention (§6; L-5, A-3) — the walkthrough, re-run against the shipped code

| ADR §6.2 stage | Where it happens at `5431fa84` | Result |
|---|---|---|
| 1 Save | `lib/validation/interview.ts:12` (≤ 2000), `save_interview_answer` (`20260925150000:139`), column CHECK | Survives, stored raw. ✓ |
| 2 Prompt | `interview-extraction.ts:117-131`: **every** answer and **every** existing record goes through `neutralize()` inside `[DATA]` in the one `buildUserMessage`, with no branch. Tested for several answers (`interview-extraction.test.ts:131-136`) and for records (`:138-147`). No new sanitizer (count 5 = baseline). | Mitigation. ✓ |
| 3 Model obeys | Schema `z.strictObject` at item and root level (`:34-63`). Test `extract.test.ts:103-110` is **exact-match**: `issues[0].code === 'unrecognized_keys'`, keys `['confidence','public_use_permission']`. The obeying round becomes `failed / invalid_response`, reconciled (`:114-119`). | **Structural kill 1 confirmed in code.** |
| 4 Conflict id | `sentExistingIds` comes from `readInterviewConflictContext(businessId)`, where `businessId` is **derived by the claim from the round** (`extract.ts:235, 245-248`). The intersection is at `extract.ts:193`. | **Structural kill 2 confirmed in code.** |
| 5 Grounding | raw-span containment in TS then SQL | Survives, as the ADR says. |
| 6 Writer | fixed columns (my live smuggle run above) | Survives, inert: `candidate`, which active-only reads never return. |
| 7 Ratification | `InterviewPanel.tsx:487-633`: per item, no accept-all, span quoted beneath every record (`:590-593`), evidence permission marker (`:595`), Ratify enabled only when all are decided (`:506, 625`) | **Human kill**, as named. |
| 8 If accepted | read-side `neutralize()` and the approval gate: unchanged code | As named. |

**The residual is still the one the ADR names.** I agree with the accounting: the content half dies only by human
judgement, and ratification is **not** a structural control. One qualification belongs in the ADR's residual
statement: because of MAJOR-3, the ratifier also lacks the hedge and conflict cues §4.4 and §4.5 promised as
aids to that judgement.

Retention verified:
- Both `answer_text` and `interview_span` are NULLed at terminal + 30 d, in ADR order (`20260925140000:436-488`).
  The stub survives, and the tests backdate to literal ±1-minute deadlines (`interview-sweep.test.ts:111-235, 290`).
- A ratified round's active rows are touched only in their span (`:246`).
- Every terminal transition stamps `terminal_at`, including skip (`20260925120000` `skip_interview_round`),
  `no_records`, `ratified`, `expired` and `failed`.

Findings:
- **MAJOR-4**: rejected candidates are retained indefinitely.
- **MINOR-4**: stored forms are not SQL-verified.

## 6. Cost and bounds (§7; A-4)

Verified:
- The claim is a single conditional UPDATE with no INSERT branch (`20260925120000:441-494`), with the 10-minute,
  ceiling and attempt guards.
- Reconcile is attempt-bound (`20260925150000:31-99`) and runs on every outcome, including a thrown model error
  (`extract.ts:258-264`) and a write failure (`:294-297`).
- A refused claim is a typed outcome (`:234`) and is correctly **not** reconciled.
- The writer's flip is guarded and its counters are recomputed. `ON CONFLICT DO NOTHING` uses the three partial
  UNIQUE indexes.
- No fifth budget purpose (the scan reddens on a plant).

Findings: none beyond NIT-3 (a scan blind spot).

## 7. The UX contract (§8; L-6, D-6, A-1)

**Verified, and each is separately legible from persisted status** (`page-state.ts:52-116`, `InterviewPanel.tsx`):
- **States:** all twelve §8.2 states. `no_records`, `extraction_failed` and `failed` are distinct statuses with
  distinct copy and icons, and `no_records` shows the dropped counts.
- **No accept-all** in any state.
- **Span:** quoted beneath every record, or a redaction notice.
- **Evidence:** not editable (no textarea; Zod and SQL both refuse), and carries its permission marker.
- **Controls:** native `<select>` for category. Accept and Reject accessible names include the record
  (`:600, 609`).
- **Live regions:** polite, at 80% and 100% only (`:388-394, 416-418`).
- **Storage and timers:** no browser storage for answers and no time limit.
- **Forbidden patterns:** no `asChild`, no `dangerouslySetInnerHTML`, no `console.*` in the new UI.
- **i18n:** en/pt/es parity is tested, including every bank question and why-line.

**What taste-skill and impeccable changed** (per the M2.10 body): taste-skill was **invoked and applied nothing**,
declaring the surface out of its scope (NIT-5). impeccable changed two things: 44 px targets on four text buttons
and the `<select>`, and a distinct icon per single-block state. Neither touched the §8 contract. The ADR finding
recorded in `InterviewPanel.tsx:13-19` is MAJOR-3.

Findings:
- **BLOCKER-1**: the lint error in this file.
- **MINOR-1**: action failures are swallowed.
- **MINOR-3**: the D-4 set-aside note is missing at ratification.
- **MINOR-9**: page state is reloaded on every render.
- **NIT-4**: the `not_due` state.

## 8. GDPR, tenancy and RLS (§9; L-8)

Verified (and see the grants and policies in §0):
- **Tenancy (item 3).** No RPC except `create_interview_round` and `snooze_interview` takes a business id (NIT-6).
  Both verify membership **before** anything else (`20260925150000:296-306`; `20260925120000:393-403`). Every other
  RPC derives the business from the row it looks up or locks. The writer rejects an answer of another round or
  business (`:496-505`). Replace re-verifies same business, `active` and `source='interview'` in SQL
  (`20260925140000:222-229`, plus the retire UPDATE's own predicate at `:286-289`). `p_user_id` is `getUser()`'s id
  in every action (`actions.ts:54-57`, verified by scratch test). `retryInterviewExtractionAction` adds its own
  membership check because the claim takes no user (`:184-188`). That is correct, and noted.
- **Ratify order (item 6)**, read line by line in `ratify_interview_round` (`20260925140000:86-321`):
  1. lock (`:87-90`)
  2. status no-op (`:97-99`)
  3. approver OR `is_admin` (`:102-111`)
  4. validate everything, including every candidate decided exactly once, a candidate of **this** round and
     business, and replace targets (`:114-254`)
  5. writes (`:258-307`)
  6. guarded flip (`:311-324`)

  Tests: an admin non-approver succeeds (`interview-ratify.test.ts:285`); an editor raises (`:270`); a candidate
  of another round is rejected (`:343`).
- **Tables.** Both new tables have ON DELETE CASCADE from `businesses` explicitly, answers also from their round,
  memory → answer is NO ACTION, and a partial UNIQUE covers the non-terminal statuses.
- **§D2.5.** Both rows are **byte-identical** to ADR §9.4 (compared by script against `2b6cb4b4:docs/decisions/0010-legal-surface.md`) and are in the M2.3 commit (`git show 2b6cb4b4 --stat`).
- **Purge.** A root DELETE and `purge_business`, each with interview memory rows present
  (`interview-rls-cascade.test.ts:227-243`).
- **Legal.** No `content/legal` or `docs/evidence` file was touched in the range, and no `[LEGAL ENTITY]`
  placeholder was edited.

No findings in this section.

## 9. The test plan (§10–11)

| Tier | Rows | Executed green in CI at `5431fa84` | Local, by me |
|---|---|---|---|
| Tier-1 component | 24 | **24/24**: db-tests, 107 files / 1091, skip-guard green (a `pull_request` run; does not move the promotion tally) | 1091/1091 |
| Tier-2 component | 18 | **0/18**: app-tests stopped at Lint, vitest never ran (BLOCKER-1) | green (5427/5427) |
| Tier-3 component | 11 | **0/11** in CI (the scans run inside app-tests) | **11/11 re-reddened by me** against plants and restored |
| Rows fully CI-green (every component) | 44 | **15/44**: the 15 pure-Tier-1 rows (1, 2, 3, 7, 9, 10, 13, 18, 28, 30, 31, 36, 37, 38, 39) | — |

"Green" does not mean "holds" for two Tier-2 rows. **#17 `INTERVIEW-NO-REPEAT`** passes only on fixtures smaller than
the bank (MAJOR-1). **#27 `INTERVIEW-HEDGE-FLAGGED`** and the surfacing half of **#26** are green on a computation
nobody sees (MAJOR-3). The constraint→CI map in `docs/current-phase.md` says "Zero of the 44 are CI-executed-green
… the branch is unpushed". That was true at the commit, but it is now superseded: CI has run, and `app-tests` is red.

No Tier-E constraint is declared, correctly (§10.4). Retrieval-into-briefs is recorded as NOT MEASURED, with no
instrumentation added. That is correct given M2.0's premise-13 finding.

## 10. Scope and documents

L-1 holds:
- **No forbidden writes.** No write to `performance_memory` or `brand_voices`, and no path sets
  `public_use_permission` true (scans, plus the live smuggle).
- **No forbidden surfaces or dependencies.** No audio or chat surface. No import from `lib/campaigns/` or
  `lib/signals/` in any interview module, including the out-of-root files `interview-coverage.ts`,
  `interview-conflicts.ts`, `InterviewCard.tsx`, the prompt and the validation file.
- **No platform changes.** No `MemoryQueryContext` change. No retirement of a non-interview row (the SQL
  predicate). No model-generated question. No fifth onboarding step.
- **No new platform entries.** No new `EmailKind`, budget purpose or `user_can` capability.

§13 documents landed:
- ADR 0016 Amendment E and the two D2.5 rows (in M2.3).
- The ADR 0025 second-consumer note.
- `launch-checklist.md`: the interview-sweep QStash row and the counsel line.
- `current-phase.md`, `pre-launch-scope.md` §10 (left unchecked), `product-status.md`, `ideas.md` and `backlog.md`.

The measurement statement is honest. It says plainly what is not measured and that nothing proves posts improved,
and it names `S34-E2E-UNVERIFIED` as open. No sentence implies a quality gain.

ECC budget: three Builder subagents (code-explorer at M2.0, inferred from the M2.5 body's "remaining" line;
database-reviewer at M2.6; security-reviewer at M2.8). Within budget.

Finding: **MINOR-5** (ADR 0027 amendment not recorded).

---

## Findings

### BLOCKER-1 — The required `app-tests` gate is RED at the head; no Tier-2 or Tier-3 constraint has executed in CI
- **What:** ESLint error `react-hooks/set-state-in-effect` at
  `app/[locale]/(dashboard)/interview/InterviewPanel.tsx:390-394`. It is the `useEffect` that `setAnnouncement`s on
  the 80% and 100% crossings. CI run 36336820699: Lint fails, the vitest step is **skipped**, and the skip-guard
  fails on the missing JSON. Reproduced locally (`npx eslint`: 1 error). M2.10's verification lines list tsc and
  vitest but **not eslint**, which is the step that fails. `docs/current-phase.md`'s map ("the branch is unpushed")
  is now stale.
- **Why it matters:** `app-tests` is a **required** merge gate (CLAUDE.md, ADR 0015 §5). Every Tier-2 and Tier-3
  claim in this session is locally green only: `AUTHORED-NOT-EXECUTED` by the constitution's definition.
- **Proven fixed when:** an `app-tests` run at a new head is green, with its skip-guard line read from the log
  (`app lib components` suites visible, zero failures). The announcement still fires only at the two crossings
  (a render test), and the `current-phase.md` map is re-dated to that run.

### MAJOR-1 — `INTERVIEW-NO-REPEAT` fails once history exceeds the bank size; the query truncates the cooldown set
- **What:** `lib/db/founder-interview-answers.ts:63-75` `listInterviewCooldownRows` orders by
  `question_key ASC, answered_at DESC` and applies `LIMIT INTERVIEW_BANK_SIZE` (33) to **rows**, not keys. It is
  called by `startInterviewRoundAction` (`actions.ts:98`) and `loadInterviewPageState`. Once a business has more
  than 33 answered or skipped rows (about five monthly rounds), rows for alphabetically later keys fall outside the
  limit, and those keys are treated as never asked.
- **Reproduced:** a scratch vitest drove the real `selectQuestions` / `computeSlotThinness` through ten monthly
  rounds with the query's ORDER BY and LIMIT applied. From month 7 (history > 33 rows) it re-asks
  `usage_data_number` **31 days** after it was answered, then `question_repeated` (31 d), `problem_cost` (62 d) and
  `question_first_call` (93 d). The Builder reported the risk in the M2.7 body and did not fix it. The Tier-2 tests
  pass only because their fixtures are smaller than the bank.
- **ADR finding too:** §9.5 fixes "cooldown keys … limit = bank size", which is correct only with one row per key.
- **Proven fixed when:** a test (Tier 1 against the real query, or Tier 2 over the real ORDER BY/LIMIT) seeds more
  than 33 rows in which a late-sorting key was answered within 180 days, and asserts that key is not selected. The
  mutant that restores the row-limited query must redden. The §9.5 bound is amended.

### MAJOR-2 — A lost or stuck extraction has no path out except the 7-day sweep, and the 10-minute re-claim is unreachable
- **What:**
  - Extraction is started only by `after(() => { void extractInterviewRound(roundId) })`
    (`actions.ts:165-167, 190-192`). The promise is voided, so it is neither returned to `after()` nor caught, and a
    thrown defect or the `AggregateError` from `extract.ts:227` is an unhandled rejection with no Sentry capture.
    The cron route two files away does capture. silent-failure-hunter found this; I verified it.
  - The 10-minute re-claim in `claim_interview_extraction` (`20260925120000:465-466`) has **no caller that can reach
    it**. `retryInterviewExtractionAction` fires only when status is `extraction_failed` (`actions.ts:188`), submit
    fires once, and no cron claims.
  - The `extracting` screen is **not polled** (`InterviewPanel.tsx:148-157`, no interval; §8.2 requires the
    `BackfillPanel` `POLL_MS` shape).
  - So if the `after()` work is lost (process recycled, unhandled throw before the claim's settle), the founder sees
    "extracting" for up to seven days. The sweep then marks the round `failed` (`20260925140000:384-399`), and
    `create_interview_round`'s any-status 30-day rule blocks a new round for the rest of the month.
- **Why it matters:** ADR §5.3 names "the 10-minute re-claim and the sweep's 7-day failed transition" as the safety
  net. Half of it is dead code, and the failure is invisible to the founder, which is exactly the silent-zero class
  item 7 targets.
- **ADR finding too:** §5.3 names the re-claim but assigns no actor to invoke it.
- **Proven fixed when:**
  - a Tier-2 test shows a round `extracting` with `claimed_at` older than 10 minutes can be re-entered from the UI
    or a caller, with its authorisation;
  - the `after()` callback returns or awaits the extraction promise and captures a thrown defect (test);
  - the extracting state polls (render test).

### MAJOR-3 — The hedge flag, the "may conflict with" marker and Replace are computed but never persisted or shown
- **What:**
  - `extract.ts:191-194` computes `hedgeFlagged` and `conflicts` and returns them in a result that
    `after(() => void …)` discards (`extract.ts:59`: *"these are NOT persisted"*).
  - No column stores either per candidate.
  - `InterviewPanel.tsx:13-19` records that the markers and **Replace** are not rendered.
  - `ratify_interview_round`'s replace branch (Tier-1-tested) is therefore unreachable from the product, and the
    `replaced` counter is structurally zero.
- **Why it matters:** ADR §8.4 requires each record to show its hedge marker and conflict, and §4.4 is the mitigation
  for the "we think" → "we are" sharpening L-6 was written against. Constraints #27 and #26 (surfacing half) are
  green on tests of a computation no human sees.
- **ADR finding:** the §2.2/§2.3 column set gives the writer nowhere to store either marker. The Builder
  recorded it as OPEN in M2.8 and M2.10 rather than stopping.
- **Proven fixed when:** an ADR amendment decides storage (or drops the markers, by founder ruling), and a
  migration, writer test and render test show a flagged record and a conflicting record each rendering its marker,
  with Replace offered only on an interview-sourced conflict.

### MAJOR-4 — Rejected candidates, including verbatim evidence text, are retained indefinitely
- **What:** `sweep_interview_data` deletes retired candidates **only of `expired` rounds**
  (`20260925140000:490-523`). A test pins that a ratified round's rejected rows are "NEVER deleted, at any age"
  (`interview-sweep.test.ts:302`). A rejected evidence row keeps `content` and `interview_extracted_text`, both equal
  to a verbatim excerpt of the answer (possibly third-party personal data), after the answer itself is redacted. A
  rejected brand or audience row keeps its restatement.
- **Why it matters:** founder ruling A-3 reads *"unratified candidates retire at 30 days and are deleted 30 days
  later"*, and a rejected candidate is by definition not ratified. Keeping text the founder explicitly declined, with
  no purpose, contradicts the ruling's intent. The launch-checklist counsel line (M2.11) describes retention without
  mentioning it, so counsel would ratify prose that omits this data. The Builder flagged it for a founder ruling
  (`20260925150000:22`).
- **ADR finding:** §6.3 is silent on rejected candidates.
- **Proven fixed when:** a founder ruling is recorded. Then either a sweep step deletes rejected candidates at their
  deadline, with a Tier-1 test at literal ±1-minute boundaries and the `:302` test inverted, or the retention is kept
  by ruling and the counsel line names it.

### MINOR-1 — Action failures are swallowed by the UI
`InterviewPanel.tsx:522-528` (ratify), `:76-99` (Start, Not now, Retry) and `:305-316` (Submit, Skip round) ignore
`!result.ok`. The `performance_claim` error returned by `actions.ts:226-229` has **no message key** in any locale. An
approver whose edit mentions "reach" clicks Ratify and nothing happens. §8.7 requires errors to receive focus.
**Proven fixed when:** a render test for each error path shows a message and moves focus.

### MINOR-2 — The card and nav badge ignore role
`isInterviewCardState` (`page-state.ts:116-118`) is role-blind, and the layout and `InterviewCard.tsx` use it as-is.
A viewer sees "due" with a Start link the RPC refuses; an editor gets a badge for a ratification they cannot perform.
§5.5 scopes each to authors and ratifiers respectively. **Proven fixed when:** there is a per-role test of card and
badge visibility.

### MINOR-3 — The D-4 set-aside note is missing at ratification
§4.7 requires *"N statements about what performs were set aside"* in the review. The ratify panel shows no dropped
counts; only `no_records` does. **Proven fixed when:** a render test on the ratify view shows the note when
`dropped_performance_claim > 0`.

### MINOR-4 — SQL grounding checks the raw span but stores unchecked `storedText` / `storedSpan`
`20260925150000:469-470, 548, 557, 566`. The containment check proves nothing about the span the ratifier later
reads, which could differ from the grounded one if the single TS caller ever regressed. The security-reviewer's
LOW-5 was left unchanged on "the only caller derives them". This is defence-in-depth, and it is what item 5 warns
of: grounding that reads stronger than it is. **Proven fixed when:** the SQL relates the stored and raw forms, or
the ADR records explicitly that stored forms are TS-trusted, with the `memory-interview.test.ts` literal cases cited
as the control.

### MINOR-5 — An ADR 0027 constraint was amended by reference and never recorded
M2.5 changed `AGENCY-NO-EVIDENCE-WRITE-SURFACE`'s scan (`lib/campaigns/planner/__tests__/source-scans.test.ts`,
the `EVIDENCE_INSERT_FUNCTIONS` allow-list) and said M2.11 must record it. No document in the range mentions it
(`git diff … -- docs | grep AGENCY-NO-EVIDENCE` is empty). **Proven fixed when:** an appended note exists in ADR 0027
(append-only) or in ADR 0029's amendments.

### MINOR-6 — ADR finding: a `failed` round locks the founder out, and an injected answer makes that deterministic
`create_interview_round` refuses any round created in the last 30 days, whatever its status (`20260925150000:338-344`).
An answer that makes a compliant model emit a smuggled key fails all three attempts `invalid_response`, and the round
goes `failed` with no new round for the rest of the month. The impact is on the tenant's own interview only.
**Proven fixed when:** a ruling is recorded (for example, a `failed` round does not count toward the 30 days), with
its Tier-1 test.

### MINOR-7 — ADR finding: the §3.3 tie-break contradicts §3.4
The "category order of §3.1" cannot produce §3.4's pinned first round. The Builder introduced
`INTERVIEW_TIEBREAK_ORDER` to match §3.4 (M2.7 body). **Proven fixed when:** an ADR amendment names the order.

### MINOR-8 — The step-4 page, the only member-RLS reader of backfill candidates, has no test
`onboarding/step-4/page.tsx` → `listEvidenceCandidatesForRun` / `listAudienceCandidatesForRun`. This is
`AUTHORED-NOT-EXECUTED` at Tier 2 for the member-write closure. Its DB half is executed by the candidate-SELECT
control. M2.2 disclosed it. **Proven fixed when:** a page-level test exercises it.

### MINOR-9 — The interview page state is recomputed on every dashboard render
`layout.tsx` calls `loadInterviewPageState` on every dashboard page; `/campaigns` calls it twice more (card, and the
page's own load via the card). In the common case (no open round), each call reads up to 3 × 500 memory rows plus
the cooldown rows. **Proven fixed when:** one load per request is used (for example React `cache()`), or a
measurement shows the cost is acceptable.

### NIT-1 — The trial-scan test fails on a CRLF checkout
`lib/interview/extract.test.ts:386-394` strips `//.*$` per `\n`-split line without the `m` flag, and `.` does not
match `\r`. On `core.autocrlf=true` (this repo's setting on Windows) the comment on `extract.ts:46-48` survives and
the test fails. I reproduced this in my first worktree.

### NIT-2 — Per-answer cap drops and ON CONFLICT dedupes are uncounted
`extract.ts:187` `continue`s without a counter. silent-failure-hunter said this drop "increments a named counter".
**It does not.** It is inferable only as `proposed − dropped − written`.

### NIT-3 — A blind spot in the `INTERVIEW-NO-BUDGET-PURPOSE` detector
`source-scans.test.ts:217-230` matches only `CHECK (purpose IN (…))`. A widening written as `= ANY (ARRAY[…])`
escapes. It should be recorded in the file as a known blind spot, as the ADR's §10.3 table does for other scans.

### NIT-4 — The `not_due` state is effectively unreachable once any round exists
`page-state.ts:96-115` shows the last terminal confirmation instead of "when the next round can start" (§8.2).

### NIT-5 — Process: taste-skill was invoked in M2.10 and applied nothing
The build guide requires it before impeccable. It is recorded in the commit body. Not a code defect.

### NIT-6 — `snooze_interview` is a second RPC taking a business id
It verifies membership first (`20260925120000:393-403`), which is safe. The build guide's "the one exception"
wording should be amended.

### NIT-7 — Neutralisation is tested for several answers but only one existing record
`interview-extraction.test.ts:138-147`. "Every record" is not pinned by a multi-record case.

---

Session 35 review complete - 21 findings (1 BLOCKER, 4 MAJOR, 9 MINOR, 7 NIT) over range bfb3bf72..5431fa84; 15/44 INTERVIEW-* constraints verified executed green in CI (Tier-1 rows 24/24, Tier-2 rows 0/18, Tier-3 rows 11/11 re-verified by me); Tier E: none declared, correctly.

## CORRECTION PASS (Session 35-D)

**Author:** Session 35-D correction pass · **Date:** 2026-09-27 · **Range fixed:** `5431fa84..<D11-sha>` (open; closes at D11)
**Reviewed head:** `5431fa84` — the head the Reviewer read; only this pass's §4 and the report itself landed
after it, at D0 (`a52ec87d`).
**Founder adjudications consumed:** deferral permitted explicitly (founder, 2026-09-27); A-6 = PENDING;
A-7 = PENDING (both required before D4 begins; not yet ruled at D1). A-1…A-5 stand. Dropping the MAJOR-3
markers was available and not taken (build-guide §4).
**Everything above this line is the Reviewer's. Everything below it is this pass's.**

### D1 — MINOR-8 + MINOR-4 (code half) + NIT-7

| Field | MINOR-8 | MINOR-4 (code half) | NIT-7 |
|---|---|---|---|
| **Finding** | MINOR-8 | MINOR-4 | NIT-7 |
| **Fix** | Added a page-level Tier-2 test for `step-4/page.tsx` asserting it reads backfill candidates through the caller's own anon/RLS client (never `createServiceRoleClient`) via `listEvidenceCandidatesForRun`/`listAudienceCandidatesForRun`, and renders them via `BackfillPanel`. No production file changed. | Added a Tier-3 scan pinning (a) `write_interview_candidates` to its sole production file `lib/db/memory-interview.ts`, and (b) `storedText`/`storedSpan` production (a payload key or member assignment) to that file's choke point (`:112-122`) only — distinguished from `lib/interview/extract.ts`'s legitimate local re-validation copy in `isStorable()` (`:106-119`), which the detector does not flag. The ADR record that the stored forms are TS-trusted is D10's job (disposition table: "D1 + D10"). | Added a case with three existing records carrying distinct injection payloads (a fake `[/DATA]` closer, a plain instruction line, a zero-width-joined-key line) and asserted every one is neutralised, not just the first. |
| **Proof** | `app/[locale]/(dashboard)/onboarding/step-4/page.test.tsx` (new file), both `it(...)` cases | `lib/interview/__tests__/source-scans.test.ts`, describe block `INTERVIEW-WRITER-SOLE-CALLER + stored-form choke point (ADR 0029 §2.3, MINOR-4, Session 35-D D1)` | `lib/ai/prompts/interview-extraction.test.ts`, `it('neutralises EVERY existing record, not just the first — three distinct injection payloads')` |
| **Reddening** | Swapped `createClient()` / `'@/lib/supabase/server'` for `createServiceRoleClient()` / `'@/lib/supabase/service'` in `page.tsx` (import line, call-site line) → RED (suite failure: the page now reaches the service-role mock this test wires to throw). Reverted; `git diff --stat -- "app/[locale]/(dashboard)/onboarding/step-4/page.tsx"` empty. | (1) Planted `client.rpc('write_interview_candidates', {})` in `app/api/cron/interview-sweep/route.ts` → RED, naming that file as the second caller. Reverted; diff empty. (2) Planted an object literal `{ storedSpan: 'x' }` in `lib/interview/extract.ts` → RED, naming that file as a second producer. Reverted; diff empty. | Bypassed `neutralize()` for `input.existing` records at index > 0 in `lib/ai/prompts/interview-extraction.ts`'s `buildUserMessage` → RED (length assertions failed). Reverted; `git diff --stat -- lib/ai/prompts/interview-extraction.ts` empty. |
| **Commit** | this commit (D1) | this commit (D1) | this commit (D1) |

**What this step did NOT touch:** no production code; no plpgsql `neutralize`.

**Full-suite confirmation (D1):** `npx tsc --noEmit --skipLibCheck` clean. `npm run lint`: 1 pre-existing
error (`InterviewPanel.tsx:391:22`, `react-hooks/set-state-in-effect` — BLOCKER-1, D2's finding, untouched
by this step) plus pre-existing warnings; no new lint error introduced. `npm run test:app` (CI env block):
371 files / 5434 tests green (was 370/5427 at `5431fa84`; the delta is exactly this step's 2 + 4 + 1 new
test cases across three files).

**Note on `test:db` for this step:** D1 as authored here is scan-and-test-only over `app/`, `lib/ai/` and
`lib/interview/` — it touches no `supabase/__tests__` file, no migration and no RLS/RPC behaviour, so there
is nothing for this step to redden or re-run at Tier 1. `test:db`'s green result at `5431fa84` (107 files /
1091 tests, skip-guard green) stands unchanged and is not re-claimed as re-executed by this step.

### D2 — BLOCKER-1 (code half) + NIT-1

| Field | BLOCKER-1 (code half) | NIT-1 |
|---|---|---|
| **Finding** | BLOCKER-1 | NIT-1 |
| **Fix** | Moved the 80%/100% counter announcement out of a `useEffect` (`react-hooks/set-state-in-effect`) and into the textarea's own change handler (`InterviewQuestionCard`'s new `handleDraftChange`), which compares the PREVIOUS render's crossing booleans (`crossedFull`/`crossed80`, closed over) against the NEXT draft's and sets the announcement only on an upward flip. Removed the effect and both `eslint-disable-next-line react-hooks/exhaustive-deps` comments (the one on the announcement effect; the file's other pre-existing `useEffect` at `:269` is untouched and out of scope). The live region stays `aria-live="polite"`; no per-keystroke re-derivation from `remaining`. **CI proof that `app-tests` actually executes green is D11's job** — this row closes only the code half. | Extracted the inline comment-stripper in `extract.test.ts`'s trial-layer source scan into a named `stripComments()` function and changed `.split('\n')` to `.split(/\r?\n/)`, so a CRLF-terminated line's trailing `\r` is removed by the split itself rather than left for `/\/\/.*$/` (no `m` flag) to strip — `.` in a JS regex never matches `\r`, so the old split left the comment un-stripped on any `core.autocrlf=true` checkout (this repo's Windows setting, CLAUDE.md). |
| **Proof** | `app/[locale]/(dashboard)/interview/InterviewPanel.test.tsx`, describe block `"the character counter's live region announces politely at 80% and 100%, not per keystroke (§8.7)"`, the tightened assertion at the >=80%/<100% step (now an exact `toBe`, proving the text is byte-identical, not just containing the substring) | `lib/interview/extract.test.ts`, `it('strips a trailing-// comment on a CRLF-terminated line (regression: core.autocrlf=true checkouts)')` |
| **Reddening** | Restored per-keystroke re-derivation (dropped the `!crossedFull` / `!crossed80` upward-flip guards) → RED: `expected 'ui.question.counter_80:{"remaining":300}' to be '...:{"remaining":400}'` (re-derived from the live draft length instead of staying stale). Reverted; `git diff --stat -- "app/[locale]/(dashboard)/interview/InterviewPanel.tsx"` shows only the intended 24-line fix (confirmed via the two test runs bracketing the mutation, both otherwise identical). | Reverted the split back to `.split('\n')` → RED: `expected '...trial-state here...' not to contain 'trial-state'` (the CRLF line survived un-stripped, reproducing NIT-1 exactly). Reverted; `git diff --stat -- lib/interview/extract.test.ts` after restore matches the intended fix only. |
| **Commit** | this commit (D2) — CI proof at D11 | this commit (D2) |

**Additional verification (beyond the standard loop):** the fix was also proven against a **genuine
CRLF-terminated** copy of `lib/interview/extract.ts` / `extract.test.ts` (converted with `sed`, confirmed
via `cat -A` showing `^M` line endings), not just a fixture string — `npx vitest run lib/interview/extract.test.ts`
against that CRLF-converted worktree: 56/56 green. Both files were then restored to the repo's tracked LF
form; `git diff --stat` afterwards shows only the intended source changes (a clean round-trip).

**`npx eslint` over the whole repo, quoted:** `✖ 112 problems (0 errors, 112 warnings)` — zero errors,
down from the 1 error (`BLOCKER-1`) present before this step.

**What this step did NOT touch:** the live region's politeness (`aria-live="polite"`) and copy keys are
unchanged; no `eslint-disable` was added anywhere; the file's other pre-existing `useEffect` (`:269`,
unrelated to the counter) and its own lint warning (`Unused eslint-disable directive`, line 271) are
untouched — that warning pre-dates this step and is out of BLOCKER-1's scope.

**Full-suite confirmation (D2):** `npx tsc --noEmit --skipLibCheck` clean. `npm run test:app` (CI env
block): 371 files / 5435 tests green (was 371/5434 after D1; the delta is exactly NIT-1's one new regression
test — the InterviewPanel change tightened an existing assertion rather than adding a new one).

**Note on `test:db` for this step:** D2 touches no migration and no `supabase/__tests__` file; `test:db`'s
green result at `5431fa84` stands unchanged and is not re-claimed as re-executed by this step.
