-- ADR 0030 §2.2 (W1) and §2.3's row "any RPC failing W1 at L2.0: explicit anon/authenticated REVOKE added" (Session 36, L2.11 close-out).
--
-- WHY. The three distilled-writer RPCs (20260726030000_performance_memory_promotion.sql, and demote_performance_pattern's re-creation in
-- 20260728220000_demote_recomputes_contradictions.sql) were revoked with `REVOKE ALL ... FROM public` only. On a FRESH Supabase database the
-- platform's default privileges for the public schema also grant EXECUTE on new functions to anon and authenticated, and a REVOKE from PUBLIC does
-- not touch those grants. So on a fresh database these three SECURITY DEFINER functions, which take a caller-supplied business id, were callable by
-- any signed-in user over PostgREST /rpc. Every other memory writer's migration revokes from anon and authenticated explicitly (the outcome, import,
-- interview and dismissal RPCs), which is why only these three failed the W1 drift test in CI.
--
-- WHY IT WAS NOT SEEN EARLIER. L2.0 premise 2 and L2.5's drift test passed on the local development database, whose ACLs for these functions were
-- created long ago without those grants (a long-lived database, not a fresh one). The db-tests job builds a fresh database, and its first run at this
-- session's head (PR #16) failed exactly these three W1 assertions. The tenant exposure on any database that received these grants from the platform
-- defaults is the defect this closes.
--
-- WHAT. One statement pair per function: revoke from PUBLIC, anon and authenticated, grant EXECUTE to service_role only. Idempotent (a REVOKE of a
-- privilege not held, and a GRANT already held, are no-ops), so it is safe on a database that already has the tight ACL. No function body, signature
-- or caller changes: the callers are service-role only (lib/db/memory-performance.ts, by lazy import).
--
-- NOT touched, on purpose: promote_outcome_pattern and every outcome / import / interview / dismissal RPC (they already revoke anon and authenticated).

REVOKE ALL ON FUNCTION public.upsert_distilled_performance_pattern(uuid, text, text, text, text, text, text, numeric, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_distilled_performance_pattern(uuid, text, text, text, text, text, text, numeric, int) TO service_role;

REVOKE ALL ON FUNCTION public.promote_performance_pattern(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_performance_pattern(uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.demote_performance_pattern(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demote_performance_pattern(uuid, text, text, text, text) TO service_role;
