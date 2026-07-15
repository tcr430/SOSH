-- Fixes a real (non-flaky) CI failure surfaced by Session 22's db-tests skip-guard:
-- user-can-matrix.test.ts's "null auth (unauthenticated anon client) resolves false"
-- called user_can() via an anon-key PostgREST client with no session. The function's
-- own body already handles this case explicitly (`IF auth.uid() IS NULL THEN RETURN
-- false`, 20260702120200_user_can.sql:15-17) — that guard clause was written for
-- exactly this call shape. But 20260702120200_user_can.sql only granted EXECUTE to
-- `authenticated`, never `anon`, after REVOKE ALL FROM PUBLIC. An anon-role caller
-- therefore never reached the function body at all — PostgREST returns a permission
-- error (not `data:false`), which is what the test actually observed.
--
-- This is a permission grant only: no new function, no signature/behavior change to
-- user_can() itself, no table/schema change. Idempotent.

GRANT EXECUTE ON FUNCTION public.user_can(uuid, text) TO anon;
