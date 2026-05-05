-- Migration 021: Lock search_path on set_updated_at()
--
-- Functions without SET search_path are vulnerable to search-path injection
-- attacks when called in a context where the search_path has been manipulated.
-- set_updated_at is not SECURITY DEFINER, but locking the path is defence in
-- depth and consistent with the other functions in this codebase.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
