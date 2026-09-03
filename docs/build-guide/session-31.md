# Session 31 — Generation quality core: sampling, judging, thinking, conditioning (ADR 0024) · Track H

> **Goal:** raise the quality of every generation call the product already makes, without adding a single
> new AI surface. Four changes, all inside `lib/ai/` and `lib/campaigns/`: **N-candidate generation judged
> on the full rubric** (replacing the one-dimension `openingStrength` retry), **thinking budgets** on the
> strategic prompts, **task-conditioned memory retrieval** (the primary call site currently passes an empty
> `queryContext`), and **schema-enforced structured output** (retiring the prose-then-JSON parse that
> produced a real production bug in Session 30).
>
> **What this session does NOT ship, explicitly:** voice exemplars or any similarity retrieval; tools for
> the generator; claim verification; the campaign planner; any memory *write* path; the social backfill;
> the outcome loop. Every one of those is a named later track, and
> `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` §7/§14 sequences them.
>
> **Corrected 2026-09-03.** This paragraph previously said voice exemplars were *"blocked on the
> embeddings ruling."* **They are no longer blocked** — `docs/pre-launch-scope.md` §12.6 scoped
> `SIGNAL-NO-EMBEDDINGS` to Mode 3's deterministic half (ADR 0020 §17c, ADR 0023 §21) and un-blocked
> similarity retrieval inside `lib/memory/`. **They are still out of scope here**, on sequencing rather
> than on a block: they need Session 32's corpus. Session 31's fence does not move.
>
> **This is the only session in the quality programme with no upstream dependency**, which is why it runs
> first: it needs no ruling, no new store, and no external access, and its effect is measurable on the
> existing eval harness the day it lands.
>
> **Prerequisite, absolute.** Session 31 does not begin until Session 30 (Track G, ADR 0023) has closed —
> PR #9 merged and its correction pass complete. This session changes sampling behaviour, and ADR 0017's
> frozen Mode 2 prompt fixtures move as a consequence (L-5); doing that on top of an open PR that itself
> touches prompt assembly would make both diffs unreadable.
>
> **Reframed 2026-09-03 — a session is now inserted ahead of this one.**
> `docs/build-guide/session-30-5.md` (**Track N, ADR 0028**) ships native LinkedIn and X providers and
> removes Postiz entirely. **The prerequisite above is extended: Session 31 does not begin until Session
> 30.5 has closed**, for the same reason it waits on Session 30 — 30.5 touches `lib/config.ts`,
> `eslint.config.mjs` and the CSP builder, and two open diffs over shared infrastructure is how a merge
> conflict becomes a silent revert. **Nothing else in this session changes**: Session 30.5 touches no file
> under `lib/ai/` or `lib/campaigns/`, and this session's Reality block, Locked decisions and eight
> questions are unaffected. The insertion is numbered 30.5 (the `session-13-5.md` precedent) precisely so
> that Sessions 31–34 keep their numbers, their track letters (H, I, J, K) and their ADR numbers
> (0024–0027).

---

## Reality check — to be re-verified against the live repo before the Architect runs

> Read at `b297a4a8`. **If any item has changed, correct this file before the Architect runs.** Every item
> below is load-bearing for at least one `Q` or `L`.

1. **There is no `temperature` anywhere in `lib/ai/`, and no thinking budget anywhere.** Verified by grep
   across `lib/ai/*.ts`. Every call therefore samples at provider defaults. **This is the prerequisite
   nobody has noticed:** generating N candidates without a sampling change returns N near-identical
   strings, and a best-of-N gate over near-identical candidates is pure cost with no quality delta. Q1 and
   Q2 both depend on this being true — re-verify it.

2. **The post-level quality gate today is one dimension and one retry.** `lib/campaigns/generate.ts:259`
   regenerates **once** if `openingStrength` is below threshold, and its own comment states there is **no
   re-score** afterwards. This is the mechanism L-3 replaces. It is *not* "no gate" — the guide must not
   describe the current state as ungated, and the ADR must name what it is replacing.

3. **The brief IS properly gated — do not duplicate it.** `lib/campaigns/brief.ts:139` runs the full rubric
   as a Stage B critique gate against `BRIEF_QUALITY_THRESHOLD`, calling `runPrompt(rubricPrompt, ctx, …)`
   at `brief.ts:170`. Session 31 changes **post** generation, not brief critique. If a step appears to
   need a change to the Stage B gate, that is an ADR 0017 amendment and it is **flagged**, not made.

4. **The rubric is fixed at ten dimensions with a designed invariant.** `lib/ai/prompts/rubric.ts` ships
   `specificity`, `originality`, `evidenceSufficiency`, `audienceRelevance`, `platformNativeness`,
   `brandVoiceAlignment`, `openingStrength`, `ctaFit`, `unsupportedClaimsRisk`, `redundancy`, and
   `rubric.ts:21-24` records that adding, renaming or removing one is a breaking change for **every**
   caller (Mode 2's brief gate, Mode 1's Studio suggestions, and ADR 0021's `mode:'card'`). An eleventh
   dimension is a founder adjudication, not an Architect decision. See L-4.

5. **`runPrompt`'s guard ordering is load-bearing and must survive.** `lib/ai/runner.ts:87` runs
   **STEP 1 trial-cap check** (`quota_exceeded`), then **STEP 2 rate-limit check** (`rate_limited`,
   via `countRecentCalls` against `AI_RATE_LIMIT_*_PER_MIN`), then assembles messages with a
   `CACHE_CONTROL_CHAR_THRESHOLD` prompt-cache decision. N-candidate generation multiplies the number of
   provider calls behind **one** user-visible generation — Q6 must state what that does to both counters.

6. **The primary retrieval call site passes an empty `queryContext`.** `lib/ai/context.ts` calls
   `retrievePerformancePatterns(client, businessId, {})`, and the in-file comment says so explicitly —
   *"no campaign/post-specific queryContext is known at this call site (`buildCustomerContext` is
   business-scoped, not per-post)"*. `MemoryQueryContext` (`lib/memory/scoring.ts:6`) is
   `{ objective?, platform?, audience? }` — three optional fields. Q4 is about closing this.

7. **Retrieval caps are per-type and independent.** `lib/memory/constants.ts`: `BRAND_CAP = 5`,
   `EVIDENCE_CAP = 5`, `AUDIENCE_CAP = 5`, `PERFORMANCE_CAP = 3`. A prompt therefore receives at most 18
   memory records. Q4 must state whether conditioning changes what fills those slots, the caps themselves,
   or both — cross-type retrieval is **out of scope** here (L-1) and is a later session.

8. **`buildCustomerContext` acquires the service-role client** (`lib/ai/context.ts:34`, via the CLAUDE.md
   lazy-import pattern). Correct for a server pipeline. Q4 must not accidentally widen this — conditioning
   changes *what is asked for*, never *who asks*.

9. **JSON is parsed out of prose today, and it has already failed in production.**
   `lib/ai/parsers.ts:48` `extractJsonBlock` → `safeParseOrAiError` (Zod). Session 30 shipped a fix for a
   real bug in exactly this path — the model prefaced its JSON decision with prose — recorded in
   `docs/current-phase.md` as one of that session's two production bugs. Q5 is about removing the bug
   class, not hardening against it again.

10. **Model routing is static, priced, and version-coupled.** `lib/ai/models.ts:4` pins `OPUS_4_7`
    (1500/7500 cents per Mtok), `SONNET_4_6` (300/1500), `HAIKU_4_5` (100/500), with `calculateCostCents`
    billing cache reads at 10% of input. The file's own header states: *"Switching a prompt's model
    requires bumping its `version` in the same commit (ADR C-4)."* **L-2 extends that rule to sampling.**

11. **The cost-ceiling precedent exists and should be reused, not reinvented.** ADR 0021 shipped
    `SIGNAL3-COST-CEILING-ATOMIC` — a per-business daily cap enforced atomically *before* the call, with
    the check-then-call race named as the failure mode. Q6 inherits that pattern.

12. **Nine prompt families exist** under `lib/ai/prompts/` (`brand-voice-inference`, `brief`,
    `learning-summarizer`, `post-generation`, `post-regeneration`, `rubric`, `studio-suggestion`, plus
    `formats/`). Q1, Q2 and Q5 each need a **per-prompt** answer, not a blanket one — a thinking budget on
    `learning-summarizer` (a Haiku classification step) would be waste.

---

## §0 — Locked decisions (binding input — adjudicated by founder, 2026-09-02)

These are decided. The Architect (H1) **encodes** them in ADR 0024 and names their losers; it does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**, exactly as an ADR
contradicting CLAUDE.md would.

**Locked (L):**

- **L-1 — Session 31 ships four generation-quality changes and nothing else.** *In scope:* sampling
  parameters as versioned prompt properties; N-candidate generation with full-rubric judging for post
  generation; thinking budgets on the strategic prompts; task-conditioned `MemoryQueryContext` threading;
  schema-enforced structured output; and the ADR 0017 fixture migration those force. *Out of scope,
  explicitly:* **voice exemplars and any similarity/embedding retrieval** — **un-blocked on 2026-09-03**
  (`docs/pre-launch-scope.md` §12.6; ADR 0020 §17c; ADR 0023 §21) but **still out of scope here**, because
  they need the corpus Session 32 supplies; **tools for the generator**;
  **claim verification**; **the campaign planner**; **any memory write path or new writer**; **cross-type
  retrieval**; **the social backfill**; **the outcome loop**; **image generation**; **autonomous anything**.
  If a step appears to need any of these, **STOP and report**.

- **L-2 — Sampling is a versioned property of a prompt, exactly as its model is.** A change to
  temperature, to N, or to a thinking budget **bumps that prompt's `version` in the same commit**, under
  the rule `lib/ai/models.ts` already states for model switches (ADR C-4). Loser: a global env-var
  temperature — it makes every prompt's output history unattributable, and this repo's whole eval story
  depends on being able to say which prompt version produced a number.

- **L-3 — Full-rubric judging REPLACES the single-dimension retry; it does not sit beside it.**
  `generate.ts:259`'s `openingStrength`-only, no-re-score regeneration is removed in the same change that
  introduces judging. Loser: keeping both — two competing quality gates on one artefact means a post can
  pass one and fail the other, and no one can say which decided the output. The ADR states the replacement
  explicitly and names the removed behaviour.

- **L-4 — The ten rubric dimensions are FIXED.** No eleventh dimension, no renamed dimension, no
  output-schema change (Reality §4). If judging appears to need a new dimension, that is a **founder
  adjudication** affecting three existing callers, and it is flagged, not folded in.

- **L-5 — ADR 0017's frozen Mode 2 prompt fixtures WILL move, and the migration is a named deliverable.**
  Changing sampling changes recorded outputs. This is expected, not a surprise to be discovered by a
  Builder mid-step. The ADR states how many fixtures move, whether they are re-recorded or the tests
  re-shaped, and **how every existing `MODE2-*` constraint survives the move**. Loser: pinning sampling to
  zero on Mode 2 to protect the fixtures — that would exempt the product's main generation path from the
  session's entire purpose.

- **L-6 — The cost ceiling is reused, not reinvented.** N-candidate generation multiplies spend per
  artefact. The per-business daily cap already exists (`SIGNAL3-COST-CEILING-ATOMIC`, ADR 0021) and is
  enforced atomically *before* the call. Session 31 extends it; it does not build a second one. The ADR
  states the arithmetic at N with literal cent figures.

- **L-7 — The structured-output migration is additive and per-prompt.** `extractJsonBlock` remains for
  every prompt not yet migrated; no big-bang. Loser: retiring the parser in one commit — it would put nine
  prompt families' output paths in a single diff, and Session 30 already demonstrated that this parse path
  fails in ways fixtures do not catch.

- **L-8 — No new AI surface. Every change improves a call that already happens.** There is no new route,
  no new user-facing generation entry point, and no new prompt family in this session. If a step wants
  one, it belongs to a different session.

- **L-9 — `runPrompt`'s guard ordering survives unchanged.** Trial cap first, then rate limit, then
  assembly (Reality §5). N-candidate generation must not be a hole through either. **What N candidates
  cost the user in trial units and in rate-limit budget is Q6 and must be answered explicitly** — the one
  thing that is locked is that neither guard may be bypassed or reordered.

- **L-10 — GDPR, tenancy and RLS obligations in full.** No new business-scoped table is expected. **If the
  ADR introduces one** (e.g. persisting losing candidates for the approval surface), it carries: RLS in
  the InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))` form, `USING` **and**
  `WITH CHECK` on every UPDATE, `ON DELETE CASCADE` from `businesses`, **a row in ADR 0010 Amendment 2
  §D2.5's cascade table**, and `purge_business` coverage. If it introduces none, the ADR **says so
  explicitly** — the Session 28-D D7 precedent for recording "no new row required".

- **L-11 — Contract discipline + constitution rules, inherited by every step.** **Zod** on every Server
  Action and route input; **atomic** state transitions by conditional `WHERE`; every list query
  **bounded + explicit `ORDER BY`** matching an index; **date-fns**; **no `any`**; **no `console.*`**
  outside the single-canonical-tick-line worker carve-out; env only via `lib/config.ts`; Anthropic SDK
  only via `lib/ai/`; DB only via `lib/db/` + `lib/memory/`; service-role never in a user-facing read
  path; **i18n en/pt/es simultaneously**; and **SHARED-FUNCTION CALLERS** for every existing function
  touched — `runPrompt`, `retrievePerformancePatterns`, `retrieveVoice` and `generate.ts`'s hook loop all
  have multiple callers, and both Session 22 blockers were exactly this failure.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | How quality is raised | **N candidates + full-rubric judge** | one candidate with a better prompt (the reliable lever in this class of system is more attempts scored by a judge, not more instructions — and more instructions past a point make output *more* generic); best-of-N without a judge (picks arbitrarily, so it is pure cost) |
| D-2 | Relationship to the existing retry | **replace it** | keep both (two gates on one artefact, no attributable decision); keep only the retry (concedes the session's purpose) |
| D-3 | Where sampling lives | **per-prompt, versioned, bumped in the same commit** | a global env var (unattributable output history, breaks the eval story) |
| D-4 | Mode 2 fixtures | **migrate them, as a named deliverable** | pin Mode 2 sampling to zero to protect the fixtures (exempts the main generation path from the whole session) |
| D-5 | Structured output rollout | **additive, per-prompt, `extractJsonBlock` retained meanwhile** | big-bang retirement (nine output paths in one diff, on a parse path already proven to fail unexpectedly) |
| D-6 | Cost ceiling | **extend ADR 0021's existing atomic per-business daily cap** | a second, generation-specific ceiling (two caps that can disagree; the check-then-call race would have to be solved twice) |
| D-7 | Thinking budgets | **per-prompt, only where the task is strategic** | thinking on every prompt (pays reasoning cost on classification steps like `learning-summarizer` where it buys nothing) |

---

## §0.1 — Questions the Architect (H1) must resolve IN the ADR (BINDING)

**H1's ADR must decide each one explicitly, name the loser, and tier the resulting constraint** (ADR 0015
§2 — Tier 1 live-Postgres / Tier 2 app-layer vitest / Tier 3 diff-verified / Tier E measured). The Builder
consumes these answers as binding. Ground every answer in the real seams — let the single
`ecc:code-explorer` sweep map them and cite `file:line` rather than remembering.

- **Q1 — The N-candidate contract (the load-bearing question).** **N as a literal number**, with the
  arithmetic that justifies it against `lib/ai/models.ts`'s rates. Parallel or sequential, and what
  happens when one candidate errors while others succeed. The **temperature value(s)**, per prompt.
  **Which prompts get N-candidate treatment** — post generation certainly; state the answer for
  `post-regeneration`, `studio-suggestion` and the `formats/` families, each with a reason. How candidates
  are scored (the full ten dimensions? a weighted subset? — L-4 forbids adding one, not ignoring one, so
  say which are meaningless here and dispose of them explicitly). **Tie-breaking.** And the case the
  design lives or dies on: **what happens when all N score below threshold** — regenerate, escalate a
  model tier, surface the best-of-a-bad-set with its score, or fail? Name the loser.

- **Q2 — Sampling and thinking as versioned prompt properties (L-2, D-3, D-7).** Where the parameters are
  declared (the `Prompt<TInput, TOutput>` object? a sibling config?), and **how the version-bump rule is
  enforced rather than remembered** — ADR C-4 is currently a comment in `models.ts`; state whether Session
  31 makes it an executable check and at which tier. Which prompts receive a thinking budget and the
  **budget as a number** for each; `brief` and the strategic paths are the candidates, and Reality §12
  warns against blanket application. State the expected latency change per affected surface.

- **Q3 — The ADR 0017 fixture migration (L-5, D-4).** How many fixtures move, and the inventory. Whether
  they are **re-recorded** against the new sampling or the **tests are re-shaped** to assert properties
  rather than bytes — argue it; a fixture that must be re-recorded on every sampling change is a
  maintenance tax, but a property-shaped test may prove less than the byte-exact one it replaces, and the
  ADR must say what coverage is *lost*. Enumerate every `MODE2-*` constraint touched and state, per
  constraint, that it still holds and which test proves it after the move. This is a **SHARED-FUNCTION
  CALLERS**-shaped obligation applied to fixtures.

- **Q4 — Task-conditioned retrieval (Reality §6, §7, §8).** The **widened `MemoryQueryContext` shape** —
  which fields are added (topic? campaign? format? post role? time window? confidence floor?) and which
  are deliberately not, with a reason for each omission. **How task context reaches `buildCustomerContext`,
  which is business-scoped by construction** — this is the real design problem, and the in-file comment at
  `lib/ai/context.ts` states it plainly; a new parameter, a second context builder, or a caller-supplied
  override are the obvious candidates and each has a cost. Which callers change, per **SHARED-FUNCTION
  CALLERS**: enumerate every caller of `buildCustomerContext`, `retrievePerformancePatterns` and
  `retrieveVoice`, and state which test covers each. Confirm the service-role acquisition (Reality §8) is
  **unchanged**. State explicitly that caps and cross-type retrieval are out of scope (L-1).

- **Q5 — Structured output (L-7, D-5, Reality §9).** The tool-use schema shape, and **which prompt migrates
  first** — pick the one whose failure is cheapest to observe and say why. Whether `safeParseOrAiError`'s
  Zod validation is retained *behind* the schema (belt and braces) or replaced by it. The error path when
  the provider returns a malformed tool call. What `extractJsonBlock` is still responsible for after this
  session, and the **condition under which it may finally be deleted** — named now, so a future session
  knows when it has earned the removal.

- **Q6 — Cost, trial caps and rate limits at N (L-6, L-9, Reality §5, §11).** **Does one user-visible
  generation at N=3 consume 1 trial post or 3?** Answer it and name the loser — a trial user watching
  their 50-post allowance drain 3× faster for one post is a product decision, not an implementation
  detail. Same question for the per-minute rate limit (`countRecentCalls` counts provider calls today).
  The **daily cost ceiling arithmetic at N**, in literal cents, per plan tier. Where enforcement happens
  relative to candidate fan-out — **before the fan-out, atomically**, or the check-then-call race
  reappears N-fold. Confirm the ADR 0021 mechanism is extended, not duplicated.

- **Q7 — What the human sees (the UX contract H1 specifies, does not design).** Whether losing candidates
  are **persisted** (which decides L-10 — a new table or not) or discarded after judging. What the
  approval surface shows: the winning post only, the winning score, the full score breakdown, or the
  losing candidates too. The argument for showing anything at all is trust — *"why this one"* — and the
  argument against is noise on a fast-triage surface; pick one and name the loser. Every state (generating,
  judged-and-passed, all-below-threshold, judging failed). Server Component page + Client interaction
  split, Zod on every Server Action, shadcn v4 / Base UI (**no `asChild` on `Button` or `DropdownMenu`
  primitives** — CLAUDE.md), Tailwind only, i18n en/pt/es simultaneously.

- **Q8 — Test plan across the tiers, and how this session proves it worked.** Map every `QUAL-*`
  constraint to its tier: **Tier 1** for anything touching a new table's RLS/cascade/`purge_business` (or
  a statement that there is none); **Tier 2** for the judging contract, the all-below-threshold path, the
  version-bump rule if it becomes executable, the widened query threading, the structured-output error
  path, and the trial-cap/rate-limit behaviour at N; **Tier 3** for the properties of absence (no new AI
  surface, `extractJsonBlock` still present for unmigrated prompts, the removed `openingStrength` retry
  having exactly zero remaining callers), enumerated as such. **And the measurement:** this session's whole
  claim is a quality delta, so state the **before/after protocol on the existing eval harness** — the
  baseline run, what is recorded, and the honest statement that the harness's current numbers are a
  bootstrap ceiling (ADR 0021 §10.4) and cannot alone prove a real-world improvement. Name what is
  honestly untestable and why.

Where an H1 answer and this build-guide disagree, **the ADR wins once written** — but H1 must not silently
contradict a §0 Locked decision; if it needs to, it **STOPS and flags for founder adjudication**.

---

## §0.2 — Founder adjudications

> **AWAITING THE ARCHITECT — this section is the Builder's gate; H2 does not start without it.**
>
> When H1 escalates a question (Q1's all-below-threshold behaviour, Q6's trial-unit accounting and Q7's
> persistence decision are the three most likely), each is recorded here in the Sessions 22–30 form,
> **before** §2 is authored:
>
> `| # | Question | Decision | Where encoded |` — one row per adjudication, `A-1 … A-n`.
>
> Where an adjudication goes **against** H1's recommendation, the recommendation is **preserved in the ADR
> and the reasoning recorded here** — nothing is rewritten in place. A revised ruling gets a prime
> (`A-4` → `A-4′`) with both visible, per the `session-29.md` L-9/D-8 precedent.
>
> This section closes by naming any constraints the adjudications **added**, and restating ADR 0024's
> total constraint count.

---

## §1 — Architect session (H1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **one document and no code**:
`docs/decisions/0024-generation-quality-core.md` (Accepted). No `.ts`, no `.sql`, no `.tsx`. Any code
attempted here is discarded. The last action is a single confirmation line, then `/exit`.

**ECC budget for this phase — four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the closed file list below, then **exactly three** advisory reviewers dispatched **once, in a single
parallel batch**, after the draft answers exist. No iterative re-consultation.
`ecc:architecture-decision-records` is a skill and is free; so is `claude-mem`'s `mem-search` — **prefer
one `mem-search` over re-reading a closed session's build guide**. ⚠️ **`ecc:cost-aware-llm-pipeline` is a
SKILL in this install, not an agent** (the Session 28 error — its guide listed it as an agent and the
phase was not executable as written). Run it as a skill; it does not consume the subagent budget.
`impeccable` / `taste-skill` are **not** invoked here — H1 *specifies* the Q7 UX contract; the Builder
runs them against it.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 31 — Generation quality core: sampling, judging, thinking, conditioning. ARCHITECT phase
(Track H). You produce ONE artefact and NO code:
  docs/decisions/0024-generation-quality-core.md (status: Accepted)
No .ts, no .sql, no .tsx. If you catch yourself writing a zod schema body, a prompt string, a migration or
a component, stop: that is the Builder's job (H2), and the constitution requires Architect-attempted code
to be discarded.

PREREQUISITE — verify before anything else. Session 30 (Track G, ADR 0023) must have CLOSED: PR #9 merged
to master and its correction pass complete. This session moves ADR 0017's frozen Mode 2 prompt fixtures;
doing that on top of an open PR that touches prompt assembly makes both diffs unreadable. If Session 30 is
still open, STOP and say so.

ECC BUDGET — FOUR subagent invocations for this whole phase. Stay inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. Ask it for file:line citations and
   the shape of each seam — nothing else.
2. Use the ecc:architecture-decision-records skill so 0024 matches 0016-0023 in structure. Use claude-mem's
   mem-search for prior-session context; cheaper than re-reading a closed build guide. Run
   ecc:cost-aware-llm-pipeline as a SKILL (it is NOT an agent in this install) for Q1/Q6's arithmetic.
   Skills are free and do not consume the budget.
3. AFTER you have draft answers to the eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - ecc:pr-test-analyzer — on Q3 and Q8 ONLY. Q3: whether re-recording ADR 0017's frozen fixtures versus
     re-shaping the tests actually preserves what the MODE2-* constraints claim, and what coverage is LOST
     either way. Q8: whether the before/after eval protocol could detect the quality delta this session
     claims, given the harness's known bootstrap ceiling (ADR 0021 section 10.4). Ask it to be blunt about
     whether the session can prove it worked at all.
   - ecc:typescript-reviewer — on Q5 and Q4. Q5: the tool-use schema shape versus extractJsonBlock plus
     safeParseOrAiError, and whether Zod validation should sit behind the schema or be replaced by it.
     Q4: how a task-conditioned queryContext threads into buildCustomerContext, which is business-scoped
     by construction, WITHOUT widening its service-role acquisition or breaking its existing callers.
   - ecc:code-reviewer — on Q1 and Q7. Q1: the all-N-below-threshold path, partial candidate failure, and
     whether replacing the generate.ts:259 openingStrength retry leaves any caller depending on the old
     behaviour. Q7: whether persisting losing candidates is worth a new table and its full RLS/cascade
     obligation, or whether the trust benefit is achievable without one.
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.
DO NOT invoke impeccable or taste-skill — you SPECIFY the Q7 UX contract; H2 runs them against it.

Read now, before anything else:
- docs/build-guide/session-31.md — the Reality block, section 0 (Locked L-1..L-11 + the D-1..D-7 ledger)
  and section 0.1 (the eight questions Q1..Q8 you MUST resolve). This is your binding input.
- docs/brainstorm/ai-quality-track-ideas-and-build-path.md — Part I in full (sections 1 through 9). T1.2,
  T1.3, T1.4 and T1.5 are this session; T1.1, T2.1, T2.2, T2.4 and T2.5 are NOT and must land in your
  deferred section. Section 5's cost math and section 8's "honest test" are your inputs for Q6 and Q8.
- docs/decisions/0017-mode-2-upgrade.md — Stage A brief assembly, the Stage B critique gate, the format
  families, AND its frozen prompt fixtures. Enumerate every MODE2-* constraint: Q3 owes one line each.
- docs/decisions/0015-test-execution-and-ci-gates.md — section 2 (the three tiers you tier against) and
  Amendment B (Tier E, MEASURED never COVERED) which governs how you may describe an eval result.
- docs/decisions/0021-mode-3-triage-and-opportunity-feed.md — section 10.4 (the eval harness and its
  bootstrap-ceiling framing) and SIGNAL3-COST-CEILING-ATOMIC, the cost mechanism Q6 EXTENDS rather than
  duplicates.
- CLAUDE.md — the AI-layer rule (no Anthropic SDK outside lib/ai/), the three-client rule, atomic
  transitions, Zod, i18n, bounded queries, the UI Component patterns section (shadcn v4 is Base UI: NO
  asChild on Button or DropdownMenu primitives), and the test-execution-integrity section (the three
  tiers, PROC-REVIEW-AT-COMMIT, and SHARED-FUNCTION CALLERS).

The CLOSED file list for the ONE ecc:code-explorer sweep — map these, cite file:line, nothing beyond:
- lib/ai/runner.ts — runPrompt's STEP 1 trial cap / STEP 2 rate limit ordering, the cache_control
  threshold, and the retry helper. REPORT whether ANY sampling parameter is passed today.
- lib/ai/models.ts — the three tiers, calculateCostCents, and the ADR C-4 version-bump comment.
- lib/ai/parsers.ts — extractJsonBlock and safeParseOrAiError, and every caller of each.
- lib/ai/prompts/ — ALL nine families and the Prompt<TInput,TOutput> type in prompts/types.ts. Report
  where a per-prompt parameter would naturally live.
- lib/ai/prompts/rubric.ts — the TEN dimensions, the designed invariant at rubric.ts:21-24, and EVERY
  existing caller (Mode 2 brief gate, Mode 1 Studio, ADR 0021 mode:'card').
- lib/campaigns/generate.ts — the hook loop, the openingStrength retry at :259, the frozen roleSequence at
  :303, and the consistency call site at :308.
- lib/campaigns/brief.ts — the Stage B critique gate at :139 and the rubric call at :170. This session does
  NOT change it; report its shape so the ADR can say so precisely.
- lib/ai/context.ts — CustomerContext, the service-role acquisition, and the EMPTY queryContext passed to
  retrievePerformancePatterns. Enumerate every caller of buildCustomerContext.
- lib/memory/scoring.ts + lib/memory/constants.ts — MemoryQueryContext's three fields, scoreRecord,
  rankAndCap, and the four caps.
- lib/db/ai-usage.ts and wherever SIGNAL3-COST-CEILING-ATOMIC is enforced — Q6 extends this.

Do NOT write the ADR yet. First OUTPUT your answers to the eight section-0.1 questions (Q1 the N-candidate
contract, Q2 sampling/thinking as versioned prompt properties, Q3 the ADR 0017 fixture migration, Q4
task-conditioned retrieval, Q5 structured output, Q6 cost/trial-cap/rate-limit at N, Q7 the UX contract,
Q8 the test plan and the before/after protocol), EACH with its named loser and its ADR 0015 tier, AND a
one-line note on any place a section-0 Locked decision constrains the answer. Flag explicitly if any
answer needs: an eleventh rubric dimension, a new business-scoped table, a change to ADR 0017's brief
critique gate, a new dependency, or a change to the trial-cap accounting a customer can observe — those
are founder adjudications, not your call. Then STOP for acknowledgement.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 31. Write docs/decisions/0024-generation-quality-core.md (status: Accepted). Ground
every claim in the real repo (cite file:line from the ecc:code-explorer sweep). You have already dispatched
your ONE batch of three advisory reviewers — fold their objections in now, or record why you rejected them.
Do not re-consult them.

1. Context + decision summary. State the diagnosis precisely and WITHOUT overstating it: the brief IS
   gated by the full rubric (brief.ts:139); posts get a ONE-dimension, ONE-shot retry (generate.ts:259,
   no re-score); there is NO sampling parameter and NO thinking budget anywhere in lib/ai/; and the
   primary retrieval call site passes an empty queryContext. Name the losers per section 0's D-1..D-7
   ledger.

2. The N-candidate contract (Q1, L-3, L-4) — the load-bearing section. N as a literal number with its
   arithmetic against models.ts's rates. Parallel vs sequential and the partial-failure path. Temperature
   per prompt. Which prompt families are in and which are out, each with a reason. The judging contract
   over the TEN fixed dimensions, with the ones meaningless for this decision named and disposed of (you
   may ignore a dimension; L-4 forbids adding, renaming or removing one). Tie-breaking. And the
   all-N-below-threshold behaviour with its loser named. State explicitly that this REPLACES the
   openingStrength retry, and enumerate every caller that depended on the old behaviour.

3. Sampling and thinking as versioned prompt properties (Q2, L-2). Where the parameters are declared; how
   the version-bump rule becomes enforced rather than remembered, and at which tier; which prompts get a
   thinking budget, each as a NUMBER; and the expected latency change per affected surface.

4. The ADR 0017 fixture migration (Q3, L-5). The inventory of fixtures that move. Re-record vs re-shape,
   argued, with an explicit statement of what coverage is LOST. Then a table: one row per MODE2-*
   constraint, stating that it still holds and naming the test that proves it AFTER the move. Fold in
   ecc:pr-test-analyzer's findings.

5. Task-conditioned retrieval (Q4). The widened MemoryQueryContext, field by field, including the fields
   you deliberately did NOT add and why. How task context reaches business-scoped buildCustomerContext —
   this is the real design problem; cite context.ts's own comment. A SHARED-FUNCTION CALLERS table for
   buildCustomerContext, retrievePerformancePatterns and retrieveVoice: one row per caller, the test that
   covers it, and confirmation that no existing caller's behaviour changes. Confirm the service-role
   acquisition is unchanged. State that caps and cross-type retrieval are OUT of scope (L-1).

6. Structured output (Q5, L-7). The schema shape, the first prompt to migrate and why, Zod's position
   relative to the schema, the malformed-tool-call error path, what extractJsonBlock still owns after this
   session, and the NAMED CONDITION under which it may finally be deleted. Fold in
   ecc:typescript-reviewer's findings.

7. Cost, trial caps and rate limits at N (Q6, L-6, L-9). Answer plainly whether one user-visible
   generation at N consumes 1 or N trial posts, and name the loser. Same for the per-minute rate limit.
   The daily-ceiling arithmetic in literal cents per plan tier. Enforcement BEFORE the fan-out, atomically
   — name the check-then-call race as the failure mode you are designing against, and state that ADR
   0021's mechanism is EXTENDED, not duplicated.

8. The UX contract the Builder is held to — you SPECIFY it, you do not design it (Q7): whether losing
   candidates are persisted, and if so the full L-10 obligation; what the approval surface shows and the
   trust-versus-noise argument resolved with a named loser; every state (generating, judged-and-passed,
   all-below-threshold, judging failed); Server Component page + Client interaction split; Zod on every
   Server Action; shadcn v4 / Base UI with NO asChild on Button or DropdownMenu primitives; Tailwind only;
   i18n en/pt/es simultaneously.

9. GDPR + tenancy (L-10). If a new business-scoped table is introduced: RLS in the InitPlan-wrapped form
   with USING and WITH CHECK on UPDATE, ON DELETE CASCADE from businesses, the ADR 0010 Amendment 2
   section D2.5 cascade row VERBATIM, and purge_business coverage. If none is introduced, SAY SO
   EXPLICITLY and record it as a deliberate no-new-row session (the Session 28-D D7 precedent).

10. Test plan across the tiers (Q8): Tier 1, Tier 2, Tier 3 enumerated as properties of absence, and the
    before/after eval protocol — including the honest statement that the harness's numbers are a bootstrap
    ceiling (ADR 0021 section 10.4, ADR 0015 Amendment B's MEASURED-never-COVERED language) and cannot
    alone prove a real-world improvement. Name the fixture directories. State what is honestly untestable
    and why.

11. A constraint table: every named constraint (QUAL-*), its test tier, and the test that will prove it —
    this is the Reviewer's checklist. Cover at least: QUAL-SAMPLING-VERSIONED, QUAL-BEST-OF-N-JUDGED,
    QUAL-FULL-RUBRIC-SCORED, QUAL-SINGLE-DIM-RETRY-REMOVED, QUAL-ALL-BELOW-THRESHOLD-DEFINED,
    QUAL-RUBRIC-UNCHANGED, QUAL-THINKING-BUDGETED, QUAL-QUERY-CONDITIONED, QUAL-CONTEXT-CALLERS-UNCHANGED,
    QUAL-STRUCTURED-OUTPUT, QUAL-PARSER-RETAINED, QUAL-COST-CEILING-EXTENDED, QUAL-GUARD-ORDER-PRESERVED,
    QUAL-NO-NEW-AI-SURFACE, QUAL-MODE2-FIXTURES-MIGRATED.

12. Explicit "deferred" section, naming each item and the session that owns it: voice exemplars and ALL
    similarity/embedding retrieval — deferred here on SEQUENCING, not on a block: SIGNAL-NO-EMBEDDINGS was
    SCOPED to Mode 3's deterministic half on 2026-09-03 (pre-launch-scope section 12.6, ADR 0020 section
    17c, ADR 0023 section 21) and NOT retired, and the ADR must say exactly that rather than repeating the
    stale "re-affirmed, therefore blocked" line; generator tools; claim verification; the campaign planner;
    cross-type retrieval;
    memory write expansion; the social backfill; the outcome loop; and anything Q1-Q7 pushed to a
    follow-on.

Do NOT write code. End with one line: "ADR 0024 written and accepted — <n> QUAL-* constraints, N=<n>,
temperature <value>, thinking on <prompts>, <n> fixtures migrated, trial units per generation <1|N>, daily
ceiling arithmetic <value>, losing candidates <persisted|discarded>." Then /exit.
```

**Gate:** do not author §2 until ADR 0024 exists and is Accepted, and the eight §0.1 answers are on the
record. **If any answer required founder adjudication, that adjudication is recorded as a `§0.2 — Founder
adjudications` block in this file before the Builder starts** — exactly as Sessions 22–30 did. Then author
§2/§3 below from the accepted ADR's real `QUAL-*` constraint names.

---

## §2 — Builder session (H2)  ·  (paste into Claude Code · Sonnet)

> **PLACEHOLDER — authored after ADR 0024 is Accepted and §0.2 exists (or is recorded as "no adjudications
> required").** Do not write this section speculatively: Builder steps are written from the ADR's *real*
> constraint names, and written earlier they cite constraints that do not exist yet.
>
> **What this section will contain when authored:**
>
> - **§2a — Builder primer**, pasted first, ending by stopping for acknowledgement. Topics: the §0 Locked
>   list and the §0.2 adjudications as inherited hard rules; the ADR decisions H2 **transcribes rather
>   than re-derives** (N, temperature per prompt, thinking budgets, the all-below-threshold behaviour, the
>   trial-unit ruling); the scope tripwires below; and the verification loop
>   (`npx tsc --noEmit --skipLibCheck` + `npx vitest run lib/db lib/social lib/validation` plus the
>   session's own paths — never bare `npx vitest run`, which picks up ECC test files that call
>   `process.exit()`).
>
> - **§2b — Builder steps**, one paste block per step, each a self-contained
>   `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle naming the ADR constraints it closes and
>   the test proving each. A step closing no constraint does not exist.
>
> **Ordering, and its rationale** — this is the part a later session must not re-derive:
>
> 1. **`H2.0` grounding pass** — re-verify every ADR premise against the live repo, no code, no commit.
>    Reality §1 (no `temperature` anywhere) is the one most likely to have drifted, and the whole session
>    is void if it has.
> 2. **Sampling parameters + the version-bump rule first**, before any judging. Without a temperature
>    change, N candidates are near-identical and every subsequent step measures nothing.
> 3. **The judge before the fan-out.** Full-rubric scoring of a single candidate is testable on its own and
>    is the piece that replaces `generate.ts:259`; landing it first means the fan-out step adds only
>    concurrency, not concurrency *and* a new scoring path.
> 4. **The fan-out, then the all-below-threshold path**, which is the branch most likely to be left
>    untested and is the one the founder adjudicated.
> 5. **The ADR 0017 fixture migration as its own step**, never folded into a behaviour step — a diff that
>    changes fixtures *and* behaviour together cannot be reviewed.
> 6. **Task-conditioned retrieval**, independent of the above and safely last among the behaviour changes.
> 7. **Structured output for the first migrated prompt only** (L-7), then the source scans and the Tier-3
>    enumeration, then coverage verification and close-out.
>
> **Scope tripwires, written as executable scans rather than review comments** (the house rule — a scope
> rule that lives as prose is not enforced): `QUAL-NO-NEW-AI-SURFACE` (no new prompt family, no new route);
> `QUAL-PARSER-RETAINED` (`extractJsonBlock` still imported by every unmigrated prompt);
> `QUAL-SINGLE-DIM-RETRY-REMOVED` (zero remaining callers of the removed path);
> `QUAL-RUBRIC-UNCHANGED` (the ten dimension names byte-identical, and `mode:'brief'` output unchanged for
> its existing callers); and a scan proving **no `lib/memory/` write path was added** (L-1).
>
> **Cost note for the step budget:** the eval harness runs in this session's CI. Its cost is real and the
> primer states it, so a Builder does not discover it mid-run.

---

## §3 — Reviewer session (H3)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored after ADR 0024 is Accepted, alongside §2.** The Reviewer's checklist *is* the
> ADR's constraint table, so it can be written before H2 runs; only the commit range is filled in at run
> time, by the Reviewer itself.
>
> **What this section will contain when authored:**
>
> - **§3a — Reviewer primer**, pasted first, ending by stopping for acknowledgement.
> - **§3b — Reviewer prompt**, pasted after acknowledgement.
>
> **Binding process rules the section must carry:**
>
> - **`PROC-REVIEW-AT-COMMIT`** — H3 reads every file **at the stated commit range**
>   (`git diff <base>..<head>`, `git show <sha>:<path>`, `git log --oneline <base>..<head>`), **never at
>   HEAD**. The report **must open by naming the exact range it read**; a report that does not name its
>   range is not a valid review. (Session 21B's false-positive MAJOR came from reading at HEAD.)
> - **`SHARED-FUNCTION CALLERS`** — `runPrompt`, `buildCustomerContext`, `retrievePerformancePatterns`,
>   `retrieveVoice` and `rubricPrompt` all have multiple callers. Before marking any constraint on them
>   tested, `git grep` the callers and list, **per caller**, which test file exercises it. A caller with no
>   listed test is `AUTHORED-NOT-EXECUTED` for that caller even if another is fully covered. Both Session
>   22 blockers were this exact failure.
> - **The coverage-count rule** — do not accept a claimed count of covered constraints. Verify each is
>   **executed green in CI at the head it is dated to**. Session 28 shipped a false "29/29" that took three
>   correction steps to undo.
> - **Tier-E language** — any eval number is `MEASURED`, never `COVERED` (ADR 0015 Amendment B). A
>   before/after quality delta from the harness is evidence, not proof, and its bootstrap-ceiling caveat
>   must be restated wherever the number is.
>
> **The three findings this session is most likely to produce**, stated so H3 looks for them specifically:
> a fixture migration that quietly weakens a `MODE2-*` constraint; an all-below-threshold path with no
> test that can actually fail; and a trial-cap or rate-limit accounting that differs from the §0.2 ruling.

---

## §4 — Correction pass (Session 31-D)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored ONLY after H3 has actually run and `docs/reviews/session-31-reviewer.md`
> exists.** A correction pass is a response to findings; there is nothing to order, prioritise or resolve
> until the findings exist, and inventing them ahead of time produces a fictional resolution log.
>
> **What this section will contain when authored:** founder adjudications arising from the review → *"What
> the Reviewer found (summary — `docs/reviews/session-31-reviewer.md` is authoritative)"* → the ordering
> rationale → where resolutions go → **§4.0** correction primer → **§4.1** correction steps (`D0 … Dn`,
> one paste block each) → **§4.2** resolution log → **§4.3** close-out.
>
> **`D0` is always the audit-trail step:** land the governing documents in git first, before any code
> change, so the range being corrected is itself reviewable.
>
> **Where resolutions go — `REVIEWER-REPORT APPEND-ONLY` (CLAUDE.md, revised Session 23-D). All four
> conditions bind:**
>
> 1. **No in-place edit, ever** — not one character of the Reviewer's text changes. No verdict flipped, no
>    status column rewritten, no RESOLVED stamped onto a finding, nothing reworded, deleted or reordered.
> 2. **One appended, attributed section** — a single `## CORRECTION PASS (Session 31-D)` at the **end** of
>    the reviewer's own file, opening with its author, date, and the commit range it fixed. A reader must
>    be able to tell from any line which of the two wrote it.
> 3. **Findings are referenced, never restated as resolved** — cite each by ID and record *finding → fix →
>    the test that now proves it → the commit SHA*.
> 4. **A disputed or withdrawn finding is argued, not erased** — say why in the appendix; the Reviewer's
>    original text stays as the evidence the reader judges against.
>
> The Session 22-D failure — writing RESOLVED verdicts *into* the reviewer's finding text — remains
> prohibited under condition 1.

---

## §5 — Docs to update at close-out (Track H done)

- [ ] `docs/decisions/0024-generation-quality-core.md` — Accepted, with its final constraint table and the
      real post-correction counts (verified executed green in CI at the head they are dated to, not
      claimed).
- [ ] `docs/decisions/0017-mode-2-upgrade.md` — amendment note recording the fixture migration and, per
      `MODE2-*` constraint, that it still holds and which test proves it after the move.
- [ ] `docs/current-phase.md` — Session 31 entry under "What's done"; the `db-tests` promotion tally
      (state whether the run was a `master` push event or a `pull_request` event — only the former counts);
      the before/after eval numbers with their bootstrap-ceiling caveat restated, never blended.
- [ ] `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` — mark T1.2, T1.3, T1.4, T1.5 shipped;
      correct §1's diagnosis for the new reality (the doc's §1 describes the pre-Session-31 state and will
      be wrong the moment this lands).
- [ ] `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — a cascade row **if** a new business-scoped
      table shipped, **or an explicit note that no new row was required** (the Session 28-D D7 precedent).
- [ ] `docs/backlog.md` — anything H1 deferred, each with its un-defer trigger named.
- [ ] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md` — new/changed files, the session summary,
      and any correction the founder made to the approach.
- [ ] `docs/reviews/session-31-reviewer.md` — exists, opens by naming its commit range, and carries the
      single appended correction-pass section.

**Next:** `docs/build-guide/session-32.md` — Track I, the social read path and cold-start backfill
(ADR 0025), which resolves open decision 19D-5 and unblocks the rest of the memory programme.
