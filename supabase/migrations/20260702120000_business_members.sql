-- ADR 0013 (Rev A) §2 / §2.1 / §2.2 — business_members table.
--
-- SEQUENCING NOTE (21A-B1): user_can() does not exist yet (it lands in B3).
-- This migration therefore ships the table, indexes, set_updated_at trigger,
-- protect_primary_admin_membership trigger, and the SELECT policy (which only
-- needs get_user_business_ids(), already live). The INSERT/UPDATE policies
-- (§2.1, gated by user_can('manage_members')) are deferred to B3's migration,
-- immediately after user_can is created.

CREATE TABLE public.business_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,   -- NULL until accept
  email        text        NOT NULL,                                      -- stored lower-cased by app
  role         text        NOT NULL CHECK (role IN ('approver','editor','viewer')),
  is_admin     boolean     NOT NULL DEFAULT false,
  status       text        NOT NULL DEFAULT 'invited'
                             CHECK (status IN ('invited','active','revoked')),
  invited_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL for backfilled owner
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- An active member must be bound to a user; an invited member must not be.
  CONSTRAINT business_members_active_has_user
    CHECK ((status = 'active' AND user_id IS NOT NULL)
        OR (status <> 'active'))
);

-- One active/invited membership per user per business (revoked excluded → re-invite allowed).
CREATE UNIQUE INDEX business_members_uniq_user
  ON public.business_members (business_id, user_id)
  WHERE user_id IS NOT NULL AND status IN ('invited','active');

-- One active/invited membership per email per business (revoked excluded).
CREATE UNIQUE INDEX business_members_uniq_email
  ON public.business_members (business_id, lower(email))
  WHERE status IN ('invited','active');

-- Read path: get_user_business_ids() scans active members by user_id.
CREATE INDEX business_members_active_user_idx
  ON public.business_members (user_id) WHERE status = 'active';
-- Member-list + seat-count path.
CREATE INDEX business_members_business_idx
  ON public.business_members (business_id);

CREATE TRIGGER trg_business_members_updated_at
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the tenant sees ALL member rows, including pending
-- invites (Rev A / m4 — full team + seat-meter transparency for every member,
-- so a non-admin seat meter is accurate without a definer count). The invite-
-- hijack vector this visibility would otherwise open is closed NOT here but at
-- accept time, by the email-match guard in accept_invite (21A-B5): reading a
-- pending row's id is harmless because binding it requires the auth email to
-- equal the invited email. No sensitive possession secret lives on the row.
CREATE POLICY business_members_select ON public.business_members
  FOR SELECT TO authenticated
  USING (
    business_id = ANY (SELECT unnest(public.get_user_business_ids()))
  );

-- INSERT/UPDATE policies (admin-gated via user_can('manage_members')) land in
-- 21A-B3, immediately after user_can() is created. No DELETE policy in any
-- step — revocation is an UPDATE to status='revoked'; hard delete happens only
-- via ON DELETE CASCADE on business purge.

-- ─── Primary-admin protection (§2.2) ────────────────────────────────────────

-- The primary admin is the account creator (businesses.owner_id). This trigger
-- guarantees at least one un-removable admin so admins cannot lock each other
-- — or the whole business — out. There is no "owner" role and no transfer
-- feature (Rev A / n1); this is purely the un-removable-admin safety invariant.
CREATE OR REPLACE FUNCTION public.protect_primary_admin_membership()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Only the primary admin's own membership row is protected.
  IF OLD.user_id = (SELECT owner_id FROM public.businesses WHERE id = OLD.business_id) THEN
    IF NEW.is_admin IS DISTINCT FROM true
       OR NEW.role   IS DISTINCT FROM 'approver'
       OR NEW.status IS DISTINCT FROM 'active'
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'primary admin membership cannot be demoted, revoked, or rebound';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_primary_admin_membership
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_primary_admin_membership();
