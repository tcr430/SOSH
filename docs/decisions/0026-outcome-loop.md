# ADR 0026 — The outcome loop: dimension tagging, pattern extraction, campaign retrospective

- **Status:** Accepted
- **Date:** 2026-09-19
- **Track:** J (Session 33). Depends on Track I (Session 32, ADR 0025) having closed — verified: `859fd73f`
  records every required workflow green (db-tests 62 files / 452 tests, app-tests 277 / 3894, eval, Vercel) on
  `session-30-5-adr-0028` (PR #9, not yet merged to `master`).
- **Amends (each additive, recorded in its owning ADR by the Builder, §14):**
  - **ADR 0016** — Amendment C: `performance_memory.source` gains `'outcome'`; `dimension` gains `'role'`,
    `'origin_mode'`, `'length_band'`, `'cta'`, `'hypothesis'`; namespace CHECKs; outcome stats columns; narrowed
    authenticated write surface (§5).
  - **ADR 0017** — Amendment C: `CampaignBriefContent` gains `hypothesis` and `successCriteria` (§8.1,
    founder ruling A-1).
  - **ADR 0018** — a note only: `performance_memory` gains another writer, and a new `AFTER INSERT` trigger reads
    `post_ai_originals`. **No line of ADR 0018's pipeline changes** (§4.2, `OUTCOME-ADR0018-UNCHANGED`).
  - **ADR 0024** — output schemas gain an optional `hookType` (§4.3). `AI_ORIGINAL_SCHEMA_VERSION` is **not**
    bumped.
  - **ADR 0025** — a correction note to §5.4 (§9).
  - **ADR 0028** — Amendment A: real `fetchPostMetrics` for X and LinkedIn, and a day-1/3/7 sync cadence
    (§3, founder ruling A-3).
  - **ADR 0010 Amendment 2 §D2.5** — three cascade rows (§11).
- **Source documents:** `docs/build-guide/session-33.md` (Reality, §0 L-1..L-9, D-1..D-7, §0.1 Q1..Q8, §0.2);
  `docs/brainstorm/ai-quality-track-ideas-and-build-path.md` §11, §12, §14;
  `docs/brainstorm/Chat/ai-social-media-manager-platform-strategy.md` §2, §7, "The metrics I would obsess over".
- **Advisory passes folded in (read-only, one batch):** `ecc:code-explorer` (the seam map — every `file:line`
  below), `database-reviewer` `[db-*]`, `ecc:mle-reviewer` `[mle-*]`, `ecc:pr-test-analyzer` `[test-*]`.
  `ecc:cost-aware-llm-pipeline` consulted as a skill. Dispositions consolidated in §16.

---

## 0. The eight resolved questions (on the record)

| Q | Decision | Loser | Test tier |
|---|---|---|---|
| **Q1** taxonomy | Seven dimensions tagged at generation or measured from the published artefact; **five promotable** (`role`, `format`, `length_band`, `cta_present`, `origin_mode`), **two descriptive-only** (`hook_type`, `proof_type`); new `post_dimensions` table filled by a trigger on `post_ai_originals`; history: generation-time facts only, imports never | a retroactive classifier (L-4); `topic`; `funnel_stage`; tag columns on `posts` | 1 + 2 + 3 |
| **Q2** normalisation / floor / confidence | Day-7 frozen outcome; per-platform own-brand median baseline; win-rate vs baseline; **k = 10**, ≥ 3 campaigns, Wilson LB (z = 1.96) > 0.5; stored confidence shrunk; separate retrieval and render block with n | raw counts; cross-business benchmarks; lift magnitude as the gate; reusing the shared ranking | 1 + 2 |
| **Q3** extractor / writers | Own daily worker `extract-outcomes`, deterministic, no model call; `source='outcome'`; sibling partial UNIQUE; namespace CHECKs; new recomputing RPCs; authenticated narrowed | folding into `sync-metrics` or `lib/learning/*` (D-4); reusing `promote_performance_pattern` | 1 + 2 + 3 |
| **Q4** decay / contradiction | 180-day windowed recompute; recency = newest agreeing post; `expires_at` (ADR 0016 mechanism) at ADR 0018's 90 days; atomic demotion on window LB ≤ 0.5 **or** 4-of-last-5 contrary | monotonically accumulating confidence; hard delete | 1 + 2 |
| **Q5** retrospective / north-star | **Hypothesis and success criteria ABSENT today** → ADR 0017 Amendment C (ruling A-1); deterministic verdict at last publish + max(7, window) days; human acknowledgement writes it to memory; cycle defined in rows | deferring the retrospective (L-6); free-text success criteria | 1 + 2 + 3 |
| **Q6** provenance | Observations only from SOSH-published posts; imports contribute only an X baseline seed, stamped and propagated; no mixed patterns | merging imported and earned at the pattern layer (L-5) | 1 + 2 |
| **Q7** UX | Campaign detail page: retrospective card + observed-outcomes list; not the approval gate; prohibited framing enforced by a three-locale copy lint; no business attribution this session | approval-gate badges; any multiplier or causal framing | 2 |
| **Q8** tests / measurement | Tier 1 for every SQL gate with independently load-bearing cases; Tier 2 through real wrappers; Tier 3 as redden-proven scans; Tier E prediction accuracy as **association, not validation** | Tier-2-only gate proofs over mocked RPCs; a causal claim from an observational comparison | 1 + 2 + 3 + E |

**Where §0's Locked decisions constrain the answers, in one line each:**
- **L-1:** no model call, no experimentation, no conversion ingestion. The metrics fetch enters only by founder ruling A-3.
- **L-2:** n is rendered on every surface, and no multiplier appears anywhere.
- **L-3:** each brand is compared with its own per-platform baseline. Pooling across brands happens only in Tier E, as an evaluation statistic.
- **L-4:** imports and untagged history never become dimension observations, which narrows near-term usefulness (ruling A-4).
- **L-5:** provenance stamped per observation and propagated.
- **L-6:** retrospective ships and defines the north-star.
- **L-7:** engagement only; attribution "none" this session (ruling A-5).
- **L-8:** three new tables with full RLS and cascade obligations.
- **L-9:** every rule inherited; SHARED-FUNCTION CALLERS enumerated in §5.6 and §4.2.

---

## 1. Context and decision summary

### 1.1 The finding, precisely

1. **The metrics worker writes `post_metrics` and nothing else.** `lib/metrics/orchestrator.ts:86-97` calls
   `upsertPostMetrics` (`lib/db/post-metrics.ts`), one row per post overwritten in place (`onConflict: 'post_id'`,
   `post-metrics.ts:12`) — no history is kept. No memory write exists in the file or its imports.
2. **`performance_memory` is written by the edit-signal pipeline, and — since Session 32 — by the import path;
   never by outcomes.** `lib/learning/promote.ts:109-159` and `lib/learning/summarize.ts:184-213` write
   `source='distilled'`; `lib/memory/import.ts:144` (`importPerformanceMemory`,
   `lib/db/memory-performance.ts:260-279`) writes `source='import'`. **This ADR adds the third writer, not the
   second** — the build guide's Reality §2 predates Session 32.
3. **Retrieval always takes the fallback branch.** `lib/memory/performance.ts:41-44`: *"today, this always takes the
   fallback branch and returns exactly what buildCustomerContext already computes today, just capped at 3 instead of
   (up to) 10."*

**Consequence.** The loop that closes today is **AI draft → human edit → memory** — a **taste** loop, running
entirely **before publication**. The **outcome** loop — published post → real metrics → learned pattern → next
generation — has never been wired.

**The naming trap, stated so nobody plans off the schema alone:** a table called `performance_memory`, populated
by the *edit* pipeline, reads to any schema reader as though outcomes feed it. They do not.

### 1.2 Four facts this ADR found that the build guide did not anticipate

1. **There is no metric input at all.** `fetchPostMetrics` throws `NOT_IMPLEMENTED` on both native providers
   (`lib/social/linkedin-provider.ts:342`, `lib/social/twitter-provider.ts:398`). `post_metrics` receives no real
   rows. Resolved by founder ruling **A-3** (§3).
2. **Metric eligibility is narrow and permanent** (ADR 0028 §13.1 item 8, §16 item 11): LinkedIn `saves`, `clicks`,
   `reach`, `impressions` are permanently null (`r_member_postAnalytics` is review-gated and not requested); X has
   no `reach`. LinkedIn therefore cannot support an engagement *rate* at all.
3. **The backfill supplies less than the prerequisite assumed.** Imported posts live in `social_backfill_posts`, not
   `posts`, are deleted after 30 days (ADR 0025 §8.3), carry no Session 33 dimension, and LinkedIn imports carry no
   metrics (`weighting = 'unweighted_no_metrics'`, ADR 0025 §4.1). Under L-4 they cannot be observations. Their
   only durable contribution is the per-run engagement baseline in `social_backfill_runs.summary` — for X.
   Resolved by founder ruling **A-4** (§9).
4. **Governed patterns are rendered as an instruction to imitate, without n.** `lib/ai/prompts/post-generation.ts:179-181`
   renders governed rows under *"## Top-Performing Post Snippets (use for tone calibration)"* as
   `On {platform}: {pattern}`. An outcome pattern rendered there would violate L-2. And the **live Mode-2 campaign
   generator does not render performance memory at all**: `lib/ai/prompts/formats/native-generation-prompt.ts`
   contains no `topContent` / `recentPostPerformance` (grep-verified; ADR 0018 §10.4 NIT-2 recorded the same
   absence). §6.4 addresses both.

### 1.3 Decision ledger (build guide §0 D-1..D-7, as encoded here)

| # | Decision | Chosen | Losers | Where |
|---|---|---|---|---|
| D-1 | Where dimensions come from | tagged at generation (trigger on the AI snapshot) or measured from the immutable published artefact | a retroactive classifier (poisons the store it exists to fill) | §4 |
| D-2 | Comparison basis | the brand's own trailing baseline, per platform | absolute counts (learn follower growth); cross-business benchmarks | §6 |
| D-3 | Promotion rule | k = 10, ≥ 3 campaigns, Wilson LB > 0.5, all rendered | promote-on-any-signal | §6 |
| D-4 | Another writer to `performance_memory` | a distinct extractor, `source='outcome'`, own RPCs, own index | folding into `lib/learning/*` | §5 |
| D-5 | Retrospective | ships here | deferring it | §8 |
| D-6 | Business attribution | engagement only this session; UTM tagging queued for T1-B | implied causal precision | §10 |
| D-7 | Imported-derived patterns | never mixed; import contributes a stamped baseline seed only | merging at the pattern layer | §9 |

### 1.4 Founder adjudications received (2026-09-19; recorded in `docs/build-guide/session-33.md` §0.2)

| # | Question | Ruling |
|---|---|---|
| A-1 | Brief lacks hypothesis / success criteria | **Option A** — ADR 0017 Amendment C adds both (structured criteria) |
| A-2 | `performance_memory` schema changes (§5) | **Approved** — existing distilled index untouched |
| A-3 | No metric input exists | **Implement `fetchPostMetrics` for X and LinkedIn in this session** as an ADR 0028 amendment and the first Builder step, with a day-1/3/7 cadence |
| A-4 | Backfill cannot feed dimension patterns | **(a) Accept** — patterns learn only from SOSH-published posts; imports seed the X baseline |
| A-5 | UTM / conversion data | **None this session**; UTM auto-tagging queued with T1-B; conversion ingestion a later track |
| A-6 | Trigger on `post_ai_originals`; optional `hookType` in ADR 0024 schemas | **Approved** |

---

## 2. What "done" means, and what it does not

**Done:** every post SOSH generates after this ships carries its dimensions from birth; every such post that
publishes gets its real metrics fetched, frozen at day 7 and normalised against the brand's own baseline;
patterns over those outcomes are promoted only past a stated floor, decay, and demote when contradicted;
campaigns are scored against a stated hypothesis and the acknowledged result enters memory; and the north-star
is a query.

**Not done, and said plainly:**
- **This session ships the loop without being able to prove it predicts anything** (§12.4).
- **No real customer has published yet** (production OAuth apps are unregistered — `docs/current-phase.md`), so
  the pattern layer will be empty in production until roughly 2–3 months of real publishing have accumulated
  after launch.
- **Until this ships, the north-star metric — "successful campaign learning cycles completed per active brand" —
  measures a loop that is not fully wired.** It must not be reported before §8.5's query returns a non-zero
  value from real rows.

---

## 3. The metrics input (founder ruling A-3 — ADR 0028 Amendment A)

### 3.1 Real `fetchPostMetrics`, verified before written

`TwitterProvider.fetchPostMetrics` and `LinkedInProvider.fetchPostMetrics` replace their `NOT_IMPLEMENTED` throws.
**ADR 0028 §13's rule binds unchanged: no endpoint, field name or scope is written from memory.** The Builder
verifies each against vendor documentation first and records the citation in ADR 0028's verification log.

| Platform | Fields to populate | Permanently null (never fetched, never zeroed) |
|---|---|---|
| X | `likes`, `comments` (replies), `shares` (reposts + quotes, as the Builder verifies), `impressions`; `saves`/`clicks` if the verified endpoint serves them under the granted scopes | `reach` |
| LinkedIn | `likes`, `comments`, `shares` — **only if** verified readable under the scopes already granted (`platforms/config.ts`) | `saves`, `clicks`, `reach`, `impressions` (A-11, ADR 0028 §16 item 11) |

**Honest fallback:** if LinkedIn's counts prove unreadable under current scopes, `LinkedInProvider.fetchPostMetrics`
keeps throwing `NOT_IMPLEMENTED` (the orchestrator already short-circuits a platform on it,
`lib/metrics/orchestrator.ts:95-97`) and the loop runs on X alone. That outcome is recorded, never papered over.
**No scope is added** — adding one forces re-authorisation of every connected account (ADR 0028 §14.1).

### 3.2 Cadence: day 1, 3 and 7 — not hourly

Hourly polling within `METRICS_MAX_AGE_DAYS` is ~170 reads per post per week against a per-read-billed X API with a
monthly read cap (ADR 0028 §14.3). The outcome loop needs **one** value (day 7); T1-B's future analytics surface
benefits from two earlier ones.

**Decision:** `list_posts_for_metrics_sync` is replaced by a new version whose "due" predicate is
`age ≥ 1d AND last_synced_at < published_at + 1d`, OR the same at 3d, OR at 7d, with
`METRICS_MAX_AGE_DAYS` defaulting to **9**. No new column: `last_synced_at` versus `published_at` already encodes
the stage. **Three reads per post.** The tick keeps its hourly schedule (a due post is picked up within the hour)
and its tick line (`kind: 'metrics-sync-tick'`, `orchestrator.ts:111`) unchanged in shape.

**Loser:** keeping hourly polling (≈ 50× the reads for no outcome-loop value, on a metered API).

---

## 4. The dimension taxonomy (Q1, L-4) — the load-bearing section

### 4.1 The list

| Dimension | Values | Source | Promotable? | The question it lets the system answer |
|---|---|---|---|---|
| `role` | `CampaignPostRole` enum | `posts.role`, written from the frozen `roleSequence` before generation (`lib/campaigns/generate.ts:478-488`, inserted `:539-575`) | **yes** | which post roles earn above-usual response for this brand |
| `format` | `single` / `thread` (+ `carousel` once snapshotted) | `post_ai_originals.format` — the output discriminant | **yes — claims are per platform** `[mle-MAJOR]` | does a thread beat a single post *on this platform* |
| `origin_mode` | `campaigns.origin` enum | the campaign row | **yes — expected to rarely populate** `[mle-MAJOR]` | do signal/objective/studio-originated posts outperform manual briefs |
| `length_band` | `short` / `medium` / `long` | **measured** from the published `posts.content` (§4.4) | **yes** | how long this brand's posts should be on this platform |
| `cta_present` | `true` / `false` | **measured** with ADR 0018's CTA rule function, imported unmodified | **yes** | does a call to action help or hurt |
| `hook_type` | `question` / `statistic` / `contrarian` / `story` / `announcement` / `how_to` | **model-stated** in the output schema (§4.3) | **no — descriptive only** `[mle-MAJOR]` | which openings work (once validated) |
| `proof_type` | `none` / `quote` / `case_study` / `usage_data` / `other` | kinds of the campaign brief's `pinnedEvidence` | **no — descriptive only** | does evidence-backed content outperform |

**Why `hook_type` is descriptive-only.** It is the model's self-report about its own opening; `contrarian` vs
`statistic` and `story` vs `announcement` are judgment calls a model mislabels even when unedited. **Un-defer
trigger:** a one-time agreement check — ≥ 30 sampled posts, model label vs a human read, Cohen's κ ≥ 0.6 —
recorded in this ADR; only then may it become promotable (a Tier-2 constant flip + this ADR's amendment). Until
then it is collected (every day uncollected is a day of untaggable output) and shown, never promoted.

**Why `proof_type` is descriptive-only.** The output schemas carry no per-post evidence citation
(`lib/ai/prompts/formats/schemas.ts:14-81` — `SinglePostOutputSchema`, `ThreadOutputSchema`,
`CarouselOutputSchema` have no evidence field). The only available source is the campaign's pinned set, which is
**constant within a campaign** — so the dimension is fully confounded with campaign identity and a pattern over it
would be a campaign effect wearing a content label. **Un-defer trigger:** per-post evidence citation in the output
schema (Session 34's claim-verification work is the natural owner).

**Excluded dimensions (losers):**
- **`topic`.** There is no controlled vocabulary for it. Free-text topics would need clustering after the fact, which is exactly the retroactive inference L-4 forbids, and at this volume topic moves with the campaign.
- **`funnel_stage`.** It overlaps `role` and `objective`, so it adds comparisons without adding information.

**`origin_mode` degeneracy, stated so its emptiness is not read as a bug.** Most brands at Plus volume run one
origin mode for months; the minority value will rarely reach three campaigns. The dimension is kept because it is
free and exact; the UI shows *"not enough variety yet"* (§10.2) rather than implying a result.

### 4.2 Storage: `post_dimensions`, filled by a trigger — every caller covered by construction

**New table `post_dimensions`**, one row **per AI authorship event** (keyed on `ai_original_id`), immutable:

| Column | Type | Notes |
|---|---|---|
| `ai_original_id` | `uuid PK REFERENCES post_ai_originals(id) ON DELETE CASCADE` | one row per snapshot revision |
| `business_id` | `uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE` | cascade + RLS anchor |
| `post_id` | `uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE` | — |
| `campaign_id` | `uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE` | distinct-campaign gate |
| `platform` | `text NOT NULL` | the cell's stratum |
| `taxonomy_version` | `int NOT NULL` | `OUTCOME_TAXONOMY_VERSION = 1` |
| `role` | `text NULL` | from `posts.role` |
| `format` | `text NULL` | from `NEW.format` |
| `origin_mode` | `text NULL` | from `campaigns.origin` |
| `hook_type` | `text NULL` | from `NEW.payload->>'hookType'`; NULL when absent |
| `proof_type` | `text NULL` | from the frozen brief's pinned kinds |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | — |

Each enum column carries a `CHECK (col IS NULL OR col IN (…))`. Indexes: `(post_id)`; `(campaign_id)`;
`(business_id, platform)`.

**Written by an `AFTER INSERT` trigger on `post_ai_originals`** (`SECURITY DEFINER`, `search_path` pinned). This is
the ADR 0018 §3.4 structural move: tagging attaches to the **artefact**, not to a **function**, so every present
and future creator of an AI post — `generatePostsForCampaign` (`lib/campaigns/generate.ts:400-414`), the
regenerate action (`app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:363`), Studio promote (ADR 0018
Amendment A.1) — is tagged without enumerating them. `[test-BLOCKER-4]` adopted: per-caller Tier-2 tests alone
repeat the Session 22 pattern.

- **The trigger body is total by construction**: reads plus one `INSERT … ON CONFLICT (ai_original_id) DO NOTHING`
  into nullable columns. Missing data (a post with `role IS NULL`, no brief) yields NULLs, never an error. **No
  `EXCEPTION` block** — a genuine defect fails loudly rather than silently untagging.
- **Immutability:** a `BEFORE UPDATE` trigger rejects every UPDATE. **`BEFORE DELETE` is deliberately absent** —
  ADR 0018 `[db-BLOCKER-1]`: a child `BEFORE DELETE` trigger fires on FK cascades and would abort
  `purge_business`.
- **Human-written posts** (no snapshot — ADR 0018 Amendment A.1's binding corollary) get **no row**, and are
  excluded from every dimension cell. That is correct: they have no generation-time tag and L-4 forbids inventing
  one.
- **Which revision applies:** the extractor uses the dimensions of the post's **latest** revision
  (`max(revision)` on `post_ai_originals`), matching ADR 0018's diff-against-latest rule.

**`OUTCOME-ADR0018-UNCHANGED` holds:** the trigger is a *new* object on ADR 0018's table; `enqueue_post_edit_signal`,
the write-once trigger, `lib/learning/**` and every ADR 0018 migration are untouched (founder ruling A-6).

**Losers:** tag columns on `posts` (hot table, `PostUpdate` `Omit` churn, and a regeneration would have to
overwrite them); per-caller application writes (fails the future-caller test).

### 4.3 `hookType` in the output schema (ADR 0024 note, ruling A-6)

`SinglePostOutputSchema`, `ThreadOutputSchema` and `CarouselOutputSchema` each gain
`hookType: z.enum([...6 values]).nullish()` — the `scriptBrief` precedent (`schemas.ts:18`, `.nullish()` per ADR
0022 §7.1): optional, so an older payload still parses. The generation prompt asks the model to state the opening
type it used. **`AI_ORIGINAL_SCHEMA_VERSION` stays 1** — an additive optional field changes no parse, and bumping
it would make ADR 0018's classifier permanently abandon every new signal (ADR 0018 §2.4). A Tier-2 test asserts a
v1 payload with and without `hookType` both classify identically.

### 4.4 Measured dimensions — measured once, from the published artefact

`length_band`, `cta_present` and `hook_survived` are computed by the extractor at maturity (§6.1) from
`posts.content`, which is immutable once published (`updatePostContent` guards `status IN ('draft','approved')`,
`lib/db/posts.ts`), and stored on `post_outcomes`. This is **measurement of the exact artefact, not inference** —
the same class as ADR 0018's deterministic deltas.

| Platform | `short` | `medium` | `long` |
|---|---|---|---|
| X (single) | < 100 chars | 100–220 | > 220 |
| X (thread) | < 4 segments | 4–6 | > 6 |
| LinkedIn | < 600 chars | 600–1,300 | > 1,300 |

`hook_survived`: the normalised first sentence of `posts.content` equals the first sentence of the latest
snapshot's `rendered_content`. A `hook_type` whose opening did not survive the human edit is excluded even from
descriptive display — a tag must describe what was published.

### 4.5 History (L-4, ruling A-4)

- **SOSH posts published before this ships:** a one-off migration may **copy** `role`, `format` and `origin_mode`
  into `post_dimensions` for existing snapshots — these were assigned at generation and are facts, not guesses.
  `hook_type` stays NULL. Measured dimensions are computed normally at maturity. In production this set is
  expected to be empty (no real customer has published).
- **Imported posts:** never tagged, never observations (§9).
- **Loser, named:** "guess retroactively" — excluded by L-4, and not reached for even though it narrows near-term
  usefulness.

---

## 5. The writers to `performance_memory` (Q3, D-4 — ADR 0016 Amendment C, ruling A-2)

### 5.1 How rows are distinguished — in the row, enforced by the database

| | Edit-learned | Imported | **Outcome (this ADR)** |
|---|---|---|---|
| `source` | `'distilled'` | `'import'` | **`'outcome'`** |
| Writer | `lib/learning/promote.ts`, `summarize.ts` | `lib/memory/import.ts:144` | **`lib/outcomes/*` only** |
| `pattern_key` | `kind:direction:platform` / `summarize:…` | NULL | **`outcome:<dimension>:<value>:<direction>:<platform>`**, and `outcome:hypothesis:<campaign_id>` |
| Unique index | `performance_memory_distilled_pattern_key_uq` — **UNCHANGED** | import partial UNIQUE (ADR 0025 §4.3) | **new sibling** `performance_memory_outcome_pattern_key_uq` |

- **`source` CHECK widened** to add `'outcome'`, via `NOT VALID` then a separate `VALIDATE CONSTRAINT`
  (`[db-7]`; the table is populated).
- **`dimension` CHECK widened** to add `'role'`, `'origin_mode'`, `'length_band'`, `'cta'`, `'hypothesis'`
  (`NOT VALID` + `VALIDATE`). `format` is reused. `hook` and `proof_type` are not written by this ADR (descriptive
  only). **The voice-write guard is not affected.** `trg_performance_memory_voice_write_guard` fires only for
  `source='distilled' AND dimension IN ('format','hook')` (`20260726020000_performance_memory_pattern_key.sql:80-115`),
  and no outcome row satisfies that condition. This is stated per `[db-7]`.
- **The new sibling partial UNIQUE:** `(business_id, dimension, coalesce(platform,''), pattern_key) WHERE
  source='outcome' AND deleted_at IS NULL`, plus `CHECK (source <> 'outcome' OR pattern_key IS NOT NULL)`.
  Postgres infers a partial index for `ON CONFLICT` by exact predicate match, so `upsert_distilled_performance_pattern`'s
  `ON CONFLICT … WHERE source='distilled'` (`20260726030000_performance_memory_promotion.sql:63-64`) keeps
  inferring only its own index (`[db-1]`).
- **Namespace CHECKs make the key-collision claim a guarantee rather than a convention** (`[db-1]`, MAJOR):
  - `CHECK (source <> 'outcome' OR pattern_key LIKE 'outcome:%')`
  - `CHECK (source <> 'distilled' OR pattern_key IS NULL OR pattern_key NOT LIKE 'outcome:%')`
- **Loser:** putting provenance inside the key alone. The key is caller-supplied text; `source` is CHECK-constrained and set inside the RPC.

### 5.2 What happens on a key collision (`OUTCOME-KEY-COLLISION-DEFINED`)

- **A literal key collision across writers is impossible.** The two index predicates are disjoint, and the namespace CHECKs above guarantee it.
- **Semantic overlap is expected, and the rows coexist.** For example, a distilled *"shortens LinkedIn posts"* next to an outcome *"short LinkedIn posts beat usual engagement in 9 of 11"*. Each keeps its own evidence.
- **Within the outcome writer,** a second upsert on the same key updates the row in place (recompute, §5.4).
- **Imported and outcome rows expressing the same thing** coexist too (ADR 0025 §5.4's rule, extended). They never merge.

### 5.3 Outcome stats columns (typed, on the row — `[db-4]` adopted over a side table)

Nullable columns, each with `CHECK ((col IS NOT NULL) = (source = 'outcome'))` — the idiom of `pattern_key`'s
CHECK and ADR 0025's import-marker CHECKs:

`outcome_n int`, `outcome_wins int`, `outcome_distinct_campaigns int`, `interval_low numeric(4,3)`,
`interval_high numeric(4,3)`, `metric_basis text CHECK (IN ('rate','count'))`, `baseline_seeded boolean`,
`contradicted_at timestamptz` (this last one nullable even for outcome rows).

A future T1-B reader gets n, interval, basis and provenance as a plain `WHERE source='outcome'` query — **no second
computation** (build guide note of 2026-09-03). **Loser:** a side table (a join on every hot-path read, its own
index, no write-amplification saving since writes are UPDATE-in-place per cell).

### 5.4 New RPCs — recompute, never trust the caller

All `SECURITY DEFINER`, `REVOKE ALL … FROM public`, `GRANT EXECUTE … TO service_role`, as ADR 0018's RPCs:

- **`wilson_bounds(p_wins int, p_n int, p_z numeric)`** returns `(low, high)`. It is `IMMUTABLE`, and it is **the one copy of the formula**, called by every RPC below (`[db-5]`: three inlined copies drift silently).
- **`upsert_outcome_performance_pattern(p_business_id, p_dimension, p_value, p_platform, p_direction)`**
  - Recomputes n, wins, distinct campaigns and bounds from `post_outcomes ⋈ post_dimensions` over the window (§7.1).
  - Writes the row with `source='outcome'`, `status='candidate'`, `sensitivity='internal'` and `public_use_permission=false`, all fixed in SQL.
  - Sets the pattern text from a closed template (§6.4) and runs `neutralizeWithSentinels` at the TS boundary before the call.
  - Takes **no stats parameters**.
- **`promote_outcome_pattern(p_business_id, p_pattern_key)`**
  - One conditional `UPDATE … SET status='active' WHERE status='candidate' AND source='outcome' AND <recomputed n ≥ 10 AND distinct campaigns ≥ 3 AND wilson low > 0.5 (or high < 0.5 for an underperform pattern)>`.
  - The predicate evaluates against one snapshot under the row lock, the `[db-Q6]` property of `promote_performance_pattern` (`20260726030000:102-131`).
  - Double promotion is impossible.
- **`demote_outcome_pattern(p_business_id, p_pattern_key)`**: conditional `UPDATE … SET status='candidate', contradicted_at=now() WHERE status='active' AND source='outcome' AND (<recomputed window bound fails> OR <fast trigger, §7.3>)`. It recomputes its own inputs, the ADR 0018 Amendment D / `20260728220000_demote_recomputes_contradictions.sql` lesson.
- **`acknowledge_campaign_retrospective(p_business_id, p_campaign_id, p_user_id)`** (§8.4).

**Loser:** reusing `promote_performance_pattern`. Its third gate counts `post_edit_signals` for the key
(`20260726030000:118-127`); an outcome key matches zero rows, so outcome patterns would be **silently permanently
unpromotable**. A Tier-1 test proves the distilled RPC cannot promote an outcome row (`[test-1]`).

### 5.5 Narrowing the authenticated write surface (`OUTCOME-WRITE-PROTECTED`, `[db-3]` MAJOR)

The authenticated policies check only `business_id` (`20260719010000_governed_memory.sql:246-253`), so a member can
today insert or update a row with any `source` and, once §5.3 lands, forge `outcome_n`/`outcome_wins`.

- **INSERT:** `performance_memory_insert_own` `WITH CHECK` gains `AND source = 'manual'`.
- **UPDATE:** a `BEFORE UPDATE` trigger (in the shape of `enforce_voice_write_preference_only`'s *"retirement always allowed"*
  branch, `20260726020000:85-88`) permits an authenticated change to a non-manual row **only** to `status='retired'`
  or `deleted_at`; any other column change on a non-`manual` row by a non-service role is rejected. The trigger
  also rejects any change to `source`, `pattern_key`, `dimension` or the §5.3 columns on an outcome row
  (`[db-2]`: outcome immutability, alongside ADR 0025's import-marker trigger).
- **Verified before writing:** no `app/**` code writes `performance_memory` directly (grep, 2026-09-19: only test
  mocks and `BackfillPanel` type imports); ratification is a service-role RPC (ADR 0025 §9.4). The Builder
  re-greps in J2.0; a newly found authenticated writer is a **STOP**, not a policy exception.

### 5.6 SHARED-FUNCTION CALLERS (L-9)

| Function (`lib/db/memory-performance.ts` unless noted) | Callers after this ADR | Covering test |
|---|---|---|
| `upsertDistilledPerformancePattern` | `lib/learning/promote.ts:115`, `lib/learning/summarize.ts:185` — **unchanged, still two** | existing `promote.test.ts`, `summarize.test.ts` + Tier-1 `performance-memory-promotion.test.ts` |
| `promotePerformancePattern` / `demotePerformancePattern` / `countProcessedSignalsForPattern` | `lib/learning/promote.ts` only — **unchanged** | existing |
| `importPerformanceMemory` | `lib/memory/import.ts:144` only — **unchanged** (source-scan enforced) | existing |
| `listPerformanceMemoryCandidates` (read) | `lib/memory/performance.ts:51,140` → `lib/ai/context.ts`, `app/[locale]/(dashboard)/studio/actions.ts:136` | **must now exclude `source='outcome'`** (§6.4 separate retrieval); Tier 2 per caller: `context-callers.context-equivalence.test.ts`, studio actions test |
| **new** `upsertOutcomePattern` / `promoteOutcomePattern` / `demoteOutcomePattern` | `lib/outcomes/extract.ts` only | Tier 1 RPC tests + Tier 2 via the real wrapper |
| **new** `listOutcomePatterns` (read) | `lib/memory/outcomes.ts` → `lib/ai/context.ts`, campaign page | Tier 2 per caller |
| **new** `acknowledgeRetrospective` | `acknowledgeRetrospectiveAction` only | Tier 1 RPC + Tier 2 action |

`listPerformanceCandidatesForRun` (`app/[locale]/(dashboard)/onboarding/step-4/page.tsx:43`) filters by
`import_run_id` and is unaffected. **No existing writer gains a caller** — the structural lesson of both Session 22
blockers is avoided by giving the outcome writer its own functions rather than sharing one.

---

## 6. Normalisation, the floor and confidence (Q2, L-2, L-3)

### 6.1 The frozen outcome: `post_outcomes`

`post_metrics` overwrites in place and engagement accrues with age, so posts must be compared **at the same age**.
The extractor freezes each post's outcome once, from its day-7 sync (`last_synced_at ≥ published_at + 7d`), into:

| Column | Notes |
|---|---|
| `post_id uuid PK REFERENCES posts ON DELETE CASCADE`; `business_id … businesses ON DELETE CASCADE`; `campaign_id … campaigns ON DELETE CASCADE` | — |
| `platform`, `published_at` | copied (the cell stratum and window key) |
| `ai_original_id uuid NULL REFERENCES post_ai_originals ON DELETE CASCADE` | the latest revision; NULL for human-written |
| `metric_basis text CHECK IN ('rate','count')` | §6.2 |
| `value numeric`, `baseline numeric NULL`, `baseline_n int NULL`, `baseline_source text CHECK IN ('own','import_seed') NULL` | — |
| `log_lift numeric NULL`, `beat_baseline boolean NULL` | NULL when no baseline |
| `length_band`, `cta_present`, `hook_survived` | measured (§4.4) |
| `measured_at timestamptz NOT NULL` | — |

Indexes (`[db-6]`): `(business_id, platform, published_at DESC)` serving the baseline and window scans;
`(campaign_id)`. Write-once `BEFORE UPDATE` trigger; no `BEFORE DELETE`.

A post whose day-7 sync never arrives within `OUTCOME_MATURITY_GRACE_DAYS = 2` gets **no row** and is counted
(`skippedNoMetrics`), never guessed.

### 6.2 The metric, per platform (ADR 0028 eligibility)

| Platform | `metric_basis` | Value | Excluded fields |
|---|---|---|---|
| X | `rate` | `(likes + comments + shares) / impressions` | `reach` (permanently unavailable); `saves`, `clicks` never enter |
| LinkedIn | `count` | `likes + comments + shares` | `saves`, `clicks`, `reach`, `impressions` (permanently null) |

**Any eligible field null at day 7 → the post is excluded, never zeroed** (`OUTCOME-ELIGIBLE-FIELDS-ONLY`). An X post
with `impressions = 0` is excluded (division undefined).

**LinkedIn's count is a known, uncorrected bias** (`[mle-MAJOR]`). A growing audience raises raw counts regardless
of content quality, and no follower count is fetched. It is mitigated (not removed) by a shorter baseline window
(§6.3) and **disclosed** on every LinkedIn surface (§10.2): *"LinkedIn results compare engagement counts, which
also rise as your audience grows."*

### 6.3 The baseline

- **X:** the median `value` of the brand's own matured X outcomes with `published_at` in the 90 days before the
  post, excluding the post itself, requiring **≥ 8**.
- **LinkedIn:** the median of the brand's **last 20** matured LinkedIn outcomes before the post (≥ 8 required) — a
  count window, so drift is chased faster.
- **Seed (X only, ruling A-4):** below 8 own outcomes, the most recent `social_backfill_runs.summary` X engagement
  baseline is used **only if** that run's recorded basis is `rate` — enforced at read time, never assumed
  (`[mle-MAJOR]`, `OUTCOME-SEED-BASIS-MATCH`); a count-basis seed is refused for a rate-basis post.
  `baseline_source='import_seed'`.
- **Neither:** `baseline`, `log_lift` and `beat_baseline` are NULL; the row still records the measurement
  (`skippedNoBaseline` counter) and the post contributes to later baselines.
- `log_lift = ln(value / baseline)`, clipped to `[-3, 3]`, with a baseline floor of `1` for the count basis
  (`[mle-MINOR]` near-zero instability). **`log_lift` is descriptive; the gate uses `beat_baseline`** — win/loss
  is robust at small n and comparable across bases (`[mle]` agreed).

### 6.4 The cell, the floor, confidence, and how it reaches the prompt

**Cell** = `(business, platform, dimension, value)`. Observations are `post_outcomes` rows in the 180-day window
(§7.1) with `beat_baseline IS NOT NULL`, joined to the latest revision's `post_dimensions` (for generation-time
dimensions) or read from `post_outcomes` (for measured ones).

**Promotion — all three gates, each independently load-bearing:**

```
OUTCOME_MIN_N                  = 10     -- k
OUTCOME_MIN_DISTINCT_CAMPAIGNS = 3
OUTCOME_WILSON_Z               = 1.96
OUTCOME_PROVISIONAL_N          = 5
OUTCOME_CONFIDENCE_SHRINK_K    = 10
OUTCOME_WINDOW_DAYS            = 180
OUTCOME_PATTERN_TTL_DAYS       = 90     -- ADR 0018's constant, re-declared
OUTCOME_FAST_CONTRA_LAST       = 5
OUTCOME_FAST_CONTRA_MIN        = 4
OUTCOME_CAP                    = 3
OUTCOME_MATURITY_DAYS          = 7
OUTCOME_MATURITY_GRACE_DAYS    = 2
```

*Above-usual* pattern: `wilson_low > 0.5`. *Below-usual* pattern: `wilson_high < 0.5`. At n = 10: 9 wins → low ≈
0.596, promotes; 8 wins → low ≈ 0.490, does not. **k = 10 is chosen so that at the floor a pattern needs 9 of 10 —
the floor and the interval bind together and neither is dead code** (the ADR 0018 §7.3 `K = 2` reasoning).

**Why these numbers, and what they cannot do.**
- At about 25 posts per platform per month, split across 2–5 values, an eligible cell reaches 10 in roughly 2–3 months.
- The three-campaign gate is what counters posts within one campaign being correlated. At the floor, that still averages only about 3 posts per campaign, which is borderline independence (`[mle-MINOR]`).
- **About 40 cells are re-evaluated daily (optional stopping), so some promotions will be false positives at this volume.**
- The mitigations are the campaign gate, demotion (§7) and Tier E (§12.4). None of them eliminates false positives.
- This ADR states the risk rather than claiming a control it does not have.

**Below the floor:** at n ≥ 5 a `status='candidate'` row is upserted (the UI's provisional state, §10.2); it can
never reach generation (`isEligible` requires `active`, `lib/memory/scoring.ts:87-91`). Below 5 nothing is written
— the UI computes "n of 10" from `post_outcomes`.

**Confidence (`[mle-BLOCKER]` adopted):** the stored `confidence` is `wilson_low × n / (n + 10)` (above-usual) or
`(1 − wilson_high) × n / (n + 10)` (below-usual). At the floor that is ≈ 0.30 — deliberately modest, because a
Wilson bound on ten correlated posts is not the same kind of number as a distilled confidence. The raw interval
lives in `interval_low`/`interval_high`. **And outcome rows never compete in the shared ranking:**
`listPerformanceMemoryCandidates` excludes `source='outcome'`; outcome rows are retrieved by
`lib/memory/outcomes.ts` (`retrieveOutcomePatterns`, `rankAndCap` with `OUTCOME_CAP = 3`, among outcome rows only).
The cross-type calibration question is therefore never asked of this data; Session 34's cross-type retrieval must
not merge it without re-deciding (§15).

**How n reaches the prompt (L-2).** A new optional `CustomerContext.observedOutcomes`, rendered in its **own block**:

```
## Observed outcomes for this brand (probabilistic observations, not rules)
- On X, thread posts beat this brand's usual engagement in 9 of 11 posts (3 campaigns).
- On LinkedIn, posts without a call to action were below this brand's usual engagement count in 10 of 12 posts (4 campaigns).
```

- Closed template, n and campaigns always present, **never a multiplier, never an imperative**, routed through
  `neutralize()` at render (the ADR 0018 §10.4 posture).
- **Render sites** (J2.0 enumerates at the commit): `lib/ai/prompts/post-generation.ts`,
  `lib/ai/prompts/post-regeneration.ts`, **and** `lib/ai/prompts/formats/native-generation-prompt.ts` — the live
  Mode-2 generator, which today renders no performance memory at all (§1.2).
- **The existing "Top-Performing Post Snippets" block is untouched** — distilled/imported/fallback rendering does
  not change.
- **`likes`/`impressions` remain omitted for governed rows** — MINOR-2 (`lib/memory/performance.ts:18-22, 61-66`) is
  not undone; the outcome block carries n and wins, never per-post metrics, so no literal zero can appear
  (`OUTCOME-NO-ZERO-METRICS-REINTRODUCED`). MINOR-3's null-platform rendering is untouched.

**Losers:** reusing the shared ranking and the "tone calibration" block (instruction-to-imitate framing, no n);
lift magnitude as the gate; raw counts; cross-business benchmarks.

---

## 7. Decay, re-confirmation and contradiction (Q4)

### 7.1 The window
Every tick recomputes each touched cell over outcomes with `published_at ≥ now − 180 days`. Old evidence ages
out mechanically, so **confidence cannot accumulate indefinitely**.

### 7.2 Recency and expiry — which, stated
- `last_confirmed_at` := the `published_at` of the **newest observation agreeing with the pattern's direction**
  (the source-date posture of ADR 0025 §5.3). `recency_at` (the generated `COALESCE(last_confirmed_at, created_at)`)
  follows. Dates are validated finite before the write (`recencyDecay` throws on non-finite,
  `lib/memory/scoring.ts:34-40`).
- `expires_at` := `last_confirmed_at + 90 days`. **This follows ADR 0016's `expires_at` mechanism, with ADR 0018's
  90-day constant** — both, stated. An unreinforced pattern goes silent at retrieval with no job and no delete.

### 7.3 Contradiction — the case that matters
A pattern that was true and stopped being true has *accumulated* confidence; it is more dangerous than one never
true. `demote_outcome_pattern` demotes `active → candidate` (never deletes; history survives) when **either**:
1. the recomputed window bound fails (above-usual: `wilson_low ≤ 0.5`; below-usual: `wilson_high ≥ 0.5`) — note
   the hysteresis: promotion requires the bound to clear 0.5 **with** n ≥ 10 and 3 campaigns, demotion only
   requires it to stop clearing; or
2. **the fast trigger:** ≥ 4 of the cell's last 5 observations (by `published_at`, a `ROW_NUMBER()`-ordered
   subquery inside the UPDATE predicate, `[db-5]`) go against the pattern's direction.

`contradicted_at` is stamped; the UI shows the contradicted state (§10.2). The demotion is one conditional UPDATE
(`WHERE status='active' AND source='outcome'`) recomputing its own inputs. A demoted pattern may re-promote later
only by clearing every gate again. **Expected false-demotion rate is non-trivial at n ≈ 10** (`[mle]`): with a true
win rate of 0.7, four of five contrary outcomes occurs about 3% of the time per check. Accepted: a wrongly demoted pattern costs one missing
observation in a prompt; a wrongly retained one costs every future post.

**Loser:** monotonically accumulating confidence (ADR 0018's `observation_count` style) — right for edit taste,
wrong for outcomes whose ground truth moves with the platform.

---

## 8. The campaign retrospective and the north-star (Q5, L-6)

### 8.1 VERIFY-FIRST finding, and the amendment (ruling A-1)

**Absent.** `CampaignBriefContent` (`lib/db/types.ts:1300-1307`) is `{ narrative, proofPlan, pinnedEvidence[],
roleSequence[] }`; a repo-wide grep finds no `hypothesis` or `success_criteria` / `successCriteria` in `lib/`, `app/`,
`supabase/migrations/` or ADR 0017. `campaigns.objective` is free text.

**ADR 0017 Amendment C:** `CampaignBriefContent` gains

```
hypothesis:      string                               // ≤ 300 chars
successCriteria: { metric: 'win_rate' | 'median_lift'
                   target: number                     // win_rate ∈ [0.5, 0.95]; median_lift ∈ [1.0, 3.0]
                   evaluationWindowDays: number }     // ∈ [7, 60]
```

- **Model-proposed at Stage A.** The brief prompt asks for a falsifiable hypothesis and criteria drawn only from what the loop measures.
- **Editable on the existing brief-review surface before freeze**, Zod-validated.
- **Unchanged:** the freeze guard (`MODE2-BRIEF-FROZEN-GUARD`) and every other brief field.
- **Briefs frozen before the amendment** have neither field. Their retrospective uses the **implicit** hypothesis *"this campaign's posts beat the brand's usual engagement"* (`win_rate` target 0.5, window 7), labelled `hypothesis_source='implicit'` everywhere it is shown.
- **Loser:** free-text success criteria. They cannot be scored, so they would make the retrospective prose.

### 8.2 What it evaluates, and when
**Trigger (in the outcome tick):** the campaign has ≥ 1 published post, **no** post in `draft`/`approved`/scheduled
state, and `now ≥ last published_at + max(7, evaluationWindowDays)` days.

**Verdict — deterministic, over the campaign's matured outcomes with a baseline:**
- `inconclusive` if n < 5.
- `win_rate`: `supported` if `wins / n ≥ target`, else `not_supported`.
- `median_lift`: `supported` if `exp(median(log_lift)) ≥ target`, else `not_supported`.
- The Wilson interval of the win rate is recorded and shown alongside every verdict. A verdict never appears without n.

### 8.3 `campaign_retrospectives`
| Column | Notes |
|---|---|
| `id uuid PK`; `campaign_id uuid UNIQUE NOT NULL REFERENCES campaigns ON DELETE CASCADE`; `business_id … businesses ON DELETE CASCADE` | one per campaign |
| `hypothesis_snapshot text`, `hypothesis_source text CHECK IN ('brief','implicit')`, `criteria_snapshot jsonb` | frozen at evaluation |
| `verdict text CHECK IN ('supported','not_supported','inconclusive')` | — |
| `n int`, `wins int`, `interval_low`, `interval_high`, `median_log_lift numeric NULL` | — |
| `by_role jsonb` | per-role n / wins, descriptive |
| `status text CHECK IN ('completed','acknowledged')` | — |
| `completed_at`, `acknowledged_at NULL`, `acknowledged_by uuid NULL REFERENCES auth.users ON DELETE SET NULL`, `note text NULL` (≤ 500) | — |

Index: `(business_id, acknowledged_at DESC)`. Rows are written by the worker (INSERT … ON CONFLICT (campaign_id) DO
NOTHING — evaluated once) and transitioned `completed → acknowledged` only by the RPC (conditional UPDATE
`WHERE status='completed'`).

### 8.4 The write-back — human-confirmed, into governed memory
**`acknowledge_campaign_retrospective(p_business_id, p_campaign_id, p_user_id)`**, called by
`acknowledgeRetrospectiveAction` (Zod: `campaignId` uuid, `note` ≤ 500). In one transaction it:

- checks that `p_user_id` is a non-viewer member of the business, the ADR 0025 ratify-RPC shape;
- flips the row to `acknowledged`;
- for a `supported` or `not_supported` verdict, writes **one `performance_memory` row** with these values:

| Column | Value |
|---|---|
| `source` | `'outcome'` |
| `dimension` | `'hypothesis'` |
| `scope` / `scope_ref` | `'campaign'` / the campaign id |
| `pattern_key` | `outcome:hypothesis:<campaign_id>` |
| `status` | `'active'` |
| `outcome_n` / `outcome_wins` / interval | from the retrospective |
| `confidence` | shrunk as in §6.4 |
| `last_confirmed_at` | `completed_at` |
| `expires_at` | `completed_at + 365 days` |
| `pattern` | closed template, through `neutralizeWithSentinels` because it embeds human-editable hypothesis text, ≤ 500 chars |

The `pattern` template reads: *"Campaign '<name>' tested: '<hypothesis>'. Result: supported — 9 of 11 posts beat this brand's usual engagement (interval 0.62–0.95)."*

**Why a single campaign's result may be `active`.** It is not a generalised pattern. It is a dated record of one
test, rendered with its n, **retrieved only by Stage A brief generation** (the next brief sees the brand's last 3
acknowledged results), never into per-post generation. The human's acknowledgement is its promotion. An
`inconclusive` verdict writes nothing. **Loser:** a fifth memory store (ADR 0016 amendment for no gain).

### 8.5 The north-star, computable (`OUTCOME-NORTHSTAR-COMPUTABLE`)

**A learning cycle** is a `campaign_retrospectives` row with `verdict IN ('supported','not_supported')`,
`acknowledged_at IS NOT NULL`, and a `performance_memory` row `source='outcome' AND pattern_key =
'outcome:hypothesis:' || campaign_id` (the write-back happened).

**Metric** = cycles with `acknowledged_at` in the trailing 30 days ÷ **active brands** (businesses with ≥ 1
`posts.status='published'` row whose `published_at` is in the trailing 30 days). Read from a service-role
`get_learning_cycles_northstar(p_since timestamptz)` function via `lib/db/campaign-retrospectives.ts`, surfaced by
`scripts/northstar-report.ts` (ops only; no customer surface). Bounded by construction (aggregates).

**Stated plainly:** until this ships and real rows exist, the north-star measures an unwired loop; it is meaningful
from the first acknowledged retrospective on a real customer's campaign, and not before.

---

## 9. Provenance across the sources (Q6, L-5, ruling A-4)

- **Observations come only from `posts` SOSH published.** An imported post is never an observation. It isn't in `posts`, carries no tag, and is deleted within 30 days.
- **The only import contribution is the X baseline seed** (§6.3). It is stamped per observation (`post_outcomes.baseline_source='import_seed'`) and propagated to the pattern (`baseline_seeded = true` if any contributing observation used a seed).
- **Anyone reading `performance_memory` sees `baseline_seeded`,** and the UI discloses it: *"compared against the history you imported."*
- **No pattern mixes imported and earned observations,** so no second n floor exists.
- **`source='import'` rows are never read, merged, promoted or demoted by this writer.**
- **Correction note to ADR 0025 §5.4** (appended by the Builder): *"its outcome loop reads `source='distilled'` only"* is superseded. The outcome loop reads `post_outcomes`, `post_dimensions` and `source='outcome'` rows, and never reads or writes `source='import'` or `source='distilled'` rows.

**The rule a future session applies without re-deriving it:**
- An observation inherits the provenance of the artefact it measures.
- A pattern's provenance is the union of its observations' provenance and its baseline's.
- `source` is set inside the writer RPC, never by a caller.
- An imported artefact may inform a *reference point*, labelled, but never an *observation*, unless the founder rules otherwise (A-4 declined option (b)).

---

## 10. The UX contract the Builder is held to (Q7, L-7) — specified, not designed

### 10.1 Where
- **Campaign detail page:** a **Retrospective card** and an **Observed outcomes** list, restricted to cells this
  campaign's posts contributed to, each row linking its n.
- **Not the approval gate.** **Loser:** pattern badges at approval — they invite approving by pattern-match at the
  one moment the human is meant to judge the post itself.
- **No analytics page** — T1-B's; it will read §5.3's columns.

### 10.2 States — every one rendered and tested
| Surface | State | Copy obligation |
|---|---|---|
| Retrospective | not yet due | "Results are evaluated 7 days after the last post (on {date})." |
| | inconclusive | "Not enough measured posts to judge ({n} of 5)." |
| | supported / not supported | hypothesis, verdict, "{wins} of {n} posts beat your usual engagement", interval, per-role table; implicit-hypothesis label where applicable |
| | acknowledged | who, when, note |
| | metrics unavailable (platform `NOT_IMPLEMENTED`) | "Metrics aren't available for {platform} yet." |
| Observed outcomes | none yet | "Nothing learned yet — patterns need at least 10 measured posts across 3 campaigns." |
| | provisional (candidate) | "{n} of 10 posts so far — not used in writing yet." |
| | live (active) | the §6.4 sentence, n and campaigns always shown |
| | contradicted | "Recent posts no longer support this — paused on {date}." |
| | not enough variety | (`origin_mode` and any single-valued dimension) "All your posts share this value — nothing to compare yet." |
| Any LinkedIn row | — | the §6.2 count-basis disclosure |
| Any seeded row | — | "Compared against the history you imported." |

### 10.3 Attribution honesty — the prohibited framing, named so it is testable
**Prohibited on every outcome surface, in en/pt/es, and in the rendered prompt block:**
- numeric or written-out multipliers (`\d+(\.\d+)?\s?[x×]`, "twice as", "double", "triple", and their pt/es forms);
- causal verbs ("causes", "drives", "leads to", "results in", "because of", "proven", "guarantees", and their pt/es forms);
- a percentage or rate without its n;
- superlatives ("best", "top-performing") applied to a pattern.

**Enforced** by a Tier-2 copy lint over the outcome namespace of **all three** locale files and the rendered
template output (`[test-5]`). **Business attribution: none this session** (ruling A-5): every surface says
*"engagement"*, and the retrospective card carries *"This measures engagement on {platform}, not signups or
revenue."* — no UTM or conversion infrastructure exists (grep: only RSS URL handling in `lib/signals/`).

### 10.4 Implementation rules
- Server Component pages; Client Components only for the acknowledge form (`useActionState`).
- Zod on `acknowledgeRetrospectiveAction` and on the brief-review hypothesis/criteria fields.
- shadcn v4 / Base UI: **no `asChild` on `Button` or `DropdownMenu` primitives** (use `buttonVariants()` on `<Link>`).
- Tailwind only.
- i18n keys added to en/pt/es simultaneously.
- Every list query is bounded (`limit`, default 20) with an explicit `ORDER BY` matching an index (`[db-8]`).
- The Builder runs `impeccable` / `taste-skill` against this contract; the Architect does not.

---

## 11. GDPR and tenancy (L-8)

Three new business-scoped tables: `post_dimensions`, `post_outcomes`, `campaign_retrospectives`.

- `business_id NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE` on each; redundant cascades via
  `post_id` / `campaign_id` / `ai_original_id` are intentional defence in depth.
- **RLS enabled; one SELECT policy each** for members in the InitPlan-wrapped form
  `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`. **No INSERT/UPDATE/DELETE policy for
  `authenticated`** — writes are the trigger (SECURITY DEFINER), the service-role worker, and the acknowledge RPC.
  With no UPDATE policy, the USING + WITH CHECK rule has nothing to apply to (ADR 0025 §9.1 precedent).
- **Write-once triggers are `BEFORE UPDATE` only** — never `BEFORE DELETE` (ADR 0018 `[db-BLOCKER-1]`).
- **`purge_business` needs no change** — everything cascades from the root delete
  (`20260702120700_purge_business_member_delete.sql:62`); the Tier-1 test asserts the erasure **succeeds**.
- `performance_memory` changes (§5) add no table and need no new cascade row (already covered).

**ADR 0010 Amendment 2 §D2.5 rows (verbatim, added in the Builder's migration PR):**

| Table | Business-scoped? | FK→businesses ON DELETE | Cascades? | Action on purge |
|---|---|---|---|---|
| post_dimensions | yes (business_id + post_id + ai_original_id) | CASCADE | yes | none — cascade = erasure (generation-time tags of the customer's posts; no content; ADR 0026 §4.2) |
| post_outcomes | yes (business_id + post_id) | CASCADE | yes | none — cascade = erasure (per-post engagement measurements and baselines; no content; ADR 0026 §6.1) |
| campaign_retrospectives | yes (business_id + campaign_id) | CASCADE | yes | none — cascade = erasure (holds the customer's hypothesis text and an optional member note; ADR 0026 §8.3) |

---

## 12. Test plan (Q8) — ADR 0015 §2, Amendment B

### 12.1 Tier 1 — live Postgres (`supabase/__tests__/`, `db-tests.yml`)
- **Tagging covers every caller:** a raw `INSERT INTO post_ai_originals` issued by no application code produces
  the `post_dimensions` row; a post with `role IS NULL` and no brief still inserts (NULLs, no error); UPDATE on
  `post_dimensions` and `post_outcomes` rejected; business delete **succeeds** with rows in all three tables.
- **The floor — each gate independently load-bearing** (`[test-BLOCKER-1]`), direct RPC calls over seeded
  `post_outcomes`/`post_dimensions`:
  1. 9 wins / 10, 3 campaigns → promotes.
  2. Same, 2 campaigns → does **not** (the only case catching an absent campaign gate).
  3. 8 / 10, 3 campaigns → does not (the bound).
  4. 9 / 9, 3 campaigns → does not (the floor: all-win at n = 9 fails only on k).
  5. The row's stored `outcome_n` forged to 10 via service-role before calling promote on fixture 4 → still does
     not (the RPC recomputes, never trusts).
  6. `promote_performance_pattern` called on an outcome row → does not promote.
- **Demotion:** window-bound failure demotes; 4-of-last-5 contrary demotes with an otherwise-passing window;
  3-of-5 does not; two concurrent demote calls → one transition, `contradicted_at` set once; observations older
  than 180 days (seeded `published_at`) leave the recompute.
- **Writers and keys:** `source='outcome'` with a non-`outcome:` key rejected; a distilled `outcome:` key rejected;
  the distilled upsert cannot touch an outcome row and vice versa; outcome upsert dedupes on the sibling index;
  the CHECK widenings accept the new values and reject others.
- **Write protection:** as `authenticated`, INSERT with `source<>'manual'` rejected; UPDATE of an outcome row's
  `outcome_n`/`pattern`/`source` rejected; retiring it allowed.
- **RLS:** cross-tenant SELECT denied on the three tables; no authenticated write path exists.
- **Retrospective:** `acknowledge_campaign_retrospective` — a non-member and a viewer refused; acknowledgement
  writes exactly one `performance_memory` row; a second call is a no-op; `inconclusive` writes none.
- **Metrics cadence:** the new `list_posts_for_metrics_sync` returns a post at day 1, 3 and 7 and not between.

### 12.2 Tier 2 — vitest (`app-tests.yml`)
- Normalisation golden tables per platform; eligible-field exclusion (null → excluded, never 0; X `impressions=0`
  excluded); seed refused on basis mismatch; log-lift clipping.
- `wilson_bounds` parity: a table of (wins, n) evaluated **through the real SQL function via the wrapper** — no TS
  re-implementation is accepted as proof of the gate (`[test-5]`).
- Measured dimensions: length bands at each boundary; CTA via ADR 0018's function; `hook_survived`.
- `hookType` additive: a v1 payload with and without it classifies identically in ADR 0018's classifier.
- Retrieval: `listPerformanceMemoryCandidates` excludes outcome rows; `retrieveOutcomePatterns` caps at 3; the
  rendered block contains n and campaigns for every line, no `likes`/`impressions` keys
  (`OUTCOME-NO-ZERO-METRICS-REINTRODUCED`); each of the three render sites renders it.
- Retrospective verdict table (both metrics, the boundary, inconclusive, implicit hypothesis); brief Zod ranges.
- Worker: tick counters; a replayed tick changes no row; per-item failure does not fail the batch.
- Providers: `fetchPostMetrics` maps each verified field and leaves permanently-null fields null (mock HTTP).
- Copy lint over en/pt/es outcome namespaces and the rendered template, **proven to redden** on a planted
  "2× more" and "leads to".
- SHARED-FUNCTION CALLERS rows of §5.6, one covering test each.

### 12.3 Tier 3 — properties of absence, as executable scans (each proven to redden on a planted violation)
- **`OUTCOME-NO-RETRO-TAGGING`:** `post_dimensions` is written only by its trigger migration and the J2 one-off
  copy migration; a TS source scan finds no `.from('post_dimensions')` write and no `.rpc` writing it outside
  `lib/db/`; planted: a write from a fake `lib/backfill/classify.ts`.
- **`OUTCOME-DETERMINISTIC-NO-LLM`:** no import of `@/lib/ai` runner/client or `@anthropic-ai` under
  `lib/outcomes/**` or `app/api/cron/extract-outcomes/**`.
- **`OUTCOME-ADR0018-UNCHANGED`:** `git diff <merge-base>..HEAD -- lib/learning/ <ADR 0018 migrations>` is empty
  — **a path check, chosen over a behavioural golden** (`[test-3b]`); if any `lib/learning` file must change, that
  is a STOP. The existing `lib/learning/*.test.ts` suite passing unmodified is the behavioural backstop.
- **`OUTCOME-NO-CROSS-BUSINESS`:** every exported function in `lib/db/post-outcomes.ts`,
  `lib/db/post-dimensions.ts`, `lib/db/campaign-retrospectives.ts` and the outcome functions in
  `memory-performance.ts` takes `businessId` and filters on it; **the outcome RPC SQL bodies** are scanned for a
  `business_id` predicate on every table they read (`[test-3c]`; the ADR 0025 §15.1 body-not-signature lesson).
- **`OUTCOME-NO-EXTRA-WRITER`:** the set of literal `source` values written by any migration's
  `INSERT INTO public.performance_memory` / RPC is exactly `{distilled, import, outcome}` plus the authenticated
  `manual` path; planted: a migration writing `'manual2'`.
- The three §D2.5 rows exist in `0010-legal-surface.md`; no new dependency in `package.json`; no `/analytics`
  route; no experiment or holdout code.
- **Not deterministically testable, by decision:** that the production cron actually runs daily (operational —
  the Sentry monitor alerts on a miss).

### 12.4 Tier E — prediction accuracy (MEASURED, never COVERED)
**Protocol (`OUTCOME-PREDICTION-ACCURACY`):**
1. At each promotion, snapshot the pattern: key, direction, date, n.
2. Over the following 60 days, on that brand and platform, compare the win rate of new matured posts that match the pattern's value with those that don't.
3. Report the difference with its interval, pooled across patterns and brands as an evaluation statistic only.
4. **Minimum reporting floor:** n ≥ 15 per arm, otherwise the output is "insufficient data".

**What it can and cannot claim** (`[mle-BLOCKER]`):
- Once promoted, the pattern is in the prompt, so the generator produces more matching posts, and the non-matching arm becomes a self-selected residual.
- Patterns are promoted *because* they ran hot, so some reversion toward the average afterwards is expected even when a pattern is real.
- **The number is therefore reported only as "association, not validation"**, and a post-promotion decline is never read as disproof on its own.
- A causal number needs a randomized holdout, which is deliberate experimentation and excluded by L-1. It is deferred (§15).

**Earliest number:** about T0 + 150 days, where T0 is the first real customer's first published post with real metrics. T0 is **undefined today** (OAuth apps unregistered; §3 not yet built).

**The honest admission:** this session ships the loop without being able to prove it predicts anything.

---

## 13. Constraint table — the Reviewer's checklist

| # | Constraint | Tier | Test that proves it |
|---|---|---|---|
| 1 | **OUTCOME-METRICS-FETCH-REAL** — X (and LinkedIn if verified) `fetchPostMetrics` return verified fields; permanently-null fields stay null | 2 | provider tests (mock HTTP) + ADR 0028 verification-log citation |
| 2 | **OUTCOME-METRICS-CADENCE-BOUNDED** — syncs due at day 1/3/7 only; max age 9 | 1 + 2 | `list_posts_for_metrics_sync` Tier-1; orchestrator test |
| 3 | **OUTCOME-DIMENSIONS-TAGGED-AT-GENERATION** — every AI snapshot gets a `post_dimensions` row from generation-time facts | 1 | raw `post_ai_originals` insert test |
| 4 | **OUTCOME-TAG-ALL-CALLERS** — no caller enumeration needed; future callers covered | 1 | the same raw-insert test (no app code) |
| 5 | **OUTCOME-DIMENSIONS-WRITE-ONCE** — `post_dimensions`/`post_outcomes` UPDATE rejected; DELETE unguarded | 1 | trigger tests |
| 6 | **OUTCOME-NO-RETRO-TAGGING** | 3 | §12.3 scan, redden-proven |
| 7 | **OUTCOME-DESCRIPTIVE-ONLY** — `hook_type`/`proof_type` never promoted | 2 + 3 | extractor test; scan: no outcome key with those dimensions |
| 8 | **OUTCOME-HOOKTYPE-ADDITIVE** — schema version unchanged; classifier unaffected | 2 | v1 payload with/without `hookType` |
| 9 | **OUTCOME-MATURED-SNAPSHOT** — outcome frozen once at day 7; missed grace → no row | 2 | worker tests |
| 10 | **OUTCOME-ELIGIBLE-FIELDS-ONLY** — null → excluded, never zeroed; ineligible fields never read | 2 | normalisation table |
| 11 | **OUTCOME-NORMALISED-TO-OWN-BASELINE** — per-brand, per-platform baseline | 2 | golden tables |
| 12 | **OUTCOME-SEED-BASIS-MATCH** | 2 | basis-mismatch refusal |
| 13 | **OUTCOME-MIN-N-ENFORCED** — k, campaigns, bound each load-bearing | 1 + 2 | §12.1 cases 1–4 |
| 14 | **OUTCOME-RECOMPUTE-NOT-TRUST** | 1 | §12.1 case 5 |
| 15 | **OUTCOME-CONFIDENCE-RENDERED** — n and campaigns in every rendered line | 2 | render tests, three sites |
| 16 | **OUTCOME-NO-ZERO-METRICS-REINTRODUCED** — MINOR-2 intact | 2 + 3 | render test; diff of `lib/memory/performance.ts` MINOR-2 lines |
| 17 | **OUTCOME-SEPARATE-RETRIEVAL** — outcome rows excluded from the shared ranking; own cap | 2 | retrieval tests |
| 18 | **OUTCOME-TWO-WRITERS-DISTINGUISHED** (now three) — `source`, namespace, sibling index | 1 | key/CHECK tests |
| 19 | **OUTCOME-KEY-COLLISION-DEFINED** | 1 | cross-writer upsert tests |
| 20 | **OUTCOME-WRITE-PROTECTED** — authenticated cannot write non-manual or forge stats | 1 | RLS + trigger tests |
| 21 | **OUTCOME-CONTRADICTION-DEMOTES-ATOMIC** | 1 + 2 | §12.1 demotion + concurrency |
| 22 | **OUTCOME-WINDOWED-DECAY** — 180-day window; `expires_at` = newest agreeing + 90d | 1 + 2 | seeded-date tests |
| 23 | **OUTCOME-PROVENANCE-PROPAGATED** — `baseline_source` → `baseline_seeded`; imports never observations | 1 + 2 | extractor + Tier-1 |
| 24 | **OUTCOME-HYPOTHESIS-IN-BRIEF** — ADR 0017 Amendment C fields, Zod ranges, freeze unchanged | 1 + 2 | brief tests + existing freeze-guard Tier-1 |
| 25 | **OUTCOME-RETROSPECTIVE-WRITES-BACK** — acknowledgement writes exactly one governed row | 1 + 2 | RPC + action tests |
| 26 | **OUTCOME-NORTHSTAR-COMPUTABLE** | 1 | `get_learning_cycles_northstar` over fixtures |
| 27 | **OUTCOME-ATTRIBUTION-CONFIDENCE-FRAMED** — prohibited framing absent in en/pt/es + prompt | 2 | copy lint, redden-proven |
| 28 | **OUTCOME-DETERMINISTIC-NO-LLM** | 3 | import scan |
| 29 | **OUTCOME-ADR0018-UNCHANGED** | 3 | path diff + unmodified `lib/learning` suite |
| 30 | **OUTCOME-NO-CROSS-BUSINESS** | 2 + 3 | wrapper tests + RPC-body scan |
| 31 | **OUTCOME-NO-EXTRA-WRITER** | 3 | source-value scan, redden-proven |
| 32 | **OUTCOME-TICK-IDEMPOTENT** — replayed tick changes nothing | 1 + 2 | replay test; ON CONFLICT DO NOTHING on outcomes/retrospectives |
| 33 | **OUTCOME-RLS-ISOLATED** | 1 | cross-tenant tests, three tables |
| 34 | **OUTCOME-CASCADE-COMPLETE** | 1 + 3 | erasure-succeeds test; §D2.5 rows |
| 35 | **OUTCOME-PREDICTION-ACCURACY** | E | §12.4 — MEASURED, never COVERED |

**35 `OUTCOME-*` constraints.** "Covered" means executed green in CI at the head it is dated to (ADR 0015 §2); a
test with no executing job is `AUTHORED-NOT-EXECUTED`.

---

## 14. Worker, config and amendments the Builder writes

- **Worker:** `app/api/cron/extract-outcomes/route.ts`, copying `capture-learning`'s dual-mode QStash/bearer shape.
  `lib/outcomes/orchestrator.ts` → `runOutcomeTick({ triggeredBy })`.
  - Lazy service-role client, `Sentry.withMonitor` with slug `extract-outcomes` and schedule `0 4 * * *`, one business per iteration with no captured `business_id` (ADR 0018 §10.3), and a per-item `try/catch`.
  - A runbook row goes in `docs/runbooks/qstash-setup.md`.
- **The one canonical log line** (CLAUDE.md worker carve-out):
  `{ kind: 'outcome.tick', triggeredBy, tick, durationMs, candidates, matured, outcomesWritten, skippedNoMetrics,
  skippedNoBaseline, skippedIneligibleField, cellsRecomputed, candidatesUpserted, promoted, demoted,
  retrospectivesCompleted, errors }`.
- **Config** via `lib/config.ts` only: `OUTCOME_BATCH_SIZE` (default 200), `METRICS_MAX_AGE_DAYS` default → 9. The
  statistical constants of §6.4 are code constants in `lib/outcomes/constants.ts` with SQL twins documented at each
  RPC (the accepted ADR 0018 duplicate-constant trade-off), never env.
- **Cost:** zero model spend. The only new variable cost is X reads: three per published post, which is negligible against the ADR 0028 §14.3 cap.
- **Amendment notes** in ADR 0016 (C), ADR 0017 (C), ADR 0018 (a note), ADR 0024 (a note), ADR 0025 (a §5.4 correction note) and ADR 0028 (A), each additive and each citing this ADR.

---

## 15. Deferred (owning session named)

| Item | Why deferred | Owner |
|---|---|---|
| Deliberate experimentation / organic A-B / randomized pattern holdout | needs volume; L-1; the only route to a causal Tier-E number | a later experimentation track, volume trigger in `docs/backlog.md` |
| UTM auto-tagging of links at publish | ruling A-5 | T1-B analytics session |
| Conversion-event ingestion (GA4, CRM, billing) | a new integration and data class | post-T1-B track |
| Analytics surface and board report | T1-B; reads §5.3 columns | T1-B session |
| Cross-type retrieval; any further memory writer; merging outcome rows into shared ranking | L-1; §6.4 calibration must be re-decided | Session 34+ |
| `hook_type` promotion | κ ≥ 0.6 agreement check (§4.1) | a follow-on amendment to this ADR |
| `proof_type` promotion | per-post evidence citation in the output schema | Session 34 (claim verification) |
| `topic` dimension | needs a controlled content-pillar vocabulary | not scheduled |
| Imported posts as observations (A-4 option (b)) | legal/retention change to ADR 0025 §8.3 | declined; would need counsel |
| LinkedIn rate metrics | `r_member_postAnalytics` approval | tracked with ADR 0028 §16 item 11 |
| Follower-count normalisation for LinkedIn | no follower fetch exists | with the LinkedIn approval above |
| Memory-driven opportunity cards | L-1; §13 of the build-path doc | Session D / R2 ruling |
| Comment mining; embeddings | L-1 | unscheduled |
| Retention for `post_outcomes` | mirrors `post_metrics`' no-retention posture | project retention ADR |

---

## 16. Advisory findings — disposition

| Finding | Source | Disposition |
|---|---|---|
| Partial-index `ON CONFLICT` inference is exact; distilled index survives | db-1 | **Adopted** (§5.1) |
| Namespace collision only by convention — add CHECKs | db-1 MAJOR | **Adopted** (§5.1) |
| Outcome rows need their own immutability | db-2 MINOR | **Adopted** (§5.5 trigger) |
| Authenticated can forge `source`/stats; RLS for INSERT, trigger for UPDATE with retire-only | db-3 MAJOR | **Adopted** (§5.5), grep-verified no app writer |
| Columns, not a side table | db-4 | **Adopted** (§5.3) |
| One shared Wilson SQL function | db-5 | **Adopted** (§5.4) |
| §D2.5 rows and indexes missing from the draft | db-6 MAJOR | **Adopted** (§11, §6.1, §4.2) |
| `NOT VALID` + `VALIDATE`; voice-guard unaffected, say so | db-7 | **Adopted** (§5.1) |
| Bounded + ordered UI lists | db-8 | **Adopted** (§10.4) |
| `hook_type` self-report unvalidated | mle MAJOR | **Adopted** — descriptive-only with κ un-defer (§4.1) |
| `origin_mode` degenerate per brand | mle MAJOR | **Adopted** — kept, disclosed (§4.1, §10.2) |
| `format` confounded with platform | mle MAJOR | **Adopted** — per-platform claims (§4.1) |
| role–campaign correlation, ~3 posts per campaign at the floor | mle MINOR | **Adopted** — stated (§6.4) |
| Wilson LB as shared `confidence` miscalibrates ranking | mle BLOCKER | **Adopted** — shrink + separate retrieval + raw interval columns (§6.4) |
| LinkedIn follower-growth drift | mle MAJOR | **Adopted partially** — shorter window + disclosure; correction deferred (no follower data) (§6.2, §15) |
| log-lift instability near zero | mle MINOR | **Adopted** — clip + floor (§6.3) |
| Seed basis must be enforced at read time | mle MAJOR | **Adopted** (§6.3, constraint 12) |
| Tier E cannot be causal; label or randomize | mle BLOCKER | **Adopted (b)** — "association, not validation"; randomized holdout deferred under L-1 (§12.4, §15) |
| Tier E per-arm floor; regression to the mean | mle MAJOR | **Adopted** (§12.4) |
| n-floor pair insufficient; each gate needs its own case, in Tier 1 | test BLOCKER | **Adopted** (§12.1 cases 1–6) |
| Contradiction path: clock control; cron cadence untestable | test MAJOR | **Adopted** (§12.1, §12.3) |
| Tier-3 scans need mechanism + redden proof; RPC bodies, not signatures | test MAJOR | **Adopted** (§12.3) |
| Per-caller tagging tests repeat Session 22 — use a DB-level invariant | test BLOCKER | **Adopted** — trigger on `post_ai_originals` (§4.2) |
| Tier-2 formula tests via TS re-implementation prove nothing | test MAJOR | **Adopted** — through the real SQL function (§12.2) |
| Copy lint evadable (written multipliers, synonyms, pt/es) | test MAJOR | **Adopted** (§10.3) |
| Reviewer suggested a presence invariant blocking approval without a `post_dimensions` row | test BLOCKER-4 (variant) | **Rejected** — would block approval of human-written posts, which legitimately have no tags (ADR 0018 A.1 corollary); the trigger on the snapshot achieves the same coverage without gating approval |

---

ADR 0026 written and accepted — 35 OUTCOME-* constraints, 7 dimensions (5 promotable, 2 descriptive-only), min-n
10, baseline = the brand's own per-platform median of day-7 outcomes (X: 90-day rate; LinkedIn: last-20 count),
extractor runs as its own daily deterministic worker `extract-outcomes`, retrospective at last publish +
max(7, evaluation window) days with human acknowledgement writing it to memory, north-star cycle defined as an
acknowledged supported/not-supported retrospective with its `outcome:hypothesis:<campaign_id>` memory row,
hypothesis fields absent → added by ADR 0017 Amendment C (ruling A-1).
