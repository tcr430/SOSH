-- Session 36 / A-8 follow-up: the allow-list decision for the SECURITY DEFINER audit (docs/launch-checklist.md section 2).
--
-- After 20261004100000 the audit (S36-FRESH-DB-RPC-ACL-AUDIT) returned 6 functions, on a fresh database and on hosted alike. This migration closes
-- three of them and the launch-checklist row justifies the other three.
--
-- CLOSED HERE. enforce_seat_cap(), enqueue_post_edit_signal() and ensure_owner_membership() are trigger functions (RETURNS trigger, wired by
-- 20260702120250, 20260726010000 and 20260702120800 respectively) with no client caller, and were created with no ACL, so they kept the default PUBLIC
-- EXECUTE. They are not callable over PostgREST /rpc as ordinary functions (a trigger function cannot be invoked directly), but a function with no
-- client caller has no business being client-executable, and the audit cannot distinguish "harmless" from "forgotten". Postgres does not check EXECUTE
-- when a trigger fires (it is checked once, at CREATE TRIGGER), so revoking it changes nothing for the triggers. The siblings
-- create_trial_state_for_new_business() and start_trial_on_first_social_account() already have this exact ACL (20261004100000).
--
-- JUSTIFIED, NOT CHANGED (the allow-list, each with its reason; the launch-checklist row carries the same text):
--   * get_user_business_ids() (authenticated): every RLS policy calls it as authenticated.
--   * accept_invite(uuid, uuid) (authenticated): called with the signed-in invitee's client (lib/db/business-members.ts).
--   * user_can(uuid, text) (anon, authenticated): called as authenticated by the team page and the social connect/disconnect routes, and by RLS
--     policies. The anon grant is deliberate (20260715200000): user-can-matrix.test.ts proves an unauthenticated caller gets false, and the body returns
--     false when auth.uid() IS NULL, so the grant discloses nothing.
--
-- Idempotent; no function body or signature changes.

REVOKE ALL ON FUNCTION public.enforce_seat_cap() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_post_edit_signal() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_owner_membership() FROM PUBLIC, anon, authenticated, service_role;
