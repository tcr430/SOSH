# ADR 0024 — Generation quality core: sampling, judging, thinking, conditioning

- **Status:** Accepted
- **Date:** 2026-09-08
- **Session:** 31 / Track H — Architect (H1). Builder is H2; this document is binding input to it.
- **Binding input consumed:** `docs/build-guide/session-31.md` — the Reality block, §0 (Locked L-1..L-11,
  the D-1..D-7 ledger), §0.1 (Q1..Q8) and **§0.2 (Founder adjudications A-1..A-4, CLOSED 2026-09-06)**.
  Where a founder ruling went against H1's recommendation (A-1 only), H1's recommendation is preserved
  below as the named loser and is **not** rewritten.
- **Amends (appended notes, never in place):** ADR 0017 §7 (the hook Tier-2 loop is **removed**, §2.9);
  ADR 0017's `MODE2-HOOK-STANDALONE` (**deliberately retired**, §4.4); ADR 0021 §3.3/§3.4
  (`SIGNAL3-COST-CEILING-ATOMIC`'s table and RPCs are **renamed, and widened by a `purpose` discriminator**
  so triage and generation cannot consume one another's ceiling, §7.5b); ADR 0018 §2.3
  (`post_ai_originals` gains columns, §8.2).
- **Amendment owed by the Builder (H2):** ADR 0010 Amendment 2 §D2.5 — **no new row** (§9), but the
  `signal_triage_budget` row's **table name changes to `ai_budget_daily`** in the same PR as the rename
  migration.
- **Scope reviewed for grounding:** working tree at `session-30-5-adr-0028` `05baf1d2`. Every `file:line`
  below was read at that tree. Citations marked *[advisory]* came from the single three-reviewer advisory
  batch (`ecc:pr-test-analyzer` on Q3/Q8, `ecc:typescript-reviewer` on Q5/Q4, `ecc:code-reviewer` on
  Q1/Q7) rather than from my own read — this ADR does not launder a reviewer's citation as its own.
  Where an advisory finding was **rejected**, §13 records why.

---

## 0. The eight resolved questions (build-guide §0.1 — on the record)

| # | Chosen | Losers (rationale) | Tier |
|---|---|---|---|
| **Q1** — the N-candidate contract | **N = 3**, parallel *within* one post and sequential *across* posts; judged by **N separate `rubricPrompt` calls at `mode:'post'`**, unchanged schema; **argmax on `overall`**, tie-break lowest candidate index; all-N-below-threshold ⇒ **surface the best of the set, flagged**; **replaces** the `generate.ts:277` `openingStrength` retry (§2) | one candidate with a better prompt (more instructions past a point make output *more* generic, D-1); best-of-N with no judge (arbitrary pick, pure cost); **unbounded parallelism** (defeats the rate limiter, §2.2); **fully sequential** (a 12-entry campaign becomes 36 serial round-trips); one multiplexed 3-output rubric call (an output-schema change, forbidden by L-4); all-N-below ⇒ **fail** (breaks a campaign on a quality opinion), **regenerate** (unbounded), **escalate to Opus** (≈5× cost for an unproven lift) | 2 + 3 |
| **Q2** — sampling + thinking as versioned prompt properties | Optional `temperature` and `thinking`, alongside the existing `maxTokens`, **on `Prompt<TInput,TOutput>`** (`lib/ai/prompts/types.ts:5-17`), ADR 0019 §4.5/A-5 precedent. **temperature = 1.0** on the three native-generation ids only (**not** `post-generation` — it has no production caller, §2.5). **thinking = 4,000 tokens on `brief-assembly` only, with its `maxTokens` raised to 12,000 in the same version bump** (§3.3a). Version-bump made **executable** by a Tier-2 frozen-table scan (§3.2) | a global env-var temperature (D-3 — unattributable output history, breaks the eval story); thinking on every prompt (D-7 — pays reasoning cost on `learning-summarizer`, a Haiku classification step, where it buys nothing); leaving ADR C-4 a comment in `models.ts` (a rule that is remembered is a rule that is forgotten) | 2 |
| **Q3** — the ADR 0017 fixture migration | **Zero fixtures move because of sampling.** The build-guide's L-5 premise is **factually false against this repo's harness** — `MockAnthropicClient` routes on `params.model`, `params._sosh.promptId` and `sosh.input.targetPlatform` and never reads `temperature`/`top_p`/`thinking` *[advisory]*. The migration is real but its driver is **tool-use**, not sampling; re-record vs re-shape is decided **per prompt** (§4) | pinning Mode 2 sampling to zero to protect fixtures (D-4 — exempts the main path from the session's purpose); re-shaping *every* fixture to property assertions (loses the byte-diff that catches rendering regressions, §4.3) | 3 |
| **Q4** — task-conditioned retrieval | `MemoryQueryContext` widened by **`role`** and **`campaignId`** only; threaded via a **third optional parameter** on `buildCustomerContext` (campaign-level) plus a **`withPostQueryContext` refinement of the performance slot alone** (per-post). Nine of ten call sites unchanged and byte-identical (§5) | a second context builder (forks `MEM-CONTEXT-EQUIVALENT` and `generate.context-equivalence.test.ts`); a caller-supplied override (puts retrieval policy in ten call sites); re-calling `buildCustomerContext` per post (multiplies the brand/evidence/audience fan-out by entry count for three stores that cannot vary per post); a free-text `topic` field (only useful with a similarity operator, which is L-1 out of scope) | 2 + 3 |
| **Q5** — structured output | **`tool_use` with `tool_choice`**, schema derived at runtime via `z.toJSONSchema(prompt.outputSchema)` — **no hand-written second schema**. **Zod is retained behind the tool schema**, not replaced. First migration: **`learningSummarizerPrompt`** (§6) | a hand-written JSON Schema beside the Zod schema (two schemas drift, and `TOutput` is `z.infer`'d off the Zod one); **replacing** Zod with the tool schema (JSON Schema cannot express `z.strictObject`'s closed shape, `RubricInput`'s discriminated union, or refinements); a big-bang retirement of `extractJsonBlock` (D-5 — nine output paths in one diff, on a path Session 30 proved fails unexpectedly) | 2 + 3 |
| **Q6** — cost, trial caps, rate limits at N | **1 trial post per user-visible generation** (not 3). **N provider calls against the per-minute rate limit** (not 1), with `AI_RATE_LIMIT_POST_GENERATION_PER_MIN` raised **30 → 100**. **One reservation before the fan-out — of one POST, not of worst-case cents** (§7.5a), against ADR 0021's guarded upsert **extended by a `purpose` discriminator, not duplicated** (§7.5b) | charging 3 trial posts (the customer bought posts, not provider calls — a 50-post trial draining 3× faster for identical product output); counting 1 rate-limit unit for 3 calls (a hole through L-9's STEP 2 guard); **per-candidate reservation** (reopens the check-then-call race N-fold, L-6); a second generation-specific ceiling (D-6); **a daily AI-spend ceiling instead of a post cap** (H1's own Q6 recommendation — overridden by founder ruling A-1, §7.4) | 1 + 2 |
| **Q7** — the UX contract | **Losing candidate content is discarded** — never persisted, never shown. **Only the winner's scores persist**, as new columns on `post_ai_originals`. The surface shows the winning post, its `overall`, and a *"3 candidates considered"* badge expanding to the winner's ten-dimension breakdown. Four states. **Below-threshold posts are excluded from bulk approve** (A-3) (§8) | a `post_candidates` table (a new business-scoped table with a full RLS + cascade + `purge_business` obligation, bought for content no one is allowed to publish); `posts.ai_generation_metadata` (an unvalidated JSONB blob carrying recorded debt, session-18b3 M2); showing losing candidates (noise on a fast-triage surface — the trust question is *"why this one"*, which the winner's own breakdown answers) | 1 + 2 |
| **Q8** — the test plan and the proof | **Zero Tier-E constraints.** Every mechanical property is exact-match testable (ADR 0015 Amendment B1.2). **This session cannot prove the posts are better** — there is no generation-quality metric and no generation-quality corpus (§10.4). Interim **instrumentation, logged not gated**: judge self-discrimination margin, and `lib/learning/diff.ts` structural deltas before/after (§10.4) | claiming a quality delta off the triage eval harness (it filters to triage paths; no Session 31 file matches, so it exits `applicable: false`); parking the claim in Tier E (Amendment B(b) — Tier E is not a shortcut around writing a real test, and every property here *is* testable) | 2 + 3 |

**Flags raised to the founder, and their disposition.** Q6 raised A-1 (Pro's *"unlimited posts"* is
unbounded at N=3) and A-2 (the ceiling extension needs a home). Q7 raised A-3 (`bulkApproveDraftPosts` has
no quality predicate). Q2 raised A-4 (thinking on brief assembly adds 8–15s to a user-visible step). All
four were adjudicated on 2026-09-06 and are encoded here. **No eleventh rubric dimension** is required
(L-4 holds). **No new business-scoped table** is required (L-10's explicit-statement branch, §9). **ADR
0017's Stage B brief critique gate is not touched** (§1.1). **No new dependency** is required — `zod`
already ships `z.toJSONSchema`, and the Anthropic SDK's tool machinery is already in use at
`lib/ai/tool-runner.ts:252-258`. **No change to trial-cap accounting a customer can observe** (§7.2).

**One premise correction, flagged and not silently absorbed (L-5).** §0's L-5 asserts that *"changing
sampling changes recorded outputs"* and therefore that fixtures move. Against this repo's harness that is
false (Q3 above, §4.1). L-5's **decision** is untouched — its named loser (pin Mode 2 sampling to zero) is
still rejected, and the migration is still a named deliverable — but its **premise** is corrected, and the
deliverable's actual driver is the Q5 tool-use migration. This is a factual correction to a stated
premise, not a reversal of a Locked decision, so it is recorded here rather than escalated for
adjudication.

---

## 1. Context and decision summary

### 1.1 What is actually wrong — stated precisely, and not one word stronger

Four separate facts, each verified in the tree at `05baf1d2`. None of them is *"generation is ungated."*

1. **The brief IS gated, by the full rubric.** `lib/campaigns/brief.ts:143` `critiqueBrief` runs
   `runPrompt(rubricPrompt, ctx, { mode: 'brief', … })` at `brief.ts:170` over all ten dimensions and
   persists `overall_score`/`critique` atomically with the `draft → critiqued` transition; the hard
   pass/fail is `approveBriefIfQualified`'s, reading the persisted score against
   `BRIEF_QUALITY_THRESHOLD = 70` (`lib/ai/prompts/rubric.ts:19`). **Session 31 does not touch this.**
   Any step that appears to need a change here is an ADR 0017 amendment, and it is flagged, not made.

2. **Posts get a one-dimension, one-shot retry with no re-score.** `lib/campaigns/generate.ts:272` scores
   the *opener only* against `openingStrength`, and at `generate.ts:277` regenerates **once** if it is
   below `BRIEF_QUALITY_THRESHOLD`. The second attempt is **never scored** — the file's own comment at
   `generate.ts:257-260` says so: *"regenerate ONCE if below threshold, no re-score of the second
   attempt."* So the post-level gate is one of ten dimensions, on one sentence, with an unverified
   replacement. That is a gate. It is a thin one. **This is what §2 replaces** — the ADR names the
   mechanism rather than describing the current state as ungated.

3. **There is no sampling parameter and no thinking budget anywhere in `lib/ai/`.** The SDK params
   assembled at `lib/ai/runner.ts:140-156` carry `model`, `system`, `messages` and
   `max_tokens: prompt.maxTokens ?? DEFAULT_MAX_TOKENS` (`runner.ts:149`) — and nothing else. Every call
   in the product samples at provider defaults. **This is the prerequisite that makes N-candidate
   generation coherent at all:** N candidates at the provider default are N near-identical strings, and a
   best-of-N gate over near-identical candidates is pure cost with no quality delta.

4. **The primary retrieval call site passes an empty `queryContext`.** `lib/ai/context.ts:59` calls
   `retrievePerformancePatterns(client, businessId, {})`, and the in-file comment at `context.ts:41-43`
   states the reason plainly: *"No campaign/post-specific queryContext is known at this call site
   (`buildCustomerContext` is business-scoped, not per-post)."* `MemoryQueryContext`
   (`lib/memory/scoring.ts:6-10`) is `{ objective?, platform?, audience? }`; the scope-match term carries
   0.2 of the ranking weight (`lib/memory/constants.ts:9-13`) and, at the main generation call site, it
   does no work at all.

### 1.2 The decision, in one paragraph

Session 31 makes four changes, all inside `lib/ai/` and `lib/campaigns/`, and adds **no new AI surface**
(L-8). Post generation produces **three** candidates at **temperature 1.0**, each scored by the existing
ten-dimension rubric, and the argmax wins — **replacing** the `openingStrength` retry entirely (§2).
Sampling and thinking become **optional, versioned properties of a prompt**, with the version-bump rule
made executable rather than remembered (§3). Retrieval becomes **task-conditioned** through two new
`MemoryQueryContext` fields, threaded by an optional parameter that leaves nine of ten call sites
byte-identical (§5). One prompt migrates to **schema-enforced `tool_use`**, with Zod retained behind it
and `extractJsonBlock` kept for everything else (§6). The cost of all this is bounded by **extending**
ADR 0021's existing atomic per-business daily reservation, not by building a second one (§7).

### 1.3 The D-ledger losers, restated

| # | Chosen | Loser named |
|---|---|---|
| D-1 | N candidates + full-rubric judge | one candidate with a better prompt; best-of-N with no judge |
| D-2 | replace the retry | keep both gates; keep only the retry |
| D-3 | per-prompt versioned sampling | a global env var |
| D-4 | migrate the fixtures | pin Mode 2 sampling to zero |
| D-5 | additive per-prompt structured output | big-bang retirement of `extractJsonBlock` |
| D-6 | extend ADR 0021's ceiling | a second, generation-specific ceiling |
| D-7 | thinking only where the task is strategic | thinking on every prompt |

---

## 2. The N-candidate contract

### 2.1 N = 3, with the arithmetic

`lib/ai/models.ts:4-19` prices `SONNET_4_6` at 300/1500 cents per Mtok and `HAIKU_4_5` at 100/500.
`calculateCostCents` (`models.ts:26-38`) bills cache reads at 10% of input and **ceils to an integer**,
because `ai_usage.cost_cents` is an integer column.

| | provider calls per post | true cost | recorded cost (ceiled per call) |
|---|---|---|---|
| **today (N=1 + 1 opener score)** | 2 | ≈**3.6¢** | ≈**4.9¢** |
| **N=3 + 3 Haiku judge calls** | 6 | ≈**6.7¢** | ≈**10¢** |

The judge is **Haiku**, not Sonnet — `rubricPrompt` already runs on the cheap tier, so tripling the judge
costs ≈1.4¢ true. The dominant term is the two extra Sonnet generations. Note the ceiling effect: a Haiku
judge call at ≈0.48¢ bills as 1¢, so **recorded cost overstates true cost by roughly 2× on cheap calls** —
itself an argument for a reservation ceiling over an `ai_usage` sum (§7.5).

**Why 3 and not 5.** At N=5 true cost is ≈10.9¢/post and recorded ≈16¢; A-1's 15-post/day Pro cap would
then land at €72/mo recorded against €125 revenue — 58%. At N=3 it lands at 36% (§7.4). N=2 gives the
judge only a binary choice, where a single bad draw halves the expected lift. **3 is the smallest N at
which argmax is meaningfully better than a coin flip, at a cost the Pro tier absorbs.**

### 2.2 Parallel within a post, sequential across posts

Candidates for **one** post are issued concurrently. Posts within a campaign remain **sequential**, as
`generate.ts`'s entry loop is today.

- **Fully sequential** is rejected: a 12-entry campaign becomes 36 serial generation round-trips plus 12
  judge round-trips, each carrying `runner.ts`'s retry-sleep budget. The wall-clock is user-hostile.
- **Unbounded parallelism** is rejected, and this is the load-bearing reason: `runner.ts:107` calls
  `countRecentCalls(serviceClient, context.business.id, 60, prompt.id)` **before** the SDK call, while
  `recordAiUsage` writes in the post-call block at `runner.ts:236`. Concurrent calls therefore all read
  the *pre-call* count. **Bounding concurrency to N caps the rate-limit overshoot at N−1 = 2 calls** —
  immaterial once the limit is raised (§7.3). Unbounded fan-out across posts would make the overshoot
  proportional to campaign size, which is a hole through L-9's STEP 2 guard rather than a rounding error.

### 2.3 The partial-failure path — three outcomes, not two

`generate.ts:244-255` today treats a generation failure as terminal for the whole session. At N=3 that is
wrong: two of three succeeding is a success. Three discrete outcomes:

| Outcome | Condition | Behaviour |
|---|---|---|
| **hard fail** | **0** of N candidates generated | session `status: 'failed'`, `error_code` from the last `AiError`, `postsCreated: 0` — the existing `generate.ts:248-254` path, unchanged |
| **unscored** | ≥1 candidate generated, but **every** judge call threw | proceed with candidate index 0, **unscored and ungated**, and emit one structured log line — the backward-compatible extension of `generate.ts:281-292`'s existing swallow-and-continue for a hook-scoring hiccup |
| **scored** | ≥1 candidate generated **and** ≥1 scored | argmax over the scored subset; unscored candidates are not eligible to win |

`QUAL-THREE-OUTCOMES` (Tier 2) pins all three, including the partial-failure sub-case where one of three
generations throws and the remaining two are judged normally.

### 2.4 Temperature, per prompt

**The inventory, stated exactly, because the pre-review version of this table was wrong (§15, MAJOR-2).**
The repo holds **seven** exported `Prompt` objects plus **one factory** that builds three more, giving
**ten concrete prompt ids** — and `formats/policy.ts` and `formats/schemas.ts` are **not** among them
(`policy.ts:15,40` export `validateThreadPolicy`/`validateCarouselPolicy`; `schemas.ts` exports Zod schemas
and types). Neither has an `id`, a `version` or a `modelKey`, so neither can carry a sampling property or a
§3.2 frozen-table row. The ten ids are:

`brand-voice-inference` (`brand-voice-inference.ts:33`), `brief-assembly` (`brief.ts:71`),
`LEARNING_SUMMARIZER_PROMPT_ID` (`learning-summarizer.ts:89`), `post-generation`
(`post-generation.ts:74`), `post-regeneration` (`post-regeneration.ts:36`), `rubric` (`rubric.ts:140`),
`studio-suggestion` (`studio-suggestion.ts:87`), and the three built by
`createNativeGenerationPrompt(family)` (`formats/native-generation-prompt.ts:172-175`):
`native-generation-single` (`:135`), `native-generation-thread` (`:146`),
`native-generation-carousel` (`:157`).

| Prompt id | temperature | Reason |
|---|---|---|
| `native-generation-single`, `native-generation-thread`, `native-generation-carousel` | **1.0** | the candidate-diversity lever; without it N=3 returns three near-identical strings and the judge is decorative |
| `post-generation` | **unset** — see §2.5 | it has **zero production callers** (§2.5); sampling a prompt nothing calls is a version bump bought for nothing |
| every other id — `brief-assembly`, `rubric`, `studio-suggestion`, `post-regeneration`, `brand-voice-inference`, `learning-summarizer` | **unset** | an unset prompt resolves through the same `?? default` shape as `maxTokens` and is **byte-identical to today**. A judge that samples is a judge that disagrees with itself; a classification step that samples is a classification step that misclassifies |

**Native generation is a factory, and that changes what "set temperature 1.0" means.**
`createNativeGenerationPrompt` returns a distinct `Prompt` per family, so `temperature: 1.0` is declared
**once inside the factory** and inherited by all three ids — but the §3.2 frozen table records **three
rows**, one per id, because the version and the model are already per-family (`:136,147,158`). A future
family added to the factory arrives with no frozen row and fails the scan, which is the behaviour we want.

### 2.5 Which prompt families get N candidates

| Family | N? | Reason |
|---|---|---|
| `native-generation-single` / `-thread` / `-carousel` | **yes** | the product's main generation path; the entire point of the session |
| `post-generation` | **no — it is dead code, and the orphan audit is now resolved** | `git grep postGenerationPrompt` returns exactly two hits: its own declaration (`post-generation.ts:73`) and the barrel re-export (`lib/ai/index.ts:4`). **There is no production caller** — `generatePostsForCampaign` drives the native-generation prompt off the frozen brief, as `generate.context-equivalence.test.ts:16-18` already records. Giving N candidates and temperature 1.0 to a prompt nothing calls buys a version bump, a frozen-table row and a fixture obligation for zero product effect (§15, MINOR-2) |
| `post-regeneration` | **no** | the user has already seen a post and asked for a *different* one. Handing them three and picking for them re-decides the thing they just took back from the machine |
| `studio-suggestion` | **no** | inline, latency-sensitive, and already user-selected — the human *is* the judge |
| `brief` | **no** | already gated by the full rubric at `brief.ts:170`. N-candidate briefs would be a **second** gate on one artefact, which is exactly D-2's loser |
| `rubric` | **no** | it *is* the judge. Judging the judge is unbounded |
| `brand-voice-inference` | **no** | a one-shot extraction over user-supplied text; there is no quality axis for argmax to climb |
| `learning-summarizer` | **no** | a Haiku classification step (D-7) |

### 2.6 The judging contract

**N separate calls to the existing `rubricPrompt` at `mode:'post'`.** Not one multiplexed call returning
three score sets — that would change `RubricOutputSchema`, which L-4 forbids and which
`lib/studio/categories.ts` derives from. The three existing callers (`brief.ts:170` `mode:'brief'`,
`generate.ts:272` `mode:'post'`, `lib/signals/triage/card.ts:226` `mode:'card'`) are unaffected;
`QUAL-JUDGE-RUBRIC-UNFORKED` (Tier 2) proves the schema and all three call shapes are untouched.

**Every candidate is `neutralize()`'d before it reaches the judge.** `generate.ts:266-271` already does
this for the single opener, with a recorded reason: the content is *the model's own prior output being fed
back into a second AI call*, the same reused-AI-generated-text shape as `brief.ts`'s narrative/proofPlan.
Dropping it for N-candidate judging would be a silent prompt-injection regression.
`QUAL-CANDIDATE-NEUTRALIZED` (Tier 2) exists specifically because this is the kind of guard a refactor
quietly loses.

**Scored on the full body, not the opener.** Today only `extractOpener(output)` is scored. Judging scores
`joinContent(output)` — the whole post — because nine of the ten dimensions are undefined over a single
sentence.

**Which dimensions decide.** All ten are **requested and persisted**; the selection key is the model's
`overall`. Four dimensions are weak signal for *this* decision and are named and disposed of rather than
silently ignored — L-4 forbids adding, renaming or removing a dimension, and permits ignoring one:

| Dimension | Role in candidate selection |
|---|---|
| `specificity`, `originality`, `audienceRelevance`, `platformNativeness`, `brandVoiceAlignment`, `openingStrength` | **decisive** — these are what vary across candidates drawn from one brief |
| `evidenceSufficiency` | **weak for ranking** — all N candidates draw on the same frozen brief's `pinnedEvidence`, so the score is near-constant across the set. Recorded, not disposed of, because it still gates the *threshold* |
| `unsupportedClaimsRisk` | **weak for ranking, decisive for the threshold** — a candidate can win on style and still be unpublishable |
| `redundancy` | **weak** — scoped to a single post here; the cross-post redundancy check is `generate.ts`'s deterministic consistency pass at `generate.ts:308`, not the rubric |
| `ctaFit` | **decisive where the role carries a CTA**, near-constant otherwise |

The **selection** key is `overall`. Inventing a weighted subset would be a second, unversioned scoring
scheme sitting beside the rubric's own — the same two-gates-on-one-artefact failure D-2 rejects.

### 2.7 Tie-breaking

**Lowest candidate index wins.** Deterministic, testable, and free of a hidden preference. Random
selection is rejected because it makes `QUAL-ARGMAX-DETERMINISTIC` (Tier 2) unassertable, and a
non-reproducible generation is a generation whose complaint cannot be investigated.

### 2.8 All N below threshold

**Surface the best of the set, flagged, and let the human decide.** The post is created, its `overall` is
persisted, and it is marked below-threshold (§8.3). Losers named, each with its reason:

- **fail the session** — breaks a whole campaign on a model's opinion of its own output, and the human
  never sees the near-miss they may well have approved.
- **regenerate** — unbounded by construction. A brief the model cannot clear regenerates forever, and the
  cost ceiling then decides where it stops, which is the worst possible place to put that decision.
- **escalate to Opus** — ≈5× the cost per `models.ts:5-8`, spent on a lift no measurement in this repo can
  currently confirm (§10.4). Revisit when the metric exists.

**This is a real behaviour change and the ADR is honest about it.** A below-threshold post reaches the
approval surface today too — it just arrives silently. After Session 31 it arrives labelled, and per
**A-3** it is **excluded from bulk approve** (§8.4).

### 2.9 This REPLACES the openingStrength retry — and every caller that depended on it

`generate.ts:261-292` — the `let regenerationCount`/`previousContent` block, the `openingStrength`
comparison at `:277`, and the second `generateNativeContent` call at `:279` — is **removed**, not kept
beside the judge (L-3, D-2). Every consumer of the old behaviour, enumerated per **SHARED-FUNCTION
CALLERS**:

| Consumer | Depended on | After |
|---|---|---|
| `generate.ts:296-304` `generated.push({ … regenerationCount, previousContent })` | `regenerationCount ∈ {0,1}` and a nullable `previousContent` | **field retained, always `0` at initial generation.** It is *not* reused as a candidate counter — conflating "the user asked for a regeneration" with "the pipeline generated 3 candidates" would corrupt ADR 0018's learning signal, which keys on `generation_kind` |
| `post_ai_originals.generation_kind` (`20260726010000_learning_capture.sql:34`, `'initial' \| 'regeneration'`) | the retry wrote a second `'initial'` row, not a `'regeneration'` | **unchanged** — exactly one `'initial'` row per post, now for the winning candidate. Losing candidates write **no** row (§8.2) |
| `lib/campaigns/generate.test.ts` hook-loop cases | the retry firing on a low `openingStrength` | **rewritten** against the judging contract; the five cases map forward individually (§4.4) |
| ADR 0017 `MODE2-HOOK-STANDALONE` | the loop existing as a standalone Tier-2 step | **retired**, deliberately and on the record (§4.4) |
| `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:282` (user-initiated regeneration) | nothing — it calls `postRegenerationPrompt`, a **different** prompt on a **different** path | **unchanged.** The user-facing "regenerate" button is not the hook loop and is not touched |

`QUAL-HOOK-RETRY-REMOVED` (Tier 3) is a property of absence: **zero** remaining references to the removed
block, proven by diff, not by a runtime assertion.

**Constraints from §2:** `QUAL-N-CANDIDATE-COUNT`, `QUAL-JUDGE-RUBRIC-UNFORKED`,
`QUAL-CANDIDATE-NEUTRALIZED`, `QUAL-ARGMAX-DETERMINISTIC`, `QUAL-THREE-OUTCOMES`,
`QUAL-BELOW-THRESHOLD-SURFACED` (Tier 2); `QUAL-HOOK-RETRY-REMOVED`, `QUAL-RUBRIC-UNCHANGED` (Tier 3).

---

## 3. Sampling and thinking as versioned prompt properties

### 3.1 Where the parameters are declared

On `Prompt<TInput, TOutput>` (`lib/ai/prompts/types.ts:5-17`), as **optional siblings of the existing
`maxTokens`**. That field already carries the exact precedent, with its rationale in the file:

> `// ADR 0019 §4.5 — founder ruling A-5. Optional; runner.ts:131 reads`
> `// prompt.maxTokens ?? DEFAULT_MAX_TOKENS, so every existing prompt`
> `// (none of which sets this) is UNCHANGED behaviour — proven, not just`
> `// claimed, by STUDIO-RUNNER-DEFAULT-PRESERVED (lib/ai/runner.test.ts).`

`runner.ts:140-156` reads the new fields with the same `??` shape and **omits the SDK field entirely when
unset**, so a prompt that declares nothing produces a byte-identical request to today.
`QUAL-SAMPLING-DEFAULT-PRESERVED` (Tier 2) is the direct sibling of `STUDIO-RUNNER-DEFAULT-PRESERVED` and
proves it across all **ten prompt ids** (§2.4).

**Loser: a global env-var temperature** (D-3). It makes every prompt's output history unattributable —
this repo's whole eval story depends on being able to say *which prompt version produced a number*, and a
process-wide knob erases that.

### 3.2 The version-bump rule, made executable

`lib/ai/models.ts:3` currently states the rule as a **comment**: *"Switching a prompt's model requires
bumping its `version` in the same commit (ADR C-4)."* A comment is a rule that is remembered. L-2 extends
the rule to sampling, and Session 31 makes it **enforced**:

A **Tier-2 frozen-table scan**, on the `lib/ai/prompts/formats/platform-map.frozen-table.test.ts`
precedent: a checked-in table keyed `{id, version}` recording each prompt's
`{ modelKey, temperature, thinking, maxTokens }`. Changing any of those four without bumping that prompt's
`version` in the same commit **fails the test**. Adding a prompt requires a new row.

**The table has exactly ten rows — one per prompt id, not one per file (§2.4, §15 MAJOR-2).**
`formats/policy.ts` and `formats/schemas.ts` get **no row**: they export validators and schemas, not
`Prompt` objects, and have no `id`/`version`/`modelKey` to freeze. The factory-built
`native-generation-{single,thread,carousel}` get **three** rows, because their version and model are
already declared per family (`native-generation-prompt.ts:136,147,158`) even though their `temperature`
is declared once inside the factory. The scan enumerates prompts by walking the exported `Prompt` objects
plus the factory's three families, so **a new prompt or a new family with no row fails**, which is the
whole point of choosing a runtime scan over a diff check.

**Tier 2, not Tier 3.** A Tier-3 diff check can only see the current diff; the frozen table is a runtime
comparison against a recorded baseline and therefore survives a rebase, a squash, and a change split
across two commits. `QUAL-SAMPLING-VERSIONED`.

### 3.3 Thinking budgets — each as a number

| Prompt id | thinking budget | Reason |
|---|---|---|
| `brief-assembly` (`lib/ai/prompts/brief.ts:70-72`) | **4,000 tokens**, and **`maxTokens` raised to 12,000 in the same declaration** (§3.3a) | Stage A brief assembly is the most strategic call in the pipeline and everything downstream is conditioned on its output. **Founder ruling A-4** accepted the latency at the full budget |
| `rubric`, `native-generation-single`, `native-generation-thread`, `native-generation-carousel`, `post-generation`, `post-regeneration`, `studio-suggestion`, `brand-voice-inference`, `learning-summarizer` | **0 (unset)** | D-7. `learning-summarizer` is a Haiku classification step where reasoning tokens buy nothing. **Native generation is excluded deliberately and provisionally** — thinking there interacts with temperature 1.0 in a way no measurement in this repo can currently resolve (§10.4), so it is not guessed at. Revisit when the metric exists |

### 3.3a The thinking budget is drawn FROM max_tokens — brief assembly needs its ceiling raised

**This is a correction applied after review (§15, BLOCKER-1), and it is load-bearing.** A thinking budget is
not additive to `max_tokens`; it is spent out of it. `briefAssemblyPrompt` declares **no** `maxTokens`
(`lib/ai/prompts/brief.ts:70-72` — the only prompt in the repo that declares one is
`studio-suggestion.ts:94`), so it resolves through `runner.ts:149` to `DEFAULT_MAX_TOKENS = 4096`
(`runner.ts:30`). A 4,000-token thinking budget against a 4,096-token ceiling leaves **96 tokens** of
visible output, and every Stage A assembly would fail at `runner.ts:185` with `response_truncated` —
deterministically, on the first call, on the product's most strategic path.

**`briefAssemblyPrompt` therefore declares `maxTokens: 12_000` in the same commit as its `thinking`**:
4,000 reasoning + 8,000 visible, where 8,000 is ~2× today's effective 4,096 ceiling for a brief that
already fits inside it. Both fields are §3.2 frozen-table properties, so this is **one version bump
covering both** — `brief-assembly` goes to `version: 2`.

**Two further consequences of enabling thinking, stated so the Builder does not discover them:**

- **The response's first content block becomes a `thinking` block.** `runner.ts:191`'s
  `response.content.find(b => b.type === 'text')` already searches rather than indexing, so it survives —
  but it survives *by luck*, and `QUAL-THINKING-BUDGETED` asserts it deliberately: a `thinking` block
  followed by a `text` block parses exactly as today. This is the same parse path Q5's tool-use migration
  widens (§6.4), and both changes land in it.
- **`temperature` and `thinking` are mutually constrained by the provider.** With thinking enabled,
  temperature may not be set to a non-default value. §2.4 sets temperature **only** on the
  native-generation families and `post-generation`, and §3.3 sets thinking **only** on `brief-assembly`,
  so the two sets are disjoint and no call carries both. **That disjointness is now a constraint, not a
  coincidence:** `QUAL-THINKING-BUDGETED` asserts that no prompt declares both `temperature` and
  `thinking`, so a future prompt cannot acquire the pair silently.

### 3.4 Expected latency change, per affected surface

| Surface | Change | Mitigation |
|---|---|---|
| **Brief assembly** (`lib/campaigns/brief.ts` Stage A) | **+8–15s** on a user-visible step | A-4: accepted. Already runs async behind `after()`. **The Builder owes a progress state that sets the expectation** — a spinner with no copy is not the contract |
| **Campaign post generation** (`generate.ts` entry loop) | **≈unchanged per post.** Candidates are concurrent, so the added wall-clock is one Haiku judge round-trip (short output), not 3× the generation. Sequential across posts is unchanged | none needed |
| **Studio suggestions**, **user regeneration**, **brand-voice inference**, **triage** | **zero** — no sampling, no thinking, no N | n/a |

**Constraints from §3:** `QUAL-SAMPLING-VERSIONED`, `QUAL-SAMPLING-DEFAULT-PRESERVED`,
`QUAL-THINKING-BUDGETED` (all Tier 2).

---

## 4. The ADR 0017 fixture migration

### 4.1 The premise the build guide inherited is false — and that is the finding

L-5 assumes sampling changes recorded outputs, therefore fixtures move. Against this repo's harness it
does not. `MockAnthropicClient` (**`lib/ai/client.ts:49-88`** — there is no `lib/ai/__mocks__/` directory;
the pre-review path was wrong, §15 MINOR-1) routes **only** on `params.model`, `params._sosh.promptId` and
`sosh.input.targetPlatform` (`client.ts:55-75`). `temperature`, `top_p` and `thinking` never touch routing
and never touch the returned JSON *[advisory]*.

**Zero fixtures move because of sampling.** An ADR that claimed otherwise would be describing a different
repository. The migration is still real — its driver is the Q5 tool-use change, which alters the
*transport* of the response, not its content.

### 4.2 Inventory

`lib/ai/__fixtures__/` holds **15** files:

| Path | Count | Disposition |
|---|---|---|
| `brand-voice-inference.json` | 1 | **unchanged** — not sampled, not tool-migrated |
| `claude-opus-4-7.json` | 1 | **unchanged** — a model-identity fixture |
| `post-generation/{linkedin,twitter,instagram,facebook,threads}.json` | 5 | **audit resolved, and the answer is "keep them" (§15, MINOR-2).** The audit is done and recorded here rather than deferred to the Builder: `postGenerationPrompt` has **no production caller** (§2.5). But the fixtures are **not deleted in Session 31** — `lib/ai/client.ts:61-67` routes `_sosh.promptId === 'post-generation'` to this exact directory, so deleting them converts any future or test call into a hard `MockAnthropicClient: fixture not found` throw. **Prompt and fixtures live or die together, and that removal is a cleanup with its own diff** — filed as `31-DEAD-POST-GENERATION-PROMPT` in `docs/backlog.md`. Session 31 touches neither |
| `studio-suggestion/*.json` | 8 | **unchanged** — Studio takes no N, no temperature, no thinking and no tool-use this session |

**Fixtures re-recorded in Session 31: 0.** `learningSummarizerPrompt` — the first tool-use migration
(§6.2) — has **no fixture** today, which is one of the reasons it was chosen.

### 4.3 Re-record vs re-shape, decided per prompt

- **Text-based prompts stay byte-exact.** A byte-diff catches rendering regressions — a lost newline, a
  reordered evidence block, a dropped `[DATA]` wrapper — that a property assertion silently passes.
- **Tool-use-migrated prompts move to property-shaped assertions.** Under `tool_use` the response body is
  a structured `input` object, not a text block; the byte-exact string no longer exists to compare.

**What is lost, stated explicitly.** For any prompt that later migrates to tool-use, the byte-exact
assertion is gone, and with it the ability to catch a *formatting* regression in the rendered payload —
property tests assert shape and content, not layout. The mitigation is that a tool-use payload has no
layout to regress: the SDK, not the prompt, serialises it. **This is a real reduction in coverage and it
is recorded as one**, not argued away. Session 31 spends it on exactly one background prompt with no user
surface, which is the cheapest possible place to spend it *[advisory]*.

### 4.4 Every MODE2-* constraint, after the move

ADR 0017 names **21** `MODE2-*` constraints. Thirteen are Tier-1 DB-behaviour (RLS, cascade, atomic
transitions, write-once) and are **not touched by any Session 31 change** — no migration in this session
alters a Mode 2 table.

| Constraint | Still holds? | Test that proves it AFTER the move |
|---|---|---|
| `MODE2-BRIEF-FROZEN` | yes | `supabase/__tests__` Tier-1 — untouched |
| `MODE2-BRIEF-FROZEN-GUARD` | yes | Tier-1 — untouched |
| `MODE2-BRIEF-RLS-ISOLATED` | yes | Tier-1 — untouched |
| `MODE2-BRIEF-STATE-ATOMIC` | yes | Tier-1 — untouched |
| `MODE2-BRIEF-CASCADE-COMPLETE` | yes | Tier-1 — untouched |
| `MODE2-ACTIVATE-GUARD-MIGRATED` | yes | Tier-1 — untouched |
| `MODE2-ROLE-WRITE-ONCE` | yes | Tier-1 — untouched |
| `MODE2-ORIGIN-ROLE-BACKFILL` | yes | Tier-1 — untouched |
| `MODE2-BRIEF-BEFORE-COPY` | yes | Tier-1 — untouched |
| `MODE2-CRITIQUE-GATE` | yes | `lib/campaigns/brief.test.ts` — §1.1(1): the Stage B gate is not touched |
| `MODE2-RUBRIC-SHARED` | yes, **strengthened** | `lib/ai/prompts/rubric.test.ts` + `QUAL-JUDGE-RUBRIC-UNFORKED`. The judge is a **fourth** consumer of the same unforked prompt |
| `MODE2-EVIDENCE-DATA-GUARDED` | yes | `brief.test.ts` + `QUAL-CANDIDATE-NEUTRALIZED`, which extends the same posture to N candidates |
| `MODE2-CONTEXT-EQUIVALENT` | yes | `lib/campaigns/generate.context-equivalence.test.ts:279-345` — **the file Q4 must not break** (§5.4) |
| `MODE2-MEMORY-WIRED` | yes | `generate.context-equivalence.test.ts:322,331` — conditioning changes *what fills* the slots, never the caps (§5.6) |
| `MODE2-REDUNDANCY-UNDEFER` | yes | `generate.test.ts` consistency-pass cases — `generate.ts:308` untouched |
| `MODE2-ROLE-COVERAGE` | yes | `generate.test.ts` — `checkRoleCoverage` against the frozen `roleSequence`, untouched |
| `MODE2-LINK-PLACEMENT` | yes | `lib/ai/prompts/formats/policy.test.ts` — untouched |
| `MODE2-THREAD-GUARDRAILS` | yes | `lib/ai/prompts/formats/schemas.test.ts` — untouched |
| `MODE2-FORMAT-FAMILY-STRUCTURAL` | yes | `platform-map.frozen-table.test.ts` — untouched, and now **extended** by the §3.2 prompt-property frozen table on the same precedent |
| `MODE2-NATIVE-RETRY` | yes, **unrelated** | the retry it names is `runner.ts`'s transport retry, not the hook loop; `lib/ai/runner.test.ts` — untouched |
| `MODE2-HOOK-STANDALONE` | **NO — deliberately retired** | see below |

**`MODE2-HOOK-STANDALONE` is retired on the record.** It asserts the existence of the standalone
`openingStrength` hook loop, which L-3 removes. A constraint whose subject no longer exists cannot "still
hold", and quietly leaving it green in the ADR 0017 table would be a false green. Its **five** test cases
map forward individually rather than being deleted:

| Old `MODE2-HOOK-STANDALONE` case | Maps forward to |
|---|---|
| opener scored against the rubric | `QUAL-JUDGE-RUBRIC-UNFORKED` |
| regeneration fires below threshold | `QUAL-BELOW-THRESHOLD-SURFACED` (no regeneration; flagged instead) |
| regeneration fires at most once | `QUAL-N-CANDIDATE-COUNT` (exactly N, bounded by construction) |
| a scoring failure does not abort a successful generation | `QUAL-THREE-OUTCOMES` (the *unscored* outcome) |
| opener is `neutralize()`'d before scoring | `QUAL-CANDIDATE-NEUTRALIZED` |

`QUAL-MODE2-FIXTURES-MIGRATED` (Tier 3) is a property of absence covering both halves: **no fixture is
re-recorded for sampling reasons**, and **the orphan audit's outcome is recorded in the PR** — a deleted
fixture with no recorded audit is indistinguishable from a fixture someone found inconvenient.

### 4.5 Advisory findings folded in (ecc:pr-test-analyzer, Q3)

Three blockers, all **accepted**:

1. **Tool-use breaks the runner before fixtures matter.** `runner.ts:191` does
   `response.content.find(b => b.type === 'text')`; a `tool_use` response yields `rawText = ''` and
   `safeParseOrAiError` fails on the empty string. **This is a hard prerequisite of Q5**, and §6.4 makes
   it an ordered Builder step rather than a mid-build discovery.
2. **The mock is candidate-blind.** Three calls return byte-identical JSON, so every argmax is a 3-way tie
   and the judge is untestable. **Accepted as a named test-harness deliverable**: the mock must be able to
   return a *sequence* of distinct payloads for one `promptId`, or `QUAL-ARGMAX-DETERMINISTIC` and
   `QUAL-BELOW-THRESHOLD-SURFACED` are `AUTHORED-NOT-EXECUTED` by construction.
3. **`__evalCassetteQueue` (`lib/ai/client.ts:38-41` declaration, `:55-56` the `shift()`) is a single
   global FIFO.** Its lifecycle becomes a **named test-authoring constraint** in the Builder's steps, not a
   silent assumption — a test that leaves the queue non-empty poisons the next file. **It is also the
   answer to blocker 2**: a FIFO of distinct payloads for one `promptId` is exactly the "sequence of
   distinct payloads" the argmax tests need, so the deliverable is to give it a scoped
   set-up/tear-down helper, not to build a second mechanism beside it.

**Constraint from §4:** `QUAL-MODE2-FIXTURES-MIGRATED` (Tier 3).

---

## 5. Task-conditioned retrieval

### 5.1 The widened MemoryQueryContext, field by field

`lib/memory/scoring.ts:6-10` today:

| Field | Status | Reason |
|---|---|---|
| `objective?: string` | **existing — now actually populated** | known at every generation call site from the campaign; today it is dropped on the floor |
| `platform?: string` | **existing — now actually populated per post** | the single strongest discriminator for `performance_memory`, and the reason `platformNativeness` exists at all |
| `audience?: string` | **existing — now actually populated** | known from the business profile; already in `CustomerContext` |
| `role?: string` | **ADDED** | the post's role in the frozen `roleSequence` (`generate.ts:303`). Already in hand at the call site, costs nothing to thread, and is the strongest task discriminator *within* one campaign |
| `campaignId?: string` | **ADDED** | makes the existing 0.2 scope-match weight (`lib/memory/constants.ts:9-13`) do work it currently cannot: `scopeMatch` already understands `scope='campaign'` via `scope_ref`, but nothing ever supplies the ref |

**Deliberately NOT added:**

| Field | Why not |
|---|---|
| `topic` (free text) | only useful with a similarity operator. Embeddings are **out of scope here** (L-1, §12.1). A free-text field with no similarity operator can only be substring-matched, which is worse than nothing because it looks like it works |
| `format` (`'single' \| 'thread'`) | no memory record carries a format dimension. There is nothing to match against |
| `timeWindow` | recency already decays exponentially at a 30-day half-life (`scoring.ts:24-30`). A second time control is two knobs on one axis that can disagree |
| `confidenceFloor` | confidence is already 0.5 of the score (`constants.ts:9-13`). A floor is a **cap** change, and caps are out of scope (L-1, Reality §7) |
| `contactId` | `relationship_memory` is parked until the engagement inbox ships (CLAUDE.md) |

### 5.2 How task context reaches a business-scoped builder — the real design problem

`lib/ai/context.ts:41-43` states the problem in its own words: *"No campaign/post-specific queryContext is
known at this call site (`buildCustomerContext` is business-scoped, not per-post)."*

Two seams, because there are genuinely two granularities:

**(a) Campaign-level — a third optional parameter.** `buildCustomerContext(businessId, voiceVariationId?,
queryContext?: MemoryQueryContext = {})`. It mirrors the existing optional `voiceVariationId` and the
`maxTokens ?? DEFAULT` shape exactly. **Any caller that does not pass it produces the identical call it
produces today**, including the literal `{}` at `context.ts:59`.

**(b) Per-post — `withPostQueryContext(ctx, { platform, role })`.** A new `lib/ai/context.ts` export that
re-runs **`retrievePerformancePatterns` only** and returns a shallow-copied `CustomerContext` with the
performance slot replaced. Brand, evidence, audience and voice are **not** re-read: they cannot vary per
post within one campaign, and re-reading them would be pure cost.

**Losers named:**

- **A second context builder.** Forks the `MEM-CONTEXT-EQUIVALENT` invariant and would require forking
  `generate.context-equivalence.test.ts` with it. Two builders is how two behaviours diverge.
- **A caller-supplied override object.** Puts retrieval *policy* in ten call sites, which is precisely
  what `MEM-NO-DIRECT-TABLE-ACCESS` and `/lib/memory/` exist to prevent.
- **Re-calling `buildCustomerContext` per post.** Multiplies the brand/evidence/audience fan-out by the
  campaign's entry count, for three stores whose contents cannot change between two posts of one campaign.

**Cost of (b):** one extra `lib/memory` **database** read per post — no extra AI call — bounded by
`PERFORMANCE_CAP = 3`. *[advisory: `ecc:typescript-reviewer` proposed threading a per-post context through
`buildCustomerContext` itself; rejected here for the fan-out reason above, and the narrower refinement
adopted instead — see §13.]*

### 5.3 The service-role acquisition is unchanged

`context.ts:35-37` lazy-imports `createServiceRoleClient` per CLAUDE.md's pattern, inside a
`buildCustomerContext` that takes no `client` parameter. **Conditioning changes what is asked for, never
who asks.** `withPostQueryContext` acquires its client the same way and takes no client parameter either —
adding one would let a caller pass an authenticated client into a service-role read path and get silent
permission failures. `QUAL-SERVICE-ROLE-UNWIDENED` (Tier 3) is a property of absence: no new
`createServiceRoleClient` call site outside `lib/ai/context.ts`, and no `client` parameter added to either
function.

### 5.4 SHARED-FUNCTION CALLERS — `buildCustomerContext`

**Ten production call sites across nine files** (`lib/campaigns/brief.ts` holds two). The count is stated
both ways deliberately: a per-*file* count is exactly how the Session 22 blockers were missed. **Nine of
the ten pass no `queryContext` and are byte-identical to today.**

| # | Call site | Passes queryContext? | Test that covers it |
|---|---|---|---|
| 1 | `lib/campaigns/generate.ts:176` | **YES** — `{ objective, audience, campaignId }` | `lib/campaigns/generate.context-equivalence.test.ts:279-345` (`MODE2-CONTEXT-EQUIVALENT`) + `QUAL-QUERY-CONDITIONED` |
| 2 | `lib/campaigns/brief.ts:111` (Stage A assembly) | no | `lib/campaigns/brief.test.ts` |
| 3 | `lib/campaigns/brief.ts:160` (Stage B critique) | no | `lib/campaigns/brief.test.ts` |
| 4 | `lib/learning/summarize.ts:156` | no | `lib/learning/summarize.test.ts:268-277` |
| 5 | `lib/signals/triage/orchestrator.ts:125` | no | `lib/signals/triage/orchestrator.test.ts` |
| 6 | `app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts:44` | no | `app/[locale]/(dashboard)/context-callers.context-equivalence.test.ts` |
| 7 | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:282` | no | `posts/actions.context-equivalence.test.ts` + `posts/actions.test.ts` |
| 8 | `app/[locale]/(dashboard)/onboarding/infer-brand-voice/actions.ts:27` | no | `context-callers.context-equivalence.test.ts` |
| 9 | `app/[locale]/(dashboard)/settings/voice/refine-from-posts-action.ts:42` | no | `refine-from-posts-action.test.ts:90` |
| 10 | `app/[locale]/(dashboard)/studio/actions.ts:133` | no | `app/[locale]/(dashboard)/studio/actions.test.ts:82` |

`QUAL-CONTEXT-CALLERS-UNCHANGED` (Tier 2) asserts, **per call site**, that the arguments and the resulting
`CustomerContext` are unchanged for the nine that pass no `queryContext`. A call site with no listed test
is `AUTHORED-NOT-EXECUTED` for that call site even if another is fully covered.

### 5.5 SHARED-FUNCTION CALLERS — `retrievePerformancePatterns` and `retrieveVoice`

| Function | Production caller | Passes new fields? | Test |
|---|---|---|---|
| `retrievePerformancePatterns` (`lib/memory/index.ts:19`, aliasing `retrieveRelevant`) | `lib/ai/context.ts:59` | **YES** — the campaign-level context, and again from `withPostQueryContext` | `lib/memory/performance.test.ts` + `QUAL-QUERY-CONDITIONED` |
| | Studio's own path (`lib/memory/performance.ts:100-102` documents it) | no — Studio already builds its own platform-scoped context | `lib/memory/performance.test.ts` |
| | `lib/signals/triage/tools.ts:22` | **not a caller** — deliberately excluded, recorded in the file | `lib/signals/source-scans.test.ts` |
| `retrieveVoice` (`lib/memory/voice.ts:22`) | `lib/ai/context.ts:57` | **no** — voice reads through `brand_voices`/`brand_voice_variations` and takes no query context (`MEM-VOICE-THROUGH-EXISTING`) | `lib/ai/context.test.ts:394-438` |
| | `lib/learning/orchestrator.ts:240` | no | the `lib/learning/orchestrator` suite |

**No existing caller's behaviour changes.** Every added field is optional; an omitted field scores exactly
as it does today, because `scopeMatch` already treats an absent field as a non-match rather than a
mismatch.

### 5.6 Out of scope, explicitly (L-1)

**Caps are unchanged.** `BRAND_CAP = 5`, `EVIDENCE_CAP = 5`, `AUDIENCE_CAP = 5`, `PERFORMANCE_CAP = 3`
(`lib/memory/constants.ts:17-20`) — a prompt still receives at most 18 memory records. Conditioning
changes **what fills the slots**, not how many there are.

**Cross-type retrieval is out of scope.** Ranking a brand fact against an audience fact on one scale is a
later session (§12.5).

**Constraints from §5:** `QUAL-QUERY-CONDITIONED`, `QUAL-CONTEXT-CALLERS-UNCHANGED` (Tier 2);
`QUAL-SERVICE-ROLE-UNWIDENED` (Tier 3).

---

## 6. Structured output

### 6.1 The schema shape

**`tool_use` with `tool_choice`**, on the machinery already present at `lib/ai/tool-runner.ts:252-258`
(`anthropicTools` built from `{ name, description, input_schema }`) and `:320-322` (`tools` +
`tool_choice` passed into the SDK params). `runPrompt` derives the tool's `input_schema` at runtime from
the prompt's existing Zod schema — `z.toJSONSchema(prompt.outputSchema)` — so **there is exactly one
schema object in the codebase per prompt**.

**Loser: a hand-written JSON Schema beside the Zod schema.** Two schemas drift; the type is `z.infer`'d
off one of them, so the drift is silent until production.

### 6.2 First prompt to migrate, and why

**`learningSummarizerPrompt`** (`lib/ai/prompts/learning-summarizer.ts`). It is the cheapest possible
failure to observe:

- it runs in a **background worker** (`lib/learning/orchestrator.ts`), behind no user-visible surface;
- it has **zero `MODE2-*` constraints** riding on it;
- it has **no fixture** (§4.2), so the §4.3 coverage loss costs nothing here;
- it is a **Haiku** call, so an iteration during migration is nearly free.

Native generation is **wave 2**, deliberately: it migrates only once tool-use parsing is proven in
production on a path where a bad day costs a delayed learning summary, not a customer's campaign.

### 6.3 Zod's position — retained behind the schema, not replaced

**Retained.** *[advisory: `ecc:typescript-reviewer`, conclusion accepted; two of its three reasons
**rejected on verification** — §15, MAJOR-3.]*

**What was checked, and what it returned.** Run against the installed `zod@4.3.6`:

- `z.toJSONSchema(z.strictObject({ a: z.string() }))` → `…"additionalProperties": false`. JSON Schema
  **does** express the closed shape.
- `z.toJSONSchema(z.discriminatedUnion('mode', […]))` → `oneOf` with `const` discriminants. It **does**
  express the union.
- `z.toJSONSchema(z.string().refine(…))` → `{"type":"string"}`. The refinement is **silently dropped**.

So the two reasons the pre-review draft called *"independently sufficient"* were both false, and one of
them cited `RubricInput` — an **input** schema, which `z.toJSONSchema(prompt.outputSchema)` never touches.
The conclusion survives on the two reasons that are real:

1. **Refinements vanish.** Anything a schema enforces beyond its structural shape — a length bound, a
   cross-field rule, a `.refine` — exists in Zod and nowhere in the emitted JSON Schema. A tool schema
   alone would accept output the program considers invalid.
2. **`TOutput` is `z.infer`'d off `prompt.outputSchema`** (`lib/ai/prompts/types.ts:9`). Replacing Zod with
   the tool schema removes the *type*, not just the runtime check — every `runPrompt` caller loses its
   return type.

The tool schema constrains what the *model* may emit; Zod validates what the *program* accepts. They are
belt and braces because they guard different failures.

### 6.4 The malformed-tool-call error path

**`AiError('invalid_response')` — the same error the text path throws today** (`runner.ts:196-200`,
`parsers.ts:63-75`). No caller changes, because no caller can distinguish the two cases and none should.
Covered:

- provider returns **no** `tool_use` block → `invalid_response`;
- provider returns a `tool_use` block whose `input` fails Zod → `invalid_response` carrying the Zod
  message, exactly as `safeParseOrAiError` does today;
- provider returns **both** a text block and a `tool_use` block → the `tool_use` block wins, and a
  structured log line records the mixed response.

**The runner's parse path is an ordered prerequisite** (§4.5, blocker 1): `runner.ts:191`'s
`content.find(b => b.type === 'text')` must learn about `tool_use` **before** any prompt declares a tool,
or the first migrated prompt returns `rawText = ''` and fails on every call.
`QUAL-MALFORMED-TOOL-CALL` (Tier 2).

### 6.5 What extractJsonBlock still owns, and when it may be deleted

**After Session 31 it owns nine of the ten prompt ids** (§2.4) — every prompt except
`learningSummarizerPrompt` — plus `lib/ai/tool-runner.ts:445`'s
`safeParseOrAiError(TriageDecisionSchema, rawText)`, which parses a *text* decision at the end of the
triage loop and is **not** part of this migration. `QUAL-PARSER-RETAINED` (Tier 3) is a property of
absence: `extractJsonBlock` still exists and is still exercised.

**The named condition for its deletion, recorded now so a future session knows when it has earned the
removal:**

> `extractJsonBlock` may be deleted when **every** `Prompt` in `lib/ai/prompts/` declares a tool schema
> **and** `lib/ai/tool-runner.ts`'s final decision parse is tool-based — i.e. when a repository-wide grep
> for `safeParseOrAiError` returns only tool-path call sites — **and** at least one full release cycle has
> passed with no `invalid_response` attributable to a tool-call parse. The second clause is not ceremony:
> Session 30's production bug was in exactly this path, and the fallback is what made it a bug report
> rather than an outage.

**Constraints from §6:** `QUAL-STRUCTURED-OUTPUT`, `QUAL-MALFORMED-TOOL-CALL` (Tier 2);
`QUAL-PARSER-RETAINED` (Tier 3).

---

## 7. Cost, trial caps and rate limits at N

### 7.1 The guard ordering survives, unchanged (L-9)

`runner.ts:92-112`: **STEP 1** trial-cap check (`quota_exceeded`), **STEP 2** rate-limit check
(`rate_limited`, via `countRecentCalls`), **STEP 3** message assembly with the
`CACHE_CONTROL_CHAR_THRESHOLD` decision (`runner.ts:29,117`). Session 31 **reorders nothing, bypasses
nothing, and adds no fourth step inside `runPrompt`.** The new reservation sits **outside and above**
`runPrompt`, in `generate.ts`, before the fan-out. `QUAL-GUARD-ORDER-PRESERVED` (Tier 2).

### 7.2 Trial units: ONE per user-visible generation, not three

**One.** `AI_TRIAL_POST_CAP = 50` (`lib/config.ts:39`) is a promise about **posts**, and the customer's
product outcome at N=3 is one post.

**And it is already true by construction — this constraint costs no production code (§15, MINOR-3).**
`runner.ts:217` skips the per-call increment for both `isPostGeneration(prompt.id)` and
`isScoringOnly(prompt.id)` (R-1, ADR 0004), with the second predicate added by the Session B2.6 BLOCKER
fix precisely so a scoring call never consumes post quota; the orchestrator batch-increments **once** after
insert. So N generation calls and N judge calls all skip the counter, and the single post-insert increment
is untouched by anything in this session. **`QUAL-TRIAL-UNIT-PER-POST` is therefore a regression test over
those two predicates, not a new mechanism** — and the Builder's obligation is the negative one: neither
predicate may be narrowed, and the batch increment stays at one per inserted post.

**Loser: charging N.** A trial user watching a 50-post allowance drain three times faster for identical
product output is a customer-observable degradation with no customer-visible cause. It is the kind of
change that reads as a bug report, not as a pricing decision.

**Consequence, stated:** the trial's true AI cost roughly doubles — 50 posts × ≈10¢ recorded ≈ **500¢
(€5)** per trial, up from ≈245¢. That is the price of the trial, and it is bounded by construction.
`QUAL-TRIAL-UNIT-PER-POST` (Tier 2).

### 7.3 Rate limit: N units, not one — and the limit is raised

**N.** `countRecentCalls` counts **provider calls**, and three generations plus three judge calls *are*
six provider calls. Counting them as one would be a hole through the STEP 2 guard, which L-9 forbids.

At N=3 the existing default is insufficient: a 12-entry campaign issues 36 generation calls plus 12 judge
calls, against `AI_RATE_LIMIT_POST_GENERATION_PER_MIN = 30` (`lib/config.ts:37`) — it dies mid-run with
`rate_limited`. **Default raised 30 → 100**, via `lib/config.ts` per L-11 (never `process.env` directly).
The judge runs under `rubricPrompt`'s own prompt id, so it is counted separately by
`countRecentCalls(…, prompt.id)`; the 100 covers generation calls.

**Loser: counting one unit for N calls.** `QUAL-RATE-LIMIT-COUNTS-CALLS` (Tier 2).

### 7.4 The daily ceiling, in literal cents, per plan tier

Per-post recorded cost at N=3: **≈10¢** (§2.1).

| Tier | Volume bound | Recorded cents/day | Recorded €/month | True €/month | % of revenue (recorded) |
|---|---|---|---|---|---|
| **Trial** (14 days) | 50 posts total, 1 campaign | — | **€5 total** | ≈€3.35 total | n/a |
| **Plus** (€79/mo) | 250 posts/month ⇒ ≈8.3/day | **≈83¢/day** | **≈€25** | ≈€17 | **32%** |
| **Pro** (€125/mo) | **15 posts/day** (A-1) | **150¢/day** | **€45** | ≈€30 | **36%** |

**The Pro cap is 15 posts/day/business** — founder ruling A-1, **against H1's own recommendation**. H1
recommended a daily **AI-spend** ceiling precisely so that *"unlimited posts"* stayed marketing-true; the
founder ruled for a **post-count** cap on the grounds that a post cap is legible to the customer where a
spend cap is not. H1's recommendation is the named loser and is preserved here, not rewritten.

15/day = 450/month, which sits at **1.8× Plus's 250-post monthly cap**, so "unlimited" degrades gracefully
rather than landing below the cheaper tier. **The founder may override the number in one line without
reopening the ruling** — the ADR fixes the mechanism, not the constant, and the constant lives in
`lib/config.ts` as **`AI_PRO_DAILY_POST_CAP`, default 15** (L-11: never `process.env` directly, and the
sibling of `TRIAGE_DAILY_CAP_CENTS` at `lib/config.ts:85`).

**Which tiers the daily reservation applies to — named, because "15/day" alone does not say (§15,
MAJOR-1).**

| Tier | Daily post reservation? | What actually bounds it |
|---|---|---|
| **Pro** | **YES** — `AI_PRO_DAILY_POST_CAP = 15`, enforced by the §7.5 reservation | the A-1 ruling |
| **Plus** | **no** | its existing 250-posts/month product bound. A-1 ruled on Pro's *"unlimited"*; Plus is already a finite number and inventing a second daily bound for it would be an unruled pricing change |
| **Trial** | **no** | `AI_TRIAL_POST_CAP = 50` total, already enforced at `runner.ts:96-99` STEP 1 — a *different* guard, in a different place, and §7.1 leaves it exactly where it is |

**The cap's user-facing behaviour is specified, not left to the Builder.** A denied reservation surfaces as
`AiError('quota_exceeded')` — the code that already exists (`runner.ts:94`) — carrying a **distinct
message from the trial cap**, and the surface renders a *"daily generation limit reached — resets at
00:00 UTC"* string in **en/pt/es**. The reset hour is not a detail: the RPC pins `day` server-side as
`(now() AT TIME ZONE 'utc')::date` (`20260807110000_mode3_triage_state.sql:145`), so there is exactly one
answer to *"when does my quota come back"* and the copy states it.

> ⚠️ **Copy obligation, tracked and NOT a Builder task.** CLAUDE.md's Locked pricing says Pro is
> *"unlimited posts"*. A-1 makes that false. Before launch, the pricing line and every marketing surface
> must read *"unlimited campaigns; fair-use daily post limit"* or equivalent. Recorded as
> `31-A1-PRICING-COPY` in `docs/backlog.md` §1. **Shipping A-1 without the copy change is a
> customer-facing misrepresentation.** `QUAL-PRO-DAILY-POST-CAP` (Tier 1).

### 7.5 Enforcement BEFORE the fan-out, atomically

**The failure mode being designed against is the check-then-call race**, named as such by ADR 0021's
`SIGNAL3-COST-CEILING-ATOMIC`: a `SELECT` of today's spend, then a decision, then a call, is three steps —
and two concurrent generations that both read the pre-call total both proceed. At N the race is not merely
reproduced, it is amplified: one lost race spends **6** provider calls, not 1.

**One reservation, before the fan-out.** **Not** one reservation per candidate: per-candidate reservation
reopens the race N-fold *inside* a single generation, which is L-6's explicit loser.

#### 7.5a What generation reserves: POSTS, not cents

**This replaces the pre-review design, which reserved worst-case cents for generation (§15, BLOCKER-2 and
MAJOR-1).** That design had two defects, and one change fixes both.

A-1's ceiling is a **post count**. A cents reservation cannot enforce a post count, so the pre-review ADR
promised a Tier-1 test (`QUAL-PRO-DAILY-POST-CAP`) for a mechanism it never specified. And because per-post
recorded cost is bounded at ≈10¢ (§2.1), **a 15-post/day cap *is* a 150¢/day spend ceiling** — the €45/mo
figure in §7.4's table is now **derived from the post cap, not separately enforced**.

So: **generation reserves exactly one unit — one post — before the fan-out**, against
`AI_PRO_DAILY_POST_CAP`. One reservation, one unit, one round trip, and the thing reserved is the thing the
founder ruled on. A generation that hard-fails (§2.3, 0 of N candidates) **releases its unit** through the
existing reconcile RPC; a generation that succeeds keeps it, whether it produced 3 candidates or 1.

**Loser: reserving worst-case cents for generation.** It enforces a ceiling nobody ruled on, in a unit the
customer cannot see, while leaving the ceiling that *was* ruled on unenforced — and it forces a
reconciliation step whose only purpose is to correct an estimate that the post cap makes unnecessary.

#### 7.5b One mechanism, two purposes — the discriminator is mandatory

**ADR 0021's mechanism is EXTENDED, not duplicated** (D-6), per founder ruling **A-2**. But extension is
not the same as sharing a counter, and the pre-review ADR's *"the reservation semantics are unchanged"* was
wrong in a way that would have shipped a silent cross-ceiling leak:
`signal_triage_budget` holds **one `reserved_cents` per `(business_id, day)`**
(`20260807100000_mode3_insight_cards.sql:98-108`, `UNIQUE (business_id, day)`) and the RPC takes **`p_cap`
from the caller** (`20260807110000_mode3_triage_state.sql:133-152`). Two consumers with two different caps
against one counter means a triage-heavy morning silently starves post generation for the rest of the day,
each caller's cap check sees the other's spend, and *"budget exceeded"* has two causes and no column that
distinguishes them.

**The rename therefore adds a `purpose` discriminator, and this is the load-bearing half of the change:**

| Object | Before | After |
|---|---|---|
| table | `signal_triage_budget` | `ai_budget_daily` |
| unique key | `UNIQUE (business_id, day)` | **`UNIQUE (business_id, purpose, day)`** |
| purpose column | — | `purpose text NOT NULL CHECK (purpose IN ('triage_cents','generation_posts'))` |
| amount column | `reserved_cents integer` | **`reserved_units integer`** — the unit is named by `purpose`: cents for `triage_cents`, posts for `generation_posts` |
| reserve RPC | `reserve_triage_budget(p_business_id, p_cents, p_cap)` | `reserve_ai_budget(p_business_id, p_purpose, p_units, p_cap)` |
| reconcile RPC | `reconcile_triage_budget(p_business_id, p_reserved_cents, p_actual_cents)` | `reconcile_ai_budget(p_business_id, p_purpose, p_reserved_units, p_actual_units)` |

**Everything else is genuinely unchanged**: the same guarded upsert, the same
`ON CONFLICT … DO UPDATE … WHERE reserved + p_units <= p_cap` atomicity, the same server-pinned
`(now() AT TIME ZONE 'utc')::date`, the same `SECURITY DEFINER` + `SET search_path`, and the same
deny-by-default posture (`20260807100000_mode3_insight_cards.sql:147-180`: RLS enabled, **no policy at
all**, `REVOKE ALL … FROM authenticated`, `GRANT EXECUTE … TO service_role`). The table is
service-role-only and stays that way.

**Migration mechanics the Builder must not improvise:**

- Both RPCs **`RETURNS SETOF public.signal_triage_budget`**. A return type cannot be changed by
  `CREATE OR REPLACE FUNCTION` — the migration **`DROP FUNCTION`s both and recreates them** under the new
  names and signatures, re-issuing the `REVOKE`/`GRANT` pair for each.
- Existing rows **backfill to `purpose = 'triage_cents'`** (`reserved_cents` → `reserved_units`
  unchanged in value), so no live triage budget is reset by the rename.
- The `trg_signal_triage_budget_updated_at` trigger (`:110-112`) is renamed with the table.
- Callers move in the same PR: `lib/db/signal-triage-budget.ts:16,35,63`
  (`reserveTriageBudget` / `reconcileTriageBudget` / `isTriageBudgetCapped`),
  `lib/signals/triage/orchestrator.ts:262`, `lib/db/types.ts`, and the two
  `supabase/__tests__/signals3-*.test.ts` suites. Per CLAUDE.md's naming rule the rename is its own tracked
  piece of work — executed inside Session 31 because the extension is not expressible without it.

D-6's second-table loser stands named: two ceilings that can disagree, and the check-then-call race solved
twice. `QUAL-COST-CEILING-EXTENDED` (Tier 1), `QUAL-BUDGET-PURPOSE-ISOLATED` (Tier 1),
`QUAL-NO-SECOND-BUDGET-TABLE` (Tier 3).

**Constraints from §7:** `QUAL-GUARD-ORDER-PRESERVED`, `QUAL-TRIAL-UNIT-PER-POST`,
`QUAL-RATE-LIMIT-COUNTS-CALLS` (Tier 2); `QUAL-COST-CEILING-EXTENDED`, `QUAL-PRO-DAILY-POST-CAP`,
`QUAL-BUDGET-PURPOSE-ISOLATED` (Tier 1); `QUAL-NO-SECOND-BUDGET-TABLE` (Tier 3).

---

## 8. The UX contract (specified here, designed by the Builder)

### 8.1 Losing candidates are DISCARDED

Losing candidate **content** is never persisted and never shown. Only the **winner's** scores persist.

**Losers named:**

- **A `post_candidates` table.** It buys a new business-scoped table with its full L-10 obligation — RLS,
  `ON DELETE CASCADE`, a §D2.5 cascade row, `purge_business` coverage, a Tier-1 erasure test — in exchange
  for storing text that, by construction, no one is permitted to publish. *[advisory: `ecc:code-reviewer`
  reached the same conclusion on Q7 and it is adopted.]*
- **Showing losing candidates on the approval surface.** The trust question is *"why this one"*, and the
  winner's own ten-dimension breakdown answers it. Three rejected drafts on a fast-triage surface are
  noise that slows the one decision the surface exists to make.

**The named condition under which a losing-content table becomes justified**, recorded now: **only if a
future session makes the judge advisory** — a compare-and-override UI where the human picks among
candidates. The outcome loop (Session 33) does **not** need it: a rejected candidate is never published
and therefore has zero engagement data to learn from.

### 8.2 Where the winner's scores live

**New columns on `post_ai_originals`** (`supabase/migrations/20260726010000_learning_capture.sql:28-42`),
**not** `posts.ai_generation_metadata`.

- `post_ai_originals` is **schema-versioned** (`schema_version int NOT NULL`, `:39`), **single-writer**,
  and **write-once** (the `trg_post_ai_originals_write_once` BEFORE UPDATE trigger at `:67-68`) — it is
  the ADR 0018-governed record of what the model produced.
- `posts.ai_generation_metadata` is an unvalidated JSONB blob carrying recorded debt
  (`docs/reviews/session-18b3-review.md`, M2). Adding a governed score to an ungoverned blob is how the
  blob becomes load-bearing.

Columns added: the winner's `overall`, the ten-dimension breakdown, the candidate count, and whether the
winner cleared `BRIEF_QUALITY_THRESHOLD`. **Columns, not a table** — the Session 29-D §D2.5 precedent
(ADR 0022's three new `studio_drafts` columns needed no new cascade row). `schema_version` bumps in the
same migration. `QUAL-SCORES-IN-ORIGINALS` (Tier 2).

**`QUAL-SCORE-ERASURE` (Tier 1).** Erasure must be proven to reach the **new columns specifically**, on
the `PROMOTE-CASCADE-COMPLETE` precedent (ADR 0022 §11.1) — a live-Postgres `db-tests` case that writes a
row carrying the new columns, runs `purge_business`, and asserts it is gone. The existing `business_id`
`ON DELETE CASCADE` at `:30` covers it structurally; the test proves it rather than assuming it.

### 8.3 Every state the surface must render

| State | Trigger | What the surface shows |
|---|---|---|
| **generating** | session in flight | progress indication; at brief assembly it must also carry the A-4 expectation-setting copy (§3.4) |
| **judged-and-passed** | winner's `overall` ≥ 70 | the post, its score badge, and a *"3 candidates considered"* affordance expanding to the winner's ten-dimension breakdown |
| **all-below-threshold** | no candidate cleared 70 | the post, an **amber** flag, and copy to the effect of *"no candidate cleared the quality bar — review carefully"*. **Excluded from bulk approve** (§8.4) |
| **judging failed** | the §2.3 *unscored* outcome | the post, **no** badge, and an explicit statement that it was not scored — an absent badge must not read as a passing one |

### 8.4 Below-threshold posts are excluded from bulk approve (A-3)

`bulkApproveDraftPosts` (`lib/db/posts.ts:594-612`) approves **exactly the ids the caller rendered**, with
`campaign_id`/`business_id`/`status`/`deleted_at` as defence in depth — and **no quality predicate**. A
below-threshold post is therefore as one-click bulk-approvable as any other draft today, which makes the
amber flag purely cosmetic.

**Per A-3, below-threshold posts require individual approval.** The founder accepts this as a
**customer-observable behaviour change**: a bulk approve now leaves drafts behind, and **the surface must
say why rather than silently skipping them.**

This is a **SHARED-FUNCTION CALLERS** obligation of exactly the Session 22 blocker shape. Both callers
must be audited and both covered:

| Caller | Covered by |
|---|---|
| the approvals surface's bulk approve (`ApprovalsInbox`) | `QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE` |
| the campaign posts surface's bulk approve (`PostsClient`) | `QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE` |

A caller with no listed test is `AUTHORED-NOT-EXECUTED` for that caller — this is the exact failure that
produced BLOCKER-1 and BLOCKER-2 in Session 22, where `APV-BULK-*` was verified against only one of the
two callers across three consecutive sessions. **The Builder `git grep`s the callers and lists them
per-caller before marking the constraint tested.**

### 8.5 Implementation contract (binding on the Builder)

- **Server Component page + Client Component for interaction.** The score breakdown's expand/collapse is
  client state; the page and its data fetch are not.
- **Zod on every Server Action input**, before any processing.
- **shadcn v4 / Base UI**: **no `asChild` on `Button`**, **no `asChild` on `DropdownMenu` primitives**.
  A link styled as a button uses `buttonVariants()` on a `<Link className={cn(buttonVariants({…}))}>`.
- **Tailwind only.** No CSS modules, no inline `style` except where genuinely dynamic.
- **i18n en/pt/es simultaneously.** Every new string — the badge, the amber copy, the
  bulk-approve-left-these-behind explanation, the unscored notice — lands in all three locale files in the
  same commit. Hardcoded English is a constitution violation, not a nit.
- **Atomic state transitions** by conditional `WHERE`; **bounded list queries** with explicit `ORDER BY`
  matching an index; **date-fns**; **no `any`**; **no `console.*`** outside the single-canonical-line
  worker carve-out.
- The Builder runs `/impeccable` and/or `/taste-skill` **against this contract**. This ADR specifies the
  states and the hierarchy; it does not design them.

**Constraints from §8:** `QUAL-SCORES-IN-ORIGINALS`, `QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE`
(Tier 2); `QUAL-SCORE-ERASURE` (Tier 1).

---

## 9. GDPR and tenancy (L-10)

**Session 31 introduces NO new business-scoped table.** This is recorded explicitly, as a deliberate
no-new-row session, on the **Session 28-D D7 precedent** and the Session 29-D / Session 30.5-N2.4
precedents already appended to ADR 0010 Amendment 2 §D2.5.

| Change | Table shape | §D2.5 obligation |
|---|---|---|
| Winner's scores (§8.2) | **new columns** on the existing `post_ai_originals` | **No new row.** The existing `post_ai_originals` row already covers the whole table via `business_id … ON DELETE CASCADE` (`20260726010000_learning_capture.sql:30`). `QUAL-SCORE-ERASURE` (Tier 1) proves erasure reaches the new columns specifically, on the `PROMOTE-CASCADE-COMPLETE` precedent |
| Budget ceiling (§7.5b) | **rename + one new column** on the existing `signal_triage_budget` → `ai_budget_daily` (`purpose`, and `reserved_cents` → `reserved_units`) | **No new row — the existing row's table name changes and moves with the table.** Same `business_id`, same `ON DELETE CASCADE`, same deny-by-default RLS (no policy at all + `REVOKE ALL … FROM authenticated`). The added `purpose` column carries no personal data and changes no erasure path. The rename migration and the §D2.5 edit land in **the same PR** |
| Sampling, thinking, judging, retrieval conditioning, structured output | **no table change at all** | none |

**Had a new business-scoped table been introduced**, it would have carried, without exception: RLS in the
InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))` form; `USING` **and**
`WITH CHECK` on every `UPDATE` policy; `ON DELETE CASCADE` from `businesses`; a verbatim new row in ADR
0010 Amendment 2 §D2.5's cascade table; and `purge_business` coverage proven by a Tier-1 case. None is
owed, because none is introduced.

**`QUAL-NO-SECOND-BUDGET-TABLE` (Tier 3)** is the property of absence that keeps this true: the migration
**renames**, and a new `CREATE TABLE` for a second budget mechanism fails the check.

---

## 10. Test plan across the tiers (Q8)

### 10.1 Tier 1 — DB behaviour, live Postgres, `db-tests.yml`

Three constraints. Each is a `supabase/__tests__/*` case against a real Postgres; a mocked client or a
`pg_policies` read is **not** coverage.

| Constraint | Case shape |
|---|---|
| `QUAL-COST-CEILING-EXTENDED` | `reserve_ai_budget` under **two concurrent reservations** and **first-call-of-day**, i.e. the ADR 0021 case shape re-run against `ai_budget_daily`; plus a case proving no `signal_triage_budget` table, trigger or RPC survives the rename, and one proving existing rows backfilled to `purpose='triage_cents'` with their `reserved_units` value intact |
| `QUAL-BUDGET-PURPOSE-ISOLATED` | **the discriminator does its job**: a `triage_cents` reservation at its cap does **not** deny a `generation_posts` reservation on the same `(business_id, day)`, and vice versa — two purposes, two rows, two caps, no shared counter (§7.5b) |
| `QUAL-PRO-DAILY-POST-CAP` | the 15-**post** ceiling **enforced** under two concurrent reservations and across the UTC day boundary; a hard-failed generation **releases** its unit through `reconcile_ai_budget`; a Plus or trial business takes **no** `generation_posts` reservation (§7.4) |
| `QUAL-SCORE-ERASURE` | write a `post_ai_originals` row carrying the new score columns, run `purge_business`, assert the row is gone (`PROMOTE-CASCADE-COMPLETE` precedent) |

> **CI note, carried forward honestly.** `db-tests` is currently **RED and not promoted** — four
> consecutive failures on `session-30-5-adr-0028` traced to a Postgres SIGSEGV, with the beta-CLI pin
> recorded as *not* a fix (`05baf1d2`). Under ADR 0015 §5 it remains advisory-but-must-be-read until three
> consecutive full green runs on `master`. **These three Tier-1 constraints cannot be called covered while
> that suite is red**, and the Reviewer must open the run and distinguish a DB-behaviour regression from
> the known stack failure rather than reading the colour.

### 10.2 Tier 2 — app-layer vitest, `app-tests.yml`, every push and PR

Eighteen constraints (§11). The judging contract, the three outcomes, argmax determinism and tie-breaking,
neutralization, the sampling defaults, the frozen-table version-bump scan, the thinking budget, the
widened query threading, the nine unchanged context call sites, the structured-output happy path and its
malformed-tool-call error path, the trial-unit and rate-limit behaviour at N, the guard ordering, the
score persistence, and the bulk-approve exclusion **across both callers**.

**Prerequisite, not optional (§4.5):** the mock must be able to return a *sequence* of distinct payloads
for one `promptId`. Without it, `QUAL-ARGMAX-DETERMINISTIC` and `QUAL-BELOW-THRESHOLD-SURFACED` are
`AUTHORED-NOT-EXECUTED` by construction — the test would pass on a 3-way tie and prove nothing.

### 10.3 Tier 3 — properties of absence, diff-verified by decision

Seven constraints, each enumerated **as such** so that "no runtime test" is a recorded decision and not an
oversight (ADR 0015 §2):

| Constraint | The absence being verified |
|---|---|
| `QUAL-HOOK-RETRY-REMOVED` | zero references to `generate.ts`'s removed `openingStrength`/`regenerationCount` retry block |
| `QUAL-RUBRIC-UNCHANGED` | no dimension added, renamed or removed; `RubricOutputSchema` byte-unchanged; `rubric.ts:21-24`'s invariant comment intact |
| `QUAL-MODE2-FIXTURES-MIGRATED` | no fixture re-recorded for sampling reasons; the orphan audit's outcome recorded in the PR |
| `QUAL-SERVICE-ROLE-UNWIDENED` | no new `createServiceRoleClient` call site outside `lib/ai/context.ts`; no `client` parameter added to `buildCustomerContext` or `withPostQueryContext` |
| `QUAL-PARSER-RETAINED` | `extractJsonBlock` present and exercised by the nine unmigrated prompt ids and `tool-runner.ts:445` |
| `QUAL-NO-SECOND-BUDGET-TABLE` | the migration renames; no second `CREATE TABLE` for a budget mechanism |
| `QUAL-NO-NEW-AI-SURFACE` | no new route, no new user-facing generation entry point, no new prompt family (L-8) |

### 10.4 The before/after protocol — and the blunt statement

**Baseline run, before any Session 31 change lands:** record, per generated post, the winner's `overall`,
the ten-dimension breakdown, the candidate count (1 today), and the observed per-post recorded cost. After
the change, record the same fields at N=3.

**Fixture directories named:** `lib/ai/__fixtures__/` (15 files, §4.2) and
`lib/signals/__fixtures__/eval/` (`corpus.v1.json`, `corpus.v2.json`, `latest-run.json`,
`populated-memory-run.json`, `sabotage-run.json`).

**Now the honest part, stated as bluntly as it deserves: this session cannot prove the posts are better.**

1. **The eval harness does not apply.** `.github/workflows/eval-triage.yml:47-52` gates on triage paths.
   No Session 31 file matches its filter, so the harness exits 0 with `applicable: false`. Running it and
   reporting a green is reporting nothing.
2. **The headline metric does not exist.** `lib/learning/diff.ts` is exhaustively **structural**
   (`lengthDelta`, `hashtagDelta`, `removedSentences`) with no edit distance, and its header carries an
   explicit **ADR 0018 STOP** against adding a diff library. There is no implemented measure of "better".
3. **The corpus does not exist and is not affordable here.** The only two corpora are triage
   `card`/`no_card` at lengths 3 and 5. Applying **ADR 0021 §10.4's own arithmetic**: binary
   classification needs **≥40 true positives** before a number stops being binomial noise, and pairwise
   preference needs **≥80–100 hand-labelled pairs**. A best-of-3 lift is plausibly **smaller than the
   detectable floor at that corpus size.** Building the corpus is founder hand-labelling hours and is a
   **Session 32 deliverable**.
4. **The harness's numbers are a bootstrap ceiling** (ADR 0021 §10.4): the cassettes and the labels share
   an author, so a high score measures self-consistency, not quality. ADR 0015 Amendment B's
   **MEASURED-never-COVERED** language governs how any such number may be described — and none of it may
   be described as coverage.

**Interim instrumentation — logged, not gated, and not a constraint:**

- **Judge self-discrimination margin**: winning-candidate `overall` minus the median candidate's, across
  generations. If the winner does not sit measurably above the median, the judge is not discriminating and
  N=3 is pure cost. **This proves the judge discriminates. It does NOT prove that its discrimination
  tracks real quality**, and both halves are stated in the log line so the number cannot be misread later.
- **`diff.ts` structural deltas on real approved-post edits**, before and after N=3 ships. If humans edit
  less, that is qualitative signal — not proof — obtained without hand-labelling.

**Zero Tier-E constraints** (ADR 0015 Amendment B1.2): every mechanical property above is exact-match
testable, and Tier E is not a place to park a claim you would rather not test (Amendment B(b)). The
measurement debt is recorded in `docs/backlog.md` and `docs/current-phase.md` with an explicit gate:
**any future "N=3 helped" claim requires the metric of §10.4(2) to exist first.**

### 10.5 What is honestly untestable, and why

| Property | Why no test can prove it here |
|---|---|
| "N=3 produces better posts" | no metric, no corpus, and a plausible effect size below the detectable floor (§10.4) |
| "temperature 1.0 is the right value" | the search space is continuous and the objective function is the metric that does not exist |
| "4,000 thinking tokens on brief assembly is the right budget" | same. 4,000 is a defensible starting point under A-4, not a measured optimum |
| "the ten rubric dimensions measure what they claim" | inherited from ADR 0017, out of scope here, and would require the same absent corpus |

---

## 11. The constraint table — the Reviewer's checklist

**29 constraints: 4 Tier 1, 18 Tier 2, 7 Tier 3, 0 Tier E.** (The pre-review count was 28/3; `QUAL-BUDGET-PURPOSE-ISOLATED` was added by the §7.5b correction — §15, BLOCKER-2.)

Where build-guide §1b's *illustrative* names and the names below differ, **these names win** (§0.2:
"§1b listed a minimum to cover, not a fixed vocabulary"). The mapping is given so nothing is lost:
`QUAL-BEST-OF-N-JUDGED` → `QUAL-N-CANDIDATE-COUNT` + `QUAL-ARGMAX-DETERMINISTIC`;
`QUAL-FULL-RUBRIC-SCORED` → `QUAL-JUDGE-RUBRIC-UNFORKED`;
`QUAL-SINGLE-DIM-RETRY-REMOVED` → `QUAL-HOOK-RETRY-REMOVED`;
`QUAL-ALL-BELOW-THRESHOLD-DEFINED` → `QUAL-THREE-OUTCOMES` + `QUAL-BELOW-THRESHOLD-SURFACED`.

| # | Constraint | Tier | Test that will prove it | § |
|---|---|---|---|---|
| 1 | `QUAL-N-CANDIDATE-COUNT` | 2 | `lib/campaigns/generate.test.ts` — exactly 3 generation calls per entry, concurrency bounded to 3 | 2.1–2.2 |
| 2 | `QUAL-JUDGE-RUBRIC-UNFORKED` | 2 | `lib/ai/prompts/rubric.test.ts` + `generate.test.ts` — N separate `mode:'post'` calls; `RubricOutputSchema` and all three existing call shapes unchanged | 2.6 |
| 3 | `QUAL-CANDIDATE-NEUTRALIZED` | 2 | `generate.test.ts` — every candidate passes through `neutralize()` before the judge; injection-payload case | 2.6 |
| 4 | `QUAL-ARGMAX-DETERMINISTIC` | 2 | `generate.test.ts` — argmax on `overall`; tie ⇒ lowest index; **requires the §4.5(2) mock sequence** | 2.7 |
| 5 | `QUAL-THREE-OUTCOMES` | 2 | `generate.test.ts` — 0-generated ⇒ hard fail; all-judges-throw ⇒ unscored, non-terminal; partial failure ⇒ argmax over the survivors | 2.3 |
| 6 | `QUAL-BELOW-THRESHOLD-SURFACED` | 2 | `generate.test.ts` — all N < 70 ⇒ best-of-set persisted and flagged, session not failed | 2.8 |
| 7 | `QUAL-HOOK-RETRY-REMOVED` | 3 | diff — zero references to the removed retry block; five old cases mapped forward (§4.4) | 2.9 |
| 8 | `QUAL-RUBRIC-UNCHANGED` | 3 | diff — ten dimensions, no rename, `RubricOutputSchema` byte-unchanged | 2.6 |
| 9 | `QUAL-SAMPLING-VERSIONED` | 2 | a new prompt-properties frozen-table test — changing `modelKey`/`temperature`/`thinking`/`maxTokens` without a `version` bump fails | 3.2 |
| 10 | `QUAL-SAMPLING-DEFAULT-PRESERVED` | 2 | `lib/ai/runner.test.ts` — a prompt declaring nothing produces byte-identical SDK params (sibling of `STUDIO-RUNNER-DEFAULT-PRESERVED`) | 3.1 |
| 11 | `QUAL-THINKING-BUDGETED` | 2 | `lib/ai/runner.test.ts` + `lib/ai/prompts/brief.test.ts` — 4,000 thinking **and** `maxTokens: 12_000` on `brief-assembly` at `version: 2`, both fields absent on the other nine ids; a `thinking`-then-`text` response parses; **no prompt declares both `temperature` and `thinking`** | 3.3, 3.3a |
| 12 | `QUAL-MODE2-FIXTURES-MIGRATED` | 3 | diff — no sampling-driven re-record; orphan-audit outcome recorded; all 21 `MODE2-*` dispositions per §4.4 | 4 |
| 13 | `QUAL-QUERY-CONDITIONED` | 2 | `lib/memory/performance.test.ts` + `lib/ai/context.test.ts` — `role`/`campaignId` reach `retrievePerformancePatterns` and change ranking | 5.1–5.2 |
| 14 | `QUAL-CONTEXT-CALLERS-UNCHANGED` | 2 | `context-callers.context-equivalence.test.ts` + `generate.context-equivalence.test.ts:279-345`, **one case per call site** in the §5.4 table | 5.4 |
| 15 | `QUAL-SERVICE-ROLE-UNWIDENED` | 3 | diff — no new service-role call site, no `client` parameter added | 5.3 |
| 16 | `QUAL-STRUCTURED-OUTPUT` | 2 | `lib/ai/runner.test.ts` — `learningSummarizerPrompt` sends a tool derived by `z.toJSONSchema`; the `tool_use` reply parses through Zod | 6.1–6.3 |
| 17 | `QUAL-MALFORMED-TOOL-CALL` | 2 | `lib/ai/runner.test.ts` — no tool block / bad `input` / mixed text+tool ⇒ `AiError('invalid_response')` | 6.4 |
| 18 | `QUAL-PARSER-RETAINED` | 3 | diff — `extractJsonBlock` present and exercised by the nine unmigrated prompt ids and `tool-runner.ts:445` | 6.5 |
| 19 | `QUAL-GUARD-ORDER-PRESERVED` | 2 | `lib/ai/runner.test.ts` — STEP 1 trial cap, then STEP 2 rate limit, then assembly; reservation sits outside `runPrompt` | 7.1 |
| 20 | `QUAL-TRIAL-UNIT-PER-POST` | 2 | `generate.test.ts` — one user-visible generation at N=3 consumes exactly **1** trial post | 7.2 |
| 21 | `QUAL-RATE-LIMIT-COUNTS-CALLS` | 2 | `lib/ai/runner.test.ts` + `generate.test.ts` — N calls count as N; overshoot bounded at N−1 | 7.3 |
| 22 | `QUAL-COST-CEILING-EXTENDED` | **1** | `supabase/__tests__` — `reserve_ai_budget` under two concurrent reservations + first-call-of-day; no `signal_triage_budget` object survives; existing rows backfilled to `purpose='triage_cents'` | 7.5b |
| 23 | `QUAL-PRO-DAILY-POST-CAP` | **1** | `supabase/__tests__` — 15 **posts**/day enforced under concurrency and across the UTC day boundary; hard-failed generation releases its unit; Plus/trial take no reservation | 7.4, 7.5a |
| 24 | `QUAL-NO-SECOND-BUDGET-TABLE` | 3 | diff — rename only; no second budget `CREATE TABLE` | 7.5, 9 |
| 25 | `QUAL-SCORES-IN-ORIGINALS` | 2 | the `lib/db` `post_ai_originals` suite — winner's scores written there, `schema_version` bumped; nothing written to `ai_generation_metadata` | 8.2 |
| 26 | `QUAL-SCORE-ERASURE` | **1** | `supabase/__tests__` — `purge_business` removes rows carrying the new score columns (`PROMOTE-CASCADE-COMPLETE` precedent) | 8.2 |
| 27 | `QUAL-BELOW-THRESHOLD-NOT-BULK-APPROVABLE` | 2 | the `ApprovalsInbox` **and** `PostsClient` suites — **both** callers of `bulkApproveDraftPosts`, plus the i18n explanation in en/pt/es | 8.4 |
| 28 | `QUAL-NO-NEW-AI-SURFACE` | 3 | diff — no new route, no new generation entry point, no new prompt family | L-8 |
| 29 | `QUAL-BUDGET-PURPOSE-ISOLATED` | **1** | `supabase/__tests__` — a capped `triage_cents` row does not deny a `generation_posts` reservation for the same business/day, and vice versa | 7.5b |

---

## 12. Deferred — each item, and the session that owns it

### 12.1 Voice exemplars and ALL similarity / embedding retrieval — deferred on SEQUENCING, not on a block

**State this precisely, because the stale form of the sentence is wrong.** `SIGNAL-NO-EMBEDDINGS` was
**SCOPED**, on 2026-09-03, to **Mode 3's deterministic half** — `docs/pre-launch-scope.md` §12.6, ADR 0020
§17c, ADR 0023 §21. It was **NOT retired**, and it does **not** block similarity retrieval inside
`lib/memory/`.

Voice exemplars are therefore **not blocked**. They are out of scope in Session 31 for one reason: **they
need the corpus Session 32 supplies.** Any future document that repeats *"re-affirmed, therefore blocked"*
is repeating a line that stopped being true on 2026-09-03. **Owner: Session 32.**

### 12.2 Tools for the generator
Giving the generation prompt retrieval tools is a different architecture from conditioning its context.
`lib/ai/tool-runner.ts` exists and is proven on triage; extending it to generation is its own session.
**Owner: the AI-quality track — `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` §7/§14.**

### 12.3 Claim verification
Checking a generated claim against `evidence_memory` is a new AI surface (L-8) and a new failure mode.
**Owner: a later quality-track session.**

### 12.4 The campaign planner
Out of scope by L-1. **Owner: a later track.**

### 12.5 Cross-type retrieval
Ranking a brand fact against an audience fact on one scale. Out of scope by L-1; the per-type caps stay
independent (§5.6). **Owner: a later memory session.**

### 12.6 Memory write expansion
Memory has many readers and, today, effectively **one** writer (the ADR 0018 edit-learning loop);
`performance_memory` is fed by editing behaviour, not by published results. **Session 31 adds no writer
and no write path.** **Owner: `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` Part II.**

### 12.7 The social backfill
Out of scope by L-1. **Owner: a later track.**

### 12.8 The outcome loop
Feeding published-post performance back into `performance_memory`. It does **not** need losing-candidate
content (§8.1). **Owner: Session 33.**

### 12.9 Pushed to a follow-on by Q1–Q7 specifically

| Item | Pushed by | Owner |
|---|---|---|
| A thinking budget on native generation | Q2 — the temperature-1.0 interaction cannot be resolved without the missing metric (§3.3) | the session that ships the metric |
| Model escalation on all-N-below-threshold | Q1 — ≈5× cost for an unconfirmed lift (§2.8) | same |
| Migrating the remaining eight prompt families to `tool_use` | Q5 — additive and per-prompt by D-5 (§6.2) | wave 2, after `learningSummarizerPrompt` proves the path in production |
| Deleting `extractJsonBlock` | Q5 — gated on the named condition (§6.5) | whichever session first satisfies it |
| **A real generation-quality metric and its hand-labelled corpus** | Q8 — the load-bearing debt of this session (§10.4) | **Session 32** |
| The A-1 pricing-copy change | A-1 — founder/copy, not a Builder task (§7.4) | founder, before launch — `31-A1-PRICING-COPY`, `docs/backlog.md` §1 |

---

## 13. Advisory findings: accepted, and rejected

**Accepted and folded in** (each cited *[advisory]* at its point of use): `ecc:pr-test-analyzer`'s three
Q3 blockers and its blunt Q8 verdict that the session cannot prove it worked (§4.5, §10.4);
`ecc:typescript-reviewer`'s Q5 position that Zod must sit **behind** the tool schema rather than be
replaced by it, with all three reasons (§6.3); `ecc:code-reviewer`'s Q7 conclusion that persisting losing
candidates does not earn its RLS/cascade obligation (§8.1) and its Q1 caller audit of the removed retry
(§2.9).

**Rejected, with the reason recorded:**

| Finding | Why rejected |
|---|---|
| `ecc:typescript-reviewer` (Q4): thread the per-post context through `buildCustomerContext` itself | It multiplies the brand/evidence/audience fan-out by the campaign's entry count, for three stores that cannot vary between two posts of one campaign. The narrower `withPostQueryContext` refinement (§5.2) buys the same conditioning for one extra DB read per post |
| `ecc:code-reviewer` (Q1): make the judge advisory and let the human pick among candidates | That is precisely the design that **would** justify a losing-candidate table (§8.1), and it is a different product decision — a founder adjudication, not an Architect call. Recorded as the named revival condition rather than adopted |

**Not re-consulted.** One batch, as the phase budget specifies.

---

## 14. Consequences

**Good.** The product's main generation path gets a real quality gate over ten dimensions instead of one
sentence scored on one dimension with no re-score. Sampling and thinking become attributable, per-prompt,
versioned properties with the version-bump rule **enforced** rather than remembered. The 0.2 scope-match
weight in the memory scorer starts doing work at the call site that matters most. One prompt's output path
stops being prose-then-parse. And the whole thing is bounded by an existing, already-raced-and-solved
atomic reservation rather than a second one.

**Bad, and stated plainly.** Per-post AI cost roughly doubles (≈3.6¢ → ≈6.7¢ true). Brief assembly gets
8–15s slower on a user-visible step **and its token ceiling triples** (4,096 → 12,000, §3.3a), so its
worst-case cost rises with it. Pro stops being "unlimited posts" and **the copy must change before launch
or the product misrepresents itself**. Bulk approve now leaves drafts behind. One byte-exact fixture
assertion class is traded for property assertions on the first tool-migrated prompt. A shared budget table
acquires a `purpose` column and a data migration, and every triage budget call site moves in the same PR
(§7.5b). **And this session cannot prove any of it made the posts better** — that proof is Session 32's
corpus, and until it exists no one may claim the lift.

---

## 15. Corrections applied after the H1 review

This ADR was reviewed against the tree it cites (`session-30-5-adr-0028` `05baf1d2`) before any Builder
work began. Nine findings were raised; **all nine are applied above**, and this section records
finding → change so a reader of the amended text can see what moved and why. Nothing was corrected
silently: the two design reversals (BLOCKER-2, MAJOR-1) name their superseded design in place.

| # | Finding | Correction |
|---|---|---|
| **BLOCKER-1** | `thinking: 4000` on `brief-assembly` against an unset `maxTokens` resolves to `DEFAULT_MAX_TOKENS = 4096` (`runner.ts:30,149`), leaving 96 output tokens — every Stage A assembly would fail `response_truncated` at `runner.ts:185` | **§3.3a added.** `maxTokens: 12_000` declared alongside the thinking budget, one `version: 2` bump covering both; the `thinking`-block parse path and the temperature/thinking disjointness both made assertions of `QUAL-THINKING-BUDGETED` (constraint 11 rewritten) |
| **BLOCKER-2** | The rename shared **one** `reserved_cents` per `(business_id, day)` (`20260807100000_mode3_insight_cards.sql:98-108`) across two caller-supplied caps — triage spend would silently starve generation and vice versa | **§7.5b rewritten.** `purpose` discriminator in the unique key, `reserved_cents` → `reserved_units`, both RPCs dropped and recreated (a `RETURNS SETOF` type cannot be `CREATE OR REPLACE`d), backfill to `purpose='triage_cents'`, caller list enumerated. New Tier-1 `QUAL-BUDGET-PURPOSE-ISOLATED` (constraint 29); §9 and §0 amended |
| **MAJOR-1** | `QUAL-PRO-DAILY-POST-CAP` was Tier 1 with **no mechanism** — A-1 caps a post *count*, §7.5 reserved *cents* | **§7.5a added.** Generation reserves **one post**, not worst-case cents; §7.4's 150¢/day becomes derived, not enforced. `AI_PRO_DAILY_POST_CAP = 15` in `lib/config.ts`; tier applicability (Pro only), release-on-hard-fail, and the `quota_exceeded` copy with its UTC reset hour all specified |
| **MAJOR-2** | The prompt inventory was wrong: `formats/policy.ts` and `formats/schemas.ts` are a validator module and a schema module, not prompts, and native generation is a **factory** producing three ids | **§2.4 reworked** around the ten real prompt ids, each cited; §3.2 states the ten-row rule, the two exclusions and the three factory rows; §3.1, §6.5 and constraint 18 recount from "nine families" to ten ids |
| **MAJOR-3** | Two of §6.3's three "independently sufficient" reasons are false against `zod@4.3.6` — `strictObject` **does** emit `additionalProperties:false`, a discriminated union **does** emit `oneOf`, and `RubricInput` is an *input* schema `z.toJSONSchema(prompt.outputSchema)` never sees | **§6.3 rewritten** with the verification output in place; the surviving reasons are dropped refinements and the `z.infer`'d `TOutput`. Conclusion (retain Zod behind the tool schema) unchanged |
| **MINOR-1** | `MockAnthropicClient` was cited at `lib/ai/__mocks__/client.ts:52-75`; no such directory exists | **§4.1 and §4.5(3) corrected** to `lib/ai/client.ts:49-88` and `:38-41`/`:55-56`. The routing claim itself verified and unchanged |
| **MINOR-2** | `post-generation` was given N=3 and temperature 1.0 while §4.2 simultaneously flagged its fixtures as possible orphans | **Audit resolved in §2.5**: zero production callers (`lib/ai/index.ts:4` is a barrel re-export). It gets neither N nor temperature; its five fixtures are **kept**, because `client.ts:61-67` still routes to that directory. Removal filed as `31-DEAD-POST-GENERATION-PROMPT` in `docs/backlog.md` |
| **MINOR-3** | §7.2 implied work where the property already holds | **§7.2 extended** to cite R-1's two skip predicates (`runner.ts:217`) and the orchestrator's batch increment; `QUAL-TRIAL-UNIT-PER-POST` restated as a regression test with a negative obligation |
| **MINOR-4** | Status `Accepted` while untracked and unregistered | Registered in `docs/current-phase.md`; the ADR and its two companion doc edits are committed together |

**Not changed, and deliberately so.** The N=3 contract, the judging contract, the argmax and tie-break
rules, the three outcomes, the retrieval design (§5), the choice of `learningSummarizerPrompt` as the first
tool-use migration, the UX contract (§8), and §10.4's refusal to claim a quality lift all survived review
without a finding. §10.4 in particular is unchanged: **this session still cannot prove the posts are
better**, and no correction above alters that.

## 16. Session 31-D correction pass — post-Builder findings

§15 recorded the H1 review, taken **before** any Builder work began. This section records findings raised
by the Session 31 **post-Builder** review (`docs/reviews/session-31-reviewer.md`, range
`05baf1d2..55b421ad`) that land as ADR corrections rather than code changes — each names its own commit and
review finding ID, additive to everything above exactly as §15 already established the pattern.

### 16.1 D7 — MINOR-2: `QUAL-CONTEXT-CALLERS-UNCHANGED` re-tiered for nine of its ten call sites

**§5.4's table and row 14 of §11 are not edited — this section corrects them additively.**

The Reviewer found the property row 14 claims (Tier 2 — "asserts, per call site, that the arguments and the
resulting `CustomerContext` are unchanged") **does hold** for all nine no-`queryContext` call sites — verified
independently at the range (`git diff --name-only 05baf1d2..55b421ad` touches none of the nine files, and
`buildCustomerContext`'s third parameter defaults to `{}`, so an unchanged caller produces an identical call
by construction) — but is **proven by absence-of-diff**, a Tier-3-shaped argument, not by the per-call-site
spy assertion Tier 2 implies. Only call site 1 (`lib/campaigns/generate.ts`, the one call site that DOES
pass a `queryContext`) has a genuine argument-level assertion
(`generate.context-equivalence.test.ts:279-345`).

**Disposition — re-tiered, not re-implemented:** `QUAL-CONTEXT-CALLERS-UNCHANGED` splits into two proof
obligations from this point forward, rather than one Tier-2 line covering ten rows:

- **Call site 1 (`lib/campaigns/generate.ts:214`) stays Tier 2** — it already carries a real
  argument-and-result assertion, and it is the one site whose `queryContext` argument can actually vary
  (§5.1/§5.2a), so a diff-absence argument would prove nothing useful here even if it held.
- **Call sites 2–10 (the nine no-`queryContext` callers) are Tier 3, diff-verified**, in the same sense §10.3
  already defines for `QUAL-SERVICE-ROLE-UNWIDENED` and `QUAL-NO-NEW-AI-SURFACE`: the property is "no caller
  file changed, and the parameter defaults to `{}`" — a `git diff --name-only <base>..<head>` check, not a
  spy-on-args unit test. §5.4's own table already enumerates the nine individually (rows 2–10); this section
  is the tier correction, not a re-enumeration.

**`brief.ts`'s two sites, named individually (the Reviewer's specific ask):** `lib/campaigns/brief.ts:111`
(Stage A assembly) and `lib/campaigns/brief.ts:160` (Stage B critique) are **two separate call sites**, not
one. Both are covered by the same file, `lib/campaigns/brief.test.ts`, which is why they were not
distinguished in the Reviewer's table — that remains true and is not a defect: `brief.test.ts` exercises
both call paths (Stage A's assembly prompt and Stage B's critique prompt each call `buildCustomerContext`
independently), and the Tier-3 diff-verified property ("this file didn't change in range") applies
identically and independently to each of the two lines it contains. Re-tiering both to Tier 3 removes the
need to distinguish them by a separate spy assertion — the diff check is line-blind by nature.

**Constraint 14 in §11's table is corrected going forward as:** `QUAL-CONTEXT-CALLERS-UNCHANGED` — Tier 2
for call site 1 only; Tier 3 (diff-verified, nine call sites, §5.4's own table) for call sites 2–10.

**Why this is the right fix, not a downgrade of rigor:** demanding a spy-on-args unit test at each of nine
call sites across nine files, for a property that already holds by construction (an unchanged file calling
a function whose new parameter defaults to nothing), would be nine tests asserting "this file's diff is
empty" — restated as vitest assertions instead of a `git diff` command. That is exactly the distinction
§10.3 draws for Tier 3. The Reviewer's own "why it matters" paragraph reaches the same conclusion: *"the
property DOES hold... this is not a false green"* — the defect was the TIER label, not the coverage.

**Reference:** `docs/reviews/session-31-reviewer.md`, MINOR-2, closed by this section (D7).

### 16.2 D9 — §3.2's "fails the test" sentence over-claims what the frozen table can prove

**§3.2 is not edited — this section corrects it additively.** The sentence stands above exactly as
written; this section states what it should have said.

**The over-claim.** §3.2 says: *"Changing any of those four without bumping that prompt's `version` in the
same commit **fails the test**."* This is not what `prompt-properties.frozen-table.test.ts` actually checks.
The test compares each live prompt's `{modelKey, temperature, thinking, maxTokens}` against its frozen-table
row keyed by `{id, version}` — it fails when the LIVE VALUE and the TABLE ROW disagree. It has no way to see
whether `version` itself was bumped, because a commit that changes `temperature` in the factory AND updates
the table row's `temperature` to match, **in the same commit, without touching `version`**, produces two
identical, agreeing values — the test passes. Observed directly during D1's own reddening work (Session
31-D): flagged there as an observation routed to D9, not re-verified as a fresh finding here, since D1
already demonstrated it.

**What the table actually proves, correctly stated:** a DRIFT between the live factory value and its frozen
row — i.e. changing ONE side only (the factory value, or the table row, but not both together) — fails the
test and is visible in the diff. This is the exact property `platform-map.frozen-table.test.ts` already
established as its precedent (§3.2's own citation): the table makes an unattributed change *visible*, it
does not — and structurally cannot — enforce that a human also bumped an unrelated integer field as an act
of authorial intent. Enforcing "you must have MEANT to change this" is not something a value-equality
comparison can express; only a git hook, a required PR-description field, or a second independent oracle
(neither of which exists here) could do that.

**Corrected sentence, for future readers of §3.2:** *"Changing any of those four ALONE — i.e. only the
factory value, or only the table row, without updating the other in the same commit — fails the test.
Changing both together to the same new value, without bumping `version`, does NOT fail the test; the table
proves the live value and its recorded baseline agree, not that a version bump accompanied the change of
either."*

**Why this is a MINOR/documentation-only correction, not a design gap:** `QUAL-SAMPLING-VERSIONED`'s real,
provable job — stopping an UNTRACKED drift between the deployed sampling behaviour and what the table
claims it is — still holds exactly as the reddening in H2.1 and D1 demonstrated (adding an eleventh id with
no row, or a fourth native-generation family with no row, both go red). What does not hold is the stronger
claim that the mechanism enforces version-bump AUTHORSHIP — nothing in this ADR relies on that stronger
claim anywhere else (§3.2's own conclusion, "Adding a prompt requires a new row," is unaffected — that part
is true and unchanged).

**Reference:** `docs/reviews/session-31-reviewer.md`'s D1 appendix ("Observation routed to D9"), closed by
this section (D9).

### 16.3 D14 — MINOR-8: the backfill case re-tiered; `QUAL-NO-SECOND-BUDGET-TABLE` recorded in code

**§10.1's table and §11 row 22 are not edited — this section corrects them additively.**

**The backfill half, re-tiered.** §10.1's `QUAL-COST-CEILING-EXTENDED` row lists three case shapes,
including *"one proving existing rows backfilled to `purpose='triage_cents'` with their `reserved_units`
value intact."* No such case exists in `supabase/__tests__/signals3-triage-state.test.ts`, and none CAN
exist against `db-tests.yml`'s fresh-migrate stack: that stack applies every migration in sequence to an
empty database, so there are never any pre-rename rows for a backfill case to act on — the `ADD COLUMN
purpose text NOT NULL DEFAULT 'triage_cents'` then `ALTER COLUMN purpose DROP DEFAULT` sequence
(`20260909110000_ai_budget_daily_rename.sql`) makes the backfill **structurally guaranteed by Postgres's own
`ADD COLUMN ... DEFAULT` semantics**, not something this repo's test harness can independently re-verify.
(Checked directly against the live linked project during this step: `ai_budget_daily` currently holds zero
rows — the table has not yet accumulated any reservations since the rename, so there is no live data to
read a backfill result FROM either; the claim rests on Postgres's own `ADD COLUMN ... DEFAULT` guarantee,
not on an empirical read.) **The backfill sub-case of `QUAL-COST-CEILING-EXTENDED` is
re-tiered to Tier 3, diff-verified by decision**, per ADR 0015 §2's rule that "no runtime test" must be an
enumerated decision, not a silent gap: the property is proven by the migration's own SQL structure (an `ADD
COLUMN ... DEFAULT` cannot leave a pre-existing row with a NULL value, by Postgres's own guarantee), not by a
`supabase/__tests__` case. The other two case shapes in the same row — the two-concurrent-reservations case
and the no-old-table-survives case — remain Tier 1 and remain correctly covered
(`supabase/__tests__/ai-budget-generation-posts.test.ts`, `signals3-triage-state.test.ts:263`).

**`QUAL-NO-SECOND-BUDGET-TABLE`, recorded in code.** This constraint already had a Tier-3 row in §10.3
(unedited) — what it lacked was a recorded statement anywhere in the CODE itself, unlike six of its seven
Tier-3 siblings (three as executable scans in `lib/scope-scans.test.ts`, three as an explicit "Tier 3,
diff-verified — no runtime test" comment in `generate.test.ts`/`context.test.ts`). D14 adds that comment
directly above `signals3-triage-state.test.ts:263`'s "no `signal_triage_budget` survives" case, naming
`QUAL-NO-SECOND-BUDGET-TABLE` explicitly and distinguishing it from that case's own, different property (the
OLD table/RPCs being gone, not the absence of a NEW second table) — closing the exact conflation risk the
Reviewer named.

**Reference:** `docs/reviews/session-31-reviewer.md`, MINOR-8, closed by this section (D14).
