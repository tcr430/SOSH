-- ADR 0025 §5.1/§9.4 (Session 32 I2.6) — the L-3 provenance marker on all
-- four *_memory tables, and the only SQL paths that write or activate
-- import rows. No new §D2.5 row: import_run_id/import_source_post_ids are
-- additive columns on tables already covered
-- (docs/decisions/0010-legal-surface.md's brand_memory/evidence_memory/
-- audience_memory/performance_memory rows), the same precedent as every
-- other additive-column migration on an already-covered table.

-- ─── the marker, on all four tables ──────────────────────────────────────────
--
-- WHY ON DELETE NO ACTION, not RESTRICT or CASCADE (ADR §5.1): runs are
-- never deleted except by the business cascade, which removes the memory
-- rows IN THE SAME STATEMENT via their OWN business_id ON DELETE CASCADE —
-- NO ACTION is checked at statement end (after every cascade in the
-- statement has run) and by then no surviving row references the deleted
-- run, so purge_business's cascade succeeds unmodified. RESTRICT is checked
-- immediately, mid-statement, and would fail that same cascade. CASCADE
-- would let a run deletion silently erase memory the founder ratified —
-- runs are never hard-deleted today, but a future bug reaching for it must
-- not have that silent-erasure escape hatch available.
--
-- STATED CONSEQUENCE: because social_backfill_runs.social_account_id
-- cascades from social_accounts, a hard DELETE of a single social_accounts
-- row whose run has import memory FAILS on this key today. Acceptable: the
-- only hard delete in the repo is purge_business's root
-- DELETE FROM public.businesses (20260702120700_purge_business_member_delete.sql:62);
-- disconnect is a soft deactivate (ADR §6.8). Any future per-account hard
-- delete must first remove or re-home that account's import memory — a
-- loud failure, which is the intended direction, not a silent one.

ALTER TABLE public.brand_memory
  ADD COLUMN import_run_id uuid NULL REFERENCES public.social_backfill_runs(id) ON DELETE NO ACTION,
  ADD COLUMN import_source_post_ids text[] NULL,
  ADD CONSTRAINT brand_memory_import_run_id_marker_check
    CHECK ((source = 'import') = (import_run_id IS NOT NULL)),
  ADD CONSTRAINT brand_memory_import_source_post_ids_marker_check
    CHECK ((source = 'import') = (import_source_post_ids IS NOT NULL));
CREATE INDEX brand_memory_import_run_id_idx ON public.brand_memory (import_run_id);

ALTER TABLE public.evidence_memory
  ADD COLUMN import_run_id uuid NULL REFERENCES public.social_backfill_runs(id) ON DELETE NO ACTION,
  ADD COLUMN import_source_post_ids text[] NULL,
  ADD CONSTRAINT evidence_memory_import_run_id_marker_check
    CHECK ((source = 'import') = (import_run_id IS NOT NULL)),
  ADD CONSTRAINT evidence_memory_import_source_post_ids_marker_check
    CHECK ((source = 'import') = (import_source_post_ids IS NOT NULL));
CREATE INDEX evidence_memory_import_run_id_idx ON public.evidence_memory (import_run_id);

ALTER TABLE public.audience_memory
  ADD COLUMN import_run_id uuid NULL REFERENCES public.social_backfill_runs(id) ON DELETE NO ACTION,
  ADD COLUMN import_source_post_ids text[] NULL,
  ADD CONSTRAINT audience_memory_import_run_id_marker_check
    CHECK ((source = 'import') = (import_run_id IS NOT NULL)),
  ADD CONSTRAINT audience_memory_import_source_post_ids_marker_check
    CHECK ((source = 'import') = (import_source_post_ids IS NOT NULL));
CREATE INDEX audience_memory_import_run_id_idx ON public.audience_memory (import_run_id);

ALTER TABLE public.performance_memory
  ADD COLUMN import_run_id uuid NULL REFERENCES public.social_backfill_runs(id) ON DELETE NO ACTION,
  ADD COLUMN import_source_post_ids text[] NULL,
  ADD CONSTRAINT performance_memory_import_run_id_marker_check
    CHECK ((source = 'import') = (import_run_id IS NOT NULL)),
  ADD CONSTRAINT performance_memory_import_source_post_ids_marker_check
    CHECK ((source = 'import') = (import_source_post_ids IS NOT NULL));
CREATE INDEX performance_memory_import_run_id_idx ON public.performance_memory (import_run_id);

-- ─── BACKFILL-PROVENANCE-IMMUTABLE — one shared trigger function, four
-- triggers. source is otherwise mutable today through the authenticated
-- INSERT/UPDATE policies (governed_memory.sql:66-73) — the database
-- reviewer's dispute at ADR-authoring time, accepted as a known gap this
-- trigger closes regardless of which write path is used. ────────────────────

CREATE OR REPLACE FUNCTION public.enforce_memory_import_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.import_run_id IS DISTINCT FROM OLD.import_run_id
     OR NEW.import_source_post_ids IS DISTINCT FROM OLD.import_source_post_ids
  THEN
    RAISE EXCEPTION 'memory import provenance columns (source, import_run_id, import_source_post_ids) are immutable once written';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brand_memory_import_immutable
  BEFORE UPDATE ON public.brand_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_import_immutable();

CREATE TRIGGER trg_evidence_memory_import_immutable
  BEFORE UPDATE ON public.evidence_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_import_immutable();

CREATE TRIGGER trg_audience_memory_import_immutable
  BEFORE UPDATE ON public.audience_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_import_immutable();

-- performance_memory already has trg_performance_memory_voice_write_guard
-- (BEFORE INSERT OR UPDATE, 20260726020000_performance_memory_pattern_key.sql:113-115).
-- A second, independently-named BEFORE UPDATE trigger fires alongside it in
-- trigger-name order (both are non-modifying beyond RAISE/RETURN NEW, so
-- order is immaterial); that guard's own condition
-- (`NEW.source = 'distilled' AND ...`) never fires for source='import' rows,
-- so there is no conflict.
CREATE TRIGGER trg_performance_memory_import_immutable
  BEFORE UPDATE ON public.performance_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_import_immutable();

-- ─── run-scoped partial UNIQUE indexes — BACKFILL-IMPORT-IDEMPOTENT ────────
--
-- Re-running a pass for the same run must insert zero duplicate rows. Scoped
-- to source='import' so a manual/distilled row with the same content never
-- collides with an import one.

CREATE UNIQUE INDEX evidence_memory_import_run_kind_content_uq
  ON public.evidence_memory (import_run_id, kind, md5(content))
  WHERE source = 'import';

CREATE UNIQUE INDEX audience_memory_import_run_kind_statement_uq
  ON public.audience_memory (import_run_id, kind, md5(lower(statement)))
  WHERE source = 'import';

CREATE UNIQUE INDEX performance_memory_import_pattern_uq
  ON public.performance_memory (business_id, dimension, coalesce(platform, ''), md5(lower(pattern)), import_run_id)
  WHERE source = 'import' AND deleted_at IS NULL;

-- ─── import_evidence_memory / import_audience_memory / import_performance_memory
-- SECURITY DEFINER, service_role only. Governance columns (source, status,
-- sensitivity, public_use_permission) are FIXED IN SQL — callers cannot pass
-- them — the upsert_distilled_performance_pattern precedent
-- (20260726030000_performance_memory_promotion.sql:97-117). last_confirmed_at
-- and expires_at are rejected if not finite (isfinite(), the same guard
-- family recencyDecay's own non-finite throw mirrors at the app layer,
-- scoring.ts:36-38). ─────────────────────────────────────────────────────────

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

-- ─── ratify_backfill_run — exactly ADR §9.4 ──────────────────────────────────
--
-- p_user_id is an EXPLICIT parameter, never auth.uid() (which is NULL under
-- the service-role client that calls this — the same reason user_can
-- returns false for a service caller, 20260702120200_user_can.sql:15-16, and
-- cannot be reused here). The calling Server Action obtains it from
-- supabase.auth.getUser() on the anon server client — never a form field.
-- p_user_id is trusted only because EXECUTE is granted to service_role
-- alone; that grant is part of this constraint, not incidental.

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
   WHERE id = p_run_id;

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

  -- Accepted candidate -> active, FILTERED BY source='import' AND
  -- import_run_id=p_run_id (without this filter it would activate stuck
  -- summarize: candidates, summarize.ts:193-211). Run across all three
  -- writable memory tables — an id belongs to at most one, by construction
  -- (random uuid primary keys never collide across tables in practice).
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

  -- DOES NOT TOUCH staged_voice — voice application is the separate,
  -- retryable step (ADR §4.2). Does not touch last_confirmed_at — a
  -- founder saying "keep this" is not a re-observation (ADR §5.3).
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

-- ─── discard_backfill_run — CREATE OR REPLACE to also retire the run's
-- candidate import rows (ADR §6.4's "one transaction", a transcription of
-- that requirement per I2.5's own commit body, not a new decision here
-- either — the staging-purge half already existed; this adds the
-- candidate-retirement half now that the memory columns exist). Signature
-- is UNCHANGED from I2.5, so its REVOKE/GRANT ACL already in force
-- persists across CREATE OR REPLACE — re-issued anyway, explicitly, for
-- the same belt-and-suspenders reason every function in this migration
-- states its grants inline rather than relying on an earlier statement. ────

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
   WHERE id = p_run_id;

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

-- ─── remove_import_source_post — per-post removal (A-5) ─────────────────────
--
-- Deletes evidence and audience rows outright (their content IS the quoted
-- post); RETIRES (never deletes) performance rows, since a pattern's
-- backing set can span multiple posts and this function removes exactly
-- one source, not the pattern's whole evidentiary basis.

CREATE OR REPLACE FUNCTION public.remove_import_source_post(p_business_id uuid, p_platform_post_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.evidence_memory
   WHERE business_id = p_business_id
     AND source = 'import'
     AND import_source_post_ids @> ARRAY[p_platform_post_id];

  DELETE FROM public.audience_memory
   WHERE business_id = p_business_id
     AND source = 'import'
     AND import_source_post_ids @> ARRAY[p_platform_post_id];

  UPDATE public.performance_memory
     SET status = 'retired'
   WHERE business_id = p_business_id
     AND source = 'import'
     AND import_source_post_ids @> ARRAY[p_platform_post_id];
END;
$$;

REVOKE ALL ON FUNCTION public.remove_import_source_post(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_import_source_post(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_import_source_post(uuid, text) TO service_role;
