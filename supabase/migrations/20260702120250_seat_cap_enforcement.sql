-- ADR 0013 (Rev A) §6.6 — DB-level seat-cap enforcement (the real boundary, not
-- app-layer-only). plan_max_seats() encodes the plan→max map; enforce_seat_cap()
-- rejects a business_members INSERT that would exceed it. null (pro/agency)
-- means unlimited. Also enforces the Pro→Plus overage lock (§6.5): a downgrade
-- leaves used > max, so the next invite hits used >= max and is rejected — no
-- separate lock mechanism needed.

-- Plan→max-seats map, SQL-side. A Builder test asserts this equals
-- lib/stripe/plan.ts getPlanCapabilities().maxSeats for every Plan value
-- (SEAT-CAP-SSOT-SYNC).
CREATE OR REPLACE FUNCTION public.plan_max_seats(p_plan text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_plan
    WHEN 'trial' THEN 10
    WHEN 'plus'  THEN 10
    WHEN 'pro'   THEN NULL      -- unlimited
    WHEN 'agency'THEN NULL      -- mirrors pro; slated for removal
    ELSE 0                      -- unknown plan → no seats (fail closed)
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_seat_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max  integer;
  v_used integer;
BEGIN
  -- Only invited/active rows consume seats; anything else (shouldn't INSERT) is ignored.
  IF NEW.status NOT IN ('invited','active') THEN
    RETURN NEW;
  END IF;

  SELECT public.plan_max_seats(b.plan) INTO v_max
  FROM public.businesses b WHERE b.id = NEW.business_id;

  IF v_max IS NULL THEN
    RETURN NEW;                       -- unlimited (pro/agency)
  END IF;

  -- Count existing seat-consuming rows for this business (authoritative: DEFINER
  -- bypasses RLS so the count is independent of the caller's visibility).
  SELECT count(*) INTO v_used
  FROM public.business_members
  WHERE business_id = NEW.business_id AND status IN ('invited','active');

  IF v_used >= v_max THEN
    RAISE EXCEPTION 'seat cap reached for plan (% of % seats used)', v_used, v_max
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_seat_cap
  BEFORE INSERT ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_seat_cap();
