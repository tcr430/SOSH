# Ideas — the unimplemented backlog of possibilities

> **What this is:** every idea raised for Jemip that is **not built and not committed**, in one place, with
> an honest status and the reason it hasn't happened. Consolidated 2026-09-02 from the brainstorm set
> (`docs/brainstorm/Chat/`, the archived planning docs, and the growth ideas doc), plus everything raised
> in strategy conversations since.
>
> **What this is not:**
> - **Not `docs/backlog.md`** — that holds *committed* deferred work with named un-defer triggers.
> - **Not `docs/pre-launch-scope.md`** — that holds *ruled* scope. An item that graduates into pre-launch
>   scope is **removed from here** and lives there instead.
> - **Not a roadmap.** Nothing here is scheduled. Ordering within a section is by assessed value, not by
>   commitment.
>
> **Status legend:** `OPEN` (live candidate) · `BLOCKED` (needs a named ruling) · `PARKED` (deliberately
> not now, with the reason) · `REJECTED` (argued down — recorded so it doesn't come back untested).
>
> **Updated 2026-09-03 — founder ruling.** `docs/pre-launch-scope.md` §12 un-blocked **§2.2** and
> **§2.5** below (both now `UNBLOCKED`, each with binding conditions), and ruled the three Tier-2 items
> that lived in that document. **The agent swarm (§5) was explicitly excluded from the ruling and stays
> `REJECTED`.** Statuses below are edited in place; the ruling itself, with its reasoning and conditions,
> is in that document and is the authority.

---

## 0. Housekeeping notes from the consolidation

- **`growth-sensation-ideas-and-build-path.md` no longer exists.** It was untracked and never committed;
  its content is absorbed into §1 below. It had proposed Sessions 31–34 / Tracks H–K / ADRs 0024–0027 for
  the growth features — **those identifiers are now owned by the quality build guides**
  (`docs/build-guide/session-31.md`…`34.md`). Every growth item here is therefore **unscheduled**, with no
  session number attached.
- **Five brainstorm docs were archived** to `docs/brainstorm/archive/` on 2026-09-02: campaign-modes,
  intelligence-layer, session-plan-0016-0018, plan-vs-implemented gap analysis, and media-generation.
  Their unimplemented content is captured below; the originals stay readable for their reasoning.
- **Still live in `docs/brainstorm/`:** `ai-quality-track-ideas-and-build-path.md` (drives Sessions 31–34)
  and `Chat/` (the two founding strategy documents — source material, not superseded).

---

## 1. Growth and distribution — `REJECTED` (founder review, 2026-09-02)

**The whole growth-and-distribution set was reviewed and declined.** It is recorded here rather than
deleted so it does not get re-proposed as a fresh idea in six months.

The set was: a public no-signup "60-second brand brain" preview; a free, cardless daily-brief tier as a
top-of-funnel wedge; a public "Content X-Ray" teardown of any company's social presence; claimable public
brand pages at `/b/<slug>`; a "Reply Radar" 15-minute-window alerting surface; and dogfooding Jemip in
public.

**Founder's reason:** the ideas themselves were not wanted. What was valuable in that document had already
been captured in `ai-quality-track-ideas-and-build-path.md`, which remains live and drives Sessions 31–34.

Two of these also carried structural blockers independent of the founder's view, worth keeping on record
in case any part is ever revisited: the free-brief tier contradicted two locked decisions (*no free forever
tier*, *card required upfront*), and both the X-Ray and Reply Radar depended on platform read access for
accounts the customer does not own — hostile on LinkedIn, priced per read on X, and carrying a counsel
question the existing ADR 0020/0023 blockers do **not** cover.

---

## 2. Intelligence and memory

*From `ai-quality-track-ideas-and-build-path.md`. Items T1.2–T1.5, T2.1, T2.2, T2.4 and §11–§12 are
**committed** to Sessions 31–34 and are therefore not listed here.*

### 2.1 Memory as a platform substrate — many writers · `OPEN`
Memory has **eight readers and one writer** (`lib/learning/orchestrator.ts`). Every human decision in the
product is a labelled example, and almost all are discarded: approvals rejections, feed dismissals, card
expiries, calendar reschedules, Studio discards, brief regenerations, and the dismiss *reasons* signals
triage already captures and drops. Add a write path from each decision surface.
*Also here:* widening `MemoryQueryContext` beyond its three optional fields, cross-type retrieval (today
four independent capped calls → at most 18 records chosen without reference to each other), and the write
governance many writers require — provenance, contradiction detection, confidence arithmetic.

### 2.2 Memory-driven opportunity cards — the fourth signal source · `UNBLOCKED` (2026-09-03)
The `evergreen-strategic` opportunity type from the founding strategy doc — the one category with no
session behind it. Its **source is memory itself**: unused evidence, unanswered objections, performance
gaps, coverage gaps, recurrence, staleness, repetition. Most triggers are arithmetic over memory rows.
*Why it's the best source:* no external dependency, no counsel blocker (it reads the customer's own data),
and it is the only source that guarantees a non-empty feed.
*Was blocked on:* ADR 0021 §12's second-source override explicitly does **not** travel to a third source
(ADR 0023 §17 A1) — it needed its own amendment and a new shortlist allocation.
**Un-blocked by `docs/pre-launch-scope.md` §12.7**, which overrides §12's gate **for this source only**
(it ingests nothing external — the risk that gate was written about is largely absent) and records the
override as one. ADR 0021 carries the amendment note. **Four binding conditions replace the gate:** its
own per-source eval slice with un-blended floors; its own minority-capped shortlist allocation; **it does
not ship before Sessions 32 and 33 have landed** (over an empty store it emits thin, obvious
observations, which is worse than an empty feed); and a per-business weekly volume ceiling.

### 2.3 Background proposal agents — the per-client cohort · `OPEN`
Independent scheduled producers — staleness, coverage, evidence-gap, repetition, living drafts — sharing
one governed memory and emitting into **one proposal object**, surfaced in the **existing opportunity
feed**. Per-agent, per-client accept rates decide which agents stay switched on.
*The architectural rule:* **a blackboard, not a conversation.** Agents coordinate *through the shared
store*, never by messaging each other. That preserves attribution and measurement; synchronous agent
chains destroy both.
*The real risk:* noise. Six agents × several proposals a week ends with a customer who stops opening the
feed — at which point the human gate becomes a rubber stamp. Hard per-agent volume ceilings and
accept-rate auto-disable are not optional.

### 2.4 Living drafts · `OPEN`
A scheduled post stays alive until it publishes. If the world moves underneath it — a competitor
announcement, a stale statistic, a better-performing hook in the brand's own memory — Jemip proposes a
**diff** at the approval gate rather than silently rewriting.
*Why it's defensible:* it needs a live signal layer, governed memory with freshness semantics, an approval
gate, and diff infrastructure — all four exist here and nowhere else together. It is also the natural
first instance of §2.3's proposal object.

### 2.5 Voice exemplars and similarity retrieval · `UNBLOCKED` (2026-09-03)
Six of the customer's own best posts, selected by similarity to the task, beat twenty voice rules. Also
underpins "find my similar past posts", repetition detection, and few-shot from the edit corpus.
*Was blocked on:* `SIGNAL-NO-EMBEDDINGS` was **re-affirmed**, not retired, in ADR 0023 §4.1 — but that
constraint was written about Stage B *scoring*, and retrieval is a different use.
**Un-blocked by `docs/pre-launch-scope.md` §12.6**, which rules the block a category error:
`SIGNAL-NO-EMBEDDINGS` is **scoped** to Mode 3's deterministic half rather than retired, and its revival
condition stands untouched **for that use**. Similarity retrieval inside `lib/memory/` for
generation-time conditioning is unblocked. ADR 0020 and ADR 0023 carry the amendment notes.
**Binding conditions:** no embedding call anywhere in `lib/signals/` (extend the source scan so the
scoping is a test, not a promise); similarity is one term inside the existing scored-and-capped ranking,
never a replacement for it; exemplars are performance-weighted and provenance-marked; and it is sequenced
**after Session 32**, which supplies the corpus.

### 2.6 Deliberate experimentation (organic A/B) · `PARKED`
Vary one tagged dimension on purpose and attribute causally rather than correlationally.
*Parked because:* it needs volume the product does not yet have. Revisit after the outcome loop has run
long enough to produce a baseline.

---

### 2.7 Outbound-activity backfill — their own comments and reactions · `OPEN` (feasibility-gated)
**The third leg of cold-start, and the one no session covers.** Session 32 backfills what the customer
**published**; ADR 0016 / Session 32 L-2 deliberately excludes comments and replies **on** their posts
(third-party personal data, deferred to counsel, un-parked by the engagement inbox). Neither covers the
customer's own **outbound** activity: the comments **they wrote** on other people's posts, and the posts
**they reacted to**. A grep across `docs/build-guide/` returns nothing for either.

*Why it is worth more than it looks:*
- **A comment they wrote is their own authored content, and it is unpolished.** That conversational
  register is exactly what performs on these platforms and exactly what a website-inferred voice gets
  wrong. As a voice corpus it is plausibly better than their published posts, which are edited.
- **What they reacted to is near-pure `audience_memory` input** — what they care about, whose work they
  rate, which arguments they endorse — at essentially no synthesis cost.

*The data-scope split that keeps this on Session 32 L-2's side of the line:* their own words and
**derived** topic/interest labels are their data, their account, their controller relationship — the same
argument L-2 uses to justify reading their published posts. **The third-party post the action attaches to
is not**, and must not be retained. An implementation that stores the target content has quietly become
the comment-mining path L-2 deferred, and inherits its counsel condition.

*Blocked on feasibility, not on a ruling* — and this is probably decisive: **the platforms may not serve
it.** LinkedIn does not meaningfully expose a member's own comment or reaction history through its API,
which is the platform where the value would be highest. `docs/build-guide/session-32.md` Q1 now requires
the Architect to answer this per platform in the same honest table as `fetchRecentPosts`, so the answer
is recorded rather than assumed. **If a platform cannot serve it, that is the finding** — and T1-D (the
founder interview) is the mechanism that reaches the same material by asking instead of reading.

*Sequencing:* it rides on Session 32's read path or it does not happen — a second historical-read
integration built separately would be waste. But it is **not** in Session 32's scope; Session 32 answers
only whether it is possible.

---

## 3. Product surface

*Mostly from `docs/brainstorm/Chat/`. Each would change how the product feels rather than what it knows.*

- **Command palette (⌘K), contextual rather than conversational** · `OPEN` — the agent-as-command-surface:
  invoked from where you already are, output lands as a *proposal* in the real surface, never as text in a
  chat bubble. Cheap, given `runToolLoop` exists. **Read tools and write tools must stay separate; writes
  are proposals, never commits.**
- **Campaign canvas** · `OPEN` — campaigns as a dependency graph rather than a list. Move the launch date
  and the whole sequence shifts, preserving spacing. Closer to project management than scheduling.
- **Content portfolio view** · `OPEN` — every post classified across topic, funnel stage, proof type,
  origin, give-vs-ask. Surfaces *"48% product features, 8% customer evidence."* Largely unlocked by
  Session 33's dimension taxonomy; mostly a surface after that.
- **Audience digital twin** · `PARKED` — simulate how the ICP reacts before publishing. Interesting,
  unfalsifiable, and expensive to validate.
- **Growth simulator / virality prediction** · `PARKED` — predicting reach pre-publication is a claim the
  data cannot support at this volume. Would violate the attribution-honesty rule.
- **Social CRM** · `PARKED` — every commenter as a profile with history and buying signals. Depends on
  `relationship_memory`, which the engagement inbox un-parks. Revisit after the inbox ships. **Note
  (2026-09-03):** the inbox is now Tier-1 pre-launch (`pre-launch-scope.md` T1-A), so this park has a
  *dated* trigger rather than an open-ended one — but the CRM itself stays post-launch.
- **Memory across years** · `OPEN` — *"show every security post we've written"*, *"we covered this 18
  months ago, update it."* Needs §2.5's retrieval.
- **Content marketplace** · `PARKED` — prompt packs, frameworks, templates, "Figma Community for
  marketing." Requires a user base that does not exist yet.

---

## 4. Media and editor

*From the archived `media-generation-editor-phase-2-brainstorm.md`. **Note the scope change:** image
generation is now **pre-launch** and video generation **post-launch** (founder ruling, 2026-09-02), so
image work has left this document for `pre-launch-scope.md`.*

- **AI-native editor ("Cursor for social")** · `OPEN` — inline suggestions beside the work rather than a
  generate button: *stronger hooks · claims needing sources · shorten the ending · you've used this hook
  twice this month*. The rubric already scores every dimension this would surface.
- **Tier-0 asset reuse** · `OPEN` — reuse and recompose existing brand assets before generating anything
  new. Cheapest visual win and it stays on-brand by construction.
- **Video generation and editing** · `PARKED` — explicitly post-launch.
- **Auto follow-up content** · `OPEN` — one strong post becomes a sequel, an FAQ, a carousel, a thread, a
  newsletter section. Reuses format families.

---

## 5. Explicitly rejected — recorded so they don't return untested

| Idea | Why rejected |
|---|---|
| **The agent swarm** (Research/Hook/Copy/SEO/Analytics agents messaging each other) — **re-affirmed 2026-09-03**, explicitly excluded from the un-blocking ruling | Handoffs serialise away the unified context governed memory exists to build; a regression becomes unattributable; unmeasurable at the seams; cost multiplies on coordination rather than quality. **§2.3's shared-memory cohort is the version that works** — the objection is to conversation between agents, not to many agents. |
| **A chat box as a primary surface** | Blank chat produces generic output, and the engine's value is that it acts *without* being asked. The command palette (§3) is the version that keeps the value. |
| **Fine-tuning** | Freezes exactly the thing that should keep learning, and makes per-business convergence harder rather than easier. Retrieval and governance are the moat. |
| **Growing the prompt** | Past a point, more instructions make output *more* generic. Examples and retrieved facts beat rules. |
| **Model upgrades as a quality strategy** | Every competitor gets them on the same day. |
| **A twelfth shallow integration** | A user-defined small world beats breadth — better results *and* lower cost. |
| **Autonomous publishing or autonomous public replies** | Human-in-the-loop is the product promise, not a risk control awaiting better data. Permanent. |
| **Reddit** | Cultural mismatch and brand-damage risk for our customers. Locked. |

---

## 6. How an idea leaves this document

1. **Into `pre-launch-scope.md`** — it is ruled as required before launch, and is deleted from here.
2. **Into `backlog.md`** — it is committed but deferred, with a named un-defer trigger.
3. **Into an ADR + build guide** — it is being built.
4. **Into §5 above** — it is argued down, with the reason recorded so the next session doesn't re-derive it.
5. **Un-blocked in place** — a `BLOCKED` item whose named ruling arrives becomes `UNBLOCKED` here, with
   the ruling cited and its binding conditions restated. It stays in this document until it enters
   pre-launch scope, the backlog or an ADR — un-blocked is not the same as scheduled.

An idea that sits here untouched for two quarters should be moved to §5 or deleted. A list that only grows
stops being read.
