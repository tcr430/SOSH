-- Migration 017: Wrap RLS function calls in subqueries for plan-time caching
--
-- Postgres evaluates a bare function call (e.g. get_user_business_ids()) once
-- per row during a sequential scan. Wrapping it in a subquery
-- (SELECT get_user_business_ids()) lets the planner treat it as an InitPlan
-- evaluated once per statement.
--
-- Same optimisation applies to auth.uid() on the businesses table.
-- All policies are dropped and recreated; no permission changes.

-- ── businesses ─────────────────────────────────────────────────────────────

DROP POLICY businesses_select_own ON public.businesses;
DROP POLICY businesses_insert_own ON public.businesses;
DROP POLICY businesses_update_own ON public.businesses;

CREATE POLICY businesses_select_own
  ON public.businesses FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);

CREATE POLICY businesses_insert_own
  ON public.businesses FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY businesses_update_own
  ON public.businesses FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- ── brand_voices ───────────────────────────────────────────────────────────

DROP POLICY brand_voices_select_own ON public.brand_voices;
DROP POLICY brand_voices_insert_own ON public.brand_voices;
DROP POLICY brand_voices_update_own ON public.brand_voices;
DROP POLICY brand_voices_delete_own ON public.brand_voices;

CREATE POLICY brand_voices_select_own
  ON public.brand_voices FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY brand_voices_insert_own
  ON public.brand_voices FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY brand_voices_update_own
  ON public.brand_voices FOR UPDATE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY brand_voices_delete_own
  ON public.brand_voices FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ── social_accounts ────────────────────────────────────────────────────────

DROP POLICY social_accounts_select_own ON public.social_accounts;
DROP POLICY social_accounts_insert_own ON public.social_accounts;
DROP POLICY social_accounts_update_own ON public.social_accounts;
DROP POLICY social_accounts_delete_own ON public.social_accounts;

CREATE POLICY social_accounts_select_own
  ON public.social_accounts FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY social_accounts_insert_own
  ON public.social_accounts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY social_accounts_update_own
  ON public.social_accounts FOR UPDATE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY social_accounts_delete_own
  ON public.social_accounts FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ── trial_state (SELECT only) ──────────────────────────────────────────────

DROP POLICY trial_state_select_own ON public.trial_state;

CREATE POLICY trial_state_select_own
  ON public.trial_state FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ── campaigns ──────────────────────────────────────────────────────────────

DROP POLICY campaigns_select_own ON public.campaigns;
DROP POLICY campaigns_insert_own ON public.campaigns;
DROP POLICY campaigns_update_own ON public.campaigns;
DROP POLICY campaigns_delete_own ON public.campaigns;

CREATE POLICY campaigns_select_own
  ON public.campaigns FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY campaigns_insert_own
  ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY campaigns_update_own
  ON public.campaigns FOR UPDATE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY campaigns_delete_own
  ON public.campaigns FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ── posts ──────────────────────────────────────────────────────────────────

DROP POLICY posts_select_own ON public.posts;
DROP POLICY posts_insert_own ON public.posts;
DROP POLICY posts_update_own ON public.posts;
DROP POLICY posts_delete_own ON public.posts;

CREATE POLICY posts_select_own
  ON public.posts FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY posts_insert_own
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY posts_update_own
  ON public.posts FOR UPDATE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY posts_delete_own
  ON public.posts FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ── post_metrics (SELECT only — write policies dropped in migration 016) ───

DROP POLICY post_metrics_select_own ON public.post_metrics;

CREATE POLICY post_metrics_select_own
  ON public.post_metrics FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ── engagement_inbox (SELECT only — write policies dropped in migration 016)

DROP POLICY engagement_inbox_select_own ON public.engagement_inbox;

CREATE POLICY engagement_inbox_select_own
  ON public.engagement_inbox FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ── ai_usage (SELECT only) ─────────────────────────────────────────────────

DROP POLICY ai_usage_select_own ON public.ai_usage;

CREATE POLICY ai_usage_select_own
  ON public.ai_usage FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));
