Session 12C — Reviewer Audit Summary
  TS reviewer: 220 tests / 15 files PASS; tsc --noEmit --skipLibCheck clean.
  Security reviewer: No CRITICAL or HIGH security findings. Auth surface mirrors the publish route exactly; tenant isolation, token redaction, SQL   function posture (non-SECURITY-DEFINER + REVOKE/GRANT), atomic upsert, and tick-local short-circuit Set all verified.

  Consolidated PASS (cross-confirmed by both reviewers)

  - A1–A5 cron auth — timingSafeEqual, length pre-check, prod rejects dev-trigger, CRON_SECRET via config.server, single Unauthorized body.
  Mirrors publish route exactly.
  - B1–B5 idempotency — Plain STABLE sql function; REVOKE … FROM public + GRANT EXECUTE TO service_role; atomic INSERT ... ON CONFLICT (post_id)
  DO UPDATE; last_synced_at only on success.
  - C1–C5 D0 short-circuit — Set<Platform> inside runMetricsSyncTick (tick-local); 5+3 same-platform NOT_IMPLEMENTED → exactly 2 provider calls;
  counter incremented for probe and short-circuit rows; only getRegistry() import.
  - D2/D3/D4/D5 — TOKEN_EXPIRED/TOKEN_REVOKED → errors, no refresh, no posts mutation; null → skippedNoData (no row written); no attempts counter,   no terminal failed.
  - E1–E4 — No ??0/||0/Number() coercion anywhere; types number | null on all metric columns; mixed {likes:5,comments:0,shares:null} round-trip
  asserted at orchestrator layer.
  - F1–F5 — business_id server-sourced; all 5 predicates in SQL; NULLS FIRST; log line contains only summary counts; worker writes only
  post_metrics.
  - G1–G3 — Import surface clean; no deep imports of postiz-provider/mock-provider/vault; route is sole non-test caller of runMetricsSyncTick.
  - H2/H7 — Per-platform short-circuit test present; route auth 7-case suite incl. dev-bypass-in-prod → 401.
  - I3/I4/I5 — One console.log, no any, both cron entries present (publish * * * * * untouched, sync-metrics 0 * * * *).

  Findings

  Blockers before first production tick

  1. [HIGH] I1 — route.ts:41 uses now.toISOString() in the error-path fallback. CLAUDE.md prohibits raw .toISOString(); orchestrator success path
  uses formatISO(now). Format drift between success and error paths breaks tick field consistency. Replace with formatISO(now).
  2. [HIGH] D1 — Error-code coverage gap: PROVIDER_NOT_CONFIGURED. The SocialProviderErrorCode union has 8 codes; the orchestrator it.each tests 4   (RATE_LIMITED, NETWORK, PLATFORM_REJECTED, UNKNOWN) plus 3 dedicated (NOT_IMPLEMENTED, TOKEN_EXPIRED, TOKEN_REVOKED) = 7 of 8.
  PROVIDER_NOT_CONFIGURED has no test. Add to it.each in lib/metrics/orchestrator.test.ts.
  3. [MEDIUM] ADR §5 ↔ type drift. ADR 0006 §5 prose names BAD_REQUEST and NOT_CONFIGURED, but the type union has PROVIDER_NOT_CONFIGURED and no
  BAD_REQUEST. Reconcile the ADR to the actual type names.
  4. [MEDIUM] H4 / H5 / H6 — lib/db/posts.metrics.test.ts tests are vacuous (expect(true).toBe(true)). Staleness window inclusion/exclusion,
  MAX_AGE_DAYS exclusion, and never-synced first-ordering are documented in comments only — no executable assertion at the TS wrapper layer. The
  SQL itself is correct (verified by reading the migration), but a misconfigured parameter (e.g. swapped p_stale_before/p_now) would be invisible.   Replace with mock-response assertions.

  Potential TS issue worth verifying (raised by typescript-reviewer)

  5. PostMetrics.fetchedAt typed as string in lib/social/types.ts:92 but orchestrator passes it to formatISO() (orchestrator.ts:86), which
  canonically wants Date | number. tsc --skipLibCheck passes — but this may be hiding a type mismatch. Either change the mapper to formatISO(new
  Date(result.fetchedAt)), or change the type to Date. Worth a 30-second look before correction pass closes.

  Blockers before Session 13

  Same as above — the I1 timestamp bug and the D1 test gap should land in a 12D correction pass before moving on. The H4/H5/H6 tests are
  technically acceptable to ship (SQL is correct; the TS wrapper has no logic to test) but the vacuous assertions are misleading and should be
  replaced or removed.

  Tech debt acceptable to defer

  - upsertPostMetrics null round-trip at DB layer (orchestrator-layer test exists; schema enforces nullability).
  - Catch block does not discriminate infra errors vs. provider errors — accuracy issue, not a security issue.
  - RLS post_metrics_insert_own / post_metrics_update_own over-grant to authenticated users — not exploitable until a user-facing metrics write
  endpoint exists. Flag for database-reviewer in Session 13.
  - Phase 1 wired-but-inert behaviour (all-skipped is healthy) — by design per ADR §1.