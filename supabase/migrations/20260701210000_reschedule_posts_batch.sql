-- Session 20D (20C MAJOR-1 / D-N) — atomic group reschedule.
--
-- The calendar's drag-a-box reschedule moves every post in a (campaign, day)
-- group in one action, but each post keeps its OWN business-tz wall-clock
-- time-of-day — so every row lands on a DIFFERENT new scheduled_at. A plain
-- .update({ scheduled_at }) can't express per-row values, so this does the
-- per-row update as a single atomic SQL statement via jsonb_to_recordset,
-- instead of the previously-rejected per-post await loop.
--
-- SECURITY INVOKER (not DEFINER): the calendar layer never uses service-role
-- (see CLAUDE.md "no service-role" posture for this feature). Running as
-- INVOKER means the posts_update_own RLS policy still gates every row using
-- the calling user's own session — this function adds no privilege the
-- caller didn't already have via a normal UPDATE.

CREATE OR REPLACE FUNCTION public.reschedule_posts_batch(
  p_business_id uuid,
  p_moves       jsonb
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.posts p
     SET scheduled_at = m.ts,
         updated_at   = now()
  FROM jsonb_to_recordset(p_moves) AS m(id uuid, ts timestamptz)
  WHERE p.id = m.id
    AND p.business_id = p_business_id
    AND p.status IN ('draft', 'approved')
    AND p.published_at IS NULL
    AND p.deleted_at IS NULL
  RETURNING p.id;
$$;

REVOKE ALL ON FUNCTION public.reschedule_posts_batch(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.reschedule_posts_batch(uuid, jsonb) TO authenticated;
