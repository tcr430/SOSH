-- Migration: platform_url column + reap/increment RPCs for publishing worker
-- ADR 0005 §9 (platform_url) and §11 (reapStuckScheduledPosts, incrementPublishedCountForCampaign)

-- platform_url was omitted from the initial publishing worker migration
ALTER TABLE public.posts
  ADD COLUMN platform_url text NULL;

-- ── reap_stuck_scheduled_posts ───────────────────────────────────────────────
-- Executes both UPDATEs from ADR 0005 §8 Phase A.2 atomically.
-- Returns total rows touched (bounced + terminal-failed).
CREATE OR REPLACE FUNCTION public.reap_stuck_scheduled_posts(
  p_now           timestamptz,
  p_stuck_minutes int,
  p_max_attempts  int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bounced int := 0;
  v_failed  int := 0;
  v_cutoff  timestamptz;
BEGIN
  v_cutoff := p_now - (p_stuck_minutes * interval '1 minute');

  -- Phase A.2a: bounce back to approved (still below retry ceiling)
  UPDATE public.posts
     SET status               = 'approved',
         publish_attempts     = publish_attempts + 1,
         last_publish_error   = 'STUCK_REAPED'
   WHERE status                  = 'scheduled'
     AND last_publish_attempt_at < v_cutoff
     AND publish_attempts + 1    < p_max_attempts
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_bounced = ROW_COUNT;

  -- Phase A.2b: terminal-fail rows that have hit the retry ceiling
  UPDATE public.posts
     SET status             = 'failed',
         last_publish_error = 'STUCK_TERMINAL'
   WHERE status                  = 'scheduled'
     AND last_publish_attempt_at < v_cutoff
     AND publish_attempts + 1   >= p_max_attempts
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  RETURN v_bounced + v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_scheduled_posts(timestamptz, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.reap_stuck_scheduled_posts(timestamptz, int, int) TO service_role;

-- ── increment_published_count_for_campaign ───────────────────────────────────
-- Atomically increments campaigns.total_posts_published (ADR 0001 §B.4).
CREATE OR REPLACE FUNCTION public.increment_published_count_for_campaign(
  p_campaign_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.campaigns
     SET total_posts_published = total_posts_published + 1
   WHERE id = p_campaign_id;
$$;

REVOKE ALL ON FUNCTION public.increment_published_count_for_campaign(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_published_count_for_campaign(uuid) TO service_role;
