-- Migration 2: Shared updated_at trigger function
--
-- Used by every table that has an `updated_at` column. The trigger itself is
-- attached per-table inside that table's migration so each table is
-- self-contained.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
