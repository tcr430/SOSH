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

> **RECEIVED 2026-09-19 (founder, in the J1 session).** Recorded below; the original placeholder text is kept
> beneath it for the record.

| # | Question | Decision | Where encoded |
|---|---|---|---|
| A-1 | The frozen brief carries **no** hypothesis or success criteria (VERIFY-FIRST: `CampaignBriefContent`, `lib/db/types.ts:1300-1307`; zero repo hits) | **Option A** — ADR 0017 Amendment C adds `hypothesis` (≤ 300) and structured `successCriteria` `{metric: win_rate\|median_lift, target, evaluationWindowDays}`; pre-amendment briefs use a labelled implicit hypothesis | ADR 0026 §8.1 |
| A-2 | `performance_memory` schema: `source` + `dimension` CHECK widening, namespace CHECKs, outcome stats columns, sibling partial UNIQUE, narrowed authenticated writes | **Approved** — the existing distilled partial UNIQUE index is **unchanged** | ADR 0026 §5 (ADR 0016 Amendment C) |
| A-3 | `fetchPostMetrics` throws `NOT_IMPLEMENTED` on X and LinkedIn — the loop has no input | **Implement it in this session** as ADR 0028 Amendment A and the **first** Builder step; sync cadence becomes day 1/3/7 (not hourly); verified endpoints only; LinkedIn falls back to `NOT_IMPLEMENTED` if counts are unreadable under current scopes | ADR 0026 §3 |
| A-4 | Imported/backfilled posts cannot be dimension observations (L-4; 30-day staging TTL; LinkedIn imports lack metrics) | **(a) Accept** — patterns learn only from SOSH-published posts; imports contribute only a stamped X baseline seed. Option (b) (retain measured facts of imports) **declined** | ADR 0026 §6.3, §9 |
| A-5 | No UTM / conversion-event infrastructure exists | **No business attribution this session**; surfaces say "engagement, not signups". UTM auto-tagging queued with T1-B; conversion ingestion is a later track | ADR 0026 §10.3, §15 |
| A-6 | New `AFTER INSERT` trigger on ADR 0018's `post_ai_originals`; optional `hookType` in ADR 0024's output schemas | **Approved** — `lib/learning/**` and ADR 0018's migrations stay byte-identical; `AI_ORIGINAL_SCHEMA_VERSION` not bumped | ADR 0026 §4.2, §4.3 |

**No adjudication went against J1's recommendation.** Constraints added by the adjudications:
`OUTCOME-METRICS-FETCH-REAL`, `OUTCOME-METRICS-CADENCE-BOUNDED` (A-3), `OUTCOME-HYPOTHESIS-IN-BRIEF` (A-1),
`OUTCOME-SEED-BASIS-MATCH` (A-4), `OUTCOME-HOOKTYPE-ADDITIVE` (A-6). **ADR 0026 total: 35 `OUTCOME-*`
constraints.**

> *Original placeholder, preserved:*
>
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

**✅ AUTHORED 2026-09-19 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Gate satisfied: `docs/decisions/0026-outcome-loop.md` is
**Accepted**, carrying **35 `OUTCOME-*` constraints** (18 rows with a Tier-1 component · 20 with a Tier-2
component · 8 with a Tier-3 component · 1 Tier E — rows are mixed-tier, so these overlap); `§0.2` records
**A-1 … A-6**, none against J1's recommendation.

**Audit-trail precondition — before `J2.0` is pasted.** At authoring time ADR 0026 is **untracked** and
`session-33.md` carries uncommitted edits. Both are committed **first, as their own docs-only commit** (the
untracked `step-2/.impeccable/` directory and `supabase/.temp/cli-latest` are **not** part of it), and that
commit's SHA is the `BASE` the Reviewer reads against and the base of `OUTCOME-ADR0018-UNCHANGED`'s path
check. The Builder works on its own branch, `session-33-adr-0026`, cut from the head where Session 32 closed
(`859fd73f`), or from `master` if PR #9 has merged by then.

**Six places where the ADR overrode the placeholder above, stated first because a Builder reading only the
placeholder would build the wrong session:**

1. **The first code step is the metrics input, not tagging.** ADR §1.2 item 1: `fetchPostMetrics` throws
   `NOT_IMPLEMENTED` on both native providers, so `post_metrics` receives no real rows. Founder ruling
   **A-3** makes the real fetch and the day-1/3/7 cadence **the first Builder step** (`J2.1`). Tagging still
   precedes everything in `lib/outcomes/`.
2. **This is the third writer, not the second** (ADR §1.1 item 2 — Session 32's `importPerformanceMemory`).
   And the placeholder's *"every `lib/db/memory-performance` function now has two callers"* is **not true by
   design**: ADR §5.6 gives the outcome writer **its own functions**, so no existing writer gains a caller.
   The SHARED-FUNCTION CALLERS risk moves to `listPerformanceMemoryCandidates` (a read with two call paths
   that must now exclude outcome rows) and the three prompt render sites.
3. **Tagging is a database trigger on `post_ai_originals`, not an extension of `generate.ts:303` in TS.**
   Per-caller TS tagging is the named loser (`[test-BLOCKER-4]`, ADR §4.2): it would repeat the Session 22
   pattern of covering one caller and missing another.
4. **The floor lives in SQL.** Promotion and demotion are RPCs that recompute from `post_outcomes` and never
   trust a caller (ADR §5.4). So the placeholder's "baseline and floor before promotion" becomes: tables
   (`J2.3`), then the memory schema (`J2.5`), then the RPCs (`J2.6`), then the TS normaliser that writes
   observations (`J2.7`). The first promotion that ever runs in production is gated by construction, because
   nothing calls the RPCs until the worker (`J2.8`) exists.
5. **The hypothesis fields ARE in scope** (ruling A-1, ADR 0017 Amendment C, `J2.10`). The placeholder
   assumed they might be flagged and deferred.
6. **The "no cross-business query" tripwire is `OUTCOME-NO-CROSS-BUSINESS` and scans RPC *bodies*.** It
   lands last (`J2.13`) because its targets exist only then; the other tripwires land in `J2.2`, before the
   code they fence.

**The ADR decisions J2 TRANSCRIBES rather than re-derives.** Every one carries a named loser in ADR 0026; a
Builder that changes one has re-opened an adjudicated decision.

| Decision | Value | ADR |
|---|---|---|
| Metrics fields | X: `likes`, `comments`, `shares`, `impressions` (+ `saves`/`clicks` only if verified); `reach` **always null**. LinkedIn: `likes`/`comments`/`shares` **only if verified under current scopes**, else `NOT_IMPLEMENTED`; `saves`/`clicks`/`reach`/`impressions` **always null**. **No scope added.** | §3.1 |
| Sync cadence | due at **day 1, 3, 7** via `last_synced_at` vs `published_at`; **no new column**; `METRICS_MAX_AGE_DAYS` = **9**; hourly tick and tick line unchanged | §3.2 |
| Dimensions | **7**: `role`, `format`, `origin_mode`, `length_band`, `cta_present` **promotable**; `hook_type`, `proof_type` **descriptive only** | §4.1 |
| Tag storage | `post_dimensions`, PK `ai_original_id`, filled by an **`AFTER INSERT` trigger on `post_ai_originals`**, `ON CONFLICT DO NOTHING`, **no `EXCEPTION` block**, `BEFORE UPDATE` rejects, **no `BEFORE DELETE`**; latest revision applies | §4.2 |
| `hookType` | `z.enum([6]).nullish()` on three output schemas; **`AI_ORIGINAL_SCHEMA_VERSION` stays 1** | §4.3 |
| Length bands | X single `<100 / 100–220 / >220` chars · X thread `<4 / 4–6 / >6` segments · LinkedIn `<600 / 600–1,300 / >1,300` chars | §4.4 |
| History | copy `role`, `format`, `origin_mode` for existing snapshots; `hook_type` NULL; **imports never** | §4.5 |
| Row distinction | `source='outcome'`; key `outcome:<dimension>:<value>:<direction>:<platform>` and `outcome:hypothesis:<campaign_id>`; sibling partial UNIQUE; two namespace CHECKs; **distilled index unchanged** | §5.1 |
| CHECK widening | `source` + `'outcome'`; `dimension` + `role`, `origin_mode`, `length_band`, `cta`, `hypothesis`; **`NOT VALID` then `VALIDATE`** | §5.1 |
| Stats columns | `outcome_n`, `outcome_wins`, `outcome_distinct_campaigns`, `interval_low`, `interval_high`, `metric_basis`, `baseline_seeded`, each `CHECK ((col IS NOT NULL) = (source='outcome'))`; `contradicted_at` nullable | §5.3 |
| RPCs | **one** `wilson_bounds`; upsert takes **no stats parameters**; promote/demote are single conditional UPDATEs that recompute | §5.4 |
| Write protection | INSERT policy `AND source='manual'`; `BEFORE UPDATE` trigger allows only retire/`deleted_at` on non-manual rows | §5.5 |
| Outcome freeze | once, at day 7; grace **2** days; missed → **no row**, counted | §6.1 |
| Metric | X **rate** `(likes+comments+shares)/impressions`; LinkedIn **count** `likes+comments+shares`; null → **excluded**; X `impressions=0` → excluded | §6.2 |
| Baseline | X: 90-day own median, **≥ 8**; LinkedIn: last **20**, **≥ 8**; seed **X only, basis `rate` only**; `log_lift` clipped **[-3, 3]**, count floor **1**; **the gate uses `beat_baseline`** | §6.3 |
| Gates | **k = 10**, **≥ 3 campaigns**, **Wilson (z = 1.96) low > 0.5** (or high < 0.5); provisional row at **n ≥ 5** | §6.4 |
| Confidence | `wilson_low × n/(n+10)` (or `(1−wilson_high) × n/(n+10)`) | §6.4 |
| Retrieval | `listPerformanceMemoryCandidates` **excludes outcome rows**; `retrieveOutcomePatterns` caps at **3**; own prompt block, closed template; **three render sites**; "Top-Performing Post Snippets" untouched | §6.4 |
| Decay | window **180 days**; `last_confirmed_at` = newest **agreeing** observation; `expires_at` + **90 days** | §7.1–7.2 |
| Demotion | window bound fails **or** **≥ 4 of the last 5** contrary; `active → candidate`, `contradicted_at` stamped, never deleted | §7.3 |
| Brief fields | `hypothesis` ≤ 300; `successCriteria` `{win_rate ∈ [0.5, 0.95] \| median_lift ∈ [1.0, 3.0], evaluationWindowDays ∈ [7, 60]}`; pre-amendment → implicit hypothesis | §8.1 |
| Retrospective | due at last publish + `max(7, window)` days with no unpublished post left; `inconclusive` if n < 5; evaluated **once** | §8.2–8.3 |
| Write-back | acknowledgement writes **exactly one** `dimension='hypothesis'` row, `expires_at` + **365 days**, read **only by Stage A** | §8.4 |
| North-star | a cycle = an acknowledged supported/not-supported retrospective **with** its memory row; ÷ active brands, trailing 30 days; ops script only | §8.5 |
| Provenance | observations **only** from SOSH-published posts; seed stamped → `baseline_seeded`; **no mixed patterns** | §9 |
| UX | campaign detail page only; **not the approval gate**; no `/analytics`; every §10.2 state; §10.3 prohibited framing | §10 |
| Tables | three, SELECT-only RLS, no authenticated write policy, cascade from `businesses`, three §D2.5 rows **verbatim** | §11 |
| Worker | `extract-outcomes`, `0 4 * * *`, `capture-learning`'s dual-mode shape, the §14 tick-line keys, `OUTCOME_BATCH_SIZE` 200 | §14 |

**Ordering, restated as binding.** Each position is forced by something that breaks under the alternative.

1. **`J2.0` grounds and ships nothing.** Two premises change the session if they have drifted: whether any
   authenticated app code writes `performance_memory` (ADR §5.5 makes that a STOP), and whether ADR 0018's CTA
   rule function can be imported **without editing `lib/learning/`** (ADR §4.4 against
   `OUTCOME-ADR0018-UNCHANGED`).
2. **The metrics input (`J2.1`) first**, by ruling A-3.
3. **Boundary scans (`J2.2`) before the code they fence.** `lib/outcomes/` is created here with its constants
   file, so the scans have a real target and cannot pass vacuously.
4. **Tables and the tagging trigger (`J2.3`) before anything reads a dimension.** Every day tagging is
   delayed is a day of untaggable output (L-4). `hookType` (`J2.4`) follows, because the trigger already
   tolerates its absence.
5. **The `performance_memory` schema (`J2.5`) before the RPCs that write it (`J2.6`).** A row written without
   the namespace CHECKs and write protection cannot be corrected afterwards.
6. **RPCs (`J2.6`) before the normaliser (`J2.7`) and the worker (`J2.8`)**, so the floor exists before any
   code can call it.
7. **Retrieval and render (`J2.9`) after the worker**, so there is something real to retrieve.
8. **The brief amendment (`J2.10`) before the retrospective (`J2.11`)**, which scores the hypothesis it adds.
9. **Surfaces (`J2.12`) after every state they render exists.** The Tier-3 re-verification, the amendments and
   the constraint→CI map (`J2.13`) come last.

**Scope tripwires — executable, not prose:**

- **`OUTCOME-DETERMINISTIC-NO-LLM`**, **`OUTCOME-NO-RETRO-TAGGING`**, **`OUTCOME-NO-EXTRA-WRITER`** and the
  scan half of **`OUTCOME-NO-ZERO-METRICS-REINTRODUCED`** are source scans in `J2.2`.
- **`OUTCOME-ADR0018-UNCHANGED`**: `git diff BASE..HEAD -- lib/learning/ <ADR 0018 migrations>` is empty. It
  is a path check by ADR decision (`[test-3b]`) and lands in `J2.2`.
- **`OUTCOME-NO-CROSS-BUSINESS`** is wrapper tests plus an RPC-body scan, in `J2.13`.
- **L-1 out of scope — STOP and report:**
  - experimentation or holdouts;
  - UTM tagging or conversion ingestion (ruling A-5);
  - an analytics page;
  - cross-type retrieval, or merging outcome rows into the shared ranking;
  - any memory writer beyond `lib/outcomes/*`;
  - comment mining or embeddings;
  - any edit under `lib/learning/`;
  - a new OAuth scope;
  - a model call anywhere in the extractor.

**Each scan is demonstrated to REDDEN against a planted violation and then reverted.** A scan that has never
failed is a comment with a test runner attached.

**Definition of done for every step:**
- `npm run typecheck` clean.
- `npm run test:app` green.
- `npm run test:db` green wherever the step touches DB behaviour.
- Each named constraint **demonstrated to redden against the pre-fix code**, then reverted.
- One commit per step, its subject naming the step id and the constraints it closes.

**Never bare `npx vitest run`** — it picks up ECC test files that call `process.exit()`.

**ECC budget for the Builder phase — three subagent invocations, total.** Fourteen steps invite a reviewer
each; **don't**. Each spawn starts cold and re-reads what the Builder already holds, and the Reviewer (`J3`)
exists for that audit. Each of the three is placed where a second pair of eyes can find what the Builder's
own tests structurally cannot:

- **One `ecc:code-explorer`** in `J2.0`, over that step's closed file list and no other.
- **One `ecc:database-reviewer`** at the end of `J2.6`, **before `J2.6` commits**, over the four migrations
  of `J2.1`, `J2.3`, `J2.5` and `J2.6`. This session's sharpest risk is in SQL:
  - three `SECURITY DEFINER` RPCs that gate promotion;
  - a trigger inside ADR 0018's write path;
  - CHECK widenings on a populated table.

  Findings against an already-committed migration are fixed by a **forward migration inside `J2.6`**.
- **One `ecc:security-reviewer`** at the end of `J2.11`, **before it commits**. It covers how member-controlled
  text (hypothesis, note, campaign name) and member privileges reach `performance_memory` and a generation
  prompt:
  - the `J2.5` write protection;
  - the `J2.6` acknowledge RPC;
  - the `J2.9` render;
  - the `J2.10` brief action;
  - the `J2.11` action.
- **Deliberately not invoked:**
  - `ecc:mle-reviewer`. Its findings are already folded into ADR §6 and §12.4. The statistics are transcribed, not re-derived, and consulting it again would re-argue a settled ADR.
  - `ecc:pr-test-analyzer` and `ecc:typescript-reviewer`. That audit is `J3`'s job.
  - Any subagent for the repetitive i18n or render-site work.

**Skills are free and do not count:**
- `/ecc:plan` → `/ecc:tdd-workflow` → `/ecc:verification-loop` on every code step.
- `supabase:supabase-postgres-best-practices` in `J2.1`, `J2.3`, `J2.5` and `J2.6`.
- `ecc:documentation-lookup` (a **skill**) in `J2.1`, for the vendor-doc verification ADR 0028 §13 requires.
- **`taste-skill` then `impeccable` in `J2.12` only**, against ADR 0026 §10.
- `ecc:cost-aware-llm-pipeline` is **not** needed. The session adds no model call
  (`OUTCOME-DETERMINISTIC-NO-LLM`), and `hookType` rides the existing generation call.

**Cost note.**
- Zero model spend.
- **The Builder makes no live platform call.** Providers are tested on responses shaped from the verified
  docs, and a live X smoke is recorded in ADR 0028 Amendment A as `NOT YET RUN`.
- **`OUTCOME-PREDICTION-ACCURACY` (Tier E) is not run.** It cannot produce a number before about
  T0 + 150 days, and T0 is undefined today (ADR §12.4).

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 33 Track J - BUILDER phase (J2). You implement ADR 0026 and the additive amendments it names. You
write code; you do NOT make architectural decisions. Every decision you need has already been made and
carries a named loser. If you find yourself choosing between two designs, STOP and report - that is an ADR
gap, not your call.

PRECONDITION: git status must show docs/decisions/0026-outcome-loop.md and docs/build-guide/session-33.md
COMMITTED and clean (a docs-only commit; do NOT include app/[locale]/(dashboard)/onboarding/step-2/.impeccable/
or supabase/.temp/). If either is untracked or modified, STOP - the Reviewer cannot read an ADR that is not in
git. Record that commit's SHA as BASE in your acknowledgement. Work on branch session-33-adr-0026.

READ FIRST, in this order:
- docs/decisions/0026-outcome-loop.md - ALL of it. Section 13 (35 constraints) is your checklist. Sections
  3, 4, 5, 6, 7, 8 and 11 are the ones you transcribe numbers and SQL shapes from. Section 16 records why each
  advisory finding was adopted or rejected - do not re-open any of them.
- docs/build-guide/session-33.md - the goal block, Reality, Section 0 (L-1..L-9, D-1..D-7) and Section 0.2
  (A-1..A-6). SECTION 0.2 IS YOUR GATE.
- docs/decisions/0018-diff-based-learning-capture.md - the OTHER pipeline into performance_memory. You change
  none of it. Its [db-BLOCKER-1] (no BEFORE DELETE on a child table) binds you.
- docs/decisions/0016-governed-memory.md - governance fields, MEM-NO-DIRECT-TABLE-ACCESS, active-only
  retrieval.
- docs/decisions/0028-*.md Sections 13, 14 and 16 - the verification rule, the read cost, the permanently
  unavailable fields.
- docs/decisions/0025-social-read-path-and-backfill.md Sections 4.1, 5.4, 9.4 - the seed, the note you
  correct, the ratify-RPC shape you copy.
- docs/decisions/0015-test-execution-and-ci-gates.md - Section 2 (tiers) and Amendment B (Tier E).
- docs/decisions/0010-legal-surface.md Amendment 2 Section D2.5 - you add three rows.
- CLAUDE.md - DB access, three Supabase clients, RLS and the erasure cascade, atomic transitions, Zod, i18n,
  bounded queries, the worker console.log carve-out, UI Component patterns, test-execution integrity.

BINDING RULES YOU WILL BE REVIEWED AGAINST:

1. TRANSCRIBE, DO NOT RE-DERIVE. k = 10, >= 3 distinct campaigns, Wilson z = 1.96 with low > 0.5 (or high <
   0.5), provisional at n >= 5, confidence = wilson_low * n/(n+10), window 180 days, expiry newest agreeing
   observation + 90 days, fast contradiction 4 of the last 5, OUTCOME_CAP 3, maturity day 7 with 2 days grace,
   baselines >= 8 (X 90-day median, LinkedIn last 20), log_lift clipped to [-3, 3] with a count floor of 1.
   Every one is a named constant in lib/outcomes/constants.ts citing its ADR section, with its SQL twin
   documented beside the RPC that uses it. Statistical constants are code, never env.

2. THE FLOOR LIVES IN SQL AND NEVER TRUSTS A CALLER. upsert_outcome_performance_pattern takes NO stats
   parameters; promote and demote are ONE conditional UPDATE each that RECOMPUTES n, wins, campaigns and the
   bound from post_outcomes JOIN post_dimensions. wilson_bounds is the ONE copy of the formula. No TS
   re-implementation of the gate is accepted as proof of it.

3. TAG AT GENERATION, NEVER AFTER (L-4). post_dimensions is written ONLY by the AFTER INSERT trigger on
   post_ai_originals and by ONE history-copy migration that copies role, format and origin_mode. No
   classifier, no model call, no TS write to post_dimensions anywhere. Imports are never tagged and never
   observations (ruling A-4). Human-written posts get no row - that is correct.

4. ADR 0018 IS UNTOUCHED. No file under lib/learning/ and no ADR 0018 migration changes - not even to add an
   export. If you need one to change, STOP. AI_ORIGINAL_SCHEMA_VERSION stays 1.

5. THREE WRITERS, DISTINGUISHED IN THE ROW. source='outcome' is set INSIDE the RPC. Namespace CHECKs make a
   cross-writer key collision impossible; the new partial UNIQUE is a SIBLING - the distilled index is
   unchanged. No existing lib/db/memory-performance function gains a caller or a parameter; the outcome writer
   has its own functions, called only from lib/outcomes/.

6. NULL IS NEVER ZERO. A permanently unavailable field (X reach; LinkedIn saves, clicks, reach, impressions)
   is null forever. An eligible field null at day 7 EXCLUDES the post. MINOR-2 in lib/memory/performance.ts
   (likes/impressions omitted for governed rows) is not undone.

7. PATTERNS ARE OBSERVATIONS, NOT RULES (L-2, L-7). Every rendered line carries "in <wins> of <n> posts
   (<c> campaigns)". Never a multiplier, a causal verb, a percentage without n, or a superlative - in en, pt,
   es, or the prompt. Outcome rows never enter the shared ranking or the "Top-Performing Post Snippets" block.
   Engagement only - no business attribution this session (ruling A-5).

8. NO MODEL CALL IN THE LOOP. lib/outcomes/** and app/api/cron/extract-outcomes/** import nothing from the
   AI layer. hookType is requested inside the EXISTING generation call.

9. NO LOOKUP BY GUESSED NAME. Every CHECK you widen is found in pg_constraint BY DEFINITION; the migration
   RAISES unless exactly one matches, drops it by that name, re-adds it EXPLICITLY NAMED as NOT VALID, then
   VALIDATEs it. A guessed DROP CONSTRAINT IF EXISTS silently no-ops.

10. SERVICE-ROLE DISCIPLINE. Every new RPC is SECURITY DEFINER with search_path pinned, REVOKE ALL FROM
    public, anon, authenticated, GRANT EXECUTE TO service_role. acknowledge_campaign_retrospective's p_user_id
    comes from supabase.auth.getUser() on the anon server client - never a form field - and is checked
    against business_members. lib/db functions that use service-role acquire their own client by lazy import
    and take no client parameter.

11. UNTRUSTED TEXT. Hypothesis, note and campaign name are member-controlled. neutralizeWithSentinels inside
    the lib/db wrapper before any write to performance_memory; neutralize() at every prompt render.

12. GDPR. Three new business-scoped tables, each ON DELETE CASCADE from businesses, SELECT-only RLS in the
    InitPlan form, no authenticated write policy, BEFORE UPDATE write-once triggers where the ADR says so and
    NO BEFORE DELETE trigger anywhere. The three ADR 11 rows go into ADR 0010 Amendment 2 Section D2.5
    VERBATIM, IN THE SAME COMMIT as the migration. purge_business is proven by a live-Postgres case.

13. SHARED-FUNCTION CALLERS. Before marking ANY constraint on a shared function tested, git grep its callers
    and state PER CALLER which test exercises it. ADR 5.6 is the table: listPerformanceMemoryCandidates (two
    call paths - context.ts and studio/actions.ts), the three prompt render sites, every creator of a
    post_ai_originals row (covered by the trigger - prove it with a raw insert), list_posts_for_metrics_sync's
    caller, and the ADR 0018 CTA function's new importer. A caller with no listed test is
    AUTHORED-NOT-EXECUTED for that caller.

14. CONTRACT DISCIPLINE. DB only via lib/db/ and lib/memory/ (no *_memory table touched outside
    lib/db/memory-*); lib/social only via lib/social/index.ts; Zod on every Server Action and route input;
    atomic conditional UPDATEs; every list query bounded with an explicit ORDER BY matching an index;
    date-fns and formatISO(); no `any`; no console.* except the ONE canonical structured-JSON tick line in
    the cron route; env only via lib/config.ts; i18n en/pt/es in the same commit; shadcn v4 / Base UI with NO
    asChild on Button or DropdownMenu primitives.

ECC BUDGET FOR THIS PHASE: THREE subagent invocations, total. One ecc:code-explorer in J2.0. One
ecc:database-reviewer at the end of J2.6, before it commits, over the J2.1, J2.3, J2.5 and J2.6 migrations.
One ecc:security-reviewer at the end of J2.11, before it commits, over the member-text-to-memory-to-prompt
path. No reviewer per step, no re-consultation, no mle-reviewer (its findings are already in the ADR). Skills
are free: /ecc:plan, /ecc:tdd-workflow, /ecc:verification-loop every code step;
supabase:supabase-postgres-best-practices for J2.1, J2.3, J2.5, J2.6; ecc:documentation-lookup (a SKILL) in
J2.1; taste-skill then impeccable in J2.12 ONLY, against ADR 0026 Section 10.

DO NOT make any live platform call and DO NOT run anything for OUTCOME-PREDICTION-ACCURACY - it is Tier E,
recorded in J2.13, not run.

VERIFICATION, every step: npm run typecheck ; npm run test:app ; npm run test:db where the step touches DB
behaviour. NEVER bare `npx vitest run`. If test:db fails, distinguish a DB-behaviour regression from a local
stack failure and say which. Each named constraint must be DEMONSTRATED TO REDDEN against the pre-fix code and
then reverted. One commit per step, subject naming the step id and the constraints it closes.

Acknowledge in ONE line: the BASE SHA, confirmation you have read ADR 0026 Sections 3-8, 11 and 13, and that
you understand rule 2 (the floor never trusts a caller) and rule 4 (lib/learning is untouched). Then STOP and
wait for J2.0.
```

### §2b — Builder steps

Each step is one paste and one commit. **A step that closes no ADR constraint does not exist.** `J2.0` is the
one deliberate exception, because of premise risk. **All 35 constraints are closed by exactly one step each.**
Where a constraint has a Tier-1 half authored earlier, the step that closes it is the one that lands its last
half, and the table says so. **Do not claim a count until it is executed green in CI at the head it is dated
to** (Session 28's false *"29/29"*).

| Step | What it ships | Constraints closed (ADR §13 #) | Tier |
|---|---|---|---|
| **J2.0** | **Grounding — no code, no commit** · `code-explorer` | — | — |
| **J2.1** | Real `fetchPostMetrics` + day-1/3/7 cadence (ADR 0028 Amendment A, ruling A-3) | `METRICS-FETCH-REAL` (1), `METRICS-CADENCE-BOUNDED` (2) | 2 · **1**+2 |
| **J2.2** | `lib/outcomes/constants.ts` + boundary scans, each reddened | `NO-RETRO-TAGGING` (6), `DETERMINISTIC-NO-LLM` (28), `ADR0018-UNCHANGED` (29), `NO-EXTRA-WRITER` (31) | 3 |
| **J2.3** | Three tables, RLS, write-once, the tagging trigger, history copy, §D2.5 rows | `DIMENSIONS-TAGGED-AT-GENERATION` (3), `TAG-ALL-CALLERS` (4), `DIMENSIONS-WRITE-ONCE` (5), `RLS-ISOLATED` (33), `CASCADE-COMPLETE` (34) | **1** + 3 |
| **J2.4** | `hookType` additive in three output schemas | `HOOKTYPE-ADDITIVE` (8) | 2 |
| **J2.5** | `performance_memory` Amendment C schema + write protection | `TWO-WRITERS-DISTINGUISHED` (18), `KEY-COLLISION-DEFINED` (19), `WRITE-PROTECTED` (20) | **1** |
| **J2.6** | `wilson_bounds`, upsert/promote/demote, acknowledge, north-star RPCs + wrappers · **database-reviewer** | `MIN-N-ENFORCED` (13), `RECOMPUTE-NOT-TRUST` (14), `NORTHSTAR-COMPUTABLE` (26); **Tier-1 halves** of 21, 22, 23, 25 authored | **1** + 2 |
| **J2.7** | Deterministic normaliser → `post_outcomes` | `ELIGIBLE-FIELDS-ONLY` (10), `NORMALISED-TO-OWN-BASELINE` (11), `SEED-BASIS-MATCH` (12) | 2 |
| **J2.8** | `extract-outcomes` worker, tick line, runbook | `DESCRIPTIVE-ONLY` (7), `MATURED-SNAPSHOT` (9), `CONTRADICTION-DEMOTES-ATOMIC` (21), `WINDOWED-DECAY` (22), `PROVENANCE-PROPAGATED` (23), `TICK-IDEMPOTENT` (32) | 1 + 2 + 3 |
| **J2.9** | Separate retrieval + observed-outcomes block at three render sites | `CONFIDENCE-RENDERED` (15), `NO-ZERO-METRICS-REINTRODUCED` (16), `SEPARATE-RETRIEVAL` (17) | 2 + 3 |
| **J2.10** | ADR 0017 Amendment C: hypothesis + success criteria | `HYPOTHESIS-IN-BRIEF` (24) | 1 + 2 |
| **J2.11** | Retrospective evaluation, acknowledge action, north-star script · **security-reviewer** | `RETROSPECTIVE-WRITES-BACK` (25) | 1 + 2 |
| **J2.12** | Campaign-page surfaces + copy lint · **taste-skill → impeccable** | `ATTRIBUTION-CONFIDENCE-FRAMED` (27) | 2 |
| **J2.13** | Cross-business scan, Tier-3 re-verify, amendments, constraint→CI map, Tier E protocol | `NO-CROSS-BUSINESS` (30), `PREDICTION-ACCURACY` (35) | 2 + 3 + E |

**Tally: 2 + 4 + 5 + 1 + 3 + 3 + 3 + 6 + 3 + 1 + 1 + 1 + 2 = 35.** (`OUTCOME-` prefix dropped in the table
for width; every commit subject and test title uses the full name.)

The fourteen pastes follow, one per step.

#### J2.0 — Grounding pass: re-verify every ADR premise  ·  no code, no commit

```
BUILDER - Session 33 - J2.0. NO CODE, NO COMMIT. Produce a premise -> file:line -> still-true? table before
anything is built. ADR 0026 was written at 859fd73f. If a premise has drifted, the step that depends on it is
NOT built until the drift is reconciled and recorded here.

ECC BUDGET INVOCATION 1 of 3. Invoke ecc:code-explorer ONCE over exactly this closed file list and no other:
  lib/social/twitter-provider.ts, linkedin-provider.ts, mock-provider.ts, types.ts, platforms/config.ts
  lib/metrics/orchestrator.ts, app/api/cron/sync-metrics/route.ts, lib/db/post-metrics.ts, lib/config.ts
  app/api/cron/capture-learning/route.ts, lib/cron/qstash-auth.ts
  lib/learning/orchestrator.ts, lib/learning/classify.ts
  lib/db/memory-performance.ts, lib/memory/performance.ts, lib/memory/scoring.ts, lib/memory/constants.ts,
  lib/memory/import.ts, lib/ai/context.ts
  lib/ai/prompts/post-generation.ts, post-regeneration.ts, brief.ts, formats/native-generation-prompt.ts,
  formats/schemas.ts
  lib/campaigns/generate.ts, lib/db/campaigns.ts, lib/db/posts.ts, lib/db/types.ts
  app/[locale]/(dashboard)/campaigns/[id]/ (page.tsx and posts/actions.ts),
  app/[locale]/(dashboard)/studio/actions.ts
  supabase/migrations: the governed_memory migration; 20260726020000*; 20260726030000*;
  20260728220000_demote_recomputes_contradictions.sql; the ADR 0018 post_ai_originals / post_edit_signals
  migrations; the migration that defines list_posts_for_metrics_sync; the ADR 0025 performance_memory import
  migration; 20260702120700_purge_business_member_delete.sql
Ask it ONE question: "for each file, what does it currently do with the metrics fetch, the metrics sync
predicate, post_ai_originals and its triggers, performance_memory writers/readers/CHECKs/policies, the brief
shape, and the performance-memory render sites - with line numbers?" Do not ask it to propose changes.

VERIFY THESE PREMISES SPECIFICALLY. Each is load-bearing for a named later step.

1. NO METRIC INPUT (J2.1). fetchPostMetrics throws NOT_IMPLEMENTED at linkedin-provider.ts:342 and
   twitter-provider.ts:398; the orchestrator short-circuits on it (orchestrator.ts:95-97); upsertPostMetrics
   uses onConflict post_id (post-metrics.ts:12). Record the CURRENT list_posts_for_metrics_sync definition
   (file + line) and METRICS_MAX_AGE_DAYS's current default in lib/config.ts.
2. THE WRITERS TODAY (J2.5). performance_memory writers: promote.ts:109-159 and summarize.ts:184-213
   (distilled); import.ts:144 -> memory-performance.ts:260-279 (import). git grep for ANY other writer, and for
   ANY app/** code writing performance_memory with an authenticated client. If one exists, STOP - ADR 5.5 makes
   it a STOP, not a policy exception.
3. THE CHECKS BY REAL NAME (J2.5). Query pg_constraint on the local DB for performance_memory's source CHECK
   and dimension CHECK: current names and value lists. Write (do not run in a migration yet) the by-definition
   lookup J2.5 will use and confirm it returns EXACTLY ONE row for each.
4. WHAT J2.5/J2.6 MUST NOT DISTURB. performance_memory_distilled_pattern_key_uq and its predicate;
   upsert_distilled_performance_pattern's ON CONFLICT ... WHERE source='distilled' (20260726030000:63-64);
   promote_performance_pattern's third gate counting post_edit_signals (:118-127); the ADR 0025 import partial
   UNIQUE; trg_performance_memory_voice_write_guard's firing condition (20260726020000:80-115);
   enforce_voice_write_preference_only's retirement branch (:85-88); the authenticated INSERT/UPDATE policies
   (governed_memory.sql:246-253).
5. POST_AI_ORIGINALS (J2.3, J2.2). Its columns (format, payload, rendered_content, revision, post_id,
   business_id), its write-once trigger, enqueue_post_edit_signal, and EVERY existing trigger on it by name.
   Record the ADR 0018 migration file names - J2.2's path check lists them.
6. TAGGING INPUTS (J2.3). posts.role written from roleSequence (generate.ts:478-488, inserted :539-575); the
   campaigns.origin enum values; CampaignBriefContent at types.ts:1300-1307 = {narrative, proofPlan,
   pinnedEvidence[], roleSequence[]} and the pinnedEvidence kind values (proof_type's source). If hypothesis
   or successCriteria already exist anywhere, STOP - ruling A-1 assumed they do not.
7. THE CTA RULE (J2.7). Find ADR 0018's CTA rule function (ADR 0026 4.4: "imported unmodified"). Is it
   EXPORTED today? If using it needs ANY edit under lib/learning/ - even adding `export` - STOP and report.
   OUTCOME-ADR0018-UNCHANGED forbids the edit and the choice is the ADR's, not yours.
8. RENDER SITES (J2.9). post-generation.ts:179-181 renders governed rows under "Top-Performing Post Snippets";
   native-generation-prompt.ts renders NO performance memory (grep topContent / recentPostPerformance); state
   what post-regeneration.ts renders. List every caller of listPerformanceMemoryCandidates
   (performance.ts:51,140 -> context.ts; studio/actions.ts:136) and of buildCustomerContext.
9. MINOR-2 / MINOR-3 (J2.2, J2.9). performance.ts:18-22 and :61-66: likes/impressions omitted for governed rows;
   a null platform rendered "Across platforms". Record the exact lines.
10. THE SEED (J2.7). social_backfill_runs.summary: the exact JSON path of the X engagement baseline, and whether
    the run records its BASIS (rate vs count). If the basis is not recorded, OUTCOME-SEED-BASIS-MATCH cannot be
    enforced at read time - STOP and report. Do not infer it.
11. THE WORKER PATTERN (J2.8). capture-learning's dual-mode QStash/bearer route, its Sentry.withMonitor usage
    and its tick line. ADR 14 cites docs/runbooks/qstash-setup.md; the file is at
    docs/build-guide/runbooks/qstash-setup.md - confirm and use the real path.
12. RETROSPECTIVE INPUTS (J2.10, J2.11). The exact post status enum values meaning "not yet published"; whether
    anything sets campaigns.status 'completed' and what; the brief-review surface where the brief is edited
    before freeze; MODE2-BRIEF-FROZEN-GUARD's test file.
13. PURGE (J2.3). 20260702120700_purge_business_member_delete.sql:62 deletes the businesses row and cascades;
    confirm no table added since blocks it.

OUTPUT: the premise table, then a DRIFT list naming, for each drifted premise, the step it affects and what
you propose. You do not decide - an ADR-level change is a STOP. Then STOP and wait for J2.1.
```

#### J2.1 — The metrics input: real `fetchPostMetrics` and the day-1/3/7 cadence  ·  ruling A-3

```
BUILDER - Session 33 - J2.1. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use
supabase:supabase-postgres-best-practices for the migration and the ecc:documentation-lookup SKILL (not a
subagent) for vendor documentation.

WHY FIRST: founder ruling A-3. Without this, post_metrics receives no real rows and every later step computes
over nothing.

SHIP: ADR 0028 Amendment A (ADR 0026 Section 3).

1. VERIFY BEFORE WRITING. ADR 0028 Section 13 binds unchanged: no endpoint, field name or scope is written from
   memory. For X: the endpoint, the public-metrics field names, and the scope each needs - confirm it is inside
   platforms/config.ts's granted scopes. For LinkedIn: whether like/comment/share counts are readable under the
   scopes ALREADY granted. Record each citation (URL, retrieval date, exact field names) in a new appended
   "Amendment A" section of docs/decisions/0028-*.md and in its verification log. DO NOT add a scope - it forces
   re-authorisation of every connected account (ADR 0028 14.1).
2. TwitterProvider.fetchPostMetrics: likes, comments (replies), shares (reposts + quotes, as verified),
   impressions; saves/clicks ONLY if the verified endpoint serves them under granted scopes; reach is null
   ALWAYS. withFreshToken for the token, the existing error mapping, the provider never sleeps.
3. LinkedInProvider.fetchPostMetrics: likes, comments, shares ONLY if step 1 verified them readable. Otherwise
   it KEEPS throwing NOT_IMPLEMENTED and Amendment A records that the loop runs on X alone. saves, clicks,
   reach, impressions are null ALWAYS.
4. MockProvider: deterministic metric fixtures for both platforms, including a permanently-null field, an
   eligible field returned null, and an X impressions = 0 case (J2.7 needs all three).
5. supabase/migrations/<ts>_metrics_sync_cadence.sql: CREATE OR REPLACE list_posts_for_metrics_sync so a post
   is due when (age >= 1 day AND last_synced_at < published_at + 1 day) OR the same at 3 days OR at 7 days. No
   new column. Keep its signature, grants, ORDER BY and limit. lib/config.ts: METRICS_MAX_AGE_DAYS default 9.
   The hourly schedule and the tick line (kind 'metrics-sync-tick') are UNCHANGED in shape.

TESTS:
- lib/social/__tests__/: fetchPostMetrics per provider over mocked HTTP shaped from the cited docs - each
  verified field mapped; reach (and LinkedIn's four) null, NEVER 0; a field absent from the response -> null,
  not 0; the LinkedIn NOT_IMPLEMENTED path if that is the outcome.
- supabase/__tests__/metrics-sync-cadence.test.ts (live Postgres): with seeded published_at/last_synced_at, a
  post is returned at day 1, 3 and 7 and NOT at day 2 or 5 once that stage's sync has landed, and not after its
  day-7 sync; a post older than 9 days never.
- the metrics orchestrator test: tick-line keys unchanged.

CONSTRAINTS CLOSED: OUTCOME-METRICS-FETCH-REAL (1, Tier 2 + the verification-log citation),
OUTCOME-METRICS-CADENCE-BOUNDED (2, Tier 1 + 2). Redden: return 0 for a null field; drop the day-3 clause.
Revert both.

NO LIVE API CALL. Record a live smoke against a founder-owned X account in Amendment A as "NOT YET RUN".

Commit: "J2.1 OUTCOME-METRICS-FETCH-REAL OUTCOME-METRICS-CADENCE-BOUNDED (ADR 0028 Amendment A)".
```

#### J2.2 — `lib/outcomes/` constants and the boundary scans  ·  before the code they fence

```
BUILDER - Session 33 - J2.2. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: lib/outcomes/constants.ts and the Tier-3 boundary scans, BEFORE any code they fence (the ADR 0023 G1b.2
precedent). lib/outcomes/ is created here, so the scans have a real, non-empty target and cannot pass
vacuously.

1. lib/outcomes/constants.ts - transcribe ADR 6.4's block exactly, each constant with a comment citing its ADR
   section: OUTCOME_MIN_N 10, OUTCOME_MIN_DISTINCT_CAMPAIGNS 3, OUTCOME_WILSON_Z 1.96, OUTCOME_PROVISIONAL_N 5,
   OUTCOME_CONFIDENCE_SHRINK_K 10, OUTCOME_WINDOW_DAYS 180, OUTCOME_PATTERN_TTL_DAYS 90,
   OUTCOME_FAST_CONTRA_LAST 5, OUTCOME_FAST_CONTRA_MIN 4, OUTCOME_CAP 3, OUTCOME_MATURITY_DAYS 7,
   OUTCOME_MATURITY_GRACE_DAYS 2. Add, citing their sections: OUTCOME_TAXONOMY_VERSION 1 (4.2),
   OUTCOME_BASELINE_MIN 8, OUTCOME_X_BASELINE_DAYS 90, OUTCOME_LINKEDIN_BASELINE_LAST 20, OUTCOME_LOG_LIFT_CLIP 3
   (6.3), OUTCOME_RETRO_MIN_N 5 (8.2), OUTCOME_HYPOTHESIS_TTL_DAYS 365 (8.4), the length-band thresholds (4.4),
   and the PROMOTABLE and DESCRIPTIVE_ONLY dimension sets (4.1).
2. lib/outcomes/__tests__/source-scans.test.ts:
   - OUTCOME-DETERMINISTIC-NO-LLM (28): no import of the lib/ai runner or client, or of @anthropic-ai, under
     lib/outcomes/** or app/api/cron/extract-outcomes/**. Assert the glob matched >= 1 file.
   - OUTCOME-NO-RETRO-TAGGING (6): no TS write to post_dimensions anywhere (a .from('post_dimensions') chained
     to insert/upsert/update, or an .rpc that writes it); and in supabase/migrations/ an INSERT INTO
     public.post_dimensions appears ONLY in an allowlist of migration file names. The allowlist is EMPTY now;
     J2.3 adds exactly two names and nothing else ever may.
   - OUTCOME-NO-EXTRA-WRITER (31): the set of literal source values written by any migration's INSERT INTO
     public.performance_memory or RPC body is exactly {distilled, import} today, plus the authenticated
     'manual' path. J2.5/J2.6 add 'outcome'.
   - the scan half of OUTCOME-NO-ZERO-METRICS-REINTRODUCED (16): pin the MINOR-2 lines recorded in J2.0
     premise 9 - a governed row's rendered object carries no likes or impressions key.
3. scripts/check-adr0018-unchanged.ts: OUTCOME-ADR0018-UNCHANGED (29) - `git diff BASE..HEAD -- lib/learning/
   <the ADR 0018 migrations named in J2.0 premise 5>` must be empty, non-zero exit otherwise. This is a PATH
   check by ADR decision ([test-3b]); the unmodified lib/learning/*.test.ts suite is the behavioural backstop.
   State in the commit body whether it runs inside app-tests or as a recorded Tier-3 command re-run in J2.13
   and by the Reviewer.

REDDEN EACH against a planted violation, show the hit, revert: an @anthropic-ai import in
lib/outcomes/probe.ts; a .from('post_dimensions').insert in a fake lib/backfill/classify.ts; a migration
writing source 'manual2'; a likes: 0 in the governed render; a whitespace edit in lib/learning/promote.ts.

CONSTRAINTS CLOSED (Tier 3): OUTCOME-NO-RETRO-TAGGING (6), OUTCOME-DETERMINISTIC-NO-LLM (28),
OUTCOME-ADR0018-UNCHANGED (29), OUTCOME-NO-EXTRA-WRITER (31). The scan half of 16 lands here; 16 closes in
J2.9.

Commit: "J2.2 OUTCOME-NO-RETRO-TAGGING OUTCOME-DETERMINISTIC-NO-LLM OUTCOME-ADR0018-UNCHANGED
OUTCOME-NO-EXTRA-WRITER".
```

#### J2.3 — Migration: three tables, the tagging trigger, the history copy, §D2.5 rows

```
BUILDER - Session 33 - J2.3. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use
supabase:supabase-postgres-best-practices.

SHIP: the three business-scoped tables, the tagging trigger, the history copy and the three D2.5 rows - the
rows IN THE SAME COMMIT as the migration (L-8, CLAUDE.md erasure-cascade rule).

1. supabase/migrations/<ts>_outcome_tables.sql:
   - post_dimensions exactly as ADR 4.2: ai_original_id uuid PK -> post_ai_originals ON DELETE CASCADE;
     business_id, post_id, campaign_id NOT NULL, each ON DELETE CASCADE; platform; taxonomy_version; role,
     format, origin_mode, hook_type, proof_type nullable, each CHECK (col IS NULL OR col IN (...)); created_at.
     Indexes (post_id), (campaign_id), (business_id, platform).
   - post_outcomes exactly as ADR 6.1, including metric_basis CHECK IN ('rate','count'), baseline_source CHECK
     IN ('own','import_seed'), length_band, cta_present, hook_survived, measured_at NOT NULL. Indexes
     (business_id, platform, published_at DESC) and (campaign_id).
   - campaign_retrospectives exactly as ADR 8.3: campaign_id UNIQUE; hypothesis_source CHECK IN
     ('brief','implicit'); verdict CHECK; status CHECK IN ('completed','acknowledged'); note <= 500;
     acknowledged_by -> auth.users ON DELETE SET NULL. Index (business_id, acknowledged_at DESC).
   - RLS on all three: ONE SELECT policy each, business_id = ANY (SELECT unnest(public.get_user_business_ids())).
     NO authenticated INSERT, UPDATE or DELETE policy (ADR 11).
   - BEFORE UPDATE triggers rejecting every UPDATE on post_dimensions and post_outcomes. NO BEFORE DELETE
     trigger on any of the three (ADR 0018 [db-BLOCKER-1]: it fires on FK cascades and aborts purge_business).
2. The tagging trigger, in the same migration: AFTER INSERT ON post_ai_originals, SECURITY DEFINER, search_path
   pinned. Body = reads plus ONE INSERT INTO post_dimensions ... ON CONFLICT (ai_original_id) DO NOTHING:
   role from posts.role; format from NEW.format; origin_mode from campaigns.origin; hook_type from
   NEW.payload->>'hookType' (NULL when absent or not one of the six values - never an error); proof_type from
   the frozen brief's pinnedEvidence kinds; platform; taxonomy_version 1. NO EXCEPTION block - a genuine defect
   must fail loudly. Name it so it cannot collide with the triggers listed in J2.0 premise 5.
3. supabase/migrations/<ts>_post_dimensions_history_copy.sql: for EXISTING post_ai_originals rows, copy role,
   format and origin_mode only (facts assigned at generation); hook_type and proof_type NULL. Imports are never
   touched (ADR 4.5). Idempotent via ON CONFLICT DO NOTHING.
4. Add BOTH migration file names to J2.2's OUTCOME-NO-RETRO-TAGGING allowlist, and nothing else.
5. docs/decisions/0010-legal-surface.md Amendment 2 Section D2.5: the three rows from ADR 0026 Section 11,
   VERBATIM.

TESTS (supabase/__tests__/, live Postgres):
- outcome-tagging-trigger.test.ts: a RAW INSERT INTO post_ai_originals issued by no application code produces
  the expected post_dimensions row; a post with role NULL and no brief still inserts (NULLs, no error); a
  payload with hookType 'nonsense' yields hook_type NULL; a second revision gets its own row; the history copy
  wrote role/format/origin_mode and left hook_type NULL.
- outcome-tables-write-once.test.ts: UPDATE on post_dimensions and post_outcomes rejected, service-role
  included.
- outcome-tables-rls.test.ts: cross-tenant SELECT denied on all three; authenticated INSERT, UPDATE and DELETE
  denied on all three.
- outcome-tables-purge.test.ts: purge_business over a business with rows in all three tables SUCCEEDS and
  leaves zero.
- The existing post_ai_originals / post_edit_signals Tier-1 tests pass UNMODIFIED.

CONSTRAINTS CLOSED: OUTCOME-DIMENSIONS-TAGGED-AT-GENERATION (3), OUTCOME-TAG-ALL-CALLERS (4),
OUTCOME-DIMENSIONS-WRITE-ONCE (5), OUTCOME-RLS-ISOLATED (33), OUTCOME-CASCADE-COMPLETE (34 - the Tier-1 erasure
test plus the Tier-3 D2.5 rows). Redden: drop the trigger; make the trigger RAISE when role IS NULL (the
role-NULL test must fail); add a BEFORE DELETE trigger (purge must fail); remove the business predicate from
one SELECT policy. Revert all.

Commit: "J2.3 OUTCOME-DIMENSIONS-TAGGED-AT-GENERATION OUTCOME-TAG-ALL-CALLERS OUTCOME-DIMENSIONS-WRITE-ONCE
OUTCOME-RLS-ISOLATED OUTCOME-CASCADE-COMPLETE".
```

#### J2.4 — `hookType`, additive  ·  ruling A-6, ADR 0024 note

```
BUILDER - Session 33 - J2.4. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: hookType in the output schemas, additively (ADR 4.3).

1. lib/ai/prompts/formats/schemas.ts: SinglePostOutputSchema, ThreadOutputSchema and CarouselOutputSchema each
   gain hookType: z.enum(['question','statistic','contrarian','story','announcement','how_to']).nullish() - the
   scriptBrief precedent (schemas.ts:18). Export the value list from ONE place.
2. The generation prompt(s) that produce these schemas ask the model to state the opening type it used. No new
   model call; no model or tier change.
3. AI_ORIGINAL_SCHEMA_VERSION stays 1. Nothing under lib/learning/ changes.
4. If a frozen prompt table or golden test covers the changed prompt text, update it in this commit and name it
   in the commit body.

TESTS:
- a v1 payload WITH and WITHOUT hookType parses under all three schemas; state and test what an unknown
  hookType does.
- ADR 0018's classifier, imported unmodified, produces identical output for a v1 payload with and without
  hookType.
- the TS value list equals the post_dimensions hook_type CHECK list (read the J2.3 migration file).
- J2.2's OUTCOME-ADR0018-UNCHANGED check still passes.

CONSTRAINT CLOSED: OUTCOME-HOOKTYPE-ADDITIVE (8). Redden: make hookType required (the without-hookType parse
must fail); drop a value from the TS list (the CHECK-equality test must fail). Revert.

Commit: "J2.4 OUTCOME-HOOKTYPE-ADDITIVE (ADR 0024 note)".
```

#### J2.5 — Migration: `performance_memory` Amendment C schema and write protection  ·  ruling A-2

```
BUILDER - Session 33 - J2.5. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use
supabase:supabase-postgres-best-practices.

SHIP: the schema half of ADR 0016 Amendment C (ADR 0026 5.1, 5.3, 5.5). The existing distilled partial UNIQUE
index is UNCHANGED.

1. supabase/migrations/<ts>_performance_memory_outcome_schema.sql:
   - Widen the source CHECK to add 'outcome', and the dimension CHECK to add 'role', 'origin_mode',
     'length_band', 'cta', 'hypothesis'. Find each CHECK in pg_constraint BY DEFINITION (the lookup from J2.0
     premise 3); RAISE unless exactly one matches; drop it by that name; re-add it EXPLICITLY NAMED with NOT
     VALID; VALIDATE CONSTRAINT in a separate statement ([db-7]).
   - Stats columns (ADR 5.3): outcome_n, outcome_wins, outcome_distinct_campaigns int; interval_low,
     interval_high numeric(4,3); metric_basis text CHECK IN ('rate','count'); baseline_seeded boolean - each
     with CHECK ((col IS NOT NULL) = (source = 'outcome')). contradicted_at timestamptz, nullable for all rows.
   - CHECK (source <> 'outcome' OR pattern_key IS NOT NULL). Namespace CHECKs: (source <> 'outcome' OR
     pattern_key LIKE 'outcome:%') and (source <> 'distilled' OR pattern_key IS NULL OR pattern_key NOT LIKE
     'outcome:%').
   - performance_memory_outcome_pattern_key_uq ON (business_id, dimension, coalesce(platform,''), pattern_key)
     WHERE source = 'outcome' AND deleted_at IS NULL.
   - Write protection ([db-3], ADR 5.5): performance_memory_insert_own's WITH CHECK gains AND source = 'manual'.
     A BEFORE UPDATE trigger in the shape of enforce_voice_write_preference_only's retirement branch
     (20260726020000:85-88): for a non-service role, a change to a non-manual row is allowed ONLY to
     status = 'retired' or to deleted_at; on an outcome row, any change to source, pattern_key, dimension or a
     stats column is rejected ([db-2]). The header records the J2.0 grep that found no authenticated app writer.
   - The voice-write guard is untouched; the header states why no outcome row can fire it (ADR 5.1).
2. J2.2's OUTCOME-NO-EXTRA-WRITER expected set becomes {distilled, import, outcome} plus manual.
3. lib/db/types.ts: the performance_memory row type gains the new columns; the *Update type EXCLUDES source,
   pattern_key and every stats column.

TESTS (supabase/__tests__/performance-memory-outcome-schema.test.ts, live Postgres):
- source='outcome' with a non-'outcome:' key rejected; source='distilled' with an 'outcome:' key rejected;
  source='outcome' with a NULL key rejected; a stats column set on a distilled row rejected; each new dimension
  value accepted and 'topic' rejected.
- cross-writer isolation: upsert_distilled_performance_pattern beside an outcome row with identical (business,
  dimension, platform) touches only the distilled row; a service-role INSERT ... ON CONFLICT on the sibling
  index dedupes outcome rows and never matches a distilled one.
- as authenticated: INSERT with source <> 'manual' rejected; UPDATE of an outcome row's outcome_n, pattern or
  source rejected; retiring it allowed; a manual row still editable.
- the existing performance-memory-pattern-key and performance-memory-promotion suites pass UNMODIFIED.

CONSTRAINTS CLOSED (Tier 1): OUTCOME-TWO-WRITERS-DISTINGUISHED (18), OUTCOME-KEY-COLLISION-DEFINED (19),
OUTCOME-WRITE-PROTECTED (20). Redden: drop each namespace CHECK in turn; drop the INSERT source predicate;
remove the trigger's stats-column branch. Revert all.

Commit: "J2.5 OUTCOME-TWO-WRITERS-DISTINGUISHED OUTCOME-KEY-COLLISION-DEFINED OUTCOME-WRITE-PROTECTED (ADR 0016
Amendment C)".
```

#### J2.6 — Migration: the outcome RPCs, the floor, and the north-star  ·  database review

```
BUILDER - Session 33 - J2.6. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Use
supabase:supabase-postgres-best-practices.

SHIP: every SQL path that writes or transitions an outcome row, plus the north-star function (ADR 5.4, 7,
8.4, 8.5). The floor lives HERE, in SQL, so the first promotion that ever runs is gated by construction.

1. supabase/migrations/<ts>_outcome_rpcs.sql. Every function: SECURITY DEFINER, search_path pinned, REVOKE ALL
   FROM public, anon, authenticated; GRANT EXECUTE TO service_role.
   - wilson_bounds(p_wins int, p_n int, p_z numeric) RETURNS (low, high), IMMUTABLE. THE ONE COPY of the
     formula ([db-5]); every RPC below calls it and none inlines it.
   - upsert_outcome_performance_pattern(p_business_id, p_dimension, p_value, p_platform, p_direction,
     p_pattern_text). Takes NO stats parameters. Recomputes n, wins, distinct campaigns and bounds from
     post_outcomes JOIN post_dimensions (latest revision per post) over published_at >= now() - 180 days, with
     EVERY table read filtered by business_id. Generation-time dimensions come from post_dimensions, measured
     ones (length_band, cta) from post_outcomes. Writes only when n >= 5. Fixed IN SQL: source 'outcome',
     status 'candidate' on insert (an existing active row keeps its status), sensitivity 'internal',
     public_use_permission false. Sets baseline_seeded = bool_or(baseline_source = 'import_seed'),
     metric_basis, confidence per ADR 6.4, last_confirmed_at = newest AGREEING observation's published_at,
     expires_at = last_confirmed_at + 90 days. ON CONFLICT on the sibling index DO UPDATE. RAISES for dimension
     hook or proof_type (OUTCOME-DESCRIPTIVE-ONLY at the SQL boundary).
   - promote_outcome_pattern(p_business_id, p_pattern_key): ONE conditional UPDATE SET status = 'active' WHERE
     status = 'candidate' AND source = 'outcome' AND <recomputed n >= 10 AND distinct campaigns >= 3 AND
     (above: wilson low > 0.5 | below: wilson high < 0.5)>, evaluated under the row lock (the [db-Q6] property
     of promote_performance_pattern, 20260726030000:102-131).
   - demote_outcome_pattern(p_business_id, p_pattern_key): ONE conditional UPDATE SET status = 'candidate',
     contradicted_at = now() WHERE status = 'active' AND source = 'outcome' AND (<recomputed window bound
     fails> OR <>= 4 of the last 5 observations by published_at, in a ROW_NUMBER()-ordered subquery, go against
     the direction>). It recomputes its own inputs (the 20260728220000 lesson).
   - acknowledge_campaign_retrospective(p_business_id, p_campaign_id, p_user_id, p_pattern_text): the ADR 0025
     ratify shape. p_user_id is checked against business_members (active, non-viewer), else RAISE. A
     conditional UPDATE moves completed -> acknowledged. For supported / not_supported it writes EXACTLY ONE
     performance_memory row with ADR 8.4's values: source 'outcome', dimension 'hypothesis', scope 'campaign',
     key 'outcome:hypothesis:<campaign_id>', status 'active', stats from the retrospective, last_confirmed_at
     completed_at, expires_at completed_at + 365 days, pattern <= 500 chars. inconclusive writes nothing. A
     second call is a no-op. ADR 8.4 lists three parameters; p_pattern_text is the fourth because
     neutralizeWithSentinels is a TS function and ADR 8.4 requires it on this text. The RPC still derives every
     stat itself. Record this in the migration header.
   - get_learning_cycles_northstar(p_since timestamptz): ADR 8.5 exactly - cycles / active brands, aggregate
     output only.
   Each function documents its SQL twin constants beside the TS constant names (the accepted ADR 0018
   duplicate-constant trade-off).
2. lib/db/memory-performance.ts: NEW upsertOutcomePattern, promoteOutcomePattern, demoteOutcomePattern and
   listOutcomePatterns(businessId, { limit, ... }). Service-role via the lazy-import pattern, no client
   parameter, neutralizeWithSentinels on the pattern text INSIDE the wrapper. NO existing function gains a
   caller or a parameter (ADR 5.6). lib/db/campaign-retrospectives.ts: acknowledgeRetrospective,
   getLearningCyclesNorthstar, a wilsonBounds wrapper, and the insert/list helpers J2.11 needs (bounded,
   ordered by an existing index).

TESTS (supabase/__tests__/, live Postgres, direct RPC calls over SEEDED post_outcomes/post_dimensions):
- outcome-promotion-floor.test.ts - each gate independently load-bearing ([test-BLOCKER-1]):
  (1) 9/10 wins, 3 campaigns -> promotes; (2) the same with 2 campaigns -> does NOT; (3) 8/10, 3 campaigns ->
  does NOT; (4) 9/9, 3 campaigns -> does NOT; (5) fixture 4 with its stored outcome_n forged to 10 -> still does
  NOT; (6) promote_performance_pattern called on an outcome row -> does not promote. Plus the below-direction
  mirror, n = 4 writing no row, and the same result through the upsertOutcomePattern / promoteOutcomePattern
  wrappers.
- outcome-demotion.test.ts: a window-bound failure demotes; 4-of-last-5 contrary demotes with an
  otherwise-passing window; 3-of-5 does not; two CONCURRENT demote calls -> one transition, contradicted_at set
  once; observations older than 180 days (seeded published_at) leave the recompute; re-promotion only by
  clearing every gate again.
- outcome-provenance.test.ts: an observation with baseline_source 'import_seed' sets baseline_seeded true; no
  source 'import' or 'distilled' row is read or modified.
- outcome-retrospective-rpc.test.ts: a non-member and a viewer refused; acknowledgement writes exactly one
  performance_memory row with ADR 8.4's values; a second call is a no-op; inconclusive writes none.
- outcome-northstar.test.ts: fixtures with an acknowledged supported retrospective, an acknowledged
  inconclusive one, an unacknowledged supported one, and a supported one whose memory row is missing -> only
  the first counts; the active-brand denominator comes from published posts in the window.
- wilson-bounds.test.ts: a (wins, n) table through SQL, including (9,10) low ~0.596 and (8,10) low ~0.490.
- authenticated EXECUTE refused on every new function.

CONSTRAINTS CLOSED: OUTCOME-MIN-N-ENFORCED (13), OUTCOME-RECOMPUTE-NOT-TRUST (14),
OUTCOME-NORTHSTAR-COMPUTABLE (26). The Tier-1 halves of 21, 22, 23 and 25 are AUTHORED here; 21, 22 and 23
close in J2.8 and 25 in J2.11. Redden: remove the campaign gate (case 2 must fail); read the stored outcome_n
instead of recomputing (case 5); drop the fast-contradiction clause; drop the membership check. Revert all.

THEN - ECC BUDGET INVOCATION 2 of 3, BEFORE THIS STEP COMMITS. Dispatch ecc:database-reviewer ONCE, read-only,
over exactly the four migrations of J2.1, J2.3, J2.5 and J2.6. Ask it:
- are grants correct on every SECURITY DEFINER function (a missing REVOKE is a privilege escalation), and is
  search_path pinned?
- does every RPC body filter business_id on EVERY table it reads?
- do promote and demote evaluate against one snapshot under the row lock, and is a concurrent demote truly a
  single transition?
- can the by-definition CHECK lookup silently no-op, and are NOT VALID and VALIDATE placed correctly?
- is there index coverage for the 180-day recompute, the baseline scans and the retrospective list?
- can the tagging trigger abort a post_ai_originals insert inside ADR 0018's write path?
- is any BEFORE DELETE trigger present that would block purge_business?
Fix a finding against J2.1, J2.3 or J2.5 by a FORWARD MIGRATION inside this step, never by editing a committed
migration. Record each finding and its disposition in the commit body. Do not re-consult.

Commit: "J2.6 OUTCOME-MIN-N-ENFORCED OUTCOME-RECOMPUTE-NOT-TRUST OUTCOME-NORTHSTAR-COMPUTABLE (+ Tier-1 halves of
21 22 23 25)".
```

#### J2.7 — The deterministic normaliser: maturity, eligibility, baseline, seed, measured dimensions

```
BUILDER - Session 33 - J2.7. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the post_outcomes writer's logic (ADR 4.4, 6.1-6.3). Pure functions in lib/outcomes/, DB only via
lib/db/post-outcomes.ts, no model call.

1. lib/outcomes/normalise.ts:
   - eligibleValue(platform, metrics): X -> rate (likes + comments + shares) / impressions; LinkedIn -> count
     likes + comments + shares. ANY eligible field null -> EXCLUDED with a typed reason, never zeroed. X
     impressions = 0 -> excluded. reach, saves and clicks are never read.
   - baseline(platform, priorOutcomes, seed): X = median of the brand's own matured X values published in the
     90 days before the post, excluding the post, requiring >= 8. LinkedIn = median of the last 20 matured
     LinkedIn outcomes before the post, requiring >= 8. Below 8, on X ONLY: the most recent
     social_backfill_runs.summary X baseline IF AND ONLY IF its recorded basis is 'rate' - enforced here at read
     time, never assumed - with baseline_source 'import_seed'. Neither -> baseline, log_lift and beat_baseline
     all NULL.
   - logLift = ln(value / baseline), clipped to [-3, 3], with the baseline floored at 1 for the count basis.
     beat_baseline = value > baseline. The gate uses beat_baseline; log_lift is descriptive.
   - measured dimensions: lengthBand per ADR 4.4's table; ctaPresent via ADR 0018's CTA rule function IMPORTED
     UNMODIFIED (J2.0 premise 7); hookSurvived = the normalised first sentence of posts.content equals that of
     the latest snapshot's rendered_content.
2. lib/db/post-outcomes.ts: insertPostOutcome (ON CONFLICT (post_id) DO NOTHING - frozen once);
   listMaturedOutcomesForBaseline(businessId, platform, { before, limit }) ordered by published_at DESC on the
   J2.3 index; listPostsDueForOutcome(businessId, { limit }) returning published posts whose day-7 sync has
   landed and that have no outcome row, plus those past maturity + grace with no day-7 sync as skip
   candidates (never guessed). Every function takes businessId and filters on it; service-role via lazy import.
3. An outcome's ai_original_id is the latest revision (max(revision)); NULL for human-written posts.

TESTS (lib/outcomes/__tests__/):
- normalise.test.ts: golden tables per platform; each eligible field null in turn -> excluded, not 0; X
  impressions = 0 excluded; LinkedIn never reads impressions even when the fixture carries it; baseline with 7
  -> null and with exactly 8 -> computed; the post excluded from its own baseline; the seed used on X at 7 own
  outcomes with basis rate, REFUSED with basis count, never used on LinkedIn; log-lift clipped at both ends;
  count floor at 1.
- measured-dimensions.test.ts: every length-band boundary (99/100/220/221 chars; 3/4/6/7 segments;
  599/600/1300/1301 chars); CTA through the imported function; hookSurvived true and false.
- lib/db post-outcomes wrapper tests: businessId filter, limit and order passed.

CONSTRAINTS CLOSED (Tier 2): OUTCOME-ELIGIBLE-FIELDS-ONLY (10), OUTCOME-NORMALISED-TO-OWN-BASELINE (11),
OUTCOME-SEED-BASIS-MATCH (12). Redden: coalesce a null field to 0; drop the self-exclusion; accept a
count-basis seed. Revert all.

Commit: "J2.7 OUTCOME-ELIGIBLE-FIELDS-ONLY OUTCOME-NORMALISED-TO-OWN-BASELINE OUTCOME-SEED-BASIS-MATCH".
```

#### J2.8 — The `extract-outcomes` worker

```
BUILDER - Session 33 - J2.8. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the extract-outcomes worker - its own daily deterministic tick (ADR 5, 7, 14). The loser is already
adjudicated: folding it into sync-metrics or lib/learning/* (D-4).

1. lib/outcomes/orchestrator.ts -> runOutcomeTick({ triggeredBy }). Lazy service-role client. Businesses ONE per
   iteration, with no business_id captured across iterations (ADR 0018 10.3). Per business:
   (a) freeze due outcomes via J2.7, counting skippedNoMetrics, skippedNoBaseline, skippedIneligibleField;
   (b) for every touched cell (platform x PROMOTABLE dimension x value x direction) call upsertOutcomePattern,
       then promoteOutcomePattern and demoteOutcomePattern;
   (c) a retrospective phase slot that J2.11 fills.
   Per-item try/catch: one failing business or cell increments errors and never fails the batch. Batch bounded
   by OUTCOME_BATCH_SIZE (lib/config.ts, default 200).
   Pattern text comes from ONE closed template in lib/outcomes/template.ts - ADR 6.4's sentence shape
   (platform, value, beat / were below this brand's usual engagement [count], wins of n posts, campaigns) -
   never a multiplier, never an imperative. hook_type and proof_type NEVER reach upsertOutcomePattern: filter
   by the PROMOTABLE set from constants.ts.
2. app/api/cron/extract-outcomes/route.ts: copy capture-learning's dual-mode QStash/bearer shape
   (lib/cron/qstash-auth.ts); Sentry.withMonitor with slug 'extract-outcomes' and schedule '0 4 * * *'; the ONE
   canonical structured-JSON console.log (CLAUDE.md worker carve-out) with EXACTLY ADR 14's keys: kind
   'outcome.tick', triggeredBy, tick, durationMs, candidates, matured, outcomesWritten, skippedNoMetrics,
   skippedNoBaseline, skippedIneligibleField, cellsRecomputed, candidatesUpserted, promoted, demoted,
   retrospectivesCompleted, errors. No content, business id or hypothesis text in the line.
3. Add the schedule to docs/build-guide/runbooks/qstash-setup.md (the real path, J2.0 premise 11) and a
   docs/launch-checklist.md row for the QStash schedule and the Sentry monitor.

TESTS:
- lib/outcomes/__tests__/orchestrator.test.ts: counters over a seeded mix; a REPLAYED tick changes no row; an
  error on one business does not stop the next; a post past maturity + grace with no day-7 sync writes no
  outcome and increments skippedNoMetrics; hook_type/proof_type cells never reach the wrapper; decay with fake
  timers and date-fns (never wall clock): a pattern whose newest agreeing observation is 91 days old is not
  returned by retrieval.
- supabase/__tests__/outcome-tick-idempotent.test.ts: the same outcome insert and the same cell upsert applied
  twice -> one row, identical values.
- the route test: both auth modes; the log line's key set equals ADR 14's exactly.
- extend J2.2's scans: no outcome pattern_key or upsert call with dimension hook or proof_type anywhere.

CONSTRAINTS CLOSED: OUTCOME-DESCRIPTIVE-ONLY (7, Tier 2 + 3), OUTCOME-MATURED-SNAPSHOT (9),
OUTCOME-CONTRADICTION-DEMOTES-ATOMIC (21), OUTCOME-WINDOWED-DECAY (22), OUTCOME-PROVENANCE-PROPAGATED (23) -
these three with their Tier-1 halves from J2.6 - and OUTCOME-TICK-IDEMPOTENT (32). Redden: pass hook_type
through; remove ON CONFLICT from the outcome insert (the replay tests must fail); skip the demote call; write a
row for a post whose day-7 sync never arrived. Revert all.

Commit: "J2.8 OUTCOME-DESCRIPTIVE-ONLY OUTCOME-MATURED-SNAPSHOT OUTCOME-CONTRADICTION-DEMOTES-ATOMIC
OUTCOME-WINDOWED-DECAY OUTCOME-PROVENANCE-PROPAGATED OUTCOME-TICK-IDEMPOTENT".
```

#### J2.9 — Separate retrieval and the observed-outcomes block at all three render sites

```
BUILDER - Session 33 - J2.9. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: outcome retrieval that never competes in the shared ranking, and its own prompt block (ADR 6.4, L-2).

1. listPerformanceMemoryCandidates EXCLUDES source = 'outcome' - one predicate in lib/db. SHARED-FUNCTION
   CALLERS: it has TWO call paths (lib/memory/performance.ts:51,140 -> lib/ai/context.ts; and
   studio/actions.ts:136). Each gets a test proving outcome rows never appear.
2. lib/memory/outcomes.ts: retrieveOutcomePatterns(businessId, { platform? }) -> listOutcomePatterns ->
   isEligible (active, unexpired) -> rankAndCap with OUTCOME_CAP 3, AMONG OUTCOME ROWS ONLY. Rows with dimension
   'hypothesis' are EXCLUDED here; only Stage A reads them (J2.10).
3. CustomerContext gains optional observedOutcomes; lib/ai/context.ts fills it. Render it in its OWN block with
   the verbatim heading "## Observed outcomes for this brand (probabilistic observations, not rules)", one line
   per pattern from the stored closed-template text, through neutralize() at render, n and campaigns on EVERY
   line. Render at lib/ai/prompts/post-generation.ts, post-regeneration.ts AND formats/native-generation-prompt.ts
   (the live Mode-2 generator, which renders no performance memory today). Empty or absent -> no block at all.
4. UNTOUCHED: the "Top-Performing Post Snippets" block; MINOR-2 (likes/impressions omitted for governed rows);
   MINOR-3 (null platform -> "Across platforms"). The outcome block carries n and wins, never per-post metrics.
5. context-callers.context-equivalence.test.ts: change ONLY what the new optional field requires, and say what
   in the commit body.

TESTS:
- retrieval: outcome rows excluded from listPerformanceMemoryCandidates on both call paths;
  retrieveOutcomePatterns caps at 3 and excludes candidate, expired and hypothesis rows.
- render: each of the THREE sites renders the block when present and omits it when absent; every line matches
  /in \d+ of \d+ posts \(\d+ campaigns?\)/; no line contains likes or impressions; a pattern text carrying an
  injection string arrives neutralised.
- a governed distilled row with no metrics still renders no 0 (with J2.2's scan half, this closes 16).

CONSTRAINTS CLOSED: OUTCOME-CONFIDENCE-RENDERED (15), OUTCOME-NO-ZERO-METRICS-REINTRODUCED (16, Tier 2 + J2.2's
Tier-3 scan), OUTCOME-SEPARATE-RETRIEVAL (17). Redden: drop the source predicate; render at two sites only;
emit likes: 0. Revert all.

Commit: "J2.9 OUTCOME-CONFIDENCE-RENDERED OUTCOME-NO-ZERO-METRICS-REINTRODUCED OUTCOME-SEPARATE-RETRIEVAL".
```

#### J2.10 — ADR 0017 Amendment C: hypothesis and success criteria in the brief  ·  ruling A-1

```
BUILDER - Session 33 - J2.10. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: a falsifiable hypothesis and structured success criteria in the frozen brief (ADR 0026 8.1).

1. CampaignBriefContent (lib/db/types.ts:1300-1307) gains hypothesis?: string and successCriteria?: { metric:
   'win_rate' | 'median_lift'; target: number; evaluationWindowDays: number }. OPTIONAL on the type, because
   briefs frozen before the amendment have neither. Old briefs are NOT backfilled.
2. Zod: hypothesis 1..300 chars; target in [0.5, 0.95] for win_rate and [1.0, 3.0] for median_lift (a
   discriminated refine); evaluationWindowDays an integer in [7, 60].
3. lib/ai/prompts/brief.ts (Stage A): the model proposes a hypothesis and criteria drawn ONLY from what the loop
   measures (engagement vs the brand's usual - win rate or median lift). Out-of-range output is rejected by the
   schema, never clamped. Stage A also receives the brand's last 3 acknowledged hypothesis results
   (listOutcomePatterns, dimension 'hypothesis', ordered by last_confirmed_at DESC, limit 3), rendered with n,
   through neutralize(). Stage A is the ONLY reader of hypothesis rows (ADR 8.4).
4. The brief-review surface: both fields editable BEFORE freeze, validated in the Server Action by the same Zod
   schema. MODE2-BRIEF-FROZEN-GUARD and every other brief field are UNCHANGED. i18n en/pt/es in this commit.
5. Append "Amendment C" to docs/decisions/0017-mode-2-upgrade.md, citing ADR 0026 8.1 and ruling A-1.

TESTS:
- Zod: each range boundary in and out; the metric/target discriminant; a pre-amendment brief with neither field
  still parses.
- the brief prompt: out-of-range output rejected; prior hypothesis results rendered with n and neutralised;
  none -> nothing rendered.
- the brief-review action: an edit before freeze accepted; after freeze refused. The existing freeze-guard
  Tier-1 test passes UNMODIFIED - name it in the commit body.

CONSTRAINT CLOSED: OUTCOME-HYPOTHESIS-IN-BRIEF (24, Tier 2 + the existing freeze-guard Tier 1). Redden: widen a
range; permit an edit after freeze. Revert.

Commit: "J2.10 OUTCOME-HYPOTHESIS-IN-BRIEF (ADR 0017 Amendment C)".
```

#### J2.11 — The retrospective, the acknowledge action, and the north-star report  ·  security review

```
BUILDER - Session 33 - J2.11. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop.

SHIP: the campaign retrospective and its human-confirmed write-back (ADR 8.2-8.5, L-6).

1. lib/outcomes/retrospective.ts - deterministic:
   - due(campaign): >= 1 published post; NO post in a not-yet-published status (the exact enum from J2.0
     premise 12); now >= last published_at + max(7, evaluationWindowDays) days.
   - verdict over the campaign's matured outcomes WITH a baseline: inconclusive if n < 5; win_rate -> supported
     iff wins / n >= target; median_lift -> supported iff exp(median(log_lift)) >= target. The Wilson interval
     comes from SQL wilson_bounds through its lib/db wrapper - NOT a TS re-implementation ([test-5]). by_role is
     per-role n and wins.
   - a pre-amendment brief uses the implicit hypothesis "this campaign's posts beat the brand's usual
     engagement", win_rate 0.5, window 7, hypothesis_source 'implicit'.
   Fill runOutcomeTick's retrospective slot: INSERT ... ON CONFLICT (campaign_id) DO NOTHING (evaluated once),
   status 'completed', counting retrospectivesCompleted.
2. acknowledgeRetrospectiveAction (Server Action beside the campaign detail page): Zod { campaignId: uuid,
   note?: string <= 500 }. p_user_id from supabase.auth.getUser() on the anon server client - NEVER from form
   data. Builds ADR 8.4's pattern text from the closed template; neutralizeWithSentinels applies because it
   embeds member-editable hypothesis text. Calls acknowledgeRetrospective.
3. scripts/northstar-report.ts - ops only; prints getLearningCyclesNorthstar for the trailing 30 days. No
   customer surface.

TESTS:
- retrospective.test.ts: the verdict table for both metrics, including the exact boundary (wins / n == target
  -> supported); inconclusive at n = 4; the implicit hypothesis labelled; due() false while any post is still
  scheduled, and false one day before the window ends.
- the action test: a viewer refused (the RPC error surfaced); a 501-char note rejected; p_user_id taken from the
  session even when a userId is present in the form data; hypothesis text carrying an injection string
  neutralised in the written pattern.
- the tick test: a second tick does not re-evaluate an evaluated campaign.

CONSTRAINT CLOSED: OUTCOME-RETROSPECTIVE-WRITES-BACK (25, Tier 2 here + its Tier-1 half from J2.6). Redden:
read userId from form data; evaluate on every tick (drop ON CONFLICT). Revert.

THEN - ECC BUDGET INVOCATION 3 of 3, BEFORE THIS STEP COMMITS. Dispatch ecc:security-reviewer ONCE, read-only,
scoped to exactly: the J2.5 write-protection trigger and INSERT policy; the J2.6
acknowledge_campaign_retrospective RPC and its grants; the J2.9 render path; the J2.10 brief-review action and
Stage A prompt; this step's action. Ask ONE question: "can a member - or text a member controls (hypothesis,
note, campaign name) - forge outcome stats, bypass the membership check, write a non-manual performance_memory
row, or reach a generation prompt un-neutralised?" Fix findings in this step; a finding against a committed
migration is fixed by a forward migration. Record dispositions in the commit body. Do not re-consult.

Commit: "J2.11 OUTCOME-RETROSPECTIVE-WRITES-BACK".
```

#### J2.12 — The campaign-page surfaces and the copy lint  ·  `taste-skill` then `impeccable`, against ADR 0026 §10

```
BUILDER - Session 33 - J2.12. /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Then taste-skill,
then impeccable - in THIS step only, against ADR 0026 Section 10.

SHIP: the Retrospective card and the Observed outcomes list on the campaign detail page, and the copy lint
(ADR 10; L-2, L-7; ruling A-5).

1. Server Component sections under app/[locale]/(dashboard)/campaigns/[id]/: RetrospectiveCard and
   ObservedOutcomesList. The ONLY Client Component is the acknowledge form (useActionState ->
   acknowledgeRetrospectiveAction). Data through lib/db and lib/memory only. The list is restricted to cells
   this campaign's posts contributed to. Every list query is bounded (limit, default 20) and ordered by an
   existing index ([db-8]).
2. EVERY ADR 10.2 state rendered, with its copy obligation:
   - Retrospective: not yet due (with the date); inconclusive ({n} of 5); supported / not supported (hypothesis,
     verdict, "{wins} of {n} posts beat your usual engagement", interval, per-role table, implicit label where
     it applies); acknowledged (who, when, note); metrics unavailable for a platform.
   - Observed outcomes: none yet; provisional ({n} of 10, not used in writing yet); live (the 6.4 sentence);
     contradicted (paused on {date}); not enough variety.
   - The LinkedIn count-basis disclosure on every LinkedIn row; "Compared against the history you imported." on
     every seeded row; "This measures engagement on {platform}, not signups or revenue." on the card.
3. NOT on the approval gate. No /analytics route.
4. i18n: a new outcome namespace in en, pt and es in THIS commit, with identical keys.
5. shadcn v4 / Base UI: NO asChild on Button or DropdownMenu primitives (buttonVariants() on <Link>); Tailwind
   only; any new colour is a token with a contrast check in both themes.
6. DESIGN. Run taste-skill FIRST - the card is a new surface and needs a point of view: it is where the product
   first says what it learned. Then run impeccable to audit every 10.2 state, accessibility, responsive
   behaviour and copy against the contract. Neither may add a state, drop a disclosure, or introduce framing
   ADR 10.3 prohibits. Record in the commit body what each one changed.

TESTS:
- lib/outcomes/__tests__/copy-lint.test.ts over the outcome namespace of ALL THREE locale files AND the rendered
  prompt template output: numeric and written multipliers (a number followed by x or the multiplication sign;
  "twice as", "double", "triple", and their pt/es forms); causal verbs ("causes", "drives", "leads to",
  "results in", "because of", "proven", "guarantees", and their pt/es forms); a percentage or rate without its
  n; superlatives applied to a pattern. PROVEN TO REDDEN on a planted "2x more" and a planted "leads to" in
  EACH locale, then reverted.
- component tests: each 10.2 state renders its obligation; the LinkedIn and seeded disclosures are present; the
  acknowledge form shows the action's error.
- i18n parity: the en/pt/es outcome key sets are equal.

CONSTRAINT CLOSED: OUTCOME-ATTRIBUTION-CONFIDENCE-FRAMED (27). Redden as above. Revert.

Commit: "J2.12 OUTCOME-ATTRIBUTION-CONFIDENCE-FRAMED (ADR 0026 Section 10; taste-skill + impeccable)".
```

#### J2.13 — Cross-business scan, Tier-3 re-verification, amendments, the constraint→CI map, Tier E

```
BUILDER - Session 33 - J2.13. /ecc:verification-loop. No new product code.

1. OUTCOME-NO-CROSS-BUSINESS (30, Tier 2 + 3). This lands last because its targets exist only now.
   - Tier 2: every exported function in lib/db/post-outcomes.ts, lib/db/campaign-retrospectives.ts (and
     lib/db/post-dimensions.ts if it exists), plus the outcome functions in memory-performance.ts, takes
     businessId and filters on it. Prove it with wrapper tests.
   - Tier 3: scan the outcome RPC SQL BODIES - not their signatures, the ADR 0025 15.1 lesson - for a
     business_id predicate on every table each body reads ([test-3c]).
   - get_learning_cycles_northstar is the ONE declared exception: an ops aggregate, service-role only. Allowlist
     it BY NAME, with the reason.
   - Redden: remove one predicate from demote_outcome_pattern's subquery in a scratch migration. Revert.
2. Re-run and redden every Tier-3 check at HEAD: 6, 7 (scan half), 16 (scan half), 28, 29
   (`git diff BASE..HEAD -- lib/learning/ <ADR 0018 migrations>` is EMPTY), 30, 31, and 34 (the three D2.5 rows
   present). Also confirm: no new dependency in package.json, no /analytics route, no experiment or holdout
   code.
3. Amendments, each ADDITIVE and citing ADR 0026:
   - ADR 0016 Amendment C;
   - an ADR 0018 note: another writer exists; a new AFTER INSERT trigger on post_ai_originals; no line of its
     pipeline changed, with the path-check command;
   - an ADR 0024 note: hookType added, schema version unchanged;
   - an ADR 0025 Section 5.4 correction note: ADR 0026 Section 9's text.
   Confirm ADR 0028 Amendment A (J2.1) and ADR 0017 Amendment C (J2.10) are present.
4. ADR 0026: append a "Builder verification (J2.13)" section. DO NOT edit Sections 0-16. The section carries
   the 35-row constraint -> CI map: constraint; tier; test file, command or protocol; closing step and SHA; the
   executing CI job (app-tests / db-tests / none-by-decision / out-of-band). Leave the "executed green in CI at
   <sha>" column EMPTY until the runs for the pushed head have been OPENED and read. Then fill it with run ids
   and the db-tests skip-guard file and test counts, read FROM THE LOG. Write no total until every cell is
   filled from a run you opened.
5. Tier E - OUTCOME-PREDICTION-ACCURACY (35). Record ADR 12.4's protocol as a runnable procedure: the per-arm
   floor (n >= 15), the "association, not validation" label, and "MEASURED - NOT YET RUN; earliest ~T0 + 150
   days; T0 undefined today". Run nothing.
6. docs/backlog.md: deliberate experimentation with its volume trigger; the hook_type kappa check; every ADR 15
   deferral not already owned elsewhere.

Commit: "J2.13 OUTCOME-NO-CROSS-BUSINESS OUTCOME-PREDICTION-ACCURACY (Tier-3 re-verified, amendments,
constraint->CI map)". Push. Open the CI runs for the pushed head and read them. Then fill the map as a separate
commit, "J2.13b constraint->CI map filled at <sha>". If db-tests is red, open the run and distinguish a
DB-behaviour regression from a stack failure (image tag or SIGSEGV, as in Session 32-D), and say which.

End with one line: "Session 33 Builder complete - range BASE..HEAD, 14 steps, <n>/34 non-E OUTCOME-*
constraints executed green in CI at <sha> (Tier-1 rows <a>/18, Tier-2 rows <b>/20, Tier-3 rows <c>/8
re-verified), Tier E recorded not run, LinkedIn metrics <served|NOT_IMPLEMENTED>." Then STOP.
```

**Gate:** `§3` below was authored alongside this section. It may be pasted once `J2.13b` has pushed and its CI
runs have been read. `§4` is authored **only after** the Reviewer has run.

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

**✅ AUTHORED 2026-09-19 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** It was authored **alongside §2**, per its own gate. **Only
the commit range is filled in at run time, by the Reviewer itself.**

**Two corrections to the placeholder, carried into the primer:**

1. **The SHARED-FUNCTION CALLERS target moved.** The placeholder says every `lib/db/memory-performance`
   function "now has two callers". ADR §5.6 deliberately gives the outcome writer **its own functions**, so
   **no existing writer gains a caller**. A Builder that routed outcome writes through
   `upsertDistilledPerformancePattern` or `promotePerformancePattern` has broken ADR §5.6. That is a finding in
   itself, not a caller-coverage question. The real shared surfaces are:
   - `listPerformanceMemoryCandidates` — two call paths, both now required to exclude outcome rows;
   - the three prompt render sites;
   - every creator of a `post_ai_originals` row, now covered by the trigger rather than by per-caller code;
   - `list_posts_for_metrics_sync`'s caller;
   - ADR 0018's CTA function, which has a new importer.
2. **"Two writers" is three** (ADR §1.1 item 2). The key-collision finding the placeholder predicts now spans
   `distilled`, `import` and `outcome`.

The placeholder's five predicted findings stand and are sharpened below.

**ECC budget for this phase — one subagent invocation, total.** The Reviewer reads the diff itself. A walk of
the constraint table against CI logs is not code analysis, and handing it to cold-starting subagents
re-derives what the Reviewer has already read. **The one exception is `ecc:silent-failure-hunter`,** run once
over a closed file list:
- `lib/outcomes/**`
- `app/api/cron/extract-outcomes/**`
- `lib/metrics/orchestrator.ts`
- the two `fetchPostMetrics` bodies

The reason is structural. This worker turns failures into **skip counters by design** (`skippedNoMetrics`,
`skippedIneligibleField`, per-item `try/catch`). Telling a *decided* skip from a *swallowed* error is exactly
that agent's lens, and it is the one defect a constraint walk reads straight past, because every test stays
green.

**Skills are free:**
- `supabase:supabase-postgres-best-practices` for the four migrations.
- **`impeccable`, run read-only, as an audit of the `J2.12` surfaces** against ADR 0026 §10. This is the one
  read-only design-skill use the constitution permits outside a Builder, and its output is evidence for
  findings, never a patch.

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 33 Track J - REVIEWER phase (J3). You are independent. You MODIFY NOTHING: no source, no tests, no
migration, no ADR, no build guide. Your single output is docs/reviews/session-33-reviewer.md. This is the ONE
review pass for this session.

PROC-REVIEW-AT-COMMIT IS ABSOLUTE AND IS YOUR FIRST OBLIGATION.
Read every artefact AT THE STATED COMMIT RANGE - git diff <base>..<head>, git show <sha>:<path>,
git log --oneline <base>..<head>. NEVER at HEAD. Reading at HEAD produced a false-positive MAJOR in Session
21B. Your report MUST OPEN with:
  "Scope reviewed: <base>..<head>; all citations are git show <sha>:<path> at that range, never HEAD."
A report that does not name its range is not a valid review.
Exception (Session 22-F, NEW-12): documents you audit AGAINST are named at their own commits, SEPARATELY:
  "ADR 0026 read at <sha>; build guide read at <sha>; reviewed artefacts read at <base>..<head>."
<base> is the docs-only commit that put ADR 0026 into git (Section 2 precondition). If ADR 0026 was not in git
at <base>, that is your first finding.

WHAT YOU ARE AUDITING AGAINST:
- docs/decisions/0026-outcome-loop.md - ALL of it; Section 13's 35 constraints are the checklist; Section 16's
  dispositions are rulings, not open questions.
- docs/build-guide/session-33.md: Section 0 (L-1..L-9, D-1..D-7), Section 0.2 (A-1..A-6), and Section 2b's
  step table (which step closes which constraint).
- The amendments ADR 0026 requires: ADR 0016 C, ADR 0017 C, ADR 0018 note, ADR 0024 note, ADR 0025 5.4 note,
  ADR 0028 A, ADR 0010 Amendment 2 D2.5 rows.
- docs/decisions/0015-test-execution-and-ci-gates.md Section 2 and Amendment B; docs/decisions/0018 (which
  must be behaviourally untouched).
- CLAUDE.md: test-execution integrity, DB access, three clients, RLS and the erasure cascade, the worker
  console.log carve-out, UI Component patterns.

KNOWN AND NOT FINDINGS AGAINST THE BUILDER:
- LinkedInProvider.fetchPostMetrics still throwing NOT_IMPLEMENTED is COMPLIANT if ADR 0028 Amendment A
  records that the counts were unverifiable under current scopes. A finding is warranted only if a scope was
  added or LinkedIn impressions/reach/saves/clicks are read.
- The pattern layer is empty in production (no real customer has published). Not a defect.
- hook_type and proof_type collected but never promoted is the design (ADR 4.1).
- origin_mode rarely populating is disclosed (ADR 4.1), not a bug.
- Human-written posts have no post_dimensions row - correct (ADR 4.2).
- LinkedIn's count basis is a known, disclosed bias (ADR 6.2); some false-positive promotions are an accepted
  risk (ADR 6.4). Judge the disclosure, not the statistics.
- No business attribution and no UTM (ruling A-5).
- OUTCOME-PREDICTION-ACCURACY not run is correct. A finding is warranted if any number is reported as COVERED
  or as causal, or if "association, not validation" is missing.
- acknowledge_campaign_retrospective taking a fourth p_pattern_text parameter is the recorded way ADR 8.4's
  TS-side neutralisation applies; judge that the RPC still derives every stat itself.
- A live X smoke recorded NOT YET RUN is correct.

THE TEN THINGS MOST LIKELY TO BE WRONG, in the order I want them checked:

1. AN N-FLOOR TEST THAT CANNOT FAIL. The six cases of ADR 12.1 must each be independently load-bearing. Redden
   each gate YOURSELF on a scratch branch: remove the campaign gate (only case 2 may fail), weaken the bound
   (case 3), drop k (case 4), read stored outcome_n (case 5). A case that stays green under its own mutation
   is a BLOCKER. Confirm the cases call the RPC over seeded rows - a Tier-2 test over a mocked RPC is not the
   proof.

2. A FLOOR THAT TRUSTS ITS CALLER. upsert_outcome_performance_pattern must take NO stats parameters. grep every
   migration in the range: the Wilson formula appears ONCE (wilson_bounds) and every RPC calls it. The TS side
   must not re-implement the gate anywhere a test relies on it.

3. A DEMOTION PATH WITH NO COVERAGE. The window-bound failure, the 4-of-last-5 fast trigger (ordered by
   published_at, not id or created_at), 3-of-5 NOT demoting, the concurrent single transition, the 180-day
   exclusion, contradicted_at set once, and demote recomputing its own inputs. A demotion test seeded so that
   the window bound AND the fast trigger both fire proves neither - check each fires alone.

4. A KEY COLLISION RESOLVED SILENTLY. Across three writers (distilled, import, outcome): both namespace CHECKs
   exist; the distilled index is byte-identical to before; upsert_distilled_performance_pattern cannot touch an
   outcome row and vice versa (tested both directions); promote_performance_pattern cannot promote an outcome
   row. The CHECK widening found the old CHECK by DEFINITION and RAISEd on anything but one match - query
   pg_constraint at <head> and confirm no stale CHECK survived beside the new one.

5. A FORGEABLE STORE. As authenticated: INSERT with source <> 'manual' rejected; UPDATE of outcome_n, pattern,
   source, pattern_key or dimension on an outcome row rejected; retire allowed. Tested as the authenticated
   role against live Postgres - a pg_policies read is not the test. No app/** code writes performance_memory
   with an authenticated client (git grep at the range).

6. A LITERAL ZERO, REINTRODUCED OR NEW. MINOR-2's lines in lib/memory/performance.ts unchanged at <head>. No
   null -> 0 in fetchPostMetrics (X reach; LinkedIn's four), in the normaliser (each eligible field), or in the
   render. X impressions = 0 excluded, not divided.

7. TAGGING THAT A CALLER CAN MISS OR RETRO-FILL. The trigger fires on a RAW post_ai_originals insert (tested);
   has no EXCEPTION block; no BEFORE DELETE trigger exists on any new table; the history copy wrote only role,
   format and origin_mode. Run the OUTCOME-NO-RETRO-TAGGING scan yourself and redden it. Run
   `git diff <base>..<head> -- lib/learning/ <ADR 0018 migrations>` - it must be EMPTY; any line is a BLOCKER
   against OUTCOME-ADR0018-UNCHANGED, including an added `export`.

8. RETRIEVAL THAT LEAKS. Outcome rows excluded from listPerformanceMemoryCandidates on BOTH call paths; never in
   the "Top-Performing Post Snippets" block; the observed-outcomes block rendered at ALL THREE sites including
   native-generation-prompt.ts (the live Mode-2 generator); hypothesis rows reaching per-post generation is a
   MAJOR - only Stage A may read them.

9. A NORTH-STAR THAT IS PROSE, AND A WRITE-BACK THAT TRUSTS THE FORM. get_learning_cycles_northstar counts only
   acknowledged supported/not_supported retrospectives WITH their outcome:hypothesis memory row (the four-
   fixture test). acknowledgeRetrospectiveAction takes p_user_id from supabase.auth.getUser() - find the line;
   a viewer is refused; exactly one row written; a second call a no-op; inconclusive writes none.

10. A COUNT THAT IS NOT EXECUTED GREEN. OPEN THE CI RUNS for <head>. 34 non-E constraints (rows with a Tier-1
    component 18, Tier-2 20, Tier-3 8 - they overlap), 1 Tier E recorded not run. Read the db-tests skip-guard
    line FROM THE LOG and record file and test counts. If db-tests is red, distinguish a DB-behaviour
    regression from a stack failure (image tag or SIGSEGV, Session 32-D) and say which. pull_request runs never
    move the promotion tally.

ALSO VERIFY, and do not take the Builder's word for any of it:
- SHARED-FUNCTION CALLERS at the range, per caller with its test: listPerformanceMemoryCandidates (context.ts
  path AND studio/actions.ts path); the three render sites; every post_ai_originals creator
  (generatePostsForCampaign, the regenerate action, Studio promote) covered by the raw-insert trigger test;
  list_posts_for_metrics_sync's caller; the ADR 0018 CTA function's new importer. A caller with no test is
  AUTHORED-NOT-EXECUTED for that caller.
- No existing lib/db/memory-performance writer gained a caller or a parameter (ADR 5.6).
- Metrics: vendor citations present in ADR 0028 Amendment A for every field read; no scope added in
  platforms/config.ts; the cadence Tier-1 test covers day 1/3/7 and the gaps; METRICS_MAX_AGE_DAYS 9 via
  lib/config.ts.
- The seed: used on X only, only when the run's recorded basis is 'rate', stamped baseline_source, propagated
  to baseline_seeded; no source='import' row read or written by the outcome path.
- Constants transcribed exactly (ADR 6.4 block) with SQL twins documented; none read from env.
- The worker: its own route and orchestrator; the tick line's key set equals ADR 14's; no content or business
  id in it; per-item try/catch; a replayed tick changes nothing; OUTCOME-DETERMINISTIC-NO-LLM scan reddened.
- Brief: Zod ranges exactly ADR 8.1's; the freeze guard's existing Tier-1 test unmodified; old briefs parse.
- GDPR: three tables, SELECT-only RLS, no authenticated write policy, ON DELETE CASCADE, the three D2.5 rows
  VERBATIM and landed in the SAME commit as the migration; the purge test holds rows in all three.
- UX: every ADR 10.2 state and disclosure; not on the approval gate; no /analytics route; the copy lint covers
  en, pt, es AND the rendered template and reddens in each; no asChild on Button or DropdownMenu; i18n parity.
  Record what taste-skill and impeccable changed per the J2.12 commit body and whether it broke the contract.
- The Tier-3 set re-run by you at <head>, each reddened: 6, 7, 16, 28, 29, 30, 31, 34.
- L-1 scope: no experimentation, UTM, conversion ingestion, analytics page, cross-type retrieval, extra memory
  writer, comment mining, embeddings, new scope, or model call in the extractor.
- Migrations: none edited after commit (git log --follow per migration file); database-reviewer and
  security-reviewer findings fixed by forward migration and recorded in the J2.6 / J2.11 commit bodies.
- ECC budget: at most three Builder subagent invocations, per the commit bodies. Exceeding it is a process
  finding, not a code defect.

ECC BUDGET FOR YOU: ONE subagent invocation. Dispatch ecc:silent-failure-hunter ONCE, read-only, AT THE RANGE,
over exactly lib/outcomes/**, app/api/cron/extract-outcomes/**, lib/metrics/orchestrator.ts and the two
fetchPostMetrics bodies. Ask one question: "which catch, skip counter, null-return or ON CONFLICT DO NOTHING
here hides an error rather than recording a decided exclusion?" Its output is evidence you verify, not
findings you copy. Skills are free: supabase:supabase-postgres-best-practices; impeccable READ-ONLY as an audit
of the J2.12 surfaces.

Acknowledge in ONE line, naming the commit range you have been given and confirming you will read at that
range and never at HEAD. Then STOP and wait for the review prompt.
```

### §3b — Reviewer prompt  (paste after the primer is acknowledged)

```
Review the Session 33 Track J Builder range and write docs/reviews/session-33-reviewer.md.

Open with the range line (PROC-REVIEW-AT-COMMIT), and name SEPARATELY the commits at which you read ADR 0026
and docs/build-guide/session-33.md.

Organise findings by ADR 0026's own sections so the correction pass can cite them:
  1. The metrics input and cadence: ADR 0028 Amendment A, verified fields, no scope added (Section 3; A-3)
  2. The dimension taxonomy: the trigger, write-once, the history copy, hookType (Section 4; L-4, A-6)
  3. The writers to performance_memory: CHECKs, namespaces, the sibling index, the stats columns, the RPCs,
     write protection, SHARED-FUNCTION CALLERS (Section 5; D-4, A-2)
  4. Normalisation, the floor, confidence, retrieval and render (Section 6; L-2, L-3)
  5. Decay, re-confirmation and contradiction (Section 7)
  6. The retrospective, the brief amendment and the north-star (Section 8; L-6, A-1)
  7. Provenance and the seed (Section 9; L-5, A-4)
  8. The UX contract and attribution honesty, including what taste-skill and impeccable changed (Section 10;
     L-7, A-5)
  9. GDPR and tenancy: three tables, RLS, D2.5 rows, purge (Section 11; L-8)
 10. The test plan: every constraint's tier, its executing CI job, whether it REDDENS if the property breaks,
     the Tier-3 set re-run by you, and Tier E framed MEASURED as "association, not validation" (Section 12)
 11. The worker, config and amendments (Section 14)
 12. Scope: L-1's out-of-scope list not shipped; lib/learning/ untouched

Severities: BLOCKER / MAJOR / MINOR / NIT, each with a STABLE ID (BLOCKER-1, MAJOR-2, ...) that the correction
pass will cite. For each: what is wrong, file:line AT THE RANGE, why it matters, and what would prove it fixed.
Do not propose patches - you write no code.

Where you believe ADR 0026 ITSELF is wrong rather than the implementation, say so and mark it an ADR finding,
not a Builder finding. The ADR already absorbed one advisory round (database-reviewer, mle-reviewer,
pr-test-analyzer - Section 16); a further defect is entirely possible and you should say so if you find one.

Run the verification yourself rather than trusting the Builder's report:
  npm run typecheck ; npm run test:app ; npm run test:db
  the J2.2 source scans and scripts/check-adr0018-unchanged, each reddened
  the six floor cases and the demotion cases, each gate mutated on a scratch branch
  the copy lint, reddened in en, pt and es
  git grep for every SHARED-FUNCTION CALLERS surface and its callers
Open the CI runs for <head> and read the db-tests skip-guard line from the log. If db-tests is red,
distinguish a DB-behaviour regression from a stack failure and say which.

State plainly anything you could NOT verify and why. A live X metrics response, LinkedIn's readability under
current scopes beyond the recorded citation, the production cron actually running daily, and any predictive
value of a promoted pattern are all unverifiable in this session - saying so is worth more than a confident
guess. Do not pad the report.

End with one line: "Session 33 review complete - <n> findings (<b> BLOCKER, <m> MAJOR, <mi> MINOR, <ni> NIT)
over range <base>..<head>; <c>/34 non-E OUTCOME-* constraints verified executed green in CI (Tier-1 rows
<a>/18, Tier-2 rows <t>/20, Tier-3 rows <d>/8 re-verified); Tier E recorded not run." Then /exit.
```

**Gate:** `§4` is authored **only after** this Reviewer has actually run and
`docs/reviews/session-33-reviewer.md` exists. A correction pass is a response to findings; inventing them
ahead of time produces a fictional resolution log.

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

**✅ AUTHORED 2026-09-20 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.**

**Filled in from `docs/reviews/session-33-reviewer.md`** (Reviewer range **`75cae307..879737c7`**, 14 commits
`J2.1` `c787e633` … `J2.13b` `879737c7`, on branch `session-33-adr-0026`). **Ten steps: D0–D9.** Correction
passes are normal, not failures (constitution). **There is no independent re-review pass this session**
(mirroring 23-D…32-D): this pass fixes the Reviewer's findings, records its own resolutions in the Reviewer's
own file, and the founder adjudicates close-out.

**Reviewer's tally: 0 BLOCKER, 2 MAJOR, 7 MINOR, 3 NIT — 12 findings.** Every one appears **exactly once** in
the disposition table below. **Two are ADR findings** (MINOR-4, MINOR-6), where the Reviewer judged ADR 0026
itself wrong or silent; each closes with an **appended** ADR 0026 §VI entry as well as, where applicable, code.

> **No finding is deferred by this guide.** There is no deferral column and no `docs/backlog.md` row for any
> finding. A step that cannot close its finding **REPORTS and STOPS**; only a founder ruling can move a
> finding out of this pass. This is the guide's posture, not a founder instruction — if the founder issues
> one, record it here verbatim beside this note.

**This pass starts from a green, pushed range — that is the unusual part, and it changes the shape of the
close-out.** Unlike 32-D there is no `BLOCKER-1` equivalent: `879737c7` is pushed to
`origin/session-33-adr-0026` and all three required workflows are green at it (app-tests `35509193435`,
db-tests `35509193408` with its skip-guard quoted, eval `35509193581`), and 34/34 non-E constraints are
verified executed green. **So D9 does not rescue an unexecuted range; it re-greens a range this pass has
changed, and re-dates every constraint claim to the corrected head.** A claim dated to `879737c7` after
D1–D8 have landed is stale, and re-dating it is the whole point of the step.

**The two MAJORs are different kinds of defect and only one is behavioural.**
- **MAJOR-1 is an architectural divergence that is silent.** Six `lib/db/` readers behind the campaign detail
  page self-acquire the **service-role** client, so `OUTCOME-RLS-ISOLATED` — 24 Tier-1 tests, green in CI —
  protects nothing in production. Nothing leaks today; the layer that would catch a future leak was removed
  without a ruling saying so. CLAUDE.md's three-client table and build-guide §0 **L-9** (*"service-role never
  in a user-facing read path"*) both forbid it.
- **MAJOR-2 is a live failure path with no observer.** J2.1 made `fetchPostMetrics` real, which turned
  `lib/metrics/orchestrator.ts:99-106`'s `else` branch from unreachable into the primary failure path for
  every X token expiry, revocation, rate limit and shape mismatch — and that branch binds nothing, logs
  nothing and captures nothing. Seven days later the outcome tick launders the result into the benign
  `skippedNoMetrics`. **An ongoing auth outage is indistinguishable from a quiet week, on the one input this
  whole session exists to consume.**

---

### Founder adjudications — **none required; one remedy would have needed one and was NOT taken**

A-1…A-6 (§0.2) stand untouched and are **not** reopened. **No step in this pass is gated on a pending
ruling.** One remedy in the Reviewer's report would have been a founder decision, and this guide records why
it is not the one taken:

| # | The remedy that would need a ruling | Why this pass does not take it |
|---|---|---|
| **MAJOR-1 option (b)** | Keep service-role on the campaign detail page, recorded as an amendment to CLAUDE.md's three-client table **and** to build-guide L-9, with ADR 0026 §10.4 stating why RLS is not the guard on this surface. | It **weakens two binding rules to match code written without noticing them**. Option (a) — the six readers take a `client` and the page passes the authenticated anon client — restores the rule rather than amending it, needs no ruling, and is what every comparable page read already does (`opportunities/page.tsx:48-50`, `settings/signals/page.tsx:47-50`). **If the founder prefers (b), D1 STOPS and the ruling is recorded here before anything is written.** |

**Engineering decisions this pass takes without a ruling, with the reason:**

| Finding | Remedy chosen | Why no ruling is needed |
|---|---|---|
| **MAJOR-1** | Option (a): page reads take a `client`; the AI-layer and worker paths keep service-role through **separate** functions | This is the established `lib/db/` split the Reviewer named (`insight-cards.ts:67,91,110` take a client; `:148,187,210` self-acquire). It conforms to L-9 rather than amending it. |
| **MAJOR-2** | Capture the bound error with platform and post id tags, **and** split `skippedNoMetrics` into "no metrics row ever written" versus "written but staler than day 7" | The capture shape is already this session's own (`lib/outcomes/orchestrator.ts:125-127`). The counter split changes ADR §14's canonical sixteen-key set, so it lands **with** its appended ADR amendment at D8 — never silently. |
| **MINOR-6** | Record at ADR 0026 §VI that descriptive display of `hook_type` / `proof_type` is **deferred**, and that `hook_survived` is stored for that future surface, naming its owner | Shipping the display surface in a correction pass is new scope and L-1 forbids it. The Builder already took the safe reading; the defect is that it was taken **silently**. |
| **MINOR-7** | Distinguish the two X shapes that are distinguishable **from the response**, and leave the rest owed to the first live smoke in ADR 0028 Amendment A A.5 | The Reviewer states plainly this cannot be closed from documentation. Half of it is closable in code today; claiming the other half would be a fabrication. |
| **NIT-2** | **Recorded closure, no code** | Commit bodies in a pushed range cannot be rewritten. The budget was not exceeded (≤ 3 declared, 2 attributable); the appendix names the unattributed first invocation. |

---

### What the Reviewer found — disposition of all 12 findings (`session-33-reviewer.md` is authoritative)

| ID | Tier | One line | Disposition | Step |
|---|---|---|---|---|
| **MAJOR-1** | MAJOR | Six page readers self-acquire service-role; the three tables' SELECT policies are never evaluated in production | FIX (option a) | **D1** |
| **MAJOR-2** | MAJOR | The now-live metrics `else` branch records no diagnostic; a real X failure becomes `skippedNoMetrics` | FIX (+ ADR §14 key-set amendment at D8) | **D2** |
| **MINOR-1** | MINOR | `retrospective.ts:147-149` swallows its error without capturing it | FIX | **D3** |
| **MINOR-2** | MINOR | The cron route's bare catch fabricates a zeroed summary and logs it as fact, returning 200 | FIX | **D3** |
| **MINOR-3** | MINOR | A member may rewrite an outcome row's `pattern` in the same UPDATE that retires or soft-deletes it | FIX (migration) | **D4** |
| **MINOR-5** | MINOR | `unavailablePlatforms` hard-codes platform capability outside `/lib/social/` | FIX | **D5** |
| **NIT-3** | NIT | `getEngagementSeed` does not filter the backfill run by status | FIX | **D6** |
| **MINOR-7** | MINOR | X's `return null` conflates "post deleted" with "this account can no longer read `public_metrics`" | FIX (partial, by recorded decision) + owed item | **D7** |
| **MINOR-4** | MINOR (**ADR**, §V.2) | The constraint→CI map names `app-tests` for row 29; CI runs only its detector | FIX (ADR) | **D8** |
| **MINOR-6** | MINOR (**ADR**, §4.1/§4.4 vs §10.2) | ADR 0026 is internally inconsistent; the Builder took the safe reading silently | FIX (ADR) | **D8** |
| **NIT-1** | NIT | ADR 0026's header still cites ADR 0016 Amendment C / ADR 0017 Amendment C; they landed as D / E | FIX (ADR) | **D8** |
| **NIT-2** | NIT | The ECC budget cannot be fully audited from the range — no commit body says "1 of 3" | RECORDED CLOSURE | **D8** |

**Count check, re-run at D9:** 12 rows, 12 distinct IDs, every ID from the Reviewer's findings index exactly
once. If it fails, the pass is not closed.

---

### Ordering rationale

1. **D0 first.** `docs/reviews/session-33-reviewer.md` is **untracked**, and it must enter git exactly as
   written so the appendix diff proves itself additive. `docs/build-guide/session-33.md` is tracked but its
   committed version (last touched `0c79d118`, before BASE) predates this §4 — the pass's own work order —
   so it lands in the same commit. ADR 0026 is already tracked (`75cae307`).
2. **D1 (MAJOR-1) is the first code step and the largest.** It changes six function signatures and the page
   that calls them; every later step's test run should already be against the corrected read path. It is also
   the only step whose remedy the founder could overrule, so it runs while the pass still has nothing to undo.
3. **D2 before D3.** MAJOR-2 defines the observability shape (bound error, `Sentry.captureException`, `cron`
   and `phase` tags) that D3 then applies twice. Writing D3 first would pin a second, unrelated shape.
4. **D3 groups the two remaining silent-failure findings** (MINOR-1, MINOR-2): same class, same proof
   standard, neither behavioural beyond what it makes visible.
5. **D4 is the only migration, and it runs alone** (the 31-D D5 / 32-D D3 precedent). A second migration
   mid-pass makes every earlier `test:db` run meaningless. It follows D1 because D1's Tier-1 RLS test seeds
   the same tables and must be green before the write-protection trigger changes underneath it.
6. **D5 and D6 are independent single-file fixes** and could run in either order; D5 first because it touches
   `/lib/social/`'s published shape and D6 does not.
7. **D7 is deliberately last among the code steps**, because it is the only one that closes **partially** by
   decision, and the appendix must say so beside a finished record of everything that closed fully.
8. **D8 is documentation truth, after every code step**, because every amendment cites the test that now
   proves it — including MAJOR-2's key-set change, which is not permitted to exist in code without it.
9. **D9 pushes last**, producing green runs for the corrected range and re-dating every constraint claim that
   D1–D8 invalidated.

---

### Where resolutions go (CLAUDE.md — `REVIEWER-REPORT APPEND-ONLY`, revised Session 23-D)

Resolutions go **into `docs/reviews/session-33-reviewer.md`**, under one appended, attributed
`## CORRECTION PASS (Session 33-D)` section at the end; there is no separate corrections file.

**The Reviewer's text is immutable:**
- Not one character is edited.
- No verdict is flipped, and no `RESOLVED` is stamped.
- This includes every "Verified" section, §0's "What I ran" table, the mutation tables in §4.1 and §5, the
  Tier-3 reddening table in §10, the "What I could NOT verify" list and the closing tally line.

**The appendix itself:**
- It references findings **by ID** and records *finding → fix → proving test → SHA*.
- A disputed finding is argued in the appendix, never erased.

**Never weaken a test to reach green.** Amend ADR 0026 (appended, as a new §VI) if a constraint proves
infeasible. Every correction lands as a **new** section, never as an edit to §§0–V — with the single
exception of the one §V.2 cell MINOR-4 names, whose prior text is **quoted in the appendix before it is
replaced**. **Do not fold D0 and the first resolution row into one commit.**

**ECC budget: ≤ 1 subagent per step, and only where the finding names one.**
- **D1** → `security-reviewer` (a tenancy boundary moving from an argument to a policy).
- **D4** → `database-reviewer` (a `BEFORE UPDATE` trigger on a table with two writers).
- **All other steps carry none.** Do not re-run the J2.6 / J2.11 reviewers; the proving test is the
  confirmation. `taste-skill` and `impeccable` are **not** invoked in this pass — no §10.2 state changes.

**The highest-risk classes:**
- **(a) D1.** Passing an anon client into a reader the **worker** also uses would silently empty the worker's
  reads. `listOutcomePatterns` has two kinds of caller — the page (anon) and `lib/memory/outcomes.ts`'s
  retrieval in the generation path (service-role). They must end up as **two functions**, not one with an
  optional parameter that defaults to service-role.
- **(b) D2.** The counter split must not change what `skippedNoMetrics` **means** for an existing dashboard
  reader without the ADR amendment landing with it.
- **(c) D4.** Widening branch C's immutable tuple must not break the legitimate retire/soft-delete path that
  `performance-memory-outcome-schema.test.ts:405` already proves.
- **(d) D5.** The capability flag must make a real LinkedIn implementation flip the disclosure off, and must
  not suppress the disclosure for a campaign that simply has no outcomes yet.

Each step ends by re-running the full existing suite for its files and confirming no previously-green
assertion changed.

---

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
You are the Session 33-D correction pass (Track J, ADR 0026, the outcome loop). You fix the findings in
docs/reviews/session-33-reviewer.md - you do not re-review, and you do not re-litigate the Reviewer's
verdicts. Acknowledge these ten rules, then stop and wait for D0.

1. THE REVIEWER'S TEXT IS IMMUTABLE. Resolutions go in ONE appended, attributed
   "## CORRECTION PASS (Session 33-D)" section at the END of docs/reviews/session-33-reviewer.md, opening
   with author, date and the commit range fixed. Not one character above it changes. A disputed finding is
   argued in the appendix, never erased.
2. ONE STEP, ONE COMMIT, THEN STOP. Each step's commit message is given; use it.
3. EVERY FIX IS PROVED BY MUTATION. Break the fix, watch the new test go RED, restore, confirm
   `git diff --stat` is empty. Record the exact mutation in the appendix.
4. NEVER WEAKEN A TEST TO REACH GREEN. Amend ADR 0026 as an APPENDED section if a constraint is infeasible.
   Never edit a committed migration; correct it with a forward migration.
5. ALL 12 FINDINGS ARE ACCOUNTED FOR; NOTHING IS DEFERRED BY THIS GUIDE. A finding you cannot close, you
   REPORT and STOP. No docs/backlog.md row for any finding. MINOR-7 closes PARTIALLY and NIT-2 is a RECORDED
   CLOSURE - the build-guide section 4 tables say exactly how each closes; follow them, and invent no others.
6. A-1..A-6 ARE RULED AND NOT REOPENED. NO STEP IS GATED ON A PENDING RULING. If you believe a remedy needs
   one - in particular MAJOR-1 option (b), keeping service-role on a user-facing read path - STOP and report.
   Never invent a ruling.
7. ONE MIGRATION, AT D4 ONLY. If another step appears to need SQL, STOP.
8. EVERY STEP'S LOOP: npx tsc --noEmit --skipLibCheck; npm run lint; npm run test:app with app-tests.yml's
   env block; and for D1 and D4, npm run test:db against a running local Supabase stack. If the stack cannot
   start, STOP - a Tier-1 change is never committed unexecuted.
   lib/signals/__fixtures__/eval/corpus-v2-schema.test.ts is a KNOWN pre-existing order-dependent flake that
   passes in isolation, is unchanged since before BASE and is green in CI; it is not yours to fix and not a
   reason to stop.
9. DO NOT PUSH BEFORE D9. The range is already pushed and green at 879737c7; that green is about to become
   stale, and D9 is what makes it true again.
10. SCOPE IS THE FINDINGS. L-1 binds: no experimentation or holdout, no UTM tagging, no conversion ingestion,
    no analytics route, no cross-type retrieval, no additional memory writer, no comment mining, no
    embeddings, no new OAuth scope, no model call anywhere in lib/outcomes/, and lib/learning/ stays
    byte-identical to 75cae307 (npx tsx scripts/check-adr0018-unchanged.ts must still exit 0 at every step).
```

---

### §4.1 — Correction steps

#### D0 — land the governing documents in git  ·  FIRST, by design  ·  no code

```
CORRECTION - Session 33-D · D0. No .ts/.tsx/.sql. No specialist.

THE STATE: docs/reviews/session-33-reviewer.md is UNTRACKED. docs/build-guide/session-33.md is tracked but
its committed version (last touched 0c79d118, before BASE 75cae307) predates this section 4, which is this
pass's work order. ADR 0026 is already tracked (75cae307; its section V at 879737c7).

DO - commit exactly these two paths, AS THEY STAND:
- docs/reviews/session-33-reviewer.md  (EXACTLY as the Reviewer left it)
- docs/build-guide/session-33.md       (with section 4 authored - say so in the commit message)
Do NOT append the CORRECTION PASS section. Do NOT stage any code file; report any present and leave it.
supabase/.temp/cli-latest is untracked noise - do not stage it.

VERIFY: `git show <D0-sha>:docs/reviews/session-33-reviewer.md` byte-identical to the working tree and
containing no "CORRECTION PASS"; `git show <D0-sha>:docs/build-guide/session-33.md | grep -c "### §4.1"`
non-zero; no code file in the commit.
On commit: "D0 - Session 33-D audit trail: the Reviewer's report enters git exactly as written (range
75cae307..879737c7, 12 findings) before any resolution row, so the appendix is provably additive;
session-33.md lands with section 4 authored, since section 4 is this pass's work order." Then stop.
```

#### D1 — MAJOR-1: the campaign page reads through RLS, and a Tier-1 test proves the policy does the work

```
CORRECTION - Session 33-D · D1. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. Invoke
security-reviewer ONCE, after the plan and before the commit. Requires a running local Supabase stack.

THE DEFECT (MAJOR-1): app/[locale]/(dashboard)/campaigns/[id]/page.tsx:66 calls loadCampaignLearningView(),
and lib/outcomes/campaign-view.ts:125-130 fans out to six readers that EACH acquire their own service-role
client: lib/db/campaign-retrospectives.ts getCampaignRetrospective (:71-72), listCampaignPostStates
(:179-180), getFrozenBriefContent (:220-221), listCampaignOutcomeCellSources, and
lib/db/memory-performance.ts listOutcomePatterns (:391-392, called TWICE). createServiceRoleClient() bypasses
RLS, so the post_dimensions / post_outcomes / campaign_retrospectives SELECT policies proved by
OUTCOME-RLS-ISOLATED (24 Tier-1 tests) are never evaluated by the only production code that reads them.
CLAUDE.md's three-client table and section 0's L-9 ("service-role never in a user-facing read path") both
forbid it. Tenancy on this surface currently rests on ONE argument.

BUILD - option (a) from the report; option (b) needs a founder ruling, so if you think it is right, STOP:
1. The SIX readers used by loadCampaignLearningView take `client: SupabaseClient` as their FIRST parameter,
   matching the house split the Reviewer named: page reads take a client (lib/db/insight-cards.ts:67,91,110),
   writes and worker reads self-acquire (:148,187,210). listOutcomePatterns then matches its own sibling
   listPerformanceMemoryCandidates(client, businessId, limit) in the very same file.
2. loadCampaignLearningView takes the client and threads it to all six. page.tsx passes the AUTHENTICATED
   anon client it already has.
3. THE TRAP: lib/memory/outcomes.ts (retrieveOutcomePatterns at :29 and retrieveHypothesisResults at :49) is
   the GENERATION path and legitimately runs service-role. Do NOT give it an anon client, and do NOT add an
   optional parameter that silently defaults to service-role - that reintroduces exactly the bug. TWO
   functions, each named for its caller, with the shared query body factored once.
4. Nothing else changes: the .eq('business_id', businessId) filters stay (OUTCOME-NO-CROSS-BUSINESS), the
   source/status/deleted_at predicates stay, and the Tier-3 wrapper scan's enumerated export list is UPDATED
   to the new names rather than widened.

VERIFY:
- NEW Tier-1 (supabase/__tests__): as an AUTHENTICATED member of business B, through THIS EXACT PATH, a
  campaign of business A returns ZERO rows from all three tables - the RLS policy doing the work, not the
  argument. Seed with the existing supabase/__helpers__/outcome-fixtures.ts.
- REDDEN IT: swap the anon client back to createServiceRoleClient() in one reader -> the new test goes RED
  naming that table. Restore; `git diff --stat` empty. Paste the transcript into the appendix.
- lib/memory/outcome-separation.test.ts still exercises BOTH listPerformanceMemoryCandidates call paths by
  name and stays green. lib/outcomes/__tests__/campaign-view.test.ts, outcome-tables-rls.test.ts and the
  Tier-3 cross-business wrapper scan all green.
- Full loop: tsc; lint; test:app (CI env); test:db.
Append the appendix opening block (section 4.2) and the MAJOR-1 row.
On commit: "D1 - MAJOR-1 closed: the six campaign-learning readers take an authenticated client and the page
passes the anon client, so OUTCOME-RLS-ISOLATED's policies are evaluated by the production read path; the
AI/worker path keeps service-role through a separate named function. A Tier-1 cross-tenant test through the
page path returns zero rows and reddens when a reader is switched back." Then stop.
```

#### D2 — MAJOR-2: the live metrics failure path gets an observer, and stops laundering into a benign counter

```
CORRECTION - Session 33-D · D2. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECT (MAJOR-2): lib/metrics/orchestrator.ts:99-106's else branch does `summary.errors++` with the error
never bound, never logged, never captured. The line is unchanged in the range - but before J2.1 (c787e633)
BOTH providers' fetchPostMetrics threw NOT_IMPLEMENTED, so the branch was unreachable for the only two
platforms the worker syncs. J2.1 made it the live path for every X token expiry, revocation, rate limit,
network error and Zod shape mismatch (twitter-provider.ts:459-465 throws UNKNOWN). The receiving end,
lib/outcomes/orchestrator.ts:139, then counts those posts as skippedNoMetrics - the counter ADR section 6.1
defines as the BENIGN "a post whose day-7 sync never arrived" - and after CANDIDATE_LOOKBACK_DAYS = 30 they
leave the candidate scan and are never frozen.

BUILD:
1. Bind the error and capture it in the shape this session already uses (lib/outcomes/orchestrator.ts:
   125-127): Sentry.captureException(err, { tags: { cron: 'sync-metrics', phase: <the phase>, platform:
   post.platform }, extra: { postId: post.id } }). Keep summary.errors++. Do NOT add a console line - the one
   canonical tick line per invocation is the house carve-out and it stays one.
2. Separate "no metrics row was EVER written" from "a metrics row exists but is older than day 7" in the
   outcome tick, so an auth outage and a quiet week are not one counter. This ADDS a key to ADR section 14's
   canonical sixteen-key set, so: name the new key here, update the tick line, and D8 appends the ADR
   amendment. If the two cases are not distinguishable from what is stored, STOP and report rather than
   guessing.
3. Do not touch twitter-provider.ts in this step - MINOR-7 is D7.

VERIFY:
- Tier-2 in lib/metrics/orchestrator.test.ts: a non-NOT_IMPLEMENTED SocialProviderError produces a Sentry
  capture carrying the platform and post id AS WELL AS the errors increment; a NOT_IMPLEMENTED error still
  takes the unsupportedPlatforms path and captures NOTHING.
- Tier-2 in lib/outcomes/__tests__/orchestrator.test.ts: a post with no metrics row and a post with a stale
  metrics row land in DIFFERENT counters, and the canonical tick line's key set is asserted EXACTLY (not as a
  subset) against its new size.
- REDDEN: delete the captureException call -> the first test RED; collapse the two counters -> the second
  RED. Restore each; `git diff --stat` empty.
- Full loop: tsc; lint; test:app (CI env).
Append the MAJOR-2 row, naming the new key.
On commit: "D2 - MAJOR-2 closed: the metrics orchestrator's now-live error branch binds and captures its
error with platform and post id, and the outcome tick no longer counts a real X failure as the benign
skippedNoMetrics. The canonical tick key set grows by one key, amended in ADR 0026 at D8." Then stop.
```

#### D3 — MINOR-1 + MINOR-2: the last two silent failures in the tick

```
CORRECTION - Session 33-D · D3. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECTS:
- MINOR-1: lib/outcomes/retrospective.ts:147-149 is `catch { result.errors += 1 }` - no binding, no capture.
  The caller (orchestrator.ts:253-254) folds retro.errors into summary.errors without capturing either, so
  listCampaignPostStates, getFrozenBriefContent, the wilsonBounds RPC, insertCampaignRetrospective and the
  deliberate throw at retrospective.ts:57 are ALL invisible. A campaign that fails evaluation looks exactly
  like "not due yet". It is the only per-item handler this session wrote with no Sentry capture.
- MINOR-2: app/api/cron/extract-outcomes/route.ts:60-67 is a bare catch that REPLACES the real summary with
  candidates: 0, matured: 0, outcomesWritten: 0, ... errors: 1, emits that as the canonical outcome.tick
  line, and returns 200. The zeros are not "unknown" - the line ASSERTS that nothing was due and nothing was
  written. The only throws that reach here are the catastrophic ones (a serverOnly() failure, a module-load
  failure, a Sentry.withMonitor failure), which are exactly the ones that need a reason.

BUILD:
1. retrospective.ts: catch (err) { result.errors += 1; Sentry.captureException(err, { tags: { cron:
   'extract-outcomes', phase: 'retrospective-campaign' } }) } - the same shape as D2 and as
   orchestrator.ts:125-127, 202-205, 244-258.
2. route.ts: bind the error, Sentry.captureException it, and emit the line with the counters the tick
   actually reached - or an explicit unknown marker for each - NEVER fabricated zeros. Keep the single
   canonical console line; state in the commit which status code it returns and why.

VERIFY:
- Tier-2: a throwing reader inside the retrospective phase produces a capture with phase
  'retrospective-campaign' AND increments errors.
- Tier-2: a throwing runOutcomeTick produces a capture AND does not report candidates: 0 as a fact - assert
  on the EMITTED LINE, not on the mock.
- REDDEN each by removing the capture / restoring the fabricated zeros; restore; `git diff --stat` empty.
- Full loop: tsc; lint; test:app (CI env).
Append the MINOR-1 and MINOR-2 rows.
On commit: "D3 - MINOR-1 and MINOR-2 closed: the retrospective phase captures its error with a phase tag, and
the extract-outcomes route no longer fabricates a zeroed summary - it captures the throw and reports what the
tick actually reached." Then stop.
```

#### D4 — MINOR-3: the SQL  ·  THE ONLY MIGRATION

```
CORRECTION - Session 33-D · D4. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. Invoke
database-reviewer ONCE, after the plan and before the commit. Requires a running local Supabase stack.

THE DEFECT (MINOR-3): supabase/migrations/20260919130000_performance_memory_outcome_schema.sql:224-247.
Branch B guards pattern_key and dimension. Branch A (:230) allows the update outright when NEW.status =
'retired' OR NEW.deleted_at IS NOT NULL. Branch C (:234-245) guards only the eight stats columns. `pattern`
is in NO branch. So an authenticated member may run
  UPDATE ... SET status = 'retired', pattern = '<anything>'
on an outcome row, and likewise SET deleted_at = now(), status = 'active', pattern = '<anything>'. ADR
section 12.1 lists "UPDATE of an outcome row's outcome_n/pattern/source rejected" as a Tier-1 obligation; the
suite covers `pattern` alone (:386) and retire + outcome_n (:413) - never retire + pattern, which is the one
combination that passes. No such row can reach a prompt (listOutcomePatterns filters status and deleted_at),
so the damage is to the integrity of the stored record of what the system observed.

BUILD - a FORWARD migration only; never edit 20260919130000:
1. Add `pattern`, `platform`, `scope` and `scope_ref` to branch C's immutable tuple for outcome rows.
2. Preserve the legitimate paths: {status: 'retired'} alone still succeeds; clearing deleted_at while status
   <> 'retired' stays rejected by branch A (performance-memory-outcome-schema.test.ts:405 must stay green).
3. Change nothing about the two namespace CHECKs, the two partial unique indexes, or the distilled index -
   the Reviewer verified the distilled index is byte-identical to 20260726020000:26-28 and that pg_constraint
   holds exactly one source CHECK and one dimension CHECK. If your migration would alter either, STOP.

VERIFY:
- Tier-1, as the AUTHENTICATED role against live Postgres, never a pg_policies read:
  {status: 'retired', pattern: 'forged'} REJECTED; {status: 'retired'} alone SUCCEEDS;
  {deleted_at: now(), status: 'active', pattern: 'forged'} REJECTED; a platform/scope/scope_ref forge
  REJECTED.
- REDDEN: drop `pattern` from the tuple -> the forge succeeds, i.e. the new test goes RED. Restore.
- Re-run the whole outcome Tier-1 set (17 files / 222 tests per the Reviewer) plus
  outcome-promotion-floor.test.ts and outcome-tables-rls.test.ts.
- After the migration, re-query pg_constraint and confirm STILL exactly one source CHECK and one dimension
  CHECK; paste the output into the appendix.
- Full loop: tsc; lint; test:app (CI env); test:db.
Append the MINOR-3 row.
On commit: "D4 - MINOR-3 closed by forward migration: pattern, platform, scope and scope_ref join branch C's
immutable tuple for outcome rows, so a member can no longer rewrite an outcome row's sentence in the same
UPDATE that retires or soft-deletes it. Retire-alone still succeeds; the resurrection guard is unchanged."
Then stop.
```

#### D5 — MINOR-5: platform capability belongs to `/lib/social/`

```
CORRECTION - Session 33-D · D5. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECT (MINOR-5): lib/outcomes/campaign-view.ts:139 reads
  unavailablePlatforms: platforms.filter((p) => p === 'linkedin' && !measured.has(p))
"Which platforms can return metrics" is /lib/social/'s knowledge; CLAUDE.md's native-provider rule exists so
consumers talk to the abstraction rather than re-deriving provider facts. Two consequences: when LinkedIn
grants r_member_social_feed, every campaign page keeps printing "Metrics aren't available for LinkedIn yet."
until someone remembers this line; and the !measured.has(p) half shows the same message for a brand-new
LinkedIn campaign with no frozen outcomes yet, indefinitely.

BUILD:
1. lib/social/platforms/config.ts: PlatformOAuthConfig gains an explicit capability field (e.g.
   metricsReadAvailable: boolean) - twitter true, linkedin false, the three unserved platforms false - each
   with the one-line reason comment the file already uses for tokenExpirySeconds. Export it through
   lib/social/index.ts; nothing outside /lib/social/ imports platforms/config directly.
2. campaign-view.ts derives the unavailable set from that capability for the campaign's platforms, and drops
   the !measured.has(p) condition, which conflates "cannot measure" with "has not measured yet".
3. The ADR section 10.2 "metrics unavailable" copy and its i18n keys do NOT change - this step changes where
   the state comes from, not what it says.

VERIFY:
- Tier-2 in lib/outcomes/__tests__/campaign-view.test.ts: with the capability false, a LinkedIn campaign
  reports the disclosure whether or not it has measured rows; FLIP the capability to true and the disclosure
  disappears - the test flips the flag, it does not assert a literal.
- Tier-2: a twitter-only campaign reports no unavailable platform in either state.
- The section 10.2 surface tests (outcome-surfaces.test.tsx, 24 tests) and the copy lint stay green in all
  three locales.
- REDDEN: restore the string literal -> the flip test RED. Restore; `git diff --stat` empty.
- Full loop: tsc; lint; test:app (CI env).
Append the MINOR-5 row.
On commit: "D5 - MINOR-5 closed: metrics-read capability is declared in lib/social/platforms/config.ts and
read through lib/social/index.ts; campaign-view no longer hard-codes 'linkedin' and no longer shows the
unavailable disclosure merely because a campaign has not measured anything yet." Then stop.
```

#### D6 — NIT-3: the seed must come from a run that finished

```
CORRECTION - Session 33-D · D6. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.

THE DEFECT (NIT-3): lib/db/post-outcomes.ts:172-179 takes the newest social_backfill_runs row for the
business and platform by created_at DESC with NO predicate on the run's status. A failed or partially
completed run whose summary already carries an engagementBaseline would seed a brand's X baseline. The basis
guard (OUTCOME-SEED-BASIS-MATCH) still applies and the row is stamped import_seed, so the seed is labelled
and disclosed - which is why the Reviewer graded it NIT, not higher.

BUILD:
1. Filter on the terminal success status ADR 0025 defines for a backfill run - READ ADR 0025 and
   lib/db/types.ts for the exact value; do not guess the string. Keep the created_at DESC ordering and the
   business+platform scoping.
2. Change nothing about the basis mapping (impressions -> rate, raw -> count, anything else -> null) or the
   baseline() guard that refuses a count-basis seed for a rate-basis post.

VERIFY:
- Tier-2: a newer non-terminal run carrying an engagementBaseline is IGNORED in favour of the older completed
  run; a business with only a non-terminal run gets NO seed (the post is then unseeded, not mis-seeded).
- REDDEN: drop the status predicate -> the first case RED. Restore; `git diff --stat` empty.
- The seed/basis tests and the "Compared against the history you imported" surface tests stay green.
- Full loop: tsc; lint; test:app (CI env).
Append the NIT-3 row.
On commit: "D6 - NIT-3 closed: getEngagementSeed reads the newest COMPLETED backfill run only, so a failed or
partial run's summary can no longer seed a brand's baseline." Then stop.
```

#### D7 — MINOR-7: distinguish what the response can distinguish, and owe the rest to the smoke

```
CORRECTION - Session 33-D · D7. /ecc:plan -> /ecc:tdd-workflow -> /ecc:verification-loop. No specialist.
THIS IS THE ONE STEP THAT CLOSES PARTIALLY BY RECORDED DECISION. Read the disposition table before you start.

THE DEFECT (MINOR-7): lib/social/twitter-provider.ts:467 (`if (!pm) return null`) and the call site
lib/metrics/orchestrator.ts:81-84 (`if (result === null) { summary.skippedNoData++; continue }`) together
turn TWO different facts into one benign skip: "this post was deleted" and "this account or app tier can no
longer read public_metrics". The method's own comment claims only the first. If X changes the entitlement,
every post returns null forever, skippedNoData climbs, errors stays 0, Sentry is silent, no post_metrics row
is ever written, and the outcome tick records skippedNoMetrics - a total, permanent loss of the only working
metrics input, indistinguishable from "these tweets were deleted".

WHAT CAN AND CANNOT BE CLOSED TODAY. ADR 0028 Amendment A A.5 concedes the partial-error shape is "NOT
confirmed against X's docs" and api.x.com/2/openapi.json returns HTTP 402. So:
1. CLOSABLE NOW - distinguish on what the response itself carries: a response with a present errors[] block
   (or any documented partial-error marker) becomes a captured SocialProviderError rather than null; a
   response whose data is genuinely absent stays null. Add NO new scope; make NO live call.
2. NOT CLOSABLE NOW - which shape X actually returns for a deleted post. Record it as an owed item in ADR
   0028 Amendment A A.5 at D8, named as the first thing the live smoke confirms, alongside the existing
   retweet_count / repost_count alias item.

VERIFY:
- Tier-2 per shape in the provider's test file: (a) errors[] present -> SocialProviderError thrown, captured
  at the orchestrator by D2's handler, errors incremented, NOT skippedNoData; (b) data absent with no errors
  block -> null -> skippedNoData; (c) a normal response still maps every field with ?? null and no ?? 0.
- REDDEN: collapse (a) back into `return null` -> the first test RED. Restore; `git diff --stat` empty.
- Full loop: tsc; lint; test:app (CI env).
Append the MINOR-7 row, stating PLAINLY which half closed and which is owed to the smoke, and quoting A.5.
On commit: "D7 - MINOR-7 closed in part: an X response carrying an errors[] block is now a captured provider
error rather than a silent null, so an entitlement loss is no longer indistinguishable from a deleted post.
X's actual deleted-post shape remains unconfirmed from documentation and is recorded as owed to the first
live smoke (ADR 0028 Amendment A A.5)." Then stop.
```

#### D8 — documentation truth: MINOR-4, MINOR-6, NIT-1, NIT-2, and the amendments D2's key set requires  ·  no code

```
CORRECTION - Session 33-D · D8. No .ts/.tsx/.sql. No specialist. Every statement cites the test (file:line)
that now proves it, at D1..D7's SHAs.

THE DEFECTS:
- MINOR-4 (ADR): section V.2 row 29 names app-tests as the executing job for OUTCOME-ADR0018-UNCHANGED, but
  scripts/check-adr0018-unchanged.ts:1-6 says in its own header it is "a recorded Tier-3 command, NOT part of
  app-tests" - it needs the BASE commit, which a shallow CI checkout does not guarantee. What app-tests runs
  is lib/outcomes/__tests__/adr0018-guard.test.ts (pure decision logic over synthetic path lists) plus the
  unmodified lib/learning suite. A reader of the map concludes CI would catch an ADR 0018 change; it would
  not. This is a LABELLING defect - the Reviewer ran the command at head (exit 0), ran the raw git diff
  (empty) and proved it reddens, so the property itself holds.
- MINOR-6 (ADR): section 4.1 says hook_type "is collected ... and shown, never promoted" and section 4.4 says
  a hook_type whose opening did not survive the edit is "excluded even from descriptive display" - both
  presuppose a display surface. Section 10.2's state table, which the ADR presents as exhaustive, has NO row
  for hook_type or proof_type. The Builder followed 10.2 (nothing displays either) and hook_survived is
  written and never read - measured.ts:52 computes it, orchestrator.ts:189 stores it, db/types.ts:1642
  declares it, no consumer exists. The safer reading, chosen SILENTLY: section V.5's deviations list has
  three items and not this one.
- NIT-1: docs/decisions/0026-outcome-loop.md:9,12 still read "ADR 0016 - Amendment C" and "ADR 0017 -
  Amendment C". They landed as ADR 0016 Amendment D and ADR 0017 Amendment E. The discrepancy IS recorded at
  section V.5 (:1059-1060) and at the head of each target amendment - but not in the header a reader meets
  first.
- NIT-2: no commit body in the range contains "ECC BUDGET 1 of 3"; d7cbda3d declares 2 of 3
  (database-reviewer) and fb28e6c6 declares 3 of 3 (security-reviewer). The budget was NOT exceeded.

DO - ADR 0026 gains ONE appended section, "## VI. Correction pass verification (Session 33-D)". Never edit
sections 0-V except the single V.2 cell MINOR-4 names, and QUOTE that cell's prior text in the appendix
before replacing it:
1. MINOR-4: row 29's "Executing CI job" cell becomes "none - recorded Tier-3 command, re-run per session (see
   V.3); app-tests runs the detector's unit tests and the unmodified lib/learning suite only". Re-run the
   command yourself at this head, paste the output, and record that it reddens against an older base (exit 1,
   naming the offender) and exits 2 on a missing base.
2. MINOR-6: record that descriptive display of hook_type and proof_type is DEFERRED, that section 10.2's
   table remains exhaustive for what ships, that hook_survived is stored for that future surface, and NAME
   the owner (the session or backlog row that would ship it). State that sections 4.1 and 4.4 presuppose a
   surface that does not exist and that the Builder's reading was the safe one.
3. NIT-1: the two header lines become "C -> landed as D / E, see section V.5".
4. D2's key set: amend section 14's canonical key list to include the new counter, naming it, saying what it
   counts and what skippedNoMetrics now excludes, and citing D2's exact-key-set test (file:line).
5. D4, D5, D7: record the forward migration and the widened immutable tuple against section 12.1's Tier-1
   obligation; the capability source for the section 10.2 "metrics unavailable" state; and MINOR-7's partial
   closure. For MINOR-7 also APPEND the owed item to ADR 0028 Amendment A A.5, beside the existing
   retweet_count / repost_count item - never an edit to A.2.
6. NIT-2: RECORDED CLOSURE in the appendix only - a pushed commit body cannot be rewritten. State the two
   declared invocations with their SHAs, that no third is attributable, and that <= 3 was not exceeded.
7. Do NOT fill any "executed green in CI" cell for the corrected range - that is D9's, from the logs.

VERIFY: `git diff <D7-sha>..HEAD -- docs/decisions/0026-outcome-loop.md` shows additions only, plus the one
named V.2 cell; the same for ADR 0028 (additions below A.5 only). Every citation resolves to a real file:line
at a real SHA - check three at random with `git show`.
Append the MINOR-4, MINOR-6, NIT-1 and NIT-2 rows.
On commit: "D8 - MINOR-4, MINOR-6 and NIT-1 closed and NIT-2 recorded: ADR 0026 section VI records row 29 as
a Tier-3 command rather than an app-tests job, the deferral of hook_type / proof_type display with
hook_survived's owner named, the corrected amendment letters, and D2's new tick key; ADR 0028 Amendment A A.5
gains MINOR-7's owed smoke item." Then stop.
```

---

### §4.2 — Resolution log (the appendix's required shape)

The appendix in `docs/reviews/session-33-reviewer.md` is written **incrementally, one block per step**. D1
opens it, D2…D8 append, and D9 closes it. It is never assembled from memory at the end.

**Opening block (written at D1):**

```
## CORRECTION PASS (Session 33-D)

**Author:** Session 33-D correction pass · **Date:** <YYYY-MM-DD> · **Range fixed:** `879737c7..<D9-sha>`
**Reviewed head:** `879737c7` — the head the Reviewer read; only this pass's §4 and the report itself landed
after it, at D0 (`<D0-sha>`).
**Founder adjudications consumed:** none — A-1…A-6 stand; MAJOR-1 option (b) was available and not taken
(build-guide §4).
**Everything above this line is the Reviewer's. Everything below it is this pass's.**
```

**Per-finding row shape.** All five fields; a row missing one is not complete:

| Field | What it must say |
|---|---|
| **Finding** | The ID, and nothing restated from the Reviewer's text |
| **Fix** | What changed, in one sentence, naming the file |
| **Proof** | The test file **and line**, never "covered by the suite" |
| **Reddening** | The exact mutation, and the clean tree confirmed afterwards |
| **Commit** | The step's SHA(s) |

**Rows that are not ordinary fixes:**
- **NIT-2** is the only **recorded closure**. It states why no code change can express the fix (a pushed
  commit body cannot be rewritten) and names the two declared invocations with their SHAs.
- **MINOR-7** is the only **partial** closure. It names the half that closed in code, the half owed to the
  first live X smoke, and the ADR 0028 A.5 paragraph that now owes it.
- **MAJOR-2** carries two SHAs (D2's code, D8's ADR key-set amendment) and states the new counter's name.
- **MINOR-4, MINOR-6, NIT-1** are ADR-only closures and cite their §VI sub-item.
- **MAJOR-1** quotes the rule it restored (CLAUDE.md's three-client table, and L-9 verbatim) and records that
  option (b) was available and not taken.

**Every step appends a "what I did NOT touch" line** where it had a tempting adjacent target:
- D1: no change to the `.eq('business_id', …)` filters, and no widening of the Tier-3 wrapper scan's
  enumerated export list.
- D2: no second console line; `twitter-provider.ts` untouched.
- D3: no status-code change beyond the one stated and justified.
- D4: no change to the two namespace CHECKs, the partial unique indexes or the distilled index.
- D5: no §10.2 copy or i18n key change.
- D7: no new OAuth scope and no live call.
- D8: no `executed green in CI` cell filled — left for D9 — and no edit to ADR 0028 §A.2.

---

### §4.3 — Close-out

#### D9 — push the corrected range, re-green CI, re-date every constraint claim, close Track J

```
CORRECTION - Session 33-D · D9. No specialist. THE POINT OF THIS STEP: 879737c7 was green and 34/34 non-E
constraints were verified executed green AT THAT HEAD. D1..D8 changed code, SQL, a provider, a tick key set
and the ADR. Every one of those claims is now dated to a head that no longer exists. This step makes them
true again - it is not a formality.

DO:
1. Push D0..D8; run every required workflow to green at the corrected head:
   - app-tests (tsc + eslint + vitest) - REQUIRED; lint must be green.
   - db-tests INCLUDING THE SKIP-GUARD. If red, OPEN THE RUN and distinguish a DB-behaviour regression from a
     stack OOM (grep the log for SIGSEGV, signal 11, OOMKilled=true, out of memory - the Reviewer found ZERO
     of each at 879737c7), quoting the deciding log line.
   - eval.
2. Record FROM THE LOGS: each workflow's run URL and counts; the db-tests skip-guard line and the app-tests
   skip-guard line QUOTED VERBATIM, as the Reviewer did. Then re-date ADR 0026's constraint->CI map: every
   one of the 34 non-E rows reads "executed green in CI at <corrected head>", not at 879737c7 or eebe96da.
   Tier 1 stays uncovered unless db-tests ITSELF is green. Tier 3 cites the commands re-run at this head,
   including check-adr0018-unchanged.ts (exit 0) per D8's corrected row 29. Tier E
   (OUTCOME-PREDICTION-ACCURACY) stays MEASURED - NOT YET RUN, earliest ~T0 + 150 days, T0 undefined.
3. db-tests PROMOTION TALLY: pull_request runs never move it; only consecutive green master PUSH runs do. The
   Reviewer's runs at 879737c7 were pull_request events and did NOT move it. Record the tally in
   docs/current-phase.md with each run's event type.
4. docs/current-phase.md - Session 33 close-out entry: this pass and its range; real post-correction counts at
   the head they are dated to, never claimed; the tally; the north-star metric restated as COMPUTABLE with the
   date from which it is meaningful; prediction accuracy framed as MEASURED with its earliest-useful date; and
   the fact that the pattern layer is EMPTY in production because no production OAuth app is registered.
5. Section 5 of docs/build-guide/session-33.md - tick each row with evidence, stating per item whether it
   applied.
6. THE APPENDIX CLOSING BLOCK: all 12 findings by ID -> disposition -> proving test -> SHA(s); re-run the
   count check (12 rows, 12 distinct IDs) - if it fails, the pass is not closed. Name the recorded closure
   (NIT-2) and the partial closure (MINOR-7). Answer the Reviewer's "What I could NOT verify" list one item at
   a time: the live X response and LinkedIn readability (STILL unverified - say so, and point at D7's owed A.5
   item); the production cron cadence (still not deterministically testable; the Sentry monitor is the control
   and does not exist in production yet); Tier E (not run, cannot run until ~T0 + 150 days); the db-tests
   per-test retry counts (inspect the JSON artifact this time, or state again that you did not); and whether
   app-tests is green on a cold first-attempt local run (the corpus-v2-schema flake). State which Reviewer
   "Verified" entries have since CHANGED - in particular section 8's service-role reading and section 3's
   caller table, both of which D1 altered - WITHOUT editing them.
7. .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md; log every bug from this pass to .wolf/buglog.json.

VERIFY: `git diff <D0-sha>..<D9-sha> -- docs/reviews/session-33-reviewer.md` shows additions BELOW the
appendix marker and NOTHING ELSE. Required workflows green at the corrected head, or their red explained from
the log with evidence in the appendix.
On commit: "D9 - Session 33-D closed: D0..D8 pushed; app-tests green at <sha> (<URL>); db-tests <state>
(<URL>, skip-guard <n> files / <n> tests quoted from the log); all 34 non-E OUTCOME-* rows re-dated to the
corrected head per tier, Tier E still MEASURED - NOT YET RUN; db-tests tally recorded per run with event type.
The 33-D appendix records all 12 findings - NIT-2 the single recorded closure, MINOR-7 the single partial -
and the diff proves nothing above the appendix changed. Track J closed." Then stop.
```

---

## §5 — Docs to update at close-out (Track J done)

- [x] `docs/decisions/0026-outcome-loop.md` — Accepted, final constraint table, real post-correction counts
      verified executed green in CI at the head they are dated to. **Applied.** §VI.7 re-dates all 34 non-E rows to
      `321911b1` (app-tests 306 files / 4362, db-tests 80 files / 687, both skip-guard lines quoted verbatim; runs
      35545282401 / 35545282403); Tier E stays MEASURED — NOT YET RUN.
- [x] `docs/decisions/0018-diff-based-learning-capture.md` — a note recording that `performance_memory` now
      has a second writer and that ADR 0018's own behaviour is unchanged, with the test that proves it. **Applied**
      (J2.13, `## Note — ADR 0026 adds a writer and a trigger beside this pipeline`, `docs/decisions/0018…:1250`); still
      true at the corrected head — `check-adr0018-unchanged.ts` exit 0 at `321911b1` and after every correction step.
- [x] `docs/decisions/0017-mode-2-upgrade.md` — **only if** the hypothesis/success-criteria fields were
      added under a founder adjudication; otherwise a note recording that they were flagged and deferred. **Applied, the
      first branch:** the fields were added under founder ruling A-1 and recorded as ADR 0017 **Amendment E** (`:882`; the
      ADR 0026 header now says "landed as Amendment E", D8 NIT-1).
- [x] `docs/current-phase.md` — Session 33 entry; the `db-tests` tally with its event type; the north-star
      metric restated as **computable**, with the date from which it is meaningful; prediction accuracy
      framed as `MEASURED` with its earliest-useful date. **Applied** (the Session 33 entry after Session 32's). Two
      "dates" are stated as *conditions*, not calendar dates, because none exists: the north-star is meaningful from the
      first production X connection, and prediction accuracy from ~T0 + 150 days with T0 undefined. Tally unchanged; every
      run is a `pull_request` event.
- [x] `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — cascade row(s), or an explicit
      no-new-row note. **Applied** — three rows (`post_dimensions`, `post_outcomes`, `campaign_retrospectives`) landed in
      the same commit as the migration (`e0ca8cab`); pinned by `lib/db/__tests__/d2.5-outcome-rows.test.ts`. The correction
      pass added **no table**, so no new row was owed (D4's migration replaces one function only).
- [x] `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` — §11 marked shipped; §1's diagnosis
      corrected (it describes the pre-Session-33 state and becomes wrong the moment this lands); §14's
      dependency chain updated. **Applied at D9**, as dated notes beside the unedited text (the same convention as its
      Session 31 correction): §11's heading is tagged SHIPPED with a correction note, §1 gained a note, §14's chain a
      status note. The one honest qualifier is stated in each: the pattern layer is empty in production.
- [x] `docs/backlog.md` — deliberate experimentation with its volume trigger; anything else J1 deferred. **Applied**
      (J2.13): `S33-EXPERIMENT` and the other `S33-*` rows. **No row was added for any finding of the correction pass**
      (rule 5); the two reviewer NITs that D1's and D4's specialists raised are reported in the appendix, not backlogged.
- [x] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md`. **Applied** (`.wolf/` is gitignored, so these are
      local working notes, not part of the pushed range); the bug log `.wolf/buglog.json` was also updated.
- [x] `docs/reviews/session-33-reviewer.md` — exists, names its commit range, carries one appended
      correction-pass section. **Applied** — the range is named at the top of the report, and the single
      `## CORRECTION PASS (Session 33-D)` section is appended; `git diff <D0>..<D9> -- docs/reviews/session-33-reviewer.md`
      shows additions only.

**Next:** `docs/build-guide/session-34.md` — Track K, agency in generation (ADR 0027): read-only tools for
the generator, claim verification against evidence memory, and the campaign planner that reasons about the
role sequence rather than only filling it.
