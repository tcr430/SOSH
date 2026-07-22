# Session 22-F — Reviewer Report (independent re-audit of the 22-E corrections)

**Scope reviewed: `462e49eb..98a9f7c7`** (4 commits: `5f9a89b0`, `578255c3`, `fa8b4bdf`, `98a9f7c7`).
Every citation is `git show <sha>:<path>` / `git diff 462e49eb..98a9f7c7 -- <path>` at that range, a mutation
run in a throwaway worktree checked out at `98a9f7c7`, or a named GitHub API response. Nothing was read at
HEAD (PROC-REVIEW-AT-COMMIT, ADR 0015 §6). `462e49eb` confirmed an ancestor of `98a9f7c7`
(`git merge-base --is-ancestor` → true). **Agents invoked:** `security-reviewer` ✅, `database-reviewer` ✅ —
both instructed to read at the range; both confirmed they did.

**Docs readable at the range:** `git ls-files docs/` → **77** files; `git show 98a9f7c7:docs/decisions/0014-…`
resolves. ADR text was read at the range, not at HEAD.

---

## ✅ INDEPENDENCE — confirmed, with two disclosures

**This reviewer did not author the 22-E commits.** Git authorship (`tcr430` on all four) proves nothing — it
is the human account on every commit in this repo. The evidence is the session record: the four 22-E commits
landed **11:48–11:57 on 2026-07-16**, from the 22-D re-review session — the session whose own Independence
Disclosure requested this pass. This reviewer's lineage begins at **16:08** and produced the three commits
that sit **after** the range: `70b5bc37`, `354bdd9a`, `0e966791` (the P1/P2/P3 passes). This is a sibling
correction pass auditing a peer's work, not an author auditing himself. NEW-4's failure mode
(finding record and fix record sharing an author) does **not** apply to this document.

**Disclosure (a) — NEW-1 is out of scope AND this reviewer is conflicted on it.** P2's NEW-1 fix is
`354bdd9a`, which is **after** `98a9f7c7` and therefore **not in this range**. It was written by this
reviewer's lineage. It is reported below as out-of-range and is **not** given a verdict. If NEW-1's closure
needs auditing, it requires a different reviewer — this one cannot supply it.

**Disclosure (b) — the spec is unreadable at the range it describes.**
`docs/reviews/session-22d-reviewer.md`, the findings document this audit is measured against, **first entered
version control in `354bdd9a`** — this reviewer's own lineage, after the range. At `98a9f7c7`:
`fatal: path 'docs/reviews/session-22d-reviewer.md' exists on disk, but not in '98a9f7c7'`. So
PROC-REVIEW-AT-COMMIT **cannot be satisfied for the spec itself**; it was necessarily read at `354bdd9a`.
This is a structural blind spot in the rule, not a lapse by anyone — filed as **NEW-12**.

---

## Status table

| Finding | Verdict | Evidence at the range |
|---|---|---|
| **MERGE CONDITION (a)** — cap on `renderedIds` | ✅ **closed** | `actions.ts` `.max(APPROVALS_POST_LIMIT)`; `posts.ts:95` real `= 200`; over-cap → `invalid_input`, zero DB calls; URL arithmetic below |
| **MERGE CONDITION (b)** — ADR coherence | ✅ **closed** | `0014` §A1.2 (`:827-916`); supersession banners `:658`, `:762`; §A1.2 governs conflicts (`:829-831`) |
| **NEW-2** — EXECUTED-AND-PROVING-NOTHING | ⚠️ **partial — closed as specified, not as worded** | **Mutation: Tier-1 stays GREEN; Tier-2 goes RED.** See below — this is the report's central judgement call |
| **NEW-3** — contrast test pins a copy | ✅ **closed, mutation-verified ×3** | `--card` → RED (1.0346…); `--muted` → RED (1.0934…); token rename → throws loudly |
| **NEW-1** — announce `result.count` | ⛔ **OUT OF RANGE — no verdict** | `354bdd9a` is after `98a9f7c7`; reviewer conflicted (Disclosure (a)) |
| **ADR 0015 §2 names EXECUTED-AND-PROVING-NOTHING** | ❌ **NOT at the range** | Absent at `98a9f7c7`; added by `70b5bc37` — **out of range**, and this reviewer's lineage. See below |
| **REGRESSION** — nothing green went red | ✅ **holds** | Skip-guard both arms, no `|| true` on the run; ruleset `19038239` active; 77 docs tracked; at-cap approve still succeeds |

---

## MERGE CONDITION (a) — the cap, and the URL failure mode

**The cap is real and correctly wired.** `bulkApproveSchema.renderedIds` is
`z.array(z.string().uuid()).max(APPROVALS_POST_LIMIT)`. `APPROVALS_POST_LIMIT` is a genuine exported
constant (`posts.ts:95`, `= 200`), imported as a value — **not** `.max(undefined)`, which Zod would silently
treat as a no-op. `actions.test.ts`'s `vi.mock` factory pins it as a literal `200` rather than a `vi.fn()`,
closing the mocked-constant bypass. `safeParse` runs **before** `getAuthContext()` and before any DB call, so
an over-cap array is **rejected, never truncated-and-approved** — verified by
`expect(bulkApproveDraftPosts).not.toHaveBeenCalled()`.

`security-reviewer` (at the range) additionally confirmed `businessId` is **server-derived** from
`client.auth.getUser()` → `getBusinessForUser()`, never caller-supplied, and found no IDOR or
tenant-tunnelling path. No CRITICAL/HIGH/MEDIUM security findings.

**Proving the URL failure mode unreachable — re-derived, not assumed.** Modelling the PostgREST request line
(`PATCH /rest/v1/posts?id=in.(…)&campaign_id=eq.…&business_id=eq.…&status=eq.draft&deleted_at=is.null`) against
an 8192-byte request-line budget:

| ids | commas literal | commas %2C-encoded | Verdict |
|---:|---:|---:|---|
| 50 (campaign surface) | 2026 B | 2128 B | ample |
| **200 (the cap)** | **7576 B — 616 B headroom** | **7978 B — 214 B headroom** | **fits, both encodings** |
| 215 | 8131 B | 8563 B ❌ | cliff |
| 220 | 8316 B ❌ | 8758 B ❌ | over |

The cliff lands at **~206–217 ids** depending on encoding. §A1.2's stated "above ~210 ids" is therefore
**well-calibrated, not a guess** — an unusually honest number. At the cap the request fits under **both**
encodings, so the §A1.1 failure mode is genuinely unreachable through this action. ✅

**But the margin is thin, and the constant does double duty — see NEW-7.**

## MERGE CONDITION (b) — ADR coherence

§A1.2 (`0014:827-916`) exists, documents the shipped signature (`renderedIds: string[]`, `:848`), the exact
statement shape (`:854`), the cap, and **why the original rejection was reversed** (`:865-876`): A1.1's word
"silently" overstated the risk (the cost is *availability*, not over-approval), and the cap is now explicit.
It adds `APV-BULK-CAP` to the A3 constraint table as Tier-2 with a named test.

**Is a stale normative §A1 left behind?** No. The `platforms?: Platform[]` strings survive at `:679`/`:752`,
but every one sits under an explicit `⚠️ MECHANISM SUPERSEDED BY §A1.2 (2026-07-16)` banner (`:658`, `:762`),
and §A1.2 states: *"Where A1/A1.1 and this section conflict, A1.2 governs."* That is supersession-with-history
— the correct ADR pattern — not drift. The ADR no longer misdescribes the shipped code. ✅

---

## NEW-2 — the mutation test, and the judgement call

**Structural fix: real but partial.** `posts-approval-boundary.test.ts:8` now imports
`bulkApproveDraftPosts`, and `:402` calls it. But this is **one of three** bulk tests: `APV-BULK-DB-BOUNDARY`
(`:271`) and the 21C M1 scenario (`:292`) still hand-roll the chain inline. NEW-2 is closed for one test, not
for the suite.

**RLS premise: sound.** `database-reviewer` verified against the migrations at the range that
`get_user_business_ids()` = owned ∪ **active** memberships
(`20260702120100_get_user_business_ids_multimember.sql`), `posts_update_own` requires
`business_id = ANY(get_user_business_ids())` AND `user_can(business_id,'reschedule')`
(`20260702120300_…`), and `user_can` grants `reschedule`/`approve` to role `approver`
(`20260702120200_user_can.sql`). The fixture's `business_members` insert (role `approver`, status `active`)
therefore genuinely lets RLS permit the foreign row, and the sanity assertion `expect(rlsReach).toHaveLength(1)`
(`:388`) is a **true positive**. The `enforce_post_transition_capability` trigger also permits it, because the
fixture deliberately uses `approver` and not `editor`. **NEW-3's RLS-masking defect is genuinely fixed.**

**THE MUTATION TEST — executed, not reasoned.** Worktree at `98a9f7c7`, `.eq('business_id', businessId)`
deleted from `posts.ts`:

| Tier | Baseline | Under mutation | Result |
|---|---|---|---|
| **Tier-1** `posts-approval-boundary.test.ts` | green | **stays GREEN** | ❌ does not catch it |
| **Tier-2** `lib/db/posts.test.ts:375` | 63 passed | **1 failed / 62 passed** — `AssertionError: expected "vi.fn()" to be called with arguments: [ 'business_id', 'biz-1' ]` | ✅ catches it |

**Why Tier-1 cannot catch it.** The fixture's foreign post lives in a *different campaign*
(`otherCampaign`), so `.eq('campaign_id', campaignId)` alone still excludes it; `count` stays 1.

**The brief's literal condition — "delete `.eq('business_id')` → a test must go RED" — is SATISFIED**
(Tier-2:375 goes red). **The spirit — that the *Tier-1* suite stop proving the wrong proposition — is only
partly satisfied.** I am **not** calling this a MAJOR, and the reasoning should be checkable:

1. **`business_id`'s individual undetectability is a theorem, not an oversight.** A campaign belongs to
   exactly one business, so `campaign_id` pins `business_id` transitively via the FK. A same-campaign
   cross-business row **cannot exist**. NEW-2 itself proved this ("no fixture can make it independently
   load-bearing") and prescribed the *achievable* fix — make the approver a member of the second business so
   only the function narrows. **22-E built exactly that.** Judged against its own spec, NEW-2 is closed.
2. **The tiers are now joined.** NEW-2's complaint was that Tier-2 pinned the chain "against a mock" and
   "nothing joins the two." Tier-1 now executes the real function against live Postgres, so the mock's chain
   shape is corroborated by a real execution. That is the substantive thing NEW-2 asked for.
3. **A test does go red.** The mutation is caught, by an executing test, in a required job (`app-tests`).

**The counter-argument, stated fairly:** a reader who holds that Tier-1 is the *only* home for a DB-behaviour
claim (ADR 0015 §2 Tier-1: "a mocked client is not coverage") can reasonably say `business_id` is still
proven only by a mock, and that is precisely the shape §2 rejects. I think the FK theorem defeats that here —
you cannot demand a test for a state the schema forbids — but the disagreement is legitimate and a tech lead
may overrule this to ⚠️→❌. **Verdict: ⚠️ partial, non-blocking.** Residuals filed as NEW-8/9/10.

**ADR 0015 §2 does NOT name EXECUTED-AND-PROVING-NOTHING at this range.** `git show
98a9f7c7:docs/decisions/0015-…` → **zero** hits for the term or for "attached to the claim". It was added by
`70b5bc37` (`git log -S`), which is **out of range** and authored by this reviewer's lineage. So: **at the
range, ❌ absent**; at HEAD, present — but this reviewer is conflicted on it and does not certify it. The
brief asked to "confirm ADR 0015 §2 names" it; the honest answer is that the thing being confirmed is not in
the range under audit.

---

## NEW-3 — closed, and independently reproduced

Every transcribed oklch literal is gone; `tokenLuminance(selector, token)` parses `app/globals.css` at test
time and **throws** on a missing/renamed token rather than defaulting. Three mutations in the worktree
(baseline: 32 passed):

| Mutation | Result |
|---|---|
| `:root --card` → `oklch(0.55 0.002 75)` | **RED** — `expected 1.0346329824259104 to be >= 4.5` |
| `:root --muted` → `oklch(0.20 0.002 75)` | **RED** — `expected 1.093361162412027 to be >= 4.5` |
| `--card` renamed to `--kard` | **RED** — `Error: globals.css: ":root" has no --card: oklch(L C H)` |

The first exactly reproduces the figure `98a9f7c7`'s message claims (`1.0346329824259104`) — the commit
message told the truth. The assertion can now fail for the reason it exists. ✅ **closed.**

*(Observation, not a finding: the rename mutation throws at module scope, so the file reports "no tests". The
skip-guard's arm (i) covers that shape, and vitest fails the file regardless — no false-green.)*

---

## NEW-1 — out of range, reviewer conflicted

`354bdd9a` ("announce the DB-flipped count, not the rendered length") is **after** `98a9f7c7` and is **not in
this range**. It was authored by this reviewer's lineage. Per PROC-REVIEW-AT-COMMIT this pass does not read
it, and per the independence rule this reviewer must not grade it. **No verdict. NEW-1 remains open as far as
this report is concerned, and needs an independent 22-G pass** (together with `70b5bc37` and `0e966791`).

---

## Regression check — nothing green at `462e49eb` went red

| Previously green | At `98a9f7c7` |
|---|---|
| Both blockers dead by construction, both surfaces | ✅ unchanged — 22-E touches no caller; `posts.ts`'s predicate chain is byte-identical apart from a comment |
| Tier-2 suites (`lib/db/posts.test.ts`, `actions.test.ts`) | ✅ 63 passed (ran at the range in a clean worktree) |
| Contrast suite | ✅ 32 passed |
| Skip-guard, both arms, no `|| true` | ✅ `app-tests.yml:30-40`; vitest exit code propagates; guard `if: always()`. The `|| true` hits in `db-tests.yml` are diagnostics only (`docker logs`, `free -h`, `supabase status`) |
| Four integration suites absent, not skipped | ✅ unchanged in range |
| Ruleset `19038239` | ✅ `master-app-tests`, `enforcement: active`, `bypass_actors: []`, required check `app-tests`, strict policy true. (`branches/master/protection` still 404s — NEW-6's point stands) |
| Governance tracked | ✅ 77 files under `docs/` |
| **Cap has not narrowed a legitimate approve** | ✅ the at-cap boundary test (`APPROVALS_POST_LIMIT` ids → `{success, count: 200}`) passes; Approvals fetches 200 (**exactly** the cap; `.max` is inclusive), campaign posts fetches 50 |

---

## New findings

### NEW-7 — MINOR — `APPROVALS_POST_LIMIT` does double duty; the cap has ~2.6% headroom

`APPROVALS_POST_LIMIT` is simultaneously (a) the Approvals **page size** (`posts.ts:106`
`opts.limit ?? APPROVALS_POST_LIMIT`) and (b) the **URL-length cap** (`actions.ts`). These are unrelated
concerns that happen to share a number. Per the table above, 200 ids leaves **214–616 bytes** of an 8192-byte
budget (**2.6%–7.5%**), and the cliff is at ~206–217. So raising the page size to 250 for an ordinary product
reason — a change no reviewer would think of as touching the write path — **silently reintroduces the 414**
that §A1.1 rejected the mechanism over. Nothing tests the coupling: the boundary tests assert
`APPROVALS_POST_LIMIT ± 1`, i.e. they are written *in terms of* the constant and stay green at any value.
**Fix:** give the cap its own named constant (e.g. `BULK_APPROVE_ID_CAP = 200`) with a comment tying it to the
8 KB budget, or add a test asserting the constructed query string stays under ~8000 bytes at the cap. Low
likelihood, but the failure is silent and lands on the exact risk §A1.1 named.

### NEW-8 — MINOR — 22-E's own honest-scope note is asymmetric, and the asymmetry is wrong

`posts-approval-boundary.test.ts:337-345` states: *"campaign_id is what actually excludes here … business_id
is defence-in-depth — no fixture can make it independently load-bearing."* The second clause is true; the
implication in the first is **false in the mutation sense**, and I verified the logic: deleting
`.eq('campaign_id', campaignId)` **alone** also leaves the test green, because `.eq('business_id', businessId)`
then excludes `otherPost` (it lives in `otherBiz`). The two predicates are **structurally redundant** in this
fixture — neither is individually provable, only their conjunction is. The comment singles out `business_id`
as the un-provable one when the property is symmetric. This matters because the comment is the artefact a
future session will trust. **Fix:** state that `campaign_id` and `business_id` are jointly-but-not-individually
load-bearing here, by the FK.

### NEW-9 — MINOR — two predicates are unpinned against the real function at Tier-1

Of `bulkApproveDraftPosts`' five predicates, **`.eq('status','draft')` and `.is('deleted_at', null)` are not
caught by any Tier-1 mutation**: `inScopeId` is created `draft` and never soft-deleted, and `otherPost` is
excluded by campaign/business regardless of its status, so deleting either predicate leaves the suite green.
Both are pinned only by the Tier-2 mock (`posts.test.ts:371-379`). `.eq('status','draft')` is the
**atomic-transition guard** — the thing that makes concurrent approves safe — so it is not a cosmetic
predicate. This is the same EXECUTED-AND-PROVING-NOTHING family NEW-2 named, surviving one tier down.
**Fix:** pass an already-`approved` row and a soft-deleted row through `bulkApproveDraftPosts` in the Tier-1
bulk case and assert they don't flip. Unlike `business_id`, these **are** achievable — no FK forbids the state.

### NEW-10 — NIT — `.in('id', renderedIds)` is caught only incidentally

Deleting `.in('id', renderedIds)` *does* turn Tier-1 red — but only because earlier tests in the file
(`:139`, `:190`, `:164`) leave undeleted `draft` rows in the same campaign, so the unconstrained update
matches ~5 rows and `expect(count).toBe(1)` fails. The protection rides on **other tests' fixture hygiene**
and on vitest's default non-shuffled ordering (`vitest.config.ts` sets no `sequence.shuffle`). Enabling
shuffle, or tidying those tests, would silently remove it. **Fix:** assert the leftover drafts are untouched,
making the intent explicit rather than emergent.

### NEW-11 — NIT — the `otherBiz` fixture leaks on the failure path, and `ON DELETE RESTRICT` compounds it

`afterAll` (`:126-136`) cascades only on `businessId` — it never references `otherBiz`. The BLOCKER-1/2 test's
own cleanup (`:412-418`) runs **only if every assertion passes**. So a failing run orphans `otherBiz`, its
campaign, post and `business_members` row. Worse than a plain leak: `businesses.owner_id` is
`REFERENCES auth.users(id) ON DELETE RESTRICT`
(`20260430120003_businesses.sql:15`), so the surviving `otherBiz` then **blocks** `afterAll`'s
`deleteUser(ownerId)` — whose error is not checked — leaving the user behind too. `package.json:19`'s
`test:db … --retry=2` re-runs the body from scratch, so one red test can strand up to three business trees.
**Fix:** delete `otherBiz` in `afterAll`, or create it via a `try/finally`.

### NEW-12 — MINOR (process) — PROC-REVIEW-AT-COMMIT has a blind spot: the findings document itself

A reviewer's report describes a range but is written *after* it, so it is **untracked at the range it
describes** — `docs/reviews/session-22d-reviewer.md` does not exist at `98a9f7c7` and only entered git at
`354bdd9a`. Every future reviewer auditing a correction pass therefore **must** read its spec outside the
range, silently violating the rule, or fail to read the spec at all. The rule as written in CLAUDE.md admits
no exception. **Fix:** amend PROC-REVIEW-AT-COMMIT to say the *reviewed artefacts* are read at the range while
the *findings document* is read at its own commit, which the report must name. This report names it:
`354bdd9a`.

---

## VERDICT

**The merge condition is DISCHARGED. ✅** The cap exists, is a real bound at the action boundary, rejects
rather than truncates, and — re-derived arithmetically rather than taken from the commit message — makes the
~8 KB request-line failure mode unreachable under both encodings at the cap, with the cliff at ~206–217 ids
exactly as §A1.2 claims. The ADR no longer misdescribes the shipped code: §A1.2 documents the mechanism, the
cap, and the reversal's reasoning, and §A1's dead signature survives only under an explicit supersession
banner with §A1.2 governing. The two things 22-D shipped without — a bound and an amended ADR — are both
present.

**NEW-3 is CLOSED**, and this is the strongest work in the range: verified by three mutations that all go red,
one of which reproduces the commit message's stated ratio to sixteen significant figures. A test that can fail
for the reason it exists.

**NEW-2 is ⚠️ PARTIAL — closed as specified, not as worded.** The mutation the brief names does turn a test
red, but at Tier-2, not Tier-1: the Tier-1 suite still cannot see `.eq('business_id')` vanish. I judge this
non-blocking because the FK makes `business_id` individually unprovable *as a theorem* — NEW-2 proved this
itself and prescribed the achievable fix, which 22-E built — and because Tier-1 now executes the real function,
which is the substantive join NEW-2 asked for. A reviewer who holds Tier-1 as the only valid home for a
DB-behaviour claim could reasonably escalate this; the reasoning above is laid out so that call can be made by
someone else. The residual (NEW-9: `status`/`deleted_at` unpinned at Tier-1) **is** achievable and should be
fixed.

**"Covered = executed AND attached to the claim" — ⚠️ HOLDS IN PRACTICE, NOT YET IN THE ADR, AND NOT
UNIFORMLY.** The doctrine is **not present at this range**: ADR 0015 §2 does not name
EXECUTED-AND-PROVING-NOTHING at `98a9f7c7` (added later by the out-of-range `70b5bc37`, which this reviewer is
conflicted on and does not certify). Within the range, 22-E *practises* the doctrine well — the contrast test
is now genuinely attached to its claim, and the Tier-1 bulk case is attached to the function instead of to a
retyped copy of it. But three predicates remain attached only to a mock (NEW-9), one assertion is attached by
accident (NEW-10), and the test comment misdescribes which predicate does the work (NEW-8). **The direction is
right and the two named findings are addressed; the principle is not yet uniformly applied.**

**Mergeable? — ✅ YES.** 22 + 22-D + 22-E together are sound. The blockers remain dead by construction on both
surfaces; the cap discharges the condition that made 22-D "not recommended" to merge alone; the ADR is
coherent with the code; the gates are enforced (`19038239` active, `bypass_actors: []`, no override path);
nothing green went red, and the cap does not narrow a legitimate at-cap approve. **No new blocker or MAJOR
was found in this range.** All six new findings (NEW-7…NEW-12) are MINOR or NIT and none of them justify
holding the merge.

**Two things this report cannot certify, and which need a 22-G pass by someone else:** (1) **NEW-1** and the
three post-range commits `70b5bc37` / `354bdd9a` / `0e966791` — out of range, and authored by this reviewer's
lineage; (2) the **ADR 0015 §2 doctrine text**, for the same reason. The 22-E commits themselves have now had
independent adversarial eyes; the P1/P2/P3 pass has not.
