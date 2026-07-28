-- Session 25-D correction pass (MAJOR-1, the overclaim half) — ADR 0018 §5.3
-- amendment.
--
-- This migration changes NO logic. `enforce_voice_write_preference_only`'s
-- guard condition, its retirement escape hatch, its INSERT/UPDATE
-- re-validation predicate, and its join are byte-identical to
-- 20260726020000_performance_memory_pattern_key.sql. Only the RAISE message
-- and the surrounding comments change, via CREATE OR REPLACE FUNCTION in a
-- new forward migration (never editing the applied one).
--
-- Why: the reviewer (docs/reviews/session-25-reviewer.md, MAJOR-1) found the
-- old RAISE text — "must be sourced entirely from preference-class
-- signals" — false for exactly the rows it was written to police. Both
-- shipped Track-C writers construct rows this trigger's EXISTS join can
-- never match:
--   1. canonicalize() (lib/learning/orchestrator.ts) sets pattern_key ONLY
--      when rowClass = 'preference' — every row with a non-NULL pattern_key
--      is preference-classed by construction, so the EXISTS is
--      unsatisfiable on the Tier-0 path.
--   2. computeSummaryPatternKey() (lib/learning/summarize.ts) namespaces its
--      key `summarize:<dimension>:<hash>`, which by design never matches ANY
--      post_edit_signals.pattern_key — unsatisfiable on the Tier-1 path too
--      (and that path is now additionally closed at the query layer by this
--      same correction pass's MAJOR-1 fix to listRecentHumanEditExcerpts).
--
-- So the trigger's LIVE scope, for this pipeline, is: it fires on nothing,
-- because nothing this pipeline writes can ever match. That is not a defect
-- — it is a guard whose actual job is to protect OTHER write paths this ADR
-- never built: a future promotion job, a manual backfill script, or an
-- ad-hoc query that writes performance_memory directly with a hand-picked
-- pattern_key that happens to collide with a real, non-preference-classed
-- post_edit_signals row. The message now says that, instead of describing an
-- invariant the shipped pipeline does not (and structurally cannot) violate.

CREATE OR REPLACE FUNCTION public.enforce_voice_write_preference_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Retirement is always allowed, unconditionally — unchanged from
  -- 20260726020000_performance_memory_pattern_key.sql.
  IF NEW.deleted_at IS NOT NULL OR NEW.status = 'retired' THEN
    RETURN NEW;
  END IF;

  IF NEW.source = 'distilled' AND NEW.dimension IN ('format', 'hook')
     AND (
       TG_OP = 'INSERT'
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.dimension IS DISTINCT FROM OLD.dimension
       OR NEW.pattern_key IS DISTINCT FROM OLD.pattern_key
     )
  THEN
    IF EXISTS (
      SELECT 1 FROM public.post_edit_signals
       WHERE business_id = NEW.business_id
         AND pattern_key = NEW.pattern_key
         AND class IS DISTINCT FROM 'preference'
    ) THEN
      RAISE EXCEPTION
        'voice-directed performance_memory row (dimension=%) shares its (business_id, pattern_key) with a non-preference-class post_edit_signals row — rejected (LEARN-VOICE-WRITE-TRIGGER). Note: the Track-C pipeline cannot produce this shape by construction (ADR 0018 §5.3 amendment); this guard''s live scope is other write paths — manual backfill, future jobs, ad-hoc queries.',
        NEW.dimension;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
