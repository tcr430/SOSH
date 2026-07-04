-- ADR 0013 (Rev B / 21A-D / MAJOR-1) — go-forward owner-membership provisioning.
--
-- M7 (20260702120600) backfilled a business_members row for every business
-- that existed when it ran. Nothing covered businesses created afterward —
-- countSeatUsage/listMembers would silently under-report the owner by 1 for
-- every new business, forever. This trigger closes that gap: it fires on
-- every future `businesses` INSERT and provisions the same row M7 would have.
--
-- Must be SECURITY DEFINER: at business-creation time the creator is not yet
-- a business_members row, so the business_members RLS (which requires
-- get_user_business_ids() membership) would reject the insert — the
-- chicken-and-egg problem M7 sidesteps the same way (service-role/DEFINER).
--
-- Idempotent via ON CONFLICT targeting business_members_uniq_user, same as
-- M7, so a manual re-provisioning attempt (or a future re-run of M7-style DML
-- against a business this trigger already covers) is a safe no-op.

CREATE OR REPLACE FUNCTION public.ensure_owner_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.business_members
      (business_id, user_id, email, role, is_admin, status, invited_at, accepted_at)
    SELECT NEW.id, NEW.owner_id, lower(u.email), 'approver', true, 'active', now(), now()
    FROM auth.users u
    WHERE u.id = NEW.owner_id
    ON CONFLICT (business_id, user_id) WHERE (user_id IS NOT NULL AND status IN ('invited','active'))
    DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ensure_owner_membership
  AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.ensure_owner_membership();
