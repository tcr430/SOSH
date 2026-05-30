-- Rename plan value 'starter' → 'plus' across the businesses table.
-- Finds and drops the auto-generated CHECK constraint by inspecting pg_constraint,
-- migrates any existing rows, then adds a named constraint with the new value set.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.businesses'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%starter%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.businesses DROP CONSTRAINT ' || quote_ident(v_constraint_name);
  END IF;
END;
$$;

UPDATE public.businesses SET plan = 'plus' WHERE plan = 'starter';

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_plan_check
  CHECK (plan IN ('trial', 'plus', 'pro', 'agency'));
