# Reviewer Report — ADR 0009 Landing Page & Positioning (Session 16)

**Date:** 2026-06-13  
**Reviewer role:** Session 16 Reviewer  
**Scope:** `(marketing)` route group, `components/marketing/`, `lib/marketing/`, `lib/stripe/plan.ts` additions, `i18n/*/marketing.json`, `app/sitemap.ts`, `app/robots.ts`, `app/globals.css` motion additions, launch-checklist §11  
**Contract:** ADR 0009 + Amendment A1 (2026-06-12)

---

## §1 — Headline decision + positioning

**"AI" word check:** `grep -i '\bai\b' i18n/en/marketing.json` → **0 matches**. Clean.

**"marketing team / marketing department" check:** 0 matches. All instances say "social media team." Clean.

**Fake social proof:** No testimonial section, no logos strip, no customer counts. `WhereWeStand` correctly replaces social proof with a POV section per ADR §4.1 D2. Clean.

**Legal stub (§6.15):** Both `content/legal/terms.en.mdx` and `content/legal/privacy.en.mdx` contain exactly `"This document is being finalised. Last updated: TBD."` — verbatim match, nothing added. Clean.

---

## §2 — Scope boundaries

**Legal prose:** Builder shipped infrastructure only; MDX bodies are the single locked stub sentence. Clean.

**PT/ES string drift:** `i18n/pt/marketing.json` and `i18n/es/marketing.json` carry EN strings verbatim as values with the `_todo` sentinel key at root, matching the ADR §10 wart contract. No real translations introduced. Clean.

---

## §3 — Routing & layout

**Path change (§3.4):** `(marketing)/page.tsx` exists at `app/[locale]/(marketing)/page.tsx`. `grep` for `redirect.*home` across `app/` → 0 matches. `(marketing)/home/` directory gone. Old `app/[locale]/page.tsx` redirect gone. Clean.

**MotionConfig (ADR §3.2 / Amendment A1):** Amendment A1 deleted `MotionProviders.tsx` and `motion.ts`. The marketing layout is a pure Server Component with no `MotionConfig` client boundary — correct per §17.2. Reduced motion is handled entirely in `globals.css` via `@media (prefers-reduced-motion: no-preference)`. Clean.

**Skip-to-content (§3.2 / §13 / WCAG 2.4.1):** The `<a href="#main">` is the first child of the layout fragment, before `<MarketingHeader />`. Placement is correct. See **MINOR-1** for the label.

**Header CTAs:** `MarketingHeader.tsx` uses `<Link href={...} className={cn(buttonVariants({ size: 'sm' }), 'active:scale-[0.98]')}>` — a `<Link>` with `buttonVariants`, no `<Button asChild>`. Correct per CLAUDE.md. Clean.

---

## §4 — Information architecture

**`/` spine:** `MarketingHomePage` renders in order: `<Hero />`, `<TheGap />`, `<HowItWorks />`, `<WhatYouGet />`, `<WhereWeStand />`, `<Section id="pricing">` (with `<PricingCards />` and `see_all` link), `<FinalCta />`. Seven sections, matching the §4.1 table exactly. No fabricated social-proof strip. Clean.

**`/pricing` composition:** Compact hero (`<section>` with `<h1>` + subtitle) → `<PricingCards />` → `<PricingFaq />`. Matches §4.2. No duplicated homepage sections. Clean.

---

## §5 — Pricing surface

**`pricingFeatureRows` location:** Lives in `lib/stripe/plan.ts` lines 91–112, alongside `MARKETING_PLANS` and `getPlanCapabilities`. Nothing duplicated in `components/marketing/`. Clean.

**`<PricingCards />` props:** Component signature is `async function PricingCards()` with no parameters. No props accepted. Clean.

**Same component on both routes:** `/` renders `<PricingCards />` from `components/marketing/PricingCards.tsx`; `/pricing` renders the same import. Single source. Clean.

**Expected rows at launch capabilities (§5.4):**
- `getPlanCapabilities('plus')`: `postsPerMonth=50, activeCampaigns=5, allowedPlatforms=LAUNCH_PLATFORMS (2), advancedAnalytics=false, engagementInbox=false`
- `pricingFeatureRows('plus')` → `[posts(50), campaigns(5), platforms_launch, analytics_basic]` — 4 rows, no extras. ✓
- `getPlanCapabilities('pro')`: `postsPerMonth=null, activeCampaigns=null, allowedPlatforms=ALL_PLATFORMS (5), advancedAnalytics=true, engagementInbox=true`
- `pricingFeatureRows('pro')` → `[posts_unlimited, campaigns_unlimited, platforms_all(5), analytics_advanced, inbox]` — 5 rows, no extras. ✓

No hallucinated rows ("Priority support," "Custom domain," etc.). Clean.

**CTA target:** Both plan CTAs link to `/${locale}/signup` via `<Link>`. No direct Stripe Checkout URL. Clean per Session 11A pattern. Clean.

---

## §6 — Copy (locked verbatim)

Diffed all key groups in `i18n/en/marketing.json` against ADR §6 section by section:

- §6.1 nav: **exact match** ✓
- §6.2 hero (eyebrow, headline with macron Ō, subhead, cta_primary, cta_secondary, trust): **exact match** ✓
- §6.3 gap (heading, subhead, all six card strings): **exact match** ✓
- §6.4 how (heading, subhead, four step titles/bodies): **exact match** ✓
- §6.5 features (heading, subhead, six tile titles/bodies): **exact match** ✓
- §6.6 pov (eyebrow, heading, body, pull): **exact match** ✓
- §6.7 pricing block heading/subhead/see_all: **exact match** ✓
- §6.8 finalCta (heading, subhead, cta, trust): **exact match** ✓
- §6.9 footer (tagline, all column headings, link labels, locale_label, copyright): **exact match** ✓
- §6.10 meta (four titles, two descriptions): **exact match** ✓
- §6.11 pricing tiers + feature labels: **exact match** ✓
- §6.12 pricingPage (title, subtitle): **exact match** ✓
- §6.13 faq (heading, six q/a pairs): **exact match** ✓
- §6.14 og (four strings): **exact match** ✓
- §6.15 legal_stub: **exact match** ✓

All copy transcribed verbatim. Clean.

---

## §7 — Legal infrastructure

**MDX library:** `@next/mdx` is used (per `next.config.ts` and `mdx.d.ts`). Not `next-mdx-remote`. Matches §7 decision. Clean.

**Frontmatter schema:** Both MDX files have `title`, `lastUpdated: "TBD"`, `locale: "en"`. Matches §7 schema exactly. No unauthorized extra fields. Clean.

**Routes resolve:** Footer links point to `/${locale}/terms` and `/${locale}/privacy`. Smoke test asserts these return 200. Clean.

---

## §8 / §17 — Motion contract (Amendment A1 binding)

**CSS custom property easing:** `globals.css` line 150: `--ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1)`. Matches §17.2. ✓

**Section reveals — durations:** `.reveal` uses `0.5s` (sections); `.reveal-child` overrides to `0.4s` (staggered children). Matches §17.2. ✓

**Hero entrance:** `.hero-enter` uses `0.5s var(--ease-out-expo)` with `@starting-style { opacity: 0; translate: 0 12px }`. `.hero-enter-blur` adds `filter: blur(4px)` at start for headline only. 70ms step choreography. Matches §17.1. ✓

**Stagger:** `StaggerItem` accepts `index` and `stepMs` (default 80); `PricingCards` calls it with `stepMs={40}` for dense feature rows. Matches §17.2 "80ms default, 40ms dense lists." ✓

**`translate` property (not `transform`):** `globals.css` uses `translate: 0 12px` in hidden state and `@starting-style`. Correct per §17.2 note. ✓

**Reduced-motion containment:** All animation CSS is inside `@media (prefers-reduced-motion: no-preference)`, including `scroll-behavior: smooth`. One block, no per-component CSS branches. Matches §17.2 L6 posture. ✓

**`motion.ts` / `MotionProviders.tsx`:** Both deleted per A1. Not present in the codebase. Clean.

**No parallax, scroll-linked transforms, or hover motion:** Confirmed absent. Hover feedback is `active:scale-[0.98]` in Tailwind, not motion. Clean.

---

## §9 — Metadata + OG

**`generateMetadata` on all four routes:** `/` and `/pricing` confirmed. `/terms` and `/privacy` use the same `marketingMetadata(locale, 'terms'|'privacy')` helper. All four routes covered. ✓

**OG image path:** `lib/marketing/metadata.ts` line 53: `` url: `/${locale}/og?route=${route}` ``. With `metadataBase` set to `APP_URL`, this resolves correctly to the Edge route. ✓

**`x-default` hreflang:** `metadata.ts` line 63: `` 'x-default': `/en${path}` ``. Present. ✓ All three locales (en/pt/es) and x-default covered.

**Edge runtime:** `og/route.tsx` line 6: `export const runtime = 'edge'`. ✓

**Unknown-route fallback:** `const route = OG_ROUTES.has(routeParam) ? routeParam : 'home'`. Correct per §9. ✓

---

## §10 — i18n posture

**Namespace registration:** `i18n/request.ts` imports `marketing.json` per locale and maps it under `marketing: marketing.default`. Correct. ✓

**`_todo` sentinel:** Both `i18n/pt/marketing.json` and `i18n/es/marketing.json` have `"_todo": "localize — ADR 0009 §10"` at root. Correct wart posture. ✓

**Placeholder removal from `common.json`:** `grep 'marketing.hero' i18n/en/common.json` → 0 matches. Placeholder removed from all three locale files. ✓

---

## §11 — Performance

**JS budget:** Cannot be verified from static analysis — requires a production build. Noted in launch-checklist §11 as a pre-launch gate. All content sections are Server Components; only `Section.tsx` and `StaggerItem` are `'use client'`. No animation library in `package.json` (`motion` removed per A1). Budget should be well under 90 KB gz, but the lab-check row in §11 launch-checklist must be ticked before ship.

**No raster images:** No `hero.png`, screenshots, or stock images found in `components/marketing/` or `public/`. The only "imagery" is the CSS radial gradient bloom on `hero-bg` and inline SVG icons. Clean.

**No unauthorized client deps:** `motion` (Framer) is absent. No carousel, animation kit, or analytics SDK added. Clean.

---

## §12 — Analytics & consent

**Vercel Analytics only:** No GA4, PostHog, LinkedIn/Meta pixel, or third-party `<Script>` tags added in any marketing component or layout. Clean.

**No consent banner:** None present. Clean.

---

## §13 — Accessibility

**Single `<h1>` per route:**
- `/`: `<h1>` in `Hero.tsx` (hero headline). `<h2>` per section. ✓
- `/pricing`: `<h1>` in `pricing/page.tsx` (pricing page title). `<h2>` in `PricingFaq`. `<h3>` in `PricingCards` (plan names). ✓
- `/terms`, `/privacy`: `<h1>` rendered from frontmatter title in `LegalPage.tsx` per ADR §7 spec. ✓

**Focus rings:** All interactive elements in the audited components use `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. No bare `outline-none` without a ring. ✓

**FAQ — native `<details>`/`<summary>`:** `PricingFaq.tsx` confirmed: `<details class="faq-details group">`, `<summary class="... [&::-webkit-details-marker]:hidden">`, chevron SVG is `aria-hidden="true"`. No JavaScript accordion. Keyboard-operable by default. ✓

**Reduced-motion semantics:** CSS `@media (prefers-reduced-motion: no-preference)` wraps all transitions. Reduced-motion users: `.reveal[data-reveal='pending']` opacity rule never fires (it's inside the media query); `@starting-style` blocks never fire. Content renders immediately in final state. "Instant final state" semantics preserved. ✓

**Navigation links:** All nav and footer items are `<Link>` (`<a>` underneath). No `<div onClick>`. ✓

---

## §14 — Tests

**`PricingCards` unit test (ADR §14 regression guard):** `lib/stripe/plan.test.ts` (extended in Session 16) contains a `pricingFeatureRows (ADR 0009 §5.2)` describe block with five assertions: MARKETING_PLANS order, Plus rows from capabilities, Plus interpolated labels ("50 posts a month" / "Up to 5 active campaigns" / "LinkedIn + X (Twitter)" / "Basic analytics"), Pro rows (unlimited/all-channels/advanced/inbox), and every row key has a label template in marketing.json. Comprehensive. ✓

**Route smoke test:** `app/[locale]/(marketing)/__integration__/routes.smoke.test.ts` covers `/en`, `/en/pricing`, `/en/terms`, `/en/privacy`, `/en/og?route=home`. ENV-gated on `ROUTE_SMOKE_TEST_ENABLED=true`. Matches ADR §14 "five routes return 200" requirement. ✓

**No copy snapshot tests:** No snapshot files under `components/marketing/` or the `(marketing)` route group. ✓

---

## §16 — Launch-checklist patch

`docs/launch-checklist.md` §11 "Landing page (ADR 0009)" confirmed present with all required rows across four sub-sections: Routes & infrastructure, Content & i18n, Pricing integrity, Motion/perf/a11y, Tests. Checklist rows reference updated A1 wording ("motion removed per ADR 0009 §17 A1" instead of the original MotionConfig rows). ✓

---

## Cross-cutting (CLAUDE.md + prior ADRs)

**`process.env` in route/component code:** `grep process.env app/[locale]/(marketing) components/marketing/` → hits only in `routes.smoke.test.ts` (the integration test gate). All production code under these paths is clean. See **NIT-2**.

**`console.*`:** 0 matches in new marketing files. ✓

**`any` types:** 0 occurrences in new marketing files and `lib/marketing/metadata.ts`. ✓

**Inline `style` attributes:** `Hero.tsx` and `StaggerItem` use inline styles only for CSS custom properties (`--enter-delay`, `--reveal-delay`) that are genuinely dynamic (step index × timing). CLAUDE.md allows inline `style` "when truly dynamic." ✓

**Hardcoded strings in JSX:** All user-visible strings pass through `getTranslations`. No bare English literals in JSX. ✓ (see **MINOR-1** for the skip-to-content special case).

---

## Findings

### MINOR

**MINOR-1 — Skip-to-content label not i18n-wrapped (§3.2 / §13 / WCAG 2.4.1)**

`app/[locale]/(marketing)/layout.tsx` line 12: `>Skip to content</a>` is a hardcoded English string, not routed through `getTranslations`. ADR §6 defines no key for it (Builder self-flagged this in an inline comment). At launch this has no visible impact — PT/ES routes render EN strings anyway per the §10 wart. However, when the marketing localization session runs, this string will remain English on PT/ES routes unless a key is retroactively added.

*Track in localization session scope:* add `marketing.layout.skipToContent = "Skip to content"` (and PT/ES equivalents) and update the layout. No code change required before launch.

---

**MINOR-2 — `sitemap.ts` path deviates from ADR §3.1 diagram; ADR §3.1 needs amendment**

ADR §3.1 shows `app/[locale]/sitemap.ts`. The Builder placed the file at `app/sitemap.ts` (root-level) and self-flagged it. The root-level placement is functionally correct — Next.js serves `app/sitemap.ts` at `/sitemap.xml`, the standard path crawlers and `robots.txt` expect. `app/[locale]/sitemap.ts` would serve at `/{locale}/sitemap.xml` per locale, which is non-standard for sitemaps.

*Action required before merge:* amend ADR §3.1 tree diagram to show `app/sitemap.ts`. No code change needed — the implementation is correct.

---

**MINOR-3 — `Section.tsx` contains a per-component reduced-motion JS branch, violating §17.2 L6**

`components/marketing/Section.tsx` line 24:
```js
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
```

ADR §17.2 states: "L6 still holds: one place, no per-component branches." The CSS contract is already sufficient — `.reveal[data-reveal='pending'] { opacity: 0; translate: 0 12px }` is inside `@media (prefers-reduced-motion: no-preference)`, so the hidden state never applies for reduced-motion users regardless of whether the attribute is set. The `matchMedia` guard is redundant with CSS and constitutes a per-component branch in violation of the stated principle.

*Correct remedy:* remove lines 23–24 from `useReveal` and rely solely on the CSS contract. The IntersectionObserver will still fire and remove the attribute harmlessly; no user-visible consequence either way.

*If the team prefers to retain the guard* for the performance benefit (skipping IntersectionObserver setup for reduced-motion users), document it explicitly as an accepted deviation from L6 with a comment citing §17.2, and note it in the ADR §9 "Accepted tech debt" section.

---

### NIT

**NIT-1 — `PricingCards.tsx` CTA uses `variant: 'brand'`; ADR §5.3 code example shows no explicit variant**

`PricingCards.tsx` line 75: `buttonVariants({ variant: 'brand', size: 'lg' })`. ADR §5.3 shows `buttonVariants({ size: 'lg' })`. The `brand` variant was added in the Session 16 design uplift. The visual result is appropriate for primary CTAs. Update the §5.3 code snippet to reflect `variant: 'brand'` so future sessions do not misread it as drift.

---

**NIT-2 — `routes.smoke.test.ts` accesses `process.env` directly**

Lines 13–14 read `process.env.ROUTE_SMOKE_TEST_ENABLED` and `process.env.SMOKE_BASE_URL` directly. CLAUDE.md requires env access via `lib/config.ts`. This follows the established integration test gate pattern from `lib/email/__integration__/round-trip.test.ts`. If integration gate vars are ever migrated into `lib/config.ts`, update both files together.

---

**NIT-3 — `footer.locale_label` key may be unused in `MarketingFooter.tsx`**

`i18n/en/marketing.json` defines `"footer.locale_label": "Language"`. `MarketingFooter.tsx` uses `getTranslations('marketing.footer')` but renders only `<LocaleSwitcher />` with no `t('locale_label')` call in the footer JSX. Verify the key is consumed inside `LocaleSwitcher.tsx`; if not, remove it from all three locale files to avoid a dangling translation key.

---

## Non-Findings (items that appeared anomalous but are correct)

- **§8 `motion.ts` / `SECTION_MOTION` / `STAGGER_CHILD` absent:** Correctly deleted by Amendment A1. §17.2 is the binding motion spec; §8 is historical context.
- **`(dashboard)/page.tsx` deletion:** The conflicting redirect page was deleted to resolve the `/{locale}` route collision created by §3.4. ADR §2 says `(dashboard)` is "untouched" but this deletion was structurally unavoidable per §3.4. Correct.
- **Smoke test covers EN only:** ADR §14 specifies "the five routes" — it names routes, not locale combinations. EN-only coverage is within spec.
- **Pricing page uses raw `<section>` not `<Section>` wrapper:** ADR §4.2 describes `/pricing` as a compact transactional page; no entrance animation contract is specified for it. Correct.

---

## Verdict

**Ready to ship.**

Zero BLOCKERs. Zero MAJORs. Three MINORs: MINOR-1 deferred to the localization session (no visible effect at launch), MINOR-2 is an ADR diagram correction with no code change, MINOR-3 is a code-cleanliness issue with zero user-visible consequence. The copy is verbatim from ADR §6, the pricing surface is correctly wired from `getPlanCapabilities` with no drift possible, the accessibility posture is solid, the tests provide meaningful capability-change regression coverage, and the motion contract is correctly implemented per Amendment A1 with no animation library on the critical path.

Before merging: (1) amend ADR §3.1 diagram for the sitemap path (MINOR-2), (2) resolve MINOR-3 by either removing the `matchMedia` guard or documenting the deviation, (3) verify NIT-3 `locale_label` consumption in `LocaleSwitcher.tsx`.
