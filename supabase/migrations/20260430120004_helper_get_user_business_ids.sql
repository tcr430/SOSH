-- Migration 4: get_user_business_ids() helper
--
-- Returns the set of business IDs the calling user can access. Used by every
-- customer-data table's RLS policies. Phase 1 implementation: ownership only.
-- When business_members lands in a future phase, only this function changes.
--
-- STABLE        — Postgres caches the result within a single statement, so a
--                 query touching multiple RLS-protected tables resolves the
--                 user's businesses once.
-- SECURITY DEFINER — required because the function reads from businesses,
--                 which itself has RLS. Without DEFINER the function would
--                 recurse into its own policy.
-- search_path  — locked to public to prevent search-path injection on the
--                 SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.get_user_business_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  FROM public.businesses
  WHERE owner_id = auth.uid()
    AND deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_user_business_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_business_ids() TO authenticated;
