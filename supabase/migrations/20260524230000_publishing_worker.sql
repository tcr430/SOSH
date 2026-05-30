-- Migration: publishing worker retry-tracking columns + claim RPC
-- ADR 0005 §9

ALTER TABLE public.posts
  ADD COLUMN publish_attempts        int          NOT NULL DEFAULT 0,
  ADD COLUMN last_publish_attempt_at timestamptz  NULL,
  ADD COLUMN last_publish_error      text         NULL;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_publish_attempts_nonnegative
    CHECK (publish_attempts >= 0),
  ADD CONSTRAINT posts_publish_attempts_ceiling
    CHECK (publish_attempts <= 10);
-- 5 is the runtime PUBLISH_MAX_ATTEMPTS; 10 is a hard defensive ceiling
-- so a misconfigured env can't run a row away to infinity.

CREATE OR REPLACE FUNCTION public.claim_posts_for_publishing(
  p_now   timestamptz,
  p_limit int
)
RETURNS SETOF public.posts
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.posts AS p
     SET status = 'scheduled',
         last_publish_attempt_at = p_now
    FROM (
      SELECT id
        FROM public.posts
       WHERE status = 'approved'
         AND scheduled_at <= p_now
         AND platform IN ('linkedin', 'twitter')
         AND deleted_at IS NULL
       ORDER BY scheduled_at ASC
       LIMIT p_limit
       FOR UPDATE SKIP LOCKED
    ) AS due
   WHERE p.id = due.id
     AND p.status = 'approved'
  RETURNING p.*;
$$;

REVOKE ALL ON FUNCTION public.claim_posts_for_publishing(timestamptz, int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_posts_for_publishing(timestamptz, int) TO service_role;
