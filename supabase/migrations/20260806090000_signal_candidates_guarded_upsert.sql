-- Session 27 E2.6 (ADR 0020 §6.4) — the guarded re-score upsert Supabase's
-- PostgREST `.upsert()` cannot express: `ON CONFLICT (signal_id) DO UPDATE
-- ... WHERE signal_candidates.status = 'new'`. A plain PostgREST upsert has
-- no way to attach a conditional WHERE clause to the DO UPDATE branch, so
-- the guard that stops a re-score from resurrecting a human-dismissed
-- candidate must live in a function — same SECURITY DEFINER + atomic-guard
-- shape as publish_post_complete (20260616210000_publish_complete_rpc.sql).
--
-- The WHERE clause is evaluated against the pre-existing row under the row
-- lock the UPDATE branch of ON CONFLICT itself acquires (Postgres's own
-- guarantee for INSERT ... ON CONFLICT DO UPDATE, confirmed at ADR §6.4) —
-- so a concurrent re-score and a concurrent (future, ADR 0021) human
-- dismissal transition can never both "win": the second statement to commit
-- either updates a row still 'new', or its WHERE clause fails to match and
-- it silently affects zero rows. Zero rows RETURNING is the no-op signal,
-- not an error — the caller (lib/db/signal-candidates.ts) reads an empty
-- result set as "the candidate was already dismissed, do nothing."

CREATE OR REPLACE FUNCTION public.upsert_signal_candidate(
  p_business_id  uuid,
  p_signal_id    uuid,
  p_score        numeric,
  p_score_inputs jsonb,
  p_occurred_at  timestamptz
)
RETURNS SETOF public.signal_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.signal_candidates (business_id, signal_id, score, score_inputs, occurred_at)
  VALUES (p_business_id, p_signal_id, p_score, p_score_inputs, p_occurred_at)
  ON CONFLICT (signal_id) DO UPDATE
     SET score        = EXCLUDED.score,
         score_inputs = EXCLUDED.score_inputs,
         occurred_at  = EXCLUDED.occurred_at
   WHERE public.signal_candidates.status = 'new'
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_signal_candidate(uuid, uuid, numeric, jsonb, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_signal_candidate(uuid, uuid, numeric, jsonb, timestamptz) TO service_role;
