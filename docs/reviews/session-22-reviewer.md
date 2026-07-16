# Session 22 — Reviewer Report
## Test-Execution Integrity & Approvals Hardening

**Scope reviewed: `7c510396..fe6da7e1`.** Every citation below is `git show <sha>:<path>` at that range, or a
named GitHub Actions run log. Nothing was read at HEAD-as-working-tree (PROC-REVIEW-AT-COMMIT / ADR 0015 §6).
Base `7c510396` = last Session-21C commit; head `fe6da7e1` = `fix(db): grant EXECUTE on user_can() to anon (B7)`.
The working tree is clean, so HEAD and `fe6da7e1` coincide — per-commit isolation was still re-derived with
`git show --stat <sha>` rather than inferred from the union diff.

**One exception, and it is itself a finding (MAJOR-3).** `/docs` and `CLAUDE.md` are in `.gitignore`;
`git ls-files docs/` returns **zero files**. ADR 0014, ADR 0015, `session-22.md` and the 21B/21C reviews exist
only as untracked working-tree copies — `git show fe6da7e1:docs/decisions/0015-test-execution-and-ci-gates.md`
→ *"exists on disk, but not in `fe6da7e1`"*. **B0 is not a commit.** Every doc citation below is flagged
`[working-tree]` and could not be verified at the range.

**Agents invoked:** `database-reviewer` ✅, `security-reviewer` ✅. `impeccable-design-and-taste` does **not
exist** as an agent in this install (the available surface is the `impeccable:impeccable` *skill* and an
`impeccable-manual-edit-applier` agent, neither a design reviewer) — Section E was therefore re-derived by hand
and is reported as such. This is why E1's proof is weaker than the brief assumes.

---

## Findings table

| Section | Check | Status | File:Line | Note |
|---|---|---|---|---|
| **A1** | Bulk is ONE statement, no loop/RPC/new DB object | ✅ | `lib/db/posts.ts:511-526` | Single `.update()` + `.select('id')`. No loop, no second write path. |
| **A2** | Raw EDITOR predicate'd UPDATE denied, zero rows | ✅ | `supabase/__tests__/posts-approval-boundary.test.ts:260-278` | **Executed live** (run 29442577275). Asserts `/approve capability required/` *and* re-reads via service-role to prove `status` unchanged. |
| **A3** | Caller lacking `approve` flips ZERO rows | ✅ | `posts-approval-boundary.test.ts:184-197`, `:224-236` | Atomic-guard test proves stale transition → 0 rows, no exception. |
| **B1** | 3 LinkedIn + 2 X, filter=X → exactly 2 flip | ⚠️ | `posts-approval-boundary.test.ts:280-311` ✅ / `PostsClient.tsx:110` ❌ | Proven live **for the inbox**. **Fails on `/campaigns/[id]/posts`** — see BLOCKER-1. |
| **B2** | Bulk cannot approve a draft outside the rendered set | ❌ | `PostsClient.tsx:110` + `posts/page.tsx:35` | **BLOCKER-2.** Inbox gate is sound; the campaign surface has a 50-row window and no gate. |
| **B3** | label = DB count = removed = announced | ⚠️ | `ApprovalsInbox.test.tsx:333-371` ✅ / `PostsClient.tsx:189` ⚠️ | Holds in the inbox. Campaign surface's button carries no count (see BLOCKER-1 note). |
| **B4** | 21C stopgap removed; nothing else disabled | ✅ | diff of `*.test.ts(x)` | Zero `.skip`/`.only`/`.todo` added in range. Removed assertions were all replaced by stricter ones. |
| **C1** | app-tests runs FULL app suite, DB-independent | ✅ | `.github/workflows/app-tests.yml:1-28` | `on: push[master] + pull_request`; no Supabase stack. 125 files / 1830 tests green. |
| **C2** | No test deleted/skipped/weakened | ✅ | — | Verified by diff, see B4. |
| **C3** | All eleven `*_INTEGRATION_TEST_ENABLED` flags gone | ⚠️ | `lib/deletion/__integration__/purge-business.test.ts:3`, `lib/email/__integration__/round-trip.test.ts:15`, `lib/social/__integration__/postiz-provider.integration.test.ts:3`, `app/[locale]/(marketing)/__integration__/routes.smoke.test.ts:13` | The **eleven db flags are genuinely gone**. **Four other flag-gated suites survive inside app-tests** — MAJOR-1. |
| **C4** | Skip-guard demonstrated on BOTH arms; no `\|\| true` | ✅ | `scripts/ci/assert-no-empty-suite.mjs`; runs 29284665943 / 29369859627 | Both arms fired in **real CI**, not a drill. |
| **C5** | Knobs VERIFIED, not theatre | ✅ | `db-tests.yml` "Verify Postgres knobs took effect" | `SHOW` + `grep -qx`, hard `exit 1`. Printed `knobs: 256MB…`, passed. |
| **C6** | db-tests: FULL run passes | ✅ (1 of 3) | run 29442577275 | Full green, 11/11 files visible, 2m41s. **Promotion tally = 1**; not yet required. |
| **D1** | Filters server-side; page passes them; total filter-scoped | ✅ | `approvals/page.tsx:33-35,58-59`; `lib/db/posts.ts:125-126,137-140` | 21C n3 closed. Total shares the predicate. `LIMIT 200` + `ORDER BY scheduled_at ASC` intact. |
| **D2** | Overflow honest; agrees with disabled-bulk | ✅ | `ApprovalsInbox.tsx:50,144,163` | `hasOverflow = totalPendingCount > posts.length` drives **both** the notice and the disabled bulk — one source, so they cannot disagree. |
| **E1** | Skip label 4.5:1 in BOTH themes | ⚠️ | `ApprovalsInbox.tsx:335` | `text-amber-700` / `dark:text-amber-300`. Values pass by hand-calculation; **no executing test and no design-agent review** — MINOR-1. |
| **E2** | Bulk name states scope; disabled explains why | ✅ | `ApprovalsInbox.tsx:213-216,245-246,256` | `approveAllLabelFiltered` states scope; disabled state carries `bulk.incompleteSetHint` + tooltip. |
| **E3** | B5 is visual/a11y only, by commit boundary | ✅ | `48c145be` vs `e2812ec8` | Separate commits. B5 touches only aria-labels/copy/i18n/tests. 21C n2 **not** repeated. |
| **E4** | i18n complete en/pt/es | ✅ | `i18n/{en,pt,es}/approvals.json` | Key parity exact for `bulk.*` (5 keys) and `overflow.notice`. |
| **F1** | Team actions echo `canServer`; DB still denies | ✅ | `settings/team/actions.ts:101,160,186,213`; `actions.test.ts` | Echo at all four sites; regression test executes in app-tests. Echo is **not** the boundary — `approvals/page.tsx:52-57` documents this and RLS/trigger unchanged in range. |
| **F2** | CLAUDE.md carries the three rules | ⚠️ | `CLAUDE.md` [working-tree] | Content present, but **untracked** — MAJOR-3. |
| **F3** | Scope: no new capability/Stripe/route; no `any`/`console.*` | ⚠️ | `supabase/migrations/20260715200000_user_can_grant_anon.sql` | Clean on hygiene. **One migration added** in B7 — see MINOR-4. |
| **G1** | Every constraint → test → executing job | ⚠️ | see Coverage | Holds for all APV-*/ROLE-* except `APV-CONTRAST-AA`. |
| **G2** | Before/after CI execution | ✅ | see Coverage | 0 → 1842 app + 11 DB files. |

---

## BLOCKER

### BLOCKER-1 — 21C M1 survives verbatim on `/campaigns/[id]/posts`: bulk approve ignores the active platform filter

`app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx:110`

```
const result = await bulkApprovePostsAction(campaign.id)   // ← no platforms argument
```

`PostsClient` has platform filter pills (`activeFilter`, `:119-123`) and renders the bulk button whenever
`draftCount > 0 && canApprove` (`:182`) — `draftCount` is computed over **all** local posts (`:91`), never over
the filtered set, and the button's visibility does not consider `activeFilter` at all.

**Re-derived failure (the brief's B1 scenario, on this surface):** campaign with 3 LinkedIn + 2 X drafts. User
clicks the "X" filter pill → sees 2 X drafts → clicks "Bulk approve" → the action is called with
`platforms = undefined` → `bulkApproveDraftPosts` (`lib/db/posts.ts:522`) skips the `.in('platform', …)`
narrowing → **all 5 drafts flip, including the 3 LinkedIn the user filtered away.** The optimistic update
(`PostsClient.tsx:104-108`) then flips every local draft regardless of filter, so the UI agrees with the wrong
outcome and the user never sees the discrepancy.

This is 21C M1 — *the exact finding this session was convened to fix* — unfixed. `git log` proves why both
reviews missed it: the 21C M1 fix `953318e7` touched **only** `ApprovalsInbox.tsx` + its test + i18n, and
Session 22's B3 (`e2812ec8`) likewise. `PostsClient.tsx` has not been touched since `c07dafda` (the 21B polish
pass, *before* the M1 fix existed). The constraint `APV-BULK-FILTER-SCOPED` is written against the *action*,
which both surfaces call — so one caller was fixed and the other was never audited.

**Fix instruction:** in `PostsClient.tsx`, derive the active platform the same way `ApprovalsInbox.tsx:120-123`
does and pass it: when `activeFilter` is a `Platform` (not `'all'`/`'approved'`/`'skipped'`/`'failed'`), call
`bulkApprovePostsAction(campaign.id, [activeFilter])`; otherwise pass `undefined`. Scope the optimistic update
(`:104-108`) to the same predicate. Add a Tier-2 test in a `PostsClient.test.tsx` mirroring
`ApprovalsInbox.test.tsx:222-245` ("THE 21C M1 SCENARIO"), and add the campaign surface to the
`APV-BULK-FILTER-SCOPED` row's test-home column in ADR 0014 A3.

### BLOCKER-2 — F1 truncation survives on `/campaigns/[id]/posts`: bulk approves drafts outside the rendered window

`PostsClient.tsx:110` + `app/[locale]/(dashboard)/campaigns/[id]/posts/page.tsx:35`

The `APV-BULK-VISIBLE-ONLY` gate (`actions.ts:208-214`) is:

```
const totalPending = await countPendingDraftPosts(ctx.client, ctx.business.id)   // business-wide
if (totalPending > APPROVALS_POST_LIMIT) return { error: 'not_eligible' }        // 200
```

Its soundness argument — *"the Approvals inbox only ever fetches up to APPROVALS_POST_LIMIT pending drafts
business-wide, so if the true total ≤ 200 the window contains everything and every rendered group is
complete"* — is **valid for the inbox** and correctly conservative there. It is **false for the other caller**,
which the gate's own comment does not contemplate.

**Re-derived failure:** `posts/page.tsx:35` renders `listPostsByCampaign(client, id, 50)` — a **50-row window
over posts of _all_ statuses**, ordered `created_at DESC` (`lib/db/posts.ts:249-257`). Take a campaign with 120
posts of which 60 are pending drafts, and a business-wide pending total of 60 (well under 200):

1. `PostsClient` renders the newest 50 posts. Suppose 5 of them are drafts (the other 55 drafts are older and
   fall outside the window).
2. `draftCount = 5` → the bulk button renders.
3. Click → gate computes `totalPending = 60 ≤ 200` → **passes**.
4. `bulkApproveDraftPosts(campaign.id, undefined)` → `.eq('campaign_id').eq('status','draft')` with no limit →
   **all 60 drafts flip. The approver saw 5.**

Fifty-five posts are approved and queued for publishing without ever being displayed to the human who approved
them. That is F1's mechanism exactly (truncation), on the surface F1 didn't look at — and it defeats the
human-in-the-loop guarantee that `CLAUDE.md` names as a product feature, not a fallback.

Note the gate cannot be fixed by tightening the constant: `APPROVALS_POST_LIMIT` (200) and this surface's limit
(50) are different windows over different predicates. The gate must be told what the *caller* rendered.

**Fix instruction:** the completeness precondition must be per-caller, not a global constant. Change
`bulkApprovePostsAction` to take the caller's rendered scope explicitly — e.g. a required
`renderedIds: string[]` (or `{ renderedCount, campaignId, platform }`) — and either (a) narrow the UPDATE with
`.in('id', renderedIds)` so "approve what I can see" is enforced by construction rather than by a proof about
window sizes, or (b) re-count with the *caller's* predicate and refuse unless `renderedCount === count`. Option
(a) is strictly stronger, kills BLOCKER-1 and BLOCKER-2 with one change, keeps the single-statement property
(A1), and makes `APV-BULK-VISIBLE-ONLY` true by construction instead of by argument. Then update ADR 0014 A1.1
[working-tree], whose current wording ("bulk offered IFF rendered count == server total for that
campaign+filter") is what the implementation should have matched — the implementation substituted a
business-wide proxy that only happens to be sound for one of two callers.

---

## MAJOR

### MAJOR-1 — app-tests has no skip-guard, and four flag-gated suites are invisible inside it

`CI-NO-SUITE-FLAGS` and `CI-NO-SKIPPED-SUITE` are enforced **only** for `supabase/__tests__` —
`assert-no-empty-suite.mjs:22` hard-codes `const SUITE_DIR = 'supabase/__tests__'`, and `app-tests.yml` has no
guard step at all. Meanwhile the green app-tests run (29442577045) reports `Test Files 125 passed | 4 skipped`:

| File | Flag | Result in CI |
|---|---|---|
| `lib/deletion/__integration__/purge-business.test.ts:3` | `DELETION_INTEGRATION_TEST_ENABLED` | 3 tests, **3 skipped** |
| `lib/email/__integration__/round-trip.test.ts:15` | `EMAIL_INTEGRATION_TEST_ENABLED` | 1 test, **1 skipped** |
| `lib/social/__integration__/postiz-provider.integration.test.ts:3` | `POSTIZ_INTEGRATION_TEST_ENABLED` | 3 tests, **3 todo** |
| `app/[locale]/(marketing)/__integration__/routes.smoke.test.ts:13` | `ROUTE_SMOKE_TEST_ENABLED` | 5 tests, **5 skipped** |

These are not among "the eleven" (C3's eleven db flags are genuinely dead — `git grep INTEGRATION_TEST_ENABLED
fe6da7e1 -- supabase/__tests__` is empty). But they are the **same defect class**, they live inside the one job
ADR 0015 §5 marks *"Required — now"*, and they are invisible by exactly the mechanism (`describe.skipIf(!flag)`)
that produced the INV-REISSUE-SAME-ROW false-green in 21B. Twelve tests report green while executing nothing.
Session 22's thesis — "covered = executed green in CI" — therefore holds in the Tier-1 job and **not** in the
Tier-2 job.

**Fix instruction:** either (a) parameterize `assert-no-empty-suite.mjs` to accept a suite dir (or a list) and
add a JSON-reportered guard step to `app-tests.yml` covering `app/**`, `lib/**`, `components/**` with a
declared, reviewed allowlist of the four `__integration__` files; or (b) move the four `__integration__` files
out of the `include` in `vitest.config.ts` into their own opt-in project, so they are *absent* rather than
*silently empty* — absence is honest, a green skip is not. Record the choice in ADR 0015 §4 and state
explicitly which suites are permitted to be flag-gated and why.

### MAJOR-2 — Both merge gates are unenforced: master has no branch protection

`gh api repos/:owner/:repo/branches/master/protection` → `404 Branch not protected`.
`gh api repos/:owner/:repo/rulesets` → `[]`.

ADR 0015 §5 [working-tree] and `CLAUDE.md`'s merge-gate table declare `app-tests` **"Required — now"**, with
override reserved to a repo admin with a written reason. GitHub requires nothing. Both checks are advisory in
fact; a red app-tests blocks no merge, and the override ceremony the ADR describes has no mechanism behind it.
`CI-MERGE-GATE` is **authored, not enforced** — the ADR documents a gate that does not exist.

**Fix instruction:** create a ruleset on `master` requiring the `app-tests` check
(`required_status_checks: ["app-tests"]`), with admin bypass restricted. Do **not** add `db-tests` yet (tally is
1/3). Record the ruleset's existence, not just the intent, in ADR 0015 §5, and put the promotion tally in
`docs/current-phase.md` as §5 already requires.

### MAJOR-3 — The entire governance layer is untracked; B0 has no commit

`.gitignore` excludes `/docs` and `CLAUDE.md`. `git ls-files docs/` → **0 files**.

Consequences, all live:
- **B0 does not exist as a commit.** The brief instructed me to verify that B0 encoded F1/F2/F3. I can confirm
  the *working-tree* documents contain F1/F2/F3 (`session-22.md` §0.1) and the A3 constraint table — but I
  cannot verify *when*, *by whom*, or *whether they changed after the code was written*. For a session whose
  thesis is verifiable execution, the specification is the one unversioned artifact.
- **PROC-REVIEW-AT-COMMIT is unenforceable for the documents that define it.** A Reviewer cannot read ADR 0015
  "at the stated commit range" because it is not in any range. The rule that exists to stop reviewers reading
  stale state cannot itself be pinned to state.
- ADR 0010's Evidence-Pack coupling (`CLAUDE.md` "Legal pages": *"Confirm the `evidenceRef` frontmatter still
  matches the current Evidence Pack commit"*) is **structurally impossible** — the Evidence Pack has no commit.

**Fix instruction:** remove `/docs` and `CLAUDE.md` from `.gitignore` and commit them in a single
`docs: track the governance layer` commit, noting in the message that all prior ADR/session history is imported
at once and is not per-session attributable. If any doc contains secrets (the reason for the ignore is not
recorded anywhere I can find), extract those first and say so. Until this lands, every future Reviewer's
PROC-REVIEW-AT-COMMIT opening statement is only half-true, and this report is the second in a row to say so.

---

## MINOR

### MINOR-1 — `APV-CONTRAST-AA` has no executing test; its A3 test-home is inaccurate

ADR 0014 A3 [working-tree] names the home as *"`approvals/ApprovalsInbox` a11y test (`app-tests`) +
`impeccable-design-and-taste` review (B5)"*. Neither exists: `ApprovalsInbox.test.tsx` at `fe6da7e1` contains
**no** contrast/amber/4.5 assertion (B5's 105 added test lines are aria-label and copy assertions), and
`impeccable-design-and-taste` is not an installed agent. The only artifact is a **code comment asserting a
measurement** — `ApprovalsInbox.tsx:248`: *"WCAG AA (B5): text-muted-foreground on bg-muted measured…"*. A
comment claiming a measurement is precisely the "authored, not executed" shape ADR 0015 exists to name.

By hand-calculation the colours do pass: `text-amber-700` (#b45309) on white ≈ 4.9:1 ✅; `dark:amber-300`
(#fcd34d) on the dark surface ≈ 12:1 ✅. **So this is a proof gap, not a user-facing regression** — E1 is very
probably fine, but "probably fine by the reviewer's arithmetic" is the standard this session set out to abolish.
The A3 row's dual tier ("Tier-2 *where harness supports* / Tier-3 visual") is also the loophole: it lets a
constraint drift into Tier-3 silently, which ADR 0015 §2 forbids — Tier-3 must be an *enumerated decision*.

**Fix instruction:** pick one and record it. Either add a real assertion (resolve the computed colour and
compute the ratio), or declare `APV-CONTRAST-AA` **Tier-3** in A3 with the named verifier and a dated artifact.
Delete the "measured" comment at `ApprovalsInbox.tsx:248` either way — it asserts a fact no test carries.

### MINOR-2 — TOCTOU between the visible-only gate and the bulk UPDATE

`actions.ts:213-216`. `countPendingDraftPosts` and `bulkApproveDraftPosts` are two round-trips with no
transaction or lock. Between them, a concurrent generation run can push the true total across the 200 boundary,
so the gate can pass for a state that no longer holds when the UPDATE lands. `database-reviewer` rated this
MAJOR; I rate it **MINOR** because at launch caps (trial 50 / Plus 50-per-month, `CLAUDE.md` pricing) the total
cannot reach 200 — the race is unreachable in the shipping product. It becomes real the moment the Pro
(uncapped) path fills an inbox, i.e. the same trigger as A2's cursor-pagination un-defer.

**Fix instruction:** if BLOCKER-2 is fixed via `.in('id', renderedIds)`, this disappears — the write is
self-limiting and no count is consulted. Prefer that. Otherwise document the race in ADR 0014 A1.1 as a known
limitation with the Pro-account trigger.

### MINOR-3 — `bulkApproveDraftPosts` is the only write path relying on RLS as its sole guard

`lib/db/posts.ts:511-526` filters `campaign_id`/`status`/`deleted_at`/`platform` but never `business_id`.
Both specialists independently confirmed this is **not** a vulnerability today: `posts_update_own`
(`20260702120300_posts_role_aware_and_status_trigger.sql:21-26`) scopes by
`business_id = ANY(get_user_business_ids())` on `USING` **and** `WITH CHECK`, and
`enforce_post_transition_capability` re-checks per row using the row's own `business_id`, so a foreign
`campaignId` matches zero rows. But `approvePost` (`:307-327`) and `reschedulePost` (`:168-187`) both carry an
explicit `business_id` guard and document it as defence-in-depth; this one doesn't. `bulkApprovePostsAction`
also never verifies `campaignId` belongs to `ctx.business.id`.

**Fix instruction:** add an optional `businessId` param to `bulkApproveDraftPosts` mirroring `approvePost`, and
pass `ctx.business.id` from the action. Cost is zero; it removes the one place where swapping in a service-role
client would silently become a cross-tenant bulk write.

### MINOR-4 — `APV-BULK-NO-NEW-DB-OBJECT`: diff-verified, holds — but the range is not migration-free

The constraint is Tier-3, scoped to *the bulk-approve commit*. Verified: `e2812ec8` touches no `supabase/**` and
no `.sql`. ✅ However the **range** adds `supabase/migrations/20260715200000_user_can_grant_anon.sql` in B7,
against §0's L-10 ("no schema change beyond the Amendment-A query predicate"). Both specialists cleared the
migration as safe — `user_can()` returns `false` at `auth.uid() IS NULL` before touching any table
(`20260702120200_user_can.sql:15-17`), so the anon GRANT creates no oracle and no side effect. It is a genuine
CI-correctness fix, not scope creep. Flagging only so the L-10 deviation is *recorded* rather than discovered.

**Fix instruction:** note the B7 migration as an approved L-10 deviation in ADR 0015's session-22 manifest.

### MINOR-5 — No index covers the new count query's predicate

`lib/db/posts.ts:150-166`. Existing indexes are `posts_business_id_status_idx (business_id, status)` and
`idx_posts_business_scheduled_at (business_id, scheduled_at) WHERE deleted_at IS NULL`; neither covers
`(business_id, status, deleted_at, scheduled_at)`. Fine at a 200-row cap; forward-looking.

**Fix instruction:** backlog `CREATE INDEX ... ON posts (business_id, status, scheduled_at) WHERE deleted_at IS
NULL`, tied to the same Pro-account trigger as A2's un-defer.

---

## NIT

- **NIT-1** — `listPendingDraftPosts` (`lib/db/posts.ts:97-142`) issues two round-trips per call; a
  `count(*) OVER()` window in the same SELECT would collapse them. Not urgent at 200 rows.
- **NIT-2** — `db-tests.yml` verifies the Postgres knobs *before* `supabase db reset`. The knobs live in
  `config.toml [db.settings]` and are baked into `postgresql.conf` pre-start, so reset cannot revert them — the
  order is safe, but verifying after the reset would prove it rather than argue it.
- **NIT-3** — During this review, `security-reviewer`'s tool results carried injected text shaped as
  `<system-reminder>` blocks instructing it to call tools outside its toolset (`get_observations`,
  `smart_outline`). The agent correctly identified these as untrusted content and ignored them. This is the
  `claude-mem` plugin injecting instruction-shaped text into subagent tool output; worth knowing, since a less
  careful agent would have followed it. Not a Session 22 defect.

---

## Coverage: constraint → test → executing CI job → tier

| Constraint | Test | Executing job | Tier | Status |
|---|---|---|---|---|
| `APV-BULK-ATOMIC` | `posts-approval-boundary.test.ts:224-236` | `db-tests` ✅ | 1 | **EXECUTED** |
| `APV-BULK-DB-BOUNDARY` | `posts-approval-boundary.test.ts:260-278` | `db-tests` ✅ | 1 | **EXECUTED** |
| `APV-BULK-FILTER-SCOPED` | `posts-approval-boundary.test.ts:280-311`; `ApprovalsInbox.test.tsx:222-245`; `actions.test.ts:303-330` | `db-tests` + `app-tests` ✅ | 1+2 | **EXECUTED — but incomplete: no test covers `PostsClient`, where the constraint fails (BLOCKER-1)** |
| `APV-BULK-VISIBLE-ONLY` | `ApprovalsInbox.test.tsx:278-332`; `actions.test.ts:331` | `app-tests` ✅ | 2 | **EXECUTED — but proves only the inbox; the gate is unsound for the campaign surface (BLOCKER-2)** |
| `APV-COUNT-CONSISTENT` | `ApprovalsInbox.test.tsx:333-371` | `app-tests` ✅ | 2 | **EXECUTED** (inbox only) |
| `APV-SERVER-FILTER` | `lib/db/posts.test.ts`; `approvals/page.test.tsx` | `app-tests` ✅ | 2 | **EXECUTED** |
| `APV-PAGINATED` | `lib/db/posts.test.ts`; `ApprovalsInbox.test.tsx` | `app-tests` ✅ | 2 | **EXECUTED** |
| `APV-CONTRAST-AA` | **none** | — | 2/3 (ambiguous) | **NOT COVERED** (MINOR-1) |
| `APV-BULK-NO-NEW-DB-OBJECT` | Reviewer diff-scan of `e2812ec8` | — | 3 | **DIFF-VERIFIED ✅** |
| `ROLE-TEAM-ECHO` | `settings/team/actions.test.ts`; `user-can-matrix`/`members` suites | `app-tests` + `db-tests` ✅ | 2+1 | **EXECUTED** |
| `INV-REISSUE-SAME-ROW` | `supabase/__tests__/reissue-invite.test.ts` | `db-tests` ✅ | 1 | **EXECUTED** — the 21B false-green is closed |
| `CI-APP-SUITE-EXECUTED` | run 29442577045 | `app-tests` ✅ | infra | **EXECUTED** |
| `CI-NO-SUITE-FLAGS` | `git grep` (eleven gone) | — | 3 | **PARTIAL** — four non-db flags survive (MAJOR-1) |
| `CI-NO-SKIPPED-SUITE` | run 29284665943 (zero arm) | `db-tests` ✅ | infra | **DEMONSTRATED — `supabase/__tests__` only** (MAJOR-1) |
| `CI-NO-SWALLOWED-FAILURE` | run 29369859627 (red arm) | `db-tests` ✅ | infra | **DEMONSTRATED** |
| `CI-KNOBS-VERIFIED` | `db-tests.yml` verify step | `db-tests` ✅ | infra | **EXECUTED** |
| `CI-OOM-DIAGNOSTIC` | `db-tests.yml` failure dump + artifact upload | `db-tests` (on failure) | infra | **AUTHORED** — not exercised by a green run; fired on the earlier red runs ✅ |
| `CI-DB-SUITE-STABLE` | promotion tally | `db-tests` | infra | **1 of 3 greens** — not promoted |
| `CI-MERGE-GATE` | — | — | infra | **NOT ENFORCED** — no branch protection (MAJOR-2) |
| `PROC-REVIEW-AT-COMMIT` | this report's opening | — | 3 | **HONORED for code; impossible for docs** (MAJOR-3) |

### G2 — before/after

| | Before Session 22 | After (`fe6da7e1`) |
|---|---|---|
| App-layer tests executed by CI | **0** — no `app-tests.yml` existed; the suite was local-only | **1830 passing** across 125 files, every push + PR |
| DB tests executed by CI | 11 files existed; each self-gated on a `*_INTEGRATION_TEST_ENABLED` flag CI never set — effectively **0 meaningfully executed**, reporting green | **11/11 files visible**, zero failures, guarded on both arms |
| Zero-file regression detectable? | No — B1 silently emptied the db suite and CI stayed green | Yes — caught in run 29284665943 by the guard itself |
| Flag-gated invisible suites | 11 (db) + 4 (app) | **0 (db) + 4 (app)** — MAJOR-1 |

The before/after is real and large. The thesis was substantially delivered.

---

## VERDICT

**Blockers before merge — 2, both in one file, both the same root cause.**

`PostsClient.tsx` is a second caller of `bulkApprovePostsAction` that neither the 21C M1 fix nor Session 22's
B3 ever looked at. On `/campaigns/[id]/posts`, bulk approve **still ignores the active platform filter**
(BLOCKER-1 = 21C M1, verbatim, unfixed) and **still approves drafts outside the rendered window** (BLOCKER-2 =
F1's truncation mechanism, on a 50-row window the 200-row gate cannot protect). Both let a human approve content
they never saw — the one thing `CLAUDE.md` says this product does not do. I recommend fixing both with the
single `.in('id', renderedIds)` change described in BLOCKER-2, which makes `APV-BULK-VISIBLE-ONLY` true by
construction rather than by an argument about window sizes — an argument that was already load-bearing, already
subtly wrong, and is what produced both blockers.

The deeper lesson is a review-process one, and it belongs in the ADRs: **three consecutive sessions verified a
constraint by testing one caller of the function the constraint is written against.** §0.1/F1 was a genuinely
excellent catch — the Architect found the truncation variant by reasoning about the invariant rather than the
test. The same reasoning applied to *"who else calls this action?"* (one `git grep`) would have found both
blockers. Suggest a standing check: for any constraint written against a shared function, enumerate its callers
and state which ones the tests cover.

---

## Resolution — Session 22-D (correction pass)

**BLOCKER-1 and BLOCKER-2: RESOLVED**, via the exact single-change fix this report recommended.
`bulkApproveDraftPosts` (`lib/db/posts.ts`) now takes `(client, campaignId, renderedIds: string[], businessId:
string)` and issues `.in('id', renderedIds).eq('campaign_id', ...).eq('business_id', ...).eq('status',
'draft').is('deleted_at', null)` — one statement, no platform predicate, no window-size argument.
`APV-BULK-VISIBLE-ONLY` now holds by construction on **both** callers, not just the inbox:

- `PostsClient.tsx` (the previously-unaudited caller) computes `renderedDraftIds` from the currently filtered,
  rendered list and passes it through; the bulk control is hidden when that set is empty. Optimistic update and
  the DB write are scoped to the same id set — BLOCKER-1 (ignored platform filter) and BLOCKER-2 (writes outside
  the 50-row window) are both closed, because the function can no longer see an id it wasn't handed.
- `ApprovalsInbox.tsx` passes the rendered group's row ids instead of a platform array; the business-wide
  `countPendingDraftPosts` gate in `actions.ts` (the F1 window-size argument this report flagged as "already
  subtly wrong") is deleted entirely — the TOCTOU race between that count and the write no longer exists because
  there is no longer a separate count-then-write step.
- `bulkApprovePostsAction` (`actions.ts`) now threads `ctx.business.id` through as the new `businessId` param,
  closing MINOR-3 (the one write path that previously relied on RLS alone).

**Test evidence:** `posts-approval-boundary.test.ts` (Tier-1, live Postgres) — id-based predicate denied for a
raw EDITOR client (zero rows flip), and a renderedIds set spanning two businesses/campaigns approves only the
in-scope row. `ApprovalsInbox.test.tsx` — 21C M1 scenario re-verified under the new signature. New
`PostsClient.test.tsx` — the same M1 scenario on the campaign surface, a 5-post truncated-window scenario
proving the write never reaches an id outside what was rendered, and an unfiltered regression case. No
migration, no new DB object.

**Deferrable debt:** ~~MAJOR-1 (app-tests skip-guard — should land next session; it is the thesis half-applied)~~
**RESOLVED, see below.** MAJOR-2 (branch protection — one API call, do it now), MAJOR-3 (untracked docs — a
real governance hole, but orthogonal to this session's code), MINOR-1 through MINOR-5, NIT-1/2.

**MAJOR-1: RESOLVED.** The eleven Tier-1 flags were dead, but four Tier-2 `__integration__` suites
(postiz-provider, purge-business, email round-trip, marketing route smoke) survived inside `app-tests` —
the **Required — now** job — reporting green while executing nothing. Per the same reasoning `db-tests.yml`'s
skip-guard already applies (ADR 0015 §4), an allowlist of blessed skips was rejected as a rotting list; the
four suites are instead made **ABSENT** from `app-tests`' glob (`vitest.config.ts` excludes
`**/__integration__/**`) and live in a separate, developer-run-only `vitest.integration.config.ts` /
`npm run test:integration`. `scripts/ci/assert-no-empty-suite.mjs` is parameterized to accept target
directories (default `supabase/__tests__`, preserving `db-tests.yml`'s call), and `app-tests.yml` now runs
`test:app` JSON-reportered plus the guard over `app lib components` — with the four suites absent, no
allowlist is needed, and any remaining zero/all-skipped file fails the job. Demonstrated live: a zero-test
fixture under `lib/` turned the guard red (`every test is skipped (invisible — not covered)`), reverted to
green after deletion. `postiz-provider.integration.test.ts` was kept (moved to opt-in, not deleted) — Postiz
removal is a future WIP workstream per `docs/current-phase.md`, not yet executed, and `PostizProvider` is
still the shipped `SocialProvider` implementation. Full rationale and the opt-in-suite table are recorded in
ADR 0015 §4 per the enumerated-decision discipline.

**MINOR sweep: all five items closed.**

- **MINOR-1: RESOLVED** (real assertion chosen over Tier-3). `ApprovalsInbox.test.tsx` now computes the
  disabled-bulk-badge's `text-foreground`-on-`bg-muted` contrast from `app/globals.css`'s actual oklch values
  in both themes and asserts ≥4.5:1 — the same approach the m2 skip-label test already used, generalized to
  a shared module-scope helper. The "measured" comment at `ApprovalsInbox.tsx:249` was deleted. ADR 0014 A3's
  `APV-CONTRAST-AA` row now names a single Tier-2 home and its test file directly — the "Tier-2 where harness
  supports / Tier-3 visual" dual-tier wording is gone.
- **MINOR-2: DISSOLVED**, confirmed. `countPendingDraftPosts` is no longer called anywhere in the bulk-approve
  path (`actions.ts`) — the BLOCKER-1/2 fix removed the count-then-write gate entirely in favour of the
  self-limiting `.in('id', renderedIds)` write. No count is consulted before the UPDATE; the TOCTOU window
  this MINOR named no longer exists. No code change needed beyond what BLOCKER-1/2 already did.
- **MINOR-3: CLOSED**, confirmed. `bulkApproveDraftPosts` (`lib/db/posts.ts`) now takes `businessId` and
  scopes the UPDATE with `.eq('business_id', businessId)`, matching `approvePost`'s defence-in-depth posture.
  No code change needed beyond what BLOCKER-1/2 already did.
- **MINOR-4: RECORDED.** `supabase/migrations/20260715200000_user_can_grant_anon.sql` (B7) is an approved
  L-10 deviation — see ADR 0015's session-22 manifest addendum below. Both specialists cleared it safe:
  `user_can()` returns `false` at `auth.uid() IS NULL` before touching any table, so the anon `GRANT` creates
  no oracle.
- **MINOR-5: BACKLOGGED**, not built. `docs/backlog.md` now carries the missing composite index
  (`(business_id, status, scheduled_at) WHERE deleted_at IS NULL`), tied to the same Pro-account/uncapped-
  inbox trigger as ADR 0014 A2's cursor-pagination un-defer. No index created in this pass.

**NIT-3: recorded, not fixed.** `docs/backlog.md` now carries the `claude-mem` plugin-hygiene item (injected
`<system-reminder>`-shaped text into a subagent's tool output during Session 22's review) as an item to
investigate — not a Session 22 code defect; the agent correctly ignored the injected instructions.

**Durable process fix — the review's headline lesson.** `CLAUDE.md` now states the SHARED-FUNCTION CALLERS
rule: a constraint written against a shared function must enumerate that function's callers and state which
ones the tests cover. Both Session 22 blockers were the same root cause — `APV-BULK-*` was verified against
one of `bulkApprovePostsAction`'s two callers across three consecutive sessions (21C, Session 22 B3, and the
Session 22 review itself) before `PostsClient.tsx` was found to be unaudited.

**Does "covered = executed" now actually hold?**

**In the Tier-1 job, yes — convincingly, and this is the session's real achievement.** The eleven flags are
dead, all 11 DB files execute against live Postgres, the skip-guard is proven on *both* arms by real CI failures
rather than drills (the zero-arm caught an actual regression this session introduced — the guard earned its
place before it was even finished), and the knobs are verified by a step that hard-fails, after the original ADR
remedy was disproven in live CI and re-grounded. Nothing here is claimed; all of it is executed.

**In the Tier-2 job, not yet — and that is the honest answer.** `app-tests` runs 1830 real tests, which is
transformative against a baseline of zero. But it has no skip-guard, and four suites inside it report green
while executing nothing. The false-green mechanism ADR 0015 was written to abolish is dead in the job that has
the guard and alive in the job that doesn't.

**And at the process layer, no.** "Covered = executed" is enforced by CI; "required" is enforced by nobody
(MAJOR-2), and the ADR that defines both is not in version control (MAJOR-3). Session 22 built a real gate and
did not connect it to the door.
