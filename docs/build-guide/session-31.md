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

**Status: CLOSED — adjudicated by the founder on 2026-09-06**, against H1's eight §0.1 answers. The
Builder gate is now: ADR 0024 written and Accepted, carrying these four rulings. Where a ruling goes
**against** H1's recommendation, H1's recommendation is preserved in the ADR as the named loser and the
reasoning is recorded below — nothing is rewritten in place. A revised ruling gets a prime (`A-1` →
`A-1′`) with both visible, per the `session-29.md` L-9/D-8 precedent.

| # | Question | Decision | Where encoded |
|---|---|---|---|
| **A-1** | Pro is sold as *"unlimited posts"* (CLAUDE.md Locked pricing). At N=3 the generation cost of a Pro business is unbounded by construction (H1 Q6). Bound it by AI **spend** or by **posts**? | **Explicit daily post cap on Pro. Against H1's recommendation** — H1 recommended a daily *AI-spend* ceiling precisely so that "unlimited posts" stayed marketing-true; the founder ruled for a post-count cap on the grounds that a post cap is legible to the customer where a spend cap is not. **Cap value: 15 posts/day/business** (derivation below). ⚠️ **This contradicts a Locked pricing decision and carries a copy obligation — see A-1 note.** | ADR 0024 §7 (H1's spend-ceiling recommendation preserved as loser) · `lib/config.ts` · `QUAL-PRO-DAILY-POST-CAP` (Tier 1) |
| **A-2** | Extending the daily cost ceiling from triage to generation needs a home; ADR 0021's mechanism is `signal_triage_budget` (H1 Q6, flag A-2). | **Rename `signal_triage_budget` to a general per-business AI budget table** — H1's recommendation, adopted. One reservation mechanism, one race. The rename is **its own tracked piece of work** per CLAUDE.md's naming rule, executed inside Session 31 because the extension is not expressible without it. D-6's second-table loser stands named. | ADR 0024 §7 + §9 · rename migration + ADR 0021 cross-ref · `QUAL-COST-CEILING-EXTENDED` (Tier 1), `QUAL-NO-SECOND-BUDGET-TABLE` (Tier 3) |
| **A-3** | Below-threshold posts (no candidate cleared 70) are today exactly as one-click bulk-approvable as any other draft — `bulkApproveDraftPosts` (`lib/db/posts.ts:594-612`) approves by id with no quality predicate, so the amber flag is cosmetic (H1 Q7, flag A-3). | **Exclude below-threshold posts from bulk-approve** — H1's recommendation, adopted. They require individual approval. The founder accepts that this is a **customer-observable behaviour change**: a bulk approve now leaves drafts behind, and the surface must say why rather than silently skipping them. | ADR 0024 §8 · `QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE` (Tier 2) · i18n en/pt/es |
| **A-4** | A 4,000-token thinking budget on `briefAssemblyPrompt` adds ~8–15s to a user-visible step (H1 Q2, flag A-4). | **Accept the latency at the full 4,000-token budget** — H1's recommendation, adopted. Brief assembly is strategic and already runs async behind `after()`; the wait buys the largest single quality lever in the pipeline. The Builder owes a progress state that sets the expectation. | ADR 0024 §3 · `QUAL-SAMPLING-VERSIONED` (Tier 2) · brief surface loading state |

**A-1 — derivation of the 15/day figure.** From H1's Q6 table: N=3 plus three Haiku judge calls costs
≈6.7¢ true / ≈10¢ recorded per post (`calculateCostCents` ceils per call, so recorded overstates true by
roughly 2× on cheap calls — itself an argument for a reservation ceiling over an `ai_usage` sum, D-6).
15 posts/day = 450/month = **€45/mo recorded, ≈€30/mo true**, i.e. 36% of Pro's €125 at recorded cost and
24% at true cost. It sits at 1.8× Plus's 250-post monthly cap, so "unlimited" degrades gracefully rather
than landing below the cheaper tier. **The founder may override the number in one line** without
reopening the ruling; the mechanism, not the constant, is what the ADR fixes.

**A-1 — copy obligation (tracked, NOT a Builder task).** CLAUDE.md's Locked pricing says Pro is
*"unlimited posts"*. A-1 makes that false. Before launch, the pricing line and every marketing surface
must read *"unlimited campaigns; fair-use daily post limit"* (or equivalent). This is a founder/copy
change to a Locked decision, not a code change, and it is **out of scope for H2** — it is recorded here
and in `docs/backlog.md` so it cannot be lost. Shipping A-1 without the copy change is a
customer-facing misrepresentation.

**A-2 — rename scope.** The rename touches the ADR 0021 table, its guarded-upsert RPC
(`20260807110000_mode3_triage_state.sql:133-152`), its RLS policy, its ADR 0010 Amendment 2 §D2.5 cascade
row (the row **moves with the table**, it is not a new row — L-10's explicit-statement branch still
applies and Session 31 introduces **no new business-scoped table**), and every caller. It does **not**
change the reservation semantics.

**Constraints these adjudications added:** `QUAL-PRO-DAILY-POST-CAP` (Tier 1 — the enforced ceiling under
two concurrent reservations and first-call-of-day, the ADR 0021 case shape) and
`QUAL-NO-SECOND-BUDGET-TABLE` (Tier 3 — a property of absence: the rename, not a duplicate mechanism).
`QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE` was already named by H1 under Q7 and is not double-counted.
A-4 added none.

**ADR 0024 total constraint count: 28** — 26 named across H1's Q1–Q7 answers plus the 2 above. The ADR's
own constraint table (§1b item 11) is authoritative on the final names; where §1b's *illustrative* list
(`QUAL-BEST-OF-N-JUDGED`, `QUAL-FULL-RUBRIC-SCORED`, …) and H1's actual names disagree, **H1's names win**
— §1b listed a minimum to cover, not a fixed vocabulary. **Zero Tier-E constraints this session**, per
H1's Q8 answer and ADR 0015 Amendment B1.2.

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

**✅ AUTHORED 2026-09-08 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Gate satisfied: `docs/decisions/0024-generation-quality-core.md`
is **Accepted**, carrying **29 `QUAL-*` constraints (4 Tier 1, 18 Tier 2, 7 Tier 3, 0 Tier E)** and its own
§15 self-corrections; `§0.2` records **A-1 … A-4** with H1's superseded recommendation preserved on A-1.

**Three places where the ADR overrode the placeholder above, stated first because a Builder reading only
the placeholder would build the wrong session:**

1. **There is no fixture-migration step.** Placeholder item 5 inherited L-5's premise that sampling moves
   ADR 0017's frozen fixtures. **ADR §4.1 disproves it against this repo:** `MockAnthropicClient`
   (`lib/ai/client.ts:49-88`) routes only on `params.model`, `params._sosh.promptId` and
   `sosh.input.targetPlatform` — `temperature`, `top_p` and `thinking` never touch routing.
   **Fixtures re-recorded in Session 31: 0.** `QUAL-MODE2-FIXTURES-MIGRATED` survives as a **Tier-3
   property of absence** (`H2.13`), not as a migration. A Builder that re-records a fixture "to be safe"
   has broken the constraint it thought it was serving.
2. **`QUAL-SINGLE-DIM-RETRY-REMOVED` does not exist under that name.** §11's mapping renames it
   `QUAL-HOOK-RETRY-REMOVED`, and `QUAL-ALL-BELOW-THRESHOLD-DEFINED` splits into `QUAL-THREE-OUTCOMES` +
   `QUAL-BELOW-THRESHOLD-SURFACED`. **The ADR's names win** (§0.2). Every step below uses them.
3. **Two migrations land that the placeholder did not anticipate**, both forced by §0.2: the
   `signal_triage_budget` → `ai_budget_daily` rename with a mandatory `purpose` discriminator (A-2, §7.5b)
   and the winner's score columns on `post_ai_originals` (§8.2). **Neither introduces a new
   business-scoped table** (§9) — that is the L-10 explicit-statement branch, and `H2.13` records it.

**The ADR decisions H2 TRANSCRIBES rather than re-derives.** Every one of these has a named loser in ADR
0024; a Builder that re-opens one has left the plan.

| Decision | Value | ADR |
|---|---|---|
| N | **3** | §2.1 |
| Concurrency | **parallel within a post, bounded to 3; sequential across posts** | §2.2 |
| Temperature | **1.0 on the three `native-generation-*` ids only**; every other id **unset** | §2.4 |
| Thinking | **4,000 on `brief-assembly` only**, with **`maxTokens: 12_000` in the same declaration** | §3.3, §3.3a |
| Judge | **N separate calls to the existing `rubricPrompt` at `mode:'post'`**, over `joinContent`, each `neutralize()`'d | §2.6 |
| Selection key | **`overall`**; tie ⇒ **lowest candidate index** | §2.6, §2.7 |
| All N below 70 | **surface the best of the set, flagged**; do not fail, do not regenerate, do not escalate | §2.8 |
| Trial units per generation | **1**, and it is **already true by construction** | §7.2 |
| Rate-limit units | **N** — and the default rises **30 → 100** | §7.3 |
| Losing candidates | **DISCARDED** — no `post_candidates` table | §8.1 |
| Pro daily cap | **15 posts/day/business**, reserved as **posts, not cents** | §7.4, §7.5a |
| First tool-use migration | **`learningSummarizerPrompt`**, and only that one | §6.2 |

**Ordering, restated as binding.** Each position below is forced by something that breaks under the
alternative — this is not a preference list.

1. **`H2.0` grounds and ships nothing.** ADR 0024 cites roughly a hundred `file:line` locations and was
   itself corrected five times post-review (§15). Reality §1 — *no `temperature` anywhere in `lib/ai/`* —
   is the premise the entire session rests on, and it is bought down first for the price of one step.
2. **The prompt-property plumbing (`H2.1`) precedes every declared value (`H2.2`).** `H2.1` adds the
   optional fields and the ten-row frozen table while **nothing declares a value**, so
   `QUAL-SAMPLING-DEFAULT-PRESERVED` is proven against a tree that is byte-identical to today. Landing the
   plumbing and the values together makes "unchanged for the nine that declare nothing" unprovable.
3. **The mock harness (`H2.3`) precedes the fan-out.** ADR §10.2: *"the mock must be able to return a
   sequence of distinct payloads for one `promptId`. Without it, `QUAL-ARGMAX-DETERMINISTIC` and
   `QUAL-BELOW-THRESHOLD-SURFACED` are `AUTHORED-NOT-EXECUTED` by construction"* — three identical
   payloads make every argmax a 3-way tie and the assertion passes on nothing.
4. **The score columns (`H2.4`) precede the judge**, because the judge is the first thing with a score to
   persist.
5. **The judge replaces the retry at N=1 (`H2.5`), then the fan-out adds concurrency (`H2.7`).** Two
   changes in one diff — a new scoring path *and* a fan-out — cannot be bisected when a case goes red.
6. **The rate-limit raise (`H2.6`) precedes the fan-out.** At N=3 a 12-entry campaign issues 36 generation
   calls against `AI_RATE_LIMIT_POST_GENERATION_PER_MIN = 30` (`lib/config.ts:37`) and **dies mid-run with
   `rate_limited`**. Landing the fan-out first means `H2.7` goes red for a reason that has nothing to do
   with `H2.7`.
7. **The budget rename (`H2.8`) precedes the cap that uses it (`H2.9`).** `reserve_ai_budget` does not
   exist until `H2.8`, and reserving against `reserve_triage_budget` would be exactly D-6's second-ceiling
   loser wearing the first ceiling's name.
8. **Structured output (`H2.10`) is last among the runtime changes** and its first sub-task is the runner's
   parse path, per ADR §4.5 blocker 1: `runner.ts:191`'s `content.find(b => b.type === 'text')` yields
   `rawText = ''` for a `tool_use` response, and `safeParseOrAiError` then fails on every single call. The
   parse path learns `tool_use` **before** any prompt declares a tool — not after, and not in the same
   commit as the prompt.
9. **The surface (`H2.12`) lands after everything it renders**, and consumes the score columns `H2.4`
   created and the below-threshold flag `H2.7` sets.

**Two orderings a Builder will get wrong unless told:**

- **`brief-assembly`'s `thinking` and its `maxTokens` land in the SAME commit** (§3.3a). A 4,000-token
  thinking budget against `DEFAULT_MAX_TOKENS = 4096` (`runner.ts:30`) leaves **96 tokens** of visible
  output, and **every** Stage A assembly fails at `runner.ts:185` with `response_truncated` —
  deterministically, on the first call, on the product's most strategic path. One version bump
  (`brief-assembly` → `version: 2`) covers both fields.
- **`QUAL-HOOK-RETRY-REMOVED` closes in `H2.5`, not `H2.7`.** The `openingStrength` retry is removed by the
  step that *replaces* it, while N is still 1. Deferring the removal to the fan-out step leaves two quality
  gates live on one artefact for the length of a commit — D-2's named loser, shipped by accident.

**Scope tripwires — each becomes an executable scan in `H2.13`, not a review comment:**

- **`QUAL-NO-NEW-AI-SURFACE`** — no new route, no new user-facing generation entry point, no new prompt
  family (L-8). The scan enumerates the **ten** prompt ids of ADR §2.4 and fails on an eleventh.
- **`QUAL-PARSER-RETAINED`** — `extractJsonBlock` still present and still exercised by the **nine**
  unmigrated prompt ids and `lib/ai/tool-runner.ts:445`.
- **`QUAL-RUBRIC-UNCHANGED`** — the ten dimension names byte-identical, `RubricOutputSchema` byte-unchanged,
  and `rubric.ts:21-24`'s invariant comment intact.
- **`QUAL-SERVICE-ROLE-UNWIDENED`** — no new `createServiceRoleClient` call site outside
  `lib/ai/context.ts`; no `client` parameter added to `buildCustomerContext` **or** `withPostQueryContext`.
- **`QUAL-NO-SECOND-BUDGET-TABLE`** — the migration **renames**; a second `CREATE TABLE` for a budget
  mechanism fails.
- **`QUAL-MODE2-FIXTURES-MIGRATED`** — no fixture re-recorded for sampling reasons, and the
  `post-generation` orphan audit's outcome (**keep them**, §4.2) recorded in the PR.
- **No `lib/memory/` write path is added** (L-1) — a scan over `lib/memory/` for a new insert/update export.

**Each tripwire is demonstrated to REDDEN against a temporary violation and then reverted.** A scan that
has never failed is not a scan; it is a comment with a test-runner attached.

**Definition of done for every step:** `npm run typecheck` clean; `npm run test:app` green;
`npm run test:db` green where the step touches DB behaviour; each named constraint **demonstrated to redden
against the pre-fix code and then reverted**; one commit per step whose subject names the step id and the
constraints it closes. **Never bare `npx vitest run`** — it picks up ECC test files that call
`process.exit()` and fails for reasons that have nothing to do with this repo.

**ECC budget for the Builder phase — three subagent invocations, total.** One `ecc:code-explorer` in
`H2.0` over that step's closed file list and no other. One `ecc:database-reviewer` scoped to **`H2.4` and
`H2.8` together**, before either is committed — they are the session's only two migrations and one of them
renames a live table with a guarded-upsert RPC. One `ecc:typescript-reviewer` scoped to **`H2.10` alone**
(the `z.toJSONSchema` derivation, Zod's position behind the tool schema, and `TOutput`'s inference).
**No reviewer per step, and no re-consultation.** Skills are free and do not count: `/ecc:plan`,
`/ecc:tdd-workflow`, `/ecc:verification-loop` on every step;
`supabase:supabase-postgres-best-practices` while authoring the two migrations; **`taste-skill` and
`impeccable` in `H2.12` only**, against ADR 0024 §8.5.

**Cost note, so it is not discovered mid-run.** The `eval-triage` harness **does not apply to this
session** — `.github/workflows/eval-triage.yml:47-52` gates on triage paths and no Session 31 file matches
its filter, so it exits 0 with `applicable: false` (ADR §10.4(1)). **Running it and reporting a green is
reporting nothing**, and no step below asks for it. The real cost in this session is the N=3 arithmetic
itself: ≈**10¢ recorded** per generated post against ≈4.9¢ today (§2.1).

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 31 Track H - BUILDER phase (H2). You implement ADR 0024. You write code; you do NOT make
architectural decisions. Every decision you need has already been made and carries a named loser. If you
find yourself choosing between two designs, STOP and report - that is an ADR gap, not your call.

READ FIRST, in this order:
- docs/decisions/0024-generation-quality-core.md - ALL of it, including Section 15 (corrections applied
  after the H1 review). Where Section 15 corrects an earlier statement, THE CORRECTION IS THE STANDARD.
  Section 3.3a, Section 7.5a and Section 7.5b are corrections and they are load-bearing.
- docs/build-guide/session-31.md - the Reality block, Section 0 (Locked L-1..L-11 and the D-1..D-7
  ledger), and Section 0.2 (founder adjudications A-1..A-4). SECTION 0.2 IS YOUR GATE.
- docs/decisions/0017-mode-2-upgrade.md - its 21 MODE2-* constraints. ADR 0024 Section 4.4 dispositions
  every one of them; you append the amendment note in H2.13.
- docs/decisions/0015-test-execution-and-ci-gates.md - Section 2 (the three tiers) and Amendment B
  (Tier E, MEASURED never COVERED).
- CLAUDE.md - the AI-layer rule (no Anthropic SDK outside lib/ai/), the three-Supabase-client rule, the
  RLS and erasure-cascade rules, atomic transitions, Zod, i18n, bounded queries, the UI Component
  patterns section, and the test-execution-integrity section.

BINDING RULES YOU WILL BE REVIEWED AGAINST:

1. TRANSCRIBE, DO NOT RE-DERIVE. N is 3. Temperature is 1.0 on native-generation-single, -thread and
   -carousel ONLY. Thinking is 4000 on brief-assembly ONLY, WITH maxTokens 12000 in the same declaration.
   The selection key is the rubric's `overall`; a tie goes to the lowest candidate index. All N below 70
   surfaces the best of the set, flagged - it does NOT fail the session, does NOT regenerate, and does NOT
   escalate to Opus. Losing candidate CONTENT is never persisted. If you want to change one of these
   numbers, you are re-opening an adjudicated decision.

2. ZERO FIXTURES MOVE. The build guide's L-5 assumed sampling changes recorded outputs. ADR 0024 Section
   4.1 DISPROVES that for this repo: lib/ai/client.ts:49-88 routes only on params.model,
   params._sosh.promptId and sosh.input.targetPlatform. temperature and thinking never touch routing.
   Re-recording a fixture "to be safe" BREAKS QUAL-MODE2-FIXTURES-MIGRATED, which is a property of
   ABSENCE. Do not touch lib/ai/__fixtures__/ except as H2.3 requires for the mock harness.

3. THE TEN RUBRIC DIMENSIONS ARE FIXED (L-4). No eleventh, no rename, no removal, and RubricOutputSchema
   is byte-unchanged. The judge is N separate calls to the EXISTING rubricPrompt at mode:'post' - NOT one
   multiplexed call returning three score sets, which would change the schema that lib/studio/categories.ts
   derives from. If judging appears to need a new dimension, STOP and report: that is a founder
   adjudication affecting three existing callers.

4. EVERY CANDIDATE IS neutralize()'d BEFORE IT REACHES THE JUDGE. generate.ts:266-271 already does this
   for the single opener, and the reason is recorded: the content is the model's own prior output being
   fed back into a second AI call. Dropping it during the refactor is a silent prompt-injection
   regression. QUAL-CANDIDATE-NEUTRALIZED exists because this is exactly the guard a refactor loses.

5. THE JUDGE SCORES THE WHOLE BODY, NOT THE OPENER. Today only extractOpener(output) is scored. Judging
   scores joinContent(output), because nine of the ten dimensions are undefined over a single sentence.

6. runPrompt's GUARD ORDERING IS UNTOUCHED (L-9). STEP 1 trial cap, STEP 2 rate limit, STEP 3 assembly
   (runner.ts:92-112). You reorder nothing, bypass nothing, and add NO fourth step inside runPrompt. The
   new budget reservation sits OUTSIDE and ABOVE runPrompt, in generate.ts, before the fan-out.

7. TRIAL UNITS: ONE PER USER-VISIBLE GENERATION, AND IT IS ALREADY TRUE. runner.ts:217 skips the per-call
   increment for BOTH isPostGeneration(prompt.id) AND isScoringOnly(prompt.id); the orchestrator
   batch-increments once after insert. QUAL-TRIAL-UNIT-PER-POST is a REGRESSION test over those two
   predicates, not a new mechanism. Your obligation is the NEGATIVE one: neither predicate may be
   narrowed, and the batch increment stays at one per inserted post.

8. RATE LIMIT COUNTS PROVIDER CALLS, SO N COUNTS AS N. Counting six calls as one would be a hole through
   the STEP 2 guard. The default rises 30 -> 100 via lib/config.ts (NEVER process.env directly).

9. NO NEW BUSINESS-SCOPED TABLE (ADR Section 9). The winner's scores are COLUMNS on the existing
   post_ai_originals; the budget change is a RENAME plus one column on the existing signal_triage_budget.
   Both are explicit no-new-cascade-row cases on the Session 28-D D7 precedent. If you find yourself
   writing CREATE TABLE, STOP and report.

10. THE BUDGET RENAME ADDS A MANDATORY purpose DISCRIMINATOR (Section 7.5b). UNIQUE (business_id, purpose,
    day), purpose IN ('triage_cents','generation_posts'), reserved_cents -> reserved_units. Two consumers
    sharing ONE counter means a triage-heavy morning silently starves post generation. Both RPCs RETURN
    SETOF the old table, so the migration DROPs and recreates them - CREATE OR REPLACE cannot change a
    return type - and re-issues the REVOKE/GRANT pair for each. Existing rows backfill to
    purpose='triage_cents' with reserved_units carrying the old reserved_cents value.

11. GENERATION RESERVES POSTS, NOT CENTS (Section 7.5a). One unit, one reservation, before the fan-out.
    NOT one reservation per candidate - that reopens the check-then-call race N-fold inside a single
    generation, which is L-6's explicit loser. A generation that hard-fails releases its unit through
    reconcile_ai_budget. Pro reserves; Plus and trial do NOT (Section 7.4).

12. THE A-1 PRICING COPY IS NOT YOURS. CLAUDE.md's Locked pricing says Pro is "unlimited posts" and A-1
    makes that false. The copy change is a founder task, tracked as 31-A1-PRICING-COPY in docs/backlog.md
    Section 1. Do not edit CLAUDE.md's pricing line and do not edit marketing copy.

13. TOOL-USE MIGRATES EXACTLY ONE PROMPT: learningSummarizerPrompt (Section 6.2). extractJsonBlock stays
    for the other nine ids and for tool-runner.ts:445. The runner's parse path learns tool_use BEFORE any
    prompt declares a tool, or the first migrated prompt returns rawText = '' and fails on every call.

14. CONDITIONING CHANGES WHAT IS ASKED FOR, NEVER WHO ASKS (Section 5.3). buildCustomerContext takes no
    client parameter and lazy-imports createServiceRoleClient; withPostQueryContext does the same and also
    takes no client parameter. Adding one lets a caller pass an authenticated client into a service-role
    read path and get silent permission failures.

15. SHARED-FUNCTION CALLERS. Before you mark ANY constraint on a shared function as tested, git grep its
    callers and state, PER CALLER, which test file exercises it. A caller with no listed test is
    AUTHORED-NOT-EXECUTED even if another caller is fully covered. This session has five such functions:
    buildCustomerContext (TEN production call sites across NINE files - lib/campaigns/brief.ts holds two;
    ADR Section 5.4 has the table), retrievePerformancePatterns, retrieveVoice, rubricPrompt (three
    existing callers plus the judge), and bulkApproveDraftPosts (TWO callers - ApprovalsInbox AND
    PostsClient). Both Session 22 blockers were bulkApproveDraftPosts verified against one of its two
    callers across three consecutive sessions.

16. CONTRACT DISCIPLINE: Zod on every route and Server Action input; atomic conditional UPDATEs, never
    read-then-update; every list query bounded with an explicit ORDER BY matching an index; date-fns and
    formatISO(), never raw .toISOString(); no `any`; no console.* outside the single canonical worker line;
    env only via lib/config.ts; DB only via lib/db/ and lib/memory/; service-role never in a user-facing
    read path; i18n en/pt/es landed together in the same commit.

17. shadcn v4 is Base UI: NO asChild on Button or DropdownMenu primitives. A link styled as a button uses
    buttonVariants() on a <Link className={cn(buttonVariants({...}))}>.

ECC BUDGET FOR THIS PHASE: THREE subagent invocations, total. One ecc:code-explorer in H2.0 over that
step's closed file list. One ecc:database-reviewer scoped to H2.4 AND H2.8 together, before either is
committed. One ecc:typescript-reviewer scoped to H2.10 alone. No reviewer per step, no re-consultation.
Skills are free: /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop on every step;
supabase:supabase-postgres-best-practices while authoring the migrations; taste-skill and impeccable in
H2.12 ONLY, against ADR 0024 Section 8.5.

DO NOT RUN THE EVAL HARNESS. .github/workflows/eval-triage.yml:47-52 gates on triage paths; no Session 31
file matches its filter, so it exits 0 with applicable: false. Running it and reporting a green is
reporting nothing (ADR Section 10.4).

VERIFICATION, every step: npm run typecheck ; npm run test:app ; npm run test:db where the step touches DB
behaviour. NEVER bare `npx vitest run` - it picks up ECC test files that call process.exit(). Each named
constraint must be DEMONSTRATED TO REDDEN against the pre-fix code and then reverted; an assertion that
cannot fail is not coverage. One commit per step, subject naming the step id and the constraints it closes.

Acknowledge in ONE line confirming you have read ADR 0024 including Sections 3.3a, 4.1, 7.5a, 7.5b and 15,
and that you understand rule 1 (transcribe, do not re-derive) and rule 2 (zero fixtures move). Then STOP
and wait for the step list.
```

### §2b — Builder steps

Each step is one paste, one commit. **A step that closes no ADR constraint does not exist** — `H2.0` and
`H2.3` are the two deliberate exceptions: the first retires premise risk, the second is the test-harness
deliverable ADR §10.2 declares *"a prerequisite, not optional"*, without which two Tier-2 constraints are
`AUTHORED-NOT-EXECUTED` by construction.

| Step | What it ships | Constraints closed | Tier |
|---|---|---|---|
| **H2.0** | **Grounding pass — no code, no commit.** Re-verify every ADR premise, the ten prompt ids, the ten `buildCustomerContext` call sites, the two trial-cap predicates, and the budget objects the rename touches. | — | — |
| **H2.1** | **Prompt-property plumbing.** Optional `temperature`/`thinking` on `Prompt<TInput,TOutput>`; `runner.ts` reads them with the `??`-and-omit shape; the ten-row frozen table. **No prompt declares a value yet.** | `QUAL-SAMPLING-DEFAULT-PRESERVED`, `QUAL-SAMPLING-VERSIONED` | 2 |
| **H2.2** | **The declared values.** `temperature: 1.0` inside the native-generation factory (three version bumps); `thinking: 4000` **and** `maxTokens: 12_000` on `brief-assembly` at `version: 2`; the thinking-then-text parse; the no-prompt-declares-both assertion. | `QUAL-THINKING-BUDGETED` | 2 |
| **H2.3** | **The mock harness — no production code.** `MockAnthropicClient` returns a *sequence* of distinct payloads for one `promptId`; `__evalCassetteQueue` gets a scoped set-up/tear-down helper. | — (named prerequisite for #4 and #6) | — |
| **H2.4** | **Migration A — the winner's score columns** on `post_ai_originals`, `schema_version` bumped, the `lib/db` writer, and the Tier-1 erasure case. | `QUAL-SCORES-IN-ORIGINALS`, `QUAL-SCORE-ERASURE` | 2 + **1** |
| **H2.5** | **The judge REPLACES the retry, still at N=1.** Full-rubric `mode:'post'` scoring over `joinContent`, `neutralize()`'d; `generate.ts:261-292` removed. | `QUAL-JUDGE-RUBRIC-UNFORKED`, `QUAL-CANDIDATE-NEUTRALIZED`, `QUAL-HOOK-RETRY-REMOVED`, `QUAL-RUBRIC-UNCHANGED` | 2 + 3 |
| **H2.6** | **The guards at N.** `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` 30 → 100 via `lib/config.ts`; the runner-level halves of the counting and trial-unit constraints; guard ordering pinned. | `QUAL-GUARD-ORDER-PRESERVED`, `QUAL-RATE-LIMIT-COUNTS-CALLS`, `QUAL-TRIAL-UNIT-PER-POST` | 2 |
| **H2.7** | **The fan-out.** N=3, concurrency bounded to 3, the three outcomes, argmax on `overall`, lowest-index tie-break, the below-threshold flag. Closes the `generate.ts` halves of `H2.6`. | `QUAL-N-CANDIDATE-COUNT`, `QUAL-ARGMAX-DETERMINISTIC`, `QUAL-THREE-OUTCOMES`, `QUAL-BELOW-THRESHOLD-SURFACED` | 2 |
| **H2.8** | **Migration B — `signal_triage_budget` → `ai_budget_daily`** with the mandatory `purpose` discriminator, `reserved_units`, both RPCs dropped and recreated, the backfill, the trigger rename, every caller moved, and the §D2.5 edit in the same PR. | `QUAL-COST-CEILING-EXTENDED`, `QUAL-BUDGET-PURPOSE-ISOLATED`, `QUAL-NO-SECOND-BUDGET-TABLE` | **1** + 3 |
| **H2.9** | **The Pro daily post cap.** `AI_PRO_DAILY_POST_CAP = 15` in `lib/config.ts`; one-unit reservation before the fan-out; release on hard fail; Plus and trial reserve nothing; a distinct `quota_exceeded` message in en/pt/es. | `QUAL-PRO-DAILY-POST-CAP` | **1** |
| **H2.10** | **Structured output.** The runner's parse path learns `tool_use` **first**; `z.toJSONSchema(prompt.outputSchema)`; `learningSummarizerPrompt` migrates; Zod retained behind the schema; the malformed-tool-call path. | `QUAL-STRUCTURED-OUTPUT`, `QUAL-MALFORMED-TOOL-CALL` | 2 |
| **H2.11** | **Task-conditioned retrieval.** `role` and `campaignId` on `MemoryQueryContext`; the third optional `buildCustomerContext` parameter; `withPostQueryContext`; one equivalence case per call site. | `QUAL-QUERY-CONDITIONED`, `QUAL-CONTEXT-CALLERS-UNCHANGED`, `QUAL-SERVICE-ROLE-UNWIDENED` | 2 + 3 |
| **H2.12** | **The surface.** Four states, the score badge and its ten-dimension breakdown, bulk-approve exclusion across **both** callers with copy that says why, i18n en/pt/es; `taste-skill` + `impeccable` against §8.5. | `QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE` | 2 |
| **H2.13** | **Tier-3 scans, the ADR 0017 amendment, the constraint-to-CI map, and §5's doc updates.** | `QUAL-NO-NEW-AI-SURFACE`, `QUAL-PARSER-RETAINED`, `QUAL-MODE2-FIXTURES-MIGRATED` | 3 |

**All 29 constraints are closed by exactly one step.** Verify that mapping before claiming completion —
and **do not claim a constraint count until it is executed green in CI at the head it is dated to.**
Session 28 shipped a false *"29/29 executed green"* that took three correction steps to undo.

The fourteen pastes follow, one per step.

#### H2.0 — Grounding pass: re-verify every ADR premise  ·  no code, no commit

```
BUILDER - Session 31 - H2.0. NO CODE, NO COMMIT. Produce a premise -> file:line -> still-true? table
before anything is built. ADR 0024 cites roughly a hundred exact locations and was itself corrected five
times after review (Section 15). If any premise has drifted, the step that depends on it is NOT built
until the drift is reconciled and recorded here. Session 26's C2.0, Session 29's F1b.0 and Session 30.5's
N2.0 are the precedents.

Invoke ecc:code-explorer ONCE over exactly this closed file list and no other - this is the phase's only
exploration sweep:
  lib/ai/runner.ts, lib/ai/models.ts, lib/ai/parsers.ts, lib/ai/client.ts, lib/ai/context.ts,
  lib/ai/tool-runner.ts, lib/ai/index.ts
  lib/ai/prompts/types.ts, brief.ts, rubric.ts, learning-summarizer.ts, post-generation.ts,
  post-regeneration.ts, studio-suggestion.ts, brand-voice-inference.ts
  lib/ai/prompts/formats/native-generation-prompt.ts, platform-map.frozen-table.test.ts
  lib/campaigns/generate.ts, lib/campaigns/brief.ts
  lib/memory/scoring.ts, lib/memory/constants.ts, lib/memory/index.ts, lib/memory/performance.ts,
  lib/memory/voice.ts
  lib/db/posts.ts, lib/db/signal-triage-budget.ts, lib/db/ai-usage.ts
  lib/config.ts
  supabase/migrations/20260726010000_learning_capture.sql
  supabase/migrations/20260807100000_mode3_insight_cards.sql
  supabase/migrations/20260807110000_mode3_triage_state.sql
Ask it ONE question: "for each file, what does it currently do with prompt parameters, candidate
generation, rubric scoring, memory query context, JSON parsing, and the daily budget - with line numbers?"
Do not ask it to propose changes.

VERIFY THESE PREMISES SPECIFICALLY. Each is load-bearing for a named later step, and the session is void
if the first one has drifted.

1. NO TEMPERATURE AND NO THINKING ANYWHERE. grep the WHOLE of lib/ai/ for temperature, top_p, top_k and
   thinking. ADR Section 1.1(3) says runner.ts:140-156 assembles model, system, messages and
   max_tokens: prompt.maxTokens ?? DEFAULT_MAX_TOKENS (runner.ts:149) and NOTHING else. If a sampling
   parameter already exists, STOP and report - H2.1 changes shape.

2. THE TEN PROMPT IDS, and only ten. ADR Section 2.4 says the repo holds SEVEN exported Prompt objects
   plus ONE factory building three more. Enumerate them yourself: brand-voice-inference, brief-assembly,
   LEARNING_SUMMARIZER_PROMPT_ID, post-generation, post-regeneration, rubric, studio-suggestion, and the
   three from createNativeGenerationPrompt (native-generation-single/-thread/-carousel at
   native-generation-prompt.ts:135,146,157). CONFIRM that formats/policy.ts and formats/schemas.ts export
   validators and Zod schemas and have NO id/version/modelKey - they get no frozen-table row. Publish the
   list; H2.1's table has exactly ten rows and an eleventh or a ninth is a defect.

3. THE RETRY BLOCK. Confirm generate.ts:261-292 is the let regenerationCount / previousContent block, the
   openingStrength comparison at :277 and the second generateNativeContent call at :279, and that
   generate.ts:257-260's comment still reads "regenerate ONCE if below threshold, no re-score of the
   second attempt." Confirm generate.ts:266-271 neutralize()s the opener. Confirm the frozen roleSequence
   at :303 and the consistency call site at :308 are NOT part of the block being removed.

4. post-generation IS DEAD. git grep postGenerationPrompt across the WHOLE repo including tests. ADR
   Section 2.5 says exactly two hits: its own declaration (post-generation.ts:73) and the barrel re-export
   (lib/ai/index.ts:4). If you find a production caller, Section 2.5 is stale and its temperature/N
   dispositions change - STOP and report. Do NOT delete the prompt or its five fixtures: that is backlog
   item 31-DEAD-POST-GENERATION-PROMPT and lib/ai/client.ts:61-67 routes to those fixtures.

5. THE MOCK IS ROUTING-BLIND TO SAMPLING. Read lib/ai/client.ts:49-88 and confirm MockAnthropicClient
   routes ONLY on params.model, params._sosh.promptId and sosh.input.targetPlatform. Confirm
   __evalCassetteQueue is declared at :38-41 and shift()ed at :55-56, and that it is a single global FIFO.
   This is why zero fixtures move (ADR Section 4.1) and why H2.3 exists.

6. buildCustomerContext HAS TEN PRODUCTION CALL SITES ACROSS NINE FILES. git grep it across the WHOLE repo.
   ADR Section 5.4 lists them: generate.ts:176, brief.ts:111, brief.ts:160, learning/summarize.ts:156,
   signals/triage/orchestrator.ts:125, campaigns/[id]/generate-action.ts:44, posts/actions.ts:282,
   onboarding/infer-brand-voice/actions.ts:27, settings/voice/refine-from-posts-action.ts:42,
   studio/actions.ts:133. CONFIRM THE COUNT YOURSELF and publish the caller table with the test file that
   covers each. A per-FILE count is exactly how the Session 22 blockers were missed. If you find an
   eleventh, Section 5.4 is stale - STOP and report before building H2.11.

7. THE TWO TRIAL-CAP PREDICATES. Confirm runner.ts:217 skips the per-call increment for BOTH
   isPostGeneration(prompt.id) AND isScoringOnly(prompt.id), and find the orchestrator's batch increment
   after insert. ADR Section 7.2 says QUAL-TRIAL-UNIT-PER-POST is already true by construction and costs
   no production code. If either predicate is missing, that section is wrong - STOP and report.

8. THE BUDGET OBJECTS. Read 20260807100000_mode3_insight_cards.sql:98-108 (the table, UNIQUE
   (business_id, day)) and :147-180 (RLS enabled with NO policy at all, REVOKE ALL FROM authenticated,
   GRANT EXECUTE TO service_role), and 20260807110000_mode3_triage_state.sql:133-152 (the guarded upsert,
   p_cap from the caller, day pinned as (now() AT TIME ZONE 'utc')::date). CONFIRM both RPCs are
   RETURNS SETOF public.signal_triage_budget - that is why H2.8 must DROP and recreate rather than
   CREATE OR REPLACE. List every caller of reserveTriageBudget / reconcileTriageBudget /
   isTriageBudgetCapped across lib/ and supabase/__tests__/.

9. bulkApproveDraftPosts HAS TWO CALLERS. git grep it. ADR Section 8.4 names ApprovalsInbox and
   PostsClient and says lib/db/posts.ts:594-612 approves exactly the ids the caller rendered with NO
   quality predicate. Publish both callers and the test file for each. This is the Session 22 blocker
   shape and H2.12 must cover both.

10. post_ai_originals IS WRITE-ONCE AND SCHEMA-VERSIONED. Confirm 20260726010000_learning_capture.sql:28-42
    (the columns, schema_version at :39), :30 (business_id ... ON DELETE CASCADE), :67-68 (the
    trg_post_ai_originals_write_once BEFORE UPDATE trigger), and :34 (generation_kind, 'initial' |
    'regeneration'). H2.4 adds COLUMNS here; a write-once trigger changes how the writer must be shaped.

11. THE EVAL WORKFLOW DOES NOT APPLY. Read .github/workflows/eval-triage.yml:47-52 and confirm its path
    filter matches no file this session touches. Record the filter verbatim.

OUTPUT: the premise table, the three caller tables (buildCustomerContext, bulkApproveDraftPosts, the
budget RPCs), the enumerated ten prompt ids, and an explicit list of any premise that has DRIFTED with
what it means for the step that depends on it. No code. No commit. Then STOP.
```

#### H2.1 — Prompt-property plumbing and the ten-row frozen table  ·  nothing declares a value yet

```
BUILDER - Session 31 - H2.1. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the plumbing for sampling and thinking as versioned prompt properties, and the scan that enforces
the version-bump rule. NO PROMPT DECLARES A VALUE IN THIS STEP. That is the point: the tree stays
byte-identical to today so that QUAL-SAMPLING-DEFAULT-PRESERVED is proven against it.

1. lib/ai/prompts/types.ts - add `temperature?: number` and `thinking?: number` to
   Prompt<TInput, TOutput> as OPTIONAL SIBLINGS OF THE EXISTING maxTokens (types.ts:5-17). Follow
   maxTokens' precedent exactly, including a comment in the same register citing ADR 0024 Section 3.1.

2. lib/ai/runner.ts:140-156 - read both with the same `??`-and-OMIT shape maxTokens uses at runner.ts:149.
   When a field is unset the SDK param is OMITTED ENTIRELY, not sent as undefined and not sent as a
   default. `thinking` is sent in the SDK's thinking-block form with the declared budget.

3. lib/ai/prompts/prompt-properties.frozen-table.test.ts - a Tier-2 frozen table on the
   lib/ai/prompts/formats/platform-map.frozen-table.test.ts precedent. A checked-in table keyed
   {id, version} recording each prompt's { modelKey, temperature, thinking, maxTokens }. Changing any of
   those four without bumping that prompt's version in the SAME COMMIT fails the test.

   THE TABLE HAS EXACTLY TEN ROWS - one per prompt ID, not one per file (ADR Section 3.2, and Section 15
   MAJOR-2 which corrects an earlier 12-row draft). formats/policy.ts and formats/schemas.ts get NO row:
   they export validators and Zod schemas, have no id/version/modelKey, and cannot carry a sampling
   property. native-generation-single/-thread/-carousel get THREE rows, because their version and model
   are already per-family (native-generation-prompt.ts:136,147,158) even though temperature will later be
   declared once inside the factory.

   THE SCAN ENUMERATES PROMPTS BY WALKING the exported Prompt objects PLUS the factory's three families,
   so a new prompt or a new family with NO ROW FAILS. That is the whole reason this is a runtime scan and
   not a diff check: a diff check sees only the current diff, while the frozen table survives a rebase, a
   squash, and a change split across two commits.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- QUAL-SAMPLING-DEFAULT-PRESERVED (Tier 2) - lib/ai/runner.test.ts, the direct sibling of
  STUDIO-RUNNER-DEFAULT-PRESERVED: a prompt declaring nothing produces BYTE-IDENTICAL SDK params to today,
  asserted across ALL TEN prompt ids.
- QUAL-SAMPLING-VERSIONED (Tier 2) - prompt-properties.frozen-table.test.ts: mutate a modelKey, then a
  temperature, then a thinking, then a maxTokens WITHOUT a version bump and confirm each reddens; add a
  fake eleventh prompt with no row and confirm that reddens too. Revert all five.

DO NOT: declare a temperature or a thinking value on any prompt (that is H2.2); change DEFAULT_MAX_TOKENS;
touch the platform-map frozen table.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.1: prompt sampling/thinking properties + ten-row frozen table (QUAL-SAMPLING-VERSIONED,
QUAL-SAMPLING-DEFAULT-PRESERVED)".
```

#### H2.2 — The declared values: temperature 1.0 on native generation, thinking 4000 on brief assembly

```
BUILDER - Session 31 - H2.2. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the actual sampling and thinking declarations. TRANSCRIBE these values; do not re-derive them.

1. TEMPERATURE 1.0, declared ONCE INSIDE createNativeGenerationPrompt
   (lib/ai/prompts/formats/native-generation-prompt.ts:172-175) and inherited by all three families. Bump
   the version of ALL THREE families in the same commit (native-generation-prompt.ts:136,147,158) and
   update all three frozen-table rows. NO OTHER PROMPT GETS A TEMPERATURE - post-generation is dead code
   (ADR Section 2.5) and sampling it buys a version bump for nothing; rubric is the judge and a judge that
   samples disagrees with itself; learning-summarizer is a Haiku classification step.

2. brief-assembly (lib/ai/prompts/brief.ts:70-72) gets thinking: 4000 AND maxTokens: 12_000 IN THE SAME
   DECLARATION, at version: 2. ONE version bump covers both fields.

   READ ADR SECTION 3.3a BEFORE YOU WRITE THIS. A thinking budget is NOT additive to max_tokens; it is
   SPENT OUT OF IT. briefAssemblyPrompt declares no maxTokens today, so it resolves through runner.ts:149
   to DEFAULT_MAX_TOKENS = 4096 (runner.ts:30). A 4,000-token thinking budget against a 4,096-token
   ceiling leaves 96 TOKENS of visible output, and every Stage A assembly would fail at runner.ts:185 with
   response_truncated - deterministically, on the first call, on the product's most strategic path.
   12,000 = 4,000 reasoning + 8,000 visible.

3. THE RESPONSE'S FIRST CONTENT BLOCK BECOMES A thinking BLOCK. runner.ts:191's
   response.content.find(b => b.type === 'text') already SEARCHES rather than indexing, so it survives -
   but it survives BY LUCK, and your test asserts it deliberately.

4. TEMPERATURE AND THINKING ARE MUTUALLY CONSTRAINED BY THE PROVIDER: with thinking enabled, temperature
   may not be set to a non-default value. Section 2.4 sets temperature only on the native families and
   Section 3.3 sets thinking only on brief-assembly, so the two sets are DISJOINT. That disjointness is
   now a CONSTRAINT, not a coincidence.

CONSTRAINT CLOSED AND THE TEST THAT PROVES IT:
- QUAL-THINKING-BUDGETED (Tier 2) - lib/ai/runner.test.ts + lib/ai/prompts/brief.test.ts. Assert: thinking
  4000 AND maxTokens 12_000 on brief-assembly at version: 2; BOTH fields absent on the other nine ids; a
  thinking-block-then-text-block response parses exactly as today; and NO PROMPT DECLARES BOTH temperature
  AND thinking - written so that adding the pair to any prompt reddens it.

ALSO: the frozen table from H2.1 must now redden if you revert any of these four declarations without
reverting its row. Demonstrate it and revert.

EXPECTED LATENCY, recorded so the reviewer does not read it as a regression (ADR Section 3.4): brief
assembly +8-15s on a user-visible step, ACCEPTED by founder ruling A-4 and already async behind after().
Campaign post generation is approximately unchanged per post - candidates are concurrent, so the added
wall-clock is one short Haiku judge round-trip. Studio, user regeneration, brand-voice inference and
triage: zero.

DO NOT: put thinking on native generation (ADR Section 3.3 excludes it deliberately and provisionally -
the interaction with temperature 1.0 cannot be resolved without a metric that does not exist); guess a
different budget; ship the maxTokens raise in a different commit from the thinking.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.2: temperature 1.0 on native generation, thinking 4000 + maxTokens 12000 on brief-assembly v2
(QUAL-THINKING-BUDGETED)".
```

#### H2.3 — The mock harness: candidate sequences and cassette-queue lifecycle  ·  test infrastructure only

```
BUILDER - Session 31 - H2.3. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: test infrastructure and nothing else. This step closes no QUAL constraint and it is NOT optional.
ADR Section 10.2 states it as a prerequisite: "the mock must be able to return a SEQUENCE of distinct
payloads for one promptId. Without it, QUAL-ARGMAX-DETERMINISTIC and QUAL-BELOW-THRESHOLD-SURFACED are
AUTHORED-NOT-EXECUTED by construction - the test would pass on a 3-way tie and prove nothing."

READ ADR SECTION 4.5 (blockers 2 and 3) FIRST.

1. THE MOCK IS CANDIDATE-BLIND TODAY. lib/ai/client.ts:49-88 routes on params.model,
   params._sosh.promptId and sosh.input.targetPlatform, so three calls for one promptId return
   BYTE-IDENTICAL JSON. Every argmax over that set is a 3-way tie, and an assertion that the lowest index
   wins passes whether or not the code implements argmax at all.

2. THE ANSWER IS ALREADY THERE. __evalCassetteQueue (lib/ai/client.ts:38-41 declaration, :55-56 the
   shift()) is a single global FIFO. A FIFO of DISTINCT payloads for one promptId is exactly the sequence
   the argmax tests need. BUILD ON IT - do not build a second mechanism beside it.

3. GIVE IT A SCOPED SET-UP / TEAR-DOWN HELPER. Because the queue is a single GLOBAL FIFO, a test that
   leaves it non-empty POISONS THE NEXT FILE. The helper enqueues a named sequence and guarantees the
   queue is drained and asserted empty in teardown, whether the test passed, failed or threw. This
   lifecycle is now a NAMED TEST-AUTHORING CONSTRAINT for every step after this one, not a silent
   assumption.

4. PROVE THE HARNESS ITSELF. Write a test that enqueues three DISTINCT rubric payloads for one promptId,
   consumes them through the mock, and asserts they came back in order and distinct. Then write one that
   deliberately leaves an item in the queue and asserts the teardown FAILS LOUDLY rather than silently
   carrying it forward. A harness whose failure mode is silent is worse than no harness.

DO NOT: touch lib/ai/__fixtures__/ content (ADR Section 4.2 - zero fixtures move, and the five
post-generation fixtures are KEPT, not deleted); change the mock's routing keys; add a second queue.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.3: mock candidate sequences + cassette-queue lifecycle helper (prerequisite for
QUAL-ARGMAX-DETERMINISTIC, QUAL-BELOW-THRESHOLD-SURFACED)".
```

#### H2.4 — Migration A: the winner's score columns on post_ai_originals

```
BUILDER - Session 31 - H2.4. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.
This step and H2.8 are the session's only two migrations. Invoke ecc:database-reviewer ONCE, scoped to
BOTH of them together, BEFORE EITHER IS COMMITTED - that is one of the phase's three subagent invocations.
Use the supabase:supabase-postgres-best-practices skill while authoring (free, not budgeted).

SHIP: columns for the winning candidate's scores, and the Tier-1 proof that erasure reaches them.

1. NEW COLUMNS ON THE EXISTING post_ai_originals (20260726010000_learning_capture.sql:28-42) - NOT on
   posts.ai_generation_metadata. The reason is recorded in ADR Section 8.2: post_ai_originals is
   schema-versioned (schema_version at :39), single-writer and WRITE-ONCE (the
   trg_post_ai_originals_write_once BEFORE UPDATE trigger at :67-68), and it is the ADR 0018-governed
   record of what the model produced. posts.ai_generation_metadata is an unvalidated JSONB blob carrying
   recorded debt (docs/reviews/session-18b3-review.md, M2). Adding a governed score to an ungoverned blob
   is how the blob becomes load-bearing.

2. WHAT THE COLUMNS HOLD: the winner's `overall`, the ten-dimension breakdown, the candidate count, and
   whether the winner cleared BRIEF_QUALITY_THRESHOLD. Bump schema_version IN THE SAME MIGRATION.

3. COLUMNS, NOT A TABLE. ADR Section 9: Session 31 introduces NO new business-scoped table. NO NEW ROW is
   owed in ADR 0010 Amendment 2 Section D2.5 - the existing post_ai_originals row already covers the whole
   table via business_id ... ON DELETE CASCADE (learning_capture.sql:30). This is the Session 29-D
   precedent (ADR 0022's three new studio_drafts columns needed no new cascade row). If you find yourself
   writing CREATE TABLE, STOP and report.

4. THE WRITER GOES IN lib/db/ (CLAUDE.md: nothing else calls Supabase). Respect the write-once trigger:
   the scores are written with the row, not UPDATEd onto it afterwards. Losing candidates write NO row -
   exactly one 'initial' row per post, for the winner (ADR Section 2.9).

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- QUAL-SCORES-IN-ORIGINALS (Tier 2) - the lib/db post_ai_originals suite: the winner's scores are written
  there, schema_version is bumped, and NOTHING is written to posts.ai_generation_metadata. Assert the
  negative half explicitly.
- QUAL-SCORE-ERASURE (Tier 1) - supabase/__tests__, on the PROMOTE-CASCADE-COMPLETE precedent (ADR 0022
  Section 11.1): write a post_ai_originals row CARRYING THE NEW SCORE COLUMNS, run purge_business, assert
  the row is gone. The existing ON DELETE CASCADE covers it structurally; this test PROVES it rather than
  assuming it.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. The db-tests skip-guard must report a
NON-ZERO file and test count read from the log, not inferred. Commit as
"H2.4: post_ai_originals score columns + erasure proof (QUAL-SCORES-IN-ORIGINALS, QUAL-SCORE-ERASURE)".
```

#### H2.5 — The judge REPLACES the openingStrength retry  ·  still at N=1

```
BUILDER - Session 31 - H2.5. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: full-rubric judging of ONE candidate, and the REMOVAL of the single-dimension retry. N is still 1
in this step. The fan-out is H2.7, and splitting them is deliberate: a new scoring path AND a fan-out in
one diff cannot be bisected when a case goes red.

1. THE JUDGE IS N SEPARATE CALLS TO THE EXISTING rubricPrompt AT mode:'post'. Not one multiplexed call
   returning three score sets - that would change RubricOutputSchema, which L-4 forbids and which
   lib/studio/categories.ts derives from. The three existing callers (brief.ts:170 mode:'brief',
   generate.ts:272 mode:'post', lib/signals/triage/card.ts:226 mode:'card') are UNAFFECTED.

2. SCORE joinContent(output), NOT extractOpener(output). Nine of the ten dimensions are undefined over a
   single sentence.

3. neutralize() EVERY CANDIDATE BEFORE THE JUDGE. generate.ts:266-271 already does this for the single
   opener and the reason is recorded: the content is the model's own prior output being fed back into a
   second AI call - the same reused-AI-generated-text shape as brief.ts's narrative/proofPlan. Dropping it
   in the refactor is a silent prompt-injection regression.

4. ALL TEN DIMENSIONS ARE REQUESTED AND PERSISTED. The SELECTION key is the model's `overall`. Do NOT
   invent a weighted subset - that would be a second, unversioned scoring scheme sitting beside the
   rubric's own, which is D-2's two-gates-on-one-artefact loser. ADR Section 2.6 names four dimensions as
   weak signal for ranking (evidenceSufficiency, unsupportedClaimsRisk, redundancy, and ctaFit where the
   role carries no CTA); they are RECORDED, not dropped, because unsupportedClaimsRisk and
   evidenceSufficiency still gate the THRESHOLD.

5. REMOVE generate.ts:261-292 ENTIRELY - the let regenerationCount / previousContent block, the
   openingStrength comparison at :277, and the second generateNativeContent call at :279. L-3 and D-2:
   the judge REPLACES it, it does not sit beside it.

6. WHAT SURVIVES THE REMOVAL, per ADR Section 2.9's caller table - transcribe, do not re-derive:
   - generate.ts:296-304's generated.push({ ... regenerationCount, previousContent }): the FIELD IS
     RETAINED and is ALWAYS 0 at initial generation. DO NOT reuse it as a candidate counter - conflating
     "the user asked for a regeneration" with "the pipeline generated 3 candidates" corrupts ADR 0018's
     learning signal, which keys on generation_kind.
   - post_ai_originals.generation_kind: UNCHANGED. Exactly one 'initial' row per post.
   - posts/actions.ts:282, the user-facing "regenerate" button: UNCHANGED. It calls postRegenerationPrompt,
     a DIFFERENT prompt on a DIFFERENT path, and it is not the hook loop.
   - ADR 0017's MODE2-HOOK-STANDALONE: RETIRED, deliberately and on the record. Its FIVE test cases map
     forward individually per ADR Section 4.4 - do not delete them, MAP them: opener-scored-against-rubric
     -> QUAL-JUDGE-RUBRIC-UNFORKED; regeneration-fires-below-threshold ->
     QUAL-BELOW-THRESHOLD-SURFACED; regeneration-fires-at-most-once -> QUAL-N-CANDIDATE-COUNT;
     scoring-failure-does-not-abort -> QUAL-THREE-OUTCOMES; opener-neutralized ->
     QUAL-CANDIDATE-NEUTRALIZED. The last three land in H2.7; leave a named placeholder for them here.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- QUAL-JUDGE-RUBRIC-UNFORKED (Tier 2) - lib/ai/prompts/rubric.test.ts + lib/campaigns/generate.test.ts:
  the judge calls the SAME rubricPrompt at mode:'post'; RubricOutputSchema and ALL THREE existing call
  shapes are unchanged. Per SHARED-FUNCTION CALLERS, list all four callers (brief, generate, card, judge)
  and the test file that exercises each.
- QUAL-CANDIDATE-NEUTRALIZED (Tier 2) - generate.test.ts: every candidate passes through neutralize()
  before the judge, with an injection-payload case that reddens if the call is dropped.
- QUAL-HOOK-RETRY-REMOVED (Tier 3) - diff: ZERO remaining references to the removed block.
- QUAL-RUBRIC-UNCHANGED (Tier 3) - diff: ten dimensions, no rename, RubricOutputSchema byte-unchanged,
  rubric.ts:21-24's invariant comment intact.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.5: full-rubric judge replaces the openingStrength retry (QUAL-JUDGE-RUBRIC-UNFORKED,
QUAL-CANDIDATE-NEUTRALIZED, QUAL-HOOK-RETRY-REMOVED, QUAL-RUBRIC-UNCHANGED)".
```

#### H2.6 — The guards at N: rate limit raised, guard ordering pinned, trial units held at one

```
BUILDER - Session 31 - H2.6. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the guard work that MUST land before the fan-out. At N=3 a 12-entry campaign issues 36 generation
calls against AI_RATE_LIMIT_POST_GENERATION_PER_MIN = 30 (lib/config.ts:37) and dies mid-run with
rate_limited. Landing H2.7 first means H2.7 goes red for a reason that has nothing to do with H2.7.

1. RAISE THE DEFAULT 30 -> 100 in lib/config.ts. NEVER process.env directly (L-11). The judge runs under
   rubricPrompt's own prompt id and is therefore counted separately by countRecentCalls(..., prompt.id);
   the 100 covers generation calls.

2. THE RATE LIMIT COUNTS PROVIDER CALLS, SO N COUNTS AS N. Three generations plus three judge calls ARE
   six provider calls. Counting them as one would be a hole through the STEP 2 guard, which L-9 forbids.
   The loser - counting one unit for N calls - is named in ADR Section 7.3.

3. GUARD ORDERING IS UNTOUCHED (L-9, ADR Section 7.1). runner.ts:92-112: STEP 1 trial cap
   (quota_exceeded), STEP 2 rate limit (rate_limited, via countRecentCalls), STEP 3 message assembly with
   the CACHE_CONTROL_CHAR_THRESHOLD decision (runner.ts:29,117). You reorder nothing, bypass nothing, and
   add NO fourth step inside runPrompt. The budget reservation of H2.9 sits OUTSIDE and ABOVE runPrompt.

4. TRIAL UNITS: ONE PER USER-VISIBLE GENERATION - AND IT IS ALREADY TRUE BY CONSTRUCTION. Read ADR
   Section 7.2 and Section 15 MINOR-3. runner.ts:217 skips the per-call increment for BOTH
   isPostGeneration(prompt.id) AND isScoringOnly(prompt.id) - the second predicate was added by the
   Session B2.6 BLOCKER fix precisely so a scoring call never consumes post quota - and the orchestrator
   batch-increments ONCE after insert. YOUR OBLIGATION IS THE NEGATIVE ONE: neither predicate may be
   narrowed, and the batch increment stays at one per inserted post. This constraint costs NO production
   code; if you find yourself adding a mechanism, you have misread the section.

   The loser is named: charging N. A trial user watching a 50-post allowance drain three times faster for
   identical product output is a customer-observable degradation with no customer-visible cause.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH (the runner-level halves land here; the generate.ts
halves land in H2.7 and the two steps together close them - say so in both commit messages):
- QUAL-GUARD-ORDER-PRESERVED (Tier 2) - lib/ai/runner.test.ts: STEP 1 trial cap, then STEP 2 rate limit,
  then assembly; assert the ORDER, and assert no reservation call exists inside runPrompt.
- QUAL-RATE-LIMIT-COUNTS-CALLS (Tier 2) - lib/ai/runner.test.ts here (N calls count as N), plus
  generate.test.ts in H2.7 (overshoot bounded at N-1 = 2 under bounded concurrency).
- QUAL-TRIAL-UNIT-PER-POST (Tier 2) - a REGRESSION test over both predicates here, plus generate.test.ts
  in H2.7 proving one user-visible generation at N=3 consumes exactly 1 trial post.

RECORD, do not hide: the trial's true AI cost roughly doubles - 50 posts x approximately 10c recorded is
about 500c (EUR 5) per trial, up from about 245c. That is the price of the trial and it is bounded by
construction (ADR Section 7.2).

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.6: rate limit 30->100, guard ordering pinned, trial-unit predicates regression-guarded
(QUAL-GUARD-ORDER-PRESERVED, QUAL-RATE-LIMIT-COUNTS-CALLS, QUAL-TRIAL-UNIT-PER-POST)".
```

#### H2.7 — The fan-out: N=3, three outcomes, deterministic argmax, below-threshold surfaced

```
BUILDER - Session 31 - H2.7. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.
This is the load-bearing step of the session. H2.3's mock sequence helper is a HARD PREREQUISITE: without
it every argmax assertion passes on a 3-way tie and proves nothing.

SHIP: N-candidate generation with full-rubric judging.

1. N = 3. Transcribed from ADR Section 2.1 with its arithmetic: 6 provider calls per post, approximately
   6.7c true / 10c recorded, against 2 calls and approximately 3.6c / 4.9c today. N=5 would put A-1's
   15-post/day Pro cap at 58% of revenue; N=2 gives the judge a binary choice where one bad draw halves
   the expected lift. Do not change the number.

2. PARALLEL WITHIN A POST, SEQUENTIAL ACROSS POSTS, CONCURRENCY BOUNDED TO 3. The bound is not tidiness:
   runner.ts:107 calls countRecentCalls BEFORE the SDK call while recordAiUsage writes in the post-call
   block at runner.ts:236, so concurrent calls all read the PRE-CALL count. Bounding concurrency to N caps
   the rate-limit overshoot at N-1 = 2 calls. Unbounded fan-out across posts would make the overshoot
   proportional to campaign size - a hole through L-9's STEP 2 guard rather than a rounding error.

3. THREE OUTCOMES, NOT TWO (ADR Section 2.3). generate.ts:244-255 today treats any generation failure as
   terminal for the whole session; at N=3 that is wrong, because two of three succeeding is a success.
   - HARD FAIL: 0 of N candidates generated -> session status 'failed', error_code from the last AiError,
     postsCreated: 0. This is the EXISTING generate.ts:248-254 path, UNCHANGED.
   - UNSCORED: at least 1 candidate generated but EVERY judge call threw -> proceed with candidate index
     0, unscored and ungated, and emit ONE structured log line. This is the backward-compatible extension
     of generate.ts:281-292's existing swallow-and-continue.
   - SCORED: at least 1 generated and at least 1 scored -> argmax over the SCORED SUBSET. Unscored
     candidates are NOT eligible to win.

4. ARGMAX ON `overall`. TIE GOES TO THE LOWEST CANDIDATE INDEX. Deterministic, testable, no hidden
   preference. Random selection is rejected because it makes the constraint unassertable and a
   non-reproducible generation is one whose complaint cannot be investigated.

5. ALL N BELOW THRESHOLD -> SURFACE THE BEST OF THE SET, FLAGGED. The post IS created, its `overall` IS
   persisted, and it is marked below-threshold. The session is NOT failed. Do NOT regenerate (unbounded by
   construction - a brief the model cannot clear regenerates forever and the cost ceiling then decides
   where it stops, which is the worst possible place to put that decision). Do NOT escalate to Opus
   (approximately 5x cost per models.ts:5-8, spent on a lift no measurement in this repo can confirm).

6. LOSING CANDIDATE CONTENT IS NEVER PERSISTED AND NEVER SHOWN (ADR Section 8.1). No post_candidates
   table. Only the WINNER's scores persist, through H2.4's columns.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH - all in lib/campaigns/generate.test.ts, all using H2.3's
mock sequence helper with its teardown assertion:
- QUAL-N-CANDIDATE-COUNT (Tier 2) - exactly 3 generation calls per entry; concurrency bounded to 3.
- QUAL-ARGMAX-DETERMINISTIC (Tier 2) - argmax on `overall` with THREE DISTINCT payloads; a deliberate tie
  goes to the lowest index. This case is meaningless without the H2.3 sequence.
- QUAL-THREE-OUTCOMES (Tier 2) - one case each: 0-generated hard fail; all-judges-throw unscored and
  NON-TERMINAL; partial failure (one of three generations throws) argmax over the survivors.
- QUAL-BELOW-THRESHOLD-SURFACED (Tier 2) - all N below 70: best-of-set persisted AND flagged, session NOT
  failed.
ALSO CLOSE HERE the generate.ts halves of H2.6: one user-visible generation at N=3 consumes exactly 1
trial post (QUAL-TRIAL-UNIT-PER-POST), and the rate-limit overshoot is bounded at N-1
(QUAL-RATE-LIMIT-COUNTS-CALLS).

DO NOT: add a reservation here (that is H2.9); change the frozen roleSequence at generate.ts:303 or the
consistency call site at :308; make the judge advisory.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.7: N=3 fan-out with judged argmax (QUAL-N-CANDIDATE-COUNT, QUAL-ARGMAX-DETERMINISTIC,
QUAL-THREE-OUTCOMES, QUAL-BELOW-THRESHOLD-SURFACED; completes QUAL-TRIAL-UNIT-PER-POST,
QUAL-RATE-LIMIT-COUNTS-CALLS)".
```

#### H2.8 — Migration B: signal_triage_budget becomes ai_budget_daily, with a mandatory purpose discriminator

```
BUILDER - Session 31 - H2.8. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.
The ecc:database-reviewer invocation from H2.4 covers THIS MIGRATION TOO and must have seen both before
either was committed. Use supabase:supabase-postgres-best-practices while authoring (free).

SHIP: the rename that makes ADR 0021's ceiling serve two purposes. READ ADR SECTION 7.5b IN FULL FIRST -
it corrects a pre-review draft that would have shipped a silent cross-ceiling leak.

WHY THE DISCRIMINATOR IS MANDATORY, not cosmetic: signal_triage_budget holds ONE reserved_cents per
(business_id, day) (20260807100000_mode3_insight_cards.sql:98-108, UNIQUE (business_id, day)) and the RPC
takes p_cap FROM THE CALLER (20260807110000_mode3_triage_state.sql:133-152). Two consumers with two
different caps against one counter means a triage-heavy morning SILENTLY STARVES post generation for the
rest of the day, each caller's cap check sees the other's spend, and "budget exceeded" has two causes and
no column that distinguishes them.

THE DELTA - transcribe it exactly:
  table         signal_triage_budget            -> ai_budget_daily
  unique key    UNIQUE (business_id, day)       -> UNIQUE (business_id, purpose, day)
  new column    -                               -> purpose text NOT NULL
                                                   CHECK (purpose IN ('triage_cents','generation_posts'))
  amount        reserved_cents integer          -> reserved_units integer
  reserve RPC   reserve_triage_budget(p_business_id, p_cents, p_cap)
                -> reserve_ai_budget(p_business_id, p_purpose, p_units, p_cap)
  reconcile RPC reconcile_triage_budget(p_business_id, p_reserved_cents, p_actual_cents)
                -> reconcile_ai_budget(p_business_id, p_purpose, p_reserved_units, p_actual_units)

EVERYTHING ELSE IS GENUINELY UNCHANGED: the same guarded upsert, the same
ON CONFLICT ... DO UPDATE ... WHERE reserved + p_units <= p_cap atomicity, the same server-pinned
(now() AT TIME ZONE 'utc')::date, the same SECURITY DEFINER + SET search_path, and the same
deny-by-default posture (insight_cards.sql:147-180: RLS enabled, NO POLICY AT ALL, REVOKE ALL FROM
authenticated, GRANT EXECUTE TO service_role). The table is service-role-only and STAYS THAT WAY.

MIGRATION MECHANICS YOU MUST NOT IMPROVISE:
- Both RPCs are RETURNS SETOF public.signal_triage_budget. A RETURN TYPE CANNOT BE CHANGED BY
  CREATE OR REPLACE FUNCTION. The migration DROP FUNCTIONs both and RECREATES them under the new names
  and signatures, RE-ISSUING THE REVOKE/GRANT PAIR FOR EACH. A recreated SECURITY DEFINER function with
  no REVOKE is a privilege escalation.
- Existing rows BACKFILL to purpose = 'triage_cents', with reserved_cents -> reserved_units UNCHANGED IN
  VALUE, so no live triage budget is reset by the rename.
- The trg_signal_triage_budget_updated_at trigger (insight_cards.sql:110-112) is RENAMED WITH THE TABLE.
- CALLERS MOVE IN THE SAME PR: lib/db/signal-triage-budget.ts:16,35,63 (reserveTriageBudget /
  reconcileTriageBudget / isTriageBudgetCapped), lib/signals/triage/orchestrator.ts:262, lib/db/types.ts,
  and both supabase/__tests__/signals3-*.test.ts suites.
- ADR 0010 Amendment 2 Section D2.5: the existing row MOVES WITH THE TABLE. This is NOT a new row - same
  business_id, same ON DELETE CASCADE, same deny-by-default RLS, and the added purpose column carries no
  personal data and changes no erasure path. The D2.5 edit lands IN THIS PR.
- Per CLAUDE.md's naming rule a rename is its own tracked piece of work. It is executed inside Session 31
  because the extension is not expressible without it (founder ruling A-2).

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- QUAL-COST-CEILING-EXTENDED (Tier 1) - supabase/__tests__: reserve_ai_budget under TWO CONCURRENT
  RESERVATIONS and FIRST-CALL-OF-DAY, i.e. the ADR 0021 case shape re-run against ai_budget_daily; plus a
  case proving NO signal_triage_budget table, trigger or RPC survives the rename; plus one proving
  existing rows backfilled to purpose='triage_cents' with their reserved_units value intact.
- QUAL-BUDGET-PURPOSE-ISOLATED (Tier 1) - supabase/__tests__: a triage_cents reservation AT ITS CAP does
  NOT deny a generation_posts reservation on the same (business_id, day), AND VICE VERSA. Two purposes,
  two rows, two caps, no shared counter. Write BOTH directions; a one-directional test passes on a shared
  counter half the time.
- QUAL-NO-SECOND-BUDGET-TABLE (Tier 3) - diff: the migration RENAMES; no second CREATE TABLE for a budget
  mechanism.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. Read the skip-guard line from the log and
confirm a NON-ZERO file and test count. Commit as
"H2.8: signal_triage_budget -> ai_budget_daily with purpose discriminator (QUAL-COST-CEILING-EXTENDED,
QUAL-BUDGET-PURPOSE-ISOLATED, QUAL-NO-SECOND-BUDGET-TABLE)".
```

#### H2.9 — The Pro daily post cap: reserve POSTS, before the fan-out, atomically

```
BUILDER - Session 31 - H2.9. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: founder ruling A-1, enforced. READ ADR SECTION 7.5a FIRST - it REPLACES a pre-review design that
reserved worst-case cents, and the replacement is the whole point.

1. GENERATION RESERVES POSTS, NOT CENTS. A-1's ceiling is a POST COUNT; a cents reservation cannot enforce
   a post count. And because per-post recorded cost is bounded at approximately 10c (ADR Section 2.1),
   A 15-POST/DAY CAP IS A 150c/DAY SPEND CEILING - the EUR 45/mo figure is DERIVED from the post cap, not
   separately enforced.

2. ONE UNIT, ONE RESERVATION, BEFORE THE FAN-OUT. NOT one reservation per candidate: per-candidate
   reservation reopens the check-then-call race N-fold INSIDE a single generation, which is L-6's explicit
   loser. The failure mode you are designing against is named: a SELECT of today's spend, then a decision,
   then a call, is three steps - and two concurrent generations that both read the pre-call total both
   proceed. At N one lost race spends SIX provider calls, not one.

3. THE CONSTANT LIVES IN lib/config.ts AS AI_PRO_DAILY_POST_CAP, DEFAULT 15 - the sibling of
   TRIAGE_DAILY_CAP_CENTS at lib/config.ts:85. NEVER process.env directly (L-11). The founder may override
   the number in one line without reopening the ruling: the ADR fixes the MECHANISM, not the constant.

4. WHICH TIERS RESERVE (ADR Section 7.4) - transcribe:
   - PRO: YES, AI_PRO_DAILY_POST_CAP = 15, enforced by the reservation.
   - PLUS: NO. Its existing 250-posts/month product bound already bounds it, and inventing a second daily
     bound for it would be an UNRULED pricing change.
   - TRIAL: NO. AI_TRIAL_POST_CAP = 50 total is already enforced at runner.ts:96-99 STEP 1 - a DIFFERENT
     guard, in a different place, and Section 7.1 leaves it exactly where it is.

5. A HARD-FAILED GENERATION RELEASES ITS UNIT through reconcile_ai_budget. A generation that succeeds
   keeps its unit, whether it produced 3 candidates or 1.

6. THE USER-FACING BEHAVIOUR IS SPECIFIED, NOT YOURS TO DESIGN. A denied reservation surfaces as
   AiError('quota_exceeded') - the code that ALREADY EXISTS at runner.ts:94 - carrying a DISTINCT MESSAGE
   FROM THE TRIAL CAP, and the surface renders "daily generation limit reached - resets at 00:00 UTC" in
   EN, PT AND ES, landed in the same commit. The reset hour is not a detail: the RPC pins day server-side
   as (now() AT TIME ZONE 'utc')::date, so there is exactly one answer to "when does my quota come back"
   and the copy states it.

7. DO NOT TOUCH THE PRICING COPY. CLAUDE.md's Locked pricing says Pro is "unlimited posts" and A-1 makes
   that false. That change is a FOUNDER task, tracked as 31-A1-PRICING-COPY in docs/backlog.md Section 1.

CONSTRAINT CLOSED AND THE TEST THAT PROVES IT:
- QUAL-PRO-DAILY-POST-CAP (Tier 1) - supabase/__tests__: the 15-POST ceiling ENFORCED under two concurrent
  reservations and ACROSS THE UTC DAY BOUNDARY; a hard-failed generation RELEASES its unit through
  reconcile_ai_budget; a Plus or trial business takes NO generation_posts reservation. Plus a Tier-2
  generate.test.ts case that the reservation happens BEFORE the fan-out, not per candidate.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. Commit as
"H2.9: Pro daily post cap, reserved as posts before the fan-out (QUAL-PRO-DAILY-POST-CAP)".
```

#### H2.10 — Structured output: the runner learns tool_use, then learningSummarizerPrompt migrates

```
BUILDER - Session 31 - H2.10. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.
Invoke ecc:typescript-reviewer ONCE, scoped to THIS STEP ALONE - the third and last of the phase's three
subagent invocations. Ask it about the z.toJSONSchema derivation, Zod's position behind the tool schema,
and whether TOutput's inference survives. Do not re-consult it.

SHIP: schema-enforced structured output for EXACTLY ONE PROMPT (L-7, D-5: additive and per-prompt; the
big-bang retirement of extractJsonBlock is the named loser, because it would put nine output paths in one
diff on a parse path Session 30 already proved fails unexpectedly).

ORDER WITHIN THE STEP IS NOT NEGOTIABLE (ADR Section 4.5 blocker 1, Section 6.4):

1. THE RUNNER'S PARSE PATH LEARNS tool_use FIRST. runner.ts:191 does
   response.content.find(b => b.type === 'text'); a tool_use response yields rawText = '' and
   safeParseOrAiError fails ON EVERY SINGLE CALL. Widen the parse path BEFORE any prompt declares a tool.
   This is the same parse path H2.2's thinking blocks widened; both changes live here now.

2. THE TOOL IS DERIVED FROM THE PROMPT'S EXISTING ZOD SCHEMA at runtime:
   z.toJSONSchema(prompt.outputSchema), sent through the machinery already present at
   lib/ai/tool-runner.ts:252-258 ({ name, description, input_schema }) and :320-322 (tools + tool_choice).
   THERE IS EXACTLY ONE SCHEMA OBJECT PER PROMPT IN THE CODEBASE. The loser is a hand-written JSON Schema
   beside the Zod schema: two schemas drift, the type is z.infer'd off one of them, and the drift is
   silent until production.

3. ZOD IS RETAINED BEHIND THE SCHEMA, NOT REPLACED (ADR Section 6.3). Two reasons, both verified against
   the installed zod@4.3.6 - and note that two OTHER reasons in the pre-review draft were CHECKED AND
   FOUND FALSE (Section 15, MAJOR-3), so do not repeat them:
   (a) REFINEMENTS VANISH. z.toJSONSchema(z.string().refine(...)) returns {"type":"string"} - the
       refinement is silently dropped. A tool schema alone would accept output the program considers
       invalid.
   (b) TOutput IS z.infer'd OFF prompt.outputSchema (lib/ai/prompts/types.ts:9). Replacing Zod with the
       tool schema removes the TYPE, not just the runtime check, and every runPrompt caller loses its
       return type.
   The tool schema constrains what the MODEL may emit; Zod validates what the PROGRAM accepts.

4. MIGRATE learningSummarizerPrompt (lib/ai/prompts/learning-summarizer.ts) AND ONLY IT. It is the
   cheapest failure to observe: a background worker (lib/learning/orchestrator.ts) behind no user-visible
   surface, ZERO MODE2-* constraints riding on it, NO FIXTURE (so Section 4.3's coverage loss costs
   nothing here), and a Haiku call so an iteration during migration is nearly free. Native generation is
   WAVE 2, deliberately - it migrates only once tool-use parsing is proven in production on a path where a
   bad day costs a delayed learning summary, not a customer's campaign.

5. THE ERROR PATH IS AiError('invalid_response') - THE SAME ERROR THE TEXT PATH THROWS TODAY
   (runner.ts:196-200, parsers.ts:63-75). No caller changes, because no caller can distinguish the two
   cases and none should. Three sub-cases: no tool_use block -> invalid_response; a tool_use block whose
   input fails Zod -> invalid_response CARRYING THE ZOD MESSAGE, exactly as safeParseOrAiError does today;
   BOTH a text block and a tool_use block -> THE TOOL BLOCK WINS and a structured log line records the
   mixed response.

6. extractJsonBlock KEEPS NINE OF THE TEN PROMPT IDS plus lib/ai/tool-runner.ts:445's
   safeParseOrAiError(TriageDecisionSchema, rawText), which parses a TEXT decision at the end of the
   triage loop and is NOT part of this migration.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- QUAL-STRUCTURED-OUTPUT (Tier 2) - lib/ai/runner.test.ts: learningSummarizerPrompt sends a tool derived
  by z.toJSONSchema, and the tool_use reply parses through Zod.
- QUAL-MALFORMED-TOOL-CALL (Tier 2) - lib/ai/runner.test.ts: no tool block / bad input / mixed text+tool
  each yield AiError('invalid_response') with the right message, and the mixed case logs.

DO NOT: migrate a second prompt; delete extractJsonBlock; change tool-runner.ts:445.

RECORD IN THE ADR (Section 6.5 already states it; do not restate it differently): extractJsonBlock may be
deleted only when EVERY Prompt declares a tool schema AND tool-runner.ts's final decision parse is
tool-based - i.e. a repo-wide grep for safeParseOrAiError returns only tool-path call sites - AND at least
one full release cycle has passed with no invalid_response attributable to a tool-call parse.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.10: tool_use structured output for learningSummarizerPrompt, Zod retained behind the schema
(QUAL-STRUCTURED-OUTPUT, QUAL-MALFORMED-TOOL-CALL)".
```

#### H2.11 — Task-conditioned retrieval: two new fields, one optional parameter, ten call sites

```
BUILDER - Session 31 - H2.11. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: retrieval that knows what task it is serving. The primary call site passes an EMPTY queryContext
today - lib/ai/context.ts:59 calls retrievePerformancePatterns(client, businessId, {}) and the comment at
context.ts:41-43 says why: "No campaign/post-specific queryContext is known at this call site
(buildCustomerContext is business-scoped, not per-post)." The scope-match term carries 0.2 of the ranking
weight (lib/memory/constants.ts:9-13) and at the main generation call site it does no work at all.

1. TWO FIELDS ADDED to MemoryQueryContext (lib/memory/scoring.ts:6-10):
   - role?: string - the post's role in the frozen roleSequence (generate.ts:303). Already in hand at the
     call site, costs nothing to thread, and is the strongest task discriminator WITHIN one campaign.
   - campaignId?: string - makes the existing 0.2 scope-match weight do work it currently cannot:
     scopeMatch already understands scope='campaign' via scope_ref, but nothing ever supplies the ref.
   The three existing fields (objective, platform, audience) are NOW ACTUALLY POPULATED rather than
   dropped on the floor.

2. DELIBERATELY NOT ADDED - do not add these "while you are in there" (ADR Section 5.1):
   topic (only useful with a similarity operator; embeddings are out of scope by L-1, and a free-text
   field with no similarity operator can only be substring-matched, which is WORSE than nothing because it
   looks like it works); format (no memory record carries a format dimension); timeWindow (recency already
   decays exponentially at a 30-day half-life, scoring.ts:24-30 - two knobs on one axis can disagree);
   confidenceFloor (confidence is already 0.5 of the score, and a floor is a CAP change, out of scope);
   contactId (relationship_memory is parked until the engagement inbox ships).

3. TWO SEAMS, BECAUSE THERE ARE GENUINELY TWO GRANULARITIES (ADR Section 5.2):
   (a) CAMPAIGN-LEVEL - a THIRD OPTIONAL PARAMETER:
       buildCustomerContext(businessId, voiceVariationId?, queryContext?: MemoryQueryContext = {}).
       It mirrors the existing optional voiceVariationId and the maxTokens ?? DEFAULT shape exactly. ANY
       CALLER THAT DOES NOT PASS IT PRODUCES THE IDENTICAL CALL IT PRODUCES TODAY, including the literal
       {} at context.ts:59.
   (b) PER-POST - withPostQueryContext(ctx, { platform, role }), a new lib/ai/context.ts export that
       re-runs retrievePerformancePatterns ONLY and returns a SHALLOW-COPIED CustomerContext with the
       performance slot replaced. Brand, evidence, audience and voice are NOT re-read: they cannot vary
       per post within one campaign and re-reading them would be pure cost. Cost of (b): one extra
       lib/memory DATABASE read per post - no extra AI call - bounded by PERFORMANCE_CAP = 3.

   LOSERS, NAMED - do not build any of them: a SECOND CONTEXT BUILDER (forks the MEM-CONTEXT-EQUIVALENT
   invariant and would require forking generate.context-equivalence.test.ts with it); a CALLER-SUPPLIED
   OVERRIDE OBJECT (puts retrieval POLICY in ten call sites, which is precisely what
   MEM-NO-DIRECT-TABLE-ACCESS and lib/memory/ exist to prevent); RE-CALLING buildCustomerContext PER POST
   (multiplies the brand/evidence/audience fan-out by the campaign's entry count for three stores whose
   contents cannot change between two posts of one campaign).

4. ONLY ONE CALL SITE PASSES A queryContext: lib/campaigns/generate.ts:176, with
   { objective, audience, campaignId }. THE OTHER NINE PASS NOTHING and are byte-identical to today.

5. THE SERVICE-ROLE ACQUISITION IS UNCHANGED. context.ts:35-37 lazy-imports createServiceRoleClient inside
   a buildCustomerContext that takes NO client parameter. withPostQueryContext acquires its client THE
   SAME WAY and takes NO client parameter either - adding one would let a caller pass an authenticated
   client into a service-role read path and get silent permission failures.

6. CAPS ARE UNCHANGED AND CROSS-TYPE RETRIEVAL IS OUT OF SCOPE (L-1). BRAND_CAP 5, EVIDENCE_CAP 5,
   AUDIENCE_CAP 5, PERFORMANCE_CAP 3 (lib/memory/constants.ts:17-20) - a prompt still receives at most 18
   memory records. Conditioning changes WHAT FILLS THE SLOTS, not how many there are.

CONSTRAINTS CLOSED AND THE TEST THAT PROVES EACH:
- QUAL-QUERY-CONDITIONED (Tier 2) - lib/memory/performance.test.ts + lib/ai/context.test.ts: role and
  campaignId REACH retrievePerformancePatterns and CHANGE RANKING. A test that only asserts the fields
  were passed proves plumbing, not conditioning - assert the ranking difference.
- QUAL-CONTEXT-CALLERS-UNCHANGED (Tier 2) - context-callers.context-equivalence.test.ts +
  generate.context-equivalence.test.ts:279-345, ONE CASE PER CALL SITE in ADR Section 5.4's table. This is
  SHARED-FUNCTION CALLERS: git grep the callers, list per caller which test exercises it, and note that a
  call site with no listed test is AUTHORED-NOT-EXECUTED for that call site even if another is fully
  covered. TEN call sites across NINE files - lib/campaigns/brief.ts holds two, and a per-FILE count is
  exactly how the Session 22 blockers were missed.
- QUAL-SERVICE-ROLE-UNWIDENED (Tier 3) - diff: no new createServiceRoleClient call site outside
  lib/ai/context.ts; no client parameter added to buildCustomerContext OR withPostQueryContext.

ALSO CONFIRM, with a test rather than a claim: MODE2-CONTEXT-EQUIVALENT and MODE2-MEMORY-WIRED still hold
(generate.context-equivalence.test.ts:279-345 and :322,331). That file is the one Q4 must not break.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.11: task-conditioned retrieval via role/campaignId and withPostQueryContext (QUAL-QUERY-CONDITIONED,
QUAL-CONTEXT-CALLERS-UNCHANGED, QUAL-SERVICE-ROLE-UNWIDENED)".
```

#### H2.12 — The surface: four states, the score breakdown, and bulk approve across BOTH callers

```
BUILDER - Session 31 - H2.12. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.
Run taste-skill AND impeccable HERE AND ONLY HERE, AGAINST ADR 0024 SECTION 8.5's contract - not against
their own taste. The ADR specifies the states and the hierarchy; it does not design them, and you do not
re-specify them.

SHIP: what the human sees, and the behaviour change the founder adjudicated.

1. FOUR STATES, ALL FOUR RENDERED (ADR Section 8.3):
   - GENERATING: progress indication. At brief assembly it MUST ALSO carry the A-4 expectation-setting
     copy - brief assembly is now 8-15s slower and A SPINNER WITH NO COPY IS NOT THE CONTRACT.
   - JUDGED-AND-PASSED (winner's overall >= 70): the post, its score badge, and a "3 candidates
     considered" affordance expanding to the winner's TEN-DIMENSION breakdown.
   - ALL-BELOW-THRESHOLD: the post, an AMBER flag, and copy to the effect of "no candidate cleared the
     quality bar - review carefully". EXCLUDED FROM BULK APPROVE (item 2).
   - JUDGING FAILED (the Section 2.3 unscored outcome): the post, NO badge, and an EXPLICIT STATEMENT that
     it was not scored. An absent badge MUST NOT read as a passing one.

2. BELOW-THRESHOLD POSTS ARE EXCLUDED FROM BULK APPROVE (founder ruling A-3). bulkApproveDraftPosts
   (lib/db/posts.ts:594-612) approves EXACTLY THE IDS THE CALLER RENDERED, with
   campaign_id/business_id/status/deleted_at as defence in depth and NO QUALITY PREDICATE - so a
   below-threshold post is as one-click bulk-approvable as any other draft today and the amber flag is
   purely cosmetic. Below-threshold posts now require INDIVIDUAL approval.

   THE FOUNDER ACCEPTS THIS AS A CUSTOMER-OBSERVABLE BEHAVIOUR CHANGE: a bulk approve now LEAVES DRAFTS
   BEHIND, AND THE SURFACE MUST SAY WHY RATHER THAN SILENTLY SKIPPING THEM.

3. THIS IS A SHARED-FUNCTION CALLERS OBLIGATION OF EXACTLY THE SESSION 22 BLOCKER SHAPE.
   bulkApproveDraftPosts has TWO callers - the approvals surface (ApprovalsInbox) AND the campaign posts
   surface (PostsClient). git grep them, cover BOTH, and list per caller which test file exercises it.
   APV-BULK-* was verified against only ApprovalsInbox across THREE CONSECUTIVE SESSIONS while PostsClient
   still exhibited the exact bugs the constraint was supposed to have closed. A caller with no listed test
   is AUTHORED-NOT-EXECUTED for that caller.

4. IMPLEMENTATION CONTRACT (ADR Section 8.5, binding):
   - Server Component page + Client Component for interaction. The breakdown's expand/collapse is client
     state; the page and its data fetch are not.
   - Zod on every Server Action input, before any processing.
   - shadcn v4 is Base UI: NO asChild on Button, NO asChild on DropdownMenu primitives. A link styled as a
     button uses buttonVariants() on a <Link className={cn(buttonVariants({...}))}>.
   - Tailwind only. No CSS modules, no inline style except where genuinely dynamic.
   - i18n EN/PT/ES SIMULTANEOUSLY, in the same commit: the badge, the amber copy, the
     bulk-approve-left-these-behind explanation, the unscored notice, and H2.9's daily-limit string.
     Hardcoded English is a constitution violation, not a nit.
   - Atomic state transitions by conditional WHERE; bounded list queries with an explicit ORDER BY
     matching an index; date-fns and formatISO(); no `any`; no console.*.
   - Any new status colour is a globals.css token with a both-themes contrast assertion that READS THE
     SHIPPED TOKEN FILE - a hand-transcribed hex is the anti-pattern that assertion exists to prevent.

5. LOSING CANDIDATES ARE NEVER SHOWN (ADR Section 8.1). The trust question is "why this one", and the
   winner's own ten-dimension breakdown answers it. Three rejected drafts on a fast-triage surface are
   noise that slows the one decision the surface exists to make.

CONSTRAINT CLOSED AND THE TEST THAT PROVES IT:
- QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE (Tier 2) - the ApprovalsInbox suite AND the PostsClient suite,
  BOTH callers, plus the i18n explanation asserted present in en, pt AND es.

VERIFY: npm run typecheck ; npm run test:app. Commit as
"H2.12: judged-post surface, four states, bulk-approve exclusion across both callers
(QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE)".
```

#### H2.13 — Tier-3 scans, the ADR 0017 amendment, the constraint-to-CI map, and §5's docs

```
BUILDER - Session 31 - H2.13. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the properties of absence, the ADR 0017 amendment, and the honest close-out.

1. THREE TIER-3 SCANS, each DEMONSTRATED TO REDDEN against a temporary violation and then reverted. A scan
   that has never failed is a comment with a test-runner attached.
   - QUAL-NO-NEW-AI-SURFACE: no new route, no new user-facing generation entry point, no new prompt family
     (L-8). Enumerate the TEN prompt ids of ADR Section 2.4 and fail on an eleventh.
   - QUAL-PARSER-RETAINED: extractJsonBlock present AND EXERCISED by the NINE unmigrated prompt ids and by
     lib/ai/tool-runner.ts:445. "Present" alone is not the constraint.
   - QUAL-MODE2-FIXTURES-MIGRATED: NO FIXTURE RE-RECORDED FOR SAMPLING REASONS, and the post-generation
     orphan audit's outcome RECORDED IN THE PR. Read ADR Section 4.1 before writing this one: the build
     guide's L-5 premise that sampling moves fixtures is FALSE FOR THIS REPO, and the correct outcome is
     ZERO fixtures moved. The audit's answer is KEEP THE FIVE post-generation FIXTURES -
     lib/ai/client.ts:61-67 routes promptId === 'post-generation' to that directory and deleting them
     converts any future call into a hard "MockAnthropicClient: fixture not found" throw. The deletion is
     backlog item 31-DEAD-POST-GENERATION-PROMPT and it is one diff with the prompt itself. A DELETED
     FIXTURE WITH NO RECORDED AUDIT IS INDISTINGUISHABLE FROM A FIXTURE SOMEONE FOUND INCONVENIENT.

2. THE L-1 SCOPE SCAN: prove NO lib/memory/ WRITE PATH WAS ADDED. Session 31 has many memory readers and
   adds no writer.

3. ADR 0017 AMENDMENT NOTE. Append a table with ONE ROW PER MODE2-* CONSTRAINT (there are 21), stating
   that it still holds and naming the test that proves it AFTER this session - transcribed from ADR 0024
   Section 4.4, not re-derived. THIRTEEN are Tier-1 DB-behaviour and are untouched because no migration in
   this session alters a Mode 2 table. ONE IS RETIRED: MODE2-HOOK-STANDALONE asserts the existence of the
   standalone openingStrength hook loop, which L-3 removed. A CONSTRAINT WHOSE SUBJECT NO LONGER EXISTS
   CANNOT "STILL HOLD", and quietly leaving it green would be a false green. Record its five forward
   mappings (ADR Section 4.4) and name the test file each now lives in. MODE2-RUBRIC-SHARED is
   STRENGTHENED, not merely preserved: the judge is a FOURTH consumer of the same unforked prompt.

4. THE CONSTRAINT-TO-CI MAP. For each of the 29 QUAL-* constraints: its tier, the test file, the CI job
   that executes it (app-tests.yml or db-tests.yml), and the run URL where it went green. DO NOT CLAIM A
   COUNT UNTIL EVERY ROW IS EXECUTED GREEN IN CI AT THE HEAD IT IS DATED TO. Session 28 shipped a false
   "29/29 executed green" that took three correction steps to undo. For db-tests, read the SKIP-GUARD line
   from the log and confirm a NON-ZERO file and test count - an inferred count is not evidence.

5. THE BEFORE/AFTER RECORD, AND THE BLUNT STATEMENT (ADR Section 10.4). Record, per generated post, the
   winner's overall, the ten-dimension breakdown, the candidate count and the observed per-post recorded
   cost, before and after. THEN STATE PLAINLY, IN docs/current-phase.md, THAT THIS SESSION CANNOT PROVE
   THE POSTS ARE BETTER, and why - four reasons, all in Section 10.4: the eval harness does not apply
   (eval-triage.yml:47-52 gates on triage paths); the headline metric does not exist (lib/learning/diff.ts
   is exhaustively structural and carries an explicit ADR 0018 STOP against adding a diff library); the
   corpus does not exist and is a Session 32 deliverable; and the harness's numbers are a BOOTSTRAP
   CEILING because the cassettes and the labels share an author. ADR 0015 Amendment B's
   MEASURED-NEVER-COVERED language governs how any such number may be described. ZERO TIER-E CONSTRAINTS
   THIS SESSION.

6. INTERIM INSTRUMENTATION - LOGGED, NOT GATED, AND NOT A CONSTRAINT: the judge self-discrimination margin
   (winning candidate's overall minus the median candidate's). If the winner does not sit measurably above
   the median, the judge is not discriminating and N=3 is pure cost. THE LOG LINE MUST STATE BOTH HALVES:
   this proves the judge discriminates; it does NOT prove its discrimination tracks real quality.

7. SECTION 5 DOC UPDATES, per the build guide's close-out checklist: ADR 0024's final constraint table
   with the real post-correction counts; the ADR 0017 amendment from item 3; docs/current-phase.md
   (Session 31 entry, the db-tests promotion tally with the event type stated - only a `master` PUSH event
   counts, never a pull_request run, however green);
   docs/brainstorm/ai-quality-track-ideas-and-build-path.md (mark T1.2, T1.3, T1.4, T1.5 shipped and
   CORRECT its Section 1 diagnosis, which describes the pre-Session-31 state and is wrong the moment this
   lands); ADR 0010 Amendment 2 Section D2.5 (the ai_budget_daily row MOVED, and an EXPLICIT NOTE that no
   NEW row was required - the Session 28-D D7 precedent); docs/backlog.md (anything deferred, each with
   its un-defer trigger named); and .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md.

VERIFY: npm run typecheck ; npm run test:app ; npm run test:db. Commit as
"H2.13: Tier-3 scope scans, ADR 0017 amendment, constraint-to-CI map (QUAL-NO-NEW-AI-SURFACE,
QUAL-PARSER-RETAINED, QUAL-MODE2-FIXTURES-MIGRATED)".
```

**Gate:** `§3` below is authored **alongside this section** and is run **after** `H2.13` is committed and
its CI runs exist. `§4` is authored **only after** H3 has run.

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

**✅ AUTHORED 2026-09-08 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Authored **alongside §2**, per its own gate. **Only the
commit range is filled in at run time, by the Reviewer itself.**

**One correction to the placeholder, carried into the primer.** Its first predicted finding — *"a fixture
migration that quietly weakens a `MODE2-*` constraint"* — was written under L-5's premise that fixtures
move. ADR §4.1 disproves that premise (`MockAnthropicClient` routes on model, promptId and targetPlatform
only), so the expected finding **inverts**: the trap is now a Builder that re-recorded a fixture *anyway*,
which breaks `QUAL-MODE2-FIXTURES-MIGRATED` — a property of **absence**. **H3 must not raise a finding
that fixtures were not migrated.** The other two predictions stand and are sharpened below.

**ECC budget for this phase — zero subagent invocations.** The Reviewer reads the diff itself. A
constraint-table walk against CI logs is not code analysis, and delegating it re-derives what the Reviewer
has already read. Skills are free; none is required.

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 31 Track H - REVIEWER phase (H3). You are independent. You MODIFY NOTHING: no source, no tests, no
ADR, no build guide. Your single output is docs/reviews/session-31-reviewer.md. This is the ONE review
pass for this session; there is no separate re-review track.

PROC-REVIEW-AT-COMMIT IS ABSOLUTE AND IS YOUR FIRST OBLIGATION.
Read every artefact AT THE STATED COMMIT RANGE - git diff <base>..<head>, git show <sha>:<path>,
git log --oneline <base>..<head>. NEVER at HEAD. Reading at HEAD produced a false-positive MAJOR finding
in Session 21B that the next session's reviewer had to withdraw. Your report MUST OPEN by naming the exact
range, e.g.:
  "Scope reviewed: <base>..<head>; all citations are git show <sha>:<path> at that range, never HEAD."
A report that does not name its range is not a valid review.

Exception you may rely on (Session 22-F, NEW-12): the ADR and build guide you audit AGAINST are read at
their own commits, which you name SEPARATELY - they predate or postdate the range and cannot be read
inside it. State both: "ADR 0024 read at <sha>; reviewed artefacts read at <base>..<head>."

WHAT YOU ARE AUDITING AGAINST:
- docs/decisions/0024-generation-quality-core.md, INCLUDING Section 15 (corrections applied after the H1
  review). WHERE A LATER SECTION CORRECTS AN EARLIER ONE, THE CORRECTION IS THE STANDARD. Sections 3.3a,
  7.5a and 7.5b are corrections, they are load-bearing, and the pre-review text they replace was left
  legible deliberately - do NOT raise a finding against superseded text.
- docs/build-guide/session-31.md: the Reality block, Section 0 (L-1..L-11, D-1..D-7), Section 0.2
  (A-1..A-4), and Section 2b's step table.
- docs/decisions/0017-mode-2-upgrade.md and the amendment H2.13 appended to it.
- docs/decisions/0015-test-execution-and-ci-gates.md Section 2 and Amendment B.
- CLAUDE.md's test-execution-integrity section.

ONE PREMISE OF THE BUILD GUIDE IS FALSE AND THE ADR SAYS SO. Build-guide L-5 assumed sampling changes
recorded outputs, therefore ADR 0017's frozen fixtures move. ADR Section 4.1 disproves it for THIS repo:
MockAnthropicClient (lib/ai/client.ts:49-88) routes ONLY on params.model, params._sosh.promptId and
sosh.input.targetPlatform, so temperature and thinking never touch routing. THE CORRECT OUTCOME IS ZERO
FIXTURES MOVED. Do NOT raise a finding that the fixture migration did not happen. DO raise one if a
fixture WAS re-recorded, because QUAL-MODE2-FIXTURES-MIGRATED is a property of ABSENCE.

THE EIGHT THINGS MOST LIKELY TO BE WRONG, in the order I want them checked:

1. AN ARGMAX TEST THAT PASSES ON A 3-WAY TIE. This is the single most likely false green in the session.
   ADR Section 10.2 states it: without a mock that returns a SEQUENCE OF DISTINCT PAYLOADS for one
   promptId, QUAL-ARGMAX-DETERMINISTIC and QUAL-BELOW-THRESHOLD-SURFACED are AUTHORED-NOT-EXECUTED BY
   CONSTRUCTION. Open H2.3's harness, then open the argmax and below-threshold cases, and confirm the
   three payloads ACTUALLY DIFFER in `overall`. Then check the __evalCassetteQueue lifecycle: it is a
   single GLOBAL FIFO (lib/ai/client.ts:38-41, :55-56), and a test that leaves it non-empty POISONS THE
   NEXT FILE. If the teardown does not assert the queue drained, say so.

2. QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE VERIFIED AGAINST ONE CALLER. bulkApproveDraftPosts
   (lib/db/posts.ts:594-612) has TWO callers - ApprovalsInbox AND PostsClient. git grep them AT THE RANGE,
   not by trusting the ADR, and list PER CALLER which test file exercises the exclusion. THIS IS THE EXACT
   SESSION 22 BLOCKER: APV-BULK-* was verified against ApprovalsInbox alone across THREE CONSECUTIVE
   SESSIONS while PostsClient still exhibited the bugs. A caller with no listed test is
   AUTHORED-NOT-EXECUTED for that caller EVEN IF the other is fully covered. Also check the surface SAYS
   WHY it left drafts behind - A-3 makes silent skipping a defect, not a nicety.

3. THE BUDGET DISCRIMINATOR THAT DOES NOT DISCRIMINATE. QUAL-BUDGET-PURPOSE-ISOLATED (Tier 1) requires
   BOTH DIRECTIONS: a capped triage_cents row must not deny a generation_posts reservation on the same
   (business_id, day), AND VICE VERSA. A one-directional test passes on a shared counter half the time.
   Confirm UNIQUE (business_id, purpose, day) actually landed - the old key was UNIQUE (business_id, day)
   and leaving it would silently reintroduce the shared counter. Confirm both RPCs were DROPPED and
   RECREATED (they RETURN SETOF the old table and CREATE OR REPLACE cannot change a return type) and that
   the REVOKE/GRANT pair was RE-ISSUED for each - a recreated SECURITY DEFINER function with no REVOKE is
   a privilege escalation. Confirm existing rows backfilled to purpose='triage_cents' with their value
   intact, and that NO signal_triage_budget table, trigger or RPC survives.

4. THE CAP THAT RESERVES THE WRONG THING. ADR Section 7.5a: generation reserves POSTS, NOT CENTS, ONE UNIT,
   BEFORE THE FAN-OUT. Check all four properties: (a) it is a post count, not a cents estimate; (b) it is
   ONE reservation, not one per candidate - per-candidate reopens the check-then-call race N-fold inside a
   single generation; (c) it happens BEFORE the fan-out; (d) a hard-failed generation RELEASES its unit
   through reconcile_ai_budget. Then confirm PLUS AND TRIAL TAKE NO generation_posts RESERVATION
   (Section 7.4) - a Builder that "helpfully" applied the cap to Plus has shipped an unruled pricing
   change.

5. TRIAL-CAP AND RATE-LIMIT ACCOUNTING THAT DIFFERS FROM THE RULING. One user-visible generation at N=3
   consumes exactly ONE trial post (Section 7.2) and N units of rate limit (Section 7.3). The trial half
   is ALREADY TRUE BY CONSTRUCTION - runner.ts:217 skips the increment for BOTH isPostGeneration(prompt.id)
   AND isScoringOnly(prompt.id), and the orchestrator batch-increments once after insert. THE BUILDER'S
   OBLIGATION WAS NEGATIVE: neither predicate narrowed, batch increment still one per inserted post. If
   the Builder ADDED a mechanism here, that is a finding - it means they misread the section and there is
   now a second thing that can drift. Confirm AI_RATE_LIMIT_POST_GENERATION_PER_MIN moved 30 -> 100 in
   lib/config.ts and NOT via process.env.

6. THINKING WITHOUT THE CEILING. brief-assembly MUST declare thinking: 4000 AND maxTokens: 12_000 IN THE
   SAME DECLARATION at version: 2 (Section 3.3a). A thinking budget is SPENT OUT OF max_tokens, not added
   to it; 4,000 against DEFAULT_MAX_TOKENS = 4096 leaves 96 tokens of visible output and EVERY Stage A
   assembly fails at runner.ts:185 with response_truncated - deterministically, on the first call. If only
   one of the two fields landed, that is a BLOCKER, not a MINOR. Also confirm NO PROMPT DECLARES BOTH
   temperature AND thinking, and that the assertion REDDENS if you add the pair.

7. THE FROZEN TABLE WITH THE WRONG NUMBER OF ROWS. It has EXACTLY TEN rows - one per prompt ID, not one
   per file (Section 3.2, and Section 15 MAJOR-2 which corrects a 12-row draft). formats/policy.ts and
   formats/schemas.ts get NO row: they export validators and Zod schemas and have no id/version/modelKey.
   native-generation-single/-thread/-carousel get THREE rows even though temperature is declared once
   inside the factory. Confirm the scan ENUMERATES prompts at runtime by walking the exported Prompt
   objects plus the factory's three families - a hand-maintained list means a new prompt with no row
   passes, which defeats the whole point of choosing a runtime scan over a diff check. Verify it reddens
   on each of the four properties (modelKey, temperature, thinking, maxTokens) independently.

8. QUAL-CONTEXT-CALLERS-UNCHANGED CLAIMED OVER FEWER THAN TEN CALL SITES. buildCustomerContext has TEN
   production call sites ACROSS NINE FILES - lib/campaigns/brief.ts holds TWO (:111 Stage A and :160
   Stage B). ADR Section 5.4 has the table; verify it by git grep AT THE RANGE and list PER CALL SITE
   which test covers it. A PER-FILE COUNT IS EXACTLY HOW THE SESSION 22 BLOCKERS WERE MISSED. Confirm
   exactly ONE call site passes a queryContext (generate.ts:176) and that the other nine produce
   byte-identical calls, INCLUDING the literal {} at context.ts:59.

ALSO VERIFY, and do not take the Builder's word for any of it:
- EVERY CONSTRAINT CLAIMED COVERED IS EXECUTED GREEN IN CI AT THE STATED HEAD, not merely authored. OPEN
  THE RUNS. There are 29 constraints - 4 Tier 1, 18 Tier 2, 7 Tier 3, 0 Tier E. A claimed count that is
  false at its dated head is exactly what Session 28 shipped and 28-D spent three correction steps undoing.
- THE db-tests SKIP-GUARD LINE SHOWS A NON-ZERO FILE AND TEST COUNT, READ FROM THE LOG, not inferred. If
  db-tests is RED, OPEN THE RUN AND DISTINGUISH a DB-behaviour regression from a stack failure - the
  session-30-5 branch hit a supautils SIGSEGV in the local Postgres stack four times, which is an
  environment failure and not a code defect. Say which one you are looking at; do not report either as the
  other. The db-tests promotion tally is at 7 consecutive green MASTER PUSH runs; pull_request runs never
  move it, however green.
- THE JUDGE IS THE EXISTING rubricPrompt, UNFORKED. RubricOutputSchema byte-unchanged, ten dimensions, no
  rename, rubric.ts:21-24's invariant comment intact. Per SHARED-FUNCTION CALLERS there are now FOUR
  callers - brief.ts:170 mode:'brief', generate.ts mode:'post', signals/triage/card.ts:226 mode:'card',
  and the judge. List the test that exercises each. A multiplexed call returning three score sets would
  change the schema lib/studio/categories.ts derives from; confirm it did not happen.
- EVERY CANDIDATE IS neutralize()'d BEFORE THE JUDGE, and the assertion REDDENS if the call is dropped. A
  test that merely calls the judge proves nothing about neutralization.
- THE JUDGE SCORES joinContent(output), NOT extractOpener(output).
- THE THREE OUTCOMES ARE ALL THREE TESTED (Section 2.3): 0-generated hard fail; all-judges-throw UNSCORED
  and NON-TERMINAL; partial failure with argmax over the survivors. The unscored path is the one most
  likely to be missing, because it is the one that looks like an error path and is actually a success path.
- ALL-N-BELOW-THRESHOLD DOES NOT FAIL THE SESSION, DOES NOT REGENERATE, AND DOES NOT ESCALATE TO OPUS. The
  post is created, flagged, and surfaced.
- LOSING CANDIDATE CONTENT IS NOWHERE PERSISTED. No post_candidates table, no JSONB blob of rejected
  drafts, nothing in posts.ai_generation_metadata.
- SCORES LIVE ON post_ai_originals AS COLUMNS, with schema_version bumped, and NOTHING was written to
  posts.ai_generation_metadata (Section 8.2). Confirm the write respects the write-once BEFORE UPDATE
  trigger at learning_capture.sql:67-68 - scores written WITH the row, not UPDATEd onto it.
- QUAL-SCORE-ERASURE IS A REAL LIVE-POSTGRES CASE: a row carrying the NEW COLUMNS is written,
  purge_business runs, the row is gone. A structural argument from ON DELETE CASCADE is not the test.
- NO NEW BUSINESS-SCOPED TABLE (Section 9), and ADR 0010 Amendment 2 Section D2.5 carries the
  ai_budget_daily rename AND an EXPLICIT NOTE that no new row was required. A business-scoped table
  omitted from that table is a silent GDPR-erasure leak; an undocumented rename is the same leak wearing
  the old name.
- THE RUNNER'S PARSE PATH LEARNED tool_use BEFORE any prompt declared a tool. Check the commit order, not
  just the end state - if they landed together, the first migrated prompt would have failed on every call
  and the test that should have caught it may be asserting the wrong thing.
- EXACTLY ONE PROMPT MIGRATED (learningSummarizerPrompt). extractJsonBlock still present AND EXERCISED by
  the nine unmigrated ids and tool-runner.ts:445. "Present" alone is not the constraint.
- ZOD IS RETAINED BEHIND THE TOOL SCHEMA, and TOutput still infers off prompt.outputSchema.
- withPostQueryContext RE-RUNS retrievePerformancePatterns ONLY - brand, evidence, audience and voice are
  NOT re-read per post. Confirm no client parameter was added to it or to buildCustomerContext, and no new
  createServiceRoleClient call site outside lib/ai/context.ts.
- QUAL-QUERY-CONDITIONED ASSERTS A RANKING DIFFERENCE, not merely that the fields were passed. A plumbing
  assertion proves plumbing.
- CAPS ARE UNCHANGED: BRAND_CAP 5, EVIDENCE_CAP 5, AUDIENCE_CAP 5, PERFORMANCE_CAP 3.
- NO lib/memory/ WRITE PATH WAS ADDED (L-1).
- THE ADR 0017 AMENDMENT HAS 21 ROWS and marks MODE2-HOOK-STANDALONE RETIRED, with its five test cases
  mapped forward INDIVIDUALLY and each mapping naming the test file it now lives in. A retired constraint
  left green in ADR 0017's table is a false green.
- i18n LANDED IN EN, PT AND ES SIMULTANEOUSLY: the score badge, the amber below-threshold copy, the
  bulk-approve explanation, the unscored notice, and the daily-limit string with its 00:00 UTC reset.
- No asChild on Button or DropdownMenu primitives. No `any`. No console.* on a user-facing surface. No raw
  .toISOString(). Every list query bounded with an explicit ORDER BY. Any new status colour is a
  globals.css token with a both-themes contrast assertion that READS THE SHIPPED TOKEN FILE.
- THE EVAL HARNESS WAS NOT RUN AND NOT CLAIMED. eval-triage.yml:47-52 gates on triage paths and no Session
  31 file matches; it exits 0 with applicable: false. A reported green from it is reporting nothing, and
  claiming it is a finding.
- TIER-E LANGUAGE: any quality number is MEASURED, never COVERED (ADR 0015 Amendment B), and the
  bootstrap-ceiling caveat is restated wherever the number appears. ZERO Tier-E constraints this session -
  confirm none was quietly added as a way to avoid writing a real test (Amendment B(b)).

WHAT IS ALREADY KNOWN AND IS NOT A FINDING AGAINST THE BUILDER:
- This session CANNOT PROVE THE POSTS ARE BETTER, and ADR Section 10.4 says so in its own words. No metric,
  no corpus, and a plausible effect size below the detectable floor. If the Builder recorded that honestly,
  that is compliance. A finding IS warranted if the Builder CLAIMED a quality improvement it did not
  measure.
- The A-1 pricing copy is a FOUNDER task (31-A1-PRICING-COPY), deliberately out of scope for H2. Report it
  as still-open, not as a Builder defect.
- 31-DEAD-POST-GENERATION-PROMPT is deliberately deferred: the prompt, its five fixtures and the
  client.ts:61-67 routing branch go together in one diff, in a later session.
- Native generation deliberately gets NO thinking budget (Section 3.3) - the interaction with temperature
  1.0 cannot be resolved without a metric that does not exist. That is a recorded decision, not an omission.

Acknowledge in ONE line, naming the commit range you have been given and confirming you will read at that
range and never at HEAD. Then STOP and wait for the review prompt.
```

### §3b — Reviewer prompt  (paste after the primer is acknowledged)

```
Review the Session 31 Track H Builder range and write docs/reviews/session-31-reviewer.md.

Open the report with the range line (PROC-REVIEW-AT-COMMIT), and name SEPARATELY the commits at which you
read ADR 0024, ADR 0017, and docs/build-guide/session-31.md.

Organise findings by the ADR's own sections so a correction pass can cite them:
  1. The N-candidate contract: N, bounded concurrency, the three outcomes, argmax and tie-breaking, and
     whether the openingStrength retry is genuinely GONE rather than dormant (Section 2; L-3, D-2)
  2. Sampling and thinking as versioned prompt properties: the ten-row frozen table, the default-preserved
     proof across all ten ids, and brief-assembly's thinking + maxTokens pair (Section 3, 3.3a; L-2, D-3)
  3. Fixtures: ZERO moved, and the post-generation orphan audit recorded rather than acted on (Section 4)
  4. Task-conditioned retrieval: the two added fields, the two seams, and the ten call sites (Section 5)
  5. Structured output: parse-path order, z.toJSONSchema, Zod behind the schema, the malformed path, and
     what extractJsonBlock still owns (Section 6; L-7, D-5)
  6. Cost, trial caps and rate limits at N: the guard ordering, the trial-unit negative obligation, the
     rate-limit raise, the budget rename with its purpose discriminator, and the post-not-cents reservation
     (Section 7; L-6, L-9, A-1, A-2)
  7. The UX contract: four states, the score breakdown, and bulk-approve exclusion across BOTH callers
     (Section 8; A-3, A-4)
  8. GDPR and tenancy: no new business-scoped table, the moved D2.5 row, and the erasure proof (Section 9;
     L-10)
  9. The test plan: every constraint's tier, its executing CI job, and whether it REDDENS if the property
     breaks; the Tier-3 seven enumerated AS DECISIONS; and the honest before/after record (Section 10)
 10. SHARED-FUNCTION CALLERS, per caller, with the test that exercises each - FIVE functions:
     buildCustomerContext (ten call sites, nine files), retrievePerformancePatterns, retrieveVoice,
     rubricPrompt (four callers), bulkApproveDraftPosts (two callers)
 11. Scope: L-1's out-of-scope list not shipped - no voice exemplars, no similarity or embedding
     retrieval, no generator tools, no claim verification, no campaign planner, no memory write path, no
     cross-type retrieval, no cap change, no image generation, no new AI surface

Severities: BLOCKER / MAJOR / MINOR / NIT, each with a STABLE ID (BLOCKER-1, MAJOR-2, ...) the correction
pass will cite. For each finding give: what is wrong, the file:line AT THE RANGE, why it matters, and what
would prove it fixed. Do not propose patches - you write no code.

Where you believe ADR 0024 ITSELF is wrong rather than the implementation, say so explicitly and mark it as
an ADR finding, not a Builder finding. This ADR already carries FIVE self-corrections in Section 15 - two
BLOCKERs, three MAJOR/MINOR - including one (Section 3.3a) that would otherwise have broken every brief
assembly on the first call. A sixth defect is entirely possible and you should say so if you find one.

Run the verification yourself rather than trusting the Builder's report:
  npm run typecheck ; npm run test:app ; npm run test:db
  git grep for the five shared functions and their callers
  the three Tier-3 scans, each run at the head AND each demonstrated to redden
Open the CI runs and read the db-tests skip-guard line from the log. If db-tests is red, distinguish a
DB-behaviour regression from the known supautils SIGSEGV in the local Postgres stack and say which.

State plainly anything you could NOT verify and why - an unverified claim recorded as unverified is worth
more than a confident guess. Do not pad the report to look thorough.

End with one line: "Session 31 review complete - <n> findings (<b> BLOCKER, <m> MAJOR, <mi> MINOR, <ni>
NIT) over range <base>..<head>; <c>/29 QUAL-* constraints verified executed green in CI." Then /exit.
```

**Gate:** `§4` is authored **only after** this Reviewer has actually run and
`docs/reviews/session-31-reviewer.md` exists. A correction pass is a response to findings; there is
nothing to order or prioritise until they exist, and inventing them ahead of time produces a fictional
resolution log.

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

**✅ AUTHORED 2026-09-10 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.**

**Filled in from `docs/reviews/session-31-reviewer.md`** (Reviewer range **`05baf1d2..55b421ad`**, 13 commits
`H2.1` `bdcabf50` … `H2.13` `55b421ad`, on branch `session-30-5-adr-0028`). **Eleven steps: D0–D10.**
Correction passes are normal, not failures (constitution). **There is no independent re-review pass this
session** (mirroring 23-D…30-D): this pass fixes the Reviewer's findings, records its own resolutions in the
Reviewer's own file, and the founder adjudicates close-out.

**Reviewer's tally: 2 BLOCKER, 5 MAJOR, 8 MINOR, 5 NIT — 20 findings.** Every one of them appears **exactly
once** in the disposition table below.

> **NOTHING IN THIS PASS IS DEFERRED — founder instruction, 2026-09-10.** Unlike 30-D, this section carries
> **no deferral column, no un-defer-condition table, and no finding whose home is `docs/backlog.md`.** All
> twenty are closed inside D0…D10. Two consequences bind every step: (a) where the Reviewer offered a
> choice between *fixing* and *recording a decision* (MINOR-3, MINOR-4, MINOR-8, NIT-2), this pass takes the
> **fixing** branch wherever a fix exists, and takes the recording branch **only** where the property is
> genuinely unexpressible as a test — and says so with its reason, in the ADR, not in the backlog; (b) a
> finding this pass cannot close, it **REPORTS** — it does not quietly carry forward. The two items already
> in `docs/backlog.md` (`31-A1-PRICING-COPY`, `31-DEAD-POST-GENERATION-PROMPT`) are **not findings** and are
> not touched: the Reviewer explicitly recorded both as correctly-out-of-scope status, not as defects.

**The two BLOCKERs are one failure at two altitudes: the reviewed range exists only on one machine.**
BLOCKER-2 is that `docs/decisions/0024-generation-quality-core.md` — the document defining all 29 `QUAL-*`
constraints, §3.4's A-4 obligation, §5.2b's retrieval seam, §7.5a's reservation contract and §15's five
self-corrections — **has never entered git**, while thirteen commit messages and ~3,500 lines of source cite
`ADR 0024 §N` as their authority; `docs/build-guide/session-31.md` carries 1,490 uncommitted lines holding
§0.2's four founder adjudications, §2b's fourteen Builder steps and §3's Reviewer prompt. BLOCKER-1 is that
the branch was never pushed — `origin/session-30-5-adr-0028` is still `05baf1d2`, thirteen commits behind —
so **0 of 29 constraints are executed green in CI** and every row is `AUTHORED-NOT-EXECUTED` at the reviewed
head. **The Builder did not misreport this**: `docs/current-phase.md` at `55b421ad` states *"0/29 are
CI-executed-green, because CI has not run"* in its own words. That is why BLOCKER-1 is a session-state
blocker rather than an integrity finding, and it is why it closes **last** (D10) rather than first — a push
before the corrections would produce green runs for a range this pass is about to invalidate.

---

### Founder adjudications — **NONE required this pass**

Stated explicitly rather than left ambiguous, because 30-D needed four (A-5…A-8) and a reader will look for
them. **A-1…A-4 (§0.2) stand untouched and are NOT reopened.** Every remedy below is an engineering
decision this pass is authorised to make, for a stated reason:

| Where a founder ruling might have been expected | Why it is not needed |
|---|---|
| **MAJOR-4** — the Reviewer offers (a) merge the query context or (b) record `campaignId`/`role` as inert | (a) **restores** §5.1's own stated purpose (*"makes the existing 0.2 scope-match weight do work it currently cannot"*). Choosing the ADR's own intent is not a new ruling; choosing (b) would have been. |
| **MINOR-1** — release-so-far vs reserve-up-front | Both are correct; (a) release-so-far is chosen because it preserves §7.5a's per-entry reservation shape, which A-2 ruled on. Reserve-up-front would change a ruled shape and *would* need the founder. |
| **MAJOR-5** — how wide to sweep | The Reviewer scoped it himself: the two RPCs this range recreated are in; the repo-wide sweep (`purge_business`, `upsert_signal_candidate`, `get_user_business_ids`) is *"its own tracked piece of work"*. D5 closes the finding; it does not open the sweep. |
| **MINOR-4** — ship the copy, or get the founder's agreement that the existing string suffices | This pass **ships the copy**, which needs no ruling. The agreement branch was the one that needed the founder — and it is the branch not taken. |
| **A-1's pricing copy** (`31-A1-PRICING-COPY`) | Already a founder task, already recorded, and the Reviewer confirms it was correctly out of scope for H2. Unchanged by this pass. |

---

### What the Reviewer found — disposition of all 20 findings (`session-31-reviewer.md` is authoritative)

| ID | Tier | One line | Disposition | Step |
|---|---|---|---|---|
| **BLOCKER-2** | **BLOCKER** | ADR 0024 is **untracked** and exists at no commit; `session-31.md` has 1,490 uncommitted lines (§0.2/§2b/§3). §15 MINOR-4 states the opposite in writing | FIX | **D0** |
| **MAJOR-2** | MAJOR | Both *"runtime"* prompt scans are hand-maintained import lists; an 11th prompt with unversioned sampling ships green, and `QUAL-NO-NEW-AI-SURFACE`'s reddening demo is invalid | FIX | **D1** |
| **MAJOR-1** | MAJOR | `temperature` is never asserted to reach — or be omitted from — the SDK params; deleting `runner.ts:167` leaves the whole repo green | FIX | **D2** |
| **MAJOR-4** | MAJOR (**ADR finding**, §5.2b) | `withPostQueryContext` **replaces** rather than merges; `campaignId` reaches no prompt on the main generation path | FIX (code + ADR) | **D3** |
| **NIT-2** | NIT | `MemoryQueryContext.role` is inert — `scopeMatch` has no `role` branch | FIX (recorded, with a guard) | **D3** |
| **MINOR-1** | MINOR | Reserved generation units leak on a mid-campaign `daily_quota_exceeded` — §7.5a names two outcomes, this is a third | FIX | **D4** |
| **MAJOR-5** | MAJOR (**security**) | Both recreated `SECURITY DEFINER` budget RPCs are EXECUTE-able by `anon`/`authenticated`; the migration's comment claims a closure the `REVOKE … FROM public` does not achieve | FIX | **D5** |
| **NIT-3** | NIT | `signal_triage_budget_pkey` / `_business_id_fkey` / `_reserved_cents_check` survive on `ai_budget_daily` | FIX | **D5** |
| **MINOR-2** | MINOR | `QUAL-CONTEXT-CALLERS-UNCHANGED` proven by absence-of-diff (Tier 3) for a Tier-2 constraint; `brief.ts`'s two sites undistinguished — the Session 22 shape | FIX | **D6** |
| **MINOR-4** | MINOR | A-4's expectation-setting copy for `brief-assembly`'s new +8–15s neither shipped nor recorded | FIX (ship it) | **D7** |
| **MINOR-6** | MINOR | New status colours are raw Tailwind palette, not tokens; no both-themes contrast assertion on the state that gates bulk approve | FIX | **D7** |
| **MINOR-3** | MINOR | H2.3's cassette-queue helper is consumed only by its own test; the global-FIFO poisoning risk stays unguarded for every other file | FIX (wire it) | **D8** |
| **NIT-1** | NIT | Dead `openingStrength` residue at `generate.ts:529-530` survives `QUAL-HOOK-RETRY-REMOVED`'s own grep | FIX | **D8** |
| **NIT-4** | NIT | Two new `as any` in `lib/memory/performance.test.ts`, outside CLAUDE.md's two named carve-outs | FIX | **D8** |
| **NIT-5** | NIT | `app-tests.yml`'s *"two files import the REAL `lib/config.ts`"* comment is now three | FIX | **D8** |
| **MAJOR-3** | MAJOR | ADR 0022's `RUNNER-UNMODIFIED` scan deleted with **no ADR 0022 amendment** — §11.3 names a test file that no longer contains the test. A false green | FIX (ADR) | **D9** |
| **MINOR-5** | MINOR | ADR 0017 Amendment D's five mapped-forward cases name a constraint but no test file — the mapping is a rename until a reader can open the file | FIX (ADR) | **D9** |
| **MINOR-7** | MINOR | §D2.5 carries the rename but not L-10's *"no new business-scoped table required"* record for the `post_ai_originals` columns | FIX (ADR) | **D9** |
| **MINOR-8** | MINOR | The Tier-1 backfill case §10.1 names does not exist; `QUAL-NO-SECOND-BUDGET-TABLE` has no recorded statement anywhere | FIX (re-tier + record) | **D9** |
| **BLOCKER-1** | **BLOCKER** | Branch unpushed; 0/29 constraints executed green in CI at `55b421ad` | FIX | **D10** |

**Count check, to be re-run at D10:** 20 rows, 20 distinct IDs, every ID from the Reviewer's index present
exactly once. If that check fails at D10, the pass is not closed.

---

### Ordering rationale (state it in the resolution log so it does not read as arbitrary)

1. **D0 runs FIRST** — the 25-D…30-D precedent, and here it is load-bearing rather than ceremonial: **D3,
   D4 and D9 all amend ADR 0024**, and amending an untracked document produces no diff and no history. At
   the reviewed head a fresh clone carries 29 `QUAL-*` constraint names in commit messages and code with
   **no document defining any of them**. This repo has paid for this exact shape twice (`632a4b5e`, ADR 0015
   Amendment B; and 30-D's own BLOCKER-2).
2. **D1 (MAJOR-2) precedes every other code step**, for the same reason 30-D put its false-green fix first:
   every later step's verification is *"the new test reddens, then goes green"*, and D1 is the finding that
   the session's own prompt-surface guard **cannot see a new prompt at all**. Fixing it last would mean
   every intermediate step was verified against a scan already demonstrated not to fail. It also has to
   precede **D2**, because D2 adds SDK-level temperature assertions whose value depends on the enumeration
   that feeds the frozen table being real.
3. **D2 before D3/D4.** `temperature: 1.0` is, in §2.4's own words, *"the candidate-diversity lever"* — it
   sits under `runPrompt`, beneath every path D3 and D4 touch. A sampling value whose arrival at the SDK is
   untested is the wrong foundation to add retrieval and reservation tests on top of.
4. **D3 before D4**: MAJOR-4 decides *what context every candidate is generated against*; MINOR-1 decides
   *how many candidates get generated at all*. The retrieval seam is upstream of the reservation loop, and
   D4's new test asserts release accounting for entries whose generation D3 has just changed the input of.
5. **D5 is the only migration in this pass, and it is deliberately alone.** A schema change mid-pass makes
   every earlier step's `npm run test:db` run against a different database shape. It also groups MAJOR-5
   with NIT-3 because both are `ALTER`s on the same table in the same file — two migrations over
   `ai_budget_daily` would each redefine the other's assumed object names.
6. **D6 (MINOR-2) after D3**, not before: D3 changes `withPostQueryContext`'s inputs, and the per-call-site
   argument assertions D6 adds for the ten `buildCustomerContext` sites must pin the **post-D3** shape, or
   they pin a shape that is about to change and give a false sense of coverage for one commit.
7. **D7 groups the two UX items** (MINOR-4, MINOR-6) because they are one design contract (§8.5) and one
   i18n round-trip across three locales. **D7 is the only step in this pass permitted to invoke
   `/impeccable`** — it is Builder-phase design work against an ADR UX contract, which is exactly the phase
   rule in CLAUDE.md. No other step may.
8. **D8 groups the four residue items** (MINOR-3, NIT-1, NIT-4, NIT-5) because none changes behaviour a
   constraint asserts, and splitting four one-line removals across four commits buries the one that does
   matter (MINOR-3 adds a `setupFiles` entry that touches every test file in the suite).
9. **D9 is the documentation-truth step, and it is not cosmetic.** Four findings land there and they are one
   failure: **documents asserting something the range does not carry** — a retired ADR 0022 constraint whose
   table still names a deleted test, a five-row forward-mapping with no file to open, a cascade table
   missing the record L-10 requires, and a Tier-1 case the ADR names that was never writable. Three of the
   four are the exact shape ADR 0024 §4.4 was written to prevent for `MODE2-HOOK-STANDALONE`.
10. **CI runs LAST (D10)**, and its job is not merely to go green: it is to produce the green runs **for the
    corrected range**, which is what turns 29 `AUTHORED-NOT-EXECUTED` rows into executed-green rows and
    makes D9's re-citations true rather than merely updated. Pushing at D0 would burn CI on a range this
    pass is about to replace, and would date the constraint table to a head that no longer exists.

---

### Where resolutions go (CLAUDE.md — `REVIEWER-REPORT APPEND-ONLY`, revised Session 23-D)

Directly into `docs/reviews/session-31-reviewer.md`, under a **single appended, attributed**
`## CORRECTION PASS (Session 31-D)` section at the **end** of the file — no separate corrections file. The
Reviewer's text above it is **immutable**: not one character edited, no verdict flipped, no status column
rewritten, no `RESOLVED` stamped onto a finding, nothing reworded, deleted or reordered — **including the
"What I verified as CORRECT" section and the 20-row findings index**, whose verdicts stay exactly as written
even after the tests exist. The appendix opens with its author, date and the commit range it fixed,
references each finding **by ID**, and records *finding → fix → the test that now proves it → the commit
SHA*. **A disputed or declined finding is argued in the appendix, never erased.** **Never weaken a test to
reach green:** if a correction shows an ADR 0024 constraint is infeasible, **amend ADR 0024** (appended,
never rewritten in place) and say so — MINOR-8 is exactly that case and D9 handles it that way. The Session
22-D failure — RESOLVED verdicts written *into* the Reviewer's finding text — remains the prohibited shape.

> **The ordering hazard, identical to 25-D…30-D's.** `docs/reviews/session-31-reviewer.md` is itself
> untracked (`??` in `git status`). D0 commits it **exactly as the Reviewer wrote it**, before a single
> resolution row is appended, so the immutable text and the appendix land in *different* commits and the
> diff proves mechanically that nothing above the appendix was touched. **Do not fold D0 and the first
> resolution row into one commit.**

> **What D0 commits that is unusual: this section.** `docs/build-guide/session-31.md` is tracked, but its
> committed version (`0c79d118`) predates §0.2, §2b, §3 and §4. It re-enters git with all four already
> authored, because **§4 *is* D0's work order** and cannot land later. Say so in the commit message rather
> than leaving it to look like an accident of timing.

> **The Reviewer's range is not stale.** `git rev-parse HEAD` is `55b421ad` and nothing has landed since the
> report was written. **D0 is the first commit after `55b421ad`** — so every citation in the report is valid
> at the moment D0 runs. BLOCKER-2's own remedy asks for one thing beyond the commit: the appendix must
> **name the ADR's own commit** (the D0 SHA), because the report's range line could not, the ADR having
> existed at no commit when it was written. That is an appendix statement, never an edit to the range line.

**ECC budget for this pass: ≤1 subagent per step, and only where the finding itself names one.**
D5 → `security-reviewer` **and** `database-reviewer` (the one step where a mistake is a **tenancy** bug: a
`SECURITY DEFINER` grant on a customer-facing quota, plus constraint renames on a live table — this is the
single step permitted two). D7 → `/impeccable` (Builder-phase design against §8.5's UX contract, per the
CLAUDE.md phase rule). **D0, D1, D2, D3, D4, D6, D8, D9 and D10 carry none** — a git commit, a filesystem
walk, two SDK assertions, an object spread, a release loop, ten argument spies, four residue removals, four
ADR amendments and a CI push do not need an advisory read. Do **not** re-run the §1 advisory reviewers to
confirm their own ADR-time findings survived; the test that now proves the fix is the confirmation.

**The three highest-risk correction classes in this pass:** (a) **D1** — a filesystem-walking scan that
imports every module under `lib/ai/prompts/` can trip on side-effectful imports or on `config.ts` at import
time (the Reviewer's own bare-shell run hit exactly that at `lib/config.ts:271`), and getting it wrong in
the other direction makes the whole suite unrunnable rather than merely under-covered; (b) **D5** — a
`REVOKE` that is too wide breaks the publishing and metrics workers, which call these RPCs through the
service-role client, and the failure mode is silent until a cron tick; (c) **D3** — merging the query
context changes what every generated post in the product is conditioned on, so the step must prove the nine
untouched callers still receive `{}` and that nothing but the generation path moved. Each of the three ends
by re-running the **full** existing suite for its file and confirming **no previously-green assertion
changed**, not merely that the new one is green.

---

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
You are the Session 31-D correction pass (Track H, ADR 0024). You fix the findings in
docs/reviews/session-31-reviewer.md — you do not re-review, and you do not re-litigate the Reviewer's
verdicts. Acknowledge these nine rules, then stop and wait for D0.

1. THE REVIEWER'S TEXT IS IMMUTABLE. Resolutions go in ONE appended, attributed
   "## CORRECTION PASS (Session 31-D)" section at the END of docs/reviews/session-31-reviewer.md, opening
   with author, date and the commit range fixed. Not one character above it changes — including the
   "What I verified as CORRECT" section, the "What I could NOT verify" list and the 20-row findings index.
   A disputed or declined finding is argued in the appendix, never erased.
2. ONE STEP, ONE COMMIT, THEN STOP. Do not run ahead. Each step's commit message is given; use it.
3. EVERY FIX IS PROVED BY MUTATION, NOT ASSERTION. Break the fix, watch the new test go RED, restore,
   confirm the working tree is clean (`git diff --stat` empty). Record that you did it, in the appendix.
   For D1 the mutation is specific and non-negotiable: ADD AN ELEVENTH PROMPT FILE and watch the scan fail
   WITHOUT touching any import list. That is the finding; anything less re-demonstrates the invalid one.
4. NEVER WEAKEN A TEST TO REACH GREEN. If a fix shows an ADR 0024 constraint is infeasible, amend ADR 0024
   as an APPENDED amendment and say so (MINOR-8 is exactly this case). Deleting or relaxing an assertion to
   pass is the prohibited move.
5. ALL 20 FINDINGS ARE ACCOUNTED FOR, AND NOTHING IS DEFERRED. There is no deferral branch in this pass
   (founder instruction, 2026-09-10). Do not add a docs/backlog.md row for any finding. Do not touch the
   two items already there (31-A1-PRICING-COPY, 31-DEAD-POST-GENERATION-PROMPT) — the Reviewer recorded
   both as correctly-out-of-scope status, not as defects. A finding you cannot close, you REPORT and STOP;
   you do not quietly carry it forward.
6. THE FOUNDER ADJUDICATIONS A-1…A-4 (§0.2) ARE ALREADY RULED AND BINDING. This pass does not reopen,
   re-argue or improve them. NO NEW ADJUDICATION IS REQUIRED — §4 says why, per finding. If you believe one
   is, STOP and say so rather than inventing a ruling.
7. ONE MIGRATION IN THIS PASS, AT D5 ONLY, BY DESIGN. If any other step appears to need one, stop and
   report: a schema change outside D5 makes every earlier step's `npm run test:db` run against a different
   database shape.
8. DO NOT PUSH BEFORE D10. The branch is 13 commits ahead of origin and has never been pushed. CI green for
   a pre-correction range proves nothing and dates the constraint table to a head that will not exist.
9. SCOPE IS THE REVIEWER'S FINDINGS AND NOTHING ELSE. L-1 still binds: no embeddings, no similarity
   retrieval, no voice exemplars, no generator tools, no claim verification, no campaign planner, no
   lib/memory/ write path, no cap change, no image generation, no new AI surface. Do not improve code the
   Reviewer did not fault, and do not add a dependency.
```

---

### §4.1 — Correction steps

#### D0 — BLOCKER-2: land the governing documents in git  ·  FIRST, by design  ·  no code

```
CORRECTION — Session 31-D · D0. No .ts, no .tsx, no .sql. This step puts the documents every later step
amends under version control, so each ADR amendment and each appended resolution row is a diff against a
committed file. Invoke no specialist — this is audit-trail integrity.

THE DEFECT (BLOCKER-2): docs/decisions/0024-generation-quality-core.md is UNTRACKED. `git log --all -- <path>`
is empty; it exists at no commit, at 55b421ad or anywhere in history. It carries §11's 29 QUAL-* constraints,
§10's test plan, §2.4's sampling rationale, §3.4's A-4 obligation, §5.2b's retrieval seam, §7.5a's
reservation contract, §8's UX contract, §9's GDPR record and §15's five self-corrections. Thirteen commit
messages, four migrations and ~3,500 lines of source cite "ADR 0024 §N" as their authority; at the reviewed
range that authority is a file on one machine. ADR 0024 §15 MINOR-4 states the opposite in writing: "Status
`Accepted` while untracked and unregistered → Registered in docs/current-phase.md; the ADR and its two
companion doc edits are committed together." The current-phase.md registration landed; the ADR did not.
Separately, docs/build-guide/session-31.md is `M` with 1,490 uncommitted added lines against its only commit
0c79d118 — the lines holding §0.2's four founder adjudications, §2b's fourteen Builder steps and §3's
Reviewer prompt. And A-1/A-2/A-3/A-4 — one of which contradicts a Locked pricing decision — are
unrecoverable from git.

DO — commit these four paths EXACTLY AS THEY STAND, with no edits in this commit:
- docs/decisions/0024-generation-quality-core.md   (untracked → new file; §15 and its Status line
                                                    BYTE-UNCHANGED, per the Reviewer's stated remedy)
- docs/build-guide/session-31.md                   (enters git WITH §0.2, §2b, §3 and §4 authored — §4 is
                                                    this step's own work order, so it cannot land later.
                                                    Say so in the commit message.)
- docs/reviews/session-31-reviewer.md              (untracked → new file, EXACTLY as the Reviewer left it)
- docs/backlog.md                                  (the uncommitted 31-A1-PRICING-COPY and
                                                    31-DEAD-POST-GENERATION-PROMPT rows the Reviewer read)
Do NOT append the CORRECTION PASS section to the reviewer report here: it must enter git as the Reviewer
wrote it, so the later diff proves nothing above the appendix was touched. Do NOT begin any ADR 0024
amendment here — D3, D4 and D9 own those, and each must be a diff against THIS commit. Do NOT stage any
.ts/.tsx/.sql/.json/.yml change: if one is present in the working tree, report it and leave it.

VERIFY: `git status` clean of those four paths; `git show <D0-sha>:docs/decisions/0024-generation-quality-core.md`
resolves and is byte-identical to the working-tree file (`git diff --stat HEAD -- <path>` empty);
`git show <D0-sha>:docs/reviews/session-31-reviewer.md` byte-identical to the file as the Reviewer left it,
and containing NO "CORRECTION PASS" string; `git show <D0-sha>:docs/build-guide/session-31.md | grep -c
"### §4.1 — Correction steps"` is non-zero; the commit contains no .ts/.tsx/.sql/.json/.yml file.
On commit: "D0 — BLOCKER-2 (part 1 of 2): ADR 0024 enters git for the first time, byte-unchanged including
§15 and its Status line, alongside session-31.md (§0.2/§2b/§3/§4), the Reviewer's report as written, and
docs/backlog.md. session-31.md lands with its §4 correction pass authored, since §4 is this step's own work
order; the reviewer report lands before any resolution row, so the appendix is provably additive. The
appendix names this SHA as the ADR's own commit, which the report's range line could not."
Then stop.
```

#### D1 — MAJOR-2: make both prompt scans genuinely runtime

```
CORRECTION — Session 31-D · D1. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. NO specialist BY
DESIGN: the property is proved by adding an eleventh prompt and watching the scan fail, which is strictly
stronger than an advisory read.

THE DEFECT (MAJOR-2): lib/ai/prompts/prompt-properties.frozen-table.test.ts:137-150's collectPrompts()
returns a HAND-WRITTEN array of ten imported objects, and lib/scope-scans.test.ts's QUAL-NO-NEW-AI-SURFACE
case repeats the identical ten-import list and asserts new Set(ids).size === 10. Neither walks
lib/ai/prompts/ on disk; neither derives the factory's families from the factory's own type. ADR 0024 §3.2
asserts the opposite twice and makes it the REASON for the design choice: "The scan enumerates prompts by
walking the exported Prompt objects plus the factory's three families, so a new prompt or a new family with
no row fails, which is the whole point of choosing a runtime scan over a diff check." The test file's own
header comment repeats the claim verbatim. Failure scenario: add lib/ai/prompts/foo.ts exporting fooPrompt
with temperature: 0.3 and no frozen row — collectPrompts() does not import it, length stays 10, every
per-id assertion passes, and QUAL-NO-NEW-AI-SURFACE passes too. An eleventh prompt family with unversioned
sampling ships green. A fourth createNativeGenerationPrompt family behaves identically. This also
invalidates QUAL-NO-NEW-AI-SURFACE's recorded reddening demonstration ("temporarily added an 11th entry to
collectPromptIds()'s import list") — adding an entry to the list is not the failure mode; adding a prompt
WITHOUT touching the list is.

BUILD:
1. collectPrompts() derives from a FILESYSTEM WALK of lib/ai/prompts/** (readdirSync recursive, .ts only,
   excluding *.test.ts and __fixtures__), importing each module and collecting every export that
   STRUCTURALLY satisfies Prompt — an `id`, a `version`, a `modelKey`, an `outputSchema`. Do not match on
   filename or on a naming convention: `fooPrompt` must be found because it is shaped like a Prompt, not
   because it ends in "Prompt".
2. The factory's families are driven off the factory's OWN family union type, not a literal
   ['single','thread','carousel'] array — so a fourth family added to the union is enumerated with no test
   edit. If the union is not currently exported from lib/ai/prompts/native-generation-prompt.ts, export it;
   that is the minimum production change this step is authorised to make and the only one.
3. lib/scope-scans.test.ts's QUAL-NO-NEW-AI-SURFACE consumes THE SAME collector (import it; do not
   re-implement it in a second place — a duplicated enumeration is how this finding happened). Its assertion
   changes from "size === 10" to "every enumerated id has a frozen-table row and every frozen-table row has
   an enumerated id" — a bijection, which is what the constraint actually means.
4. Files with no Prompt export (formats/policy.ts, formats/schemas.ts) must contribute NOTHING and must not
   error. The Reviewer confirmed both correctly get no row today; keep it that way.
5. RESPECT THE IMPORT-TIME HAZARD. The Reviewer's bare-shell run showed three files fail at import on
   lib/config.ts:271's publicSchema.parse(). If the walk pulls a module that reads config at import time,
   the whole suite becomes unrunnable rather than merely under-covered — the worst outcome available at this
   step. Verify the walk under BOTH a bare shell and app-tests.yml's env block, and say which prompts (if
   any) needed handling.

ALSO, and record it as an ADR observation rather than a silent expansion of scope: §3.2's sentence
"Changing any of those four without bumping that prompt's version in the same commit fails the test"
OVER-CLAIMS what any frozen table can do — editing temperature 1.0 → 0.8 in the factory AND editing the
table row to 0.8, without touching version, passes. The table makes the change VISIBLE IN A DIFF, which is
the platform-map.frozen-table precedent's real property. Do NOT try to build commit-awareness into the test.
Note it here; D9 corrects the ADR sentence.

VERIFY:
- THE MUTATION IS THE FINDING: create a temporary module under lib/ai/prompts/ exporting an object with an
  id, a version, a modelKey, an outputSchema and temperature: 0.3, WITHOUT touching any import list. Confirm
  BOTH the frozen table AND QUAL-NO-NEW-AI-SURFACE go RED. Delete it and confirm `git status` is clean.
  Paste both exit states into the appendix — that transcript is the proof.
- The SECOND mutation: add a fourth family to the factory's union without a table row; confirm RED; restore.
- All ten existing per-id assertions stay green and unchanged in meaning. The table still has exactly ten
  rows and reddens independently on modelKey, temperature, thinking, maxTokens and useToolOutput.
- npx tsc --noEmit --skipLibCheck; npm run test:app.
Append the D1 rows (MAJOR-2, and the §3.2 over-claim as a noted observation routed to D9).
On commit: "D1 — MAJOR-2 closed: collectPrompts() now walks lib/ai/prompts/** and collects every export
structurally satisfying Prompt, with the factory's families driven off its own union type; scope-scans.test.ts
consumes the same collector and asserts a bijection against the frozen table rather than a hand-counted 10.
Proved by adding an eleventh prompt file with no frozen row and no import-list edit — both scans go RED,
which the previously recorded demonstration could not show. §3.2's 'without bumping version fails the test'
over-claim noted for the D9 ADR correction." Then stop.
```

#### D2 — MAJOR-1: prove `temperature` reaches the SDK, and is absent when undeclared

```
CORRECTION — Session 31-D · D2. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist —
this is two assertions in an existing suite, in the exact shape two sibling properties already use.

THE DEFECT (MAJOR-1): lib/ai/runner.ts:167-168 spreads temperature into the SDK params —
`...(prompt.temperature !== undefined ? { temperature: prompt.temperature } : {})` — and NO TEST ANYWHERE
asserts it arrives. `git grep -n temperature -- lib app components` returns five production hits and four
test hits, all four of which read the PROMPT OBJECT's field (prompt-properties.frozen-table.test.ts) or the
"declares BOTH" disjointness check (runner.test.ts:759-784), never mockCreate.mock.calls. Delete
runner.ts:167 and every test in the repo stays green: production silently returns to provider-default
sampling, N=3 draws three near-identical strings, the judge becomes decorative, and the session's cost
doubles for no quality effect — with QUAL-SAMPLING-VERSIONED, QUAL-SAMPLING-DEFAULT-PRESERVED and
QUAL-N-CANDIDATE-COUNT all still passing. ADR §11 constraint 10 says QUAL-SAMPLING-DEFAULT-PRESERVED proves
"a prompt declaring nothing produces byte-identical SDK params" — half of that is unproven. Both sibling
properties ARE covered at this level: runner.test.ts:703-715 (maxTokens 4096 / override) and :799-812
(thinking sent and omitted). Temperature 1.0 is, in §2.4's own words, "the candidate-diversity lever" — the
single most load-bearing value in the session, with no end-to-end test.

BUILD — lib/ai/runner.test.ts, in the shape of the thinking pair at :799-812, no production change:
1. A prompt declaring temperature: 1.0 produces mockCreate.mock.calls[0][0].temperature === 1.0. Use a
   NATIVE-GENERATION prompt (createNativeGenerationPrompt), not a synthetic one — the constraint is about
   the real generation path, and a synthetic prompt would pass even if the factory stopped declaring it.
2. mockPrompt (a prompt declaring nothing) produces params with NO temperature key:
   expect(callArgs).not.toHaveProperty('temperature'). `toBeUndefined()` is NOT sufficient — the constraint
   is byte-identical params, and an explicitly-undefined key is a different object.
3. Do not touch runner.ts. Do not touch the frozen table. Do not narrow or widen :759-784's disjointness
   check — the Reviewer verified it green and it must stay exactly as it is.

VERIFY:
- Prove BOTH redden, separately: (a) delete runner.ts:167's spread → case 1 goes RED; (b) change the spread
  to an unconditional `temperature: prompt.temperature` → case 2 goes RED (the key now present as undefined)
  while case 1 stays green. Restore after each; `git diff --stat` empty. The second mutation is the one that
  proves the assertion is about the KEY, not the value — record both transcripts.
- Re-run the full runner.test.ts suite: :703-715, :726, :759-786, :788, :799-812, :822, :865, :954, :966,
  :979 all stay green, unchanged.
- npx tsc --noEmit --skipLibCheck; npm run test:app.
Append the D2 row (MAJOR-1).
On commit: "D2 — MAJOR-1 closed: runner.test.ts now asserts at the SDK-params level that a native-generation
prompt sends temperature 1.0 and that a prompt declaring nothing sends no temperature KEY at all
(not.toHaveProperty, not toBeUndefined), closing the unproven half of QUAL-SAMPLING-DEFAULT-PRESERVED.
Demonstrated to redden in both directions: deleting the spread, and making it unconditional." Then stop.
```

#### D3 — MAJOR-4 (+ NIT-2): merge the query context instead of replacing it

```
CORRECTION — Session 31-D · D3. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist.
THIS IS AN ADR FINDING, NOT A BUILDER FINDING — §5.2b specified the narrow signature and the Builder
implemented it exactly. The fix is therefore CODE PLUS AN ADR 0024 AMENDMENT; landing one without the other
reproduces the finding at the other altitude.

THE DEFECT (MAJOR-4): lib/campaigns/generate.ts:211-214 builds the campaign-level context
`{ objective, audience, campaignId }` and passes it to buildCustomerContext. Then, for EVERY entry,
generate.ts:322 calls `withPostQueryContext(ctx, { platform: entry.platform, role: entry.role })`, and
lib/ai/context.ts:161-171 re-runs retrievePerformancePatterns with ONLY { platform, role } and REPLACES
recentPostPerformance wholesale. postCtx — not ctx — is what reaches generateNativeContent (:331) and the
judge (:373); ctx.recentPostPerformance is consumed nowhere else. So the campaign-level retrieval is
computed and thrown away once per generation, and campaignId NEVER influences any prompt's context on the
product's main generation path. lib/memory/scoring.ts:56-70's scopeMatch is campaignId's only consumer and
is never called with one from production. QUAL-QUERY-CONDITIONED's two ranking cases
(lib/memory/performance.test.ts:259-286) call retrieveRelevant directly, BYPASSING the seam where the field
is dropped; the plumbing case in lib/ai/context.test.ts proves the third parameter reaches
retrievePerformancePatterns — from the call whose result is discarded. §5.1's stated purpose for campaignId
("makes the existing 0.2 scope-match weight do work it currently cannot") is silently un-done by §5.2b's
narrow signature.

THE CHOICE IS MADE, do not re-open it: remedy (a), MERGE. It restores the ADR's own stated intent; remedy
(b) — recording campaignId as inert — would have needed a founder ruling and is the branch NOT taken.

BUILD:
1. withPostQueryContext merges rather than replaces: `{ ...campaignQueryContext, platform, role }`, with the
   campaign-level MemoryQueryContext threaded from the call site. Per-post fields WIN over campaign-level
   ones on key collision (platform and role are per-post by definition) — assert that precedence, do not
   leave it to spread order being read correctly by the next author.
2. Thread it at generate.ts:322 from the queryContext already built at :211. Do NOT re-derive it, and do NOT
   widen buildCustomerContext's signature.
3. QUAL-SERVICE-ROLE-UNWIDENED MUST HOLD: no `client` parameter appears on either function; the only
   createServiceRoleClient() call sites stay inside lib/ai/context.ts via the lazy-import pattern. The
   Reviewer verified this green at context.test.ts:686 — re-run it and confirm it did not move.
4. withPostQueryContext still re-runs retrievePerformancePatterns ONLY — brand, evidence, audience, voice
   and campaigns are NOT re-read. The Reviewer verified this; the merge must not turn it into a full
   re-build. Re-run context.test.ts's "does not re-read brand/evidence/audience/voice or campaigns" case.
5. NIT-2 — `role` is inert: scopeMatch (scoring.ts:56-70) has no role branch, so role changes no ranking
   anywhere. DO NOT invent a MemoryScope role mapping — no MemoryScope value maps to role, and adding one is
   new retrieval behaviour the ADR does not specify and L-1 does not authorise. Close it by RECORDING, with
   a test that pins the record: (i) a scoring.test.ts case asserting that two otherwise-identical candidates
   with different role values score IDENTICALLY — so the day someone adds a role branch, this case reddens
   and forces the ADR to be updated rather than the behaviour drifting silently; (ii) the ADR amendment in
   step 6 states role is threaded for a named future consumer and is inert today. That is a closure with a
   guard, not a deferral.
6. ADR 0024 §5.2b APPENDED AMENDMENT (never rewritten in place): record that the originally-specified
   signature discarded the campaign-level context, that §5.1's stated purpose for campaignId was therefore
   un-met at H2.11, the merge that now holds, the per-post-wins precedence, and role's recorded inertness
   with the scoring.test.ts case that pins it. Name the Reviewer's MAJOR-4 as the source. This is the SIXTH
   self-correction on an ADR that already carries five — say so plainly in the amendment; §15's own honesty
   is the reason that document is usable.

VERIFY:
- A generate.test.ts case asserting campaignId SURVIVES to retrievePerformancePatterns — spy on the third
  argument at the point withPostQueryContext calls it, and assert { campaignId, platform, role } together.
  That is the seam; asserting it anywhere else re-creates the bypass the Reviewer identified.
- A case asserting per-post platform/role WIN over any campaign-level value of the same key.
- Prove it reddens: restore the replacing form ({ platform, role } only), watch the new case fail, restore.
- QUAL-QUERY-CONDITIONED's two existing ranking cases stay green and UNCHANGED — do not "improve" them to
  route through the seam; the Reviewer's point is that they were the ONLY proof, not that they were wrong.
- npx tsc --noEmit --skipLibCheck; npm run test:app.
Append the D3 rows (MAJOR-4, NIT-2).
On commit: "D3 — MAJOR-4 closed: withPostQueryContext now merges the campaign-level MemoryQueryContext
rather than replacing it, so campaignId reaches retrievePerformancePatterns on the main generation path and
§5.1's stated purpose for the field is met; per-post platform/role win on collision, and
QUAL-SERVICE-ROLE-UNWIDENED plus the no-re-read property are re-verified unmoved. NIT-2 closed by record
plus guard: role stays inert by decision (no MemoryScope maps to it, and adding one is out of L-1 scope),
pinned by a scoring.test.ts case that reddens the moment a role branch appears. ADR 0024 §5.2b amended —
the sixth self-correction, recorded as such." Then stop.
```

#### D4 — MINOR-1: release every reserved unit when a mid-campaign reservation is refused

```
CORRECTION — Session 31-D · D4. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist —
this is release accounting in one function, proved by a three-entry fixture.

THE DEFECT (MINOR-1): generate.ts:305-320 reserves ONE UNIT PER ENTRY, INSIDE the entry loop, and
generate.ts:498 inserts the posts AFTER the loop completes. releaseGenerationPost is called on exactly one
path: the 0-of-N hard fail at :344-347. When entry k's reserveGenerationPost returns null, the function
writes error_code 'daily_quota_exceeded' and returns postsCreated: 0 — leaving the k−1 units already
reserved for entries the customer never received. Failure scenario: a Pro business with 5 of 15 units left
generates a 12-entry campaign; entries 1–5 generate, entry 6's reservation is refused, the session fails
with postsCreated: 0, and 5 daily post units are consumed with no post in existence. ADR §7.5a defines TWO
outcomes — hard fail releases, success keeps. The mid-loop denial is a THIRD case it does not name, and
supabase/__tests__/ai-budget-generation-posts.test.ts does not cover it.

THE CHOICE IS MADE, do not re-open it: remedy (a), RELEASE-SO-FAR. It preserves §7.5a's per-entry
reservation shape, which A-2 ruled on. Reserve-up-front (p_units = totalPosts) is the rejected alternative
BECAUSE it changes a ruled shape and would need the founder — record that reasoning in the ADR amendment so
the next author does not re-litigate it.

BUILD:
1. On the daily_quota_exceeded return path, release EVERY unit reserved so far in this invocation — one
   releaseGenerationPost call per already-reserved entry, or a single reconcile carrying the count; state
   which you chose and why in the appendix. Track the reserved count explicitly; do not infer it from the
   loop index, which is off-by-one at the refusal point.
2. Do not change the reservation site, the cap read (config.server.AI_PRO_DAILY_POST_CAP at :307), the
   'generation_posts' purpose, the one-unit-per-entry shape, or the Plus/trial no-reservation behaviour —
   the Reviewer verified all of these green (generate.test.ts:838, :851, :858, :864, :874, :881).
3. ADR 0024 §7.5a APPENDED AMENDMENT: name the third outcome (mid-loop denial), state that it releases, and
   record the rejected reserve-up-front alternative with its reason. Two outcomes was the defect; three is
   the contract.

VERIFY:
- A generate.test.ts case with THREE entries where entry 2 of 3 is refused, asserting releaseGenerationPost
  is called exactly ONCE (for entry 1's already-reserved unit) and that postsCreated is 0 with error_code
  'daily_quota_exceeded'. The count is the assertion — "was called" would pass on the buggy code the moment
  someone adds a stray release.
- A case where entry 1 of 3 is refused, asserting releaseGenerationPost is called ZERO times — the
  boundary that an off-by-one release loop gets wrong.
- The existing hard-fail release case (:874) and the not-released-on-success case (:881) stay green,
  unchanged.
- Prove it reddens: restore the no-release return, watch the three-entry case fail, restore.
- npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db.
Append the D4 row (MINOR-1).
On commit: "D4 — MINOR-1 closed: a mid-campaign daily_quota_exceeded now releases every generation unit
already reserved in that invocation, so a refusal at entry k no longer consumes k−1 units for posts the
customer never receives; proved by a three-entry fixture asserting an exact release COUNT at k=2 and zero at
k=1, demonstrated to redden against the no-release return. ADR 0024 §7.5a amended to name the third outcome
and record why reserve-up-front was rejected (it changes an A-2-ruled shape)." Then stop.
```

#### D5 — MAJOR-5 + NIT-3: the budget RPC grants, and the legacy constraint names  ·  THE ONLY MIGRATION

```
CORRECTION — Session 31-D · D5. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
security-reviewer ONCE and database-reviewer ONCE — the only step in this pass permitted two specialists,
because a SECURITY DEFINER grant on a customer-facing quota is a TENANCY bug, not a defect, and the
constraint renames touch a live table. THIS IS THE ONLY MIGRATION IN THE PASS.

THE DEFECT (MAJOR-5): supabase/migrations/20260909110000_ai_budget_daily_rename.sql drops and recreates both
RPCs and issues, for each, `REVOKE ALL ON FUNCTION … FROM public;` + `GRANT EXECUTE … TO service_role;`,
with a comment asserting "a recreated SECURITY DEFINER function with no REVOKE is a privilege escalation."
Read from the live linked project, both are:
  reserve_ai_budget    prosecdef=t  acl: postgres=X | anon=X | authenticated=X | service_role=X
  reconcile_ai_budget  prosecdef=t  acl: postgres=X | anon=X | authenticated=X | service_role=X
Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on new functions to anon and authenticated BY NAME.
`REVOKE … FROM public` does not touch a named grant, so the REVOKE the ADR relies on is a NO-OP against
exactly the two roles that matter. Failure scenario: any signed-in customer calls PostgREST
POST /rest/v1/rpc/reserve_ai_budget with {p_business_id: <another tenant's uuid>, p_purpose:
'generation_posts', p_units: 15, p_cap: 15}. The function is SECURITY DEFINER with no caller check and
ai_budget_daily has NO RLS POLICY AT ALL, so the row is written and that tenant's Pro daily post cap is
exhausted for the UTC day; reconcile_ai_budget lets them zero a competitor's counter instead.
vault_delete_secret on the same project shows the correct end state (postgres=X | service_role=X), so the
repo already knows how to do this.

SCOPE IT EXACTLY AS THE REVIEWER DID. This is NOT a Session 31 regression: the superseded
reserve_triage_budget/reconcile_triage_budget used the identical pattern
(20260807110000_mode3_triage_state.sql:154,189), and purge_business, upsert_signal_candidate and
get_user_business_ids all carry the same anon=X | authenticated=X ACL today. It is reported against this
range because the range (a) recreated both functions, (b) attached a CUSTOMER-FACING QUOTA to one, and
(c) wrote a comment claiming a closure it does not achieve. THIS STEP CLOSES THE TWO FUNCTIONS THE RANGE
RECREATED. The repo-wide sweep (purge_business first) is its own tracked piece of work and this pass does
NOT open it — say so in the appendix, with the three function names, so it is a stated boundary rather than
an omission.

THE DEFECT (NIT-3): read live, ai_budget_daily still carries signal_triage_budget_pkey,
signal_triage_budget_business_id_fkey and signal_triage_budget_reserved_cents_check — Postgres carries
constraint names through a RENAME. Cosmetic today (the Tier-1 "no signal_triage_budget object survives" case
probes the table and the RPCs only), and misleading the moment anyone reads a constraint-violation error.

BUILD — ONE new migration, additive, never an edit to 20260909110000_*.sql (it is applied on the live
project; editing an applied migration is the prohibited move):
1. `REVOKE ALL ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) FROM PUBLIC, anon,
   authenticated;` and the same for reconcile_ai_budget with its exact signature. Read the signatures from
   the applied migration; do not retype them from memory — a wrong signature REVOKEs nothing and errors on
   nothing.
2. `GRANT EXECUTE … TO service_role` re-stated, so the file is complete on its own reading.
3. CORRECT THE COMMENT the Reviewer quoted — in the NEW migration's header, not by editing the old file:
   state that REVOKE … FROM public does not touch Supabase's named anon/authenticated default grants, and
   that this is why the original REVOKE was insufficient. The next author will otherwise copy the pattern.
4. NIT-3: ALTER … RENAME CONSTRAINT for the three legacy names → ai_budget_daily_pkey,
   ai_budget_daily_business_id_fkey, ai_budget_daily_reserved_cents_check. Read the live names first; do not
   assume the third one's spelling.
5. Create no new table — QUAL-NO-SECOND-BUDGET-TABLE still holds and D9 records it.

VERIFY:
- Re-read proacl for both functions after applying: `postgres=X | service_role=X` ONLY. Paste the before and
  after ACL strings into the appendix — that read is the proof, not the migration text.
- A Tier-1 case in supabase/__tests__/ asserting an AUTHENTICATED client's rpc('reserve_ai_budget', …) is
  DENIED (permission denied for function), and that the service-role client's identical call still SUCCEEDS.
  Both halves: a REVOKE that also breaks service_role is the failure mode this step must not ship, and the
  publishing/metrics workers call these through service-role on a cron tick where breakage is silent.
- The existing QUAL-BUDGET-PURPOSE-ISOLATED bidirectional cases (signals3-triage-state.test.ts:289 and :311)
  and the "no signal_triage_budget survives" case (:263) stay green.
- A query asserting the three renamed constraints exist under their new names and none under the old.
- Prove it reddens: drop the named-role REVOKE from the migration, re-apply to a scratch DB, watch the
  authenticated-denied case fail, restore.
- npx tsc --noEmit --skipLibCheck; npm run test:app; npm run test:db.
Append the D5 rows (MAJOR-5, NIT-3) INCLUDING the explicit statement that the repo-wide sweep is out of this
pass and which three functions it covers.
On commit: "D5 — MAJOR-5 closed: both recreated SECURITY DEFINER budget RPCs now REVOKE FROM PUBLIC, anon,
authenticated, so a signed-in customer can no longer exhaust or zero another tenant's Pro daily post cap
through PostgREST; proacl re-read shows postgres=X | service_role=X only, and a Tier-1 case asserts the
authenticated call is denied while the service-role call still succeeds. The migration header records why
REVOKE FROM public was a no-op against Supabase's named default grants. NIT-3 closed: the three
signal_triage_budget_* constraint names renamed to ai_budget_daily_*. The repo-wide sweep (purge_business,
upsert_signal_candidate, get_user_business_ids) is explicitly out of this pass and stated as such." Then stop.
```

#### D6 — MINOR-2: assert `QUAL-CONTEXT-CALLERS-UNCHANGED` per call site

```
CORRECTION — Session 31-D · D6. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist.
RUNS AFTER D3 BY DESIGN: D3 changes withPostQueryContext's inputs, and these assertions must pin the POST-D3
shape or they give a false sense of coverage for exactly one commit.

THE DEFECT (MINOR-2): the constraint's stated shape is "asserts, PER CALL SITE, that the arguments and the
resulting CustomerContext are unchanged for the nine." There are TEN production call sites across NINE files
(lib/campaigns/brief.ts holds two, :111 Stage A and :160 Stage B) — the §5.4 count is correct — and exactly
one (generate.ts:214) passes a queryContext. Only that one has an ARGUMENT assertion
(generate.context-equivalence.test.ts:291-298). The other nine are covered by suites that exercise the
caller but never assert what was passed to buildCustomerContext:
  2  lib/campaigns/brief.ts:111 (Stage A)            → brief.test.ts, NOT distinguished from #3
  3  lib/campaigns/brief.ts:160 (Stage B)            → brief.test.ts, NOT distinguished from #2
  4  lib/learning/summarize.ts:156                   → summarize.test.ts, no arg assertion
  5  lib/signals/triage/orchestrator.ts:125          → orchestrator.test.ts, no arg assertion
  6  …/campaigns/[id]/generate-action.ts:44          → context-callers.context-equivalence.test.ts:188
  7  …/campaigns/[id]/posts/actions.ts:282           → posts/actions.test.ts, no arg assertion
  8  …/onboarding/infer-brand-voice/actions.ts:27    → context-callers.…test.ts:205
  9  …/settings/voice/refine-from-posts-action.ts:42 → context-callers.…test.ts:223
  10 …/studio/actions.ts:133                         → studio/actions.test.ts, no arg assertion
The property DOES hold — none of those nine files changed in the range and the third parameter defaults to
{} — so this is not a false green. But it is proven by ABSENCE-OF-DIFF, a Tier-3 argument, for a constraint
the ADR tiers as 2. And brief.ts's two sites covered by one undifferentiated file is the per-FILE accounting
§5.4 itself warns is "exactly how the Session 22 blockers were missed."

BUILD — tests only, no production change:
1. A spy-on-args case PER ROW above: assert buildCustomerContext receives its third argument as undefined or
   {} (whichever the call site actually passes — read each one; do not assume) and that the resulting
   CustomerContext is shape-unchanged. Ten rows, ten assertions.
2. brief.ts's two sites are DISTINGUISHED INDIVIDUALLY — Stage A and Stage B asserted separately, by name.
   That distinction is the whole point of the finding; one case covering "brief.ts" repeats the Session 22
   shape at a smaller scale.
3. Do not re-tier the constraint. The alternative remedy the Reviewer allowed (an appendix note re-tiering
   the nine as Tier 3) is NOT taken — a Tier-2 constraint with a Tier-2 proof is available here, and this
   pass takes the fixing branch wherever a fix exists.
4. Per SHARED-FUNCTION CALLERS, record the per-caller table in the appendix with, for each row, the test
   file AND line that now asserts its arguments. A caller with no listed line is AUTHORED-NOT-EXECUTED for
   that caller even if another caller is fully covered.

VERIFY:
- Prove they redden AS A GROUP AND INDIVIDUALLY: add a stray third argument at ONE call site (brief.ts:160
  — the Stage B site, the one previously indistinguishable) and confirm ONLY that row's case goes RED, not
  the Stage A one. Restore. That single mutation is what proves the ten are ten and not one.
- generate.context-equivalence.test.ts:291-298 and context-callers.context-equivalence.test.ts stay green,
  unchanged in meaning.
- npx tsc --noEmit --skipLibCheck; npm run test:app.
Append the D6 row (MINOR-2) with the ten-row per-caller table.
On commit: "D6 — MINOR-2 closed: QUAL-CONTEXT-CALLERS-UNCHANGED now has a per-call-site argument assertion
for all ten production sites, with brief.ts's Stage A and Stage B sites distinguished individually rather
than covered by one undifferentiated file; the constraint is proved at Tier 2 as the ADR tiers it, not by
absence-of-diff. Demonstrated to discriminate: a stray third argument at brief.ts:160 reddens only the Stage
B case." Then stop.
```

#### D7 — MINOR-4 + MINOR-6: the two UX obligations  ·  the ONE step that may invoke /impeccable

```
CORRECTION — Session 31-D · D7. Run /ecc:plan → /ecc:verification-loop. Invoke /impeccable ONCE, against
ADR 0024 §8.5's UX contract — this is Builder-phase design work, which is the ONLY phase CLAUDE.md permits
it in, and no other step in this pass may. Do not invoke /taste-skill: neither surface is generic-reading;
both are small, specific states inside surfaces that already have a point of view.

THE DEFECT (MINOR-4): ADR §3.4 and build-guide §0.2 A-4 state the obligation in the same words — "The
Builder owes a progress state that sets the expectation" / "a spinner with no copy is not the contract."
brief-assembly's thinking: 4000 landed at H2.2 (8ac97dfc), adding +8–15s to brief assembly. The only brief
progress string in the repo is i18n/en/common.json:229 — "The brief is still being assembled and critiqued.
Check back shortly." — UNCHANGED in the range and written before the latency existed.
`git diff 05baf1d2..55b421ad -- i18n/` shows no brief-progress addition in any of the three locales. A-4 is
one of four founder rulings and the only one whose deliverable is purely UX.
THE CHOICE IS MADE: SHIP THE COPY. The alternative the Reviewer allowed — recording the existing string as
sufficient, with the founder's agreement — is the branch NOT taken, because it needs a ruling this pass does
not have and because "check back shortly" does not set an expectation for a deliberate 8–15 second wait.

THE DEFECT (MINOR-6): components/posts/PostJudgmentBadge.tsx (new at 03eebcb8) renders the two new status
states with LITERAL palette classes — bg-amber-100 … text-amber-800 dark:bg-amber-950/40 dark:text-amber-300
and bg-emerald-100 … text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300. No app/globals.css token
is added and no test reads the shipped token file to assert contrast in either theme. §8.5 binds the Builder
to the repo's design contract, and the AMBER state is the one carrying a BEHAVIOURAL consequence (exclusion
from bulk approve), so its legibility in both themes is functional, not cosmetic. Scoped honestly: this is
house-consistent — ApprovalsInbox.tsx's pre-existing bulk button is bg-emerald-700 … text-white, also raw
palette — so it is a continuation, not a regression. Fix the new badge; do NOT sweep the pre-existing ones.

BUILD:
1. MINOR-4 — a brief-assembly progress string that NAMES THE WAIT, in en, pt and es SIMULTANEOUSLY (CLAUDE.md
   i18n rule; the Reviewer's key-parity check found zero missing/zero extra in the range and it must stay
   that way). It sets an expectation: the brief is being critiqued, this takes a few seconds longer than a
   draft, the page updates itself. Do not invent a percentage or a countdown — the latency is 8–15s and
   variable, and a false precision is worse than none. Wire it into the brief surface's pending state; a key
   added to the locale files and rendered nowhere is the same defect at a different altitude.
2. MINOR-6 — TWO token pairs in app/globals.css, defined in BOTH `:root` (line ~61) and `.dark` (line ~113),
   in the file's existing oklch idiom: a warning/below-threshold pair and a success/cleared pair, each with
   a background and a foreground token. PostJudgmentBadge.tsx consumes the tokens; the literal amber-* and
   emerald-* classes leave the badge. Do not touch ApprovalsInbox.tsx's bulk button.
3. Keep all four rendered states and their existing semantics EXACTLY: resolvePostJudgment maps
   cleared_quality_threshold: null → 'judging-failed', NEVER a defaulted false, and the unscored state is
   stated rather than badge-absent. The Reviewer verified all four green in both surfaces — this is a colour
   change, not a state change.

VERIFY:
- A test that READS THE SHIPPED TOKEN FILE (app/globals.css — parse it, do not hardcode the values into the
  test) and asserts a WCAG AA contrast ratio (≥4.5:1 for the badge text size in use) for each pair under
  BOTH `:root` and `.dark`. Reading the shipped file is the point: a test carrying its own copy of the
  values passes forever after someone edits globals.css.
- Prove it reddens: set one dark-mode foreground token to a near-background value, watch the contrast case
  fail for that pair and that theme only, restore.
- Programmatic i18n key parity across en/pt/es for every file touched: zero missing, zero extra — the same
  check the Reviewer ran.
- PostJudgmentBadge.test.tsx, PostCard.test.tsx and ApprovalsInbox.test.tsx all stay green: all four states
  still render, the amber state still excludes from bulk approve, and both surfaces still SAY WHY (A-3).
- npx tsc --noEmit --skipLibCheck; npm run lint; npm run test:app.
Append the D7 rows (MINOR-4, MINOR-6).
On commit: "D7 — MINOR-4 closed: A-4's expectation-setting copy for brief assembly's +8–15s thinking budget
now ships in en/pt/es and renders on the brief pending state, replacing a string written before the latency
existed. MINOR-6 closed: the two new status states read from --status-* token pairs defined in both :root
and .dark, with a test that parses the shipped app/globals.css and asserts WCAG AA contrast in both themes —
the amber state gates bulk approve, so its legibility is functional. The pre-existing raw-palette bulk button
is deliberately untouched." Then stop.
```

#### D8 — MINOR-3 + NIT-1 + NIT-4 + NIT-5: the residue

```
CORRECTION — Session 31-D · D8. Run /ecc:plan → /ecc:verification-loop. No specialist. Four items, one
commit: none changes behaviour a constraint asserts, and splitting them buries the one that does matter
(MINOR-3 adds a setupFiles entry that touches every test file in the suite — treat it as the risky one).

MINOR-3 — H2.3's cassette-queue helper is used by nothing except its own test.
`git grep -n 'enqueueCassettes\|drainCassetteQueue' -- lib app components` returns hits in
lib/ai/__test-utils__/cassette-queue.ts and cassette-queue.test.ts ONLY. The tests that needed distinct
payloads — generate.test.ts's argmax, tie-break, partial-failure and below-threshold cases — get them from
vi.mocked(runPrompt).mockResolvedValueOnce(...) and vi.mocked(generateNativeContent).mockResolvedValueOnce(...)
chains, because that file mocks @/lib/ai/runner and @/lib/ai/generate-native wholesale (generate.test.ts:42-49).
BE PRECISE ABOUT WHAT IS AND IS NOT WRONG: the property ADR §4.5(2) demanded IS MET — the argmax case uses
three distinct overall values (60/95/80) and asserts the winner is 95; the tie case uses three distinct
candidate bodies plus a deliberate 90/90/70 tie and asserts candidate 0 wins. These do NOT pass on a 3-way
tie. This is NOT the false green the ADR feared. What is wrong is narrower: the named prerequisite
deliverable — including drainCassetteQueue's loud-failure teardown — guards a queue no Session 31 test
touches, so the global-FIFO poisoning risk at lib/ai/client.ts:38-41,:55-56 remains UNEXERCISED AND
UNGUARDED FOR EVERY OTHER FILE.
THE CHOICE IS MADE: WIRE IT. The alternative the Reviewer allowed — recording H2.3 as superseded by the
vi.mock route and keeping the helper as available infrastructure — is the branch NOT taken, because it
closes the finding while leaving the poisoning risk unguarded, and this pass takes the fixing branch
wherever a fix exists.
  BUILD: vitest.config.ts currently has NO setupFiles entry (verified — read it before editing). Add one
  global setup module that calls drainCassetteQueue() in an afterEach, so an un-drained queue fails LOUDLY
  in whichever file left it dirty rather than poisoning the next file. Keep the existing `include`/`exclude`
  blocks and their long explanatory comments BYTE-UNCHANGED — those comments encode the Session 22 B2
  false-green history and the ADR 0023 §2.4.2 eval-scope decision, and losing them re-opens both.
  RISK, state it in the appendix: the setup module runs for all 257 files. If it measurably slows the suite
  or breaks a file, report the measurement — do not silently drop the wiring and fall back to the recording
  branch without saying so.

NIT-1 — dead openingStrength residue survives QUAL-HOOK-RETRY-REMOVED's own grep.
generate.ts:529-530 still carries an unreachable branch — previousContent is hard-coded null at :460, so the
ternary's true arm can never run — containing the string
`rejectionNote: 'weak opener (openingStrength below threshold)'`. The constraint's recorded verification
(generate.test.ts:822-828) greps for `extractOpener\|openingStrength.score <`, which does not match it. The
retry itself IS genuinely gone (no second generateNativeContent call, no threshold comparison, no
regenerationCount mutation).
  BUILD: delete the unreachable branch and the string. WIDEN the Tier-3 grep at generate.test.ts:822-828 to
  also reject the bare token `openingStrength`, so the residue cannot come back under a third spelling. A
  constraint whose grep misses its own residue is the finding; deleting the residue without widening the
  grep fixes today and not tomorrow.

NIT-4 — two new `as any` outside CLAUDE.md's named carve-outs.
lib/memory/performance.test.ts uses `const client = {} as any` with an eslint-disable, twice, new in the
range. CLAUDE.md names EXACTLY TWO any-adjacent loci — lib/email/templates/index.ts and
supabase/__tests__/*.test.ts — and this is an app-layer lib/** test file. `npm run lint` is 0 errors, which
is why it is a NIT and not a finding against the gate.
  BUILD: type both against the real client shape the function consumes (a narrow structural type, or the
  generated Supabase client type), and REMOVE the eslint-disable comments. Do NOT add a third carve-out to
  CLAUDE.md — extending the constitution to legalise a test's convenience is the wrong direction, and the
  two existing carve-outs are each justified by a real type-unification problem this one does not have.

NIT-5 — .github/workflows/app-tests.yml's env comment is now stale.
It reads "two files import the REAL lib/config.ts unmocked (lib/config.test.ts …; lib/signals/orchestrator.test.ts …)".
As of this range there are THREE — lib/campaigns/generate.test.ts now transitively imports lib/config.ts via
lib/campaigns/generate.ts, which is what the Reviewer's bare-shell run surfaced. CI still passes (the env
block is step-scoped), which is why this is a NIT and not a finding against the job.
  BUILD: correct the count and name the third file and WHY it is transitive rather than direct — the
  distinction is the thing a future author needs, because a transitive importer can appear without anyone
  editing a test.

VERIFY:
- MINOR-3: leave the queue deliberately dirty in a scratch test file and confirm the global afterEach FAILS
  that file loudly; delete the scratch file; confirm `git status` clean. Then run the FULL suite and record
  the before/after wall-clock in the appendix.
- NIT-1: confirm the widened grep case reddens by re-adding the deleted string; restore.
- NIT-4: `npm run lint` still 0 errors, and the two eslint-disable comments are GONE from the file (grep it).
- NIT-5: no code change; the yml's step-scoped env block is untouched.
- npx tsc --noEmit --skipLibCheck; npm run lint; npm run test:app.
Append the D8 rows (MINOR-3, NIT-1, NIT-4, NIT-5).
On commit: "D8 — MINOR-3 closed by wiring, not by record: drainCassetteQueue now runs in a global vitest
afterEach, so the client.ts global-FIFO poisoning risk fails loudly in whichever file leaves the queue dirty
instead of being guarded only by its own test; include/exclude comments byte-unchanged. NIT-1 closed: the
unreachable openingStrength branch deleted and QUAL-HOOK-RETRY-REMOVED's grep widened to the bare token so
the residue cannot return. NIT-4 closed: both `as any` in lib/memory/performance.test.ts typed properly and
their eslint-disables removed, with no third CLAUDE.md carve-out added. NIT-5 closed: app-tests.yml's env
comment names three files and says which one is transitive." Then stop.
```

#### D9 — documentation truth: MAJOR-3, MINOR-5, MINOR-7, MINOR-8  ·  no code

```
CORRECTION — Session 31-D · D9. No specialist, no .ts, no .tsx, no .sql. Four findings, one failure:
DOCUMENTS ASSERTING SOMETHING THE RANGE DOES NOT CARRY. Three of the four are the exact shape ADR 0024 §4.4
was written to prevent for MODE2-HOOK-STANDALONE — "quietly leaving it green in the ADR 0017 table would be
a false green." Every edit below is an APPENDED amendment; nothing above an existing amendment marker is
rewritten in place.

MAJOR-3 — an ADR 0022 constraint was retired in code with no ADR 0022 amendment.
`git diff 05baf1d2..55b421ad -- lib/scope-scans.test.ts` DELETES the entire MODE2-RUNNER-UNTOUCHED describe
block — the SHA-256 content pin on lib/ai/runner.ts and the "no fourth is* predicate" assertion — replacing
it with a comment explaining the retirement. The deletion is CORRECT ON THE MERITS: ADR 0024 §3.1/§6.4/§7
legitimately modify runner.ts. But MODE2-RUNNER-UNTOUCHED is ADR 0022's constraint, not ADR 0017's. At
55b421ad, docs/decisions/0022-promote-to-campaign-and-format-families.md:911 still names
`lib/scope-scans.test.ts (MODE2-RUNNER-UNTOUCHED)` as RUNNER-UNMODIFIED's executable home, and :927 lists it
under "executable". `git diff --name-only 05baf1d2..55b421ad -- docs/decisions/` returns only 0010 and 0017 —
ADR 0022 GOT NO AMENDMENT. And ADR 0024 §0's "Amends" list names ADR 0017 §7, MODE2-HOOK-STANDALONE, ADR 0021
§3.3/§3.4 and ADR 0018 §2.3 — NOT ADR 0022 — so the retirement is also unauthorised by the ADR. The cited
precedent (POSTS-DDL-UNMODIFIED) was retired with a DEDICATED DOC COMMIT, b6580b84; this one was retired in
a code comment inside a source commit.
  BUILD: (a) an APPENDED amendment on docs/decisions/0022-promote-to-campaign-and-format-families.md marking
  RUNNER-UNMODIFIED RETIRED, SUPERSEDED BY ADR 0024 §3.1/§6.4, naming the commit that deleted the scan
  (bdcabf50), and stating what still guards the "no fourth is* predicate" half — runner.test.ts:865
  (QUAL-TRIAL-UNIT-PER-POST's exact-skip-set case) does in fact still cover it, and the amendment must say
  so by file:line rather than leaving the half unaccounted; (b) ADD ADR 0022 to ADR 0024 §0's "Amends" list,
  as an appended correction, so the authority matches the act.

MINOR-5 — ADR 0017 Amendment D's five mapped-forward cases name no test file.
Amendment D at 55b421ad carries exactly 21 rows (independently verified) and MODE2-HOOK-STANDALONE is marked
"NO — deliberately retired" with its reason on the record — that half is right. But the five-case mapping
table gives only a target CONSTRAINT NAME per row (QUAL-JUDGE-RUBRIC-UNFORKED, QUAL-BELOW-THRESHOLD-SURFACED,
…) and NO TEST FILE, while every other row of the 21 names a file. A retired constraint's cases are only
"mapped forward" if a reader can OPEN THE FILE that now runs them; without one, the mapping is a rename.
  BUILD: a file:line in each of the five rows. The files exist — lib/campaigns/generate.test.ts:665-820 and
  lib/ai/prompts/rubric.test.ts — READ THEM and cite the actual case line, do not cite the range endpoints.
  Append the correction; do not rewrite Amendment D's existing rows in place.

MINOR-7 — §D2.5 carries the rename but not L-10's "no new row required" record.
docs/decisions/0010-legal-surface.md §D2.5 at 55b421ad correctly renames the row and annotates it
("ai_budget_daily … renamed from signal_triage_budget, ADR 0024 §7.5b, Session 31 H2.8 — same row, same FK,
same cascade, purpose column added carries no personal data"), and purge_business is cascade-driven
(20260702120700_purge_business_member_delete.sql:59-61 — a root DELETE FROM public.businesses, no table
named), so the rename is safe by construction with no function edit owed. What is missing is the SECOND
obligation: L-10 / ADR §9's explicit-statement branch, on the Session 28-D D7 precedent, calls for the "no
new business-scoped table required" record to live in §D2.5's OWN DOCUMENT. It lives in ADR 0024 §9 and in a
migration header comment — not in the cascade table, which is what a GDPR auditor reads.
  BUILD: one line under §D2.5's table recording that Session 31 introduced NO new business-scoped table,
  that post_ai_originals gained four columns needing no new row (the ADR 0022 studio_drafts precedent), and
  that QUAL-SCORE-ERASURE (supabase/__tests__/post-ai-original-scores-erasure.test.ts) proves erasure reaches
  them. Cite D5's migration too — it added no table either.

MINOR-8 — the Tier-1 backfill case ADR §10.1 names does not exist.
§10.1 requires, under QUAL-COST-CEILING-EXTENDED, "one proving existing rows backfilled to
purpose='triage_cents' with their reserved_units value intact." supabase/__tests__/signals3-triage-state.test.ts
at 55b421ad has a "NO signal_triage_budget table or RPC survives the rename" case (:263) and a "purpose has
no default" case (:274) — NO BACKFILL CASE. It is NOT WRITABLE against db-tests' fresh-migrate stack: there
are no pre-rename rows to backfill. The migration's `ADD COLUMN purpose text NOT NULL DEFAULT 'triage_cents'`
followed by `ALTER COLUMN purpose DROP DEFAULT` makes the backfill structurally guaranteed, and the live
project's rows did migrate. The PROPERTY HOLDS; the RECORD is what is missing, and ADR 0015 §2 is explicit
that "no runtime test" must be an ENUMERATED DECISION, never a gap.
  BUILD: (a) re-tier the BACKFILL HALF of QUAL-COST-CEILING-EXTENDED to TIER 3 in ADR 0024 §10.1 and §11,
  with its untestability stated in the ADR's own words — the fresh-migrate stack has no pre-rename rows, and
  the DEFAULT-then-DROP-DEFAULT sequence is the structural guarantee that replaces the test. This is the ONE
  place in this pass where the recording branch is taken over the fixing branch, and the reason is that no
  test can express the property, not that writing one is inconvenient. Say that explicitly. The Tier-1 half
  of the constraint (the cap arithmetic) is UNCHANGED and stays Tier 1. (b) a one-line Tier-3 record for
  QUAL-NO-SECOND-BUDGET-TABLE — the one Tier-3 row with no recorded statement anywhere in code — alongside
  the other six, in ADR 0024 §10/§11.

ALSO, from D1: correct §3.2's over-claim. The sentence "Changing any of those four without bumping that
prompt's version in the same commit fails the test" is not true of any frozen table — editing the value in
both the source and the table row, without touching version, passes. Append the correction stating what the
table actually guarantees: the change is VISIBLE IN A DIFF (the platform-map.frozen-table precedent's real
property), and D1's bijection scan is what makes a NEW prompt impossible to add silently.

VERIFY:
- Every edit is APPENDED. `git diff` for this step shows NO deletion or in-place rewrite above any existing
  amendment marker in any of the four documents — check it, do not assume it.
- ADR 0022 §11.3's RUNNER-UNMODIFIED row can be traced from its table to the amendment to
  runner.test.ts:865, by a reader with no other context.
- Each of Amendment D's five rows now names a file:line that OPENS and contains the case it claims.
- The Tier counts in ADR 0024 §10/§11 are internally consistent after the re-tier — recount them
  (previously 4 Tier 1, 18 Tier 2, 7 Tier 3, 0 Tier E) and state the new counts. A re-tier that leaves the
  header count stale is the same class of defect as the one being fixed.
- Confirm 0 Tier E rows still, per ADR 0015 Amendment B(b) — no quality claim may be smuggled in here.
Append the D9 rows (MAJOR-3, MINOR-5, MINOR-7, MINOR-8, and the §3.2 correction from D1).
On commit: "D9 — documentation truth. MAJOR-3 closed: ADR 0022 carries an appended amendment retiring
RUNNER-UNMODIFIED as superseded by ADR 0024 §3.1/§6.4, naming bdcabf50 and runner.test.ts:865 as what still
guards the no-fourth-predicate half; ADR 0024 §0's Amends list corrected to include ADR 0022. MINOR-5 closed:
Amendment D's five mapped-forward rows now name file:line. MINOR-7 closed: §D2.5 records that Session 31
added no business-scoped table and that QUAL-SCORE-ERASURE proves erasure reaches post_ai_originals' four
new columns. MINOR-8 closed: the backfill half of QUAL-COST-CEILING-EXTENDED re-tiered to Tier 3 with its
untestability stated — the one recorded-decision closure in this pass, and the reason is expressibility, not
convenience — and QUAL-NO-SECOND-BUDGET-TABLE given its Tier-3 record. §3.2's version-bump over-claim
corrected." Then stop.
```

---

### §4.2 — Resolution log (the appendix's required shape)

The appendix in `docs/reviews/session-31-reviewer.md` is written **incrementally, one block per step** — D1
opens it, D2…D9 append their own rows, D10 closes it. It is never assembled at the end from memory.

**Opening block (written at D1, the first step that appends — not at D0, which lands the report untouched):**

```
## CORRECTION PASS (Session 31-D)

**Author:** Session 31-D correction pass · **Date:** 2026-09-10 · **Range fixed:** `55b421ad..<D10-sha>`
**Reviewed head:** `55b421ad` — the head the Reviewer read; nothing had landed after it when D0 ran.
**ADR 0024's own commit:** `<D0-sha>` — the Reviewer's range line could not name it, the ADR having existed
at no commit when the report was written (BLOCKER-2). This statement is the correction; the range line above
it is the Reviewer's and is unedited.
**Everything above this line is the Reviewer's. Everything below it is this pass's.**
```

**Per-finding row shape — every row carries all five fields, and a row missing one is not complete:**

| Field | What it must say |
|---|---|
| **Finding** | The ID, and nothing restated from the Reviewer's text |
| **Fix** | What changed, in one sentence, naming the file |
| **Proof** | The test file **and line** that now proves it — never "covered by the suite" |
| **Reddening** | The exact mutation performed, and that the working tree was confirmed clean afterwards |
| **Commit** | The step's SHA |

**Two rows carry an extra obligation, and must not be written as ordinary rows:**

- **MINOR-8** is the only **recorded-decision** closure in the pass. Its row must state *why no test can
  express the property* (the fresh-migrate stack has no pre-rename rows) — not that writing one was
  inconvenient — and must name the ADR section that now carries the Tier-3 record.
- **NIT-2** is a **closure with a guard**, not a fix: `role` stays inert by decision, and the row must name
  the `scoring.test.ts` case that reddens if a `role` branch ever appears.

**Every step also appends its own "what I did NOT touch" line** where the step had a tempting adjacent
target: D5 (the repo-wide REVOKE sweep — name `purge_business`, `upsert_signal_candidate`,
`get_user_business_ids`), D6 (the constraint was not re-tiered), D7 (`ApprovalsInbox.tsx`'s pre-existing
raw-palette bulk button), D8 (no third CLAUDE.md `any` carve-out). A stated boundary is a decision; an
unstated one is an omission.

---

### §4.3 — Close-out

#### D10 — BLOCKER-1: push the corrected range, run CI green, close Track H

```
CORRECTION — Session 31-D · D10. No specialist. This step's job is not merely to go green: it is to produce
the green runs FOR THE CORRECTED RANGE, which is what turns 29 AUTHORED-NOT-EXECUTED rows into executed-green
rows and makes D9's re-citations true rather than merely updated.

THE DEFECT (BLOCKER-1): `git rev-parse origin/session-30-5-adr-0028` = 05baf1d2; the branch is 13 commits
ahead and HAS NEVER BEEN PUSHED. The newest CI runs on it are pull_request runs dated 2026-09-06, at or
before 05baf1d2 — every run predates H2.1. NO app-tests run, NO db-tests run and NO skip-guard line exists
for any commit in the reviewed range. Under ADR 0015 and CLAUDE.md, "covered" = executed green in CI, never
"authored" — so all 29 rows are AUTHORED-NOT-EXECUTED at 55b421ad, including the 18 Tier-2 rows that need
only a push. The Builder did NOT misreport this: docs/current-phase.md at 55b421ad says "0/29 are
CI-executed-green, because CI has not run." This step is what makes that statement obsolete.

DO:
1. Push D0…D9 to the branch and run every required workflow to green at the corrected head:
   - app-tests (tsc + eslint + vitest) — REQUIRED NOW.
   - db-tests, including THE SKIP-GUARD. If it goes red, OPEN THE RUN and distinguish the two possible
     causes the merge-gate table names — a DB-behaviour regression vs a stack OOM / the known supautils
     SIGSEGV. Do not report a red as "environmental" without reading the log; that judgement is the tech
     lead's until db-tests is promoted, and the evidence must be in the appendix either way.
2. Record, READ FROM THE LOGS rather than assumed:
   - the app-tests run URL and its file/test counts;
   - the db-tests run URL AND the skip-guard's exact file count and test count, QUOTED VERBATIM — a
     supabase/__tests__ file that executed zero tests is a false green with NO override available;
   - which of the 29 constraints are now executed-green, PER TIER. The four Tier-1 rows
     (QUAL-COST-CEILING-EXTENDED — cap half only, per D9's re-tier — QUAL-BUDGET-PURPOSE-ISOLATED,
     QUAL-PRO-DAILY-POST-CAP, QUAL-SCORE-ERASURE) plus D5's new authenticated-denied case stay uncovered
     until db-tests ITSELF is green; say so plainly if it is not.
3. THE db-tests PROMOTION TALLY: it is at 0/3 consecutive green master PUSH runs. A pull_request run NEVER
   moves it. Record the tally in docs/current-phase.md with the event type stated for each run — the rule
   has been misapplied before and the event type is the whole rule.
4. docs/current-phase.md — the Session 31 close-out entry naming this correction pass and its range; the
   real post-correction constraint counts at the head they are dated to, NEVER claimed; the db-tests tally
   per (3); and the before/after mechanism record (1→3 candidates, 2→6 provider calls, ≈4.9¢→≈10¢) kept
   EXACTLY as honest as the Builder left it. THE SESSION STILL CANNOT PROVE THE POSTS ARE BETTER — the
   Reviewer verified that no quality improvement is claimed anywhere in the range and raised no finding.
   Do not let a green CI run become a quality claim: MEASURED, never COVERED.
5. §5 of docs/build-guide/session-31.md — tick off the close-out list, and state EXPLICITLY for each "only
   if" item whether it applied, rather than leaving it ambiguous: whether ADR 0015 changed (it should not
   have — D9's re-tier is recorded IN ADR 0024, not by amending 0015), and whether any legal-surface change
   was needed beyond D9's §D2.5 line.
6. THE APPENDIX'S CLOSING BLOCK in docs/reviews/session-31-reviewer.md: a table of ALL 20 FINDINGS by ID →
   disposition → the test that now proves it → commit SHA. Every ID from the Reviewer's 20-row index appears
   EXACTLY ONCE — re-run the count check §4 opens with, and if it fails, the pass is not closed. State that
   NOTHING WAS DEFERRED, and name the one recorded-decision closure (MINOR-8) and the one closure-with-guard
   (NIT-2) so a reader can find the two rows that are not ordinary fixes. Answer the Reviewer's five "could
   NOT verify" items on the record: (1) CI results now exist — cite them; (2) Tier-1 execution — say what
   db-tests actually ran; (3) reddening demonstrations — this pass performed them, cite the transcripts;
   (4) H2.0's grounding pass — still no artefact, and say so rather than inventing one; (5) whether
   /impeccable ran at H2.12 — it did NOT, which is why D7 exists; record that plainly instead of leaving it
   unanswered. State plainly which of the Reviewer's "What I verified as CORRECT" entries have since changed
   — WITHOUT editing them.
7. .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md per the OpenWolf protocol; log every bug encountered
   during this pass to .wolf/buglog.json.

VERIFY: `git diff <D0-sha>..<D10-sha> -- docs/reviews/session-31-reviewer.md` shows additions BELOW the
appendix marker and NOTHING ELSE — that diff is the mechanical proof of REVIEWER-REPORT APPEND-ONLY, and it
is the one check that cannot be replaced by an assertion. All required workflows green at the corrected head,
or their red explained from the log with the evidence in the appendix.
On commit: "D10 — BLOCKER-1 closed: the 13-commit Builder range plus D0…D9 pushed, app-tests green at <sha>
(<URL>), db-tests <state> (<URL>, skip-guard <n> files / <n> tests quoted from the log); the QUAL-* rows that
are now EXECUTED-green are recorded per tier at the head they are dated to, and the db-tests promotion tally
is stated per run with its event type. The 31-D appendix records all 20 findings — 20 closed, 0 deferred —
with MINOR-8 named as the single recorded-decision closure and NIT-2 as a closure-with-guard, and the diff
proves nothing above the appendix was touched. No quality improvement is claimed: the mechanism record stays
MEASURED, never COVERED. Session 31 Track H closed." Then stop.
```

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
