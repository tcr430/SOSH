-- ADR 0013 (Rev A) §3 — get_user_business_ids() widened to owner_id ∪ active members.
--
-- Fulfils ADR 0001 §A's promise ("the same function will resolve via a
-- business_members join table without changes to any policy"). Every
-- existing RLS policy already references this helper's output via the
-- `business_id = ANY (SELECT unnest(public.get_user_business_ids()))` array-ANY
-- pattern (established in migration 20260430120017). This migration is the
-- SINGLE point of change for the read-access widening — no policy body is
-- touched (RLS-READ-HELPER-ONLY).
--
-- Non-recursion: SECURITY DEFINER runs as the function owner, for whom RLS
-- is not applied, so reading business_members (whose own SELECT policy calls
-- this same function) inside this DEFINER function does not re-enter that
-- policy. If this ran SECURITY INVOKER, it would recurse infinitely
-- (RLS-HELPER-NORECURSE).

CREATE OR REPLACE FUNCTION public.get_user_business_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT bid), ARRAY[]::uuid[])
  FROM (
    SELECT id AS bid
    FROM public.businesses
    WHERE owner_id = auth.uid()
      AND deleted_at IS NULL
    UNION
    SELECT m.business_id AS bid
    FROM public.business_members m
    JOIN public.businesses b ON b.id = m.business_id AND b.deleted_at IS NULL
    WHERE m.user_id = auth.uid()
      AND m.status = 'active'
  ) s;
$$;

REVOKE ALL ON FUNCTION public.get_user_business_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_business_ids() TO authenticated;
