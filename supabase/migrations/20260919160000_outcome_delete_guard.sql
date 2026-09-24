-- ADR 0026 (Session 33 J2.11) — forward migration, from the security-reviewer's MINOR-2.
--
-- A member could hard-DELETE an outcome row from performance_memory through the anon client: the
-- performance_memory_delete_own policy (20260719010000:255) had no source restriction. For the
-- hypothesis row written by acknowledge_campaign_retrospective that would leave an acknowledged
-- retrospective with no memory row and quietly drop that cycle from the north-star.
--
-- Outcome rows are produced and retired by the outcome RPCs and the service role (the soft-retire
-- path, an UPDATE, stays open to members). A member may still delete every other row exactly as
-- before. purge_business and FK cascades are not policy-governed and are unaffected.
--
-- SECURITY: the USING clause keeps the original InitPlan tenancy predicate and only ADDS
-- source <> 'outcome'.

DROP POLICY IF EXISTS performance_memory_delete_own ON public.performance_memory;

CREATE POLICY performance_memory_delete_own
  ON public.performance_memory FOR DELETE TO authenticated
  USING (
    business_id = ANY (SELECT unnest(public.get_user_business_ids()))
    AND source <> 'outcome'
  );
