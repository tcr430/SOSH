# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.

# Claude-Mem

This project uses Claude-Mem for optimization, leverage this to improve quality and token usage.


# SOSH — Project Constitution for Claude Code

> This file is read by Claude Code at the start of every session. It contains the permanent context, decisions, and conventions for this project. Do not delete or rename this file. Update it deliberately — any change here affects every future session.

---

## What this project is

SOSH is an AI-powered social media management platform for B2B SaaS founders and marketers. Users define content campaigns with specific objectives, the AI generates platform-specific posts in their brand voice, the user reviews and approves them, then they publish automatically across multiple social platforms. SOSH also provides analytics insights and (in later phases) an engagement agent for replying to comments and DMs.

**This is not a fire-and-forget tool.** Every post is human-approved before publishing by default. Human-in-the-loop is a feature, not a fallback.

**Long-term vision:** SOSH for B2B SaaS (premium, €99–€199/mo). A future sub-product called Repost by SOSH will serve local service businesses (€19–€29/mo) on shared infrastructure. Build SOSH first, do not pre-build for Repost, but design abstractions cleanly so the future spinoff is feasible.

---

## Locked strategic decisions

These decisions have been made. Do not revisit them without explicit instruction from the user.

- **ICP:** B2B SaaS founders and marketing teams at tech companies with 1–100 employees
- **Launch platforms:** LinkedIn, X (Twitter), Instagram, Facebook Pages, Threads
- **Excluded platforms:** Reddit (cultural mismatch, brand-damage risk for our customers)
- **Future platforms (Phase 2+):** Pinterest, TikTok, YouTube Shorts
- **Languages:** English, Portuguese (PT-PT and PT-BR collapsed to `pt`), Spanish — global website, AI generates natively in all three
- **Pricing:** €99/mo Plus (1 business, LinkedIn + X, 5 active campaigns, 50 posts/month, basic analytics) and €199/mo Pro (1 business, all platforms, unlimited campaigns, unlimited posts, advanced analytics, engagement inbox)
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

**Rule (erasure cascade):** Any migration that adds a business-scoped table (or any table reachable only via a `business`) must, in the same PR, add a row to ADR 0010 Amendment 2's cascade table (§D2.5) and ensure the table either cascades from `businesses` ON DELETE or is explicitly purged/retained in `purge_business`. A business-scoped table omitted from the cascade table is a silent GDPR-erasure leak.

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

- **TypeScript strict mode.** No `any` types. If you need an unknown type, use `unknown` and narrow it. **Named carve-outs:** (1) `lib/email/templates/index.ts` — the template registry uses `props: any` and `React.FC<any>` with `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments to unify per-`EmailKind` payload shapes in the `KindEntry` interface; (2) `supabase/__tests__/*.test.ts` — the service-role admin client (`createServiceRoleClient()`) is typed `any` with an adjacent `eslint-disable-next-line @typescript-eslint/no-explicit-any` comment, house style across all ADR 0013 integration test files rather than retyping each one against the generated Supabase client type. These are the only accepted `any`-adjacent patterns in the codebase.
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

This project uses Everything Claude Code (ECC). Commands are namespaced with `/ecc:` prefix, such as:

- `/ecc:plan "task"` — break work into 2-5 min subtasks before implementing
- `/ecc:tdd-workflow "what to build"` — types/tests first, implementation second
- `/ecc:verification-loop` — run after each prompt; tsc + vitest must pass
  - **Always** run `npx tsc --noEmit --skipLibCheck` (bare `--noEmit` reports ECC remotion skill errors unrelated to SOSH)
  - **Always** run `npx vitest run lib/db lib/social lib/validation` (bare `npx vitest run` picks up ECC test files that call `process.exit()` and fail)
  - **`npm run build` currently fails** (pre-existing ECC issue — not introduced by SOSH code). Use `npm run dev` for local validation. Do not attempt to fix in a Builder session.
- `/ecc:agent-sort` — once per project setup; identifies relevant agents
- `/ecc:save-session` — at end of every session; writes session memory file

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

Other ECC agents, skills and commands may be used.

**Session structure for foundational work:** Architect → Builder → Reviewer in three separate Claude Code sessions, with `/exit` between each. The Reviewer typically surfaces issues that need a correction pass (Session N-D, N-E) before the next foundational session starts. Correction passes are normal, not failures.

---

## UI Component patterns (shadcn v4 / Base UI)

**shadcn v4 uses `@base-ui/react` under the hood — not Radix UI.** Several Base UI components have different APIs:

- **No `asChild` on DropdownMenu primitives.** `DropdownMenuTrigger` does not accept `asChild`. Style the trigger directly with Tailwind classes. Place `<Link>` or `<form>` as children *inside* `DropdownMenuItem`, not as the trigger itself.
- **No `asChild` on Button.** For a link styled as a button, use `buttonVariants()` applied to a `<Link className={cn(buttonVariants({ ... }))}>` — never `<Button asChild><Link>`.
- **shadcn `form` component absent from base-nova preset.** Create form wrappers manually with `react-hook-form` + `@radix-ui/react-slot`, or use `useActionState` (preferred in Server Action flows).

**Onboarding step page architecture:**

Each step page follows this split:
- **Server Component page** (`page.tsx`): renders the layout shell (progress indicator, heading), imports the form component, passes no data props — data comes from context.
- **Client Component form** (`Step{N}Form.tsx`): uses `useActiveBusiness()` to pre-fill values, calls the Server Action via `useActionState`, owns all interactivity.

This avoids duplicate data fetches and keeps Server Components clean.

**Native `<select>` preferred over shadcn Select** for dropdowns whose options are static constants. The shadcn Select (`@base-ui/react/select`) has uncertain API stability for certain patterns. Style with Tailwind `border rounded-md px-3 py-2 bg-background text-sm`.

**Architect role boundary:** Architect sessions produce ADR documents only. No code, no SQL, no TypeScript. The Architect's last action is a single confirmation line, then `/exit`. Any code attempted by an Architect session must be discarded.

---

## Webhook handlers

Patterns established during the Stripe webhook implementation (Session 11). Apply to any future webhook route.

- **Read raw body first.** Use `await req.text()` before anything else — Stripe signature verification requires the unmodified body string, not parsed JSON. Calling `req.json()` first corrupts the signature check.
- **Pre-record before dispatch.** Insert the event into `billing_events` using the provider's event ID as the DB primary key *before* any business logic runs. This ensures the event is tracked even if dispatch crashes.
- **Detect duplicates via `23505`.** On INSERT, catch the Postgres unique violation code `23505` — that's a replay. Return 200 immediately without re-processing. No SELECT needed.
- **Update outcome after dispatch.** After the dispatcher returns, call `updateBillingEventOutcome` with the result. The route owns idempotency; the dispatcher owns business logic — keep them separate.
- **Return codes:** signature failure → 400 (Stripe won't retry); unhandled dispatch error → 500 (Stripe will retry); duplicate or success → 200.

---

## Test-execution integrity (ADR 0015)

**"Covered" = executed green in CI, never "authored."** A test file that exists and passes locally but
that no CI job runs is not covered — it is `AUTHORED-NOT-EXECUTED`. A CI suite that a flag silently
empties to zero tests is not covered either — it is a `FALSE-GREEN`. Every named constraint in every ADR
maps to exactly one of three tiers (full definitions: `docs/decisions/0015-test-execution-and-ci-gates.md`
§2):

- **Tier 1 — DB-behaviour** (RLS policies, triggers, DEFINER RPCs): home is `supabase/__tests__/*` against
  a **live Postgres**, executed by `db-tests.yml`. A mocked client or a `pg_policies` read is not coverage.
- **Tier 2 — App-layer** (Server Actions, resolvers, components, i18n): home is `app/**`, `lib/**`,
  `components/**` `*.test.ts(x)`, executed by `vitest run` in `app-tests.yml` on every push/PR.
- **Tier 3 — Diff-verified** (properties of *absence*, e.g. "no new migration"): no runtime test by
  decision — must be enumerated as such in its owning ADR, so "no test" is a recorded decision, not an
  oversight.

**PROC-REVIEW-AT-COMMIT.** A Reviewer reads every file **at the stated commit range**
(`git diff <base>..<head>`, `git show <sha>:<path>`, `git log --oneline <base>..<head>`) — **never at
HEAD**. Reading at HEAD produced a false-positive MAJOR finding in Session 21B (a Reviewer read
`DashboardShell.tsx` at HEAD, which already contained 21C's live `/approvals` link; the 21C reviewer
withdrew it). Every Reviewer report MUST **open by naming the exact commit range it read**
(e.g. *"Scope reviewed: `c07dafda..9acc0133`; all citations are `git show <sha>:<path>` at that range,
never HEAD."*) — a report that doesn't name its range is not a valid review.

**SHARED-FUNCTION CALLERS.** A constraint written against a shared function MUST enumerate that
function's callers and state which ones the tests cover. Both Session 22 blockers (BLOCKER-1, BLOCKER-2)
were the same root cause: `APV-BULK-*` was verified against only one of `bulkApprovePostsAction`'s two
callers (`ApprovalsInbox.tsx`) across three consecutive sessions (21C, Session 22 B3, and the Session 22
review itself) before `PostsClient.tsx` — the other caller — was found to be unaudited and still exhibiting
the exact bugs the constraint was supposed to have closed. Before marking any constraint on a shared
function/action as tested, `git grep` its callers and list, per caller, which test file (if any) exercises
it. A caller with no listed test is `AUTHORED-NOT-EXECUTED` for that caller, even if another caller is
fully covered.

**REVIEWER-REPORT IMMUTABILITY.** A reviewer's report is append-only history and is NEVER edited in place
by the correction pass it audits. Resolutions go in a SEPARATE `docs/reviews/session-NN-D-corrections.md`
(or the next delta review), never as RESOLVED verdicts written back into the original by the fix's author.
The finding record and the fix record must not share an author in the same file. Session 22-D violated this
— `docs/reviews/session-22-reviewer.md` carries RESOLVED verdicts written by 22-D itself, the author of the
fixes those verdicts describe, collapsing the independent-audit trail this rule exists to preserve. That
file is left as-is (history is not rewritten after the fact); this rule prevents recurrence going forward.

**Merge gates (`docs/decisions/0015-test-execution-and-ci-gates.md` §5):**

| Check | Required? | What a RED means | Who can override |
|---|---|---|---|
| **`app-tests`** (tsc + eslint + vitest) | **Required — now** | A real regression in Tier-2 behaviour or type safety. | Repo admin only, written reason in the PR. Never routine. |
| **`db-tests`** (Tier-1 live-Postgres) | **Required after 3 consecutive full green runs on `master`** (the promotion rule). Advisory-**but-must-be-read** until then. | Either a DB-behaviour regression **or** a stack OOM — the reviewer must open the run and distinguish the two. | Until promoted: tech lead reads the evidence and decides. After promotion: repo admin only, as `app-tests`. |
| **Skip-guard** (part of `db-tests`) | Required whenever `db-tests` runs | A `supabase/__tests__` file executed zero tests — a false-green. | No override — a fix is mandatory. |

The three-green tally and promotion date live in `docs/current-phase.md`.

## Legal pages

`content/legal/*.mdx` files are counsel-ready prose locked against the Evidence Pack at `docs/evidence/0010-legal-evidence.md`.

Any PR touching these files must either:
- Confirm the `evidenceRef` frontmatter still matches the current Evidence Pack commit, **or**
- Bump `evidenceRef` to a new Evidence Pack commit that covers the change.

Drift between code reality and legal prose is a counsel-grade failure mode. The Evidence Pack is the long-term artefact; the MDX is its rendering.

`[LEGAL ENTITY]` placeholders are deliberate — substitution is gated on counsel ratification (launch-checklist §9 entity gate, ADR 0010 A1.6). Do not replace them in a Builder session.

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
