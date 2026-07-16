# Session 22-D — Reviewer Report (delta)
## Approvals Hardening & Test-Execution Integrity — auditing the correction pass

**Scope reviewed: `fe6da7e1..462e49eb`** (4 commits: `eaa7e0f7`, `33232cc1`, `1b8edfbc`, `462e49eb`).
Every citation below is `git show 462e49eb:<path>` / `git diff fe6da7e1..462e49eb -- <path>` at that range, or
a named GitHub Actions run log. Nothing was read at HEAD (PROC-REVIEW-AT-COMMIT, ADR 0015 §6). Base
`fe6da7e1` = last Session-22 commit reviewed by `session-22-reviewer.md`; head `462e49eb` = "docs: track the
governance layer". **Agents invoked:** `database-reviewer` ✅, `security-reviewer` ✅ — both instructed to read
at the range; both confirmed they did.

---

## ⚠️ INDEPENDENCE DISCLOSURE — read before trusting any verdict below

**This report is not an independent review and must not be filed as one.**

The reviewer that produced it (a) reviewed 22-D earlier in the same session, (b) was then instructed by the
founder to fix its own findings, and (c) authored four **Session 22-E** commits on top of this range
(`5f9a89b0`, `578255c3`, `fa8b4bdf`, `98a9f7c7`, pushed to PR #1) before writing this document. It is a
reviewer auditing corrections he partly wrote.

This is the exact anti-pattern the report itself flags as **NEW-4** — the finding record and the fix record
sharing an author. It is recorded here rather than hidden, because a review whose independence is compromised
and *says so* is recoverable; one that doesn't is not.

**Consequence:** the ✅ marks below are evidence-backed and re-derivable from the citations, but they have had
no adversarial second pair of eyes. **An independent 22-F pass should re-audit `462e49eb..98a9f7c7` (the 22-E
commits) at minimum.** Where this report corrects an error of its own earlier pass, that is marked inline —
see *Corrections*, MINOR-5.

**Also note:** 22-E changes some of the answers below (the cap; the Tier-1 test calling the real function; the
contrast test parsing `globals.css`). Every finding here is stated **at the 22-D range**, i.e. as if 22-E did
not exist. Where 22-E already closes a finding, that is a forward-reference and does **not** upgrade the 22-D
verdict.

---

## Status table

| Finding (from `session-22-reviewer.md`) | Verdict | Evidence at the range |
|---|---|---|
| **BLOCKER-1** — bulk ignores the platform filter on `/campaigns/[id]/posts` | ✅ **closed** | `PostsClient.tsx:100-112` (`filtered` → `renderedDraftIds`), `:127` passes them; `PostsClient.test.tsx:110` re-derives the M1 scenario |
| **BLOCKER-2** — bulk approves drafts outside the rendered window | ✅ **closed** | `lib/db/posts.ts:519-527` `.in('id', renderedIds)`; `PostsClient.tsx:98-101` (`idSet` gate); `PostsClient.test.tsx:132` |
| **MAJOR-1** — no skip-guard in `app-tests`; four flag-gated suites invisible | ✅ **closed, EXECUTED** | `app-tests.yml:30-40`; run **29488958422** → `skip-guard: 126 file(s) under [app, lib, components] all visible, zero failures — green.` |
| **MAJOR-2** — merge gates unenforced | ✅ **closed (gh-verified, not attested)** | ruleset **19038239** — see below |
| **MAJOR-3** — governance layer untracked | ✅ **closed** | `git ls-files docs/` → 76 files; secret-scan re-run independently, clean |
| **MINOR-1** — `APV-CONTRAST-AA` not executing; dual-tier wording | ✅ **closed** (residual: NEW-3) | `ApprovalsInbox.test.tsx:477-546`; ADR 0014 A3 row single-tier (`:896`), correction note (`:903`) |
| **MINOR-2** — TOCTOU between gate and write | ✅ **dissolved by the blocker fix**, not separately patched | `actions.ts:196-213` — count gate gone; predicate and write are one statement |
| **MINOR-3** — `bulkApproveDraftPosts` relied on RLS alone | ✅ **closed by the blocker fix**, not separately patched | `posts.ts:525` `.eq('business_id', businessId)` — but see NEW-2 on what proves it |
| **MINOR-4** — B7 migration vs §0 L-10 | ✅ **recorded as an approved deviation** | `session-22-reviewer.md:251-255`; `20260715200000_user_can_grant_anon.sql` |
| **MINOR-5** — no index covers the count predicate | ✅ **filed, NOT created** | `docs/backlog.md:42`; `git diff --name-only fe6da7e1..462e49eb -- supabase/migrations` is **empty** |
| **PROCESS** — SHARED-FUNCTION CALLERS rule in CLAUDE.md | ✅ **carried** | `CLAUDE.md:280-290` |
| **NIT-3** — `claude-mem` injection filed | ✅ **filed** | `docs/backlog.md` (`22-NIT-3`) |
| **B3** — label = DB count = removed = announced, **both** surfaces | ⚠️ **partial** | **NEW-1** below |

---

## The two blockers, re-derived (not taken on a test's word)

**BLOCKER-1 — the 21C M1 scenario on the CAMPAIGN surface.** Re-derived by reading `PostsClient.tsx` at
`462e49eb`:

```
:100  const filtered = localPosts.filter(p => {
        if (activeFilter === 'all') return true
        ... return p.platform === activeFilter })         // filter=twitter → the 2 X rows
:110  const renderedDraftIds = filtered
        .filter(p => p.status === 'draft').map(p => p.id)  // → exactly [x1, x2]
:127  await bulkApprovePostsAction(campaign.id, renderedDraftIds)
```

With 3 LinkedIn + 2 X drafts and `activeFilter === 'twitter'`, `renderedDraftIds` derives **from `filtered`**,
so it is exactly the two X ids. The statement is `id = ANY([x1,x2]) AND campaign_id AND business_id AND
status='draft' AND deleted_at IS NULL` — no LinkedIn id is in the array, so **no LinkedIn draft can flip**.
The pre-fix code called `bulkApprovePostsAction(campaign.id)` with no scope at all and optimistically flipped
every local `draft` (`git show fe6da7e1:…/PostsClient.tsx`). The gap was real and is closed.
`PostsClient.test.tsx:110` independently reproduces it, asserting
`toHaveBeenCalledWith(CAMPAIGN.id, [posts[3].id, posts[4].id])`.

**BLOCKER-2 — the truncation scenario.** `posts/page.tsx:35` fetches `listPostsByCampaign(client, id, 50)`. An
unseen 51st draft is **not in `localPosts`** → not in `filtered` → not in `renderedDraftIds` → not in
`id = ANY(...)`. It **cannot flip** — by construction, not by a gate. Strictly stronger than the old
business-wide count gate, which refused the *whole* write above a business-wide 200 and otherwise let an
unbounded window through. The optimistic path is scoped identically (`:98` `const idSet = new
Set(renderedDraftIds)`; `:101` `idSet.has(p.id)`), so the UI cannot claim a flip the DB didn't make.

**One statement, no second write path.** At the range, `bulkApproveDraftPosts` has exactly one definition
(`posts.ts:513`) and one caller (`actions.ts:206`); `bulkApprovePostsAction` has exactly two callers —
`ApprovalsInbox.tsx:123` and `PostsClient.tsx:127` — **both** passing rendered ids. No loop, no RPC, no new DB
object, and `supabase/migrations` is untouched in the range. `countPendingDraftPosts` survives but is **not**
in the write path (`ApprovalsInbox.tsx:36`, read-side overflow signal only); `git grep countPendingDraftPosts
462e49eb` shows **zero** hits in `actions.ts`. **No surviving count-gate.**

**DB boundary intact, EXECUTED.** `supabase/__tests__/posts-approval-boundary.test.ts` runs against live
Postgres with real `signInWithPassword` clients, executed by `db-tests` — run **29488958413**, green,
`skip-guard: 11 file(s) under [supabase/__tests__] all visible, zero failures`. It covers editor denial via
`enforce_post_transition_capability` (`:147-186`, raw editor client → denied) and the cross-scope case
(`:320-380`). **Caveat — NEW-2: it does not call `bulkApproveDraftPosts`, and its cross-scope case is masked
by RLS.** The boundary holds; what proves it is weaker than it looks.

**The caller that had zero coverage for three sessions now has coverage.** `PostsClient.test.tsx` exists at
the range (new, +172 lines), under `app/`, inside `app-tests`' glob (`test:app` = `vitest run app/ lib/
components/`). The guard counted **126 files**, matching a local full run (126 files / 1835 tests, green).
*Precision note:* the guard proves every **collected** file ran ≥1 non-skipped assertion and that each target
dir was non-empty; it does not assert a **named** file was collected. So "PostsClient.test.tsx executed in CI"
rests on the file being in the glob plus the 126-count matching — not on the log naming it. See NEW-5.

---

## MAJOR-1 — demonstrated, not asserted

**The four suites are ABSENT, not skipped.** `vitest.config.ts:24` adds `'**/__integration__/**'` to
`exclude`; `vitest.integration.config.ts` (new) is the opt-in home. Grepping the **app-tests run log**
(29488958422) for `skipped`/`todo` returns **zero hits**, and none of `postiz-provider`, `purge-business`,
`round-trip`, `routes.smoke` appear in it (the single `postiz` match is the Lint step listing
`lib/social/postiz-provider.ts`, the *source* file). Absent-and-honest, as ADR 0015 §4 requires — a green skip
inside a required job is the false-green shape the ADR exists to kill.

**Both arms, no `|| true`.** `assert-no-empty-suite.mjs` at the range: arm (i) INVISIBILITY — fails if a
target dir matched zero files, or if any collected file has zero / all-`skipped` / `pending` assertions
(`:52-72`); arm (ii) FAILURE — fails on any failed test. `app-tests.yml:36-40` runs vitest **without**
`|| true` (its exit code propagates), and the guard runs `if: always()` so it cannot be skipped past. The
guard is now generic (target dirs via argv) while `db-tests.yml` still calls it with its default
`supabase/__tests__`. Both arms demonstrated green on the runs cited above.

**postiz-provider: MOVED, not deleted — and the choice is recorded.** The file survives at
`lib/social/__integration__/postiz-provider.integration.test.ts` (`git diff --name-status` shows no deletion
in the range). ADR 0015 carries a per-suite fate table (`:446-451`) recording **"Kept, moved to opt-in"** with
rationale: `PostizProvider` is still the shipped `SocialProvider`; Postiz removal is a not-yet-executed
workstream; the suite was already `.skipIf`'d and never executed inside `app-tests`, so moving it reduces no
CI-executed coverage — it makes a pre-existing absence honest. The table also records that its bodies are
`it.todo` placeholders (a pre-existing authoring gap, not introduced here). Right call, recorded in the right
artefact.

**Eleven-flag abolition holds.** `git grep -c '_INTEGRATION_TEST_ENABLED' 462e49eb -- supabase/` → **0**. The
only survivors are the four opt-in suites, `vitest.integration.config.ts`, and two **comments** in
`db-tests.yml` (`:6`, `:138`) describing the abolition. No regression.

---

## MAJOR-2 — enforced, gh-verified (and the ADR's verification command is wrong)

**Not founder-attested — verified by API**, but **not by the command the brief names.**
`gh api repos/:owner/:repo/branches/master/protection` returns **404 "Branch not protected"**, and that 404 is
**not evidence of absence**: the gate is a **repository ruleset**, invisible to the legacy branch-protection
API. `gh api repos/:owner/:repo/rulesets/19038239`:

- `name: master-app-tests`, `target: branch`, `enforcement: "active"`
- `conditions.ref_name.include: ["refs/heads/master"]`
- `rules: [{type: "required_status_checks", parameters: {required_status_checks: [{context: "app-tests"}], strict_required_status_checks_policy: true}}]`
- `bypass_actors: []`, `current_user_can_bypass: "never"`

`app-tests` **required**; `db-tests` **not required** — correct, the tally is 1/3 under the promotion rule.

**Two facts the ADR should record.** (1) ADR 0015 §5's verification command must be the **rulesets** endpoint,
or every future reviewer runs the 404 and mis-reports the gate as missing — this reviewer nearly did. (2) The
ruleset enforces on **direct pushes**, not merges only: pushing this range to `master` was rejected with
`GH013 … Required status check "app-tests" is expected`. See NEW-6.

*(Procedural note: because 22-D was unpushed at review time, this range had **zero** CI runs of its own — the
greens in `session-22-reviewer.md`'s addendum, 29442577045 / 29442577275, are B7's, on `fe6da7e1`. The runs
cited throughout this report, 29488958422 / 29488958413, exist only because this session pushed the range to
branch `session-22-d` / PR #1 to obtain them. Before that, **MAJOR-1's guard was itself
`AUTHORED-NOT-EXECUTED`** — the precise condition it was written to detect.)*

---

## MAJOR-3 — tracked, and the secret-scan re-verified rather than attested

`git ls-files docs/` → **76 files**, including `0014`, `0015`, `session-22.md`, `session-22-reviewer.md`,
`current-phase.md`. `git show 462e49eb:docs/decisions/0015-…` resolves. PROC-REVIEW-AT-COMMIT is checkable for
docs for the first time — this is the first report that could cite an ADR at a range.

**Secret scan: re-run here.** `462e49eb`'s commit message documents the bulk-import rationale but records
**no** secret scan; the only record of one lives in a session summary, outside the repo. So it was re-run
independently over `docs/` + `CLAUDE.md` at the range (private-key headers, `sk_live_` / `sk_test_` /
`rk_live_`, `whsec_`, JWT `eyJhbGciOi…`, `xox[baprs]-`, `ghp_`, `AKIA…`). **Clean** — every hit is a prose
mention of a key *prefix* (`sk_live_…`, ellipsis, no key material), an env-var **name**, or a description of
redaction (e.g. `session-18b2-review.md:76`). No credential is tracked. ✅

---

## New findings

### NEW-1 — MINOR — the count invariant does **not** hold on both surfaces; and neither surface uses the DB's count

The brief asks whether *label = DB count = removed = announced* now holds on both surfaces. It does not, in
two distinct ways.

**(a) The campaign surface makes no claim at all.** `PostsClient.tsx:189-197` renders `✓ {t('bulkApprove')}` —
**no count** in the label; and `git grep 'aria-live|statusMessage|announce|role="status"'` in
`PostsClient.tsx` at the range returns **nothing**: there is no announcement of any kind. Contrast
`ApprovalsInbox.tsx:156` (`<div aria-live="polite" className="sr-only">`) and `:128`
(`t('bulk.announceApproved', {count, campaign})`). So on `/campaigns/[id]/posts`, `APV-BULK-COUNT-CONSISTENT`
is satisfied only **vacuously** — a label with no number cannot lie — while a screen-reader user gets *no
confirmation* that a bulk approve happened. The caller that went unaudited for three sessions is also the one
with no announcement. Not a blocker (nothing over-approves; the write is exact), but real a11y parity debt on
a shipped surface.

**(b) Both surfaces announce the RENDERED count, not the DB count.** `bulkApprovePostsAction` returns
`{success, count}`, where `count` is the number of rows the statement actually flipped (`posts.ts:528-530`,
from `.select('id')`). Both callers **discard it**:

```
ApprovalsInbox.tsx:128   setStatusMessage(t('bulk.announceApproved', { count: renderedIds.length, … }))
PostsClient.tsx:127-131  const result = await bulkApprovePostsAction(...); if (!result.success) rollback
```

Under concurrency — another approver flips one of the rendered drafts between render and write —
`.eq('status','draft')` correctly drops it, `count` returns lower, and the inbox still announces
`renderedIds.length` and removes every rendered row. The announcement **overstates what this action did**.
Real-world harm is small (dropped rows are usually *already* approved, so the end state matches), but the
constraint is literally *label = **DB count***, and the DB count is sitting unused in `result.count`.
Pre-existing (pre-22-D announced `rows.length` too) so **not a 22-D regression** — but 22-D rewrote this exact
line with the correct number in hand.

**Fix:** announce `result.count`; give `PostsClient` a count in its label and an `aria-live` region at parity
with the inbox.

### NEW-2 — MAJOR — the Tier-1 suite proves the wrong proposition, and RLS masks its cross-scope case

**(a) It never calls the function.** No test in `posts-approval-boundary.test.ts` imports or calls
`bulkApproveDraftPosts`; each hand-rolls the chain inline (`:359-367`,
`client.from('posts').update(...).in('id', ...)`). Delete `.eq('business_id', businessId)` from `posts.ts:525`
and **every test still passes**. The suite pins *Postgres honouring a WHERE clause* — never in doubt — not
*the function emitting that WHERE clause*, which is the only mutation it exists to catch. Tier-2
(`lib/db/posts.test.ts:370-377`) pins the chain, but against a mock. Nothing joins the two. Under ADR 0015 §2
this is not `AUTHORED-NOT-EXECUTED`; it is a shape the tiers don't name —
**EXECUTED-AND-PROVING-NOTHING**. ADR 0015 §2 should name it.

**(b) The cross-scope case is decided by RLS, not by the code under test.** `:327` inserts the second business
with `owner_id: ownerId` — the same owner — but the acting client is `signInAs(approverEmail)` (`:359`), and
`get_user_business_ids()` = owned ∪ active memberships
(`20260702120100_get_user_business_ids_multimember.sql`). The approver owns neither business and is a member
only of `businessId` (`:109-117`), so `posts_update_own` excludes the foreign row **before** the function's
predicate is consulted. The test passes identically with the app-layer filter deleted. *(Both specialist
agents were half-right and contradicted each other here — `security-reviewer` on the fixture's ownership,
`database-reviewer` on the membership; resolved by reading `:327` and `:359` directly. The conclusion is the
database-reviewer's.)*

**Honest scope limit:** `business_id` cannot be made *independently* load-bearing by any fixture — a campaign
belongs to exactly one business, so `.eq('campaign_id')` pins it transitively via the FK. It is
defence-in-depth. The achievable fix is to make the approver an active member of the second business, so RLS
permits both rows and the **function's** predicate is what narrows.

*(Closed by 22-E `578255c3` — forward-reference only; does not change this range's verdict.)*

### NEW-3 — MINOR — MINOR-1's assertions are real but pin a **copy** of the theme

`ApprovalsInbox.test.tsx:480-486, 519-524` transcribe the oklch triples out of `app/globals.css` by hand
(`oklchToRelativeLuminance(0.985, 0.002, 75)` etc.). The tests execute, and one binds the math to the rendered
`className` (`:497-505`) — a genuine improvement on the comment it replaced. But editing `--card` or `--muted`
in `globals.css` leaves them **green** while the shipped contrast regresses: the assertion cannot fail for the
reason it exists. Same family as NEW-2 — executed, but not attached to the thing it claims about. **Fix:**
parse the tokens from `globals.css`. *(Closed by 22-E `98a9f7c7`, verified by mutation: breaking `--card`
drives the ratio to 1.03 and turns the test red, where the transcribed version stayed green.)*

### NEW-4 — MINOR (process) — the reviewer's report was amended in place by the pass it audits

`session-22-reviewer.md` now carries `RESOLVED` verdicts (`:350-417`) written by 22-D. The finding record and
the fix record are the same document with the same author. Two concrete consequences, both visible in this
audit: **MINOR-5 was recorded as "BACKLOGGED"** on reasoning never independently checked, and **NEW-6 went
unrecorded entirely**. **Fix:** append `session-NN-D-corrections.md`; leave the reviewer's report immutable.
*(This report is itself an instance of the failure — see the Independence Disclosure.)*

### NEW-5 — NIT — the skip-guard cannot detect a **named** file silently vanishing

`assert-no-empty-suite.mjs` fails on (i) a target dir matching zero files and (ii) a collected file with no
non-skipped assertions. Neither arm fires if *one* expected file stops being collected while its siblings
still match — the dir is non-empty, and an uncollected file has no entry to inspect. A rename or glob slip
dropping exactly `PostsClient.test.tsx` would go green. Low likelihood, and the 126-file count matching a
local run is decent counter-evidence. **Possible fix:** assert a floor on the file count, or pin an explicit
manifest of required suites.

### NEW-6 — MINOR — `master` is now push-locked, and nothing records it

The `master-app-tests` ruleset enforces `required_status_checks` on **direct pushes**, not just PR merges —
demonstrated: pushing this range to `master` was rejected with `GH013 … Required status check "app-tests" is
expected`. Every future session must land via PR. Neither `docs/current-phase.md` nor ADR 0015 §5 says so, and
§5's stated verification command (`branches/master/protection`) returns a **404** that reads as "no gate". A
future session will lose time to both. **Fix:** record the PR-only workflow in `current-phase.md`; correct
§5's command to the rulesets endpoint.

---

## Corrections to this reviewer's own earlier pass

- **MINOR-5 is NOT moot.** An earlier pass in this session reported it moot and recommended closing the
  backlog entry. **That was wrong.** MINOR-5 concerns `countPendingDraftPosts`'s
  `(business_id, status, deleted_at, scheduled_at)` **read** predicate (`posts.ts:150-166`); the "PK lookup,
  no index needed" analysis it leaned on was about the `.in('id', renderedIds)` **write** predicate — a
  different query. `countPendingDraftPosts` remains live as A2's overflow signal, so the finding **stands as
  filed** and `docs/backlog.md:42` **stays open**. The status table above reflects the corrected verdict
  (✅ filed, not created — as the brief requires).

---

## Regression check — nothing green went red

| Previously green | At `462e49eb` |
|---|---|
| Tier-1 boundary suite (`posts-approval-boundary.test.ts`) | ✅ green, 11 files visible, run 29488958413 (quality caveat: NEW-2) |
| `db-tests` stability | ✅ green, 2m30s, no OOM |
| Eleven-flag abolition | ✅ `git grep -c` → 0 in `supabase/`; survivors are the 4 opt-in suites + comments |
| Contrast fix (21C B5 / m2) | ✅ 32/32 in `ApprovalsInbox.test.tsx` (quality caveat: NEW-3) |
| A1 single-statement / no-new-DB-object | ✅ one `.update()`; `supabase/migrations` untouched in range |
| Hygiene (no `any`, no `console.*`, no unused imports) | ✅ tsc clean; lint 0 errors / 85 pre-existing warnings |

---

## VERDICT

**"Approve only what you saw" — ✅ HOLDS on BOTH surfaces**, by construction rather than by gate. Re-derived
from the code, not from test names: on `/campaigns/[id]/posts` the M1 scenario cannot flip a LinkedIn draft
under `filter=X`, and a draft past the 50-row window is not in `renderedDraftIds` and therefore not in
`id = ANY(...)`. On `/approvals` the same property holds per campaign group. Both callers are pinned by
executing Tier-2 tests, and the DB boundary (RLS + `enforce_post_transition_capability`) is intact and
executed against live Postgres. The caller unaudited for three consecutive sessions now has tests. **Both
blockers are genuinely dead.**

**"Covered = executed" — ✅ HOLDS, but only as of this session, and with one shape the tiers don't name.**
MAJOR-1's guard is real and demonstrated (126 files, both arms, no `|| true`, four suites absent rather than
skipped). But plainly: **at the moment 22-D was handed to review, the entire range was unpushed and had zero
CI runs — the skip-guard written to detect `AUTHORED-NOT-EXECUTED` was itself `AUTHORED-NOT-EXECUTED`.** It is
executed now only because this session pushed the range to obtain runs. And NEW-2 / NEW-3 identify a gap the
tier model doesn't name: tests that are *executed* and *green* while proving something adjacent to the claim
(the DB honouring a WHERE clause; a transcribed copy of the theme). **"Covered = executed" is necessary but
not sufficient — ADR 0015 §2 should add "and attached to the claim".**

**Mergeable? — ⚠️ YES, with one condition and one disclosure.**

22 + 22-D together are sound: the code is correct, the gates are enforced, the governance layer is tracked and
clean. Nothing here justifies blocking a merge on its own.

**The condition:** the range implements the mechanism ADR 0014 §A1.1 **explicitly rejected**
(`.in('id', renderedIds)`, rejected over the ~7 KB-of-URL-at-200-ids risk) and **did not amend the ADR** —
§A1 still normatively specifies a `platforms?: Platform[]` signature that no longer exists, and the code
carried **no cap**, leaving the rejected mechanism's named failure mode unmitigated. *(Raised as MAJOR in this
session's earlier pass; closed by 22-E `5f9a89b0` + `fa8b4bdf` — the Zod `.max(APPROVALS_POST_LIMIT)` and ADR
§A1.2. Merging 22-D **without** those is not recommended.)*

**The disclosure:** per the Independence Disclosure, 22-E was authored by this reviewer, and neither 22-E nor
this report has had independent eyes. **A 22-F pass should re-audit `462e49eb..98a9f7c7`.**

**Deferred, non-blocking:** NEW-1 (count/announcement parity — the one genuine product gap this delta leaves
open), NEW-5 (guard can't see a named file vanish), NEW-6 (push-lock undocumented), MINOR-5 (index — stands as
filed), `22E-integration-discovery` (no job runs the four opt-in suites; recorded in ADR 0015's fate table and
`docs/backlog.md`).
