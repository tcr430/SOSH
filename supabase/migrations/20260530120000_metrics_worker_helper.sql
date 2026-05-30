-- Migration: metrics worker helper function
-- Plain SQL function for posts → post_metrics LEFT JOIN.
-- NOT SECURITY DEFINER — service-role is the security boundary.
-- Idempotent read; no lock. Contrast ADR 0005 §4 claim_posts_for_publishing.

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
     AND (pm.last_synced_at IS NULL OR pm.last_synced_at < p_stale_before)
   ORDER BY pm.last_synced_at ASC NULLS FIRST, p.published_at ASC
   LIMIT p_limit;
$$;

-- Service-role only — RLS bypass already happens via the client,
-- but lock the function down explicitly.
REVOKE ALL ON FUNCTION public.list_posts_for_metrics_sync(timestamptz, timestamptz, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.list_posts_for_metrics_sync(timestamptz, timestamptz, int, int) TO service_role;
