# Media Generation & Editor — Phase 2 Brainstorm

> Synthesis of the 2026-07-17 strategy session. This is exploratory design for a
> capability the constitution already anticipates but explicitly excludes from launch
> ("We don't generate images at launch (text-only Phase 1, image generation is Phase
> 2)"). Nothing here changes that — this document is Phase 2 scope, drafted ahead of
> when it builds, so the design exists before the work is scheduled. Companion to
> `campaign-modes-architecture-and-build-plan.md` and
> `intelligence-layer-memory-mining-rubric-opportunity-feed.md`, which this extends
> into the media dimension. Instagram/carousels are used throughout as the hardest
> illustrative case — they are not a near-term scope commitment (per the current
> constitution, Instagram is a launch platform but carousel-format generation is not
> assumed at launch).

---

## 0. The premise

All three campaign modes assume the ability not just to *load* media (upload, stock
library) but to *create and edit* it — an editor along the lines of Postiz: text,
objects, free stock images, image upload, and AI image generation/editing as tools
within a single canvas.

That editor is the easy, well-understood part. The hard part is **autonomous media
production inside the AI-driven modes (2 and 3)** — deciding whether a post needs media,
what it should depict, sourcing or generating it, and keeping it on-brand without a
human in the loop for every image. This document is about that harder half.

---

## 1. The editor is not just Mode 1's interface — it's the universal review surface

A Postiz-style editor (canvas, text layers, objects, stock library, upload, AI
generation/editing as in-canvas tools) is Mode 1's natural home. But it should not be
built as a Mode-1-only feature: whatever Mode 2 or Mode 3 auto-drafts for media should
land in that *same* editor for the human to regenerate, swap, or hand-edit before
approval. This is the same reuse principle that runs through the rest of the
architecture — one editing surface, three feeding pipelines, rather than three separate
media UIs. It mirrors Studio's diff view being the shared review mechanism for
AI-drafted text regardless of which mode produced it.

---

## 2. Autonomous media should follow the same tiering as text — not a separate system

The campaign-modes document establishes a tiered agency model for text (deterministic
code → single-shot generation → bounded critique loop → agentic tool loop) and a
format-family schema boundary instead of per-platform schemas. Media should use the
same two ideas, not a parallel architecture.

### Tier 0 — asset reuse, before generating anything

If evidence memory has an attached asset (a real product screenshot tied to a specific
evidence record, a customer photo, a previously-uploaded brand image) and the post being
generated cites that evidence, use the existing asset — deterministically, no
generation call. This is the same "check governed memory before reasoning from scratch"
discipline already applied to text retrieval, pointed at media instead. It should be
tried and exhausted before any generation path runs, for three reasons: it's free, it's
maximally brand-safe, and it's more credible than anything synthetic (see §5).

### Tier 1 — split creative direction from rendering

Don't ask one call to both decide *what* an image should show and *render* it. A cheap
text-model call produces a structured creative brief — subject, style, mood,
composition, brand elements to include, aspect ratio for the target format — which is
the `imageBrief` field already specified in the campaign-modes document's format-family
schemas, made generative instead of purely advisory. A separate, more expensive
image-model call renders against that brief. This mirrors the brief/copy separation
already designed for campaign generation: keep the expensive, hard-to-retry step
(pixel rendering) isolated from the cheap, fast, easily-iterated reasoning step.

### Template-driven generation as the primary mechanism, freeform generation as the fallback

For structured formats — quote cards, stat/data visualization cards, carousel slides —
the reliable path is generating structured *components* into a template (deterministic
layout/rendering, e.g. SVG or HTML-to-image), where the AI's job is picking the right
template and filling its content (which stat, which quote, what headline), not
freehand-rendering pixels. This gives a materially stronger brand-consistency guarantee
than raw text-to-image, and is faster and cheaper, since rendering a template beats a
full diffusion call. It also maps cleanly onto the format-family concept already
established for text: a carousel slide is a format family the same way an X thread is,
just visual instead of textual.

Freeform AI-generated imagery (photorealistic or illustrative, no template) is a real
capability worth having eventually, but it is the harder, slower, more expensive, and
least consistent path. It should be reserved for cases where no template fits — not
the default mechanism.

---

## 3. Brand consistency is the actual hard problem

"Can we call an image-generation API" is not the interesting question — raw generative
image calls are stylistically inconsistent from one call to the next unless explicitly
constrained. Two mechanisms, used together:

- **Reference-image conditioning**: pass 1-3 locked brand exemplars (logo, palette
  swatch, a previously-approved image) into any generation call that supports
  image-to-image conditioning, rather than generating from a text prompt alone each
  time.
- **Visual style memory**: the same governance pattern already designed for voice
  memory in the intelligence-layer document, applied to imagery — a locked palette,
  typography-on-image rules, composition patterns, and an explicit "anti-style" list
  (things to never produce, e.g. stock-photo-cliché imagery). This should be fed by the
  *same* diff-loop mechanism already designed for text: if a human keeps regenerating or
  replacing AI-drafted images rather than approving them, that is an unambiguous
  preference signal, and once it repeats across enough instances it should promote into
  style memory exactly the way a text-editing pattern promotes into voice memory. No new
  learning mechanism is needed here — the existing one just needs to be pointed at a
  second content type.

---

## 4. Carousels need set-level generation, not independent per-slide calls

The campaign-modes document recommends N independent per-platform calls from a frozen
brief for cross-platform text, specifically because independent failure/retry beats
forced joint coherence for that case. Carousels are the one place that recommendation
should be inverted: a carousel's slides must visibly share style, palette, and
typography, so slide generation should happen as one set-level call (or one locked
style/brief reference threaded through sequential slide calls), not independent calls
that might drift. The failure mode of visibly inconsistent slides is more damaging and
more immediately obvious to a viewer than inconsistent phrasing across platforms — the
tradeoff calculus that favored independent calls for text does not carry over here.

---

## 5. Two risks worth designing around from the start

- **Trust and credibility for a B2B SaaS audience.** This audience is unusually likely
  to notice — and distrust — an AI-generated image standing in for something that
  should be real: a customer photo, a product screenshot, a testimonial visual. This is
  why Tier 0 asset-reuse-first (§2) is not just a cost optimization, it's a credibility
  safeguard. Until there is a deliberate policy decision otherwise, AI-generated
  imagery should be restricted to clearly non-representational formats — quote cards,
  data visualizations, abstract/illustrative graphics — rather than anything implying
  "this is a real customer" or "this is an actual screenshot."
- **Cost and latency.** Real image rendering is meaningfully more expensive and slower
  than text generation, and a campaign implies multiple posts across multiple
  platforms — the volume multiplies fast. The template-first architecture in §2 is not
  only a quality choice, it's what keeps this economically viable at that volume;
  freeform generation for every slide of every carousel would be a genuine cost center,
  not a nice-to-have.

---

## 6. Sequencing

This is explicitly a bigger lift than the text pipeline and should follow it, not run
in parallel:

1. Text pipeline (campaign-modes document, Phases A-D) matures first — it establishes
   the brief/generation split, the format-family schema pattern, and the diff-based
   learning loop this document borrows directly.
2. Tier 0 asset-reuse (evidence-memory-linked media) is the cheapest, lowest-risk first
   step here — no generation infrastructure needed, just surfacing existing assets
   against the relevant post.
3. Template-driven generation for single-post formats (quote/stat cards) next — bounded
   scope, strong consistency guarantee, validates the visual-style-memory mechanism
   before committing to anything more ambitious.
4. Carousel set-generation and freeform image generation come last, and only once
   Instagram/carousel support is an actual near-term platform priority — not assumed
   at launch per the current constitution.
