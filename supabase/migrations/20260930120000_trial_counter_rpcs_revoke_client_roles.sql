-- ADR 0030 V.17 / Session 36-D MAJOR-2, follow-up (docs/launch-checklist.md section 2, "SECURITY DEFINER functions not client-executable").
--
-- WHY. increment_brand_voice_attempts(uuid) and increment_posts_generated(uuid) (20260515160000_increment_rpcs.sql) are SECURITY DEFINER, take a
-- CALLER-SUPPLIED p_business_id, and were created with NO privilege statement at all. A function with no ACL keeps the default PUBLIC EXECUTE, so
-- anon and authenticated can both call them over PostgREST /rpc: any signed-in user (or an anonymous one) could bump another business's trial counters
-- (posts_generated_count, brand_voice_inference_attempts), which feed the trial caps. A fresh database shows it as proacl = NULL; their siblings
-- (increment_campaigns_created, increment_posts_generated_by, ...) carry an explicit service_role-only ACL.
--
-- WHAT. One statement pair per function, the 20260930100000 form: revoke from PUBLIC, anon and authenticated, grant EXECUTE to service_role only.
-- Idempotent, so it is safe on a database that already has the tight ACL. No function body or signature changes.
--
-- WHO CALLS THEM. Only lib/db/trial-state.ts (incrementBrandVoiceAttempts, incrementPostsGenerated), through the lazily imported service-role client
-- (CLAUDE.md: trial_state writes are service-role). No authenticated or anon client calls either function, so nothing legitimate loses access.
--
-- NOT touched, on purpose: the other six functions the audit lists (accept_invite, enforce_seat_cap, enqueue_post_edit_signal, ensure_owner_membership,
-- get_user_business_ids, user_can) have client callers or are trigger functions and are the launch-checklist row's allow-list decision.

REVOKE ALL ON FUNCTION public.increment_brand_voice_attempts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_brand_voice_attempts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.increment_posts_generated(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_posts_generated(uuid) TO service_role;
