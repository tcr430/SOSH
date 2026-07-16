Session 2C — Database & Security Review                                                                                                                          
  Status: BLOCKED — multiple issues require resolution before Session 3 implementation begins.                                                                                    
  ---
  CRITICAL (must fix before any new code is written)

  ┌─────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬────────────────────────────┐
  │  #  │                                                       Finding                                                        │           Where            │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────┤
  │     │ Soft-delete filter missing from all campaign and post queries — listCampaigns, getCampaignById, listPostsByCampaign, │ lib/db/campaigns.ts,       │
  │ C-1 │  getPostById return soft-deleted rows. The ADR explicitly says /lib/db/ enforces this filter; none of these helpers  │ lib/db/posts.ts            │
  │     │ do.                                                                                                                  │                            │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────┤
  │ C-2 │ listPostsDue will publish soft-deleted posts — no deleted_at IS NULL guard. An approved post that is then            │ lib/db/posts.ts:58         │
  │     │ soft-deleted will still be sent to the publishing worker.                                                            │                            │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────┤
  │     │ No createServiceRoleClient() factory exists — ai_usage writes, Vault token reads, trial_state writes, and            │ lib/supabase/ (missing     │
  │ C-3 │ listPostsDue all require service-role access, but there is no sanctioned way to construct that client. All of        │ file)                      │
  │     │ /lib/ai/ and /lib/social/ depend on it.                                                                              │                            │
  └─────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴────────────────────────────┘

  ---
  HIGH (block on these before merging)

  ┌─────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────┬────────────────────────────────────┐
  │  #  │                                                   Finding                                                    │               Where                │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │     │ updateBusiness allows plan self-upgrade — BusinessUpdate includes plan, stripe_customer_id,                  │ lib/db/businesses.ts:45,           │
  │ H-1 │ stripe_subscription_id. An authenticated user can call updateBusiness({ plan: 'pro' }) and RLS permits it.   │ lib/db/types.ts:69                 │
  │     │ Revenue bypass.                                                                                              │                                    │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │ H-2 │ post_metrics and engagement_inbox allow authenticated INSERT/UPDATE/DELETE — should be service-role-only     │ Migrations 11, 12                  │
  │     │ writes (matching ai_usage/trial_state). Authenticated users can fabricate metrics and fake engagement items. │                                    │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │ H-3 │ Post status machine not enforced in updatePost — a caller can set status: 'published' directly, bypassing    │ lib/db/posts.ts:42                 │
  │     │ the approval workflow. PostUpdate also does not exclude business_id, campaign_id, or published_at.           │                                    │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │     │ get_user_business_ids() not wrapped in (SELECT …) in RLS policies — the STABLE caching annotation only takes │ Migrations 5–13 (all policy        │
  │ H-4 │  effect when wrapped: business_id = ANY ((SELECT get_user_business_ids())). Without it, the function         │ bodies)                            │
  │     │ evaluates per-row, turning every multi-row query into N function calls.                                      │                                    │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │     │ deactivateSocialAccount does not delete Vault secrets — the ADR requires three steps on disconnect (set      │                                    │
  │ H-5 │ is_active = false, vault.delete_secret(), null the vault ID columns). Only step 1 is implemented. Tokens     │ lib/db/social-accounts.ts:60       │
  │     │ remain in Vault indefinitely. GDPR erasure risk.                                                             │                                    │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │ H-6 │ listStalePostMetrics and listAiUsageByBusiness are unbounded — no LIMIT. Self-DoS for any business with      │ lib/db/post-metrics.ts:31,         │
  │     │ meaningful history. The metrics worker will fan out to N API calls at once.                                  │ lib/db/ai-usage.ts:18              │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │ H-7 │ listSocialAccounts returns inactive accounts — no is_active filter. Callers see revoked connections.         │ lib/db/social-accounts.ts:4        │
  ├─────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
  │ H-8 │ listEngagementItems has no ORDER BY — the index is (business_id, status, received_at DESC) but the query     │ lib/db/engagement.ts:9             │
  │     │ doesn't use .order('received_at', { ascending: false }). Inbox is unordered.                                 │                                    │
  └─────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────┴────────────────────────────────────┘

  ---
  MEDIUM

  ┌─────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────┐
  │  #  │                                                     Finding                                                     │              Where              │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ M-1 │ No auth guard in middleware — unauthenticated requests reach /(dashboard)/ routes. Server Components must       │ middleware.ts                   │
  │     │ individually check auth or routes become public.                                                                │                                 │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ M-2 │ No security headers in next.config.ts — no CSP, X-Frame-Options, HSTS, or Referrer-Policy.                      │ next.config.ts                  │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ M-3 │ deleted_at not excluded from BusinessUpdate, CampaignUpdate, PostUpdate — callers can un-soft-delete records by │ lib/db/types.ts                 │
  │     │  passing deleted_at: null.                                                                                      │                                 │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ M-4 │ getBusinessById / getBusinessByOwner don't filter deleted_at IS NULL — safe with RLS-scoped client, but returns │ lib/db/businesses.ts            │
  │     │  deleted rows when called with service-role.                                                                    │                                 │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ M-5 │ new Date().toISOString() in soft-delete functions — violates the date-fns convention from CLAUDE.md. Clock      │ businesses.ts:67,               │
  │     │ drift between app and DB also affects timestamp consistency with the trigger-set updated_at.                    │ campaigns.ts:65, posts.ts:61    │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ M-6 │ trial_card_fingerprint returned in every getTrialState() response — treat as sensitive; should be excluded from │ lib/db/trial-state.ts           │
  │     │  client-facing reads or returned only to service-role consumers.                                                │                                 │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │     │ Publishing queue index deviates from ADR — migration creates (scheduled_at) WHERE status = 'approved'; ADR      │                                 │
  │ M-7 │ specifies (status, scheduled_at) WHERE status = 'approved'. Functionally works but diverges from spec and       │ Migration 10                    │
  │     │ cannot serve index-only scans.                                                                                  │                                 │
  ├─────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤
  │ M-8 │ stripe_customer_id uses plain UNIQUE instead of partial unique index — ADR specifies WHERE stripe_customer_id   │ Migration 3                     │
  │     │ IS NOT NULL partial form to avoid index bloat.                                                                  │                                 │
  └─────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────┘

  ---
  LOW

  ┌─────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬────────────────────────┐
  │  #  │                                                          Finding                                                          │         Where          │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-1 │ auth.uid() in businesses SELECT policy not wrapped as (SELECT auth.uid())                                                 │ Migration 3            │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-2 │ Trigger functions create_trial_state_for_new_business and start_trial_on_first_social_account lack REVOKE ALL FROM public │ Migrations 7, 8        │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-3 │ set_updated_at() lacks SET search_path = public                                                                           │ Migration 2            │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-4 │ No CHECK >= 0 on trial_state counter columns                                                                              │ Migration 7            │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-5 │ No CHECK >= 0 on post_metrics metric columns                                                                              │ Migration 11           │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-6 │ listCampaigns, listPostsByCampaign have no ORDER BY — non-deterministic UI ordering                                       │ campaigns.ts, posts.ts │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-7 │ Vault UUID columns typed as plain string — no branded type or Zod UUID validation                                         │ lib/db/types.ts        │
  ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────┤
  │ L-8 │ PostCSS moderate CVE in Next.js 16.2.4 dependency chain                                                                   │ package.json           │
  └─────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴────────────────────────┘

  ---
  Recommended fix order for Session 2D

  1. Create lib/supabase/service.ts with createServiceRoleClient() (C-3)
  2. Add .is('deleted_at', null) to all list/get helpers in campaigns.ts and posts.ts (C-1, C-2)
  3. Remove plan, stripe_customer_id, stripe_subscription_id from BusinessUpdate; add updateBusinessPlan() service-role-only function (H-1)
  4. Drop authenticated INSERT/UPDATE/DELETE policies from post_metrics and engagement_inbox (H-2)
  5. Enforce post status machine in updatePost; create approvePost, rejectPost, schedulePost functions (H-3)
  6. Wrap all RLS policy calls: business_id = ANY ((SELECT get_user_business_ids())) (H-4)
  7. Add vault cleanup steps to deactivateSocialAccount (coordinate with /lib/social/) (H-5)
  8. Add LIMIT parameters to listStalePostMetrics and listAiUsageByBusiness (H-6)
  9. Add is_active filter / separate listActiveSocialAccounts (H-7)
  10. Add .order('received_at', { ascending: false }) to listEngagementItems (H-8)
  11. Add auth redirect to middleware (M-1)
  12. Exclude deleted_at from all *Update types (M-3)

  Ready for the builder to act on these. The migration files for issues H-2, H-4, L-2, L-3, L-4, L-5 will require new migration files (don't edit existing
  ones).