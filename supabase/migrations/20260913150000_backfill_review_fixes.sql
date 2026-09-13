-- ADR 0025 (Session 32 I2.6) — ecc:database-reviewer findings against the
-- I2.4/I2.5/I2.6 migration set (ECC budget invocation 3 of 3), fixed by a
-- FORWARD migration since 20260913120000/130000/140000 are already applied
-- live — never by editing a committed/applied migration. Three MEDIUM
-- findings, all against 20260913140000's own new surface:
--
-- 1. remove_import_source_post's `import_source_post_ids @> ARRAY[...]`
--    predicate has no supporting index on any of the three tables — a
--    sequential scan that degrades as a business's memory grows. Fixed with
--    a GIN index per table, scoped to source='import' (the only rows this
--    function ever touches).
-- 2. The three import_*_memory RPCs never verify that p_business_id matches
--    the business that actually owns p_import_run_id's social_backfill_runs
--    row. The ON DELETE NO ACTION purge-safety argument (20260913140000:14-20)
--    silently depends on that invariant holding; nothing enforced it. Fixed
--    by a guard inside each RPC — CREATE OR REPLACE, signatures unchanged.
-- 3. ratify_backfill_run and discard_backfill_run, run concurrently for the
--    SAME run_id, can deadlock: both touch the same five tables in the same
--    macro order, but neither locks the parent run row FIRST, so their bulk
--    UPDATEs on evidence/audience/performance_memory can lock an overlapping
--    candidate-row set in different physical orders (PK order vs.
--    import_run_id-index order). Fixed by SELECT ... FOR UPDATE on the
--    social_backfill_runs row as the first statement in both functions —
--    the CLAUDE.md "consistent lock ordering" principle, applied here as
--    "lock the parent before its children." CREATE OR REPLACE, signatures
--    unchanged.
--
-- NOT fixed here (recorded, not rejected — deferred as genuinely LOW/INFO
-- per the reviewer's own severity call, and out of this step's scope):
-- error_code has no enumerating CHECK; social_accounts.created_at remains
-- in the I2.4 authenticated UPDATE allowlist (connected_at, the column that
-- actually gates trial-clock logic, is correctly excluded); weighting has
-- no CHECK (ADR does not specify a closed enum for it).

-- ─── (1) GIN indexes for per-post removal ───────────────────────────────────

CREATE INDEX evidence_memory_import_source_post_ids_gin_idx
  ON public.evidence_memory USING GIN (import_source_post_ids)
  WHERE source = 'import';

CREATE INDEX audience_memory_import_source_post_ids_gin_idx
  ON public.audience_memory USING GIN (import_source_post_ids)
  WHERE source = 'import';

CREATE INDEX performance_memory_import_source_post_ids_gin_idx
  ON public.performance_memory USING GIN (import_source_post_ids)
  WHERE source = 'import';

-- ─── (2) business_id / import_run_id consistency guard ──────────────────────

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
  VALUES (
    p_business_id, 'import', p_confidence, 'candidate', 'internal', false,
    p_scope, p_scope_ref, p_last_confirmed_at, p_expires_at,
    p_import_run_id, p_import_source_post_ids, p_kind, p_content, p_source_url
  )
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
  VALUES (
    p_business_id, 'import', p_confidence, 'candidate', 'internal', false,
    p_scope, p_scope_ref, p_last_confirmed_at, p_expires_at,
    p_import_run_id, p_import_source_post_ids, p_segment, p_kind, p_statement
  )
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
  VALUES (
    p_business_id, 'import', p_confidence, p_observation_count, 'candidate', 'internal', false,
    p_scope, p_scope_ref, p_last_confirmed_at, p_expires_at,
    p_import_run_id, p_import_source_post_ids, p_dimension, p_pattern, p_platform
  )
  ON CONFLICT (business_id, dimension, coalesce(platform, ''), md5(lower(pattern)), import_run_id)
    WHERE source = 'import' AND deleted_at IS NULL DO NOTHING
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.import_performance_memory(uuid, uuid, text[], text, text, text, text, text, numeric, integer, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_performance_memory(uuid, uuid, text[], text, text, text, text, text, numeric, integer, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_performance_memory(uuid, uuid, text[], text, text, text, text, text, numeric, integer, timestamptz, timestamptz) TO service_role;

-- ─── (3) lock the parent run row FIRST — closes the ratify/discard deadlock
-- class by construction rather than reducing its probability. Whichever
-- transaction acquires the run-row lock first proceeds through all five
-- tables uncontested; the second blocks on that ONE row until the first
-- commits, then its own guarded terminal UPDATE (WHERE status =
-- 'awaiting_ratification' / WHERE status NOT IN ('ratified','discarded'))
-- correctly resolves to a no-op rather than racing. ─────────────────────────

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
BEGIN
  SELECT business_id, staged_voice INTO v_business_id, v_staged_voice
    FROM public.social_backfill_runs
   WHERE id = p_run_id
   FOR UPDATE;

  IF v_business_id IS NULL THEN
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
       WHERE business_id = v_business_id AND user_id = p_user_id AND status = 'active'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.businesses
       WHERE id = v_business_id AND owner_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'discard_backfill_run: % is not an active member of business %', p_user_id, v_business_id;
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
