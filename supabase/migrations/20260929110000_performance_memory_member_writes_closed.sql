-- ADR 0030 §2.4 (Session 36, L2.2, founder ruling A-5) — close member writes on performance_memory.
-- ALONE in its commit on purpose: it is the one change in the session that can break an EXISTING writer's tests, so
-- the L2.0 baseline set is re-run at this commit.
--
-- It is the fourth and last of the governed memory tables to close. 20260925100000_memory_member_writes_closed.sql
-- closed brand_memory, evidence_memory and audience_memory and deliberately left this one alone (ADR 0029 §2.4,
-- INTERVIEW-PERFORMANCE-POLICY-UNCHANGED): Session 33's outcome loop had narrowed, not closed, its member surface.
--
-- WHY IT CANNOT STAY OPEN (ADR 0030 §1.1 fact 6, confirmed independently by [sec-1] HIGH and [db-8] MAJOR):
-- performance_memory_insert_own checks only business_id and source = 'manual' (20260919130000:199-203), the blanket
-- GRANT ... ON ALL TABLES ... TO authenticated (20260707190000:28,32) was never revoked on this table, and
-- enforce_performance_memory_write_protection leaves manual rows unrestricted. A member could therefore INSERT an
-- ACTIVE, confidence-1.0, public_use_permission = true row straight over PostgREST, and
-- listPerformanceMemoryCandidates (which excludes only 'outcome') would put it in every generation prompt. Nothing in
-- the product writes source = 'manual'; every real writer is a service_role SECURITY DEFINER RPC or the service-role
-- client (upsert_distilled_performance_pattern, import_performance_memory, upsert_outcome_performance_pattern,
-- promote/demote_*), none of which depends on `authenticated` privileges.
--
-- Three steps, copied from 20260925100000:39-56:
--   1. DROP the three member write policies (their real names — 20260919130000 and the original governed_memory).
--   2. REVOKE INSERT, UPDATE, DELETE, TRUNCATE from `authenticated` AND `anon`, so a direct write fails at the GRANT
--      layer with 42501 ("permission denied for table") before RLS is consulted and no policy is left to misread.
--   3. KEEP performance_memory_select_own — the member RLS client still reads this table, and tenant isolation on
--      SELECT is unchanged.
--
-- NOT edited, on purpose (defence in depth, now unreachable by clients): enforce_performance_memory_write_protection
-- (20260919130000:217-255) and the outcome-row delete guard (20260919160000). `git diff` shows neither.

DROP POLICY performance_memory_insert_own ON public.performance_memory;
DROP POLICY performance_memory_update_own ON public.performance_memory;
DROP POLICY performance_memory_delete_own ON public.performance_memory;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.performance_memory FROM authenticated, anon;
