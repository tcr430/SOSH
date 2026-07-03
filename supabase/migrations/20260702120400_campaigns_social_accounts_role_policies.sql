-- ADR 0013 (Rev A) §5.3 / §5.4 — role-aware write policies on campaigns and
-- social_accounts. SELECT policies on both tables are untouched.

-- ─── campaigns (§5.3) — simple policy delta, no status-transition trigger ───
-- No capability-differentiated transition on campaigns (post-level approval is
-- the only approval gate). A viewer cannot write; editor+ can.

DROP POLICY campaigns_insert_own ON public.campaigns;
DROP POLICY campaigns_update_own ON public.campaigns;
DROP POLICY campaigns_delete_own ON public.campaigns;

CREATE POLICY campaigns_insert_own
  ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'author')));

CREATE POLICY campaigns_update_own
  ON public.campaigns FOR UPDATE TO authenticated
  USING      (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'author')))
  WITH CHECK (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'author')));

CREATE POLICY campaigns_delete_own
  ON public.campaigns FOR DELETE TO authenticated
  USING (business_id = ANY ((SELECT public.get_user_business_ids()))
         AND (SELECT public.user_can(business_id, 'author')));

-- ─── social_accounts (§5.4) — defense-in-depth only ─────────────────────────
-- The real connect path writes via service-role (vault token ids force it),
-- so this predicate cannot gate the actual connect/disconnect flow. It exists
-- only for any future authenticated write against this table. The
-- authoritative connect_accounts gate is the route-handler user_can() call —
-- that wiring is 21B (RLS-SOCIAL-APPLAYER).

DROP POLICY social_accounts_insert_own ON public.social_accounts;
DROP POLICY social_accounts_update_own ON public.social_accounts;
DROP POLICY social_accounts_delete_own ON public.social_accounts;

CREATE POLICY social_accounts_insert_own
  ON public.social_accounts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'connect_accounts')));

CREATE POLICY social_accounts_update_own
  ON public.social_accounts FOR UPDATE TO authenticated
  USING      (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'connect_accounts')))
  WITH CHECK (business_id = ANY ((SELECT public.get_user_business_ids()))
              AND (SELECT public.user_can(business_id, 'connect_accounts')));

CREATE POLICY social_accounts_delete_own
  ON public.social_accounts FOR DELETE TO authenticated
  USING (business_id = ANY ((SELECT public.get_user_business_ids()))
         AND (SELECT public.user_can(business_id, 'connect_accounts')));
