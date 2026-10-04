-- Session 36 / A-8 follow-up (docs/launch-checklist.md section 2, "SECURITY DEFINER functions not client-executable").
--
-- WHY. On 2026-10-04 the hosted project's audit (S36-FRESH-DB-RPC-ACL-AUDIT) returned 29 SECURITY DEFINER functions executable by anon and
-- authenticated; a fresh `supabase db reset` returns 8. After the 29 pending migrations were applied to hosted (including 20260930100000, 110000,
-- 120000) it still returned 24: 18 functions carried the platform's default grants (anon, authenticated, service_role) on hosted while the same
-- functions are service_role-only on a fresh database. The hosted database was built through scripts/apply-migrations.ts and its history never matched
-- the repo file-for-file, so the REVOKEs the repo already carries did not all take effect there. This migration re-states the intended ACLs. It is a
-- NO-OP on a fresh database (the ACLs are already these) and idempotent anywhere.
--
-- WHAT. The target ACL of each function is the one a fresh database has today (read from pg_proc.proacl at 15f15e53 + 20260930120000):
--   * 16 service-role RPCs: revoke from PUBLIC, anon, authenticated; grant EXECUTE to service_role only (the 20260930100000 form).
--     Every caller uses the service-role client (lib/db/*, lib/auth/rate-limit.ts), checked before writing this.
--   * 2 trigger functions (create_trial_state_for_new_business, start_trial_on_first_social_account): no client EXECUTE. A trigger fires without the
--     invoker holding EXECUTE, so nothing changes for the triggers themselves.
--   * accept_invite, get_user_business_ids: keep authenticated, drop anon and PUBLIC. user_can is left as is (a fresh database grants anon too).
--
-- NOT touched: enforce_seat_cap, enqueue_post_edit_signal, ensure_owner_membership (NULL ACL, trigger functions). They remain the launch-checklist
-- allow-list decision, on a fresh database as well as on hosted.
--
-- The hosted-only ledger table public.schema_migrations (scripts/apply-migrations.ts) is closed to the API roles below; it does not exist on a fresh
-- database, hence the guard.

REVOKE ALL ON FUNCTION public.claim_deletion_requests(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_deletion_requests(integer, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_email_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_outbox(integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_post_edit_signals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_edit_signals(integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_posts_for_publishing(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_posts_for_publishing(timestamp with time zone, integer) TO service_role;

REVOKE ALL ON FUNCTION public.consume_rate_limit_token(text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_token(text, numeric, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.create_voice_variation(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voice_variation(uuid, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.find_trial_expiring_between(timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_trial_expiring_between(timestamp with time zone, timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.increment_business_published_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_business_published_count(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.increment_campaigns_created(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_campaigns_created(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.increment_posts_generated_by(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_posts_generated_by(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.increment_published_count_for_campaign(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_published_count_for_campaign(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.insert_insight_card_if_claimed(uuid, timestamp with time zone, text, text, text, jsonb, jsonb, text, numeric, numeric, numeric, numeric, jsonb, numeric, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_insight_card_if_claimed(uuid, timestamp with time zone, text, text, text, jsonb, jsonb, text, numeric, numeric, numeric, numeric, jsonb, numeric, timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.publish_post_complete(uuid, text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_post_complete(uuid, text, text, timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.purge_business(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_business(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.reap_stuck_scheduled_posts(timestamp with time zone, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stuck_scheduled_posts(timestamp with time zone, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_signal_candidate(uuid, uuid, numeric, jsonb, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_signal_candidate(uuid, uuid, numeric, jsonb, timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.create_trial_state_for_new_business() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_trial_on_first_social_account() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.accept_invite(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_business_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_business_ids() TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;
