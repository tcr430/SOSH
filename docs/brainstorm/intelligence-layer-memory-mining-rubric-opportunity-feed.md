# Intelligence Layer — Memory, Content Mining, Quality Rubric, Opportunity Feed

> Synthesis of the 2026-07-17 strategy session. Companion to
> `campaign-modes-architecture-and-build-plan.md`, which covers the three campaign
> creation modes that consume everything described here. This is a design document, not
> an ADR — needs an Architect session before any code is written.

---

## 1. Governed memory

The foundational upgrade everything else depends on. Today, `CustomerContext`
(`lib/ai/context.ts`) is a single flat aggregate assembled by a fixed fan-out of
queries — `listCampaigns(..., 5)`, `listTopPostMetrics(..., 10)` — always the same
shape, no relevance scoring, no confidence tracking, dumped wholesale into every prompt.
Governed memory replaces that with typed, sourced, confidence-scored stores.

### Six memory types

| Type | Holds | Example |
|---|---|---|
| **Brand** | Stable approved facts | Positioning, product capabilities, pricing, competitors |
| **Voice** | How the brand communicates | Voice principles, `avoid_words` (already exists on `BrandVoiceContext`), anti-voice, platform variations |
| **Evidence** | Material that supports claims | Customer quotes, case studies, usage data — each with source/date/confidence/permission |
| **Audience** | What audiences care about | Problems, objections, common questions, buying triggers |
| **Performance** | What has appeared to work | Topics, hooks, formats, proof types — **probabilistic, not permanent** |
| **Relationship** | What's known about a contact | Previous conversations, interests, stage — feeds Phase 2 engagement inbox |

Every record carries governance metadata: source, creation date, last-confirmed date,
confidence, sensitivity, public-use permission, scope (brand/campaign/platform/contact),
expiry/review policy. The system should be able to say "we believe technical comparison
posts perform well for CTO audiences based on three campaigns," not assert it as
permanent fact after one data point.

### How memory actually enters a prompt — without dumping everything in

The naive version of "add memory" is "stuff more into the context object." That's the
literal problem already present in `runner.ts` (`JSON.stringify(context)` into the first
message, on top of the already-templated sections `buildUserMessage` builds). The fix is
architectural, not additive — split three things that are currently collapsed into one
call:

1. **Learning** (background, periodic, can be expensive and AI-driven) — a scheduled
   distillation worker (same pattern as the existing publishing/metrics workers)
   batches recent signal (see §5) and runs a moderate-cost LLM call, infrequently, to
   turn raw data into compact, confidence-scored memory statements. This is where the
   actual "intelligence" lives — not in a bigger prompt, in periodic synthesis that
   already happened before generation time.
2. **Retrieval** (per-call, cheap, deterministic code, hard-budgeted) — at generation
   time you already know the task shape (campaign objective, platform, audience), so
   retrieval is a scored query, not an LLM decision: rank by relevance (embedding
   similarity to the objective is sufficient, doesn't need to be fancy), confidence, and
   recency, then take a **hard cap** — top 5 evidence items, top 3 performance patterns,
   always the core voice rules. The cap forces prioritization instead of "include
   everything relevant," which is the discipline missing from `buildCustomerContext`
   today.
3. **Generation** (per-call, single-shot) — stays exactly what `runPrompt` already is.
   No new call mechanics; it receives already-retrieved, already-capped context.

**Module boundary**: add `lib/memory/` alongside `lib/ai/`, `lib/social/`, `lib/db/` —
one file per memory type, each exposing `retrieveRelevant(businessId, queryContext,
limit)`. `buildCustomerContext` calls into `lib/memory/*` instead of directly calling
`lib/db/campaigns.ts` / `lib/db/post-metrics.ts` for the sections that should be scoped
rather than exhaustive. Same call site in `runner.ts`, same one API call — only the
selection logic changes.

**Prompt caching** — already partially built (`runner.ts` sets `cache_control:
{ type: 'ephemeral' }` on system prompts over 4096 chars) — should carry the stable,
shared context (platform constraints, core voice), while the per-call retrieved slice
goes in the uncached user message. Currently everything is undifferentiated, so the
caching benefit that already exists in the code isn't being fully captured.

---

## 2. Content mining & insight cards

The best content usually already exists inside the company, trapped in a format that
isn't publishable. Mining connects to sources (GitHub releases, changelog, product
analytics, support conversations, sales-call transcripts, Notion docs) and extracts
observations — but **never produces a post directly**. It produces an **insight card**:

- The underlying observation
- Why it matters
- Relevant audience
- Supporting evidence
- Potential content angles
- Novelty / freshness / sensitivity / confidence
- Suggested campaign objective

The card is the approval gate between raw company knowledge and public communication —
a human always triages the card before it becomes a campaign brief. Three opportunity
types worth distinguishing so the portfolio doesn't skew:

1. **Company-originated** — product work, customer insights, founder experience.
2. **Market-responsive** — news, industry discussion, competitor moves.
3. **Evergreen strategic** — category education, recurring objections.

Build order (see companion doc's Phase D): start with company-originated only, sourced
from the business's own GitHub/changelog — this needs no external ingestion, no
competitor monitoring, and is the cheapest, lowest-risk version of the mining pipeline
to validate before adding market-responsive sources.

---

## 3. Quality rubric / critique-before-generation

A self-contained addition to `lib/ai/` — score a draft against a fixed set of
dimensions **before** committing tokens to full generation, and let the AI push back
rather than silently generate something weak:

- Specificity, originality, evidence sufficiency
- Audience relevance, platform nativeness
- Brand-voice alignment, strength of opening
- CTA fit, risk of unsupported claims
- Similarity to previous content (redundancy)

The valuable version of this isn't a passive score — it's active critique: *"This idea
is too weak for a campaign because it contains no novel claim or evidence. Here are
three questions that would make it publishable."* That's more useful than generating
polished mediocrity and letting the human notice it's weak after the fact.

This rubric is reused in three places across the product, not built three times:

- **Mode 2's brief critique gate** (campaign-modes doc, Stage B) — scores the brief
  before any post copy is generated.
- **Mode 1's suggestion categories** — each Studio suggestion maps to a rubric
  dimension, with rationale sourced to governed memory where one exists.
- **The post-generation consistency pass** — extended with a platform-nativeness score
  specifically, to catch reformatted-not-native output before a human sees it.

---

## 4. Opportunity feed

The surfacing layer for what content mining produces — the home-screen experience of
"here's what's worth acting on," not a calendar of what's already scheduled. Distinct
from the mining pipeline (§2) in the same way a search index is distinct from a search
results page: mining produces and scores insight cards; the opportunity feed is where a
human triages them (approve / dismiss / save), ranked by relevance and freshness.

Design constraints carried over from the wider product principles:

- **Narrow by design.** Don't monitor the whole internet — let the user define a watch
  list (their own product's sources plus a short, explicit list of competitors/topics).
  This is both a cost control (orders of magnitude less data to process) and a
  relevance control (a defined "world" produces more useful cards than an
  undifferentiated firehose).
- **Never autonomous.** The feed proposes, it never posts. This isn't a product
  positioning choice on top of the human-in-the-loop principle — it's the same
  principle, applied here.
- **Expiry matters.** An opportunity that isn't acted on within its relevant window
  should decay out of the feed rather than accumulate as clutter — ties directly to
  the confidence/expiry governance rule on memory records (§1).
- **This is Mode 3's Stage E**, not a separate product surface — see the companion
  document for how an approved card re-enters the shared campaign pipeline at the brief
  stage.

---

## 5. The intelligence layer / loop — how it all connects

Putting the four pieces above together as one mechanism rather than four features:

### The tiered agency model

Agency should scale with how much judgment-under-uncertainty a step requires — applying
it uniformly is both wasteful and, in some places, a quality regression.

| Tier | Shape | Where |
|---|---|---|
| **0 — Deterministic code** | Rules, lookups, stats, no LLM | Platform constraints, hashtags, link placement, scheduling time, signal clustering/dedup |
| **1 — Single-shot generation** | One call, pre-retrieved/capped context in | Copy generation, brief assembly, insight cards |
| **2 — Bounded critique loop** | Generate → score → regenerate once if below threshold | Hook refinement (including thread openers) |
| **3 — Agentic tool loop** | Model decides what to look up, 2-4 bounded tool calls | Mode 3's signal triage — the *only* place in the product this is warranted |

Pushing agency further than this has real costs worth naming: cost compounds per tool
call, latency breaks the "instant" feel Studio mode depends on, testability degrades
from simple fixture-based exact-match tests to eval-harness-style statistical testing,
and failure modes get quieter (an agent that silently skips a memory lookup it should
have made fails invisibly, where a fixed pipeline fails loudly). The human-approval gate
that exists on every campaign regardless of origin also caps the marginal value of more
upstream autonomy — better to spend the agentic budget where a human can't easily verify
the result themselves (cross-referencing evidence) than where they can (hashtag count).

### The learning loop — universal across all three campaign modes

The single highest-leverage mechanism in this whole design, because it's what makes
memory actually improve instead of staying a store someone has to manually curate:

1. Snapshot the AI-authored content at generation time (`ai_original`), kept separate
   from the mutable field the human then edits freely.
2. At the moment of approval/publish (the existing atomic state-transition guard), diff
   `ai_original` → `human_final`. This captures more than an explicit accept/reject on
   an individual suggestion would — a user can click "accept" on a Studio suggestion and
   then still quietly rewrite it, and an accept/reject log alone would miss that. The
   diff against the final approved version is ground truth regardless of which mode
   produced the draft.
3. Classify the diff — heuristic-first (word-list matches against `avoid_words`, length
   delta, hashtag delta, CTA presence/absence — no LLM call needed for most of this),
   with periodic batch LLM summarization for higher-level patterns ("this business
   shortens AI-generated LinkedIn hooks by ~20% on average").
4. **Correction vs. preference** must be distinguished from the start: an edit that
   fixes a hallucinated fact is an evidence-memory / grounding signal, not a taste
   signal. Conflating them will teach voice memory the wrong lesson.
5. Aggregate before promoting to memory — a single diff shouldn't change future
   generation. A pattern needs to repeat across N posts/campaigns before it moves from
   "observed once" to "used to steer generation." This is the same probabilistic
   framing as the confidence field on every memory record (§1) — it's one mechanism,
   applied consistently.
6. Because the snapshot-diff-classify pipeline doesn't depend on which mode produced
   the draft, every editing surface in the product — Studio, campaign review, a future
   quick-edit surface — feeds the same loop for free. Build it once (companion doc,
   Phase B).

### Where this all points

The moat this whole design is aiming at isn't the model — every competitor has access
to the same LLMs. It's the combination of: a company knowledge graph no competitor has
(governed memory, sourced and confidence-scored), a content-performance graph built
from real edit behavior (the diff loop), and workflow trust (explainable suggestions
sourced to that memory, not generic LLM judgment). None of that requires training a
custom model — it requires retrieval discipline, a background distillation job, and one
narrow, bounded agentic loop where judgment genuinely earns it. Everything else in the
architecture is deliberately boring, cheap, and testable on purpose.
