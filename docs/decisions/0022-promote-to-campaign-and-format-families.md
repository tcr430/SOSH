# ADR 0022 — Promote-to-campaign, the carousel format family, and script as a recommendation field

- **Status:** Accepted
- **Date:** 2026-08-21
- **Track:** F — the second track of the second programme, following Track D (ADR 0019, Mode 1 Studio) and Tracks D2/E (ADRs 0020/0021, Mode 3). It closes the two gaps `docs/brainstorm/plan-vs-implemented-gap-analysis.md` located *inside* Modes 1 and 2, and closes them as decisions rather than as silent overrides of Accepted ADRs. Both were deferred by a named ruling in a landed ADR; neither is a bug.
- **Supersedes / amends:** none superseded outright. **Amends ADR 0018** by CHECK-widening (`post_ai_originals.generation_kind`), by column-bounding (`performance_memory.pattern`) and by guard-strengthening at that writer — ADR 0018 Amendment A. **Amends ADR 0017 §3.1** by value-addition (`campaigns.origin = 'studio_promoted'`) — ADR 0017 Amendment B. **Amends ADR 0019 §2.2** by column-addition (three columns on `studio_drafts`) and **explicitly supersedes ADR 0019's founder ruling A-4** (its refusal of a draft→campaign FK) — ADR 0019 Amendment A. **Amends ADR 0010 Amendment 2 §D2.5:** no new row required — §12.2 states why. **`posts` is not modified in any way.** `lib/ai/runner.ts` is not modified.
- **Source design docs:** `docs/brainstorm/plan-vs-implemented-gap-analysis.md` (the drift this track closes); ADR 0019 §15 item 1 (*"Promote-to-campaign (L-3) — the immediate follow-on"*) and §15 item 10 (the `topContent` write-time bound); ADR 0017 §15 D-6 (carousel/script deferral) and §4 (format families); ADR 0021 §6 (Stage F, the seeding precedent); build guide `docs/build-guide/session-29.md` Reality 1-19 + §0 (Locked L-1..L-12, ledger D-1..D-8) + §0.1 (the eight questions this ADR resolves) + §0.2 (the eight founder adjudications this ADR encodes).
- **Advisory passes folded in (read-only, no code, ONE batch, never re-consulted):** `ecc:code-explorer` (the seam map every `file:line` below is drawn from), `database-reviewer` (Q1/Q2 and Q4's schema instrument), `typescript-reviewer` (Q5/Q6/Q7), `security-reviewer` (Q4 and the promote path's honest severity). Findings are cited inline as `[db-*]`, `[type-*]`, `[sec-*]` and consolidated in §14. **All three changed the design before it was written, and two of them falsified a claim in a landed ADR** — recorded as such in §4.1 and §3.2 rather than quietly corrected.
- **Scope discipline:** this ADR ships **promote-to-campaign, the carousel format family, and script as a recommendation field — and nothing else.** Not the script *format family* (§15.1), not a second signal source (ADR 0023 / Session 30), not any change to Mode 3, not `relationship_memory`, not embeddings, not the skip-review fast path (ADR 0017 L-11), not image generation, not the media editor, and **no change to Mode 2's existing single-post or thread generation behaviour** (§8 makes that testable rather than asserted).

---

## 0. The eight resolved questions (build-guide §0.1 — on the record)

| Q | Decision | Named loser | Tier |
|---|---|---|---|
| **Q1** — what promote produces | `promoteDraftToCampaign(draftId)` creates a campaign (`origin='studio_promoted'`), seeds ADR 0017's brief pipeline **unchanged**, and carries the human's own prose forward as a real `posts` row (§2) | a **pure Stage F mirror** (turns the human's prose into a seed and publishes AI text instead — defeats Mode 1); a **bare post-INSERT with no brief** (one human gate, violates L-2); **extending `BriefAssemblyInput`** (ADR 0021 §6.1's loser, unchanged) | 1 + 2 |
| **Q2** — atomicity, idempotency, failure | a **two-column** claim: `promotion_claimed_at` claimed atomically **before** `createCampaign`, `promoted_campaign_id` written back after (§3) | **read-then-update** (L-4); **copying Stage F's ordering** (Reality 2 names it a hazard, not a pattern); a `status` enum on `studio_drafts` (ADR 0019 §2.2's standing refusal, undisturbed) | 1 |
| **Q3** — the `generation_kind` amendment | additive third value `'studio_promoted'`, written by **application code** (not a trigger), snapshotting the **retained accepted revision** (§4) | a new enum or table (non-additive); deferring again (A-3's "no caller" ground is discharged); **fabricating a snapshot from human text** (corrupts ADR 0018's corpus — §4.2) | 1 + 2 |
| **Q4** — the write-time length bound | **500 characters** on `performance_memory.pattern`, enforced at the **RPC** with a promoter-level Zod bound in front, **rejecting** on overflow (§5) | **truncate at a boundary** (§5.3); bounding at render time; bounding only at the summarizer (a second writer already exists); **refusing the promote** (too blunt); deferring a third time (L-5 removes the option) | 1 + 2 |
| **Q5** — the carousel family | one new union branch with **roles** and its own policy validator; reachable only via a **new required input dimension** so L-10 holds strictly (§6) | a `carousel` flag on the single-post branch (ADR 0017 D-3's argument); **a volume-derived trigger** (§6.3 — changes output for inputs that already exist); model-chosen family; generating images (constitution) | 2 |
| **Q6** — script as a recommendation field | `scriptBrief: string \| null`, on `imageBrief`'s exact footing, never published, proved by a Tier-3 source scan (§7) | a **structured `{hook, beats[], cta}` object** (§7.1 — becomes a format family in miniature, the thing L-9 forbids); a script **format family** now (D-8); deferring script entirely; **the compile-error brand** (§7.2 — evaluated and rejected on cost, not skipped) | 2 + 3 |
| **Q7** — proving Mode 2 unchanged | a `Record<Platform, …>`-typed **frozen expectation table** on the platform map, the only layer where a regression is silent (§8) | a **snapshot test** (rots; an accepted update erases the guarantee); asserting only at the schema layer; testing all three layers equally | 2 |
| **Q8** — test plan + UX contract | §10 (UX contract, specified not designed) and §11 (the tier map) | — | 1/2/3 |

### 0.2 — Founder adjudications (2026-08-21)

Raised by the Architect after the seam sweep and the single advisory batch; adjudicated by the founder the same day. Full text, including F1a's superseded recommendation on A-4, is in `docs/build-guide/session-29.md` §0.2. Encoded here as:

| # | Encoded in |
|---|---|
| A-1 — retain the accepted revision; snapshot **that**; L-6 amendment stands | §2.2, §4 |
| A-2 — `origin = 'studio_promoted'`, + ADR 0017 §3.1 amendment | §2.3 |
| A-3 — the user picks `scheduled_at`; approve must re-touch it; **promote is two steps, not one click** | §2.5, §10 |
| A-4 — carousel via a **new required input dimension**; L-10 holds strictly | §6.3, §8 |
| A-5 — `neutralizeWithSentinels` at the writer boundary | §5.4 |
| A-6 — deliberate slot consumption + a **staleness window** | §3.4 |
| A-7 — **Package A**: the post is independent of the brief; `activateCampaign` counts pre-existing posts | §2.6, §2.7 |
| A-8 — correct the build guide's two factual errors | Reality 10, §0.1 Q3 of the guide (done, `8aaded62`) |

---

## 1. Context and decision summary

### 1.1 What happens today

Mode 1 Studio produces a reviewed draft that **dead-ends**. `studio_drafts` holds `content`, the chosen `platform` and the merged accepted revision, and **nothing consumes them** — there is no route from a Studio draft to anything publishable. Mode 3 already ships the symmetric exit: `seedCampaignFromCard` (`lib/signals/seed.ts:62`) turns an approved insight card into a real campaign and a real brief through the **unchanged** ADR 0017 pipeline.

Separately, ADR 0017 D-6 deferred carousel and script *"when Instagram carousel / TikTok-Shorts are prioritized; one new union branch each."* Instagram, Facebook Pages and Threads are locked launch platforms, so **carousel's revival condition is met**. Script's is not, and D-6's price for it was wrong (§15.1).

### 1.2 The decision

Give Studio the same exit Mode 3 has, by the same route, and add carousel as a real format family while shipping script on the recommendation-field footing `imageBrief` already occupies. Much of this ADR's job is explaining why promote is **not allowed to invent a different route** than the one ADR 0017 already defines.

### 1.3 The losers, per §0's ledger D-1..D-8

D-1 (two ADRs, not one) is discharged by ADR 0023 existing separately. D-2 is resolved by §2. D-3's loser (read-then-update) is rejected in §3, and this ADR goes further than D-3 required — see §3.2, where Stage F's *ordering* is also rejected. D-4, D-5, D-6, D-7 and D-8 are encoded in §5, §4, §6, §6.4 and §7 respectively, each with its loser named in place.

---

## 2. What promote produces (Q1) — the load-bearing section

### 2.1 Decision

**`promoteDraftToCampaign(draftId: string): Promise<PromoteResult>`**, a Server Action in the Studio surface, returning `{ campaignId, briefId, postId }` on success and a **typed** outcome otherwise (§3.3). It performs, in this order (the order is load-bearing — §3.2):

1. **Claim** the draft atomically (§3.1).
2. `createCampaign` with `origin = 'studio_promoted'` (§2.3), composing `draft.content` into `campaigns.objective` (§2.4).
3. **Write back** `promoted_campaign_id` immediately.
4. Insert the human's draft as a `posts` row, `status='draft'`, with a user-chosen `scheduled_at` (§2.5).
5. Write the `post_ai_originals` snapshot from the **retained accepted revision** (§4).
6. Call `assembleBrief(campaignId)` **unchanged** (`lib/campaigns/brief.ts:80`).

`critiqueBrief` (`:143`) and the HARD gate in `approveBriefIfQualified` (`:197-216`) then run exactly as they do for every other campaign, unconditionally.

### 2.2 Why not a pure Stage F mirror

The seductive answer is to mirror `seedCampaignFromCard` exactly: compose the draft into an objective, seed the brief, let Mode 2 generation produce the posts. **It is wrong for one decisive reason: it discards the human's prose.**

Mode 1 Studio exists so a human can write the post. A pure mirror turns that text into a *seed* and publishes AI-written text instead — the mode's entire premise, inverted at the moment of promotion. `security-reviewer` reached the same structural point independently `[sec-6]`: Stage F *"never writes card text into `posts.content`; posts are still AI-generated fresh from the brief,"* whereas promote is *"a materially different operation: a direct copy of raw human text into `posts.content`, bypassing generation entirely."* That difference is the product, not an implementation detail.

It also cannot satisfy ADR 0019 §2.6, which commits promote to writing a `post_ai_originals` row — a table whose `post_id` and `campaign_id` are both `NOT NULL` (`20260726010000_learning_capture.sql:32`). Without a post, there is no snapshot and the learning ride ADR 0019 forfeited stays forfeited.

**Resolving the apparent contradiction in the sources.** Build guide §0.1 Q1 frames ADR 0019 §15 (*"an INSERT into `posts`"*) against ADR 0021 §6 (*"seed a brief"*) as *"different products."* Read at the source, they are not: §15 item 1's **first sentence** is *"Extract the argument and evidence from a human draft and **seed ADR 0017's Stage A brief pipeline**."* The `posts`-INSERT clause that follows is an argument about **not adding a mutation surface to a tenancy-critical column** — a contrast with option (a) — not a competing shape. This ADR does both, because §15 says both.

### 2.3 `campaigns.origin` — a migration IS required here (A-2)

Verified, not assumed: `20260722190000_mode2_brief_and_roles.sql:112-115` ships `CHECK (origin IN ('manual', 'objective_generated', 'signal_generated'))`, `NOT VALID` then `VALIDATE` at `:118`; the column's DEFAULT was added at `:107` and **dropped** at `:109-110`, so every insert must state `origin` explicitly.

**There is no studio value.** Unlike Stage F — which ADR 0021 §6.2 could record as *"no migration, the value already ships"* — promote **requires a fourth value**, `'studio_promoted'`, and therefore a migration against `campaigns` and an amendment to ADR 0017 §3.1 (§13.2).

**Loser: reusing `'manual'`.** It would make promoted campaigns indistinguishable from hand-typed ones in `listCampaigns`, in the learning loop, and in any future analysis — a lie in the one column whose purpose is provenance.

### 2.4 Composing the objective

`composeObjective`'s **shape** is reused and generalized, not duplicated and not extended. Stage F's version (`lib/signals/seed.ts:22-26`) joins four card fields with `\n\n`; promote's analogue composes the draft's content and platform into the same `objective: string` slot.

**`BriefAssemblyInput` is NOT extended.** Its six fields (`lib/ai/prompts/brief.ts:61-68`) are untouched. This is ADR 0021 §6.1's ruling applied to a second caller: seeding through `objective` costs **zero change to ADR 0017's code**, and *"adding a `seed` variant to `BriefAssemblyInput`"* remains the named loser — it is a change to Mode 2's generation behaviour, which L-1 forbids.

### 2.5 `scheduled_at`, and the surprise-publish failure mode (A-3)

`posts.scheduled_at` is `NOT NULL` (`20260430120010_posts.sql:24`), so promote must supply one. **The user chooses it, and the approve step must re-touch it.**

The reason is a concrete failure mode `[db-Q1]`, not tidiness. A defaulted `now()` inserts safely — the post is `status='draft'`, and nothing publishes drafts. But nothing requires `approvePost` to re-set `scheduled_at`. A human approving three days later flips `status` to `approved` with an **already-past** timestamp, and `claim_posts_for_publishing`'s `scheduled_at <= p_now` predicate (`20260524230000_publishing_worker.sql:33`) claims it on the **next cron tick** — published within minutes of approval, with no deliberate scheduling anywhere in the flow. For a feature whose premise is that the human controls what goes out, that is disqualifying.

**Consequence, stated because it changes the UX contract: promote is TWO steps, not one click.** §10 reflects this; any description of promote as a one-click affordance is wrong.

### 2.6 The brief governs generation, not the promoted post (A-7, Package A)

The brief is assembled, critiqued and gated exactly as ADR 0017 specifies. **Its outcome does not block the promoted post's own approval path.**

The reason is a category distinction. `approveBriefIfQualified`'s HARD gate (`brief.ts:197-216`, `overall_score` vs `BRIEF_QUALITY_THRESHOLD = 70`, compared in code before any DB write) exists to **stop Mode 2 generating posts from a bad brief**. A promoted post is not generated from the brief — it is human prose that already passed the Studio review gate. Gating it on brief quality is a category error, and a damaging one: the brief is auto-assembled from the user's own draft, so a score of 68 would trap **the user's own post** inside a campaign that never activates, for a reason they can neither see nor fix.

**Losers.** *Package B — the post waits for the brief*: cleanest single gate-story, but it couples promote into the brief-approval flow via a branch keyed on `origin='studio_promoted'`, which is close to the change L-1 forbids, and it hides the user's post behind a gate they do not control. *Package C — promote creates no brief*: drops to one gate, which §2.2's L-2 argument already rules out.

**Gate count, stated plainly per L-2 and in ADR 0021 §6.3's form:**

> A **promoted post** passes **TWO** human gates — Studio accept → post approval — exactly matching Mode 2's two (brief approval → post approval). Any **generated** post in that same campaign passes **THREE**, because the brief gate stands in front of it. **No gate is skipped for anything the brief actually governs**, and there is no flag, plan tier or setting that skips any of them.

### 2.7 `total_posts_planned` (A-7)

`campaigns.total_posts_planned` defaults to `0` (`20260430120009:25`) and is set only by `activateCampaign(id, totalPostsPlanned)` (`lib/db/campaigns.ts:92-107`), guarded `awaiting_brief → active`, from a brief-derived count. Promote inserts a post **before** activation, so a naive activation would write `N` for a campaign holding `N + 1` posts — permanently off by one for every promoted campaign.

**Fix:** `activateCampaign`'s caller computes `planned = brief-derived N + the count of posts already attached to the campaign`. For every non-promoted campaign that count is `0`, so the value and the behaviour are **byte-identical** to today. One call-site change, no schema change.

### 2.8 Two pre-existing facts that will look like promote bugs

Recorded so nobody debugs them fresh in three months. Neither is introduced by this ADR and neither is fixed by it.

1. **`claim_posts_for_publishing` filters `platform IN ('linkedin','twitter')`** (`20260524230000_publishing_worker.sql:34`), while `studio_drafts.platform` permits all five (`20260730100000_studio_drafts.sql:22-23`). A promoted Instagram, Facebook or Threads post sits `approved` **forever** `[db-addition]`. This is the publishing worker's allowlist, not a promote defect.
2. **No campaign-status guard exists on post creation at all.** `createPosts` (`lib/db/posts.ts:288-297`) is a bare insert; neither code nor DB checks the parent campaign's status. Promote is the **first** path to insert a post under a structurally pre-brief campaign — permitted, but new, and §2.6 is the decision that makes it coherent.

`campaigns.status`, for the record, is `CHECK (status IN ('draft','awaiting_brief','active','paused','completed'))` (`20260722190000:175`), and `createCampaign` sets no status — a promoted campaign lands `'draft'` by column default and passes `assembleBrief`'s `status !== 'draft'` guard (`brief.ts:84-86`) exactly like Stage F `[db-correction]`.

---

## 3. Atomicity, idempotency and failure (Q2, L-4)

### 3.1 Two columns, not one

`studio_drafts` gains three columns in total (§13.3); two of them carry the transition:

- **`promotion_claimed_at timestamptz NULL`** — the claim. Atomically claimed with a conditional UPDATE guarded on `promotion_claimed_at IS NULL` (subject to §3.4's staleness window), **before** `createCampaign` runs.
- **`promoted_campaign_id uuid NULL REFERENCES campaigns(id) ON DELETE SET NULL`** — the result, written back immediately after `createCampaign`, itself guarded on `promoted_campaign_id IS NULL`, mirroring `setCardCampaignId`'s `.is('campaign_id', null)` pattern (`lib/db/insight-cards.ts:161-170`).

### 3.2 Why one column is not enough — and why Stage F's shape cannot simply be copied

The Architect's first design used only `promoted_campaign_id`, reordered so the write-back preceded `assembleBrief`, on the reasoning that shrinking the crash window from an LLM call to an insert→update was sufficient. **`database-reviewer` falsified that** `[db-Q2]`, and the argument is decisive:

> `promoted_campaign_id` is **a real FK to `campaigns(id)`**. There is no legal non-null value to write into it before the campaign row exists, so the claim can only ever happen **after** the expensive, non-idempotent step. Two concurrent promoters — a double-clicked button, not even a crash — both pass any pre-check, both call `createCampaign`, and only the second loses the write-back race, *after both campaigns already exist*. **Milliseconds versus seconds changes the odds of hitting the window, not whether the window admits a duplicate.**

And the reason Stage F escapes this is structural, not clever: `seedCampaignFromCard` is gated **upstream** by `approveCardAction`'s atomic conditional transition on `insight_cards.status`, which guarantees at most one caller reaches it per approval — its own comment says so (`lib/signals/seed.ts:52-61`). **`studio_drafts` has no status column, by ADR 0019 §2.2's explicit refusal**, so promote has no equivalent upstream gate. The claim column is a **direct consequence of that refusal**, not an independent design choice.

The reorder is retained anyway — it is still correct and still shrinks the residual window — but it is not the guarantee. The claim is.

### 3.3 What the losing caller sees

The claim's loser matches **zero rows immediately**, before wasting a `createCampaign` or an `assembleBrief` call. It then re-reads the draft and renders that draft's **real current state**, mirroring `transitionCardStatus`'s `already_triaged` arm (`lib/db/insight-cards.ts:206-232`) — never a generic error.

**A distinction the ADR makes explicit** `[db-Q2]`: *"silently no-op" is correct for the write-back and wrong for the claim.* `setCardCampaignId` returns `void` and cannot distinguish "updated" from "already set" (`insight-cards.ts:155-160`); that is acceptable for a terminal write-back and unacceptable for a gate whose loser must render something truthful. **The claim returns a typed result; the write-back does not.**

### 3.4 The stranded-winner case and the staleness window (A-6)

A winner that claims and then crashes before `createCampaign` or before the write-back leaves the draft **claimed, with no campaign, and unreclaimable** under a one-shot `IS NULL` guard.

Stage F accepted the analogous residual as *"unreachable today, no retry job exists."* **Promote cannot**, for a reason specific to it: Stage F's stranded object is a card sitting `approved` with `campaign_id IS NULL` — invisible in most views. **A stuck Studio draft is directly in the user's face**, on the page they are working on.

**Decision:** the claim guard admits a **staleness window** — a draft is reclaimable when `promotion_claimed_at` is older than a stated interval **AND** `promoted_campaign_id IS NULL`. The interval is a named constant in `lib/config.ts`, not a literal at the call site. The Builder states the chosen value and its arithmetic (it must exceed the worst-case `createCampaign` + write-back latency by a wide margin, and it need not accommodate `assembleBrief`, which runs after the write-back).

**Loser:** documenting a stuck-forever case, as `seed.ts:52-61` does. That is how Stage F's NIT-1 became a review finding instead of a design decision.

### 3.5 Idempotency, stated honestly

Promote is **not** idempotent at `createCampaign`, and no design short of a distributed transaction makes it so — `assembleBrief` is an LLM call and cannot sit inside a DB transaction. What promote guarantees instead is that **at most one caller reaches `createCampaign` per draft per staleness window**, which is a stronger guarantee than Stage F has, obtained from the claim rather than from luck. The orphan case that remains (claim → crash → reclaim → a first campaign nobody references) is bounded, reclaimable, and stated here rather than discovered later.

---

## 4. The `generation_kind` amendment (Q3, L-6, A-1)

### 4.1 A landed claim, verified and found half false

ADR 0019 §2.6 and §15 both state that at promote *"the existing trigger does the rest, unchanged."* §0.1 Q3 required this ADR to **verify that claim against the shipped trigger rather than quote it**. Verified, it is half true, and the load-bearing half is false:

- **True:** `enqueue_post_edit_signal()` is `AFTER UPDATE ON posts` with no `WHEN` clause (`20260726010000_learning_capture.sql:224-226`) and needs no modification.
- **False:** that trigger **only reads** the latest snapshot (`:199-203`). **`generation_kind` is written by application code**, at exactly two sites — `lib/campaigns/generate.ts:407` (`'initial'`) and `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:363` (`'regeneration'`). There is **no trigger anywhere that writes `post_ai_originals`.**

**Promote must therefore write its own snapshot row**, following `createPostAiOriginal`'s existing shape (`lib/campaigns/generate.ts:400-414`). Recorded as a correction to a landed ADR, not silently absorbed.

### 4.2 Why a fabricated snapshot was rejected, and what A-1 rules instead

`database-reviewer` and `security-reviewer` **independently** recommended writing **no** snapshot at all `[db-Q1]` `[sec-6]`, on grounds this ADR accepts as correct:

- The trigger already handles the case by design — `IF v_origin_id IS NOT NULL THEN` at `:205-207`, with the comment *"a snapshot-less post (manual origin, or any post with no `post_ai_originals` row) must NOT fail the approve — just skip."* **A promoted post does not need a snapshot for approval to work.**
- The table's own comment (`:4-5`) defines it as an *"immutable snapshot of what the model generated."* No `generation_kind` value truthfully describes human-authored text.
- A fabricated snapshot is **worse than none**: Track C would diff the human's text against the human's own text wearing an AI label, synthesizing a phantom correction or preference into `performance_memory` — corrupting the exact corpus ADR 0018 exists to keep clean.

**But both reviewers assumed the snapshot's content would be the human's raw draft. ADR 0019 §2.6 does not say that** — it says *"the **accepted-suggestion revision** is written as a `post_ai_originals` row."* That text **is** model-generated, so the row is truthful and the diff measures a real AI→human delta.

**The obstacle is retrievability, and it is real:** `studio_drafts` has no column holding the accepted revision. Its columns are `content`, `platform`, `content_hash`, `suggestions`, `suggestions_for_hash`, and the accepted revision is **merged into `content`**. **ADR 0019 §2.6's plan is not implementable as written.**

**A-1 rules:** `studio_drafts` gains a column retaining the accepted revision; promote snapshots **that**. This keeps L-6's amendment, keeps the row truthful, restores the learning ride ADR 0019 forfeited, and avoids both reviewers' objection — which was to fabrication, not to snapshotting.

**Corollary the Builder must not get wrong:** when a draft was never suggested-on (the human wrote it and promoted it without accepting any suggestion), the retained revision is **NULL**, and promote writes **no snapshot**. The trigger's skip path at `:205-207` then applies exactly as designed. **A snapshot is written if and only if a genuine model-generated baseline exists.**

### 4.3 The amendment itself

Additive third value **`'studio_promoted'`** on `post_ai_originals.generation_kind`, currently `CHECK (generation_kind IN ('initial','regeneration'))` at `20260726010000_learning_capture.sql:34`. Widening a CHECK cannot invalidate existing rows — every extant row is `'initial'` or `'regeneration'` and satisfies the wider constraint — so the change is **additive and needs no backfill**, stated explicitly because L-12 requires it.

Written in the ADR 0014 Amendment A / ADR 0010 Amendment 2 house form as **ADR 0018 Amendment A** (§13.1).

### 4.4 What ADR 0018's classifier does with the new value

It processes the row normally, but the ADR records that **the measurement is not the same**, so no future reader mistakes it for equivalence:

- For `'initial'` / `'regeneration'`, the baseline is AI-authored and the diff measures **a human correcting a machine**.
- For `'studio_promoted'`, the baseline is **an AI suggestion the human had already accepted**, so the diff measures the human deviating from advice they endorsed.

Both are valid learning signals; the second is arguably cleaner. The ADR states the difference rather than letting it pass unremarked.

**Loser: reusing `'initial'`** — it erases exactly this distinction and leaves the learning loop unable to tell a human baseline from a machine one.

---

## 5. The write-time length bound (Q4, L-5, A-5)

### 5.1 The bound, and the arithmetic

**500 characters** on `performance_memory.pattern`.

`topContent` renders at `lib/ai/prompts/post-generation.ts:179` under `PERFORMANCE_CAP = 3`. Today's only live source is real `posts.content`, bounded by the manual-edit path's `z.string().max(5000)` — worst case ≈ **3 × 5,000 = 15,000 chars ≈ 3,750 tokens** in a single prompt section, which the comment at `:167-178` tolerates only because posts are platform-constrained. A *distilled* pattern is a synthesized sentence or two, not a post: **3 × 500 = 1,500 chars ≈ 375 tokens**, an order of magnitude below the tolerated worst case.

**A premise correction that matters** `[sec-2]`: `studio_drafts.content` is **unbounded today** — `createStudioDraftAction` and `saveStudioDraftAction` validate with a bare `z.string()`, no `.max()` (`app/[locale]/(dashboard)/studio/actions.ts:267`, `:296`). It is inert only because nothing consumes it. The moment promote reads it, the worst case is **whatever a human can paste into a textarea**, not the "~3×5000" the existing comment reasons about — that figure assumes edit-path caps that do not apply to this path. **Promote therefore applies the existing `z.string().min(1).max(5000)` contract** (`calendar/actions.ts:48`, `posts/actions.ts:179`) when copying into `posts.content`, so promote is not the one write path to that column with a different contract than every other.

### 5.2 Where it is enforced

**At the RPC, with a promoter-level Zod bound in front.**

`upsert_distilled_performance_pattern` is `SECURITY DEFINER`, granted only to `service_role` (`20260726030000_performance_memory_promotion.sql:74-75`), and is the last chokepoint before a value becomes durable and indefinitely re-renderable. It is also **the only place a future second writer cannot bypass** — and that writer already exists in embryo: `recomputeAndUpsertPattern` (`lib/db/memory-performance.ts:52`) calls the same RPC **without passing through the summarizer** `[sec-3]`. A bound placed only at ADR 0018's summarizer is silently void the day it goes live.

The instrument is a **CHECK constraint**, added `NOT VALID` then `VALIDATE`d as a separate statement — the precedent being `campaigns_origin_check` itself (`20260722190000:112-118`) `[db-Q4]`.

This is defence-in-depth of the kind ADR 0018 already uses (`memory-performance.ts:135-139`), not redundancy: the promoter's bound is **input hygiene**, the RPC's is a **durable-storage invariant**. They are different guarantees at different boundaries.

**Losers:** bounding at render time (`neutralize()` *"was never designed to bound length"* per `:174-178`, and it would mask a bad write rather than prevent it); bounding only at the summarizer (§5.2's second-writer argument); refusing the **promote** on this basis (blocks campaign creation for a well-formed draft because a much later, low-probability distillation *might* exceed a memory bound `[sec-4]`).

### 5.3 Overflow behaviour: reject, never truncate

The value renders under the section header *"Top-Performing Post Snippets (use for tone calibration)"* — **an instruction to imitate**. A statement cut mid-clause ("*…posts that open with a direct question about their biggest*") becomes, to the model, a complete stylistic instruction it has no signal to distrust `[sec-4]`. There is no truncation marker on this path: `TRUNCATION_SUFFIX` exists in `wrap-evidence.ts` for evidence, and `post-generation.ts:179` has no truncation logic at all.

**Rejection also matches house policy.** ADR 0019's founder ruling A-6 already settled the sibling case in these words: *"REFUSE input over the authoritative, derived cap outright"* (`lib/studio/guard.ts:106-108`).

**Operational requirement:** the distillation worker handles a rejected item **per item** — log and skip that pattern — and does **not** fail the whole batch. Whether the existing tick loop already does this is a **stated-open** item (§16).

### 5.4 A-5 — the guard, which the length bound does not close

A length bound closes the cost problem. It does **not** close a distinct gap `[sec-5]`:

- ADR 0019 §5.5 built `neutralizeWithSentinels` (`lib/ai/wrap-evidence.ts:118-132`) **precisely because** plain `neutralize()`'s `\p{Cf}`-only strip (`:84-93`) was judged insufficient — it misses `\p{Co}` (private-use sentinels), `\p{Cs}` (lone surrogates) and variation selectors. The gap is stated in-code at `:108-115`.
- But `guardStudioField` (`lib/studio/guard.ts:83-129`) runs only at Studio's **suggest-time** sink. `saveStudioDraftAction` is a bare `z.string()`, so **manually-saved content — exactly what promote reads — is never guarded at all.**
- And the second sink (`performance_memory` → `post-generation.ts:179`) routes through the **weaker** `neutralize()`, which was chosen before ADR 0019 §5.5's standard existed.

**Decision: `neutralizeWithSentinels` is applied at the writer boundary** for any `pattern` value whose provenance chain touches human-authored text. Recorded in ADR 0018 Amendment A alongside the bound, because it is that writer's guarantee. **Loser:** documenting the residual as an accepted carve-out (the alternative A-5 offered) — declined, because the wider guard already exists and the cost of calling it is one function swap.

### 5.5 Existing rows

**Do not let `VALIDATE` be the discovery mechanism** `[db-Q4]`. A `VALIDATE CONSTRAINT` failure is a full-table scan that aborts a deploy with a bare Postgres error, not a legible report. `performance_memory` is **no longer necessarily empty** — the "ships EMPTY" comment (`governed_memory.sql:200-203`) predates Track C, which is live and writes through `promote.ts` and `summarize.ts`. The count query and its result are a **stated-open** item that must be closed before the Builder fixes the number (§16).

---

## 6. The carousel format family (Q5, L-7, L-8, D-7)

### 6.1 The branch

A third branch on the existing `z.discriminatedUnion('format', …)` in `lib/ai/prompts/formats/schemas.ts`, alongside `single` (`:9-13`) and `thread` (`:21-37`):

- discriminator `format: 'carousel'`;
- **`slides`** — an array of `{ text, role, imageBrief }`, bounded **3..10** as literal schema bounds, so `safeParse` rejects a malformed carousel **structurally**, exactly as thread's `.min(3).max(8)` does;
- **`role`** on each slide, from a closed set: **`cover | body | cta`**;
- `imageBrief` repeated per-branch, per ADR 0017 §4.1's `[type-4]` caveat (no shared base merge in `discriminatedUnion`);
- **no `order` field** — array position is the order, per ADR 0017 §4.1's `[type-2]` ruling.

**Union arity is a non-issue, and this ADR spends no further argument on it.** `typescript-reviewer` probed it directly `[type-1]`: `discriminatedUnion` dispatches through an internal Map keyed on the literal tag, and the `issues` array is **byte-identical** at both failure channels (`invalid_type` for a shape miss inside a valid tag; `invalid_union` / *"No matching discriminator"* for a bad tag) whether the union has two branches or three.

### 6.2 Roles, and why positional discipline was rejected

Slides carry roles rather than relying on position, on an argument stronger than symmetry with thread `[type-4]`. A carousel's **cover slide is the only thing rendered in-feed before a swipe** on Instagram and LinkedIn. A "plausible but wrong" sequence — the CTA drifting to slide 2 of 6, or no clear cover — is invisible to any positional validator and surfaces weeks later as a swipe-through or save-rate number nobody traces back. A thread's equivalent failure is already judged consequential enough to warrant a dedicated Tier-0 policy function; carousel's is **more** consequential, not less.

`policy.ts` gains **`validateCarouselPolicy`**, mirroring `validateThreadPolicy`'s shape (`policy.ts:15-32`): first slide is `cover`, at least one `cta`, and the sequence discipline stated as literal rules. It throws `AiError('policy_violation', …)`, keeping the **distinguishable** error codes ADR 0017 §4.2 requires — shape failures surface as `invalid_response` from zod, sequence failures as `policy_violation`, and the bounded single re-prompt can therefore send a targeted correction rather than a generic retry.

### 6.3 Reachability, and how L-10 is satisfied strictly (A-4)

`selectFormatFamily` routes `instagram` to `'single'` **unconditionally** (`platform-map.ts:25-35`), and `platform-map.test.ts:5-12` asserts it is single *"regardless of content volume."* Carousel cannot be reachable without touching that arm — `typescript-reviewer` confirmed there is no alternative `[type-3]`.

**The resolution is to make carousel a domain *extension*, not a mapping change.** `selectFormatFamily` gains a **third, required parameter** — `carouselRequested` — sourced from the brief, the deterministic Tier-0 input that already drives generation. Instagram's arm becomes conditional on it; every other arm is untouched.

The consequence is the point:

> **Every call that exists today supplies no such value and resolves byte-identically. L-10 holds in its strict form — satisfied literally, not reinterpreted.** Carousel becomes reachable only in a region of the input space that was previously unrepresentable, and `platform-map.test.ts:5-12` stays **true as written**, because content volume genuinely is not the trigger.

The parameter is **required, not optional**, precisely because there is exactly one caller today (`lib/ai/generate-native.ts:98`): the cost is one line, and a required parameter forces the decision to be visible at every future call site instead of defaulting silently.

**Loser: a volume-derived trigger** (thread's rule, analogised — e.g. "≥3 slides' worth → carousel"). It is derived from inputs that **already exist**, so calls that resolve to `'single'` today would begin resolving to `'carousel'`. That is precisely the L-10 violation this design avoids, restated. **Also rejected:** amending L-10 by founder fiat, and deferring carousel — both unnecessary once the extension framing is available. *(The Architect's original recommendation was to reinterpret L-10; it is preserved in build guide §0.2 A-4 and superseded here.)*

### 6.4 What carousel ships as (L-8, D-7)

**Structured slide copy plus a per-slide `imageBrief` recommendation. Nothing else.** The constitution's *"We don't generate images at launch"* stands unamended by this ADR. A carousel is a sequence of image slides, and SOSH ships **the copy for those slides and a brief describing the image each needs** — stated here as the shipped product, not as a stopgap, with its revival condition in §15.2 so the next gap analysis reads it as a decision rather than drift.

**Losers:** generating images (constitution); a `carousel` boolean on the single-post branch (structurally cannot reject prose-where-carousel-expected — ADR 0017 D-3's original argument); a model-chosen family (nondeterministic and unverifiable — `platform-map.ts` is Tier-0 by design).

### 6.5 The prompt factory, and a precondition that is not optional (L-7)

`createNativeGenerationPrompt` gains a third overload signature and a third builder (`buildCarouselPrompt`), with its own hardcoded `prompt.id` alongside `'native-generation-single'` (`:107`) and `'native-generation-thread'` (`:118`). **`lib/ai/runner.ts` is not modified, and no third `prompt.id` branch is added to the runner** (`runner.ts:17-25`) — ADR 0017 D-3's ruling, unchanged. If the Builder finds itself editing `runner.ts`, it has taken the losing option.

**The precondition, which is a required diff and not a cleanup** `[type-2]`. Three sites dispatch on a **bare `FormatFamily` string**, and are therefore **not** exhaustiveness-checked by `tsc` — the discriminant is a variable, not a tagged object, so discriminated-union narrowing does not apply:

| Site | Failure if carousel is added and the site is missed |
|---|---|
| `lib/ai/generate-native.ts:110` | **Silent misroute.** A carousel call falls into `generateThread`, receiving the thread prompt and `validateThreadPolicy`. It throws only because that validator happens to crash on the missing `posts[0].role` — **an accidental safety net, not a designed one**. A differently-shaped policy check would not crash, and garbage would validate. |
| `native-generation-prompt.ts:36-52` (`buildSystemPrompt`) | Loud: the model receives thread instructions, every carousel call fails `invalid_response`, burns its one re-prompt, then fails for real. Self-announcing. |
| `native-generation-prompt.ts:138` (factory body) | The two-arm ternary cannot express three arms; extending it naively reintroduces the same missing-exhaustiveness property for a fourth family later. |

**All three convert to `switch (family) { …; default: assertNever(family) }` (or equivalent) as a precondition of adding the carousel branch.** Note precisely what the existing `switch` does and does not buy: `selectFormatFamily`'s switch (`platform-map.ts:26-34`) gives exhaustiveness over **`Platform`** — it will fail to compile if a sixth platform appears — and gives **nothing** when `FormatFamily` itself grows a member.

For contrast, and recorded so the Builder does not "fix" what is already safe: `lib/campaigns/generate.ts:48` (`extractOpener`) and `:55` (`joinContent`) **are** protected, because they narrow on the *output union* where `CarouselOutput` has `slides` and not `posts` — a genuine compile error. That is structural luck from Zod's typing, not a pattern this codebase designed for, and it does not transfer to the three sites above.

---

## 7. Script as a recommendation field (Q6, L-9, D-8)

### 7.1 The shape

**`scriptBrief: string | null`** — a bounded string on exactly `imageBrief`'s footing (`schemas.ts:12`, `:36`), declared per-branch for the same anti-drift reason ADR 0017 §4.1 gives, with a literal length bound stated in the schema. It is generated, attached to the post, surfaced wherever posts are reviewed, and **never published**.

**Loser: a structured `{ hook, beats[], cta }` object.** The Architect's draft preferred it; `typescript-reviewer` argued it down and this ADR accepts the argument `[type-6]`: a structured multi-field object with its own array bound *"starts looking exactly like a format family in miniature — the thing you were told not to build."* It also buys nothing at the render layer while adding required-field validation surface for the model to trip on (empty `beats`, missing `cta`). **L-9 forbids the format family; a shape that converges on one by degrees is the same decision taken quietly.**

### 7.2 The never-published guarantee — and why the compile-error goal was rejected

§0.1 is explicit that a length bound is **not** a substitute for proving the field cannot reach `posts.content` or the publishing worker. This ADR evaluated the strongest available form of that proof and **rejected it on cost, which is different from skipping it** `[type-7]`.

**Why a brand does not work as stated.** A branded string (`string & { __brand }`) constrains what may be assigned **to** a branded slot; it does nothing to a plain `string` parameter, because a branded value *is* structurally a string. The guarantee would have to sit on the **sink** — `posts.content` writes requiring a `PublishableText` that `scriptBrief` cannot satisfy.

**Why that is the wrong trade here.** `posts.content` has **several legitimate plain-string producers today** — manual user edits from the post editor, AI generation via `joinContent` (`generate.ts:270`), and the regeneration and brand-voice rewrite paths. Forcing all of them through one mint point means the brand no longer proves *"this came from a sanctioned field"*; it proves *"this passed through the function everything passes through"* — **a tautology**, and CLAUDE.md's own `as`-cast failure mode relocated into the mint function's body.

**What ships instead:** a **Tier-3 diff-verified source scan**, on the precedent `lib/signals/source-scans.test.ts` already sets for the GitHub-client boundary — asserting `scriptBrief` appears nowhere outside the generation-output module and the single mapper that consumes generation output, **with a per-root vacuity guard** (the Session 26-D MINOR-1 precedent, so an empty root cannot pass the scan silently). Enumerated as a Tier-3 decision in §11.3 so *"no runtime test"* is a recorded choice, not an oversight.

### 7.3 i18n and rendering

`scriptBrief` renders wherever posts are reviewed, as visible text with an accessible name marking it a **recommendation that is never published** — the same treatment `imageBrief` receives, not a new category. Keys land in **en, pt and es simultaneously** and are registered in `i18n/request.ts`, per L-12.

---

## 8. Proving Mode 2 unchanged (Q7, L-10)

### 8.1 Where the strongest assertion goes, and why

The three candidate layers do not carry equal risk `[type-8]`:

| Layer | Risk | Why |
|---|---|---|
| Schema output | **Lowest** | Additive and self-testing; a shape miss fails loudly as `invalid_response`. Union arity is proven not to degrade error quality (§6.1). |
| Assembled prompt | **Medium — but fails LOUD** | A missing carousel arm in `buildSystemPrompt` makes every carousel call fail on its first attempt. Annoying, self-announcing, cannot pass CI silently. |
| **Platform map / selection** | **Highest — the only layer where a regression is SILENT and plausible-looking** | A subtly wrong edit to an existing arm (a shifted `>= 3` threshold while adding carousel) still produces valid, schema-passing output — for the wrong family. Nothing downstream complains. |

**The strongest assertion therefore goes on the platform map**, confirming Reality 8's judgement.

### 8.2 The assertion, and its two rot modes

A **frozen expectation table**, checked into the test, enumerating every `(platform, estimatedTweetsWorth, carouselRequested)` combination across the existing domain and asserting `selectFormatFamily` returns exactly its pre-F2 value. **Not a snapshot file** — a snapshot rots invisibly and gets `-u`'d back to green, which erases the guarantee it exists to provide.

**Rot mode 1 — the table gets co-edited.** The commonest failure for this class of test: the PR that changes `platform-map.ts` also edits the frozen table to match, and review passes because "tests are green." **This ADR requires that any PR touching both `platform-map.ts` and the frozen table justify each changed row individually against L-10 in the PR description.** "Tests still green" is not evidence for a table editable in the same commit as its subject.

**Rot mode 2 — a new `Platform` value silently escapes the table.** Prevented at **compile time**, not test time: the table is typed as **`Record<Platform, …>`**, so `tsc --noEmit` hard-fails the moment `Platform` gains a member the table does not cover — **before `vitest` ever runs**. This is strictly stronger than a runtime completeness check and matches the exhaustiveness posture of `platform-map.ts:26`'s `default`-less switch.

*(Not adopted: cross-checking against `CANONICAL_PLATFORM_ORDER` (`generate.ts:28`). It is module-private, and exporting it solely for a test would add an export with no production consumer — the `Record<Platform, …>` typing is a better guarantee anyway.)*

**Secondary assertion:** byte comparison of `buildSinglePrompt()` and `buildThreadPrompt()` output against frozen fixtures — the assembled prompt is what actually reaches the model.

**Constraint name:** `MODE2-FORMAT-SELECTION-UNCHANGED`, in `SIGNAL3-RUBRIC-UNCHANGED`'s shape.

---

## 9. SHARED-FUNCTION CALLERS

`git grep` re-run during the F1a seam sweep. **The Builder re-runs it at close-out and extends this table if a caller appeared.** Both Session 22 blockers were this exact failure.

| Function | Caller | Test covering that caller | Behaviour change? |
|---|---|---|---|
| `assembleBrief` (`lib/campaigns/brief.ts:80`) | `seedCampaignFromCard` (`lib/signals/seed.ts:85`) — **the only production caller today** | Tier-1 `supabase/__tests__/signals3-seed.test.ts:139` (drives the real body through a production caller); `lib/campaigns/brief.test.ts:155,172,185,202,210,216,225` (Tier 2, direct) | **No.** |
| `assembleBrief` | **`promoteDraftToCampaign` (NEW — its SECOND production caller)** | **Tier-1 live-Postgres end-to-end through promote — ADR 0021 A-2's binding condition, applied to the second caller** (§11.1), plus a Tier-2 action test | **No.** Same signature, same input type; the draft composes into `objective`. |
| `critiqueBrief` (`:143`) | existing callers, unchanged | `lib/campaigns/brief.test.ts` | **No** — promote adds no caller; the gate runs on the brief as it always did. |
| `approveBriefIfQualified` (`:197`) | existing callers, unchanged | `lib/campaigns/brief.test.ts` | **No** — §2.6 changes what the *promoted post* depends on, not what this function does. |
| `createCampaign` (`lib/db/campaigns.ts:37`) | existing callers + `promoteDraftToCampaign` (NEW) | existing tests + promote's Tier-1/Tier-2 | **No.** |
| `activateCampaign` (`lib/db/campaigns.ts:92`) | existing caller, **argument computation changes** (§2.7) | existing tests + a new case asserting a non-promoted campaign's `planned` is **unchanged** | **No** for every non-promoted campaign (pre-existing post count is 0). |
| `selectFormatFamily` (`platform-map.ts:25`) | `lib/ai/generate-native.ts:98` — **the only caller**; **signature gains a required third parameter** (§6.3) | `platform-map.test.ts` + §8's frozen table | **No** for every existing input (§6.3). |
| `softDeleteCampaignGuarded` (`lib/db/campaigns.ts:141`) | existing callers, **plus a new cleanup call** (§12.1) | Tier-1 soft-delete case (§11.1) | **No** to its own behaviour; a sibling cleanup is added alongside, mirroring D7. |
| `upsertDistilledPerformancePattern` (`lib/db/memory-performance.ts:95`) | `lib/learning/promote.ts:122`, `lib/learning/summarize.ts:150`; `recomputeAndUpsertPattern` (`:52`, not yet live) | ADR 0018's existing tests + the new bound's Tier-1/Tier-2 | **Yes, deliberately** — over-length patterns are now rejected (§5.3). |

**Note on a mocked caller, recorded because it is exactly the AUTHORED-NOT-EXECUTED trap:** `lib/signals/seed.test.ts:14` mocks `assembleBrief` with `vi.fn()` and asserts it was called (`:86`, `:109`). It therefore **does not execute the real function's body** and is not coverage of it. The only test that drives `assembleBrief` through a production caller is the Tier-1 file above.

---

## 10. The UX contract (Q8) — specified, not designed

The Builder designs; this ADR fixes the contract it is held to. **No `.tsx` appears in this ADR.**

**Placement and split.** Promote lives on `app/[locale]/(dashboard)/studio/[draftId]`. **Server Component page + Client interaction**, per the shipped precedent in both directions: `approvals/page.tsx` and `opportunities/page.tsx` hold auth, the capability gate and every bounded read, while `ApprovalsInbox.tsx` / `OpportunityFeed.tsx` own interaction only. `opportunities/page.tsx:13-16` states the rule in-code: *"NO client-side data fetching."*

**Promote is two steps (A-3, §2.5)** — the user chooses `scheduled_at` before the action fires. Any affordance implying one click is wrong.

**States, each with visible text and an accessible name:**

| State | Condition |
|---|---|
| not promotable | `content` empty, **or** `platform IS NULL` (the column is nullable by design, ADR 0019 §2.2) |
| promotable | otherwise |
| promoting | claim held, in flight |
| promoted | terminal — renders a **real link to the brief**, following D7's `insight_cards.campaign_id` link precedent |
| promote failed | the action errored after claiming; the draft is reclaimable per §3.4 |
| already promoted | **the lost-race arm** — renders *that draft's* real current state, never a generic error (OpportunityFeed's `already_triaged` precedent) |
| reclaimable | claimed, stale, no campaign — §3.4's window has elapsed |

**Carousel and script previews** render in the approvals surface: slides in order with their roles visible, `imageBrief` and `scriptBrief` shown as **recommendations explicitly marked never-published**.

**Design floor (L-11), inherited exactly.** Any new status colour lands on `app/globals.css` tokens beside the existing set (`--warning`, `--warning-border`, `--warning-foreground`, `--success`, `--success-border`, `--success-foreground`, `--info-foreground`; light `:98-110`, dark `:149-156`) — **never ad-hoc Tailwind colour classes.** The accompanying test must **read the shipped token file live**, as `OpportunityFeed.test.tsx:439` does via `readFileSync(path.resolve(process.cwd(), 'app/globals.css'))`, parsing luminance out of the real `:root` and `.dark` blocks and asserting ≥ 4.5:1 in **both** themes, plus the negative assertion that no raw `amber|emerald|sky-\d` class survives in the rendered output. **Hand-transcribed hex values are the anti-pattern that test exists to prevent.**

**Constitution, non-negotiable:** shadcn v4 / Base UI — **no `asChild`** on `Button` or `DropdownMenu` primitives; a link styled as a button uses `buttonVariants()`. i18n **en/pt/es simultaneously**, registered in `i18n/request.ts`. Zod on every Server Action input. No `console.*` on a user-facing surface. Zero `dangerouslySetInnerHTML`.

---

## 11. Test plan across the tiers (Q8, ADR 0015 §2)

### 11.1 Tier 1 — DB behaviour, live Postgres, executed by `db-tests.yml`

| Constraint | What it proves |
|---|---|
| `PROMOTE-CLAIM-ATOMIC` | Two concurrent promoters of one draft: **exactly one** campaign exists; the loser matches zero rows and receives a **typed** outcome (§3.3). Must redden if the claim guard is removed. |
| `PROMOTE-WRITEBACK-GUARDED` | The `promoted_campaign_id` write-back is guarded and no-ops on a lost race. |
| `PROMOTE-CLAIM-RECLAIMABLE` | A stale claim with `promoted_campaign_id IS NULL` is reclaimable; a fresh one is not (§3.4). |
| `PROMOTE-RLS-ISOLATED` | The three new columns under the four existing `studio_drafts` policies, **mirrored both directions** (tenant A cannot read or update tenant B's), with `USING` **and** `WITH CHECK` on UPDATE. |
| `PROMOTE-CASCADE-COMPLETE` | Erasure **succeeds**: `businesses` cascade reaches the new columns' rows; `purge_business` covered (§12.2). |
| `PROMOTE-SOFTDELETE-CLEARED` | A **soft-deleted** campaign leaves no dangling `promoted_campaign_id` (§12.1) — must redden without the cleanup function. |
| `PROMOTE-BRIEF-END-TO-END` | **`assembleBrief` driven end to end through promote against real Postgres** — ADR 0021 A-2's binding condition applied to the second caller (§9). |
| `LEARN-GENERATION-KIND-WIDENED` | The CHECK accepts `'studio_promoted'` and still rejects a bogus value. |
| `MEM-PATTERN-BOUNDED` | The `pattern` CHECK rejects an over-length write. |

### 11.2 Tier 2 — app layer, executed by `app-tests.yml`

`CAROUSEL-SCHEMA-STRUCTURAL` (slide bounds and roles rejected by `safeParse`, not by a downstream string check) · `CAROUSEL-POLICY-SEQUENCE` (`validateCarouselPolicy` distinguishes `policy_violation` from `invalid_response`) · **`MODE2-FORMAT-SELECTION-UNCHANGED`** (§8's `Record<Platform, …>` frozen table) · `MODE2-PROMPT-BYTE-IDENTICAL` (frozen prompt fixtures) · `SCRIPT-BRIEF-BOUNDED` · `PROMOTE-ACTION-VALIDATED` (the Zod contract, including the `max(5000)` copy bound, §5.1) · `PROMOTE-STATES-RENDERED` (all seven §10 states through the real component) · `PROMOTE-CONTRAST-AA` (both themes, reading the shipped token file) · `PROMOTE-I18N-COMPLETE` (en/pt/es) · `ACTIVATE-PLANNED-UNCHANGED` (a non-promoted campaign's `planned` is identical, §2.7) · **`MEM-PATTERN-SENTINEL-GUARDED`** (Session 29-D, MAJOR-1 / A-5 — `upsertDistilledPerformancePattern`'s sole writer boundary applies `neutralizeWithSentinels`, per ADR 0018 Amd A.3, to `insert.pattern` before the RPC call; a mocked-client Tier-2 test asserts a `[/DATA]`-class payload is neutralized before reaching `client.rpc`).

### 11.3 Tier 3 — diff-verified, enumerated **as decisions**

Per ADR 0015 §2, these have no runtime test **by decision**, and that decision is recorded here rather than left as an omission:

1. **`RUNNER-UNMODIFIED`** — `lib/ai/runner.ts` is untouched; no third `prompt.id` branch (ADR 0017 D-3).
2. **`SCRIPT-NEVER-PUBLISHED`** — enforced by an executable **source scan with a per-root vacuity guard** (§7.2). Diff-verified in the sense that it is a property of *absence*.
3. **`MODE3-UNTOUCHED`** — no change to the poller, watch list, scorer, candidate schema, triage loop, card schema or feed (L-12).
4. **`POSTS-DDL-UNMODIFIED`** — `posts` gains no column, constraint, index, policy or trigger.
5. **`NO-SKIP-REVIEW-PATH`** — ADR 0017 L-11 stays deferred; no configuration skips a gate (L-2).

### 11.4 Merge gates

Unchanged by this ADR (ADR 0015 §5). `app-tests` is Required. `db-tests`' promotion tally is **under founder adjudication** following the Session 29 Step 0 discovery that five consecutive full-green `master` runs exist while the ledger records `0 of 3` — see `docs/current-phase.md`. **This ADR neither asserts nor moves that tally.**

---

## 12. GDPR, tenancy and the cascade (L-11)

### 12.1 The soft-delete trap, inherited from D7

`softDeleteCampaignGuarded` is an **UPDATE** setting `deleted_at` (`lib/db/campaigns.ts:141-155`), **not** a DELETE. Therefore **`ON DELETE SET NULL` never fires** for a soft-deleted campaign. This is precisely why Session 28-D D7 needed `clearCampaignReferenceOnCards` (`lib/db/insight-cards.ts:172-191`) *in addition to* the FK.

Without the equivalent, a promoted draft would point at a soft-deleted, unreachable campaign forever — **the exact bug D7 closed, reintroduced fresh** `[db-Q2]`. This ADR therefore requires a sibling function clearing `promoted_campaign_id` on soft-delete, wired from the same call sites as `clearCampaignReferenceOnCards`, and proved by `PROMOTE-SOFTDELETE-CLEARED` (§11.1).

### 12.2 §D2.5 — no new row, and why

**No new row in ADR 0010 Amendment 2 §D2.5 is required.** The three new columns land on `studio_drafts`, an **already-covered** table whose cascade row exists and whose `business_id` already carries `ON DELETE CASCADE` (`20260730100000_studio_drafts.sql:17`). This is the Session 28-D D7 precedent exactly — *"a column on an existing table, whose cascade row already exists"* — and L-11 explicitly settles the case. `purge_business` needs no edit for the same reason. Stated rather than assumed, because L-11 requires saying **which case applies and why**.

### 12.3 Tenancy — the honest severity of the promote path (Q4)

`security-reviewer` traced the full read side and **confirms there is no cross-tenant path** `[sec-1]`: `listPerformanceMemoryCandidates` (`lib/db/memory-performance.ts:11-35`) filters `.eq('business_id', businessId)` with no widening branch; `retrieveRelevant` (`lib/memory/performance.ts:45-56`) requires `businessId` and passes it through; all three RPCs key on `business_id` first (`20260726030000:63`, `:114`, `:158`); and `scope`/`scope_ref` are a dimension **within** one business, never an alternate key. `enqueue_post_edit_signal` copies `NEW.business_id` verbatim (`learning_capture.sql:211`).

> **Stated plainly, and deliberately not inflated: this is SAME-TENANT self-poisoning and a cost / context-exhaustion concern. It is not a tenancy breach and not an exfiltration finding.**

**Honest severity: MEDIUM once promote lands, unmitigated — not HIGH.** Today, no action is needed and the existing comment is accurate. It rises above LOW only because a distilled pattern **persists up to 90 days** (`expires_at`, `20260726030000:61`) and renders into **every** subsequent generation for that business until it decays — a recurring cost, not a single incident. It cannot be HIGH or CRITICAL: `neutralize()` still runs at the single render site, and no tenant boundary is crossed.

---

## 13. Amendments to landed ADRs

All four are **additive**; none rewrites existing text. Each is written in the ADR 0014 Amendment A / ADR 0010 Amendment 2 house form, appended to its own ADR, and **cited from here rather than duplicated**.

### 13.1 ADR 0018 Amendment A — the learning-capture surface

Three changes, all to objects **ADR 0018 owns**, which is why they live there and not here: the third `generation_kind` value with its additive/no-backfill statement (§4.3); the `performance_memory.pattern` write-time bound at its writer and RPC (§5); and A-5's `neutralizeWithSentinels` guard at that same boundary (§5.4). A future reader asking *"why does `pattern` have a length CHECK?"* opens ADR 0018, because the column is ADR 0018's.

### 13.2 ADR 0017 Amendment B — `campaigns.origin`

Adds `'studio_promoted'` to the `origin` value set ADR 0017 §3.1 defines (§2.3).

### 13.3 ADR 0019 Amendment A — `studio_drafts`, and the supersession of A-4

Adds three columns — `promotion_claimed_at`, `promoted_campaign_id`, and the retained accepted revision (§4.2) — and **explicitly supersedes ADR 0019's founder ruling A-4**, its refusal of a draft→campaign FK.

**The supersession is argued in words, not performed silently.** A-4's stated ground was *"a nullable FK nobody uses yet … will attract exactly one join."* Promote is a real consumer from day one, so **the stated condition no longer holds** `[db-Q2]`. Two things are recorded alongside, so a future reader is not left guessing:

- A-4's prediction is being **fulfilled exactly as it foresaw** — there will indeed be one join — but now for a real reason rather than a speculative one. That is the difference the supersession turns on.
- **The name `promoted_campaign_id`, not `campaign_id`, is deliberate:** a directional, single-purpose FK ("this draft became this campaign"), not the vague bidirectional join-magnet A-4 was actually warning about.

### 13.4 ADR 0010 Amendment 2 §D2.5

**No amendment required** — §12.2 states why.

---

## 14. Advisory findings, consolidated

One batch, read-only, never re-consulted. **All three changed the design before it was written, and two falsified claims in landed ADRs or in the Architect's own draft.**

| Ref | Finding | Effect |
|---|---|---|
| `[db-Q2]` | `promoted_campaign_id` is an FK and **cannot be pre-claimed**; the reorder shrinks the window but does not close it. Stage F is protected upstream by `approveCardAction`; `studio_drafts` has no such gate **because ADR 0019 refused a status column**. | **Design changed** — a second, non-FK claim column added (§3.1, §3.2). |
| `[db-Q2]` | `softDeleteCampaignGuarded` is an UPDATE, so `ON DELETE SET NULL` never fires — D7's bug, reintroduced. | **Design changed** — cleanup function required (§12.1). |
| `[db-Q1]` | A defaulted `scheduled_at` publishes within minutes of approval via `claim_posts_for_publishing`. | **Design changed** — A-3, user-chosen (§2.5). |
| `[db-Q1]` | `total_posts_planned` skew; no campaign-status guard on post creation. | **Design changed** — §2.7, §2.8. |
| `[db-Q1]` `[sec-6]` | Promote should write **no** `post_ai_originals` row; a fabricated one corrupts ADR 0018's corpus. | **Partially accepted** — fabrication rejected; A-1's retained-revision snapshot adopted, with a NULL-revision skip path (§4.2). |
| `[db-Q4]` | Do not let `VALIDATE` be the discovery mechanism; `performance_memory` may not be empty. Check `renderPatternStatement` / `renderTierZeroSummary` before fixing 500. | **Accepted** — §16 stated-open. |
| `[type-1]` | Union arity does **not** degrade `discriminatedUnion` error quality (probed empirically). | **Concern withdrawn** (§6.1). |
| `[type-2]` | Three bare-`FormatFamily` ternaries are not exhaustiveness-checked; `generate-native.ts:110` **silently misroutes**. | **Design changed** — conversion is a precondition (§6.5). |
| `[type-3]` | Instagram's arm must change; no alternative exists. | **Confirmed** — resolved by A-4's extension framing (§6.3). |
| `[type-4]` | Carousel slides need roles; the cover slide is the only pre-swipe render. | **Design changed** — roles + `validateCarouselPolicy` (§6.2). |
| `[type-6]` | A structured script object becomes a format family in miniature. | **Architect's draft reversed** — bounded string (§7.1). |
| `[type-7]` | The compile-error brand degrades to a tautology across `posts.content`'s many producers. | **Accepted** — source scan, with the rejection recorded as deliberate (§7.2). |
| `[type-8]` | Platform map is the only silent-regression layer; `Record<Platform, …>` beats a runtime check; the table can be co-edited. | **Design changed** — §8.2. |
| `[sec-1]` | No cross-tenant path exists. | **Framing confirmed** (§12.3). |
| `[sec-2]` | `studio_drafts.content` is **unbounded today**; the "3×5000" premise does not hold. | **Design changed** — promote applies the `max(5000)` contract (§5.1). |
| `[sec-3]` | The RPC is the only unbypassable chokepoint; a second writer already exists. | **Design changed** — bound at the RPC (§5.2). |
| `[sec-5]` | Guard-strength drift: manually-saved content is never guarded; the memory sink uses the weaker `neutralize()`. | **Design changed** — A-5 (§5.4). |

---

## 15. Deferred to later tracks / phases (boundary on the record)

So a future session does not build any of these here by mistake, and so the next gap analysis reads them as **decisions rather than drift**.

1. **The script FORMAT FAMILY** — deferred, not cancelled (L-9, D-8). ADR 0017 D-6 priced it as *"one new union branch each,"* and that price assumed every family has a `platform-map.ts` row **and a publish path**. Script has neither: no launch platform publishes video, and the product has no media pipeline, so a script family would be a **new unpublishable-artefact class** — something generated, reviewed and approved that can never reach `published`, for which `posts`' state machine, the approval flow, the calendar and the publishing worker have **no state**. That is a session, not a branch. **Revival condition: a video-capable platform lands, OR the product decides what a non-publishable artefact is — whichever comes first.**
2. **Image generation for carousel slides** — the constitution's *"We don't generate images at launch"* is unamended. **Revival condition: an image pipeline lands.** Until then §6.4 is the shipped product.
3. **A reconciliation job for orphaned promote campaigns** — §3.4's staleness window makes the *draft* reclaimable; a campaign created by a crashed promote that nothing references is bounded and rare, but not swept. If such a job is ever written it **MUST** check the draft's claim state first, exactly as `lib/signals/seed.ts:52-61` instructs for the Stage F analogue.
4. **Fixing the publishing worker's platform allowlist** — §2.8(1). Three of five locked launch platforms cannot publish today. Real, out of scope (L-1), and **flagged not made**.
5. **Guarding Mode 2's unguarded prompt fields** — ADR 0019 §15 item 9's `[sec-HIGH-6]`, still out of scope because L-1 forbids changing Mode 2's generation behaviour.
6. **Multi-platform promote** — one platform per draft, inherited from ADR 0019 §15 item 7.
7. **The skip-review fast path** (ADR 0017 L-11), **`relationship_memory`, embeddings** — unchanged from their existing deferrals.
8. **A `PublishableText` brand across `posts.content`** — §7.2 rejected it on cost for the narrow script case. If the sink ever gains an independent reason to be nominally typed, the script guarantee comes along free.

---

## 16. Stated-open items

Recorded as **open with the command that closes each**, rather than resolved by assumption. Both belong to Q4's number and **must be closed before the Builder writes the migration**.

1. **Does `performance_memory` contain rows exceeding the bound?** The "ships EMPTY" comment (`20260719010000_governed_memory.sql:200-203`) predates Track C, which is **live** and writes through `lib/learning/promote.ts:122` and `lib/learning/summarize.ts:150`. **Closing command:** `SELECT count(*) FROM performance_memory WHERE length(pattern) > 500;` — read-only, cheap, no lock. The result goes in the Builder's step notes, and if non-zero the migration states the remediation before `VALIDATE`.
2. **Do the pattern renderers interpolate unbounded content?** `renderPatternStatement` (`lib/learning/orchestrator.ts:273`) and `renderTierZeroSummary` (`lib/learning/summarize.ts:47`) produce the value written to `pattern`. If either interpolates an unbounded excerpt, a legitimate distillation could organically exceed 500 chars, and §5.3's reject-not-truncate rule would **silently starve `performance_memory`** rather than bound it — degrading Track C's output in a way nobody would notice. **Closing action:** read both functions; if either is unbounded, either bound the interpolation at its source or raise the number with new arithmetic stated here.
3. **Does the distillation worker handle a rejected item per-item or per-batch?** §5.3 requires per-item log-and-skip. The existing tick loop was not verified during this Architect phase. **Closing action:** read the worker; if it fails the batch, that is a Builder fix inside this ADR's scope.

---

## 17. §16 closure record (2026-08-21, additive)

Written after §16 was authored, in the ADR 0014 Amendment A / ADR 0010 Amendment 2 additive form: **§16 is
not edited.** Each item below cites *finding → evidence → consequence for the Builder*. All three were
closed by reading the code at `dd748435`; item 1 additionally carries a production confirmation the Builder
records rather than decides on.

**§16 item 2 — CLOSED: no unbounded interpolation. The item named the wrong function.**

`renderTierZeroSummary` (`lib/learning/summarize.ts:47`) is **not a writer of `pattern`.** It builds
*prompt input*: `summarize.ts:131` maps it over `tierZeroRows` to feed `runPrompt`. Its output never
reaches `performance_memory`. §16 item 2's premise is therefore wrong about that half, and the function
that actually needed auditing is the model-output write at `summarize.ts:150`.

There are exactly **two** production write paths into `performance_memory.pattern` (`git grep` over
`upsertDistilledPerformancePattern` / `recomputeAndUpsertPattern` finds no third non-test caller, and no
migration inserts into the table):

| Writer | Value written | Bound |
|---|---|---|
| `lib/learning/orchestrator.ts:273` → `renderPatternStatement` (`orchestrator.ts:105`) | `` `${KIND_LABEL[kind]} on ${platform}.` `` | Closed set of **9 fixed labels**; longest is 62 chars, plus `" on "` + platform + `"."` → **≈ 80 chars, hard maximum** |
| `lib/learning/summarize.ts:150` | `statement.statement` — raw model output | `z.string().max(LEARNING_SUMMARY_MAX_STATEMENT_CHARS)` = **200** (`lib/ai/prompts/learning-summarizer.ts:16`, `lib/learning/constants.ts:16`), enforced at parse |

**Consequence:** §5.3's reject-not-truncate rule **cannot silently starve `performance_memory`.** The Zod
parse rejects at 200 long before the 500 CHECK is reached, so no legitimate distillation can organically
overflow the bound. Neither writer needs bounding at source, and Q4's number needs no new arithmetic.

**§16 item 1 — CLOSED in code; the query remains as confirmation, NOT as a gate.**

`git log -L16,16:lib/learning/constants.ts` shows `LEARNING_SUMMARY_MAX_STATEMENT_CHARS = 200` landed in
**`387c8c64`** — *the same commit that introduced the summarizer*. There was never a window in which an
unbounded statement could be written. Combined with item 2's writer inventory, **no row exceeding 500 can
exist from any production path.**

**Consequence:** the Builder still runs `SELECT count(*) FROM performance_memory WHERE length(pattern) >
500;` — read-only, cheap, and it catches what static analysis cannot (manual inserts, dev/staging seeds) —
and records the result in the step notes. But it is **not a decision input**: the migration is written
`NOT VALID` + `VALIDATE` in one step regardless. §16's stated fear — that `VALIDATE` becomes the discovery
mechanism `[db-Q4]` — is discharged by the arithmetic above, not by the query result.

**Corollary, recorded so a later session does not "tighten" it as an oversight:** with writers capped at
200 and ≈80, **a 500 CHECK can never fire from a legitimate Track C write.** That is the intended
property — it makes the constraint a pure defence-in-depth guard on the §5 promote-path writer boundary
(A-5), not a live participant in Track C's distillation. **Keep 500. Do not reduce it to 200.**

**§16 item 3 — HALF CLOSED. The row loop is per-item; the statement loop is not. The remainder is a small in-scope Builder fix.**

*The row loop is correct.* `runLearningTick` (`lib/learning/orchestrator.ts:350-351`) calls `processRow`,
whose own `try/catch` (`orchestrator.ts:211`, `orchestrator.ts:284`) funnels every exception into the
permanent/transient handling and **returns without rethrowing**. One rejected row cannot fail the batch.
§5.3's requirement is already met at this level.

*The statement loop is not.* `lib/learning/summarize.ts:146` iterates `output.statements` and awaits
`upsertDistilledPerformancePattern` with **no per-statement `try/catch`**. A CHECK rejection on statement
#2 throws out of `summarizeBusinessLearning` into the per-business catch at `orchestrator.ts:358`. The tick
survives and other businesses are unaffected — but statements #3–5 for that business are **never written**,
and the loss surfaces as a single `summarizeFailed` with `summarizeFailedCode: 'unknown'`, indistinguishable
in the canonical log line from an Anthropic-side outage.

**Consequence — Builder scope (§2), small and bounded:** wrap the `summarize.ts:146` upsert in a
`try/catch` that logs and continues to the next statement, and add a **`summarizeRejected`** counter to
`LearningTickSummary` (`orchestrator.ts:44-58`, initialised at `orchestrator.ts:319-334`) so a bound
rejection is legible as itself rather than as a generic failure. **This is latent today** — nothing can
currently produce a >200-char statement — so it is a correctness-of-the-guard fix, not a live bug, and it
must not be described as one.

### 17.1 — A stale-comment correction the Builder makes in the same commit

The `governed_memory.sql:200-203` "ships EMPTY" comment that `[db-Q4]` caught is **not the only stale
comment in this area.** Two further comments assert that the Tier-0 arithmetic writer has no production
caller:

- `lib/ai/prompts/learning-summarizer.ts:41` — *"the arithmetic Tier-0 writer (lib/learning/promote.ts's `recomputeAndUpsertPattern`) has no production caller yet"*
- `lib/db/memory-performance.ts:51-52` — the same claim, same wording

`lib/learning/orchestrator.ts:270` **is** that production caller, and has been since the tick loop landed.

**Precision matters here:** only the *premise* is stale. Both comments use it to argue that `pattern` text
must **not** be assumed arithmetic-and-therefore-safe — and that **conclusion remains correct and must not
be weakened**; it is now correct for a stronger reason (both writers are live, and there is still no column
distinguishing an arithmetic row from an LLM-summarizer row). The Builder corrects the "no production
caller yet" clause in both comments and leaves the guard posture exactly as it stands. ADR 0022's own
reasoning leans on comment claims in these files, which is precisely why they are corrected rather than
left for the next Architect to re-derive.

---

## 18. Corrections to §6.3 and §9 (2026-08-21, additive)

Two defects found by an audit of this ADR against the code at `dd748435`. Both are corrected **here**, in
the append-only house form — **§6.3 and §9 are not edited**, so the original claims stay legible as what
they were. Neither correction changes a founder adjudication; A-4 and Q5 stand exactly as ruled.

### 18.1 — §9's `upsertDistilledPerformancePattern` row was wrong in three ways, and hid a fourth thing

§9's final row reads:

> `upsertDistilledPerformancePattern` (`lib/db/memory-performance.ts:95`) | `lib/learning/promote.ts:122`,
> `lib/learning/summarize.ts:150`; `recomputeAndUpsertPattern` (`:52`, not yet live) | ADR 0018's existing
> tests + the new bound's Tier-1/Tier-2 | **Yes, deliberately**

**(1) Wrong location.** `recomputeAndUpsertPattern` is at **`lib/learning/promote.ts:109`**.
`lib/db/memory-performance.ts:52` is a *comment mentioning it* — the same stale comment §17.1 corrects.

**(2) Wrong liveness.** It is **live**: `lib/learning/orchestrator.ts:270` calls it in production. The
`[sec-3]` argument §5.2 draws from it is therefore **stronger** than stated, not weaker — see §18.2.

**(3) Double-counted.** `promote.ts:122` **is** `recomputeAndUpsertPattern`'s own upsert call
(`promote.ts:119`, `pattern:` at `:122`). The row lists one call site twice and presents the two as
distinct callers, reporting three callers where there are **two**.

**(4) What the row hid — and this is the reason the rule exists.** The cell "ADR 0018's existing tests"
does not name a test *per caller*, which `SHARED-FUNCTION CALLERS` requires and every other row in §9 does.
Naming them exposes an `AUTHORED-NOT-EXECUTED` gap: **both production callers mock the function.**
`lib/learning/promote.test.ts:16-18` and `lib/learning/summarize.test.ts:23-25` each
`vi.mock('@/lib/db/memory-performance')` with `upsertDistilledPerformancePattern: vi.fn()`, and
`lib/learning/orchestrator.test.ts:71-72` mocks `recomputeAndUpsertPattern` itself. **No Tier-2 test
executes this function's real body through any production caller.** `lib/db/memory-performance.test.ts:168`
does run the real body, but directly and against a stubbed Supabase client — which **cannot** exercise a
Postgres CHECK.

**Corrected row (supersedes §9's final row):**

| Function | Caller | Test covering that caller | Behaviour change? |
|---|---|---|---|
| `upsertDistilledPerformancePattern` (`lib/db/memory-performance.ts:95`) | `recomputeAndUpsertPattern` (`lib/learning/promote.ts:109`, upsert at `:119`) — **live**, driven by `lib/learning/orchestrator.ts:270` | `lib/learning/promote.test.ts` — **MOCKS the function** (`:16-18`); `lib/learning/orchestrator.test.ts` — **MOCKS `recomputeAndUpsertPattern`** (`:71-72`). **`AUTHORED-NOT-EXECUTED` for this caller.** | **Yes, deliberately** — over-length patterns rejected (§5.3) |
| " | `summarizeBusinessLearning` (`lib/learning/summarize.ts:147`, `pattern:` at `:150`) | `lib/learning/summarize.test.ts` — **MOCKS the function** (`:23-25`). **`AUTHORED-NOT-EXECUTED` for this caller.** | **Yes, deliberately** |
| " | *(direct, non-production)* `lib/db/memory-performance.test.ts:168` | Runs the real body against a **stubbed** client — Tier-2 only; **a stub cannot fire a CHECK**, so this is not coverage of the bound | — |

**Binding consequence for the Builder.** `MEM-PATTERN-BOUNDED` (§11.1) is a **DB CHECK** and **Tier-1 is
its only valid home** — live Postgres, in `supabase/__tests__/`, alongside
`performance-memory-promotion.test.ts`. It **cannot** be discharged by a Tier-2 test on either production
caller, because both mock the writer, nor by `memory-performance.test.ts`, because its client is a stub.
A Tier-2 test may prove the *promoter-level Zod bound* (§5.2's input hygiene) — that is a different
guarantee at a different boundary, and it must be labelled as such, never as proof of the CHECK.

This is the same trap §9 already records for `seed.test.ts` mocking `assembleBrief`. It was caught there
and missed here.

### 18.2 — §5.2's "in embryo" framing is stale (same root cause)

§5.2 describes `recomputeAndUpsertPattern` as a writer that *"already exists **in embryo**"* and warns a
summarizer-only bound would be *"silently void **the day it goes live**."* **It is already live**
(`orchestrator.ts:270`), and the citation `lib/db/memory-performance.ts:52` points at the stale comment
rather than the function (`lib/learning/promote.ts:109`).

**The decision is unchanged and its ground is firmer:** the bound belongs at the RPC precisely because a
second writer is **shipping today**, not because one might ship later. §5.5 already states this correctly
(*"Track C … is live"*); §5.2 contradicts it, and §5.2 is the side that is wrong.

### 18.3 — §6.3 overclaims twice: the test does not stay "as written," and the cost is not "one line"

§6.3 states that with `carouselRequested` added, *"`platform-map.test.ts:5-12` stays **true as written**"*
and that, because there is one production caller, *"the cost is one line."* **A-4's ruling that the
parameter is REQUIRED is not disturbed** — the reasoning §6.3 gives for it (forcing the decision to be
visible at every future call site) is accepted and stands. Only the two claims about its cost are corrected.

**`lib/ai/prompts/formats/platform-map.test.ts` contains TEN two-argument call sites of
`selectFormatFamily`.** A required third parameter fails `tsc` at every one. The file **cannot** stay as
written; the true cost is **one production line (`lib/ai/generate-native.ts:98`) plus ten test call sites.**

What survives, and what §6.3 was reaching for: the test's **assertions** stay true — content volume
genuinely is not the carousel trigger, and every existing input resolves byte-identically. L-10 holds in
its strict form. It is the *arity of the calls*, not the *truth of the expectations*, that changes.

**The tension this creates with §8.2, and its resolution.** §8.2 Rot mode 1 warns that a test co-edited in
the same commit as its subject is not evidence — and the Builder is now obliged to edit `platform-map.test.ts`
in the same commit that edits `platform-map.ts`. That is **not** Rot mode 1, and the distinction is
mechanical enough to enforce:

> **The `platform-map.test.ts` diff in the carousel commit MUST change call arity ONLY.** Every existing
> call gains a third argument `false` and **nothing else changes** — not one `expect(...).toBe(...)`
> right-hand side, not one `it.each` platform list, not one description string. Rot mode 1 is an *expected
> value* edited to match new behaviour; this is an *argument list* extended while every expectation is
> preserved byte-for-byte. **The PR must show that diff and state that it contains zero changed
> expectations.** A single altered expectation in that file, in that commit, is an L-10 violation and the
> reviewer treats it as one.

§8.2's frozen `Record<Platform, …>` table remains the primary instrument and is unaffected: it is authored
new, in three-tuple form, and has no "as written" baseline to preserve.

---

## 19. Minor corrections (2026-08-21, additive)

Same append-only form: **§2, §5, §12 and §14 are not edited.** These are citation and completeness defects
only — no decision in this ADR changes.

### 19.1 — §14's table is not, as it claims, consolidated

§14 opens *"Advisory findings, consolidated."* Three refs cited in the body have **no row**:

| Ref | Cited at | Why its absence matters |
|---|---|---|
| `[sec-4]` | §5.2 (rejecting *"refuse the promote"*) and §5.3 (the truncation-as-imitable-instruction argument) | **Load-bearing.** §5.3's reject-never-truncate ruling rests on it; a reader auditing that ruling from §14 finds nothing. |
| `[db-addition]` | §2.8(1) — the publishing worker's `linkedin`/`twitter` allowlist | Flags a real defect deferred to §15.4; absent from the one table that inventories advisory output. |
| `[db-correction]` | §2.8 — `createCampaign` sets no status, so a promoted campaign lands `'draft'` by column default | Corrects a draft assumption; same. |

**Separately, `[type-5]` appears nowhere in this document.** The `type` refs run 1, 2, 3, 4, 6, 7, 8.
Whether a finding was dropped, merged or renumbered during drafting **is not recoverable from the record**,
and this ADR does not invent one. Stated so the gap reads as a known unknown rather than as something lost.

**Consequence:** §14 is a *near*-complete index, not a complete one. Anyone auditing this ADR's advisory
provenance reads §14 **plus** a grep for the `db`/`type`/`sec` ref markers across the body.

### 19.2 — Three citation drifts

| Section | As cited | Correct | Note |
|---|---|---|---|
| §12.1 | `clearCampaignReferenceOnCards` (`lib/db/insight-cards.ts:172-191`) | **`:183`** — `:172-182` is the preceding comment block | The D7 precedent the section turns on |
| §2.2 | `post_id` and `campaign_id` both `NOT NULL` (`20260726010000_learning_capture.sql:32`) | **`:31-32`** — `:31` is `post_id`, `:32` is `campaign_id` | The cite covers only one of the two columns it names |
| §5.2 | CHECK precedent `20260722190000:112-118` | **`:113-118`** — `ADD CONSTRAINT` at `:113`, `CHECK` at `:114`, `VALIDATE` at `:118` | Off-by-one on the range start only |

### 19.3 — Forward pointers §5.3 and §5.5 do not have

Both subsections close by referring the reader to *"a **stated-open** item (§16)"*. **All three §16 items
were closed on 2026-08-21 — see §17.** A reader arriving at §5.3 or §5.5 has no signal of that. Read those
two references as **§16 → §17**:

- §5.3's *"Whether the existing tick loop already does this is a stated-open item (§16)"* → **§17, item 3**:
  the row loop already satisfies it; the **statement** loop does not, and that is a named Builder fix.
- §5.5's *"The count query and its result are a stated-open item (§16)"* → **§17, item 1**: closed in code;
  the query is retained as confirmation and is **not** a gate on the migration.

---

## 20. F1b.11 close-out: the constraint map, re-grepped callers, Tier-3 as executed scans (Session 29, 2026-08-23, additive)

Append-only, same form as §17–19: **§9 and §11 are not edited** — a §9 row correction is given below (§20.3)
as a **corrected row (supersedes §9's `selectFormatFamily` row)**, exactly the pattern §18.1 already
established for the `upsertDistilledPerformancePattern` row. This section is the F1b.11 build step's
required output: every constraint mapped to its executing CI job with *reddens-if-broken* stated per row,
the Tier-3 five re-stated now that four of them are executable scans (not the original "no runtime test by
decision"), and the SHARED-FUNCTION CALLERS re-grep.

**Update — CI-verified (2026-08-23), superseding the local-only note this paragraph originally read:**
`docs/build-guide/session-29.md`'s F1b.11 spec requires real run URLs, not a local claim — PR #6
(`session-29` → `master`, opened solely to trigger CI, not to merge) produced them.

**First attempt reddened for real, and the redden was a genuine bug, not noise.** Run
`https://github.com/tcr430/SOSH/actions/runs/32609638366` (`app-tests`, commit `0601090e`, the original
F1b.11 commit) FAILED both `MODE2-RUNNER-UNTOUCHED` and `MODE3-UNTOUCHED` — this repo has no
`.gitattributes`, so a Windows checkout (`core.autocrlf=true`) normalizes LF→CRLF on disk while the Ubuntu
CI runner keeps LF; hashing raw file bytes made both frozen pins environment-dependent rather than
content-dependent. Fixed in commit `b01a9985` (`readNormalized` strips `\r` before hashing; both frozen
SHA-256 constants recomputed against normalized content) and re-verified locally (redden-then-revert
re-demonstrated for `MODE2-RUNNER-UNTOUCHED`) before pushing.

**Both jobs green at `b01a9985` (the current range head):**

| Job | Run URL | Skip-guard line, quoted verbatim |
|---|---|---|
| `app-tests` | `https://github.com/tcr430/SOSH/actions/runs/32609963073` | `skip-guard: 219 file(s) under [app, lib, components] all visible, zero failures — green. (2963/2963 tests passed)` |
| `db-tests` | `https://github.com/tcr430/SOSH/actions/runs/32609963087` | `skip-guard: 34 file(s) under [supabase/__tests__] all visible, zero failures — green. (309/309 tests passed)` |

**Note on the earlier local `test:db` rate-limiting** this paragraph also originally reported (25/34 files,
9 files / 27 tests all failing `AuthApiError: Request rate limit reached`, never an assertion failure): CI's
`db-tests` job runs against a **local Supabase stack it starts itself** (`supabase/setup-cli@v2.1.1` →
"Start local Supabase stack"), not the hosted dev project this session's local runs hit — so it was never
subject to that rate limit, confirmed by the 309/309 clean result above. The local rate-limiting was
correctly never asserted as a regression signal; it simply wasn't informative either way, and CI is the
authoritative result.

### 20.1 Every ADR 0022 constraint → its executing CI job

| Constraint | Tier → job | Reddens if broken |
|---|---|---|
| `PROMOTE-CLAIM-ATOMIC` | 1 → `db-tests.yml` | The claim guard is removed; two concurrent promoters both succeed. |
| `PROMOTE-WRITEBACK-GUARDED` | 1 → `db-tests.yml` | The write-back stops no-oping on a lost race. |
| `PROMOTE-CLAIM-RECLAIMABLE` | 1 → `db-tests.yml` | A stale claim stops being reclaimable, or a fresh one becomes reclaimable. |
| `PROMOTE-RLS-ISOLATED` | 1 → `db-tests.yml` | Tenant A can read/update tenant B's promote columns, or an UPDATE policy loses its `WITH CHECK`. |
| `PROMOTE-CASCADE-COMPLETE` | 1 → `db-tests.yml` | Erasure leaves a promote-related row behind `businesses` cascade or `purge_business`. |
| `PROMOTE-SOFTDELETE-CLEARED` | 1 → `db-tests.yml` | A soft-deleted campaign leaves a dangling `promoted_campaign_id`. |
| `PROMOTE-BRIEF-END-TO-END` | 1 → `db-tests.yml` | `assembleBrief` stops being driven through promote against real Postgres (the second caller, §9). |
| `LEARN-GENERATION-KIND-WIDENED` | 1 → `db-tests.yml` | The CHECK stops accepting `'studio_promoted'`, or starts accepting an arbitrary value. |
| `MEM-PATTERN-BOUNDED` | 1 → `db-tests.yml` | The `pattern` CHECK stops rejecting an over-length write. |
| `CAROUSEL-SCHEMA-STRUCTURAL` | 2 → `app-tests.yml` | An out-of-bounds slide count or an unknown slide role parses instead of failing `safeParse`. |
| `CAROUSEL-POLICY-SEQUENCE` | 2 → `app-tests.yml` | `validateCarouselPolicy` stops distinguishing `policy_violation` from `invalid_response`. |
| `MODE2-FORMAT-SELECTION-UNCHANGED` | 2 → `app-tests.yml` | Any `(platform, estimatedTweetsWorth, carouselRequested)` row in the frozen table changes value. |
| `MODE2-PROMPT-BYTE-IDENTICAL` | 2 → `app-tests.yml` | The single/thread prompt fixtures stop matching byte-for-byte. |
| `SCRIPT-BRIEF-BOUNDED` | 2 → `app-tests.yml` | `scriptBrief` stops rejecting a string over `SCRIPT_BRIEF_MAX_CHARS`. |
| `PROMOTE-ACTION-VALIDATED` | 2 → `app-tests.yml` | The Zod contract stops enforcing the `max(5000)` copy bound. |
| `PROMOTE-STATES-RENDERED` | 2 → `app-tests.yml` | Any of the seven §10 states stops rendering through the real `PromoteDraftDialog`/`StudioEditor` component. |
| `PROMOTE-CONTRAST-AA` | 2 → `app-tests.yml` | A promote-surface token drops below 4.5:1 in either theme, read live from `app/globals.css`. |
| `PROMOTE-I18N-COMPLETE` | 2 → `app-tests.yml` | en/pt/es key sets diverge. |
| `ACTIVATE-PLANNED-UNCHANGED` | 2 → `app-tests.yml` | A non-promoted campaign's `planned` computation changes. |
| `MEM-PATTERN-SENTINEL-GUARDED` | 2 → `app-tests.yml` | **Added Session 29-D, D1 (MAJOR-1 / A-5).** `neutralizeWithSentinels` is swapped back to a plain pass-through (or removed) at `upsertDistilledPerformancePattern`'s RPC call — a `[/DATA]`-class payload in `pattern` reaches `client.rpc` unneutralized. |
| `RUNNER-UNMODIFIED` | 3 → executable scan, `app-tests.yml` (`lib/scope-scans.test.ts`, `MODE2-RUNNER-UNTOUCHED`) | `lib/ai/runner.ts`'s content hash changes, or a fourth `is*(promptId)` predicate joins the three pre-existing ones. |
| `SCRIPT-NEVER-PUBLISHED` | 3 → executable scan, `app-tests.yml` (`lib/ai/prompts/formats/script-never-published.test.ts`) | `scriptBrief` appears in any file outside the three allowed (`schemas.ts`, `campaigns/[id]/posts/actions.ts`, F1b.9's `AiOutputPreview.tsx`). |
| `MODE3-UNTOUCHED` | 3 → executable scan, `app-tests.yml` (`lib/scope-scans.test.ts`, `MODE3-UNTOUCHED`) | Any of the 16 production files under `lib/signals/` or the opportunities feed changes — combined content hash. |
| `POSTS-DDL-UNMODIFIED` | 3 → executable scan, `app-tests.yml` (`lib/scope-scans.test.ts`, `POSTS-DDL-UNMODIFIED`) | Any migration filed after `20260814220000_insight_card_campaign_id.sql` adds `posts` DDL. |
| `NO-SKIP-REVIEW-PATH` | 3 → executable scan, `app-tests.yml` (`lib/scope-scans.test.ts`, `NO-SKIP-REVIEW-PATH`) | A skip/bypass-review identifier appears in `lib/` or `app/`, or `CampaignStatus` gains a sixth value. |
| `MODE2-CAROUSEL-NO-IMAGE-GEN` | **New at F1b.11**, 3 → executable scan, `app-tests.yml` (`lib/scope-scans.test.ts`) | Any image-generation API call/SDK reference appears in `lib/` or `app/` (L-8, constitution — not one of the original Tier-3 five; added because carousel work makes this concretely checkable for the first time). |

### 20.2 The Tier-3 five, restated: no longer "no runtime test by decision" — four are now executable scans

§11.3 originally enumerated these as diff-verified **by decision, with no runtime test**, per ADR 0015 §2.
F1b.11 upgrades four of the five to actual executable tests (the fifth, `SCRIPT-NEVER-PUBLISHED`, was
already upgraded at F1b.8). This is **not** a re-scoping of what Tier 3 means — `RUNNER-UNMODIFIED`,
`MODE3-UNTOUCHED` and `POSTS-DDL-UNMODIFIED` are hash-pinned/content-scanned rather than git-diffed against
a moving base commit (a base-SHA diff is a point-in-time fact, not a standing test — see `lib/scope-scans.
test.ts`'s header comment for why). All five, restated:

1. `RUNNER-UNMODIFIED` — executable (`MODE2-RUNNER-UNTOUCHED`).
2. `SCRIPT-NEVER-PUBLISHED` — executable (F1b.8, extended at F1b.9 to admit `AiOutputPreview.tsx`).
3. `MODE3-UNTOUCHED` — executable.
4. `POSTS-DDL-UNMODIFIED` — executable.
5. `NO-SKIP-REVIEW-PATH` — executable.

Each was demonstrated to redden against a real, temporary violation and then reverted before this section
was written (a blank-line edit to `runner.ts`; a scratch file with `images.generate(`; a bogus
`ALTER TABLE posts` line in F1b.2's migration; a blank-line edit to `lib/signals/score.ts`; a scratch file
defining `skipReview`) — the demonstration commands and their output are not reproduced here; the test
file's own header comment records what was done.

### 20.3 SHARED-FUNCTION CALLERS — re-grepped at F1b.11's range head

`git grep` re-run for every function named in §9's table, at this range's head. **One new caller was
found** — `selectFormatFamily`'s second caller (`lib/ai/prompts/studio-suggestion.ts:142`), already fixed
during F1b.7 but never reflected in §9's own row, which still reads as it did before F1b.7 (**§9 is not
edited**, per this section's own rule — see §20 preamble).

**Corrected row (supersedes §9's `selectFormatFamily` row):**

| Function | Caller | Test covering that caller | Behaviour change? |
|---|---|---|---|
| `selectFormatFamily` (`platform-map.ts:36`) | `lib/ai/generate-native.ts:106` (production Mode 2 dispatch) **and** `lib/ai/prompts/studio-suggestion.ts:142` — **a SECOND production caller**, found by `git grep` during F1b.7 and missed by §9's original text and the build guide's premise that there was exactly one; **signature gains a required third parameter** (§6.3), fixed at both call sites during F1b.7 | `platform-map.test.ts` + §8's frozen table (both call sites' arity); `lib/ai/prompts/studio-suggestion.test.ts` exercises the SECOND caller's real body — no mock on `selectFormatFamily` or `platform-map` in that file, so this is genuine execution, not `AUTHORED-NOT-EXECUTED` | **No** for every existing input (§6.3), at both call sites. |

No other function in §9 gained a caller this session:

- `assembleBrief` — still exactly two production callers (`lib/campaigns/promote.ts:151`,
  `lib/signals/seed.ts:85`); `lib/signals/seed.test.ts:14` still mocks it (unchanged from §9's existing note).
- `createCampaign` — three call sites confirmed (`promote.ts:96`, `seed.ts:70`,
  `campaigns/new/actions.ts:120`), consistent with §9's "existing callers + promoteDraftToCampaign (NEW)".
- `activateCampaign`, `softDeleteCampaignGuarded`, `approveBriefIfQualified` — one production caller each,
  unchanged.
- `upsertDistilledPerformancePattern` — confirmed exactly two production callers
  (`lib/learning/promote.ts:119`, `lib/learning/summarize.ts:167`), **both mocking it** in their own test
  files (`lib/learning/promote.test.ts:18`, `lib/learning/summarize.test.ts:25`) — `MEM-PATTERN-BOUNDED` is
  discharged in **Tier-1 only** (§18.1's correction, re-confirmed here at F1b.11's range head).
