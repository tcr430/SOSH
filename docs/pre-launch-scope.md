# Pre-Launch Scope — what must exist before we turn it on

> **Status:** **RULED 2026-09-03.** Written 2026-09-02 as a proposal; P-1…P-6 were adjudicated on
> 2026-09-03 and the ruling is recorded in **§12**, which is appended and attributed rather than written
> back over the argument above. This document now governs pre-launch product scope the way
> `launch-checklist.md` governs pre-launch operational readiness.
>
> **Read §12 before acting on §4, §5, §6 or §11** — it moves T2-A into Tier 1, rules T2-B and T2-C,
> corrects a three-way contradiction about image generation, and un-blocks two `docs/ideas.md` items.
>
> **The phase-model change this document records:** what the constitution calls "Phase 2" is **no longer
> post-launch**. Several Phase-2 capabilities are now considered pre-launch. **Video generation stays
> post-launch** — the objective is a close-to-functioning product first, and generative video is the most
> expensive, least differentiating way to reach it.
>
> ⚠️ **This paragraph originally also said image generation stays post-launch. It contradicted `CLAUDE.md`
> and `docs/product-status.md`, both of which place image generation pre-launch, and the constitution
> wins.** §12.5 records the contradiction and its resolution: image generation is **pre-launch, Tier 2**,
> sequenced behind T1-C. The §6 entry has been corrected accordingly.

---

## 1. Why this document exists

`docs/launch-checklist.md` answers **"is what we built safe to turn on?"** — environment variables,
migrations, cron, Sentry, security headers, the Stripe live-mode flip, auth and rate limits, legal slots,
rollback, CI gates, the native-publishing migration. It is a readiness document and it is good at that job.

It never asks **"is what we built enough?"** Nothing in the repo does. That is the gap this file closes.

The two are complementary and meet at one gate:

> **Launch = every row in `launch-checklist.md` is green AND every Tier-1 item here is shipped.**

---

## 2. The finding that settles most of the argument

**The pricing in `CLAUDE.md` already promises three capabilities that have no surface in the product.**

| Plan | Promised in `CLAUDE.md` | Reality |
|---|---|---|
| €79 Plus | *"basic analytics"* | **No analytics route exists.** `post_metrics` is collected by `lib/metrics/orchestrator.ts`; nothing renders it. |
| €79 Plus | *"engagement inbox"* | **No inbox route exists.** `relationship_memory` is explicitly parked (ADR 0016). |
| €125 Pro | *"advanced analytics"* | Same — nothing exists. |
| €125 Pro | *"engagement inbox"* | Same — nothing exists. |

> **Corrected 2026-09-03 (§12).** This table originally read €99/€199 and attributed the engagement inbox
> to Pro alone. `CLAUDE.md`'s locked pricing is **€79 Plus / €125 Pro**, and the inbox is promised in
> **both** tiers. The correction makes the argument stronger, not weaker: the inbox is not a Pro
> differentiator at all, it is a floor-level promise on the cheapest plan.

Dashboard routes today: `approvals`, `billing`, `calendar`, `campaigns`, `create`, `onboarding`,
`opportunities`, `settings`, `studio`. There is no `analytics` and no `inbox`.

This is not a prioritisation question. **A €125 tier whose differentiating line item does not exist cannot
be sold**, and the €79 tier promises *both* basic analytics and the engagement inbox, neither of which
exists. Either the features ship or the pricing page changes — and changing it strips the cheapest plan
back to generation-and-publishing, which is the commodity half of the product.

That argument alone moves the engagement inbox and an analytics surface into Tier 1 without appeal to
strategy.

---

## 3. The bar: what "enough" means

From the agency-replacement objective — replacing or materially augmenting a €10–20k/month agency or a
10–20 person internal team — an agency sells **four** things. Mapping honestly:

| Quadrant | What it means | Today | After Sessions 31–34 |
|---|---|---|---|
| **Judgment** | what to say, why now, to whom | Strong | **Best in market** |
| **Production** | making the artefacts | Text only | Text only |
| **Execution** | publishing **and** engaging | Publishing only | Publishing only |
| **Accountability** | reporting; owning the number | **Nothing** | Learning, no artefact |

**We are 1.5 of 4, and the entire planned quality programme deepens the quadrant we already lead.** Tier 1
below is the minimum that gets to 3.5 of 4 without touching generative media.

---

## 4. Tier 1 — MUST ship pre-launch

*Launch is not meaningful without these. Each is either a promised-but-unbuilt feature or a gap a
prospect finds in the first demo.*

### T1-A — Engagement inbox
**Promised in the Pro tier. Does not exist.** Comments and mentions on the customer's **own** posts,
classified (support / product feedback / qualified interest / objection / advocate / partnership /
content opportunity / reputation risk / routine), with a drafted reply and a human approval gate. No
autonomous public replies, ever — that stays prohibited regardless of evidence.

*Why pre-launch:* it is the missing half of "social media management." For founder-led B2B, replies drive
more pipeline than posts. A prospect asks *"who handles the comments?"* in the first demo.
*What exists:* the triage machinery (`runToolLoop`, the closed read-only tool pattern, the ten-state feed)
transfers almost wholesale. *What's new:* platform read of comments, `relationship_memory` un-parked, the
inbox surface. *Un-parks:* ADR 0016's `relationship_memory`. *Needs:* counsel work on third-party personal
data — the same class as the ADR 0020 §9.6 / ADR 0023 items, **not covered by them**.

### T1-B — Analytics and the monthly report
**Promised in both tiers. Does not exist.** A post/campaign/portfolio analytics surface, plus a generated
monthly report the founder can forward to a board.

*Why pre-launch:* it is priced, and it is the artefact that justifies the subscription internally. An
agency's monthly report is half of what the retainer buys.
*What exists:* `post_metrics` is collected; Session 33 (ADR 0026) produces the patterns and the campaign
retrospective. *What's new:* the surface and the report artefact — **cheap once Session 33 lands**, which
is the argument for sequencing it immediately after.

### T1-C — Carousels via templates (NOT image generation)
LinkedIn document carousels are structured text rendered to a deck. **No diffusion model, no generative
imagery, no brand-safety surface.**

*Why pre-launch:* roughly half of what an agency produces is visual, and carousels are the highest-reach
native format for this ICP. A text-only tool loses the side-by-side comparison.
*What exists:* carousel is already a shipped `FormatFamily` branch (schema, policy, platform-map
selection) — **only the sourcing that would set it true is deferred** (ADR 0022 §6.3, Session 29-D D6).
*What's new:* the sourcing, a template system, and rendering. *Note:* this deliberately keeps the
constitution's "no image generation at launch" rule intact — it is not a loophole, it is a different
capability.

### T1-D — The founder input engine (structured async interview)
A recurring, structured prompt set — 5–8 questions, chosen by which memory types are thin — that writes
directly into evidence and audience memory.

*Why pre-launch:* **this is the input problem, and nothing else solves it.** Session 32's backfill reads
what was already published; it cannot reach what was never written down. Agencies run a monthly interview
because that is the only way to get a founder's stories, opinions and proof out. Without it, memory
plateaus at whatever the customer has already posted, and output quality plateaus with it.
*What exists:* nothing. *Size:* moderate — it is prompts, a schedule, a surface, and memory writes.
*Highest-leverage unbuilt feature in the product.*

### T1-E — Founder / personal profile support
**Added 2026-09-03 by the §12.2 ruling** (promoted from T2-A, which this document had listed as blocked
by a constitution rule that no longer exists). The founder's personal LinkedIn/X profile, connected to the
business workspace, generated in a distinct founder voice through the existing ADR 0011 variation
machinery, with the approval gate unchanged. **Full scope and exclusions: §12.2.**

*Why pre-launch:* in B2B SaaS the founder's personal account routinely outperforms the company page
several times over, and it is what agencies actually ghostwrite. `CLAUDE.md`'s locked platform list
already promises it.

---

## 5. Tier 2 — SHOULD ship pre-launch (founder ruling needed)

> **RULED 2026-09-03 — see §12.2/§12.3.** T2-A is **approved and promoted to Tier 1** (it is already a
> locked decision in `CLAUDE.md`'s platform list, so this document was the stale one). T2-B is
> **approved as Tier 2** with a shape constraint. T2-C is **un-deferred** and owned by Session 34 Q4.
> T2-D (image generation) is **added** by that ruling. The argument below is left exactly as written.

*Launch survives without these, but is materially weaker. Each carries a constitution conflict, which is
why each needs an explicit decision rather than a default.*

### T2-A — Founder / personal profile support ('Blocked')
**Conflicts with the locked decision *"we don't support personal social accounts (business accounts
only)."***

In B2B SaaS the founder's personal LinkedIn routinely outperforms the company page several times over, and
ghostwriting for founders is what the good agencies actually sell. **This may be the largest ICP mismatch
in the constitution** — it excludes the highest-value surface for exactly the customer we chose.
*What exists:* the voice-variation machinery (ADR 0011) already supports a distinct founder voice.
*Ruling needed:* amend the locked decision, or accept that the product cannot serve its ICP's best channel. - 'Approved'

### T2-B — Content mining from connected sources ('Blocked')
Changelogs, GitHub PRs, Linear, docs, call transcripts — the chat doc's "content mining," of which only
GitHub releases and RSS are built.
*Why it might wait:* T1-D (the interview) covers the same need at a fraction of the cost, and each new
source is an integration plus a counsel question. 'Approved'

### T2-C — Cross-set redundancy detection ('Blocked')
`MODE2-REDUNDANCY-UNDEFER` — *"these two posts make the same argument."* Session 34 Q4 must decide it
anyway; this records that it is a launch-quality question, not only an architectural one.
**→ RULED 2026-09-03: un-deferred, owned by Session 34 (§12.4).**

### T2-D — Image generation
**Added 2026-09-03 by the §12.5 ruling**, which resolved a three-way contradiction: `CLAUDE.md` and
`docs/product-status.md` both place image generation pre-launch, while §6 of this document placed it
post-launch. The constitution wins. **Tier 2 and sequenced behind T1-C** — template carousels close most
of the visual gap first, and T2-D is judged against what is still missing after they land. Gating
conditions (brand-safety path, per-image human approval, cost ceiling): §12.5.

---

## 6. Tier 3 — Explicitly POST-launch

*Named so no future session quietly pulls one forward.*

- ~~**Image generation** (diffusion / generative imagery)~~ — **MOVED to Tier 2 (T2-D) on 2026-09-03,
  §12.5.** `CLAUDE.md` places image generation pre-launch and in scope; this entry contradicted the
  constitution. The reasoning that put it here still holds as *sequencing*: it is expensive, brand-risky,
  and **T1-C closes most of the visual gap without it** — so it ships after T1-C, not instead of it.
- **Video generation and editing** — stays post-launch. Same reasoning, more so, and unchanged by the
  2026-09-03 ruling.
- **Paid amplification** — excluded by strategy.
- **Multi-channel** (newsletter, blog, SEO) — a deliberate boundary; say so in the pitch rather than
  letting a prospect discover it.
- **Full social listening** — beyond the user-defined watch list.
- **Autonomous publishing or autonomous public replies** — never, at any phase.

**And what software cannot replace at all, which the pitch should state plainly:** relationships and PR,
live event coverage, crisis judgment, influencer negotiation, filmed production, and absorbing blame.

---

## 7. Already in flight

`docs/build-guide/session-31.md` … `session-34.md` (ADRs 0024–0027) are authored and Architect-ready:
generation quality, the social read path and cold-start backfill, the outcome loop, and agency in
generation. **They are pre-launch by assumption, not by decision** — this document makes that explicit,
and notes that **T1-B depends on Session 33** and **T1-A reuses Session 34's tool patterns**.

The existing hardening queue (`current-phase.md` "Next up") is unchanged and still blocking: legal gates,
perf/CWV, and the `db-tests` promotion tally. (The native-publishing migration that used to be on this
list — Session 30.5, ADR 0028 — is complete in code; production OAuth apps are not yet registered, tracked
in `launch-checklist.md` §16.)

---

## 8. The risk this document creates, and its mitigation

**Naming Phase 2 as pre-launch is how launches slip forever.** Four Tier-1 features plus four quality
sessions plus the hardening queue is roughly **ten to twelve sessions** of work, and every one of them will
suggest a fifth thing that "obviously" belongs before launch.

Three mitigations, all of which need a founder decision:

1. **Freeze the list.** Tier 1 is closed once ruled. A new pre-launch candidate does not get added — it
   displaces an existing Tier-1 item, explicitly and in writing.
2. **Set a date, not a scope.** Pick a launch date and let Tier 2 fall away rather than letting the date
   move. Tier 1 exists precisely so this is survivable.
3. **Consider launching on the augmentation claim first.** *"Significantly augments a marketing team"* is
   true with far less than *"replaces a €10–20k agency."* It is the easier claim, the easier sale, and it
   buys the time to earn the harder one. **This is the cheapest way to de-risk everything above.**

---

## 9. Constitution amendments this implies

`CLAUDE.md` says *"Update it deliberately — any change here affects every future session."* These are the
exact lines that go stale the moment this document is ruled on. **None has been changed yet.**

| # | `CLAUDE.md` line | Change needed |
|---|---|---|
| **C-1** | *"Current phase: Phase 1 — MVP (in progress)"* | **DONE (2026-09-03).** `CLAUDE.md` now reads *"Pre-launch (in progress)"* and restates the phase model, pointing at §6 for the post-launch boundary |
| **C-2** | Pricing: Plus *"basic analytics"*, Pro *"advanced analytics, engagement inbox"* | Either T1-A/T1-B ship, or the pricing page changes. **Do not launch with the current wording and neither feature** |
| **C-3** | *"We don't have a free forever tier"* / *"card required upfront"* | **No change — closed.** The growth track that would have challenged these was declined in full (`docs/ideas.md` §1), and its document no longer exists. Both locked decisions stand |
| **C-4** | *"Launch platforms: LinkedIn (Business and Founder), X (Business and Founder)…"* | **Already applied.** `CLAUDE.md` carries founder profiles in the locked platform list; **this document was the stale one** and §12.2 corrects it. What remains is implementation, not amendment |

---

## 10. The launch gate

Launch when **all** of these hold:

- [ ] Every row in `docs/launch-checklist.md` §1–§16 is green
- [ ] `db-tests` promoted to a required gate (three consecutive green `master` runs, ADR 0015 §5)
- [ ] **T1-A** engagement inbox shipped, with its counsel work closed
- [ ] **T1-B** analytics surface + monthly report shipped
- [ ] **T1-C** template carousels shipped
- [ ] **T1-D** founder input engine shipped
- [ ] **T1-E** founder/personal profile support shipped (promoted from T2-A, §12.2)
- [ ] Sessions 31–34 closed (or explicitly descoped, in writing, with what is lost recorded)
- [ ] Every Tier-2 item is **either shipped or explicitly deferred with a named un-defer trigger**
- [ ] `CLAUDE.md` amendments C-1…C-4 applied, and the pricing page matches what actually exists
- [ ] The pitch states the §6 boundaries plainly — what this does not do, and what software cannot do

---

## 11. Open decisions blocking this document

> **ALL SIX RULED 2026-09-03 — see §12.** The table below is left as written; §12.7 records each answer.

| # | Decision | Owner |
|---|---|---|
| **P-1** | Ratify Tier 1 as the closed pre-launch list | Founder |
| **P-2** | Rule on each Tier-2 item: pre-launch, or deferred with a trigger | Founder |
| **P-3** | T2-A — amend "business accounts only", or accept the ICP gap | Founder |
| **P-4** | Date-driven or scope-driven launch (§8 mitigation 2) | Founder |
| **P-5** | Launch on the augmentation claim first, or hold for the replacement claim (§8 mitigation 3) | Founder |
| **P-6** | Apply the C-1…C-4 constitution amendments | Founder |

~~Until P-1 is ruled, this document is a proposal.~~ **P-1 was ruled on 2026-09-03 (§12.7); this document
is now binding on pre-launch product scope.** `docs/current-phase.md` and `docs/launch-checklist.md`
remain authoritative for working state and readiness respectively.

---

## 12. Founder ruling and amendment (2026-09-03) — APPENDED, NOT REWRITTEN

> **Author:** founder ruling, recorded by the 2026-09-03 documentation session.
> **Form:** the house amendment form (ADR 0021 §16 / ADR 0010 Amendment 2). Everything above this heading
> is the document as written on 2026-09-02, except for four **factual** corrections that are each marked
> inline where they occur (§2's pricing table, the header's image-generation paragraph, §6's image entry,
> §9's C-1/C-3/C-4 rows). **No argument above has been altered, and no tier label above has been silently
> rewritten** — the moves are recorded here and pointed to from there.
>
> **Occasion:** the positioning documents written on 2026-09-02/03 (`docs/product-vision.md`,
> `docs/product-status.md`) sharpened the claim this product is measured against — *the judgment and
> consistency of a €10–20k/month agency, priced as software* — and the founder asked for the constrained
> ideas to be unblocked. This section rules P-1…P-6, moves what the new positioning moves, and un-blocks
> `docs/ideas.md` §2.2 and §2.5.

### 12.1 The principle the whole ruling follows

The vision document names the moat in one line: **the value is what the system knows, so the input
problem is the real problem**, and the differentiator is *judgment*, not generation.

That gives a single, mechanical test for every item below:

> **Does it put more of the customer's own reality into the system, or does it make the system's judgment
> more accountable? If neither, it is not pre-launch.**

Every promotion in this section passes that test. Every deferral fails it. Nothing is ranked by how
impressive it demos.

### 12.2 T2-A — founder/personal profiles: **APPROVED, promoted to Tier 1 as T1-E**

**This document was stale, not undecided.** `CLAUDE.md`'s locked strategic decisions already read
*"Launch platforms: LinkedIn (Business and Founder), X (Business and Founder)…"*, and
`docs/product-status.md` records founder profiles as *"in the platform list as a decision, but not
implemented."* The "business accounts only" rule T2-A worried about **no longer exists in the
constitution**. The open question was never whether to allow it — it was who owns building it.

**Ruling:** founder/personal profile support is **Tier 1 (T1-E)**. In B2B SaaS the founder's personal
LinkedIn routinely outperforms the company page several times over, and ghostwriting for founders is what
the good agencies actually sell. Launching without it means the ICP's best channel is the one channel we
do not serve.

**Scope of T1-E:** connecting a personal LinkedIn/X profile as an account belonging to the business
workspace; the existing voice-variation machinery (ADR 0011) carrying a distinct founder voice; and the
approval gate unchanged — a founder's personal account is *more* sensitive, not less, so nothing about
human-in-the-loop relaxes. **Out of scope:** multi-founder workspaces, per-person seats mapped to
personal accounts beyond what ADR 0013/0014 already give, and anything resembling posting as a person who
has not personally connected their own account.

**This changes Session 32.** The backfill's highest-value corpus for a founder-led company is the
founder's own personal history, not the company page's. Session 32's read path must be account-shaped,
not org-shaped — see §12.8.

### 12.3 T2-B — content mining from connected sources: **APPROVED as Tier 2, with a shape constraint**

Approved, and deliberately **not** promoted to Tier 1, because §12.1's test is passed more cheaply by
T1-D (the founder interview) and Session 32 (the backfill). Both reach the same goal — more of the
customer's reality in the store — with no new integration and no new counsel question each.

**The shape constraint, which is binding on whichever session builds it:** `docs/ideas.md` §5 rejects
*"a twelfth shallow integration"* and the constitution rejects breadth for its own sake. So T2-B ships as
**depth on few sources, not breadth on many**. Concretely: **at most two new sources pre-launch**, each
chosen because it is where this ICP's raw material actually lives — the ordering is **(1) changelog /
release notes beyond GitHub, (2) call transcripts**, because a transcript is the only source that reaches
the founder's spoken reasoning, which is the thing T1-D is otherwise buying at interview cost. Linear,
Notion and Slack are **not** pre-launch: they carry team-internal chatter whose signal-to-noise is worse
than the two above and whose personal-data surface is larger.

**Each source inherits ADR 0020/0023's full ingestion discipline** — untrusted-content neutralisation,
deterministic dedup, per-source eval slice, and its own counsel line. A source that cannot state its
lawful basis does not ship, regardless of this approval.

### 12.4 T2-C — cross-set redundancy: **UN-DEFERRED. `MODE2-REDUNDANCY-UNDEFER` is triggered.**

*"These two posts make the same argument"* is a **judgment** claim, and judgment is the quadrant the
positioning stakes everything on. A campaign that argues the same thing three ways is exactly what a
customer would have got from the cheap tool they are leaving.

**Ruling:** the deferral recorded in `lib/campaigns/consistency.ts` and ADR 0022 §8 item 4 is lifted.
**Session 34 (ADR 0027) owns it** — its Q4 was going to have to decide it anyway, and the campaign
planner is the component that reasons over the set. Session 34's ADR must now record this as a *ruled
un-defer with an owner*, not as an open question it may leave closed.

**What this does not authorise:** an embeddings-based similarity check inside Mode 3 Stage B. See §12.6 —
the two are different mechanisms in different places, and conflating them is the failure mode.

### 12.5 Image generation: the three-way contradiction, resolved as **Tier 2 (T2-D)**

Three documents disagreed:

| Document | Said |
|---|---|
| `CLAUDE.md` "What we don't do" | *"**Image generation is pre-launch and in scope**"* |
| `CLAUDE.md` §"Current phase" | image generation is among the capabilities *"now pre-launch"* |
| `docs/product-status.md` | *"Image generation — now scoped as pre-launch, not started"* |
| **this document**, header + §6 | image generation is **post-launch** |

**The constitution wins, and this document was wrong.** Image generation is **pre-launch, Tier 2
(T2-D)**, sequenced **behind T1-C**: template carousels close most of the visual gap at a fraction of the
cost and with no brand-safety surface, so they ship first and T2-D is judged against what is still
missing after they land. **Video generation and editing remain post-launch, unchanged.**

T2-D's gating conditions, so it cannot arrive as an unbounded surface: a brand-safety review path, a
human approval gate on every generated image (it is a published artefact, so §12.1's honesty rules apply
in full), and a cost ceiling in the `SIGNAL3-COST-CEILING-ATOMIC` form.

### 12.6 `docs/ideas.md` §2.5 — voice exemplars and similarity retrieval: **UN-BLOCKED**

**The block was a category error, and correcting it costs nothing.**

`SIGNAL-NO-EMBEDDINGS` (ADR 0020 §6.5 / §12, re-affirmed ADR 0023 §4.1) is a constraint about **Mode 3
Stage B**: it exists to keep signal *scoring and dedup* deterministic and exactly testable — *"a
non-deterministic component inside the one half of Mode 3 that is supposed to be exactly testable."*
Every clause of that reasoning is about scoring candidates for the opportunity feed.

**Retrieving a customer's own six best past posts to condition a generation call is a different
mechanism, in a different module, with a different failure mode.** It touches no scorer, no dedup key and
no fixture; if it retrieves badly the result is a weaker draft a human still reviews, not a
non-reproducible pipeline.

**Ruling:** similarity retrieval **inside `lib/memory/` for generation-time conditioning is unblocked**.
`SIGNAL-NO-EMBEDDINGS` is **not retired** — it is **scoped**, explicitly, to Mode 3's deterministic half,
and its revival condition (a measured near-duplicate card rate, ADR 0023 §4.1) stands untouched for that
use. Amendment notes are appended to ADR 0020 and ADR 0023 recording exactly this, so no future session
reads this ruling as having opened Stage B.

**Binding conditions on the session that builds it:**
1. **No embedding call anywhere in `lib/signals/`.** The source scan that enforces the signals boundary
   should be extended to prove it, so the scoping is a test rather than a promise.
2. **Retrieval stays scored and capped** (`lib/memory/constants.ts`) — similarity becomes one term in the
   existing confidence × recency × scope ranking, never a replacement for it.
3. **Exemplars are performance-weighted and provenance-marked**, per Session 32 L-3/L-6. Six mediocre
   posts teach mediocrity, and a backfilled exemplar is not the same claim as an earned one.
4. **It needs a corpus, so it is sequenced after Session 32.** This ruling unblocks it; it does not
   schedule it into Sessions 31–34, whose scope fences stay closed (§12.8).

### 12.7 `docs/ideas.md` §2.2 — memory-driven opportunity cards: **UN-BLOCKED, with its own gate**

The `evergreen-strategic` source reads **the customer's own memory** — unused evidence, unanswered
objections, coverage gaps, staleness, recurrence. No external dependency, no counsel question, and it is
the only source that guarantees a non-empty feed. Against §12.1's test it is the single best-scoring
unbuilt item in `ideas.md`: it converts what the system knows directly into what it proposes, which is
the product's whole thesis in one component.

**Ruling: un-blocked.** ADR 0021 §12's second-source gate — and Amendment A's explicit statement that the
market-responsive override *"does NOT travel"* to a third source — is **overridden for this source and
this source only**, and recorded as an override rather than argued as satisfied. An amendment note goes
on ADR 0021.

**Why an override is defensible here specifically:** §12's gate protects against *scaling an unproven
judgment component over untrusted external content*. This source ingests **nothing external**. Its inputs
are rows the customer's own product usage produced, already governed, already tenant-scoped, already
carrying source/confidence/recency. The risk §12 was written about is largely absent.

**The gate that replaces it — all four binding:**
1. **Its own per-source eval slice**, with per-source metrics and floors, never blended (ADR 0023 §2.7's
   rule, inherited).
2. **Its own shortlist allocation cap** in `TRIAGE_SHORTLIST_PER_TICK`, minority-capped on arrival like
   the market-responsive source was, lifting only on a defined precision graduation.
3. **A memory-population precondition.** It does not ship before Sessions 32 and 33 have landed. Over an
   empty store it emits thin, obvious observations — which is *worse* than an empty feed, because it
   trains the customer to stop opening it.
4. **A volume ceiling per business per week**, because the failure mode of a source that can always
   produce something is a feed nobody reads.

### 12.8 What is deliberately NOT unblocked

| Item | Status after this ruling | Why |
|---|---|---|
| **The agent swarm** (agents messaging each other) | **STILL REJECTED** — explicitly excluded by the founder from this ruling | `docs/ideas.md` §5 stands verbatim: handoffs serialise away the unified context governed memory exists to build, regressions become unattributable, and cost multiplies on coordination rather than quality |
| **§2.3 background proposal agents** (the shared-memory cohort) | **Unchanged — `OPEN`**, needing no ruling | It was never blocked. It stays a blackboard, never a conversation. Its real gate is noise, and §12.7's per-source volume ceiling is the same mechanism it will need |
| **Autonomous publishing / autonomous public replies** | **Permanently prohibited** | Not a risk control awaiting better data — it is the product promise |
| **Growth and distribution set** (`ideas.md` §1) | **Still declined** | Founder review 2026-09-02; unchanged |
| **Growth simulator / virality prediction** | **Still parked** | It would require claiming causal precision the data cannot support, which violates the honesty property the vision names as the reason a founder is willing to press publish |
| **Deliberate experimentation (organic A/B)** | **Still parked** | Parked on *volume*, not on a ruling. No ruling can create n |
| **Video generation** | **Still post-launch** | §12.5 |
| **Sessions 31–34 scope fences** | **Unchanged** | Nothing in this ruling is pulled into an authored session. §12.6 and §12.7 create work for **Session 35+**, and the guides' "does NOT ship" lists stay closed — they are what makes a quality regression attributable |

### 12.9 P-1…P-6, answered

| # | Decision | Ruling |
|---|---|---|
| **P-1** | Ratify Tier 1 as the closed pre-launch list | **Ratified, with T1-E added** (§12.2). Tier 1 is now A–E and is **closed**: a new candidate must displace an existing item, explicitly and in writing (§8 mitigation 1) |
| **P-2** | Rule each Tier-2 item | **Done.** T2-A → Tier 1 (§12.2); T2-B → Tier 2 with the two-source shape constraint (§12.3); T2-C → un-deferred to Session 34 (§12.4); T2-D image generation added (§12.5) |
| **P-3** | T2-A — amend "business accounts only" | **Moot.** The constitution no longer contains that rule; this document was stale (§12.2) |
| **P-4** | Date-driven or scope-driven launch | **Scope-driven, with Tier 1 closed.** The freeze in §8 mitigation 1 is what makes this survivable, and it is now binding rather than proposed |
| **P-5** | Launch on the augmentation claim first | **Yes — augmentation first.** `docs/product-vision.md` already frames it this way (*"Now — augmentation"*), and it is the claim the current product can actually defend. The replacement claim is earned by closing T1-A…T1-E, not by marketing |
| **P-6** | Apply the C-1…C-4 constitution amendments | **C-1 done; C-3 closed with no change; C-4 already applied in `CLAUDE.md`** (§9). **C-2 remains open and is the one hard gate**: the pricing wording and the shipped product must match before launch |

### 12.10 What this ruling costs

Tier 1 is now five items, not four, and Tier 2 is three. The honest read of §8's warning is that this
ruling **made the risk it names worse**, and it should be read as such rather than as tidy progress. Two
things hold it: Tier 1 is closed by P-1, and P-5 means we launch on the augmentation claim, which the
product can defend at Tier 1 without waiting for Tier 2.

_End §12. Nothing above this heading was rewritten, beyond the four inline-marked factual corrections._
