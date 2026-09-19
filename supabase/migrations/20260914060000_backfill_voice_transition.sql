-- ADR 0025 §4.2/§6.4/§6.5/§10.3 (Session 32 I2.13) — the founder's voice
-- decisions over a backfill run. ratify_backfill_run (20260913150000) only
-- ever sets voice_status='pending' when a voice was staged; this is the ONE
-- generic conditional-status-UPDATE for every voice_status edge from there
-- (pending -> applied/refused_cap/failed/declined), mirroring
-- transition_backfill_run's own generic-transition shape for the run's
-- `status` column. Membership authorization is NOT re-checked here — the
-- Server Action layer (app/[locale]/(dashboard)/onboarding/step-4/
-- backfill-actions.ts) performs the same approver/admin membership check
-- ratify_backfill_run enforces, BEFORE calling this RPC, because applying a
-- voice also writes brand_voices/brand_voice_variations through the
-- existing non-backfill-aware upsert/create-variation paths first — this
-- RPC only ever records the OUTCOME of that write on the run row.
CREATE OR REPLACE FUNCTION public.transition_backfill_voice_status(
  p_run_id         uuid,
  p_from_statuses  text[],
  p_to_status      text,
  p_applied_to     text DEFAULT NULL
)
RETURNS SETOF public.social_backfill_runs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.social_backfill_runs
     SET voice_status      = p_to_status,
         voice_applied_to  = CASE WHEN p_to_status = 'applied' THEN p_applied_to ELSE voice_applied_to END,
         voice_applied_at  = CASE WHEN p_to_status = 'applied' THEN now() ELSE voice_applied_at END,
         staged_voice      = CASE WHEN p_to_status IN ('applied', 'declined') THEN NULL ELSE staged_voice END,
         updated_at        = now()
   WHERE id = p_run_id
     AND voice_status = ANY (p_from_statuses)
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_backfill_voice_status(uuid, text[], text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_backfill_voice_status(uuid, text[], text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_backfill_voice_status(uuid, text[], text, text) TO service_role;
