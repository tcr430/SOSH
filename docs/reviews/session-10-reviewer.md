Session 10C — Reviewer Audit (Publishing Worker)

  Three parallel agents (security-reviewer, typescript-reviewer, database-reviewer) audited Session 10B against the 8-section checklist.
  Consolidated findings below.

  Consolidated Findings Table
  Section: A1
  Check: timingSafeEqual used
  Status: ✅
  File:Line: route.ts:22,29
  Notes: —
  ────────────────────────────────────────
  Section: A2
  Check: Buffer length pre-check
  Status: ✅
  File:Line: route.ts:22,29
  Notes: —
  ────────────────────────────────────────
  Section: A3
  Check: Prod rejects X-Cron-Dev-Trigger
  Status: ✅
  File:Line: route.ts:18–32
  Notes: —
  ────────────────────────────────────────
  Section: A4
  Check: CRON_SECRET min-length in prod
  Status: ❌
  File:Line: config.ts:32
  Notes: default('') — empty secret + Authorization: Bearer  = bypass
  ────────────────────────────────────────
  Section: A5
  Check: 401 body leaks nothing
  Status: ✅
  File:Line: route.ts:35
  Notes: —
  ────────────────────────────────────────
  Section: A6
  Check: No process.env CRON_SECRET outside config
  Status: ✅
  File:Line: grep clean
  Notes: —
  ────────────────────────────────────────
  Section: B1
  Check: claim/reaper/increment all SECURITY DEFINER + REVOKE/GRANT
  Status: ✅
  File:Line: both migrations
  Notes: —
  ────────────────────────────────────────
  Section: B2
  Check: Atomic conditional UPDATE on transitions
  Status: ⚠️ 
  File:Line: posts.ts:127-155, 392-424
  Notes: markPostFailed + requeueScheduledPost do read-then-write (metadata merge in app code)
  ────────────────────────────────────────
  Section: B3
  Check: Reaper before claim in route handler
  Status: ✅
  File:Line: route.ts:47,57,68
  Notes: —
  ────────────────────────────────────────
  Section: B4
  Check: markPostPublished single UPDATE for platform_post_id + status
  Status: ✅
  File:Line: posts.ts:364-375
  Notes: —
  ────────────────────────────────────────
  Section: B5
  Check: Reaper has STUCK_REAPED + STUCK_TERMINAL two-statement
  Status: ✅
  File:Line: 20260525_helpers.sql:29-47
  Notes: —
  ────────────────────────────────────────
  Section: B6
  Check: PUBLISH_STUCK_MINUTES (10m) > maxDuration (60s)
  Status: ✅
  File:Line: config.ts:35, route.ts:9
  Notes: —
  ────────────────────────────────────────
  Section: B7
  Check: last_publish_attempt_at updated on every transition out of scheduled
  Status: ❌
  File:Line: posts.ts:404-413
  Notes: requeueScheduledPost does NOT update it — reaper window measured from original claim, not requeue
  ────────────────────────────────────────
  Section: C1
  Check: All 8 error codes have explicit case
  Status: ⚠️ 
  File:Line: orchestrator.ts:145-228
  Notes: Only TOKEN_EXPIRED/RATE_LIMITED/NETWORK explicit; TOKEN_REVOKED/PLATFORM_REJECTED/NOT_IMPLEMENTED/PROVIDER_NOT_CONFIGURED/UNKNOWN
    all fall through default. Functionally correct but structurally fragile. ADR 0005 §5 names "BAD_REQUEST"/"NOT_CONFIGURED" don't exist in
    actual type — type wins
  ────────────────────────────────────────
  Section: C2
  Check: One refresh per socialAccountId per tick
  Status: ✅
  File:Line: orchestrator.ts:77,147
  Notes: —
  ────────────────────────────────────────
  Section: C3
  Check: Refresh doesn't increment publish_attempts
  Status: ✅
  File:Line: orchestrator.ts:146-183
  Notes: —
  ────────────────────────────────────────
  Section: C4
  Check: Refresh-then-retry handles non-TOKEN_EXPIRED errors correctly
  Status: ❌
  File:Line: orchestrator.ts:155-167
  Notes: Bare catch(e2) routes ALL retry errors to terminal failed with TOKEN_REVOKED. NETWORK/RATE_LIMITED on retry permanently fail —
    violates ADR 0005 §6
  ────────────────────────────────────────
  Section: C5
  Check: RATE_LIMITED uses retryAfterSeconds, incrementAttempts=false
  Status: ✅
  File:Line: orchestrator.ts:187-194
  Notes: —
  ────────────────────────────────────────
  Section: C6
  Check: NETWORK backoff = base*2^attempts ±25%, pre-increment, incrementAttempts=true
  Status: ✅
  File:Line: orchestrator.ts:206-214
  Notes: —
  ────────────────────────────────────────
  Section: C7
  Check: NOT_CONFIGURED terminal
  Status: ✅
  File:Line: default branch
  Notes: —
  ────────────────────────────────────────
  Section: C8
  Check: redactTokens on err.details before write
  Status: ✅
  File:Line: orchestrator.ts:221-227
  Notes: redactTokens is key-name-based only; doesn't scan values (defence-in-depth gap)
  ────────────────────────────────────────
  Section: D1
  Check: Claim has explicit non-tenant filters + SKIP LOCKED + TOCTOU re-assert
  Status: ✅
  File:Line: publishing_worker.sql:30-41
  Notes: —
  ────────────────────────────────────────
  Section: D2
  Check: Campaign counter increment atomic single UPDATE
  Status: ✅
  File:Line: helpers.sql:64-69
  Notes: —
  ────────────────────────────────────────
  Section: D3
  Check: Failed posts retain errorCode/errorAt/details
  Status: ✅
  File:Line: posts.ts:138,145
  Notes: —
  ────────────────────────────────────────
  Section: D4
  Check: CHECK constraints >= 0 and <= 10, independent nullability
  Status: ✅
  File:Line: publishing_worker.sql:6,7,10-13
  Notes: —
  ────────────────────────────────────────
  Section: D5
  Check: No raw tokens in log lines
  Status: ✅
  File:Line: orchestrator.ts:73,128,251
  Notes: —
  ────────────────────────────────────────
  Section: E1
  Check: No imports of postiz-provider/mock-provider/vault/errors outside /lib/social/
  Status: ✅
  File:Line: grep clean
  Notes: —
  ────────────────────────────────────────
  Section: E2
  Check: /lib/publishing/ imports only permitted modules
  Status: ✅
  File:Line: orchestrator.ts:13
  Notes: —
  ────────────────────────────────────────
  Section: E3
  Check: Cron route is only non-test caller
  Status: ✅
  File:Line: grep
  Notes: —
  ────────────────────────────────────────
  Section: F1
  Check: PostCard disables Approve/Skip/Edit on scheduled/published/failed
  Status: ✅
  File:Line: PostCard.tsx:353-433
  Notes: Status-gated render; legacyStatusKey forced cast at line 167 misleading but benign
  ────────────────────────────────────────
  Section: F2
  Check: rel="noopener noreferrer" target="_blank"
  Status: ✅
  File:Line: PostCard.tsx:214-221
  Notes: —
  ────────────────────────────────────────
  Section: F3
  Check: All 3 locales identical error.* keys
  Status: ✅
  File:Line: posts.json:45-54
  Notes: —
  ────────────────────────────────────────
  Section: F4
  Check: "Next post" handles null scheduled_at
  Status: ✅
  File:Line: CampaignDetailActions.tsx:110
  Notes: —
  ────────────────────────────────────────
  Section: F5
  Check: failedBanner pluralisation wired
  Status: ✅
  File:Line: common.json:275-276
  Notes: —
  ────────────────────────────────────────
  Section: G1
  Check: Per-error-code tests with MockProvider
  Status: ⚠️ 
  File:Line: orchestrator.test.ts:284-312
  Notes: Tests exist for NOT_IMPLEMENTED/PROVIDER_NOT_CONFIGURED/UNKNOWN but don't assert last_publish_error value
  ────────────────────────────────────────
  Section: G2
  Check: Refresh-then-success test
  Status: ⚠️ 
  File:Line: orchestrator.test.ts:160-173
  Notes: Missing publish_attempts unchanged assertion
  ────────────────────────────────────────
  Section: G3
  Check: Refresh-then-fail test
  Status: ✅
  File:Line: orchestrator.test.ts:175-187
  Notes: —
  ────────────────────────────────────────
  Section: G4
  Check: Recovery-before-claim ordering tested
  Status: ❌
  File:Line: absent
  Notes: No test seeds stale scheduled + fresh approved + asserts both → published
  ────────────────────────────────────────
  Section: G5
  Check: Platform gate tested
  Status: ❌
  File:Line: absent
  Notes: No test that approved Instagram is NOT claimed
  ────────────────────────────────────────
  Section: G6
  Check: Idempotency short-circuit
  Status: ✅
  File:Line: n/a per ADR §7
  Notes: —
  ────────────────────────────────────────
  Section: H1
  Check: formatISO everywhere
  Status: ❌
  File:Line: posts.ts:346
  Notes: claimPostsForPublishing creates its own new Date() — ignores threaded now, breaks tick coherence
  ────────────────────────────────────────
  Section: H2
  Check: No process.env outside config
  Status: ❌
  File:Line: route.ts:13
  Notes: process.env.NODE_ENV direct read; should use config.public.NODE_ENV
  ────────────────────────────────────────
  Section: H3
  Check: One structured log per tick
  Status: ✅
  File:Line: orchestrator.ts:73,128,251
  Notes: Empty-batch path logs durationMs: 0 (cosmetic)
  ────────────────────────────────────────
  Section: H4
  Check: No any types
  Status: ✅
  File:Line: all files
  Notes: —
  ────────────────────────────────────────
  Section: H5
  Check: Comments on non-obvious decisions
  Status: ⚠️ 
  File:Line: orchestrator.ts:77,119
  Notes: refreshedThisTick Set, reaped-via-opts, recovery-before-claim unexplained

  ---
  ❌ Blockers — Exact Fixes

  A4 / Extra — CRON_SECRET production validation (lib/config.ts:32)
  Replace CRON_SECRET: z.string().default('') with a .superRefine() that enforces >= 32 chars when NODE_ENV === 'production'. Pattern:
  mirror OAUTH_STATE_SECRET at line 18. Without this, a deploy missing the env var admits any request with header Authorization: Bearer  (7
  bytes match "Bearer " exactly through timingSafeEqual).

  B7 — last_publish_attempt_at not updated in requeueScheduledPost (lib/db/posts.ts:404-413)
  Add last_publish_attempt_at: formatISO(now) to the updateData object. now is already threaded through handleError (orchestrator.ts:136).
  Without this, reaper measures stuck window from original claim instead of most recent requeue — reaper fires too early on
  NETWORK/RATE_LIMITED retry path.

  C4 — Refresh-retry swallows non-TOKEN_EXPIRED errors (lib/publishing/orchestrator.ts:155-167)
  The catch (e2) block routes everything to terminal failed with TOKEN_REVOKED. Fix: branch on e2 instanceof SocialProviderError. If e2.code   === 'TOKEN_EXPIRED' → terminal with refresh_failed. For other SocialProviderError codes → re-invoke handleError(client, post, e2, ...) so   NETWORK gets backoff, RATE_LIMITED gets retryAfterSeconds. Non-SocialProviderError → keep current terminal behavior. Currently violates
  ADR 0005 §6 explicitly.

  G4 — Recovery-before-claim ordering test absent (lib/publishing/orchestrator.test.ts)
  Add ADR 0005 §15 mandatory test: seed one stale scheduled row + one fresh approved row, run one tick, assert both end published and that
  Phase A (reap) ran before Phase B (claim).

  G5 — Platform gate test absent (lib/publishing/orchestrator.test.ts or posts.publishing.test.ts)
  Add ADR 0005 §15 mandatory test: approved Instagram post with scheduled_at = now(); assert claimed === 0 and row stays approved.

  H1 — claimPostsForPublishing ignores threaded now (lib/db/posts.ts:346)
  Either (a) accept now?: Date parameter and use formatISO(now ?? new Date()), or (b) remove p_now from the TypeScript call and use now()
  inside the SQL RPC (preferred — matches ADR 0005 §12 spirit; requires migration patch).

  H2 — process.env.NODE_ENV direct read (app/api/cron/publish/route.ts:13)
  Replace with config.public.NODE_ENV === 'production'. CLAUDE.md violation.

  ---
  ⚠️  Recommendations (defer-eligible)

  - B2 metadata merge race — markPostFailed + requeueScheduledPost do read-then-write of ai_generation_metadata. Promote to RPC using
  ai_generation_metadata || jsonb_build_object('publish_error', $1) for single-statement atomicity. Low practical risk (SKIP LOCKED bounds
  concurrency).
  - C1 structural — Promote TOKEN_REVOKED and PLATFORM_REJECTED to explicit case branches; keep default for unknown future codes only.
  Prevents silent counter bugs on future maintenance.
  - C8 redactTokens — Add value-pattern scanning (Bearer , sk-, long hex) to redactTokens for defence-in-depth. Current key-name filter
  misses tokens embedded in arbitrary values.
  - G1/G2 assertions — Add last_publish_error and publish_attempts assertions to existing error-code tests.
  - H3 — Empty-batch path logs durationMs: 0 before duration is captured (cosmetic).
  - H5 — Add comments on refreshedThisTick Set purpose, recovery-before-claim ordering, and why reaped is passed via opts.
  - W1 — markPostPublished doesn't set last_publish_attempt_at. Harmless (row no longer in scheduled) but breaks observability.
  - W2 (console.log) — Accepted per ADR 0005 §17 until structured logger session.
  - W3 (ALTER TABLE non-idempotent) — Add IF NOT EXISTS next time migrations touched.
  - W4 (platform_url in second migration) — Document apply ordering coupling in migration header.
  - F1 cast — legacyStatusKey as 'draft' | 'approved' | 'skipped' at PostCard.tsx:167 is misleading but never rendered for new statuses.

  ---
  Final Verdict

  Blockers before Session 11:
  - G4 — recovery-before-claim ordering test
  - G5 — platform gate test
  - C1 structural — promote known codes to explicit cases (touched by next worker session)

  Blockers before first production cron run:
  - A4 — CRON_SECRET production min-length (CRITICAL — auth bypass)
  - C4 — refresh-retry error routing (HIGH — permanently fails recoverable posts)
  - B7 — last_publish_attempt_at on requeue (HIGH — premature reaper firing)
  - H1 — claimPostsForPublishing now threading
  - H2 — process.env.NODE_ENV in route

  Acceptable to defer (future ADR / Phase 2):
  - B2 metadata merge race → promote markPostFailed/requeueScheduledPost to RPCs (Phase 2 concurrency)
  - C8 redactTokens value scanning
  - G1/G2 partial assertions
  - H5 comments, H3 cosmetic log, W1/W3/W4 migration hygiene
  - console.log policy → structured logger session (already deferred by ADR 0005 §17)

  Recommendation: open Session 10D correction pass for the 7 production blockers (A4, B7, C4, G4, G5, H1, H2) before Session 11 begins. The
  3 Session-11 structural blockers (C1, G4, G5) overlap and can be folded into the same 10D pass.