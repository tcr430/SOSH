-- ADR 0013 (Rev A) §7.3 — accept_invite(member_id, business_id) SECURITY DEFINER RPC.
--
-- Why DEFINER: the accepting user is NOT YET a member, so get_user_business_ids()
-- does not include the business and business_members_update (user_can(...,
-- 'manage_members')) is false for them. RLS cannot admit this write; a DEFINER
-- RPC is the only correct mechanism (RLS-ACCEPT-DEFINER-ONLY).

CREATE OR REPLACE FUNCTION public.accept_invite(p_member_id uuid, p_business_id uuid)
RETURNS public.business_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row       public.business_members;
  v_auth_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT lower(email) INTO v_auth_email FROM auth.users WHERE id = auth.uid();

  -- Idempotency: already accepted by THIS user → return the row unchanged.
  SELECT * INTO v_row FROM public.business_members
   WHERE id = p_member_id AND business_id = p_business_id;
  IF FOUND AND v_row.status = 'active' AND v_row.user_id = auth.uid() THEN
    RETURN v_row;
  END IF;

  -- Rev A / m2 — double-membership pre-check: if this user is ALREADY an active
  -- member of this business via a different row, don't trip the unique index with
  -- a raw 23505; raise a clear, catchable message for 21B to surface (e.g. auto-
  -- revoke the redundant invite + "you're already on this team").
  IF EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = p_business_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND id <> p_member_id
  ) THEN
    RAISE EXCEPTION 'already an active member of this business'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Bind. Guards, all atomic in one WHERE:
  --   status='invited' AND user_id IS NULL   → single-use (replay fails once bound)
  --   lower(email)=v_auth_email              → Rev A / m4 email-match (closes the
  --                                             in-tenant hijack now that invited
  --                                             rows are visible to all members)
  --   invited_at > now()-7d                  → Rev A / m1 DB-side expiry (holds even
  --                                             if the app-side token check is skipped)
  UPDATE public.business_members
     SET user_id = auth.uid(), status = 'active', accepted_at = now()
   WHERE id = p_member_id
     AND business_id = p_business_id
     AND status = 'invited'
     AND user_id IS NULL
     AND lower(email) = v_auth_email
     AND invited_at > now() - interval '7 days'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Ambiguous by design: don't leak whether it was expiry / email-mismatch /
    -- already-claimed / unknown. 21B shows a generic "invite is no longer valid".
    RAISE EXCEPTION 'invite not available (expired, already accepted, revoked, wrong account, or unknown)';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_invite(uuid, uuid) TO authenticated;
