-- Session 18B-2 (B18-075) — consolidate the publish-success update path.
-- Previously the orchestrator made two separate calls per successful publish
-- (markPostPublished, then incrementPublishedCountForCampaign), with no
-- atomicity between them: a crash between the two left the post published
-- but the campaign counter under-counted. This RPC does both in one
-- round-trip, guarded by the same WHERE id AND WHERE status = 'scheduled'
-- atomic transition used elsewhere in the publishing worker.

CREATE OR REPLACE FUNCTION public.publish_post_complete(
  p_post_id          uuid,
  p_platform_post_id text,
  p_platform_url     text,
  p_published_at     timestamptz
)
RETURNS SETOF public.posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_post public.posts;
BEGIN
  UPDATE public.posts
     SET status                  = 'published',
         platform_post_id        = p_platform_post_id,
         platform_url            = p_platform_url,
         published_at            = p_published_at,
         last_publish_error      = NULL,
         last_publish_attempt_at = NULL
   WHERE id = p_post_id
     AND status = 'scheduled'
     AND deleted_at IS NULL
  RETURNING * INTO v_post;

  -- Guard rejected the transition (already published/failed/skipped, or the
  -- post doesn't exist) — zero rows affected. Return zero rows; the caller
  -- treats this as a no-op, not an error.
  IF v_post.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.campaigns
     SET total_posts_published = total_posts_published + 1
   WHERE id = v_post.campaign_id;

  RETURN QUERY SELECT * FROM public.posts WHERE id = v_post.id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_post_complete(uuid, text, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.publish_post_complete(uuid, text, text, timestamptz) TO service_role;
