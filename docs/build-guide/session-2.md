# Session 2 — Database Schema & Multi-Tenancy

> **Goal:** Design and implement the complete database schema with RLS, multi-tenant isolation, and typed query helpers.
> **Time:** 2–3 hours
> **Models:** Architect (Opus 4.7) → Builder (Sonnet 4.6) → Reviewer (Opus 4.7)
> **ECC agents:** `architect`, `database-reviewer`, `security-reviewer`, `tdd-guide`
> **Session structure:** Three separate Claude Code sessions — `/clear` or `/exit` between each

---

## Pre-session checklist

- [ ] Session 1 complete and committed
- [ ] ECC installed — run `/plugin list everything-claude-code@everything-claude-code` to confirm
- [ ] `npm run dev` works (warnings fine, errors not)
- [ ] Supabase project shows "Active"
- [ ] Service role key available in `.env.local`
- [ ] Run one quick ECC health check: fresh `claude` session → `/agent-sort` → confirm `database-reviewer` and `security-reviewer` appear → `/exit`

---

## Part A — Architect Session (Opus 4.7)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Opus 4.7**
3. Paste Primer → Prompt → `/exit` when done

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, and AGENTS.md.

Session 2 Part A — Database Architecture. Architect role only.

ECC workflow:
- Use the architect agent mindset: think before designing
- Before writing the document, list the key decisions you need to 
  make and any ambiguities you spot in the requirements
- Ask clarifying questions if anything is unclear
- Only produce the design document after I confirm your decision list

Output: /docs/decisions/0001-database-schema.md
No SQL files. No TypeScript. Pure design document.

Acknowledge, list your planned decisions, wait for my go-ahead.
```

### Architect Prompt

```
Design the complete Supabase database schema for SŌSH Phase 1.

Tables required:

1. businesses — multi-tenant root. Fields: id, name, website, 
   industry, description, logo_url, owner_id (fk auth.users), 
   plan (enum: trial/starter/pro/agency), stripe_customer_id, 
   stripe_subscription_id, language (enum: en/pt/es), timezone, 
   onboarding_completed (bool default false), created_at, updated_at.

2. brand_voices — 1:1 with businesses. Fields: id, business_id, 
   tone (text[]), target_audience (text), keywords (text[]), 
   avoid_words (text[]), writing_examples (text[], max 3), 
   competitors (text[]), unique_value_prop (text), 
   inferred_from_url (text nullable), updated_at.

3. social_accounts — many:1 with businesses. Fields: id, business_id,
   platform (enum: linkedin/twitter/instagram/facebook/threads),
   platform_user_id, platform_username, platform_display_name,
   vault_access_token_id (uuid — Supabase Vault secret ID, not raw token),
   vault_refresh_token_id (uuid nullable), token_expires_at (timestamptz
   nullable), is_active (bool default true), connected_at, updated_at.
   NOTE: tokens stored in Supabase Vault, this table stores only the 
   vault secret IDs.

4. campaigns — many:1 with businesses. Fields: id, business_id, name,
   objective (text), special_instructions (text nullable), 
   platforms (text[]), frequency (enum: daily/3x_week/weekly/custom),
   posts_per_week (int), start_date (date), end_date (date),
   status (enum: draft/active/paused/completed),
   total_posts_planned (int default 0), total_posts_published (int 
   default 0), created_at, updated_at.

5. posts — many:1 with campaigns AND businesses (denormalized 
   business_id for RLS query performance). Fields: id, campaign_id,
   business_id, platform (same enum), content (text), hashtags (text[]),
   media_urls (text[] default '{}'), scheduled_at (timestamptz),
   published_at (timestamptz nullable), platform_post_id (text nullable),
   status (enum: draft/approved/scheduled/published/failed/skipped),
   rejection_note (text nullable), ai_generation_metadata (jsonb default '{}'),
   created_at, updated_at.

6. post_metrics — many:1 with posts AND businesses. Fields: id, post_id,
   business_id, likes (int nullable), comments (int nullable), 
   shares (int nullable), saves (int nullable), clicks (int nullable),
   reach (int nullable), impressions (int nullable), last_synced_at.
   NOTE: nullable means platform doesn't expose metric — not zero.

7. engagement_inbox — many:1 with businesses, nullable fk posts.
   Fields: id, business_id, post_id (nullable), platform, 
   type (enum: comment/dm/mention), platform_item_id (text, unique 
   per platform — add UNIQUE constraint), author_username, 
   author_display_name, content (text), received_at,
   sentiment (enum: positive/neutral/negative/urgent, nullable),
   ai_draft_reply (text nullable),
   status (enum: pending/replied/ignored/auto_replied),
   replied_at (timestamptz nullable).

8. trial_state — 1:1 with businesses. Fields: id, business_id,
   trial_started_at (timestamptz nullable — NULL until first 
   social_account connected — THIS IS WHEN 14-DAY CLOCK STARTS),
   campaigns_created_count (int default 0),
   posts_generated_count (int default 0),
   work_email_verified (bool default false),
   trial_card_fingerprint (text nullable).

9. ai_usage — many:1 with businesses. Fields: id, business_id,
   prompt_id (text), prompt_version (int), model (text),
   input_tokens (int), output_tokens (int), cost_cents (int),
   latency_ms (int), success (bool), error_code (text nullable),
   created_at.

Design requirements:

A. RLS POLICIES using Supabase Auth
- Create helper function: get_user_business_ids() returns uuid[]
- Every table: RLS enabled, SELECT/INSERT/UPDATE/DELETE scoped to 
  user's own businesses via get_user_business_ids()
- EXCEPTION: ai_usage and trial_state — SELECT by owner, 
  INSERT/UPDATE by service_role only (AI and billing layers use 
  service client)
- CRITICAL: check every policy for cross-tenant leakage risk

B. SUPABASE VAULT for token storage
- social_accounts stores vault secret IDs, not raw tokens
- Document: how vault.create_secret() creates a token secret
- Document: how vault.decrypted_secrets view retrieves it  
- Document: how token refresh updates the secret in-place
- The vault secret name convention: 'sosh_token_{account_id}_{type}'

C. INDEXES for hot query paths
- Posts publish queue: (status, scheduled_at) partial where status='approved'
- Posts by campaign: (campaign_id)
- Posts by business+time: (business_id, created_at DESC)
- Engagement queue: (business_id, status, received_at DESC)
- AI usage by business+month: (business_id, created_at DESC)
- All foreign key columns that lack an index

D. SOFT DELETES
Decide which tables need deleted_at. Document reasoning for each.
Campaigns and posts likely yes. Others TBD.

E. AUDIT TRIGGERS  
One reusable trigger function set_updated_at() applied to every 
table that has updated_at.

F. TRIAL ENFORCEMENT TRIGGER
A trigger on social_accounts INSERT: if this is the first 
social_account for a business and trial_state.trial_started_at 
is NULL, set it to now(). This is the official trial clock start.

G. MIGRATION ORDER
List the exact order migrations must be applied. Dependencies 
must be respected (e.g. businesses before brand_voices).

Write the full document and save to /docs/decisions/0001-database-schema.md
```

### After Part A

- [ ] File exists with all 9 tables
- [ ] Vault approach documented
- [ ] All RLS policies written in SQL syntax
- [ ] Trial trigger documented
- [ ] Migration order listed

```
git add docs/decisions/0001-database-schema.md
git commit -m "Session 2A: Database schema design"
git push
```

**→ Paste the document to Claude.ai. Do not start Part B without confirmation.**

---

## Part B — Builder Session (Sonnet 4.6)

> Wait for Claude.ai sign-off on the design before starting.

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, AGENTS.md, and
/docs/decisions/0001-database-schema.md.

Session 2 Part B — Database Implementation. Builder role.

ECC workflow for this session:
- Use /ecc:plan before each prompt to break it into subtasks
- Use /tdd for all TypeScript (types/interfaces first, then implementation)
- Use /verify after each prompt — do not proceed if verify fails
- Stop and ask if anything in the design is ambiguous — do not invent

Confirm: list the 9 tables you'll be creating before I send Prompt 1.
```

### Builder Prompt 1 — Migration files

```
/ecc:plan "Create all Supabase SQL migration files for SŌSH Phase 1"

After plan is confirmed, create /supabase/migrations/ with these files:

20260101000001_extensions.sql — enable pgsodium for Vault
20260101000002_helper_functions.sql — get_user_business_ids(), set_updated_at()
20260101000003_businesses.sql
20260101000004_brand_voices.sql
20260101000005_social_accounts.sql — Vault secret ID columns, not raw tokens
20260101000006_campaigns.sql
20260101000007_posts.sql
20260101000008_post_metrics.sql
20260101000009_engagement_inbox.sql
20260101000010_trial_state.sql
20260101000011_ai_usage.sql
20260101000012_rls_policies.sql — ALL RLS in one file
20260101000013_indexes.sql
20260101000014_triggers.sql — attach set_updated_at to all tables
20260101000015_trial_clock_trigger.sql — sets trial_started_at on first social_account

Rules:
- Each file has a header comment explaining its purpose
- IF NOT EXISTS guards where re-running is safe
- Match the design document exactly — zero invention

/verify: all 15 files exist, names match exactly, grep for obvious syntax errors
```

### Builder Prompt 2 — TypeScript types

```
/tdd "TypeScript database types for all 9 SŌSH tables"

Step 1 (RED): Write /lib/db/types.ts with:
- Row types for all 9 tables
- Insert types (required fields only, auto-generated optional)
- Update types (all optional)
- All enum types as string literal unions (not TypeScript enums)
- No 'any', no 'unknown' without narrowing

Step 2: Write /lib/db/types.test.ts with type-level assertions

Step 3 (GREEN): Run npx tsc --noEmit — must be zero errors

/verify: tsc clean, all 9 tables represented, no 'any'
```

### Builder Prompt 3 — Query helpers

```
/tdd "Supabase query helper files for all 9 tables in /lib/db/"

For each table, following TDD:
1. Write function signatures (types only) in the .ts file
2. Write tests in .test.ts using a mock Supabase client
3. Implement the functions
4. Run npx vitest run to confirm tests pass

Files:
- /lib/db/businesses.ts + .test.ts
- /lib/db/brand-voices.ts + .test.ts
- /lib/db/social-accounts.ts + .test.ts
- /lib/db/campaigns.ts + .test.ts
- /lib/db/posts.ts + .test.ts
- /lib/db/post-metrics.ts + .test.ts
- /lib/db/engagement.ts + .test.ts
- /lib/db/trial-state.ts + .test.ts
- /lib/db/ai-usage.ts + .test.ts

Each function: takes Supabase client as first arg, fully typed,
throws on error (caller handles). No direct Supabase access outside 
these files per CLAUDE.md.

Update /lib/db/index.ts to re-export everything.

/verify after each file pair before moving to the next.
```

### Builder Prompt 4 — Apply migrations

```
Create /scripts/apply-migrations.ts:
- Reads /supabase/migrations/ alphabetically
- Uses service_role key via /lib/config.ts (never process.env directly)
- Logs each migration result
- Stops on first failure

npm install -D tsx
Add to package.json: "db:migrate": "tsx scripts/apply-migrations.ts"

Run: npm run db:migrate

Show full output. If any migration fails, stop and show the error.
Do not auto-fix.

If all pass, run this in Supabase SQL Editor and paste the result:
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' ORDER BY table_name;

/verify: all 9 tables in the output
```

### Builder Test Checklist

- [ ] 15 files in `/supabase/migrations/`
- [ ] `npm run db:migrate` succeeded
- [ ] All 9 tables in Supabase Table Editor
- [ ] RLS enabled on every table (click each → Authentication)
- [ ] All `/lib/db/*.ts` and `.test.ts` files exist
- [ ] `npx vitest run` passes
- [ ] `npx tsc --noEmit` passes

```
git add .
git commit -m "Session 2B: Database implementation"
git push
```

---

## Part C — Reviewer Session (Opus 4.7)

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0001-database-schema.md, all files in 
/supabase/migrations/, all files in /lib/db/.

Session 2 Part C — Database Review.

Invoke the database-reviewer ECC agent and the security-reviewer 
ECC agent. You are an independent reviewer — you did not write 
this code. Do not modify any files.

Acknowledge when ready.
```

### Reviewer Prompt

```
Run the database-reviewer agent followed by the security-reviewer 
agent. Synthesize findings into one structured report.

SECTION A — SCHEMA (database-reviewer)
- All 9 tables present and match design document?
- Column types, constraints, defaults correct?
- Foreign keys correct and enforced?
- Enum fields use CHECK constraints or PG enums?
- Vault secret IDs in social_accounts (not raw tokens)?
- Soft delete columns where design specified?

SECTION B — RLS SECURITY (security-reviewer — most critical)
For every table, verify:
- RLS is ENABLED (not just policies present — RLS must be ON)
- SELECT policy scopes to user's businesses only
- INSERT policy prevents writing to other business's data
- UPDATE/DELETE same scoping
- Any USING (true) policy: FLAG AS ❌ CRITICAL
- Any missing business_id filter: FLAG AS ❌ CRITICAL
- ai_usage INSERT: service_role only?
- trial_state INSERT/UPDATE: service_role only?
- No raw tokens stored — only vault secret IDs?
Search entire codebase for 'createClient' — report every instance 
and whether it uses service_role or anon key.

SECTION C — PERFORMANCE (database-reviewer)
- All indexes from design doc exist?
- Partial index on posts (status, scheduled_at) where status='approved'?
- All FK columns indexed?
- Any obvious N+1 query risks in /lib/db/?

SECTION D — CODE QUALITY
- Any 'any' in /lib/db/? (CLAUDE.md: forbidden)
- Tests exist for all 9 db files?
- All functions use types from /lib/db/types.ts?
- Any process.env usage outside /lib/config.ts?

SECTION E — TRIGGERS
- set_updated_at trigger on all tables with updated_at?
- trial_clock_trigger fires on first social_account insert?

SECTION F — DESIGN ADHERENCE
- Any deviation from /docs/decisions/0001-database-schema.md?
- Anything added not in design?
- Anything omitted from design?

Report format: markdown table with columns:
Section / Check / Status (✅/❌/⚠️) / File:Line / Fix

Then: list all ❌ items with exact fix instructions.
Then: list all ⚠️ items with recommendations.
```

### After Part C

All ✅ or only ⚠️ (no ❌):
```
git add .
git commit -m "Session 2C: Database review passed"
git push
```

Any ❌: paste full report to Claude.ai for correction prompts.

---

## Report Back to Claude.ai

```
Session 2 complete.

Tables created: [list all 9]
Migrations applied: [yes/no]
Tests passing: [yes/no]
tsc clean: [yes/no]

Reviewer report:
[paste full report]

Remaining ❌: [list or "none"]
⚠️ Concerns: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas

**Vault vs pgcrypto** — Supabase Vault is the correct approach. If Claude Code reaches for pgcrypto for token storage, redirect it to `vault.create_secret()`.

**Migrations partially applied** — DB is now inconsistent. Don't re-run. Paste error to Claude.ai.

**RLS enabled ≠ RLS policies exist** — you need both. The reviewer checks both explicitly.

**Service role leaked client-side** — `SUPABASE_SERVICE_ROLE_KEY` in any non-server file = stop everything.

**ECC /verify fails** — never skip it. Paste the failure to Claude.ai.
