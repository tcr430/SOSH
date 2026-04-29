# SŌSH — Project Constitution for Claude Code

> This file is read by Claude Code at the start of every session. It contains the permanent context, decisions, and conventions for this project. Do not delete or rename this file. Update it deliberately — any change here affects every future session.

---

## What this project is

SŌSH is an AI-powered social media management platform for B2B SaaS founders and marketers. Users define content campaigns with specific objectives, the AI generates platform-specific posts in their brand voice, the user reviews and approves them, then they publish automatically across multiple social platforms. SŌSH also provides analytics insights and (in later phases) an engagement agent for replying to comments and DMs.

**This is not a fire-and-forget tool.** Every post is human-approved before publishing by default. Human-in-the-loop is a feature, not a fallback.

**Long-term vision:** SŌSH for B2B SaaS (premium, €99-€199/mo). A future sub-product called Repost by SŌSH will serve local service businesses (€19-€29/mo) on shared infrastructure. Build SŌSH first, do not pre-build for Repost, but design abstractions cleanly so the future spinoff is feasible.

---

## Locked strategic decisions

These decisions have been made. Do not revisit them without explicit instruction from the user.

- **ICP:** B2B SaaS founders and marketing teams at tech companies with 1-100 employees
- **Launch platforms:** LinkedIn, X (Twitter), Instagram, Facebook Pages, Threads
- **Excluded platforms:** Reddit (cultural mismatch, brand-damage risk for our customers)
- **Future platforms (Phase 2+):** Pinterest, TikTok, YouTube Shorts
- **Languages:** English, Portuguese (PT-PT and PT-BR), Spanish — global website, AI generates natively in all three
- **Pricing:** €99/mo Starter (1 business, LinkedIn + X, 2 active campaigns, 30 posts/month, basic analytics) and €199/mo Pro (1 business, all platforms, unlimited campaigns, unlimited posts, advanced analytics, engagement inbox)
- **Trial:** 14 days, card required upfront, work email required (block free providers), 1 campaign / 50 generated posts cap during trial, trial clock starts on first social account connection
- **Agency tier:** Planned for Phase 4, not implemented at launch

---

## Architecture principles

These are non-negotiable. Every implementation follows these.

### The SocialProvider abstraction

We integrate with social platforms through a single abstraction layer called `SocialProvider`. At launch, the only implementation is `PostizProvider` (using self-hosted Postiz). In the future, individual platforms (LinkedIn, X, etc.) will get their own native provider implementations.

**Rule:** No code outside `/lib/social/` ever calls Postiz directly. No code outside `/lib/social/` ever knows that Postiz exists. Business logic talks to `SocialProvider`, not to Postiz.

### The AI layer

All Anthropic SDK calls go through `/lib/ai/`. No direct Anthropic SDK calls anywhere else in the codebase. Every Claude API call must include a `CustomerContext` object that aggregates the customer's business profile, brand voice, recent campaigns, and recent post performance.

**Rule:** When you find yourself wanting to call `anthropic.messages.create` outside `/lib/ai/`, stop and add a function to `/lib/ai/` instead.

### Database access

All Supabase queries go through `/lib/db/`. Each table has its own file (e.g., `/lib/db/campaigns.ts`, `/lib/db/posts.ts`) exposing typed query functions. No direct Supabase calls in API routes or components.

**Rule:** API routes call functions in `/lib/db/`. Functions in `/lib/db/` call Supabase. Nothing else calls Supabase.

### Multi-tenancy via Row Level Security

Every table that contains customer data has `business_id` as a foreign key. Every table has Row Level Security enabled. Every RLS policy uses `auth.uid()` to scope access to the authenticated user's businesses only.

**Rule:** No new table is created without an RLS policy. No exceptions.

### Configuration

All environment variables accessed through `/lib/config.ts` which exports a typed object. Never use `process.env.SOMETHING` directly in code outside that file.

---

## Code conventions

- **TypeScript strict mode.** No `any` types. If you need an unknown type, use `unknown` and narrow it.
- **Server Components by default.** Only use `'use client'` when interactivity demands it.
- **Server Actions for mutations.** Don't create POST API routes for things that can be Server Actions.
- **Zod for all input validation.** Every Server Action and API route validates input with Zod before processing.
- **Tailwind only for styling.** No CSS modules, no styled-components, no inline `style` attributes except when truly dynamic.
- **shadcn/ui for primitives.** Don't build a button from scratch when shadcn has one.
- **No console.log in committed code.** Use a proper logger (we'll add this later) or remove before committing.
- **Date handling via date-fns.** Never `new Date()` directly when comparing or formatting — use date-fns helpers.
- **i18n from day one.** Every user-facing string goes through the i18n system, never hardcoded English.

---

## File structure

```
/app
  /(auth)              → Login, signup, password reset
  /(dashboard)         → Protected app pages
  /(marketing)         → Public landing pages
  /api                 → API routes (only when Server Actions can't be used)
/components
  /ui                  → shadcn primitives
  /campaigns           → Campaign-specific components
  /posts               → Post-specific components
  /layout              → Sidebar, navbar, etc.
/lib
  /ai                  → All Anthropic SDK calls + prompt templates
  /social              → SocialProvider abstraction + implementations
  /db                  → Supabase query functions, one file per table
  /config.ts           → Typed env var access
  /supabase            → Supabase client setup (server, browser, middleware)
/i18n
  /en, /pt, /es        → Translation files
/docs
  /decisions           → Architecture Decision Records (ADRs)
  /build-guide         → Session-by-session build guide (this folder)
  current-phase.md     → What's being built now, what's done, what's next
```

---

## What we don't do

- We don't post to Reddit (excluded by strategic decision)
- We don't auto-publish without user approval (human-in-the-loop is a feature)
- We don't store payment card data (Stripe handles this)
- We don't generate images at launch (text-only Phase 1, image generation is Phase 2)
- We don't support personal social accounts (business accounts only — Instagram requires Business account, X is fine for personal but our marketing is B2B)
- We don't have a free forever tier (14-day trial only)

---

## Current phase

**Phase 1 — MVP** (in progress)

Goal: First paying customer. Core loop: signup → onboard with brand voice → connect social account → create campaign → AI generates posts → user approves → posts publish on schedule.

See `/docs/current-phase.md` for the working state.

---

## Tech stack reference

- **Framework:** Next.js 14 (App Router, TypeScript)
- **Database:** Supabase (Postgres + Auth + Storage)
- **Hosting:** Vercel (with Vercel Cron for scheduled jobs)
- **AI:** Anthropic Claude (Sonnet 4.6 default, Opus 4.7 for complex generation, Haiku 4.5 for classification)
- **Social publishing:** Self-hosted Postiz (behind SocialProvider abstraction)
- **Payments:** Stripe (subscriptions)
- **Email:** Resend (transactional)
- **Styling:** Tailwind CSS + shadcn/ui
- **Validation:** Zod
- **Dates:** date-fns
- **i18n:** next-intl

---

## When in doubt

If you (Claude Code) encounter a situation not covered here, stop and ask. Do not improvise architectural decisions. Do not add new dependencies without confirming. Do not introduce patterns that are inconsistent with what already exists in the codebase.

If the user's prompt seems to contradict this file, follow this file and flag the contradiction.
