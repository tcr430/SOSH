-- Session 32-D correction pass · D3 — THE ONLY MIGRATION this pass makes.
-- Fixes MAJOR-2, MAJOR-5, MINOR-3, MINOR-4, MINOR-8, MINOR-9 (A-8),
-- BLOCKER-3's writer against docs/reviews/session-32-reviewer.md
-- (range 4f3e7129..3914a31c). Every function is CREATE OR REPLACE over an
-- already-applied migration — 20260913120000..20260914060000 are never
-- edited in place.

-- ─── (1) MAJOR-2 — ratify_backfill_run's status guard moves BEFORE the six
-- memory UPDATEs and the staging DELETE, not after. Today a run that is
-- NOT 'awaiting_ratification' (e.g. still 'extracting') still has its
-- candidates activated/retired and its staging deleted, and only the FINAL
-- UPDATE's WHERE status = 'awaiting_ratification' silently no-ops — by then
-- the damage is done. The FOR UPDATE lock on the run row (150000's own
-- deadlock fix) makes a single status read immediately after it race-free:
-- nothing else can change this run's status until this transaction commits
-- or rolls back. Grants, membership check, source/import_run_id filter and
-- staged_voice are all otherwise unchanged. ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.ratify_backfill_run(
  p_user_id       uuid,
  p_run_id        uuid,
  p_accepted_ids  uuid[],
  p_rejected_ids  uuid[],
  p_account_role  text
)
RETURNS SETOF public.social_backfill_runs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id   uuid;
  v_staged_voice  jsonb;
  v_status        text;
BEGIN
  SELECT business_id, staged_voice, status INTO v_business_id, v_staged_voice, v_status
    FROM public.social_backfill_runs
   WHERE id = p_run_id
   FOR UPDATE;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  -- MAJOR-2: a run not currently awaiting ratification touches NOTHING —
  -- checked here, before any memory write, not discovered only at the
  -- final UPDATE's guard.
  IF v_status IS DISTINCT FROM 'awaiting_ratification' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND (role = 'approver' OR is_admin)
  ) THEN
    RAISE EXCEPTION 'ratify_backfill_run: % is not an approver/admin member of business %', p_user_id, v_business_id;
  END IF;

  UPDATE public.evidence_memory
     SET status = 'active'
   WHERE id = ANY (p_accepted_ids) AND source = 'import' AND import_run_id = p_run_id AND status = 'candidate';
  UPDATE public.audience_memory
     SET status = 'active'
   WHERE id = ANY (p_accepted_ids) AND source = 'import' AND import_run_id = p_run_id AND status = 'candidate';
  UPDATE public.performance_memory
     SET status = 'active'
   WHERE id = ANY (p_accepted_ids) AND source = 'import' AND import_run_id = p_run_id AND status = 'candidate';

  UPDATE public.evidence_memory
     SET status = 'retired'
   WHERE id = ANY (p_rejected_ids) AND source = 'import' AND import_run_id = p_run_id AND status = 'candidate';
  UPDATE public.audience_memory
     SET status = 'retired'
   WHERE id = ANY (p_rejected_ids) AND source = 'import' AND import_run_id = p_run_id AND status = 'candidate';
  UPDATE public.performance_memory
     SET status = 'retired'
   WHERE id = ANY (p_rejected_ids) AND source = 'import' AND import_run_id = p_run_id AND status = 'candidate';

  DELETE FROM public.social_backfill_posts WHERE run_id = p_run_id;

  RETURN QUERY
  UPDATE public.social_backfill_runs
     SET status = 'ratified',
         account_role = p_account_role,
         ratified_at = now(),
         voice_status = CASE WHEN v_staged_voice IS NOT NULL THEN 'pending' ELSE voice_status END,
         updated_at = now()
   WHERE id = p_run_id
     AND status = 'awaiting_ratification'
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.ratify_backfill_run(uuid, uuid, uuid[], uuid[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ratify_backfill_run(uuid, uuid, uuid[], uuid[], text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ratify_backfill_run(uuid, uuid, uuid[], uuid[], text) TO service_role;

-- ─── (2) MINOR-4 — discard_backfill_run's p_user_id guard requires
-- approver/admin, matching ratify's own gate, instead of any active
-- member. The owner_id fallback branch this replaces is redundant:
-- trg_ensure_owner_membership (20260702120800) guarantees every business
-- owner already holds a business_members row with role='approver',
-- is_admin=true, status='active', so the single membership check below
-- covers the owner too. The NULL p_user_id system path
-- (deactivateSocialAccount) is UNCHANGED. ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.discard_backfill_run(p_run_id uuid, p_user_id uuid)
RETURNS SETOF public.social_backfill_runs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id
    FROM public.social_backfill_runs
   WHERE id = p_run_id
   FOR UPDATE;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.business_members
       WHERE business_id = v_business_id
         AND user_id = p_user_id
         AND status = 'active'
         AND (role = 'approver' OR is_admin)
    ) THEN
      RAISE EXCEPTION 'discard_backfill_run: % is not an approver/admin member of business %', p_user_id, v_business_id;
    END IF;
  END IF;

  UPDATE public.evidence_memory SET status = 'retired'
   WHERE source = 'import' AND import_run_id = p_run_id AND status = 'candidate';
  UPDATE public.audience_memory SET status = 'retired'
   WHERE source = 'import' AND import_run_id = p_run_id AND status = 'candidate';
  UPDATE public.performance_memory SET status = 'retired'
   WHERE source = 'import' AND import_run_id = p_run_id AND status = 'candidate';

  DELETE FROM public.social_backfill_posts WHERE run_id = p_run_id;

  RETURN QUERY
  UPDATE public.social_backfill_runs
     SET status = 'discarded', staged_voice = NULL, updated_at = now()
   WHERE id = p_run_id
     AND status NOT IN ('ratified', 'discarded')
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.discard_backfill_run(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.discard_backfill_run(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_backfill_run(uuid, uuid) TO service_role;

-- ─── (3) MAJOR-5 + MINOR-3 — the three import_*_memory RPCs. Adding, to
-- each, atomically inside the INSERT's own WHERE clause (never a separate
-- count-then-insert read, same reasoning as the evidence cap at
-- 20260914050000):
--   (a) MINOR-3 — zero rows written unless the run is 'extracting'.
--   (b) MAJOR-5 — audience_memory capped at 25, performance_memory capped
--       at 15 rows already written FOR THE RUN (evidence_memory's cap of
--       40 already exists at 20260914050000 and is untouched here except
--       for adding (a) to it). The p_business_id / p_import_run_id
--       ownership guard (RAISE EXCEPTION, 20260913150000) is unchanged. ────

CREATE OR REPLACE FUNCTION public.import_evidence_memory(
  p_business_id           uuid,
  p_import_run_id         uuid,
  p_import_source_post_ids text[],
  p_kind                  text,
  p_content                text,
  p_source_url             text,
  p_scope                  text,
  p_scope_ref              text,
  p_confidence              numeric,
  p_last_confirmed_at       timestamptz,
  p_expires_at              timestamptz
)
RETURNS SETOF public.evidence_memory
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT isfinite(p_last_confirmed_at) THEN
    RAISE EXCEPTION 'import_evidence_memory: last_confirmed_at must be finite';
  END IF;
  IF p_expires_at IS NOT NULL AND NOT isfinite(p_expires_at) THEN
    RAISE EXCEPTION 'import_evidence_memory: expires_at must be finite';
  END IF;
  IF p_business_id IS DISTINCT FROM (SELECT business_id FROM public.social_backfill_runs WHERE id = p_import_run_id) THEN
    RAISE EXCEPTION 'import_evidence_memory: p_business_id does not match the business owning p_import_run_id';
  END IF;

  RETURN QUERY
  INSERT INTO public.evidence_memory (
    business_id, source, confidence, status, sensitivity, public_use_permission,
    scope, scope_ref, last_confirmed_at, expires_at,
    import_run_id, import_source_post_ids, kind, content, source_url
  )
  SELECT
    p_business_id, 'import', p_confidence, 'candidate', 'internal', false,
    p_scope, p_scope_ref, p_last_confirmed_at, p_expires_at,
    p_import_run_id, p_import_source_post_ids, p_kind, p_content, p_source_url
  WHERE (SELECT status FROM public.social_backfill_runs WHERE id = p_import_run_id) = 'extracting'
    AND (
      SELECT count(*) FROM public.evidence_memory
       WHERE import_run_id = p_import_run_id AND source = 'import'
    ) < 40
  ON CONFLICT (import_run_id, kind, md5(content)) WHERE source = 'import' DO NOTHING
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.import_evidence_memory(uuid, uuid, text[], text, text, text, text, text, numeric, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_evidence_memory(uuid, uuid, text[], text, text, text, text, text, numeric, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_evidence_memory(uuid, uuid, text[], text, text, text, text, text, numeric, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.import_audience_memory(
  p_business_id            uuid,
  p_import_run_id          uuid,
  p_import_source_post_ids text[],
  p_segment                text,
  p_kind                   text,
  p_statement               text,
  p_scope                   text,
  p_scope_ref               text,
  p_confidence               numeric,
  p_last_confirmed_at        timestamptz,
  p_expires_at               timestamptz
)
RETURNS SETOF public.audience_memory
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT isfinite(p_last_confirmed_at) THEN
    RAISE EXCEPTION 'import_audience_memory: last_confirmed_at must be finite';
  END IF;
  IF p_expires_at IS NOT NULL AND NOT isfinite(p_expires_at) THEN
    RAISE EXCEPTION 'import_audience_memory: expires_at must be finite';
  END IF;
  IF p_business_id IS DISTINCT FROM (SELECT business_id FROM public.social_backfill_runs WHERE id = p_import_run_id) THEN
    RAISE EXCEPTION 'import_audience_memory: p_business_id does not match the business owning p_import_run_id';
  END IF;

  RETURN QUERY
  INSERT INTO public.audience_memory (
    business_id, source, confidence, status, sensitivity, public_use_permission,
    scope, scope_ref, last_confirmed_at, expires_at,
    import_run_id, import_source_post_ids, segment, kind, statement
  )
  SELECT
    p_business_id, 'import', p_confidence, 'candidate', 'internal', false,
    p_scope, p_scope_ref, p_last_confirmed_at, p_expires_at,
    p_import_run_id, p_import_source_post_ids, p_segment, p_kind, p_statement
  WHERE (SELECT status FROM public.social_backfill_runs WHERE id = p_import_run_id) = 'extracting'
    AND (
      SELECT count(*) FROM public.audience_memory
       WHERE import_run_id = p_import_run_id AND source = 'import'
    ) < 25
  ON CONFLICT (import_run_id, kind, md5(lower(statement))) WHERE source = 'import' DO NOTHING
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.import_audience_memory(uuid, uuid, text[], text, text, text, text, text, numeric, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_audience_memory(uuid, uuid, text[], text, text, text, text, text, numeric, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_audience_memory(uuid, uuid, text[], text, text, text, text, text, numeric, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.import_performance_memory(
  p_business_id             uuid,
  p_import_run_id           uuid,
  p_import_source_post_ids  text[],
  p_dimension               text,
  p_pattern                  text,
  p_platform                  text,
  p_scope                     text,
  p_scope_ref                 text,
  p_confidence                 numeric,
  p_observation_count          integer,
  p_last_confirmed_at          timestamptz,
  p_expires_at                 timestamptz
)
RETURNS SETOF public.performance_memory
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT isfinite(p_last_confirmed_at) THEN
    RAISE EXCEPTION 'import_performance_memory: last_confirmed_at must be finite';
  END IF;
  IF p_expires_at IS NOT NULL AND NOT isfinite(p_expires_at) THEN
    RAISE EXCEPTION 'import_performance_memory: expires_at must be finite';
  END IF;
  IF p_business_id IS DISTINCT FROM (SELECT business_id FROM public.social_backfill_runs WHERE id = p_import_run_id) THEN
    RAISE EXCEPTION 'import_performance_memory: p_business_id does not match the business owning p_import_run_id';
  END IF;

  RETURN QUERY
  INSERT INTO public.performance_memory (
    business_id, source, confidence, observation_count, status, sensitivity, public_use_permission,
    scope, scope_ref, last_confirmed_at, expires_at,
    import_run_id, import_source_post_ids, dimension, pattern, platform
  )
  SELECT
    p_business_id, 'import', p_confidence, p_observation_count, 'candidate', 'internal', false,
    p_scope, p_scope_ref, p_last_confirmed_at, p_expires_at,
    p_import_run_id, p_import_source_post_ids, p_dimension, p_pattern, p_platform
  WHERE (SELECT status FROM public.social_backfill_runs WHERE id = p_import_run_id) = 'extracting'
    AND (
      SELECT count(*) FROM public.performance_memory
       WHERE import_run_id = p_import_run_id AND source = 'import'
    ) < 15
  ON CONFLICT (business_id, dimension, coalesce(platform, ''), md5(lower(pattern)), import_run_id)
    WHERE source = 'import' AND deleted_at IS NULL DO NOTHING
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.import_performance_memory(uuid, uuid, text[], text, text, text, text, text, numeric, integer, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_performance_memory(uuid, uuid, text[], text, text, text, text, text, numeric, integer, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_performance_memory(uuid, uuid, text[], text, text, text, text, text, numeric, integer, timestamptz, timestamptz) TO service_role;

-- ─── (4) MINOR-8 — `authenticated` holds a table-level INSERT and DELETE
-- grant on social_accounts (from 20260707190000's blanket "GRANT ... ON ALL
-- TABLES IN SCHEMA public"), the same over-wide-grant shape
-- 20260913120000 already closed for UPDATE. A repo-wide grep (recorded in
-- docs/reviews/session-32-reviewer.md's D3 appendix) of every INSERT/DELETE
-- against social_accounts across app/, lib/ and supabase/migrations/ found
-- none issued from an authenticated-role client: the OAuth callback
-- (app/api/social/[platform]/callback/route.ts) and disconnect
-- (lib/db/social-accounts.ts's deactivateSocialAccount, an UPDATE not a
-- DELETE) both use the service-role client exclusively; the one function
-- that DOES insert with a caller-supplied client (createSocialAccount) has
-- no production caller — only its own test. Safe to revoke. ─────────────────

REVOKE INSERT, DELETE ON public.social_accounts FROM authenticated, anon;

-- ─── (5) MINOR-9 per A-8 (founder ruling, 2026-09-15, accepted as
-- recommended) — ADR §8.3 has no retention row for CANDIDATE memory
-- belonging to a run that is never ratified or discarded: today such rows
-- persist forever. Two-stage sweep, anchored on the owning run's
-- completed_at (stable — a run this sweep targets never transitions once
-- it reaches awaiting_ratification, because nobody ever rules on it):
--   Stage 1 (retire): import candidate rows of a run STILL
--     'awaiting_ratification' whose completed_at is older than
--     p_ttl_days -> status = 'retired'.
--   Stage 2 (delete): import rows already 'retired' by stage 1 — same
--     run-status filter, so a row retired via ratification-rejection or
--     discard (whose OWNING RUN is 'ratified'/'discarded', never
--     'awaiting_ratification') is NEVER matched here and keeps the
--     founder-deletion/per-post-removal/business-purge retention ADR
--     §8.3 already specifies for those — is deleted once its run's
--     completed_at is older than 2 * p_ttl_days (i.e. p_ttl_days AFTER
--     stage 1 retired it, since stage 1 fires at exactly p_ttl_days).
--     Both horizons reuse the same BACKFILL_STAGING_TTL_DAYS = 30 the ADR
--     already accepts for staged post text (A-8's own recommendation),
--     never a separately-tunable constant. ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_expired_backfill_candidates(p_ttl_days integer)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH retire_runs AS (
    SELECT id FROM public.social_backfill_runs
     WHERE status = 'awaiting_ratification'
       AND completed_at IS NOT NULL
       AND completed_at < now() - (p_ttl_days || ' days')::interval
  ),
  delete_runs AS (
    SELECT id FROM public.social_backfill_runs
     WHERE status = 'awaiting_ratification'
       AND completed_at IS NOT NULL
       AND completed_at < now() - ((2 * p_ttl_days) || ' days')::interval
  ),
  retired_evidence AS (
    UPDATE public.evidence_memory SET status = 'retired'
     WHERE source = 'import' AND status = 'candidate' AND import_run_id IN (SELECT id FROM retire_runs)
    RETURNING 1
  ),
  retired_audience AS (
    UPDATE public.audience_memory SET status = 'retired'
     WHERE source = 'import' AND status = 'candidate' AND import_run_id IN (SELECT id FROM retire_runs)
    RETURNING 1
  ),
  retired_performance AS (
    UPDATE public.performance_memory SET status = 'retired'
     WHERE source = 'import' AND status = 'candidate' AND import_run_id IN (SELECT id FROM retire_runs)
    RETURNING 1
  ),
  deleted_evidence AS (
    DELETE FROM public.evidence_memory
     WHERE source = 'import' AND status = 'retired' AND import_run_id IN (SELECT id FROM delete_runs)
    RETURNING 1
  ),
  deleted_audience AS (
    DELETE FROM public.audience_memory
     WHERE source = 'import' AND status = 'retired' AND import_run_id IN (SELECT id FROM delete_runs)
    RETURNING 1
  ),
  deleted_performance AS (
    DELETE FROM public.performance_memory
     WHERE source = 'import' AND status = 'retired' AND import_run_id IN (SELECT id FROM delete_runs)
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM retired_evidence) + (SELECT count(*) FROM retired_audience) +
    (SELECT count(*) FROM retired_performance) + (SELECT count(*) FROM deleted_evidence) +
    (SELECT count(*) FROM deleted_audience) + (SELECT count(*) FROM deleted_performance);
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_backfill_candidates(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_expired_backfill_candidates(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_backfill_candidates(integer) TO service_role;

-- ─── (6) BLOCKER-3's WRITER — nothing sets posts_extracted today; the
-- step-4 panel (BackfillPanel.tsx) reads it to decide whether a run has
-- anything to ratify, so every real run showed zero. Definition: a post is
-- PROCESSED, i.e. moved to 'extracted' or 'skipped' — never merely
-- staged, and never 'failed' (a permanently-failed post was never
-- meaningfully processed into memory). Grouped by run_id so a bulk call
-- spanning posts from more than one run increments each correctly; a
-- second resolve of an already-resolved id matches zero rows (the existing
-- extraction_status = 'claimed' guard) and so cannot double-count. ─────────

CREATE OR REPLACE FUNCTION public.resolve_backfill_posts(p_post_ids uuid[], p_status text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_ids uuid[];
  v_count   integer;
BEGIN
  -- A CTE only lives for the ONE statement that declares it — array_agg
  -- here, in the SAME WITH...SELECT, is what carries the resolved run_ids
  -- past that statement boundary into a plain plpgsql variable.
  WITH resolved AS (
    UPDATE public.social_backfill_posts
       SET extraction_status = p_status
     WHERE id = ANY (p_post_ids)
       AND extraction_status = 'claimed'
    RETURNING run_id
  )
  SELECT array_agg(run_id), count(*) INTO v_run_ids, v_count FROM resolved;

  IF v_count > 0 AND p_status IN ('extracted', 'skipped') THEN
    UPDATE public.social_backfill_runs r
       SET posts_extracted = r.posts_extracted + rc.n,
           updated_at = now()
      FROM (SELECT run_id, count(*) AS n FROM unnest(v_run_ids) AS t(run_id) GROUP BY run_id) rc
     WHERE r.id = rc.run_id;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_backfill_posts(uuid[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_backfill_posts(uuid[], text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_backfill_posts(uuid[], text) TO service_role;
