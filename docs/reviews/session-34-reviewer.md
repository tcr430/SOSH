# Session 34 · Track K — Reviewer report (K3)

**Scope reviewed: `28aa23c6..cad8790f`; all citations are `git show <sha>:<path>` at that range, never HEAD.**

Documents audited *against*, named at their own commits (Session 22-F, NEW-12):

- **ADR 0027 §§0–14** read at **`28aa23c6`**, the docs-only commit that put it into git (`git log --diff-filter=A`
  returns `28aa23c6` and nothing earlier), so the Section 2 precondition holds. The ADR's **Builder verification
  appendix (V.1–V.10)** is an artefact *inside* the range and is read at **`cad8790f`**. `git diff 28aa23c6..cad8790f`
  over the ADR adds only that appendix; §§0–14 are byte-unchanged.
- **`docs/build-guide/session-34.md`** read at **`28aa23c6`** (unchanged in the range).
- ADR 0017 / 0021 / 0024 / 0010 amendments are range artefacts, read at `cad8790f`. ADR 0015, ADR 0016 and CLAUDE.md
  read at `cad8790f`.

Local mutation runs used a **detached scratch worktree at exactly `cad8790f`**, env pointed at the **local** Supabase
stack only (`127.0.0.1:54321/54322`). The repo's `.env.local` targets the remote project and was deliberately not
used. The local DB's migration table is at `20260923100000`, the range's last migration. Every plant was restored,
and `git status` was clean after each one.

---

## 0. Verdict

**NOT READY TO MERGE. 1 BLOCKER, 6 MAJOR, 8 MINOR, 5 NIT.**

The security architecture holds, and I re-ran it rather than re-reading it. Tools are read-only and tenant-bound. The
brand has a real runtime initializer, and the cast scan reddens. The planner's output schema has no verdict field.
Claim verification is a pure id-set intersection. Every Tier-3 scan I planted against reddened. CI is green at the
head.

The defects are in **wiring and in what is claimed as closed**:

- the freeze/supersede RPC this ADR calls "the genuine hole" has no production caller;
- a ratified `reorder` does not produce the order the human ratified;
- four new Server Actions have no tests, while three test headers cite test files that do not exist;
- claim flags go stale the moment a post is edited or regenerated;
- `planner_run_id` links to nothing;
- half (b) of the redundancy check never reaches the approval gate.

---

## 1. What I ran, and what it showed

| Check | Result |
|---|---|
| CI at head `cad8790f` (event `pull_request`, PR #13) | app-tests **35986048998** ✅, db-tests **35986048987** ✅, eval **35986049119** ✅ |
| app-tests skip-guard, **verbatim from the log** | `skip-guard: 333 file(s) under [app, lib, components] all visible, zero failures — green. (4837/4837 tests passed)` |
| db-tests skip-guard, **verbatim from the log** | `skip-guard: 93 file(s) under [supabase/__tests__] all visible, zero failures — green. (782/782 tests passed)` |
| db-tests stack health | the log shows the known image-tag shadow step (`ghcr.io/supabase/postgres:17.6.1.113` tagged as `.111`); **no** `signal 11` / `SIGSEGV` / `OOMKilled` / out-of-memory line. Green, not a stack failure |
| Promotion tally | both runs are `pull_request` events, so the tally **does not move**. `docs/current-phase.md` says so correctly |
| `pg_constraint` on `ai_budget_daily` at head (live local DB) | exactly **one** purpose CHECK, `ai_budget_daily_purpose_check`, with all four values, plus `reserved_units_check`. **No stale CHECK survived** |
| `information_schema.routine_privileges` for the 5 new SECURITY DEFINER functions + `reserve_ai_budget` | EXECUTE held by `postgres, service_role` only. **Correct live, but pinned by no test** (MAJOR-6) |
| `authenticated` SELECT on the six tool backing tables | a `*_select_own` policy exists on all eight tables touched (incl. `insight_cards`, `signal_candidates`, `signals`), so the production (authenticated) tool path works |
| `npx tsc --noEmit --skipLibCheck` at head plus one planted raw field | the **only** error is the plant (below), so head itself is tsc-clean |
| Tier-3 scans re-run and **reddened by me** at head | §4, every one red on a real plant |
| `ecc:silent-failure-hunter` (my one invocation, read-only, at `cad8790f`) | 2 findings. Both verified by me and carried as MINOR-3 and NIT-4. One factual slip in its "checked fine" list is corrected in §6 |
| **ECC budget, Builder** | four invocations: K2.0 `code-explorer` (build guide), typescript-reviewer "2 of 4" (K2.3), database-reviewer "3 of 4" (K2.6), security-reviewer "4 of 4" (K2.7). **Within budget.** Invocation 1 is not labelled in any commit body (NIT-5) |
| Migrations edited after commit | `git log --follow` per file: each of the three migrations has exactly **one** commit (`09dbd445`, `26e732fc`, `4d447238`). The K2.7 security findings were fixed by **forward** migration `20260923100000` |
| `MODE2-BRIEF-FROZEN-GUARD` byte-unchanged | `git diff --stat 28aa23c6..cad8790f -- supabase/__tests__/mode2-brief-rls.test.ts` is **empty** ✅ |
| Stage C byte-identical | `lib/ai/tool-runner.test.ts` and `lib/signals/triage/orchestrator.test.ts`: **empty diff**. The triage tool tests changed only `as` → `as unknown as` on result casts; **no assertion changed**. No `TRIAGE_*` constant renamed ✅ |
| p95 | `current-phase.md`: *"Measured p95 latency against ADR 0027 §7.3's predicted 30 000 ms: NOT MEASURED. No planner run has ever been observed"*. **Honest; not a finding** |

---

## 2. Findings

### BLOCKER-1 — `approve_brief_and_supersede_proposals` and `revise_brief_and_supersede_proposals` have zero production callers; `AGENCY-FREEZE-SUPERSEDE-ATOMIC` is AUTHORED-NOT-EXECUTED on every real path

ADR 0027 §5.7 calls this "the genuine hole", and says the fix is **one** RPC doing approval *and* supersede in one
function body. The RPCs exist and are one function body each
(`20260922110000_campaign_plan_proposal_rpcs.sql:323`, `:357`). **No TypeScript at `cad8790f` names either one.**
`git grep` for `approve_brief_and_supersede|revise_brief_and_supersede` over `*.ts`/`*.tsx` returns nothing, and
there is not even a `lib/db` wrapper. The production paths are unchanged:

- **Approve:** `approveBriefAction` → `approveBriefIfQualified` → `lib/campaigns/brief.ts:215`
  `approveBrief(client, brief.id)`. That is the single PostgREST UPDATE at `lib/db/campaign-briefs.ts:77`, which
  supersedes nothing.
- **Version advance:** `rejectBriefAction` and `editBriefAction` → `reviseBrief` (`brief/actions.ts:131`, `:217` →
  `lib/db/campaign-briefs.ts:100`), which supersedes nothing.

The Tier-1 test `plan-proposals-freeze-supersede.test.ts` calls the RPCs directly through `w.admin.rpc(...)`, so it
proves a function the product never runs. This is the `SHARED-FUNCTION CALLERS` failure the Session 22 blockers were
made of.

**Observable consequences at head:**

1. Approving a brief leaves its pending proposals `pending` against a frozen brief. `brief/page.tsx:47` lists them
   (`listPlanProposalsForBrief`), and `PlanReviewPanel.tsx:104` renders them as pending forever.
   `superseded_reason='brief_frozen'` is never written, so the §8.2 state *"the brief was approved"* never renders.
2. After any human edit or reject, the version advances with the old-version proposals still `pending`. The page
   query spans **every** version, so those proposals are listed as pending and, once the brief is `critiqued` again,
   **selectable**. The apply RPC then refuses them as `no_proposals_applied`, because it is version-scoped since
   `4d447238`. That is exactly ADR §5.7's *"If neither fix lands: stale pending proposals stay visible and
   acceptable"*.

**Disclosure:** none. The K2.6 body describes the RPCs as the fix. ADR 0027 V.2 row 34 and ADR 0017 Amendment F
treat the property as closed.

**Required:** route `approveBriefIfQualified` and both `reviseBrief` callers through the RPCs (with `lib/db`
wrappers). Add a per-caller test for each, and a Tier-1 test that goes through `approveBriefIfQualified` rather than
the raw RPC.

---

### MAJOR-1 — a ratified `reorder` lands one position away from where the human ratified it, and no test sends a reorder through the RPC

`apply_brief_proposals` (the live definition is `20260923100000_…sql`) resolves a reorder by giving the moved entry
`sort_key = proposed_order` (`:157`) and then ranking with `ORDER BY sort_key, idx` (`:161`). The occupant of the
target slot has the **same** `sort_key` and wins the `idx` tiebreak, so the moved entry never reaches
`proposed_order`. I reproduced the exact CTE against the live local Postgres:

```
entries r0..r3
move 3 -> 0 : r0,r3,r1,r2     (r3 lands at 1, not 0)
move 0 -> 3 : r1,r2,r0,r3     (r0 lands at 2, not 3)
```

The planner prompt tells the model `reorder` means *"move the post at targetOrder to proposedOrder"*, and the human
ratifies that sentence. The RPC then writes a different brief, which freezes and drives N posts (§6.1's
*durable, multiplied* effect). **No Tier-1 test covers a reorder through the RPC.**
`git grep reorder|proposed_order` over `plan-proposals-ratify.test.ts` and `plan-proposals-version-scope.test.ts`
finds nothing. The only reorder case is a hand-built array in `lib/campaigns/role-sequence.test.ts:139`, which never
touches the RPC.

**Required:** fix the placement semantics (for example, remove the entry, then insert it at `proposed_order`) and add
Tier-1 cases for a forward move, a backward move, and a reorder combined with a drop.

---

### MAJOR-2 — the four new Server Actions have no tests, and three test files cite test files that do not exist

The ADR assigns behaviour to these actions: the typed `already_decided` re-render (§5.6), the apply action
re-critiquing in the same request ([cr-MINOR-2], §5.5), and *"cite selects, never creates"* checked at runtime
(§4.8). None of it is executed:

| Action | File | Test that exercises it |
|---|---|---|
| `decidePlanProposalAction` | `brief/plan-actions.ts:78` | **none** |
| `applyPlanProposalsAction` (incl. its two `critiqueBrief` calls) | `brief/plan-actions.ts` (`critiqueBrief` at `:181`, `:233`) | **none** |
| `recritiqueBriefAction` | `brief/plan-actions.ts` | **none** |
| `resolveClaimAction` | `approvals/claim-actions.ts` | **none** |

The components that call them mock them out (`vi.mock('./plan-actions')`, `vi.mock('./claim-actions')`), and point
to tests that are not in the tree at `cad8790f` (`git ls-tree` of the directories):

- `PlanReviewPanel.test.tsx:28`: *"plan-actions.test.ts covers the actions themselves"*. **That file does not exist.**
- `ClaimFlags.test.tsx:26`, `ApprovalsInbox.test.tsx:23`, `lib/db/posts.claims.test.ts:10`: *"claim-actions.test.ts"*.
  **That file does not exist.**
- `ClaimFlags.test.tsx:25`: *"ApprovalsInbox.claims.test.tsx"*. **That file does not exist.**

So a SHARED-FUNCTION-CALLERS listing points at phantom coverage, and `critiqueBrief` has two new production callers
with no test. Removing the `critiqueBrief` call from the apply action, or letting `resolveClaimAction` accept any id,
would ship green.

**Required:** write the tests, or correct the citations and record the actions as AUTHORED-NOT-EXECUTED.

---

### MAJOR-3 — claim flags go stale when a post is edited or regenerated, and then highlight text the model never wrote

`claimCheck` stores **spans** into the post text (`verify-claims.ts`, *"Rendering a claim means slicing THE POST"*).
Neither content-changing path clears it:

- **Edit:** `updatePostContentAction` → `updatePostContent` (`lib/db/posts.ts:611`) writes `content` and leaves
  `ai_generation_metadata` untouched.
- **Regenerate:** `regeneratePostAction` builds `newMetadata` from `...existingMetadata`
  (`posts/actions.ts:328`), so the old `claimCheck` rides onto the new text.

`ClaimFlags.tsx:120` (`content.slice(c.span.start, c.span.end)`) and `MarkedPostText` then slice the **new** content
with the **old** offsets. The gate labels arbitrary new substrings "uncited" or "cited evidence not found", and it
does not flag a regenerated draft's actual claims at all. ClaimFlags even links "Edit the text" as one of the four
§4.8 actions, which is the step that corrupts the flag. `lib/db/posts.ts:304` states *"A post with no claimCheck
(generated before K2.9, **or regenerated**) is simply absent"*. **That is false.**

**Required:** clear or invalidate `claimCheck` on both paths (it would then render "not checked"), and test both.

---

### MAJOR-4 — `planner_run_id` is a random UUID with no link to `ai_usage`, so `AGENCY-PROPOSAL-PROVENANCE` is met in form only

ADR 0027 §5.3 says `planner_run_id` is *"the `ai_usage` row the spend belongs to"*, and gives the reason `[db-MAJOR-B]`:
*"without a run id, `planner_cents` spend has no row linking it to what it bought"*. The migration comment repeats
it (`20260922100000_…sql:72-73`). The code sets `plannerRunId: crypto.randomUUID()`
(`planner/orchestrator.ts:161`). `runToolLoop` writes its `ai_usage` row in its `finally` block and returns no id,
and there is no FK. The proposals group by run, but nothing joins them to spend. The Tier-1 test proves only
`NOT NULL`. This deviation is not disclosed (the K2.7 body says *"one planner_run_id per run"*).

**Required:** have the loop return the `ai_usage` row id (or record the run id on the `ai_usage` row) and persist that.
Otherwise amend the ADR and fix the migration comment.

---

### MAJOR-5 — redundancy half (b) is a log line, not an approval-gate flag; the discharge is claimed complete anyway

ADR 0027 §5.8(b): *"… → **flagged at the approval gate**. Never blocked, never edited."* At head, `checkSetRedundancy`
runs (`generate.ts:537`) and its only output is a `console.log` of `campaign.generate.redundancy_flagged`
(`:548`). Nothing persists the flag and nothing renders it. The K2.8 body disclosed this
(*"surfacing it at the approval gate needs a persistence/UI decision (K2.10 or later)"*), but K2.10 did not surface
it. ADR 0017 Amendment F.3 and ADR 0027 V.2 row 35 then record `MODE2-REDUNDANCY-UNDEFER` as **discharged**. An
operator log line is not a human gate, so ruling A-3's substitution is half-delivered. (Separately, the `proofType`
input is always `null` (`generate.ts`, *"a null proofType"*), so half of the ADR 0026 tuple condition never
discriminates. That is disclosed in K2.8 and not a separate finding.)

**Required:** persist the flag (for example in `ai_generation_metadata`) and render it in the approvals gate, or amend
F.3 and V.2 to record half (b) as open.

---

### MAJOR-6 — no test pins that `authenticated`/`anon` cannot EXECUTE the SECURITY DEFINER RPCs that trust a caller-supplied `p_user_id`

`apply_brief_proposals` and `decide_plan_proposal` take `p_user_id` as a **parameter** and check the capability of
*that* id (`assert_plan_proposal_author`). The whole authorisation model therefore rests on the REVOKE/GRANT lines
(`…rpcs.sql:261`, `:305-307`, and the others). If an authenticated user could execute them, they could pass the
owner's id. The grants are correct on the live DB (§1). But no test asserts them. The decide/ratify/version-scope
tests all call through `w.admin`, and none queries `routine_privileges` or calls an RPC with an authenticated JWT.
The repo has the precedent (`rls-policy-lockdown.test.ts`: *"purge_business function is executable by service_role
only"*). A later `DROP FUNCTION … CREATE FUNCTION` restores the default PUBLIC EXECUTE, and nothing would go red.

**Required:** a Tier-1 assertion per function, covering both the grant query and an authenticated
`rpc(...)` → `42501`/permission denied.

---

### MINOR-1 — the Tier-1 tenancy test runs every tool under service-role; its premise is stale and the "RLS arm" is mislabelled

`planner-tools-tenancy.test.ts:18` says *"The planner's own `client` parameter is service-role in production"*. At
head that is false. The orchestrator threads the caller's authenticated client, and `prepareBriefForCampaign` is
called with the request client (`campaigns/new/actions.ts:154`). Every tool call in the file uses `admin`
(`:195`, `:222`, …). So user U, who reaches both A and B, is seeded but never used as the client, and the "RLS arm"
(C) is really just a second `.eq` arm.

What the file *does* prove, I mutated: removing `listCampaigns`' `.eq('business_id')` fails 2 tests. What it cannot
prove: removing **one** of `getSignalForCampaign`'s three per-hop `business_id` predicates stays green (hop 1
removed: 4/4 pass). Removing all three fails only the no-linked-card case. The ADR's point that there are "three
chances to omit one" has no test that sees a single omission. The seed rows are `status='active'`,
`scope='brand'`, and the positive control runs first, so the test is not vacuous.

**Required:** run the tools under U's signed-in client (the ADR's scenario) as well as under service-role, and add a
recording-client Tier-2 test asserting `business_id` on each hop.

### MINOR-2 — `apply_brief_proposals` has no `status='critiqued'` guard; ADR 0017 F.1 says it has one

ADR 0027 §5.4's diagram gives the RPC `status='critiqued', frozen_at IS NULL, version++`. ADR 0017 Amendment F.1
(`0017:931`) says *"the brief must be `critiqued`"*. The RPC checks only `frozen_at` and `version`
(`20260923100000_…sql:62`, `:173`). `applyPlanProposalsAction` checks `critiqued` before calling, and the version
guard stops two rounds racing, so I found no reachable bypass today. But the RPC is the stated security boundary,
and the amendment misdescribes it. **Required:** add `AND status='critiqued'` (typed outcome) or correct F.1.

### MINOR-3 — `planBrief` swallows a failed or no-op status write, leaving proposals behind a brief that reads `not_run` (silent-failure-hunter #1, verified)

`plan-brief.ts:22`: `setBriefPlanAnalysis` errors are Sentry-only, and a `null` return (the `not_run` guard excluded
the row) is not even checked. If proposals were persisted and the status write fails, the brief shows `not_run`,
which is the worker-path state, while real pending rows sit in the table. That is the indistinguishability §3.3
exists to prevent. **Required:** treat a failed or no-op record as a distinct alert, and render proposals as present
whatever the status.

### MINOR-4 — the ADR 0010 §D2.5 row is not verbatim, and its new wording understates what the table holds

The row landed in the **same commit** as the migration (`09dbd445`) ✅. But it differs from ADR 0027 §9.3's verbatim
text (`0010:1092`), and it now says *"no third-party content"*. `reason` is model text written **after reading
`evidence_memory`** (customer quotes, case studies), and the planner is invited to say what it found. For a
counsel-facing cascade table, **required:** restore §9.3's wording verbatim.

### MINOR-5 — `toToolResultId` is an exported, non-validating mint that bypasses the type-level guarantee without a cast

`wrap-evidence.ts:331`. I planted `texts.map((text) => toToolResultId(text))` in `list_recent_posts`, and **tsc
accepted it**, while the planted raw `html_url` in the same run was rejected (`TS2322`). The cast scan cannot see a
function call. The dispatcher's UUID-shape assertion catches it at runtime (post text is not UUID-shaped, so the
model sees `TOOL_EXECUTION_ERROR_MESSAGE`), so this is defence-in-depth, not a hole. **Required:** validate the UUID
shape inside `toToolResultId`, or scan its call sites.

### MINOR-6 — the service-role function-body scan uses a hand-written list that omits a function the tools reach

`PLANNER_CALLED_DB_FUNCTIONS` (`planner/__tests__/source-scans.test.ts:280`) lists six functions. `list_evidence`
also reaches **`getEvidenceMemoryByIds`** through `wrapEvidenceForPrompt`, and that function is not in the list. It
is caller-client today (verified), so this is not a live defect. But the list is not derived from `tools.ts`'
imports, so a new import is covered only if someone remembers to add it.

### MINOR-7 — the page's proposal query does not match the partial index; the constraint's test targets a function with no production caller

`brief/page.tsx:47` uses `listPlanProposalsForBrief` (every status, every version, `brief_id` only). The partial
review index is `WHERE status='pending'`. `listPendingPlanProposals`, the query that matches it and the one
`AGENCY-PROPOSAL-BOUNDED-QUERY`'s test names, is called only from its test. It is bounded and all-ASC, so the house
rule holds. It is also the reason BLOCKER-1's stale rows reach the screen.

### MINOR-8 — a round of drops covering every entry commits an empty `roleSequence`

The RPC does not refuse it (`coalesce(jsonb_agg(...),'[]')`). `applyRatifiedProposals` then reports `invalid_result`
*after* the commit (its own "HONEST LIMIT"), so the brief is left `draft` with zero entries. **Required:** refuse in
the RPC with a typed outcome.

### NIT-1 — `tools.test.ts` (c) smuggles `businessId`, not an arbitrary key, and checks `toHaveProperty('issues')` rather than `instanceof z.ZodError`

`tools.test.ts:98-103`. My mutations (`z.object`, `z.object({businessId: z.never()})` blocklist, extra JSON-schema
key, missing `properties`) all reddened it, so this is a precision nit, not a hole.

### NIT-2 — `decidePlanProposalAction` does not check that the proposal belongs to the submitted campaign's brief

The RPC scopes by `business_id` only. It is the same tenant and author capability, so the only effect is rejecting a
sibling campaign's proposal.

### NIT-3 — the `wrapSignalForPrompt` allowlist scan still covers only `lib/signals/**`

It was widened in K2.4's own commit, with the assertion updated ✅. A fourth caller *outside* `lib/signals/` would
not fail it.

### NIT-4 — a dispatcher envelope violation is indistinguishable from an ordinary tool error (silent-failure-hunter #2, verified)

`tool-runner.ts:514` runs inside the generic catch: `console.error` only (`:525`), counted as a tool call. It fails
closed correctly. The gap is an operator signal (a named error plus Sentry).

### NIT-5 — ECC invocation "1 of 4" is not recorded in any commit body

It is inferable as K2.0's `code-explorer` (K2.0 has no commit).

---

## 3. The ten checks, in order

1. **Tools / clients.** All six tools read through caller-client functions carrying an explicit `business_id`:
   `listEvidenceMemoryCandidates`, `listBrandMemoryCandidates`, `listAudienceMemoryCandidates` (plus
   `getEvidenceMemoryByIds` through `wrapEvidenceForPrompt`), `listCampaigns`, `getSignalForCampaign`,
   `listRecentPublishedPostTexts`. The service-role imports in `memory-evidence.ts:74-76` and
   `memory-audience.ts:41-42` are in `import*` **siblings** that are never reached. `getSignalForCampaign` takes a
   caller client, has `.eq('business_id')` on all three hops, and imports no service-role (`.maybeSingle()` instead of
   the ADR's `.single()`, which is justified). `getCampaignById` and `listPostsByCampaign` are **not used by any
   tool**. `getCampaignById` is used by the *orchestrator* on the caller's client with a caller-supplied id, outside
   the model's reach. The K2.1 scans reddened (§4).
2. **Tenancy tests.** The Tier-2 schema test passes: `properties` must exist, the key set is exact and Zod-derived,
   and the code is `unrecognized_keys`. All five of my mutations reddened it. The Tier-1 test: MINOR-1.
3. **Brand.** `renderedToolResultBrand: unique symbol = Symbol(...)` is non-exported with a real initializer ✅. The
   cast scan reddens against a plant in `verify-claims.ts` (`as`) and in `claim-actions.ts` (angle-bracket) ✅.
   `execute`'s `GuardedJson` return fails tsc on a raw field ✅, with the mint caveat in MINOR-5. The runtime
   assertion runs on the **serialised** form at the single `JSON.stringify` (`tool-runner.ts:513-514`) ✅. The stale
   comment at `wrap-evidence.ts:241-244` was corrected ✅.
4. **Injection walkthrough, re-run on code.** First kill: `PlannerDecisionSchema`/`PlannerProposalSchema` are
   `strictObject` at both levels, with fields `kind, targetOrder, proposedRole?, proposedOrder?, reason`. **No field
   is read by any code as a verdict**, and `assertDecisionSchemaIsStrict` refuses `applied/status/approved/verified`
   at loop entry. Second kill: `verifyClaims` is a `Set.has` over `BoundEvidence.sentIds`, minted from the same fetch
   as the prompt text (`bindEvidenceForPrompt`), with no model in the loop. `reason` is free text, but the ADR
   accepts it as an unverifiable assessment and nothing consumes it as a verdict. **The residual is the named one.
   Nothing worse.** (MAJOR-1 widens it slightly: even a *faithful* human ratification of a reorder mis-applies.)
5. **Laundering.** `persist.ts` → `neutraliseProposalText` → the imported `neutralizeWithSentinels` (not copied) on
   `reason`, the only text column. It is asserted on the **stored row** (`planner-persistence.test.ts:66-83`). The
   failure and capped branches write zero rows. The apply RPC copies no proposal text (only enums, integers, and the
   existing `angle`), which is disclosed in `persist.ts`'s header as a correction to the build guide. The sixth
   sanitizer scan reddens ✅.
6. **Frozen brief.** Guard test byte-unchanged ✅. `editBriefAction` not widened (`brief/actions.ts` has an empty
   diff) ✅. Frozen refused with typed `'frozen'` ✅. The shared refine is imported by both `prompts/brief.ts` and
   `apply-proposals.ts` ✅. Caveat: `validateRoleSequence` runs *after* the RPC commits (disclosed; see MINOR-8).
7. **Atomicity.** The approve and revise supersede RPCs are single function bodies ✅, but unwired (**BLOCKER-1**).
   `decide_plan_proposal` is one guarded UPDATE, `AND status='pending'`, `IF NOT FOUND THEN RETURN NULL` ✅. Apply is
   guarded on `version = p_expected_version` and re-derives `order` via `row_number()` ✅, but with the placement
   bug in MAJOR-1. The atomic test issues two genuinely concurrent PostgREST calls (`Promise.all`) against live
   Postgres ✅.
8. **Soft failure.** DEFAULT `'not_run'` with a CHECK, Tier-1 ✅. The runtime array
   `TOOL_LOOP_FAILURE_REASONS`, `satisfies Record<…,'unavailable'>` (so mapping to `ok` is a compile error), and all
   eleven map to `unavailable` ✅. The reason column has a closed CHECK plus a pairing CHECK ✅. Reconcile happens on
   every loop outcome, and a pre-loop failure refunds to 0 ✅. The cap returns `capped` without a model call, and
   `isPlannerBudgetCapped` is a service-role boolean ✅. The distinguishability test renders from the persisted
   column (`page.tsx` passes `brief.plan_analysis_status`). Gap: MINOR-3.
9. **Grants / policy / cascade.** One SELECT policy in the InitPlan form ✅. `REVOKE ALL FROM anon`, and
   `REVOKE INSERT, UPDATE, DELETE, TRUNCATE FROM authenticated`, with the TRUNCATE grant absence asserted ✅. No
   UPDATE grant, no DELETE policy, no `BEFORE DELETE` trigger ✅. `kind` and `status` NOT NULL ✅. `proposed_role` is
   the `posts_role_check` six ✅. Partial UNIQUE on pending ✅. All three FKs declare CASCADE ✅. The trigger raises on
   every write-once payload column ✅. The D2.5 row is in the same commit ✅ but not verbatim (MINOR-4). The purge test
   covers the root delete, `purge_business`, and `decided_by` SET NULL ✅. `ai_budget_daily` widened by definition
   lookup plus RAISE, with no stale CHECK ✅. `rls-policy-lockdown.test.ts` is an **enumeration** of write-policy
   tables. `campaign_plan_proposals` has no write policy, so there was nothing to add there, but the RPC-grant
   pinning it also models is missing (MAJOR-6).
10. **CI.** §1. Green at the head, with the skip-guard lines read from the logs. V.2's column cites the prior head
    `998030e8`; the head itself (`cad8790f`, docs-only) is also green. Tier E: none, which is correct.

**SHARED-FUNCTION CALLERS at head (`git grep`, production only):**

| Function | Callers | Test per caller |
|---|---|---|
| `runToolLoop` | `triage/orchestrator.ts:128`, `planner/orchestrator.ts:107` (2) | triage suite (unmodified); `planner/__tests__/orchestrator.test.ts` |
| `assembleBrief` | `prepare-brief.ts:31`, `promote.ts:154`, `seed.ts:85` (3; only the first plans) | `prepare-brief.test.ts`; worker paths scan-asserted to never import the planner |
| `reviseBrief` | `brief/actions.ts:131`, `:217` (2; **not** routed through the supersede RPC, BLOCKER-1) | existing `actions.test.ts` |
| `editBriefAction` | `BriefReviewForm.tsx:37` (1, not widened) | `BriefReviewForm.test.tsx` |
| `critiqueBrief` | `prepare-brief.ts:37`, `plan-actions.ts:181`, `:233` | `prepare-brief.test.ts`; **plan-actions: none (MAJOR-2)** |
| `checkRoleCoverage` | `generate.ts:506` (1, unchanged) | existing |
| `wrapToolResultForPrompt` | `triage/tools.ts`, `planner/tools.ts` (+ `scripts/eval/live-triage-run-populated-memory.ts`, non-production) | both `tools.test.ts` deep-walks |
| `wrapSignalForPrompt` | `triage/card.ts:192`, `triage/orchestrator.ts:109`, `planner/tools.ts:124` (3) | allowlist widened in K2.4's own commit (NIT-3) |

**Tools are built once per campaign** (`orchestrator.ts`, before `runToolLoop`, outside `generate.ts`), and a planted
construction in the fan-out fails 3 scans ✅. **Bounds:** each bound has a reddenable case that imports the constant,
the tool-call cap asserts **withholding**, and the `max_tokens` invariant is asserted for both consumers ✅. **The
three inherited holes are closed** (`provider_error` non-retryable, `withTimeout` with fake timers, and a tool error
relaying the constant rather than the DB text) ✅. **Prompt re-freeze:** three frozen rows moved `3 → 4`, both fixtures
regenerated per the K2.9 body, `AI_ORIGINAL_SCHEMA_VERSION` still `2` ✅. **L-1 scope:** no write tool, no egress,
no provider, no new memory writer (`cite` checks the id against a capped `retrieveEvidenceMemory`), no embeddings, no
eleventh dimension, no new API route, no human gate removed (K2.13 keeps Generate as a separate explicit control) ✅.

**UX:** no `asChild`, `console.*`, `dangerouslySetInnerHTML` or inline `style` in any changed `app/` file. No
select-all/accept-all. The transient `draft` state explains the absent Approve (`PlanReviewPanel.tsx`
`briefStatus === 'draft'`). `verif*`/`support*`/`suport*`/`comprov*`/`respald*` appear nowhere in
`i18n/{en,pt,es}/agency.json`. **taste-skill and impeccable changed nothing** (K2.10 body: *"taste-skill: CHANGED
NOTHING … impeccable: READ-ONLY audit, CHANGED NOTHING. Detector: 0 findings"*), and neither touched the §8
contract.

---

## 4. Tier-3 scans: re-run and reddened by me at `cad8790f`

Each row: a plant in the scratch worktree, the named file re-run, then restored.

| # | Plant | Result |
|---|---|---|
| 1/5 | `.insert(` in `planner/tools.ts` | 1 failed / 51: *"lib/campaigns/planner/** contains no write verb"* |
| 4 | dynamic `await import('@/lib/supabase/service')` in `planner/persist.ts` | 1 failed / 51: *"reaches no service-role client"* |
| 6 | `fetch(` in `planner/tools.ts` | 1 failed / 51: *"makes no network call …"* |
| 7 | `queryContext` passed to `listEvidenceMemoryCandidates` in `lib/memory/evidence.ts` | 1 failed / 51: *"… call their candidate reader without the query context"* |
| 8 | `buildPlannerTools` constructed in a loop in `generate.ts` | 3 failed / 51 |
| 9 | `planBrief` imported by `promote.ts` | 1 failed / 51: *"the two worker-side assembleBrief callers do not import the planner"* |
| 11 | `status` field in a strictObject in `campaign-planner.ts` | 1 failed / 51 |
| 18 | `@/lib/db/posts` imported by `verify-claims.ts` | 1 failed / 27 |
| 22 | an eleventh key `claimSupport` in the rubric schema | 1 failed / 51 (my first plant, a comment, stayed green: a bad plant, not a hole) |
| 23 | `lib/campaigns/verify-claims.ts` path corrupted in `triage/verify.ts`' cross-reference | 1 failed / 27 |
| 24 | `evidence_memory` `.insert` in `prepare-brief.ts` | 2 failed / 51 |
| 25 | `reviseBrief` imported under the planner root | 1 failed / 51 |
| 29 | a second module doing `.from('campaign_plan_proposals').update(...)` | 1 failed / 4 (`decide-scan.test.ts`) |
| 38 | `'raw' as RenderedToolResult` in `verify-claims.ts`; `<RenderedToolResult>` in `claim-actions.ts` | 1 failed / 51, each |
| 39 | `function sanitizeDataField` in `prepare-brief.ts` | 1 failed / 51 |
| 40 | `dangerouslySetInnerHTML` in `PlanReviewPanel.tsx` | 1 failed / 1 |
| 43 | `CREATE TABLE public.planner_budget_daily` in a scratch migration (deleted) | 1 failed / 51 |

Constraint 44 part (c): the Builder's transcript was generated at `980ff0ae`, **before** K2.12/K2.13. Those two
commits touch `generate-action.ts` (`startGenerationAction`). I read that diff: it adds a `brief_not_approved` refusal
and requires `awaiting_brief` plus an approved brief, **adding a precondition, not a path**. Nothing under
`lib/social`, `lib/publishing` or `app/api` changed across the full range
(`git diff --name-only 28aa23c6..cad8790f`).

---

## 5. Constraint → status (46; rows are mixed-tier)

Executed green in CI at `cad8790f` at file level (skip-guard: no file invisible, none red): **all 46 rows' named
files**. That is not the same as *proven*. The rows below have a defect or a gap this review found:

| # | Constraint | Status |
|---|---|---|
| 3 | TOOLS-TENANT-BOUND | Tier-2 ✅. Tier-1 runs under service-role only; a single per-hop omission is untestable (MINOR-1) |
| 4 | NO-SERVICE-ROLE-IN-TOOLS | ✅, with a hand list gap (MINOR-6) |
| 18 | CLAIMS-FLAGGED-NEVER-EDITED | text never edited ✅. The flag itself goes stale on edit/regenerate (MAJOR-3) |
| 21 | CLAIM-CITED-NOT-SUPPORTED | ✅ |
| 29 | PROPOSAL-DECIDE-VIA-RPC | the RPC's capability check ✅. EXECUTE-grant boundary unpinned (MAJOR-6). The action is untested (MAJOR-2) |
| 32 | PROPOSAL-PROVENANCE | NOT NULL ✅. The link to `ai_usage` is absent (MAJOR-4) |
| 33 | PROPOSAL-BOUNDED-QUERY | tested function unused in production (MINOR-7) |
| 34 | FREEZE-SUPERSEDE-ATOMIC | **AUTHORED-NOT-EXECUTED on the production path (BLOCKER-1)** |
| 35 | SET-REDUNDANCY-CHECKED | half (b) not at the gate (MAJOR-5) |
| 36 | PROPOSAL-PAYLOAD-NEUTRALISED | ✅ |
| 26/27 | FROZEN-BRIEF-CONTRACT-INTACT / ORDER-UNIQUE | ✅; reorder placement is wrong (MAJOR-1), a separate property with no constraint and no test |
| 44 | GATES-UNCHANGED | Tier-1 and Tier-2 ✅. The Tier-3 transcript predates K2.12/13, re-checked above ✅ |
| all others | | ✅ as mapped in V.2 |

Tier E: none declared, which is correct per ADR §10.4.

---

## 6. The silent-failure-hunter's output, as evidence

It was dispatched once, read-only, at `cad8790f`, over the four scoped paths. It hit a rate limit mid-run and was
**resumed** (the same invocation, not a second one). Its findings #1 and #2 were verified against the code and are
carried as MINOR-3 and NIT-4. One statement in its "checked and fine" list is **wrong** and is not relied on: it says
a persistence failure is refunded because `reservationHeld` is still true. In fact `orchestrator.ts:133` clears
`reservationHeld` *before* reconcile and persist, so a persistence failure reconciles to the real cost and does not
refund. The outcome (no double refund, spend recorded) is correct for a different reason than the agent gave.

---

## 7. Required before merge

1. **BLOCKER-1:** wire both supersede RPCs into the approve and revise paths, with tests per caller.
2. **MAJOR-1:** fix reorder placement; add Tier-1 reorder cases.
3. **MAJOR-2:** test the four actions, or correct the phantom citations and record them as AUTHORED-NOT-EXECUTED.
4. **MAJOR-3:** invalidate `claimCheck` on edit and regenerate.
5. **MAJOR-4:** make `planner_run_id` join to spend, or amend the ADR and the migration comment.
6. **MAJOR-5:** surface redundancy at the gate, or amend ADR 0017 F.3 and V.2 row 35 to "half (b) open".
7. **MAJOR-6:** pin the RPC EXECUTE grants with a Tier-1 test.

MINORs may be closed in the same correction pass or deferred with a `docs/backlog.md` entry each.

_End of reviewer findings. A correction pass appends below this line, per REVIEWER-REPORT APPEND-ONLY; nothing above it
is edited._

---

## CORRECTION PASS (Session 34-D)

**Author:** Session 34-D correction pass · **Date:** 2026-09-24 · **Range fixed:** `cad8790f..<D12-sha>`
**Reviewed head:** `cad8790f` — the head the Reviewer read; only this pass's §4 and the report itself landed
after it, at D0 (`da1f1aa5`).
**Founder adjudications consumed:** one — no finding is deferred (founder, 2026-09-24), overriding the
Reviewer's §7 permission to defer MINORs. A-1…A-9 stand; MAJOR-5 option (b), MAJOR-4 option (b) and MAJOR-2
option (b) were available and not taken (build-guide §4).
**Everything above this line is the Reviewer's. Everything below it is this pass's.**

### D1 — MAJOR-6

- **Finding:** MAJOR-6.
- **Fix:** new Tier-1 file `supabase/__tests__/plan-proposals-rpc-grants.test.ts` derives every
  `CREATE OR REPLACE FUNCTION public.<name>(` from `20260922110000_campaign_plan_proposal_rpcs.sql` and
  `20260923100000_plan_proposal_version_scope_and_reason_check.sql` (6 functions), then asserts per function
  that anon, authenticated and PUBLIC hold no EXECUTE (ACL read from `pg_proc.proacl`, defaulting through
  `acldefault` when NULL, plus `has_function_privilege`) and that `service_role` does, and that an
  authenticated member's `rpc()` — passing the owner's id as `p_user_id` and the real `p_business_id` — and an
  anon `rpc()` are both refused with `42501` (a body-level refusal would mean the caller got in).
- **Proof:** `supabase/__tests__/plan-proposals-rpc-grants.test.ts:80` (derived set non-empty, contains the six
  required names), `:90` (ACL arm), `:132` (authenticated `rpc()` arm), `:141` (anon `rpc()` arm). The
  authenticated-client construction is the `plan-proposals-rls.test.ts` one (`createClient` +
  `signInWithPassword` on the `createWorld` user); no second helper was written.
- **Reddening** (LOCAL stack only, `127.0.0.1:54321/54322`; both arms went red each time, `REVOKE` restored, re-run green):
  1. `GRANT EXECUTE ON FUNCTION public.decide_plan_proposal(uuid, uuid, uuid, text) TO authenticated;` →
     `2 failed | 3 passed`: `decide_plan_proposal grantees: expected [ 'postgres', 'service_role', …(1) ] to not include 'authenticated'`
     and `decide_plan_proposal was callable by an authenticated member: expected null not to be null`.
     `REVOKE EXECUTE … FROM authenticated;` → `5 passed`.
  2. `GRANT EXECUTE ON FUNCTION public.apply_brief_proposals(uuid, uuid, int, uuid, uuid[]) TO authenticated;` →
     `2 failed | 3 passed`: `apply_brief_proposals grantees: … to not include 'authenticated'` and
     `apply_brief_proposals was callable by an authenticated member`. `REVOKE` → `5 passed`.
  The mutation was a live-DB `GRANT`, not a file edit, so the working tree was never dirtied; the local
  database is back at the migrations' state.
- **Commit:** this commit (D1; SHA back-filled by D12's sweep).
- **What I did NOT touch:** no production code, no migration; the existing `plan-proposals-*.test.ts` files are
  unchanged.

### D2 — MINOR-1 and NIT-1

**MINOR-1**
- **Finding:** MINOR-1.
- **Fix:** `supabase/__tests__/planner-tools-tenancy.test.ts` now runs every tool under BOTH clients — the
  existing service-role arm (kept) and user U's signed-in client (U reaches A and B, so RLS alone cannot keep B
  out of a tool bound to A) — and its header is corrected to what is true (the orchestrator threads the
  request's authenticated client, `campaigns/new/actions.ts:154`); the "RLS arm" title for business C is
  relabelled (RLS-closed for the member, filter-closed for service-role). A new Tier-2 recording-client test,
  `lib/db/signals-campaign-tenancy.test.ts`, asserts `.eq('business_id', …)` on each of
  `getSignalForCampaign`'s three hops by table name.
- **Proof:** `supabase/__tests__/planner-tools-tenancy.test.ts:204` (`arms`) and `:209` (`for (const arm of arms)`;
  the three tests at `:211`, `:238`, `:261` plus the zero-rows test each run once per arm — 8 tests);
  `lib/db/signals-campaign-tenancy.test.ts:42` (per-hop, `it.each` over the three tables) and `:50` (exactly
  the three hops).
- **Reddening** (each restored from a saved copy; `git diff` on the mutated file confirmed empty afterwards):
  - (a) delete the `.eq('business_id', businessId)` line of ONE hop in `lib/db/signals.ts`: hop 1 (`:123`) →
    `× hop insight_cards …: insight_cards lacks .eq('business_id', 'biz-1')`; hop 2 (`:132`) →
    `× hop signal_candidates …`; hop 3 (`:141`) → `× hop signals …`. Each: 1 failed | 3 passed, naming the hop.
    (Before D2 the Reviewer showed hop 1 removed left 4/4 green.)
  - (b) delete `lib/db/campaigns.ts:14` (`listCampaigns`' `.eq('business_id')`) → the Tier-1 file went
    3 failed | 5 passed, including `… ZERO business-B rows [member's signed-in client]` — the signed-in arm
    reddens, not only service-role.
- **Commit:** this commit (D2; SHA back-filled by D12's sweep).
- **What I did NOT touch:** the service-role arm is kept, not replaced; no tool's code changed.

**NIT-1**
- **Finding:** NIT-1.
- **Fix:** `lib/campaigns/planner/__tests__/tools.test.ts` case (c) now smuggles an ARBITRARY key
  (`injected: 1`) alongside `businessId` and additionally asserts `toBeInstanceOf(z.ZodError)`; the existing
  `toHaveProperty('issues')` and `unrecognized_keys` assertions are kept (added, not weakened).
- **Proof:** `lib/campaigns/planner/__tests__/tools.test.ts:101` (smuggle) and `:104` (`instanceof z.ZodError`).
- **Reddening:** `z.strictObject(` → `z.object(` in `lib/campaigns/planner/tools.ts` → case (c) RED
  (`expected AssertionError: list_evidence accepted a … to be an instance of ZodError`), 1 failed | 11 passed;
  restored, `git diff` empty.
- **Commit:** this commit (D2; SHA back-filled by D12's sweep).

### D3 — MINOR-5, MINOR-6 and NIT-3

**MINOR-5**
- **Finding:** MINOR-5.
- **Fix:** `lib/ai/wrap-evidence.ts` — `toToolResultId` now throws `toToolResultId: refused a value that is not
  UUID-shaped` on anything failing the pattern, and `UUID_SHAPE` is exported once (moved above the mint) and
  used by both the mint and the dispatcher's `assertGuardedToolResult` — no second regex.
- **Callers (SHARED-FUNCTION CALLERS), each passing a typed DB row id:** `lib/campaigns/planner/tools.ts:73`
  (`rawIds`), `:85`, `:96`, `:108` (row ids) and `lib/signals/triage/tools.ts:95`, `:110`, `:124`, `:136` —
  exercised by `lib/campaigns/planner/__tests__/tools.test.ts` (deep-walk + injection) and
  `lib/signals/triage/tools.test.ts` respectively; `lib/ai/tool-result-guard.test.ts` passes a real UUID.
  Their fixtures used non-UUID ids (`'row-1'`, `'camp-1'`), which is exactly what the old comment recorded as
  the reason the mint could not validate; the fixture ids were changed to UUID-shaped values
  (`memoryRow` and `campaignRow` in both files, plus `lib/campaigns/planner/__tests__/tools.test.ts:116`'s
  comment) — production ids are always real UUIDs, so no assertion was weakened. Stage C behaviour is
  unchanged (`lib/ai/tool-runner.test.ts` and `lib/signals/triage/orchestrator.test.ts` not edited).
- **Proof:** `lib/ai/to-tool-result-id.test.ts:17` (valid uuid round-trips), `:22` (throws on `'not-a-uuid'`,
  `''`, `'row-1'`, post text, trailing space, an envelope-close smuggle), `:29` (the Reviewer's exact
  `texts.map((text) => toToolResultId(text))` throws), `:34` (one constant shared with the dispatcher).
- **Reddening:** re-planted the Reviewer's mutation — `lib/campaigns/planner/tools.ts:135`
  `wrapToolResultForPrompt(text)` → `toToolResultId(text)` in `list_recent_posts`. **tsc accepted it (no
  output)**; `lib/campaigns/planner/__tests__/tools.test.ts` went RED —
  `× list_recent_posts: every string in the result is guarded … Error: toToolResultId: refused a value that is
  not UUID-shaped` (1 failed | 11 passed). Restored from a saved copy; `git diff` on `tools.ts` empty.
- **Commit:** this commit (D3; SHA back-filled by D12's sweep).

**MINOR-6**
- **Finding:** MINOR-6.
- **Fix:** `lib/campaigns/planner/__tests__/source-scans.test.ts` — the hand list is deleted;
  `derivePlannerCalledDbFunctions` (`:322`) derives the set from `tools.ts`' named value imports (one hop into
  every `lib/ai` module it imports, and through `lib/memory/index.ts`' re-exports into the module that defines
  each retrieval function), via the new `namedValueImports` (`:288`, drops `import type` and inline `type X`).
  The service-role body scan runs over the derived set. A derived name that is not a `function` declaration
  must be a plain exported constant (e.g. `MEMORY_CANDIDATE_LIMIT`) — an arrow/function-expression const FAILS
  instead of being skipped.
- **Proof:** `source-scans.test.ts:357` (`namedValueImports` planted), `:369` (derived set non-empty, contains
  `getEvidenceMemoryByIds` and the six previously hand-listed functions, and no body reaches service-role).
- **Reddening:** prepended `import { insertSignal } from '@/lib/db/signals'` (a function that lazily acquires
  `createServiceRoleClient`) to `tools.ts` → `× every lib/db function a planner tool reaches — DERIVED from the
  import graph … AssertionError: expected [ Array(1) ] to deeply equal []` (1 failed | 51 passed); the hand list
  would have stayed green. Restored; `git diff` on `tools.ts` empty.
- **Commit:** this commit (D3; SHA back-filled by D12's sweep).

**NIT-3**
- **Finding:** NIT-3.
- **Fix:** `lib/signals/source-scans.test.ts` — the `wrapSignalForPrompt` allowlist scan now walks `app/**`,
  `lib/**` and `components/**` (definition `lib/ai/wrap-evidence.ts` excluded by name) and asserts exactly
  `lib/campaigns/planner/tools.ts`, `lib/signals/triage/card.ts`, `lib/signals/triage/orchestrator.ts`. No
  `scripts/` caller exists (`git grep` at D3), and `scripts/` is not a production root.
- **Proof:** `lib/signals/source-scans.test.ts:211`.
- **Reddening:** created `app/scratch-d3.ts` importing and referencing `wrapSignalForPrompt` →
  `× wrapSignalForPrompt is referenced by exactly the three sanctioned production callers … AssertionError:
  expected [ 'app/scratch-d3.ts', …(3) ] to deeply equal [ …(3) ]` (1 failed | 15 passed). File deleted;
  `git status` shows no scratch file.
- **Commit:** this commit (D3; SHA back-filled by D12's sweep).
- **What I did NOT touch:** no second UUID regex; no tool behaviour change beyond the mint's throw.
  Note for the record: `lib/signals/triage/tools.test.ts` was edited for FIXTURE IDS ONLY (rule 9 names
  `tool-runner.test.ts` and `triage/orchestrator.test.ts` as the byte-identical pair; neither was touched).

### D4 — BLOCKER-1

- **Finding:** BLOCKER-1.
- **Fix:** `lib/db/campaign-briefs.ts` gains `approveBriefAndSupersedeProposals(businessId, briefId)` and
  `reviseBriefAndSupersedeProposals(businessId, briefId, expectedVersion, content)` — service-role via the
  CLAUDE.md lazy import, NO client parameter, mapping the RPC's typed outcome (`ok` → the row; `invalid_state` /
  `concurrent_edit` → `null`; anything else, or an RPC error, throws) onto the predecessors' `row | null`
  contract. `approveBriefIfQualified` (`lib/campaigns/brief.ts`) keeps its status check and
  `BRIEF_QUALITY_THRESHOLD` gate BEFORE the write, then calls the approve wrapper with the LOADED brief's
  `business_id`; `rejectBriefAction` and `editBriefAction` (`brief/actions.ts`) call the revise wrapper with
  `loaded.brief.business_id`. `approveBrief` and `reviseBrief` are DELETED (`git grep` at D4 start: no caller
  besides the three above and their tests), the now-dead `serviceClient` field of the loader and its
  `SupabaseClient` import are removed, and the stale caller comment in `brief.ts` is rewritten.
- **Per-caller table (SHARED-FUNCTION CALLERS):**

  | Caller | Reaches | Test (file:line) |
  |---|---|---|
  | `approveBriefAction` | `approveBriefIfQualified` (REAL) → `approveBriefAndSupersedeProposals('biz-loaded','brief-1')` | `app/[locale]/(dashboard)/campaigns/[id]/brief/actions.supersede-callers.test.ts:85` |
  | `approveBriefAction`, below threshold | never reaches the wrapper | `actions.supersede-callers.test.ts:95` |
  | `approveBriefIfQualified` (direct) | wrapper with `('biz-1','brief-1')`; below threshold never | `lib/campaigns/brief.test.ts:307`, `:283` |
  | `rejectBriefAction` | `reviseBriefAndSupersedeProposals('biz-loaded','brief-1',1, own content)` | `actions.supersede-callers.test.ts:104` (and `actions.test.ts:172`) |
  | `editBriefAction` | `reviseBriefAndSupersedeProposals('biz-loaded','brief-1',1, edited content)` | `actions.supersede-callers.test.ts:114` (and `actions.test.ts:229`, `actions.hypothesis.test.ts:57,90,97`) |
  | both revise callers, `null` | `concurrent_edit` surfaced | `actions.supersede-callers.test.ts:132` |

  The pre-existing `actions.test.ts`, `actions.hypothesis.test.ts` and `brief.test.ts` were renamed to the new
  wrapper names and their argument assertions changed from `expect.anything()` (the old client) to
  `'biz-1'` (the loaded brief's business id) — stricter, not weaker. `lib/db/campaign-briefs.test.ts`'s
  `approveBrief`/`reviseBrief` describes were replaced by wrapper tests (`:148`, `:180`) pinning the outcome
  mapping, since the functions they tested no longer exist.
- **Proof (Tier-1, through the production functions, not the raw RPC):**
  `supabase/__tests__/plan-proposals-approve-revise-path.test.ts:51` (`approveBriefIfQualified`: an
  above-threshold critiqued brief with two pending proposals → approved, `frozen_at` set, BOTH proposals
  `superseded`/`brief_frozen`, `decided_by` NULL), `:71` (below threshold: refused before any write, proposals
  stay pending), `:84` (revise wrapper: superseded `version_advanced`, brief at N+1), `:102` (stale
  `expectedVersion` → `null`, nothing superseded). **Tier-3:** `lib/campaigns/__tests__/brief-write-paths.test.ts:74`
  (no module under `lib/` or `app/` issues a PostgREST `.update()` on `campaign_briefs` setting status
  `'approved'` or advancing `version`; floor: >200 files and `lib/db/campaign-briefs.ts` must be in the set),
  `:88` (both wrappers exist, `approveBrief`/`reviseBrief` are gone, and ONLY `lib/campaigns/brief.ts` calls the
  approve wrapper and ONLY `brief/actions.ts` the revise wrapper), `:54`/`:67` (detector planted positives and
  negatives). The planner root's `BRIEF_WRITERS` list (`planner/__tests__/source-scans.test.ts`) additionally
  forbids the two wrapper names to the planner — additive; the old names stay listed.
  `plan-proposals-freeze-supersede.test.ts` is unchanged and green.
- **Reddening** (each restored from a saved copy; the mutated file confirmed back to its pre-mutation state):
  1. `lib/campaigns/brief.ts:219` — the wrapper call replaced by the old direct PostgREST
     `client.from('campaign_briefs').update({ status: 'approved', frozen_at: … }).eq('id', brief.id).eq('status','critiqued')…`.
     Tier-1: `× approveBriefIfQualified: an above-threshold critiqued brief is approved and frozen, and BOTH
     pending proposals supersede brief_frozen … AssertionError: expected 'pending' to be 'superseded'`
     (1 failed | 3 passed). Tier-3 scan, same mutation: `× no production module under lib/ or app/ issues one …
     AssertionError: expected [ Array(1) ] to deeply equal []`.
  2. `brief/actions.ts` (`rejectBriefAction`) — `loaded.brief.business_id` → `parsed.data.campaignId`:
     `× rejectBriefAction -> reviseBriefAndSupersedeProposals(biz-loaded, brief-1, …)` (1 failed | 4 passed).
- **Specialist:** `ecc:security-reviewer`, invoked ONCE after the plan and before the commit, read-only over the
  uncommitted diff at `b6e76bb6`. **No blocking finding.** Two LOW/informational notes, recorded not actioned
  (neither is a regression and neither is in this step's scope): (a) `approveBriefIfQualified` does no ownership
  check itself — the same trust model as before, safe while `approveBriefAction` (which runs
  `loadOwnedCampaignAndBrief` first) is its only non-test caller, and the wrapper-caller pin at
  `brief-write-paths.test.ts:88` now fails if a second caller appears; (b) the RPC re-checks
  `status='critiqued'` but not `overall_score`, so the threshold gate lives in code before the RPC — the
  predecessor had the same shape, and the RPC is only changed at D5 (the one migration), where no ruling
  requires it. The specialist also confirmed tenant isolation (`getCampaignById` on the user's client,
  `campaign.business_id === ctx.business.id`, `UNIQUE(campaign_id)`, the RPC re-matching `business_id`), no static
  service-role import, and that the outcome mapping cannot treat a forged outcome as success.
- **Commit:** this commit (D4; SHA back-filled by D12's sweep).
- **What I did NOT touch:** `approveBriefIfQualified`'s threshold gate is unchanged;
  `plan-proposals-freeze-supersede.test.ts` is unchanged. The ADR text that still names `approveBrief` /
  `reviseBrief` (`docs/decisions/0027-…`, §5.7 and the caller tables) is D11's, not this step's.

### D5 — MAJOR-1, MINOR-2, MINOR-8 and MINOR-7's index half  ·  the only migration

**One forward migration:** `supabase/migrations/20260924100000_apply_brief_proposals_exact_placement.sql`
(`20260922110000` and `20260923100000` are untouched). `CREATE OR REPLACE apply_brief_proposals` with the SAME
signature; its `REVOKE ALL … FROM PUBLIC`, `REVOKE EXECUTE … FROM anon, authenticated` and
`GRANT EXECUTE … TO service_role` lines are restated verbatim. D1's grant test is green after it
(`plan-proposals-rpc-grants.test.ts`, 5/5); `information_schema.routine_privileges` for the function reads
`postgres:EXECUTE`, `service_role:EXECUTE` only.

**The placement rule, in the migration header and matching the sentence the human ratifies** ("reorder: move
the post at targetOrder to proposedOrder", `lib/ai/prompts/campaign-planner.ts`): *proposed_order is the entry's
0-based position in the RESULTING sequence — after every accepted drop is removed — and every entry that is not
the target of an accepted reorder keeps its original relative order and fills the remaining positions, in
order.* Composition: `target_order` always names an entry by its ORIGINAL `order`; drop removes; substitute
keeps the place and changes only the role; a reorder PINS its entry to its slot and the un-pinned survivors fill
the open slots left to right (submission order is irrelevant). A combination the sentence cannot satisfy is
REFUSED with a typed outcome: two reorders to one slot → `conflicting_reorders`; a slot past the result's end →
`invalid_reorder_target`; nothing left → `empty_sequence`.

**MAJOR-1**
- **Finding:** MAJOR-1.
- **Fix:** the ranking `ORDER BY sort_key, idx` is replaced by pin-and-fill in the migration's `placed` CTE. The
  same rule is implemented as the pure reference `placeRatifiedProposals` (`lib/campaigns/role-sequence.ts:96`).
  New constraint **`AGENCY-REORDER-RATIFIED-EXACT`** (Tier 1); D11 records it in ADR 0027 (46 → 47).
- **Proof:** Tier-1 `supabase/__tests__/plan-proposals-ratify.test.ts` — cases ADDED, none changed (0 removed
  lines): `:272` (the Reviewer's 3 → 0, verbatim: `r3,r0,r1,r2`), `:276` (0 → 3, verbatim: `r1,r2,r3,r0`), `:280`
  (forward and backward interior moves), `:285` (reorder + drop), `:294` (reorder + substitute), `:303` (two
  reorders to different slots), `:323` (two reorders to one slot refused), `:335` (slot past the result's end
  refused). Each accepted case asserts the RPC's `roleSequence` EQUALS the TypeScript reference's output for the
  same input; each refusal asserts the typed outcome, a named proposal, and ZERO rows changed. Tier-2
  `lib/campaigns/role-sequence-placement.test.ts:25,48,79` pins the reference itself.
- **Reddening (LOCAL DB):** loaded the previous migration's function body (`ORDER BY sort_key, idx`) into the
  local database (`md5(pg_get_functiondef)` `902f8742…` → `f4a8bba0…`): 9 of the 17 ratify tests RED, including
  `× the Reviewer's case 3 -> 0 (verbatim)` and `× … 0 -> 3 (verbatim)`; re-applied the migration's function
  body → hash `902f8742…` again (byte-identical) and 17/17 green. (Before the migration was applied at all, the
  same 9 were RED against the live old function — the TDD RED run.)
- **Commit:** this commit (D5) for the migration and tests; a second SHA for the ADR record is D11's.

**MINOR-2**
- **Finding:** MINOR-2.
- **Fix:** the RPC refuses a brief that is not `critiqued` with the typed outcome `not_critiqued`, and the final
  brief UPDATE is also guarded `AND status = 'critiqued'`. **Guard order, argued:** frozen → concurrent_edit →
  (stale/conflicting checks) → no_proposals_applied → `not_critiqued`. The first draft of the migration put
  `not_critiqued` before `no_proposals_applied`; the EXISTING `plan-proposals-version-scope.test.ts` scenario
  ("applying the stale sibling afterwards changes NOTHING", which is a `draft` brief with nothing pending) went
  RED across all retries, because that scenario has always answered `no_proposals_applied`. That test was not
  changed; the migration was — "nothing to apply" is the truer answer than "not critiqued" when no pending
  proposal remains, and a draft brief WITH a pending proposal still reads `not_critiqued`.
- **Proof:** `plan-proposals-ratify.test.ts:347` (a draft brief → `not_critiqued`, proposal still `pending`,
  version and status unchanged); `plan-proposals-version-scope.test.ts` unchanged and green.
- **Reddening:** the old function body (no critiqued guard) → `× a draft (non-critiqued) brief is refused
  'not_critiqued'` RED (part of the 9 above); restored, hash identical.
- **Commit:** this commit (D5); D11's ADR 0017 addendum is the second SHA.

**MINOR-8**
- **Finding:** MINOR-8.
- **Fix:** a result with zero entries returns `empty_sequence` BEFORE any proposal is marked accepted, so the
  brief is not left `draft` with an empty `roleSequence` and no row changes.
- **Proof:** `plan-proposals-ratify.test.ts:359` (drop every entry → `empty_sequence`; proposals still pending;
  version, status and roleSequence unchanged); `role-sequence-placement.test.ts` covers the reference.
- **Reddening:** old body → RED (part of the 9); restored, hash identical.
- **Commit:** this commit (D5).

**MINOR-7 (index half only; the query changes at D10)**
- **Fix:** non-partial index `campaign_plan_proposals_brief_version_idx ON campaign_plan_proposals (brief_id,
  brief_version, target_order, created_at, id)`. The partial review index and the partial unique index are
  unchanged. `pg_indexes` after the migration (local):

  ```
  campaign_plan_proposals_brief_id_idx      ... USING btree (brief_id)
  campaign_plan_proposals_brief_version_idx ... USING btree (brief_id, brief_version, target_order, created_at, id)
  campaign_plan_proposals_business_id_idx   ... USING btree (business_id)
  campaign_plan_proposals_campaign_id_idx   ... USING btree (campaign_id)
  campaign_plan_proposals_decided_by_idx    ... USING btree (decided_by) WHERE (decided_by IS NOT NULL)
  campaign_plan_proposals_pending_slot_uq   ... UNIQUE ... (brief_id, brief_version, kind, target_order) WHERE (status = 'pending')
  campaign_plan_proposals_pkey              ... UNIQUE ... (id)
  campaign_plan_proposals_review_idx        ... USING btree (brief_id, brief_version, target_order, created_at, id) WHERE (status = 'pending')
  ```

- **Proof:** the query output above (an index has no behavioural assertion; D10's query is what uses it).
- **Commit:** this commit (D5) for the index; D10 is the second SHA (the query).

**Specialist — `ecc:database-reviewer`, invoked ONCE, after the plan and before the commit** (read-only, over the
uncommitted migration). **No blocking finding.** It confirmed the placement CTE cannot silently drop or duplicate
an entry when no refusal fires (pins are distinct and in range, so free count = open-slot count), that every
refusal `RETURN` precedes the flip UPDATE, the tenant scoping and the restated grants, and that the new index is
non-partial and matches the page's ASC ordering. Its findings and their disposition — **all closed in this step,
none deferred:**
- **MEDIUM — race with `decide_plan_proposal`** (it does not lock the brief, so a proposal rejected between the
  placement computation and the flip would still shape the brief while `acceptedIds` omitted it). **Fixed:** the
  would-be-accepted proposal rows are locked `FOR UPDATE ORDER BY id` before anything is computed from them.
  **Proof:** new `supabase/__tests__/plan-proposals-apply-lock.test.ts:39` — a second connection rejects the
  proposal inside an open transaction, the apply must BLOCK (it cannot settle while the reject is uncommitted),
  and after the COMMIT it must answer `no_proposals_applied` and leave the brief untouched. **Reddening:** the
  function loaded WITHOUT the lock block → `AssertionError: expected 'ok' to be 'no_proposals_applied'` (the
  apply wrote the brief with a change the human had rejected — exactly the defect); restored, hash `4f7059cf…`
  identical, green.
- **LOW — latent partial commit** (a `RETURN concurrent_edit` after the flip would commit the flip without the
  brief write if the row lock were ever loosened). **Fixed:** it is now `RAISE EXCEPTION … ERRCODE '40001'`, which
  rolls the whole call back and keeps the "a refusal changes zero rows" contract. Unreachable while `FOR UPDATE`
  on the brief holds, so it has no test of its own.
- **LOW, inherited and unchanged — non-contiguous or duplicate stored `order` values** (matching is by the order
  VALUE as before; a duplicate would make a reorder pin two rows and read as `conflicting_reorders`, still a
  refusal, never silent corruption; a valid target absent from a non-contiguous array reads `stale_target_order`).
  Not changed: the shared schema (`RoleSequenceSchema`, Amendment E) already forbids duplicate `order`, and the
  apply re-derives `order` contiguously, so a stored sequence in this state predates that schema.
- **NIT — the partial review index is now a subset of the new one.** Kept, as the work order requires
  ("Keep the partial review index … exactly as they are").

**Wiring the new typed outcomes (needed so the exhaustive `switch` still type-checks):**
`ApplyBriefProposalsRpcResult` (`lib/db/campaign-plan-proposals.ts`) gains `not_critiqued`, `empty_sequence`,
`conflicting_reorders`, `invalid_reorder_target`; `applyPlanProposalsAction` (`brief/plan-actions.ts`) maps
`not_critiqued` → `invalid_brief_state`, `empty_sequence` → error `empty_sequence`, and the two reorder refusals →
`conflict` with the proposal named; `i18n/{en,pt,es}/agency.json` gain `conflict.conflicting_reorders`,
`conflict.invalid_reorder_target` and `error.empty_sequence` in all three locales (`lib/i18n/agency-parity.test.ts`
green). The action's own tests are D6's (MAJOR-2).

**Verification:** `tsc` clean; lint 0 errors (111 warnings, unchanged baseline; touched files clean); `test:app`
4873/4874 (the one failure is the known `corpus-v2-schema` flake); `test:db` **96 files, 806 tests, all green**
(includes every `plan-proposals-*.test.ts`, D4's tests, D1's grant test and the new lock test).
`supabase db reset --local` was DENIED by the auto-mode classifier as irreversible local destruction, so the
from-scratch proof used a safer equivalent: the ENTIRE migration file was executed inside a transaction that was
rolled back (the new index dropped inside it first so its `CREATE INDEX` could run) — `CREATE FUNCTION`, three
`REVOKE`/`GRANT`, `CREATE INDEX`, `ROLLBACK`, no error — and only the function body was then re-applied to the
live local database. CI applies the file to an empty database in `db-tests`.

- **Commit:** this commit (D5; SHA back-filled by D12's sweep).
- **What I did NOT touch:** the two partial indexes, the write-once trigger and the other RPC bodies are
  unchanged; no committed migration was edited; no existing test was changed (the `plan-proposals-ratify.test.ts`
  addition removes 0 lines; `plan-proposals-version-scope.test.ts` is untouched).
