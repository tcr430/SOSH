-- ADR 0025 §4.1 step 4 / §4.5 (Session 32 I2.12) — the evidence batch loop's
-- write path: resolving a claimed batch to extracted/skipped/failed, and an
-- atomic per-run cap on import_evidence_memory so a re-run pass can never
-- exceed 40 (BACKFILL-EVIDENCE-VERBATIM's companion cap, checked against
-- rows ALREADY WRITTEN FOR THE RUN, not a separate counter this migration
-- could drift from).

-- ─── resolve_backfill_posts — claim_backfill_posts (I2.5) moves pending ->
-- claimed; this is the other half, claimed -> extracted | skipped | failed.
-- Bulk, scoped by id list. Guarded to extraction_status='claimed' so a
-- post already resolved by a concurrent/duplicate call is a no-op, not a
-- silent overwrite.

CREATE OR REPLACE FUNCTION public.resolve_backfill_posts(p_post_ids uuid[], p_status text)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH resolved AS (
    UPDATE public.social_backfill_posts
       SET extraction_status = p_status
     WHERE id = ANY (p_post_ids)
       AND extraction_status = 'claimed'
    RETURNING 1
  )
  SELECT count(*)::integer FROM resolved;
$$;

REVOKE ALL ON FUNCTION public.resolve_backfill_posts(uuid[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_backfill_posts(uuid[], text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_backfill_posts(uuid[], text) TO service_role;

-- ─── import_evidence_memory — CREATE OR REPLACE (never edit 20260913140000/
-- 150000 in place), same signature, ADDING the BACKFILL_EVIDENCE_CAP=40
-- per-run ceiling INSIDE the INSERT's own WHERE clause — atomic with the
-- write itself, not a separate count-then-insert read (which would race
-- across two batches of the same run processed back to back). ────────────

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
  WHERE (
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
