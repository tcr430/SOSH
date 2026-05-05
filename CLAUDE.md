# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.


# SŌSH — Project Constitution for Claude Code

> This file is read by Claude Code at the start of every session. It contains the permanent context, decisions, and conventions for this project. Do not delete or rename this file. Update it deliberately — any change here affects every future session.

---

## What this project is

SŌSH is an AI-powered social media management platform for B2B SaaS founders and marketers. Users define content campaigns with specific objectives, the AI generates platform-specific posts in their brand voice, the user reviews and approves them, then they publish automatically across multiple social platforms. SŌSH also provides analytics insights and (in later phases) an engagement agent for replying to comments and DMs.

**This is not a fire-and-forget tool.** Every post is human-approved before publishing by default. Human-in-the-loop is a feature, not a fallback.

**Long-term vision:** SŌSH for B2B SaaS (premium, €99–€199/mo). A future sub-product called Repost by SŌSH will serve local service businesses (€19–€29/mo) on shared infrastructure. Build SŌSH first, do not pre-build for Repost, but design abstractions cleanly so the future spinoff is feasible.

---

## Locked strategic decisions

These decisions have been made. Do not revisit them without explicit instruction from the user.

- **ICP:** B2B SaaS founders and marketing teams at tech companies with 1–100 employees
- **Launch platforms:** LinkedIn, X (Twitter), Instagram, Facebook Pages, Threads
- **Excluded platforms:** Reddit (cultural mismatch, brand-damage risk for our customers)
- **Future platforms (Phase 2+):** Pinterest, TikTok, YouTube Shorts
- **Languages:** English, Portuguese (PT-PT and PT-BR collapsed to `pt`), Spanish — global website, AI generates natively in all three
- **Pricing:** €99/mo Starter (1 business, LinkedIn + X, 2 active campaigns, 30 posts/month, basic analytics) and €199/mo Pro (1 business, all platforms, unlimited campaigns, unlimited posts, advanced analytics, engagement inbox)
- **Trial:** 14 days, card required upfront, work email required (block free providers), 1 campaign / 50 generated posts cap during trial, trial clock starts on first social account connection
- **Agency tier:** Reserved as a `plan` enum value but not implemented at launch. Phase 4.

---

## Architecture principles

These are non-negotiable. Every implementation follows these.

### The SocialProvider abstraction

We integrate with social platforms through a single abstraction layer called `SocialProvider`. At launch, the only implementation is `PostizProvider` (using self-hosted Postiz). In the future, individual platforms will get native provider implementations.

**Rule:** No code outside `/lib/social/` ever imports `postiz-provider` or `mock-provider` directly. All consumers import from `/lib/social/index.ts`. Business logic talks to `SocialProvider`, never to Postiz.

### Token storage — Supabase Vault, never raw

OAuth tokens are stored in `vault.secrets` (Supabase Vault), encrypted at rest. The `social_accounts` table holds only opaque `vault_access_token_id` and `vault_refresh_token_id` (uuids), never raw tokens. The `/lib/social/` layer uses the service-role client to read decrypted tokens from `vault.decrypted_secrets`. No raw token ever appears in any application table or TypeScript type.

On disconnect: set `is_active = false`, null the vault ID columns, delete the vault secrets via service-role RPC. All three steps required for GDPR compliance.

### The AI layer

All Anthropic SDK calls go through `/lib/ai/`. No direct Anthropic SDK calls anywhere else. Every Claude API call must include a `CustomerContext` object that aggregates the customer's business profile, brand voice, recent campaigns, and recent post performance.

**Rule:** When you find yourself wanting to call `anthropic.messages.create` outside `/lib/ai/`, stop and add a function to `/lib/ai/` instead.

### Database access

All Supabase queries go through `/lib/db/`. Each table has its own file (e.g., `/lib/db/campaigns.ts`, `/lib/db/posts.ts`) exposing typed query functions. No direct Supabase calls in API routes, Server Actions, or components.

**Rule:** API routes and Server Actions call functions in `/lib/db/`. Functions in `/lib/db/` call Supabase. Nothing else calls Supabase.

### Three Supabase client roles

Three distinct client factories, each with a specific purpose. Mixing them is a security bug.

| File | Key | Used by |
|---|---|---|
| `/lib/supabase/client.ts` | anon | Browser/Client Components only |
| `/lib/supabase/server.ts` | anon | Server Components, Server Actions, route handlers |
| `/lib/supabase/middleware.ts` | anon | Session refresh in proxy.ts |
| `/lib/supabase/service.ts` | service-role | AI layer, webhook handlers, vault writes, scheduler — never imported into a Server Component or Client Component |

`createServiceRoleClient()` has a `serverOnly()` guard and bypasses RLS entirely. Use it only for: `ai_usage` writes, `trial_state` writes, `vault.create_secret`/`update_secret`/`delete_secret`, the publishing worker, the metrics worker, the Stripe webhook.

**Pattern:** When a `/lib/db/` function requires service-role, use the lazy-import pattern so the service-role client is never accidentally bundled into client code:

```typescript
export async function recordAiUsage(data: AiUsageInsert): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  // ...
}
```

Functions that internally use service-role do not take a `client` parameter — they acquire their own. Caller can't accidentally pass an authenticated client and trigger silent permission failures.

### Multi-tenancy via Row Level Security

Every table that contains customer data has `business_id` as a foreign key. Every table has Row Level Security enabled. Every RLS policy uses `(SELECT get_user_business_ids())` (wrapped in `SELECT` so the function evaluates once per query, not once per row).

**Rule:** No new table is created without an RLS policy. Every UPDATE policy must have both `USING` and `WITH CHECK` clauses to prevent tenant tunnelling.

### Atomic state transitions

State machine transitions on rows (post status, campaign status) use a conditional UPDATE rather than a read-then-update. The `WHERE` clause guards against invalid transitions atomically.

```typescript
await client
  .from('posts')
  .update({ status: 'approved' })
  .eq('id', id)
  .eq('status', 'draft')  // atomic guard
  .select()
  .single()
```

This eliminates a round-trip and is correct under concurrent requests.

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
- **Date handling via date-fns.** Never `new Date().toISOString()` directly when comparing or formatting — use `formatISO()` from date-fns.
- **i18n from day one.** Every user-facing string goes through the i18n system, never hardcoded English. Add keys to all three locale files simultaneously (en, pt, es).
- **List queries always have a `limit` parameter** with a sensible default. Unbounded queries are a self-DoS vector.
- **List queries always have an explicit `ORDER BY`** matching an existing index — never rely on implicit ordering.
- **Soft-delete filtering happens in `/lib/db/` query helpers** (`.is('deleted_at', null)`), not in RLS. Service-role consumers can opt out by calling alternate functions.
- **`*Update` types exclude tenancy-critical fields** — `business_id`, `campaign_id`, `published_at`, `platform_post_id`, `deleted_at`, `plan`, `stripe_*`. Mutations to these go through dedicated service-role functions.

---

## File structure

```
/app
  /[locale]
    /(auth)              → Login, signup, password reset
    /(dashboard)         → Protected app pages
    /(marketing)         → Public landing pages
  /api                   → API routes (only when Server Actions can't be used)
/components
  /ui                    → shadcn primitives
  /campaigns             → Campaign-specific components
  /posts                 → Post-specific components
  /layout                → Sidebar, navbar, etc.
/lib
  /ai                    → All Anthropic SDK calls + prompt templates
  /social                → SocialProvider abstraction + implementations
  /db                    → Supabase query functions, one file per table
  /supabase              → Supabase client setup (browser, server, middleware, service)
  /validation            → Zod schemas (email, etc.)
  /config.ts             → Typed env var access
/i18n
  /en, /pt, /es          → Translation files
/supabase
  /migrations            → SQL migrations
/scripts                 → One-off scripts (apply-migrations.ts, etc.)
/docs
  /decisions             → Architecture Decision Records (ADRs)
  /build-guide           → Session-by-session build guide
  current-phase.md       → What's being built now, what's done, what's next
proxy.ts                 → Next.js 16 middleware (renamed from middleware.ts)
```

---

## What we don't do

- We don't post to Reddit (excluded by strategic decision)
- We don't auto-publish without user approval (human-in-the-loop is a feature)
- We don't store payment card data (Stripe handles this)
- We don't store raw OAuth tokens (Vault only)
- We don't generate images at launch (text-only Phase 1, image generation is Phase 2)
- We don't support personal social accounts (business accounts only)
- We don't have a free forever tier (14-day trial only)
- We don't expose service-role client outside trusted server contexts

---

## Working with Claude Code (ECC integration)

This project uses Everything Claude Code (ECC). Commands are namespaced with `/everything-claude-code:` prefix:

- `/everything-claude-code:plan "task"` — break work into 2-5 min subtasks before implementing
- `/everything-claude-code:tdd "what to build"` — types/tests first, implementation second
- `/everything-claude-code:verify` — run after each prompt; tsc + vitest must pass
  - **Always** run `npx tsc --noEmit --skipLibCheck` (bare `--noEmit` reports ECC remotion skill errors unrelated to SOSH)
  - **Always** run `npx vitest run lib/db lib/social` (bare `npx vitest run` picks up ECC test files that call `process.exit()` and fail)
- `/everything-claude-code:agent-sort` — once per project setup; identifies relevant agents
- `/everything-claude-code:save-session` — at end of every session; writes session memory file

**ECC agents used in this project:**

| Agent | Used for |
|---|---|
| `architect` | Architect sessions — produces ADRs, no code |
| `database-reviewer` | Schema, indexes, RLS, query patterns |
| `security-reviewer` | RLS leakage, SSRF, auth, token exposure, prompt injection |
| `typescript-reviewer` | Type safety, abstraction integrity, no `any` |
| `tdd-guide` | Enforces RED-GREEN-REFACTOR |
| `code-reviewer` | General quality after implementation |
| `cost-aware-llm-pipeline` | AI cost optimisation, model selection |
| `build-error-resolver` | Diagnoses before proposing fixes |

**Session structure for foundational work:** Architect → Builder → Reviewer in three separate Claude Code sessions, with `/exit` between each. The Reviewer typically surfaces issues that need a correction pass (Session N-D, N-E) before the next foundational session starts. Correction passes are normal, not failures.

**Architect role boundary:** Architect sessions produce ADR documents only. No code, no SQL, no TypeScript. The Architect's last action is a single confirmation line, then `/exit`. Any code attempted by an Architect session must be discarded.

---

## Current phase

**Phase 1 — MVP** (in progress)

See `/docs/current-phase.md` for the working state.

---

## Tech stack reference

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack)
- **Database:** Supabase (Postgres + Auth + Storage + Vault)
- **Hosting:** Vercel (with Vercel Cron for scheduled jobs)
- **AI:** Anthropic Claude (Sonnet 4.6 default, Opus 4.7 for architecture/inference, Haiku 4.5 for classification)
- **Social publishing:** Self-hosted Postiz (behind SocialProvider abstraction)
- **Payments:** Stripe (subscriptions)
- **Email:** Resend (transactional)
- **Styling:** Tailwind CSS + shadcn/ui
- **Validation:** Zod
- **Dates:** date-fns
- **i18n:** next-intl
- **Testing:** Vitest

---

## When in doubt

If you (Claude Code) encounter a situation not covered here, stop and ask. Do not improvise architectural decisions. Do not add new dependencies without confirming. Do not introduce patterns that are inconsistent with what already exists in the codebase.

If the user's prompt seems to contradict this file, follow this file and flag the contradiction.
