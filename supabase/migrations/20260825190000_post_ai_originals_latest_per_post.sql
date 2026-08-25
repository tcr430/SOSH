-- Session 29-D, D9 (MINOR-6) — listLatestPostAiOriginalsByPostIds's old read
-- ordered by (post_id ASC, revision DESC) with a single LIST-WIDE cap
-- (postIds.length * 20). That cap is a PER-LIST heuristic, not a per-post
-- one: one post with more than 20 revisions consumes the whole list's
-- budget, and because the ordering is post_id-major, posts sorted AFTER it
-- fall off the result entirely — their preview silently renders nothing, no
-- error. createNextPostAiOriginalRevision increments on every regeneration,
-- so >20 revisions on one post is reachable in practice.
--
-- Fix: a DISTINCT ON (post_id) read — one row per post, guaranteed,
-- regardless of how many revisions any OTHER post in the list has.
-- SECURITY INVOKER (the default — no SECURITY DEFINER keyword), so RLS
-- still applies through the caller's own session; this is NOT a
-- service-role bypass. Granted to `authenticated`, not `service_role` (the
-- convention every other RPC in this codebase follows), because this
-- function's sole production caller
-- (app/[locale]/(dashboard)/approvals/page.tsx) uses the RLS-scoped
-- Server Component client, never the service-role client.
--
-- UNIQUE (post_id, revision) (20260726010000_learning_capture.sql:41)
-- already provides the index this DISTINCT ON / ORDER BY needs.
CREATE OR REPLACE FUNCTION public.get_latest_post_ai_originals(p_post_ids uuid[])
RETURNS SETOF public.post_ai_originals
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (post_id) *
  FROM public.post_ai_originals
  WHERE post_id = ANY (p_post_ids)
  ORDER BY post_id, revision DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_post_ai_originals(uuid[]) TO authenticated;
