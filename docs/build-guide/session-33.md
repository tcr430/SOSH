# Session 33 — The outcome loop: dimension tagging, pattern extraction, campaign retrospective (ADR 0026) · Track J

> **Goal:** close the loop the product's whole thesis rests on. Today SOSH **measures** performance and
> never **learns** from it: `lib/metrics/orchestrator.ts` writes only `post_metrics`, and
> `performance_memory` — despite its name — is written **exclusively** by `lib/learning/*`, the
> *edit-signal* pipeline. So the closed loop is *AI draft → human edit → memory*, which is a **taste** loop
> running entirely **before publication**. The loop that does not close is *published post → real metrics
> → learned pattern → next generation*.
>
> This session ships: a **dimension taxonomy tagged at generation time**; **normalisation** against the
> brand's own trailing baseline; **pattern extraction** from real metrics into `performance_memory` behind
> a minimum-n floor and a confidence interval; **decay and re-confirmation**; and the **campaign
> retrospective** that scores a campaign's hypothesis against its outcome and writes the result back.
>
> **What this session does NOT ship, explicitly:** deliberate experimentation / organic A-B testing (it
> needs volume this product does not yet have — a later track); business-outcome attribution beyond UTMs
> and conversion events presented with confidence levels (L-7 forbids implying precision); memory-driven
> opportunity cards; cross-type retrieval or new memory writers (Session 34); comment mining; embeddings.
>
> **Prerequisite, absolute.** Session 33 does not begin until Session 32 has closed. Without the backfill,
> a new customer needs roughly six months of publishing before any pattern clears a minimum-n floor —
> which means every constraint in this session would ship untestable against real data and unusable by
> real customers. **The dependency is on n, and it is not negotiable.**
>
> **Added 2026-09-03 — this session is now the substrate for a Tier-1 launch item.**
> `docs/pre-launch-scope.md` T1-B (analytics surface + the monthly report a founder can forward to a
> board) is **Tier-1 pre-launch**, and its own entry argues it is *"cheap once Session 33 lands."* That
> is only true if this session's outputs are shaped for a reader as well as for a prompt. The ADR must
> therefore state, briefly and explicitly, **what T1-B will read** — which rows carry a
> human-presentable pattern, its n, its confidence interval, its normalisation baseline and its
> provenance (imported vs earned, Q6) — so the surface is a query rather than a second computation.
> **This does NOT pull the analytics surface or the report artefact into Session 33's scope**; it only
> requires that the store it writes can be read by one.
>
> **One thing to know before reading further:** the north-star metric — *"successful campaign learning
> cycles completed per active brand"* — currently measures a loop that is **not fully wired**. §5/Q5 is
> what makes it true. Say so plainly in the ADR rather than letting anyone report the metric first.
>
> **Reframed 2026-09-03 — the metrics this session learns from now come from native platform APIs.**
> `docs/build-guide/session-30-5.md` (**Track N, ADR 0028**) runs ahead of Session 31 and replaces the
> Postiz broker with native LinkedIn and X providers. The prerequisite chain is unchanged in shape (this
> session still waits on Session 32, which now waits on 30.5), but **one substantive input changes**: ADR
> 0028 **Q5** produces a per-platform table stating, field by field, which of `PostMetrics`' seven values
> each API can actually serve, which need an access tier the product does not have, and which are
> **permanently unavailable** — as distinct from *"not fetched this tick"*, which
> `lib/metrics/orchestrator.ts` writes identically as `null` today.
>
> **That table is a required input to this session's normalisation and minimum-n design, not background
> reading.** A permanently-null field silently entering a minimum-n floor is a measurable defect this
> session would otherwise ship: the floor would never clear, or worse, would clear on a partial
> denominator. The Architect must read ADR 0028 §6 and state, per dimension, which metric fields are
> **eligible** to contribute to a pattern. Everything else in this session — the taxonomy, decay,
> re-confirmation, the retrospective, and T1-B's read shape — is untouched.

---

## Reality check — to be re-verified against the live repo before the Architect runs

> Read at `b297a4a8`. **If any item has changed, correct this file before the Architect runs.**

1. **The metrics worker writes `post_metrics` and nothing else.** `lib/metrics/orchestrator.ts:82` calls
   `upsertPostMetrics` (imported at `:7`), and there is no memory write anywhere in the file. The cron
   entry is `app/api/cron/sync-metrics`. **This is the gap the session closes** — verify it before
   designing against it.

2. **`performance_memory`'s only writer is the edit-signal pipeline.** `lib/learning/promote.ts` and
   `lib/learning/summarize.ts` import from `lib/db/memory-performance`; `lib/learning/orchestrator.ts:2`
   describes itself as *"snapshot lookup → classify (Tier 0) → aggregate into performance_memory"*.
   `lib/learning/pattern-key.ts` and the migrations
   `20260726020000_performance_memory_pattern_key.sql` / `20260726030000_performance_memory_promotion.sql`
   define the existing pattern key and promotion SQL. **Session 33 adds a SECOND writer to a table that
   has only ever had one** — Q3 must treat that as the design problem it is, not a detail.

3. **Retrieval always takes the fallback branch today.** `lib/memory/performance.ts`'s own comment:
   *"today, this always takes the fallback branch"* — governed rows are absent, so retrieval reads raw
   `post_metrics` and returns `topContent` with `likes`/`impressions`. The same file records two prior
   corrections worth honouring: a governed pattern's `platform` may be **null** and is rendered *"Across
   platforms"* rather than dropped or guessed (MINOR-3), and `likes`/`impressions` are **omitted** for a
   governed pattern rather than emitted as `0`, because *"a literal 0 likes, 0 impressions would read to
   the model as evidence the pattern performs badly, inverting the store's intent"* (MINOR-2).

4. **A dimension-tagging precedent already exists.** `lib/campaigns/generate.ts:303` tags each generated
   post with the `order` of the `roleSequence` entry it was generated **from** — *"assigned before
   generation, not discovered after"* — and `lib/campaigns/consistency.ts`'s `checkRoleCoverage` does a
   positional cross-check against the frozen brief. **Q1's taxonomy extends this pattern**; it does not
   invent one, and the "assigned before, not discovered after" principle is exactly L-4.

5. **The governance fields the loop needs already exist.** `lib/memory/scoring.ts`: `confidence`,
   `recency_at` (exponential decay, 30-day half-life, non-finite input throws rather than silently
   scoring 0), `expires_at`, `status`, `scope`/`scope_ref`, with `isEligible` and `rankAndCap`.
   `PERFORMANCE_CAP = 3` (`lib/memory/constants.ts`). Nothing is currently feeding outcome data into any
   of it.

6. **Session 32's provenance marker will be live.** Imported records are permanently distinguishable from
   earned ones (Session 32 L-3). Q6 must state how an outcome pattern **derived from imported data** is
   labelled, because a pattern computed over a backfilled corpus is not the same claim as one computed
   over posts SOSH itself published and measured.

7. **Whether a campaign brief carries a `hypothesis` and `success criteria` is NOT yet confirmed — verify
   it first.** The strategy doc (`docs/brainstorm/Chat/ai-social-media-manager-platform-strategy.md` §2)
   specifies both as campaign fields, and ADR 0017 shipped Stage A brief assembly with post roles. **Q5's
   scope depends entirely on which of them actually exist in the frozen brief today.** If they do not,
   Q5's answer includes whether adding them is in scope here or is an ADR 0017 amendment to be **flagged,
   not made**.

8. **The north-star metric is named for this loop.** *"Successful campaign learning cycles completed per
   active brand"* (strategy doc, "The metrics I would obsess over"). Q5 must make it **computable** and
   state what a "cycle" is in rows, not prose.

9. **`ai_usage`, the daily cost ceiling, and the worker pattern all exist.** `SIGNAL3-COST-CEILING-ATOMIC`
   is the precedent (ADR 0021); `app/api/cron/` holds eight workers including `sync-metrics` and
   `capture-learning`, each emitting a single canonical structured-JSON tick line under CLAUDE.md's
   worker carve-out.

10. **ADR 0018's diff-learning loop is live and must not be disturbed.** `post_ai_originals` (write-once)
    and `post_edit_signals` (trigger-enqueued on `draft→approved`) feed the Tier-0 classifier and the
    Tier-1 Haiku summarizer. Session 33 runs **alongside** it into the same store. Any change to ADR
    0018's behaviour is **flagged, not made**.

---

## §0 — Locked decisions (binding input — adjudicated by founder, 2026-09-02)

These are decided. The Architect (J1) **encodes** them in ADR 0026 and names their losers; it does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**.

**Locked (L):**

- **L-1 — Session 33 ships the outcome loop and nothing that consumes it beyond generation.** *In scope:*
  the dimension taxonomy tagged at generation; the normalisation baseline; the extractor writing
  `performance_memory` from real metrics; the minimum-n floor, confidence and interval; decay and
  re-confirmation for outcome patterns; the campaign retrospective and its write-back; and making the
  north-star metric computable. *Out of scope, explicitly:* **deliberate experimentation / organic A-B
  testing**; **business-outcome attribution beyond UTM and conversion events with stated confidence**;
  **memory-driven opportunity cards**; **cross-type retrieval and any additional memory writer beyond this
  session's one** (Session 34); **comment mining**; **embeddings**; **any change to ADR 0018's
  diff-learning behaviour**; **image generation**; **autonomous anything**. If a step appears to need any
  of these, **STOP and report**.

- **L-2 — Patterns are probabilistic claims, never rules.** Every promoted pattern carries its **n** and
  its confidence, and renders in a prompt as *"based on 7 posts"*. The strategy doc's own formulation is
  binding: *"we believe technical comparison posts perform well for CTO audiences based on three
  campaigns"* — never a weak pattern promoted to a permanent truth. Loser: emitting patterns as
  instructions, which is how a six-post coincidence becomes a permanent constraint on every future post.

- **L-3 — Normalise before comparing. Never absolute counts, never cross-business.** A post is compared
  against **that brand's own trailing baseline for the same platform** (engagement rate versus rolling
  median). Loser: raw impressions — dominated by follower count and posting time, so it would mostly learn
  "posts published when we had more followers did better."

- **L-4 — Dimensions are tagged AT GENERATION, never retroactively.** Tagged at generation the data is
  exact and free; tagged afterwards it is inference about inference. This extends
  `generate.ts:303`'s existing *"assigned before generation, not discovered after"* principle (Reality §4).
  Loser: a retroactive classifier over historical posts — cheaper to ship, and it would silently poison
  the store the whole session exists to fill. **What happens to already-published untagged posts, and to
  Session 32's imported ones, is Q1 — but the answer may not be "guess."**

- **L-5 — Imported-derived patterns are labelled as such, permanently.** Session 32's provenance marker
  propagates: a pattern computed over backfilled posts is a weaker claim than one computed over posts SOSH
  published and measured itself, and the two must never be indistinguishable. Loser: merging them at the
  pattern layer, which would launder imported data into earned evidence in one step.

- **L-6 — The campaign retrospective ships in this session, and it is what makes the north-star metric
  true.** A campaign's hypothesis is scored against its outcome and the result is written to memory.
  Loser: deferring it and continuing to report a north-star metric that measures an unwired loop.

- **L-7 — Attribution honesty is a constraint, not a disclaimer.** Business-outcome attribution (signups,
  pipeline) stays weak; UTMs and conversion events are used, and results are **presented with confidence
  levels**. Loser: any surface that implies causal precision the data cannot support — this is the single
  most tempting dishonesty available to an analytics feature, and it is prohibited with a test.

- **L-8 — GDPR, tenancy and RLS obligations in full.** Every new business-scoped table: RLS in the
  InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))` form, `USING` **and**
  `WITH CHECK` on every UPDATE, `ON DELETE CASCADE` from `businesses`, **a row in ADR 0010 Amendment 2
  §D2.5's cascade table**, and `purge_business` coverage. If no new table ships, the ADR **says so
  explicitly** (Session 28-D D7 precedent).

- **L-9 — Contract discipline + constitution rules, inherited by every step.** DB only via `lib/db/` +
  `lib/memory/` (`MEM-NO-DIRECT-TABLE-ACCESS` holds); Anthropic SDK only via `lib/ai/`; **Zod** on every
  Server Action and route input; **atomic** state transitions by conditional `WHERE`; every list query
  **bounded + explicit `ORDER BY`** matching an index; **date-fns**; **no `any`**; **no `console.*`**
  outside the single-canonical-tick-line worker carve-out; env only via `lib/config.ts`; service-role
  never in a user-facing read path; **i18n en/pt/es simultaneously**; and **SHARED-FUNCTION CALLERS** for
  every existing function touched — `lib/db/memory-performance`'s writers now have two callers, which is
  exactly the shape of both Session 22 blockers.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | Where dimensions come from | **tagged at generation** | a retroactive classifier (cheap, and it poisons the store this session exists to fill) |
| D-2 | Comparison basis | **the brand's own trailing baseline, per platform** | absolute counts (learns follower growth, not content quality); cross-business benchmarks (different audiences, no shared baseline) |
| D-3 | Promotion rule | **minimum-n floor + confidence interval, both rendered** | promote-on-any-signal (six posts become a permanent rule — astrology with a schema) |
| D-4 | Second writer to `performance_memory` | **a distinct extractor, provenance-separated from `lib/learning/*`** | folding outcome extraction into the existing edit-signal pipeline (conflates taste with outcome, and neither can be attributed afterwards) |
| D-5 | Retrospective | **ships here** | deferring it (leaves the north-star metric measuring an unwired loop) |
| D-6 | Business attribution | **UTM + conversion events, with stated confidence** | implied causal precision (the most tempting dishonesty an analytics feature offers) |
| D-7 | Imported-derived patterns | **permanently labelled** | merging at the pattern layer (launders imported data into earned evidence) |

---

## §0.1 — Questions the Architect (J1) must resolve IN the ADR (BINDING)

**J1's ADR must decide each one explicitly, name the loser, and tier the resulting constraint** (ADR 0015
§2). Ground every answer in the real seams — let the single `ecc:code-explorer` sweep map them and cite
`file:line`.

- **Q1 — The dimension taxonomy (the load-bearing question).** The **exact list** — candidates are topic,
  format, proof type, funnel stage, opening type, length band, CTA presence, and origin mode (`manual` /
  `objective_generated` / `signal_generated` / `studio_promoted`) — with each dimension justified by a
  question it lets the system answer. Where each is stored, and whether it extends the existing
  post-tagging seam (Reality §4) or needs a new column/table. Which are **derivable deterministically at
  generation** and which need the model to state them as part of its output (the latter interacts with
  Session 31's structured-output work — say how). And the question L-4 forces: **what happens to posts
  already published without tags, and to Session 32's imported posts** — tag going forward only, tag
  imports at import time, or something else. "Guess retroactively" is excluded by L-4; if the answer
  narrows the session's near-term usefulness, say so plainly rather than reaching for the classifier.

- **Q2 — Normalisation, the n floor, and confidence (L-2, L-3).** The baseline's definition: which metric,
  which window, which platform grouping, and how a brand with fewer than a handful of posts is handled.
  **k, the minimum n, as a literal number**, with the reasoning — and what the system does with a pattern
  sitting below it (held, discarded, or surfaced as provisional-and-unused). The confidence computation
  and how it maps onto `lib/memory/scoring.ts`'s existing `confidence` field. How **n is rendered into the
  prompt** (L-2), and how that interacts with `lib/memory/performance.ts`'s deliberate omission of
  `likes`/`impressions` for governed rows (Reality §3, MINOR-2) — do not re-introduce the zero that
  correction removed.

- **Q3 — The extractor: where it runs and how it coexists with `lib/learning/*` (Reality §2, D-4).**
  Whether it extends `lib/metrics/orchestrator.ts`, joins `app/api/cron/sync-metrics`, or becomes its own
  worker — argued, with the cost and the tick-line posture. What it writes and at which cadence.
  Deterministic versus model-derived, per step (L-8's Stage-B posture from Session 32 applies here too).
  **And the design problem D-4 names:** `performance_memory` gains a second writer. State how the two are
  distinguished in the row itself, whether they share `pattern_key` semantics
  (`lib/learning/pattern-key.ts` and the partial UNIQUE index), what happens when both produce a pattern
  for the same key, and the **SHARED-FUNCTION CALLERS** table for every `lib/db/memory-performance`
  function now called from two places.

- **Q4 — Decay and re-confirmation for outcome patterns (Reality §5).** Which timestamp drives
  `recency_at` for a pattern aggregated over posts spanning months. The expiry policy, and what
  re-confirmation means when new posts either support or contradict a live pattern — including the
  contradiction case, which is the one that matters: a pattern that was true and has stopped being true is
  more dangerous than one that was never true, because it has accumulated confidence. Follow ADR 0016's
  `expires_at` or ADR 0018's 90-day decay and **say which**.

- **Q5 — The campaign retrospective and the north-star metric (L-6, Reality §7, §8).** **First, verify
  whether the frozen brief actually carries a `hypothesis` and `success criteria`** — Reality §7 flags
  this as unconfirmed. If it does not, state whether adding them is in scope here or is an ADR 0017
  amendment to be **flagged, not made**. Then: what the retrospective evaluates, when it runs (campaign
  completion? a fixed window after the last post?), what it writes to memory, and whether it is
  deterministic, model-assisted, or human-confirmed. Finally, make *"successful campaign learning cycles
  completed per active brand"* **computable** — define a "cycle" in terms of rows and state where the
  number is read from.

- **Q6 — Provenance across the two sources (L-5, Reality §6).** How Session 32's marker propagates from
  imported posts into a derived pattern. Whether a pattern may mix imported and earned observations, and
  if so how it is labelled and whether the n floor differs. What a reader of `performance_memory` sees.
  State the rule a future session can apply without re-deriving it.

- **Q7 — What the human sees, and attribution honesty (L-7).** Where outcome patterns surface (the
  approval gate? a campaign view? both?) and in what language — *"based on 7 posts"*, not *"founder
  stories perform 4× better"*. The retrospective's presentation. The UTM/conversion posture and the
  **explicit confidence framing**, with the prohibited framing named so it is testable rather than
  aspirational. Every state (no patterns yet, below-n patterns, live patterns, a contradicted pattern, a
  retrospective pending). Server Component page + Client interaction split; Zod on every Server Action;
  shadcn v4 / Base UI (**no `asChild` on `Button` or `DropdownMenu` primitives**); Tailwind only; i18n
  en/pt/es simultaneously.

- **Q8 — Test plan across the tiers, and the one measurement that proves the loop works.** **Tier 1**
  (live Postgres) for any new table's RLS/cascade/`purge_business`, the two-writer interaction on
  `performance_memory`'s partial UNIQUE index, and the atomic promotion path. **Tier 2** for the
  taxonomy's tagging at generation, the normalisation arithmetic, the n floor (**a test that a
  below-floor pattern is not promoted, and that can actually fail**), the confidence computation, decay
  and contradiction handling, and the retrospective. **Tier 3** for properties of absence — no retroactive
  tagging anywhere in the diff, no change to ADR 0018's behaviour, no cross-business comparison, no
  additional memory writer beyond this session's one — enumerated as such. **And the measurement:**
  `MEASURED`, never `COVERED` (ADR 0015 Amendment B) — **prediction accuracy**: do posts matching a
  promoted pattern actually outperform the brand's baseline? State the protocol, the earliest date it
  could produce a number, and the honest admission that this session ships the loop without yet being able
  to prove it predicts anything.

Where a J1 answer and this build-guide disagree, **the ADR wins once written** — but J1 must not silently
contradict a §0 Locked decision; if it needs to, it **STOPS and flags for founder adjudication**.

---

## §0.2 — Founder adjudications

> **AWAITING THE ARCHITECT — this section is the Builder's gate; J2 does not start without it.**
>
> Recorded here in the Sessions 22–30 form, **before** §2 is authored:
> `| # | Question | Decision | Where encoded |`, rows `A-1 … A-n`.
>
> **Most likely escalations:** Q5's finding on whether the brief carries a hypothesis at all (if not,
> adding one is an ADR 0017 amendment and a founder call); Q1's answer for already-published untagged
> posts, which may narrow the session's near-term usefulness; and Q3's two-writer resolution if it needs a
> schema change to `performance_memory`'s existing pattern-key index.
>
> Where an adjudication goes **against** J1's recommendation, the recommendation is **preserved in the ADR
> and the reasoning recorded here** — nothing is rewritten in place. A revised ruling gets a prime with
> both visible. Closes by naming any constraints the adjudications added and ADR 0026's total count.

---

## §1 — Architect session (J1)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **one document and no code**:
`docs/decisions/0026-outcome-loop.md` (Accepted). No `.ts`, no `.sql`, no `.tsx`. Any code attempted here
is discarded. The last action is a single confirmation line, then `/exit`.

**ECC budget for this phase — four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the closed file list, then **exactly three** advisory reviewers dispatched **once, in a single
parallel batch**, after the draft answers exist. No iterative re-consultation.
`ecc:architecture-decision-records`, `claude-mem`'s `mem-search` and `ecc:cost-aware-llm-pipeline` are
skills, are free, and do not consume the budget — ⚠️ the last of these is a **SKILL in this install, not
an agent** (the Session 28 error). `impeccable` / `taste-skill` are **not** invoked — J1 specifies the Q7
UX contract; the Builder runs them against it.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 33 — The outcome loop: dimension tagging, pattern extraction, campaign retrospective. ARCHITECT
phase (Track J). You produce ONE artefact and NO code:
  docs/decisions/0026-outcome-loop.md (status: Accepted)
No .ts, no .sql, no .tsx. If you catch yourself writing a migration, an extractor, or a scoring function,
stop: that is the Builder's job (J2), and the constitution requires Architect-attempted code to be
discarded.

PREREQUISITE — verify before anything else. Session 32 (Track I, ADR 0025) must have CLOSED. Without the
backfill there is no n: a new customer would need roughly six months of publishing before any pattern
clears a minimum-n floor, so every constraint here would ship untestable against real data. If Session 32
is open, STOP and say so.

VERIFY FIRST, BEFORE DESIGNING (this changes Q5's scope): does the frozen campaign brief actually carry a
HYPOTHESIS and SUCCESS CRITERIA today? The strategy doc specifies both; ADR 0017 may not have shipped
them. Report what you find. If they are absent, adding them may be an ADR 0017 amendment to be FLAGGED,
not made — that is a founder adjudication, not your call.

ECC BUDGET — FOUR subagent invocations for this whole phase. Stay inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. file:line citations and the shape of
   each seam — nothing else.
2. Skills are free: ecc:architecture-decision-records for structure; claude-mem's mem-search for
   prior-session context; ecc:cost-aware-llm-pipeline as a SKILL for the extractor's cost posture.
3. AFTER you have draft answers to the eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - database-reviewer — on Q3 and Q4, the sharpest structural risk in the session. performance_memory
     gains a SECOND writer alongside lib/learning/*. Ask specifically about the partial UNIQUE index from
     20260726020000_performance_memory_pattern_key.sql and the promotion SQL in
     20260726030000_performance_memory_promotion.sql: what happens when two writers produce a pattern for
     the same key, whether the existing index survives, whether provenance belongs in the key or beside
     it, and how a contradicted pattern is demoted atomically.
   - ecc:mle-reviewer — on Q1 and Q2. Whether the proposed dimension taxonomy can actually support the
     claims the product wants to make; whether the normalisation baseline is sound for small n; whether
     the minimum-n floor and confidence computation are statistically honest at the volumes this product
     sees (roughly 50 posts a month on the Plus plan); and whether Q8's prediction-accuracy protocol could
     ever produce a trustworthy number. Ask it to be blunt about which claims are unsupportable.
   - ecc:pr-test-analyzer — on Q8 ONLY. Whether the n-floor test can actually fail, whether the
     contradiction/decay path is testable at all, and whether Tier-3's properties of absence (no
     retroactive tagging; no change to ADR 0018's behaviour) are expressible as executable scans rather
     than review comments.
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.
DO NOT invoke impeccable or taste-skill — you SPECIFY the Q7 UX contract; J2 runs them against it.

Read now, before anything else:
- docs/build-guide/session-33.md — the Reality block, section 0 (Locked L-1..L-9 + the D-1..D-7 ledger)
  and section 0.1 (Q1..Q8). This is your binding input.
- docs/brainstorm/ai-quality-track-ideas-and-build-path.md — Part II section 11 in full (this session),
  section 12 (Session 32, which you depend on for n), and section 14's dependency chain. Section 10
  (many writers, cross-type retrieval) and section 13 (memory-driven cards) are LATER sessions and belong
  in your deferred list.
- docs/decisions/0018-diff-based-learning-capture.md — ALL of it. It owns the OTHER writer to
  performance_memory, and you must not change its behaviour.
- docs/decisions/0016-governed-memory.md — the governance fields, confidence, recency, expiry,
  MEM-NO-DIRECT-TABLE-ACCESS, and the active-only rule for performance_memory.
- docs/decisions/0017-mode-2-upgrade.md — Stage A brief assembly and the frozen brief. Q5 depends on what
  it actually shipped.
- docs/decisions/0025-social-read-path-and-backfill.md — Session 32's provenance marker, which Q6
  propagates.
- docs/decisions/0015-test-execution-and-ci-gates.md — section 2 and Amendment B (MEASURED never COVERED),
  which governs how you may describe Q8's prediction-accuracy protocol.
- docs/brainstorm/Chat/ai-social-media-manager-platform-strategy.md — section 2 (the campaign object,
  hypothesis, success criteria), section 7 (the analytics hierarchy), and "The metrics I would obsess
  over" (the north-star metric Q5 must make computable).
- CLAUDE.md — DB-access rules, atomic transitions, the worker console.log carve-out, Zod, i18n, bounded
  queries, the RLS/erasure-cascade obligation, and SHARED-FUNCTION CALLERS.

The CLOSED file list for the ONE ecc:code-explorer sweep — map these, cite file:line, nothing beyond:
- lib/metrics/orchestrator.ts + app/api/cron/sync-metrics/ — what it writes today (upsertPostMetrics and
  nothing else) and its tick-line shape.
- lib/db/post-metrics.ts — the metrics row: which fields exist, and what a baseline could be computed from.
- lib/learning/orchestrator.ts + promote.ts + summarize.ts + classify.ts + pattern-key.ts — the EXISTING
  writer to performance_memory, its pattern key, and its promotion path.
- supabase/migrations/20260726020000_performance_memory_pattern_key.sql and
  20260726030000_performance_memory_promotion.sql — the partial UNIQUE index and the promotion SQL.
- lib/db/memory-performance.ts + lib/memory/performance.ts — the write surface, the fallback branch and
  its comment, and the MINOR-2 / MINOR-3 corrections (null platform kept; likes/impressions OMITTED not
  zeroed). Do not re-introduce what those corrections removed.
- lib/memory/scoring.ts + constants.ts — confidence, recencyDecay, isEligible, rankAndCap, PERFORMANCE_CAP.
- lib/campaigns/generate.ts — the post-tagging seam at :303 (order from the frozen roleSequence) that Q1
  extends, and lib/campaigns/consistency.ts's positional cross-check.
- lib/db/campaigns.ts + the frozen brief type in lib/db/types.ts — REPORT whether hypothesis and success
  criteria exist as fields. This is the VERIFY-FIRST item.
- app/api/cron/ — the worker pattern and the cron inventory.

Do NOT write the ADR yet. First OUTPUT your answers to the eight section-0.1 questions (Q1 the dimension
taxonomy, Q2 normalisation/n-floor/confidence, Q3 the extractor and the two-writer problem, Q4
decay/re-confirmation/contradiction, Q5 the retrospective and the north-star metric, Q6 provenance across
sources, Q7 the UX contract and attribution honesty, Q8 the test plan and prediction accuracy), EACH with
its named loser and its ADR 0015 tier, AND a one-line note on any place a section-0 Locked decision
constrains the answer. Report the VERIFY-FIRST finding explicitly. Flag if any answer needs: a change to
ADR 0017's brief schema, a change to ADR 0018's behaviour, a schema change to performance_memory's
existing index, a new dependency, or a narrowing of scope because untagged historical posts cannot be
used — those are founder adjudications, not your call. Then STOP for acknowledgement.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 33. Write docs/decisions/0026-outcome-loop.md (status: Accepted). Ground every claim in
the real repo (cite file:line from the ecc:code-explorer sweep). You have already dispatched your ONE batch
of three advisory reviewers — fold their objections in now, or record why you rejected them. Do not
re-consult them.

1. Context + decision summary. State the finding precisely, with its three citations: the metrics worker
   writes only post_metrics (lib/metrics/orchestrator.ts:82); performance_memory's only writer is the
   edit-signal pipeline (lib/learning/*); and retrieval always takes the fallback branch
   (lib/memory/performance.ts's own comment). Then the consequence stated plainly: the closed loop is a
   TASTE loop running before publication, and the OUTCOME loop has never been wired. Include the naming
   trap — a table called performance_memory written by the edit pipeline — because anyone planning off the
   schema alone will plan wrongly. Name the losers per section 0's D-1..D-7 ledger.

2. The dimension taxonomy (Q1, L-4) — the load-bearing section. The exact list, each dimension justified
   by a question it lets the system answer. Storage, and whether it extends the generate.ts:303 tagging
   seam or needs new schema. Deterministic-at-generation versus model-stated, and the interaction with
   Session 31's structured output. And the untagged-history answer, with "guess retroactively" named as
   the excluded loser — if this narrows near-term usefulness, say so rather than reaching for a classifier.

3. Normalisation, the n floor and confidence (Q2, L-2, L-3). The baseline definition and the small-brand
   case. k as a NUMBER with its reasoning, and the behaviour of a below-floor pattern. The confidence
   computation mapped onto lib/memory/scoring.ts's field. How n renders into the prompt — and confirm you
   have NOT re-introduced the literal zero that MINOR-2 deliberately removed. Fold in ecc:mle-reviewer's
   findings, including any claim it called unsupportable.

4. The extractor and the two-writer problem (Q3, D-4). Where it runs, argued, with cost and tick-line
   posture. What it writes, at what cadence, deterministic versus model-derived. Then the design problem:
   how two writers to performance_memory are distinguished in the row, whether they share pattern_key
   semantics and the partial UNIQUE index, what happens on a key collision, and a SHARED-FUNCTION CALLERS
   table for every lib/db/memory-performance function now called from two places. Fold in
   database-reviewer's findings.

5. Decay, re-confirmation and contradiction (Q4). Which timestamp drives recency for a pattern aggregated
   over months. Expiry policy — follow ADR 0016's expires_at or ADR 0018's 90-day decay and SAY WHICH. And
   the contradiction case in full: a pattern that was true and has stopped being true has accumulated
   confidence, which makes it more dangerous than one that was never true. State the demotion path and
   that it is atomic.

6. The campaign retrospective and the north-star metric (Q5, L-6). Report the VERIFY-FIRST finding on
   hypothesis and success criteria, and if they are absent state whether adding them is in scope or is an
   ADR 0017 amendment to be FLAGGED. What the retrospective evaluates, when it runs, what it writes, and
   whether it is deterministic, model-assisted or human-confirmed. Then make "successful campaign learning
   cycles completed per active brand" COMPUTABLE — a cycle defined in rows, and where the number is read
   from. State plainly that until this ships, the metric measures a loop that is not fully wired.

7. Provenance across the two sources (Q6, L-5). How Session 32's marker propagates into a derived pattern;
   whether a pattern may mix imported and earned observations and how it is then labelled; whether the n
   floor differs; and the rule a future session applies without re-deriving it.

8. The UX contract the Builder is held to — you SPECIFY it, you do not design it (Q7, L-7): where patterns
   surface and in what language ("based on 7 posts", never "founder stories perform 4x better"); the
   retrospective's presentation; the UTM/conversion posture with explicit confidence framing and the
   PROHIBITED framing named so it is testable; every state (no patterns, below-n, live, contradicted,
   retrospective pending); Server Component page + Client interaction split; Zod on every Server Action;
   shadcn v4 / Base UI with NO asChild on Button or DropdownMenu primitives; Tailwind only; i18n en/pt/es
   simultaneously.

9. GDPR + tenancy (L-8). Any new business-scoped table: RLS in the InitPlan-wrapped form with USING and
   WITH CHECK on UPDATE, ON DELETE CASCADE from businesses, the ADR 0010 Amendment 2 section D2.5 cascade
   row VERBATIM, and purge_business coverage. If none, say so explicitly (Session 28-D D7 precedent).

10. Test plan across the tiers (Q8). Tier 1, Tier 2, Tier 3 enumerated as properties of ABSENCE (no
    retroactive tagging in the diff; no change to ADR 0018's behaviour; no cross-business comparison; no
    memory writer beyond this session's one). Then the prediction-accuracy protocol — MEASURED, never
    COVERED — with the earliest date it could produce a number and the honest admission that this session
    ships the loop without yet proving it predicts anything. Fold in ecc:pr-test-analyzer's findings.

11. A constraint table: every OUTCOME-* constraint, its tier, and the test that proves it — the Reviewer's
    checklist. Cover at least: OUTCOME-DIMENSIONS-TAGGED-AT-GENERATION, OUTCOME-NO-RETRO-TAGGING,
    OUTCOME-NORMALISED-TO-OWN-BASELINE, OUTCOME-MIN-N-ENFORCED, OUTCOME-CONFIDENCE-RENDERED,
    OUTCOME-NO-ZERO-METRICS-REINTRODUCED, OUTCOME-TWO-WRITERS-DISTINGUISHED, OUTCOME-KEY-COLLISION-DEFINED,
    OUTCOME-CONTRADICTION-DEMOTES-ATOMIC, OUTCOME-PROVENANCE-PROPAGATED, OUTCOME-RETROSPECTIVE-WRITES-BACK,
    OUTCOME-NORTHSTAR-COMPUTABLE, OUTCOME-ATTRIBUTION-CONFIDENCE-FRAMED, OUTCOME-ADR0018-UNCHANGED,
    OUTCOME-RLS-ISOLATED, OUTCOME-CASCADE-COMPLETE.

12. Explicit "deferred" section with the owning session named for each: deliberate experimentation / A-B
    testing and why volume gates it; business-outcome attribution beyond UTM; memory-driven cards;
    cross-type retrieval and additional memory writers (Session 34); comment mining; embeddings; and
    anything Q1-Q7 pushed to a follow-on.

Do NOT write code. End with one line: "ADR 0026 written and accepted — <n> OUTCOME-* constraints, <n>
dimensions, min-n <k>, baseline <definition>, extractor runs <where>, retrospective <trigger>, north-star
cycle defined as <definition>, hypothesis fields <present|absent|flagged>." Then /exit.
```

**Gate:** do not author §2 until ADR 0026 exists and is Accepted, the eight §0.1 answers are on the record,
and any founder adjudication is recorded in §0.2. Then author §2/§3 below from the accepted ADR's real
`OUTCOME-*` constraint names.

---

## §2 — Builder session (J2)  ·  (paste into Claude Code · Sonnet)

> **PLACEHOLDER — authored after ADR 0026 is Accepted and §0.2 exists (or is recorded as "no adjudications
> required").** Builder steps are written from the ADR's *real* constraint names; written earlier they cite
> constraints that do not exist yet.
>
> **Will contain:** **§2a** a Builder primer (pasted first, ends by stopping for acknowledgement) carrying
> the §0 Locked list, the §0.2 adjudications, the ADR decisions J2 **transcribes rather than re-derives**
> (the dimension list, k, the baseline definition, the key-collision rule, the retrospective trigger), the
> scope tripwires below, and the verification loop (`npx tsc --noEmit --skipLibCheck` +
> `npx vitest run lib/db lib/social lib/validation` plus this session's paths — never bare
> `npx vitest run`). Then **§2b**, one paste block per step, each a self-contained
> `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle naming the constraints it closes and the
> test proving each.
>
> **Ordering, and its rationale:**
>
> 1. **`J2.0` grounding pass** — no code, no commit. Reality §2 (single writer) and Reality §7 (whether the
>    brief carries a hypothesis) are the two that change the session if they have drifted.
> 2. **Dimension tagging FIRST, before any extraction.** Nothing downstream can be computed over untagged
>    posts, and tagging is the only step that must be in place before posts are generated rather than
>    after — every day it is delayed is a day of untaggable output.
> 3. **The migration and the two-writer distinction before the extractor**, because a row written without
>    provenance cannot be corrected afterwards (L-5) and a half-marked store is worse than an unmarked one.
> 4. **The baseline and the n floor before promotion**, so the first promotion that ever runs is already
>    gated. A pattern promoted below its floor is a correctness bug, not a tuning issue.
> 5. **Then promotion, then contradiction/demotion** — the demotion path is the branch most likely to be
>    left untested, and it is the one that protects the store from accumulated-confidence rot.
> 6. **The retrospective**, then the north-star computation, then the surfaces.
> 7. **Tier-3 enumeration, coverage verification, close-out.**
>
> **Scope tripwires as executable scans, not review comments:** `OUTCOME-NO-RETRO-TAGGING` (no classifier
> over historical posts anywhere in the diff); `OUTCOME-ADR0018-UNCHANGED` (`lib/learning/*` behaviour
> byte-identical for its existing paths); a scan proving **no cross-business query** exists; a scan proving
> **no third memory writer** was added (L-1); and `OUTCOME-NO-ZERO-METRICS-REINTRODUCED` (the MINOR-2
> correction in `lib/memory/performance.ts` is not undone).

---

## §3 — Reviewer session (J3)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored after ADR 0026 is Accepted, alongside §2.** The checklist *is* the ADR's
> constraint table; only the commit range is filled in at run time, by the Reviewer itself.
>
> **Will contain:** **§3a** a Reviewer primer (ends by stopping for acknowledgement), then **§3b** the
> Reviewer prompt.
>
> **Binding process rules the section must carry:**
>
> - **`PROC-REVIEW-AT-COMMIT`** — read every file **at the stated commit range**, never at HEAD, and
>   **open the report by naming the exact range**; a report that does not name its range is not a valid
>   review (Session 21B's false-positive MAJOR came from reading at HEAD).
> - **`SHARED-FUNCTION CALLERS`** — every `lib/db/memory-performance` function now has **two** callers
>   (`lib/learning/*` and this session's extractor). This is precisely the shape of both Session 22
>   blockers. `git grep` each and list, per caller, which test exercises it; a caller with no listed test
>   is `AUTHORED-NOT-EXECUTED` for that caller even if the other is fully covered.
> - **The coverage-count rule** — verify each constraint is **executed green in CI at the head it is dated
>   to**; do not accept a claimed total (Session 28's false "29/29").
> - **Tier-E language** — prediction accuracy is `MEASURED`, never `COVERED`, and any number reported
>   before the loop has run long enough must say so.
>
> **The findings this session is most likely to produce:** an n-floor test that cannot actually fail; a
> demotion path with no coverage; a key collision between the two writers that the partial UNIQUE index
> resolves silently and wrongly; a re-introduced literal zero in the governed-pattern read path; and a
> north-star definition that is prose rather than a computable query.

---

## §4 — Correction pass (Session 33-D)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored ONLY after J3 has run and `docs/reviews/session-33-reviewer.md` exists.** A
> correction pass responds to findings; inventing them ahead of time produces a fictional resolution log.
>
> **Will contain:** founder adjudications arising from the review → *"What the Reviewer found (summary —
> `docs/reviews/session-33-reviewer.md` is authoritative)"* → ordering rationale → where resolutions go →
> **§4.0** primer → **§4.1** steps (`D0 … Dn`, one paste block each) → **§4.2** resolution log → **§4.3**
> close-out. **`D0` is always the audit-trail step** — land the governing documents in git first.
>
> **Where resolutions go — `REVIEWER-REPORT APPEND-ONLY` (CLAUDE.md, revised Session 23-D). All four
> conditions bind:** (1) **no in-place edit, ever** — not one character of the Reviewer's text changes;
> (2) **one appended, attributed `## CORRECTION PASS (Session 33-D)` section** at the end of the
> reviewer's own file, opening with author, date and the commit range fixed, so a reader can tell from any
> line which of the two wrote it; (3) **findings referenced by ID, never restated as resolved** — record
> *finding → fix → the test that now proves it → the commit SHA*; (4) **a disputed or withdrawn finding is
> argued in the appendix, not erased**. The Session 22-D failure (RESOLVED verdicts written *into* the
> reviewer's findings) remains prohibited under condition 1.

---

## §5 — Docs to update at close-out (Track J done)

- [ ] `docs/decisions/0026-outcome-loop.md` — Accepted, final constraint table, real post-correction counts
      verified executed green in CI at the head they are dated to.
- [ ] `docs/decisions/0018-diff-based-learning-capture.md` — a note recording that `performance_memory` now
      has a second writer and that ADR 0018's own behaviour is unchanged, with the test that proves it.
- [ ] `docs/decisions/0017-mode-2-upgrade.md` — **only if** the hypothesis/success-criteria fields were
      added under a founder adjudication; otherwise a note recording that they were flagged and deferred.
- [ ] `docs/current-phase.md` — Session 33 entry; the `db-tests` tally with its event type; the north-star
      metric restated as **computable**, with the date from which it is meaningful; prediction accuracy
      framed as `MEASURED` with its earliest-useful date.
- [ ] `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — cascade row(s), or an explicit
      no-new-row note.
- [ ] `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` — §11 marked shipped; §1's diagnosis
      corrected (it describes the pre-Session-33 state and becomes wrong the moment this lands); §14's
      dependency chain updated.
- [ ] `docs/backlog.md` — deliberate experimentation with its volume trigger; anything else J1 deferred.
- [ ] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md`.
- [ ] `docs/reviews/session-33-reviewer.md` — exists, names its commit range, carries one appended
      correction-pass section.

**Next:** `docs/build-guide/session-34.md` — Track K, agency in generation (ADR 0027): read-only tools for
the generator, claim verification against evidence memory, and the campaign planner that reasons about the
role sequence rather than only filling it.
