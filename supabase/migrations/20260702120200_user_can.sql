-- ADR 0013 (Rev A) §4 — user_can(business_id, capability) + the business_members
-- INSERT/UPDATE policies deferred from 21A-B1 (§2.1), now that user_can exists.

CREATE OR REPLACE FUNCTION public.user_can(p_business_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;                       -- no anonymous / service capability here
  END IF;

  -- Owner override: the owner is approver + admin, independent of any member row.
  IF EXISTS (SELECT 1 FROM public.businesses
             WHERE id = p_business_id AND owner_id = auth.uid() AND deleted_at IS NULL) THEN
    v_role := 'approver'; v_is_admin := true;
  ELSE
    SELECT m.role, m.is_admin INTO v_role, v_is_admin
    FROM public.business_members m
    WHERE m.business_id = p_business_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN false;                     -- not a member of this tenant
    END IF;
  END IF;

  RETURN CASE p_capability
    WHEN 'author'           THEN v_role IN ('editor','approver')
    WHEN 'reschedule'       THEN v_role IN ('editor','approver')
    WHEN 'approve'          THEN v_role =  'approver'
    WHEN 'connect_accounts' THEN v_role =  'approver' OR v_is_admin   -- L-2 union / D-4
    WHEN 'manage_members'   THEN v_is_admin
    WHEN 'manage_billing'   THEN v_is_admin
    ELSE false                          -- unknown capability → deny
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.user_can(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.user_can(uuid, text) TO authenticated;

-- ─── business_members INSERT/UPDATE policies (deferred from 21A-B1 §2.1) ───

-- INSERT (invite): admins only; new rows are reserved invites.
CREATE POLICY business_members_insert ON public.business_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.user_can(business_id, 'manage_members'))
    AND status = 'invited' AND user_id IS NULL
  );

-- UPDATE (change role / revoke): admins only. Primary-admin protection is a trigger (§2.2).
-- The accept path is NOT here — the invitee is not yet a member, so user_can is
-- false for them; acceptance runs through the DEFINER RPC accept_invite (21A-B5+).
CREATE POLICY business_members_update ON public.business_members
  FOR UPDATE TO authenticated
  USING      ((SELECT public.user_can(business_id, 'manage_members')))
  WITH CHECK ((SELECT public.user_can(business_id, 'manage_members')));

-- No DELETE policy. Revocation is an UPDATE to status='revoked' (frees the seat,
-- retains the audit row). Hard delete happens only via ON DELETE CASCADE on
-- business purge. This is also why owner protection (§2.2) is UPDATE-only.
