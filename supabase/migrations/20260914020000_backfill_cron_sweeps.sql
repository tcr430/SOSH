-- ADR 0025 §6.6/§6.8/§8.3 (Session 32 I2.9) — the cron tick's sweeps and the
-- one extra timestamp they need. All SECURITY DEFINER, service_role only,
-- house grant shape.

-- ─── transition_backfill_run — CREATE OR REPLACE (never edit the applied
-- 20260914010000 migration in place), same signature, ADDING completed_at
-- stamping on first entry to 'awaiting_ratification' — mirrors started_at's
-- own "stamp once, on first entry" shape. Nothing transitions a run to
-- 'awaiting_ratification' yet (I2.10-I2.12 build extraction), so this is
-- inert until then; the staging-TTL sweep below is written against it now
-- so I2.9's own sweep list is complete without a later migration. ──────────

CREATE OR REPLACE FUNCTION public.transition_backfill_run(
  p_run_id         uuid,
  p_from_statuses  text[],
  p_to_status      text,
  p_error_code     text DEFAULT NULL
)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET status = p_to_status,
         error_code = CASE WHEN p_to_status = 'failed' THEN p_error_code ELSE error_code END,
         started_at = CASE WHEN p_to_status = 'fetching' AND started_at IS NULL THEN now() ELSE started_at END,
         completed_at = CASE WHEN p_to_status = 'awaiting_ratification' AND completed_at IS NULL THEN now() ELSE completed_at END,
         updated_at = now()
   WHERE id = p_run_id
     AND status = ANY (p_from_statuses)
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.transition_backfill_run(uuid, text[], text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_backfill_run(uuid, text[], text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_backfill_run(uuid, text[], text, text) TO service_role;

-- ─── sweep_stalled_backfill_runs — BACKFILL-LATENCY-BOUNDED: a run in
-- queued/fetching/extracting with no progress (updated_at) for
-- p_stall_minutes -> failed (resumable — error_code='stalled', never
-- 'caller_bug'). Bulk, not per-row, so one tick sweeps every stalled run
-- at once. ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_stalled_backfill_runs(p_stall_minutes integer)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH stalled AS (
    UPDATE public.social_backfill_runs
       SET status = 'failed', error_code = 'stalled', updated_at = now()
     WHERE status IN ('queued', 'fetching', 'extracting')
       AND updated_at < now() - (p_stall_minutes || ' minutes')::interval
    RETURNING 1
  )
  SELECT count(*)::integer FROM stalled;
$$;

REVOKE ALL ON FUNCTION public.sweep_stalled_backfill_runs(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_stalled_backfill_runs(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stalled_backfill_runs(integer) TO service_role;

-- ─── sweep_expired_backfill_staging — ADR §8.3: staged post rows are
-- purged p_ttl_days after their run LEFT extracting (completed_at, stamped
-- above), whichever of ratification/discard/disconnect/this-TTL comes
-- first — the other three already delete staging directly in their own
-- RPCs (ratify_backfill_run, discard_backfill_run), so this sweep only
-- ever finds rows for a run that is still sitting in awaiting_ratification
-- (or failed after reaching it) past the horizon. ──────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_expired_backfill_staging(p_ttl_days integer)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH purged AS (
    DELETE FROM public.social_backfill_posts
     WHERE run_id IN (
       SELECT id FROM public.social_backfill_runs
        WHERE completed_at IS NOT NULL
          AND completed_at < now() - (p_ttl_days || ' days')::interval
     )
    RETURNING 1
  )
  SELECT count(*)::integer FROM purged;
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_backfill_staging(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_expired_backfill_staging(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_backfill_staging(integer) TO service_role;

-- ─── sweep_expired_staged_voice — ADR §8.3: staged_voice nulled
-- p_ttl_days after ratification, if the founder never reviewed it via
-- step-2 backfill mode. ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_expired_staged_voice(p_ttl_days integer)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH nulled AS (
    UPDATE public.social_backfill_runs
       SET staged_voice = NULL, updated_at = now()
     WHERE staged_voice IS NOT NULL
       AND ratified_at IS NOT NULL
       AND ratified_at < now() - (p_ttl_days || ' days')::interval
    RETURNING 1
  )
  SELECT count(*)::integer FROM nulled;
$$;

REVOKE ALL ON FUNCTION public.sweep_expired_staged_voice(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_expired_staged_voice(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_staged_voice(integer) TO service_role;
