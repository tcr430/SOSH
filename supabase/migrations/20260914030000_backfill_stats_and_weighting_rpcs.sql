-- ADR 0025 §4.1 steps 2-3 (Session 32 I2.10) — the two writes the
-- deterministic extraction step needs, per lib/db/types.ts's own
-- precedent (every write to these two tables goes through an RPC, never a
-- raw .insert()/.update()). SECURITY DEFINER, service_role only.

-- ─── update_backfill_post_lifts — bulk-writes social_backfill_posts.lift
-- from a jsonb array of {id, lift}, scoped to run_id so a caller can never
-- accidentally touch another run's staging rows even if p_lifts carried a
-- foreign id. Returns the count of rows actually updated.

CREATE OR REPLACE FUNCTION public.update_backfill_post_lifts(p_run_id uuid, p_lifts jsonb)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE public.social_backfill_posts p
       SET lift = (l.lift)::numeric
      FROM jsonb_to_recordset(p_lifts) AS l(id uuid, lift numeric)
     WHERE p.id = l.id AND p.run_id = p_run_id
    RETURNING 1
  )
  SELECT count(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION public.update_backfill_post_lifts(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_backfill_post_lifts(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_backfill_post_lifts(uuid, jsonb) TO service_role;

-- ─── record_backfill_run_summary — writes the account-statistics summary
-- (cadence/timing/format/length distributions, engagement baseline) and
-- the weighting flag ('weighted' | 'unweighted_no_metrics') onto the run
-- row. Guarded to status='extracting' — the only phase this ever runs in.

CREATE OR REPLACE FUNCTION public.record_backfill_run_summary(p_run_id uuid, p_summary jsonb, p_weighting text)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET summary = p_summary, weighting = p_weighting, updated_at = now()
   WHERE id = p_run_id
     AND status = 'extracting'
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.record_backfill_run_summary(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_backfill_run_summary(uuid, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_backfill_run_summary(uuid, jsonb, text) TO service_role;
