-- Session 33-D D4 (MINOR-3) — a forward migration; 20260919130000 is NOT edited.
--
-- enforce_performance_memory_write_protection's branch C guarded only the eight statistics columns, so on an
-- outcome row a member could run
--     UPDATE ... SET status = 'retired', pattern = '<anything>'
--     UPDATE ... SET deleted_at = now(), status = 'active', pattern = '<anything>'
-- because branch A lets any change through that retires or soft-deletes, and `pattern` was in no branch. The row
-- can never reach a prompt (the readers filter status and deleted_at), but it rewrites the stored record of what
-- the system observed. ADR 0026 s12.1 lists an outcome row's pattern as immutable to a member.
--
-- The fix widens branch C's immutable tuple with the four remaining identity/content columns of an outcome row:
-- pattern, platform, scope, scope_ref. Everything else is byte-for-byte the function 20260919130000 created:
--   * branch B (pattern_key / dimension immutable for every role) is unchanged;
--   * branch A (a member may only retire or soft-delete a non-manual row) is unchanged, so {status:'retired'}
--     alone still succeeds and un-retiring / resurrecting is still rejected by it;
--   * the service role and the SECURITY DEFINER RPCs (current_user is not authenticated/anon) remain exempt —
--     upsert_outcome_performance_pattern still rewrites `pattern` on recompute.
-- No constraint, index or policy is touched (the two namespace CHECKs, the two partial unique indexes and the
-- distilled index are exactly as they were).

CREATE OR REPLACE FUNCTION public.enforce_performance_memory_write_protection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.source = 'outcome'
     AND (NEW.pattern_key IS DISTINCT FROM OLD.pattern_key OR NEW.dimension IS DISTINCT FROM OLD.dimension)
  THEN
    RAISE EXCEPTION 'outcome performance_memory rows: pattern_key and dimension are immutable (ADR 0026 s5.5)';
  END IF;

  IF current_user IN ('authenticated', 'anon') AND OLD.source <> 'manual' THEN
    IF NOT (NEW.status = 'retired' OR NEW.deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'a member may only retire or soft-delete a non-manual performance_memory row (source=%) (ADR 0026 s5.5)', OLD.source;
    END IF;

    IF OLD.source = 'outcome'
       AND (
         NEW.outcome_n, NEW.outcome_wins, NEW.outcome_distinct_campaigns,
         NEW.interval_low, NEW.interval_high, NEW.metric_basis, NEW.baseline_seeded, NEW.contradicted_at,
         NEW.pattern, NEW.platform, NEW.scope, NEW.scope_ref
       ) IS DISTINCT FROM (
         OLD.outcome_n, OLD.outcome_wins, OLD.outcome_distinct_campaigns,
         OLD.interval_low, OLD.interval_high, OLD.metric_basis, OLD.baseline_seeded, OLD.contradicted_at,
         OLD.pattern, OLD.platform, OLD.scope, OLD.scope_ref
       )
    THEN
      RAISE EXCEPTION 'outcome performance_memory statistics and content are written only by the outcome RPCs (ADR 0026 s5.5)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE keeps the existing grants, but restate them so this file is self-evidently as closed as its
-- predecessor.
REVOKE ALL ON FUNCTION public.enforce_performance_memory_write_protection() FROM public, anon, authenticated;
