# Session 16 — Landing Page & Positioning

> **Goal:** Ship the marketing surface that turns Session 14's welcome email from a no-op into the first thing a paying customer receives. Three cooperating outputs: (a) `/` and `/pricing` as a tightly-typographic editorial marketing surface using a shared `PricingCards` component; (b) `/terms` and `/privacy` as MDX-backed legal infrastructure with empty placeholder copy and a working footer link surface; (c) a header + footer chrome that locks the public-facing visual identity so future marketing pages compose into it. The villain is locked: the gap between what founders know and what they actually publish. The hero is locked: *"You know what to say. SŌSH makes sure you actually say it."* The session inverts the usual posture — copy is the deliverable, code is the transcription.
> **Time:** 5–7 hours including correction pass
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7) → optional Correction
> **Plugins:** ECC throughout, claude-mem automatic, `impeccable-design-and-taste` for Builder (marketing surface — this is where the skill finally earns its keep on something other than an error page)
> **Skills consulted by Claude while drafting this guide** (so Architect inherits their posture without having to invoke them itself): `engineering:architecture` (Options Considered + named loser at every contested decision), `design:ux-copy` (per-section copy as a real deliverable, EN locked verbatim in the ADR), `design:design-critique` (IA spine evaluated for editorial pacing, not feature checklist), `design:accessibility-review` (WCAG 2.1 AA for marketing — reduced motion, focus management, contrast on editorial type), `engineering:testing-strategy` (what's worth testing on a marketing surface and what isn't).
> **Session structure:** Architect runs first and stops. Builder and Reviewer prompts are intentionally held back — drafted only after ADR 0009 is reviewed end-to-end.

---

## Why an Architect session

The landing page is a single Next.js route group. The non-obvious decisions are:

- **Copy is the artefact, not the components.** A landing-page session that goes Builder-first produces seven sections of placeholder Lorem and an ADR no one reads. Locking the EN copy *in the ADR itself* — every hero, subhead, body, CTA, FAQ — is what makes the Builder a transcription job and protects the headline from drift two iterations later. Same model as ADR 0008 §8a for email copy.
- **Editorial direction vs. product-led screenshots.** The product UI hasn't had its launch polish pass yet. Building a screenshot-driven landing page now bakes in pre-polish dashboard frames that will look dated within a session. Going editorial defers the visual debt to the post-launch UI review and plays to `impeccable-design-and-taste`'s strengths. The ADR must name this tension or the Builder will reach for a fake-dashboard mockup.
- **Pricing as a shared surface across `/` and `/pricing`.** Two routes, one component, one source of truth (`lib/stripe/plan.ts`). Without a locked component shape, the two surfaces drift within a release cycle.
- **Legal-page infrastructure without legal copy.** Footer links cannot 404. The MDX route + page wrapper + frontmatter shape ship now; the copy lands later through a content-only PR. The ADR must spec the boundary precisely so the Builder doesn't fabricate placeholder Terms.
- **Motion library introduction.** `motion` (Framer Motion v11) is the first new client-side dependency since shadcn. Reduced-motion preference handling, SSR posture, and bundle budget all need locking now or every future marketing page inherits whatever the Builder felt like that day.
- **The "social proof" gap.** Pre-launch there are no logos, no testimonials, no metrics. The conventional landing-page IA has a slot for them. Leaving the slot empty looks broken; faking it is a brand-trust violation. The ADR must replace the slot with something honest, or omit it deliberately.
- **i18n routes exist but copy is EN-only.** PT and ES files exist; the strings are EN as fallback. The ADR names this as a deliberate launch wart matching ADR 0008's Supabase Auth posture, with a follow-up session slot.

ADR 0009 locks these so the Builder invents nothing. The Architect proposes the IA, the section-by-section EN copy, the routing shape, the motion contract, and the legal-page infrastructure — this guide does not pre-write them.

---

## What this session builds and what it doesn't

**Builds:**

- **ADR 0009** — Landing Page & Positioning (Architect output, markdown only, with full EN copy inline)
- Replace the Session 1 placeholder homepage at `app/[locale]/(marketing)/page.tsx` with the real landing page
- New route: `app/[locale]/(marketing)/pricing/page.tsx` — pricing surface, reuses `PricingCards`
- New routes: `app/[locale]/(marketing)/terms/page.tsx` and `app/[locale]/(marketing)/privacy/page.tsx` — MDX-backed legal pages with stub copy
- New layout: `app/[locale]/(marketing)/layout.tsx` — marketing header + footer chrome (replaces / extends whatever Session 1 left)
- `components/marketing/` — section components (Hero, Problem, Solution, HowItWorks, Pricing, FAQ, FinalCTA, MarketingHeader, MarketingFooter)
- `components/marketing/pricing-cards.tsx` — the shared pricing component, reads from `getPlanCapabilities`
- `i18n/{en,pt,es}/marketing.json` — full keyed copy (EN authoritative, PT/ES fall back to EN strings with `// TODO: localize` comments per ADR 0008 wart precedent)
- `lib/mdx/` — minimal MDX page wrapper for legal pages (page component that loads frontmatter + content from `content/legal/`)
- `content/legal/terms.en.mdx`, `content/legal/privacy.en.mdx` — stubs with `Last updated: TBD` and a single placeholder paragraph
- `motion` (Framer Motion v11) added as a dependency; SSR-safe `<MotionConfig reducedMotion="user">` wrapper
- Per-page `generateMetadata` + `next/og` runtime OG image route at `app/og/route.tsx`
- `docs/launch-checklist.md` landing-page section (DNS canonical, OG image smoke, sitemap, robots, /terms /privacy routes return 200)
- `docs/decisions/0009-landing-page-positioning.md`

**Defers (named here so we don't argue mid-Builder):**

- Legal copy itself — separate content-only PR; Builder ships stubs only
- PT and ES marketing translations — `marketing.json` files exist with EN fallback strings; localisation is a one-sitting follow-up session post-launch
- Product screenshots / dashboard frames on the landing page — editorial direction is screenshot-free by deliberate choice; revisit once dashboard UI review pass is done
- Logos / testimonials / customer quotes — pre-launch reality, the IA replaces this slot rather than faking it
- Demo video / Loom embed — no recording exists; placeholder embed is worse than no embed
- Blog / changelog routes — separate marketing surface, post-launch
- Cookie consent banner — analytics posture in §12 keeps us out of consent territory at launch; revisit if we add anything beyond first-party page-view counts
- Pricing toggle (monthly/annual) — annual pricing not yet decided
- A/B testing infrastructure on hero variants — Phase 2+, post-data
- Internationalised OG images (per-locale title rendering) — EN-only OG matches EN-only copy
- Sitemap auto-generation from a CMS — flat static `app/sitemap.ts` covering the five routes is sufficient
- Marketing analytics dashboard — Vercel Analytics page-view counts only
- Custom 404 for marketing routes — the existing `[locale]/not-found.tsx` covers this

---

## Pre-session checklist

- [ ] Session 15D complete; `drain-email-outbox` worker live; current-phase.md reflects it
- [ ] You can articulate the villain in one sentence without looking at the memory note (this is the litmus test for whether the ADR copy will land)
- [ ] You've sat with *"You know what to say. SŌSH makes sure you actually say it."* for at least one day and still want to ship it as-is — last chance to revise before it gets locked in code and email
- [ ] You have decided whether the `/pricing` page renders the FAQ inline or omits it (default: inline; see D4)
- [ ] `npx tsc --noEmit --skipLibCheck` clean; full test suite green
- [ ] `npm view motion version` returns ≥ 11.x (the rebranded Framer Motion); confirm SSR support in your Next.js 16 version before Architect starts
- [ ] claude-mem running at http://localhost:37777
- [ ] You've skimmed `app/[locale]/(marketing)/page.tsx` as it stands today (the Session 1 placeholder) so you remember what's being deleted

---

## Part A — Architect Session (Opus 4.7)

### How to run

1. `claude` → `/model` → **Claude Opus 4.7**
2. Paste Primer
3. Architect lists planned ADR sections + IA spine + the full EN copy outline (headlines and subheads only at this stage, not body); **wait for explicit approval**
4. Paste Architect Prompt
5. Architect writes ADR 0009 with full inline copy
6. Type confirmation line and `/exit`
7. **STOP.** Read the ADR end-to-end, especially §6 (Copy). Push back on any line of the hero, problem, or solution copy in a fresh chat before Builder/Reviewer prompts are drafted. This is the highest-leverage pushback opportunity in the entire pre-launch sequence — every email subject line, every dashboard empty state, and every onboarding step thereafter inherits this voice.

### Primer

```
/resume-session

Read /CLAUDE.md, /docs/current-phase.md, /AGENTS.md.

Read /docs/decisions/0007-launch-hardening.md §B7 — design
tokens, Stone palette, focus ring, typography scale. The
marketing surface must be VISUALLY CONTINUOUS with the
dashboard chrome; the landing page is not a separate brand.

Read /lib/stripe/plan.ts — getPlanCapabilities is the SINGLE
SOURCE OF TRUTH for pricing card content. The Architect specs
how PricingCards reads from this, not from a duplicate
constant in components/marketing/.

Read /app/[locale]/(marketing)/page.tsx — the Session 1
placeholder. This is what's being replaced. The (marketing)
route group already exists; you're extending it, not
introducing it.

Read /docs/decisions/0008-transactional-email.md §8a — the
copy-as-deliverable model. Adopt the same posture for §6 of
this ADR: full EN copy inline in the ADR, every headline,
subhead, body paragraph, CTA, FAQ Q+A. The Builder transcribes
verbatim into i18n/en/marketing.json — no copy invention,
no rewording, no "I'll improve this line."

That's the full primer. For anything else — ADR conventions,
the i18n shape, the (marketing) vs (dashboard) route group
distinction, the launch-checklist patch format — read the
relevant file IN-PLACE when you reach the section that needs
it. Cross-reference by section number; do not restate.

You are the Architect. Output is ONE markdown file:
/docs/decisions/0009-landing-page-positioning.md. No .ts, no
.tsx, no .mdx, no JSON files, no migration files, no config
edits, no component code. Schemas, file trees, and code shapes
appear as fenced blocks INSIDE the ADR. The full EN copy
appears as fenced blocks inside §6. A launch-checklist patch
appears as a fenced markdown block at the end of the ADR — the
Builder applies it.
```

### Architect Prompt

```
You are the Architect for SOSH Session 16 — Landing Page &
Positioning.

DELIVERABLE: /docs/decisions/0009-landing-page-positioning.md

Match the voice and density of ADR 0007 and ADR 0008. Cross-
reference prior ADRs by section number rather than restating
their content. Lead with a single headline decision.

POSTURE — read before writing:

This is a design ADR AND a copy ADR. At every contested
decision below, you state the alternative considered and the
reason for the choice — "editorial over product-led" is not
a fact, it's a trade-off with a named loser (lower
self-evidence about what the product does, higher reliance
on copy carrying the demonstration) and a winner (no
dependence on un-polished screenshots, brand differentiation,
Builder unblocked today). Use the same pattern throughout.

For §6 (Copy), the posture is different: there is no
trade-off discussion, only the locked text. Every word ships.
If you find yourself writing "the Builder can adjust this
line," stop and either commit to the line or remove it.

ORDER OF OPERATIONS:

1. Before writing the ADR body, output:
   (a) the planned section list with one-line summaries
   (b) the IA spine for `/` — section names in order, with
       one-line intent per section (no copy yet, just the
       skeleton)
   (c) the list of contested decisions you'll resolve, with
       your proposed answer for each
   (d) the hero copy — exact final text, EN — so it can be
       reviewed before everything downstream is anchored
       to it
   Wait for explicit user approval before writing the ADR
   body.

LOCKED CONSTRAINTS (do not re-litigate; these were decided
upstream of this session):

L1. Headline (locked verbatim, no variants explored):
    "You know what to say. SŌSH makes sure you actually
    say it."
    Use the Ō with macron. This is the brand spelling.

L2. Villain framing (locked): the gap between what B2B SaaS
    founders KNOW about their domain and what they ACTUALLY
    PUBLISH on social. The product closes that gap. AI is
    NOT the villain, and AI is NOT the hero — the AI is the
    mechanism. The hero of the copy is the founder; SŌSH is
    the tool that lets them stop dropping the cadence.
    Do NOT lead with "AI-powered" anywhere in the copy. The
    word "AI" may appear once on `/`, max, and only where
    it serves clarity.

L3. ICP (locked from CLAUDE.md): B2B SaaS founders and
    marketing teams at tech companies, 1–100 employees.
    Copy speaks to them, not to agencies, not to consumers,
    not to creators.

L4. Pricing (locked): €99/mo Plus, €199/mo Pro. 14-day trial,
    card required, work email required. Source of truth is
    /lib/stripe/plan.ts → getPlanCapabilities. PricingCards
    component reads from there at render time, does not
    duplicate.

L5. Editorial / typographic visual direction (locked):
    typography-led, generous whitespace, one abstract
    supporting visual per section max (CSS or inline SVG —
    no raster images, no product screenshots, no stock
    photography, no illustrated humans, no 3D renders). The
    palette extends ADR 0007 §B7 — Stone neutrals with the
    existing accent. No new colour palette.

L6. Motion library (locked): `motion` (Framer Motion v11,
    rebranded npm package name). Used for entrance fades and
    scroll-linked reveals only. Reduced-motion preference is
    honoured via <MotionConfig reducedMotion="user"> at the
    layout root — no per-component overrides.

L7. i18n posture (locked, matches ADR 0008 §13 wart precedent):
    next-intl scaffolding for all marketing strings. EN
    authoritative. PT and ES files exist with EN strings as
    fallback values plus `// TODO: localize` comments. PT and
    ES routes resolve and render the page in EN. Launch wart;
    follow-up session post-launch.

L8. Legal pages — INFRASTRUCTURE in scope, COPY out of scope:
    /terms and /privacy routes exist, render an MDX-driven
    page wrapper, have working footer links, and contain a
    single placeholder paragraph with "Last updated: TBD".
    The real legal copy lands via a separate content-only PR
    and is not the Builder's responsibility.

L9. Pricing surface — DUAL ROUTE, SHARED COMPONENT: the
    pricing block appears both as a section on `/` and as
    its own `/pricing` route. The two surfaces render the
    same <PricingCards /> component with no prop drift. The
    `/pricing` route additionally renders a FAQ section
    (which `/` does not).

L10. Builder reads /lib/stripe/plan.ts and treats it as
     source of truth. If the price changes, the ADR's quoted
     prices (€99/€199) become stale but the component
     remains correct. The ADR notes this and does not duplicate
     plan capabilities in §6.

CONTESTED DECISIONS — you propose answers with named
alternatives:

D1. IA SPINE for `/`.
    Frame: conventional B2B SaaS landing IA has 7–9 sections
    (hero, social proof, problem, solution, how-it-works,
    features, pricing, FAQ, final CTA). Pre-launch we have no
    social proof. The question is which sections survive,
    which are merged, and which are cut. Propose the exact
    section list in order, with a one-line intent for each.
    Argue for the cut sections by naming what would be lost
    if they shipped.

D2. SOCIAL PROOF SLOT.
    Frame: pre-launch reality means no logos, no testimonials,
    no usage metrics. Options: (a) omit the section entirely;
    (b) replace with a "what we believe" / positioning
    statement that earns trust through point-of-view rather
    than borrowed credibility; (c) replace with a founder
    note. Decide. If (a), explain why the absence is not a
    hole. If (b) or (c), lock the exact copy in §6.

D3. HERO COMPOSITION.
    Frame: the locked headline (L1) needs a visual companion
    or it sits alone on a vast field of whitespace. Options:
    (a) headline alone, dramatic vertical centring, no
    supporting visual; (b) headline + abstract typographic
    treatment (oversized SŌSH wordmark, kinetic type, or
    similar — pure typography as the visual); (c) headline +
    a minimal CSS/SVG abstract piece (e.g., a publishing-
    cadence visualisation). Decide. Constraint: no product
    screenshots, no humans, no stock — L5.

D4. PRICING-PAGE FAQ.
    Frame: a FAQ on `/pricing` answers the predictable
    objections (annual billing? team seats? cancel anytime?
    what happens after the trial? which platforms are live?).
    Without it, the page is a price tag with a button. Lock
    the question list now — 5–7 questions, exact EN wording
    in §6. The Builder transcribes; does not invent
    questions.

D5. MDX LIBRARY for legal pages.
    Frame: @next/mdx (compile-time, App Router-first,
    integrates via next.config) vs next-mdx-remote (runtime
    rendering, more flexibility, more weight). Legal copy is
    static, version-controlled, no live editing requirement.
    Decide and justify. Spec the resulting file layout:
    where do .mdx files live (content/legal/?), what does
    the page wrapper look like (frontmatter shape: title,
    lastUpdated, locale).

D6. ROUTING & LAYOUT TOPOLOGY.
    Frame: confirm the (marketing) route group hosts /,
    /pricing, /terms, /privacy. Spec the marketing layout.tsx
    — header, footer, <MotionConfig>, locale switcher,
    skip-to-content link. Header link list: confirm Pricing,
    Sign in, Start free trial. Footer link list: confirm
    Product / Legal / Company columns. Spec exact link sets.
    The (dashboard) layout is untouched; the boundary is at
    the route group.

D7. MOTION POSTURE.
    Frame: spec the exact motion contract. Which interactions
    get entrance animations (section scroll-into-view fades
    only?), which get scroll-linked reveals, which get
    hover micro-interactions. Spec the durations (one or
    two values, no per-component drift), easing curve (one
    value), stagger model. Reduced-motion behaviour is
    locked to L6, but the ADR must name what "no motion"
    looks like — instant render, not delayed render.

D8. PERFORMANCE BUDGET.
    Frame: marketing-page Core Web Vitals are SEO-load-
    bearing. Lock LCP, CLS, INP targets. Lock the JS
    payload budget (motion adds ~30–40 KB gzipped; the
    Builder must not casually pull in other heavy
    dependencies). Lock the image strategy — since L5
    bans raster images, the budget enforces itself, but
    the ADR names this explicitly so the Builder doesn't
    sneak a hero image in.

D9. METADATA + OG IMAGE STRATEGY.
    Frame: per-page generateMetadata is straightforward.
    OG image: static PNG in /public vs runtime-generated
    via next/og (the Vercel-canonical pattern). next/og
    lets the OG image be derived from the page title +
    locked typography, but it's a runtime cost on every
    crawler fetch. Decide. Lock the route shape if
    runtime-generated.

D10. ANALYTICS & CONSENT POSTURE.
     Frame: Vercel Analytics is first-party page-view
     counting, no cookies, no consent banner required in
     EU. Adding anything beyond it (Plausible, Posthog,
     marketing pixels) trips GDPR consent. The default
     posture is Vercel Analytics only. Decide and lock,
     so the Builder doesn't reach for a Posthog snippet
     on autopilot. Confirm: no cookie banner at launch.

ADR SECTIONS (use these headings in this order; you choose
the internal structure of each based on the decisions above):

1. HEADLINE DECISION — one paragraph naming (a) editorial-
   typographic over product-led, (b) copy-locked-in-ADR over
   Builder-improvisation, (c) shared PricingCards across `/`
   and `/pricing`, (d) legal infrastructure without legal
   copy. The unifying constraint: the landing page is a
   transcription target, not a creative brief.

2. SCOPE BOUNDARIES — in/out lists matching this guide's
   "Builds" / "Defers" sections. Spell out the legal-copy
   boundary in particular: Builder ships routes + wrapper +
   stub paragraph, not Terms-of-Service prose.

3. ROUTING & LAYOUT — (marketing) route group composition,
   marketing layout.tsx shape, header + footer link sets,
   <MotionConfig> placement, locale switcher pattern, skip-
   to-content. File tree fenced block.

4. INFORMATION ARCHITECTURE — `/` section spine from D1;
   `/pricing` page composition; `/terms` and `/privacy`
   page wrapper composition. One subsection per route.

5. PRICING SURFACE — PricingCards component shape, prop
   contract, getPlanCapabilities integration, the dual-
   route reuse pattern (one component, two render contexts),
   trial CTA behaviour, "most popular" treatment (if any —
   decide), FAQ inclusion (locked to /pricing per L9).

6. COPY (EN, locked verbatim) — full inline copy for every
   section on `/`, every section on `/pricing` including the
   FAQ Q+A pairs from D4, every header/footer string, every
   metadata title/description, every OG-image string, every
   CTA label, the social-proof-replacement copy from D2 if
   applicable. Plain text fenced blocks per section, NOT
   JSON — the Builder converts to i18n keys. Voice notes:
   present tense, second person ("you"), no exclamation
   marks, no "revolutionise", no "leverage", no "unleash".
   The hero subhead and the email subject lines from ADR
   0008 §8a should feel like they share a voice.

7. LEGAL PAGE INFRASTRUCTURE — MDX library choice from D5,
   file layout, page wrapper component shape, frontmatter
   schema, the stub paragraph text (one sentence:
   "This document is being finalised. Last updated: TBD."
   — locked verbatim, EN only).

8. MOTION CONTRACT — from D7. Interaction list, duration
   values, easing curve, stagger, reduced-motion semantics.
   One fenced TS-shape block showing the canonical motion
   props object the Builder uses for every section entrance.

9. METADATA + OG IMAGES — from D9. Per-route metadata
   shape, OG image route (if runtime), OG-image content
   per route. The og/route.tsx contract is sketched here;
   the Builder writes the code.

10. i18n POSTURE — L7 spelled out. marketing.json key
    structure (suggest grouping: hero, problem, solution,
    pricing, faq, footer, meta). PT and ES fallback
    convention. The follow-up-session slot is named.

11. PERFORMANCE BUDGET — from D8. LCP, CLS, INP targets.
    JS payload ceiling. Image strategy reaffirmation
    (none).

12. ANALYTICS & CONSENT — from D10. Vercel Analytics only.
    No cookie banner. The boundary for "what would require
    one" is named so future additions don't slip past it.

13. ACCESSIBILITY — the WCAG 2.1 AA subset that matters for
    a marketing surface: contrast on editorial type (large
    type can drop to 3:1 per 1.4.3 but the body stays at
    4.5:1), focus rings continuous with ADR 0007 §B7, skip-
    to-content link, semantic landmarks (header/main/footer),
    `<a>` for navigation never `<div onClick>`, reduced-
    motion handled at the MotionConfig root, OG image alt
    text, lang attribute per locale segment. Keep it tight
    — this is not a separate audit, it's the posture.

14. TEST POSTURE — what's worth testing on a marketing page
    and what isn't. NOT: snapshot tests on hero copy
    (changes too often, breaks on every word). YES: a
    playwright/route smoke (all five routes return 200,
    contain the locked hero phrase, contain the €99 and
    €199 price strings sourced from getPlanCapabilities,
    footer links to /terms and /privacy resolve). YES: a
    unit test on PricingCards that asserts it reads
    getPlanCapabilities and renders both plans. The test
    suite remains green; the marketing surface does not
    introduce flaky tests.

15. WHAT THIS UNLOCKS / OUT OF SCOPE — explicit list of
    follow-up sessions (PT/ES translation pass, legal copy
    PR, post-launch UI review feeding back into landing-
    page screenshot section, A/B testing infrastructure).

16. LAUNCH-CHECKLIST PATCH — fenced markdown block the
    Builder applies to /docs/launch-checklist.md. New
    section "11. Landing page" with: /terms returns 200,
    /privacy returns 200, /pricing renders both plan
    prices matching getPlanCapabilities, OG image route
    returns a PNG for /, hero phrase present in / HTML,
    sitemap.ts covers all 5 routes, robots.txt allows /,
    locale switcher present in footer.

NON-GOALS (state explicitly in §15):

- Legal copy itself (separate PR)
- PT and ES translation of marketing strings (post-launch session)
- Product screenshots (post-UI-review)
- Blog / changelog (separate marketing surface)
- A/B testing (Phase 2+)
- Annual pricing toggle (pricing model not finalised)
- Demo video (no recording yet)
- Cookie consent banner (analytics posture in §12 keeps us out of consent territory)

ARCHITECT END

When you have written the ADR, do not output any further
content. Type exactly:

  ADR 0009 written. No code authored. Builder may proceed
  in a fresh session.

Then /exit.
```

### What to push back on (red-flag list for your ADR read)

Before drafting the Builder prompts, read ADR 0009 cover to cover with these in mind. Any of the following is a sign to bounce the ADR back:

- **Hero copy that isn't the locked line.** If the Architect "improves" *"You know what to say. SŌSH makes sure you actually say it."*, that's the signal to push back, not a reason to proceed. L1 is a lock, not a suggestion.
- **The word "AI" appearing more than once on `/`.** L2 caps it at one occurrence.
- **A "leverage", "revolutionise", "unleash", "supercharge", "10x", or "game-changing"** anywhere in §6. The voice notes ban these.
- **A pricing component that duplicates plan capabilities** instead of reading `getPlanCapabilities`. L10 + §5 is explicit.
- **Stub Terms-of-Service prose written by the Architect.** L8 + §7 limits the stub to the single locked sentence.
- **A motion contract with per-component duration values.** §8 + L6 wants one or two values, total.
- **An OG image strategy that ships a static PNG** if `next/og` was a viable alternative — or vice versa, without the trade-off named.
- **A "social proof" section with fabricated logos or testimonials,** or worse, real logos the company hasn't earned. D2 demands honesty.
- **PT or ES sample copy in §6.** L7 is EN-only. If the Architect drafts translations, push back — the localisation session is its own work.
- **A new colour palette.** L5 says Stone + existing accent. A new accent or a marketing-specific palette is scope creep that propagates.
- **Per-page MotionConfig.** L6 says layout root, once.
- **Image components, Hero illustrations, raster files.** L5 bans them. CSS/SVG only.
- **A pricing FAQ that asks questions you can't answer yet** (e.g., "Do you offer annual billing?" if the answer is "not yet" — the FAQ shouldn't exist if it raises objections it can't dismiss). D4 wants 5–7 sharp Qs that actually deflect objections.
- **Tests that snapshot copy.** §14 explicitly bans this — copy is the deliverable, not the assertion.

---

## What this unlocks

After Session 16:

- The welcome email from ADR 0008 lands on a real product surface for the first time. A new customer who pays €99 sees the landing page → checks out → reads `welcome-to-plan` → arrives at a dashboard whose visual identity matches the marketing chrome.
- `/terms` and `/privacy` resolve, satisfying the launch-checklist legal slots' *infrastructure* row. The copy row stays red until the content PR lands.
- `lib/stripe/plan.ts` becomes load-bearing for two surfaces (checkout already; pricing now). Future plan changes propagate to marketing without a code change.
- The voice locked in §6 becomes the reference for every dashboard empty state, every settings page tooltip, and every onboarding step that gets a copy pass post-launch. Session 14 emails inherit this voice retroactively in spirit (their copy is already locked).
- The `impeccable-design-and-taste` skill has been used on a marketing surface, which is what it's tuned for — the prior error-page application was a warm-up. The output sets the visual bar for any future marketing page.

Remaining pre-launch gaps after Session 16: legal copy (content PR, non-engineering), PT/ES marketing translations (one follow-up session), engineering-debt cleanup (plan-limit hardcoding sweep, middleware → proxy rename, pre-launch reviewer backlog), Stripe live-mode flip.

---

# Session 16 — Part B (Builder) + Part C (Reviewer)

> Companion to `session-16.md` (Part A — Architect). Run only after `docs/decisions/0009-landing-page-positioning.md` is committed and you've read §6 (Copy) cover-to-cover one more time. The Builder transcribes; it does not rewrite.
>
> **Plugins:** ECC throughout (`/plan` → `:tdd` → `:verify`), claude-mem automatic, **`impeccable-design-and-taste` enabled for the Builder** — this is the session it was added for. Reviewer runs with claude-mem only.
>
> **Skills the Builder should reach for during the session** (named so it doesn't have to guess):
> - `engineering:architecture` for any sub-decision not pre-locked in the ADR (there should be very few)
> - `design:design-system` for token discipline — the marketing surface introduces zero new tokens; the skill helps the Builder *resist* adding them
> - `design:accessibility-review` for the §13 posture as the Builder writes interactive elements
> - `engineering:testing-strategy` for the §14 spec (route smoke + PricingCards unit, no copy snapshots)
>
> **Reviewer skills:** `engineering:code-review` and `engineering:architecture` (ADR-conformance audit).

---

## Pre-Builder ritual

- [ ] ADR 0009 committed; `current-phase.md` updated to "Session 16A complete — ADR 0009 written"
- [ ] You've re-read §6 (Copy) end-to-end and still want every line as written. Last chance — once Builder runs, those strings exist in three locale files and five routes.
- [ ] `npx tsc --noEmit --skipLibCheck` clean
- [ ] Full test suite green
- [ ] `npm view motion version` returns ≥ 11.x (the rebranded Framer Motion package name is `motion`)
- [ ] `npm view @next/mdx version` returns a version compatible with Next 16 (if not, check the Next 16 release notes — `@next/mdx` had churn around that line; the ADR §7 picked it deliberately, so if compatibility is broken, push back to me before Builder, not mid-B4)
- [ ] claude-mem running at http://localhost:37777
- [ ] You've eyeballed the Session 1 placeholder at `app/[locale]/(marketing)/home/page.tsx` so you remember what's being deleted by §3.4

---

## Part B — Builder Session (Sonnet 4.6)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Sonnet 4.6**
3. Plugins: confirm `impeccable-design-and-taste` is active for this session (per CLAUDE.md, it's added only for UI surfaces)
4. Paste **Primer**
5. claude-mem injects prior-session context — let it settle, then proceed
6. Run prompts **B1 through B6 in order** — do NOT `/clear` between them
7. Each prompt ends with `/verify` — wait for green before the next prompt
8. After B6, type one confirmation line and `/exit`. Do not start the Reviewer in the same session.

### Primer

```
/resume-session

Read /CLAUDE.md, /AGENTS.md, /docs/current-phase.md.

Read /docs/decisions/0009-landing-page-positioning.md END-TO-END
before writing any code. This ADR is unusually copy-heavy and
unusually prescriptive — every shipped string lives in §6, and
the Builder transcribes verbatim. If you find yourself "improving
a line," that is a defect, not a contribution.

Read /lib/stripe/plan.ts — getPlanCapabilities is the source of
truth for plan limits. §5 of the ADR extends THIS file with
MARKETING_PLANS and pricingFeatureRows; no duplicated capability
constants in components/marketing/.

Read /app/[locale]/layout.tsx and /i18n/request.ts so you know
the existing i18n shape before adding the marketing namespace.

Read /app/[locale]/(marketing)/home/page.tsx and
/app/[locale]/page.tsx — these are what §3.4 deletes. Confirm
the redirect chain before you remove it.

Read ADR 0007 §B7 (Stone palette, focus ring, typography). The
marketing surface uses ONLY these tokens. Zero new colors, fonts,
or radii.

Read ADR 0008 §8a — the copy-as-deliverable model. Same posture
applies here.

You are the Builder. You output code and config. You do not
write marketing prose. Every string visible on /, /pricing,
/terms, or /privacy comes verbatim from ADR 0009 §6 (or from
getPlanCapabilities for plan limits). If you find a string in
the ADR you think is awkward, that's a finding for the Reviewer
session — not something you fix in code.

For each prompt below, ECC: /plan "title" — write the plan,
implement, then /verify before moving on. Do NOT /clear between
prompts; the session context carries forward.
```

---

### Prompt B1 — Marketing chrome, i18n namespace, motion provider boundary

```
/plan "Marketing chrome, i18n namespace, motion provider boundary"

Goal: stand up the (marketing) route group with public chrome,
the marketing i18n namespace populated VERBATIM from ADR 0009 §6,
the motion provider boundary at the layout root, and the §3.4
URL change that makes / the canonical homepage.

Scope of this prompt (six discrete pieces):

1. Add the `motion` package (Framer Motion v11, npm name `motion`).
   Verify Next 16 compatibility before installing if the version is
   newer than what the ADR was written against. No other client
   deps added in this prompt.

2. i18n namespace `marketing`:
   - Create i18n/en/marketing.json with the FULL contents of
     ADR 0009 §6 transcribed verbatim. Convert dot-keys to nested
     JSON. Root keys (from §10): nav, hero, gap, how, features,
     pov, pricing (nested: heading, subhead, see_all, tiers,
     feature, trial_note), pricingPage, faq, finalCta, footer,
     meta, og, legal_stub.
   - Create i18n/pt/marketing.json and i18n/es/marketing.json
     with the EN strings as values, plus a root-level "_todo"
     key with value "localize — ADR 0009 §10" (per ADR §10).
     PT and ES routes will render in EN at launch; this is a
     named wart, not a defect.
   - Register the marketing namespace in i18n/request.ts per
     ADR §10 (see the snippet at lines 504-509 of the ADR).
   - REMOVE the placeholder `marketing.hero.*` block from
     i18n/{en,pt,es}/common.json. Confirm no consumer outside
     the (marketing) route group reads `marketing.hero.*` from
     common before deleting — grep first.

3. (marketing)/layout.tsx as a Server Component, with a thin
   'use client' wrapper component MotionProviders that holds
   <MotionConfig reducedMotion="user">. See ADR §3.2 for the
   shape. The skip-to-content link is the first focusable
   element targeting #main. Layout itself stays a Server
   Component; only MotionProviders is client.

4. MarketingHeader (sticky, border-b, bg-background/80
   backdrop-blur, wordmark link to /, Pricing link to /pricing,
   Sign in to /login, Start free trial as primary
   buttonVariants-styled link to /signup). Use the
   `cn(buttonVariants({...}))` pattern for CTAs — never
   <Button asChild> (per CLAUDE.md).
   MarketingFooter with the three columns + locale switcher +
   copyright per ADR §3.3 and §6.9. Locale switcher per §3.5.

5. components/marketing/motion.ts: export SECTION_MOTION and
   STAGGER_CHILD with the EXACT values from ADR §8 (duration
   0.5, ease [0.22, 1, 0.36, 1], opacity/y, viewport once with
   -10% 0px margin). No drift on any value. Type as const.

6. §3.4 URL change:
   - Create (marketing)/page.tsx as a STUB that renders <Hero />
     (Hero component placeholder for now; B3 builds the real
     sections). Use the eyebrow/headline/subhead from
     marketing.hero.* via getTranslations('marketing.hero').
   - Delete (marketing)/home/page.tsx and the (marketing)/home/
     directory.
   - Delete app/[locale]/page.tsx (the redirect to /home). The
     new (marketing)/page.tsx now satisfies /{locale}.
   - Update any internal links that pointed at /{locale}/home —
     grep first; expect mostly nav patterns and possibly a Stripe
     success_url. Each updated location is a small finding to
     surface in the verify step.

Architectural conventions (non-negotiable, from CLAUDE.md):
- All strings via next-intl. No hardcoded user-visible text.
- Tailwind only — no inline style, no CSS modules.
- Server Components by default; the only 'use client' here is
  MotionProviders and (later, B3) any section using motion props.
- All env access via lib/config.ts; no process.env in this work.
- No `any` types.
- No console.* in committed code.

/verify

Verification checklist (in addition to /verify):
- tsc --noEmit --skipLibCheck clean
- /en, /pt, /es all return 200 and render the marketing layout
- Wordmark, Pricing link, Sign in, Start free trial all visible
  in the header; footer columns + locale switcher visible
- prefers-reduced-motion test: with reduce-motion enabled in OS,
  no animations fire (Hero stub may have nothing animated yet —
  that's fine)
- npm run build clean
- The old (marketing)/home/ and the [locale]/page.tsx redirect
  are gone from the repo
```

---

### Prompt B2 — Pricing surface (shared component + /pricing route + FAQ)

```
/plan "Pricing surface — shared PricingCards + /pricing route + FAQ"

Goal: ship the dual-route pricing surface that ADR §5 + §4.2 +
§6.11–§6.13 specify. One component. Two render contexts. Zero
duplication of plan capabilities.

Scope:

1. Extend lib/stripe/plan.ts (do NOT create a new file in
   components/marketing/ for this):
   - Add MARKETING_PLANS readonly array of ['plus', 'pro'].
   - Add PricingFeatureRow interface and pricingFeatureRows
     function exactly as written in ADR §5.2 (lines 173-204).
     ALL_PLATFORMS is already in the file; reference it
     in-module.

2. components/marketing/PricingCards.tsx — Server Component, NO
   PROPS, per ADR §5.3 (lines 211-222). It MUST work identically
   when dropped into /'s pricing section and into /pricing's body.
   The component reads getTranslations('marketing.pricing'),
   maps MARKETING_PLANS to cards, and renders each card's
   feature rows from pricingFeatureRows(plan). CTA on both
   cards: <Link href="/signup" className={cn(buttonVariants({
   size: 'lg' }))}>{t(`tiers.${plan}.cta`)}</Link>. Pro card
   carries the "Most popular" badge (§5.4) — small pill with
   ring-1 ring-primary/30; no other visual difference between
   the cards.

3. components/marketing/PricingFaq.tsx — Server Component.
   Six locked Q+A from ADR §6.13. Native <details>/<summary> per
   §5.4 of session-16.md and §13 of the ADR. CSS-only chevron
   rotation via group-open:; no JS, no 'use client'. The
   <summary> carries the shared focus ring. Default <details>
   marker hidden via [&::-webkit-details-marker]:hidden.

4. app/[locale]/(marketing)/pricing/page.tsx — composition only:
   compact hero from marketing.pricingPage.* (§6.12), then
   <PricingCards />, then <PricingFaq />. generateMetadata
   reads marketing.meta.pricing_title and pricing_description
   (B5 wires this fully — for this prompt, basic title and
   description metadata is fine; B5 layers on OG and hreflang).

5. Confirm the shared-component invariant holds: render
   <PricingCards /> on / (you'll wire the section in B3) and
   on /pricing. The component has no props. If a Builder
   thought enters your head to add a `compact` or `variant`
   prop, that's a violation of ADR §5.3 — push back in the
   verify step instead.

Architectural conventions:
- pricingFeatureRows lives in lib/stripe/plan.ts. If you find
  yourself putting plan capabilities in components/marketing/,
  stop — that's the exact thing §5.1 forbids.
- Server Components. No 'use client' in any of the three new
  files.
- Strings via next-intl. The €99/€199 strings are in
  marketing.pricing.tiers.*.price — presentational. The
  factual limits come from getPlanCapabilities.

/verify

Verification checklist:
- /pricing returns 200 and shows both cards with feature rows
  derived from getPlanCapabilities: Plus = 50 posts a month /
  Up to 5 active campaigns / LinkedIn + X (Twitter) / Basic
  analytics; Pro = Unlimited posts / Unlimited active campaigns
  / All 5 channels — … / Advanced analytics / Engagement inbox.
  (Exact label text per §6.11.)
- "Most popular" pill renders on Pro only.
- The 6 FAQ entries from §6.13 are present verbatim; clicking
  / Enter / Space on a <summary> expands.
- Keyboard-tab through the page surfaces focus rings on every
  interactive element (cards CTAs, FAQ summaries).
- tsc --noEmit --skipLibCheck clean.
- Greps for plan capability constants in components/marketing/
  return nothing. The single source of truth is lib/stripe/plan.ts.
```

---

### Prompt B3 — Homepage section components + composition

```
/plan "Homepage sections — Hero, TheGap, HowItWorks, WhatYouGet, WhereWeStand, FinalCta — and / composition"

Goal: build the seven sections of /'s spine per ADR §4.1, all
copy verbatim from §6, with the canonical motion wrapper from §8.

Scope:

1. components/marketing/Section.tsx — the canonical section
   wrapper. Thin 'use client' component using
   `motion.section` from 'motion/react' with the SECTION_MOTION
   props spread on it. Accepts children + optional id + className.
   This is the ONLY place section entrance motion lives. Every
   section component below renders <Section id="...">…</Section>.

2. The six section components, ALL Server Components except
   where they need <Section> (which is a client island around the
   content):
   - Hero — id implicit (no anchor); renders
     marketing.hero.eyebrow / .headline / .subhead / two CTAs
     (.cta_primary → /signup primary; .cta_secondary →
     #how anchor link) and .trust line.
     Layout: oversized headline (per ADR §13 large-display
     contrast leeway), generous whitespace. No raster, no SVG
     hero illustration — typography carries the section.
   - TheGap — id="gap" — renders marketing.gap.heading /
     .subhead and the three problem cards
     (card_team, card_quiet, card_generic). Cards use the
     dashboard `Card` pattern or `border bg-card rounded-2xl p-6`
     per ADR §4.2.
   - HowItWorks — id="how" — renders .heading / .subhead and
     four numbered steps (step1..step4). Use STAGGER_CHILD on
     each step so they enter in sequence.
   - WhatYouGet — id="features" — renders .heading / .subhead
     and six feature tiles (voice, campaigns, native, approval,
     analytics, languages). Stagger.
   - WhereWeStand — renders .eyebrow / .heading / .body / .pull
     (the pull is the differentiator one-liner; emphasize via
     larger type, not color).
   - FinalCta — renders .heading / .subhead / .cta button (to
     /signup) / .trust line.

3. app/[locale]/(marketing)/page.tsx — replace the B1 stub with
   the real composition:
   <>
     <Hero />
     <TheGap />
     <HowItWorks />
     <WhatYouGet />
     <WhereWeStand />
     <PricingCards />     {/* from B2; wrap in a <Section> with id="pricing" if needed for the anchor */}
     <FinalCta />
   </>
   Anchor IDs on TheGap/HowItWorks/WhatYouGet and on the
   PricingCards wrapper match the nav (Pricing link → /pricing,
   not #pricing; but the footer Features link goes to /#features).

4. Visual posture (ADR §1, §11, §13):
   - One <h1> only — in Hero. Sections use <h2>; cards <h3>.
   - max-w-6xl mx-auto px-6; py-20 / py-24 between sections.
   - Stone tokens only — no new color values, no new fonts.
   - One abstract CSS/SVG mark per section MAXIMUM, and only
     where it earns its place (e.g. a subtle background gradient
     or a numbered-step marker). No raster images, no humans,
     no stock, no product chrome.
   - The WhereWeStand pull quote uses heading-scale type and
     `--muted-foreground` or similar, NOT a new accent color.

5. Confirm only the section content that actually uses motion
   sits inside a 'use client' boundary (the Section wrapper).
   Section bodies (the cards, the step list, the feature grid)
   remain RSC-rendered, passed as children into <Section>.

`impeccable-design-and-taste` invocation: this is the prompt
where the skill earns its keep. Use it for spacing rhythm,
type pairing, the WhereWeStand pull quote treatment, and the
step-numbering composition. Do NOT use it as a license to
introduce new tokens or motion semantics that conflict with
the ADR; the skill informs the *application* of locked
constraints, it doesn't loosen them.

/verify

Verification checklist:
- / returns 200 in all three locales.
- Every section renders the §6 copy VERBATIM. The hero
  headline reads exactly: "You built something worth hearing
  about. SŌSH makes sure your market does." If a word is
  different, that's a defect.
- The word "AI" appears ZERO times in the rendered HTML of /.
  (grep the rendered HTML or just the marketing.json EN file.)
- Section entrance animations fire on scroll (whileInView, once);
  with prefers-reduced-motion enabled, sections render instantly
  in place.
- Anchor links from the header / footer scroll to the correct
  sections.
- tsc / vitest / build all clean.
```

---

### Prompt B4 — Legal infrastructure (MDX, /terms, /privacy)

```
/plan "Legal infrastructure — @next/mdx wiring, content/legal stubs, /terms and /privacy routes"

Goal: ship the legal-pages INFRASTRUCTURE per ADR §7. Routes
exist, MDX wrapper compiles, footer links resolve to 200. NO
legal prose is written by the Builder — only the single locked
stub sentence.

Scope:

1. Install @next/mdx (or equivalent compatible with Next 16);
   wire it into next.config.ts:
   - Add the mdx() plugin configuration.
   - Add 'mdx' to pageExtensions (page files can be .mdx if
     needed, though we won't use that here — we import .mdx as
     content).
   Verify next.config.ts still passes a build before proceeding.

2. content/legal/terms.en.mdx and content/legal/privacy.en.mdx,
   each with:
   - Frontmatter exactly per ADR §7:
       ---
       title: "Terms of Service"        (or "Privacy Policy")
       lastUpdated: "TBD"
       locale: "en"
       ---
   - Body: the single locked sentence from ADR §6.15:
       This document is being finalised. Last updated: TBD.
     Nothing else. No headings, no boilerplate, no GDPR
     paragraph. Anything beyond that sentence is a defect.

3. components/marketing/LegalPage.tsx — Server Component that
   takes slug: 'terms' | 'privacy', loads the compiled MDX +
   frontmatter for that slug, and renders the structure from
   ADR §7 (article with `prose mx-auto max-w-2xl py-20`, h1
   from frontmatter.title, "Last updated: {frontmatter.lastUpdated}"
   in --muted-foreground, then the MDXContent).

4. app/[locale]/(marketing)/terms/page.tsx and
   app/[locale]/(marketing)/privacy/page.tsx — thin route
   files that render <LegalPage slug="terms" /> and
   <LegalPage slug="privacy" /> respectively. generateMetadata
   reads marketing.meta.terms_title and privacy_title (B5
   completes the metadata story).

5. Confirm the footer links (built in B1) actually resolve to
   /terms and /privacy now, not # placeholders. If B1 used #
   as a stub, fix it here.

6. PT and ES routing: at launch, /pt/terms and /es/terms also
   load the same .en.mdx content. The frontmatter `locale: "en"`
   is the source-of-truth marker that this is the EN stub being
   served to all locales. The follow-up legal-copy PR adds
   .pt.mdx / .es.mdx; the wrapper can read frontmatter from a
   per-locale file at that point. Do NOT pre-build the
   per-locale resolution here — leave the resolver as "always
   .en.mdx" at launch, with a TODO comment naming the
   follow-up.

/verify

Verification checklist:
- /terms and /privacy return 200 in all three locales.
- Both pages render: title from frontmatter, "Last updated: TBD"
  line, and the single sentence "This document is being
  finalised. Last updated: TBD." Nothing else.
- next.config.ts integration: npm run build clean; no MDX-
  related warnings.
- Footer Terms and Privacy links navigate correctly.
- tsc / vitest / build all clean.
```

---

### Prompt B5 — Metadata, runtime OG image, sitemap, robots

```
/plan "Metadata, runtime OG image route, sitemap.ts, robots.ts"

Goal: per-route metadata, runtime OG image, sitemap, and robots
per ADR §9 + the launch-checklist patch in §16.

Scope:

1. Per-route generateMetadata for all four marketing routes (/,
   /pricing, /terms, /privacy). Each reads marketing.meta.*
   (§6.10) for title and description. openGraph: title,
   description, type 'website', locale, images: ['/og?route=<route>']
   (relative to locale). twitter: card 'summary_large_image'.
   alternates: self-canonical per locale + hreflang for en/pt/es
   + x-default → /en/<route>. Use a small helper if the
   per-route metadata gets repetitive — but keep it readable.

2. OG image route: app/[locale]/(marketing)/og/route.tsx,
   Edge runtime, exporting GET that returns ImageResponse
   1200×630. The `route` query param maps to marketing.og.*
   per ADR §6.14 (home, pricing, terms, privacy). Default /
   unknown param → home string.
   Visual contract per ADR §9: Stone palette, --background as
   bg, --foreground type, large editorial wordmark + the
   locked line for that route. The Builder writes the JSX
   inside ImageResponse to match — same type system as the
   landing page, but rendered at OG dimensions.
   IMPORTANT: ImageResponse can't read CSS variables — translate
   the Stone token values to literal hex/oklch in the JSX.
   Source the literal values from app/globals.css; do NOT
   invent new values.
   The OG image alt text in metadata is the same locked line
   (ADR §13).

3. app/[locale]/sitemap.ts — exports the default sitemap function
   listing /, /pricing, /terms, /privacy across en/pt/es with
   priorities (/ = 1.0, /pricing = 0.9, /terms and /privacy = 0.3).
   changefreq monthly for /, /pricing; yearly for /terms, /privacy.

4. app/robots.ts — allow /; reference the sitemap URL.

5. Smoke-check: curl -I against /og?route=home returns
   image/png; the four route HEAD requests return 200 with
   correct Content-Type.

/verify

Verification checklist:
- View-source on / and /pricing shows og:title, og:description,
  og:image, twitter:card, hreflang alternates for en/pt/es +
  x-default.
- /og?route=home returns a 1200×630 PNG with the locked hero
  line and the SŌSH wordmark in Stone styling.
- /og?route=pricing returns the locked pricing line PNG.
- /og?route=terms and /og?route=privacy return "SŌSH — Terms"
  and "SŌSH — Privacy" respectively.
- /og (no param) returns the home image (default).
- /sitemap.xml lists all four marketing routes across three
  locales.
- /robots.txt allows / and references the sitemap.
- tsc / build clean.
```

---

### Prompt B6 — Tests, checklist patch, final verify

```
/plan "Route smoke test, PricingCards unit test, launch-checklist patch, final tsc/vitest/build pass"

Goal: write the two tests ADR §14 specifies, apply the §16
launch-checklist patch verbatim, run the full verification
pass.

Scope:

1. PricingCards unit test (lib/stripe/plan.test.ts or
   components/marketing/PricingCards.test.tsx, whichever fits
   the existing test convention better):
   - Test pricingFeatureRows('plus') returns rows whose
     interpolated labels read: "50 posts a month",
     "Up to 5 active campaigns", "LinkedIn + X (Twitter)",
     "Basic analytics" — and crucially, the row keys derive
     from getPlanCapabilities('plus'). If a future change
     bumps Plus to 100 posts/month, this test catches the
     marketing surface lagging.
   - Test pricingFeatureRows('pro') returns: posts_unlimited,
     campaigns_unlimited, platforms_all with count 5,
     analytics_advanced, inbox.
   - DO NOT snapshot the full rendered HTML (ADR §14 explicitly
     bans copy snapshots). Assert on the key/values structure
     instead.

2. Route smoke test (Playwright OR a lightweight Vitest +
   fetch test that boots the Next app — whichever matches the
   existing repo convention; if neither exists, prefer a
   Vitest-based test that imports the page components and
   asserts on rendered output):
   - /, /pricing, /terms, /privacy all return 200.
   - /og?route=home returns image/png.
   - / HTML contains the exact substring "makes sure your
     market does" (verifies the locked hero phrase is in place).
   - /pricing HTML contains "€99" and "€199" (verifies the
     pricing card path through capabilities → pricingFeatureRows
     → marketing.json renders).
   - Footer links /terms and /privacy resolve (HEAD 200).
   These assertions must not snapshot whole pages — they test
   for presence of load-bearing strings only.

3. Apply ADR §16 launch-checklist patch to
   docs/launch-checklist.md verbatim. Insert as a new "### 11.
   Landing page (ADR 0009)" section. Do not duplicate existing
   rows.

4. Update docs/current-phase.md to note Session 16 build
   complete (Reviewer pending).

5. Final verification pass:
   - npx tsc --noEmit --skipLibCheck
   - npx vitest run (full suite green)
   - npm run build
   - npm run dev → manually visit /en, /pt, /es for all four
     routes + /og — confirm all render.
   - Lighthouse or web-vitals quick check on / and /pricing:
     LCP < 1.8s, CLS < 0.05, INP < 200ms (these may need a
     production-build serve, not dev mode).

/verify

Final report-back checklist:
- All tests green.
- tsc clean.
- build clean.
- launch-checklist.md row count: count the new rows added under
  "### 11. Landing page" — should match the ADR §16 patch row
  count exactly.
- current-phase.md updated.
- One-line summary of any deviations from the ADR (there should
  be none; if there are, name them so the Reviewer sees them
  immediately).
```

---

### Builder end

When B6 verifies green, report back here with:

- the row count of new launch-checklist rows (sanity check against ADR §16)
- the JS bundle size for `/` and `/pricing` (against the ≤ 90 KB gz budget)
- any deviations from the ADR you had to make and why (there should be none; if there are, this is the moment to name them, not the Reviewer's)

Do NOT start the Reviewer in the same Claude Code session. `/exit` and start a fresh session for Part C.

---

## Part C — Reviewer Session (Opus 4.7)

### How to run

1. Fresh terminal session — `/exit` from Builder first
2. `claude` → `/model` → **Claude Opus 4.7**
3. Plugins: claude-mem only. `impeccable-design-and-taste` is OFF for the Reviewer (the Reviewer audits taste; it doesn't apply it).
4. Paste **Primer**
5. Paste **Reviewer Prompt**
6. Reviewer produces tiered findings (BLOCKER / MAJOR / MINOR / NIT)
7. You read findings, classify any disputes, and either ship to a correction pass (Session 16D) or accept and move on

### Primer

```
/resume-session

Read /CLAUDE.md, /AGENTS.md, /docs/current-phase.md.

Read /docs/decisions/0009-landing-page-positioning.md
END-TO-END. This is the contract you audit against.

Read ADR 0007 §B7 (the design-token contract this surface
extends) and ADR 0008 §8a + §13 (the copy-as-deliverable
and EN-only-wart precedents this session inherits).

Read the Builder's diff between Sessions 15 and 16 by
walking the file tree from ADR §3.1 — every file the Builder
created or modified is in scope.

You are the Reviewer. Output is ONE markdown findings report
with tiered findings: BLOCKER (must fix before merge),
MAJOR (should fix before launch), MINOR (would improve),
NIT (preference). You write no code. You suggest no
rewrites of marketing copy — copy was locked in ADR §6 and
the Builder transcribed; if the Reviewer disagrees with a
line, that is a follow-up ADR amendment, not a finding.

For each finding: name the ADR section or CLAUDE.md
convention it violates, quote the offending code or string
briefly, state the expected behavior. No essays.
```

### Reviewer Prompt

```
You are the Reviewer for SOSH Session 16 — Landing Page &
Positioning.

DELIVERABLE: a markdown findings report at
/docs/reviews/0009-landing-page-review.md (create the
directory if missing). Tiered as BLOCKER / MAJOR / MINOR /
NIT. End with a one-line verdict: "Ready to ship" / "Ship
after correction pass" / "Re-architect".

AUDIT AGAINST ADR 0009 SECTION BY SECTION. For each section
below, name what you checked and what you found. If a
section is clean, say "Clean" and move on — no padding.

§1. Headline decision + positioning.
   - Does any rendered string on / lead with "AI" or
     "AI-powered"? Find one and it's a BLOCKER (ADR §1
     and §6 voice notes).
   - Grep i18n/en/marketing.json for case-insensitive "ai" as
     a whole word. Expected count: 0. Anything > 0 is a
     BLOCKER.
   - Does the copy claim "marketing team" or "marketing
     department" anywhere (vs. "social media team")? ADR §1
     "Scope of the claim" forbids this. BLOCKER if found.
   - Does the copy claim ROI numbers, customer counts,
     testimonials, or fake logos? BLOCKER.

§2. Scope boundaries.
   - Does the Builder ship any legal prose beyond the locked
     stub sentence ("This document is being finalised. Last
     updated: TBD.")? BLOCKER.
   - Any PT or ES marketing strings that differ from EN
     (other than the _todo sentinel)? MAJOR — the wart
     contract is that PT/ES carry EN values verbatim at
     launch.

§3. Routing & layout.
   - (marketing)/page.tsx exists; (marketing)/home/ and the
     /[locale]/page.tsx redirect are gone. If the redirect
     still lives, BLOCKER.
   - MotionConfig reducedMotion="user" sits at exactly ONE
     place — the marketing layout root (inside a 'use client'
     MotionProviders). Any per-component reduced-motion
     branching is a MAJOR (ADR §8 last paragraph).
   - Skip-to-content link is the FIRST focusable element in
     the layout (WCAG 2.4.1). If it's anywhere else, MAJOR.
   - Header CTAs use cn(buttonVariants(...)), NOT <Button
     asChild> (CLAUDE.md). asChild={true} anywhere is a
     MAJOR.

§4. Information architecture.
   - / spine matches the §4.1 table: Hero, TheGap, HowItWorks,
     WhatYouGet, WhereWeStand, Pricing, FinalCta. Any extra
     section (especially a fake "social proof" or "trusted
     by" strip) is a BLOCKER. Missing section is a MAJOR.
   - /pricing has compact hero + PricingCards + PricingFaq.
     Anything else (e.g. a duplicated hero, a re-hash of
     features) is a MAJOR.

§5. Pricing surface.
   - pricingFeatureRows lives in lib/stripe/plan.ts. If it
     was moved to components/marketing/ or duplicated there,
     BLOCKER (ADR §5.1 and §5.2 are explicit).
   - <PricingCards /> takes NO PROPS. If it accepts a
     variant/compact/dense prop, BLOCKER (ADR §5.3).
   - Same <PricingCards /> is rendered on / and /pricing.
     If two different components exist, BLOCKER.
   - Plus and Pro cards show exactly the expected rows from
     §5.4 "Expected render at launch capabilities." Any extra
     row (e.g. "Priority support" hallucinated by the Builder)
     is a BLOCKER.
   - Card CTA target is /signup on both plans. If it links
     to a plan-specific Stripe Checkout URL directly, MAJOR
     (the post-signup flow is the Session 11A pattern).

§6. Copy (locked verbatim).
   - Diff i18n/en/marketing.json against ADR §6 section by
     section. ANY string that differs in word, punctuation,
     or em-dash usage is a BLOCKER. Whitespace-only diffs
     are NIT.
   - Hero headline exactly matches "You built something worth
     hearing about. SŌSH makes sure your market does." with
     the macron Ō. If the Builder substituted "SOSH" (no
     macron) in the headline, MAJOR; in body copy it's
     allowed (per §6 voice notes).
   - Legal stub sentence exact match: "This document is being
     finalised. Last updated: TBD." If anything was added,
     BLOCKER.

§7. Legal infrastructure.
   - @next/mdx (or equivalent) wired in next.config.ts. If
     a different MDX library was used without an ADR
     amendment, MAJOR.
   - content/legal/terms.en.mdx and privacy.en.mdx exist with
     frontmatter matching the §7 schema. Any added fields
     (e.g. "author", "version") are a NIT; missing
     lastUpdated is a MAJOR.
   - /terms and /privacy resolve to 200 and render the
     LegalPage wrapper. If footer links still point at # or
     are missing, BLOCKER.

§8. Motion contract.
   - components/marketing/motion.ts exports SECTION_MOTION
     and STAGGER_CHILD with the EXACT values from §8 —
     duration 0.5, ease [0.22, 1, 0.36, 1], opacity 0→1,
     y 12→0, viewport once with -10% 0px margin. ANY drift
     is a MAJOR.
   - <MotionConfig reducedMotion="user"> appears at layout
     root only. Per-component reducedMotion settings: MAJOR.
   - Hover micro-interactions implemented via motion: MAJOR
     (ADR §8: hover lives in buttonVariants, not motion).
   - Parallax or scroll-linked transforms anywhere: MAJOR
     (out of scope per §8).

§9. Metadata + OG.
   - Each of /, /pricing, /terms, /privacy has
     generateMetadata reading marketing.meta.*.
   - openGraph.images points at /og?route=<route> per
     locale.
   - hreflang alternates cover en/pt/es + x-default.
     Missing x-default: MAJOR.
   - /og runs on Edge runtime (ADR §9). Node runtime: MAJOR.
   - /og?route=<unknown> falls back to home string.

§10. i18n posture.
   - marketing namespace registered in i18n/request.ts.
   - i18n/pt/marketing.json and i18n/es/marketing.json carry
     EN strings as values plus a "_todo" sentinel key.
     If the Builder shipped real PT/ES translations, MAJOR —
     that's the next session's work.
   - Placeholder marketing.hero.* removed from all three
     common.json files. If still present, MAJOR (it's a
     conflicting source of truth).

§11. Performance.
   - First-load JS for / and /pricing ≤ 90 KB gz. Bundle
     analyzer or the Vercel deploy output is the source of
     truth. > 90 KB gz: MAJOR; > 110 KB gz: BLOCKER.
   - No raster images in /public/ marketing assets. If a
     hero.png or screenshot appeared, BLOCKER.
   - No client dep added beyond `motion`. If the Builder
     pulled in framer-motion (the old package, separate from
     `motion`), recharts, swiper, or similar: MAJOR.

§12. Analytics & consent.
   - Vercel Analytics is the ONLY analytics. No GA4, no
     PostHog snippet, no LinkedIn/Meta pixel. If found:
     MAJOR (and the consent banner now becomes load-bearing).
   - No cookie banner present. If one was added without an
     ADR amendment, MAJOR.

§13. Accessibility.
   - Exactly one <h1> on each page. > 1 is a MAJOR.
   - All interactive elements show the shared focus-visible
     ring. Any `outline-none` without a replacement ring:
     MAJOR.
   - <details>/<summary> for the FAQ — keyboard operable.
     If the Builder reached for a JS-driven accordion ('use
     client'): MAJOR (ADR §13).
   - prefers-reduced-motion: with the OS setting on,
     sections render instantly (no delay, no fade). If
     sections delay then snap-render, MAJOR (the semantics
     are "instant final state" per ADR §8).

§14. Tests.
   - The PricingCards unit test exists and verifies feature
     rows derive from getPlanCapabilities. Missing: BLOCKER.
   - The route smoke test exists. Missing: BLOCKER.
   - NO copy snapshot tests (ADR §14 bans these). Presence
     of a snapshot file covering hero/section copy: MAJOR
     (will break on every word edit, generating noise).

§16. Launch-checklist patch.
   - The §16 patch is applied to docs/launch-checklist.md
     verbatim. Missing rows: MAJOR.

CROSS-CUTTING (CLAUDE.md + prior ADRs):
   - All env access via lib/config.ts? grep process.env
     under app/[locale]/(marketing) and components/marketing/.
     Any hit (outside lib/config.ts itself): MAJOR.
   - No console.* in committed code under the new files:
     MAJOR per occurrence.
   - No `any` types in new code: MAJOR per occurrence.
   - Tailwind only, no inline style, no CSS modules: MAJOR
     per file with a violation.
   - All user-visible strings through next-intl: hardcoded
     strings in JSX = MAJOR.

VERDICT:
   - Zero BLOCKERs and ≤ 2 MAJORs: "Ready to ship."
   - 1–2 BLOCKERs or > 2 MAJORs: "Ship after correction
     pass (Session 16D)."
   - 3+ BLOCKERs OR a positioning-level miss (e.g. the hero
     line is wrong, the AI cap is violated, fake social proof
     shipped): "Re-architect — escalate to a fresh Architect
     turn."

Output the report and stop. No code, no rewrites, no
suggested copy edits.
```

---

## What to do with the Reviewer report

- **Ready to ship:** merge, update current-phase.md to "Session 16 complete," tee up Session 17.
- **Ship after correction pass:** open Session 16D as a surgical fix-only Sonnet session that addresses BLOCKERs + MAJORs only; MINORs and NITs go to a pre-launch backlog file. Same `/plan`-based ECC cycles, one prompt per finding cluster.
- **Re-architect:** the hero line, the AI cap, or fabricated social proof slipped through — back to a fresh Architect with the failing constraints called out at the top of the prompt (same pattern as the corrective re-prompt that produced the current ADR 0009).

The reason for the explicit "Re-architect" tier is that positioning-level misses propagate into the next eight sessions of dashboard copy, settings tooltips, onboarding strings, and email-template revisions. A landing page that ships with the wrong hero is worse than a delayed launch.

---

## What this unlocks

When Session 16 ships:

- Five marketing routes resolve, the welcome email from ADR 0008 lands on a real surface, and the launch checklist's landing-page rows go green.
- `lib/stripe/plan.ts` becomes load-bearing for THREE surfaces (checkout, in-app billing card, marketing pricing). The §5.5 follow-up (converging the in-app billing card onto `pricingFeatureRows`) becomes more obviously the right next move.
- The voice locked in ADR §6 is now the canonical SOSH voice in code. Every dashboard empty state, every settings page tooltip, every error message gets read against it from now on. Session 14 emails were written before this voice was locked; a post-launch email-copy review pass against this surface is filed as a backlog item.
- The `impeccable-design-and-taste` skill has shipped on a marketing surface — the post-error-page upgrade. The output is the visual reference for any future marketing page (case studies, comparison pages, blog).

Remaining pre-launch gaps: legal copy (content PR), PT/ES marketing translation (one follow-up session), engineering-debt cleanup (plan-limit hardcoding sweep, middleware → proxy rename, pre-launch reviewer backlog), Stripe live-mode flip.
