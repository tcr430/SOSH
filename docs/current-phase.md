# Current Phase

**Phase:** 1 — MVP
**Goal:** First paying customer
**Status:** Session 13.5D complete — QStash trigger migration correction pass done (B7 + E1/H1/I3). Next: Session 14 (Transactional Email).

## What's done
- Session 0: Environment setup complete
- Session 1: Next.js 16 initialized, Tailwind, shadcn/ui,
  next-intl (EN/PT/ES), Supabase clients, typed config
- Session 2A: Database schema ADR complete and approved
  (docs/decisions/0001-database-schema.md)
- Session 2B: All 23 database migrations authored
  (supabase/migrations/ 001–013 base + 014–015 placeholders + 016–023 fixes)
- Session 2C: Reviewer audit — database schema and security review passed
- Session 2D: All lib/db/ query modules complete with full TypeScript types
  (businesses, brand-voices, campaigns, posts, post-metrics, social-accounts,
  engagement, trial-state, ai-usage)
- Session 2E: Final correction pass — all warnings resolved
  - Test suite: 96/96 passing; tsc --noEmit clean
- Session 3A: SocialProvider ADR authored (docs/decisions/0002-social-provider.md)
- Session 3B: Full SocialProvider abstraction implemented (/lib/social/)
  - types.ts — SocialProvider interface + all OAuth/token types
  - errors.ts — SocialProviderError with typed error codes
  - constants.ts — Required OAuth scopes per platform
  - vault.ts — readAccessToken, readRefreshToken, withFreshToken (service-role)
  - oauth/state.ts — signOAuthState / verifyOAuthState (HMAC-SHA256 JWT)
  - mock-provider.ts — MockProvider with configurable failure injection
  - postiz-provider.ts — PostizProvider (Postiz API wrapper)
  - registry.ts — getRegistry() singleton; SOCIAL_PROVIDER=mock for tests
  - index.ts — single public export surface for all consumers
  - ESLint rule: no direct imports of postiz-provider or mock-provider outside lib/social/
  - Migration 24: vault RPC helpers (vault_create_secret, vault_update_secret, vault_delete_secret)
  - Test suite: 66/66 passing (7 test files in lib/social); full suite 162/162
  - lib/social/types.test.ts — type-level assertions for all exported types
  - app/api/_health/social/route.ts — health check endpoint (HEALTHCHECK_TOKEN gated)
  - HEALTHCHECK_TOKEN added to /lib/config.ts as optional server var
  - vitest.config.ts: testTimeout bumped to 15000ms (vault module-reset slowness)
- Session 3C: Reviewer audit — SocialProvider reviewed by typescript-reviewer +
  security-reviewer in parallel (Opus 4.7 synthesis). 10 fixes identified.
- Session 3D: Correction pass — all 10 reviewer fixes applied:
  1. POSTIZ_BASE_URL — renamed from POSTIZ_API_URL (canonical ADR name) across
     lib/config.ts, registry.ts, route.ts, .env.local, .env.local.example
  2. readRefreshToken — added !account.is_active guard (was missing vs readAccessToken)
  3. Zod validation on Postiz responses — PostizCallbackResponseSchema +
     PostizRefreshResponseSchema replace raw `as` casts in postiz-provider.ts
  4. Recursive redaction — SocialProviderError.details now redacts nested
     token-shaped keys (e.g. details.platform_message.accessToken)
  5. Constant-time health-check — token comparison uses crypto.timingSafeEqual
  6. NODE_ENV via config — registry.ts + route.ts read config.public.NODE_ENV,
     not process.env.NODE_ENV directly
  7. Expired-token test — oauth-state.test.ts covers verifyOAuthState rejection
  8. 300s exact boundary test — vault.test.ts covers the <= skew condition
  9. token_secret + recursive redaction test — errors.test.ts covers nested keys
  10. Integration test placeholder — lib/social/__integration__/ created, gated on
      POSTIZ_INTEGRATION_TEST_ENABLED
  Rec A: OAuthAuthorizeInput platform/state fields documented in types.ts +
         current-phase.md
  Rec B: OAUTH_STATE_SECRET requires .min(32) at boot (no silent empty default)
  Test suite: 165/165 passing + 3 todo + 1 skipped (integration)

- Session 4A: Authentication & Onboarding Foundation
  - lib/validation/email.ts — FREE_EMAIL_PROVIDERS blocklist, isWorkEmail(), getEmailDomain(),
    workEmailSchema (Zod); lib/validation/email.test.ts — 37 tests covering all cases
  - app/[locale]/(auth)/ — signup, login, forgot-password, reset-password pages with
    Server Actions, useActionState feedback, next-intl translations across EN/PT/ES
  - i18n/en|pt|es/auth.json — full auth namespace (signup, login, forgot, reset, errors)
  - middleware.ts — auth redirect + i18n locale detection + x-pathname header injection
  - lib/contexts/business-context.tsx — BusinessProvider + useActiveBusiness() Client Component
    context (user, activeBusiness, brandVoice)
  - app/[locale]/(dashboard)/layout.tsx — Server Component guard (getUser → login redirect;
    getBusinessByOwner → signup redirect; onboarding guard via x-pathname header)
  - app/[locale]/(dashboard)/actions.ts — logoutAction (signOut + redirect)
  - components/layout/DashboardShell.tsx — sidebar (5 nav items) + top bar with user dropdown
    (Base UI DropdownMenu without asChild — see decisions below)
  - app/[locale]/(dashboard)/campaigns/page.tsx — empty state page
  - components/onboarding/OnboardingProgress.tsx — step progress indicator (X of 4)
  - app/[locale]/(dashboard)/onboarding/page.tsx — routing logic redirects to correct step
    based on what's already filled in (business fields → brand voice → step-3)
  - app/[locale]/(dashboard)/onboarding/step-1/ — business profile (name/website/industry/
    description); native <select> for industry; pre-fills from context
  - app/[locale]/(dashboard)/onboarding/step-2/ — brand voice (tone multi-select pills,
    target audience, keywords tag input, avoid_words tag input, unique_value_prop);
    tone serialized as JSON hidden input, tags as comma-separated string
  - app/[locale]/(dashboard)/onboarding/step-3/ — social platform cards (LinkedIn, X,
    Instagram, Facebook, Threads); Connect buttons disabled with "Coming soon" tooltip;
    Skip → step-4
  - app/[locale]/(dashboard)/onboarding/step-4/ — completion screen; completeOnboardingAction
    sets onboarding_completed via service-role (lazy import pattern)
  - i18n/en|pt|es/common.json — nav.profile, nav.logout, dashboard.campaigns.empty.*,
    onboarding.* (all steps, tones, industries, platforms)

- Session 4B: Reviewer audit — typescript-reviewer + security-reviewer parallel audit of Session 4A.
  Identified 12 issues (B-01–B-06, H-01–H-02, M-03, M-05–M-06, plus deferred M-01/M-02/M-04/L-*).
- Session 4D: Correction pass — all non-deferred reviewer findings applied:
  1. **IDOR closure (B-01):** step-1 and step-2 Server Actions no longer trust client-supplied
     `businessId` from FormData. `businessId` is now derived server-side via
     `getBusinessByOwner(client, user.id)` after the auth check. Hidden `businessId` inputs
     removed from both forms.
  2. **Zod schema for step-2 (B-02):** `saveStep2Action` now validates all six fields through
     a proper `step2Schema`; exported `Step2State` type added with index signature for field errors.
  3. **Guarded JSON.parse for tone (B-03):** `JSON.parse(toneRaw)` wrapped in try/catch and
     validated through `z.array(z.string()).catch([])` — malformed input silently coerces to `[]`.
  4. **Missing locale key (B-04):** `errors.onboarding.name_required` and `errors.onboarding.generic`
     added to all three locale files (en/pt/es) under `common.json`.
  5. **Step2Form useActionState + errors (B-05):** Step2Form refactored to mirror Step1Form —
     `useActionState`, `isPending` on submit button, `_form` error block with `role="alert"`.
  6. **Step1Form error rendering (B-06):** Field error paragraph now calls `tErrors(state.errors.name)`
     instead of rendering the field label string.
  7. **Reset URL from APP_URL (H-01):** `forgot-password/actions.ts` no longer builds the reset
     URL from spoofable `x-forwarded-host`/`host` headers. URL comes from `config.server.APP_URL`
     (backed by `NEXT_PUBLIC_APP_URL`); `lib/config.ts` updated with the new `APP_URL` getter.
  8. **Zod-first password reads (H-02):** `reset-password/actions.ts` removed pre-Zod unsafe casts;
     password mismatch check moved into `resetPasswordSchema` via `.superRefine`.
  9. **Signup recovery path (M-03):** Post-auth setup failures return a `setup_incomplete` error
     state with preserved form values instead of silently stalling. `errors.signup.setup_incomplete`
     added to all three auth locale files.
  10. **Skip button pending state (M-05):** `SkipButton` component created using `useFormStatus`;
      both step-1 and step-2 forms use it for the "Skip for now" action.
  11. **Form value preservation on error (M-06):** All auth actions (login, signup, forgot-password)
      now include `values` in error returns; login/signup/forgot-password pages bind `defaultValue`
      on inputs from `state.values.*`.
  Test suite: 265/265 passing; tsc --noEmit clean (SOSH files).

- Session 5A: AI layer ADR authored (docs/decisions/0003-ai-layer.md)
  - 8-step runner contract, SSRF constraints (F-1–F-14), trial cap & rate-limit rules,
    cost accounting model (ADR §10: raw input_tokens + cache_read_input_tokens stored),
    per-prompt rate limits (ADR §9), provider abstraction (AI_PROVIDER env)
- Session 5B: Full AI layer implemented (/lib/ai/)
  - models.ts — MODELS registry (SONNET_4_6, HAIKU_4_5, OPUS_4_7), calculateCostCents
  - errors.ts — AiError class with typed codes (quota_exceeded, rate_limited, provider_error,
    invalid_response, rate_limit)
  - parsers.ts — safeParseOrAiError (Zod-validated JSON parse)
  - client.ts — getAnthropicClient factory; AI_PROVIDER=mock returns stub
  - context.ts — buildCustomerContext: loads business + brand voice + trial_state;
    trialState derives from business.plan (not row nullity — B-trial-bypass fix)
  - website-fetcher.ts — fetchWebsiteText with full SSRF guard (F-1–F-14):
    scheme allowlist, credential rejection, blocklisted IPv4/IPv6 ranges, all-address
    DNS check, IPv4-mapped IPv6 (::ffff:) detection, undici pinned dispatcher (TOCTOU),
    manual redirect re-resolution (max 2 hops), streaming body cap (C-body-stream fix)
  - runner.ts — 8-step runPrompt: trial cap → rate limit → message assembly →
    cache_control (>4096 chars) → SDK call with one retry → parse → cost calc →
    ai_usage record (always, in finally) → trial counter increment
  - prompts/brand-voice-inference.ts — BrandVoiceInferenceOutput schema + prompt builder
  - metrics.ts — aiCostByBusiness, aiCallVolume read-only observability helpers
  - index.ts — single public export surface
  - Migration 25: increment_brand_voice_attempts + increment_posts_generated RPC functions
    (atomic single-statement UPDATE, no read round-trip — B-race fix)
  - Test suite additions: context, errors, models, parsers, runner, website-fetcher, metrics,
    ai-usage (countRecentCalls), trial-state (increment RPCs) — 334 tests total
  - Step 2 form upgraded: polls inferBrandVoiceAction → BrandVoice DB row; AI-badge on
    suggested fields; per-error-code i18n messages (quota_exceeded, rate_limited,
    provider_error, invalid_response, timeout) in EN/PT/ES
- Session 5C: Reviewer audit — security-reviewer + typescript-reviewer + cost-aware-llm-pipeline
  parallel review of /lib/ai/. Identified B-trial-bypass, 3 SSRF gaps (C-dns-all,
  C-mapped-ipv6, C-toctou), F-cache-tokens-not-stored, F-rate-limit-not-per-prompt,
  I-i18n-ai-errors, B-race, C-body-stream.
- Session 5D: Correction pass — all 8 reviewer findings applied:
  1. **B-trial-bypass:** context.ts now derives trialState from business.plan (not
     trialStateRow === null). If plan is 'trial' but row missing, full caps returned
     (trigger hasn't fired yet). config.server.AI_TRIAL_POST_CAP and
     AI_TRIAL_CAMPAIGN_CAP added (env-configurable, previously hardcoded).
  2. **C-dns-all:** lookup() now called with { all: true }; every resolved address
     checked — single blocked address in a multi-A record set rejects the request.
  3. **C-mapped-ipv6:** isBlockedIPv6 now extracts the IPv4 part from ::ffff:x.x.x.x
     and passes it through isBlockedIPv4. Covers AWS metadata via mapped IPv6.
  4. **C-toctou:** undici Agent created with connect.lookup pinned to the pre-resolved
     IP address; TCP connect cannot re-resolve to a different address (DNS rebinding fix).
  5. **F-cache-tokens-not-stored:** ai_usage.input_tokens now stores
     usage.input_tokens + usage.cache_read_input_tokens (raw total per ADR §10).
     Cost weighting (10% for cache reads) is applied only in calculateCostCents.
  6. **F-rate-limit-not-per-prompt:** countRecentCalls now accepts promptId param and
     filters by prompt_id. Separate rate limits: brand-voice 10/min, post-gen 30/min.
     AI_RATE_LIMIT_POST_GENERATION_PER_MIN added to config.
  7. **I-i18n-ai-errors:** errors.ai.{quota_exceeded,rate_limited,provider_error,
     invalid_response,timeout} added to all three locale files. Step 2 form calls
     inferBrandVoiceAction on mount; on failure, sets errorCode state and shows the
     specific message via useTranslations('errors.ai').
  8. **B-race:** incrementBrandVoiceAttempts + incrementPostsGenerated replaced with
     single client.rpc() calls to atomic SQL functions (migration 25). No read round-trip.
  9. **C-body-stream:** website-fetcher replaced arrayBuffer() with streaming reader;
     cap fires at the byte boundary as data arrives, not after full buffer load.
  Test suite: 334/334 passing; tsc --noEmit --skipLibCheck clean; migration 25 applied.

- Session 6A: SocialProvider OAuth ADR authored (docs/decisions/0002-social-provider.md §7 — vault
  write sequence, compensating transactions, state JWT with locale)
- Session 6B: Full OAuth + social accounts UI implemented:
  - Postiz docker-compose (local dev stack with Postgres, Redis, health checks)
  - OAuth connect/callback/disconnect routes for all 5 platforms
  - lib/social/oauth/state.ts — signOAuthState / verifyOAuthState with locale claim
  - lib/social/platforms/guards.ts — VALID_PLATFORMS + isPlatform() (single source of truth)
  - lib/social/connection-status.ts — ConnectionStatus type with 'connected_coming_soon'
    (active account on coming-soon platform shows Disconnect; not connected shows disabled Connect)
  - components/social/PlatformConnectionCard.tsx — shared card component (settings + onboarding)
  - components/social/PlatformIcon.tsx — brand-colour platform icons
  - app/[locale]/(dashboard)/settings/accounts/ — server-fetched accounts page with
    AccountsClient (banner, router refresh on disconnect)
  - app/[locale]/(dashboard)/onboarding/step-3/ — Step3Client with live polling and skip warning
  - components/layout/SettingsNav.tsx — settings sidebar nav
  - i18n EN/PT/ES — full accounts, settings nav, step-3 strings
- Session 6C: Reviewer audit — security-reviewer + typescript-reviewer parallel review (Opus 4.7).
  31-item security checklist (24 ✅ / 4 ❌ / 3 ⚠️), 35-item TS checklist (30 ✅ / 2 ❌ / 3 ⚠️).
- Session 6D: Correction pass — all critical findings applied:
  1. DashboardShell.tsx — eslint-disable for hydration-safe sessionStorage read in useEffect
  2. SocialAccountUpdate type — vault_access_token_id/vault_refresh_token_id allow null;
     double cast removed from deactivateSocialAccount
  3. listAllSocialAccounts / listActiveSocialAccounts — explicit column list, vault IDs excluded;
     return type SocialAccountWithoutVault
  4. connected_coming_soon status — active account on coming-soon platform surfaces Disconnect;
     disabled Connect button prevents orphan accounts; i18n keys in all 3 locales
  5. connect_failed — added to ERROR_KEYS whitelist + translations (EN/PT/ES)
  6. Locale in OAuth state JWT — signOAuthState embeds locale; callback reads claims.locale
     for all redirects (fixes PT/ES users landing on /en/ after OAuth)
  7. isPlatform() guard — extracted to lib/social/platforms/guards.ts, replaces three
     duplicated VALID_PLATFORMS Sets in connect/callback/disconnect routes
  8. Connection-status boundary tests — exact 7-day (expiring_soon) + 8-day (connected)
  Test suite: 295/295 passing; tsc --noEmit clean (SOSH files)

- Session 7 complete (7A ADR → 7B Builder → 7C Reviewer + correction pass):
  - **Plan enforcement:** checkCampaignCreationAllowed with trial/starter/pro tiers;
    atomic increment_campaigns_created RPC; trial cap env-configurable
  - **Server-side platform ownership check:** createCampaignAction verifies all
    submitted platforms are connected for the business before enforcement step
  - **Campaign list page:** listCampaigns + CampaignCard (status badge, platform names,
    pause/resume/delete actions with AlertDialog confirmation for delete)
  - **Campaign detail page:** getCampaignById (RLS-scoped); overview card; Generate Posts
    CTA placeholder (inline coming-soon message on click); danger zone with pause/resume/delete
  - **Type safety:** CampaignUpdate now excludes business_id (CLAUDE.md tenancy convention);
    softDeleteCampaign unguarded export removed (only softDeleteCampaignGuarded is public)
  - **Cleanup:** Dead i18n keys errors.campaign.limit_trial / limit_starter removed;
    endDate validation message updated to clarify same-day case
  - Test suite: 459/459 passing; tsc --noEmit --skipLibCheck clean

- Session 7B: Campaign creation form + Server Action (builder role):
  - lib/validation/campaign.ts — createCampaignSchema (Zod): name, objective,
    specialInstructions (optional), platforms (min 1), frequency (enum), postsPerWeek
    (1–21 int), startDate, endDate (optional, must be after startDate)
  - lib/db/campaigns.ts — countActiveCampaigns: counts active+draft campaigns per business
    (draft counts toward Starter limit — represents committed in-progress work)
  - lib/campaigns/enforcement.ts — checkCampaignCreationAllowed: trial=cap from
    config.server.AI_TRIAL_CAMPAIGN_CAP (default 1, via campaigns_created_count);
    starter=2 active+draft; pro/agency=unlimited
  - lib/campaigns/campaign.test.ts — 26 tests covering schema validation + all 4 plan tiers
  - app/[locale]/(dashboard)/campaigns/new/actions.ts — createCampaignAction Server Action:
    10-step pipeline (validate → auth → business → trialState → enforcement → compute
    totalPostsPlanned → createCampaign(status:draft) → incrementIfTrial(swallowed) → return
    campaignId). Returns campaignId for client-side redirect (redirect() not usable inside
    useActionState).
  - app/[locale]/(dashboard)/campaigns/new/actions.test.ts — 18 tests: validation errors,
    auth/business errors, limit errors, success path, error swallowing, generic DB error
  - supabase/migrations/20260521180000_increment_campaigns_created.sql — atomic
    increment_campaigns_created RPC (SECURITY DEFINER, service_role-only). Applied to live DB.
  - lib/db/trial-state.ts — incrementCampaignsCreated added (lazy service-role import pattern)
  - app/[locale]/(dashboard)/campaigns/new/page.tsx — Server Component: fetches
    listActiveSocialAccounts, passes to CampaignForm
  - app/[locale]/(dashboard)/campaigns/new/CampaignForm.tsx — Client Component with three
    sections: (1) name/objective/special-instructions; (2) platform cards (all 5 shown —
    connected selectable, disconnected greyed with "Connect in Settings →"; coming-soon badge
    on instagram/facebook/threads); frequency pills (daily/3×week/weekly/custom); date range
    with estimated post count; (3) sticky summary bar with live preview + Create button
  - i18n EN/PT/ES — campaigns.new.* namespace (25 keys: title, section headers, all field
    labels/placeholders, frequency options, platform states, summary, cta, limit banners)
  - errors.campaign.generic added to all three locales (limit_trial/limit_starter later removed as dead keys in 7C)
  - Test suite: 470/470 passing; tsc --noEmit --skipLibCheck clean

  - lib/db/campaigns.ts — pauseCampaign, resumeCampaign (atomic status-guarded UPDATE, return row|null),
    softDeleteCampaignGuarded (guards on draft/completed status, returns boolean)
  - app/[locale]/(dashboard)/campaigns/actions.ts — pauseCampaignAction, resumeCampaignAction,
    deleteCampaignAction: UUID Zod validation → auth → business (RLS) → mutate → success/error
  - app/[locale]/(dashboard)/campaigns/actions.test.ts — 13 tests covering UUID validation,
    unauth, guard failures, success paths, DB errors
  - lib/db/campaigns.test.ts — extended with 9 new tests for the three guarded helpers
  - components/campaigns/CampaignCard.tsx — Client Component: name/objective/status badge/platform
    names/post count/created date; View link (buttonVariants); Pause/Resume/Delete buttons shown
    only in valid states; Delete uses AlertDialog confirmation; useTransition + router.refresh()
    on success; inline error message per action
  - app/[locale]/(dashboard)/campaigns/page.tsx — replaced stub: fetches listCampaigns via RLS;
    empty state (inline SVG + headline + CTA) or list of CampaignCards with page header
  - i18n EN/PT/ES — campaigns.list.* (title, new_button, empty.*, card.*) and
    campaigns.status.* (draft/active/paused/completed) in all three locale files
  - Test suite: 492/492 passing; tsc --noEmit --skipLibCheck clean

- Session 8B: Post generation — full AI orchestration + UI wiring:
  - lib/ai/prompts/post-generation.ts — PostGenerationOutputSchema (Zod), PLATFORM_CONSTRAINTS
    (per-platform character/hashtag/style rules), getPlatformConstraintsVersion(),
    postGenerationPrompt (buildSystemPrompt + buildUserMessage with [DATA] injection hardening)
  - lib/campaigns/schedule.ts — schedulePosts: timezone-aware UTC slot generation, per-platform
    optimal days/hours (OPTIMAL_SLOTS), week-cap enforcement, window widening (MAX_WIDENING_PASSES),
    fillExtraSlots fallback, endDate clamp (end-of-day UTC), evenly-spaced pick
  - lib/db/post-generation-sessions.ts — createGenerationSession, getGenerationSession,
    updateGenerationSessionStatus (service-role CRUD for post_generation_sessions table)
  - lib/db/trial-state.ts — incrementPostsGeneratedBy(businessId, amount) RPC wrapper
  - lib/campaigns/generate.ts — generatePostsForCampaign orchestrator (12 steps):
    service-role client → mark generating → idempotency guard → buildCustomerContext →
    trial pre-flight (P-4, R-2) → schedule per platform (canonical order) → runPrompt per
    platform (P-2) → collect-then-insert (P-1) → updateCampaign(active) → increment trial
    counter (R-1) → mark complete; full rollback to 'failed' on any error path
  - app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts — two Server Actions:
    startGenerationAction (UUID validation → auth → idempotency checks → trial pre-flight →
    createGenerationSession → after() background dispatch) and
    getGenerationSessionAction (UUID validation → auth → session ownership check → return status)
  - app/[locale]/(dashboard)/campaigns/[id]/GeneratePostsButton.tsx — Client Component:
    idle → pending → generating (live post count) → complete (auto-redirect) → failed (retry);
    polling via setInterval at 2s; MAX_POLLS derived from config.server.POST_GENERATION_POLL_MAX_SECONDS
  - app/[locale]/(dashboard)/campaigns/[id]/CampaignDetailActions.tsx — GeneratePostsButton
    wired into draft state; pollMaxSeconds prop passed from Server Component parent
  - lib/db/types.ts — GenerationSession, AiGenerationMetadata types added; PostInsert
    ai_generation_metadata widened to AiGenerationMetadata | Record<string, unknown>
  - lib/config.ts — POST_GENERATION_POLL_MAX_SECONDS added (env-configurable, default 120s)
  - Migrations 026–029: post_generation_sessions table, increment_posts_generated_by RPC,
    vault write helpers, increment_campaigns_created corrections
  - i18n EN/PT/ES — campaigns.detail.generate.* (cta, starting, in_progress, success, timeout,
    try_again, error.{quota_exceeded,rate_limited,provider_error,invalid_response,timeout,
    invalid_campaign_state,already_generated,generic})
  - Test suite: 231/231 passing; tsc --noEmit --skipLibCheck clean

- Session 8C: Reviewer audit — security-reviewer + typescript-reviewer parallel review of
  Session 8B post-generation subsystem. 37-item consolidated checklist (28 ✅ / 6 ⚠️ / 5 ❌).
  All 7 ADR-mandated patterns (P-1–P-7) and 2 reversals (R-1, R-2) verified correct.
  5 blockers identified (Fixes 1–5 below), 6 recommendations (some deferred).

- Session 8D: Correction pass — all 5 blockers applied:
  1. **UUID validation on Server Action params (Fix 1):** Both startGenerationAction and
     getGenerationSessionAction now call z.string().uuid().safeParse() at entry; params
     renamed rawCampaignId / rawSessionId so validated const flows through the function.
  2. **console.warn removed (Fix 2):** posts.length mismatch block deleted from generate.ts;
     CLAUDE.md prohibits console.* in committed code; discrepancy observable via session row.
  3. **Double-cast eliminated (Fix 3):** PostInsert.ai_generation_metadata widened to
     AiGenerationMetadata | Record<string, unknown>; `as unknown as` cast removed from generate.ts.
  4. **scheduled_at endDate clamp (Fix 4):** schedulePosts now filters selected slots to
     ≤ endDate (end-of-day UTC) before returning. Widening may produce post-endDate slots in
     the fillExtraSlots fallback; clamp removes them. Fewer posts than count is acceptable
     (posts_created < posts_planned surfaced by session row). New test added:
     "clamps output to endDate — no slot returned after endDate".
  5. **POST_GENERATION_POLL_MAX_SECONDS extracted (Fix 5):** Hardcoded 120 moved to
     config.server; passed as pollMaxSeconds prop from page.tsx → CampaignDetailActions →
     GeneratePostsButton.
  Test suite: 231/231 passing; tsc --noEmit --skipLibCheck clean.

- Session 8A: Campaign detail page built:
  - app/[locale]/(dashboard)/campaigns/[id]/page.tsx — Server Component: auth + RLS-scoped
    getCampaignById (redirect to /campaigns on 404/unowned); renders back link, campaign header
    (name + status badge + Edit button), overview card (objective, special instructions,
    platforms, frequency, date range); passes campaign to CampaignDetailActions
  - app/[locale]/(dashboard)/campaigns/[id]/CampaignDetailActions.tsx — Client Component:
    Draft state: "Ready to generate your posts?" card with total_posts_planned count,
    Generate Posts button (shows coming-soon message inline on click);
    Non-draft state: published/total summary + View Posts link → /campaigns/{id}/posts;
    Danger zone (collapsed by default): Pause button (active campaigns), Resume button
    (paused campaigns), Delete button (draft/completed with AlertDialog confirmation);
    after delete → router.push to /campaigns
  - i18n EN/PT/ES — campaigns.detail.* (back, edit, meta.*, generate.*, posts.*, danger.*)
  - Test suite: 461/461 passing; tsc --noEmit --skipLibCheck clean

- Session 9D: Correction pass — all 5 reviewer fixes applied:
  1. **C5 — Prompt injection sanitization:** Added `sanitizeDataField()` helper to both
     `post-regeneration.ts` and `post-generation.ts` (local copy per file, not shared import).
     Applied to all user-controlled strings inside [DATA] blocks: `previousContent`,
     `previousRationale`, `feedbackNote`, `siblingPostsTopics[]`, `special_instructions`,
     `unique_value_prop`, `alreadyGeneratedTopics[]`. Replaces `[/DATA]` with `[/data-blocked]`.
  2. **E2a — i18n Show more/less:** Added `card.showMore`/`card.showLess` to all three
     locale files (EN/PT/ES). `PostCard.tsx` now uses `t('card.showLess')`/`t('card.showMore')`
     with Unicode arrows.
  3. **E2b — date-fns locale in date dividers:** `PostsClient.tsx` imports `enUS`/`pt`/`es`
     from `date-fns/locale`, builds a `DATE_FNS_LOCALES` map, destructures `locale` prop,
     and passes `{ locale: dateFnsLocale }` to `format()` for date divider labels.
  4. **E7 — formatISO convention:** `listPostsDue()` in `lib/db/posts.ts` uses
     `formatISO(new Date())` instead of `new Date().toISOString()` per CLAUDE.md.
  5. **X1 — FilterPill at module scope:** Moved `FilterPill` out of `PostsClient` render
     to module scope; added `FilterPillProps` with `activeFilter`/`onSelect` props; all 4
     call sites updated.
  Test suite: 331/331 SOSH tests passing; tsc --noEmit --skipLibCheck clean.

- Session 9B: Posts review UI — full implementation:
  - lib/ai/prompts/post-regeneration.ts — PostRegenerationOutputSchema (Zod), postRegenerationPrompt
    (buildSystemPrompt + buildUserMessage with feedbackNote injection)
  - AiGenerationMetadata.previousVersions type fixed (string[] → array of version objects)
  - lib/db/posts.ts — updatePostContentAndMetadata helper (updates content + hashtags +
    increments ai_generation_metadata.regenerationCount, caps previousVersions at 10)
  - 7 Post Review Server Actions (app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts):
    approvePostAction, unapprovePostAction, skipPostAction (with rejection_note), unskipPostAction,
    updatePostContentAction, regeneratePostAction (full runPrompt pipeline), bulkApprovePostsAction
  - app/[locale]/(dashboard)/campaigns/[id]/posts/actions.test.ts — full test suite covering
    all 7 actions (UUID validation, auth guards, optimistic update payloads, error codes)
  - app/[locale]/(dashboard)/campaigns/[id]/posts/page.tsx — Server Component: auth + RLS;
    post counts (approved/draft/skipped/total); back link; summary bar; ready-to-publish banner
    (all approved); empty state with CTA; passes posts + campaign to PostsClient
  - app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx — Client Component:
    optimistic local state; filter pills (all/per-platform/approved/skipped); date dividers;
    sticky filter bar; bulk-approve button (drafts only); renders PostCard per post
  - components/posts/PostCard.tsx — full interactive card: platform colour accent; status pill;
    regeneration count badge; content expand/collapse (>300 chars); hashtag pills; skip inline
    form; edit mode (Textarea + hashtags input); action buttons per status (approve/skip/undo/
    edit/regenerate); optimistic updates with rollback on server error
  - components/posts/RegenerateDialog.tsx — modal with feedback Textarea (min 5 chars);
    submitting state; per-error-code messages; optimistic content/hashtags update on success
  - i18n/en|pt|es/posts.json — new posts namespace (title, back, summary.*, readyBanner.*,
    empty.*, filter.*, bulkApprove, bulkApproveSuccess, card.*, skip.*, regenerate.*);
    wired into i18n/request.ts; legacy posts.* keys removed from common.json
  - All i18n key paths in components aligned to posts.json structure (fixed in this session:
    title {campaignName}, summary sub-keys, readyBanner.*, empty.action, regenerate.error.*,
    regenerate.minChars, regenerate.submitting, card.actions.cancel, bulkApprove)
  - Test suite: 488/488 passing; tsc --noEmit --skipLibCheck clean

- Session 10A: Publishing worker ADR authored (docs/decisions/0005-publishing-worker.md)
  - REVERSAL 1: retry-tracking columns (publish_attempts/last_publish_attempt_at/
    last_publish_error) over jsonb
  - REVERSAL 2: `failed` is terminal — "re-queue back to scheduled" in ADR 0001 §B.5 was
    speculative; retry-from-failed is Phase 2
  - REVERSAL 3: scheduled_at is now mutable — worker bumps it on RATE_LIMITED/NETWORK retry
  - Full error matrix (8 codes), TOKEN_EXPIRED in-tick refresh+retry with per-tick Set loop
    guard, PUBLISH_STUCK_MINUTES=10 strictly greater than maxDuration=60s

- Session 10B: Publishing worker implementation + status UI surfaces (Prompt B7):
  - Migration 20260525100000: publish_attempts/last_publish_attempt_at/last_publish_error
    columns; claim_posts_for_publishing SECURITY DEFINER RPC with REVOKE/GRANT service_role;
    FOR UPDATE SKIP LOCKED claim query
  - lib/db/posts.ts: claimPostsForPublishing, markPostPublished, markPostFailed,
    requeueScheduledPost (incrementAttempts flag), reapStuckScheduledPosts
    (STUCK_REAPED/STUCK_TERMINAL two-statement approach), incrementPublishedCountForCampaign
  - lib/db/post-generation-sessions.ts: recoverStuckGenerationSessions (stale janitor,
    deferred from Session 8)
  - lib/publishing/orchestrator.ts: runPublishTick + runJanitorTick; full 8-code error
    matrix; TOKEN_EXPIRED in-tick refresh+retry; NETWORK exponential backoff ±25% jitter;
    redactTokens helper; per-tick refreshedThisTick Set loop guard
  - app/api/cron/publish/route.ts: CRON_SECRET timing-safe auth (length pre-check +
    timingSafeEqual); X-Cron-Dev-Trigger dev bypass (production rejects header entirely);
    Phase A (janitor + reaper) → Phase B (publish tick); always-200 response
  - vercel.json: * * * * * schedule for /api/cron/publish (Pro; Hobby: */5 * * * *)
  - lib/config.ts: 6 new vars with ADR 0005 §14 defaults (CRON_SECRET, PUBLISH_BATCH_SIZE=25,
    PUBLISH_MAX_ATTEMPTS=5, PUBLISH_RETRY_BACKOFF_SECONDS=60, PUBLISH_STUCK_MINUTES=10,
    POST_GENERATION_SESSION_STALE_MINUTES=15)
  - docs/build-guide/runbooks/cron-secret-rotation.md: full CRON_SECRET rotation runbook
  - Status UI (Prompt B7): PostCard extended with scheduled (indigo animate-pulse dot),
    published (emerald dot + ExternalLink to platform_url), failed (amber dot + localised
    error label from resolveErrorLabel switch + failedAt tooltip) pills; action buttons
    disabled for scheduled/published/failed states; CampaignDetailActions extended with
    "Next post: in Xh Xm" timing + amber failed-banner → ?filter=failed deep-link;
    PostsClient extended with failed filter pill + initialFilter prop wired from searchParams
  - i18n EN/PT/ES: posts.json (card.status.scheduled/published/failed, card.error.* 9 codes,
    filter.failed, card.tooltip.failedAt, card.action.openOnPlatform); common.json
    (campaigns.detail.nextPost, failedBanner, failedBanner_plural, openFailed)
  - Test suite: 289/289 passing; tsc --noEmit --skipLibCheck clean

- Session 10C: Reviewer audit completed — 8 blockers + 2 quick wins identified across
  auth (CRON_SECRET), state machine (requeueScheduledPost timestamp), error routing
  (refresh-retry catch), explicit error cases, tests (reaper ordering + platform gate),
  timestamp coherence (claimPostsForPublishing now param), and convention (config.public.NODE_ENV).
  
- Session 10D: All 8 blockers and 2 quick wins resolved. 13 test files, 204 tests passing.
  tsc --noEmit --skipLibCheck clean.
  Deferred: B2 (metadata RPC), C8 (value-scanning), H5 (comments), W2/W3/W4.

- Session 11A: Stripe billing — full implementation (B6 webhook, B7 upgrade CTAs, B8 billing UI)
  + ESLint correction pass. 706/706 tests passing. tsc --noEmit --skipLibCheck clean.

  **Stripe surface (`/lib/stripe/`):**
  - `client.ts` — lazy singleton `getStripeClient()`; server-only guard (throws if imported in browser)
  - `products.ts` — `PLAN_TO_PRICE_ID` / `planForPriceId()` driven by env vars; bidirectional map
  - `plan.ts` — `PlanCapabilities` interface + `getPlanCapabilities(plan)` — single source of truth
    for all per-plan limits and feature flags (postsPerMonth, activeCampaigns, allowedPlatforms, etc.)
  - `checkout.ts` — `createCheckoutSession` / `createBillingPortalSession` / `NoBillingCustomerError`
  - `webhook.ts` — `parseWebhookEvent` (signature verify) + `dispatchWebhookEvent` (business logic)
  - ESLint boundary rule added: no direct `stripe` npm import outside `lib/stripe/**`

  **Migration 031 — `billing_events` table:**
  - `id TEXT PRIMARY KEY` — Stripe event.id is the PK; unique constraint provides idempotency
  - `processed_outcome` CHECK: applied | ignored_unknown_price | ignored_no_business |
    ignored_duplicate | error
  - RLS: authenticated users SELECT their own business's events; all writes are service-role

  **Webhook idempotency model:**
  - Route pre-records the event before dispatch using event.id as PK
  - Postgres `23505` unique violation → `{ duplicate: true }` → immediate 200, no re-processing
  - Outcome updated after dispatch; initial value is optimistic 'applied'
  - Signature failure → 400; dispatch error → 500 (triggers Stripe retry); duplicates/success → 200

  **Webhook events handled:**
  - `checkout.session.completed` → activates subscription, upgrades plan, records card fingerprint (non-fatal)
  - `customer.subscription.updated` → upgrades/downgrades plan or clears billing on cancellation statuses
  - `customer.subscription.deleted` → clears billing (downgrade to trial)
  - `invoice.payment_failed` → explicit no-op (logged; dunning emails deferred to Phase 3)
  - All other event types → silent no-op; 200 returned

  **Plan-switch UX decision (B8):**
  - New subscriptions → Stripe Checkout (`startCheckoutAction`): full hosted payment flow
  - Plan switches and cancellations → Customer Portal (`openBillingPortalAction`): Stripe manages
    proration, downgrades, and cancellation; no custom plan-switch UI at launch

  **New env vars:**
  - Server (4): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PLUS`, `STRIPE_PRICE_ID_PRO`
  - Public (1): `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

  **New i18n namespace `billing.*`** — full EN/PT/ES covering pricing cards, current plan banner,
  success page, portal access, and trial expiry banner.

  **B7 — Upgrade CTA gate:** `upgradeCtaTargetFor(reason)` in `lib/campaigns/enforcement.ts`
  returns `/billing` for trial and plus limits. Gate value `PLUS_CAMPAIGN_LIMIT = 5` still
  hardcoded in enforcement.ts — not yet reading from `getPlanCapabilities()`. See Backlog.

  **Deferred:** Smoke tests A–F not yet run against live Stripe (dev server confirmed running).

- Session 11B: typescript-reviewer + security-reviewer parallel audit of B6/B7/B8 output.
  3 critical TS issues, 7 medium, 2 critical security, 4 medium security identified.

- Session 11C: Correction pass — all 10 fixes applied and verified.
  299/299 tests passing. tsc --noEmit --skipLibCheck clean. 0 ESLint violations on touched files.

  **Fixes applied:**
  - (B5) Webhook pre-records with 'error' sentinel before dispatch, updates to real outcome after
  - (B6) Documented stale subscription.updated race condition — Phase 2 accepted risk
  - (G4) "Manage billing" link gated on stripe_customer_id presence
  - Zod validation added to startCheckoutAction (plan + locale params)
  - (D5) serverOnly guard added to products.ts to prevent client-side bundling
  - (H1a) Double-cast removed from route.ts payload
  - (H1b) isPostgresError type guard replaces 3 unsafe error casts in billing-events.ts
  - (H2) Redundant type casts removed from webhook.ts fingerprint block
  - (H7) 4 WHY comments added to checkout.ts (client_reference_id, subscription_data)
  - Fingerprint-capture-failure resilience test added to webhook.test.ts

  **Learned skill:** postgres-error-type-guard — safe Supabase error narrowing pattern
  saved to ~/.claude/skills/learned/postgres-error-type-guard.md

- Session 12B: Metrics worker — full Phase 1 implementation (ADR 0006):
  - Migration 20260530120000: `list_posts_for_metrics_sync` plain SQL helper function
    (LEFT JOIN posts → post_metrics, staleness predicate, NULLS FIRST ordering, REVOKE/GRANT)
  - lib/db/posts.ts — `listPostsForMetricsSync` (RPC wrapper, service-role, formatISO args)
  - lib/metrics/orchestrator.ts — `runMetricsSyncTick`: per-platform short-circuit Set<Platform>,
    full §5 outcome matrix, null-vs-zero preservation, structured console.log summary
  - app/api/cron/sync-metrics/route.ts — timing-safe auth, dev-bypass, always-200 response
  - vercel.json — hourly cron `0 * * * *` added alongside publish cron
  - lib/config.ts — `METRICS_SYNC_BATCH_SIZE`, `METRICS_STALE_MINUTES`, `METRICS_MAX_AGE_DAYS`
  - Test suite: orchestrator (8 outcome-matrix cases, short-circuit, batch limit, tick format),
    route (auth, dev-bypass, internal throw), DB helper (RPC params, staleness arg, error throw)
  - 220 tests passing across 15 files; tsc --noEmit --skipLibCheck clean

- Session 12C: Reviewer correction pass — all 5 items resolved:
  1. [HIGH I1] `route.ts` — `now.toISOString()` → `formatISO(now)` in error-path fallback;
     `formatISO` imported from date-fns (only `.toISOString()` in the Session 12B diff)
  2. [HIGH D1] `orchestrator.test.ts` — `PROVIDER_NOT_CONFIGURED` added to `it.each`;
     all 8 `SocialProviderErrorCode` values now covered exactly once
  3. [MEDIUM ADR drift] ADR 0006 §5 — `BAD_REQUEST` removed (never existed in the union);
     `NOT_CONFIGURED` renamed to `PROVIDER_NOT_CONFIGURED` (actual code name)
  4. [MEDIUM H4/H5/H6] `posts.metrics.test.ts` — 3 `expect(true).toBe(true)` tests deleted;
     replaced with a comment block above `describe()` citing the migration as the SQL spec;
     no integration test infrastructure exists
  5. [VERIFY] `orchestrator.ts` — `formatISO(result.fetchedAt)` removed; `result.fetchedAt`
     passed straight through (Option a: `PostMetrics.fetchedAt` is typed `string`, already
     ISO-8601 per provider contract; `formatISO` expects `Date | number`, not `string`);
     test mocks corrected from `fetchedAt: NOW` (Date) to `fetchedAt: formatISO(NOW)` (string)
  28 test files, 348 tests passing; tsc --noEmit --skipLibCheck clean (SOSH files).

- **Session 13A:** Launch Hardening — Sentry observability + CSP + rate limiting (ADR 0007 §B1–B6):
  - Sentry SDK initialized across client, server, and edge runtimes; `lib/observability/sentry-scrub.ts`
    shared scrubber module with CATCH_ALL_SUBSTRINGS; scrubEvent PII scrubber wired into Sentry config
  - Content Security Policy with nonce injection (Middleware) and Report-Only mode; security headers
    (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
  - `auth_rate_limits` and `cron_health` migrations authored and applied to live DB
  - Database-backed rate limiting: `consumeRateLimit` wired into all 4 auth Server Actions
    (signup, login, forgot-password, reset-password)
  - `app/api/_health/route.ts` — health check endpoint with cron job monitoring
  - `lib/config.ts` — all 42 env vars centralized and typed
  - Vercel Speed Insights + Analytics integrated
  - Error message redaction refactored into shared constants
  - 551 tests passing.

- **Session 13B:** Launch Hardening continued — error boundaries + launch checklist (ADR 0007 §B7–B8):
  - `app/global-error.tsx` — root error boundary, inline Stone CSS, multi-locale (en/pt/es),
    Sentry capture on mount, no next-intl dependency
  - `app/[locale]/error.tsx` — locale-scoped error boundary, Tailwind, next-intl, Sentry on mount
  - `app/[locale]/not-found.tsx` — Server Component 404 page, next-intl, no Sentry (by design)
  - `i18n/en|pt|es/errors.json` — error boundary translations for all three locales
  - `docs/launch-checklist.md` — all Section 1 `<fill>` cells replaced with concrete
    `vercel env ls production | grep` commands; `SENTRY_DSN` corrected to
    `NEXT_PUBLIC_SENTRY_DSN`; Section 8 scrubEvent route-path exclusion check added
  - 551 tests passing.

- **Session 13C:** Reviewer audit — typescript-reviewer review of the full ADR 0007 (Launch Hardening)
  implementation. 6 code findings and 3 ADR doc-drift issues identified.

- **Session 13D:** Correction pass — all 6 code findings resolved, ADR 0007 aligned in 3 sections:
  - B6: tunnelRoute removed from `withSentryConfig` in next.config.ts
  - A8: `Sentry.setUser({ id: user.id })` added to dashboard layout (id only — no PII)
  - H5: Orchestrator kind strings hyphenated — `publish-tick`, `metrics-sync-tick`
  - F2: `detectLocale` uses `Object.hasOwn()` — prototype-poisoning safe
  - A1: `CATCH_ALL_SUBSTRINGS` single source of truth — exported from sentry-scrub.ts,
    imported and re-exported by errors.ts; reference equality enforced by test
  - D15: `signupAction` drops unused email arg from `consumeRateLimit`
  - ADR §3.2: sourcemaps config pattern documented (deleteSourcemapsAfterUpload)
  - ADR §3.5: janitor-cron Sentry.withMonitor example documented
  - ADR §4.2: middleware ordering corrected (auth redirect → x-pathname → i18n → nonce → CSP)
  - New tests: prototype-poisoning cases in global-error.test.tsx, CATCH_ALL_SUBSTRINGS ===
    reference equality in errors.test.ts, Sentry.setUser integration in layout.test.tsx
  - 691/691 tests passing; tsc --noEmit --skipLibCheck clean.

- **Session 13.5B:** QStash trigger migration — dual-mode cron authentication (ADR 0005 Amendment 1):
  - `lib/cron/qstash-auth.ts` — `verifyQStashRequest` helper + `QStashAuthError` class;
    10 tests passing (Receiver constructor mock, valid/invalid/missing signature, env var absent)
  - `app/api/cron/publish/route.ts` — hard-branched on `CRON_TRIGGER`: GET+Bearer in `secret` mode,
    POST+QStash signature in `qstash` mode; 405 returned for wrong method in either mode
  - `app/api/cron/sync-metrics/route.ts` — same dual-mode pattern
  - `docs/runbooks/qstash-setup.md` and `docs/runbooks/vercel-cron-restore.md` created
  - `vercel.json` crons array removed (QStash schedules the jobs from the Upstash console)
  - `docs/launch-checklist.md` §3 updated for QStash verification gates
  - @upstash/qstash ^2.11.0 added to package.json
  - 36 route tests + 10 auth tests passing; commit 4840f47.

- **Session 13.5C:** Reviewer audit — security + correctness review of QStash migration (Opus 4.7).
  Two blockers surfaced: B7 (caret range on @upstash/qstash) and E1/H1/I3 (duplicate tick logs).

- **Session 13.5D:** Correction pass — both reviewer blockers resolved:
  - B7: `@upstash/qstash` pinned to exact version `2.11.0` (no caret) in package.json;
    lockfile regenerated
  - E1/H1/I3: `triggeredBy` parameter threaded through `runPublishTick`, `runJanitorTick`,
    and `runMetricsSyncTick` signatures; orchestrators emit one canonical log line per tick
    carrying both `triggeredBy` and all summary fields; duplicate route-level tick logs deleted
  - Route tests updated to assert `triggeredBy` via `vi.mocked(orchestratorFn).toHaveBeenCalledWith`
    (orchestrators are mocked in route tests); `it.each(['qstash', 'secret'])` parametrized
    tests added in both orchestrator test files
  - 89 tests passing across cron routes + auth + orchestrators; commit b62a29c.

## What's next

**Session 14 — Transactional Email (Resend integration)**

Start with an Architect session to produce an ADR before building. Anticipated scope:
- ADR for email strategy — welcome email, trial expiry warning, payment failed, post published digest
- Resend SDK integration via `lib/email/` abstraction (mirrors `lib/ai/` and `lib/stripe/` pattern)
- Email templates with branding and plain-text fallbacks
- i18n EN/PT/ES for all transactional email content
- Trigger wiring: Stripe webhook (subscription events), trial state transitions, publishing worker

---

## Backlog / Deferred

### Session 5D

- **fixture-key by prompt_id**: lib/ai/__fixtures__/ should be keyed by prompt_id so
  fixtures are reusable across prompt versions without collision.
- **Extra IP ranges**: 0.0.0.0/8 (this-network broadcast) and fe80::/10 (link-local IPv6)
  are not yet in the SSRF blocklist. Low risk in practice but should be added.
- **Error cast cleanup**: `(error as { message: string })` pattern appears in ~15 places
  across lib/db/. Extract to a typed `getErrorMessage(unknown): string` helper.
- **fetch_failed dead enum**: The `fetch_failed` value exists in an error enum but is
  never produced by the current website-fetcher (it returns null on failure). Remove or connect it.
- **AI_RATE_LIMIT_POST_GENERATION_PER_MIN**: Config var and countRecentCalls filter are
  wired up, but post-generation prompts don't exist yet. Verify the limit applies correctly
  when Session 6 lands.

### Session 6D

- **A3 — TOCTOU race on disconnect** (ADR deviation, low-probability): deactivateSocialAccount
  reads then updates the social_accounts row in two round-trips. A concurrent connect could
  race between the read and the update. Acceptable until publishing worker lands; revisit then.
- **Silent vault cleanup logging**: vault_delete_secret failures in the 6e reconnect path are
  swallowed silently. Add structured logging once a proper logger (pino/similar) is introduced.
- **AlertDialog visual QC**: the disconnect confirmation dialog renders but has not been
  verified in a browser across all three locales and dark/light modes. Schedule a UI QC pass.

### Session 7C

- **TOCTOU on starter cap:** countActiveCampaigns + createCampaign is two round-trips;
  a concurrent request could slip a 3rd campaign through on the Starter plan. Low probability
  in practice — revisit when concurrent usage warrants it (Phase 2).
- **notFound() over redirect on missing campaign:** detail page currently redirects to
  /campaigns on 404/unowned; Next.js convention prefers notFound(). Cosmetic — no security
  impact given RLS guards.
- **Equal-date endDate edge case:** Zod refine uses `>` which already rejects same-day
  (error message updated to make this explicit). No functional gap.

### Session 8C

- **Schema enforcement on prompt output (B4):** PostGenerationOutputSchema validates structure
  but does not enforce platform-specific hashtag counts or content length ranges at parse time.
  Acceptable at launch — add stricter Zod refinements in a future prompt iteration pass.
- **Custom frequency scheduler test (E6):** schedulePosts is tested for daily/3x_week/weekly
  but not for `frequency='custom'` with an unusual postsPerWeek value. Add a targeted test
  if custom frequency is user-facing.
- **updateCampaign atomic guard:** generate.ts step 10 calls updateCampaign without an atomic
  `WHERE status='draft'` guard. Low risk (orchestrator already verified draft status in step 3),
  but a concurrent request could slip through. Revisit when concurrent generation is possible (Phase 2).
- **toISOString() consistency:** lib/db/posts.ts still uses `.toISOString()` directly in a few
  places instead of date-fns `formatISO()`.

### Session 11A

- **Cross-file capability-hardcoding sweep:** `lib/stripe/plan.ts` is the single source of
  truth for plan limits via `getPlanCapabilities()`, but several files still hardcode values
  that should read from it:
  - `lib/campaigns/enforcement.ts` — `PLUS_CAMPAIGN_LIMIT = 5` hardcoded; should be
    `getPlanCapabilities('plus').activeCampaigns`
  - `lib/ai/runner.ts` — trial post cap reads `config.server.AI_TRIAL_POST_CAP`; verify it
    aligns with `getPlanCapabilities('trial').postsPerMonth` or consolidate the two sources
  - Platform config — platform allow-lists per plan should reference
    `getPlanCapabilities(plan).allowedPlatforms` rather than being re-specified elsewhere
  - Full sweep: grep for hardcoded plan-limit integers (`1`, `2`, `5`, `30`, `50`) across
    `lib/` and replace with `getPlanCapabilities()` lookups.
- **Smoke tests A–F:** Not yet run against live Stripe keys. Run before going live:
  webhook idempotency, pricing page render, checkout flow, Stripe portal, trial banner,
  signature failure (400).

### Session 13.5C

- **C4/H2 — Bearer-side cron-auth-failure warn log:** The `secret` (Bearer) branch does not emit a
  structured `{ kind: 'cron-auth-failure' }` warn log on failed auth, unlike the QStash branch which
  logs reason + route + trigger. Low operational impact at launch but inconsistent with the QStash
  branch's observability. Add a parallel `console.warn(JSON.stringify({ kind: 'cron-auth-failure',
  route, trigger: 'secret', reason: ... }))` to both route Bearer guards in a future correction pass.
- **G1/G2 — ADR 0005 + 0006 cross-reference drift:** ADR 0005 Amendment 1 and ADR 0006 §12/§13
  were not updated to cross-reference each other after the QStash migration. Resolve in a dedicated
  doc pass — no code change required.
- **vercel.json cosmetic:** vercel.json retains commented-out cron stanza (left as a rollback reference).
  Remove the comment block once QStash is confirmed stable in production.

### Session 13D

- **H1 — launch-checklist tunable granularity:** `docs/launch-checklist.md` §1 collapses ~14
  tunable parameters into one grep row. Expand to per-var rows referencing ADR §8.1 when an
  operator complains. Not blocking launch.
- **B5 — withSentryConfig SENTRY_AUTH_TOKEN:** currently relies on @sentry/nextjs SDK
  auto-pickup of SENTRY_AUTH_TOKEN rather than passing the field explicitly. ADR §3.2 documents
  both forms; convert to explicit when next touching next.config.ts.

---

## Key Decisions

### Sessions 3B + 3D

- SocialProvider abstraction enforced at ESLint level (no-restricted-imports rule)
- Vault access is always service-role; lib/social/ layer owns all vault I/O
- MockProvider injected via SOCIAL_PROVIDER env var (no test-only DI plumbing)
- OAuth state signed as HMAC-SHA256 JWT (stateless, no DB round-trip)
- Vault helpers exposed as Supabase RPC (not direct vault.secrets writes)
- POSTIZ_BASE_URL is the canonical env var name (not POSTIZ_API_URL)
- Postiz integration tests gated on POSTIZ_INTEGRATION_TEST_ENABLED env var
- OAUTH_STATE_SECRET requires min 32 chars — boot fails fast if missing

### Session 4A

- **onboarding_completed is service-role gated:** `completeOnboarding()` uses the lazy dynamic
  import pattern so the service-role client is never accidentally bundled into client code.
- **Onboarding guard via x-pathname header:** middleware.ts injects `x-pathname`; dashboard
  layout reads it to detect when the user is already on an `/onboarding` route and avoid a redirect loop.
- **Step page architecture:** Each onboarding step is a Server Component page wrapping a Client
  Component form. The Server Component renders the shell; the form reads `useActiveBusiness()`.
- **Native `<select>` for industry dropdown:** shadcn/ui Select (`@base-ui/react/select`) has
  uncertain API stability for this pattern; native HTML `<select>` styled with Tailwind is used instead.
- **Tone stored as JSON, tags as CSV:** Step 2 receives `tone` as a JSON-parsed array and
  `keywords`/`avoid_words` as comma-split strings, serialized via hidden `<input>` fields.
- **Base UI DropdownMenu — no asChild:** shadcn v4 does not expose `asChild` on Menu primitives.
  `DropdownMenuTrigger` is styled directly; `<Link>` and `<form>` are children inside `DropdownMenuItem`.
- **Skip for now sets onboarding_completed:** `skipOnboardingAction` calls `completeOnboarding()`
  via service-role and redirects to campaigns.
- **Step 2 Zod schema:** tone validated as array after guarded JSON.parse; keywords/avoid_words
  split from CSV. All fields optional except tone (defaults to `[]`).
- **Step 1 Zod schema:** name required; businessId derived server-side via getBusinessByOwner,
  never from FormData.

### Session 5

- **8-step runner** (`lib/ai/runner.ts`): trial cap → rate limit (per prompt_id) → message
  assembly with cache_control for system prompts >4096 chars → SDK call with one retry on
  429/5xx → Zod parse → cost calc → ai_usage INSERT in finally (never throws) → trial counter
  RPC (success path only, errors swallowed).
- **Per-prompt rate limits**: countRecentCalls filters by (business_id, prompt_id, window).
  brand-voice: 10/min; post-gen: 30/min. Env-configurable via config.server.
- **Atomic trial increments**: Postgres functions increment_brand_voice_attempts /
  increment_posts_generated do a single `UPDATE ... SET col = col + 1`. No read round-trip.
- **undici pinned dispatcher**: fetchWebsiteText resolves DNS once, checks ALL addresses,
  then creates an Agent whose connect.lookup always returns the validated IP — eliminates DNS
  rebinding TOCTOU window.

### Session 11A

- **Stripe SDK boundary enforced at ESLint level:** `no-restricted-imports` paths rule bans
  direct `stripe` npm imports outside `lib/stripe/**`. Test files (`*.test.ts`) excluded so
  they can import stripe for mocking. Uses `paths` (exact match), not `patterns`, to avoid
  accidentally catching `@/lib/stripe/*` internal imports.
- **Plan-switch via Customer Portal, not Checkout:** `startCheckoutAction` is for new
  subscriptions only. Existing subscribers use `openBillingPortalAction` (Stripe-hosted portal)
  for upgrades, downgrades, and cancellations. No custom plan-switch UI at launch.
- **`startCheckoutAction(locale, plan)` takes locale as a parameter:** No `getLocale()` helper
  exists in Server Actions; Client Component passes locale from `useParams()`.
- **`billing_events.id` is the Stripe event.id (TEXT PK):** Idempotency is enforced by the
  primary key constraint. Duplicate detection is a Postgres `23505` unique violation, not an
  application-level query. Pre-record before dispatch; update outcome after.
- **`invoice.payment_failed` is an explicit no-op at launch:** The event is recorded and
  returns outcome 'applied' with a null businessId. Dunning emails and grace-period logic
  are Phase 3.

### Sessions 13A–D (ADR 0007 — Launch Hardening)

- **Sentry.setUser passes id only:** no email, no name, no PII ever set on the Sentry user context.
- **CATCH_ALL_SUBSTRINGS single source of truth:** exported from `lib/observability/sentry-scrub.ts`;
  `lib/social/errors.ts` imports and re-exports it. Reference equality enforced by test — prevents
  accidental divergence if one copy is edited and not the other.
- **Object.hasOwn over `in` operator for locale detection:** `in` traverses the prototype chain
  and is vulnerable to prototype-poisoning attacks. `Object.hasOwn` checks own properties only.
- **tunnelRoute excluded from withSentryConfig:** increases attack surface without sufficient
  benefit at our scale. Removed in Session 13D correction pass.
- **global-error.tsx has no next-intl dependency:** the root error boundary must render without
  the i18n provider, which may itself have crashed. Locale detection is manual with an
  Object.hasOwn guard and a hardcoded EN fallback.

### Session 13.5B–D (ADR 0005 Amendment 1 — QStash trigger migration)

- **CRON_TRIGGER hard-branch, not feature flag:** Routes branch at entry on `config.server.CRON_TRIGGER`.
  GET returns 405 in `qstash` mode; POST returns 405 in `secret` mode. Dev-bypass (`X-Cron-Dev-Trigger`)
  is only consulted in the `secret` branch — never in the `qstash` branch.
- **@upstash/qstash pinned exactly:** `"2.11.0"` (no caret). ADR Amendment 1 mandates exact pinning
  for security-critical SDKs whose verification logic must not silently change between deploys.
- **Canonical tick log lives in the orchestrator:** `publish-tick`, `janitor_tick`, and
  `metrics-sync-tick` log lines are emitted once per tick from the orchestrator, carrying both
  `triggeredBy` and all summary fields. Routes do not emit tick logs — they delegate to orchestrators.

---

## Known gotchas

- **`npm run build` fails (pre-existing):** ECC remotion skill files cause Next.js tsc
  (without `--skipLibCheck`) to error. Use `npm run dev` for local work. Do not fix in a Builder session.
- **`middleware.ts` deprecation warning:** Next.js 16 prefers `proxy`. Not renamed yet —
  belongs in a dedicated correction pass, not a Builder session.
- **Bare `npx vitest run` picks up ECC tests:** Always scope to SOSH paths, e.g.
  `npx vitest run lib/db lib/social lib/campaigns lib/ai lib/observability lib/publishing lib/metrics app/global-error "app/[locale]/(dashboard)" "app/[locale]/(auth)"`.
  Bare vitest matches ECC files that call `process.exit()` and fail.
- **tsc must use `--skipLibCheck`:** Bare `npx tsc --noEmit` surfaces ECC remotion errors.
  Always use `npx tsc --noEmit --skipLibCheck`.
- **Migrations applied through 031 + auth_rate_limits + cron_health:** All migrations through 031
  (billing_events) plus the two Session 13A migrations (auth_rate_limits, cron_health) have been
  applied to the live Supabase DB as of Session 13A.
- **OAuthAuthorizeInput has 2 extra fields vs ADR §2** (platform, state — Builder additions).
  Document in ADR 0002 open follow-ups.
- **ECC commands use `/everything-claude-code:` prefix**, not `/ecc:`.
- **`npm run db:migrate` requires `DATABASE_URL`** (Supabase transaction pooler connection string).
