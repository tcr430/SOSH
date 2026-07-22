# Session 7 — Campaign Builder

> **Goal:** Users create content campaigns — defining objectives, selecting platforms, setting frequency and dates. Campaign list and detail pages. Plan enforcement for trial and Starter limits. Post generation is Session 8; this session creates the campaign and shows it ready for generation.
> **Time:** 3–5 hours including correction pass
> **Models:** Builder (Sonnet 4.6) → Reviewer (Opus 4.7)
> **Plugins:** ECC for structure, Frontend Design auto-activates for UI, claude-mem automatic
> **Session structure:** Single builder session (form + list + detail share tight context), reviewer, expected correction pass

---

## Why no Architect session

The campaigns table is fully designed in ADR 0001. The data model, status machine, and plan limits are all specified. The campaign builder is well-defined product work — no novel architecture decisions. Single builder + reviewer is the right structure.

---

## What this session builds and what it doesn't

**Builds:**
- Campaign creation form (multi-section, single page)
- Campaign list page with empty state
- Campaign detail page (shows campaign info + "Generate Posts" CTA)
- Server Action for campaign creation with plan enforcement
- Trial cap enforcement (1 campaign) and Starter enforcement (2 active)
- Campaign status management (pause, complete, delete)

**Defers to Session 8:**
- AI post generation (the "Generate Posts" button exists but is a placeholder)
- Post review and approval queue

---

## Pre-session checklist

- [ ] Session 6 fully complete — all correction passes done
- [ ] At least one social account connected (LinkedIn or X) so platform selection works
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run` passes
- [ ] claude-mem running at http://localhost:37777

---

## Part A — Builder Session (Sonnet 4.6)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Sonnet 4.6**
3. Paste Primer
4. claude-mem injects previous session context — review before Prompt 1
5. Run prompts in order — do NOT `/clear` between them

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0001-database-schema.md (campaigns table, §B.4),
/lib/db/campaigns.ts, /lib/db/trial-state.ts,
/lib/db/businesses.ts, /lib/db/types.ts.
Read /lib/social/platforms/config.ts,
/lib/social/connection-status.ts.
Read /app/[locale]/(dashboard)/layout.tsx.
Read existing /app/[locale]/(dashboard)/campaigns/ structure.

Session 7 — Campaign Builder. Builder role.

Plan limits from CLAUDE.md (enforce in Server Action):
- trial plan: max 1 campaign total (trial_state.campaigns_created_count)
- starter plan: max 2 ACTIVE campaigns simultaneously
- pro plan: unlimited campaigns
- agency plan: unlimited campaigns

Campaign status machine (ADR 0001 §B.4):
draft → active → paused → completed
Campaigns start as 'draft'. AI generation (Session 8) moves
them to 'active'. Users can pause/complete manually.

ECC workflow:
- /plan before each prompt — confirm before implementing
- /tdd for Server Actions and validation schemas
- /verify after each prompt

Frontend-design is active for all UI prompts. SŌSH aesthetic:
refined minimal, professional, purposeful. The campaign builder
is the core product interaction — it must feel like a strategy
tool, not a form.

After injected memory loads, confirm you understand the campaign
schema and plan limits. Wait for Prompt 1.
```

### Prompt 1 — Campaign validation schema and plan enforcement

```
/plan "Campaign creation validation and plan enforcement logic"

Following /tdd:

1. Create /lib/validation/campaign.ts:

   createCampaignSchema — Zod schema for campaign creation:
   {
     name: z.string().min(1).max(100),
     objective: z.string().min(10).max(2000),
     specialInstructions: z.string().max(1000).optional(),
     platforms: z.array(z.enum(['linkedin','twitter','instagram',
       'facebook','threads'])).min(1).max(5),
     frequency: z.enum(['daily','3x_week','weekly','custom']),
     postsPerWeek: z.number().int().min(1).max(21),
     startDate: z.string().refine(s => !isNaN(Date.parse(s)), 
       { message: 'Invalid date' }),
     endDate: z.string().refine(s => !isNaN(Date.parse(s)),
       { message: 'Invalid date' }).optional(),
   }
   .refine(data => {
     if (data.endDate) {
       return parseISO(data.endDate) > parseISO(data.startDate)
     }
     return true
   }, { message: 'End date must be after start date', path: ['endDate'] })

2. Create /lib/db/campaigns.ts helper (or update existing):
   
   countActiveCampaigns(client, businessId): Promise<number>
   Returns count of campaigns where status IN ('active','draft')
   and deleted_at IS NULL.
   
   Note: 'draft' campaigns count toward the Starter limit because
   they represent in-progress work the user intends to activate.

3. Create /lib/campaigns/enforcement.ts:

   checkCampaignCreationAllowed(
     client: SupabaseClient,
     business: BusinessRow,
     trialState: TrialStateRow | null
   ): Promise<{ allowed: boolean; reason?: string }>

   Logic:
   - plan === 'trial':
     if trialState?.campaigns_created_count >= 1 (config cap):
       return { allowed: false, reason: 'trial_campaign_limit' }
   - plan === 'starter':
     count = await countActiveCampaigns(client, business.id)
     if count >= 2:
       return { allowed: false, reason: 'starter_campaign_limit' }
   - plan === 'pro' | 'agency': return { allowed: true }
   - default: return { allowed: true }

   Export: CampaignEnforcementReason type union.

4. Tests in campaign.test.ts:
   - createCampaignSchema: valid input passes
   - name too short → validation error
   - platforms empty array → validation error
   - endDate before startDate → refinement error
   - checkCampaignCreationAllowed: trial at limit → blocked
   - trial under limit → allowed
   - starter at 2 active → blocked
   - starter at 1 active → allowed
   - pro plan → always allowed

/verify
```

### Prompt 2 — Campaign creation Server Action

```
/plan "Campaign creation Server Action"

Create /app/[locale]/(dashboard)/campaigns/new/actions.ts:

'use server'

export type CreateCampaignState = {
  errors?: {
    name?: string
    objective?: string
    platforms?: string
    endDate?: string
    _form?: string
    _limit?: 'trial_campaign_limit' | 'starter_campaign_limit'
  }
  success?: boolean
  campaignId?: string
}

export async function createCampaignAction(
  prevState: CreateCampaignState,
  formData: FormData
): Promise<CreateCampaignState>

Steps:
1. Parse and validate with createCampaignSchema (safeParse)
   Return field errors on failure.

2. Get authenticated user via createServerClient()

3. Get business via getBusinessByOwner()

4. Get trial state via getTrialState() — service-role
   (trial_state is service-role readable per RLS)

5. Check plan enforcement via checkCampaignCreationAllowed()
   If not allowed: return { errors: { _limit: reason } }
   Do NOT create the campaign.

6. Compute totalPostsPlanned:
   Estimate based on frequency, postsPerWeek, and date range:
   - If endDate provided: calculate weeks between dates × postsPerWeek
   - If no endDate: use postsPerWeek × 4 (4-week default estimate)

7. Create campaign via createCampaign() in /lib/db/campaigns.ts:
   status: 'draft'
   total_posts_planned: computed above
   total_posts_published: 0

8. If plan === 'trial': increment trial_state.campaigns_created_count
   via service-role (atomic UPDATE col = col + 1 pattern from Session 5)

9. Return { success: true, campaignId: newCampaign.id }

10. On success, the CLIENT-side component redirects to
    /[locale]/campaigns/{campaignId}
    (redirect() from 'next/navigation' does not work in useActionState
    — return the ID and let the client redirect)

All error message keys use next-intl keys. Add keys to all
three locale files simultaneously.

/verify
```

### Prompt 3 — Campaign creation form UI

```
/plan "Campaign creation form — the core product interaction"

This is the most important UI in SŌSH. It must feel like a
strategy tool, not an admin form. Frontend-design is active.

Create /app/[locale]/(dashboard)/campaigns/new/page.tsx
and the client form component:
/app/[locale]/(dashboard)/campaigns/new/CampaignForm.tsx

The form has three visual sections on a single page:

SECTION 1 — "What's the goal?"
- Campaign name (text input, required)
- Objective (large textarea, required — placeholder:
  "e.g. Drive signups for our winter launch, build thought
  leadership on LinkedIn, promote our new case study...")
- Special instructions (smaller textarea, optional — placeholder:
  "e.g. Mention our sale ends Dec 31, avoid competitor comparisons,
  always end with a question")

SECTION 2 — "Where and how often?"
- Platform selector: cards for each of the 5 platforms.
  Show ONLY platforms where the user has a connected account
  (is_active = true). Grey out platforms not connected with
  "Connect in Settings →" hint.
  For connected platforms where publishingAvailable = false
  (instagram/facebook/threads), show the platform card but
  add a small "Coming soon" badge — user can still select
  them to generate content even if publishing is deferred.
  Multi-select. At least one required.

- Frequency: segmented control or radio group:
  Daily (7/week) | 3× week | Weekly | Custom
  When Custom: show a number input for posts_per_week (1-21)

- Date range: start date (required, default today) + 
  end date (optional, datepicker). When both set, show:
  "Approximately {N} posts will be generated"
  computed from frequency and date range.

SECTION 3 — Summary bar (sticky bottom or side panel on desktop)
Shows live preview as user types:
- Campaign name (or "Untitled campaign")
- Selected platforms as icons
- Estimated post count
- "Create Campaign" button (disabled until required fields filled)

Form uses useActionState(createCampaignAction, initialState).
On success (state.campaignId): router.push(`/campaigns/${campaignId}`)
On _limit error: show a contextual upgrade prompt (not a hard error):
  - trial_campaign_limit: "Your trial includes 1 campaign.
    Upgrade to create more."
  - starter_campaign_limit: "Your Starter plan includes 2 active
    campaigns. Upgrade or complete an existing one."

Platform data fetched server-side in page.tsx:
GET /api/social/accounts → filter to active ones.
Passed as prop to CampaignForm client component.

Add i18n keys to all three locale files:
campaigns.new.title
campaigns.new.section1.title
campaigns.new.section2.title  
campaigns.new.fields.name
campaigns.new.fields.objective
campaigns.new.fields.objective_placeholder
campaigns.new.fields.special_instructions
campaigns.new.fields.platforms
campaigns.new.fields.frequency.daily
campaigns.new.fields.frequency.3x_week
campaigns.new.fields.frequency.weekly
campaigns.new.fields.frequency.custom
campaigns.new.fields.start_date
campaigns.new.fields.end_date
campaigns.new.fields.estimated_posts
campaigns.new.cta
campaigns.new.limit.trial
campaigns.new.limit.starter

/verify
```

### Prompt 4 — Campaign list page

```
/plan "Campaign list page with empty state"

Create /app/[locale]/(dashboard)/campaigns/page.tsx
(Server Component):

Fetches campaigns for the business via listCampaigns()
in /lib/db/campaigns.ts. Shows:

EMPTY STATE (no campaigns yet):
A welcoming empty state that explains what campaigns are.
Something like:
- Illustration or icon (simple SVG — no external images)
- "Start your first campaign" headline
- Brief explanation: "Define your content goal, choose your
  platforms, and SŌSH will generate posts tailored to your
  brand voice."
- "Create campaign" button → /campaigns/new

CAMPAIGN LIST (has campaigns):
- Page header with "Campaigns" title and "New campaign" button
- Campaign cards in a list (not grid — campaigns have text content
  that reads better in list form)

Each campaign card shows:
- Campaign name (bold)
- Objective (truncated to 2 lines)
- Status badge: draft (grey) / active (green) / paused (amber) /
  completed (muted)
- Platform icons for selected platforms
- Posts published / total posts planned (e.g. "0 / 12 posts")
- Created date
- Actions: View (primary), Pause/Resume (if active/paused),
  Delete (destructive, with confirmation)

Pause/resume and delete use Server Actions in
/app/[locale]/(dashboard)/campaigns/actions.ts:
- pauseCampaignAction(campaignId): sets status → 'paused'
- resumeCampaignAction(campaignId): sets status → 'active'
- deleteCampaignAction(campaignId): soft delete (deleted_at)
  Only allowed for draft or completed campaigns (not active).
  Active campaigns must be paused first.

All mutations verify the campaign belongs to the user's business
before applying (use anon client with RLS — never trust client-
supplied businessId).

Add i18n keys for campaign statuses and all list UI text.

/verify
```

### Prompt 5 — Campaign detail page

```
/plan "Campaign detail page with Generate Posts CTA"

Create /app/[locale]/(dashboard)/campaigns/[id]/page.tsx
(Server Component):

Fetches the campaign by ID. If not found or not owned by user:
redirect to /campaigns (RLS returns null for unowned campaigns).

The page shows two sections:

TOP — Campaign overview:
- Campaign name as page title
- Status badge
- Edit button (→ /campaigns/{id}/edit — placeholder, not built yet)
- Platform icons
- Objective (full text, not truncated)
- Special instructions (if set)
- Frequency and posts per week
- Date range

MIDDLE — Generate Posts section:
This is the key CTA. For draft campaigns (no posts generated):

  A prominent card/section:
  "Ready to generate your posts?"
  "SŌSH will create {N} platform-specific posts in your brand voice.
  You'll review and approve each one before anything is published."
  
  "Generate Posts" button → currently a placeholder that will be
  wired in Session 8. For now:
  - Button is rendered and styled
  - onClick shows a toast: "Post generation coming soon"
    OR redirect to a placeholder route /campaigns/{id}/generate
    that shows "Post generation is being built — coming in the
    next session."

For campaigns that already have posts (status !== 'draft'):
  Show a summary:
  - Posts approved / total
  - Posts published / total
  - "View Posts" button → /campaigns/{id}/posts (Session 9 route)

BOTTOM — Danger zone (collapsed by default):
- Pause campaign (if active)
- Delete campaign (if draft or completed, with confirmation)

The detail page must feel like a project dashboard, not a
data view. This is where users spend time managing their work.

/verify
```

### Prompt 6 — Update sidebar navigation

```
/plan "Update dashboard sidebar with campaigns navigation"

The sidebar currently has placeholder nav items from Session 4.
Wire up the real routes that now exist.

Update /components/layout/DashboardShell.tsx:

Active nav items (link to real routes):
- Dashboard → /[locale]/dashboard (or campaigns as the default)
- Campaigns → /[locale]/campaigns
- Settings → /[locale]/settings/accounts

Placeholder items (not yet built — show as disabled or
with a "coming soon" tooltip):
- Calendar → coming in Session 9
- Inbox → coming in Session 11
- Analytics → coming in Phase 2

For active items, highlight the current route using
usePathname() from next/navigation. Add the appropriate
'use client' boundary.

Also update the dashboard root redirect:
/app/[locale]/(dashboard)/page.tsx should redirect to
/[locale]/campaigns (campaigns list is the home screen).

/verify
```

### Prompt 7 — Build and verify

```
Run:
1. npx tsc --noEmit
2. npx vitest run lib/validation lib/campaigns lib/db
3. npm run build

If all pass, run npm run dev.

Manual smoke test:
- /campaigns shows empty state for a fresh account
- /campaigns/new loads the campaign creation form
- Platform cards show only connected platforms (should show
  LinkedIn and/or X if connected in Session 6)
- Fill in all required fields and create a campaign
- Redirects to /campaigns/{id} detail page
- Back on /campaigns list: campaign appears as 'draft'
- Campaign detail shows "Generate Posts" button
- Delete the campaign — confirm it disappears from list

For plan enforcement test (trial):
In Supabase SQL Editor:
  UPDATE trial_state 
  SET campaigns_created_count = 1 
  WHERE business_id = '<your-test-id>';
Try to create another campaign → should show trial limit message
not create the campaign.

/learn-eval
/save-session
```

`/exit` Claude Code.

---

## Part B — Reviewer Session (Opus 4.7)

### Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0001-database-schema.md (campaigns table).
Read:
  lib/validation/campaign.ts
  lib/campaigns/enforcement.ts
  lib/db/campaigns.ts
  app/[locale]/(dashboard)/campaigns/new/actions.ts
  app/[locale]/(dashboard)/campaigns/new/page.tsx
  app/[locale]/(dashboard)/campaigns/new/CampaignForm.tsx
  app/[locale]/(dashboard)/campaigns/page.tsx
  app/[locale]/(dashboard)/campaigns/actions.ts
  app/[locale]/(dashboard)/campaigns/[id]/page.tsx
  i18n/en/common.json, i18n/pt/common.json, i18n/es/common.json

Session 7 Part B — Campaign Builder Review.

Run security-reviewer and typescript-reviewer in parallel.
Independent review. Do not modify files.
Acknowledge when ready.
```

### Reviewer Prompt

```
Run security-reviewer and typescript-reviewer in parallel.
Synthesize one structured report.

SECTION A — AUTHORIZATION AND MULTI-TENANT ISOLATION

A1. Campaign creation ownership:
- createCampaignAction derives businessId from session,
  NOT from form data or URL params?
- Could a user create a campaign for another user's business?

A2. Campaign mutations (pause/resume/delete):
- pauseCampaignAction, resumeCampaignAction, deleteCampaignAction
  verify campaign belongs to the authenticated user's business?
- Use anon client with RLS (not service-role) for ownership check?
- What happens if a user passes another user's campaignId?
  Should return null via RLS → graceful 404 or redirect.

A3. Campaign detail page:
- If campaign not found (unowned or deleted): redirects cleanly?
- No error exposed to client about whether campaign exists vs 
  belongs to another user?

A4. Platform selection trust:
- Platforms submitted in form are validated against Zod schema?
- A user cannot select a platform they haven't connected by
  manipulating form data (even if UI hides unconnected platforms)?
  Note: the schema validates platform names but not ownership —
  is there a check that the selected platforms are actually
  connected for this business?

SECTION B — PLAN ENFORCEMENT

B1. Trial cap check is BEFORE database write?
B2. Starter cap check is BEFORE database write?
B3. campaigns_created_count increment uses atomic UPDATE
   (col = col + 1), not read-then-write?
B4. checkCampaignCreationAllowed uses service-role client
   to read trial_state (per RLS: service-role only for writes,
   authenticated can read — verify which client is used)?
B5. Could a user bypass the cap by sending concurrent requests?
   (Flag as ⚠️ — acceptable Phase 1 risk, not a blocker)

SECTION C — DATA INTEGRITY

C1. All Server Actions use Zod validation before any DB call?
C2. createCampaignAction returns campaignId in state
   (not redirecting from Server Action)?
C3. startDate / endDate stored as date strings matching
   the DB column type (date, not timestamptz)?
C4. totalPostsPlanned computation: are the inputs validated
   before arithmetic (no NaN, no negative values)?
C5. Soft delete on campaigns: deleted_at set, not hard DELETE?
C6. Campaigns can only be deleted when draft or completed
   (not active)? Verified server-side, not just client-side?

SECTION D — CODE QUALITY

D1. No any types?
D2. All i18n keys present in en/pt/es simultaneously?
D3. Server Actions marked 'use server'?
D4. Direct Supabase calls outside lib/db/? 
    (Search for .from() and .rpc() outside lib/)
D5. process.env outside lib/config.ts?
D6. formatISO used for date formatting?
D7. Zod schema handles edge cases: empty platforms array,
    postsPerWeek = 0, endDate = startDate (same day)?

SECTION E — UX CORRECTNESS

E1. Platform cards only show connected platforms
    (server-side fetched, not client-trust)?
E2. Coming-soon platforms (instagram/facebook/threads)
    can be selected for content generation even though
    publishing is deferred?
E3. Generate Posts button exists on detail page
    (even as placeholder)?
E4. Empty state renders when no campaigns?
E5. Trial/Starter limit messages are helpful (explain
    what to do, not just "limit reached")?

Report format: markdown table
(Section / Check / Status ✅❌⚠️ / File:Line / Fix)
After table: every ❌ with exact fix instructions.
After that: every ⚠️ with recommendations.

Verdict:
- Blockers before Session 8
- Blockers before first user
- Acceptable to defer
```

### After Part B

```
git add .
git commit -m "Session 7B: Review complete"
git push
```

Paste full report to Claude.ai. Correction pass (7C) if needed.

---

## Part C — Correction Pass (only if reviewer finds issues)

Fresh Sonnet session. Fix listed issues only. Verify. Commit.

```
git add .
git commit -m "Session 7C: Corrections applied, Session 7 complete"
git push
```

---

## Report Back to Claude.ai

```
Session 7 complete.

Manual smoke test:
- Empty state rendered: [yes/no]
- Campaign creation form loads: [yes/no]
- Platform cards show connected platforms only: [yes/no]
- Campaign created successfully: [yes/no]
- Campaign appears in list as draft: [yes/no]
- Campaign detail shows Generate Posts CTA: [yes/no]
- Trial cap enforcement tested: [yes/no — what happened?]

Build:
- tsc clean: [yes/no]
- vitest pass: [yes/no — test count]
- npm run build: [yes/no]

Reviewer report: [paste full report]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas in Session 7

**Platform selection trust** — the UI only shows connected
platforms, but a user could manipulate form data to submit
unconnected platforms. The reviewer checks for this. If not
caught here it will surface in Session 8 when the AI tries
to generate posts for a platform with no connected account.

**useActionState and redirect** — Server Actions using
useActionState cannot call redirect() — it throws. The pattern
is to return { success: true, campaignId } and redirect
client-side with router.push(). This is easy to get wrong.

**Draft vs active for plan limits** — the enforcement counts
draft AND active campaigns toward the Starter limit. This
prevents users from creating 10 draft campaigns. The reviewer
checks this logic specifically.

**endDate edge cases** — the Zod schema refinement for
endDate > startDate must handle the case where they're the
same day (should fail — a campaign needs at least a 1-day
range). Also handle missing endDate gracefully in
totalPostsPlanned computation.

**i18n date formatting** — date inputs in HTML return
ISO strings (YYYY-MM-DD). The DB campaigns.start_date and
end_date columns are type 'date'. Store the ISO date string
directly — no conversion needed. Don't use formatISO() on
dates that are already ISO strings; formatISO() is for
converting Date objects.
