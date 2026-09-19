-- Session 31-D, D5 (MAJOR-5) — closes the privilege escalation the Session
-- 31 review found in 20260909110000_ai_budget_daily_rename.sql.
--
-- WHAT WAS WRONG: that migration's `REVOKE ALL ON FUNCTION ... FROM PUBLIC`
-- does NOT touch a role's OWN named grant. Supabase's `ALTER DEFAULT
-- PRIVILEGES` grants EXECUTE on every newly created function to `anon` and
-- `authenticated` BY NAME at creation time — a REVOKE against the PUBLIC
-- pseudo-role never reaches those two named grants. Read from the live
-- project: `reserve_ai_budget`/`reconcile_ai_budget` both showed
-- `acl: postgres=X | anon=X | authenticated=X | service_role=X` — i.e. EVERY
-- signed-in customer, and even an anonymous caller, could execute both
-- SECURITY DEFINER functions directly via PostgREST
-- (`POST /rest/v1/rpc/reserve_ai_budget`) against ANY business_id, because
-- neither function checks the caller and `ai_budget_daily` carries no RLS
-- policy at all (by design — it's meant to be service-role-only).
-- `vault_delete_secret`/`vault_update_secret` already show the correct
-- pattern (`20260516180000_vault_write_helpers.sql`,
-- `20260904090000_vault_update_secret.sql`): REVOKE ALL FROM PUBLIC, THEN a
-- SEPARATE named `REVOKE EXECUTE ... FROM anon, authenticated`.
--
-- SCOPE: this migration touches ONLY the two functions Session 31 recreated
-- and attached a customer-facing quota to (`reserve_ai_budget`,
-- `reconcile_ai_budget`). The review found the SAME defect is repo-wide
-- (`purge_business`, `upsert_signal_candidate`, `get_user_business_ids` all
-- carry `anon=X | authenticated=X` too) — that sweep is explicitly NOT this
-- migration's job (docs/reviews/session-31-reviewer.md, MAJOR-5: "The
-- repo-wide sweep ... belongs in its own tracked piece of work, not in a
-- Session 31 correction pass").
--
-- No function body changes — CREATE OR REPLACE is not used here on purpose;
-- only the ACL is corrected, so there is nothing to migrate data-wise and no
-- ADR 0010 Amendment 2 §D2.5 cascade-table implication (no new table, no
-- table dropped).

REVOKE ALL ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_ai_budget(uuid, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_ai_budget(uuid, text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_ai_budget(uuid, text, integer, integer) TO service_role;
