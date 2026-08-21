# ADR 0018 — Diff-Based Learning Capture

- **Status:** Accepted
- **Date:** 2026-07-25
- **Track:** C (of the ADR 0016→0017→0018 intelligence-layer programme; `docs/brainstorm/session-plan-adrs-0016-0018.md`). Depends on Track A (ADR 0016) having landed — `performance_memory` exists and ships empty, and ADR 0016 §10 names **this ADR as the WRITER**. Independent of Track B, which has nonetheless landed and materially improves this design (§1.3).
- **Supersedes / amends:** none superseded. **Amends ADR 0016 §3.4** by column-addition (`performance_memory.pattern_key`, §7.2) — recorded as **ADR 0016 Amendment B**. **Amends ADR 0016 §10** by discharging the "ADR 0018 — the WRITER" deferral. **Amends ADR 0010 Amendment 2 §D2.5** (cascade table) by row-addition (`post_ai_originals`, `post_edit_signals`). Amends nothing in ADR 0011 or ADR 0016 §3.5 — **no voice table is created** (§8).
- **Source design docs:** `docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md` §5 "The learning loop" (primary — the six numbered steps at lines 185-213) + §1 (governance metadata); `docs/brainstorm/campaign-modes-architecture-and-build-plan.md` §2 Phase B (lines 247-257) + §1 Mode 2 stage I (line 97); build guide `docs/build-guide/session-25.md` §0 (Locked L-1..L-13) + §0.1 (the eight questions this ADR resolves).
- **Advisory passes folded in (read-only, no code):** `ecc:code-explorer` (the seam map every `file:line` below is drawn from), `database-reviewer` (schema, triggers, indexes, claim, promotion atomicity), `security-reviewer` (GDPR/cascade + summarizer injection), `ecc:type-design-analyzer` (the correction/preference encoding), `cost-aware-llm-pipeline` (cadence, model tier, ceiling). Material findings are cited inline as `[db-*]`, `[sec-*]`, `[type-*]`, `[cost-*]` and consolidated in §14. **Three of them changed the design before it was written**, including one that would have broken GDPR erasure outright.
- **Scope discipline:** this ADR ships the **diff-based learning capture only** — the `ai_original` snapshot, the capture hook at the existing atomic approval transition, the Tier-0 heuristic classifier, the correction-vs-preference split, the batched Tier-1 summarization, the promotion threshold, and the write-back into governed memory. **Not** Mode 1 Studio, Mode 3 (mining / insight cards / opportunity feed), `relationship_memory`, embeddings, the skip-review fast path, brief-edit capture, or any change to generation *behaviour* (§15).

---

## 0. The eight resolved questions (build-guide §0.1 — on the record)

Each answer names its loser, its agency tier (L-10), and its test tier (ADR 0015 §2). The Builder consumes these as binding and does not re-decide them.

| Q | Decision | Loser | Agency / Test tier |
|---|---|---|---|
| **Q1** `ai_original` | New **table** `post_ai_originals`, append-only, `UNIQUE (post_id, revision)`; snapshot carries **both** the structured `payload` and the `rendered_content`; write-once via a **`BEFORE UPDATE`-only** trigger; no backfill (ships empty, snapshot-less posts skipped) | an `ai_original jsonb` column on `posts` — cannot represent the regeneration lineage, so the human is credited with the AI's own rewrite | Tier 0 / Tier 1 (DB) + Tier 2 |
| **Q2** capture hook | **Outbox**, enqueued by an `AFTER UPDATE` trigger on `posts` at `draft → approved`, copying the human-final content into the row; **approval only** | inline in the transition (couples approve latency + failure; `bulkApproveDraftPosts` returns only a count); worker re-scan (needs a cursor, risks double-counting); approval **+ publish** (re-observes the same edit) | Tier 0 / Tier 1 (DB) + Tier 2 |
| **Q3** diff algorithm | **In-repo deterministic deltas**, no diff library; sentence-level set difference for claim removal | pinning `diff` / `diff-match-patch` now — the heuristics need deltas, not a rendered patch; the library earns its keep in Mode 1 Studio (Phase C), where the visual diff *is* the product | Tier 0 / Tier 2 |
| **Q4** taxonomy + split | 12 Tier-0 signal kinds (9 preference + 1 correction + 2 inconclusive — [Session 25-D correction, NIT-1] corrected from a miscounted "11"); **partitioned classifier return** (no flat `Signal[]` exists) + **`LEARN-VOICE-WRITE-TRIGGER`** at the DB + a `@ts-expect-error` compile-time test | one undifferentiated "edit" signal (D-5); a flat tagged array filtered by a runtime `if` | Tier 0 / Tier 1 (DB) + Tier 2 |
| **Q5** memory write + threshold | `performance_memory`, `source='distilled'`, `status='candidate'`; promotion needs **`observation_count ≥ 5` AND `confidence ≥ 0.70` AND `distinct campaigns ≥ 2`**; contradiction *reduces* confidence; decay via `expires_at` | writing an `active` row from a single diff (D-4 — the exact failure ADR 0016 L-5 exists to prevent); hard-deleting stale patterns | Tier 0 / Tier 1 (DB) + Tier 2 |
| **Q6** voice learning | **Option (a)** — `performance_memory` rows with `dimension ∈ {'format','hook'}`. No voice table. `brand_voices` never touched | (b) a human-reviewable `avoid_words` suggestion surface (needs UI — deferred); (c) amending ADR 0016 with a voice store (premature); **auto-mutating `brand_voices` — a STOP, not proposed** | Tier 0 / Tier 2 + Tier 3 |
| **Q7** worker | Copies **`runEmailDrainTick`**; hourly QStash POST route; claim via `FOR UPDATE SKIP LOCKED`; summarization gated by a **two-gate floor**, Haiku 4.5, Tier 1; idempotency by **recompute, never increment** | a bespoke queue, a trigger doing the classification inline, or a Vercel-Cron-only path (D-6; the repo migrated off it) | Tier 0 + Tier 1 / Tier 1 (DB) + Tier 2 |
| **Q8** surfacing | **Pipeline-only.** No UI in Track C | a read-only "what SOSH has learned" panel now — a real product need, deferred to Session 26-UI with Mode 1 Studio's diff renderer | n/a / Tier 3 |

---

## 1. Context + decision summary

### 1.1 What happens today when a human edits an AI draft

Nothing is recorded. Nothing is learned. Concretely, at HEAD:

```
generatePostsForCampaign  →  joinContent(g.output)          lib/campaigns/generate.ts:353
                              — the structured SinglePostOutput | ThreadOutput
                                collapses to one string, and the structure is DISCARDED
                          →  createPosts(client, allInserts)  lib/campaigns/generate.ts:362
                                                              lib/db/posts.ts:288-298

human edits               →  updatePostContent               lib/db/posts.ts:473-489
                              — writes content + hashtags IN PLACE, overwriting the AI's words
                          →  updatePostContentAndMetadata    lib/db/posts.ts:497-517
                              — the regenerate path; rewrites content + ai_generation_metadata

human approves            →  approvePost                     lib/db/posts.ts:320-340
                              — atomic guard .eq('status','draft'), returns the PostRow
                          →  bulkApproveDraftPosts           lib/db/posts.ts:526-544
                              — one UPDATE, returns a COUNT only (posts.ts:543), not the ids
```

The AI's original words exist in memory at `generate.ts:353` and are gone one statement later. `updatePostContent` (`posts.ts:480`) overwrites `content` with no prior value retained anywhere — there is no history table, no snapshot column, no audit row. The approval transitions flip `status` atomically and emit nothing. `lib/db/memory-*.ts` contains **no writer function at all** — `performance_memory` ships empty by design (`supabase/migrations/20260719010000_governed_memory.sql:197-203`: *"Ships EMPTY. Track C's distillation worker is the writer"*).

### 1.2 Why that is the problem

The edit is the **highest-signal artefact a customer produces**, and it is thrown away.

1. **It is unforced ground truth.** A customer who rewrites an AI draft has spent real effort telling us exactly what was wrong with it — no survey, no thumbs-up widget, no prompt engineering. `intelligence-layer §5` (line 187) calls this "the single highest-leverage mechanism in this whole design."
2. **It subsumes the accept/reject signal.** A user can accept a suggestion and then quietly rewrite it; an accept/reject log alone misses that entirely (`intelligence-layer §5`, lines 192-197). The diff against the *final approved* version is ground truth regardless of what was clicked.
3. **Without it, memory can only ever be manually curated.** ADR 0016 built four governed stores with `source ∈ ('manual','distilled','import')` — and shipped **no distilled writer**. A store nobody feeds is a store that stays empty, and the "company knowledge graph no competitor has" (`intelligence-layer §5`, line 217) never accrues.
4. **The corruption risk is silent and compounding.** Learning the *wrong* lesson — treating a hallucination fix as a taste preference — degrades every future generation with nothing going red. That is why §5 is the longest section in this ADR.

### 1.3 The fix, and what Track B changed under it

**snapshot → diff at the approval transition → heuristic-first classify → correction-vs-preference → aggregate before promoting → mode-agnostic by construction.** The six steps of `intelligence-layer §5`, taken literally.

Two things ADR 0017 shipped materially improve this design over what the 2026-07-17 strategy doc could assume:

- **AI output is no longer a flat string.** `SinglePostOutput | ThreadOutput` (ADR 0017 §4.1) exists in memory at `generate.ts:236` and survives to `generate.ts:353`, where `joinContent` (`generate.ts:50-55`) flattens it. Snapshotting the **structured payload** makes "the human collapsed a 5-tweet thread to 3" checkable — a string-only snapshot could not see it (§2.3).
- **Evidence is pinned by id, `business_id`-enforced.** ADR 0017 Amendment A.1 (`0017-mode-2-upgrade.md:684-706`) hardened the citation-by-id boundary from asserted to enforced. That gives this ADR a **checkable** definition of a grounding correction — "the human deleted a claim citing no pinned evidence" — instead of a guess (§5.2).

### 1.4 Decision ledger (losers named — build guide §0 D-1..D-7)

| # | Decision | Chosen | Loser (rationale) |
|---|---|---|---|
| D-1 | Track C scope | diff-based learning capture only | bundling Mode 1 / Mode 3 / mining / the skip-review fast path — each depends on foundations not yet built, or on *this* track's data to justify it (`session-plan §4`) |
| D-2 | The learning signal | **diff of AI-original → human-approved final** | an explicit accept/reject log per suggestion (misses the silent rewrite after an "accept" — `intelligence-layer §5.2`); a thumbs-up/down UI (asks the user to do work they already did by editing) |
| D-3 | Classification | **heuristic-first (Tier 0)**, batch LLM second | an LLM classification call per approved post — cost scales with usage, latency lands on the approval path, failures get quieter |
| D-4 | Promotion | **aggregate-then-promote** via `observation_count`/`confidence`/`status` (ADR 0016 §2) | writing an `active` row from a single diff (one data point asserted as fact — the exact failure ADR 0016 L-5 exists to prevent) |
| D-5 | Signal typing | **correction vs preference, structurally split** | one undifferentiated "edit" signal (teaches voice memory that a hallucination fix is a style preference — silent, compounding corruption) |
| D-6 | Worker shape | **copy the existing tick/orchestrator + QStash cron pattern** | a bespoke queue; **a DB trigger doing the work inline**; a Vercel-Cron-only path (the repo migrated off it — ADR 0005 Amd 1) |
| D-7 | Agency ceiling | **Tier 1 max** (one batched summarization call per business per period) | an agent that decides what to learn (cost compounds, testability degrades to statistical, failures get quiet — `intelligence-layer §5`) |

> **D-6 reading, flagged for the record (founder-adjudicable).** §3 enqueues via an `AFTER UPDATE` trigger. D-6's named loser is *"a DB trigger **doing the work** inline"* — a trigger that diffs, classifies, or calls an LLM. This trigger does **one INSERT**: no computation, no network, no LLM. It is the enqueue half of the `email_outbox` pattern, and because Supabase JS has no client-side multi-statement transaction, **it is the only genuinely atomic implementation of build-guide Q2's option (b), "an outbox row written in the same transition."** This ADR reads that as within Q2(b) rather than a contradiction of D-6, and therefore does **not** invoke a STOP — but it is the closest call in the document and is recorded here so a Reviewer or the founder can overrule it explicitly rather than discover it.

---

## 2. The `ai_original` snapshot (Q1)

### 2.1 L-2 is the load-bearing invariant of this entire ADR

> **L-2 — the AI's own output is snapshotted at generation time, kept SEPARATE from the mutable field the human edits freely, written once by the generating path, and NEVER overwritten by a human edit.**

If the snapshot can be clobbered, the ground truth of Track C is gone and every downstream number — every `observation_count`, every `confidence`, every promoted pattern — is silently wrong with no test able to see it. Everything in §2 exists to make clobbering impossible, and the enforcement is at the **DB**, not by convention (`LEARN-SNAPSHOT-WRITE-ONCE`).

### 2.2 Placement: a new table, not a column — and the regeneration lineage is why

**Decision: a new business-scoped table `post_ai_originals`, append-only, one row per AI-authorship event, `UNIQUE (post_id, revision)`.** (`LEARN-SNAPSHOT-SEPARATE`.)

**Loser: an `ai_original jsonb` column on `posts`.** The deciding fact is the **regeneration path**, which a column structurally cannot represent. `regeneratePostAction` (`app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:320`) calls `updatePostContentAndMetadata` (`lib/db/posts.ts:497-517`), which rewrites `content`, `hashtags` and `ai_generation_metadata` — i.e. **the AI authors the post a second time**. Under a write-once column the snapshot would still hold draft v1 while `posts.content` descends from v2, so the diff would attribute the AI's own rewrite to the human. That is exactly the *silent confidence inflation* the build guide names as this track's top risk: a pattern would gain observations from edits no human ever made, and nothing would go red. A revisioned table diffs against the **latest** revision and keeps every earlier one for audit.

Secondary reasons: a column widens the hot `posts` table with cold, worker-only data; and it would force a `PostUpdate` `Omit` (see §2.6) that the service-role generation path bypasses anyway.

### 2.3 Shape: both the structured payload and the rendered string

Neither alone is sufficient, so the snapshot carries both. A string-only snapshot cannot tell you the human collapsed a 5-tweet thread to 3; a payload-only snapshot cannot be diffed against `posts.content`, which is a single `text` column (`lib/db/types.ts:268`).

| Column | Type | Why |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | — |
| `business_id` | `uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE` | the cascade + RLS anchor. `businesses` is the parent, never `campaign_id` — ADR 0017 `[db-MAJOR-1]` |
| `post_id` | `uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE` | the join key; adopted per `[sec-LOW-1]` for referential integrity |
| `campaign_id` | `uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE` | needed for the distinct-campaign promotion gate (§7.3) |
| `revision` | `int NOT NULL DEFAULT 1 CHECK (revision >= 1)` | the regeneration lineage; `UNIQUE (post_id, revision)` |
| `generation_kind` | `text NOT NULL CHECK (generation_kind IN ('initial','regeneration'))` | attribution |
| `format` | `text NOT NULL CHECK (format IN ('single','thread'))` | ADR 0017 §4.1's discriminant, mirrored |
| `payload` | `jsonb NOT NULL` | the `SinglePostOutput \| ThreadOutput` **verbatim** — the only way to know a thread was shortened, or that a `pull_quote` tweet was deleted |
| `rendered_content` | `text NOT NULL` | exactly what `joinContent()` (`generate.ts:50-55`) produced and what landed in `posts.content` at `generate.ts:353` — makes the diff apples-to-apples against a `text` column |
| `hashtags` | `text[] NOT NULL DEFAULT '{}'` | `posts.hashtags` is separately editable; the AI's originals must be frozen |
| `schema_version` | `int NOT NULL` | §2.4 |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | — |

No `updated_at` and no `set_updated_at()` trigger: the row is immutable by construction (§2.5), so an `updated_at` column would be a lie.

### 2.4 Versioning the shape against future format families

`schema_version int NOT NULL`, written from the ADR constant **`AI_ORIGINAL_SCHEMA_VERSION = 1`**, which covers ADR 0017 §4.1's `single` + `thread` union. Carousel and script families are deferred (ADR 0017 §15); when one lands it bumps the constant to 2.

**The rule that makes this safe: the classifier refuses to diff an unknown `schema_version` and permanently abandons the signal** (§9.4), rather than best-effort parsing a shape it does not understand. A mis-parsed payload would emit wrong signals into a confidence counter — the failure mode this whole track is built to avoid. Refusing loudly is correct; guessing quietly is not.

### 2.5 Write-once enforcement: `BEFORE UPDATE` only, never `DELETE`

The precedent is ADR 0017 §3.2's `MODE2-ROLE-WRITE-ONCE` (`0017-mode-2-upgrade.md:207-213`), implemented as `enforce_post_role_write_once` at `supabase/migrations/20260722190000_mode2_brief_and_roles.sql:147-159`, and its sibling `enforce_campaign_brief_frozen` (`MODE2-BRIEF-FROZEN-GUARD`) at `:80-92`. **Both are `BEFORE UPDATE` only.** L-2 is at least as load-bearing as `posts.role`, so it gets the same treatment — but *stronger in the UPDATE direction*: where the `role` trigger rejects conditionally (`NEW.role IS DISTINCT FROM OLD.role AND OLD.role IS NOT NULL`), this trigger rejects **any** UPDATE to a `post_ai_originals` row, unconditionally. There is no legal reason to modify a snapshot.

> **`[db-BLOCKER-1]` / `[sec-HIGH-1]` — the design as first drafted would have broken GDPR erasure outright.** The first draft specified `BEFORE UPDATE **OR DELETE**` with an unconditional `RAISE`. `database-reviewer` and `security-reviewer` independently caught the same fault: **Postgres fires a child's `BEFORE DELETE` row triggers for FK-cascade deletes identically to direct ones.** `purge_business` performs a root `DELETE FROM public.businesses WHERE id = p_business_id` (`supabase/migrations/20260702120700_purge_business_member_delete.sql:62`) and has **no `EXCEPTION` block anywhere in its body**, so the cascade into `post_ai_originals` would `RAISE`, abort the whole function, and roll back the vault-secret deletion and `business_members` erasure that already ran. Effect: **no business that has ever generated a post could ever be GDPR-purged**, and the failure would present as an ordinary retryable error (`0010-legal-surface.md:1097`) that retries identically forever. Not a leak — a total denial of erasure.
>
> **Adopted fix:** the trigger is scoped to `BEFORE UPDATE` only. There is no way to distinguish a cascade-originated DELETE from a direct one inside a child `BEFORE DELETE` trigger, so special-casing is a dead end. Immutability against the **application** is provided instead by RLS carrying **no authenticated DELETE policy** — the `email_outbox` posture, whose migration states it explicitly (`supabase/migrations/20260607100000_email_outbox.sql:41-43`). This also restores §10.2's claim that `purge_business` needs no change, which was false as first specified.

### 2.6 Backfill and the `PostUpdate` exclusion

**Backfill: none. The table ships empty.** Pre-existing `posts` rows have no honest AI original — inventing one would fabricate ground truth, the same reasoning ADR 0017 §3.2 used to backfill `posts.role` to `NULL` rather than a default role. A post with no snapshot is **skipped and counted** (`skippedNoSnapshot` in the tick log, §9.5), never errored.

**`PostUpdate` (`lib/db/types.ts:320`) is NOT changed.** Its `Omit` set — `'id' | 'created_at' | 'business_id' | 'campaign_id' | 'published_at' | 'platform_post_id' | 'platform_url' | 'deleted_at' | 'role'` — exists because `role` and the tenancy-critical fields live *on `posts`*; a separate table needs no exclusion. Stated explicitly so the Builder does not add a speculative one.

**Where the snapshot is written:** in the same service-role orchestrator that already owns generation — `generatePostsForCampaign`, alongside `createPosts` (`lib/campaigns/generate.ts:362`), from the structured `GeneratedItem.output` (`generate.ts:57-65`, field at `:62`) that is still in scope there — and in the regenerate path, which writes `revision + 1`. `createPosts` returns the full inserted `PostRow[]` (`lib/db/posts.ts:293-295`), so the `post_id`s are available without a re-query.

> **`[db-MINOR-1]` — the revision race.** If the next `revision` is computed client-side (`SELECT max(revision)+1` then `INSERT`), two concurrent regenerations of the same post collide on `UNIQUE (post_id, revision)`. That is a *safe* failure (the constraint rejects one write; no corruption), but the regenerate Server Action needs an explicit `23505` catch-and-retry — the same duplicate-detection convention CLAUDE.md's Webhook Handlers section already establishes. Named as an implementation obligation, not left implicit.

---

## 3. The capture hook (Q2)

### 3.1 The transition, and the mechanism

**Decision: an outbox. `post_edit_signals` rows are enqueued by an `AFTER UPDATE` trigger on `posts` firing on the `draft → approved` transition, and drained by the worker (§9).** (`LEARN-CAPTURE-AT-TRANSITION`.)

**The trigger copies the human-final content into the row** (`NEW.content`, `NEW.hashtags`). This is not incidental. Both diff inputs — the frozen snapshot and the frozen human-final copy — are then immutable forever, which means:

- **No TOCTOU.** `updatePostContent`'s guard is `.in('status', ['draft','approved'])` (`lib/db/posts.ts:482`), so a post **can** be edited after approval. If the worker re-read `posts.content` at claim time it would diff a version the human never approved.
- **Determinism becomes a property of the data, not of timing** — which §4.3 requires, because the output feeds a confidence counter.

**Losers:**
- **(a) inline in the transition** — couples the user's approve latency *and the capture's failure modes* to their approve. Worse, `bulkApproveDraftPosts` returns a **count only** (`lib/db/posts.ts:543`), so an inline capture would have to change its return shape or re-query. `[db-Q1]` confirms a `FOR EACH ROW` trigger fires once per row of a set-based UPDATE regardless of what the client sees — the trigger sidesteps this entirely.
- **(c) a worker re-scan on a staleness predicate** — needs a cursor or claim marker and risks double-counting, which is precisely the correctness bug §9.6 exists to eliminate.

**Approval only, not approval + publish.** `publishPostComplete` (`lib/db/posts.ts:613-631`) does not alter content, so capturing at publish would re-observe the same edit and inflate `observation_count`. **Loser: approval + publish.**

> **Named accepted gap.** An edit made to an *already-approved* post is not re-captured. The `ON CONFLICT (post_id, ai_original_id) DO UPDATE ... WHERE post_edit_signals.status = 'pending'` clause (§3.3) refreshes a not-yet-processed row — so unapprove → edit → re-approve is handled correctly — but never creates a second row and never mutates an already-processed one. Recorded as a bounded, deliberate gap rather than silently omitted.

### 3.2 Two corrections adopted from the advisory passes

> **`[db-MAJOR-1]` — the snapshot-less post.** The trigger fires on *every* `draft → approved` transition, including pre-existing posts and posts from `manual`-origin campaigns (`campaigns.origin` includes `'manual'`, `20260722190000_mode2_brief_and_roles.sql:94-115`) that may never have been AI-generated at all. With `ai_original_id NOT NULL` and no skip branch, the trigger's INSERT throws a not-null violation and **the entire approve transaction rolls back** — a production outage on the core approval flow, not a corner case. With `ai_original_id` nullable, Postgres treats NULLs as distinct in a UNIQUE index, so `ON CONFLICT` can never fire for those rows and every re-approval inserts a duplicate, dissolving the dedup contract.
>
> **Adopted:** `ai_original_id` is **`NOT NULL`**, and the trigger body carries an explicit *"no latest snapshot → return without enqueuing"* branch — the same skip-and-count posture as §2.6, surfaced as `skippedNoSnapshot` in the tick log.

> **`[sec-LOW-2]` — the transition guard belongs in the function body.** The existing `posts` trigger precedent (`supabase/migrations/20260702120300_posts_role_aware_and_status_trigger.sql:70-72`) checks `OLD.status` / `NEW.status` inside the function, not via a `WHEN` clause. This trigger does the same (`IF OLD.status = 'draft' AND NEW.status = 'approved' THEN …`). Without it, every later `UPDATE` on an approved post — a schedule change, a publish-attempt counter — would enqueue a duplicate row carrying stale content.

### 3.3 `post_edit_signals` — the outbox row

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | — |
| `business_id` | `uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE` | cascade + RLS anchor |
| `post_id` | `uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE` | — |
| `ai_original_id` | `uuid NOT NULL REFERENCES post_ai_originals(id) ON DELETE CASCADE` | **NOT NULL** per `[db-MAJOR-1]` |
| `campaign_id` | `uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE` | the distinct-campaign promotion gate (§7.3) |
| `platform` | `text NOT NULL` | scope / `scope_ref` for the memory row |
| `human_content` | `text NOT NULL` | frozen at approval by the trigger |
| `human_hashtags` | `text[] NOT NULL DEFAULT '{}'` | frozen at approval |
| `approved_at` | `timestamptz NOT NULL` | — |
| `status` | `text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed','abandoned'))` | the drain state machine, mirroring `email_outbox` (`20260607100000_email_outbox.sql:2-23`) |
| `attempts` | `int NOT NULL DEFAULT 0` | — |
| `next_attempt_at` | `timestamptz NOT NULL DEFAULT now()` | backoff |
| `last_error` | `text` | — |
| `processed_at` | `timestamptz` | — |
| `class` | `text CHECK (class IS NULL OR class IN ('preference','correction','inconclusive'))` | written by the worker; the DB half of §5.3 |
| `pattern_key` | `text` | written by the worker; the aggregation key (§7.2) |
| `signals` | `jsonb` | the Tier-0 classifier output |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | `updated_at` via the shared `set_updated_at()` trigger |

**`UNIQUE (post_id, ai_original_id)`** — the first idempotency layer (§9.6). A regeneration produces a new `ai_original_id` and therefore a legitimately new signal; a re-approval of the same original does not.

**Indexes** (`[db-Q4]`, exact shapes supplied by the advisory pass):
- `post_edit_signals_claimable_idx (next_attempt_at) WHERE status = 'pending'` — mirrors `email_outbox_drainable_idx` (`20260607100000_email_outbox.sql:31-33`).
- `post_edit_signals_pattern_processed_idx (business_id, pattern_key) INCLUDE (campaign_id) WHERE status = 'processed'` — one covering partial index serving **both** the `observation_count` recompute and the `COUNT(DISTINCT campaign_id)` promotion gate by index-only scan.
- Explicit FK indexes on `ai_original_id` and `campaign_id` — **neither is implied** by the stated UNIQUE (which leads on `post_id`), and both are needed for cascade-delete lookups. On `post_ai_originals`, `UNIQUE (post_id, revision)` already serves the latest-revision lookup by backward scan; `business_id` and `campaign_id` each still get a plain index per the always-index-FKs rule.

Both tables are brand-new, so inline `CHECK (… IN (…))` at `CREATE TABLE` time is correct; the `NOT VALID` / `VALIDATE CONSTRAINT` two-step (ADR 0017 §3.2 `[db-MINOR-1]`, `20260722190000_mode2_brief_and_roles.sql:112-118`) is only needed when constraining a table with existing rows, so its absence here is deliberate, not an omission.

### 3.4 The enumerated caller table (CLAUDE.md SHARED-FUNCTION CALLERS) — `LEARN-CAPTURE-ALL-CALLERS`

Both Session 22 blockers were the same root cause on **this exact function pair**: a constraint verified against one of two callers of `bulkApprovePostsAction` across three consecutive sessions. The enumeration is therefore mandatory — and the mechanism was chosen partly to make it moot.

| Transition fn | Caller | `file:line` | Kind | Test file that covers it |
|---|---|---|---|---|
| `approvePost` (`lib/db/posts.ts:320`) | `approvePostAction` | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:89` | Server Action | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.test.ts` |
| `approvePost` | `approvePostFromCalendarAction` | `app/[locale]/(dashboard)/calendar/actions.ts:270` | Server Action | `app/[locale]/(dashboard)/calendar/actions.test.ts` |
| `bulkApproveDraftPosts` (`lib/db/posts.ts:526`) | `bulkApprovePostsAction` | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:207` | Server Action | `actions.test.ts` |
| ↳ UI caller of that action | `PostsClient` | `app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx:133` | Client Component | `PostsClient.test.tsx` |
| ↳ UI caller of that action | `ApprovalsInbox` | `app/[locale]/(dashboard)/approvals/ApprovalsInbox.tsx:123` | Client Component | `approvals/ApprovalsInbox.test.tsx` |
| `createPosts` (`lib/db/posts.ts:288`) | `generatePostsForCampaign` | `lib/campaigns/generate.ts:380` | internal lib (service-role) | `lib/campaigns/generate.test.ts` |
| **any future caller** | — | — | — | **covered by construction** — see below |

> **[Session 25-D correction, MINOR-9]** All six `file:line` citations above were re-derived at the
> current commit (not `d7cee4a5`, the range the original Reviewer read). Four were wrong as originally
> written and are corrected here: `actions.ts:94` → `:89`, `actions.ts:218` → `:207`,
> `calendar/actions.ts:280` → `:270` (this fifth drift was found during this re-derivation, beyond the
> three the Reviewer's MINOR-9 named — line numbers drift as a file is edited by unrelated later commits;
> that is expected and is exactly why this table must be periodically re-checked, not trusted forever),
> and `generate.ts:362` → `:380`. The test-coverage cell for `bulkApproveDraftPosts` is also corrected:
> `actions.context-equivalence.test.ts` is **removed** from it — that file's only `describe` block is
> `regeneratePostAction caller — …`, and `git grep bulkApprovePostsAction` returns zero matches in it at
> the current commit (not even a mock declaration). `bulkApprovePostsAction` is fully covered by
> `actions.test.ts` alone (`describe('bulkApprovePostsAction', ...)`, asserting real invocation and args),
> so this is a **citation correction, not a new coverage gap** — but it is exactly the class of thing
> SHARED-FUNCTION CALLERS exists to stop being taken at face value.

**The structural point.** Because capture attaches to the **transition** and not to a **function**, every caller — present, future, and hypothetical — is covered by the schema itself. The Session 22 failure mode is *eliminated*, not merely enumerated. The proof of that claim is a **Tier-1 test that issues a raw `UPDATE posts SET status='approved'` from no application code at all** and asserts a signal row appears (§12). The table above is still written and still tested per caller, because the ADR-level claim "all callers covered" must be checkable at both layers.

This is also what satisfies **L-4 / `LEARN-MODE-AGNOSTIC`**: the hook keys off "an AI-authored draft that a human approved", never off `campaigns.origin`. Studio (Mode 1), the approvals inbox, the campaign review surface and any future quick-edit surface feed the same loop for free — build it once, it pays for all three modes.

### 3.5 `campaign_briefs` edits: out of scope, named as a follow-on

**Decision: brief-edit diffs are NOT captured in Track C.** (`LEARN-BRIEF-DIFF-DEFERRED`.)

ADR 0017 §2.3 keeps briefs **mutable in place** with only a monotonic `version` bump (`lib/db/campaign-briefs.ts:108`, `version: expectedVersion + 1`) and explicitly rejected a revisions child table as "unused machinery for a Track-C consumer that does not yet exist." The consequence is decisive: **there are no brief revision rows**, so the AI's original brief content is already gone after the first human edit. Capturing brief diffs therefore requires its own snapshot artefact (`campaign_brief_revisions`, which ADR 0017 §2.1 assigned to *Track C's choice* — Track C chooses: **not now**), its own capture point, its own strategy-level taxonomy, and its own memory dimension. That is a second track, not a sub-step of this one.

**Loser: capturing brief diffs in Track C.** It is genuinely higher-signal than copy edits — a strategy-level correction says more than a tone tweak — and that is exactly why it deserves its own design rather than a bolt-on to a migration-heavy track.

---

## 4. The diff and the Tier-0 heuristic classifier (Q3, Q4, L-5)

### 4.1 The dependency question, pressure-tested (L-13)

**Decision: no diff library. In-repo deterministic deltas.** `package.json` (verified, `dependencies` at `:22-79`) contains no `diff`, `diff-match-patch`, `jsdiff` or `fast-diff`, and none is added.

The build guide asked me to pressure-test the premise before spending a dependency, and the premise does not hold. Every L-5 heuristic needs a **delta**, not a rendered patch:

| Heuristic | What it actually needs |
|---|---|
| length delta | `.length` on two frozen strings |
| hashtag delta | set difference over two `text[]` |
| avoid-word removal | word-boundary matching against `avoid_words` |
| CTA presence | a deterministic rule over both strings |
| thread-length change | `payload.posts.length` vs `human_content.split('\n\n---\n\n').length` — the delimiter is fixed at `generate.ts:50-55` and is therefore a contract, not a guess |
| link movement | the segment index of the first URL |
| claim removal (§5) | **sentence-level set difference** — split both on `.!?` + newline, normalise, subtract |

A character-level patch earns its keep in **Mode 1 Studio (Phase C)**, where the left/right diff **is** the product; `campaign-modes §1` (line 58) already names `diff-match-patch` for exactly that. Pinning it here would add a runtime dependency for a consumer that does not exist.

**Loser: an exact-pinned `diff` / `diff-match-patch` now.** Since no dependency is added, L-13's founder-confirmation requirement is not engaged. If a future step in this track appears to need one, that is a **STOP** — the pin must be exact, no caret (the Session 13.5D/B7 rule that pinned `@upstash/qstash 2.11.0`, `package.json:43`).

### 4.2 The taxonomy (`LEARN-HEURISTIC-FIRST` — no LLM on this path)

Twelve signal kinds ([Session 25-D correction, NIT-1] corrected from a miscounted "eleven" — 9 preference + 1 correction + 2 inconclusive), each with a fixed rule. **Nothing on this path calls an LLM.** An LLM call per approved post is the wrong architecture at any scale and is an L-1 STOP.

| Kind | Class | Exact rule |
|---|---|---|
| `avoid_word_removed` | preference | a term in the business's `avoid_words` is present in `rendered_content` and absent from `human_content`, matched on word boundaries, case-insensitive |
| `length_delta` | preference | `(len(human) − len(original)) / len(original)`; emitted only when `\|delta\| ≥ LEARN_LENGTH_DELTA_MIN_PCT = 0.15`, with the sign carried as the direction |
| `hashtag_delta` | preference | set difference and count difference between `hashtags` and `human_hashtags`; direction = added / removed |
| `cta_added` / `cta_removed` | preference | a deterministic CTA rule (imperative-opener list ∪ presence of an outbound URL in the final segment) evaluated over both strings; emitted on a change of verdict |
| `thread_shortened` / `thread_lengthened` | preference | `payload.posts.length` (thread family only) vs the human segment count; direction from the sign |
| `link_moved` | preference | the segment index of the first outbound URL changed. Emitted **especially** when it moves out of segment 0 — that contradicts ADR 0017 §8's `MODE2-LINK-PLACEMENT` Tier-0 rule, so it is evidence the generator's own rule is wrong |
| `numbering_stripped` | preference | thread segments in the original open with `1/`, `1.`, or `(1/7)`-style markers and the human segments do not. **The strategy doc's own named first test case** (`campaign-modes §1`, lines 195-197) |
| `unsourced_claim_removed` | **correction** | §5.2 |
| `evidence_cited_claim_removed` | inconclusive | a removed claim that **was** backed by pinned evidence — the human disagreed with a sourced claim; could be either class; **do not learn from it** |
| `avoid_word_added` | inconclusive | the human added a term on their *own* avoid list — it contradicts their stated rule, so record it and do not learn from it |

`avoid_words` is read through `lib/memory/voice.ts`'s `retrieveVoice` (`lib/memory/voice.ts:22-37`), which reads `brand_voices` / `brand_voice_variations` — never a direct table query (§7.5).

### 4.3 Determinism is a named constraint, not a hope (`LEARN-CLASSIFY-DETERMINISTIC`)

`classify(aiOriginal, humanFinal, voiceRules, pinnedEvidence)` is a **pure function**: no clock, no randomness, no network, no LLM, no dependence on row order. The same input pair must always produce the same classification, **because its output increments a confidence counter** — a nondeterministic classifier would make `observation_count` a random variable and every promotion decision unreproducible.

Proven at Tier 2 by a golden fixture pair evaluated twice yielding byte-identical output, plus a case table exercising each of the twelve kinds.

---

## 5. Correction vs preference (Q4, L-6) — the section the Reviewer will read hardest

### 5.1 Why this is the highest-stakes section

An edit that fixes a hallucinated fact is an **evidence/grounding** signal. An edit that changes tone is a **taste** signal. Conflating them teaches voice memory that a hallucination fix is a style preference — and the corruption is **silent and compounding**: nothing goes red, the model's outputs drift, and by the time anyone notices, the memory that would explain it is itself the corrupted artefact. The plan doc's Track C reviewer step names this specifically: *"a check that the correction/preference split is actually enforced (not just documented) before anything writes into voice memory"* (`session-plan §2`, line 92).

### 5.2 The rule that classifies a grounding correction — checkable, not guessed

ADR 0017 Amendment A.1 (`0017-mode-2-upgrade.md:684-706`) hardened the pinned-evidence boundary from *asserted* to **`business_id`-enforced**: `wrapEvidenceForPrompt()` now requires a `businessId` and threads it into `getEvidenceMemoryByIds`, which filters `.eq('business_id', businessId)`. That is the lever that makes a correction **checkable**:

```
unsourced_claim_removed  ⟺
    a sentence present in the AI original and absent from the human final,
    AND carrying a factual marker (numeral, %, currency, superlative, or named entity),
    AND overlapping NO pinned evidence row for that campaign
```

The pinned set is read from the campaign's frozen brief `content.pinnedEvidence[].evidenceMemoryId` (`CampaignBriefContent`, ADR 0017 §2.2) and re-fetched via `getEvidenceMemoryByIds(businessId, ids)`, `business_id`-scoped per Amendment A.1.

> **The guard that makes this rule safe, and without which it is worse than useless.** The correction check **only runs when a frozen brief with a non-empty `pinnedEvidence` set exists for the campaign.** Without that condition, a post with no brief would make *"no pinned evidence supports this claim"* trivially true for **every** claim, and the system would flood itself with false corrections — poisoning the very signal the split exists to protect. **Absence of evidence is not evidence of hallucination.** Posts with no brief, or with an empty pinned set, emit `inconclusive`, never `correction`. This is `LEARN-CORRECTION-REQUIRES-BRIEF`.

### 5.3 The structural enforcement — stated honestly, not overclaimed

**A runtime `if` is not enforcement. This ADR says so explicitly, and does not claim more than it delivers.**

`ecc:type-design-analyzer` was blunt and correct: plain TypeScript cannot make this *unrepresentable*, and **this codebase has already been through exactly this overclaim once** — ADR 0017 Amendment A.2 (`0017-mode-2-upgrade.md:708-731`) walked back the identical claim about `FrozenBrief`'s brand, recording that a single-step `{...} as FrozenBrief` is legal TypeScript and that *"the DB trigger is, and was always meant to be, the actual enforcement layer."* This ADR follows that precedent rather than repeating the mistake.

**Layer 1 — a partitioned return, not a flat tagged array.**

```
type PreferenceKind    = 'avoid_word_removed' | 'length_delta' | 'hashtag_delta'
                       | 'cta_added' | 'cta_removed' | 'thread_shortened'
                       | 'thread_lengthened' | 'link_moved' | 'numbering_stripped'
type CorrectionKind    = 'unsourced_claim_removed'
type InconclusiveKind  = 'evidence_cited_claim_removed' | 'avoid_word_added'
        // the three vocabularies share NO members

interface SignalBase         { postId: string; platform: Platform; detail: SignalDetail }
interface PreferenceSignal   extends SignalBase { readonly _class: 'preference';   kind: PreferenceKind }
interface CorrectionSignal   extends SignalBase { readonly _class: 'correction';   kind: CorrectionKind }
interface InconclusiveSignal extends SignalBase { readonly _class: 'inconclusive'; kind: InconclusiveKind }

classify(...) : {
  readonly preferences:  readonly PreferenceSignal[]
  readonly corrections:  readonly CorrectionSignal[]
  readonly inconclusive: readonly InconclusiveSignal[]
}
```

**There is no `Signal[]` type anywhere in the codebase.** The specific footgun L-6 names — *a flat list a developer forgets to filter* — is structurally gone: there is nothing to `.filter()` and forget. The voice-directed writer accepts only `readonly PreferenceSignal[]`, so passing `result.corrections` is a compile error.

Per `[type-2]`: **`_class` is the primary discriminant and alone suffices** to block the cross-assignment; the disjoint `Kind` vocabularies are a documented **fallback**, load-bearing only if a future refactor deletes `_class` as "redundant." Both are kept, and which is which is recorded here so a Reviewer does not mistake the fallback for decoration. The minimum invariant a future PR must not break: **at least one field must carry a string-literal type unique to each shape, never widened to `string`, and none of the three interfaces may carry an index signature.**

Per `[type-3]`: plain interfaces with a literal tag are house style — `VaultSecretId` (`lib/db/types.ts:19-31`), `RenderedEvidence` (`lib/ai/wrap-evidence.ts:11`), `FrozenBrief`. A `#private`-field class **would** give real nominal typing in TypeScript, but it is a novel OOP pattern for this codebase, for a gain the DB layer must provide regardless. Rejected for house consistency, **with the rejection recorded rather than silent**.

**What this layer honestly does not close** — spelled out because the alternative is another Amendment A.2: `as unknown as PreferenceSignal[]` defeats any plain-TS encoding; and the **DB rehydration boundary** is the real hole — the moment a signal is persisted and re-read by the promotion job, its TS type is whatever the read function declares.

**Layer 2 — `LEARN-VOICE-WRITE-TRIGGER`, the actual enforcement.**

> **`[type-4]` called the first draft partial theatre, and was right.** "A service-role path that re-derives the class and rejects non-preference rows" is **an `if` statement relocated from TS into app-layer SQL-building** — exactly what L-6 forbids. A `CHECK (class IN (…))` only rejects typos; it does nothing to stop a validly-tagged `'correction'` row being read and written.
>
> **Adopted instead:** a **trigger on `performance_memory`** that, for any `source='distilled'` INSERT or UPDATE carrying `dimension IN ('format','hook')`, joins back to the contributing `post_edit_signals` rows and `RAISE`s if **any** carries `class <> 'preference'`. This is enforcement independent of which code path issues the write — including a future promotion job, a manual backfill script, or an ad-hoc debugging query. It is the same architectural move ADR 0017 made when it paired the branded `FrozenBrief` with the `frozen_at` DB trigger (`0017-mode-2-upgrade.md:334-344`).

**Layer 3 — a compile-time regression test.** `lib/db/types.test.ts` already establishes the `@ts-expect-error` negative-test convention (lines 91, 95, 116, 138-143). A sibling file asserts that passing `result.corrections` to the voice-directed writer **fails to compile**. This converts "a reviewer has to notice that someone widened `kind` to `string`" into "CI goes red," which is the entire point of Tier 2 under ADR 0015.

**The named second choke point.** Per `[type-5]`, the function that rehydrates persisted signal rows into `PreferenceSignal` / `CorrectionSignal` shapes is named in the ADR as a choke point — mirroring how `wrapEvidenceForPrompt()` is "the single shared choke point" (`lib/ai/wrap-evidence.ts:114-131`) — and carries a runtime Zod `.literal()` guard at that boundary. Whoever writes that function decides its return type; without a guard there, nothing else in this section reaches the promotion path.

### 5.4 What none of this proves, stated plainly

Everything above establishes that a value **correctly tagged** `correction` cannot reach a voice-directed write. It proves **nothing** about whether the heuristic that assigned the tag was right. A bug in §5.2's rule — an off-by-one against the pinned-evidence id set, a sentence-splitter edge case — mislabels at construction time, and the type system has zero visibility into it by design (`[type-7]`).

That residual is managed by **aggregation, not by types**: a mislabelled single signal cannot change generation, because §7.3 requires 5 observations across 2 campaigns before anything is retrieved. The type-safety machinery must not be read as implying more than it delivers, and this paragraph exists so it is not.

---

## 6. The batch summarization (L-5, L-10, Q7)

### 6.1 What it summarizes, and what it does not

Tier-0 produces **deterministic, templated pattern statements** with no LLM involvement — *"Human editors shorten AI-generated LinkedIn posts by ~22% (7 observations)"* is arithmetic, not generation. The summarizer exists for the one thing arithmetic cannot do: **clustering semantically-similar edits the fixed taxonomy cannot name** — e.g. *"this business consistently replaces vendor-speak with plain verbs."*

Input per call: the deterministic Tier-0 signal summaries for **one** business since its last summary, plus **hard-capped excerpts of human-edited copy** (§6.3). Output: a bounded set of candidate pattern statements (§6.4), written as `candidate` rows subject to the same promotion threshold as Tier-0 statements — the summarizer gets **no shortcut into `active`**.

### 6.2 Cadence, model, and ceiling — never per post

**The cadence is a floor, not a schedule.** The tick runs hourly (§9.2); summarization fires for a business only when **both** gates pass:

- `≥ LEARNING_SUMMARY_MIN_SIGNALS = 20` newly-processed signals since its last summary, **and**
- `≥ LEARNING_SUMMARY_MIN_INTERVAL_DAYS = 7` elapsed since its last summary.

So it is **at most weekly per business, and frequently never**. Below the signal floor the Tier-0 templated statements are already sufficient and the LLM adds nothing but cost. **An LLM call per approved post is an L-1 STOP.**

**Model: Haiku 4.5** (`claude-haiku-4-5-20251001`), per CLAUDE.md's stack line putting Haiku on classification. Justified rather than assumed: the input is bounded and **pre-aggregated by deterministic code**, the semantic task is compression of already-classified signals rather than open-ended generation, and the output is schema-bounded.

> **`[cost-1]` — a deliberate deviation from `cost-aware-llm-pipeline`'s routing pattern, recorded as such.** The skill prescribes complexity-based routing (cheap tier by default, escalate past a token/item threshold). This track uses **a single fixed tier with no escalation**, because Tier-0 pre-aggregation caps how much the model must reason about *by construction* — the escalation threshold would never fire, so a routing layer would be dead code. Deviations from an established pattern are findings, not choices, so this one is named rather than absorbed.

**Per-business cost ceiling:** `LEARNING_SUMMARY_MAX_INPUT_TOKENS = 12000` (**truncate, not warn** — the posture ADR 0017 §9 `[sec-HIGH-1]` adopted for evidence length) and `LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS = 8`, counted from the existing `ai_usage` table (a service-role write per CLAUDE.md). At ~12k input + ≤1k output on Haiku that is roughly **$0.015 per call, ≈ $0.06 per business per month** at the weekly floor — negligible against a €99–199/mo product, and hard-capped regardless of usage. The stable system prompt carries `cache_control: ephemeral`, which `runner.ts:85-91` already applies over 4096 chars.

**Tier 1. There is no Tier 2 and no Tier 3 anywhere in this track** — no critique/regenerate loop, no agentic tool loop. Mode 3's signal triage remains the only Tier-3 in the entire product and is deferred (§15). The learning loop is background, cheap, and boring on purpose.

### 6.3 Input handling — a NEW data-flow direction for this codebase (`LEARN-SUMMARY-DATA-GUARDED`)

Until now this codebase fed AI-authored or user-profile text into prompts. **Human-edited post copy becoming LLM *input* in a background worker is new**, and it gets the full ADR 0017 §9 (`0017-mode-2-upgrade.md:446-481`) treatment:

- **Guard at render time, never authorship time** (ADR 0017 `[sec-HIGH-2]`): a later human edit re-enters the field after any one-time sanitize, so authorship-time sanitization is a bypass.
- **The shared `neutralize()` helper** (`lib/ai/wrap-evidence.ts:83-111`) — NFKC normalisation, Cf-character stripping, fence and leading-brace defusal, `[/DATA]`-closer neutralisation, returning the `[DATA]`-fenced string at `:111` — **not** the weaker local `sanitizeDataField`, which only replaces a literal `[/DATA]` closer and is duplicated verbatim in five files (`lib/ai/prompts/rubric.ts:9-11`, `post-regeneration.ts:7-9`, `post-generation.ts:6-8`, `formats/native-generation-prompt.ts:9-11`, `brief.ts:13-15`).
- **A hard length cap before the model sees anything**, per ADR 0017 §9's `[sec-HIGH-1]`: append-only escaping is not a substitute for a length/shape cap.
- **Accepted residual, recorded not waved through** (`[sec-MEDIUM-2]`): `neutralize()` is a *structural* guard — it defeats fence escape, invisible-character smuggling and homoglyphs. It does not, and was never designed to, block a semantic instruction sitting inside a correctly-fenced `[DATA]` block. That residual is identical to the one ADR 0017 §9 accepted for `evidence_memory.content` (`[sec-LOW-1]`). Blast radius is **same-tenant only** — the summarizer reads and writes one `business_id` per call (§10.3) — so a business can only shape its own future prompts. The one angle worth naming: a malicious or compromised **team member** could shape what the next AI draft says, which a *different*, less careful approver then reviews under the assumption it is ordinary AI output. Given that human-in-the-loop is this product's core premise, that is recorded as an accepted, stated residual rather than ignored.

### 6.4 Bounded output contract

A Zod schema: at most `LEARNING_SUMMARY_MAX_STATEMENTS = 5` statements, each ≤ 200 characters, each carrying a `dimension` from ADR 0016 §3.4's fixed vocabulary (`topic` / `hook` / `format` / `proof_type`). Parsed via the existing `safeParseOrAiError` path; a parse failure surfaces `invalid_response` and the batch is retried per §9.4 — it never falls through to an unvalidated write.

> **`[sec-MEDIUM-3]` — what the bounded schema does and does not close.** It closes **output widening** (extra fields, oversized payloads, malformed nesting). It does **not** substitute for render-time neutralisation: 200 characters is ample room for a short imperative instruction, and once written to `performance_memory.pattern` that string re-enters generation prompts. **The two are orthogonal controls and this ADR must not conflate them** — which is why §10.4 exists.

---

## 7. The memory write and promotion (Q5, L-7, L-9)

### 7.1 The row written

Into `performance_memory` (`supabase/migrations/20260719010000_governed_memory.sql:205-231`), through `lib/db/memory-performance.ts` + `lib/memory/` — never directly (`MEM-NO-DIRECT-TABLE-ACCESS`, ADR 0016 §5.1). **Track C creates the first writer function in `lib/db/memory-*.ts`; today there is none.**

| Column | Value written |
|---|---|
| `source` | `'distilled'` |
| `status` | `'candidate'` — never retrieved until promoted (ADR 0016 §2) |
| `dimension` | `'format'` / `'hook'` for preference-derived patterns; `'topic'` / `'proof_type'` for correction-derived grounding patterns |
| `pattern` | the statement — Tier-0 templated, or the Tier-1 summarizer's bounded output |
| `pattern_key` | the deterministic identity slug (§7.2) |
| `platform` | the post's platform, or `NULL` for cross-platform |
| `scope` / `scope_ref` | `'platform'` + the platform value when platform-specific; `'brand'` + `NULL` when cross-platform |
| `sensitivity` | `'internal'` |
| `public_use_permission` | `false` — a distilled internal pattern is never published material |
| `confidence` | derived (§7.3), never asserted |
| `observation_count` | **recomputed** (§9.6), never incremented |
| `last_confirmed_at` | refreshed on each reinforcing observation |
| `expires_at` | `last_confirmed_at + LEARN_PATTERN_TTL_DAYS` (§7.4) |

> **ADR 0016 §3.4's un-defer trigger is DISCHARGED, and this ADR confirms it.** §3.4 bound ADR 0018: *"must not ship a `performance_memory` writer without resolving the placeholder."* Session 23-E (commit `6149535f`) resolved it by making `likes` / `impressions` **optional** on `PerformancePattern`, so the governed branch omits them rather than inventing `0`. **The distilled writer omits both and carries `observation_count` as the credibility signal** — *"appeared in 5 campaigns"* — which is what L-5's probabilistic framing actually wants. **The `0/0` inversion is not resurrected and cannot be**: the numerics are optional at the type level now (`lib/memory/performance.ts:11-23`).

### 7.2 `pattern_key` — the identity key (ADR 0016 Amendment B)

`observation_count` is only honest if two observations of the same phenomenon land on the same row. **One additive column on `performance_memory`: `pattern_key text`** — a deterministic slug derived from signal kind + direction + platform, **never from the prose** (prose varies; the phenomenon does not) — plus a partial UNIQUE index:

```
(business_id, dimension, coalesce(platform,''), pattern_key)
  WHERE source = 'distilled' AND deleted_at IS NULL
```

> **`[db-MAJOR-2]`, adopted:** without `CHECK (source <> 'distilled' OR pattern_key IS NOT NULL)`, Postgres never dedupes on NULL, so distilled rows with a NULL key accumulate one per tick and — because §9.6's recompute is scoped *by* `pattern_key` — stay frozen at their initial counts forever. The CHECK is required, not optional.
>
> **`[db-Q5]`, adopted:** `coalesce(platform,'')` inside a UNIQUE index is legal and is **the idiom already established here** — `email_outbox_dedupe_uq` uses `coalesce(dedupe_token,'')` (`20260607100000_email_outbox.sql:27-28`). `NULLS NOT DISTINCT` would introduce a second idiom for a solved problem. `platform` is CHECK-constrained to a fixed enum (`20260719010000_governed_memory.sql:227`), so `''` can never collide with a real value.

**This is a column-addition to a landed ADR and is recorded as ADR 0016 Amendment B**, not slipped in.

### 7.3 The promotion threshold — the number the strategy docs left to this ADR (`LEARN-PROMOTION-THRESHOLD`)

Named ADR constants, siblings of `BRIEF_QUALITY_THRESHOLD` (ADR 0017 §6.3) and the caps in `lib/memory/constants.ts` — never scattered magic numbers:

```
LEARN_PROMOTION_MIN_OBSERVATIONS       = 5
LEARN_PROMOTION_MIN_CONFIDENCE         = 0.70
LEARN_PROMOTION_MIN_DISTINCT_CAMPAIGNS = 2
LEARN_CONFIDENCE_K                     = 2
LEARN_CONFIDENCE_CEILING               = 0.95
LEARN_DEMOTION_NET                     = 3
LEARN_PATTERN_TTL_DAYS                 = 90
LEARN_LENGTH_DELTA_MIN_PCT             = 0.15
AI_ORIGINAL_SCHEMA_VERSION             = 1
```

**All three promotion gates must hold.** The third is what makes L-7 real: five observations inside a single campaign is **one editing session**, not a pattern — L-7 says "across N posts *or campaigns*", and only the distinct-campaign gate enforces the second half.

**Confidence is derived arithmetic:**

```
net        = observations − contradictions
confidence = min(LEARN_CONFIDENCE_CEILING, net / (net + LEARN_CONFIDENCE_K))   for net > 0, else 0
```

At exactly 5 clean observations this yields **0.714**, just clearing 0.70 — so both gates bind together and **neither is dead code**. (`K = 3` would have made `MIN_OBSERVATIONS` unreachable and the constant a lie; that is why `K = 2`. The interaction is deliberate and is Tier-2 tested at the boundary.)

**The promotion UPDATE is atomic** — a single conditional `UPDATE … WHERE status = 'candidate' AND observation_count >= 5 AND confidence >= 0.70 AND (SELECT count(DISTINCT campaign_id) …) >= 2`, matching the `approvePost` guard pattern (`lib/db/posts.ts:329-336`) and the constitution's read-then-update prohibition. Per `[db-Q6]`, Postgres evaluates the whole predicate including the subquery against one snapshot and takes the row lock before applying, so double-promotion is impossible; a marginal pattern racing a concurrent tick simply promotes one tick later, which is correct eventual-consistency behaviour for a tick-based system, not a bug.

**`LEARN-NO-SINGLE-DIFF-PROMOTION`** is the structural consequence: retrieval returns `active` only (ADR 0016 §2, and the partial index predicate at `20260719010000_governed_memory.sql:232-234`), so an unpromoted pattern **cannot** reach generation. The gate is structural, not a convention.

### 7.4 Contradiction and decay

**A contradicting diff reduces confidence — it does not merely fail to raise it.** An edit that lengthens where the pattern says "shortens" is a contradicting observation and enters `net` negatively. An `active` row whose `net` falls below `LEARN_DEMOTION_NET = 3` is **demoted to `candidate`**, never deleted — the audit trail and the observation history survive. Per `[db-MINOR-3]`, demotion carries the **same** explicit atomic guard as promotion (`.eq('status','active')`), spelled out rather than left to prose.

**Decay is free and structural.** `expires_at = last_confirmed_at + LEARN_PATTERN_TTL_DAYS (90)`, refreshed on each reinforcing observation. ADR 0016 §2 already excludes `expires_at < now()` at retrieval, so an unreinforced pattern goes silent with no deletion, no job, and no new mechanism. **Loser: hard-deleting stale patterns** (loses the audit trail and the observation history that a later reinforcement would build on).

### 7.5 Everything goes through the boundary (`LEARN-MEMORY-THROUGH-BOUNDARY`)

`lib/db/memory-performance.ts` owns the raw queries (explicit `business_id` filter, explicit `limit`, explicit index-matching `ORDER BY`, `.is('deleted_at', null)`); `lib/memory/performance.ts` owns scoring and the cap; `lib/memory/index.ts` (`:15-22`) is the only public entry point. The new writer follows the same layering. `avoid_words` is read via `lib/memory/voice.ts:22-37`, never by querying `brand_voices` directly.

---

## 8. Voice learning when there is deliberately no voice table (Q6, L-9)

**Decision: option (a). Preference signals land in `performance_memory` with `dimension ∈ {'format','hook'}`. No voice table is created. The user's `brand_voices` rows are never touched.** (`LEARN-VOICE-NOT-AUTO-MUTATED`.)

The deciding fact is that (a) **already reaches generation with zero new wiring.** A promoted `format` row flows `retrievePerformancePatterns` (`lib/memory/performance.ts:34-84`) → `CustomerContext.recentPostPerformance` → the post-writing templates, which since Session 23-E render each pattern with `On {platform}:` / `Across platforms:` provenance. So the strategy doc's own test case — *"if users consistently strip thread numbering, that's an unambiguous diff signal that should update voice memory over time"* (`campaign-modes §1`, lines 195-197) — actually changes future generation once promoted, through machinery that already ships.

**Losers:**
- **(b) a human-reviewable suggestion surface** proposing an `avoid_words` addition the user approves. Consistent with human-in-the-loop and genuinely attractive — but it requires a UI, and §11 keeps Track C pipeline-only. Deferred as `LEARN-VOICE-SUGGESTION-DEFERRED`.
- **(c) an amendment to ADR 0016 adding a voice-directed governed store.** Premature: §3.5 `MEM-VOICE-THROUGH-EXISTING` created none deliberately ("a parallel voice store is a spec defect"), and (a) already delivers the behaviour, so a new store buys nothing yet.

> **Auto-mutating `brand_voices` from an inference is a STOP, and this ADR does not propose it.** L-9 is explicit: silently mutating those user-owned rows is a change to the customer's own data without their consent. It is named here in those words so the boundary is on the record and a future session does not reach for it as an "obvious" simplification. No founder adjudication is requested, because nothing in this ADR requires it.

**Honest caveat, recorded rather than smoothed over:** voice learning lives under a *"performance"* label. The naming is imperfect and the ADR says so. **Named un-defer trigger:** if learned preferences ever need to reach the **system** prompt / core voice rules — rather than the per-call retrieved slice they reach today — that is when a voice-directed governed store earns an ADR 0016 amendment. Not before.

**Amendments:** ADR 0016 **§3.4** (the `pattern_key` column, §7.2 — Amendment B) and **§10** (the "ADR 0018 — the WRITER" deferral closes; `performance_memory` no longer ships without a writer). **Nothing in ADR 0011 or ADR 0016 §3.5 is amended** — the absence of a voice table is preserved, deliberately.

---

## 9. Worker topology (Q7, L-8)

### 9.1 Which tick it copies, and the deviation it does not copy

**Copies `runEmailDrainTick` (`lib/email/orchestrator.ts:32`)** — the repo's only true outbox drainer, and therefore the closest analogue:

| Element | `runEmailDrainTick` | Track C's `runLearningTick` |
|---|---|---|
| lazy service-role import | `lib/email/orchestrator.ts:49-50` | same |
| `Sentry.withMonitor` | `orchestrator.ts:46`, options `:132-138` | same, monitor slug `capture-learning` |
| one canonical JSON tick log | `orchestrator.ts:146-152` | §9.5 |
| batch claim | `claimEmailOutboxBatch` `orchestrator.ts:55` → RPC `claim_email_outbox` `20260607100000_email_outbox.sql:49-64` (`FOR UPDATE SKIP LOCKED`) | §9.3 |
| atomic status re-guard | `lib/db/email-outbox.ts:110` (`.eq('status', currentStatus)`) + `LEGAL_TRANSITIONS` `:18-24` | same |
| transient/permanent taxonomy | `orchestrator.ts:20`, `:106`, `:118-128` | §9.4 |

> **Named deviation NOT copied (deviations are findings, not choices — L-8).** `runJanitorTick` (`lib/publishing/orchestrator.ts:317`) has **no `Sentry.withMonitor` wrap**, unlike `runPublishTick` (`:71`) — confirmed by direct read during the grounding pass. Track C's tick **is** wrapped. Recorded so a Builder copying the nearest janitor-shaped code does not silently inherit the gap.

New module: `lib/learning/orchestrator.ts`, exporting `runLearningTick({ triggeredBy })`, alongside `lib/learning/classify.ts` (Tier 0) and `lib/learning/summarize.ts` (Tier 1).

### 9.2 Route and schedule

`app/api/cron/capture-learning/route.ts`, copying the dual-mode shape of `app/api/cron/publish/route.ts` verbatim: QStash signature verification at `route.ts:13-24`, the non-QStash bearer-secret fallback with `timingSafeEqual` at `:32-36` and the non-prod `x-cron-dev-trigger` header at `:45`, `GET` 405 when `CRON_TRIGGER === 'qstash'` (`:99-104`), `POST` 405 otherwise (`:106-111`). Input validated with Zod (L-12).

**Schedule: hourly, `0 * * * *`** — matching `runMetricsSyncTick` (`lib/metrics/orchestrator.ts:110-116`). Approval is not latency-sensitive; learning is explicitly background. A **runbook row** is added to `docs/runbooks/qstash-setup.md`, as the deletion cron's Step 2b was.

### 9.3 Claim mechanism

`claim_post_edit_signals(p_batch_size int)` — a new RPC copying `claim_email_outbox` (`20260607100000_email_outbox.sql:49-64`) verbatim in shape: `FOR UPDATE SKIP LOCKED`, `pending → processing`, bounded by `p_batch_size`, ordered by `next_attempt_at` against `post_edit_signals_claimable_idx` (§3.3). The sibling precedent is `claim_deletion_requests` (`20260615200000_deletion_cron_state_machine.sql:36`). `SECURITY DEFINER`, `REVOKE ALL … FROM public`, `GRANT EXECUTE … TO service_role`, as `purge_business` does (`20260702120700_purge_business_member_delete.sql:73-74`).

### 9.4 Failure taxonomy

Copying `isPermanentError` / `computeBackoff` (`lib/deletion/orchestrator.ts:20-27`, `:29-34`):

- **Transient** — Anthropic 429/5xx/network, Postgres serialization `40001`. → `status='failed'` with `next_attempt_at` set by exponential backoff + jitter, retried up to `LEARNING_MAX_ATTEMPTS`, then `abandoned`.
- **Permanent** — Postgres `23xxx` constraint classes, an **unknown `schema_version`** on the snapshot (§2.4), a missing snapshot row. → `status='abandoned'` immediately, no retry.

A capture that fails silently loses the signal forever and nobody finds out, so **no error on this path is swallowed**: every terminal outcome writes `last_error` and increments a counter that appears in §9.5's log line.

### 9.5 Config tunables and the single canonical tick log

Matching the `lib/config.ts:28-64` naming convention (`<DOMAIN>_BATCH_SIZE`, `<DOMAIN>_MAX_ATTEMPTS`, `<DOMAIN>_RETRY_BACKOFF_SECONDS`), accessed only through `lib/config.ts` (never `process.env` directly):

```
LEARNING_BATCH_SIZE                              default 50
LEARNING_MAX_ATTEMPTS                            default 5
LEARNING_RETRY_BACKOFF_SECONDS                   default 300
LEARNING_SUMMARY_MIN_SIGNALS                     default 20
LEARNING_SUMMARY_MIN_INTERVAL_DAYS               default 7
LEARNING_SUMMARY_MAX_INPUT_TOKENS                default 12000
LEARNING_SUMMARY_MAX_MONTHLY_CALLS_PER_BUSINESS  default 8
```

**Exactly one `console.log` on this path** (CLAUDE.md forbids `console.*` outside the canonical tick log):

```
console.log(JSON.stringify({
  kind: 'learning.tick', triggeredBy, tick, durationMs,
  claimed, classified, signalsEmitted, skippedNoSnapshot,
  patternsUpserted, promoted, demoted, summarized, summarizeFailed,
  summarizeFailedCode, retrying, abandoned, raceLost,
}))
```

> **[Session 25-D correction, NIT-4]** `failed` is renamed `retrying`: the counter means "sent back to
> `pending` with a backoff, will retry" — not a terminal failure like `abandoned`. Sitting beside
> `abandoned`/`promoted`/`demoted` under the old name, an operator alerting on `failed > 0` would page on
> every ordinary transient retry. `summarizeFailedCode` (added same pass, MINOR-4) carries the underlying
> `AiErrorCode` (or `'unknown'` for a non-`AiError`, e.g. a DB write failure in the summarizer's upsert
> loop) of the MOST RECENT summarize failure this tick, so an operator can tell a transient Anthropic-side
> failure from a prompt/schema regression without leaving the log line to cross-reference Sentry.

All application-layer timestamps use `date-fns` `formatISO`, never `new Date().toISOString()` (L-12); SQL-side defaults use `now()`.

### 9.6 IDEMPOTENCY — three layers, and the third is the one that matters (`LEARN-TICK-IDEMPOTENT`)

A double-counted diff silently inflates `observation_count` and promotes a pattern that was observed once. That is a **correctness bug, not a nicety**, and it is invisible.

1. **At enqueue** — `UNIQUE (post_id, ai_original_id)` with `ON CONFLICT DO UPDATE … WHERE post_edit_signals.status = 'pending'`. A re-approval cannot create a second row; a not-yet-processed row is refreshed; an already-processed row is untouched. `[db-Q2]` confirms the `WHERE` on the `DO UPDATE` arm is a predicate on the existing row that silently no-ops when false (not an error), and that under a bulk approve each row's trigger targets a distinct index entry, so there is no inter-row contention.
2. **At claim** — `FOR UPDATE SKIP LOCKED` plus the atomic `pending → processing` transition. A replayed tick claims nothing already claimed.
3. **At aggregation — `observation_count` is RECOMPUTED from the signal rows, never incremented.**

```
observation_count := COUNT(*) FROM post_edit_signals
                     WHERE business_id = $1 AND pattern_key = $2 AND status = 'processed'
```

**This makes double-counting arithmetically impossible rather than guarded against.** An increment can be replayed; a recompute cannot. It is the single most important design decision in this section, and it is why `observation_count` and `confidence` are treated as *outputs* of the signal table rather than independently-maintained counters — which is also what let §7.2 add only **one** column to `performance_memory` instead of three. `[db-Q5]` confirms the recompute is an index range scan against `post_edit_signals_pattern_processed_idx`, not a seq scan.

> **`[db-MINOR-2]` — a recorded gap, not silently inherited.** `post_edit_signals` is append-only with no retention or archival policy, so the recompute's scan grows without bound over time. No outbox-style table in this repo has a pruning job today, so this is a project-wide posture rather than a new fault — but it is named here for a follow-on retention ADR (§15) rather than left to be discovered.

---

## 10. GDPR and PII (L-11)

### 10.1 Both new tables take the full obligation

`post_ai_originals` and `post_edit_signals` are both business-scoped and both carry customer content — and `post_edit_signals.human_content` may carry third-party quote material identical to what `evidence_memory` holds (ADR 0016 §3.2's sensitivity note, `0016-governed-memory.md:144-148`). Each gets:

- **`business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE`** — the anchor parent, per ADR 0017 `[db-MAJOR-1]`. Tenancy is a **column**, never derived through a join.
- **The four RLS policies in the InitPlan-wrapped form**, copied from `20260719010000_governed_memory.sql:232-257` — `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`, with the UPDATE policy carrying **both** `USING` and `WITH CHECK` (tenant-tunnelling, CLAUDE.md). Per `[db-NIT-1]`: the bare `= ANY (public.get_user_business_ids())` form is the superseded pre-`…120017` body and must **not** be copied — it evaluates the function once **per row** on a seq scan. This is a known-regression shape, and stamping two new tables from a template is exactly when it comes back.
- **No authenticated DELETE policy on `post_ai_originals`** — the app-layer half of write-once (§2.5), the `email_outbox` posture (`20260607100000_email_outbox.sql:41-43`).
- **A row each in ADR 0010 Amendment 2 §D2.5's cascade table**, annotated as `evidence_memory`'s row is (`0010-legal-surface.md:1067`), per `[sec-MEDIUM-1]`:

| Table | Business-scoped? | FK→businesses ON DELETE | Cascades? | Action on purge |
|---|---|---|---|---|
| `post_ai_originals` | yes (`business_id`) | CASCADE | yes | none — cascade = erasure (holds AI-authored customer content) |
| `post_edit_signals` | yes (`business_id`) | CASCADE | yes | none — cascade = erasure (holds human-edited copy; may carry third-party quote material) |

A business-scoped table absent from that table is a **silent GDPR-erasure leak** (CLAUDE.md); neither ships without its row. Both tables also cascade redundantly via `post_id` / `campaign_id` — multiple cascade paths to the same row are legal and are defense-in-depth here, noted in the migration as intentional (`[db-NIT-2]`).

### 10.2 `purge_business` needs no change — but only because §2.5 was corrected

`purge_business` root-deletes at `20260702120700_purge_business_member_delete.sql:62` and relies on the FK graph; `0010-legal-surface.md:1078` records that only `business_deletion_requests` (NO ACTION) would ever have blocked it. **That claim was false in the first draft of this ADR** — the `BEFORE UPDATE OR DELETE` trigger would have aborted the root delete for every business that had ever generated a post (§2.5, `[db-BLOCKER-1]` / `[sec-HIGH-1]`). With the trigger scoped to `BEFORE UPDATE` only, the claim holds again.

**The Tier-1 test for this asserts that erasure SUCCEEDS**, not merely that rows are gone (§12) — because the failure mode here was erasure *denial*, and a rows-are-gone assertion inside an already-aborting transaction would never be reached.

### 10.3 The service-role summarizer must scope every query

The worker runs under the service-role client, which **bypasses RLS by design** — so correctness rests entirely on the queries, exactly the bug class Session 24-D's MAJOR-1 closed for `wrapEvidenceForPrompt` (`0017-mode-2-upgrade.md:684-706`). Binding constraints (`[sec-Q2]`):

1. Every input query filters explicitly on `business_id`. **One business per LLM call** — never a batched multi-tenant read collapsed into one prompt.
2. The output write sets `business_id` from **the same per-iteration variable the input was read with**. Where the tick loops over businesses, `business_id` must not be a shared or captured variable that could carry the previous iteration's value — the classic loop-capture leak.
3. Proven by a test that one business's input strictly cannot produce another business's write (§12), not merely by a unit test of the query builder.

This is the same two-belt posture ADR 0016 §4 documents: RLS protects the future authenticated read path; the explicit `business_id` filter is what actually holds at generation time.

### 10.4 `LEARN-PATTERN-RENDER-GUARDED` — an L-1 scope expansion, adopted on a HIGH finding

> **`[sec-HIGH-2]`.** `retrieveRelevant` returns `record.pattern` verbatim as `topContent` (`lib/memory/performance.ts:56-59`) — correctly, since ADR 0017 §9 requires guarding at *render* time. But the render sites do not guard it: **`lib/ai/prompts/post-generation.ts:158` places `p.topContent` inside a `[DATA]` fence with no sanitization at all**, while applying `sanitizeDataField` to *neighbouring* fields in the same template (`post-generation.ts:169`). Only `post-regeneration.ts:139` guards it, and only with the weak local copy. The hole is live today and already reachable via a `source='manual'` insert under `performance_memory_insert_own`.
>
> **[Session 25-D correction, NIT-2]** This section originally cited a THIRD site,
> `lib/ai/prompts/formats/native-generation-prompt.ts:158-163`, as also unguarded. It does not exist: that
> file renders no `topContent` or `recentPostPerformance` field at all at the range this ADR's
> implementation shipped (`git grep -n "topContent\|recentPostPerformance" -- lib/ai/prompts/formats/` →
> no match, independently re-derived by the Session 25 Reviewer and confirmed again here). There are only
> **two** real render sites. The citation below is corrected to them.

ADR 0018 does not create this hole — **it makes it load-bearing**, turning `performance_memory.pattern` from a rarely-used manual field into the automated, periodically-refreshed backbone of `recentPostPerformance`, written with no human reading the string before it enters a live generation prompt. Under CLAUDE.md's SHARED-FUNCTION CALLERS rule and ADR 0017 §9's enumerated-caller precedent, closing it is therefore **this ADR's obligation**:

| Prompt-builder rendering `recentPostPerformance.topContent` | Today | Required |
|---|---|---|
| `lib/ai/prompts/post-generation.ts:158` | **unguarded** | shared `neutralize()` at render |
| `lib/ai/prompts/post-regeneration.ts:139` | weak local `sanitizeDataField` | shared `neutralize()` at render |

> **Recorded as an L-1 scope expansion, adopted rather than assumed.** L-1 scopes Track C to the capture pipeline, and these two files are not in it. The expansion is small (two render sites, one shared helper that already exists at `lib/ai/wrap-evidence.ts:83-111`) and is justified by Track C being the thing that makes the gap dangerous. **If the founder prefers, this descopes cleanly to a separate hardening session** — in which case the residual is recorded as accepted and `LEARN-PATTERN-RENDER-GUARDED` moves with it. The ADR states the choice rather than making it silently. Note this changes **no output** for input that was already safe — it is a guard, not a behaviour change, so L-1's "no change to generation behaviour" is not violated.
>
> **[Session 25-D correction, NIT-2]** C2.1's commit message (`be5779e1`) said "all three render sites" —
> it inherited this section's stale citation at the time it was written. The commit message is history and
> is not rewritten. The work itself was correct and complete: it guarded both real sites
> (`post-generation.ts`, `post-regeneration.ts`) and touched no other file — see §I2 in the Session 25
> Reviewer's report ("exemplary scope discipline... no opportunistic sweep"). Only the ADR's own citation,
> corrected above, and the commit message's count were wrong; the guard coverage was never incomplete.
>
> **Consolidating the five duplicated `sanitizeDataField` copies is explicitly NOT in scope** (`[sec-LOW-3]`) — those fields already carry *some* guard; the urgency is specific to the newly-unguarded `topContent` path. Named as a fast-follow (§15).

---

## 11. Surfacing (Q8)

**Decision: pipeline-only. Track C ships no user-facing surface.**

The plan doc's Phase B lists no UI; §8's decision (a) needs none; and an approve-a-suggestion flow depends on the deferred voice-suggestion store. Shipping a panel here would also couple a design surface to a migration-heavy Builder track — the phase-isolation risk ADR 0017 §10 named when it deferred its own high-touch UI.

**Loser: a read-only "what SOSH has learned" panel now.** This is a **real product need**, not a nicety — the stated moat is *"explainable suggestions sourced to that memory, not generic LLM judgment"* (`intelligence-layer §5`, line 221), and memory nobody can see is memory nobody trusts. It is deferred, not dismissed, because it belongs with the Mode 1 Studio diff renderer and Session 24-UI's deferred surfaces, which need the same components and the same design-led treatment (`impeccable` + `taste-skill`).

**Follow-on named: Session 26-UI — the "Learned patterns" panel**, shipped with or after Mode 1 Studio. When it is built it takes the full CLAUDE.md UI obligation: Server Component page + Client form split, Zod-validated Server Actions, i18n **en/pt/es simultaneously**, shadcn v4 / Base UI.

**How a founder verifies in production that the loop is actually learning** — required, because a pipeline whose only output is invisible rows is unverifiable, and this track's whole value is that it compounds silently:

1. **The canonical tick log** (§9.5) — `kind: 'learning.tick'` in Vercel logs, with `claimed / classified / patternsUpserted / promoted / demoted / skippedNoSnapshot`. One grep. A loop running but learning nothing shows `claimed > 0, patternsUpserted = 0`; a loop not running shows nothing at all; a loop starved of snapshots shows a high `skippedNoSnapshot`.
2. **`scripts/learning-report.ts`** (the repo's `/scripts` one-off convention) — per business: signals by class, the top `pattern_key`s with `observation_count` / `confidence` / `status`, and how many have reached `active`.
3. **The Sentry monitor `capture-learning`** via `Sentry.withMonitor` — alerts on a missed or failing tick, so a silently dead loop surfaces without anyone thinking to look.

---

## 12. Test plan mapped to the three tiers (ADR 0015 §2)

**Tier 1 — DB-behaviour (`supabase/__tests__/*`, live Postgres, `db-tests.yml`):**

- `post_ai_originals` write-once: any `UPDATE` rejected by the trigger (`LEARN-SNAPSHOT-WRITE-ONCE`).
- **Cascade / erasure SUCCEEDS**: deleting a business with `post_ai_originals` + `post_edit_signals` rows completes **without error** and purges them. Asserting *success*, not merely absence — the `[db-BLOCKER-1]` failure mode was erasure **denial** (`LEARN-CASCADE-COMPLETE`).
- RLS on both new tables: cross-tenant SELECT/INSERT/UPDATE/DELETE denied, `USING` **and** `WITH CHECK` proven, not assumed (`LEARN-RLS-ISOLATED`). A mocked client or a `pg_policies` read is **not** coverage (ADR 0015 §2).
- The capture trigger fires on a **raw `UPDATE posts SET status='approved'`** issued by no application code — the proof of `LEARN-CAPTURE-ALL-CALLERS`; does **not** fire on other `posts` UPDATEs; and **skips** a post with no snapshot without failing the UPDATE (`LEARN-CAPTURE-AT-TRANSITION`).
- `UNIQUE (post_id, ai_original_id)` rejects a duplicate; re-approval refreshes a `pending` row and does not touch a `processed` one (`LEARN-TICK-IDEMPOTENT`).
- `claim_post_edit_signals` returns disjoint sets under concurrent calls.
- The atomic promotion UPDATE promotes exactly once under concurrency; demotion likewise (`LEARN-PROMOTION-THRESHOLD`).
- `pattern_key` CHECK + the partial UNIQUE index dedupe distilled rows; a NULL `pattern_key` distilled insert is rejected.
- **`LEARN-VOICE-WRITE-TRIGGER`**: an INSERT of a `dimension='format'` distilled row sourced from a `class='correction'` signal is **rejected by the DB**.

**Tier 2 — app-layer (`lib/**`, `app/**` `*.test.ts(x)`, `app-tests.yml`, every push/PR):**

- The classifier: a case table across all twelve signal kinds; **determinism** — the same fixture pair twice yields byte-identical output (`LEARN-CLASSIFY-DETERMINISTIC`); **no LLM client is constructed on this path** (`LEARN-HEURISTIC-FIRST`).
- The correction rule: `unsourced_claim_removed` fires only against a frozen brief with a non-empty pinned set; a post with no brief yields `inconclusive`, never `correction` (`LEARN-CORRECTION-REQUIRES-BRIEF`).
- The split: the partitioned return; the rehydration choke point's runtime `.literal()` guard; **a `@ts-expect-error` compile-time assertion that passing `corrections` to the voice writer does not compile** (`LEARN-CORRECTION-PREFERENCE-ENFORCED`).
- Threshold arithmetic: 4 observations does not promote; 5 across 1 campaign does not promote; 5 across 2 campaigns does; a contradiction lowers confidence; `net < 3` demotes an `active` row (`LEARN-NO-SINGLE-DIFF-PROMOTION`, `LEARN-PROMOTION-THRESHOLD`).
- Tick outcomes: claimed / classified / skipped / failed / abandoned counters; the transient-vs-permanent branch; unknown `schema_version` → permanent abandon; **a replayed tick — run twice over one fixture, assert every second-run counter is zero and every `performance_memory` row byte-identical** (`LEARN-TICK-IDEMPOTENT`).
- The summarizer: each gate independently suppresses the call; input is `neutralize()`-wrapped and truncated at the cap; the bounded output schema rejects an over-long or over-count response (`LEARN-SUMMARY-DATA-GUARDED`); the monthly ceiling blocks the call.
- The two §10.4 render sites ([Session 25-D correction, NIT-2] corrected from a miscounted "three" — the ADR's own former citation of a third site that renders no `topContent` at all) guard `topContent` — a `[/DATA]`-bearing, fence-bearing pattern is neutralised at each (`LEARN-PATTERN-RENDER-GUARDED`).
- Business scoping: one business's signals cannot produce another business's memory row (§10.3).
- The memory write goes through `lib/db/memory-performance.ts` and **omits** `likes` / `impressions`.
- **The enumerated approval callers** (§3.4): each of the six caller rows exercised in its named test file, asserting a signal row results. **SHARED-FUNCTION CALLERS** applies to `approvePost`, `bulkApproveDraftPosts` and `createPosts`; the Builder `git grep`s all three and lists, per caller, the covering test **before** marking any constraint tested. A caller with no listed test is `AUTHORED-NOT-EXECUTED` for that caller even if another is fully covered.

**Tier 3 — diff-verified (properties of absence, enumerated AS SUCH so "no test" is a recorded decision):**

- The two §D2.5 cascade rows exist in `0010-legal-surface.md` (paired with the Tier-1 erasure test).
- No `*_voice_memory` table migration exists — extending ADR 0016's existing Tier-3 check (`LEARN-VOICE-NOT-AUTO-MUTATED`, structural half).
- No new dependency in `package.json` (L-13).
- No Tier-2 and no Tier-3 agentic loop introduced anywhere in this track (L-10).
- Track C ships **no route** under `app/[locale]/(dashboard)` and **no new i18n keys** — the recorded form of §11's pipeline-only decision.
- `LEARN-BRIEF-DIFF-DEFERRED`: no `campaign_brief_revisions` table exists.
- `LEARN-MEMORY-THROUGH-BOUNDARY` (grep half): the two new tables and `performance_memory` are queried only inside `lib/db/` + `lib/memory/`.
- **[Session 25-D correction, MINOR-1]** `rehydrateSignals()` (`lib/learning/rehydrate.ts`, `[type-5]`'s named choke point) has **no production reader today** — `git grep rehydrateSignals` matches only its own file and its own test. `PostEditSignalRow.signals` is typed `Record<string, unknown> | null` (`lib/db/types.ts:839`), which means nothing in the type system stops a future reader from writing `row.signals as unknown as ClassifyResult` directly, bypassing the choke point entirely with zero compiler complaint — "MUST route through `rehydrateSignals()`" is, today, a comment, not an enforced constraint. This is recorded here **by decision, not oversight**: this track deliberately does not ship a production reader of persisted `signals` (no reader was in scope for Track C), so inventing one now would be scope creep. **`rehydrateSignals()` is the MANDATORY entry point the day a production reader is added** — the next session that reads `post_edit_signals.signals` back into a `ClassifyResult` MUST route through it, and a reviewer of that session should treat any direct cast as a regression, not rediscover this by grep.

---

## 13. Constraint table (the Reviewer's checklist)

| Constraint | Agency tier | Test tier | Test that proves it |
|---|---|---|---|
| **LEARN-SNAPSHOT-SEPARATE** | 0 | 1 + 3 | `post_ai_originals` exists as its own table; no `ai_original` column on `posts`; `PostUpdate` unchanged |
| **LEARN-SNAPSHOT-WRITE-ONCE** | 0 | 1 | any `UPDATE` on `post_ai_originals` rejected by the `BEFORE UPDATE` trigger; **DELETE deliberately not guarded** (§2.5) |
| **LEARN-CAPTURE-AT-TRANSITION** | 0 | 1 | trigger fires on `draft→approved` only; skips snapshot-less posts without failing the UPDATE |
| **LEARN-CAPTURE-ALL-CALLERS** | 0 | 1 + 2 | Tier-1: raw `UPDATE` from no app code enqueues. Tier-2: all six §3.4 caller rows, one test file each |
| **LEARN-MODE-AGNOSTIC** | 0 | 1 | capture keys off the transition, never `campaigns.origin`; proven by the raw-UPDATE test |
| **LEARN-HEURISTIC-FIRST** | 0 | 2 | no LLM client constructed on the per-post classify path; twelve-kind case table |
| **LEARN-CLASSIFY-DETERMINISTIC** | 0 | 2 | the same fixture pair twice → byte-identical output |
| **LEARN-CORRECTION-REQUIRES-BRIEF** | 0 | 2 | no frozen brief / empty pinned set → `inconclusive`, never `correction` |
| **LEARN-CORRECTION-PREFERENCE-ENFORCED** | 0 | 1 + 2 | Tier-2: partitioned return + `@ts-expect-error` compile assertion + rehydration guard. **Tier-1: the trigger below** |
| **LEARN-VOICE-WRITE-TRIGGER** | 0 | 1 | DB rejects a `dimension='format'` distilled write sourced from a `class='correction'` signal |
| **LEARN-NO-SINGLE-DIFF-PROMOTION** | 0 | 2 | one diff never yields an `active` row; retrieval returns `active` only |
| **LEARN-PROMOTION-THRESHOLD** | 0 | 1 + 2 | Tier-2: the 5 / 0.70 / 2 arithmetic incl. contradiction + demotion at the boundary. Tier-1: the atomic UPDATE under concurrency |
| **LEARN-TICK-IDEMPOTENT** | 0 | 1 + 2 | Tier-1: UNIQUE rejects duplicates; claim RPC disjoint under concurrency. Tier-2: a replayed tick changes nothing |
| **LEARN-MEMORY-THROUGH-BOUNDARY** | 0 | 2 + 3 | Tier-2 (Session 25-D, MINOR-2): `lib/learning/memory-table-boundary.test.ts` — source scan over `lib/learning/**` + `app/api/cron/capture-learning/**` asserts no `.from('performance_memory'\|'post_ai_originals'\|'post_edit_signals')`, executed in `app-tests.yml`. Tier-3: the two new tables and `performance_memory` are queried only inside `lib/db/` + `lib/memory/` |
| **LEARN-SUMMARY-DATA-GUARDED** | 1 | 2 | input `neutralize()`-wrapped + truncated at the cap; bounded output schema rejects over-long/over-count |
| **LEARN-PATTERN-RENDER-GUARDED** | 0 | 2 | both §10.4 render sites route `topContent` through `neutralize()` |
| **LEARN-VOICE-NOT-AUTO-MUTATED** | 0 | 2 + 3 | Tier-2 (Session 25-D, MINOR-2): the SAME `lib/learning/memory-table-boundary.test.ts` scan also asserts no `.from('brand_voice…')` in that same file set, executed in `app-tests.yml`. Tier-3: no voice-memory migration |
| **LEARN-RLS-ISOLATED** | 0 | 1 | cross-tenant CRUD denied on both new tables, live Postgres, `USING` + `WITH CHECK` |
| **LEARN-CASCADE-COMPLETE** | 0 | 1 + 3 | Tier-1: business delete **succeeds** and purges both tables. Tier-3: two §D2.5 rows present |
| **LEARN-BRIEF-DIFF-DEFERRED** | — | 3 | deferred by decision — no `campaign_brief_revisions` table; un-defer recorded (§3.5) |
| **LEARN-VOICE-SUGGESTION-DEFERRED** | — | 3 | deferred by decision — no suggestion surface (§8, §11) |

**21 `LEARN-*` constraints.** Every Tier-1/Tier-2 constraint maps to a test **and** to the CI job that executes it (Tier-1 → `db-tests`, Tier-2 → `app-tests`). A constraint with a test but no executing job is a defect; one with neither is `AUTHORED-NOT-EXECUTED` (ADR 0015 §2). "Covered" means **executed green in CI**, never "authored."

---

## 14. Consolidated advisory findings (disposition)

| Finding | Source | Disposition |
|---|---|---|
| **BLOCKER-1** `BEFORE UPDATE OR DELETE` trigger blocks the FK cascade and breaks `purge_business` / GDPR erasure | db + sec (independently) | **Adopted** — trigger scoped to `BEFORE UPDATE` only; app-layer immutability via RLS with no authenticated DELETE policy (§2.5, §10.2) |
| **[Session 25-D correction, NIT-5] Q1** a `FOR EACH ROW` trigger fires once per row of a set-based `UPDATE` regardless of what the client sees — confirms the outbox trigger design sidesteps `bulkApproveDraftPosts`'s count-only return shape, ruling out a Loser (inline-in-the-transition capture) | db | **Adopted implicitly** — this finding is what confirmed the outbox/trigger mechanism (§3.1) is correct against a bulk approve, rather than a separate implementation obligation; cited at `[db-Q1]` (§3.1) but never given its own row until this correction |
| **MAJOR-1** enqueue trigger undefined for snapshot-less posts (hard-fails approve, or dissolves dedup) | db | **Adopted** — `ai_original_id NOT NULL` + an explicit skip-and-count branch (§3.2) |
| **MAJOR-2** `pattern_key` needs `CHECK (source <> 'distilled' OR pattern_key IS NOT NULL)` | db | **Adopted** (§7.2) |
| **HIGH-2** `recentPostPerformance.topContent` rendered unguarded at two call sites, weakly at a third — the original finding as raised, quoted verbatim; [Session 25-D correction, NIT-2] one of the "two" sites named in the original finding does not exist at this ADR's implementation range, so only two real sites were ever guarded (§10.4) | sec | **Adopted** → `LEARN-PATTERN-RENDER-GUARDED`, recorded as an L-1 scope expansion with a clean descope path (§10.4) |
| **MEDIUM-1** §D2.5 rows must be annotated as holding customer/third-party content | sec | **Adopted** (§10.1) |
| **MEDIUM-2** same-tenant "content laundering" — a team member shapes drafts a different approver reviews | sec | **Documented as an accepted residual** (§6.3), same posture as ADR 0017 §9 `[sec-LOW-1]` |
| **MEDIUM-3** bounded output schema ≠ render-time neutralisation; must not be conflated | sec | **Adopted** — stated explicitly (§6.4) |
| **Q2** service-role summarizer must scope every read and write to one `business_id` | sec | **Adopted** → §10.3, with a test obligation |
| **LOW-1** add a direct `post_id` FK to `post_ai_originals` | sec | **Adopted** (§2.3) |
| **LOW-2** transition guard belongs in the trigger body, not a `WHEN` clause | sec | **Adopted** (§3.2) |
| **LOW-3** consolidating the five duplicated `sanitizeDataField` copies | sec | **Declined as out of scope** — those fields already carry a guard; named as a fast-follow (§10.4, §15) |
| **Q4** exact index shapes (claim partial, covering `INCLUDE (campaign_id)`, missing FK indexes) | db | **Adopted verbatim** (§3.3) |
| **Q5** `coalesce(platform,'')` is the established idiom; keep it over `NULLS NOT DISTINCT` | db | **Adopted** (§7.2) |
| **Q6** the promotion UPDATE is genuinely atomic; demotion needs the same rigor | db | **Adopted** (§7.3, §7.4) |
| **MINOR-1** regeneration `revision` race needs an explicit `23505` catch-and-retry | db | **Adopted** as an implementation obligation (§2.6) |
| **MINOR-2** no retention policy on the append-only `post_edit_signals` | db | **Recorded as a named gap** for a follow-on retention ADR (§9.6, §15) |
| **MINOR-3** demotion needs the same explicit atomic guard as promotion | db | **Adopted** (§7.4) |
| **NIT-1** use the InitPlan-wrapped RLS form, not the superseded bare form | db | **Adopted** and called out explicitly (§10.1) |
| **NIT-2** document the multi-parent cascade as intentional | db | **Adopted** (§10.1) |
| **type-1** drop "unrepresentable"; use the `FrozenBrief` / Amendment A.2 honest framing | type | **Adopted** (§5.3) |
| **type-2** `_class` is the primary discriminant; disjoint kinds are the fallback | type | **Adopted**, and which is which is recorded (§5.3) |
| **type-3** stay with plain interfaces; a `#private` class breaks house style | type | **Adopted**, rejection recorded rather than silent (§5.3) |
| **type-4** the DB layer must be a trigger, not a service-role `if` — otherwise theatre | type | **Adopted** → `LEARN-VOICE-WRITE-TRIGGER` (§5.3) |
| **type-5** name the rehydration function as the second choke point; guard it at runtime | type | **Adopted** (§5.3) |
| **type-6** add a `@ts-expect-error` compile-time regression test | type | **Adopted** (§5.3, §12) |
| **type-7** the type layer cannot validate that the tag was assigned correctly | type | **Adopted** — stated plainly (§5.4) |
| **cost-1** a single fixed model tier deviates from the skill's routing pattern | cost | **Adopted with the deviation named** (§6.2) |

---

## 15. Deferred to later tracks / phases (boundary on the record)

Explicitly **NOT** built in Track C. A future session must not build these here by mistake (L-1) — if a step appears to need one, that is a **STOP and report**.

- **Mode 1 Studio** — inline-marker suggestions, the deterministic diff renderer, the left/right UI. It reuses this track's capture pipeline for its accept/edit/reject signal and is where a text-diff dependency (`diff-match-patch`) finally earns its place (§4.1). Its own phase (`campaign-modes §2` Phase C).
- **Mode 3** — signal ingestion, candidate scoring, insight cards, the opportunity feed, and the Tier-3 triage loop. **The only Tier-3 in the entire product**, and deferred (`campaign-modes §2` Phase D).
- **`relationship_memory`** — ADR 0016 §3.6; no Phase-1 consumer, waits for the Phase-2 engagement inbox.
- **Embeddings** — ADR 0016 §5.3's un-defer trigger (`EMBEDDINGS_UNDEFER_THRESHOLD = 200`) is **not this track's** and is not tripped by it.
- **The skip-review fast path** — ADR 0017 D-7 / L-11. **This track produces exactly the edit-distance evidence that would later justify it** (`campaign-modes §2` Phase A: *"once brief quality is validated — edit-distance trending down — add a skip-review fast path… Don't build that path before you have the data to justify it"*) — **and still does not build it.** Attempting it here is an L-1 STOP.
- **`MODE2-REDUNDANCY-UNDEFER`** (ADR 0017 §8) — the cross-set redundancy call whose trigger is *"once Track C's edit-distance / manual-review data shows cross-set redundancy surviving the frozen brief."* Track C produces that data; it does not evaluate the trigger or ship the call.
- **Brief-edit diff capture** (`LEARN-BRIEF-DIFF-DEFERRED`, §3.5) — needs `campaign_brief_revisions`, which ADR 0017 §2.1 left to Track C's choice. Track C chooses: not now.
- **The voice-suggestion surface** (`LEARN-VOICE-SUGGESTION-DEFERRED`, §8) — Q6 option (b); needs a UI.
- **A voice-directed governed store** (§8 option (c)) — un-defer trigger: when learned preferences need to reach the *system* prompt rather than the per-call retrieved slice.
- **Any user-facing surface** (§11) — Session 26-UI, the "Learned patterns" panel, with or after Mode 1 Studio.
- **A retention / archival policy for `post_edit_signals`** (§9.6) — a named gap for a follow-on ADR.
- **Full `sanitizeDataField` consolidation** across the five duplicate definitions (§10.4) — a fast-follow, not this track.
- **The numbered-vs-unnumbered thread preference as a *generation* rule** — ADR 0017 §15 assigns it to Track C's diff loop, and Track C captures it as a `numbering_stripped` signal (§4.2). It changes generation only through the ordinary promotion path — **no bespoke rule is added to any template.**
- **Any other change to generation behaviour** — L-1. The only files this track touches in `lib/ai/` are §10.4's two render sites, and only to add a guard that changes no output for input that was already safe.
- **[Session 25-D correction, MINOR-11] A length cap on `topContent` at the §10.4 render sites** (`lib/ai/prompts/post-generation.ts`, `post-regeneration.ts`) — both route `topContent` through `neutralize()` (correct — `[sec-HIGH-2]`), but neither truncates, unlike `wrapEvidenceForPrompt`'s `EVIDENCE_MAX_CHARS` and the summarizer's token budget. **Not needed today**: both live writers are bounded by construction — Tier-0's `renderPatternStatement` is a fixed template over an enum-constrained platform (no unbounded input reaches it), and the summarizer's output is capped at 200 characters by its Zod schema (§6.4). **Un-defer trigger:** the FIRST writer that puts a synthesized, unbounded value into `performance_memory.pattern` must enforce its own length bound at write time before that value can reach these render sites. Filed to `docs/backlog.md` (`25D-MINOR-11`) so this is a tracked follow-up rather than re-litigated each review.

---

ADR 0018 written and accepted — 21 LEARN-* constraints, snapshot as **table** (`post_ai_originals`, append-only + revisioned), capture via **outbox** (trigger-enqueued at the `draft→approved` transition), promotion threshold **`observation_count ≥ 5` AND `confidence ≥ 0.70` AND `distinct campaigns ≥ 2`**, voice learning **option (a) — `performance_memory` `dimension ∈ {format, hook}`, no voice table**, surface **deferred** (Session 26-UI).

---

## Amendment A — MAJOR-1 / MAJOR-2 narrowing (Session 25-D correction pass, 2026-07-28)

**Author:** Session 25-D (Claude Code, Sonnet 5), resolving two coupled findings from
`docs/reviews/session-25-reviewer.md` (range `717263d2..d7cee4a5`). §5.3, §6.1, §12 and §13's original text
above are **not edited** — this amendment is additive, per this ADR's own convention (ADR 0016 Amendments
A/B follow the identical pattern). The founder-adjudicated resolution (recorded in
`docs/build-guide/session-25.md` §4) was: **(a) record + narrow — do not make summarizer rows
promotable.**

**MAJOR-1 and MAJOR-2 are one problem, not two**, both consequences of `pattern_key` being simultaneously
the Tier-0 aggregation key, the promotion join key, and the voice-guard join key:

**§5.3 narrowed — `LEARN-VOICE-WRITE-TRIGGER`'s live scope.** The original RAISE text ("must be sourced
entirely from preference-class signals") is false for the rows it was written to police: `canonicalize()`
(`lib/learning/orchestrator.ts:107-123`) sets `pattern_key` **only** on `rowClass = 'preference'`, and
`computeSummaryPatternKey()` (`lib/learning/summarize.ts`) namespaces its key `summarize:<dimension>:<hash>`
so it never matches any `post_edit_signals.pattern_key` — both shipped Track-C writers construct rows the
trigger's `EXISTS` join can never match. The trigger is **not** dead: it is enforcement for write paths this
ADR did not build — a future promotion job, a manual backfill script, or an ad-hoc query that writes
`performance_memory` directly with a hand-picked `pattern_key` colliding with a real, non-preference-classed
`post_edit_signals` row. `supabase/migrations/20260728190000_narrow_voice_write_trigger_message.sql`
replaces only the RAISE message and comments (via `CREATE OR REPLACE FUNCTION`, no logic change) to state
this scope instead of the disproven one. Tier-1 proof both ways, on the record together:
`performance-memory-pattern-key.test.ts`'s "rejects a hook-dimension distilled write sourced from a
correction-class signal" test proves the trigger fires when **handed** such a row directly; this amendment
records that the shipped pipeline cannot **produce** one.

**Query-layer half closed as a real code fix, not just documentation.** `listRecentHumanEditExcerpts`
(`lib/db/post-edit-signals.ts`) now filters `.eq('class', 'preference')` — correction- and
inconclusive-classed human copy (grounding fixes, not taste) no longer enters the summarizer's input at all,
regardless of what the trigger can or cannot see downstream. This is the one genuine behavioural change in
this amendment; everything else here is documentation catching up to what the code already does.

**§6.1 narrowed — summarizer output is permanently candidate-only, by construction, not "no shortcut."**
§6.1's original framing — the summarizer "gets no shortcut into `active`" — understates the property.
`promote_performance_pattern`'s third gate (`20260726030000_performance_memory_promotion.sql:118-127`)
counts `post_edit_signals` rows matching `p_pattern_key`; a `summarize:`-namespaced key matches **zero**
such rows by construction (the same property that keeps it from colliding with a Tier-0 key), so that gate
is `0 >= 2`, always false. **A summarizer row cannot reach `status='active'` at any volume, for any
duration.** This is now stated explicitly in `lib/learning/summarize.ts`'s upsert-site comment (Session
25-D) and here: it is **intended**, not a residual gap, and summarizer rows are read back only by
`listDistilledPatternsForSummary` — never by `listPerformanceMemoryCandidates` (which filters
`status='active'`), so no summarizer statement can influence a generation prompt.

**§12 Tier-3 addition** — one property, diff-verified rather than runtime-tested, added to the existing
Tier-3 list: **summarizer rows are structurally unpromotable.** No test asserts promotion of a
`summarize:`-keyed row succeeds (there is no such test, by decision, because the property being tested is
its permanent absence) — confirmed instead by inspection of `promote_performance_pattern`'s campaign-gate
subquery against `computeSummaryPatternKey`'s namespace, per the reasoning above. A future session that adds
a summarizer-side campaign count (option (b), explicitly **declined** here) would need to remove this
Tier-3 entry and add a Tier-1/Tier-2 test in its place.

**Evidence:** `lib/db/post-edit-signals.ts` (MAJOR-1 code fix); `lib/db/post-edit-signals.test.ts` (Tier-2
test, reddens with the `.eq` removed — verified); `lib/learning/summarize.ts:144-159` (MAJOR-2 comment);
`supabase/migrations/20260728190000_narrow_voice_write_trigger_message.sql` (RAISE text/comment only);
`supabase/__tests__/performance-memory-pattern-key.test.ts` (new hook-dimension/correction-class Tier-1
test); `docs/reviews/session-25-reviewer.md` MAJOR-1, MAJOR-2.

---

## Amendment B — §13 Tier-2 mapping closed for #14/#17 (Session 25-D correction pass, 2026-07-28)

**Author:** Session 25-D (Claude Code, Sonnet 5), closing `docs/reviews/session-25-reviewer.md` MINOR-2.
§13's table cells for `LEARN-MEMORY-THROUGH-BOUNDARY` and `LEARN-VOICE-NOT-AUTO-MUTATED` are edited
in place (not appended around) because the table's own stated purpose is to be a live, current
constraint→test map — unlike §5.3/§6.1's narrative decision text, a stale table cell is simply wrong, not
a historical claim worth preserving verbatim. This amendment records why the edit happened and when.

**What changed:** both constraints previously read "Tier 2 + 3" with only a Tier-3 grep description — true
today, per the Reviewer, only by inspection: `promote.test.ts` and `orchestrator.test.ts` mock
`lib/db/memory-performance.ts`'s exports, so neither would catch a direct `.from('performance_memory')` (or
`'post_ai_originals'` / `'post_edit_signals'` / `'brand_voice…'`) added anywhere in `lib/learning/**` or the
`capture-learning` cron route. `lib/learning/memory-table-boundary.test.ts` (new, Session 25-D) closes both
halves with one source-scan test — the same technique `classify.test.ts`'s `LEARN-HEURISTIC-FIRST` check
already uses — executed in `app-tests.yml`. Manually confirmed to redden: injecting a
`.from('performance_memory')` call into `lib/learning/orchestrator.ts` and re-running the test failed it;
reverting restored green.

**Result:** all 21 `LEARN-*` constraints in §13 now map to an executing test in a named CI job — no
"unmapped" cell remains.

**Evidence:** `lib/learning/memory-table-boundary.test.ts`; `docs/reviews/session-25-reviewer.md` MINOR-2,
CORRECTION PASS D3.

---

## Amendment C — §9.4's failure-taxonomy prose corrected to match the schema as applied (Session 25-D
correction pass, 2026-07-28)

**Author:** Session 25-D (Claude Code, Sonnet 5), closing `docs/reviews/session-25-reviewer.md` MINOR-5.
§9.4's original prose above is **not edited** — this amendment is additive, per this ADR's own convention.

**What was wrong:** §9.4 states a transient failure moves to `→ status='failed'` with backoff, retried up
to `LEARNING_MAX_ATTEMPTS`, then `abandoned`. Under the schema **as actually applied**, this is false:
`claim_post_edit_signals` (`20260726010000_learning_capture.sql:231-246`) claims ONLY `status='pending'` —
unlike its sibling `claim_deletion_requests`, it has no `OR (status='failed' AND attempts < max)` reclaim
clause. A row genuinely parked at `'failed'` would never be claimed again, silently losing the retry this
prose promises.

**Resolution: option (i), preferred by the Reviewer over adding a reclaim clause.** Rather than build a
migration to service a state the orchestrator never actually uses, `'failed'` is removed from
`LEGAL_TRANSITIONS`' reachable targets entirely (`lib/db/post-edit-signals.ts`) — no code path can
transition a row into or out of `'failed'` anymore. This makes the schema (as enforced by the app-layer
transition guard) and this prose agree, and removes the trap (a future writer parking a row at `'failed'`
expecting reclaim) rather than leaving it in place to be serviced later. `'failed'` remains a legal DB
value — the table's `CHECK` constraint is unchanged, no migration was needed for an app-layer guard — it is
simply unreachable through any transition this codebase performs.

**Corrected prose** (§9.4's transient bullet, restated — the original bullet above is not itself edited):
*Transient — Anthropic 429/5xx/network, Postgres serialization `40001`. → `status='pending'` with
`next_attempt_at` set by exponential backoff + jitter (reclaimable by `claim_post_edit_signals`'s existing
`status='pending'` predicate, no reclaim clause needed), retried up to `LEARNING_MAX_ATTEMPTS`, then
`abandoned`.* Permanent's bullet is unaffected by this correction.

**Evidence:** `lib/db/post-edit-signals.ts` (`LEGAL_TRANSITIONS`); `lib/db/post-edit-signals.test.ts` (new
"throws on illegal transition: processing → failed" test); `docs/reviews/session-25-reviewer.md` MINOR-5,
CORRECTION PASS D5.

---

## Amendment D — Session 25-D correction pass, consolidated index (2026-07-29)

**Author:** Session 25-D (Claude Code, Sonnet 5), step D7 (documentation finalisation, no `.ts`/`.sql`
changed). This amendment does not introduce new content — it is a single index pointing to everything the
correction pass changed across this ADR, so a reader does not have to reconstruct the map from six separate
git diffs. Amendments A, B, and C above, and the inline additions below, are each unedited by this entry.

| Area | What changed | Where | Step |
|---|---|---|---|
| §5.3 — `LEARN-VOICE-WRITE-TRIGGER`'s live scope | Narrowed from "must be sourced entirely from preference-class signals" (disproven — the shipped pipeline cannot produce a matching row) to "rejects a shape this pipeline cannot construct; live scope is other write paths" | **Amendment A** | D1 |
| §6.1 — summarizer output promotability | Narrowed from "no shortcut into active" to "no path whatsoever" — permanently candidate-only, by construction, not merely by convention | **Amendment A** | D1 |
| §7.4 — demotion rigor vs. promotion | `[db-MINOR-3]`'s "same rigor as promotion" is now literally true: `demote_performance_pattern` recomputes its own contradiction count via a correlated subquery (was: caller-trusted `p_net`) | inline, §7.4's own text (see `20260728220000_demote_recomputes_contradictions.sql`) — no lettered amendment, since this changed the migration/function directly rather than correcting prose | D5 |
| §9.4 — failure-taxonomy prose | Corrected `→ status='failed'` (disproven — `claim_post_edit_signals` never reclaims `'failed'`) to `→ status='pending'`, matching `LEGAL_TRANSITIONS` as applied | **Amendment C** | D5 |
| §12 Tier-3 — `rehydrateSignals()` | New entry: no production reader exists yet; mandatory entry point when one is added | inline addition to §12's existing Tier-3 list | D6 |
| §12 Tier-3 — summarizer unpromotability | New entry: no test asserts promotion of a `summarize:`-keyed row succeeds, by decision | **Amendment A** | D1 |
| §13 — constraint→test mapping | `#14`/`#17` (`LEARN-MEMORY-THROUGH-BOUNDARY` / `LEARN-VOICE-NOT-AUTO-MUTATED`) closed from unmapped to `lib/learning/memory-table-boundary.test.ts` — **19 of 21 → 21 of 21** | **Amendment B** | D3 |
| §14 — disposition table | Missing 28th row (`[db-Q1]`, cited inline at §3.1 but never tabled) added — 27 rows → 28, now matching `docs/build-guide/session-25.md`'s "28 advisory findings" prose | inline addition to §14's table | D6 |
| §15 — deferred/tracked follow-ups | New bullet: `topContent` length cap at the two §10.4 render sites, triggered on the first synthesized-unbounded `performance_memory.pattern` writer; mirrored in `docs/backlog.md` (`25D-MINOR-11`) | inline addition to §15's list | D6 |
| §0/Q4, §4.2, §4.3, §12, §13 | "Eleven" Tier-0 signal kinds corrected to twelve (9 preference + 1 correction + 2 inconclusive) throughout | inline corrections at each site | D6 |
| §10.4 | Phantom third render site (`formats/native-generation-prompt.ts`, renders no `topContent`) removed from the citation table and three sibling references (§12, §13, §15) that had gone stale when §10.4 itself was first corrected | inline corrections at each site | D6 |
| §3.4 (this file's own caller table is separate from the Reviewer's §1 tables) | Four `file:line` citations re-derived and corrected at the current commit; one false test-file citation removed | inline correction to the §3.4 table | D6 |

**No new table, no new migration beyond `20260728220000_demote_recomputes_contradictions.sql` (D5), no
behaviour change to generation.** The full narrative for each row is in its cited Amendment or inline
location above; the full narrative for *why* each change was made is in
`docs/reviews/session-25-reviewer.md`'s `## CORRECTION PASS (Session 25-D)` section, D1 through D7.

**Evidence:** `docs/reviews/session-25-reviewer.md` CORRECTION PASS, D0–D7 (SHAs `052c48fc` through
`aabe6152`, D7 pending its own commit at the time this amendment was written).

---

## Amendment A — Promote-to-campaign's learning surface (2026-08-21)

**Author:** Session 29 Track F Architect (F1a). **Amending ADR:** `0022-promote-to-campaign-and-format-families.md`.
**Authority:** build guide `docs/build-guide/session-29.md` §0 L-5, L-6 and §0.2 rulings **A-1** and **A-5**,
adjudicated by the founder 2026-08-21. **Form:** ADR 0014 Amendment A / ADR 0010 Amendment 2 house form.

**Everything above this line is unchanged.** This amendment is **additive**: it widens one CHECK, bounds one
column, and strengthens one guard. It rewrites no decision in the original ADR, and it retracts nothing.

**Why here and not in ADR 0022.** All three changes are to objects **this ADR owns** — its CHECK, its column,
its writer, its RPC. A future reader asking *"why does `performance_memory.pattern` have a length CHECK?"*
opens ADR 0018, because the column is ADR 0018's. ADR 0022 records the promote decision and **cites** this
amendment; no fact is stated in both places.

### A.1 — `post_ai_originals.generation_kind` gains a third value (L-6)

**Change.** The CHECK at `supabase/migrations/20260726010000_learning_capture.sql:34` —
`generation_kind text NOT NULL CHECK (generation_kind IN ('initial', 'regeneration'))` — widens to admit
**`'studio_promoted'`**.

**Additive, and no backfill.** Widening a CHECK cannot invalidate an existing row: every extant row is
`'initial'` or `'regeneration'` and satisfies the wider constraint. Stated explicitly because Session 29 L-12
requires an additive migration to carry an explicit backfill statement, and *"none, and here is why"* is that
statement.

**Its caller now exists.** ADR 0019 §2.6 named and specified this amendment and deferred it under founder
ruling A-3 on the sole ground that *"Track D has no promote step, so the amendment has no caller."* Session 29
Track F1 is that caller. **The deferral is discharged, not overridden** — its stated condition no longer holds.

**A correction to a claim in ADR 0019, verified rather than quoted.** ADR 0019 §2.6 and §15 state that at
promote *"the existing trigger does the rest, unchanged."* Verified against the shipped migration, that is
**half true, and the load-bearing half is false**:

- **True:** `enqueue_post_edit_signal()` is `AFTER UPDATE ON posts` with no `WHEN` clause (`:224-226`) and
  requires no modification whatsoever.
- **False:** it **only reads** the latest snapshot (`:199-203`). **No trigger anywhere writes
  `post_ai_originals`.** `generation_kind` is supplied by application code at exactly two sites —
  `lib/campaigns/generate.ts:407` (`'initial'`) and
  `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:363` (`'regeneration'`).

**Promote therefore writes its own snapshot row**, following `createPostAiOriginal`'s existing shape
(`lib/campaigns/generate.ts:400-414`). Recorded as a correction to a landed ADR rather than silently absorbed.

**What is snapshotted, and the condition under which nothing is (A-1).** The row's `payload` /
`rendered_content` is the **accepted-suggestion revision** — model-generated text the human endorsed — **not**
the human's raw draft. This matters because `database-reviewer` and `security-reviewer` **independently**
recommended writing no snapshot at all, on the correct ground that this table's own comment (`:4-5`) defines it
as an *"immutable snapshot of what the model generated"* and that a **fabricated** original would make the
classifier diff human text against human text wearing an AI label, synthesizing a phantom pattern into
`performance_memory` — corrupting the corpus this ADR exists to keep clean. Their objection was to
**fabrication**, and it is accepted in full.

> **Binding corollary.** A snapshot is written **if and only if a genuine model-generated baseline exists.**
> When a draft carries no accepted revision — the human wrote it and promoted it without accepting any
> suggestion — promote writes **no `post_ai_originals` row**, and the trigger's existing skip path at
> `:205-207` applies exactly as designed: *"a snapshot-less post … must NOT fail the approve — just skip."*
> Nothing about that path changes.

*(Retrievability note: `studio_drafts` merges the accepted revision into `content` and does not retain it
separately, so ADR 0019 §2.6's plan was **not implementable as written**. ADR 0019 Amendment A adds the
retaining column. Recorded here because this amendment depends on it.)*

**What the classifier does with the new value.** It processes the row normally. Recorded, so no future reader
mistakes it for equivalence, that **the measurement differs**: for `'initial'`/`'regeneration'` the baseline is
AI-authored and the diff measures *a human correcting a machine*; for `'studio_promoted'` the baseline is *an
AI suggestion the human had already accepted*, so the diff measures the human deviating from advice they
endorsed. Both are valid signals; the second is arguably cleaner. **No promotion gate, threshold or
`pattern_key` rule changes.**

**Loser: reusing `'initial'`** — it erases exactly this distinction and leaves the learning loop unable to tell
a human baseline from a machine one.

### A.2 — `performance_memory.pattern` gains a write-time length bound (L-5)

**Change.** `pattern` is bounded at **500 characters**, enforced by a **CHECK constraint** added `NOT VALID`
then `VALIDATE`d as a separate statement — the precedent being `campaigns_origin_check` itself
(`20260722190000_mode2_brief_and_roles.sql:112-118`) — with a Zod bound at
`upsertDistilledPerformancePattern` (`lib/db/memory-performance.ts:95-114`) in front of it.

**This discharges an obligation this codebase wrote down and then carried unmet for three sessions.** The
comment at `lib/ai/prompts/post-generation.ts:167-178` states it in its own words: *"Once Track C's
distillation writer populates performance_memory.pattern (also an unbounded text column) with synthesized, not
platform-constrained, values, THAT writer must enforce its own length bound at write time — neutralize() was
never designed to bound length, only to defuse injection primitives."* ADR 0016 §15 and ADR 0019 §15 item 10
both carried it forward. Session 29 L-5 removes the option to defer it again.

**The arithmetic.** `topContent` renders at `post-generation.ts:179` under `PERFORMANCE_CAP = 3`. Today's live
source is real `posts.content`, bounded by the manual-edit path's `z.string().max(5000)` — a tolerated worst
case of approximately 3 x 5,000 = 15,000 chars, roughly 3,750 tokens in one prompt section. A distilled pattern
is a synthesized sentence or two, not a post: **3 x 500 = 1,500 chars, roughly 375 tokens** — an order of
magnitude below what is already tolerated.

**Where, and why not elsewhere.** The RPC `upsert_distilled_performance_pattern`
(`20260726030000_performance_memory_promotion.sql:39-72`) is `SECURITY DEFINER`, granted only to `service_role`
(`:74-75`), and is the **last chokepoint before the value becomes durable and indefinitely re-renderable** — a
pattern persists up to 90 days (`expires_at`, `:61`) and renders into *every* subsequent generation for that
business until it decays. It is also the only place a **future second writer cannot bypass**, and that writer
already exists in embryo: `recomputeAndUpsertPattern` (`lib/db/memory-performance.ts:52`) calls the same RPC
**without passing through the summarizer**. A bound placed only at the summarizer is silently void the day it
goes live. The promoter-level bound is **input hygiene**; the RPC's is a **durable-storage invariant** — two
different guarantees at two boundaries, which is the defence-in-depth posture this ADR already adopts at
`memory-performance.ts:135-139`, not redundancy.

**Overflow behaviour: REJECT, never truncate.** The value renders under the section header *"Top-Performing
Post Snippets (use for tone calibration)"* — **an instruction to imitate**. A statement cut mid-clause becomes,
to the model, a complete stylistic instruction it has no signal to distrust; there is no truncation marker on
this path (`TRUNCATION_SUFFIX` exists in `wrap-evidence.ts` for evidence, and `post-generation.ts:179` has no
truncation logic at all). Rejection also matches house policy: ADR 0019 founder ruling A-6 settled the sibling
case as *"REFUSE input over the authoritative, derived cap outright"* (`lib/studio/guard.ts:106-108`).

**Operational requirement.** The distillation worker handles a rejected item **per item** — log and skip that
pattern — and **must not fail the whole batch**. Whether the shipped tick loop already does this is recorded as
a stated-open item in ADR 0022 §16.3.

**Existing rows.** `VALIDATE` **must not be the discovery mechanism** — a failure there is a full-table scan
that aborts a deploy with a bare Postgres error rather than a legible report. This ADR's *"ships EMPTY"* note
(`20260719010000_governed_memory.sql:200-203`) **predates Track C**, which is live and writes through
`lib/learning/promote.ts:122` and `lib/learning/summarize.ts:150`; the table can no longer be assumed empty.
`SELECT count(*) FROM performance_memory WHERE length(pattern) > 500;` runs first, read-only and unlocked, and
its result is recorded before the migration is written (ADR 0022 §16.1).

### A.3 — `neutralizeWithSentinels` at the writer boundary (A-5)

**Change.** Any `pattern` value whose provenance chain touches human-authored text is guarded with
`neutralizeWithSentinels` (`lib/ai/wrap-evidence.ts:118-132`), not plain `neutralize()`.

**The gap this closes, which the length bound does not.** ADR 0019 §5.5 built the wider guard **precisely
because** plain `neutralize()`'s `\p{Cf}`-only strip (`:84-93`) was judged insufficient — it misses `\p{Co}`
(private-use sentinels), `\p{Cs}` (lone surrogates) and variation selectors, a gap stated in-code at
`:108-115`. But `guardStudioField` (`lib/studio/guard.ts:83-129`) runs **only at Studio's suggest-time sink**;
`saveStudioDraftAction` validates with a bare `z.string()`
(`app/[locale]/(dashboard)/studio/actions.ts:296`), so **manually-saved content — exactly what promote reads —
is never guarded at all**. And this ADR's own second sink (`performance_memory` → `post-generation.ts:179`)
routes through the **weaker** `neutralize()`, chosen before ADR 0019 §5.5's standard existed.

**Honest severity, stated so it is neither inflated nor buried.** `security-reviewer` traced the full read side
and confirms **no cross-tenant path exists**: `listPerformanceMemoryCandidates`
(`lib/db/memory-performance.ts:11-35`), `retrieveRelevant` (`lib/memory/performance.ts:45-56`) and all three
RPCs (`20260726030000:63`, `:114`, `:158`) key on `business_id` with no widening branch, and
`enqueue_post_edit_signal` copies `NEW.business_id` verbatim (`20260726010000_learning_capture.sql:211`).
**This is SAME-TENANT self-poisoning and a cost concern — not a tenancy breach and not an exfiltration
finding. MEDIUM once promote lands, unmitigated; no action needed before then.**

**Loser:** documenting the residual as an accepted carve-out, in the manner of `wrap-evidence.ts:54-59`'s
Unicode-confusables note. Declined — the wider guard already exists and the cost of calling it is one function
swap.

### A.4 — What this amendment does NOT change

Stated explicitly, because an amendment's silence is not evidence:

- **No change to the classifier's logic**, its correction-vs-preference split, or its Tier-0 heuristics.
- **No change to any promotion gate or threshold**, including `promote_performance_pattern`'s
  `count(DISTINCT campaign_id) >= 2` cross-campaign generality test.
- **No change to `pattern_key`**, to `post_edit_signals`, or to the `enqueue_post_edit_signal` trigger.
- **No new table, no new RPC, no new §D2.5 cascade row** — every object touched is already covered.
- **`LEARN-MODE-AGNOSTIC` remains true as written.** It keys off an AI-authored draft a human approved, never
  off `campaigns.origin`. Track F1 simply produces such an artefact for the first time from Mode 1.

**Evidence:** ADR 0022 §4, §5 and §12.3; `docs/build-guide/session-29.md` §0.2 rulings A-1 and A-5 and Reality
items 13-16. Builder commits pending at the time this amendment was written.
