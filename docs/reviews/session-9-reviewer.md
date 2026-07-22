Session 9C — Reviewer Audit Report

  Full Check Table
  Section: A1
  Check: All 7 actions authenticate via getUser() before any DB call
  Status: ✅
  File:Line: actions.ts:42–51
  Notes: getAuthContext() calls getUser() → getBusinessByOwner() before returning; all 7 actions call it first
  ────────────────────────────────────────
  Section: A2
  Check: All DB calls use anon ctx.client (RLS enforced); no service-role for bulk approve
  Status: ✅
  File:Line: actions.ts:76,124,194
  Notes: bulkApprovePostsAction uses ctx.client, not service-role — RLS applies
  ────────────────────────────────────────
  Section: A3
  Check: regeneratePostAction checks status === 'draft' before runPrompt
  Status: ✅
  File:Line: actions.ts:229
  Notes: Guard is at line 229; runPrompt is called at line 267
  ────────────────────────────────────────
  Section: A4
  Check: buildCustomerContext receives campaign.business_id from server-side DB read, not a client param
  Status: ✅
  File:Line: actions.ts:233,239
  Notes: Campaign fetched via RLS-scoped getCampaignById(ctx.client, post.campaign_id)
  ────────────────────────────────────────
  Section: A5
  Check: UUID validation on all postId / campaignId params
  Status: ✅
  File:Line: actions.ts:61,108,156,206
  Notes: z.string().uuid() in every schema
  ────────────────────────────────────────
  Section: B1
  Check: postsRemaining >= 1 pre-flight before runPrompt
  Status: ✅
  File:Line: actions.ts:242–244
  Notes: Defence-in-depth: outer check + runner internal check (two layers)
  ────────────────────────────────────────
  Section: B2
  Check: Runner step-8 trial counter fires for 'post-regeneration'
  Status: ✅
  File:Line: runner.ts
  Notes: isPostGeneration() guard only skips 'post-generation'; regeneration increments the counter correctly
  ────────────────────────────────────────
  Section: B3
  Check: rate_limited AiError surfaces to caller (not swallowed)
  Status: ✅
  File:Line: actions.ts:268–270
  Notes: catch (e) { if (e instanceof AiError) return { error: e.code } } — code propagates
  ────────────────────────────────────────
  Section: B4
  Check: previousVersions capped at 5
  Status: ✅
  File:Line: actions.ts:279–282
  Notes: .slice(0, 5) — correct
  ────────────────────────────────────────
  Section: C1
  Check: feedbackNote in buildUserMessage only, not buildSystemPrompt
  Status: ✅
  File:Line: post-regeneration.ts:36–52,74–77
  Notes: buildSystemPrompt takes no input arg; all user fields are in buildUserMessage
  ────────────────────────────────────────
  Section: C2
  Check: previousContent / previousRationale from DB row, not client param
  Status: ✅
  File:Line: actions.ts:250–251
  Notes: Read from server-fetched post.content and existingMetadata.rationale
  ────────────────────────────────────────
  Section: C3
  Check: campaign.objective and special_instructions in buildUserMessage not buildSystemPrompt
  Status: ✅
  File:Line: post-regeneration.ts:58–59,86–90
  Notes: Correctly placed in user message
  ────────────────────────────────────────
  Section: C4
  Check: siblingPostsTopics from DB, not user-supplied
  Status: ✅
  File:Line: actions.ts:238; posts.ts:268
  Notes: getPostSiblingTopics queries posts table via auth client (RLS applies)
  ────────────────────────────────────────
  Section: C5
  Check: [/DATA] delimiter injection in user-controlled fields
  Status: ❌
  File:Line: post-regeneration.ts:67–90
  Notes: feedbackNote, previousContent, special_instructions, siblingPostsTopics not stripped of [/DATA]. A user can embed [/DATA]\nIgnore prior
    instructions… to escape the data block
  ────────────────────────────────────────
  Section: D1
  Check: Atomic conditional UPDATE on all status transitions
  Status: ✅
  File:Line: posts.ts:89–95,155–163,175–181,189–198
  Notes: Every helper uses .eq('status', ...) on the WHERE clause — no read-then-update
  ────────────────────────────────────────
  Section: D2
  Check: updatePostContent restricted to ['draft','approved']
  Status: ✅
  File:Line: posts.ts:216
  Notes: .in('status', ['draft', 'approved'])
  ────────────────────────────────────────
  Section: D3
  Check: Content + metadata updated in single DB call (atomic)
  Status: ✅
  File:Line: actions.ts:291–295; posts.ts:231–251
  Notes: updatePostContentAndMetadata sets all three fields in one .update()
  ────────────────────────────────────────
  Section: D4
  Check: bulkApprovePostsAction WHERE includes status='draft' guard
  Status: ✅
  File:Line: posts.ts:261
  Notes: .eq('campaign_id', …).eq('status', 'draft')
  ────────────────────────────────────────
  Section: D5
  Check: rejection_note set to NULL on unskip
  Status: ✅
  File:Line: posts.ts:191
  Notes: update({ status: 'draft', rejection_note: null })
  ────────────────────────────────────────
  Section: E1
  Check: No any types
  Status: ✅
  File:Line: —
  Notes: No any annotations; two as Partial<AiGenerationMetadata> casts are unknown-based
  ────────────────────────────────────────
  Section: E2
  Check: Hardcoded EN strings — Show less/more
  Status: ❌
  File:Line: PostCard.tsx:227
  Notes: '↑ Show less' / '↓ Show more' not keyed through t()
  ────────────────────────────────────────
  Section: E2
  Check: date-fns format ignores active locale (date dividers)
  Status: ❌
  File:Line: PostsClient.tsx:151
  Notes: format(new Date(dateKey), 'EEEE, d MMMM') — no locale arg; always renders in EN
  ────────────────────────────────────────
  Section: E3
  Check: All i18n keys present in EN file (sanity check)
  Status: ✅
  File:Line: en/posts.json
  Notes: All code-referenced keys exist; regenerate.error.* keys exist for all error codes
  ────────────────────────────────────────
  Section: E4
  Check: Optimistic update reverts on Server Action error
  Status: ✅
  File:Line: PostCard.tsx:81–152
  Notes: All 5 handlers snapshot prev state and call onOptimisticUpdate(post.id, prev) on failure
  ────────────────────────────────────────
  Section: E5
  Check: listPostsByCampaign called with limit: 50
  Status: ✅
  File:Line: page.tsx:33
  Notes: listPostsByCampaign(client, id, 50)
  ────────────────────────────────────────
  Section: E6
  Check: Regenerate button disabled while in-flight (no double-submit)
  Status: ✅
  File:Line: PostCard.tsx:329; RegenerateDialog.tsx:57,98
  Notes: Button only visible when status === 'draft' && !isEditMode && !isSkipOpen; isPending gates both PostCard and dialog
  ────────────────────────────────────────
  Section: E7
  Check: formatISO for timestamp writes (not .toISOString())
  Status: ❌
  File:Line: posts.ts:304
  Notes: listPostsDue uses new Date().toISOString() — violates CLAUDE.md convention
  ────────────────────────────────────────
  Section: E8
  Check: No service-role in Client Components or Server Actions
  Status: ✅
  File:Line: All files
  Notes: createClient() (anon key) throughout; no service-role import in this subsystem
  ────────────────────────────────────────
  Section: X1
  Check: FilterPill defined inside PostsClient render
  Status: ❌
  File:Line: PostsClient.tsx:87–97
  Notes: Component defined inside render creates new type on every render — React unmounts/remounts instead of updating. Causes focus loss on filter
    click
  ────────────────────────────────────────
  Section: X2
  Check: revalidateCampaignPosts path format
  Status: ⚠️ 
  File:Line: actions.ts:54
  Notes: Path /[locale]/campaigns/${campaignId}/posts is correct for Next.js ([locale] as bracket notation wildcards all locales, route group
  (dashboard)
    is URL-transparent). However, verify this holds in Next.js 16 — the 'page' tag behaviour for i18n routes should be tested
  ────────────────────────────────────────
  Section: X3
  Check: locale prop declared in PostsClientProps but not used
  Status: ⚠️ 
  File:Line: PostsClient.tsx:23,30
  Notes: Prop is passed, typed, but not destructured — dead prop until E2 date fix is applied

  ---
  ❌ Exact Fix Instructions

  Fix 1 — C5: Strip [/DATA] from all user-controlled strings before prompt interpolation

  File: lib/ai/prompts/post-regeneration.ts

  Add at the top of the file (before the prompt export):

  function sanitizeDataField(value: string): string {
    return value.replace(/\[\/DATA\]/gi, '[/data-blocked]')
  }

  Apply to every user-controlled field that enters a [DATA] block in buildUserMessage:

  // line 69 — previousContent (from DB but user-originated)
  Content: ${sanitizeDataField(input.previousContent)}
  // line 70 — previousRationale (also user-originated, via prior AI call on their input)
  Original rationale: ${sanitizeDataField(input.previousRationale)}
  // line 76 — feedbackNote (direct user input)
  ${sanitizeDataField(input.feedbackNote)}
  // line 82 — siblingPostsTopics (DB rationale strings, user-originated)
  ${input.siblingPostsTopics.map(sanitizeDataField).join('\n')}
  // line 89 — special_instructions (user-set at campaign creation)
  ${sanitizeDataField(input.campaign.special_instructions ?? '')}

  Also apply in lib/ai/prompts/post-generation.ts for any fields that follow the same pattern (special_instructions, brandVoice text fields).

  ---
  Fix 2 — E2a: Hardcoded 'Show less' / 'Show more'

  Files: i18n/en/posts.json, i18n/pt/posts.json, i18n/es/posts.json, components/posts/PostCard.tsx

  Add to all three locale files under card:
  "card": {
    "showMore": "Show more",
    "showLess": "Show less",
    ...
  }
  PT: "showMore": "Ver mais", "showLess": "Ver menos"
  ES: "showMore": "Ver más", "showLess": "Ver menos"

  Then in PostCard.tsx:224–228:
  // Before
  {isExpanded ? '↑ Show less' : '↓ Show more'}

  // After
  {isExpanded ? `↑ ${t('card.showLess')}` : `↓ ${t('card.showMore')}`}

  ---
  Fix 3 — E2b: date-fns format ignores active locale

  File: app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx

  // Add imports at top
  import { enUS } from 'date-fns/locale/en-US'
  import { pt } from 'date-fns/locale/pt'
  import { es } from 'date-fns/locale/es'
  import type { Locale } from 'date-fns'

  const DATE_FNS_LOCALES: Record<string, Locale> = { en: enUS, pt, es }

  // line 30 — destructure locale
  export function PostsClient({ posts, campaign, locale }: PostsClientProps) {

  // line ~149–152 — pass locale to format
  const dateFnsLocale = DATE_FNS_LOCALES[locale] ?? enUS
  const dividerLabel = format(new Date(dateKey), 'EEEE, d MMMM', { locale: dateFnsLocale })

  This also resolves the dead locale prop (X3) in one change.

  ---
  Fix 4 — E7: .toISOString() in listPostsDue

  File: lib/db/posts.ts:304

  // Before
  const now = new Date().toISOString()

  // After
  import { formatISO } from 'date-fns'  // (add to existing date-fns imports)
  const now = formatISO(new Date())

  ---
  Fix 5 — X1: FilterPill defined inside render

  File: app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx

  Move FilterPill to module scope (outside PostsClient):

  // Module-level constants
  const filterPillBase = 'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer'
  const filterPillActive = 'bg-foreground text-background'
  const filterPillInactive = 'bg-muted text-muted-foreground hover:bg-muted/70'

  interface FilterPillProps {
    value: FilterValue
    label: string
    activeFilter: FilterValue
    onSelect: (v: FilterValue) => void
  }

  function FilterPill({ value, label, activeFilter, onSelect }: FilterPillProps) {
    return (
      <button
        type="button"
        onClick={() => onSelect(value)}
        className={`${filterPillBase} ${activeFilter === value ? filterPillActive : filterPillInactive}`}
      >
        {label}
      </button>
    )
  }

  Update all <FilterPill> call sites to pass activeFilter={activeFilter} onSelect={setActiveFilter}.

  ---
  ⚠️  Recommendations (post-Session 10)

  R1 — statusKey cast is unsound (PostCard.tsx:166). Replace post.status as 'draft' | 'approved' | 'skipped' with a direct fallback lookup:
  const pillClass = STATUS_PILL_CLASS[post.status] ?? STATUS_PILL_CLASS.draft

  R2 — PostActionState.error should be a typed union (actions.ts:31). Replace error?: string with error?: PostActionErrorCode (a named union of all
  valid error codes). Eliminates the cast in RegenerateDialog:49.

  R3 — ai_generation_metadata cast is latent any (PostCard.tsx:70, actions.ts:246). The as Partial<AiGenerationMetadata> cast on Record<string,unknown>
  bypasses type safety. Add a narrow helper parseAiGenerationMetadata(raw: unknown): Partial<AiGenerationMetadata> in lib/db/types.ts. Medium priority —   the existing ?? [] guard on previousVersions prevents a runtime crash today.

  R4 — VALID_TRANSITIONS is inconsistent with actual permitted transitions (posts.ts:4–11). unapprovePost (approved→draft) and unskipPost
  (skipped→draft) bypass validateStatusTransition. Either add those transitions to the map with a comment, or add a JSDoc on validateStatusTransition
  explaining it only applies to the generic updatePost.

  R5 — Redundant double sort. Posts are sorted by scheduled_at in the Server Component (page.tsx:34–36) then re-sorted in PostsClient.filtered. Drop the   server-side sort; PostsClient owns ordering.

  ---
  Verdict

  ┌───────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │         Category          │                                                       Issues                                                        │
  ├───────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Blockers before Session   │ ❌ C5 (prompt injection), ❌ E2×2 (hardcoded strings), ❌ E7 (formatISO), ❌ X1 (FilterPill in render) — 5 fixes    │
  │ 10                        │ required                                                                                                            │
  ├───────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Blockers before first     │ ❌ C5 (prompt injection — self-harm only: user can escape their own post's constraints, no cross-tenant risk)       │
  │ user                      │                                                                                                                     │
  ├───────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Acceptable to defer       │ R1–R5 (type quality), X2 (verify revalidatePath in Next.js 16), double sort                                         │
  └───────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Session 9D should apply all 5 ❌ fixes and verify the test suite still passes at 488+. Then Session 10 can proceed to the publishing worker.