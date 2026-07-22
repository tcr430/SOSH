# Session 9 — Post Review & Approval Queue

> **Goal:** The human-in-the-loop core of SŌSH. Users see every AI-generated post, edit content inline, regenerate individual posts with a feedback note, approve or skip each one, and bulk-approve the whole queue. No post is ever published without human sign-off. When all posts are approved the campaign is ready for Session 10 (publisher).
> **Time:** 4–6 hours including correction pass
> **Models:** Builder (Sonnet 4.6) → Reviewer (Opus 4.7)
> **Plugins:** ECC throughout, claude-mem automatic, frontend-design skill active for UI prompts
> **Session structure:** Single builder session + reviewer. No architect needed — the regeneration contract is fully specified in ADR 0004 §12 and the post status machine is in ADR 0001. No schema migrations required.

---

## Why no Architect session

The schema is complete (ADR 0001 — posts status machine covers `draft → approved → skipped`). The regeneration contract is locked in ADR 0004 §12 with exact TypeScript interfaces. The product design decisions — approve/skip/edit/bulk/regenerate — are straightforward human-in-the-loop patterns with no novel architectural risk. Single builder + reviewer is the right structure.

---

## What this session builds and what it doesn't

**Builds:**
- `lib/db/posts.ts` additions: post review helpers (`approvePost`, `skipPost`, `unapprovePost`, `unskipPost`, `updatePostContent`, `bulkApproveDraftPosts`, `getPostSiblingTopics`)
- `lib/ai/prompts/post-regeneration.ts` — full prompt implementation from ADR 0004 §12 contract
- `lib/ai/__fixtures__/post-regeneration/*.json` — mock fixtures (one per platform)
- `app/[locale]/(dashboard)/campaigns/[id]/posts/` route — page, actions, client components
- Server Actions: approve/skip/undo/edit/bulk-approve/regenerate
- i18n keys in `posts.*` namespace (EN/PT/ES)

**Defers to Session 10:**
- Publishing worker (approved → scheduled → published)
- `regenerateAllPosts` for an entire campaign (too expensive for Phase 1 UI)
- Post soft-delete from the review queue
- Pagination for very large post lists (> 50 posts — cap at 50 for now)

---

## Pre-session checklist

- [ ] Session 8 fully complete — all correction passes done (8D)
- [ ] At least one campaign in `active` status with `draft` posts generated
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vitest run lib/campaigns lib/ai lib/db` passes (all 231 tests)
- [ ] claude-mem running at http://localhost:37777
- [ ] ADR 0004 §12 open in a side tab — it is the contract for regeneration

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

Read CLAUDE.md, /docs/current-phase.md, AGENTS.md.
Read /docs/decisions/0001-database-schema.md §B.5 (posts table,
status machine, indexes).
Read /docs/decisions/0004-post-generation.md §12 (regeneration
contract — your exact TypeScript interface for this session).
Read /lib/db/posts.ts, /lib/db/campaigns.ts, /lib/db/trial-state.ts,
/lib/db/types.ts.
Read /lib/ai/index.ts, /lib/ai/runner.ts, /lib/ai/context.ts.
Read /lib/ai/prompts/post-generation.ts (pattern to follow for
the regeneration prompt).
Read /app/[locale]/(dashboard)/campaigns/[id]/page.tsx and
CampaignDetailActions.tsx (existing detail page — your page links from here).

Session 9 — Post Review & Approval Queue. Builder role.

ECC workflow:
- /plan before each prompt
- /tdd for all logic (DB helpers, Server Actions, prompt)
- /verify after each prompt

CLAUDE.md constraints (non-negotiable):
- All Claude SDK calls only through /lib/ai/runner.ts
- Service-role via lazy import only
- /lib/db/ only — never direct Supabase in components or actions
- formatISO from date-fns for all timestamp writes
- No process.env outside /lib/config.ts
- No console.* in committed code
- No `any` types — use `unknown` and narrow

Post status machine (ADR 0001 §B.5):
  draft → approved (user approves)
  draft → skipped  (user skips, rejection_note required)
  approved → draft (undo approve)
  skipped → draft  (undo skip)
All transitions use atomic conditional UPDATE with WHERE status = '<current>'
to prevent race conditions (CLAUDE.md atomic state transitions rule).

No schema migration is needed for this session. All required
columns and states exist.

Confirm you've read the ADR 0004 §12 regeneration contract,
list the files you'll create/modify. Wait for Prompt 1.
```

---

### Prompt B1 — DB helpers for post review

```
/plan "Post review DB helpers"

Add to /lib/db/posts.ts the following typed functions.
All use the authenticated anon client passed by the caller
(RLS scopes to owner automatically).
All state transitions use atomic conditional UPDATE
per CLAUDE.md (eq('status', '<expected>') on every transition).

1. approvePost(client, postId: string): Promise<PostRow>
   UPDATE posts SET status='approved'
   WHERE id=postId AND status='draft' AND deleted_at IS NULL
   Returns the updated row. Throws if no row matched (already
   transitioned or not owned by user — RLS handles the latter).

2. unapprovePost(client, postId: string): Promise<PostRow>
   UPDATE posts SET status='draft'
   WHERE id=postId AND status='approved' AND deleted_at IS NULL

3. skipPost(
     client,
     postId: string,
     rejectionNote: string,
   ): Promise<PostRow>
   UPDATE posts SET status='skipped', rejection_note=rejectionNote
   WHERE id=postId AND status='draft' AND deleted_at IS NULL
   rejectionNote is required (enforce in calling Server Action via Zod,
   min 3 chars — a short note is enough for skipping, unlike the
   min-5-char regeneration feedback).

4. unskipPost(client, postId: string): Promise<PostRow>
   UPDATE posts SET status='draft', rejection_note=NULL
   WHERE id=postId AND status='skipped' AND deleted_at IS NULL

5. updatePostContent(
     client,
     postId: string,
     patch: { content: string; hashtags: string[] },
   ): Promise<PostRow>
   UPDATE posts SET content=patch.content, hashtags=patch.hashtags
   WHERE id=postId AND deleted_at IS NULL
   AND status IN ('draft', 'approved')
   (Cannot edit skipped or published posts.)

6. bulkApproveDraftPosts(
     client,
     campaignId: string,
   ): Promise<number>
   UPDATE posts SET status='approved'
   WHERE campaign_id=campaignId AND status='draft'
   AND deleted_at IS NULL
   Returns the count of rows updated.
   RLS scopes this to the owner — no extra business_id check needed
   since RLS already guards it.

7. getPostSiblingTopics(
     client,
     campaignId: string,
     excludePostId: string,
   ): Promise<string[]>
   SELECT ai_generation_metadata->>'rationale' AS topic
   FROM posts
   WHERE campaign_id=campaignId
   AND id != excludePostId
   AND deleted_at IS NULL
   LIMIT 20
   Returns array of rationale strings (may be empty if metadata
   is absent). Used to build siblingPostsTopics for regeneration.
   Filter out null/empty strings before returning.

Add TypeScript types where missing. Use the existing
PostRow and PostUpdate patterns from /lib/db/types.ts.

Follow /tdd: write tests for each helper in
/lib/db/posts.test.ts (mock Supabase client — same pattern
as existing tests in this file).

/verify
```

---

### Prompt B2 — Post regeneration prompt

```
/plan "Post regeneration AI prompt"

Implement the regeneration prompt from ADR 0004 §12.
This is a contract — match the interfaces exactly.

Create /lib/ai/prompts/post-regeneration.ts:

  export const postRegenerationPrompt: Prompt<
    PostRegenerationInput,
    PostRegenerationOutput
  >

  - id: 'post-regeneration'
  - version: 1
  - modelKey: 'SONNET_4_6'

  PostRegenerationInput (from ADR §12):
    postId: string
    previousContent: string
    previousRationale: string
    previousHashtags: string[]
    feedbackNote: string             // min 5 chars enforced at Server Action
    campaign: Pick<CampaignRow,
      'id' | 'name' | 'objective' | 'special_instructions'>
    targetPlatform: Platform
    scheduledAt: string
    siblingPostsTopics: string[]

  PostRegenerationOutputSchema: z.object({
    content: z.string().min(1),
    hashtags: z.array(z.string()).max(30),
    rationale: z.string().min(10).max(280),
  })

  buildSystemPrompt(context: CustomerContext): string
  Must include:
  - Business and brand voice context (same opening as post-generation)
  - Instruction to produce exactly one post for targetPlatform
  - Platform character limits and hashtag rules (import
    PLATFORM_CONSTRAINTS from post-generation prompt or config)
  - Explicit instruction: "Do not repeat the previous content
    or its main angle. The user's feedback tells you what to change."
  - Output: raw JSON object only (no markdown fences)

  buildUserMessage(input: PostRegenerationInput): string
  Must include:
  - Campaign name, objective, special_instructions
  - targetPlatform
  - scheduledAt (displayed as context, not instruction)
  - previousContent (labeled "Previous post — do NOT repeat this")
  - previousRationale (labeled "Why the AI chose this angle")
  - previousHashtags (labeled "Previous hashtags — vary these")
  - feedbackNote (labeled "User's feedback — address this:")
  - siblingPostsTopics (labeled "Other posts in this campaign —
    don't repeat these topics:", capped at last 10 entries)

Counter note (from ADR §12):
  Regeneration DOES consume posts_generated_count. The runner's
  step 8 increment fires normally (prompt.id is 'post-regeneration',
  not 'post-generation', so R-1 does NOT apply — the skip is
  for 'post-generation' only). Do NOT add any special skip logic.

Create fixture files:
  /lib/ai/__fixtures__/post-regeneration/linkedin.json
  /lib/ai/__fixtures__/post-regeneration/twitter.json
  (Two fixtures are enough — pattern is the same across platforms)

Fixture shape:
  {
    "content": "...",
    "hashtags": ["...", "..."],
    "rationale": "..."
  }

Write tests in /lib/ai/prompts/post-regeneration.test.ts:
  - id/version/modelKey are stable (snapshot)
  - outputSchema.parse(linkedinFixture) succeeds
  - buildSystemPrompt contains 'post-regeneration' marker string
  - buildUserMessage contains feedbackNote text from input
  - buildUserMessage contains previousContent labeled correctly

/verify
```

---

### Prompt B3 — Server Actions

```
/plan "Post review Server Actions"

Create /app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts

All actions follow this pattern:
1. Authenticate (createServerClient → getUser → if !user redirect)
2. Validate input via Zod (UUID for IDs, min-length for strings)
3. Call /lib/db/ function with anon client (RLS scopes to owner)
4. Revalidate path on success
5. Return { success: boolean; error?: string } — never throw from
   Server Actions called by Client Components

Actions to implement:

approvePostAction(postId: string):
  Zod: z.string().uuid()
  DB: approvePost(client, postId)
  Revalidate: /[locale]/campaigns/[campaignId]/posts
  (read campaignId from the post row returned by approvePost)

unapprovePostAction(postId: string):
  Same pattern, calls unapprovePost.

skipPostAction(postId: string, rejectionNote: string):
  Zod: postId uuid, rejectionNote z.string().min(3).max(500)
  DB: skipPost(client, postId, rejectionNote)

unskipPostAction(postId: string):
  Zod: postId uuid
  DB: unskipPost(client, postId)

updatePostContentAction(
  postId: string,
  content: string,
  hashtags: string[],
):
  Zod: postId uuid, content z.string().min(1).max(5000),
       hashtags z.array(z.string().max(100)).max(30)
  DB: updatePostContent(client, postId, { content, hashtags })

bulkApprovePostsAction(campaignId: string):
  Zod: z.string().uuid()
  DB: bulkApproveDraftPosts(client, campaignId)
  Returns count: number in success payload

regeneratePostAction(postId: string, feedbackNote: string):
  This is the most complex action. Steps:
  1. Auth + validate (postId uuid, feedbackNote z.string().min(5).max(1000))
  2. Load the post via getPostById(client, postId) — if null or
     status !== 'draft': return { success: false, error: 'not_eligible' }
  3. Load the campaign via getCampaignById(client, post.campaign_id)
  4. Load sibling topics via getPostSiblingTopics(client, campaignId, postId)
  5. buildCustomerContext(businessId) for the AI call
  6. Pre-flight trial check: if trialState exists and
     trialState.postsRemaining < 1:
     return { success: false, error: 'quota_exceeded' }
  7. Build PostRegenerationInput from the post's ai_generation_metadata:
     - previousContent: post.content
     - previousRationale: post.ai_generation_metadata.rationale ?? ''
     - previousHashtags: post.hashtags
     - feedbackNote
     - campaign: { id, name, objective, special_instructions }
     - targetPlatform: post.platform as Platform
     - scheduledAt: post.scheduled_at
     - siblingPostsTopics (from step 4)
  8. runPrompt(postRegenerationPrompt, ctx, input) — may throw AiError
  9. On AI error: map AiErrorCode to user-facing string, return error
  10. Build updated ai_generation_metadata:
      - regenerationCount: (metadata.regenerationCount ?? 0) + 1
      - previousVersions: cap at 5 entries, prepend
        { content: previousContent, rejectionNote: feedbackNote,
          regeneratedAt: formatISO(new Date()) }
      - rationale: output.rationale
      - Keep all other metadata fields unchanged (promptId etc.)
  11. updatePostContent(client, postId, {
        content: output.content,
        hashtags: output.hashtags,
      })
      then update ai_generation_metadata separately via a direct
      patch (add updatePostMetadata helper to /lib/db/posts.ts
      if needed — or combine in a single update if posts.ts supports it)
  12. Revalidate path
  13. Return { success: true }

Error mapping for regeneratePostAction (same as generate):
  quota_exceeded → i18n key posts.regenerate.error.quota_exceeded
  rate_limited   → posts.regenerate.error.rate_limited
  provider_error → posts.regenerate.error.provider_error
  invalid_response → posts.regenerate.error.invalid_response
  timeout        → posts.regenerate.error.timeout
  generic        → posts.regenerate.error.generic

Write tests for regeneratePostAction in a .test.ts file
alongside the actions file:
  - returns error when post status !== 'draft'
  - returns error when trial quota exhausted
  - returns success when runPrompt succeeds (mock runPrompt)
  - previousVersions capped at 5

/verify
```

---

### Prompt B4 — Posts page (Server Component)

```
/plan "Posts review page — Server Component"

Activate the frontend-design skill mindset:
AESTHETIC DIRECTION: Editorial / workspace. Think of a magazine
art director's desk — structured, confident, information-dense
without feeling cluttered. Cards have clear hierarchy. Status
is communicated through subtle color, not heavy badges.
Platform identity shows through icon + platform-accent color.
The overall palette stays dark/neutral; the approved state
uses a restrained emerald tick, not a garish green block.

Create /app/[locale]/(dashboard)/campaigns/[id]/posts/page.tsx
(Server Component):

1. Auth check: getUser() → redirect to /login if none
2. Fetch campaign: getCampaignById(client, id)
   If null/not owned: redirect to /campaigns
3. Fetch posts: listPostsByCampaign(client, id, {
     limit: 50,
     orderBy: 'scheduled_at',
     includeDeleted: false
   })
   (confirm listPostsByCampaign supports these params; if not,
   call the list function with explicit order and limit — never
   unbounded queries per CLAUDE.md)
4. Compute summary counts:
   total = posts.length
   approved = posts.filter(p => p.status === 'approved').length
   draft = posts.filter(p => p.status === 'draft').length
   skipped = posts.filter(p => p.status === 'skipped').length

5. Render:
   - Back link → /campaigns/{id} ("← {campaignName}")
   - Page title: t('posts.title') — "{campaignName} — Posts"
   - Summary bar: "{approved}/{total} approved · {draft} drafts · {skipped} skipped"
   - If draft === 0 and approved > 0: render a "Ready to publish"
     banner (distinct visual treatment — emerald border, icon)
     "All posts approved. Publishing setup is coming soon."
   - Pass posts + campaign to <PostsClient> Client Component

6. Empty state:
   If posts.length === 0:
   Centered empty state: icon + "No posts yet"
   "Generate posts from the campaign page first."
   Button → /campaigns/{id}

Use next-intl useTranslations('posts') — all strings through i18n.

/verify
```

---

### Prompt B5 — PostsClient, PostCard, RegenerateDialog

```
/plan "Interactive post review components"

This is the heart of Session 9. Build with care.
Frontend-design skill: editorial/workspace aesthetic throughout.
Use shadcn/ui primitives. Animations via Tailwind transitions
(not framer-motion — no new deps).

Create these Client Components:

─────────────────────────────────────────────────────────────
FILE: PostsClient.tsx
─────────────────────────────────────────────────────────────
'use client'

Props:
  posts: PostRow[]
  campaign: CampaignRow
  locale: string

State:
  - activeFilter: 'all' | Platform | 'approved' | 'skipped'
  - localPosts: PostRow[] (starts from props.posts — optimistic updates applied here)

Layout:
  TOP — sticky filter bar:
    - Filter tabs: "All ({total})" | per platform (show only
      platforms that have posts) | "Approved ({n})" | "Skipped ({n})"
    - Tabs use shadcn Tabs or simple button row styled as pills
    - Right side: "Approve all drafts" button — visible only when
      draft > 0. Calls bulkApprovePostsAction optimistically
      (set all draft posts to approved locally before action
      resolves; revert all on error).

  MAIN — filtered post list:
    <PostCard> for each filtered post, sorted by scheduled_at ascending.
    Post cards separated by date dividers when the date changes
    (e.g. "Tuesday, 27 May" as a subtle divider between groups).

─────────────────────────────────────────────────────────────
FILE: PostCard.tsx
─────────────────────────────────────────────────────────────
'use client'

Props:
  post: PostRow
  onOptimisticUpdate: (postId: string, patch: Partial<PostRow>) => void

Visual design (editorial aesthetic):
  - Left edge: 3px vertical bar in platform accent color
    (linkedin=#0A66C2, twitter/x=#000000, instagram=#E1306C,
    facebook=#1877F2, threads=#000000)
  - Platform icon (lucide-react or inline SVG) + platform name
  - Scheduled date/time (formatted: "Tue 27 May · 09:00") in
    muted text — use date-fns format, convert from UTC to display
    (Note: display in UTC for Phase 1; timezone localisation
    is Phase 2 — add a small "UTC" label)
  - Status indicator: small pill — draft (slate), approved (emerald),
    skipped (amber)
  - Content text: full content (no truncation — users must see
    what they're approving). Max-height with overflow-y-auto
    if content > 300 chars, or expand/collapse toggle.
  - Hashtag pills below content: each hashtag as a small chip
    (muted background, monospace or small text)
  - Regeneration count badge: if ai_generation_metadata.regenerationCount > 0,
    show "Regenerated ×{count}" in small muted text

  Action buttons (conditional by status):

  STATUS = 'draft':
    Row of buttons:
    [✓ Approve]     — primary, green tint
    [✗ Skip]        — ghost/destructive
    [✎ Edit]        — ghost
    [↻ Regenerate]  — ghost with spinner when loading

  STATUS = 'approved':
    [↩ Undo]        — ghost/muted (returns to draft)
    [✎ Edit]        — ghost

  STATUS = 'skipped':
    [↩ Undo]        — ghost/muted (returns to draft)
    [Reason: "{first 40 chars of rejection_note}"] — displayed inline

  Edit mode (inline, toggled by Edit button):
    - Textarea replaces content display (auto-resizes, min 4 rows)
    - Editable hashtag list: comma-separated input OR tag pills
      with × to remove (simple comma-split input is fine)
    - [Save] [Cancel] buttons
    - Save calls updatePostContentAction, optimistic update applied
    - Textarea and hashtag input must have aria-labels

  Approve/Skip/Undo: optimistic update via onOptimisticUpdate before
  action resolves. Revert on error, show toast (use shadcn toast or
  a simple inline error text on the card).

─────────────────────────────────────────────────────────────
FILE: RegenerateDialog.tsx
─────────────────────────────────────────────────────────────
'use client'

Triggered by "↻ Regenerate" button in PostCard.

Uses shadcn AlertDialog or Dialog primitive.

Content:
  - Title: t('posts.regenerate.title') — "Regenerate this post"
  - Body: t('posts.regenerate.description') —
    "Tell the AI what to change. Be specific — this uses one
    post credit."
  - Textarea for feedbackNote (required, min 5 chars)
    placeholder: t('posts.regenerate.placeholder') —
    "e.g. Make it shorter and more direct. Less jargon."
  - Character count hint: "minimum 5 characters"
  - [Cancel] [Regenerate →] buttons
  - Loading state on Regenerate button while action is in-flight
  - On success: dialog closes, parent gets optimistic update
    (the card shows new content immediately)
  - On error: show error string inside dialog (don't close)

After the dialog calls regeneratePostAction successfully:
  call onOptimisticUpdate with the new content from the
  action return value (add content + hashtags to the return
  payload of regeneratePostAction).

/verify
```

---

### Prompt B6 — i18n and final verify

```
/plan "i18n keys for posts review — all three locales"

Create i18n/en/posts.json, i18n/pt/posts.json, i18n/es/posts.json
with these keys (all three simultaneously — never skip a locale):

{
  "title": "{campaignName} — Posts",
  "back": "Back to campaign",
  "summary": {
    "approved": "{count} approved",
    "drafts": "{count} drafts",
    "skipped": "{count} skipped",
    "of": "of {total}"
  },
  "readyBanner": {
    "title": "All posts approved",
    "description": "Publishing setup is coming soon."
  },
  "empty": {
    "title": "No posts yet",
    "description": "Generate posts from the campaign page first.",
    "action": "Back to campaign"
  },
  "filter": {
    "all": "All ({count})",
    "approved": "Approved ({count})",
    "skipped": "Skipped ({count})"
  },
  "bulkApprove": "Approve all drafts",
  "bulkApproveSuccess": "Approved {count} posts",
  "card": {
    "utcNote": "UTC",
    "regeneratedCount": "Regenerated ×{count}",
    "status": {
      "draft": "Draft",
      "approved": "Approved",
      "skipped": "Skipped"
    },
    "actions": {
      "approve": "Approve",
      "skip": "Skip",
      "undo": "Undo",
      "edit": "Edit",
      "regenerate": "Regenerate",
      "save": "Save",
      "cancel": "Cancel"
    },
    "edit": {
      "contentLabel": "Post content",
      "hashtagsLabel": "Hashtags (comma-separated)"
    }
  },
  "skip": {
    "label": "Reason to skip",
    "placeholder": "Why are you skipping this post?",
    "submit": "Skip post"
  },
  "regenerate": {
    "title": "Regenerate this post",
    "description": "Tell the AI what to change. Be specific — this uses one post credit.",
    "placeholder": "e.g. Make it shorter and more direct. Less jargon.",
    "minChars": "Minimum 5 characters",
    "submit": "Regenerate",
    "submitting": "Regenerating…",
    "success": "Post regenerated",
    "error": {
      "quota_exceeded": "You've used all your post credits for this trial.",
      "rate_limited": "Too many requests. Wait a moment and try again.",
      "provider_error": "AI provider error. Try again in a moment.",
      "invalid_response": "The AI returned an unexpected response. Try again.",
      "timeout": "The AI took too long. Try again.",
      "not_eligible": "This post can't be regenerated in its current state.",
      "generic": "Something went wrong. Please try again."
    }
  }
}

Provide accurate Portuguese and Spanish translations (not
placeholder strings — write real translations for each key).

Then run final verification:
  npx tsc --noEmit --skipLibCheck
  npx vitest run lib/db lib/ai lib/campaigns app/\[locale\]/\(dashboard\)/campaigns

If tests fail or tsc errors appear: fix before stopping.
Report the final counts.

/verify
```

---

### After Part A

```
git add .
git commit -m "Session 9A: Posts review UI complete"
git push
```

Then run a manual smoke test:
1. Navigate to `/campaigns/{id}/posts` for a campaign with generated posts
2. Approve one post — confirm status badge updates and card style changes
3. Skip one post with a note — confirm rejection_note stored
4. Undo the skip — confirm post back to draft
5. Edit a post — change content and hashtags, save, confirm persisted
6. Regenerate a post with a feedback note — confirm new content appears
7. Bulk approve remaining drafts — confirm count updates
8. Confirm "All posts approved" banner appears when all approved

---

## Part B — Reviewer Session (Opus 4.7)

### How to run

1. `/exit` from builder session
2. `claude` in a fresh terminal
3. `/model` → **Claude Opus 4.7**
4. Paste Reviewer Primer
5. Paste Reviewer Prompt

### Reviewer Primer

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md,
/docs/decisions/0001-database-schema.md §B.5 (posts status machine),
/docs/decisions/0004-post-generation.md §12 (regeneration contract).

Read all Session 9A output:
  /lib/db/posts.ts (all new helpers)
  /lib/ai/prompts/post-regeneration.ts
  /app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts
  /app/[locale]/(dashboard)/campaigns/[id]/posts/page.tsx
  /app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx
  /app/[locale]/(dashboard)/campaigns/[id]/posts/PostCard.tsx
  /app/[locale]/(dashboard)/campaigns/[id]/posts/RegenerateDialog.tsx
  All test files for the above.
  All three locale posts.json files.

Session 9 Part B — Reviewer. Use security-reviewer +
typescript-reviewer agents in parallel.

You are auditing the human-in-the-loop core of SŌSH.
The stakes: a bug here could approve wrong content,
expose another tenant's posts, bypass the trial cap,
or inject prompt content into the AI.

Report format: markdown table (Section / Check / Status ✅❌⚠️ / File:Line / Fix)
After table: every ❌ with exact fix instructions.
After that: every ⚠️ with recommendations.
Verdict: blockers before Session 10 / blockers before first user / acceptable to defer.

Acknowledge and list your planned checks. Then run them.
```

### Reviewer Prompt

```
Audit Session 9A against these checks:

SECTION A — AUTHORIZATION & OWNERSHIP

A1. Every Server Action authenticates via getUser() before any DB call?
    - approvePostAction, skipPostAction, unapprovePostAction, unskipPostAction,
      updatePostContentAction, bulkApprovePostsAction, regeneratePostAction
    - All use anon client (not service-role) for the DB calls so RLS applies?

A2. RLS is the ownership gate for single-post actions:
    - No manual businessId check inside the action for approve/skip/undo/edit?
      (RLS handles this — the post won't be found if not owned)
    - bulkApprovePostsAction uses anon client (not service-role)?
      A service-role bulk approve would bypass RLS and could approve
      ANY business's posts.

A3. regeneratePostAction verifies post status === 'draft' before calling AI?
    - A user could call this action on an already-approved or skipped post.
    - Verify the check exists BEFORE the runPrompt call.

A4. regeneratePostAction uses the authenticated user's businessId (from getUser
    → getBusinessByOwner), not from the post row or any client-supplied param,
    for the trial pre-flight check and buildCustomerContext call?

A5. UUID validation on all postId and campaignId params (z.string().uuid())?
    Raw string params without UUID validation are an injection vector.

SECTION B — TRIAL CAP & AI COST

B1. regeneratePostAction checks postsRemaining >= 1 before calling runPrompt?
    - If check is missing: unlimited free regeneration bypasses trial cap.

B2. The runner's step-8 trial counter fires for 'post-regeneration' (R-1
    exception covers only 'post-generation')?
    - Verify by reading runner.ts: the conditional skip is
      `if (prompt.id === 'post-generation')` — regeneration must NOT be skipped.

B3. No rate-limit bypass: regeneratePostAction does not suppress or swallow
    the rate_limited AiError? It must surface it to the user.

B4. previousVersions is capped at 5 entries before writing (ADR §12)?
    An uncapped array grows the ai_generation_metadata jsonb unboundedly.

SECTION C — PROMPT INJECTION & CONTENT SAFETY

C1. feedbackNote (user-supplied) goes into buildUserMessage (not buildSystemPrompt)?
    A user who injects system-prompt instructions via feedbackNote must not
    be able to override the prompt's platform constraints or brand voice rules.

C2. previousContent and previousRationale sourced from the DB (post row),
    not from any client-supplied parameter?
    The action must read these from the post row fetched server-side.

C3. campaign.objective and campaign.special_instructions — user-controlled
    fields — go into buildUserMessage, not buildSystemPrompt?
    (Same check as Session 8C §B1.)

C4. siblingPostsTopics sourced from DB rationale strings (not from
    user-supplied content or form data)?

SECTION D — DATA INTEGRITY

D1. All status transitions use atomic conditional UPDATE
    (eq('status', '<expected>') on the WHERE clause)?
    Check: approvePost, skipPost, unapprovePost, unskipPost.
    A missing guard allows a concurrent request to double-transition a post.

D2. updatePostContent is restricted to posts in 'draft' or 'approved' status?
    A skipped or published post must not be editable via this action.

D3. After regeneration, ai_generation_metadata is updated atomically with
    the content update (both in the same DB operation or immediately
    sequential with no possible partial state)?

D4. bulkApprovePostsAction does NOT touch posts in 'skipped', 'approved',
    'scheduled', or 'published' states — only 'draft'?
    Verify the WHERE clause includes `AND status = 'draft'`.

D5. rejection_note set to NULL when unskipping a post
    (clean state for re-use)?

SECTION E — UI & CODE QUALITY

E1. No `any` types in any Session 9A TypeScript files?

E2. All user-facing strings go through i18n (no hardcoded English)?
    Spot-check PostCard.tsx, RegenerateDialog.tsx for any raw string literals.

E3. All three locale files (en, pt, es) contain identical key sets?
    A missing key in pt or es will throw at runtime.

E4. PostCard optimistic update reverts on Server Action error?
    If approve/skip fails, the card must return to its previous state —
    not silently stay in the wrong state.

E5. Unbounded list query guard: listPostsByCampaign called with limit: 50?

E6. Regenerate button disabled while in-flight (no double-submit)?

E7. formatISO used for all timestamp writes (not .toISOString() directly)?
    Specifically: previousVersions[].regeneratedAt in regeneratePostAction.

E8. Service-role is NOT used in any Client Component or Server Action for
    post read/write (only the AI layer uses it, via runner.ts)?

Report format: markdown table + fix instructions + verdict.
```

---

### After Part B

```
git add .
git commit -m "Session 9B: Reviewer audit complete"
git push
```

Paste full reviewer report into Claude.ai.
If blockers found → correction pass (9C) before moving to Session 10.

---

## Part C — Correction Pass (only if reviewer finds blockers)

Fresh Sonnet 4.6 session. Fix every ❌ item. Do not change
anything the reviewer marked ✅ or deferred as ⚠️.

```
/resume-session

Read CLAUDE.md, /docs/current-phase.md.
Read the Session 9B reviewer report (provided below).
Fix all ❌ blockers. List what you'll change before touching any file.

[paste reviewer report here]

Fix only the listed ❌ items. After each fix run:
  npx tsc --noEmit --skipLibCheck
  npx vitest run lib/db lib/ai app/\[locale\]/\(dashboard\)/campaigns

Report: which fixes applied, final tsc + vitest status.
```

```
git add .
git commit -m "Session 9C: Corrections applied, Session 9 complete"
git push
```

---

## Report Back to Claude.ai

```
Session 9 complete.

Live smoke test results:
- Approve single post: [yes/no — status badge changed?]
- Skip post with note: [yes/no — note stored?]
- Undo skip: [yes/no — back to draft?]
- Inline edit: [yes/no — content saved?]
- Regenerate with note: [yes/no — new content appeared?]
  - posts_generated_count before: [N]
  - posts_generated_count after: [N+1]
- Bulk approve: [yes/no — how many posts approved?]
- All approved banner: [yes/no]
- Optimistic revert on error: [tested? yes/no]

Build:
- tsc clean: [yes/no]
- vitest pass: [yes/no — test count]

Reviewer report: [paste full report]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas in Session 9

**Atomic guard on skip** — `skipPost` must set `rejection_note` and `status='skipped'`
in the same `UPDATE`. If they are two separate calls, a concurrent approve between
the two writes leaves a post approved with a rejection_note — confused state.

**bulkApproveDraftPosts with service-role** — the most tempting mistake. Service-role
bypasses RLS. Using it for bulk approve would approve ALL businesses' draft posts,
not just the authenticated user's. Use the anon client; RLS does the scoping.

**Optimistic update granularity** — updating `localPosts` state in `PostsClient`
requires cloning the array. A direct mutation (`localPosts[i].status = 'approved'`)
won't trigger a re-render. Use `.map(p => p.id === id ? { ...p, status: 'approved' } : p)`.

**Regenerate return payload** — `regeneratePostAction` must return the new content
and hashtags in its success response so `PostCard` can optimistically update without
a page reload. Don't forget to add `content` and `hashtags` to the return type.

**previousVersions prepend vs append** — ADR §12 says prepend (newest first) so
index 0 is always the most recent rejection. Cap at 5 before prepend to avoid
off-by-one (slice to 4, then unshift).

**Platform accent colors** — hardcode these as a constant map in PostCard to avoid
Tailwind purging dynamic class strings. Use inline style for the accent bar or
safe-listed classes in tailwind.config.ts.

**i18n interpolation** — next-intl uses `{variable}` syntax. The `title` key
`"{campaignName} — Posts"` requires the page to pass `campaignName` via
`t('title', { campaignName: campaign.name })`. Verify the component does this.

**listPostsByCampaign ordering** — if the existing function doesn't support
`orderBy: 'scheduled_at'`, add it now rather than using default DB ordering
(which is undefined without an explicit ORDER BY — violates CLAUDE.md).

**Skip dialog vs inline** — the session uses an inline skip that reveals a note
input directly on the card (not a separate dialog). This is simpler and keeps
the user's focus on the post. Only regeneration uses a dialog (because it needs
more context and the trial-credit warning).

**Date dividers** — extract `format(parseISO(post.scheduled_at), 'EEEE, d MMMM')`
using date-fns. Group posts by the date portion of `scheduled_at` and render a
divider between groups. The grouping happens in `PostsClient`, not in the Server
Component, to avoid hydration mismatches.

**UTC label** — Phase 1 displays all times in UTC. Add a small "UTC" label next to
each scheduled time so users understand the timezone context. Phase 2 will localise
to the business's IANA timezone (already stored in `businesses.timezone`).
