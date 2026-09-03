# Campaign Creation Modes — Architecture & Build Plan

> Synthesis of the 2026-07-17 strategy session. This is a design document, not an ADR —
> the next step is an Architect session that turns the agreed pieces below into formal
> ADRs before any Builder session touches code. Nothing in this document has been
> implemented yet.

---

## 0. The reframe

SOSH's current build (Phase 1 MVP) implements one campaign-creation path: user states an
objective, AI generates native posts across platforms. This document extends that into
**three entry points that share one pipeline**, and specifies exactly what upgrades the
existing pipeline needs to support all three without becoming three separate codebases.

The central discipline running through everything below: **agency should scale with how
much judgment-under-uncertainty a step requires, not be applied uniformly.** Some steps
stay deterministic code forever (platform character limits, hashtag counts, scheduling
time). Some become single AI calls with well-scored context. Very few earn a bounded
agentic loop. See the companion document for the full tiering.

---

## 1. The three modes

Not three products — three different **triggers** into the same campaign/post pipeline,
differing in who performs the Signal and Strategy steps before Creation begins.

| Mode | Signal | Strategy | Creation | Analogy |
|---|---|---|---|---|
| **1 — Studio** | Human | Human | Human, AI-assisted (suggest + explain) | Grammarly for campaigns |
| **2 — Objective-driven** (current model) | Human states objective | Human states objective | AI | Existing SOSH generation |
| **3 — Signal-driven** | AI (mining/monitoring) | AI proposes, human approves | AI | Opportunity engine |

All three write into the **same** `campaigns` / `posts` tables. The only structural
difference is an `origin` field (`manual` / `objective_generated` / `signal_generated`)
and how far upstream the human enters the funnel. Building them as one pipeline with
three seeds — rather than three flows — is what keeps this achievable for a small team:
Mode 1's "promote a draft into a campaign" and Mode 3's "approved insight card becomes a
campaign" both terminate in the *same* generation step Mode 2 already has.

### Mode 1 — Studio: a controlled experiment, not a generic AI assist

The framing that makes this different from a bolted-on writing assistant: the user sees
**their draft on the left, an AI-revised version on the right, with each change
explained and individually acceptable** — Grammarly's interaction model, but the
rationale is sourced from SOSH's own governed memory wherever possible, not generic LLM
judgment.

Mechanics (see also the companion document's rubric section for what this draws on):

- The model returns a fully revised version with changed spans wrapped in inline
  markers tied to an id (e.g. `⟦1:stronger phrase⟧`), plus a parallel array
  `{ id, category, rationale, memorySource? }`. **Do not ask the model for character
  offsets into the original text** — offsets drift constantly in practice. Let the model
  do what it's good at (wrapping its own output), and compute the actual diff
  deterministically in code (e.g. `diff-match-patch`) against the stripped, marker-free
  revision.
- Each suggestion's rationale should cite a governed-memory source where one exists —
  "you used 'leverage', which is on your avoid-words list" is a rule-based citation
  (`avoid_words` already exists on `BrandVoiceContext` in `lib/ai/context.ts`), not an
  LLM guess. Only categories with no governed source (general hook strength, say) fall
  back to pure model judgment. This traceability is the actual differentiator versus
  Grammarly, whose rules are fixed grammar — SOSH's are fixed to *this business's* data.
- One call per "suggest improvements" click, not live-as-you-type — cost and the
  "controlled experiment" framing both argue against a debounced live-suggestion loop.
  Cheap/fast model tier is sufficient (classification + rewriting against supplied
  context, not open-ended generation).
- "Promote to campaign": extract the underlying argument/evidence from the human's
  draft, then run it through the same brief → platform-native generation steps Mode 2
  uses (below), seeded from the draft instead of a typed objective.

### Mode 2 — Objective-driven generation (upgraded)

Today: objective → `buildCustomerContext` (fixed fan-out queries) → one
`postGenerationPrompt` call per platform → finished posts. The upgrade adds a
reviewable strategy checkpoint *before* any post copy exists, and structurally
guarantees platform-native output instead of prompting for it:

```
A. Brief assembly (Tier 1)        — retrieve scored+capped memory, generate a
                                      structured BRIEF: narrative, proof plan,
                                      post-role sequence — NOT posts yet
B. Brief critique gate (Tier 1)   — score brief against rubric before the user
                                      even sees post copy
C. Human reviews/edits BRIEF      — cheap checkpoint, prevents wasted generation
                                      on a bad strategy
D. Native post generation (Tier 1)— per platform, per role, format-family schema
                                      (see below) — pulls only the memory slice
                                      relevant to that specific post
E. Hook refinement (Tier 2)       — bounded critique/regenerate loop on openings
F. Deterministic pass (Tier 0)    — platform constraints, hashtags, link
                                      placement, scheduling time — code, not LLM
G. Human reviews posts            — same Studio diff view available per post
H. Publish                        — existing SocialProvider, unchanged
I. Diff-learning capture (async)  — see intelligence-layer companion doc
```

**Why the brief matters**: right now objective goes straight to finished posts, same as
any competitor's "one-shot magic button." Making the brief — narrative, proof plan,
post-role sequence — a first-class, human-reviewable artifact before generation spends
tokens on copy is what turns "AI wrote my posts" into "AI proposed a strategy I can
shape." It is also the mechanism that guarantees cross-platform coherence (next
section) rather than hoping for it.

**Posts per platform, per campaign**: yes, more than one — this is not optional. A
campaign whose X presence is one tweet syndicated everywhere is a weaker product than
what "campaign" is meant to mean here. `CampaignRow` already carries `posts_per_week`,
`frequency`, `start_date`, `end_date`, and `postGenerationPrompt` already takes
`postsToGenerate` + `scheduledDates[]` — the schema half-supports this today. What's
missing is **post roles** (anchor thesis, founder perspective, customer proof,
objection response, conversation starter, follow-up/retrospective) as an explicit field
assigned at the brief stage, so the campaign has an actual narrative arc instead of N
independently-generated posts that happen to share an objective, and so portfolio
analytics can later say "this campaign has four announcements and no proof."

#### Guaranteeing cross-platform *native*, not cross-posted, content

The current output schema (`{ content: string, hashtags: string[] }`) cannot represent
an Instagram carousel or a script — those are structurally different content, not the
same shape with a different tone. "Native" has to be a structural guarantee, not a
prompt request.

- **Format families, not literal platforms, are the schema boundary.** One schema per
  content *shape*:
  - *Single-post*: LinkedIn, Facebook, Threads-as-standalone →
    `{ body, imageBrief?: string | null }`
  - *Thread*: X-as-thread, Threads-as-thread →
    `{ posts: [{ text, order, role: 'hook'|'body'|'pull_quote'|'close' }], imageBrief? }`
  - *Carousel*: Instagram → `{ slides: [{ caption, imageBrief, order }] }`
  - *Script* (Phase 2, TikTok/Shorts): `{ hook, shots: [...], spokenScript, caption }`

  Each family is a discriminated zod schema. If the model tries to return prose where a
  carousel schema is expected, `safeParseOrAiError` rejects it and the call retries —
  the guarantee is structural validation, not prompt wording. This also decouples
  "how many platforms" from "how many schemas": adding TikTok later means adding one
  new format family, not re-architecting generation.
  - `imageBrief` is a structured *recommendation* field ("this needs an image showing
    X"), not image generation — consistent with the "no image generation at launch"
    rule while keeping the AI strategically aware that carousels are meaningless
    without media.

- **Coherence comes from a frozen brief, not independent per-platform reasoning.** If
  each platform call re-derives its argument from the raw objective, outputs drift —
  different evidence cited, redundant framing, no sense the LinkedIn post and the X
  thread are two moves in the same argument. Instead: the brief (Stage A) pins specific
  evidence citations and assigns each post its role once; every platform call receives
  that *same frozen object*, not a fresh derivation. Platform generation renders the
  same argument into a native shape — it doesn't re-argue it.

- **A post-generation consistency pass** catches drift pinning alone doesn't: role
  coverage check (did every assigned role get fulfilled — Tier 0), redundancy/
  contradiction check across the generated set (Tier 1, cheap), and a
  platform-nativeness score added to the existing quality rubric (does this read like a
  native single post/thread/carousel, or reformatted copy with the count cut down).

- **Recommended call shape: N independent per-platform calls from the frozen brief**,
  not one joint call returning all platforms at once. A joint call would guarantee
  coherence by construction but couples failure (one platform's schema-validation
  failure blocks the whole batch) and complicates per-platform token budgets and
  parallelism. N calls fail and retry independently — consistent with the existing
  idempotent/partial-failure-tolerant reliability principles already in the
  constitution. Revisit only if the consistency-check step proves to catch drift often
  enough to be a real cost.

#### X/Threads thread mechanics specifically

A thread is **the native rendering of one scheduled post within the campaign's role
sequence — not the campaign itself.** A campaign's X presence is still multiple posts
scheduled over the campaign's duration (one per role); any individual one of those posts
independently resolves to a single tweet or a thread depending on that post's actual
content volume. Don't let "thread" become shorthand for "the campaign's X content."

- **Thread-vs-single-tweet is decided at generation time, by content volume**, not
  dictated top-down by the brief. A customer-proof role with three data points
  naturally wants a thread; a conversation-starter role naturally wants one tweet.
  Bounded by Tier 0 guardrails: minimum ~3 tweets to justify thread format at all (below
  that, force single-tweet), maximum ~7-8 tweets (drop-off risk beyond that).
- **Hook tweet must stand alone** — it's the only part visible pre-expansion, so it
  can't presuppose tweet 2. This reuses the Tier 2 hook-critique loop already
  established for single posts, applied to `posts[0]` — no new machinery.
- **Per-tweet `role` tag** (`hook | body | pull_quote | close`) enables structural
  validation: does tweet[0] have `role: 'hook'`, does the last have `role: 'close'`, is
  there at least one `pull_quote`-worthy tweet.
- **Link placement is a deterministic rule** (Tier 0), not model discretion: outbound
  links in the first tweet suppress X's algorithmic reach — CTA links go in the final
  tweet or as an explicit follow-up reply, never tweet 1.
- **Threads (the Meta app) shares the structural family but not the constraint set** —
  same ordered-array-with-roles shape, different culture (less numbered-listicle, more
  conversational, no link-penalty behavior identical to X's). Treat it as a separate
  `PLATFORM_CONSTRAINTS` entry within the same thread family, the same way platforms
  with shared mechanics but different norms are already handled today.
- **Numbered ("1/7") vs unnumbered style is a learned preference, not a correctness
  rule** — a clean first test case for the confidence-gated memory promotion described
  in the companion document: if users consistently strip numbering, that's an
  unambiguous diff signal that should update voice memory over time.

### Mode 3 — Signal-driven campaigns

```
A. Ingestion (Tier 0, scheduled)   — user-defined watch list ONLY (own product:
                                      changelog/GitHub/analytics thresholds;
                                      external: competitor accounts, scoped
                                      RSS/news) — narrow by design, not firehose
B. Candidate scoring (Tier 0)      — cheap embeddings + dedup + clustering,
                                      ranked against audience/evidence memory
C. Triage (Tier 3, shortlist only) — bounded agentic loop (2-4 tool calls): is
                                      this campaign-worthy? do we have evidence?
                                      does it conflict with a prior claim? —
                                      the ONE legitimate agent loop in the product
D. Insight card generation (Tier 1)— observation, why it matters, angle options,
                                      confidence, sensitivity — NOT a campaign yet
E. Human reviews insight inbox      — approve / dismiss / save
F. Approved card seeds Mode 2       — re-enters at Mode 2 Stage A, brief now
   Stage A                            seeded by the insight instead of a typed
                                      objective — everything downstream is
                                      code already built for Mode 2
```

Full detail on the mining/insight-card mechanism and the triage agent's design lives in
`intelligence-layer-memory-mining-rubric-opportunity-feed.md`. The key point for this
document: Mode 3 is not a parallel generation system — it is new machinery only for
Stages A-D; Stage F is a re-entry into Mode 2's existing pipeline.

---

## 2. Build & integration plan

Ordered for a small team, each phase reusing the previous rather than adding a parallel
system.

### Phase A — Mode 2 upgrade (highest priority, no new infrastructure)
- Add `origin` field to campaigns; add `role` enum to posts.
- Introduce the brief as an intermediate artifact (new prompt + schema in
  `lib/ai/prompts/`), with its own critique gate (reuses the quality-rubric mechanism).
- Split `postGenerationPrompt`'s output into format-family schemas (single-post, thread
  first — carousel/script later as those platforms come online).
- Add the hook-refinement Tier 2 loop.
- Add the deterministic post-generation pass: platform constraints (already exist),
  link placement rule, role-coverage check.
- **Risk**: brief-as-checkpoint adds a step/latency versus today's instant generation.
  Once brief quality is validated (edit-distance trending down — see Phase B), add a
  "skip review, generate directly" fast path for repeat users. Don't build that path
  before you have the data to justify it.

### Phase B — Diff-based learning capture (universal, moderate infrastructure)
- Snapshot AI-original content separately from the mutable, human-editable field.
- Async worker (same pattern as existing publishing/metrics workers) diffs
  `ai_original` → `human_final` at the approval state transition.
- Heuristic-first classification (word-list matches against `avoid_words`, length
  delta, hashtag delta, CTA presence) before any LLM classification call; batch/periodic
  LLM summarization into confidence-scored memory statements, not per-post.
- Explicit **correction vs. preference** tagging from day one — conflating "fixed a
  hallucinated fact" with "changed my tone preference" will corrupt voice memory.
- This pipeline is mode-agnostic by construction — it captures the signal from Mode 1,
  2, and 3 identically, so building it once pays for all three.

### Phase C — Mode 1 Studio
- Reuses: the quality rubric (as suggestion categories), the diff-capture pipeline
  (Phase B) for the accept/edit/reject signal, and the brief→generation pipeline for
  "promote draft to campaign."
- New: the inline-marker suggestion schema, the deterministic diff renderer, the
  left/right UI.
- Decide upfront whether rejected suggestions can carry a human-entered reason
  (richer signal, more UI friction) or are silently dropped — this changes the schema,
  not just the UI, so it should be settled before implementation, not mid-build.

### Phase D — Mode 3 signal-driven (largest net-new surface, scope down hard)
- Start with **one signal source**: the business's own product (GitHub releases /
  changelog), per the "company-originated" opportunity type only — skip
  market-responsive (news/competitor monitoring) entirely at first.
- Build Stages A-D only; Stage F is free (Phase A's pipeline).
- The triage step (Stage C) is the most expensive and least testable part of the whole
  architecture — needs a hard per-business daily cost ceiling and an eval-harness style
  test approach (statistical pass rates, not exact-match) before it ships, and should
  not be scaled to multiple signal sources until that harness exists.
- Insight cards need an expiry/decay policy from the start (ties to memory's
  confidence/expiry governance) or the inbox becomes clutter.

---

## 3. Session summary

Chronological record of what this session covered, for handoff into an Architect
session:

1. Reviewed two external strategy docs (`ai-social-media-manager-platform-strategy.md`,
   `next-hootsuite-ai-social-growth-os.md`) and identified four integrable ideas:
   governed memory, content mining / insight cards, a quality rubric /
   critique-before-generation, and an opportunity feed — prioritized in that order,
   with autonomous public replies and full "growth autopilot" explicitly rejected as
   inconsistent with the human-in-the-loop constitution.
2. Worked through how governed memory would actually enter a single-shot
   `messages.create` call without becoming a chatbot: separating **learning**
   (background, periodic, can be AI-driven and expensive) from **retrieval** (per-call,
   cheap, scored-and-capped) from **generation** (stays a boring one-shot call). Flagged
   that `runner.ts` currently `JSON.stringify`s the entire `CustomerContext` into the
   first message — literal, present-tense over-inclusion worth fixing independent of
   the larger redesign.
3. Defined a tiered agency model (Tier 0 deterministic code → Tier 1 single-shot
   generation → Tier 2 bounded critique/regenerate loop → Tier 3 agentic tool-use loop)
   and mapped the campaign-creation pipeline onto it: SEO/hashtags/scheduling stay Tier
   0 forever; hooks get Tier 2; only Mode 3's signal triage earns Tier 3. Discussed
   drawbacks of over-applying agency: cost compounds per tool call, latency breaks the
   "instant" feel Mode 1 depends on, testability degrades sharply (fixture-based exact
   match vs. eval-harness statistical testing), failure modes get quieter, and the
   human-approval gate that exists regardless caps the marginal value of more upstream
   autonomy.
4. Defined the three campaign modes (this document, §1) and confirmed multiple posts
   per platform per campaign is correct — the schema already half-supports it
   (`posts_per_week`, `scheduledDates[]`), what's missing is post *roles*.
5. Worked through Mode 1 as "a controlled experiment, not an opinionated studio" —
   Grammarly-style diff with per-suggestion rationale sourced to governed memory where
   possible (marker-based model output + deterministic diff computation, not
   model-reported character offsets).
6. Refined the learning loop: the human usually edits the AI's *suggestion*, not just
   accepts/rejects it — so the real signal is a second diff (AI-suggested version →
   human's final version), which subsumes the accept/reject signal and, critically,
   applies identically across all three modes (any AI-authored draft, any origin).
   Flagged the correction-vs-preference distinction as a required design element to
   avoid corrupting voice memory with hallucination fixes.
7. Designed the Mode 2/Mode 3 pipelines in full (§1-§2 of this document), including the
   brief-as-artifact checkpoint, format-family schemas for guaranteed platform-native
   output, the frozen-brief mechanism for cross-platform coherence, and X/Threads
   thread-specific best practices (hook standalone-readability, per-tweet roles, link
   placement, thread length guardrails).
8. Produced this document and the companion intelligence-layer document as session
   output, for handoff to an Architect session to formalize into ADRs.

**Not yet decided / open for the Architect session**: exact confidence-threshold
numbers for memory promotion; whether rejected Studio suggestions carry a human-entered
reason; the specific eval-harness approach for Mode 3's triage agent; naming/shape of
the new `lib/memory/` module boundary relative to existing `lib/db/` and `lib/ai/`.
