-- ADR 0025 §4.1/§4.2/§6.1 (Session 32 I2.11) — the extraction-loop writes:
-- passes_done bookkeeping, the partial/awaiting_ratification exit, and
-- staging the synthesised voice. SECURITY DEFINER, service_role only.

-- ─── increment_backfill_passes_done — recorded AFTER each pass's own
-- writes (never before), so a crash mid-pass never over-counts.

CREATE OR REPLACE FUNCTION public.increment_backfill_passes_done(p_run_id uuid)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET passes_done = passes_done + 1, updated_at = now()
   WHERE id = p_run_id
     AND status = 'extracting'
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.increment_backfill_passes_done(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_backfill_passes_done(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_backfill_passes_done(uuid) TO service_role;

-- ─── mark_backfill_run_partial — a reservation refusal stops extracting:
-- awaiting_ratification with whatever memory has already been written,
-- partial=true, and the reason folded into the existing summary jsonb
-- (never a separate column — one place the "what we learned" screen reads
-- from).

CREATE OR REPLACE FUNCTION public.mark_backfill_run_partial(p_run_id uuid, p_reason text)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET status = 'awaiting_ratification',
         partial = true,
         completed_at = COALESCE(completed_at, now()),
         summary = summary || jsonb_build_object('partialReason', p_reason),
         updated_at = now()
   WHERE id = p_run_id
     AND status = 'extracting'
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.mark_backfill_run_partial(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_backfill_run_partial(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_backfill_run_partial(uuid, text) TO service_role;

-- ─── stage_backfill_voice — ADR §4.2: writes NOTHING to brand_voices/
-- brand_voice_variations, only the run row's own staged_voice + voice_status.

CREATE OR REPLACE FUNCTION public.stage_backfill_voice(p_run_id uuid, p_staged_voice jsonb)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET staged_voice = p_staged_voice,
         voice_status = 'pending',
         updated_at = now()
   WHERE id = p_run_id
     AND status = 'extracting'
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.stage_backfill_voice(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stage_backfill_voice(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_backfill_voice(uuid, jsonb) TO service_role;
