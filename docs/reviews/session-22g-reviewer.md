# Session 22-G — Reviewer Report (independent audit of P1/P2/P3 + P5)

**Reviewed ranges.** `98a9f7c7..0e966791` — P1 `70b5bc37`, P2 `354bdd9a`, P3 `0e966791` (the lineage 22-F
declined to certify). `0e966791..d2063875` — P5 `d2063875` (residual hardening, NEW-7…NEW-12). All artefact
citations are `git show <sha>:<path>` / `git diff` at those ranges. Nothing was read at HEAD
(PROC-REVIEW-AT-COMMIT, ADR 0015 §6).

**Findings documents, each at its own commit** (per §6 as amended by P5/NEW-12):
- `docs/reviews/session-22d-reviewer.md` — read at **`354bdd9a`**, the commit that first tracked it.
- `docs/reviews/session-22f-reviewer.md` — **has no commit and cannot be given one.** Read from the working
  tree on disk. This is not a lapse; it is mechanically impossible at present, and it is **NEW-15** below.
  The P5 amendment requiring a reviewer to *name the findings document's own commit* is therefore
  **unsatisfiable for this very pass** — the first pass obliged to obey it.

**Agents invoked:** `security-reviewer` ✅, `database-reviewer` ✅ — both instructed to read at the named
commits; both confirmed they did. `database-reviewer` was explicitly told Docker was unavailable and that it
must reason statically and say so; it did.

---

## ⚠️ INDEPENDENCE — disclosed, and weaker than 22-F's

**I did not author P1/P2/P3, 22-D, 22-E, 22-F, or P5 in this session.** This session began cold with no
memory of writing them. Three facts cut against a strong independence claim, and the founder should weigh
them rather than take a green from me on trust:

1. Every commit in the audited ranges is `Co-Authored-By: Claude Sonnet 5` — authored by Claude sessions in
   **this same worktree**. Git authorship (`tcr430`) proves nothing; it is the human account on every commit.
2. **The P5 session is my immediate predecessor**, and its session summary was injected into my context at
   startup. It names P5's task ("close the 22-F residuals NEW-7…NEW-12") and the exact files it touched. I
   began this audit already holding the author's own account of its intent. 22-F's independence test was a
   session/timestamp boundary; by that test I am a new lineage. By the stricter test — *did the reviewer
   arrive uncontaminated by the author's framing* — **I did not**.
3. I am a different model (Opus 4.8 vs Sonnet 5), which is a real but weaker separation than a different
   human.

**Compensation:** I trusted no commit message and no code comment. Every verdict below rests on a mutation I
ran myself, a command whose output is quoted, or an explicit "could not verify." That discipline is what
caught NEW-13 — a defect the commit message and the ADR text both describe as fixed.

**One self-correction, disclosed:** my first contrast mutation (`--muted-foreground`) left the suite green
and I nearly filed it as a regression. The suite reads `--card`/`--foreground`/`--muted`; I had mutated a
token it does not assert on. Re-run against the right token, it reddens correctly. **My green was my error,
not a defect** — recorded here because a reviewer who hides a near-miss is not auditable.

---

## Status table

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| **NEW-1** | Both surfaces announce `result.count` | ✅ **PASS** | Mutation ×3 → RED (below) |
| **NEW-1 (a11y)** | `PostsClient` count label + `aria-live` | ✅ **PASS** | `354bdd9a:PostsClient.tsx:158-160` live region; `:218` label `{count}` |
| **P1 doctrine** | ADR names EXECUTED-AND-PROVING-NOTHING + CONS-ATTACHED | ✅ **PASS** (located in **§1(c)**, not §2) | `70b5bc37` §1(c):108-131; §2 CONS-TIERED:175 |
| **P1 rule has teeth** | mutation obligation, not just the name | ✅ **PASS** — not toothless | Quoted below |
| **NEW-4** | CLAUDE.md reviewer-report immutability | ✅ **PASS** | `70b5bc37:CLAUDE.md:292-299`; precedent verified real (4 `RESOLVED` markers) |
| **NEW-6 / P3** | rulesets endpoint corrected; PR-only recorded | ✅ **PASS** | Both API calls re-run live (below) |
| **NEW-7** | distinct constant; Zod `.max()` → it; <8 KB test | ⚠️ **PARTIAL** | Trap closed by the split; **the test proves nothing** → **NEW-13** |
| **NEW-8** | honest-scope comment corrected | ⚠️ **PARTIAL** | Symmetry fixed; **"by the FK" is a fresh overclaim** → **NEW-14** |
| **NEW-9** | `status`/`deleted_at` pinned at Tier-1 | ⛔ **NOT CERTIFIED** | **Mutation impossible here** → **NEW-16** |
| **NEW-10** | `.in('id',…)` explicit, not fixture-order | ✅ **PASS** | `d2063875:…boundary.test.ts:293-305, 336-343` |
| **NEW-11** | `otherBiz` teardown in `try/finally` | ✅ **PASS** | `:482-490`; FK order safe; `signInAs` placement safe |
| **NEW-12** | PROC amendment coherent, doesn't weaken at-range | ✅ **PASS** (text) / ⛔ **inoperable** | Coherent; but unsatisfiable — **NEW-15** |

### Regression battery (nothing 22-F certified went red)

| Check | Verdict | Evidence |
|---|---|---|
| Cap intact; rejects over-cap | ✅ | `actions.test.ts:349` green (but mock-pinned — NEW-13) |
| BLOCKER-1/2 dead **by construction** | ✅ | `bulkApprovePostsAction(campaignId, renderedIds)` — no window arg; zero `countPendingDraftPosts`/`totalPending` in the bulk path |
| NEW-3 contrast still mutation-reddening | ✅ | `--muted` → `oklch(0.25 0 0)` ⇒ ratio **1.237** ⇒ RED |
| Ruleset `19038239` active | ✅ | `enforcement:"active"`, `bypass_actors:[]`, `required_status_checks:[{context:"app-tests"}]` |
| Skip-guard both arms | ✅ | `assert-no-empty-suite.mjs`: arm (i) zero-files:57-69, arm (ii) any-failure |
| **Docs tracked** | ❌ **REGRESSED** | **NEW-15** |
| tsc / Tier-2 suite | ✅ | `tsc --noEmit --skipLibCheck` clean; `vitest run lib/db lib/social lib/validation` → **555/555** |

**P5 relaxed nothing to make a residual pass.** No test was weakened, no assertion loosened, no guard removed.

---

## NEW-1 — CLOSED (the one product-facing fix nobody independent had checked)

Re-derived, not read. Mutating both surfaces back to the rendered length:

```
ApprovalsInbox.tsx : count: result.count ?? 0  →  count: renderedIds.length
PostsClient.tsx    : count: result.count ?? 0  →  count: renderedDraftIds.length
```

⇒ **3 RED**:
```
FAIL ApprovalsInbox … THE CONCURRENCY SCENARIO
  AssertionError: expected 'bulk.announceApproved:{"count":3,…' to contain '"count":2'
FAIL PostsClient … announces the DB-reported count …
  AssertionError: expected 'bulkApproveSuccess:{"count":3}' to contain '"count":0'
FAIL PostsClient … THE CONCURRENCY SCENARIO …
  AssertionError: expected 'bulkApproveSuccess:{"count":3}' to contain '"count":2'
```
Restored; baseline 54/54 green. The announcement tracks the DB-flipped count on **both** surfaces, and
`PostsClient` has both halves of the a11y fix (`aria-live="polite"` region, empty before action; count in
label). **Attached to the claim. NEW-1 is closed.**

---

## P1 doctrine — present, and it has teeth

Located in **§1(c)**, not §2 (§2's CONS-TIERED rule references it). Substantively correct, and the mutation
obligation is explicit in both places — this is **not** a name-without-obligation:

> **§1(c) / CONS-ATTACHED:** "covered = executed **and** attached to the claim… If deleting the production
> guard and re-running the test suite doesn't turn it red, the test is `EXECUTED-AND-PROVING-NOTHING`,
> regardless of how green it looks in CI."

> **§2 / CONS-TIERED:** "the Reviewer must additionally confirm, for Tier-1 and Tier-2 constraints, that
> removing the production guard would turn the test red."

**NEW-4** (`70b5bc37:CLAUDE.md:292-299`) is present, and I verified its cited precedent is real rather than
rhetorical: `session-22-reviewer.md` at that commit carries **4 `RESOLVED` markers** written by 22-D, the
author of the fixes they describe. The rule correctly declines to rewrite history and binds forward only.

---

## NEW FINDINGS

### NEW-13 — MINOR (Tier 2) — the NEW-7 URL-budget test is itself EXECUTED-AND-PROVING-NOTHING

**The trap 22-F actually named is closed.** `BULK_APPROVE_ID_CAP` (`d2063875:lib/db/posts.ts:106`) is a
genuinely distinct constant; `APPROVALS_POST_LIMIT` remains the page size (`:117`); Zod points at the cap
(`actions.ts:79`). Bumping the page size can no longer move the cap. That half is real. ✅

**But the test written to pin the budget cannot fail.** `actions.test.ts` mocks `@/lib/db/posts` and
hardcodes `BULK_APPROVE_ID_CAP: 200` (`:30`). All three cap tests — over-cap reject (`:349`), at-cap accept
(`:367`), and the new NEW-7 budget test (`:380`) — import the **mock**, never the shipped constant.

**Mutation (run):** shipped `BULK_APPROVE_ID_CAP` 200 → 400 in `lib/db/posts.ts`. The real PostgREST request
line becomes **15,765 bytes** — ~2× the ~8 KB budget, squarely the 414 ADR 0014 §A1.1 rejected the mechanism
over. **All 12 tests passed.** Restored.

This is precisely 22-F's own NEW-7 diagnosis — *"they are written in terms of the constant and stay green at
any value"* — reproduced in the fix for it. **A second layer:** the test hand-builds the request line as a
string literal rather than deriving it from `bulkApproveDraftPosts`, so a sixth predicate added to the real
query would never register. That is the NEW-3 transcription defect, one tier over.

**Verified arithmetic** (confirms 22-F and P5's comment): at 200 ids, `%2C`-encoded = **7,965 B**; cliff vs
the 8192 budget at **206**. P5's comment (2.6–7.5% headroom, cliff ~206–217) is **accurate**.

**Fix:** assert against the real constant — move the budget test to a file that does not mock `@/lib/db/posts`
(e.g. alongside `lib/db/posts.calendar.test.ts`, which imports `APPROVALS_POST_LIMIT` unmocked), or add an
unmocked guard test pinning `BULK_APPROVE_ID_CAP <= 205`. Better: derive the request line from the query
builder rather than transcribing it.

### NEW-14 — MINOR (doc accuracy) — "by the FK" is a fresh overclaim; second correction, still wrong

`d2063875:supabase/__tests__/posts-approval-boundary.test.ts:380-388` now says `campaign_id` + `business_id`
are jointly-not-individually load-bearing **"by the FK."** The symmetry correction is right. **The mechanism
is not.** Verified at the commit:

- `posts.campaign_id` → `REFERENCES public.campaigns(id) ON DELETE CASCADE`
- `posts.business_id` → `REFERENCES public.businesses(id) ON DELETE CASCADE`

Two **independent** FKs. There is no composite FK, CHECK, generated column, or trigger tying
`posts.business_id` to `campaigns(campaign_id).business_id`. The migration says so itself
(`20260430120010_posts.sql:6-7`): *"business_id is denormalised from the parent campaign for RLS efficiency.
`/lib/db/posts.ts` is the sole writer and must keep it consistent."* That is **application-level convention,
not a DB invariant** — a service-role path bypassing `/lib/db/` could create the very row the comment says
"cannot exist," at which point both predicates *would* become independently provable.

No behavioural impact (the fixture rows are inserted consistently, so the test's described pass/fail is
correct). It matters because the comment is the artefact the next session trusts, and this comment has now
been "corrected" twice and is still wrong about *why*. The overclaim originates in 22-F's NEW-8 text; P5
copied it. **Fix:** cite the sole-writer convention, not the FK.

### NEW-15 — MAJOR (process, Tier 3) — `/docs` is re-ignored: the governance layer is silently untracked again

Working-tree `.gitignore:25` adds `/docs`. This is a **regression of MAJOR-3** (*"The entire governance layer
is untracked; B0 has no commit"*), which `462e49eb` ("docs: track the governance layer") fixed by removing
that exact line and tracking 77 docs + `CLAUDE.md`.

Verified:
- `/docs` is **absent** from `.gitignore` at `462e49eb` **and at committed `HEAD`** — it exists **only in the
  working tree**, uncommitted, origin unknown.
- `git add docs/reviews/session-22f-reviewer.md` → *"The following paths are ignored by one of your
  .gitignore files: docs"*.
- A probe file under `docs/reviews/` does **not** appear in `git status` at all. New docs are **invisible**,
  not merely untracked.
- Existing docs survive only because they are already in the index — `git check-ignore --no-index` matches
  the same rule against `session-22d-reviewer.md`. Tracking is the only shield.

**Consequences, live right now:**
1. `session-22f-reviewer.md` — the findings document for this arc — **has no commit and cannot get one**
   without `-f`. It exists on one disk.
2. **This report** is equally invisible. The audit record of the arc cannot be committed as things stand.
3. **NEW-12's amendment is unsatisfiable.** It requires naming the findings document's own commit; the
   mechanism that would give it one is disabled. P5 wrote a rule its own repo state cannot obey.
4. Any **new ADR** under `docs/decisions/` would silently vanish — the same class as MAJOR-3.

**This is the single thing standing between the arc and closure**, and it is a one-line fix.

### NEW-16 — MINOR (Tier 1) — NEW-9 cannot be certified from this environment

**I could not run the mutation, so I do not pass it.** 22-F flagged NEW-9 as the residual that *is*
achievable and asked that it be held to the mutation bar. I held it there and **could not clear it**:

- `docker: command not found`; Docker Desktop not installed (`Program Files\Docker\…` absent); no
  `com.docker.service`; no `postgresql*` service; no `psql`.
- `npx supabase status` → daemon pipe failure.
- Consequently the whole Tier-1 suite self-skips: `posts-approval-boundary.test.ts (11 tests | 11 skipped)`.

The fixture's own comment asserts *"verified locally by temporarily deleting each predicate and confirming
this test goes RED"* — **an author's claim with no artefact behind it.** Under the CONS-ATTACHED doctrine P1
committed three commits earlier, that is exactly the evidence-shape that does not count. I record it as
unverified, not as false.

**Static derivation (mine, corroborated independently by `database-reviewer`) says the pin is sound.** Given
`renderedIds = [inScopeId, otherPost, alreadyApprovedId, softDeletedId]` and `expect(count).toBe(1)`:

| Mutation | Predicted result | Predicted verdict |
|---|---|---|
| delete `.is('deleted_at', null)` | `softDeletedId` now matches all remaining predicates → count = **2** | RED |
| delete `.eq('status','draft')` | `alreadyApprovedId` matches; `approved→approved` is a no-op value-wise but still satisfies `WHERE` and is returned by `RETURNING id` → count = **2** | RED |

`database-reviewer` further confirmed nothing masks these: `posts_update_own` RLS checks only `business_id` +
`user_can(...)`; `enforce_post_transition_capability` fires only `IF NEW.status IS DISTINCT FROM OLD.status`
(so it never blocks the `approved→approved` row); no RLS policy or trigger references `deleted_at` at all.
Each predicate is pinned by its **own** row, neither masked by the other — genuinely unlike the NEW-8 pair.

**So: sound by reasoning, unproven by execution.** Someone with Docker must run both mutations. Until then
NEW-9 is `AUTHORED-NOT-EXECUTED` **for this reviewer**, and the honest label is *not certified* — not *closed*.

---

## VERDICT

### Is the full arc (22 → 22-D → 22-E → 22-F → P1/P2/P3 → P5) mergeable?

**The code is mergeable.** No BLOCKER and no code-level MAJOR survives. `security-reviewer` returned no
CRITICAL/HIGH/MEDIUM: `business_id` is always server-derived from `ctx.business.id` and never client-supplied;
Zod is the only bound on `renderedIds` and it holds server-side (a hand-crafted RSC payload hits the same
validation); the catch-all leaks nothing. `database-reviewer` found no missing index (the `.in('id', ≤200)`
UPDATE is PK-driven) and no FK-ordering bug. Both blockers are dead **by construction**, not by test.
Everything 22-F certified still holds under re-mutation. P5 relaxed nothing.

### Is it closeable?

**No — not yet, for one reason: NEW-15.** An arc whose entire justification is *"covered means executed, and
the record must be legible"* cannot close while its own review record is unversioned by a one-line
working-tree edit. `session-22f-reviewer.md` and this report both exist on exactly one disk. Restore
`.gitignore`, commit both, and the arc closes on this axis.

Secondarily, **NEW-9 needs one Docker run** (two mutations, both predicted RED). That is a ten-minute task
for anyone with a working stack, and I decline to launder it into a pass.

### Does "covered = executed AND attached to the claim" now hold UNIFORMLY?

22-F's assessment was: *"in practice, not yet in the ADR, not uniformly."* Scoring the two deltas separately:

- **"not yet in the ADR" → FIXED by P1.** ✅ §1(c) names `EXECUTED-AND-PROVING-NOTHING`, CONS-ATTACHED states
  the rule, and **both** §1(c) and §2 carry an explicit mutation obligation. The doctrine is now written down
  with teeth, and the Reviewer's checklist obligation is binding. This is a real advance.

- **"not uniformly" → STILL NOT UNIFORM.** ❌ And the counter-example is *new*, introduced by the very pass
  meant to close the gap. **P5's own NEW-7 budget test is `EXECUTED-AND-PROVING-NOTHING`** by the definition
  P1 committed three commits earlier: it runs green in CI, and doubling the shipped cap to a value that
  guarantees a 414 does not redden it. NEW-9 — the pin P5 got *right* in substance — remains unproven for
  want of a Docker daemon.

**The honest summary:** the doctrine is now *stated* uniformly and *practised* unevenly. P1 closed the ADR
gap. P5 closed three residuals well (NEW-10, NEW-11, and — pending one mutation run — NEW-9), corrected NEW-8's
symmetry while introducing a new overclaim about its mechanism, and shipped a fresh instance of the exact
defect class the session exists to eliminate. That is not a failure of the session; it is evidence that the
failure mode is **subtle enough to survive being named, defined, and made a merge-gate obligation in the same
week** — which is the strongest possible argument that CONS-ATTACHED earns its place in the ADR, and that the
mutation obligation must be exercised by reviewers rather than asserted by authors.

**Recommendation:** merge the code. Do **not** mark the arc closed until (1) `/docs` is un-ignored and both
review documents are committed (NEW-15, one line), and (2) the two NEW-9 mutations are run on a live stack by
someone with Docker (NEW-16). NEW-13 and NEW-14 are MINOR and can be backlogged — but NEW-13 should not be
recorded as "NEW-7 closed," because the half that a future session will rely on is the half that does not work.

---

*Reviewer: Session 22-G. No code, tests, ADRs, or prior review documents were modified. All mutations were
reverted and the working tree re-verified clean (`.gitignore` and `docs/build-guide/session-22.md` remain
modified exactly as found at session start — neither is my doing).*
