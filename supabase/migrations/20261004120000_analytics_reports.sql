-- Session 37 O2.2 (ADR 0031 §5.1, §5.4, §11; founder ruling O-3 in session-37.md §0.2) — the analytics report snapshot.
--
-- WHAT THIS MIGRATION DOES, in the order ADR 0031 §11 lists it:
--   1. ONE new business-scoped table, public.analytics_reports: an immutable monthly snapshot (§5.1).
--   2. The posts partial index the report and the portfolio page read through (§2.7, §9.1).
--   3. email_outbox_kind_check widened with 'monthly-report', the six existing kinds COPIED from
--      20260709120000:3-9 (§5.4).
--   4. email_outbox_select_own moved to the InitPlan form. DECLARED HERE, NOT BUNDLED SILENTLY (§11 [db-3]):
--      it is a policy change on a table this migration does not otherwise add, made because the new kind adds rows
--      to a table whose policy still evaluates get_user_business_ids() once per row.
--   5. businesses.report_email (A-6), the opt-out for the report EMAIL (never for generation or the in-app report).
--
-- NO NEW SQL FUNCTION (the DEFINER audit gate's count must not move; docs/launch-checklist.md section 2):
--   * the write-once trigger REUSES public.reject_outcome_table_update() (20260919110000:158-166), which is
--     SECURITY INVOKER, table-agnostic (it raises with TG_TABLE_NAME) and already REVOKEd from PUBLIC, anon and
--     authenticated (20260919150000:97);
--   * report_email needs NO restricting trigger. O2.0 premise 3 found the businesses UPDATE policy is OWNER-ONLY
--     (USING and WITH CHECK are both owner_id = auth.uid(), 20260430120017:25-27), so no other member, admin or not,
--     can write the column through PostgREST. Founder ruling O-3 (2026-10-04) narrows the ADR's "admin" to "owner".
--
-- RLS (ADR 0031 §11): ONE policy, SELECT TO authenticated, the InitPlan form (get_user_business_ids() wrapped in a
-- SELECT so it evaluates once per query). get_user_business_ids() returns an ARRAY, so for a user in two businesses
-- RLS alone does not separate them: every reader adds .eq('business_id', ...) itself (§9.1).

-- ─── 1. analytics_reports (§5.1) ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.analytics_reports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- The first day of the report's month in businesses.timezone. EXTRACT on a date is immutable (date_trunc is not).
  period_month      date        NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  tier              text        NOT NULL CHECK (tier IN ('basic', 'advanced')),
  schema_version    int         NOT NULL,
  -- Aggregates, template keys and their params, exclusion counts, cited post ids. NO post text (§5.1).
  payload           jsonb       NOT NULL,
  -- The instant every read behind this report was bounded by (§2.7 [db-1]); late outcomes are disclosed, not added.
  outcomes_through  timestamptz NOT NULL,
  generated_at      timestamptz NOT NULL,
  -- The idempotency point (INSERT ... ON CONFLICT DO NOTHING) and the index the due check and the report list use.
  CONSTRAINT analytics_reports_business_period_uq UNIQUE (business_id, period_month)
);

-- Write-once: BEFORE UPDATE only, NEVER BEFORE DELETE, so the FK cascade and purge_business still work
-- (ADR 0018 [db-BLOCKER-1], the same shape as post_dimensions and post_outcomes).
CREATE TRIGGER trg_analytics_reports_write_once
BEFORE UPDATE ON public.analytics_reports
FOR EACH ROW EXECUTE FUNCTION public.reject_outcome_table_update();

ALTER TABLE public.analytics_reports ENABLE ROW LEVEL SECURITY;

-- Any member role, a viewer included, may read their business's report (ADR 0031 A-1).
-- There is deliberately NO INSERT, UPDATE or DELETE policy: the report is written only by the service-role worker,
-- and no authenticated write exists to constrain, so no USING / WITH CHECK pair is needed (stated so the
-- policy-pattern check does not flag a missing one).
CREATE POLICY analytics_reports_select_own
  ON public.analytics_reports FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- Defence in depth: no privilege either, so a permissive policy added later cannot silently open a write path.
-- (ALTER DEFAULT PRIVILEGES in 20260707190000 grants every new public table to these roles, hence the REVOKEs.)
REVOKE ALL ON public.analytics_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.analytics_reports FROM authenticated;

-- ─── 2. The posts index (§2.7) ───────────────────────────────────────────────────────────────────────────────
-- No existing posts index covers published_at (20260430120010:42-49 plus later partials). Every query that should
-- use this repeats BOTH predicates literally and orders published_at DESC.
CREATE INDEX posts_business_published_idx
  ON public.posts (business_id, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

-- ─── 3. email_outbox_kind_check (§5.4) ───────────────────────────────────────────────────────────────────────
-- The six kinds below are copied from 20260709120000:3-9; 'monthly-report' is the seventh.
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_kind_check;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('trial-warning-t3','trial-warning-t1',
                  'welcome-to-plan','payment-failed-courtesy',
                  'first-post-published','team-invite',
                  'monthly-report'));

-- ─── 4. email_outbox_select_own to the InitPlan form (declared change; §11 [db-3]) ──────────────────────────
-- Same command, role and meaning as 20260607100000:43-45; only the evaluation changes.
ALTER POLICY email_outbox_select_own ON public.email_outbox
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ─── 5. businesses.report_email (A-6; ADR 0031 §5.4) ─────────────────────────────────────────────────────────
-- 'off' stops ONLY the email (never generation, never the in-app report); 'all_members' widens delivery to every
-- active member. A new column on an already-cascaded table: no new §D2.5 row, a dated note (ADR 0010 A2).
ALTER TABLE public.businesses
  ADD COLUMN report_email text NOT NULL DEFAULT 'admins'
  CONSTRAINT businesses_report_email_check CHECK (report_email IN ('admins', 'all_members', 'off'));
