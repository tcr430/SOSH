Session 8 Part C — Post Generation Review (Synthesis)

  Two independent reviewers (security + typescript) — findings merged below. ✅ = pass, ⚠️  = concern, ❌ = fix required.
  Consolidated Findings Table
  ┌─────────┬──────────────────────────────────────────────────────────────────────┬────────┬────────────────────────────────────────────┬──────────┐
  │ Section │                                Check                                 │ Status │                 File:Line                  │ Reviewer │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ A1      │ Pre-check fires before any runPrompt()                               │ ✅     │ generate.ts:95–102                         │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ A2      │ Pre-check uses campaign.total_posts_planned; fresh trialState        │ ✅     │ generate.ts:82, 94                         │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ A3      │ R-1 skip in runner; orchestrator increments once on success          │ ✅     │ runner.ts:12,164; generate.ts:221          │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ A4      │ ai_usage rows created for every SDK call (finally block)             │ ✅     │ runner.ts:180–198                          │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ A5      │ Ownership via RLS; cap uses business's own trialState                │ ✅     │ generate-action.ts:31–48                   │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ B1      │ User input → buildUserMessage only; system prompt uses               │ ✅     │ post-generation.ts:74,117                  │ sec+ts   │
  │         │ CustomerContext                                                      │        │                                            │          │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ B2      │ PLATFORM_CONSTRAINTS hardcoded                                       │ ✅     │ post-generation.ts:38–62                   │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ B3      │ alreadyGeneratedTopics from Claude rationale                         │ ✅     │ generate.ts:178                            │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ B4      │ Cap at 10 via .slice(-10)                                            │ ✅     │ generate.ts:155                            │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ B4      │ Schema type lacks .max(10) enforcement                               │ ⚠️      │ post-generation.ts:22                      │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C1      │ business_id from verified param                                      │ ✅     │ generate.ts:198                            │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C2      │ scheduled_at may exceed campaign.end_date (widening +                │ ⚠️      │ schedule.ts:170–183                        │ sec      │
  │         │ fillExtraSlots)                                                      │        │                                            │          │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C3      │ formatISO used in generate.ts                                        │ ✅     │ generate.ts (multiple)                     │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C3      │ toISOString() in schedule.ts localHourToUTCIso                       │ ⚠️      │ schedule.ts:62                             │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C4      │ All ADR §6 metadata fields present                                   │ ✅     │ generate.ts:185–195                        │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C4      │ as unknown as Record<string, unknown> double-cast                    │ ❌     │ generate.ts:205                            │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C5      │ Collect-then-insert, single createPosts call                         │ ✅     │ generate.ts:182,211                        │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C6      │ Campaign 'active' only on success                                    │ ✅     │ generate.ts:215–218                        │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C6      │ updateCampaign lacks atomic .eq('status','draft') guard              │ ⚠️      │ generate.ts:215                            │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C7      │ total_posts_planned = actual postsCreated                            │ ✅     │ generate.ts:216–218                        │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ C8      │ Session row created pre-background; status updated all paths         │ ✅     │ generate-action.ts:57–63;                  │ sec      │
  │         │                                                                      │        │ generate.ts:38,224,232                     │          │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ D1      │ startGenerationAction uses anon/RLS client                           │ ✅     │ generate-action.ts:31–37                   │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ D2      │ Re-verify business_id/status/no-existing-posts server-side           │ ✅     │ generate.ts:44–79                          │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ D3      │ P-3 idempotency check before runPrompt                               │ ✅     │ generate.ts:62–70                          │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ D4      │ getGenerationSessionAction ownership-scoped                          │ ✅     │ generate-action.ts:88–90                   │ sec      │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E1      │ No any / as any / @ts-ignore in generate.ts or schedule.ts           │ ✅     │ —                                          │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E1      │ Redundant casts in schedule.ts                                       │ ⚠️      │ schedule.ts:195–196                        │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E2      │ runPrompt only from @/lib/ai/runner                                  │ ✅     │ generate.ts:3                              │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E3      │ formatISO via date-fns                                               │ ✅     │ generate.ts:1                              │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E4      │ Service-role via lazy import throughout                              │ ✅     │ generate.ts:34; generate-action.ts:55,85   │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E5      │ i18n keys present in en/pt/es                                        │ ✅     │ i18n/*/common.json:250–269                 │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E6      │ schedule tests cover frequencies × platforms, null endDate,          │ ✅     │ schedule.test.ts                           │ ts       │
  │         │ widening, boundary                                                   │        │                                            │          │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E6      │ custom frequency branch not tested                                   │ ⚠️      │ schedule.test.ts                           │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ E7      │ POST_GENERATION_POLL_MAX_SECONDS hardcoded, not in config            │ ❌     │ GeneratePostsButton.tsx:11                 │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ —       │ console.warn in committed code (CLAUDE.md prohibition)               │ ❌     │ generate.ts:172–175                        │ sec+ts   │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ —       │ Missing Zod UUID validation on Server Action params                  │ ❌     │ generate-action.ts:24, 73                  │ ts       │
  ├─────────┼──────────────────────────────────────────────────────────────────────┼────────┼────────────────────────────────────────────┼──────────┤
  │ —       │ generate.ts function approaching 50-line/nesting limits              │ ⚠️      │ generate.ts:28–239                         │ ts       │
  └─────────┴──────────────────────────────────────────────────────────────────────┴────────┴────────────────────────────────────────────┴──────────┘

  ---
  ❌ Required Fixes (with exact instructions)

  1. Zod validation on Server Action params — generate-action.ts:24, 73

  Server Actions accept user-supplied strings; CLAUDE.md mandates Zod at all Server Action boundaries.
  // startGenerationAction
  const parsed = z.string().uuid().safeParse(rawCampaignId)
  if (!parsed.success) return { error: 'invalid_campaign_state' }
  const campaignId = parsed.data
  // Same pattern for getGenerationSessionAction with sessionId → 'not_found'

  2. Remove console.warn — generate.ts:172–175

  Hard CLAUDE.md prohibition; mismatch is recoverable from session row (posts_planned vs posts_created). Delete the block.

  3. Eliminate double-cast on metadata — generate.ts:205

  Change PostInsert.ai_generation_metadata in lib/db/types.ts to AiGenerationMetadata | Record<string, unknown> and drop the as unknown as
  Record<string, unknown> cast.

  4. POST_GENERATION_POLL_MAX_SECONDS — GeneratePostsButton.tsx:11

  Move out of component. Either:
  - lib/constants.ts export, import into the component, OR
  - add NEXT_PUBLIC_POST_GENERATION_POLL_MAX_SECONDS to lib/config.ts public schema (ADR 0004 §13 prefers env var).

  ---
  ⚠️  Recommendations

  - C2 (scheduled_at ceiling): Add a final clamp/filter in schedulePosts rejecting slots past campaign.end_date. Otherwise the publishing worker
  silently skips them.
  - B4: Add z.array(z.string()).max(10) to PostGenerationInput to make the slice contract explicit.
  - C6 atomic guard: Replace bare updateCampaign with activateCampaign() helper using .eq('status','draft') per CLAUDE.md atomic-transition pattern.
  - schedule.ts:62: Use formatISO for consistency.
  - schedule.ts:195–196: Remove redundant as Platform[] / as CampaignFrequency casts.
  - E6: Add custom frequency test case.
  - generate.ts: Extract STEP 8 insert-build loop (lines 182–208) into buildPostInserts() helper to reduce length/nesting.

  ---
  Verdict

  Blockers before Session 9 (security + type integrity at Server Action boundary):
  1. Zod UUID validation on startGenerationAction and getGenerationSessionAction params
  2. Remove console.warn at generate.ts:172–175
  3. Fix as unknown as double-cast at generate.ts:205

  Blockers before first user (data integrity + operability):
  4. C2 — clamp scheduled_at to campaign.end_date (otherwise silent missing-post UX)
  5. POST_GENERATION_POLL_MAX_SECONDS extracted from component

  Acceptable to defer:
  - B4 schema cap (call-site enforces)
  - custom frequency test (simple branch)
  - schedule.ts cast/format cosmetics
  - updateCampaign atomic guard (session flow makes race unlikely)
  - Pre-existing listPostsDue toISOString (Session 5D backlog)
  - Generation-session janitor for stale 'generating' rows (ADR §15 → Session 10)
  - Two-click race (button-disable mitigates; ADR §15 deferral)

  Overall: Core architecture is sound — all ADR invariants (P-1…P-7, R-1/R-2, D1–D4) verified. Three small fixes unblock Session 9; two more unblock
  first user. No structural rework needed.