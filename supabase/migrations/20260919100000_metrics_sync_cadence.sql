-- Migration: metrics sync cadence — day 1 / 3 / 7 (ADR 0026 §3.2, ADR 0028 Amendment A, J2.1)
--
-- WHY. The hourly, staleness-based predicate (20260530120000) is ~170 reads per
-- post per week against a per-read-billed X API (ADR 0028 §14.3), and the outcome
-- loop needs exactly ONE value (day 7). A post is now DUE when
--
--     (age >= 1 day  AND last_synced_at < published_at + 1 day)
--  OR (age >= 3 days AND last_synced_at < published_at + 3 days)
--  OR (age >= 7 days AND last_synced_at < published_at + 7 days)
--
-- with last_synced_at NULL (never synced) counting as "before" every stage. No new
-- column: last_synced_at versus published_at already encodes which stage a post has
-- reached. Three reads per post is the ceiling. A missed stage is caught up (a post
-- last synced at day 1 is still due at day 5 — its day-3 read never landed). The
-- caller's METRICS_MAX_AGE_DAYS (default 9, lib/config.ts) bounds the tail: 7 days
-- plus a 2-day grace (OUTCOME_MATURITY_GRACE_DAYS) so a day-7 read can still land.
--
-- WHAT DOES NOT CHANGE. Signature (so CREATE OR REPLACE is an in-place body swap —
-- no overload, no orphaned old function), STABLE SQL, search_path, the WHERE filters
-- other than staleness, ORDER BY and LIMIT, and the service-role-only grants.
-- p_stale_before stays in the signature ONLY so the one caller
-- (lib/db/posts.ts listPostsForMetricsSync) and the deployed RPC contract do not
-- change; it is deliberately ignored, and metrics-sync-cadence.test.ts proves a
-- far-future value no longer re-selects a post.
--
-- ROLLOUT. Idempotent. Nothing to backfill, no lock beyond the function DDL, and a
-- reverted deploy simply falls back to whatever body is live.

CREATE OR REPLACE FUNCTION public.list_posts_for_metrics_sync(
  p_now                 timestamptz,
  p_stale_before        timestamptz,
  p_max_age_days        int,
  p_limit               int
)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p.*
    FROM public.posts AS p
    LEFT JOIN public.post_metrics AS pm ON pm.post_id = p.id
   WHERE p.status = 'published'
     AND p.platform_post_id IS NOT NULL
     AND p.deleted_at IS NULL
     AND p.platform IN ('linkedin', 'twitter')
     AND p.published_at > (p_now - make_interval(days => p_max_age_days))
     AND (
          (p_now >= p.published_at + interval '1 day'
            AND (pm.last_synced_at IS NULL OR pm.last_synced_at < p.published_at + interval '1 day'))
       OR (p_now >= p.published_at + interval '3 days'
            AND (pm.last_synced_at IS NULL OR pm.last_synced_at < p.published_at + interval '3 days'))
       OR (p_now >= p.published_at + interval '7 days'
            AND (pm.last_synced_at IS NULL OR pm.last_synced_at < p.published_at + interval '7 days'))
     )
   ORDER BY pm.last_synced_at ASC NULLS FIRST, p.published_at ASC
   LIMIT p_limit;
$$;

-- Unchanged: service-role only. Re-stated so the grants are visible next to the body.
REVOKE ALL ON FUNCTION public.list_posts_for_metrics_sync(timestamptz, timestamptz, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.list_posts_for_metrics_sync(timestamptz, timestamptz, int, int) TO service_role;
