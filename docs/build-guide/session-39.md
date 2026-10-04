# Session 39 — Template carousels (ADR 0033, provisional) · Track Q

> **PLACEHOLDER — intent only (written 2026-10-04).** This file records *what Session 39 is for*, sourced
> from the planning docs. It is **not** a build guide yet: the Reality check, §0 Locked decisions, §0.1
> Architect questions, §0.2 adjudications and the §1a/§1b Architect prompts are authored later with the
> `sosh-build-guide` skill, and §2/§3/§4 then follow at their own gates. The ADR number and Track letter are
> provisional until the Architect runs.
>
> **Goal:** ship **T1-C** (`docs/pre-launch-scope.md` §4): LinkedIn document carousels as **structured
> text rendered to a deck through templates** — the sourcing that selects the carousel format, a template
> system, rendering, and publishing.
>
> **Does NOT ship:** image generation (T2-D — Tier 2, sequenced **behind** this session, §12.5); any
> diffusion model or generative imagery; video (post-launch). `CLAUDE.md`: template-rendered carousels
> *"are a separate capability from generative imagery and should not be conflated with it."*

## Why this session, and why now

- **It closes the Production gap.** `docs/product-status.md`: Production is *"Partial. Text only. No
  images, no carousels in practice."* `pre-launch-scope.md` §4: *"roughly half of what an agency produces
  is visual, and carousels are the highest-reach native format for this ICP. A text-only tool loses the
  side-by-side comparison."*
- **Most of the plumbing exists.** Carousel is already a shipped `FormatFamily` branch (schema, policy,
  platform-map selection); *"only the sourcing that would set it true is deferred"* (ADR 0022 §6.3,
  Session 29-D D6). `product-status.md`: *"Carousels exist as a format in the code but nothing ever
  selects one."*
- **It gates T2-D.** §12.5: image generation *"is judged against what is still missing after"* template
  carousels land.
- **No brand-safety surface.** Templates render the customer's approved text; there is nothing generated
  visually to police.

## What already exists (to be re-verified in the Reality check)

- ADR 0022 (Session 29): the carousel / script format families and the deferred sourcing.
- The Mode 2 generation pipeline, rubric judging (ADR 0024) and approval gate the slides must pass through.
- Native LinkedIn / X publishing (ADR 0028).

## What the Architect will have to decide (themes, not the §0.1 questions)

- **Sourcing** — when a campaign or post selects carousel, and who decides (planner, brief, user).
- **Template system** — how brand identity (colours, fonts, logo) reaches the templates; how many
  templates ship at launch.
- **Rendering** — where slides become a PDF (Vercel Function vs other), its size/time limits, storage of
  the artefact (Supabase Storage), and any new dependency (needs explicit confirmation per `CLAUDE.md`).
- **Publishing** — the LinkedIn document-post path and its media upload inside `/lib/social/`; what X
  gets instead (X has no document posts).
- **Approval** — the human approves the rendered deck, not only the text; editing a slide re-renders.
- **Plan gating** — whether carousels are Plus or Pro.

## Constraints it inherits

Provider calls only inside `/lib/social/`; AI calls only inside `/lib/ai/` with `CustomerContext`;
Tailwind/shadcn for any UI; i18n en/pt/es; the approval gate unchanged.

## §2 — Builder · §3 — Reviewer · §4 — Correction pass

> **PLACEHOLDER — §2 and §3 are authored after the ADR is Accepted; §4 only after the Reviewer has run and
> `docs/reviews/session-39-reviewer.md` exists.**

## Next

**Session 40 — the engagement inbox (T1-A).**
