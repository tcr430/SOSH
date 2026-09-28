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

### D3 — MAJOR-1 (code half)

**SHARED-FUNCTION CALLERS of `listInterviewCooldownRows`, both updated in this step:**

| Caller | File:line | Test that exercises it |
|---|---|---|
| `startInterviewRoundAction` | `app/[locale]/(dashboard)/interview/actions.ts:98` | `app/[locale]/(dashboard)/interview/actions.test.ts` (mocked) |
| `loadInterviewPageState` | `lib/interview/load-page-state.ts:35` | `lib/interview/load-page-state.test.ts` (mocked) |

**Precondition confirmed (BUILD step 1):** `coolingDownKeys` / `selectQuestions` (`lib/interview/select.ts:54-67`)
read nothing older than `INTERVIEW_ANSWERED_COOLDOWN_DAYS` (180, the larger of the two windows — the skipped
window is only 60). A windowed read at 180 days therefore loses nothing the pure selection could ever use.

| Field | MAJOR-1 (code half) |
|---|---|
| **Finding** | MAJOR-1 |
| **Fix** | `listInterviewCooldownRows` (`lib/db/founder-interview-answers.ts`) now takes `now: Date`, filters `answered_at >= now - INTERVIEW_ANSWERED_COOLDOWN_DAYS` via `date-fns` (`subDays` + `formatISO`, no raw `toISOString`), and keeps the explicit `ORDER BY (question_key ASC, answered_at DESC)`. The row `limit` becomes a DERIVED constant, `INTERVIEW_COOLDOWN_ROW_CAP = (Math.floor(180/30)+1)*8 = 56` (`lib/interview/constants.ts`) — a defensive backstop bounding what a realistic (rate-limited-to-one-round-per-30-days) history could ever return, never the correctness mechanism. Both callers now pass `now` and `INTERVIEW_COOLDOWN_ROW_CAP`; neither passes `INTERVIEW_BANK_SIZE` any more (its import is removed from both call sites). **The §9.5 ADR amendment naming this derived cap is D10's job**, per the disposition table ("D3 + D10"). |
| **Proof** | Tier 2 (mocked, real query shape): `lib/db/founder-interview-answers.test.ts`, the `.gte('answered_at', cutoff)` assertion and the updated signature/source assertions. Tier 2 (pure, real `selectQuestions`, real bank, simulated real query shape over 10 monthly rounds): `lib/interview/select.test.ts`, describe block `"MAJOR-1 fix — a late-sorting key (usage_data_number) survives a >33-row history"` (two tests: one reproducing the bug under the OLD row-count-only shape, one proving the fix under the time-windowed shape). Tier 1 (live Postgres, real function, real RLS): `supabase/__tests__/interview-lifecycle.test.ts`, describe block `"MAJOR-1 fix — the cooldown read survives a >33-row history (live Postgres)"` — seeds 40 answered rows for one business (> the old 33-row limit, < the new 56-row cap), signs in as the member, and asserts the alphabetically-last key's row is returned. |
| **Reddening** | Restored the pre-fix shape in `listInterviewCooldownRows` (dropped the `.gte` clause, hardcoded `.limit(33)`, `now`/`limit` params unused) → RED on both the Tier-2 mocked test (the `.gte` and source-pattern assertions) and the Tier-1 live test (`expected 33 to be greater than 33` — the seeded late key's row was truncated, reproducing the Reviewer's exact finding against real Postgres). Reverted; `git diff --stat -- lib/db/founder-interview-answers.ts` shows only the intended 16-line fix (confirmed via the two test runs bracketing the mutation). |
| **Commit** | this commit (D3) |

**`select.test.ts` / `thinness.test.ts` stayed green and byte-unchanged**, confirmed via
`git diff --stat -- lib/interview/select.test.ts lib/interview/thinness.test.ts` before adding the new
describe block (empty) and via `thinness.test.ts` remaining completely untouched throughout this step.

**What this step did NOT touch:** no migration; no change to `founder_interview_answers_cooldown_idx` or any
RLS policy; `select.ts` / `thinness.ts` production files untouched (only their test files gained new,
additive describe blocks); `INTERVIEW_BANK_SIZE` itself is untouched in `lib/interview/bank.ts` — only its use
as a cooldown-read bound is removed from the two callers (it may still be used elsewhere, e.g. `bank_version`
literature, unaffected by this step).

**Full-suite confirmation (D3):** `npx tsc --noEmit --skipLibCheck` clean. `npx eslint .`: `✖ 112 problems (0
errors, 112 warnings)`, unchanged from D2. `npm run test:app` (CI env block): 371 files / 5437 tests green
(was 371/5435 after D2; the delta is exactly `select.test.ts`'s two new tests — `founder-interview-answers.test.ts`'s
tests were updated in place, not added). `npm run test:db` against the running LOCAL Supabase stack (env from
`supabase status -o env`, 127.0.0.1:54321/54322): **107 files / 1092 tests green** (was 107/1091 at `5431fa84`;
the delta is exactly this step's one new Tier-1 test in `interview-lifecycle.test.ts`, which alone runs 66/66,
up from 65).

### D4 — MAJOR-3 (DB half), MAJOR-4, MINOR-6, NIT-2 (DB half): the one forward migration

**File:** `supabase/migrations/20260928100000_interview_correction_pass.sql`. It is the only migration of this pass. It
edits no committed migration; five functions are replaced by `CREATE OR REPLACE`.

**Founder rulings consumed (build-guide §4, now filled in there).** Both were taken as the guide's recommendation **(a)**, on
the user's explicit instruction at D4 (2026-09-28): *"do d4, assuming recommendations for founder rullings"*. Read this as an
instruction to assume the recommendations, not as a separate founder sign-off. If the founder later rules the other way,
reversing either is a further forward migration, and each half is isolated (A-6 = sweep step 4b + the marker; A-7 = step 3 of
`create_interview_round`).

| Ruling | Recorded as | What D4 builds |
|---|---|---|
| **A-6(a)** | *"a rejected candidate is an unratified candidate under A-3 and so deleted at its round's answer-redaction deadline (`terminal_at + 30 d`), not 30 days after that"* | sweep step **4b**; ratify's REJECT sets a marker |
| **A-7(a)** | *"a `failed` round does not count toward the 30-day rule, but at most two rounds may be created per 30 days"* | `create_interview_round` step 3; the cooldown cap re-derived 56 → 104 |

**One deviation from the guide's BUILD list, and why.** The guide names three `SECURITY DEFINER` bodies (writer, sweep,
`create_interview_round`). This step replaces a **fourth**: `ratify_interview_round`, by **one added assignment** in its REJECT
branch (`interview_rejected = true`), plus the immutability trigger function. The guide's part 2 says the sweep deletes *"candidate rows
whose ratify decision was REJECT"*. The schema cannot say that. A rejected candidate and a row a later round *replaced* are both
`status = 'retired'` in a ratified round, and `interview-sweep.test.ts:302` (the test A-6 inverts) pinned exactly that ("a rejected
candidate, **and a row a later round replaced**"). Deleting "every retired row of a ratified round" would therefore have deleted
replaced rows too, which A-6 does not rule on. A three-table boolean, `interview_rejected`, set only by the REJECT UPDATE, is the
smallest thing that makes the ruling implementable. The trigger only allows `false -> true` in the statement that moves a `candidate` to
`retired`, and (db-review MINOR-2) a rejected row can never leave `retired`.
**Residual, stated:** an interview row rejected *before* this migration carries no marker and is not deleted. The feature has shipped to
no customer (`docs/current-phase.md`), so none should exist in production. I have **not** queried the remote project to confirm that.

| Field | MAJOR-3 (DB half) |
|---|---|
| **Finding** | MAJOR-3: hedge flag and conflict markers were computed and discarded (`extract.ts:59` "these are NOT persisted"); the ratify replace branch was unreachable. |
| **Fix** | `interview_hedge_flagged boolean` and `interview_conflict_ids uuid[]` (<= 5) on `brand_memory`, `evidence_memory`, `audience_memory`. Both are NULL unless `source = 'interview'` (CHECK `*_interview_markers_clean_check`), and immutable after insert (`enforce_memory_interview_immutable`). `write_interview_candidates` takes optional `hedgeFlagged` / `conflictIds` per item, and **keeps a conflict id only if it is a non-deleted row of the SAME table with `business_id` = the LOCKED ROUND's business**. Any other id is dropped and counted in `founder_interview_rounds.dropped_conflict_foreign`, and is never stored. The return object is unchanged. |
| **Proof** | `interview-writer.test.ts` (Tier 1, live Postgres), "D4 MAJOR-3": flag persisted true/false/`{}` defaults; **`INTERVIEW-CONFLICT-TENANT-BOUNDED`** (own id kept; foreign-tenant, non-existent and cross-table ids dropped, counted, stored in no table; the other tenant's round counter 0); dedupe by uuid; five malformed-marker cases raise `22023` and write nothing; the CHECKs (`23514` with the constraint name); trigger immutability. The **governance smuggle was re-run**: a payload smuggling `confidence`, `status`, `source`, `public_use_permission`, `business_id`, `scope` **and** `interview_rejected` still yields fixed governance, `interview_rejected = false`, and 0 foreign-tenant rows. `pg_proc.prosrc` of the writer and ratify has **no jsonb read of any governance key**, and the regex is shown non-vacuous. |
| **Reddening** | On the LOCAL DB, each mutant applied by `psql`, tests run, original restored: (a) dropped `business_id = v_business_id` from the conflict filter -> the tenant-bounded test RED; (a2) checked audience items against `brand_memory` -> RED; (e) removed the marker-immutability clause from the trigger -> RED; (g) stored the hedge flag as `false` -> RED. Restored each; **`pg_get_functiondef` md5 of all five functions identical before and after.** |
| **Commit** | this commit (D4) |

| Field | MAJOR-4 (per A-6(a)) |
|---|---|
| **Finding** | MAJOR-4: rejected candidates, including verbatim evidence excerpts, outlive the answer they were cut from (`sweep_interview_data` deleted retired rows of *expired* rounds only). |
| **Fix** | `interview_rejected boolean NOT NULL DEFAULT false` (three tables; CHECK: false unless `source = 'interview'`). `ratify_interview_round`'s REJECT UPDATE sets it. **Sweep step 4b** deletes `source = 'interview' AND status = 'retired' AND interview_rejected` rows of **RATIFIED** rounds with `terminal_at < now() - 30 d`, bounded to 500 per table per run, and counted in `candidatesDeleted`. The return object stays exactly six counters. |
| **Proof** | `interview-sweep.test.ts`, "[A-6(a)]": at literal **+30 d + 1 min** the rejected candidate is gone; at **+30 d - 1 min** it survives; the ACTIVE row of the same round survives both, with its span redacted as before; **a row a later round replaced (retired, `interview_rejected = false`) survives at 400 days**; a `skipped` round's marked row is out of scope; a second run changes nothing. `interview-ratify.test.ts`, "[A-6(a)] REJECT marks...": the marker is set on the rejected candidate only, and accepted and replaced rows stay `false`. |
| **The one assertion flip** | `interview-sweep.test.ts:302` ("a RATIFIED round's retired rows ... are NEVER deleted, at any age") is **inverted for the rejected half only**, with A-6 quoted beside it in the file. The active-row half and the replaced-row half hold as before. **No other previously green assertion changed.** All 266 pre-existing interview Tier-1 tests were green on the migration before any new test was added. |
| **Reddening** | (b) deleted step 4b -> the `+30 d + 1 min` case and the counter case RED; (d) ratify's REJECT no longer sets the marker -> the ratify marker test RED. Restored; hashes identical. |
| **Commit** | this commit (D4) |

| Field | MINOR-6 (per A-7(a)) |
|---|---|
| **Finding** | MINOR-6: a `failed` round locks the founder out for 30 days, deterministically via an injected answer. |
| **Fix** | `create_interview_round` step 3: a non-`failed` round created in the last 30 days blocks (`too_soon`), **and so do two rounds of any status** created in the last 30 days. A-4's spend bound stays structural (<= 2 x 30 cents per 30 days, no fifth budget purpose). `INTERVIEW_COOLDOWN_ROW_CAP` is re-derived from the D3 pointer: `(2 x 6 + 1) x 8 = 104` (`INTERVIEW_MAX_ROUNDS_PER_30_DAYS = 2`). Per db-review MINOR-1, creations for one business are serialised by `pg_advisory_xact_lock`. |
| **Proof** | `interview-lifecycle.test.ts`, "MINOR-6 / A-7(a)": a `failed` round 5 days old does not block; after a failed round and a second, failed, round a third is `too_soon`, and it is created once the older one is 31 days old; the ceiling at the literal 30-day boundary (`30 d - 1 min` blocks, `30 d + 1 min` does not); nine other statuses (`open` ... `expired`) **still block** at 5 days; the advisory lock is proved deterministically (a second connection holds the business's lock, the RPC waits and completes on release, and an unrelated business is not blocked). `lib/interview/constants.test.ts` (new) pins the derivation and the value 104. `select.test.ts`'s two D3 cases now read the real constant instead of a hardcoded 56 (D3's "byte-unchanged" was a D3 precondition). |
| **Reddening** | (c) dropped `<> 'failed'` -> the "failed does not block" case and the ceiling case RED; (c2) dropped the `>= 2` clause -> the ceiling cases RED; (h) removed the advisory lock -> the lock test RED. Restored; hashes identical. |
| **Commit** | this commit (D4) |

| Field | NIT-2 (DB half) |
|---|---|
| **Finding** | NIT-2: the per-answer cap drop (`extract.ts:187`) is uncounted. |
| **Fix** | `founder_interview_rounds.dropped_cap int NOT NULL DEFAULT 0`, written by the same writer call from an **optional** `counters.droppedCap`. An older caller that omits it still works (counts as 0). A present-but-invalid value raises `22023`. |
| **Proof** | `interview-writer.test.ts`, "D4 NIT-2": persisted; absent -> 0; negative, fractional, string and JSON-null values raise. |
| **Reddening** | (f) the writer no longer sets `dropped_cap` -> RED. Restored. |
| **Open** | The **TS half** (passing `droppedCap`, `hedgeFlagged` and `conflictIds` from `extract.ts` through `lib/db/memory-interview.ts`, and showing the counts) is **D5**. Until D5 no production caller sends the new keys, so the columns are written with their defaults. D4 is deliberately DB-only. |

**SHARED-FUNCTION CALLERS** (rule 9). Every replaced function, its production callers, and the test that exercises each:

| Function | Production caller | Tier-1 (live DB) | Tier-2 (mocked) |
|---|---|---|---|
| `write_interview_candidates` | `lib/db/memory-interview.ts:109` <- `lib/memory/interview.ts` <- `lib/interview/extract.ts` | `interview-writer.test.ts` (all cases + D4) | `lib/db/memory-interview.test.ts`, `lib/memory/interview.test.ts`, `lib/interview/extract.test.ts` |
| `ratify_interview_round` | `lib/db/memory-interview.ts:83` <- `lib/memory/interview.ts` <- the ratify Server Action | `interview-ratify.test.ts` (all + D4) | `lib/db/memory-interview.test.ts`, `lib/memory/interview.test.ts` |
| `sweep_interview_data` | `lib/db/founder-interview-rounds.ts:136` <- `app/api/cron/interview-sweep/route.ts` | `interview-sweep.test.ts` (all + D4) | `app/api/cron/interview-sweep/route.test.ts`, `lib/db/founder-interview-rounds.test.ts` |
| `create_interview_round` | `lib/db/founder-interview-rounds.ts:73` <- `startInterviewRoundAction` (`interview/actions.ts`) | `interview-lifecycle.test.ts` (all + D4) | `app/[locale]/(dashboard)/interview/actions.test.ts`, `lib/db/founder-interview-rounds.test.ts` |
| `enforce_memory_interview_immutable` (trigger) | fires on every UPDATE of the three memory tables: ratify, the sweep's redaction, the writer's `ON CONFLICT` path | `interview-writer.test.ts` "IMMUTABLE after insert", `interview-ratify.test.ts`, `interview-sweep.test.ts`, `interview-schema.test.ts` | none |

`INTERVIEW_COOLDOWN_ROW_CAP` (the re-derived constant) callers, unchanged and both re-verified by `test:app`: `startInterviewRoundAction`
(`actions.ts:99`) and `loadInterviewPageState` (`load-page-state.ts:35`).

**database-reviewer (ECC, once) over the migration. No BLOCKER or MAJOR.** Its report and my disposition:

| # | Finding | Disposition |
|---|---|---|
| MINOR-1 | `create_interview_round` has no lock, so the ceiling can be exceeded by a millisecond race once the first round goes terminal instantly. | **Applied.** `pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0))` before step 3. Proved and reddened (mutation h). |
| MINOR-2 | `interview_rejected` is not tied to `status` staying `retired`; a restored-then-retired row would be deleted by the sweep. | **Applied.** Trigger: `OLD.interview_rejected AND NEW.status <> 'retired'` raises. Proved and reddened (mutation i). |
| MINOR-3 | `interview_conflict_ids` has no FK, so ids can dangle. | **Applied as documentation.** `COMMENT ON COLUMN` x3: advisory, no FK, and the ratify RPC re-verifies any replace target in SQL. Deliberately no FK, because the sweep deletes rows and the ids are display hints. |
| NIT-4 | The partial index does not match the sweep's `status = 'retired'` predicate. | **Applied.** `WHERE interview_rejected AND status = 'retired'`. |
| NIT-5 | The `ALTER TABLE`s take `ACCESS EXCLUSIVE` and validate. | **No change.** Pre-launch, no large tables, and the constant default avoids a rewrite. Revisit if the migration were ever re-run on a large table. |
| NIT-6 | `droppedCap` rejects `5.0` and JSON null. | **No change.** Defensible; D5's TS caller sends a non-negative integer. |

The reviewer verified by `diff` that the ratify, sweep and create-round bodies differ from the committed migrations **only** at the intended
lines, and that `EXECUTE` is `service_role`-only with `search_path = public, pg_temp` on all four `SECURITY DEFINER` functions (the trigger function is not one).
The ADR 0010 Amendment 2 §D2.5 erasure cascade is unaffected: no new table, and the new columns sit on already-cascaded tables.

**Full-suite confirmation (D4):** `npx tsc --noEmit --skipLibCheck` clean (the three new memory columns and two round columns required 15 typed
test fixtures to gain the fields; no assertion changed). `npx eslint .`: `✖ 112 problems (0 errors, 112 warnings)`, unchanged. `npm run test:app` (CI env
block): **372 files / 5440 tests** green (was 371/5437: +1 file, `constants.test.ts`, +3 tests). `npm run test:db` against the LOCAL stack only
(env from `supabase status -o env`, 127.0.0.1:54321/54322; the DB was rebuilt from scratch with `supabase db reset --local`, so the whole chain including this migration applied clean): **107 files / 1126 tests green** (was 107/1092 after D3; the +34 are this step's new Tier-1 cases, no file added). The skip-guard is satisfied: no file executed zero tests.

**What this step did NOT touch:** no push (rule 10); no `extract.ts`, `lib/db/memory-interview.ts` or UI change (D5); `docs/decisions/*` untouched
(ADR amendments are D10); `docs/launch-checklist.md` untouched (D10).

### D5 — MAJOR-3 (TS + UI), MINOR-3, NIT-2 (TS): the ratifier sees the markers, Replace, and what was set aside

D5 is the app half of what D4's migration made possible. No SQL, no migration. It closes MAJOR-3 (with D4), MINOR-3 and NIT-2.

| Field | MAJOR-3 (TS + UI half) |
|---|---|
| **Finding** | MAJOR-3: the hedge flag and conflict markers were computed and discarded; the ratify view could show neither and Replace was unreachable (`InterviewPanel.tsx:13-19`, `extract.ts:59`). |
| **Fix** | `extract.ts` (`filterExtractedItems`) now puts `hedgeFlagged` and `conflictIds` (the model's ids intersected with the ids that were SENT, at most 3) on each kept record. They go through `lib/memory/interview.ts` (`z.strictObject`; `hedgeFlagged` boolean, `conflictIds` at most 3 uuid strings) and `lib/db/memory-interview.ts` (named-key picking) into D4's writer. `listInterviewCandidatesForRound` also resolves each candidate's persisted conflict ids to `{ id, text, status, source }` with three new bounded readers (`list{Brand,Audience,Evidence}ConflictTargets`, the caller's member-RLS client, `ORDER BY id`, limit 72), each id looked up only in the table of the candidate that names it. `InterviewPanel` renders per record: a hedge marker when flagged; a "may conflict with: <target>" marker per resolved conflict; and **Replace only when the target is `active` AND `source = 'interview'`**, with an accessible name naming both records. One target is replaced by at most one record, and `replaces` is sent only with an ACCEPT. Still no accept-all and no checkbox; Ratify is enabled only when every item is decided. The two stale comments (`extract.ts:59`, `InterviewPanel.tsx:13-19`) now point at D4/D5. |
| **Proof** | Tier 2 render (`InterviewPanel.test.tsx`, 12 new cases): flagged shows the marker and unflagged / pre-D5 (null) do not; a conflicting record shows the marker naming its target; an unresolved id and a cross-type id show none; **Replace appears for an active interview target and NOT for a manual or a retired one** (the marker still shows for all three); Replace's accessible name carries both records; an accepted record with Replace sends `replaces { type, id }`; a rejected record never does; choosing a target for a second record clears it from the first. Tier 2 pass-through: `extract.test.ts` (per-record `hedgeFlagged`, per-record `conflictIds` with a foreign id absent from the payload, `[]` when none, cap drop counted), `memory/interview.test.ts` (strict schema: malformed inputs rejected; pass-through; conflict targets resolved per table, deduplicated, with the caller's client), `db/memory-interview.test.ts` (exactly nine item keys and four counter keys; defaults false / [] / 0). **Tier 1, live Postgres, end to end** (`interview-ratify.test.ts`): the writer persists the real conflict id and drops and counts a foreign one; a Replace decision built from the PERSISTED id reaches **`replaced = 1`** (it was structurally 0), the old row is retired and not marked rejected. |
| **Reddening** | 12 mutations, each source file backed up and restored byte-for-byte: (a1) `hedgeFlagged` not passed by `extract.ts` -> the Tier-2 pass-through RED; (a2) the panel never derives the hedge flag -> the hedge render test RED; (b) Replace offered regardless of source or status -> the manual/retired case RED; (d) `conflictIds` dropped in `extract.ts` -> RED; (f) the memory layer drops `hedgeFlagged` -> RED; (f2) the schema no longer requires uuid / max 3 -> two rejection cases RED; (g) the DB wrapper sends `hedgeFlagged: false` -> RED; (h) brand targets resolved from audience ids -> RED; (i) a target selectable by two records -> RED; (j) `replaces` sent for a rejected record -> RED. |
| **Commit** | this commit (D5) |

| Field | MINOR-3 |
|---|---|
| **Finding** | MINOR-3: the D-4 "N statements about what performs were set aside" note (ADR 0029 §4.7) was missing at ratification. |
| **Fix** | The ratify view shows `ui.ratify.set_aside` (ICU plural, with the count) when `round.dropped_performance_claim > 0`. |
| **Proof / Reddening** | Render tests: shown with the count when it is 2, absent when 0. (c) Hiding the note -> the "count 2" case RED. |
| **Commit** | this commit (D5) |

| Field | NIT-2 (TS half) |
|---|---|
| **Finding** | NIT-2: `extract.ts:187` `continue`d past the per-answer cap without a counter. |
| **Fix** | `droppedCap++` at that branch; `counters.droppedCap` travels to the writer beside the yield counters and lands in D4's `dropped_cap`. The returned `yield` keeps its three keys, so no existing assertion on it changed. |
| **Proof / Reddening** | `extract.test.ts`: `INTERVIEW_MAX_ITEMS_PER_ANSWER + 2` items -> `droppedCap: 2` reaches the writer. (e) Removing the increment -> RED. |
| **Commit** | this commit (D5) |

**i18n (rule: en, pt AND es in the same commit).** `ui.ratify.{hedge_marker, conflict_marker, replace, replace_for, set_aside}` added to all three `interview.json`, additions only (the diff shows the five keys and one trailing comma). `lib/i18n/interview-parity.test.ts` stays green.

**Assertions that changed, and why (none weakened).** D5's own build step changes the payload the extraction sends, so the tests that pin its exact key set were updated to the new exact set: item keys 5 -> 7 (`extract.test.ts`), 7 -> 9 (`memory-interview.test.ts`); counters 3 -> 4 keys (`droppedCap`); an evidence item now also carries `hedgeFlagged: false, conflictIds: []`; `listInterviewCandidatesForRound` now also returns `conflictTargets`. Each is still an exact-shape assertion, and the governance-key scans over the serialised payload are untouched.

**SHARED-FUNCTION CALLERS** (rule 9):

| Function | Production callers | Tests |
|---|---|---|
| `filterExtractedItems` / `extractInterviewRound` | `interview/actions.ts` (submit, retry) | `extract.test.ts` |
| `recordInterviewCandidates` | `lib/interview/extract.ts` only | `memory/interview.test.ts`, `extract.test.ts` (mocked), `interview-writer.test.ts` (Tier 1) |
| `listInterviewCandidatesForRound` | `lib/interview/load-page-state.ts` (dashboard layout, `InterviewCard`, `/interview`) | `memory/interview.test.ts`, `load-page-state.test.ts` |
| `InterviewRatifyPanel` | `InterviewPanel` (the `/interview` page) | `InterviewPanel.test.tsx` |

**security-reviewer (ECC, once) over the answer -> extraction -> writer -> ratify path.** No BLOCKER or MAJOR; areas (a) prompt-injection id flow, (b) tenant isolation of the new reads, (c) rendering, (e) governance, (f) information exposure and (g) bounds found nothing. Disposition:

| # | Finding | Disposition |
|---|---|---|
| MINOR-1 | `ratify_interview_round` does not bind `replaces` to the candidate's own `interview_conflict_ids`, nor to its type. An approver or admin who hand-crafts a Server Action call can replace ANY active interview record of their own business, including one of another type. The UI never offers it. | **NOT APPLIED — reported.** The fix is a change to a committed `SECURITY DEFINER` function, which is SQL, and rule 7 permits SQL at D4 only ("if another step appears to need SQL, STOP"). Impact is bounded: the caller is already an approver or admin of that business, the target must be an active `source = 'interview'` row of the same business, and manual, foreign-tenant and reused targets are already rejected `22023`. It needs a founder / next-session decision on a small forward migration (`v_rep_id = ANY (candidate.interview_conflict_ids)`, and `v_rep_type = v_type` unless a cross-type replace is intended). |
| NIT-1 | The writer stores any live same-table, same-business row as a conflict id, including retired or manual ones. | **No change.** Harmless by design: replace-eligibility is decided at render time from the live status and source, and again in SQL. The cost is a "may conflict" marker that is not actionable for a stale target. |
| NIT-2 | The target read uses `.in('id', ids)` with no chunking. | **No change.** At most 24 candidates x 3 ids = 72 per table, a bounded URL, and the read is limited to 72 and ordered by primary key. |

**Full-suite confirmation (D5):** `npx tsc --noEmit --skipLibCheck` clean. `npx eslint .`: `✖ 112 problems (0 errors, 112 warnings)`, unchanged. `npm run test:app` (CI env block): **372 files / 5464 tests** green (was 372/5440 after D4: +24 tests, no new file). `npm run test:db` against the LOCAL stack only: **107 files / 1127 tests green** (was 1126 after D4; the +1 is the end-to-end writer -> ratify Replace case). The skip-guard is satisfied: no file executed zero tests.

**What this step did NOT touch:** no SQL and no migration; no push (rule 10); `docs/decisions/*` untouched (D10 records the new constraint `INTERVIEW-MARKERS-SURFACED`); the D6 work (after() capture, stale retry, polling) is not started.

### D6 — MAJOR-2: a lost extraction is visible, captured, and recoverable

No SQL, no migration. New constraint **`INTERVIEW-EXTRACTION-RECOVERABLE`** (recorded in D10).

**`claim_interview_extraction`'s accepted statuses, read from `20260925120000` and recorded (BUILD step 2):** `submitted`; `extraction_failed`; and `extracting` **whose `claimed_at < now() - interval '10 minutes'`** (strict less-than), on top of `spend_cents + 10 <= ceiling_cents` and `extraction_attempts < 3`. Anything else returns `not_claimable`. The claim clock is `claimed_at`, or `submitted_at` for a round never claimed.

| Field | MAJOR-2 |
|---|---|
| **Finding** | MAJOR-2: (1) `actions.ts` ran `after(() => { void extractInterviewRound(id) })` in both submit and retry, so a thrown defect, or the `AggregateError` `extract.ts` throws when it cannot settle a failed attempt, was an unhandled rejection with no capture; (2) the 10-minute re-claim had no reachable caller, because Retry fired only on `extraction_failed`; (3) the extracting screen never polled. A lost extraction stranded the founder for the 7-day sweep. |
| **Fix** | (1) Both `after()` callbacks now **return** `extractInBackground(id, phase)`, an `async` wrapper that awaits `extractInterviewRound` and, on a throw (asynchronous or synchronous), calls `Sentry.captureException(err, { tags: { action: 'interview-extract', phase: 'submit' \| 'retry' } })`, mirroring `interview-sweep/route.ts:67`. It never rejects, so `after()` never sees a rejection; a typed outcome the orchestrator RETURNS (refused, failed) is not an error and is not captured. (2) New pure rule `lib/interview/stale.ts` (`isExtractionStale`): an `extracting` round is stale when `claimed_at` is more than 10 minutes old, a `submitted` round by `submitted_at`, and a missing or unparseable clock is never stale. `retryInterviewExtractionAction` now admits `extraction_failed` (unchanged, immediate) **or a stale round**; the membership and role check runs first and is unchanged. The staleness test is a gate against a pointless call only: `claim_interview_extraction` re-evaluates status and `claimed_at` atomically and stays the authority, so a wrong clock or a race with the original extraction is refused there. (3) `computeInterviewPageState`'s `extracting` state carries `stale`. `InterviewPanel` polls `router.refresh()` every `POLL_MS = 4000` while extracting (and only then), stops on unmount and after a 20-minute maximum, and shows the stale copy and a **Retry** only once `stale`. New copy in en, pt and es (`ui.extracting.{stale_body, retry}`). |
| **Proof** | Tier 2 (`actions.test.ts`, 9 new): the after() callback returns a promise that resolves; a REJECTED extraction reaches `Sentry.captureException` with the exact tags for **submit** and for **retry** (an `AggregateError` captured whole), and the callback still resolves; a returned typed outcome is not captured; **retry on an extracting round claimed 11 minutes ago reaches the orchestrator, at 9 minutes it returns `not_open` and schedules nothing**; a submitted round by `submitted_at` at 11 and 9 minutes; **a non-member and a viewer on the stale round get `forbidden` and extraction never fires**; `extraction_failed` stays retryable at once. `stale.test.ts` (new, 14): the literal boundary (10 min + 1 s stale, exactly 10 min and 9 min 59 s not), submitted-by-`submitted_at`, missing/unparseable clock, and every other status never stale. `page-state.test.ts`: the state's `stale` at 11 and 9 minutes for both statuses. `InterviewPanel.test.tsx` (5 new, fake timers): nothing at 3999 ms, one at 4000, three by 12000; no polling in any other state; stops on unmount and at the 20-minute maximum; no Retry while fresh; the stale copy and a Retry that calls the retry action for this round and refreshes. **Tier 1 (already present, cited):** `interview-lifecycle.test.ts:471` (a claim 9 minutes old is refused) and `:479` (a claim 11 minutes old is admitted, attempt 2, spend 20). |
| **Reddening** | 9 mutations, each source file backed up and restored byte-for-byte: (a) `void extractInterviewRound(...)` put back -> the promise-returned and capture tests RED; (a2) the capture removed -> the capture tests RED; (b) retry gated on `extraction_failed` only -> the 11-minute cases RED; (c) no polling interval -> the poll tests RED; (d) the membership check dropped -> the non-member cases RED (including the pre-existing one); (e) the boundary `<` changed to `<=` -> the boundary case RED; (f) the page state never stale -> RED; (g) Retry always shown -> the "no Retry while fresh" case RED; (h) the poll never stops at the maximum -> RED. |
| **Commit** | this commit (D6) |

**Two deviations from the build guide, stated.** (1) BUILD step 3 says to poll *"with BackfillPanel's max-duration stop"*. `BackfillPanel` has **no** max-duration stop (its interval runs while a run is active), so there was nothing to copy. `InterviewPanel` polls at BackfillPanel's `POLL_MS = 4000` and adds its own 20-minute maximum, so a tab left open on a stalled round does not poll for ever. Retry does not depend on polling. (2) The guide's snippet is `.catch(...)` on the promise; the implementation is an `async` `try`/`catch` wrapper instead, because it also captures a synchronous throw and does not depend on the callee returning a promise. Behaviour and tags are as specified.

**Assertions that changed:** none weakened. Two typed fixtures for the `extracting` state gained `stale: false` (`InterviewPanel.test.tsx`, `page-state.test.ts`); the existing submit and retry after() tests pass unchanged.

**SHARED-FUNCTION CALLERS** (rule 9): `extractInterviewRound` production callers and their tests:

| Caller | Now | Test |
|---|---|---|
| `submitInterviewRoundAction` (`interview/actions.ts`) | via `extractInBackground(id, 'submit')` | `actions.test.ts` (callback returned, capture tagged `submit`) |
| `retryInterviewExtractionAction` (`interview/actions.ts`) | via `extractInBackground(id, 'retry')`, for `extraction_failed` or a stale round | `actions.test.ts` (11 vs 9 minutes, submitted, non-member, failed, capture tagged `retry`) |

`computeInterviewPageState` (whose `extracting` state gained `stale`) callers: `loadInterviewPageState` (dashboard layout, `InterviewCard`, `/interview`), tested in `page-state.test.ts` and `load-page-state.test.ts`.

**Full-suite confirmation (D6):** `npx tsc --noEmit --skipLibCheck` clean. `npx eslint .`: `✖ 112 problems (0 errors, 112 warnings)`, unchanged. `npm run test:app` (CI env block): **373 files / 5493 tests** green (was 372/5464: +1 file, `stale.test.ts`, +29 tests). `npm run test:db` against the LOCAL stack only (no migration or DB test file changed in this step; the run is the full-loop confirmation): **107 files / 1127 tests green** (unchanged from D5, as expected: no DB test or migration changed). The skip-guard is satisfied: no file executed zero tests.

**What this step did NOT touch:** no SQL and no migration; no push (rule 10); `docs/decisions/*` untouched (D10); D7 (role-aware card and badge, single page-state load) not started.

### D7 — MINOR-2 + MINOR-9: the card and badge respect role, and the page state is loaded once per request

Presentation-only: no SQL, no RPC, no migration.

**ADR 0029 §5.5, read and recorded (BUILD step 1):** the card and badge are *"shown to members with author rights when a round is **due** or **open**, and to ratifiers when one is **awaiting ratification**"*. The exact roles, each mirroring the RPC it stands in front of:

| Predicate | Rule | The RPCs it mirrors |
|---|---|---|
| `canAuthorInterview` | `role` is `editor` or `approver` (the `AUTHOR` capability; `is_admin` does **not** admit these) | `create_interview_round`, `save_/skip_interview_answer`, `skip_/submit_interview_round`, the retry action |
| `canRatifyInterview` | `role` is `approver` **or** `is_admin` | `ratify_interview_round` (`20260925140000:102-111`); deliberately **not** the `APPROVE` capability |

State visibility: `due`, `in_progress`, `extracting`, `extraction_failed` -> authors; `awaiting_ratification` -> ratifiers; every other state -> nobody.

| Field | MINOR-2 |
|---|---|
| **Finding** | MINOR-2: `isInterviewCardState` was role-blind, and the layout and `InterviewCard.tsx` used it as is. A viewer saw "due" with a Start link the RPC refuses; an editor got a badge for a ratification they cannot perform. |
| **Fix** | `isInterviewCardState(state, member)` now takes the member (`MemberCapabilityContext`, so role and `is_admin`) and applies the table above; `canAuthorInterview` / `canRatifyInterview` are exported beside it. `InterviewCard` takes `member` instead of `isRatifier`, and returns null **without loading** for a member holding neither role. The layout's badge goes through a new `loadInterviewBadge(client, business, member)` in `load-page-state.ts` (see deviations), which applies the same rule and skips the load for a viewer. The campaigns page passes `member` to both of its `InterviewCard` renders. |
| **Proof** | Tier 2, per role (`page-state.test.ts`, 26 new): viewer, editor, approver, **editor + admin** and **viewer + admin** across `due`, `in_progress`, `extracting`, `extraction_failed` and `awaiting_ratification`, plus the two predicates directly. `InterviewCard.test.tsx` (5 new): a viewer sees no card in any state and the load is not made; an editor sees due and open but not a ratification; an approver sees all three; an admin who cannot author sees the awaiting card and no due card; the loader is told `isRatifier` exactly when the member can ratify. `load-page-state.cache.test.ts` (`loadInterviewBadge`, 4 new): the same rule for the nav badge. |
| **Reddening** | (a) the author states made role-blind -> the viewer and admin-viewer cases RED; (a2) the ratification state made role-blind -> the viewer and editor cases RED; (a3) ratifier narrowed to `approver` only (the `APPROVE` capability) -> every admin case RED; (a4) author widened to include admin -> the admin-viewer cases RED; (a5) the card's viewer short-circuit removed -> RED; (a6) the badge's viewer short-circuit removed -> RED. Restored each byte-for-byte. |
| **Commit** | this commit (D7) |

| Field | MINOR-9 |
|---|---|
| **Finding** | MINOR-9: `layout.tsx` called `loadInterviewPageState` on every dashboard page, and `/campaigns` called it again through the card; each call can read up to 3 x 500 memory rows plus the cooldown rows. |
| **Fix** | `loadInterviewPageState` keeps its signature and is memoised per request with React `cache()` keyed on primitives only (`business.id`, `interview_snoozed_until`, `isRatifier`): the layout, the card and the `/interview` page of one request share one load. The first caller's `client` does the reads, so a client is deliberately not part of the key. A Server Action's revalidation and the panel's polling `router.refresh()` are new requests and read fresh state. A rejection is shared within the request. |
| **Proof** | `load-page-state.cache.test.ts` (new, 7 cases plus the 4 badge cases): two calls with the same arguments run the reads **once** and share the result; three callers with three different client objects share one load; the first caller's client does the reads; a different business, snooze instant or ratifier flag is a different key; a new request reads fresh state; the badge and a card share one load; a failure is shared. React's `cache()` only memoises inside a server render, so the file replaces it with a faithful memoiser and an explicit "new request" reset (stated in the file). |
| **Reddening** | (b) `cache(` unwrapped -> five cases RED. Restored byte-for-byte. |
| **Commit** | this commit (D7) |

**Deviations and gaps, stated.**
1. **`loadInterviewBadge` (new).** The layout is an async Server Component, and its badge expression would otherwise have been authored but never executed by a test. The rule moved into `loadInterviewBadge` next to the loader, where it is tested; the layout is one call.
2. **`layout.test.tsx` was not "stays green" as is.** It mocks `@/lib/interview/load-page-state` wholesale, so it needed the new export in its mock (`loadInterviewBadge` resolving `false`, replacing `loadInterviewPageState`). Only the mock changed; its Sentry and onboarding-guard assertions are untouched and green.
3. **`InterviewCard`'s props changed** (`isRatifier` -> `member`), and its one production caller, `campaigns/page.tsx`, changed with it. `loadInterviewPageState`'s signature is unchanged, as the guide requires.
4. **"`/campaigns` calls it twice more"** is two mutually exclusive render branches (empty state and list), so one request renders one card; the shared load matters for the layout + card + page.
5. **Residual, not fixed (out of D7's scope).** The `/interview` page itself still renders the `due` state, with its Start button, to a viewer who follows the URL. D7 fixes the card and the badge, which is what MINOR-2 and §5.5 name; the RPC refuses the action.

**SHARED-FUNCTION CALLERS** (rule 9), `loadInterviewPageState`:

| Caller | Now | Test |
|---|---|---|
| `app/[locale]/(dashboard)/layout.tsx` | via `loadInterviewBadge` (skipped for a viewer) | `load-page-state.cache.test.ts` (`loadInterviewBadge`), `layout.test.tsx` (mocked) |
| `components/interview/InterviewCard.tsx` (from `campaigns/page.tsx`) | direct, skipped for a viewer | `InterviewCard.test.tsx` |
| `app/[locale]/(dashboard)/interview/page.tsx` | direct (unchanged) | `load-page-state.test.ts` (uncached behaviour), `InterviewPanel.test.tsx` |

`isInterviewCardState` callers: `loadInterviewBadge`, `InterviewCard.tsx` (the layout no longer imports it), tested in `page-state.test.ts`.

**Assertions that changed, none weakened:** the five pre-D7 `isInterviewCardState` assertions and the `InterviewCard` cases now pass an approver (who holds both roles) as the member, so they assert exactly what they did before. `layout.test.tsx` changed only its mock.

**Full-suite confirmation (D7):** `npx tsc --noEmit --skipLibCheck` clean. `npx eslint .`: `✖ 112 problems (0 errors, 112 warnings)`, unchanged. `npm run test:app` (CI env block): **374 files / 5535 tests** green (was 373/5493: +1 file, `load-page-state.cache.test.ts`, +42 tests). No `test:db`: D7 changes no SQL and no DB test (the guide's loop for this step is tsc, lint, `test:app`).

**What this step did NOT touch:** no SQL and no migration; no push (rule 10); `docs/decisions/*` untouched (D10); D8 (action failures shown and focused) not started.

### D8 — MINOR-1: every action failure is shown and receives focus

Presentation-only: no SQL, no RPC, no migration.

| Field | MINOR-1 |
|---|---|
| **Finding** | `InterviewPanel.tsx` ignored `!result.ok` in the top-level actions (Start, Not now, Retry), the answering surface (Submit, Skip round, skip-question) and ratify. `performance_claim` (`actions.ts`) had **no message key in any locale**: an approver whose edit mentioned "reach" clicked Ratify and nothing happened. |
| **Fix** | A shared `useActionErrors(onStateMoved)` hook and `ActionErrorRegion` component, one instance per surface (the top-level panel, the answering panel, the ratify panel). Every action now runs through `run()` (renamed `runAction` after the lint fix below), which: sets the message and moves focus to the region on a throw, an `{ ok: false }`, **or a typed non-success outcome** (`not_open`, `not_found`, `no_answers`, `too_soon`, `round_open`, `not_skippable`, `not_awaiting`); calls the success callback only on a genuine success (`ok`, `retrying`, `nothing_thin`, `ratified`, `already_snoozed`); and re-reads the page state when the failure means the round moved on (`not_open`). The region is `role="alert" tabIndex={-1}`, one per surface, and message keys are `ui.errors.{unauthenticated, not_found, forbidden, validation, performance_claim, generic, not_open}` — **no new error code is invented**: the set is `InterviewActionError` from `actions.ts` plus `not_open` for the typed non-success outcomes a stale page provokes. All seven keys added to en, pt and es (additions only). |
| **Proof** | `InterviewPanel.test.tsx`, "D8" (11 new): ratify `performance_claim` shows the message (previously absent) and takes focus, and the round is not refreshed as a success; start `forbidden`; Not-now `unauthenticated`; submit `validation`; skip-round `not_found`; retry's `not_open` (D6) is shown, focused, **and re-reads the state**; a thrown action becomes `generic` rather than an unhandled rejection; an error code the panel does not recognise falls back to `generic`; `too_soon` / `round_open` from Start are shown as `not_open`, not swallowed; a later success clears an earlier error; every code has a non-empty message in all three locales. |
| **Reddening** | 7 mutations, each source file backed up and restored byte-for-byte: (a) the focus effect removed -> every focus assertion RED; (b) `performance_claim` deleted from es -> the parity test AND the D8 key-coverage test RED; (c) `fail()` made a no-op -> every failure-surfacing case RED; (d) the `not_open` re-read removed -> the retry case RED; (e) a thrown action left to propagate -> the thrown-action case RED; (f) a non-success outcome treated as success -> the `not_open` and `too_soon`/`round_open` cases RED; (g) an unrecognised code passed through unmapped -> the fallback case RED. |
| **Commit** | this commit (D8) |

**One correction during VERIFY, not in the guide's script.** The straightforward implementation (`errors.regionRef` read inside the JSX returned by `ActionErrorRegion({ errors })`) failed `npx eslint .` with **3 errors**: `react-hooks/refs`, "Cannot access refs during render" — reading `errors.regionRef` as a **property access inside the render body** trips the same rule class BLOCKER-1 (D2) fixed for `set-state-in-effect`. Per CLAUDE.md's carve-out list this is not one of the accepted `any`-adjacent exceptions, so it is a real lint error, not house style. Fixed by **destructuring** the hook's return at the call site (`const { error, regionRef, run } = useActionErrors(...)`) and passing the plain `error` value and the `regionRef` object itself as two props, rather than passing the whole hook-result object through and reading `.error` / `.regionRef` off it inside JSX — the destructure happens once, outside the returned tree, same as every other `useRef` in this file. Confirmed: `npx eslint .` **0 errors** before commit; the destructuring changed no behaviour (all 136 `InterviewPanel.test.tsx` tests, including the 11 new D8 cases, pass identically before and after).

**Two render-only additions to the test harness, stated.** (1) The focus effect commits and fires in a React effect, not a `requestAnimationFrame`, so the tests read `document.activeElement` immediately after the awaited action rather than needing a synchronous rAF stub. (2) `InterviewAnswerPanel`'s pre-existing mount-focus effect (§8.7, moves focus to the first question on open) races the new SUBMIT and SKIP-ROUND error tests in jsdom; both tests await one macrotask before clicking so the mount effect settles first — a test-only accommodation, not a production change (`git diff --stat` on `InterviewPanel.tsx`'s mount-focus block is empty).

**SHARED-FUNCTION CALLERS** (rule 9): `useActionErrors` / `ActionErrorRegion` have three call sites, all in this one file — the top-level `InterviewPanel` switch, `InterviewAnswerPanel`, `InterviewRatifyPanel` — each exercised by its own `describe` block in `InterviewPanel.test.tsx`, listed above.

**Full-suite confirmation (D8):** `npx tsc --noEmit --skipLibCheck` clean. `npx eslint .`: `✖ 112 problems (0 errors, 112 warnings)`, unchanged (the 3-error regression above was caught and fixed before this count). `npm run test:app` (CI env block): **374 files / 5547 tests** green (was 374/5535: +12 tests, no new file — `lib/i18n/interview-parity.test.ts` needed no change, since the parity test already walks every key). No `test:db`: D8 changes no SQL and no DB test.

**What this step did NOT touch:** no SQL and no migration; no push (rule 10); `docs/decisions/*` untouched (D10); D9 (`INTERVIEW-NO-BUDGET-PURPOSE` scan widened) not started.

### D9 — NIT-3: `INTERVIEW-NO-BUDGET-PURPOSE` detects `= ANY (ARRAY[...])` as well as `IN (...)`

Test-only. No production file touched.

| Field | NIT-3 |
|---|---|
| **Finding** | `lib/interview/__tests__/source-scans.test.ts:217-230`'s detector for constraint 32 (`INTERVIEW-NO-BUDGET-PURPOSE`, ADR 0029 §7.3, A-4) matched only `CHECK (purpose IN (...))`. A widening of the same CHECK written as `purpose = ANY (ARRAY[...])` — an equally valid, equivalent Postgres CHECK shape — escaped the regex entirely. |
| **Fix** | `latestBudgetPurposes` now matches both `purpose IN (...)` and `purpose = ANY (ARRAY[...])`, case- and whitespace-insensitive (`\s*`/`\s+` throughout, so a line-wrapped or mixed-case `Any (Array[...])` is still caught), still scoped to the `ai_budget_daily` table and the `purpose` column, still reading the **latest** migration that defines it. A comment block above the function records the **residual blind spots** the detector still has, in ADR §10.3's table format: a `CREATE DOMAIN ... CHECK` applied via the column's type; a value list moved into a separate lookup table with an FK; and the (non-)risk of two overlapping `ALTER`s inside one migration. |
| **Proof** | Two new planted positives: a `= ANY (ARRAY[...])` widening to five values is caught, with the fifth (`interview_cents`) present; the same form is caught across a line wrap, mixed case (`Any`, `array`) and extra whitespace. One new planted negative: an unrelated `= ANY (ARRAY[...])` CHECK on a **different column** (`status`) or a **different table** is ignored, and the real `purpose IN (...)` value list on `ai_budget_daily` still wins. The pre-existing "detector reads the LATEST definition" and "ignores commented-out / unrelated CHECKs" cases, and the real-migration assertion (still exactly the four baseline purposes), are unchanged and still pass. |
| **Reddening** | (a) the detector reverted to the old `IN`-only regex -> both new planted positives RED (`expected undefined to be '20260930000000_b.sql'`, and the mixed-case/line-wrap case failing to contain `interview_cents`); every other assertion, including the planted negatives, stayed green -- confirming the mutation isolated exactly the intended gap. Restored byte-for-byte (`git diff --stat` empty). |
| **Commit** | this commit (D9) |

**The scan run over D4's migration.** `supabase/migrations/20260928100000_interview_correction_pass.sql` does not touch `ai_budget_daily` at all (one comment line mentions "budget purpose" in prose, no SQL). The widened detector's "the latest real definition has exactly the four baseline purposes" test therefore exercises the **whole real migration set unaffected by D4**, and stays green: the latest real `ai_budget_daily` purpose CHECK is still `20260922110000`'s four-value `IN (...)` form (M2.0 premise 9, unchanged since M2). This is the guide's VERIFY requirement ("the scan runs over D4's migration and stays green") -- satisfied because D4 adds nothing for the scan to see, not because the widened regex was exercised against new SQL. If the founder later widens the CHECK in a migration written as `= ANY (ARRAY[...])`, this step is what makes that visible instead of silently escaping.

**SHARED-FUNCTION CALLERS** (rule 9): `latestBudgetPurposes` has one caller, `describe('INTERVIEW-NO-BUDGET-PURPOSE ...')` in the same file; no production code calls it (it is a scan over migration source, not a runtime function).

**Full-suite confirmation (D9):** `npx tsc --noEmit --skipLibCheck` clean. `npx eslint .`: `✖ 112 problems (0 errors, 112 warnings)`, unchanged. `npm run test:app` (CI env block): **374 files / 5550 tests** green (was 374/5547: +3 tests, no new file). No `test:db`: D9 touches no SQL and no `supabase/__tests__` file.

**What this step did NOT touch:** no SQL, no migration, no production TypeScript; no push (rule 10); `docs/decisions/*` untouched (D10); D10 (documentation truth) not started.
