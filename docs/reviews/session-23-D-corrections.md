# Session 23-D — Governed Memory Foundation · CORRECTION PASS resolution log

**Audits:** `docs/reviews/session-23-reviewer.md` (Reviewer range `f688fc54^..708fe468`).
**Build guide:** `docs/build-guide/session-23.md` §4.

## Why this file exists (REVIEWER-REPORT IMMUTABILITY — CLAUDE.md)

`docs/reviews/session-23-reviewer.md` is **append-only history and is not edited by this pass.** No
RESOLVED verdict is written back into it. Session 22-D violated exactly this rule — it wrote RESOLVED
verdicts into the report auditing its own fixes, collapsing the independent-audit trail. The finding
record and the fix record must not share an author in the same file, so the fixes live here.

**Reviewer's findings-document commit:** `docs/reviews/session-23-reviewer.md` is untracked at every
commit in the range it audits; it enters git at D0's commit (below). This is the Session 22-F NEW-12
exception, disclosed rather than silent: the **reviewed artefacts** were read at `f688fc54^..708fe468`;
the **findings document** is necessarily read outside that range, because it was written after it.

---

## Ordering rationale — why a BLOCKER runs last (recorded per §4.2)

The steps are **D0 → D1 → D2 → D3 → D4 → D5**, which is deliberately *not* "BLOCKERs first":

- **BLOCKER-2 leads (D0).** It is a commit of governing docs. Nothing depends on it, and every later
  step cites the ADR it lands — so it goes first.
- **BLOCKER-1 closes (D5).** Its fix instruction is *"push and get both CI jobs green on this exact
  range"*. That cannot be satisfied until the range is **final**. Running it first would certify a
  range that D1–D4 then invalidate, producing a green run that proves nothing about what ships.

**This ordering is not a downgrade of BLOCKER-1.** It is the only order in which BLOCKER-1's fix is
meaningful. Stated here explicitly so no future reader reads the sequence as a deprioritisation.

---

## Resolution table

| Finding | Tier | Fix | Test that now proves it | Step | SHA |
|---|---|---|---|---|---|
| **BLOCKER-2** — ADR 0016 + build guide + `current-phase.md` + `brainstorm/` untracked; the MEM-* checklist and the §6.2 authorisation exist at no commit | BLOCKER | Committed all four paths (plus the Reviewer's own report) as one `docs(adr):` commit. History **not** rewritten — see disclosure below. | n/a (docs; Tier-3 diff-verified — `git status` shows no untracked `docs/` paths) | D0 | `_pending_` |
| **MINOR-2** (doc half) — `likes: 0 / impressions: 0` placeholder inverts meaning once Track C populates the store | MINOR | Named **un-defer trigger** added to ADR 0016 §3.4: ADR 0018 must not ship on top of it without resolving; two resolution options recorded; owner named. | n/a (doc-only; code half deferred, §4.4) | D0 | `_pending_` |
| **MINOR-1** (doc half) — production tenancy rests on one `.eq()`, not on RLS | MINOR | **Named risk** added to ADR 0016 §4. The pre-existing note framed the service-role split as *intended*; this records what it *costs* — a dropped `.eq()` leaks cross-tenant with every RLS test still green. Tier-2 half deferred to Session 24. | n/a (doc-only; Tier-2 assertions deferred, §4.4) | D0 | `_pending_` |
| **MAJOR-2** — `toBeLessThanOrEqual(3)` passes at 0 | MAJOR | — | — | D1 | — |
| **MAJOR-3** — two voice resolvers; `voice.ts` duplicates live logic it was written to replace | MAJOR | — | — | D2 | — |
| **MAJOR-1** — B4 narrows model input on all three templates; the proof test cannot fail by construction | MAJOR | — | — | D3 | — |
| **MAJOR-4** — 10→3 narrowing reaches 5 callers; 0 caller-level tests | MAJOR | — | — | D4 | — |
| **BLOCKER-1** — the range has never executed in CI; all 8 Tier-1/2 constraints are `AUTHORED-NOT-EXECUTED` | BLOCKER | — | — | D5 | — |

---

## D0 — BLOCKER-2 + the two doc-only MINOR halves

### Disclosure: ADR 0016 post-dates the code it governs

**Required by the Reviewer's BLOCKER-2 fix instruction, and stated plainly rather than buried.**

The Reviewer offered two remedies: rebase the ADR to sit *before* `f688fc54` so the range reads
spec-then-implementation, or commit it on top and disclose. **History was not rewritten** — the five
B0–B4 commits are already authored, reviewed and cited by SHA throughout
`docs/reviews/session-23-reviewer.md`, and rebasing would invalidate every citation in the very
document this pass is discharging.

The consequence, stated without softening: **`git show <any-B-sha>:docs/decisions/0016-governed-memory.md`
returns nothing.** Source comments across B0–B4 cite `ADR 0016 §2 / §3.4 / §5.4 / §6.2 / §7` as binding
authority — including the **one pre-authorised test-assertion change** (the `limit=10`→`limit=3` edit in
`lib/ai/context.test.ts`, ratified by §6.2). **At the commits where those citations were written, the
authority they cite did not exist in git.** From D0 forward it does. A reader auditing the B-range in
isolation cannot verify the §6.2 authorisation and must read the ADR at D0 or later.

Whether the §1 phase gate (*"ADR written and Accepted before the Builder starts"*) was honoured
**cannot be established from git** and is not claimed here. The working-tree ADR predates the build
commits by authoring time, but that is not a git-verifiable fact, and this log does not assert it as
one.

### What was committed

| Path | Prior state | Note |
|---|---|---|
| `docs/decisions/0016-governed-memory.md` | untracked | The governing ADR. +2 amendments this step (below). |
| `docs/build-guide/session-23.md` | untracked | §0 Locked, §0.1's four questions, §4's correction-step list. |
| `docs/current-phase.md` | modified, uncommitted | Carries the `db-tests` promotion tally D5 updates. |
| `docs/brainstorm/` | untracked | Committed, not gitignored — three build-guide sections cite it **by path** as the ADR's source. Leaving it untracked is the exact ambiguity that produced BLOCKER-2. |
| `docs/reviews/session-23-reviewer.md` | untracked | **Added beyond the step's literal list** — see below. |

**Addition to the step's list, flagged rather than made silently.** §4.1's D0 text names four paths and
does not name the Reviewer's own report, which was also untracked. Committing the work order while
leaving the report that *is* the work order untracked would reproduce BLOCKER-2 in miniature — and
Session 22-G set the precedent (NEW-15, *"track findings docs"*). It is included. This is an addition
to a docs-only commit, within D0's "no `.ts`, no `.sql`" boundary.

### ADR amendments made in this step

1. **§3.4 — un-defer trigger (MINOR-2).** Records that `performance.ts` maps governed rows to literal
   `likes: 0, impressions: 0` and that `post-generation.ts:153-154` renders them verbatim; that this is
   **inert only while the table ships empty**; and that ADR 0018 populating `performance_memory` is
   precisely what makes the placeholder start reaching real prompts, where "0 likes, 0 impressions"
   plausibly reads as evidence the pattern performs *badly* — inverting the store's intent. Two
   resolution options recorded (optional numerics + omitted clause, or `observation_count` as the
   credibility signal). Owner: ADR 0018.
2. **§4 — named risk (MINOR-1).** §4 already documented the service-role/RLS-bypass split as
   *intended* design. That note explains the architecture but never states the **failure mode**, which
   is what MINOR-1 asks for: the only production read path is service-role, so RLS is bypassed in the
   running system and isolation rests on a single `.eq('business_id', …)` per query. The Tier-1 RLS
   suite proves a property **no production path currently exercises**, so a future edit dropping that
   `.eq()` leaks cross-tenant memory into a generation prompt **with every RLS test still green**.
   Mitigation (Tier-2 assertion per `lib/db/memory-*.ts`) deferred to Session 24 as a recorded
   decision, not an oversight.

### Correction to the Reviewer's MAJOR-1 table (non-material)

MAJOR-1's heading reads *"three of four prompt templates"*. Re-deriving from `lib/ai/prompts/*.ts`:
there are **three** templates — `post-generation.ts`, `post-regeneration.ts`,
`brand-voice-inference.ts` (`types.ts` is type-only). All three lose something, so the correct
statement is *"all three of three"*. **The finding is unaffected** — the per-template render sets in
the Reviewer's table were re-derived independently in this pass and match exactly, including that
`trialState` is read by no template and that `post-regeneration.ts` renders neither `recentCampaigns`
nor `recentPostPerformance`. Recorded because the Reviewer's report is immutable and cannot carry its
own erratum.

### Verification

- `git log` shows the docs commit.
- `git status` shows **no untracked `docs/` paths**.
- No `.ts` / `.sql` file touched in this step.

---

## Deferred, carried not dropped (§4.4)

| Item | Disposition |
|---|---|
| MINOR-1 (Tier-2 `.eq('business_id')` assertions per `lib/db/memory-*.ts`) | **Session 24.** Doc-side risk note landed at D0. |
| MINOR-2 (`likes: 0` placeholder) | **Un-defer trigger recorded in ADR 0016 §3.4 at D0.** Owner: ADR 0018. |
| MINOR-3 (`platform: null` rows silently dropped, can under-fill the cap) | **ADR 0017**, which owns the retrieval consumers. |
| MINOR-4 (brand/evidence/audience tests thin — wrong cap constant would not redden) | **ADR 0017**, when those modules gain real consumers. |
| NIT-1 (squash the two migrations) | **Declined** — Reviewer says do not rewrite history for this. |
| NIT-2 (`let admin: any`) | **Not a defect** — compliant with the CLAUDE.md carve-out (2). No action. |
| NIT-3 (stale `lib/memory/index.ts` header) | **D2.** |

---

*Resolution log for Session 23-D. The Reviewer's report is not modified by this pass.*
