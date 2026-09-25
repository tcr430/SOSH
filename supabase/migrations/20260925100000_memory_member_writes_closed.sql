-- ADR 0029 §2.4 (Session 35, M2.2) — close member writes on brand_memory, evidence_memory and
-- audience_memory. This migration is ALONE in its commit on purpose: it is the one change in the
-- session that can break an EXISTING reader or writer, so every existing memory test is re-run at
-- this commit.
--
-- It DISCHARGES a deferral recorded in 20260719010000_governed_memory.sql:16-22, quoted verbatim:
--
--   "No user_can() write-gating in Track A (ADR §4 "Role-gating decision") —
--    the only writers today are the service-role generation path and (later)
--    Track C's service-role distillation worker, both of which bypass RLS.
--    These plain any-member policies are defense-in-depth for a future
--    authenticated memory-management UI; capability gating is added in the
--    same session that ships that UI, not speculatively now."
--
-- This is that session (ADR 0029 D-7). It closes rather than capability-gates: a user_can-gated
-- INSERT/UPDATE would still let an approver set public_use_permission = true or confidence = 1.0
-- straight over PostgREST, bypassing the counsel gate (ADR 0025 A-6) and provenance (L-5). No
-- member-authored write path onto these tables exists or is planned; every writer is a
-- SECURITY DEFINER function granted to service_role only (import_evidence_memory,
-- import_audience_memory, ratify_backfill_run, discard_backfill_run, remove_import_source_post,
-- sweep_expired_backfill_candidates) or the service-role client, none of which depends on
-- `authenticated` privileges. brand_memory has no writer yet; the interview writer (M2.5) is a
-- service-role RPC too.
--
-- Three steps per table:
--   1. DROP the three member write policies (by their real names — governed_memory.sql:66-77 and
--      the evidence/audience equivalents);
--   2. REVOKE INSERT, UPDATE, DELETE, TRUNCATE from `authenticated` AND `anon`, so a direct write
--      fails at the GRANT layer with 42501 ("permission denied for table") before RLS is consulted
--      and there is no policy left to misread;
--   3. KEEP <table>_select_own — the member RLS client still reads these tables
--      (onboarding/step-4 review of import candidates), and tenant isolation on SELECT is unchanged.
--
-- A future general memory-management UI re-opens a gated path of its own, through its own RPC
-- (ADR 0029 §1.3 item 2, §12).

-- ─── brand_memory ───────────────────────────────────────────────────────────

DROP POLICY brand_memory_insert_own ON public.brand_memory;
DROP POLICY brand_memory_update_own ON public.brand_memory;
DROP POLICY brand_memory_delete_own ON public.brand_memory;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.brand_memory FROM authenticated, anon;

-- ─── evidence_memory ────────────────────────────────────────────────────────

DROP POLICY evidence_memory_insert_own ON public.evidence_memory;
DROP POLICY evidence_memory_update_own ON public.evidence_memory;
DROP POLICY evidence_memory_delete_own ON public.evidence_memory;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.evidence_memory FROM authenticated, anon;

-- ─── audience_memory ────────────────────────────────────────────────────────

DROP POLICY audience_memory_insert_own ON public.audience_memory;
DROP POLICY audience_memory_update_own ON public.audience_memory;
DROP POLICY audience_memory_delete_own ON public.audience_memory;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audience_memory FROM authenticated, anon;
