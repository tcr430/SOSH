# Session 22 — Test-Execution Integrity & Approvals Hardening (ADR 0015 + ADR 0014 Amendment A)

> **Goal:** close the two *systemic* gaps 21B/21C surfaced — (1) **no CI job executes the app-layer Vitest
> suite**, so every 21B/21C UI/flow constraint is "authored, not executed", and (2) the `db-tests` stack is
> **intermittently red from a reproducible Postgres OOM**, so "green in CI" is not reproducible on demand —
> and then clear the residual approvals findings, chief among them the **atomicity-preserving fix for bulk
> approve** (the 21C correction merely *disabled* the affordance under a filter).
>
> **Zero product scope.** No new capability, no migration, no Stripe, no new route. This is pre-launch debt.
> After 22, `covered` means `executed on every push`, and the approvals inbox is honest about what it
> approves and what it is hiding.
>
> **Status:** §0 adjudicated. **ADR 0015 + ADR 0014 Amendment A written and accepted** (Architect, Opus).
> §0.1 records the Architect's grounded corrections to this brief and the **three defects found in the
> ADRs during founder review** — the Builder consumes §0.1 as binding. §2 is live.
>
> **How to use this file:** paste each phase into Claude Code in order. **Architect → Opus (done).
> Builder → Sonnet. Reviewer → Opus. Correction → Opus.** §2 opens with a **primer** — paste it, wait for
> acknowledgement, then paste B0…B7 one at a time.
>
> **One step, one commit.** 21C squashed C1+C2 and its Reviewer could not verify phase isolation (21C n2).
> B3 (behaviour) and B5 (visual/a11y) must be separately reviewable commits.
>
> **Design plugins.** `impeccable-design-and-taste` + the taste skill activate on **B5 only**, behind the
> confirmation gate. Not invoked in B0–B4, B6, B7.

---

## §0 — Locked decisions (binding input — adjudicated on claude.ai)

**Locked (L):**

- **L-1 — Two workstreams, one session.** **W1 = test-execution integrity** (ADR 0015). **W2 = approvals
  hardening** (ADR 0014 Amendment A). Shared Reviewer, independently committable. **W1 lands first** —
  W2's regression tests are worthless until something executes them.
- **L-2 — `db-tests` OOM remedy = tune + shard.** Disable every Supabase service the suite does not use;
  cap the Postgres runtime knobs for a 2-core runner; shard into two jobs only if a full run still OOMs.
  **Losers:** bare `postgres` container (the suites sign in with real anon-key clients — GoTrue is not
  optional); a paid larger runner (buys a green light without understanding the crash).
- **L-3 — App-layer suite gets its OWN workflow** (`app-tests.yml`: `tsc` + `eslint` + `vitest run`, every
  push/PR). **Loser:** a job inside `db-tests.yml` — DB flakiness would mask the app signal, the exact
  failure being fixed.
- **L-4 — Per-suite integration flags are DELETED**, replaced by a **skip-guard meta-test**: a suite may be
  RED, it may never be INVISIBLE. **Loser:** keep-and-force-ON (one env-var typo re-opens the false-green
  that produced the INV-REISSUE-SAME-ROW lie in 21B).
- **L-5 — Merge gates written down.** `app-tests` required immediately; `db-tests` required after three
  consecutive full green runs. **Loser:** requiring `db-tests` now (blocks every merge on a known-flaky stack).
- **L-6 — Bulk approve is re-enabled, atomically, and approves ONLY what the approver could see.** One
  statement; the `enforce_post_transition_capability` trigger still gates every row. **Losers:** leaving it
  disabled under a filter (product regression); a per-id loop over `approvePostAction` (destroys atomicity —
  the property bulk exists to provide). *(Refined by §0.1/F1 — see APV-BULK-VISIBLE-ONLY.)*
- **L-7 — APV-PAGINATED = honest overflow signal, not pagination.** Bounded query + "showing N of M";
  cursor pagination deferred with a named un-defer trigger. **Loser:** cursor pagination now (unearned at
  trial-50 / Plus-50-per-month caps).
- **L-8 — Team Server Actions carry a capability echo.** *(Satisfied at HEAD — see §0.1/C6. Session 22
  regression-guards it rather than implementing it.)*
- **L-9 — PROC-REVIEW-AT-COMMIT.** Reviewers read every file at the stated commit range, never at HEAD.
  Reading at HEAD produced 21B's false-positive M1 (withdrawn by the 21C reviewer). Goes into `CLAUDE.md`
  and every future Reviewer primer.
- **L-10 — Zero product scope.** No new capability, no schema change beyond the Amendment-A query predicate,
  no Stripe, no new route, no 0013/0014 model change.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | OOM remedy | tune + shard if needed | bare-postgres container (no GoTrue → anon-key sign-in tests die); bigger paid runner (hides the bug) |
| D-2 | App-suite CI home | standalone `app-tests.yml` | job inside `db-tests.yml` (DB flake masks app signal) |
| D-3 | Integration flags | delete + skip-guard meta-test | keep-and-force-ON (one typo re-opens the false-green) |
| D-4 | Merge gates | `app-tests` required now; `db-tests` after 3 consecutive greens | require `db-tests` immediately (blocks all merges on a flaky stack) |
| D-5 | Bulk approve + filter | filter-scoped, one atomic statement | permanently disabled (product regression); per-id loop (non-atomic) |
| D-6 | Pagination | overflow signal + server-side filters; cursor pagination → backlog | cursor pagination now (unearned at launch caps) |
| D-7 | Team-action echo | `canServer('manage_members')` echo | stay deferred (leaves ADR 0014 §5.3 describing behaviour that does not exist) |

---

## §0.1 — Post-ADR corrections (BINDING — read before B0)

The Architect grounded ADR 0015 + Amendment A in the actual repo and corrected this brief in several
places. Founder review of the ADRs then found **three defects**. Both sets are binding on the Builder;
where §0.1 and the ADR text disagree, **§0.1 wins**, and the Builder records the deviation in its plan.

### Corrections FROM the Architect (my brief was wrong; the ADR is right)

- **C1 — npm, not pnpm.** No pnpm lockfile exists (`db-tests.yml:37-40` runs `npm ci`, Node 24 / npm 11).
  All workflow contracts use npm.
- **C2 — `tsc` must run `--noEmit --skipLibCheck`**, and `vitest run` must be **scoped via
  `vitest.config.ts` `include`** (bare `vitest run` otherwise picks up ECC plugin tests that call
  `process.exit()`). The scope is fixed once in config, not as an inline path list — a path list would
  silently drop `app/**` and `components/**`, the very suites 22 exists to switch on.
- **C3 — Eleven flags, not two.** `*_INTEGRATION_TEST_ENABLED` × 11 (`db-tests.yml:134-144`), each read by
  its own suite file. All eleven die.
- **C4 — Postgres memory knobs cannot live in `config.toml`.** The `[db]` block exposes only
  `port`/`shadow_port`/`major_version`/`[db.pooler]`. The knobs go where Postgres reads them (ADR 0015
  §3.2b) — **subject to F3 below.**
- **C5 — `listPendingDraftPosts` ALREADY filters server-side** (`posts.ts:125-126`). The dead part (21C n3)
  is that `page.tsx:40` passes only `{ businessId }`; and `countPendingDraftPosts` is **business-scoped
  only** — *that* is what must learn the predicate, or a filtered view will show a business-wide total and
  lie in the other direction.
- **C6 — ROLE-TEAM-ECHO is ALREADY implemented** (`settings/team/actions.ts:101,160,186,213`). 21B m2 is
  closed. Session 22 adds the **regression test**, not the code. Likewise **21C n1** (comment rot) and
  **21B n1** (manifest) were closed in 21C/E2–E3 — B6 **re-verifies**, expecting no work.
- **C7 — The contrast fix may already be in.** HEAD shows `text-amber-700` / dark `amber-300`
  (`ApprovalsInbox.tsx:309`). B5 **verifies both themes empirically**; it does not re-fix blind.
- **C8 — Do not clobber the uncommitted `config.toml` diff** (`enable_confirmations = false → true`,
  `[auth.email]`) — unrelated to this session, and email confirmation is a hard constraint (21B).

### Defects found in the ADRs during founder review (fix these; they are the point)

- **F1 — 🔴 The A1 count invariant does NOT hold under truncation. `APV-BULK-VISIBLE-ONLY` is added.**
  `bulkApproveDraftPosts` has **no row limit** — it approves *every* matching draft in the campaign. The
  inbox renders from a **200-row window** (A2). So whenever `total > 200`: campaign X has 60 pending drafts
  but only 12 are inside the window → the button reads *"Approve all (12)"* → the DB approves **all 60**,
  including 48 the approver never saw. **This is 21C M1 exactly, with truncation as the mechanism instead
  of a platform filter.** A1 proves label = approved = removed = announced *only when the rendered set is
  complete*, and never states that precondition.
  **Fix (adjudicated):** bulk is offered **iff the rendered set for that campaign + active filters is
  provably complete** — i.e. the count of rows shown for that predicate equals the server's total for the
  **same** predicate. When it is not complete, the bulk button is **disabled with an honest message**
  ("Filter down to approve in bulk"), never silently over-approving. New constraint
  **`APV-BULK-VISIBLE-ONLY`** (Tier-2), with an explicit >200-draft test. *Rejected alternative:* bulk by
  explicit visible ids (`.in('id', ids)`) — invariant true by construction, but 200 UUIDs ≈ 7 KB of
  PostgREST URL, uncomfortably near the 8 KB limit. *Rejected alternative:* accept over-approval above 200
  — it breaks the human-in-the-loop promise 21C M1 exists to protect.
  **This also gives A2's un-defer trigger teeth:** the first production overflow now degrades a real
  affordance, which is exactly the signal that should unlock cursor pagination.
- **F2 — 🔴 ADR 0015 §4's skip-guard ships a NEW false-green.** The contract runs
  `npm run test:db … || true` and then asserts only *emptiness*. A DB test that genuinely **fails** now
  exits 0 and the job passes. An ADR about false-greens must not ship one.
  **Fix:** `scripts/ci/assert-no-empty-suite.mjs` asserts **both** invariants and re-propagates failure —
  it exits non-zero if any `supabase/__tests__` file ran zero/all-skipped tests **or** if the JSON reports
  any failed test. Nothing invisible, **and** nothing red, or the job fails. New constraint
  **`CI-NO-SWALLOWED-FAILURE`** (process).
- **F3 — 🟠 `ALTER SYSTEM` is very likely wiped by the restart it depends on.** `ALTER SYSTEM` writes
  `postgresql.auto.conf` **inside PGDATA**; `supabase stop --no-backup` destroys the volume, so the
  restart-only knobs (`shared_buffers`, `max_connections`) can come back at defaults while the job reports
  green — the remedy silently no-ops.
  **Fix:** restart the **DB container** (volume-preserving) rather than tearing the stack down, and
  **prove it**: immediately after the restart, `SHOW shared_buffers; SHOW max_connections; SHOW work_mem;`
  must reflect the caps. If they do not, **STOP and report** — do not proceed on an unverified remedy.
  New constraint **`CI-KNOBS-VERIFIED`** (process).

**Constraint set for the Reviewer** = ADR 0015 §7 (CI-*, PROC-REVIEW-AT-COMMIT) + ADR 0014 Amendment A3
(APV-*, ROLE-TEAM-ECHO) + the three added here: **`APV-BULK-VISIBLE-ONLY`**, **`CI-NO-SWALLOWED-FAILURE`**,
**`CI-KNOBS-VERIFIED`**.

---

## §1 — Architect  ✅ COMPLETE

Delivered: `docs/decisions/0015-test-execution-and-ci-gates.md` (Accepted) and ADR 0014 **Amendment A**
(Accepted, appended). Both are grounded in the repo, name their losers, and tier every constraint. §0.1
records the three defects found in founder review; they are handled at Builder time (F1 as an Amendment-A
refinement the Builder encodes; F2/F3 as ADR 0015 corrections). **No re-Architect pass is required** — but
B0 makes the Builder restate them, so they cannot be lost.

---

## §2 — Builder session  (paste into Claude Code · Sonnet)

Eight steps, dependency-ordered, each a self-contained `/ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop` cycle. **Paste the primer (§2a) first, wait for acknowledgement, then paste B0…B7
one at a time**, letting each go green + commit before the next.

Hard rules inherited by every step (CLAUDE.md): env only via `lib/config.ts`; DB only via `lib/db/`;
service-role client via lazy import and **never** in a user-facing path; timestamps via `date-fns`
(`formatISO`, never `new Date().toISOString()`); no `any`, no `console.*`; all strings through i18n
(en/pt/es); atomic transitions via conditional `WHERE` guards; no unbounded queries. **No migration, no new
DB object, no Stripe, no new route, no new product capability.** If any step appears to require one, **STOP
and report** — that contradicts ADR 0014 Amendment A and ADR 0015 §9.

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 22 — Test-Execution Integrity & Approvals Hardening, BUILDER phase. You will transcribe ADR 0015
and ADR 0014 Amendment A into CI workflows, data-layer changes and tests, across eight steps (B0…B7).
You are not the designer: the ADRs are authoritative, as refined by session-22.md §0.1.

Read now, before anything else:
- docs/decisions/0015-test-execution-and-ci-gates.md — the whole ADR. §7 constraints (CI-*, PROC-*) are
  half your acceptance checklist.
- docs/decisions/0014-seats-permissions-flow-surface.md — Amendment A (A0…A4). The A3 constraint table
  (APV-*, ROLE-TEAM-ECHO) is the other half.
- docs/build-guide/session-22.md §0.1 — BINDING. It carries the Architect's grounded corrections (C1–C8)
  AND three defects found in the ADRs during founder review (F1, F2, F3). Where §0.1 and an ADR disagree,
  §0.1 WINS and you record the deviation in your /ecc:plan.
- docs/reviews/session-21c-reviewer.md — M1 and its failure scenario, verbatim. It is the test you write.
- CLAUDE.md — hard rules; the tsc/vitest invocation notes.
- .github/workflows/*, supabase/config.toml, vitest.config.ts, package.json.
- lib/db/posts.ts (listPendingDraftPosts, countPendingDraftPosts, bulkApproveDraftPosts), the /approvals
  route + ApprovalsInbox, campaigns/[id]/posts/actions.ts, settings/team/actions.ts.

Invoke ECC in build posture (/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop per step).
Do NOT invoke impeccable-design-and-taste yet — it activates at B5 only, and I will confirm it there.

Do NOT write code yet. Confirm these grounding facts (a wrong one is a STOP):
(1) no existing CI job runs vitest over the app suite (confirm, listing every workflow);
(2) the exact count of *_INTEGRATION_TEST_ENABLED flags and every file that reads one;
(3) the current signature + WHERE of bulkApproveDraftPosts, and whether the inbox bulk button is currently
    DISABLED under an active platform filter (the 21C stopgap) — cite file:line;
(4) whether listPendingDraftPosts already applies campaignId/platform server-side, and whether
    countPendingDraftPosts does (C5 says: it does not — verify);
(5) whether settings/team/actions.ts already calls canServer(MANAGE_MEMBERS) in all four actions (C6 says
    yes — verify), and what the skip-button colours are at HEAD in BOTH themes (C7);
(6) that enforce_post_transition_capability is a BEFORE UPDATE per-row trigger on posts and is the sole
    gate on →approved.
Then restate, in your own words, what F1 / F2 / F3 (§0.1) require you to do differently from the ADR text.
Output the six findings + the F-restatement + "Ready for B0." Then stop.
```

### §2b — Builder steps

#### B0 — Encode the three ADR corrections  ·  §0.1 F1, F2, F3

```
BUILDER — Session 22 · B0. Docs only. No CI, no app code, no tests. This step exists so the three defects
found in founder review are RECORDED in the ADRs before any code assumes the un-corrected text.

DO:
- ADR 0014, Amendment A: add A1.1 — APV-BULK-VISIBLE-ONLY (§0.1 F1). State the truncation failure
  (campaign with 60 pending drafts, 200-row window shows 12, button says 12, DB approves 60) as the
  regression the constraint forbids; state the rule (bulk is offered IFF the rendered set for that
  campaign + active filters is provably complete: rows-shown-for-that-predicate === server total for the
  SAME predicate); state the disabled-with-honest-message fallback; add the constraint to the A3 table
  (Tier-2). Record the rejected alternatives (id-list bulk → PostgREST URL length at 200 UUIDs; accepting
  over-approval → breaks the human-in-the-loop promise). Note that this makes A2's un-defer trigger real:
  the first production overflow now degrades a real affordance.
- ADR 0015 §4: correct the skip-guard contract (§0.1 F2). `|| true` + an emptiness-only assertion means a
  genuinely FAILING db test exits 0 and the job passes — a new false-green inside the anti-false-green ADR.
  The guard asserts BOTH: (i) no supabase/__tests__ file ran zero/all-skipped tests, AND (ii) zero failed
  tests in the JSON; it re-propagates failure. Add CI-NO-SWALLOWED-FAILURE to §7.
- ADR 0015 §3.2b: correct the knob step (§0.1 F3). ALTER SYSTEM writes postgresql.auto.conf inside PGDATA;
  `supabase stop --no-backup` destroys the volume, so the restart-only knobs can silently revert. Specify a
  volume-preserving DB-container restart, and a MANDATORY verification (SHOW shared_buffers /
  max_connections / work_mem must reflect the caps) that STOPS the job if unmet. Add CI-KNOBS-VERIFIED to §7.

Do NOT change any other ADR text. Do NOT re-litigate a locked decision.
On commit, output "B0 complete — ADR 0014 A1.1 + ADR 0015 §3.2b/§4 corrected (APV-BULK-VISIBLE-ONLY,
CI-NO-SWALLOWED-FAILURE, CI-KNOBS-VERIFIED)." Then stop.
```

#### B1 — App-layer suite in CI  ·  ADR 0015 §3.1, §5  ·  CI-APP-SUITE-EXECUTED

```
BUILDER — Session 22 · B1. Transcribe ADR 0015 §3.1 + §5. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop.

BUILD (npm — there is no pnpm in this repo, C1):
- vitest.config.ts — add the `include` from §3.1 so a bare `vitest run` deterministically runs the FULL
  SOSH suite (app/** + lib/** + components/**) and nothing from ECC/plugins. Keep the existing exclude.
- package.json — `typecheck` (tsc --noEmit --skipLibCheck), `test:app` (vitest run), `test:db`. One
  scripted entrypoint each; no inline command drift between local and CI.
- .github/workflows/app-tests.yml — exactly per the §3.1 contract: push + PR; Node 24 / npm 11; npm ci;
  npm run typecheck; npm run lint; npm run test:app. It MUST NOT start the Supabase stack and MUST NOT
  depend on db-tests (L-3 / D-2).

VERIFY (empirical, not authored):
- Run the full app suite locally; record pass/fail counts. Confirm the workflow runs the SAME command over
  the SAME set. Any test the workflow does not reach is a STOP.
- Report how many tests this switches on in CI for the first time (every 21B/21C app-layer test).
- If the suite is RED on first CI execution, that is EXPECTED and is the point. Fix genuine breakage (env
  assumptions, missing setup). Do NOT delete, .skip(), or weaken a test to reach green — if a test is
  wrong, report it and STOP.

Constraints: CI-APP-SUITE-EXECUTED, CI-MERGE-GATE.
On green + commit, output "B1 complete — app-layer suite executing in CI (N tests newly enforced)." Stop.
```

#### B2 — `db-tests` stability, flag abolition, honest skip-guard  ·  ADR 0015 §3.2, §3.3, §4 (as corrected in B0)  ·  CI-DB-SUITE-STABLE, CI-NO-SUITE-FLAGS, CI-NO-SKIPPED-SUITE, CI-NO-SWALLOWED-FAILURE, CI-KNOBS-VERIFIED, CI-OOM-DIAGNOSTIC

```
BUILDER — Session 22 · B2. Transcribe ADR 0015 §3.2 / §3.3 / §4 AS CORRECTED IN B0. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- supabase/config.toml — disable [studio], [inbucket], [storage] (iff grep-clean), [edge_runtime]; keep
  [api], [db], [auth] ON (GoTrue is not optional — the suites sign in with real anon-key clients). One WHY
  comment per flip, matching the realtime/analytics precedent. Before each flip, grep supabase/__tests__
  for usage of that service and record the zero-hit result in the commit message.
  ⚠️ Do NOT clobber the uncommitted working-tree diff in config.toml (enable_confirmations = true,
  [auth.email]) — unrelated to this session, and email confirmation is a hard constraint (C8).
- db-tests.yml — the Postgres knob step, VOLUME-PRESERVING (F3): apply the knobs, restart the DB container
  WITHOUT destroying the volume, then VERIFY with SHOW shared_buffers / max_connections / work_mem. If the
  values do not reflect the caps after restart, the job FAILS and you STOP and report — an unverified
  remedy is worse than none, because it reports green. (CI-KNOBS-VERIFIED)
- DELETE all eleven *_INTEGRATION_TEST_ENABLED flags: from the workflow env block, lib/config.ts if
  referenced, every .env example, and EVERY test file that reads one, including the conditional
  describe/skip they drive. A DB suite runs iff the DB env is present. (CI-NO-SUITE-FLAGS)
- scripts/ci/assert-no-empty-suite.mjs — the guard, per B0's corrected contract. It asserts BOTH:
  (i) no supabase/__tests__ file ran zero or all-skipped tests, AND (ii) zero failed tests in the JSON —
  and it re-propagates failure. A suite may be RED (and the job then fails); it may never be INVISIBLE.
  The `|| true` in the ADR's original snippet is exactly the false-green this session exists to kill: do
  not ship it. (CI-NO-SKIPPED-SUITE + CI-NO-SWALLOWED-FAILURE)
- db-tests.yml — persist the existing failure dumps to a file and upload via actions/upload-artifact
  (CI-OOM-DIAGNOSTIC), so the next crash is legible after the runner is gone.

VERIFY:
- Run db-tests to completion in CI. Report the result AND the memory/OOM evidence.
- Prove the guard on BOTH arms: (a) point it at a zero-test fixture → job fails; (b) make one DB test fail
  deliberately → job fails (NOT a swallowed green). Revert both.
- If a full run still OOMs, implement the §3.2c shard contract (read vs write seam, each shard running its
  own skip-guard, plus the partition-totality listing test so a new suite cannot fall between shards) and
  re-run. Report which path you took. Do NOT raise the caps back; do NOT add continue-on-error.
- Report how many DB suites were previously flag-gated OFF and are now unconditionally executing.

On green + commit, output "B2 complete — knobs verified, flags abolished, guard fails on empty AND on red;
db-tests <monolith|sharded>, full run <green|OOM+evidence>." Stop.
```

#### B3 — Bulk approve: filter-scoped, visible-only, atomic  ·  Amendment A1 + A1.1  ·  APV-BULK-FILTER-SCOPED, APV-BULK-VISIBLE-ONLY, APV-BULK-ATOMIC, APV-BULK-DB-BOUNDARY, APV-COUNT-CONSISTENT, APV-BULK-NO-NEW-DB-OBJECT

```
BUILDER — Session 22 · B3. Transcribe ADR 0014 Amendment A1 + A1.1 (B0). The highest-risk step in the
session: it re-enables an affordance that was disabled BECAUSE it over-approved. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- lib/db/posts.ts — bulkApproveDraftPosts(client, campaignId, platforms?: Platform[]). The predicate is
  appended to the SAME builder: .eq(campaign_id).eq(status,'draft').is(deleted_at,null)[.in('platform',
  platforms)].select('id'). ONE statement, all-or-nothing. No loop, no second query, no RPC, no new DB
  object, NO MIGRATION. If you believe a DB object is needed, STOP and report — that contradicts A1.
- campaigns/[id]/posts/actions.ts — bulkApprovePostsAction(campaignId, platforms?), Zod-validating
  platforms as an optional array of the Platform enum.
- ApprovalsInbox — remove the 21C stopgap disable (:210-232). Pass the active platform filter through.
  Label, optimistic removal and the live-region announcement all read from the SAME filtered set.
- A1.1 / APV-BULK-VISIBLE-ONLY: bulk is offered IFF the rendered set for that campaign + active filters is
  provably COMPLETE — rows shown for that predicate === the server's total for the SAME predicate (B4 makes
  that total available; if B4 has not landed, sequence it first and say so in your plan). When incomplete
  (the >200 truncation case), the button is DISABLED with an honest message. It must NEVER approve a draft
  outside the rendered set.

TESTS (TDD — write these FIRST; they are the findings):
- THE 21C M1 SCENARIO, verbatim: campaign X has 3 LinkedIn + 2 X drafts; filter = X; bulk → EXACTLY the 2
  X drafts flip; the 3 LinkedIn stay `draft`. Anything else fails.
- THE TRUNCATION SCENARIO (F1 — the new one): a campaign whose pending drafts exceed the rendered window
  → bulk must NOT approve the unseen drafts. Assert the button is disabled/blocked and that ZERO rows flip
  if the action is invoked directly.
- APV-COUNT-CONSISTENT: label N === DB count N === rows removed N === announced N, filtered AND unfiltered.
- APV-BULK-ATOMIC: a caller lacking `approve` flips ZERO rows; nothing is optimistically removed; the
  action returns an error. No partial application.
- APV-BULK-DB-BOUNDARY (Tier-1, live Postgres, supabase/__tests__/posts-approval-boundary.test.ts): a raw
  authenticated EDITOR client calling the predicate'd UPDATE is denied by
  enforce_post_transition_capability; zero rows flip. The predicate must NARROW an already-gated statement —
  it must not become a new write path. This MUST execute in db-tests (B2 made that real).
- Unfiltered bulk keeps its exact current behaviour (regression pin).

BEHAVIOUR ONLY in this commit — zero visual/a11y change (that is B5, and the Reviewer checks the commit
boundary). Hard rules as §2.
On green + commit, output "B3 complete — bulk approve filter-scoped, visible-only, atomic, DB-gated." Stop.
```

#### B4 — Read path: filter-scoped total + overflow  ·  Amendment A2  ·  APV-SERVER-FILTER, APV-PAGINATED

```
BUILDER — Session 22 · B4. Transcribe ADR 0014 Amendment A2. Note C5: listPendingDraftPosts ALREADY filters
server-side — the gaps are page.tsx and the count. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- lib/db/posts.ts — listPendingDraftPosts returns { rows, total }: rows = first (limit ?? 200) drafts
  matching businessId [+ campaignId] [+ platform], ORDER BY scheduled_at ASC; total = EXACT count matching
  the SAME predicate, UNBOUNDED by the limit. countPendingDraftPosts learns the same optional
  campaignId/platform predicate (or is folded into the head:true count) — a filtered view must NOT show a
  business-wide total and lie in the other direction. Both remain bounded, indexed, single queries.
- approvals/page.tsx — pass campaignId/platform from searchParams (closing 21C n3: today it passes only
  { businessId }); thread `total` to the inbox.
- The inbox consumes `total`: overflow = total > rows.length. B4 ships the data and a minimal truthful
  string so the state is testable; B5 owns the banner's copy/layout/a11y/i18n. B4 also supplies the
  per-campaign completeness signal B3's APV-BULK-VISIBLE-ONLY consumes.

TESTS (TDD):
- server-side filter actually narrows (a param'd call returns a strictly narrower set; never a row outside
  the predicate);
- the total is FILTER-SCOPED (filtered view's total matches the filtered predicate, not the business);
- LIMIT 200 + ORDER BY scheduled_at ASC hold; no unbounded query introduced by the count;
- overflow: >200 pending drafts → rows.length === 200, total > 200, the surface reports overflow (never
  silent truncation — the 21C m1 finding);
- no overflow: total <= 200 → no overflow state.

Hard rules as §2. Do NOT invoke the taste plugins.
On green + commit, output "B4 complete — filter-scoped total, overflow exposed, page params wired." Stop.
```

#### B5 — UI + a11y pass  ·  Amendment A2/A3  ·  APV-CONTRAST-AA  ·  ⚠️ TASTE PLUGINS ACTIVATE

```
BUILDER — Session 22 · B5. UI-ONLY. Zero behavioural change: no DB call, no action, no predicate, no
redirect, no route touched in this commit. If a fix appears to require behaviour, STOP and report.

FIRST: invoke `impeccable-design-and-taste` and the taste skill for this step (confirm before proceeding).
This is the only step in Session 22 where they are in play.

BUILD:
- VERIFY the contrast, do not re-fix blind (C7): HEAD already shows text-amber-700 / dark amber-300
  (ApprovalsInbox.tsx:309). Measure the skip label against the 4.5:1 AA floor in BOTH light and dark. If it
  passes both, say so and move on. If it fails either, fix BOTH themes — never trade a dark regression for
  a light fix. Then sweep the rest of the inbox to the same floor (approve/bulk, platform badges, muted
  timestamps, focus rings).
- The overflow banner, on the data B4 exposes: honest, quiet, actionable — "Showing the first {n} of
  {total} pending posts — narrow with a campaign or platform filter." It is an informational state, not an
  error; it must not shout. i18n en/pt/es; no hardcoded English.
- The DISABLED bulk state from B3/A1.1 (the truncation case) needs copy that tells the truth about WHY —
  a disabled button with no explanation is a worse failure than the bug it prevents. Same i18n discipline.
- Keyboard + screen-reader pass on the re-enabled bulk button: its accessible name must state WHAT it will
  approve, not merely how many. A blind approver must not have to infer the active filter from a number.

TESTS: contrast assertions where the harness supports them; accessible-name assertions on the bulk button
(enabled AND disabled states); i18n key completeness across all three locales.

Hard rules as §2.
On green + commit, output "B5 complete — AA verified in both themes, overflow + disabled-bulk copy shipped,
bulk button announces its scope." Stop.
```

#### B6 — Verify-the-closed, hygiene, and the process constraint  ·  L-9, C6  ·  ROLE-TEAM-ECHO, PROC-REVIEW-AT-COMMIT

```
BUILDER — Session 22 · B6. Mostly VERIFICATION, not implementation (C6 — several findings are already
closed at HEAD; confirm rather than redo). Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

DO:
- ROLE-TEAM-ECHO: the four team actions ALREADY call canServer(MANAGE_MEMBERS) (actions.ts:101,160,186,213).
  Do NOT re-implement. ADD the Tier-2 regression test: a non-admin member calling each of the four actions
  directly gets the TYPED denial (not an opaque zero-row error), and the DB still denies independently (the
  echo must not have become the boundary). If the echo is NOT in fact present in any of the four, that is a
  finding — implement it and say so.
- Re-verify 21C n1 (DashboardShell export-area comment) and 21B n1 (ADR §11 manifest) are closed. Expected:
  no work. Report if not.
- 21B n2: MemberList.isExpiredInvite → date-fns, not raw epoch math.
- CLAUDE.md: add (a) PROC-REVIEW-AT-COMMIT (ADR 0015 §6) — Reviewers read at the stated commit range
  (`git show <sha>:<path>`, `git diff <range>`), NEVER at HEAD; a Reviewer report must OPEN by naming its
  range; (b) the "covered = executed green, never authored" rule + the §2 three-tier taxonomy pointer;
  (c) the §5 merge-gate table, so it is enforceable without opening the ADR.
- Docs: docs/current-phase.md (22 done; the CI topology change; start the db-tests three-green tally).
  backlog.md — file cursor pagination for the approvals inbox WITH the A2 un-defer trigger (first business
  observed with total > 200 pending drafts — now sharpened by APV-BULK-VISIBLE-ONLY: overflow disables bulk,
  so the first real overflow degrades a live affordance); file 21B n4 (request-level memo of
  getBusinessForUser). launch-checklist.md — tick CI/test-execution rows ONLY where the code earns it.

Hard rules as §2.
On green + commit, output "B6 complete — ROLE-TEAM-ECHO regression-guarded, hygiene done,
PROC-REVIEW-AT-COMMIT + merge gates in CLAUDE.md, docs updated." Stop.
```

#### B7 — Verification sweep  ·  the pre-Reviewer gate

```
BUILDER — Session 22 · B7. No new feature code. Run /ecc:verification-loop as a whole-session gate.

DO:
- npm run typecheck + npm run lint clean. npm run test:app green. db-tests green IN CI on a FULL run (not
  locally, not "green until it crashed"). If db-tests is still OOMing, say so explicitly and do NOT claim
  the session is ready.
- Coverage table — the point of this session. For EVERY constraint: ADR 0015 §7 (CI-*, PROC-*, plus
  CI-NO-SWALLOWED-FAILURE, CI-KNOBS-VERIFIED) and ADR 0014 A3 (APV-*, ROLE-TEAM-ECHO, plus
  APV-BULK-VISIBLE-ONLY) → the test that proves it → the CI JOB that EXECUTES that test → its tier (1/2/3).
  A Tier-1 or Tier-2 constraint whose "executing job" cell is EMPTY is a STOP: that is precisely the defect
  this session exists to eliminate, and shipping it would be the session failing at its own thesis.
- The delta that matters: how many tests CI executed before Session 22 vs now.
- Scope check: no migration, no new DB object, no Stripe, no new route, no new product capability.
- Commit-boundary check: B3 (behaviour) and B5 (visual) are SEPARATE commits, so the Reviewer can verify
  phase isolation — the thing 21C could not do.
- Guard check: confirm nothing in CI swallows a failure (no `|| true`, no continue-on-error on a gate).

Output the coverage table, the executed-test delta, and "B7 complete — Session 22 green, ready for review."
Then stop. Do NOT write Reviewer prompts.
```

---

## §3 — Reviewer session  (paste into Claude Code · Opus)

Run only after B0–B7 are committed. The Reviewer is independent and modifies nothing.

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 22 — Test-Execution Integrity & Approvals Hardening, REVIEWER phase. You are an INDEPENDENT
reviewer: you did NOT write this code and you will not modify any file. Output is a review document only.

⚠️ PROC-REVIEW-AT-COMMIT (ADR 0015 §6 — a HARD constraint, and the reason it exists):
Read EVERY file AT THE STATED COMMIT RANGE — `git diff <base>..<head>`, `git show <sha>:<path>` — NEVER at
HEAD. In Session 21B a Reviewer read DashboardShell.tsx at HEAD (which already contained 21C) and raised a
MAJOR that had to be withdrawn. Your report MUST OPEN by naming the exact commit range you read and stating
that every citation comes from that range.

Read now, at that range:
- docs/decisions/0015-test-execution-and-ci-gates.md (as corrected in B0) — §7 constraints.
- docs/decisions/0014-seats-permissions-flow-surface.md, Amendment A incl. A1.1 — the A3 constraint table.
- docs/build-guide/session-22.md §0.1 — the three defects (F1/F2/F3) B0 was supposed to encode. Verify it did.
- docs/reviews/session-21c-reviewer.md — M1. You are auditing its FIX, and the truncation variant of it.
- The full Session 22 diff, COMMIT BY COMMIT (B0…B7), and every test added.
- .github/workflows/*, supabase/config.toml, vitest.config.ts, scripts/ci/.

Invoke `security-reviewer` AND `database-reviewer`. Invoke `impeccable-design-and-taste` for B5 ONLY.

Before reviewing anything, ESTABLISH TEST-EXECUTION REALITY — this session IS about that, so a wrong answer
here voids the review:
(1) Point at the actual CI runs. Is the app-layer suite executing on push? Did db-tests pass a FULL run
    (not "green until it crashed")? Paste/point to the runs.
(2) Which DB suites were flag-gated OFF before and now execute? Has the skip-guard been DEMONSTRATED on
    BOTH arms — a zero-test suite fails the job, AND a genuinely failing test fails the job (no `|| true`
    swallow)? Demonstrated, not claimed.
(3) Were the Postgres knobs VERIFIED after restart (SHOW shared_buffers/max_connections/work_mem), or does
    the remedy silently no-op?
(4) List every constraint whose proof is an EXECUTED test vs authored-but-unrun vs Tier-3 diff-verified.
If (1) cannot be confirmed, STOP — do not review a session about test execution using tests that do not
execute.

Output the above and "Ready to review 22 (range: <sha>..<sha>)." Then wait.
```

### §3b — Reviewer prompt  (paste after acknowledgement)

```
REVIEWER — Session 22. Audit the diff section-by-section against ADR 0015 and ADR 0014 Amendment A (both as
corrected in B0). RE-DERIVE the adversarial checks yourself — write the query, reason about the outcome —
rather than trust a test's name. Tier every finding BLOCKER / MAJOR / MINOR / NIT. All citations at the
stated commit range.

SECTION A — THE APPROVE BOUNDARY IS UNCHANGED  (A1 · the only BLOCKER-class area)
A1. bulkApproveDraftPosts is still ONE statement: no loop, no second query, no RPC, no new DB object, no
    migration. A per-row loop or a second write path is a BLOCKER.
A2. The platform predicate NARROWS an already-gated UPDATE. Prove a raw authenticated EDITOR client calling
    the predicate'd UPDATE is denied by enforce_post_transition_capability, zero rows flip. EXECUTED against
    live Postgres, or it does not count.
A3. Atomicity: a caller lacking `approve` flips ZERO rows; nothing is optimistically removed; the action
    errors. Partial application is a BLOCKER.

SECTION B — THE M1 FIX IS REAL, AND SO IS THE TRUNCATION FIX  (APV-BULK-FILTER-SCOPED, APV-BULK-VISIBLE-ONLY,
                                                               APV-COUNT-CONSISTENT)
B1. Reconstruct the original failure: 3 LinkedIn + 2 X drafts, filter = X, bulk → exactly 2 rows change. If
    any LinkedIn draft can still flip, BLOCKER.
B2. Reconstruct the TRUNCATION failure (§0.1 F1 — the variant the ADR originally missed): a campaign with
    more pending drafts than the rendered window. Prove bulk CANNOT approve a draft outside the rendered
    set — the button is blocked/disabled, and a direct invocation flips zero unseen rows. If bulk can still
    approve an unseen draft, that is a BLOCKER: it is 21C M1 with a different mechanism, and the whole point
    of this session's W2.
B3. The count invariant: label = DB count = rows removed = announced, filtered AND unfiltered. Any
    divergence is a MAJOR — a button that says 12 and does 60 is the defect being killed.
B4. Confirm the 21C stopgap is removed and nothing ELSE was disabled to make tests pass.

SECTION C — CI IS REAL, NOT CLAIMED  (CI-APP-SUITE-EXECUTED, CI-DB-SUITE-STABLE, CI-NO-SUITE-FLAGS,
                                      CI-NO-SKIPPED-SUITE, CI-NO-SWALLOWED-FAILURE, CI-KNOBS-VERIFIED,
                                      CI-OOM-DIAGNOSTIC)
C1. app-tests.yml runs the FULL app suite on push/PR, independent of the DB stack. Compare the workflow's
    command against the local suite: any test the workflow does not reach is a MAJOR.
C2. No test was deleted, .skip()-ed, or weakened to make the newly-enforced suite green. Diff the test
    files — a loosened assertion introduced this session is a MAJOR.
C3. Every one of the eleven flags is GONE (grep workflows, lib/config.ts, .env*, supabase/__tests__). A
    surviving flag is a MAJOR — it is the false-green mechanism.
C4. The skip-guard is DEMONSTRATED on both arms (empty suite fails; a genuinely failing test fails). If
    `|| true` or continue-on-error survives anywhere on a gate, that is a MAJOR — the ADR would then ship
    the very defect it exists to prevent.
C5. The Postgres knobs are VERIFIED post-restart (SHOW …). If the restart destroys the volume and the knobs
    silently revert, the remedy is theatre — MAJOR.
C6. db-tests: does a FULL run pass? If it still OOMs, say so plainly: what the ADR promised vs what shipped.
    "Green until it crashed" is not green.

SECTION D — THE READ PATH  (APV-SERVER-FILTER, APV-PAGINATED)
D1. campaignId/platform applied server-side AND page.tsx passes them (21C n3 closed); the total is
    FILTER-SCOPED (a filtered view must not report a business-wide total); LIMIT + ORDER intact; no
    unbounded query introduced by the count.
D2. Overflow is honest: >200 pending drafts → the surface says so. Silent truncation surviving this session
    is a MAJOR (it was 21C m1) — and it is now also the trigger for B2's disabled-bulk state, so verify the
    two agree.

SECTION E — UI / A11Y  (APV-CONTRAST-AA · impeccable-design-and-taste)
E1. The skip label meets 4.5:1 in BOTH themes — verify light AND dark. A dark regression traded for a light
    fix is a MAJOR. Sweep the rest of the inbox to the same floor.
E2. The bulk button's accessible name states its SCOPE (enabled state), and the DISABLED state explains WHY
    (the truncation case). A disabled control with no explanation is a MINOR at best.
E3. B5 is visual/a11y ONLY — verify BY COMMIT BOUNDARY (this is why B3 and B5 are separate commits). If they
    were squashed, say so: that is the 21C n2 defect repeating.
E4. i18n complete across en/pt/es; no hardcoded English.

SECTION F — PARITY, SCOPE, PROCESS  (ROLE-TEAM-ECHO, PROC-REVIEW-AT-COMMIT)
F1. The four team actions echo canServer('manage_members') and return the typed denial; the DB still denies
    independently (the echo must not have become the boundary); the regression test executes in app-tests.
F2. CLAUDE.md carries PROC-REVIEW-AT-COMMIT, the "covered = executed" rule, and the merge-gate table.
F3. Scope: no migration, no new DB object, no Stripe, no new route, no new capability. No `any`, no
    `console.*`; env via lib/config; DB via lib/db; date-fns for timestamps.

SECTION G — CONSTRAINT COVERAGE (the thesis)
G1. EVERY constraint (ADR 0015 §7 + ADR 0014 A3, including the three added in B0) maps to a test AND to the
    CI JOB that executes it. A Tier-1/Tier-2 constraint with a test but no executing job is a MAJOR — that
    is the exact state Session 22 was convened to end.
G2. State the before/after: tests executed by CI before 22 vs after.

OUTPUT: docs/reviews/session-22-reviewer.md —
- OPEN by naming the commit range read (PROC-REVIEW-AT-COMMIT).
- A table: Section / Check / Status (✅/⚠️/❌) / File:Line / Note.
- Then BLOCKER, MAJOR, MINOR, NIT — each with an exact fix instruction.
- A coverage section: constraint → test → executing CI job → tier.
- A VERDICT: blockers before merge · deferrable debt · whether "covered = executed" now actually holds.
Do NOT modify code. Do NOT write the correction prompts — those come from claude.ai after this report.
```

---

## §4 — Correction pass (Session 22-D)

The Reviewer (`docs/reviews/session-22-reviewer.md`, range `7c510396..fe6da7e1`) returned **2 BLOCKERs,
3 MAJORs, 5 MINORs, 3 NITs**. The thesis was substantially delivered — Tier-1 "covered = executed" is
real and convincing — but three gaps stop it being true end-to-end. The headline finding is a
process one and is recorded here as the session's durable lesson.

**The lesson (adopt as a standing rule).** `bulkApprovePostsAction` has **two callers**; three
consecutive sessions verified `APV-BULK-*` against **one** of them (`ApprovalsInbox`), leaving the
campaign surface (`PostsClient.tsx`) carrying 21C M1 verbatim (BLOCKER-1) and F1's truncation on a
50-row window (BLOCKER-2). §0.1/F1 was a good catch found by reasoning about the *invariant*; the same
reasoning applied to *"who else calls this function?"* — one `git grep` — would have found both. **New
rule → `CLAUDE.md` (Prompt 3): a constraint written against a shared function must enumerate that
function's callers and state which the tests cover.**

**Root-cause decision (adjudicated).** Both blockers are killed by one change: `bulkApproveDraftPosts`
approves **exactly the ids the caller rendered** (`.in('id', renderedIds)`), making
`APV-BULK-VISIBLE-ONLY` true **by construction** instead of by a window-size argument that failed
review twice. This also dissolves MINOR-2 (TOCTOU — no count consulted) and carries MINOR-3's
`business_id` guard along. The rejected alternative (pass `{renderedCount, …}` and re-count per caller)
was declined precisely because it preserves the "prove the window is complete" reasoning that broke.
Cost — ~200 UUIDs ≈ 7 KB of PostgREST URL vs the ~8 KB ceiling — is unreachable at launch caps and
shares the Pro-account trigger already on the watch list.

**Structure:** BLOCKER-1+2 are one signature change (splitting them would be artificial) → then each
MAJOR as its own prompt. **Prompts 1–3 are Builder (Sonnet).** **Checklists 4–5 are founder/infra
actions** (branch-protection API call; un-ignoring `/docs`) — no test to write, and MAJOR-3 is
secret-sensitive, so they are **not** Builder-TDD prompts. **Do MAJOR-3 (Checklist 5) first if you
can**, so the 22-D correction commits land in a tracked `/docs`.

**Escape hatch (unchanged):** if any correction shows an ADR 0015 contract is infeasible against the
runner, **amend the ADR** — never a retry loop or `continue-on-error`. A CI job allowed to fail
silently is this session's disease under a new name.

---

### Prompt 1 — 22-D · BLOCKER-1 + BLOCKER-2  (Sonnet · one pass, do not split)

```
Session 22-D · CORRECTION — BLOCKER-1 + BLOCKER-2. One change fixes both; do NOT split them. Run
/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

CONTEXT (docs/reviews/session-22-reviewer.md — read BLOCKER-1 and BLOCKER-2 in full first):
bulkApprovePostsAction has TWO callers. The 21C M1 fix and Session 22 B3 only ever touched the
Approvals inbox; the second caller — app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx —
was never audited. On that surface bulk approve (a) ignores the active platform filter (BLOCKER-1 =
21C M1 verbatim, unfixed) and (b) approves drafts outside its 50-row rendered window (BLOCKER-2 = F1's
truncation, on a window the 200-row gate cannot protect). Both let a human approve content they never
saw — the human-in-the-loop guarantee CLAUDE.md names as a product feature.

ROOT-CAUSE FIX (adjudicated — chosen over re-counting):
Make bulkApproveDraftPosts approve EXACTLY the ids the caller rendered. "Approve what I can see"
becomes the literal WHERE clause instead of an argument about window sizes that has now failed review
twice. This makes APV-BULK-VISIBLE-ONLY true BY CONSTRUCTION and dissolves the TOCTOU race (MINOR-2).

BUILD:
- lib/db/posts.ts — bulkApproveDraftPosts signature becomes
  (client, campaignId, renderedIds: string[], businessId: string). Required explicit id set, not an
  optional platform predicate. ONE statement, all-or-nothing:
    UPDATE posts SET status='approved'
    WHERE id = ANY(:renderedIds) AND campaign_id = :campaignId AND business_id = :businessId
      AND status = 'draft' AND deleted_at IS NULL
    RETURNING id
  (campaign_id + status + deleted_at stay as defence-in-depth; business_id closes MINOR-3 — the one
  write path that previously relied on RLS alone. No loop, no second query, no RPC, no new DB object,
  NO MIGRATION.) Empty renderedIds → return 0 without a DB call.
- campaigns/[id]/posts/actions.ts — bulkApprovePostsAction(campaignId, renderedIds) passes
  ctx.business.id through as businessId. DELETE the business-wide countPendingDraftPosts gate
  (actions.ts:208-214) entirely — now unnecessary AND the unsound proxy behind BLOCKER-2.
- ApprovalsInbox.tsx — pass the ids of the CURRENTLY RENDERED, filter-visible drafts as renderedIds
  (not all fetched rows if any are filtered out client-side). Optimistic removal removes exactly that
  set; label = renderedIds.length = DB count = announced (APV-COUNT-CONSISTENT holds by construction).
- PostsClient.tsx — the previously-unaudited caller: pass the ids of the drafts it actually rendered
  (respecting activeFilter) as renderedIds; scope the optimistic update (:104-108) to that same set.

TESTS (TDD — write first; BOTH surfaces, this is the whole point):
- posts-approval-boundary.test.ts (Tier-1, live Postgres): the predicate'd UPDATE by a raw EDITOR
  client is still denied by enforce_post_transition_capability, zero rows flip; and renderedIds
  spanning multiple campaigns/businesses cannot approve a row outside campaignId+businessId.
- ApprovalsInbox.test.tsx: the 21C M1 scenario (3 LinkedIn + 2 X, filter=X → exactly the 2 rendered X
  ids approved) stays green under the new signature.
- NEW PostsClient.test.tsx: the SAME M1 scenario on the campaign surface (BLOCKER-1), AND the
  truncation scenario (BLOCKER-2) — a campaign whose drafts exceed the 50-row window renders 5, bulk
  approves EXACTLY those 5; older unseen drafts stay `draft`.
- Regression: unfiltered bulk over a fully-rendered small campaign still approves all of them.

Hard rules: no migration, no new DB object, no any/console, env via lib/config, DB via lib/db,
date-fns. Behaviour-only commit.
On green + commit, output "22-D BLOCKER-1+2 complete — bulk approves rendered ids only, both surfaces,
DB-gated." Update the review resolution log and stop.
```

### Prompt 2 — 22-D · MAJOR-1  (Sonnet · absence over allowlist)

```
Session 22-D · CORRECTION — MAJOR-1 (app-tests reports green while four suites execute nothing). Run
/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop.

CONTEXT (docs/reviews/session-22-reviewer.md MAJOR-1): the eleven db flags are dead, but four
flag-gated __integration__ suites survive INSIDE app-tests and report green while skipped/todo —
purge-business, email round-trip, postiz-provider, marketing routes.smoke. Same defect class as the
21B false-green, now inside the job ADR 0015 §5 marks "Required — now". app-tests has no skip-guard.

DECISION (adjudicated): make these suites ABSENT, not present-but-empty. An allowlist of sanctioned
green-skips is a maintained list of blessed false-greens, and lists rot (that is how the eleventh 21B
flag got left off). Absence is honest; a green skip is not. Mirrors what B2 did to the eleven db flags
(deletion over conditional-skip), keeping the thesis coherent across both jobs.

BUILD:
- vitest.config.ts — define a SEPARATE opt-in vitest project (or workspace entry) for the
  __integration__ files, and REMOVE them from the default app-tests `include`. A bare `vitest run`
  (app-tests) must not see them; running the opt-in project explicitly (env present) does.
- Extend the skip-guard to app-tests: parameterize scripts/ci/assert-no-empty-suite.mjs to accept the
  target dir(s) (it hard-codes 'supabase/__tests__' at :22); add a JSON-reportered run + guard step to
  app-tests.yml over app/** lib/** components/**. With the four files ABSENT, no allowlist is needed —
  nothing inside app-tests may be empty. Keep BOTH arms (zero/all-skipped AND any failed → non-zero
  exit; no `|| true`).
- SPECIAL CASE — postiz-provider.integration.test.ts: Postiz is slated for pre-launch removal. Confirm
  whether this file should move to the opt-in project or be DELETED with the code it tests. Do not
  preserve an integration test for code being removed — decide explicitly and state which and why.

VERIFY:
- app-tests reports the reduced file count (no "N skipped" for these four), and the new guard
  demonstrably fails if any remaining app-suite file runs zero tests (point at a zero-test fixture,
  confirm red, revert).
- Record in ADR 0015 §4 which suites are opt-in and why (the enumerated-decision discipline §2 requires
  for anything not executed on every push).

On green + commit, output "22-D MAJOR-1 complete — four integration suites made opt-in/removed;
app-tests skip-guarded; no silent-skip remains in a required job." Stop.
```

### Prompt 3 — 22-D · MINOR sweep + the callers rule  (Sonnet · after blockers land)

```
Session 22-D · CORRECTION — MINOR sweep. Docs + small code. Run /ecc:plan → /ecc:verification-loop.

From docs/reviews/session-22-reviewer.md:
- MINOR-1 (APV-CONTRAST-AA has no executing test; a code comment asserts a measurement): DELETE the
  "measured" comment at ApprovalsInbox.tsx:248. Then EITHER add a real assertion (resolve the computed
  colour, compute the ratio, assert >=4.5 both themes) OR declare APV-CONTRAST-AA Tier-3 in ADR 0014 A3
  with a named verifier + dated artifact. Pick one, record it, and remove the dual-tier "Tier-2 where
  harness supports / Tier-3 visual" wording — that ambiguity is the loophole ADR 0015 §2 forbids.
- MINOR-2 (TOCTOU): confirm DISSOLVED by the BLOCKER fix (no count consulted). Note resolved in the
  review log — no code. If any count-based gate remains, remove it.
- MINOR-3 (bulk lacked a business_id guard): confirm CLOSED by the BLOCKER fix (business_id now in the
  WHERE). Note resolved.
- MINOR-4 (B7 added 20260715200000_user_can_grant_anon.sql vs L-10): record in ADR 0015's session-22
  manifest as an APPROVED L-10 deviation — both specialists cleared it safe (user_can() returns false
  at auth.uid() IS NULL before touching any table; the anon GRANT creates no oracle).
- MINOR-5 (no index for the count predicate): file to backlog.md —
  CREATE INDEX ... ON posts (business_id, status, scheduled_at) WHERE deleted_at IS NULL — tied to the
  same Pro-account trigger as A2's cursor-pagination un-defer. Do NOT create the index now.

ALSO — the durable process fix (the review's headline lesson):
- CLAUDE.md: add the SHARED-FUNCTION CALLERS rule — "a constraint written against a shared function
  MUST enumerate that function's callers and state which ones the tests cover." Both 22 blockers came
  from verifying APV-BULK-* against one of two callers of bulkApprovePostsAction across three sessions.
- NIT-3 (worth a note, not a fix): the claude-mem plugin injected <system-reminder>-shaped text into a
  subagent's tool output instructing out-of-toolset calls; the agent correctly ignored it. Record it in
  backlog.md as a plugin-hygiene item to investigate — not a Session 22 defect.

On commit, output "22-D MINOR sweep complete." Stop.
```

### Checklist 4 — 22-D · MAJOR-2  (FOUNDER / infra — not a Builder prompt)

Branch protection: the merge gate ADR 0015 §5 marks *"Required — now"* is **authored, not enforced** —
`gh api …/branches/master/protection` returns `404 Branch not protected`. Run this yourself (or paste
to Claude Code with `gh` access):

```
Create a ruleset on `master` requiring the app-tests check. Do NOT require db-tests yet (tally 1/3).

  gh api repos/:owner/:repo/rulesets -X POST -f name='master-app-tests' \
    -f target=branch \
    -f 'conditions[ref_name][include][]=refs/heads/master' \
    -f 'rules[][type]=required_status_checks' \
    -F 'rules[][parameters][required_status_checks][][context]=app-tests' \
    -f enforcement=active
  # restrict admin bypass, then verify the 404 is gone:
  gh api repos/:owner/:repo/branches/master/protection

Record the ruleset's EXISTENCE (not the intent) in ADR 0015 §5; put the db-tests promotion tally in
docs/current-phase.md.
```

Acceptance: the `404` is gone. The gate now blocks a red `app-tests`, which it did not before.

### Checklist 5 — 22-D · MAJOR-3  (FOUNDER — do this FIRST, and carefully)

`/docs` and `CLAUDE.md` are in `.gitignore`; `git ls-files docs/` returns **0 files**. Consequences are
live: **B0 has no commit**, **PROC-REVIEW-AT-COMMIT is unenforceable for the ADRs that define it**, and
**ADR 0010's `evidenceRef` coupling is structurally impossible**. Second review in a row to raise it.
Committing previously-ignored files can leak secrets, so this is a human action, not a Builder pass:

```
1. Find WHY they are ignored (reason is unrecorded) and secret-scan before committing anything:
     git grep -nE '(secret|token|key|password|BEGIN [A-Z ]*PRIVATE KEY)' \
       -- $(git ls-files -o --exclude-standard docs CLAUDE.md)
   Extract anything real into env/secrets; leave a reference, not the value.
2. Remove /docs and CLAUDE.md from .gitignore.
3. ONE commit: "docs: track the governance layer" — note that all prior ADR/session history is
   imported at once and is not per-session attributable.
4. Verify: git ls-files docs/ is non-empty; git show HEAD:docs/decisions/0015-...md succeeds.
```

Acceptance: the governance layer is in version control, so every subsequent 22-D correction commit
lands in a tracked `/docs` and the next Reviewer's PROC-REVIEW-AT-COMMIT opening is fully true.

---

### §4.1 — Re-review  (paste into Claude Code · Opus · after Prompts 1–3 green and Checklists 4–5 done)

Independent, modifies nothing, reads at the 22-D range. This is a **targeted delta review**, not a
re-run of the whole §3 — it audits the five corrections and confirms nothing regressed, rather than
re-deriving the whole session. Paste the primer, wait, then the prompt.

#### §4.1a — Re-review primer  (paste first · wait for acknowledgement)

```
Session 22-D re-review. You are an INDEPENDENT reviewer of the CORRECTION pass; you did not write it and
you modify nothing. Output is a review document only.

⚠️ PROC-REVIEW-AT-COMMIT (ADR 0015 §6): read EVERY file AT THE 22-D COMMIT RANGE — `git diff <base>..<head>`,
`git show <sha>:<path>` — NEVER at HEAD. Your report MUST OPEN by naming the exact range and stating that
every citation comes from it. (This is now fully checkable only because MAJOR-3 tracked /docs — confirm
that first; if `git ls-files docs/` is still empty, the governance ADRs are unreadable at any range and
that is a STANDING BLOCKER, not a pass.)

Read now, at the 22-D range:
- docs/reviews/session-22-reviewer.md — the report you are auditing the fixes for. Its 2 BLOCKER / 3 MAJOR
  / 5 MINOR findings are your checklist.
- docs/build-guide/session-22.md §4 (Prompts 1–3, Checklists 4–5) — what was SUPPOSED to change.
- The 22-D diff, commit by commit.
- lib/db/posts.ts (bulkApproveDraftPosts), campaigns/[id]/posts/{actions.ts,PostsClient.tsx},
  approvals/ApprovalsInbox.tsx, and BOTH test files (ApprovalsInbox + the new PostsClient test).
- vitest.config.ts, scripts/ci/assert-no-empty-suite.mjs, .github/workflows/app-tests.yml.

Invoke `security-reviewer` AND `database-reviewer`.

Before reviewing, ESTABLISH THREE FACTS and report them (a wrong one voids the review):
(1) Does `git ls-files docs/` now return the ADRs? (MAJOR-3)
(2) Does `gh api repos/:owner/:repo/branches/master/protection` return protection, not 404, with
    app-tests required? (MAJOR-2) — if you cannot call gh, say so and mark it founder-attested.
(3) Point at the actual CI runs: app-tests green AND its NEW skip-guard active; db-tests green on a full
    run. Paste/point to them.
Output those three + "Ready to re-review 22-D (range: <sha>..<sha>)." Then wait.
```

#### §4.1b — Re-review prompt  (paste after acknowledgement)

```
REVIEWER — 22-D delta. Audit each correction against the finding it closes. RE-DERIVE the two blocker
scenarios yourself rather than trust a test name. Tier any NEW finding BLOCKER/MAJOR/MINOR/NIT. All
citations at the 22-D range.

BLOCKER-1+2 — bulk approves rendered ids only, BOTH surfaces (the core fix):
- bulkApproveDraftPosts is `id = ANY(renderedIds) AND campaign_id AND business_id AND status='draft'
  AND deleted_at IS NULL`, ONE statement, no loop, no count-gate, no new DB object, no migration. A
  surviving business-wide count-gate or any second write path is a BLOCKER.
- Re-derive the M1 scenario on PostsClient (3 LinkedIn + 2 X, filter=X → exactly 2 flip). If any
  LinkedIn draft can still flip on the CAMPAIGN surface, the blocker is not fixed → BLOCKER.
- Re-derive the truncation scenario on PostsClient (drafts > the 50-row window → only the rendered ids
  flip; unseen older drafts stay draft). If an unseen draft can flip → BLOCKER.
- DB boundary intact (Tier-1, live PG): a raw EDITOR client calling the predicate'd UPDATE is denied by
  enforce_post_transition_capability; renderedIds spanning another campaign/business cannot escape
  campaign_id+business_id. Both tested and EXECUTED, or it does not count.
- Count invariant now holds by construction on BOTH surfaces: label = DB count = removed = announced.
- Confirm the NEW PostsClient.test.tsx exists and executes in app-tests — the caller that had zero
  coverage for three sessions must not still have zero.

MAJOR-1 — no silent-skip in a required job:
- The four __integration__ suites are ABSENT from the default app-tests run (moved to an opt-in project
  or deleted), not present-and-skipped. Grep app-tests output for "skipped": the four must not appear.
- assert-no-empty-suite.mjs now also guards app dirs, BOTH arms (empty → fail; any failed test → fail),
  no `|| true`. Demonstrated, not asserted.
- postiz-provider: confirm it was moved OR deleted-with-its-code, and that the choice is recorded.

MAJOR-2 — the gate is ENFORCED, not authored: branch protection exists, app-tests required, db-tests
NOT yet required (tally < 3). If founder-attested rather than gh-verified, say so plainly.

MAJOR-3 — /docs tracked: the governance ADRs are in version control; a secret-scan was run before the
commit. If /docs is still ignored, this is a standing BLOCKER (see primer).

MINORS: MINOR-1 (contrast — real assertion OR declared Tier-3 with verifier, and the dual-tier wording
gone); MINOR-2/3 confirmed dissolved/closed by the blocker fix, not separately patched; MINOR-4 (the B7
migration recorded as an approved L-10 deviation); MINOR-5 (index filed to backlog, NOT created).

PROCESS: CLAUDE.md carries the shared-function-callers rule. NIT-3 (claude-mem injection) filed.

REGRESSION: nothing that was green in the original §3 review went red — the Tier-1 boundary suite, the
db-tests stability, the eleven-flag abolition, and the contrast fix all still hold at the 22-D range.

OUTPUT: docs/reviews/session-22d-reviewer.md — open by naming the range; a Status table
(finding → ✅closed / ⚠️partial / ❌open → file:line); any new findings tiered; a VERDICT stating
whether 22 + 22-D together are mergeable and whether "covered = executed" and "approve only what you saw"
now hold on BOTH approval surfaces. Do NOT modify code.
```

### §4.2 — Close-out  (paste into Claude Code · Sonnet · after the re-review verdict is clean)

```
Session 22 CLOSE-OUT. No feature code. Only run after the 22-D re-review returns no BLOCKER/MAJOR.
Docs + ledger hygiene. Run /ecc:verification-loop as a final gate.

DO:
- Final gate: npm run typecheck + lint clean; app-tests green (skip-guard active); db-tests green on a
  full run. If db-tests passed cleanly, INCREMENT the promotion tally in docs/current-phase.md; when it
  reaches 3 consecutive full greens, promote it to a required check (ADR 0015 §5 / L-5) and record that
  it was promoted.
- docs/current-phase.md: Session 22 + 22-D DONE. State plainly what changed about how the project tests
  (app-suite executed on every push; db-tests stabilised; flags abolished; skip-guard on both jobs;
  branch protection enforcing app-tests; /docs tracked). Set the next phase = Postiz removal.
- backlog.md: confirm these are filed (add any missing) — approvals cursor pagination + its un-defer
  trigger (first business with >200 pending drafts, now sharpened: overflow disables bulk); MINOR-5
  partial index; 21B n4 request-level memo of getBusinessForUser; NIT-3 claude-mem injection hygiene.
- launch-checklist.md: tick the CI / test-execution rows ONLY where the code earns it — and note they
  are now genuinely ENFORCED (branch protection), not merely present. Do NOT tick anything unfinished.
- Verify the two ADRs read cleanly at HEAD now that /docs is tracked: ADR 0015 (§4 skip-guard corrected,
  §3.2b knob-verify, §5 gates + promotion state, §7 incl. CI-NO-SWALLOWED-FAILURE / CI-KNOBS-VERIFIED)
  and ADR 0014 Amendment A (A1.1 APV-BULK-VISIBLE-ONLY, now true by construction via renderedIds).

Output a one-screen session-22 retrospective: what shipped, the executed-test delta (CI before 22 → after
22-D), the standing rules added (covered=executed; review-at-commit; shared-function callers), and the
single sentence you'd want the NEXT session's Architect to read first. Then commit "docs: close out
Session 22 + 22-D" and stop.
```

**Next (unchanged pre-launch sequence):** remove Postiz for direct LinkedIn + X API integration → legal
copy PR → lawyer ratification → Stripe live-mode flip → launch.
