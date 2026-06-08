-- businesses.total_posts_published: business-level publish counter for first-post
-- detection (ADR 0008 §12). Mirrors campaigns.total_posts_published naming convention.
ALTER TABLE public.businesses
  ADD COLUMN total_posts_published int NOT NULL DEFAULT 0;

-- increment_business_published_count: atomic increment-and-return.
-- RETURNING value === 1 is the exclusive first-post enqueue trigger (ADR 0008 §12).
CREATE OR REPLACE FUNCTION public.increment_business_published_count(p_business_id uuid)
RETURNS int
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.businesses
     SET total_posts_published = total_posts_published + 1
   WHERE id = p_business_id
  RETURNING total_posts_published;
$$;

REVOKE ALL ON FUNCTION public.increment_business_published_count(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_business_published_count(uuid) TO service_role;
