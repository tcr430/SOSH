# Session 28 — Reviewer report (E6)

**Scope reviewed: `a153feaa..9ddfe5a9`** — twelve commits (`E5.1 … E5.12`), 80 files, +9594/−50. All
citations below are `git show <sha>:<path>` or `git diff a153feaa..9ddfe5a9` **at that range, never HEAD,
never the working tree** (PROC-REVIEW-AT-COMMIT, ADR 0015 §6).

- **Base `a153feaa`** — "D7 complete", the last Session 27 commit. Verified as the correct base:
  `git cat-file -e a153feaa:docs/decisions/0021-mode-3-triage-and-opportunity-feed.md` →
  *exists on disk, but not in 'a153feaa'*.
- **Head `9ddfe5a9`** — "E5.12 complete — verification pass, close-out docs, and one real gap closed".

**The checklists I audited *against*, read at their own commits** (CLAUDE.md, Session 22-F NEW-12) — and
one of the three has no commit at all:

| Artefact | Read at |
|---|---|
| `docs/decisions/0021-…md` (§0.2, §10, §11) | **`9ddfe5a9`** — clean in the working tree, identical to the range head. It entered git at **`6ab6f19f` (E5.4, mid-Builder)**, not at the Architect phase. |
| `docs/build-guide/session-28.md` §0, §0.2, §2 | **No commit — working tree only**, blob `cc29a6c5`. The committed file at `9ddfe5a9` is still the `5b5bbb9f` (Session 27) version: 631 lines, **no `## §0.2` heading**, §2 still the placeholder. |
| `docs/decisions/0015-…md` **Amendment B** | **No commit — working tree only**, blob `2d3089ef`. `git show 9ddfe5a9:docs/decisions/0015-test-execution-and-ci-gates.md \| grep -ci "amendment b"` → **`0`**. |

Also dirty and outside the reviewed range, recorded so nothing is confused for reviewed work:
`.gitignore`, `docs/build-guide/session-24.md`. No production source is dirty.

**CI at the range head.** `9ddfe5a9` does have its own green runs, which the shipped docs do not cite:
`app-tests` [31410192007](https://github.com/tcr430/SOSH/actions/runs/31410192007), `db-tests`
[31410191972](https://github.com/tcr430/SOSH/actions/runs/31410191972) — `skip-guard: 30 file(s) under
[supabase/__tests__] all visible, zero failures — green. (279/279 tests passed)`, `eval`
[31410191914](https://github.com/tcr430/SOSH/actions/runs/31410191914).

**Vocabulary, per Amendment B4.** Twenty-eight constraints are claimed **COVERED**; `SIGNAL3-TRIAGE-QUALITY`
is **MEASURED**, at **precision 1.000 (24/24) / recall 1.000 (24/24) / dismiss-match 1.000 (16/16),
corpusVersion=1, executed 40/40**, run [31405593644](https://github.com/tcr430/SOSH/actions/runs/31405593644).
That number is a bootstrap ceiling by construction and ADR §15 says so; I quote it as required and read it
as such.

**Summary: 1 BLOCKER, 7 MAJOR, 8 MINOR, 6 NIT, 1 ADJUDICATION REQUEST.**

---

## READ HARDEST — A. FAIL-CLOSED (L-3, §2.5)

I traced every bound in `git show 9ddfe5a9:lib/ai/tool-runner.ts`. **The loop cannot write a card: it
imports nothing from `lib/db/insight-cards` or `lib/db/signal-candidates`, and every failure arm returns a
typed value rather than throwing.** Bound by bound:

| Bound | Declared | Compared at | Breach → zero cards? |
|---|---|---|---|
| `TRIAGE_MAX_TOOL_CALLS` 4 | `:29` | `:255` (`offerTools`) | n/a — withholds tools rather than failing; forces the decision turn, per §2.5. Correct. |
| `TRIAGE_MAX_TURNS` 6 | `:34` | `:241` + fallback `:386-393` | Yes — `max_turns_exceeded`. |
| `TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS` 40 000 | `:35` | `:294` | Yes. |
| `TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN` 1 024 | `:36` | `:299` | Yes — but see NIT-2: unreachable in production. |
| `TRIAGE_MAX_CUMULATIVE_OUTPUT_TOKENS` 4 000 | `:37` | `:304` | Yes. |
| `TRIAGE_MAX_WALL_CLOCK_MS` 45 000 | `:41` | `:244` | Yes — but see MAJOR-7: not an upper bound. |
| `TRIAGE_RETRY_BUDGET` 2 | `:54` | `:165`, mapped `:283` | Yes — `retry_budget_exhausted`. |
| `stop_reason === 'max_tokens'` | — | `:309` | Yes — `response_truncated`. |

**No bound is defined-but-never-compared.** Every one has its own test case producing zero cards
(`lib/ai/tool-runner.test.ts:149-230`), and each would redden if its comparison were deleted.

**Does the token cap count RETRIED tokens (§2.7)? No — and the code says so.** `tool-runner.ts:42-53`
states that a failed attempt contributes no tokens (there is no response to read `usage` from) and that only
a turn's eventually-resolved response is counted once. That is *factually correct* and contradicts ADR
§2.4/§2.7, which is unamended. See MINOR-4. Safety is unaffected — a retry storm still trips closed via the
retry budget and wall-clock — but the ADR's stated *mechanism* is wrong.

**Early returns skipping the `ai_usage` write?** Two, both before the `try`: `:182-184` (`quota_exceeded`)
and `:193-195` (`rate_limited`). Neither issues an SDK call, so there are no tokens to record; the test at
`lib/ai/tool-runner.test.ts:297-300` asserts this deliberately. **Not a finding.** Every path that spends
tokens passes through the `finally` at `:394-415`, which itself catches and logs rather than throwing.

---

## READ HARDEST — B. INJECTION, END TO END (L-9, §7)

§7.4's kill points against the real code:

1. **Does any tool mutate state?** No — and I checked the functions *behind* the four, not just the
   wrappers. `git show 9ddfe5a9:lib/memory/{evidence,audience,brand}.ts` contain **no**
   `.insert/.update/.upsert/.delete/.rpc`; `lib/db/campaigns.ts:6-20`'s `listCampaigns` is a bounded,
   `business_id`-filtered, soft-delete-filtered `SELECT`. **Clean.**
2. **Is the returned schema a `z.strictObject` with no `status`?** Yes — `lib/ai/tool-runner.ts:75-81`:
   `verdict / reason / citableEvidenceIds / citableBrandIds / audienceNote`, nothing else. "approved" is
   unemittable by the model. **Clean.**
3. **Is `insight_cards.status` set by DB DEFAULT with no code path assigning it?** Yes.
   `supabase/migrations/20260807100000_mode3_insight_cards.sql` defaults it, and
   `lib/signals/triage/card.ts:240-256`'s insert object has **no `status` key** (comment at `:238-239`).
   The only writer is `transitionCardStatus` (`lib/db/insight-cards.ts:164`), an atomic conditional UPDATE.
   **Clean.**
4. **Does every string field of every tool result pass through `wrapToolResultForPrompt`, and is there a
   `JSON.stringify` of tool output into a `tool_result` block?** The wrapping is present per field
   (`lib/signals/triage/tools.ts:91, :104, :116, :118, :131-133`). **The `JSON.stringify` is present —
   `lib/ai/tool-runner.ts:346` — and the scan that was supposed to forbid it cannot see it.** See MAJOR-5.
5. **Does any card field render through `dangerouslySetInnerHTML` or as markdown?** No. Every field renders
   as plain text through JSX (`OpportunityFeed.tsx:239, :244, :252, :270-271`), and
   `app/[locale]/(dashboard)/opportunities/source-scans.test.ts:42-52` scans for
   `dangerouslySetInnerHTML` with a per-root vacuity guard. **Clean.**

**The honest limit (§7.5).** Partially met. `card.audience` is marked as the model's assessment
(`OpportunityFeed.tsx:251`, italic + muted + a `title` attribute), but `observation` and `why_it_matters`
— equally unverified model prose generated from attacker-influencable release text — render **unmarked, in
the primary position, in normal body text** (`:239, :244`), while the "verified evidence" block renders a
bare **count** (`:259`) rather than any evidence. A reader cannot tell which claims are evidence-backed.
See MINOR-5.

---

## READ HARDEST — C. TENANCY UNDER SERVICE-ROLE (§2.3, §4.6)

**Both halves pass, and this is the strongest work in the range.**

`git show 9ddfe5a9:supabase/__tests__/signals3-triage-tools.test.ts` is a genuine Tier-1 test: it creates
two real auth users and two real businesses (`:41-44`), seeds real rows in `evidence_memory`,
`audience_memory`, `brand_memory` and `campaigns` for **both** (`:49-100`), then runs all four tools under
a real service-role client and asserts zero foreign rows — **mirrored both directions for `list_evidence`**
(`:118-138`) and one direction each for the other three (`:140-171`). Not a mock. Removing
`.eq('business_id', …)` from any backing function would redden it.

Stage D's persistence-time guard asserts **count equality**, not merely a successful fetch:
`lib/signals/triage/card.ts:221-225` — `if (reFetchedEvidence.length !== verifiedEvidenceIds.length) return
{ outcome: 'skipped', reason: 'evidence_tenant_mismatch' }`, **before** the insert at `:240`. Its mechanism
is proved on live Postgres at `supabase/__tests__/signals3-card-evidence-tenant.test.ts:70-95`, including
the control case (the same id under its *own* business does return). **Clean.**

---

## FINDINGS

### BLOCKER-1 — `generateCard` has zero production callers: Stage D never runs, so no insight card can ever exist

**Citation:** `git show 9ddfe5a9:lib/signals/triage/card.ts:173` (definition);
`git show 9ddfe5a9:lib/signals/triage/orchestrator.ts:95-105` (the path that should call it).

**Evidence.** `git grep -n "generateCard" 9ddfe5a9` returns exactly three non-test hits: the definition
itself, a comment in `lib/db/insight-cards.ts:116`, and a comment in `card.ts:107`. **The only production
worker never calls it.** `orchestrator.ts:97-99` reads:

```
if (result.decision.verdict === 'card') {
  summary.carded++
  // Left at 'triaging' — see this file's header comment.
}
```

and the file header at `:10-15` states plainly: *"NO CARD GENERATION here (Stage D, E5.7+)."* That comment
was written at E5.6, when Stage D did not yet exist; E5.7 built `generateCard` and never wired it in.

**What actually happens in production at this range:** a candidate is triaged (≈6 ¢), gets verdict `card`,
increments a counter, and is left at `triaging`. Thirty minutes later
`reclaimStaleTriagingCandidates` (`orchestrator.ts:154-155`) returns it to `new`. The next tick triages it
again. **No `insight_cards` row is ever written, `/opportunities` can only ever be empty, and every
`card`-verdict candidate is re-triaged indefinitely** — an unbounded spend loop that the daily cap merely
rate-limits rather than terminates.

This is the same failure mode §0.2 **A-2** was written to prevent, one file over: A-2 flagged the risk of a
function with zero production callers, and this session shipped a *new* one — the session's central
deliverable — in the same range.

**It is enshrined by a test.** `lib/signals/triage/orchestrator.test.ts:195` is titled *"a 'card' verdict is
counted but leaves the candidate claimed (no card generation this step)"*, so the broken state is locked in
as expected behaviour and CI is green on it.

**The close-out does not disclose it.** ADR `§15` (`9ddfe5a9:docs/decisions/0021-…md:1391-1431`) lists
"E5.7 Stage D card generation" as executed and claims "All 29 §11 constraints executed green in CI";
`docs/current-phase.md` claims the feed "implements all ten §9.2 states". Three §11 constraints
(`SIGNAL3-CARD-NO-POST-COPY`, `-CARD-EVIDENCE-TRACEABLE`, `-CARD-EVIDENCE-TENANT-BOUND`) are proved only
against a function nothing calls.

**What would close it.** Call `generateCard` from `triageOneCandidate` on the `card` verdict, passing the
`CardCitableContext` that `buildTriageTools` populates (`tools.ts:72`) — which the orchestrator currently
does not even construct (`orchestrator.ts:83` calls `buildTriageTools(client, businessId)` with the
two-argument form, so the citation context §4.6 depends on is never captured). Then rewrite
`orchestrator.test.ts:195` to assert a card **is** written and the candidate reaches `carded`, and confirm
it reddens with the call removed.

---

### MAJOR-1 — A-4′ is implemented inverted: the card is inserted unconditionally, then deleted if the claim is gone

**Citation:** `git show 9ddfe5a9:lib/signals/triage/card.ts:240-270`.

**Evidence.** The binding adjudication (session-28.md §0.2 A-4′; ADR §0.2, §4.1; §11's row) says: *"Stage
D's card insert is **conditional on the claim it consumes**; if the claim is gone, **zero rows, no card**."*
The shipped order is the reverse:

```
const card = await insertCard({ … })                                    // :240  unconditional
const transitioned = await setCandidateTriageOutcome(client, candidate.id, claimedAtIso, 'carded')  // :266
if (transitioned === null) { await deleteCardById(client, card.id); … } // :268  compensating delete
```

The comment at `:258-265` acknowledges the inversion and justifies it: `UNIQUE (signal_candidate_id)` would
otherwise permanently block a re-triage if an orphan card survived. That is a real problem — see the
ADJUDICATION REQUEST below — but the shipped resolution is a **non-atomic compensating delete**, not the
adjudicated conditional insert. A crash, a lost connection, or a failing `deleteCardById` between `:256` and
`:270` leaves a `status = 'pending'` card visible in the feed describing release text that no longer exists
— precisely the outcome A-4′ was chosen to make impossible ("a card can never describe text that changed
underneath it").

It also introduces a card DELETE path into a table the migration deliberately gave **no DELETE policy**
(`20260807100000_mode3_insight_cards.sql:152-158`, on the stated ground that "cards are the eval corpus's
history"); `deleteCardById` (`lib/db/insight-cards.ts:123`) reaches it via service-role.

**What would close it.** Either implement the adjudicated `INSERT … SELECT … WHERE status='triaging' AND
triage_claimed_at = $claim` shape and resolve the `UNIQUE` interaction (the ADJUDICATION REQUEST names the
options), or take the inversion back to the founder as an amendment to A-4′ with the crash window stated.
Either way the Tier-1 test must exercise the real function — see MAJOR-2.

---

### MAJOR-2 — `SIGNAL3-RESCORE-INVALIDATES-TRIAGE`'s card arm is EXECUTED-AND-PROVING-NOTHING

**Citation:** `git show 9ddfe5a9:supabase/__tests__/signals3-triage-state.test.ts:238-287`.

**Evidence.** The test builds its **own** SQL and asserts Postgres honours the `WHERE` clause it just wrote:

```
const result = await rawClient.query(
  `INSERT INTO public.insight_cards ( … )
     SELECT … FROM public.signal_candidates c
      WHERE c.id = $1 AND c.status = 'triaging' AND c.triage_claimed_at = $2
   RETURNING id`, [candidateId, claimedAt])
expect(result.rowCount).toBe(0)
```

Its own comment (`:260-263`) says why: *"Proven directly against live Postgres via the raw shape Stage D
will use, since no `lib/db/insight-cards.ts` helper exists yet at this step."* It was written at E5.2 and
never revisited at E5.7 — by which point the real Stage D had shipped a **different** shape (MAJOR-1).

This is ADR 0015 §1(c)'s named anti-pattern verbatim: *"`posts-approval-boundary.test.ts` asserted that a
hand-built Postgres query respected a `WHERE` clause the test itself constructed."* **Deleting the guard
from the real production function would not turn this test red, because the test never calls it.** The RPC
arm of the same constraint (`:213-235`) is genuine and reddens correctly; only the card arm is hollow.

**What would close it.** Call `generateCard` (once BLOCKER-1 is fixed) against a candidate whose claim was
invalidated by a real `upsert_signal_candidate` re-score, and assert zero `insight_cards` rows survive.
Demonstrate it reddens with the claim guard removed, then revert.

---

### MAJOR-3 — `SIGNAL3-TOOL-INVOCATION-EXPECTED` does not exist anywhere in the range

**Citation:** absence. `git grep -rn "TOOL-INVOCATION-EXPECTED\|toolInvocation\|expectedTool" 9ddfe5a9`
returns **no hits outside `docs/decisions/0021-…md` and `docs/decisions/0015-…md`**.

**Evidence.** §11 declares it Tier 2, *"Expected tool called ≥ once per fixture — **exact-match, not
statistical**"*. Amendment B1.2 names this exact constraint as one of the load-bearing examples of a
property that **must stay Tier 1/2** and must never be absorbed into the statistical gate. There is no test,
no assertion, and no helper implementing it — it is not merely `AUTHORED-NOT-EXECUTED`, it was never
authored.

Consequently ADR §15's *"All 29 §11 constraints executed green in CI"* and `docs/current-phase.md`'s
matching claim are **false**: the constraint is 0-for-3 on tier, test and job. And because the only thing in
the range that touches tool invocation at all is the eval harness, the property has in practice been left to
Tier E — which Amendment B(b) says *"is a finding, and a Reviewer must raise it as one."* This is that
finding.

**What would close it.** A Tier-2 case per `lib/signals/__fixtures__/triage/` fixture asserting the expected
tool's `execute` was called at least once (the seam already exists — `tool-runner.test.ts:122` uses it), and
correction of the two "29/29 green" claims.

---

### MAJOR-4 — the Tier-E merge gate is fused, not split: a threshold miss fails the job

**Citation:** `git show 9ddfe5a9:scripts/ci/assert-eval-executed.mjs:87-90`, invoked by
`git show 9ddfe5a9:.github/workflows/eval-triage.yml:82-84`.

**Evidence.**

```
if (artefact.metricsPass !== true) {
  console.error('::error::assert-eval-executed: one or more metrics fell below its floor …')
  failed = true
}
```

`failed` reaches `process.exit(1)` at `:92-94`, so **a purely statistical threshold dip fails the only job
in the workflow.** Amendment B3 and ADR §10.4 split the gate deliberately, and B3.1 calls the split "the
point": `eval-reported` is REQUIRED and *"fails **only** when its in-job applicability step said applicable
and no artefact with the metrics + run URL was produced"*; `eval-threshold` is **ADVISORY** — *"the metrics
themselves never block a merge."* Neither check exists as a separate reportable status; there is one job,
and it enforces both.

The consequence is exactly what D-8 and B3.1 argue against: once `eval-reported` is promoted to required,
a non-deterministic statistical result becomes merge-blocking, and — in this repo's own words — *"a gate
people learn to ignore is worse than no gate at all."* The step is even named *"Assert the metrics artefact
was produced **and is green**"*, so the fusion was deliberate rather than accidental.

**What would close it.** Split into two jobs (or two steps with separate check names): `eval-reported`
asserting artefact existence + metrics + run URL and nothing else; `eval-threshold` reporting
`metricsPass` **without** a non-zero exit. Everything else in the guard — the corpus minimum at `:60-65`,
the executed-count check at `:67-73`, and the errored-example third state at `:75-85` — is correct as
specified by B2.4 and should not change.

---

### MAJOR-5 — `SIGNAL3-TOOL-RESULTS-GUARDED`'s scan cannot fail for the file that performs the prohibited operation, and its second case is a tautology

**Citation:** `git show 9ddfe5a9:lib/signals/triage/source-scans.test.ts:51-77`; the operation itself at
`git show 9ddfe5a9:lib/ai/tool-runner.ts:346`.

**Evidence.** ADR §7.3 and session-28.md §2 both state the rule against **the dispatcher**: *"⚠️ **The
dispatcher must never `JSON.stringify(toolOutput)` into a `tool_result` block** — that is
`SIGNAL3-TOOL-RESULTS-GUARDED`, an executable scan."* The dispatcher does exactly that:

```
content: JSON.stringify(toolResult),      // lib/ai/tool-runner.ts:346
```

The scan is scoped to `lib/signals/triage/tools.ts` alone (`:58`, `:60-64`), explicitly excluding
`lib/ai/tool-runner.ts` — the one file the rule names. **The scan is structurally incapable of failing for
the violation it was written to catch.** Its second case is worse:

```
it("every tool in tools.ts returns already-guarded fields — the semantic half this scan alone cannot prove …", () => {
  expect(true).toBe(true)      // :76
})
```

A tautology that reports as a passing test in a required job.

**In fairness, the substantive property largely holds by a different mechanism.** Every untrusted string a
tool returns is neutralised inside `execute()` before the stringify (`tools.ts:91, :104, :116, :118,
:131-133`), and `tools.test.ts:70-126` proves neutralisation for `list_audience_notes`,
`list_brand_claims` and `list_recent_campaigns.name` with cases that would redden if a wrap were removed.
So I am not claiming an exploitable injection here. I am claiming the **constraint as declared is not
enforced**: a fifth tool, or a new field on an existing one, that returned raw text would ship green.

**What would close it.** Either extend the scan to `lib/ai/tool-runner.ts` and amend §7.3 to state the
guarantee as "guarded at the tool boundary, serialised by the dispatcher" (the design the code actually
implements), or move the serialisation guarantee somewhere a scan can assert. Delete `expect(true)
.toBe(true)` — a pointer belongs in a comment, never in an assertion.

---

### MAJOR-6 — `OpportunityFeed.tsx` has no test: the ten §9.2 states are AUTHORED-NOT-EXECUTED

**Citation:** `git show 9ddfe5a9:app/[locale]/(dashboard)/opportunities/page.test.tsx:16` —
`vi.mock('./OpportunityFeed', () => ({ OpportunityFeed: () => null }))`.

**Evidence.** `git grep -n "OpportunityFeed" 9ddfe5a9` shows the component is imported only by `page.tsx`
and is **mocked to `() => null`** in the sole page test. There is no `OpportunityFeed.test.tsx`. The range's
four test files on this surface cover Server Actions (`actions.test.ts`), auth/capability redirects
(`page.test.tsx`), i18n key parity (`opportunities-i18n.test.ts`) and source scans — **none renders the
component.**

387 lines of the entire user-facing surface are therefore unexecuted, including every property §9.2 names
as binding: the two *different* empty states (`:155-170`), triage-failed (`:129-134`), triage-paused
(`:137-142`), high-sensitivity's warning band and second confirmation (`:223-230`, `:285-290`), expired
(`:293`), saved (`:296-298`), approved-and-in-flight (`:302-313`), the `already_triaged` re-render of that
card's real state (`:70-74`, `:88-90`, `:104-106`), and the `aria-live` announcements (`:124-126`).

The state *machine* is genuinely covered at the action layer — `actions.test.ts:90` proves the typed
`already_triaged` outcome and `:139-176` proves the capability gate on all three actions. That is the
server half. The rendering contract §9.2 specifies is the client half, and it has nothing. Meanwhile
`docs/current-phase.md` states the feed "implements all ten §9.2 states" — authored, not executed.

**What would close it.** A render test per §9.2 state driving the real component through the props that
select it, plus a case asserting the `already_triaged` path patches that card's status rather than showing a
generic error. Each must be shown to redden against the corresponding branch's removal.

---

### MAJOR-7 — `TRIAGE_MAX_WALL_CLOCK_MS` is not an upper bound, so E-2's deadline invariant does not hold

**Citation:** `git show 9ddfe5a9:lib/ai/tool-runner.ts:241-248, :56, :64, :156-172`; the orchestrator's
reserve at `git show 9ddfe5a9:lib/signals/triage/orchestrator.ts:180`.

**Evidence.** The wall-clock check runs at the **top of each turn** (`:244`). The request that follows is
bounded only by `TRIAGE_REQUEST_TIMEOUT_MS = 30_000` (`:64`), and `callWithRetryBudget` (`:156-172`) applies
that timeout **per attempt**, recursing up to `TRIAGE_RETRY_BUDGET = 2` times with `RETRY_DELAY_MS = 2000`
between them. So a turn entered at 44.9 s can legitimately run:

`30 s + 2 s + 30 s + 2 s + 30 s = 94 s` → **loop worst case ≈ 139 s, not 45 s (≈3.1×).**

The orchestrator's deadline check reserves exactly one `TRIAGE_MAX_WALL_CLOCK_MS`:

```
if (deadlineHit || TICK_MAX_DURATION_MS - (Date.now() - startedAt) < TRIAGE_MAX_WALL_CLOCK_MS) {   // :180
```

so a candidate can be claimed at t≈255 s believing 45 s suffices and still be running at t≈394 s — past
`TICK_MAX_DURATION_MS = 300_000` (`:42`) and past Sentry's `maxRuntime: 295` (`:217`). E-2's adjudication
exists precisely to make the ceiling *"an invariant in code rather than arithmetic in a table"*; the
re-check before each claim is implemented faithfully, but the quantity it reserves is not an upper bound, so
the invariant it was meant to establish does not hold.

Blast radius is bounded — a killed function leaves the candidate at `triaging`, which the 30-minute stale
sweep reclaims — so this is not data loss. It is the stated guarantee not being true.

**What would close it.** Either reserve the true worst case
(`TRIAGE_MAX_WALL_CLOCK_MS + TRIAGE_RETRY_BUDGET × (TRIAGE_REQUEST_TIMEOUT_MS + RETRY_DELAY_MS)`) in
`orchestrator.ts:180`, or — better — enforce the loop deadline *inside* `callWithRetryBudget` by passing the
remaining loop budget into `withTimeout`, so `TRIAGE_MAX_WALL_CLOCK_MS` becomes a genuine ceiling. A Tier-2
case with a fixture that times out twice should assert the loop returns within the bound.

---

### MINOR-1 — ADR 0015 Amendment B and session-28.md §0.2/§2 are untracked at the range head

**Citation:** `git show 9ddfe5a9:docs/decisions/0015-test-execution-and-ci-gates.md | grep -ci "amendment b"`
→ `0`; `git show 9ddfe5a9:docs/build-guide/session-28.md` has no `## §0.2` heading and 631 lines against the
working tree's 1493.

**Evidence.** L-10 makes Amendment B *"a named deliverable of the Architect phase… Not a follow-on, not a
ticket"*, and ADR §15 asserts it "landed in this same commit range (prior session)". It did not land in any
commit: `git log -- docs/decisions/0015-…md` ends at `0e966791`, which predates the range and contains no
Amendment B. The governing scope document (§0.2's six adjudications, §2's thirteen steps) is likewise
working-tree-only. Every "the ADR/amendment requires…" claim in this session's docs currently rests on
untracked text, and a fresh clone of `9ddfe5a9` would not contain the category `SIGNAL3-TRIAGE-QUALITY` is
declared under.

**What would close it.** Commit both files at 28-D's `D0` step, as sessions 23-D/25-D/27-D did, and correct
§15's "prior session" attribution.

---

### MINOR-2 — the close-out cites CI runs for `0ffe6acf`, not the range head, and one Tier-1 test post-dates the cited evidence

**Citation:** `git show 9ddfe5a9:docs/decisions/0021-…md:1399-1405`;
`git show --stat 9ddfe5a9` (adds `supabase/__tests__/signals3-triage-atomic.test.ts`, 136 lines).

**Evidence.** §15 and `docs/current-phase.md` cite `app-tests` 31405593195, `db-tests` 31405592573
(29 files / 278 tests) and `eval` 31405593644, all at head `0ffe6acf`. But
`git cat-file -e 0ffe6acf:supabase/__tests__/signals3-triage-atomic.test.ts` → *exists on disk, but not in
'0ffe6acf'* — the file proving `SIGNAL3-TRIAGE-ATOMIC` was added by `9ddfe5a9` itself. **The cited run
provably did not execute it.** The correct evidence does exist (`db-tests` 31410191972, 30 files /
279 tests, quoted in this report's header); it is simply not the evidence cited.

**What would close it.** Re-cite the `9ddfe5a9` runs with their skip-guard file/test counts.

---

### MINOR-3 — the `eval-reported` promotion tally is redefined as not-`master`-gated, contradicting E-1 and its own ADR

**Citation:** `git diff a153feaa..9ddfe5a9 -- docs/current-phase.md`, the "Eval-reported tally" paragraph.

**Evidence.** The entry reads: *"Unlike the `db-tests` promotion tally, this is not gated on `master` —
`eval-triage.yml` runs on every PR by design."* E-1 says the opposite and says it twice: *"`eval-reported`
is promoted, not required on day one: advisory-but-must-be-read until three consecutive green `master`
runs, exactly as `db-tests`"* (session-28.md §0.2), echoed at ADR §10.4 and Amendment B3. "Runs on every PR"
and "promotes on three green `master` runs" are not in tension — `db-tests` also runs on every PR — so the
stated reason does not support the changed rule.

**What would close it.** Restore the `master`-run-only tally and reset the count to 0 of 3, matching
`db-tests`.

---

### MINOR-4 — ADR §2.4/§2.7's "the token cap counts retries" is contradicted by the shipped code and left unamended

**Citation:** `git show 9ddfe5a9:docs/decisions/0021-…md:296-297, :352-358` vs
`git show 9ddfe5a9:lib/ai/tool-runner.ts:42-53`.

**Evidence.** §2.7 states *"The token cap counts **billed** tokens including retries, so a retry storm trips
fail-closed rather than overspending — that is a feature."* The code states the opposite and explains why:
a failed attempt yields no response, so there is no `usage` to read; only a turn's resolved response is
counted, once. The code is right; the ADR describes a protection that does not exist. The Builder was
instructed to *"write the comment saying so"* (§2's transcription list) and instead corrected the claim in
code, attributing it to security-reviewer LOW-1 — the right call, but the ADR was never amended to match, so
§2.7's justification for `TRIAGE_RETRY_BUDGET = 2` now rests on a mechanism the code disclaims.

**What would close it.** Amend §2.4/§2.7 to state what `tool-runner.ts:42-53` states, and re-derive the
retry budget's justification from wall-clock and attempt count rather than token accounting.

---

### MINOR-5 — §7.5's assessment/evidence distinction covers one field and misses the two most prominent ones

**Citation:** `git show 9ddfe5a9:app/[locale]/(dashboard)/opportunities/OpportunityFeed.tsx:237-261`.

**Evidence.** `card.audience` is marked as the model's assessment (`:251` — italic, muted, `title` attr).
`card.observation` (`:239`) and `card.why_it_matters` (`:244`) are equally unverified model prose generated
from attacker-influencable release text, and render **unmarked, first, in normal body text**. The
"verified evidence" block (`:256-261`) renders `card.evidence.length` — a **number** — so the one element
carrying the oracle shows no content at all. §7.5 requires unverified prose be *"rendered as the model's
assessment, visually distinct from the verified evidence block"*; as built, the visual weight runs the
opposite way. Separately, `title` is not reliably exposed to assistive technology and is not
keyboard-reachable, so the distinction is conveyed by italics and colour rather than text — the same class
of problem §9.3 names for sensitivity.

**What would close it.** Apply the assessment affordance — as visible text, not a `title` — to
`observation` and `why_it_matters`, and render the verified evidence's content rather than its count.

---

### MINOR-6 — §9.3's contrast floor is unproven for this surface, and the bands bypass the token system

**Citation:** `git grep -ln "globals.css" 9ddfe5a9 -- '*.test.ts*'` → only
`app/[locale]/(dashboard)/approvals/ApprovalsInbox.test.tsx`; the colours at
`OpportunityFeed.tsx:138-140, :257-259, :286-289, :297`.

**Evidence.** §9.3 requires *"WCAG-AA in BOTH themes against the shipped `app/globals.css` tokens (never a
hand-transcribed copy)"*. No test on the `/opportunities` surface reads `globals.css`; the Session 22-D
precedent that established the pattern exists and was not applied. Compounding it, the status bands use raw
Tailwind palette values (`amber-50/200/800`, `emerald-50/200/800`, `sky-700`) rather than design tokens, so
there is no token to test against for exactly the elements that carry warning semantics.

**What would close it.** Move the bands onto `globals.css` tokens and add a contrast assertion that reads
the shipped token file at test time, per §1(c)'s `ApprovalsInbox` remedy.

---

### MINOR-7 — the "approved and in flight" state's link is inert, so the three-gate count is not legible

**Citation:** `git show 9ddfe5a9:app/[locale]/(dashboard)/opportunities/OpportunityFeed.tsx:302-313`.

**Evidence.** §9.2 requires the state to link *"to the brief AND say it still needs review — the three-gate
count must be LEGIBLE"*. The implementation renders a non-interactive `<span>` with
`cursor-not-allowed opacity-60` whose visible text and `title` are the same key
(`status.approvedLinkPendingHint`, `:308` and `:310`). ADR §15 discloses this honestly as a schema gap
(`insight_cards` carries no `campaign_id`, and Stage F writes none back), which is why this is MINOR rather
than MAJOR — but the state as shipped does not meet the contract.

**What would close it.** Either the `campaign_id` write-back (a migration + a Stage F change, so plausibly
28-D scope or a follow-on), or an explicit §9.2 amendment recording the reduced state.

---

### MINOR-8 — the two close-out documents describe the same eval number in contradictory terms

**Citation:** `git diff a153feaa..9ddfe5a9 -- docs/current-phase.md` ("**First real eval result** (not a
hand-authored bootstrap number …)") vs `git show 9ddfe5a9:docs/decisions/0021-…md:1424-1427` ("a
**bootstrap ceiling** (hand-authored cassettes scored against their own hand-assigned labels), not evidence
of real triage quality").

**Evidence.** Both were written in the same commit about the same 1.000/1.000/1.000 result.
`current-phase.md` then immediately concedes "the corpus's ceiling-by-construction caveat from E5.8 still
applies", contradicting its own opening clause. Amendment B2.3 makes `current-phase.md` the place a reviewer
reads the number; it should not need the ADR to correct it.

**What would close it.** Drop "(not a hand-authored bootstrap number)" and use §15's framing.

---

### NIT-1 — `lib/ai/runner.ts` is modified, against "runPrompt is NOT modified"

`git diff a153feaa..9ddfe5a9 -- lib/ai/runner.ts` adds `CARD_GENERATION_PROMPT_ID` to `isScoringOnly`
(`:42-50`). The spirit of §2.1 is intact — no tool-dispatch branch, and existing prompt ids behave
identically — and the change is correct (a triage card should not consume trial post quota). But §2.1 and
session-28.md §2 both assert the file is untouched, and it isn't. Worth a one-line ADR note.

### NIT-2 — `TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN`'s comparison is unreachable in production

`lib/ai/tool-runner.ts:261` sets `max_tokens: TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN`, so the API cannot return
`output_tokens > 1024`; the comparison at `:299` can only fire against a fixture the provider cannot emit
(`lib/signals/__fixtures__/triage/oversized-output-per-turn.json` declares `output_tokens: 2000` with
`stop_reason: "end_turn"`). The real production signal is `stop_reason === 'max_tokens'` at `:309`. The
guard is defensible defence-in-depth against a provider contract change, and its test does redden if
deleted — but §11's "each bound breached in its own fixture case" should say which bound is structurally
unreachable.

### NIT-3 — a mutable global back-door in production source

`lib/ai/client.ts:27-40, :52-54` adds `globalThis.__evalCassetteQueue`, consumed by `MockAnthropicClient`.
It is inert unless `AI_PROVIDER=mock` and the rationale is sound, but a `declare global` mutable queue plus a
`as Anthropic.Message` cast in `lib/ai/` is a test seam living in production source. Worth a note in §10.4.

### NIT-4 — the eval guard hardcodes `corpus.v1.json`

`scripts/ci/assert-eval-executed.mjs:20` pins `CORPUS_PATH`. A `corpus.v2.json` would leave the pre-run
minimum check reading a stale file. Resolve the path from the artefact's `corpusVersion`.

### NIT-5 — `is_prerelease` added to a Session 27 join

`lib/db/signal-candidates.ts` widens the `signals(...)` select. Additive, read-only, and disclosed in-code
with the same drift-correction rationale as A-3's `tag_name`. Not a schema change, so not an L-1 breach —
but ADR 0020 §13.1's join list now needs the same amendment note A-3 got.

### NIT-6 — two tool fields are wrapped but not asserted, and `list_evidence` has no neutralisation case

`tools.ts:132-133` wraps `objective` and `specialInstructions`, but `tools.test.ts:93-126` asserts only
`name`. `list_evidence` has no injection case at all (its content path goes through
`wrapEvidenceForPrompt`, which is separately guarded). Removing either unasserted wrap would ship green.

---

## ADJUDICATION REQUEST — `UNIQUE (signal_candidate_id)` and A-4′'s conditional insert are in tension

This is a disagreement with the **ADR**, not the code, so I raise it rather than file it.

A-4′ specifies a card insert conditional on the claim. `20260807100000_mode3_insight_cards.sql:19` makes
`signal_candidate_id` UNIQUE (the `ON CONFLICT` arbiter, per ADR 0020 §3.4's lesson). The Builder found the
interaction the ADR did not model and recorded it at `card.ts:258-265`: if a conditional insert ever *does*
write a row that is later orphaned, `UNIQUE` blocks the candidate from ever being carded again. The shipped
insert-then-delete avoids that at the cost of the crash window in MAJOR-1.

Both properties cannot hold with the current schema and a two-statement flow. The options, for the founder:

1. **One statement** — `INSERT … SELECT … WHERE status='triaging' AND triage_claimed_at=$claim` with
   `ON CONFLICT (signal_candidate_id) DO NOTHING`, which restores A-4′ literally and makes the orphan case
   unreachable. My recommendation; it is the guarded-upsert shape the reservation RPC already uses.
2. **Wrap the insert and the claim consumption in one transaction** (an RPC), which also restores atomicity.
3. **Accept the compensating delete** and amend A-4′ to state the crash window explicitly, as an accepted
   named limit in §7.5's style.

The ADR is binding until the founder changes it; 28-D should not pick option 3 by default simply because it
is what shipped.

---

## Coverage table (constraint → category → CI job → verdict)

`db-tests` = run 31410191972 at `9ddfe5a9`; `app-tests` = run 31410192007; `eval` = run 31410191914.

| # | Constraint | Cat. | CI job | Test | Verdict |
|---|---|---|---|---|---|
| 1 | `SIGNAL3-TRIAGE-BOUNDED` | 2 | app-tests | `lib/ai/tool-runner.test.ts:149-241` | **COVERED** (see NIT-2) |
| 2 | `SIGNAL3-FAIL-CLOSED` | 2 | app-tests | `lib/ai/tool-runner.test.ts:128-241` | **COVERED** |
| 3 | `SIGNAL3-TOOLS-READ-ONLY` | 2 (scan) | app-tests | `lib/signals/triage/source-scans.test.ts:35-49` | **COVERED** — backing fns verified read-only by hand |
| 4 | `SIGNAL3-TOOLS-TENANT-BOUND` | **1**+2 | db-tests + app-tests | `signals3-triage-tools.test.ts:118-171`; `tools.test.ts:44-57` | **COVERED** — strongest in range |
| 5 | `SIGNAL3-TOOL-RESULTS-GUARDED` | 2 (scan) | app-tests | `source-scans.test.ts:51-77` | **EXECUTED-AND-PROVING-NOTHING** — MAJOR-5 |
| 6 | `SIGNAL3-AI-LAYER-ROUTED` | 2 (scan) | app-tests | `lib/signals/ai-layer-routed.test.ts:49-70` | **COVERED** — has a staleness canary |
| 7 | `SIGNAL3-COST-CEILING-ATOMIC` | **1** | db-tests | `signals3-triage-state.test.ts:107-148` incl. first-call-of-day `:126` | **COVERED** |
| 8 | `SIGNAL3-CLAIM-RECLAIMABLE` | 1 | db-tests | `signals3-triage-state.test.ts:166-209` (both arms) | **COVERED** |
| 9 | `SIGNAL3-RESCORE-INVALIDATES-TRIAGE` | **1** | db-tests | RPC arm `:213-235` ✓ / card arm `:238-287` ✗ | **PARTIAL** — MAJOR-2 |
| 10 | `SIGNAL3-TICK-DEADLINE-BOUNDED` | 2 | app-tests | `orchestrator.test.ts:128` | **COVERED as written** — but see MAJOR-7 |
| 11 | `SIGNAL3-BACKFILL-AGE-GATED` | 2 | app-tests | `orchestrator.test.ts:116` | **COVERED** |
| 12 | `SIGNAL3-CARD-NO-POST-COPY` | 2 | app-tests | `validate.test.ts:17-88`; scan `opportunities/source-scans.test.ts:82-91` | **COVERED** — but guards a function nothing calls (BLOCKER-1) |
| 13 | `SIGNAL3-CARD-EVIDENCE-TRACEABLE` | 2 | app-tests | `verify.test.ts` (three arms) | **COVERED** — same caveat |
| 14 | `SIGNAL3-CARD-EVIDENCE-TENANT-BOUND` | **1**+2 | db-tests + app-tests | `signals3-card-evidence-tenant.test.ts:70-95`; `card.ts:221-225` | **COVERED** — count equality confirmed |
| 15 | `SIGNAL3-NEVER-AUTONOMOUS` | 3+2 | app-tests | `opportunities/source-scans.test.ts:56-91`; §10.3 diff record | **COVERED** |
| 16 | `SIGNAL3-TRIAGE-ATOMIC` | **1** | db-tests | `signals3-triage-atomic.test.ts` | **COVERED at `9ddfe5a9`** — not in the cited run (MINOR-2) |
| 17 | `SIGNAL3-TRIAGE-LEGAL-TRANSITION` | **1** | db-tests | `signals3-schema.test.ts` | **COVERED** — trigger + conditional UPDATE both present |
| 18 | `SIGNAL3-CARD-EXPIRES` | 1+2 | db-tests + app-tests | `signals3-schema.test.ts`; `insight-cards-expired.test.ts`; `actions.test.ts:124` | **COVERED** |
| 19 | `SIGNAL3-DISMISS-REASON-ENUM` | 1+2 | db-tests + app-tests | `signals3-schema.test.ts`; `opportunities-i18n.test.ts:39-49` | **COVERED** — en/pt/es parity asserted |
| 20 | `SIGNAL3-INJECTION-GUARDED` | 2 | app-tests | `tools.test.ts:70-126`; `card.test.ts` | **COVERED** (see NIT-6) |
| 21 | `SIGNAL3-RLS-ISOLATED` | **1** | db-tests | `signals3-schema.test.ts` (mirrored + WITH CHECK) | **COVERED** |
| 22 | `SIGNAL3-CASCADE-COMPLETE` | **1** | db-tests | `signals3-schema.test.ts`; §D2.5 rows present in-range | **COVERED** |
| 23 | `SIGNAL3-PURGE-COVERED` | **1** | db-tests | `signals3-schema.test.ts` | **COVERED** |
| 24 | `SIGNAL3-CAPABILITY-GATED` | 2 | app-tests | `actions.test.ts:139-176` (all three actions) | **COVERED** |
| 25 | `SIGNAL3-SEED-ONLY-NO-GENERATION` | 3 (diff) | — | ADR §10.3's verification table | **COVERED** (Tier-3 decision, properly enumerated) |
| 26 | `SIGNAL3-MODE2-UNCHANGED` | 2 | app-tests | `rubric.test.ts:150-200`; `brief.test.ts` unchanged | **COVERED** |
| 27 | `SIGNAL3-RUBRIC-UNCHANGED` | 2 | app-tests | `rubric.test.ts:156-202` — exact-string equality, ten-dimension schema | **COVERED** — exemplary |
| 28 | `SIGNAL3-TOOL-INVOCATION-EXPECTED` | 2 | **none** | **none** | **NOT AUTHORED** — MAJOR-3 |
| 29 | `SIGNAL3-TRIAGE-QUALITY` | **E** | eval | corpus v1, 40 examples | **MEASURED** — precision 1.000 (24/24), recall 1.000 (24/24), dismiss-match 1.000 (16/16), run [31405593644](https://github.com/tcr430/SOSH/actions/runs/31405593644). A bootstrap ceiling, never COVERED. |

**Tier-E discipline (Amendment B1.2, B(b)).** Exactly one constraint is Tier E ✓. The harness is **absent**
from `vitest.config.ts`'s `include` — not present-but-skipped ✓ (`test:eval` is `tsx
scripts/eval/run-triage-eval.ts`, outside every glob). `assert-eval-executed.mjs:75-85` treats an errored
example as a **job-failing third state**, never coerced to a verdict ✓. `eval-triage.yml` has **no
workflow-level `paths:` filter**, with applicability decided in-job at `:26-47` ✓ (E-1 honoured). The first
result **is** recorded in `docs/current-phase.md` as a number with `corpusVersion` and run URL ✓ (B2.3).
**But** the required/advisory split is fused (MAJOR-4), and one constraint B1.2 explicitly reserves for
Tier 2 has in practice been left to the statistical gate by never being written at all (MAJOR-3).

**The six adjudications.** **A-1** ✓ genuinely additive — ten dimensions, no rename, no output-schema
change, proved by byte-identical fixture equality (`rubric.test.ts:156-202`). **A-2** ✓ the binding Tier-1
condition is real: `supabase/__tests__/signals3-seed.test.ts:139-164` drives `seedCampaignFromCard` →
`assembleBrief` against live Postgres with a real auth context and asserts a real brief row, plus the
missing-rows path at `:166-167`. Not discharged with a mock. **A-3** ✓ no `tag_name` anywhere in the range.
**A-4′** ✗ RPC arm correct, card arm inverted and its test hollow — MAJOR-1, MAJOR-2. **E-1** ~ workflow
shape correct, gate split not implemented — MAJOR-4, MINOR-3. **E-2** ~ `45_000` and the per-claim re-check
are both present, but the reserve is not an upper bound — MAJOR-7.

**SHARED-FUNCTION CALLERS (greps re-run at the range).** `assembleBrief` — one production caller,
`lib/signals/seed.ts:75`, covered by `lib/signals/seed.test.ts:84` (Tier 2) **and**
`supabase/__tests__/signals3-seed.test.ts:139` (Tier 1); `lib/campaigns/brief.test.ts:155-225` covers the
definition. **Every caller has a listed test.** `rubricPrompt` — three production callers:
`lib/campaigns/brief.ts:170` (covered, `brief.test.ts`), `lib/campaigns/generate.ts:263` (covered,
`generate.test.ts`), `lib/signals/triage/card.ts:227` (covered by `card.test.ts`, but that caller is itself
unreachable in production — BLOCKER-1); plus the schema derivation at `lib/studio/categories.ts:2,19`,
untouched and proved untouched by `rubric.test.ts:198-201`. **No caller is unlisted.**

**GDPR.** Two §D2.5 cascade rows land in the same range as the migration ✓
(`docs/decisions/0010-legal-surface.md`, `insight_cards` and `signal_triage_budget`). Cascade and
`purge_business` proved at Tier 1 ✓. **No `BEFORE DELETE` trigger on either table** ✓
(`20260807100000_mode3_insight_cards.sql:89-93, :114`, both with the reason recorded).

**Scope.** Clean. `git diff --name-only a153feaa..9ddfe5a9` touches no poller, watch list, scorer,
`lib/social/**`, or `campaigns.origin`; `package.json`'s only change is a `test:eval` script (`tsx` was
already a devDependency at `:80`). No `@anthropic-ai/sdk` import under `lib/signals/**`. No card field
reaches `posts.content`. The one Session 27 edit — `is_prerelease` added to a join — is additive and
disclosed (NIT-5).

**DB guarantees.** Concurrency (atomic conditional UPDATE, `lib/db/insight-cards.ts:164`) and legality
(`BEFORE UPDATE` trigger, migration `:81-83`) are **both** present and both tested — not conflated. The
reservation RPC's Tier-1 test **includes the first-call-of-day case** (`signals3-triage-state.test.ts:126`),
the one that would have caught `[db-BLOCKER-1]`. The feed index carries `INCLUDE (expires_at)`
(migration `:134-137`) and `lib/db/insight-cards.ts:29-31`'s `ORDER BY` matches it exactly
(`score DESC, occurred_at DESC, id ASC`). The migration is additionally *stronger* than specified: a
column-scoped `GRANT UPDATE (status, dismiss_reason)` (`:178`) narrows the writable surface beyond what §5.3
asked for.

---

**Summary: 1 BLOCKER, 7 MAJOR, 8 MINOR, 6 NIT, 1 ADJUDICATION REQUEST.** The schema, RPC, tenancy and
rubric work in this range is strong and in several places exceeds its brief. The defect that matters is
BLOCKER-1: the pipeline's terminal stage was built, tested in isolation, and never connected, so nothing
this session ships can produce a card — and a passing test at `orchestrator.test.ts:195` records that
absence as intended behaviour.

## CORRECTION PASS (Session 28-D)

Author: Claude (Session 28-D, D0–D9 correction pass). This appendix records resolutions against the
findings above **by reference only** — nothing above this heading is edited, reworded, or reordered
(CLAUDE.md REVIEWER-REPORT APPEND-ONLY). Findings declined or disputed are argued here, never erased. Each
row: finding → fix → test → commit.

### D0 — MINOR-1

**Fix:** Committed `docs/decisions/0015-test-execution-and-ci-gates.md` (Amendment B), `docs/build-guide/session-28.md`
(entering git with §0.2/§2/§3/§4 already authored — §4 is D0's own work order and could not land later),
and this reviewer report itself, all three exactly as they stood in the working tree, in one commit, with
no resolution row appended in that same commit (so the immutable text and this appendix are provably in
different commits).
**Test:** N/A — Tier 3, diff-verified. Proof is `git show <sha>:docs/decisions/0015-test-execution-and-ci-gates.md | grep -ci "amendment b"` returning non-zero at the new head (verified: **3**), and `git status` showing all three paths clean post-commit.
**Commit:** `632a4b5e`

### D1 — BLOCKER-1

**Fix:** `lib/signals/triage/orchestrator.ts` — `triageOneCandidate` now constructs a `CardCitableContext`
via `createCardCitableContext()` and passes it as `buildTriageTools`'s third argument (was the two-argument
form, so `tools.ts`'s citation-capture side effect was dead code). On `result.decision.verdict === 'card'`,
it calls `generateCard({ client, context, candidate, claimedAtIso, decision: result.decision, citable })`.
`generateCard`'s typed outcome is now fully handled: `'inserted'` increments `summary.carded`; any
`'skipped'` reason (`citations_rejected`, `evidence_tenant_mismatch`, `validation_failed`, `claim_lost`)
increments a new field, `summary.cardSkipped`, added to `TriageTickSummary` and to the canonical tick log
line — never miscounted as `carded`. The stale `:10-15` header comment ("NO CARD GENERATION here… Stage
D's card insert transitions it to 'carded'") and the `:97-99` placeholder comment ("Left at 'triaging' —
see this file's header comment") are both replaced with an accurate description of the wiring: Stage D
(`generateCard`) owns the terminal `'carded'` transition itself, atomically with its own insert (A-4′/A-5);
a `'skipped'` outcome leaves the candidate at `'triaging'` for the stale-claim reclaim sweep to self-heal,
the same fail-closed shape as a bound breach (§2.5). Neither the fail-closed contract (a bound breach in
`runToolLoop` still produces no card) nor L-5 (Stage D stays outside the loop, called after `runToolLoop`
returns) were touched. **ai_usage write confirmed, not coded**: `generateCard` calls `runPrompt`
(`cardGenerationPrompt` and `rubricPrompt`), which inherits `lib/ai/runner.ts`'s existing finally-block
`ai_usage` write — no new write path was needed or added.
**Test:** `lib/signals/triage/orchestrator.test.ts` — the old `:195` case
(*"a 'card' verdict is counted but leaves the candidate claimed (no card generation this step)"*) asserted
the defect as intended behaviour and was green on the bug; it is **deleted**, not weakened. Replaced with
two cases: (1) *"a 'card' verdict calls generateCard with the captured CardCitableContext, and a real
insert reaches 'carded'"* — asserts `buildTriageTools` was called with a third-argument `CardCitableContext`
(`evidence`/`brandClaims` `Map`s), asserts `generateCard` was called with the candidate/claimedAtIso/decision/citable,
and asserts `summary.carded === 1` on an `'inserted'` result; (2) *"a 'skipped' generateCard outcome is NOT
a card…"* — asserts `summary.carded === 0`, `summary.cardSkipped === 1`, and no direct
`setCandidateTriageOutcome` call from the orchestrator on either path (Stage D, mocked here, owns that).
Both cases were manually mutated and observed to redden: removing the `generateCard` call (reverting to
`summary.carded++` inline) failed both new tests; independently reverting the three-argument
`buildTriageTools(client, businessId, citable)` back to the two-argument form failed the
`CardCitableContext` assertion specifically. Both mutations were then reverted. `npx tsc --noEmit --skipLibCheck`
clean; `npx vitest run lib/signals/triage/orchestrator.test.ts` — 8/8 green; the broader sweep
(`lib/signals lib/ai lib/db lib/social lib/validation`) — 1184/1184 green, with one pre-existing,
unrelated failure (`lib/signals/orchestrator.test.ts`, Stage C's poller test — missing
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in this
shell's env, confirmed identical at the D0 commit before any D1 change via `git stash`). `npm run test:db`
could not execute in this shell for the same reason (no Supabase/Postgres env configured locally) — D1
touches no SQL/migration and modifies no Tier-1 test file, so this is a pre-existing environment gap, not
a D1 regression; flagged here rather than silently skipped.
**Commit:** `95226fa9`

### D2 — MAJOR-1 / A-5 (ADJUDICATION REQUEST) + MAJOR-2

**A-5 ruling (recorded here for the record — already binding before this step ran):** the single-statement
conditional insert. `INSERT … SELECT … FROM signal_candidates c WHERE c.id = $1 AND c.status = 'triaging'
AND c.triage_claimed_at = $2 ON CONFLICT (signal_candidate_id) DO NOTHING RETURNING id` — zero rows, no
card, if the claim is gone. The compensating delete (and `deleteCardById` with it) is the named loser: it
is non-atomic, and a crash, a lost connection or a failing `deleteCardById` between the insert and the
claim consumption leaves a `pending` card in the feed describing release text that no longer exists — the
exact outcome A-4′ was chosen to make impossible.

**Fix (MAJOR-1):** the literal SQL sketch in the ADJUDICATION REQUEST reads the claim (`SELECT … FROM
signal_candidates c WHERE …`) without itself *consuming* it — but A-4′'s contract ("carded, set by Stage D,
on a successful card insert") requires the candidate to actually transition, and a read-only guard alone
would leave `signal_candidates.status` stuck at `'triaging'` forever even after a successful card insert.
The implementation therefore folds BOTH facts — "was the claim still live" and "does the card now exist" —
into ONE SQL statement via a writable CTE: `supabase/migrations/20260807120000_insight_card_claimed_insert.sql`
defines `insert_insight_card_if_claimed`, whose body is `WITH claimed AS (UPDATE signal_candidates SET
status = 'carded', triage_claimed_at = NULL WHERE id = $1 AND status = 'triaging' AND triage_claimed_at =
$2 RETURNING business_id, id) INSERT INTO insight_cards (…) SELECT … FROM claimed ON CONFLICT
(signal_candidate_id) DO NOTHING RETURNING *` — one statement, one implicit transaction, so the claim
consumption and the card insert either both happen or neither does. `lib/db/insight-cards.ts`'s `insertCard`
now calls this RPC and returns a typed `InsertCardResult` (`{ outcome: 'inserted'; card }` or `{ outcome:
'claim_lost' }`) instead of throwing on the fail-closed path. `business_id` is no longer a caller-supplied
field on the insert at all — the RPC derives it from `signal_candidates` itself, inside the same statement,
so it structurally cannot diverge from the parent row (stronger than the old app-level equality check).
`deleteCardById` is deleted from `lib/db/insight-cards.ts` entirely; `git grep -n "deleteCardById"` after
the change returns zero code references (only historical prose in docs). `card.ts:258-265`'s comment is
rewritten to record what the `UNIQUE(signal_candidate_id)` tension WAS and why the single statement
dissolves it, per the instruction, rather than being deleted. ADR 0021 §4.1 amended with a new
`#### Amendment (Session 28-D, D2) — A-5` subsection (appended, original text untouched) recording the
ruling, the statement shape, and the named loser.
**Fix (MAJOR-2):** `supabase/__tests__/signals3-triage-state.test.ts`'s hand-built `INSERT … SELECT …
WHERE` (the anti-pattern — it asserted Postgres honours a `WHERE` clause the test itself just wrote,
without ever calling a production function) is replaced with three tests that drive the REAL `generateCard`
(mocking only `runPrompt`, matching `signals3-seed.test.ts`'s established Tier-1 precedent for AI-touching
production paths): (1) the invalidated-claim case — seeds a candidate, claims it, invalidates the claim via
a REAL `upsert_signal_candidate` re-score (A-4′'s actual mechanism, not a duplicate query), calls
`generateCard`, asserts `{ outcome: 'skipped', reason: 'claim_lost' }` and zero `insight_cards` rows; (2)
the happy path — a live claim produces EXACTLY ONE card, and the candidate transitions to `'carded'`
(treated as the more important case per the instruction, since a `WHERE` that never matches looks identical
to fail-closed working correctly without it); (3) the re-triage case — after (1) invalidates the claim, the
candidate is re-claimed and successfully carded on the second attempt, proving `UNIQUE
(signal_candidate_id)` no longer bars it because no orphan card was ever written. The RPC arm at the
original `:213-235` (now shifted, same content) is untouched.
**Test:** `lib/db/insight-cards.test.ts` — the two `insertCard`-specific cases rewritten for the new
`(insert, claimedAtIso) => InsertCardResult` contract, asserting the RPC name/args and both the
`'inserted'`/`'claim_lost'` outcomes (mocked `client.rpc`, Tier 2). `lib/signals/triage/card.test.ts` —
mocks/assertions updated for the new `insertCard` shape; the `claim_lost` case now mocks `insertCard`
returning `{ outcome: 'claim_lost' }` directly rather than mocking a separate `setCandidateTriageOutcome`
call, and the `mockDeleteCardById` assertion is removed (the function no longer exists). `supabase/__tests__/signals3-triage-state.test.ts`
— see MAJOR-2 fix above; three new Tier-1 cases against live Postgres.
**Verification actually performed:** `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run
lib/signals/triage/card.test.ts lib/db/insight-cards.test.ts lib/signals/triage/orchestrator.test.ts` —
31/31 green; broader sweep (`lib/signals lib/ai lib/db lib/social lib/validation`) — 1184/1184 green with
the same pre-existing, unrelated `lib/signals/orchestrator.test.ts` env failure noted in D1's row (confirmed
identical before any D2 change). `database-reviewer` invoked once (per D2's mandate) against the migration
and its TypeScript caller: verdict **"Sound. This closes MAJOR-1 correctly"** — confirmed the writable-CTE
is genuinely one atomic statement (no interleaving window), confirmed `ON CONFLICT` is unreachable in the
normal flow but safe/correct to keep as defense-in-depth (traced concretely against `claimCandidateForTriage`'s
claim exclusivity and `'carded'`'s terminal status), confirmed a mid-INSERT failure rolls back the CTE's
UPDATE too (ordinary Postgres statement atomicity), confirmed `SECURITY DEFINER`/`search_path` hardening and
the `REVOKE`/`GRANT` signature match are correct, and confirmed no SQL-injection surface (all values bound
RPC parameters, never interpolated). One non-blocking MINOR raised and addressed: a connection drop after
the RPC commits but before the response returns reads back identically to a real `claim_lost` — no
data-integrity impact, addressed with a one-line comment on `insertCard`'s zero-rows branch documenting the
distinction rather than a design change.
**Verification NOT performed (flagged, not silently skipped):** `npm run test:db` — this shell has no local
`supabase`/`docker` available (confirmed: `which supabase` → not found, `docker --version` → not found), so
the three new Tier-1 tests in `signals3-triage-state.test.ts` could not be executed against live Postgres
here, and the "prove it reddens" mutation proof against the RPC's `WHERE`/claim-equality predicate
(specified in D2's VERIFY section) could not be performed for the same reason. This is the identical
environment gap D1 hit and flagged, not a new one. The tests are written to the same idiom as the
already-passing `signals3-seed.test.ts` and `signals3-card-evidence-tenant.test.ts` Tier-1 suites and were
verified by `tsc` and by the database-reviewer's independent trace of the same logic; they have not been
**executed** green in this session and should be treated as `AUTHORED-NOT-EXECUTED` until `db-tests.yml`
(or a local Supabase stack) runs them.
**Commit:** `2824b017`

### D3 — MAJOR-3, MAJOR-5, NIT-6

**Fix (MAJOR-3):** `SIGNAL3-TOOL-INVOCATION-EXPECTED` never existed — `git grep -rn "TOOL-INVOCATION-EXPECTED"`
hit only `docs/decisions/`. Added a new `describe('SIGNAL3-TOOL-INVOCATION-EXPECTED …')` block in
`lib/ai/tool-runner.test.ts`, using the seam the instruction pointed to (`tool-runner.test.ts:122`'s
`expect(tool.execute).toHaveBeenCalledWith(...)` pattern). Two new fixtures added —
`tool-use-list-audience-notes.json`, `tool-use-list-brand-claims.json` — so the exact-match assertion spans
three of the four real tools (the third pre-existing fixture, `tool-use-list-evidence.json`, already
covered `list_evidence`), not just one, per Amendment B1.2's "never an aggregate pass rate": each case
drives a full four-tool `runToolLoop` and asserts the ONE fixture-named tool's `execute` was called with
the fixture's exact input, AND every other tool in the closed four was NOT called.
**Fix (MAJOR-5):** disposition **(a)**, as directed. `lib/signals/triage/source-scans.test.ts`'s
`expect(true).toBe(true)` tautology is deleted. The scan is extended with a new
`describe('SIGNAL3-TOOL-RESULTS-GUARDED — the dispatcher's serialisation boundary …')` block reading
`lib/ai/tool-runner.ts` (the file ADR §7.3 actually names) and asserting exactly one
`JSON.stringify(toolResult)` call site with no bypass pattern (`${...toolResult`, `toolResult +`, `+
toolResult`) present. ADR 0021 §7.3 amended (appended, original untouched) — the original line ("the
dispatcher must never `JSON.stringify(toolOutput)`") is stated as wrong-as-written, and the guarantee is
restated to match the shipped design: **"guarded at the tool boundary, serialised by the dispatcher."** The
Reviewer's fairness note is preserved verbatim in the amendment: the substantive property largely holds
(every untrusted field is already neutralised inside `tools.ts` before the dispatcher sees it); what was
missing was enforcement reaching the dispatcher file, not an exploitable hole.
**Fix (NIT-6):** `lib/signals/triage/tools.test.ts` — a new case asserts `list_recent_campaigns`'
`objective` AND `special_instructions` wraps (previously only `name` was asserted; either unasserted wrap
could have been removed and shipped green). A new `list_evidence` case asserts the **composition**: since
`list_evidence`'s content path is `wrapEvidenceForPrompt` (a distinct, separately-guarded and
separately-tested function, ADR §4.6), the case drives an injection payload through the REAL
(unmocked) `wrapEvidenceForPrompt` against a mocked Supabase client and asserts the returned `evidence`
field is neutralised — proving `list_evidence` really composes that function rather than passing evidence
through raw, not re-proving `wrapEvidenceForPrompt`'s own guarantee a second time.
**Test / redden proofs, all performed and reverted:**
- MAJOR-3: reverted `tool-use-list-evidence.json`'s tool name from `list_evidence` to `list_audience_notes`
  (simulating the loop calling the wrong/no tool) — the new case, plus two pre-existing cases sharing the
  same fixture, failed; reverted, 21/21 green again.
- MAJOR-5: added `+ toolResult` after the sanctioned `JSON.stringify(toolResult)` call in
  `lib/ai/tool-runner.ts` (a bypass pattern) — the extended scan failed exactly as designed; reverted.
- NIT-6: removed the `objective` wrap in `tools.ts`'s `list_recent_campaigns` (`objective: row.objective`
  instead of `wrapToolResultForPrompt(row.objective)`) — the new case failed with the raw injected string
  visible in the assertion output; reverted.
**Verification:** `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run lib/signals/triage/tools.test.ts
lib/signals/triage/source-scans.test.ts lib/ai/tool-runner.test.ts` — 38/38 green; broader sweep
(`lib/signals lib/ai lib/db lib/social lib/validation`) — 1189/1189 green (5 new since D2), same
pre-existing unrelated `lib/signals/orchestrator.test.ts` env failure noted in D1/D2's rows. No specialist
invoked, per the instruction — every finding here is closed by a test proven to redden, which was the
mandated evidence.
**Commit:** `8765f3b6`

### D4 — MAJOR-4, MINOR-3, NIT-4

**Fix (MAJOR-4):** `scripts/ci/assert-eval-executed.mjs:87-90` set `failed = true` on `metricsPass !==
true`, fusing a purely statistical threshold dip into the same exit path as the false-green guards —
contradicting Amendment B3/B3.1's explicit split. Split into three script modes: `--check-corpus-only`
(unchanged, pre-run), the default mode (`checkArtefactHard`, the `eval-reported` check — corpus minimum,
executed-count, errored-example, and a `runUrl`-present check; job-failing; `metricsPass` deliberately
absent), and a new `--check-threshold` mode (`checkThreshold`, the `eval-threshold` check — reports
`metricsPass` and the metric numbers via `console.warn`, **never** `process.exit(1)`). `.github/workflows/
eval-triage.yml` split from one job into two — `eval-reported` (applicability → install → pre-run corpus
check → `npm run test:eval` → `assert-eval-executed.mjs` default mode → upload artefact) and
`eval-threshold` (`needs: eval-reported`, `if: always()`, downloads the uploaded artefact, runs
`assert-eval-executed.mjs --check-threshold`) — two GitHub check names sharing one workflow, per ADR 0021
§10.4's new amendment note.
**A second, un-named fusion point found while implementing the fix:** `scripts/eval/run-triage-eval.ts:
170-173` also called `process.exit(1)` on `!metricsPass`, inside the `npm run test:eval` step that runs
*before* `assert-eval-executed.mjs` in the workflow. Left alone, splitting only the guard script would not
have split the actual gate — the `eval-reported` job would still fail on a metrics dip via this earlier
call site. Removed that branch (replaced with a non-fatal `console.warn`); its errored-example
`process.exit(1)` (lines 166-169) is untouched, preserving B2.4's guard unchanged, exactly as instructed.
**Fix (MINOR-3):** `docs/current-phase.md`'s "Eval-reported tally" paragraph claimed the tally was "not
gated on `master`," contradicting E-1 (session-28.md §0.2), ADR §10.4 and Amendment B3, each stated twice
over. Rewritten to match `db-tests`' master-gated phrasing exactly, count reset to **0 of 3**, the false
sentence deleted, with a pointer to E-1/§10.4/Amendment B3 for the promotion rule. The `db-tests` tally
elsewhere in the file is untouched.
**Fix (NIT-4):** `assert-eval-executed.mjs`'s hardcoded `CORPUS_PATH = 'lib/signals/__fixtures__/eval/
corpus.v1.json'` replaced with `resolveCorpusPath()`, which reads the corpusVersion from the **previously
committed** `latest-run.json` (the only version signal available before a new run exists) and builds
`corpus.v${version}.json`, falling back to v1 only when no prior artefact exists. Used by all three script
modes.
**Test / redden proofs, all performed and reverted (VERIFY's three hand-made-artefact scenarios, run
against the script directly since no test file exists for this CI script — consistent with its own
Amendment B2.4 precedent of being verified by direct invocation, not a vitest suite):**
- Scenario 1 — `metricsPass: false`, artefact otherwise present: `node assert-eval-executed.mjs` (default)
  exited **0** (`eval-reported green`); `node assert-eval-executed.mjs --check-threshold` printed a
  `::warning::` and exited **0** — the workflow does not fail on this account.
- Scenario 2 — no artefact file present: `node assert-eval-executed.mjs` (default) exited **1** (ENOENT on
  the artefact path).
- Scenario 3 — one `outcomes[]` entry mutated to `status: 'error'`: `node assert-eval-executed.mjs`
  (default) exited **1**, naming the errored example — B2.4 preserved, unchanged by the split.
- All mutations made against a scratch copy of the real committed artefact and reverted via `git checkout
  --` afterward; `git status --short lib/signals/__fixtures__/eval/` confirmed byte-identical to HEAD
  before proceeding.
**Verification:** `npx tsc --noEmit --skipLibCheck` clean; `npm run test:app` — 2769/2769 tests passed (209
of 211 files; the 2 "failed" files, `lib/config.test.ts` and `lib/signals/orchestrator.test.ts`, are the
same pre-existing, unrelated missing-env-var failure already noted in D1/D2/D3's rows — `NEXT_PUBLIC_
SUPABASE_URL` etc. absent locally, no relation to any D4 file); `npm run test:eval` exited 0 locally
(re-run only for verification; its timestamp-only side effect on `latest-run.json` was reverted via `git
checkout --` so the committed artefact stays byte-identical to CI's last real run). No specialist invoked,
per the instruction — this is a CI-guard split and a tally correction, settled by reading Amendment B3 and
E-1, not a judgment call needing a specialist's independent read.
**Commit:** `391371cd`

### D5 — MAJOR-6, MINOR-5, MINOR-6

**Fix (MAJOR-6):** `OpportunityFeed.tsx` (387 lines, the entire Mode 3 user-facing surface) was
`AUTHORED-NOT-EXECUTED` — mocked to `() => null` in `page.test.tsx`, no dedicated suite existed.
`OpportunityFeed.test.tsx` (new, 25 cases) drives the REAL component through all ten §9.2 states, named in
the test titles ("§9.2 state N/10: …") so a reviewer can count them: the two empty states (asserted
DIFFERENT from each other, not merely each individually correct — `not.toBe` on the two renders'
`textContent`), cards pending (full §9.1 hierarchy), high-sensitivity (warning band + the second-click
confirmation gate, plus a companion case proving a LOW-sensitivity card does NOT get the gate), expired
(both "not in the default feed" and "reachable via the filter, actions disabled"), saved, approved-and-
in-flight, triage-failed, triage-paused, and lost-the-triage-race (`already_triaged` — asserts the card
re-renders in its real patched status, `status.dismissed`, never the generic `actions.error`). A separate
`describe` block asserts all four `aria-live` announcements (approve/dismiss/save/already_triaged) as
`textContent`, not attribute presence, per the instruction.
**Fix (MINOR-5):** `card.observation`, `card.why_it_matters` and `card.audience` each now render a visible
`<p>` assessment marker (`t('card.modelAssessment')`) beneath the field — no new i18n key needed, the
existing key is reused, now rendered as real text instead of only living on `card.audience`'s `title`
attribute (deleted). The verified-evidence block now maps `card.evidence` (the id array — `insight_cards`
carries no title/body join, confirmed against `lib/db/types.ts:611-621`) into a list of id items instead of
rendering `card.evidence.length`. Tests assert: exactly three visible marker elements exist and zero
`[title="card.modelAssessment"]` elements remain; the evidence ids appear as list-item content; no evidence
block renders when the array is empty.
**Fix (MINOR-6):** `app/globals.css` gained seven new tokens (`--warning`, `--warning-border`,
`--warning-foreground`, `--success`, `--success-border`, `--success-foreground`, `--info-foreground`) in
both `:root` and `.dark`, plus `@theme inline` mappings — additive only, no existing token touched. Values
are Tailwind's own amber/emerald/sky hexes, pre-verified at ≥5.69:1 AA contrast (floor 4.5:1) in both
themes via a scratch script before landing, independently re-verified by `ecc:react-reviewer` at ≥6.8:1.
The status bands (triage-paused, high-sensitivity, verified-evidence, saved hint) now use these tokens
instead of raw Tailwind palette classes. `OpportunityFeed.test.tsx` mirrors `ApprovalsInbox.test.tsx`'s
contrast-testing mechanism exactly — reads `app/globals.css` at test time via `readFileSync`, not a
hand-transcribed copy — with one adaptation: the new tokens are stored as literal hex (not `oklch(L C H)`),
a disclosed choice to avoid a hand-computed oklch conversion introducing its own contrast error, so a
`hexTokenLuminance()` helper sits alongside the existing `oklch`-based `tokenLuminance()` (still needed and
used for `--card`, which the Saved hint's `info-foreground` text renders directly onto). A final case
asserts the component's rendered HTML contains no `amber-\d|emerald-\d|sky-\d` classes and does contain the
new token classes.
**`ecc:react-reviewer` invoked once, per the instruction (no other specialist).** Verdict: **Approve**, no
CRITICAL/HIGH findings. Two MEDIUM notes: (1) the evidence-id list is honest but low-value UX given the
data model has no joinable content beyond the id — accepted as a bounded, disclosed limitation, not fixed
this pass; (2) a leftover `title` attribute on the unrelated "approved, link pending" hint, inconsistent
with the house rule MINOR-5 just established even though it duplicated visible text and carried no
information loss — **fixed** (the `title` attribute removed, visible text is unchanged) per "address every
finding before commit." The agent's report also flagged that injected-looking text appeared in its own
tool-call transcript making false claims about the code state (that the confirmation gate and
already_triaged handling had been removed, and that tests were failing) — it correctly verified against
real `Read`/`Bash`/`vitest` output and disregarded the false claims; this is session-memory-hook noise in
the subagent environment, not a vulnerability in the reviewed code, and is recorded here for the audit
trail rather than acted on.
**Test / redden proofs, all performed and reverted (the five named in the instruction: both empty states,
triage-failed, high-sensitivity, already_triaged):**
- Empty state 1 (no connection): gated the branch behind `false &&` — state 1's test failed on the missing
  `empty.noConnectionTitle` text; reverted.
- Empty state 2 (connected, nothing yet): same mutation on the other branch — state 2's test failed on the
  missing `empty.connectedNothingYetTitle` text (and would also have failed the "must differ from state 1"
  assertion had it reached that far); reverted.
- Triage-failed: gated `hasTriageFailures` behind `false &&` — state 8's test failed on the missing
  `status.triageFailedTitle`; reverted.
- High-sensitivity: removed the `isHighSensitivity && !confirmingApprove` gate from `requestApprove()` —
  the test's `expect(approveCardAction).not.toHaveBeenCalled()` failed (it WAS called on the first click);
  reverted.
- Already_triaged: removed the `already_triaged` branch from `handleApprove` — the test's
  `status.dismissed` assertion failed, the card instead showed `actions.error`'s generic message (the exact
  failure mode §5.3 exists to prevent); reverted.
- `page.test.tsx`'s `() => null` mock was kept, not removed, and justified in a comment as a deliberate
  page-level isolation boundary (that file tests only `page.tsx`'s auth/redirect/capability logic) now that
  `OpportunityFeed` has its own suite.
**Verification:** `npx tsc --noEmit --skipLibCheck` clean; `npx vitest run app/[locale]/(dashboard)/
opportunities/` — 53/53 green (5 files, incl. the new suite's 25); `npm run test:app` in full — 2792/2794
tests passed, 4 files reported failed but only 2 individual tests actually failed
(`lib/social/__tests__/vault.test.ts` and `lib/ai/runner.test.ts`, both `Test timed out in 15000ms` under
full-suite parallel load — re-run each in isolation immediately after: both green, 12/12 and 40/40, neither
file touches `opportunities/` or `globals.css`, confirmed flaky-under-load rather than a regression); the
other 2 "failed" files are the same pre-existing, unrelated missing-env-var collection failure already
noted in D1-D4's rows (`lib/config.test.ts`, `lib/signals/orchestrator.test.ts`).
**Commit:** pending (D5, not yet committed as of this appendix row)

### D6 — MAJOR-7, NIT-2

**Fix (MAJOR-7):** `lib/ai/tool-runner.ts`'s `TRIAGE_MAX_WALL_CLOCK_MS` check ran only at the top of each
turn; `callWithRetryBudget` applied `TRIAGE_REQUEST_TIMEOUT_MS` (30s) per attempt, uncoordinated with that
deadline — a turn entered at 44.9s could still run `30 + 2 + 30 + 2 + 30` = 94s before giving up, ≈3.1× the
declared 45s ceiling, while `orchestrator.ts:180` reserved exactly one `TRIAGE_MAX_WALL_CLOCK_MS` believing
that could not happen. `callWithRetryBudget` now takes a fourth argument, `deadlineAt` (`startTime +
TRIAGE_MAX_WALL_CLOCK_MS`, computed once in `runToolLoop` and threaded down on every recursive retry call):
each attempt's own timeout is clamped to `min(TRIAGE_REQUEST_TIMEOUT_MS, deadlineAt - Date.now())`, and a
retry is refused outright — no `sleep(RETRY_DELAY_MS)`, no further attempt — once the remaining budget can
no longer fit `RETRY_DELAY_MS`. Both paths throw a new internal `LoopDeadlineExceededError`, caught in
`runToolLoop` and mapped to the SAME `'wall_clock_exceeded'` reason the top-of-turn check already produces
— one failure mode, one name, regardless of where in the turn it's detected. This is a fail-closed path,
not an error: it produces `{ outcome: 'failed', reason: 'wall_clock_exceeded' }` with zero cards, and the
`finally`-block `ai_usage` write still runs unconditionally (verified — the write is outside the
`try`/`catch` that handles `LoopDeadlineExceededError`, in the existing `finally` all outcomes share).
`orchestrator.ts:180`'s single reservation is now correct as written, not correct arithmetic resting on a
false premise. ADR 0021 §2.4 amended with a note on where the ceiling is enforced (two places, both
load-bearing: the top-of-turn check and inside `callWithRetryBudget`).

The Reviewer's fallback option (widen the reservation to
`TRIAGE_MAX_WALL_CLOCK_MS + TRIAGE_RETRY_BUDGET × (TRIAGE_REQUEST_TIMEOUT_MS + RETRY_DELAY_MS)`) was not
taken — option 1 (enforce inside `callWithRetryBudget`) proved feasible against the SDK's timeout surface
(`withTimeout` already accepted an arbitrary `ms`; clamping it to the remaining budget required no change
to its signature), so the stronger option was implemented and the tick's claimed-candidate throughput is
not reduced to protect against a case that is now structurally impossible.

**Fix (NIT-2):** `TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN`'s comparison (`response.usage.output_tokens >
TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN`) is structurally unreachable in production — the same request sets
`max_tokens` to that identical value, so the provider contractually cannot return more. The guard is kept
as defence-in-depth against a future provider contract change; a comment at the comparison site states
this, and ADR 0021 §11 gained an amendment naming `SIGNAL3-TRIAGE-BOUNDED`'s `oversized-output-per-turn`
fixture as the one synthetic row in that table — it manufactures a response the real API contract does not
permit, to exercise a dead branch rather than leave it silently unexecuted.

**Test:** `lib/ai/tool-runner.test.ts` gained two cases, both driven by a mocked `Date.now()` sequence
(not real elapsed time) so the loop's own deadline math is asserted against the bound directly rather than
sampled off the wall clock: (1) *"a retryable failure that consumes ~all remaining budget is retried once
(clamped), then the deadline is exhausted before a third attempt"* — simulates attempt 1 consuming 30s of
the 45s budget (retry proceeds, 15s remaining), attempt 2 clamped to the remaining 13s and consuming all of
it (0ms remaining, under `RETRY_DELAY_MS`) — asserts `wall_clock_exceeded` and exactly 2 `mockCreate`
calls, never a 3rd; (2) *"a retry that cannot fit the remaining loop budget is refused outright"* —
attempt 1 alone consumes 44s of the 45s budget (1000ms remaining, under `RETRY_DELAY_MS`) — asserts
`wall_clock_exceeded` and exactly 1 `mockCreate` call, with `TRIAGE_RETRY_BUDGET` (2) still unspent. Both
cases were shown to redden against the pre-D6 code: `git show HEAD:lib/ai/tool-runner.ts` restored
temporarily (the un-fixed four-argument-less `callWithRetryBudget`), `npx vitest run
lib/ai/tool-runner.test.ts` run — the 2 new cases failed (a `TypeError` reading `response.usage` off the
`undefined` the pre-D6 code returns when the rejected promise it never guards against a loop deadline
propagates past where a response was expected), the 21 pre-existing cases stayed green unchanged — then
the D6 fix was restored and the file re-run: 23/23 green. `npx tsc --noEmit --skipLibCheck` clean; `npm run
test:app` — 2796/2796 tests passed (2 suites report failed but 0 individual tests failed inside them:
`lib/config.test.ts` and `lib/signals/orchestrator.test.ts`, both the same pre-existing missing
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
collection-time failure already noted in D1's and D5's rows, unrelated to `lib/ai/tool-runner.ts`).
**Commit:** pending (D6, not yet committed as of this appendix row)
