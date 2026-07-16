# ADR 0009 — Landing Page & Positioning

**Status:** Accepted (amended — see §17, Amendment A1, 2026-06-12)
**Date:** 2026-06-11
**Session:** 16 (Architect)
**Supersedes:** Session 1 marketing placeholder (`app/[locale]/(marketing)/home/page.tsx`)
**Related:** ADR 0007 §B7 (Stone palette, focus ring, typography — the visual system this surface extends), ADR 0008 §8a (copy-as-deliverable model; §13 EN-only i18n wart precedent), Session 11A (`lib/stripe/plan.ts` → `getPlanCapabilities` as pricing source of truth), CLAUDE.md (ICP, locked pricing, Server-Components-by-default, Tailwind-only, i18n-from-day-one)

---

## 1. Headline decision

**SOSH's public surface is a typography-led, copy-locked marketing site inside the `(marketing)` route group — `/`, `/pricing`, `/terms`, `/privacy` — that positions the product as the organic social media team an early-stage B2B SaaS startup cannot yet hire, not as a posting scheduler.** Four sub-decisions hang off that sentence, each chosen against a named alternative:

1. **Editorial-typographic over product-led.** The hero and every section are carried by words and type, not screenshots or product chrome. *Loser:* self-evidence — a screenshot shows what the product does in a glance; copy has to demonstrate it. *Winner:* we don't depend on un-polished pre-launch UI, the brand reads as a point of view rather than a feature tour, and the Builder is unblocked today instead of after a UI-review screenshot pass. (The post-launch screenshot section is named in §15.)

2. **Copy locked in this ADR over Builder improvisation.** Every shipped string lives in §6, verbatim. *Loser:* Builder latitude to "improve a line" in the moment. *Winner:* a reviewed, consistent voice across five routes and three locales, and a transcription task with no creative ambiguity. This mirrors ADR 0008 §8a.

3. **One `<PricingCards />` shared across `/` and `/pricing`.** *Loser:* per-surface tuning (a denser card on `/pricing`, a teaser on `/`). *Winner:* zero price drift between the two surfaces, one component to test, one place prices are read from `getPlanCapabilities` (§5).

4. **Legal infrastructure without legal copy.** The Builder ships the `/terms` and `/privacy` routes, the MDX wrapper, working footer links, and a one-sentence stub. *Loser:* a launch-complete legal surface. *Winner:* the routes exist and resolve for the launch checklist while the actual Terms/Privacy prose lands in a separate content-only PR owned by someone who is not the Builder (§7).

The unifying constraint: **the landing page is a transcription target, not a creative brief.** The positioning, IA, motion, and copy are all decided here; the Builder builds to spec and writes no marketing prose.

### The position itself (and the alternative rejected)

The villain is **obscurity** — a good B2B SaaS product that its market never hears about, because showing up on social (consistently, in voice, across channels) is an entire function the startup can't staff yet. The founder owns the domain insight; what they lack is the team that turns insight into presence. SOSH is that team. The rejected framing (explored and dropped in this session) was the *consistency engine* — "you know what to say, we make sure you say it regularly." *Loser of the rejected frame:* it positions against a symptom (irregular posting) and lands SOSH next to Postiz and every other scheduler. *Winner of the chosen frame:* it positions against the stakes (your market doesn't know you exist) and makes the scheduler comparison a category error — a scheduler assumes you already have a social media team to feed it; SOSH *is* the team, and the schedule is its last step, not its product. AI is neither villain nor hero in the copy — it is the mechanism; the hero is the founder. The copy never leads with "AI-powered" and uses the word "AI" zero times on `/` (we found we did not need it).

**Scope of the claim (honesty guardrail):** SOSH is an *organic* social media team — campaign planning, on-brand posts, scheduling, and publishing across your channels. It is **not** paid ads, SEO, or email, so the copy never says "marketing team" or "marketing department" (which would imply demand-gen and a full funnel we don't run). It says **"social media team."** Phase 1 is text-only, LinkedIn + X at launch. "Reach" in the copy means an organic social presence on the channels where your buyers already are — never a paid or measurable-funnel claim.

---

## 2. Scope boundaries

### Builds (this ADR, Session 16)
- `(marketing)` route group hosting four routes: `/` (homepage), `/pricing`, `/terms`, `/privacy`, plus one OG image route (`/og`, §9).
- `marketing/layout.tsx`: sticky header, footer, `<MotionConfig reducedMotion="user">`, locale switcher, skip-to-content link (§3).
- The `/` section spine (§4) as Server Components, with `motion` entrance animations (§8).
- `<PricingCards />` reading `getPlanCapabilities`, rendered on both `/` and `/pricing` with no prop drift (§5).
- `/pricing` FAQ — six locked Q+A (§6.13).
- Legal route **infrastructure**: `@next/mdx` wrapper, `content/legal/*.mdx`, frontmatter schema, one stub sentence (§7).
- Full EN copy for every string on every route (§6), transcribed verbatim into `i18n/en/marketing.json`.
- PT/ES `marketing.json` files containing EN strings as fallback values + `// TODO: localize` markers; PT/ES routes resolve and render in EN (§10).
- Per-route `generateMetadata` + runtime `next/og` image route (§9).
- `sitemap.ts`, `robots.txt`, performance budget adherence (§11), Vercel-Analytics-only posture (§12).
- Route smoke test + `PricingCards` unit test (§14).

### Defers (explicitly out — §15)
- **Legal copy itself.** The Builder ships routes + wrapper + the stub sentence. The Terms-of-Service and Privacy-Policy prose is a **separate content-only PR**, not the Builder's responsibility. Do not write legal language in this session.
- PT/ES translation of marketing strings (post-launch localization session).
- Product screenshots / demo media (post-UI-review).
- Blog / changelog (separate marketing surface).
- A/B testing infrastructure (Phase 2+).
- Annual-pricing toggle (pricing model not finalized — monthly only).
- Cookie-consent banner (the §12 analytics posture keeps us out of consent territory).

The `(dashboard)` and `(auth)` route groups are untouched. The boundary is the route group.

---

## 3. Routing & layout

### 3.1. Route group composition

```
app/[locale]/(marketing)/
  layout.tsx              ← public chrome: header + <main> + footer, MotionConfig root
  page.tsx                ← `/`  (the homepage — see §3.4 path change)
  pricing/page.tsx        ← `/pricing`
  terms/page.tsx          ← `/terms`   (renders <LegalPage slug="terms" />)
  privacy/page.tsx        ← `/privacy` (renders <LegalPage slug="privacy" />)
  og/route.tsx            ← `/og` runtime OG image (next/og — §9)
components/marketing/
  MarketingHeader.tsx     MarketingFooter.tsx   LocaleSwitcher.tsx
  Section.tsx             ← motion entrance wrapper (the canonical animated section — §8)
  Hero.tsx                TheGap.tsx            HowItWorks.tsx
  WhatYouGet.tsx          WhereWeStand.tsx      FinalCta.tsx
  PricingCards.tsx        ← shared by `/` and `/pricing` (§5)
  PricingFaq.tsx          ← `/pricing` only (L9)
  LegalPage.tsx           ← MDX wrapper (§7)
lib/stripe/plan.ts        ← EXTEND: add MARKETING_PLANS + pricingFeatureRows (§5)
content/legal/
  terms.en.mdx            privacy.en.mdx
i18n/{en,pt,es}/marketing.json   ← NEW namespace (§10)
i18n/request.ts                  ← MODIFY: register marketing namespace
i18n/{en,pt,es}/common.json      ← MODIFY: remove placeholder marketing.hero block
app/[locale]/sitemap.ts          ← NEW (or extend)   app/robots.ts ← NEW (or extend)
next.config.ts                   ← MODIFY: @next/mdx integration (§7)
```

### 3.2. `layout.tsx` shape

```tsx
// app/[locale]/(marketing)/layout.tsx — Server Component
import { MotionConfig } from 'motion/react'   // see §8 re: client boundary
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionProviders>                          {/* thin 'use client' wrapper around MotionConfig */}
      <a href="#main" className="sr-only focus:not-sr-only ...">Skip to content</a>
      <MarketingHeader />
      <main id="main">{children}</main>
      <MarketingFooter />
    </MotionProviders>
  )
}
```

`MotionConfig reducedMotion="user"` is the single place reduced-motion is honored (L6) — see §8. It must sit in a `'use client'` boundary (`MotionProviders`); the layout itself stays a Server Component and only the provider shell is client.

### 3.3. Header & footer link sets

**Header** (sticky, `border-b bg-background/80 backdrop-blur`): wordmark **SŌSH** → `/` · `Pricing` → `/pricing` · `Sign in` → `/login` · **`Start free trial`** → `/signup` (primary button via `buttonVariants`). No hamburger needed at launch breakpoints; collapse the two text links into the bar on mobile, keep the primary CTA always visible.

**Footer** — three columns + locale switcher + copyright:
- **Product:** `Features` → `/#features` · `Pricing` → `/pricing`
- **Legal:** `Terms` → `/terms` · `Privacy` → `/privacy`
- **Company:** `Sign in` → `/login` · `Start free trial` → `/signup`
- **Locale switcher** (§3.5) and `© 2026 SŌSH. All rights reserved.`

All navigation is real `<a>`/`<Link>` — never `<div onClick>` (§13).

### 3.4. Path change — `/` becomes the homepage (flagged)

Current state on disk: the placeholder lives at `(marketing)/home/page.tsx`, and `app/[locale]/page.tsx` does `redirect(\`/${locale}/home\`)`. **This ADR makes `/` (i.e. `/{locale}`) the canonical homepage** so the marketing surface, sitemap, OG, and `hreflang` all point at one clean URL. Builder actions: create `(marketing)/page.tsx`, delete `(marketing)/home/`, delete the `app/[locale]/page.tsx` redirect (the `(marketing)/page.tsx` now satisfies `/{locale}`). This is a deliberate change from the Session 1 redirect, not an accident — the homepage is worth the bare URL.

### 3.5. Locale switcher

A footer control listing `EN · PT · ES` that re-routes to the same pathname under the chosen locale (next-intl `Link`/`usePathname` + `useRouter` from `@/i18n/navigation` if present, else `next/navigation` with locale-segment swap). Because PT/ES render EN strings at launch (L7/§10), the switcher changes the URL segment and the `lang` attribute but not yet the visible copy — accepted wart, named in §10.

---

## 4. Information architecture

### 4.1. `/` spine (D1)

Conventional B2B SaaS IA runs 7–9 sections (hero, social proof, problem, solution, how-it-works, features, pricing, FAQ, final CTA). Pre-launch we have no social proof, and "solution" duplicates "how-it-works + features." The surviving spine, in order:

| # | Section (`id`) | Intent |
|---|---|---|
| 1 | **Hero** | Name the stakes (your market doesn't know you exist) and the promise (we're the social media team that fixes that). Primary CTA → trial. |
| 2 | **The Gap** (`#gap`) | The villain: marketing is a whole function you can't staff, so a product your market needs stays a secret. |
| 3 | **How It Works** (`#how`) | Four steps — set the campaign → it drafts in your voice → you approve → it publishes and learns. The mechanism, founder in control. |
| 4 | **What You Get** (`#features`) | Everything a social media team does, without the headcount. The "more than a scheduler" proof. |
| 5 | **Where We Stand** | POV that replaces social proof (D2): big companies buy reach; startups have to earn it; we level that. |
| 6 | **Pricing** (`#pricing`) | The shared `<PricingCards />`; two tiers; deep-link to `/pricing`. |
| 7 | **Final CTA** | Restate the promise in one line; repeat the trial + trust line. |

**Cut, with the loss named:**
- **Social-proof section — cut**, replaced by §5 "Where We Stand." *Lost:* borrowed credibility (logos, metrics, testimonials). *Acceptable because:* we have none pre-launch; fabricating it is worse than a point-of-view that earns trust on conviction (D2).
- **Standalone "Solution" — merged** into How It Works + What You Get. *Lost:* a single grand "here's the answer" beat. *Acceptable because:* the four-step mechanism is the solution shown concretely; an abstract solution section would restate it with less evidence.
- **FAQ — moved off `/`**, lives on `/pricing` only (L9). *Lost:* homepage objection-handling. *Acceptable because:* homepage doubts are answered inline by §2/§5; transactional objections (billing, seats, cancellation) belong beside the price.

### 4.2. `/pricing` composition

Compact hero (`marketing.pricingPage.*`, §6.12) → shared `<PricingCards />` (§5) → `<PricingFaq />` (six Q+A, §6.13). No second nav, no duplicated homepage sections. The page is a price, a comparison, and the answers to the six questions that precede a card entry.

### 4.3. `/terms` and `/privacy` composition

Each route renders `<LegalPage slug="terms|privacy" />` (§7): a constrained-width prose wrapper that reads the MDX body + frontmatter (`title`, `lastUpdated`) and renders the title, a "Last updated: {lastUpdated}" line, and the MDX content. At launch the MDX body is the single locked stub sentence (§7). Same header/footer chrome; no motion beyond the shared section fade.

---

## 5. Pricing surface

### 5.1. Source of truth (L4, L10)

`getPlanCapabilities(plan)` in `lib/stripe/plan.ts` is the only source for per-plan limits and feature flags. `<PricingCards />` derives its feature rows from it at render time and **does not** duplicate capabilities in `components/marketing/`. If a price or limit changes there, the component stays correct; the prices quoted in §6 become stale prose and are corrected in i18n — never in logic.

### 5.2. Derivation helper (co-located with the source of truth)

Add to `lib/stripe/plan.ts` (pure data module — safe to import in a Server Component; no `serverOnly` guard, unlike `products.ts`):

```typescript
/** Plans shown on the marketing pricing surface, in display order. */
export const MARKETING_PLANS: ReadonlyArray<Plan> = ['plus', 'pro']

/** A feature row = an i18n label key + values to interpolate. */
export interface PricingFeatureRow {
  key: string                              // → marketing.pricing.feature.<key>
  values?: Record<string, number>
}

/**
 * Ordered feature rows for a plan card, derived from capabilities.
 * Numbers and flags come from getPlanCapabilities; only the label
 * templates live in i18n. This is what keeps the marketing card and
 * the billing layer from ever disagreeing.
 */
export function pricingFeatureRows(plan: Plan): ReadonlyArray<PricingFeatureRow> {
  const c = getPlanCapabilities(plan)
  const rows: PricingFeatureRow[] = []
  rows.push(c.postsPerMonth === null
    ? { key: 'posts_unlimited' }
    : { key: 'posts', values: { count: c.postsPerMonth } })
  rows.push(c.activeCampaigns === null
    ? { key: 'campaigns_unlimited' }
    : { key: 'campaigns', values: { count: c.activeCampaigns } })
  rows.push(c.allowedPlatforms.length >= ALL_PLATFORMS.length
    ? { key: 'platforms_all', values: { count: c.allowedPlatforms.length } }
    : { key: 'platforms_launch' })
  rows.push({ key: c.advancedAnalytics ? 'analytics_advanced' : 'analytics_basic' })
  if (c.engagementInbox) rows.push({ key: 'inbox' })
  return rows
}
```

`ALL_PLATFORMS` already exists in `plan.ts`; reference it in-module.

### 5.3. Component & prop contract

```tsx
// components/marketing/PricingCards.tsx — Server Component, no props
import { getTranslations } from 'next-intl/server'
import { MARKETING_PLANS, pricingFeatureRows } from '@/lib/stripe/plan'

export default async function PricingCards() {
  const t = await getTranslations('marketing.pricing')
  // renders MARKETING_PLANS.map(plan => card with t(`tiers.${plan}.*`)
  //   + pricingFeatureRows(plan).map(r => t(`feature.${r.key}`, r.values)))
  // CTA: <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
}
```

**No props.** The dual-route reuse (L9) works precisely because the component is self-contained: `/` and `/pricing` both render `<PricingCards />` with nothing passed in, so there is no surface where they can drift. The only contextual difference between the routes lives *outside* the component (the surrounding heading on `/`, the FAQ on `/pricing`).

### 5.4. "Most popular", trial CTA, expected output

- **"Most popular" treatment — yes, on Pro.** `marketing.pricing.tiers.pro.badge = "Most popular"` renders as a small pill on the Pro card with a subtle ring (`ring-1 ring-primary/30`). *Alternative rejected:* no badge (lower nudge). We badge Pro because it is the plan we want anchored as the default for a team, and the price ladder makes Plus the considered down-sell.
- **Trial CTA:** both cards' CTA is `Start free trial` → `/signup`. Identical action; the plan is chosen post-signup at checkout, consistent with the Session 11A flow (new subscriptions → Checkout).
- **Expected render at launch capabilities** (Builder sanity check):
  - **Plus €99/mo** — `50 posts a month` · `Up to 5 active campaigns` · `LinkedIn + X (Twitter)` · `Basic analytics`
  - **Pro €199/mo** — `Unlimited posts` · `Unlimited active campaigns` · `All 5 channels — LinkedIn, X, Instagram, Facebook, Threads` · `Advanced analytics` · `Engagement inbox`

### 5.5. `billing.json` duplication (follow-up, not in scope)

The in-app `billing.json` still hardcodes equivalent feature strings. Converging the in-app billing card onto `pricingFeatureRows` is a recommended follow-up (§15), not a launch blocker, and is out of scope here.

---

## 6. Copy (EN, locked verbatim)

> **Posture (per ADR 0008 §8a):** every string below is final. The Builder transcribes it into `i18n/en/marketing.json` exactly as written and converts the dot-keys to nested JSON — no rewording, no invented keys, no "the Builder can adjust this line." PT/ES carry these EN strings as fallback values (§10). **Voice:** present tense, second person, no exclamation marks; never "revolutionise", "leverage", or "unleash"; "AI" does not appear. The register is the calm, continuity-minded voice of the ADR 0008 §8a email subjects. The wordmark is **SŌSH** (macron Ō); body copy may use "SOSH".

### 6.1. Header / nav (`marketing.nav.*`)
```
brand            = SŌSH
pricing          = Pricing
signin           = Sign in
cta              = Start free trial
```

### 6.2. Hero (`marketing.hero.*`)
```
eyebrow          = For B2B SaaS founders and teams
headline         = You built something worth hearing about. SŌSH makes sure your market does.
subhead          = Knowing your market was never the problem. Showing up where your buyers already are — consistently, in your voice — is. SŌSH is the social media team you can't hire yet: campaigns built around your goals, every post written for you, published across your channels once you approve.
cta_primary      = Start free trial
cta_secondary    = See how it works
trust            = Free for 14 days · Card required, nothing charged today · Cancel anytime
```

### 6.3. The Gap (`marketing.gap.*`)
```
heading          = The best product doesn't win. The one people hear about does.
subhead          = You're heads-down building. Meanwhile the work that decides whether anyone finds you — showing up on social — waits for a team you haven't hired. So the channels go quiet, the momentum fades, and a product your market needs stays a secret.
card_team_title  = A whole function, landing on one person
card_team_body   = Strategy, writing, scheduling, knowing what worked — that's a social media team's job. At your stage it's a founder's twelfth.
card_quiet_title = Every quiet week has a cost
card_quiet_body  = The weeks you don't show up, a competitor who does takes the attention you were building. Silence compounds.
card_generic_title = Generic tools sound generic
card_generic_body  = Your insight is the edge. Off-the-shelf content sands it off until you read like everyone else.
```

### 6.4. How It Works (`marketing.how.*`)
```
heading          = A social media team's output. Your final say on every post.
subhead          = Set the direction once. SŌSH does the work a team would — and you stay the editor.
step1_title      = 1 · Set the campaign
step1_body       = Tell SŌSH your goal, your audience, and your channels. It plans content around the objective, not just the calendar.
step2_title      = 2 · It drafts in your voice
step2_body       = SŌSH writes posts that sound like you — the right length and tone for each channel, built from what makes your product matter.
step3_title      = 3 · You approve
step3_body       = Review, edit, or regenerate every post. Nothing reaches your audience until you've signed off.
step4_title      = 4 · It publishes and learns
step4_body       = Approved posts go live on schedule across your channels. SŌSH watches what lands and feeds it into the next campaign.
```

### 6.5. What You Get (`marketing.features.*`)
```
heading          = Everything a social media team does — without the headcount.
subhead          = Not a scheduler with a text box. The social media function your stage can't staff yet.
voice_title      = Your voice, captured
voice_body       = SŌSH learns how you talk about your product, then writes every post to match. Your insight, not a template.
campaigns_title  = Campaigns, not one-off posts
campaigns_body   = Content planned around a goal and an audience, the way a strategist would brief it — across weeks, not just today.
native_title     = Native to every channel
native_body      = LinkedIn depth, X brevity. Each post is shaped for where it lands, so nothing reads copy-pasted.
approval_title   = You approve everything
approval_body    = Human sign-off is built in. Your account only ever shows what you chose to publish.
analytics_title  = Analytics that change what's next
analytics_body   = See what reaches people and what doesn't, and watch each campaign get sharper for it.
languages_title  = Speaks your market's language
languages_body   = Write natively in English, Portuguese, or Spanish — written for each market, not machine-translated.
```

### 6.6. Where We Stand (`marketing.pov.*`)
```
eyebrow          = Why we built this
heading          = Big companies have a team for this. Startups have themselves.
body             = The companies you compete with have people whose whole job is showing up where their market is — posting, consistently, in a voice that's unmistakably theirs. You have a product that's often better and no one to do that for you. We think that's the real reason good startups stay quiet: not the product, the presence. SŌSH gives you a social media team's worth of presence inside a startup's budget, so the better product gets a fair hearing.
pull             = A scheduler assumes you already have a social media team to feed it. SŌSH is the team.
```

### 6.7. Pricing block — heading on `/` (`marketing.pricing.*` shared with §6.11)
```
heading          = Priced for a startup, not an agency.
subhead          = Both plans include a 14-day free trial. Pick one when you're ready — cancel anytime.
see_all          = Compare plans in detail
```

### 6.8. Final CTA (`marketing.finalCta.*`)
```
heading          = Your market is waiting to hear from you.
subhead          = Start your free trial today. Set your first campaign, approve your first posts, and put a social media team to work for the price of a tool.
cta              = Start free trial
trust            = Free for 14 days · Card required, nothing charged today · Cancel anytime
```

### 6.9. Footer (`marketing.footer.*`)
```
tagline          = The social media team B2B SaaS startups can't hire yet.
col_product      = Product
link_features    = Features
link_pricing     = Pricing
col_legal        = Legal
link_terms       = Terms
link_privacy     = Privacy
col_company      = Company
link_signin      = Sign in
link_signup      = Start free trial
locale_label     = Language
copyright        = © 2026 SŌSH. All rights reserved.
```

### 6.10. Metadata (`marketing.meta.*`)
```
home_title       = SŌSH — the social media team B2B SaaS startups can't hire yet
home_description = SŌSH builds campaigns, writes every post in your voice, and publishes across your channels once you approve. A social media team's worth of presence, priced for a startup.
pricing_title    = Pricing — SŌSH
pricing_description = A social media team's output from €99 a month. 14-day free trial, cancel anytime. Compare Plus and Pro.
terms_title      = Terms — SŌSH
privacy_title    = Privacy — SŌSH
```

### 6.11. Pricing card tiers + feature labels (`marketing.pricing.tiers.*`, `marketing.pricing.feature.*`)
> Feature rows are rendered from `getPlanCapabilities` via `pricingFeatureRows` (§5); `{count}` is interpolated from the capability value. Tier name/price/cadence/tagline/badge/cta are presentational copy. Prices are quoted here for transcription but the **component reads capabilities, not these strings**, for the limits (L10).
```
tiers.plus.name        = Plus
tiers.plus.price       = €99
tiers.plus.cadence     = per month
tiers.plus.tagline     = For founders getting their product in front of the channels that matter most.
tiers.plus.cta         = Start free trial

tiers.pro.name         = Pro
tiers.pro.price        = €199
tiers.pro.cadence      = per month
tiers.pro.badge        = Most popular
tiers.pro.tagline      = For teams going all-in across every channel, with the data to prove it.
tiers.pro.cta          = Start free trial

feature.posts                = {count} posts a month
feature.posts_unlimited      = Unlimited posts
feature.campaigns            = Up to {count} active campaigns
feature.campaigns_unlimited  = Unlimited active campaigns
feature.platforms_launch     = LinkedIn + X (Twitter)
feature.platforms_all        = All {count} channels — LinkedIn, X, Instagram, Facebook, Threads
feature.analytics_basic      = Basic analytics
feature.analytics_advanced   = Advanced analytics
feature.inbox                = Engagement inbox

trial_note       = Both plans start with a 14-day free trial. Work email and card required. No charge until your trial ends.
```

### 6.12. `/pricing` page hero (`marketing.pricingPage.*`)
```
title            = Priced for a startup, not an agency.
subtitle         = One simple choice, billed monthly. A social media team's output, from €99 a month — with a 14-day free trial and no lock-in.
```

### 6.13. `/pricing` FAQ — six locked questions (`marketing.faq.*`) (D4)
```
heading          = Questions, answered.

q1               = What happens when my free trial ends?
a1               = Pick the plan that fits and keep going, or do nothing and your account pauses. We never charge you without a plan you chose.

q2               = Do I need a card to start?
a2               = Yes. The 14-day trial needs a work email and a card, but nothing is charged until the trial ends — and you can cancel before then.

q3               = Which channels can I publish to?
a3               = Plus publishes to LinkedIn and X (Twitter). Pro adds Instagram, Facebook Pages, and Threads. More channels are on the way.

q4               = Can I cancel anytime?
a4               = Anytime, from your billing settings. You keep access until the end of the period you've paid for.

q5               = Is there annual billing?
a5               = Not yet — both plans are billed monthly today. For now you're never locked into more than a month at a time.

q6               = Can my team use one account?
a6               = Your plan covers your business, with no per-seat fees. Deeper team roles and permissions are on the way as we grow with you.
```

### 6.14. OG image strings (`marketing.og.*`) — rendered into the `next/og` image (§9)
```
home             = You built something worth hearing about. SŌSH makes sure your market does.
pricing          = A social media team's output, from €99 a month.
terms            = SŌSH — Terms
privacy          = SŌSH — Privacy
```

### 6.15. Legal stub (locked verbatim, EN only — §7)
```
legal_stub       = This document is being finalised. Last updated: TBD.
```

---

## 7. Legal page infrastructure (D5)

**Library: `@next/mdx`** (compile-time, App-Router-native, wired through `next.config.ts`). *Alternative rejected:* `next-mdx-remote` (runtime rendering, more flexibility, ~more weight). Legal copy is static, version-controlled, and never live-edited, so compile-time MDX is the lighter, simpler fit; runtime MDX would add a rendering path and bundle cost for zero benefit here.

**File layout:** `content/legal/terms.en.mdx`, `content/legal/privacy.en.mdx`. EN-only at launch (matches the §10 wart; PT/ES legal is part of the separate legal-copy PR).

**Frontmatter schema:**
```yaml
---
title: "Terms of Service"      # or "Privacy Policy"
lastUpdated: "TBD"             # ISO date once real copy lands; "TBD" at launch
locale: "en"
---
```

**Body at launch:** the single locked sentence from §6.15 — `This document is being finalised. Last updated: TBD.` Nothing else. The real prose lands via the content-only PR.

**Wrapper (`LegalPage.tsx`) shape:**
```tsx
// components/marketing/LegalPage.tsx — Server Component
// 1. import the compiled MDX for `slug` + its frontmatter
// 2. render: <article class="prose mx-auto max-w-2xl py-20">
//      <h1>{frontmatter.title}</h1>
//      <p class="text-muted-foreground">Last updated: {frontmatter.lastUpdated}</p>
//      <MDXContent />
//    </article>
```
`next.config.ts` gains the `@next/mdx` plugin and `.mdx` page extension wiring; the route files `terms/page.tsx` and `privacy/page.tsx` are thin and render `<LegalPage slug="…" />`. Footer links to `/terms` and `/privacy` resolve to 200 (§16).

---

## 8. Motion contract (D7, L6) — amended by A1 (§18)

> **A1 (2026-06-12) replaced the `motion` library with CSS.** The original contract below is preserved for history; the binding contract is §17.2. Summary of the change: same visual values (0.5s, `cubic-bezier(0.22, 1, 0.36, 1)`, opacity 0→1 + 12px rise, staggered children), but implemented as CSS transitions driven by a ~30-line `IntersectionObserver` hook (`Section.tsx`) and `@starting-style` (hero), removing ~35 KB from the JS budget and moving all animation off the main thread.

**Library (superseded by A1):** `motion` (Framer Motion v11, rebranded package). **Used for two things only:** section entrance fades on scroll-into-view, and the hero's one-time entrance. **Not used for:** parallax, scroll-linked transforms, or hover micro-interactions (hover lives in `buttonVariants`, not `motion`).

**Canonical values — one of each, no per-component drift:**
- **Duration:** `0.5s`
- **Easing:** `[0.22, 1, 0.36, 1]` (ease-out, expo-ish)
- **Entrance transform:** opacity `0 → 1`, `y: 12px → 0`
- **Stagger:** `0.08s` between grouped children (cards in a row, steps in a list)
- **Trigger:** `whileInView`, `viewport={{ once: true, margin: '-10% 0px' }}` — animate once, slightly before fully in view.

**Canonical props object the Builder reuses for every section entrance:**
```typescript
// components/marketing/motion.ts
export const SECTION_MOTION = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-10% 0px' },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
} as const

export const STAGGER_CHILD = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
} as const
// parent uses transition={{ staggerChildren: 0.08 }}
```

**Reduced motion (L6):** honored only at the root via `<MotionConfig reducedMotion="user">`. When the user prefers reduced motion, `motion` resolves the above to **instant render at the final state** — `opacity: 1`, `y: 0`, no transition. The semantics are *render immediately in place*, never *render after a delay with no animation*. No per-component reduced-motion branches anywhere (L6).

---

## 9. Metadata + OG images (D9)

**Per-route metadata:** each route exports `generateMetadata` reading `marketing.meta.*` (§6.10): `title`, `description`, `openGraph` (`title`, `description`, `type: website`, `locale`, `images: ['/og?route=<route>']`), `twitter` (`card: summary_large_image`), `alternates` (self-canonical + `hreflang` for en/pt/es + `x-default`).

**OG image: runtime `next/og`.** *Alternative rejected:* a static PNG per route in `/public` — it drifts from the type system and multiplies across three locales. The runtime route derives the image from a locked title string and the Stone typography, so the OG art *is* the brand type. **Route:** `app/[locale]/(marketing)/og/route.tsx` (Edge runtime, `ImageResponse`). **Contract:** `GET /og?route=home|pricing|terms|privacy` → 1200×630 PNG; the route maps the param to the matching `marketing.og.*` string (§6.14), renders it in the Stone palette on `--background` with `--foreground` type (large editorial wordmark + line), and the Builder writes the `ImageResponse` JSX to that spec. Default (no/unknown param) → the `home` string. **Alt text** for the OG image in metadata = the same locked line (§13).

---

## 10. i18n posture (L7)

**EN authoritative.** A new `marketing` namespace is its own file, mirroring `auth`/`posts`/`billing`. Registration in `i18n/request.ts`:
```typescript
const [common, auth, posts, billing, errors, marketing] = await Promise.all([
  /* …existing… */ import(`./${locale}/marketing.json`),
])
return { locale, messages: { ...common.default, /* … */ marketing: marketing.default, errors: {/* … */} } }
```
The Session 1 placeholder `marketing.hero.*` block is removed from `common.json` (all three locales); the new namespace supersedes it.

**Key grouping (`marketing.json` root):** `nav`, `hero`, `gap`, `how`, `features`, `pov`, `pricing` (`{ heading, subhead, see_all, tiers, feature, trial_note }`), `pricingPage`, `faq`, `finalCta`, `footer`, `meta`, `og`, `legal_stub`.

**PT/ES convention (the wart):** `i18n/pt/marketing.json` and `i18n/es/marketing.json` exist with the **EN strings copied verbatim as values**, each file headed by a `// TODO: localize (ADR 0009 §10)` marker comment (or a `"_todo"` sentinel key, since JSON has no comments — use `"_todo": "localize — ADR 0009 §10"` at the root). PT/ES routes resolve and render the page in EN. This matches the ADR 0008 §13 EN-only auth-email precedent: a named launch wart, not a defect. **Follow-up slot:** a post-launch *"Marketing localization (PT/ES)"* session (§15) replaces the fallback values with real translations and removes the sentinel.

---

## 11. Performance budget (D8)

Core Web Vitals are SEO-load-bearing on this surface. **Targets (field, p75):** LCP **< 1.8s**, CLS **< 0.05**, INP **< 200ms**.

**JS budget:** first-load JS for any marketing route **≤ 90 KB gzipped**. *(A1: `motion` (~35 KB) removed — the budget now carries no animation library at all; the reveal hook in `Section.tsx` is the only motion JS.)* Originally: of which `motion` is ~35 KB. The Builder must not add another heavy client dependency (carousel libs, animation kits, analytics SDKs) without an ADR amendment. Keep `motion` usage inside small client islands (the `Section` wrapper + hero), not the whole tree — section content stays in Server Components.

**Image strategy: none.** L5 bans raster images, product screenshots, stock, illustrated humans, and 3D renders. The only "imagery" is CSS/inline-SVG abstract marks (≤ one per section) and the runtime OG image (crawler-only, off the user's critical path). This makes the budget largely self-enforcing — the ADR names it so the Builder does not "just add a hero image."

---

## 12. Analytics & consent (D10)

**Vercel Analytics only** (already mounted in `app/[locale]/layout.tsx`) — first-party, cookieless page-view counting. **No cookie-consent banner at launch**, because nothing on the marketing surface sets a cookie or fires a cross-site request.

**The boundary, named so it isn't crossed on autopilot:** adding GA4, PostHog, a Meta/LinkedIn pixel, or any script that writes a cookie or sends data to a third-party origin moves us into GDPR/ePrivacy consent territory and would *require* a consent banner. None of those are added in this session. If a future session wants product analytics or ad pixels, it owns the consent banner as part of that work.

---

## 13. Accessibility

The WCAG 2.1 AA subset that matters for an editorial marketing surface — posture, not a separate audit:
- **Contrast:** body text ≥ 4.5:1 (1.4.3); large display type (≥ 24px, or ≥ 18.66px bold) may sit at ≥ 3:1, which the oversized hero type uses deliberately. Stone tokens already clear these (verified for ADR 0007 §B7 boundaries); the one combination to spot-check is `--primary` on `--primary-foreground` for CTAs.
- **Focus:** every link/button/`<summary>` shows the shared `focus-visible` ring from ADR 0007 §B7 / `buttonVariants` — continuous with the app. No `outline-none` without a ring (2.4.7).
- **Landmarks & headings:** one `<h1>` (hero), `<h2>` per section, semantic `<header>/<main id="main">/<footer>/<nav>` (1.3.1, 2.4.6). No skipped levels.
- **Navigation is links:** `<a>`/`<Link>` for all nav and anchors — never `<div onClick>` (2.1.1, 4.1.2).
- **Skip-to-content:** first focusable element targets `#main` (2.4.1).
- **Reduced motion:** handled once at the `<MotionConfig>` root (L6/§8).
- **OG image alt:** metadata carries the locked line (§9) as alt text (1.1.1).
- **Language:** `lang={locale}` per segment (already set in `app/[locale]/layout.tsx`); the locale switcher updates the segment.
- **FAQ:** native `<details>`/`<summary>` — keyboard-operable and announced by default; chevron via CSS `group-open:` rotation, no JS.

---

## 14. Test posture

**What is not worth testing:** snapshot tests on hero/section copy. Copy changes word-by-word during pre-launch and a snapshot breaks on every edit for no signal. No copy snapshots.

**What is worth testing (and stays green, no flake):**
- **Route smoke (Playwright or a lightweight route test) — the five routes return 200:** `/`, `/pricing`, `/terms`, `/privacy`, and `/og` (the OG route returns an `image/png`). Assertions: `/` HTML contains the locked hero phrase (`makes sure your market does`); `/pricing` HTML contains the price strings `€99` and `€199` (which originate from `getPlanCapabilities` via the card); footer links to `/terms` and `/privacy` resolve.
- **`PricingCards` unit test:** asserts the component reads `getPlanCapabilities`/`pricingFeatureRows` (e.g. spy or capability-driven assertion) and renders **both** `MARKETING_PLANS` with the launch feature rows (Plus: 50 posts / 5 campaigns / launch platforms / basic; Pro: unlimited / unlimited / all-channels / advanced / inbox). This is the regression guard against price drift.

The marketing surface introduces no new flaky tests; the existing suite stays green.

---

## 15. What this unlocks / out of scope

**Unlocks (named follow-up sessions):**
- **Marketing localization (PT/ES)** — replace EN fallback values with real translations, remove the `_todo` sentinels (§10).
- **Legal copy PR** — real Terms/Privacy prose into `content/legal/*.mdx`, `lastUpdated` set (§7). Content-only, not the Builder's job.
- **Post-launch UI review → screenshot section** — once the product UI is polished, a homepage "see it in action" section with real screenshots (the deferred product-led beat from §1).
- **A/B testing infrastructure** — Phase 2+; would also force the §12 consent decision.
- **Converge in-app billing card onto `pricingFeatureRows`** (§5.5).

**Explicitly out of scope (non-goals):**
- Legal copy itself (separate PR).
- PT/ES translation of marketing strings (post-launch session).
- Product screenshots / demo video (no polished UI / no recording yet).
- Blog / changelog (separate surface).
- A/B testing (Phase 2+).
- Annual-pricing toggle (pricing model not finalized — monthly only).
- Cookie-consent banner (the §12 posture keeps us out of consent territory).

---

## 16. Launch-checklist patch

> **Builder:** add the following to `docs/launch-checklist.md` as a new section, matching the existing checkbox/table format. Do not duplicate rows that already exist.

```markdown
### 11. Landing page (ADR 0009)

#### Routes & infrastructure
- [ ] `/` (homepage) returns 200 and its HTML contains the hero phrase "makes sure your market does"
- [ ] `/pricing` returns 200 and renders both plan prices (€99 and €199) sourced from getPlanCapabilities
- [ ] `/terms` returns 200 (MDX wrapper + stub paragraph "Last updated: TBD")
- [ ] `/privacy` returns 200 (MDX wrapper + stub paragraph "Last updated: TBD")
- [ ] OG image route `/og` returns a PNG for `/` (route=home)
- [ ] `sitemap.ts` covers all marketing routes (/, /pricing, /terms, /privacy) across en/pt/es
- [ ] `robots.txt` allows `/` and references the sitemap
- [ ] Locale switcher present in the footer (EN/PT/ES)

#### Content & i18n
- [ ] `marketing` namespace registered in i18n/request.ts; placeholder `marketing.hero.*` removed from common.json (all locales)
- [ ] EN copy matches ADR 0009 §6 verbatim (no Builder-invented strings)
- [ ] PT/ES marketing.json present with EN fallback values + `_todo` sentinel; PT/ES routes render in EN without missing-key errors
- [ ] No customer logos, testimonials, screenshots, stock photos, or raster images on any route (L5)

#### Pricing integrity
- [ ] PricingCards renders feature rows from getPlanCapabilities via pricingFeatureRows (no duplicated constant in components/marketing/)
- [ ] Same <PricingCards /> renders on `/` and `/pricing` with no prop drift
- [ ] Plus = 50 posts / 5 campaigns / LinkedIn + X / basic analytics; Pro = unlimited / unlimited / all 5 channels / advanced / inbox

#### Motion, perf, a11y
- [ ] <MotionConfig reducedMotion="user"> at the marketing layout root; reduced-motion renders sections instantly in place
- [ ] First-load JS for marketing routes ≤ 90 KB gz; no heavy client deps beyond `motion`
- [ ] LCP < 1.8s, CLS < 0.05, INP < 200ms on `/` (lab check pre-launch)
- [ ] Single <h1>, semantic landmarks, skip-to-content link, focus rings continuous with ADR 0007 §B7
- [ ] Vercel Analytics only; no cookie-consent banner (no third-party cookies/pixels added)

#### Tests
- [ ] Route smoke test green (5 routes 200; hero phrase + price strings present; legal links resolve)
- [ ] PricingCards unit test green (reads getPlanCapabilities, renders both plans)
```

---

## 17. Amendment A1 (2026-06-12) — CSS motion migration & interaction polish

Proposed via a design-engineering review of the implemented surface (Session 16 follow-up); implemented the same day. Rationale: (a) Framer Motion's `opacity`/`y` props animate on the main thread via rAF — the hero entrance plays during initial page load, the worst case for dropped frames; CSS runs off-thread. (b) `motion` was ~35 KB of the 90 KB §11 budget for a single fade effect. (c) The uniform 0.5s fade on all sections gave the first-impression hero the same entrance as the footer.

### 17.1. What changed

| Area | Before (original ADR) | After (A1) |
|---|---|---|
| Animation engine | `motion` package, `<MotionConfig reducedMotion="user">` client boundary | CSS transitions + `@starting-style`; `motion` uninstalled; `MotionProviders.tsx` and `motion.ts` deleted |
| Section reveals | `motion.section` with `whileInView` | `Section.tsx` toggles `data-reveal` via `IntersectionObserver`; `.reveal` CSS in `globals.css`. Hidden state applied **by JS only, post-mount, below-fold only** — no-JS/crawler HTML is always fully visible (strictly better than the SSR'd `opacity:0` the old approach shipped) |
| Hero | Same fade as every section | One-time orchestrated entrance: eyebrow → headline → subhead → CTAs → trust at 70ms steps; headline settles from `blur(4px)`; pure CSS `@starting-style`, zero JS |
| Stagger | 0.08s uniform | 80ms default, **40ms for dense lists** (pricing feature rows now stagger); children transition at 0.4s (sections stay 0.5s) |
| Reduced motion | `MotionConfig` prop | One `@media (prefers-reduced-motion: no-preference)` block wraps *all* marketing motion incl. smooth scroll (L6 still holds: one place, no per-component branches) |
| Buttons | `transition-all` in `buttonVariants`; 1px translate press | Explicit `transition-[color,background-color,border-color,box-shadow,translate,scale,opacity] duration-150 ease-out`; marketing CTAs add `active:scale-[0.98]` press feedback |
| Anchor links | Instant jump | `html { scroll-behavior: smooth }` (reduced-motion-gated) |
| Sticky header | `border-b` always visible | Hairline fades in over the first 24px of scroll via `animation-timeline: scroll()`; `@supports`-gated, fallback = always visible |
| FAQ `<details>` | Content pops open | `::details-content` height transition (200ms) + `interpolate-size: allow-keywords`; chevron `duration-200 ease-out`. Native element kept (§13 posture intact) |
| Touch hover | — | Already handled: Tailwind v4 gates `hover:` behind `(hover: hover)` natively; no change needed |

### 17.2. Binding motion contract (replaces §8 values where they conflict)

- **Easing:** `--ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1)` (unchanged, now a CSS custom property).
- **Durations:** sections 0.5s; staggered children 0.4s; FAQ/chevron 200ms; button transitions 150ms.
- **Entrance transform:** opacity 0→1, `translate: 0 12px → 0 0` (the `translate` property, not `transform` — composes with Tailwind v4 scale/translate utilities).
- **Stagger:** 80ms default, 40ms dense lists, 70ms hero choreography. Trigger: `IntersectionObserver`, `rootMargin: '-10% 0px'`, once.
- **No new client animation dependency may be added without a further amendment** (§11 posture, now stricter: the budget carries zero animation libraries).

### 17.3. Checklist deltas

The §16 checklist rows referencing `MotionConfig` and "no heavy client deps beyond `motion`" are superseded — see the updated rows in `docs/launch-checklist.md` §11.

---

---

## Amendment A2 (2026-06-13) — Documentation corrections post-Builder

Two small documentation deviations were surfaced by the Session 16 Reviewer (`docs/reviews/session-16-reviewer.md`): the implementation is correct; this amendment aligns the ADR to it. No code changes accompany this amendment.

**§3.1 sitemap path.** The tree diagram showed `app/[locale]/sitemap.ts`. The Builder placed the file at `app/sitemap.ts` (root-level), which is the standard Next.js path — `app/sitemap.ts` serves `/sitemap.xml` directly, while `app/[locale]/sitemap.ts` would serve `/{locale}/sitemap.xml` per locale, which crawlers and `robots.txt` do not expect. The §3.1 tree should read:

```
app/sitemap.ts                   ← root-level — Next.js serves /sitemap.xml
app/robots.ts                    ← root-level
```

**§5.3 PricingCards CTA variant.** The §5.3 code snippet shows `buttonVariants({ size: 'lg' })`. The shipped implementation uses `buttonVariants({ variant: 'brand', size: 'lg' })` — the `brand` variant was added during the Session 16 design uplift and is the correct treatment for primary marketing CTAs. The §5.3 snippet should read:

```tsx
<Link href="/signup" className={cn(buttonVariants({ variant: 'brand', size: 'lg' }))}>
  {t(`tiers.${plan}.cta`)}
</Link>
```

Future Architect sessions should treat `variant: 'brand'` as the canonical primary-CTA treatment on marketing surfaces.

---

## 18. Architect end

This ADR fixes the positioning (SOSH as the marketing team a B2B SaaS startup can't hire yet), the `/` IA spine, the `(marketing)` routing and layout, the shared `PricingCards` wiring to `getPlanCapabilities`, the full locked EN copy for all five routes, the legal-infrastructure-without-copy boundary, the motion contract, metadata + runtime OG strategy, the EN-authoritative i18n wart, the performance and analytics postures, the accessibility posture, the test posture, and the launch-checklist patch. The Builder builds to this spec in a fresh session and writes no marketing prose.
