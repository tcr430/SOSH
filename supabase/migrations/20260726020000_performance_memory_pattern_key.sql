-- ADR 0016 Amendment B / ADR 0018 §7.2 (Session 25 C2.3)
--
-- performance_memory ships empty (20260719010000_governed_memory.sql) — this
-- CHECK is satisfiable immediately because every existing row (there are
-- none yet) is necessarily source <> 'distilled'. Stated explicitly rather
-- than assumed: if this migration is ever run against a non-empty table
-- where a distilled row already lacks pattern_key, ADD CONSTRAINT will fail
-- loudly at apply time — the correct behaviour, not a silent no-op.

ALTER TABLE public.performance_memory ADD COLUMN pattern_key text;

-- [db-MAJOR-2]: without this, Postgres never dedupes on NULL — distilled
-- rows with a NULL key would accumulate one per tick, and because §9.6's
-- recompute is scoped BY pattern_key, they'd stay frozen at their initial
-- counts forever. The feature would appear to work (rows get created) while
-- learning nothing (counts never update, nothing ever promotes).
ALTER TABLE public.performance_memory
  ADD CONSTRAINT performance_memory_distilled_requires_pattern_key
  CHECK (source <> 'distilled' OR pattern_key IS NOT NULL);

-- [db-Q5]: coalesce(platform,'') is the established idiom (email_outbox_dedupe_uq,
-- 20260607100000_email_outbox.sql:27-28) — NOT NULLS NOT DISTINCT, which would
-- introduce a second idiom for an already-solved problem. platform is
-- CHECK-constrained to a fixed enum (20260719010000_governed_memory.sql:227),
-- so '' can never collide with a real value.
CREATE UNIQUE INDEX performance_memory_distilled_pattern_key_uq
  ON public.performance_memory (business_id, dimension, coalesce(platform, ''), pattern_key)
  WHERE source = 'distilled' AND deleted_at IS NULL;

-- LEARN-VOICE-WRITE-TRIGGER (ADR 0018 §5.3, [type-4]) — the actual
-- enforcement. "A service-role `if` that re-derives the class and rejects
-- non-preference rows" is an `if` statement relocated from TS into app-layer
-- SQL-building, not real enforcement — it holds only for callers that go
-- through that one code path. This trigger holds regardless of which code
-- path issues the write: a future promotion job, a manual backfill script,
-- or an ad-hoc query all hit the same wall.
--
-- Join key: performance_memory.pattern_key and post_edit_signals.pattern_key
-- are the same aggregation key (ADR 0018 §7.2 / the C2.2 signals schema) —
-- the only column the two tables share that identifies which signals
-- contributed to a given distilled pattern. Matched together with
-- business_id, since pattern_key alone is not tenant-scoped.
--
-- database-reviewer (C2.3 pass, NIT): the EXISTS query below has no index
-- directly covering (business_id, pattern_key) across every signal status —
-- only the processed-only partial index does. Harmless today (EXISTS
-- short-circuits on first match; write volume here is a distillation tick,
-- not a user-facing path), but worth a non-partial (business_id, pattern_key)
-- index later if post_edit_signals grows large per business.
--
-- `class IS DISTINCT FROM 'preference'`, not `<>`: catches NULL too
-- (fail-closed) — a contributing signal that has not yet been classified
-- must not silently be treated as safe.
--
-- database-reviewer (C2.3 pass, MAJOR): the naive form of this trigger
-- re-ran the EXISTS check on EVERY UPDATE unconditionally, with no OLD/NEW
-- comparison. That created a lockout: if a contributing signal was
-- reclassified away from 'preference' AFTER a row already existed, the same
-- guard that (correctly) flags the row would ALSO block the one write that
-- could remediate it — retiring or soft-deleting that row — since retiring
-- is itself an UPDATE. Two changes close this:
--   1. The check only re-runs on INSERT, or on an UPDATE that actually
--      changes source/dimension/pattern_key — an unrelated field update
--      (confidence, observation_count, status, last_confirmed_at, etc.) on
--      an already-existing row is not re-validated.
--   2. Retirement is an explicit, unconditional escape hatch: an UPDATE that
--      sets deleted_at or moves status to 'retired' is always allowed
--      through, regardless of what post_edit_signals looks like — retiring
--      a row can never leak anything further, so it must never be the thing
--      blocked by this guard.
--
-- Concurrency note (database-reviewer, MINOR): this EXISTS check runs under
-- read-committed against whatever is already committed at statement start.
-- The assumption is a single-writer distillation worker per tick — a
-- classification write to post_edit_signals is not expected to race a
-- performance_memory write for the same pattern_key within the same tick.
-- If that assumption is ever violated, the UPDATE-time re-check above (for
-- any later write that changes source/dimension/pattern_key) is the second
-- line of defense, not a full close of the gap.
CREATE OR REPLACE FUNCTION public.enforce_voice_write_preference_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Retirement is always allowed, unconditionally — see the comment above.
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
        'voice-directed performance_memory row (dimension=%) must be sourced entirely from preference-class signals (LEARN-VOICE-WRITE-TRIGGER)',
        NEW.dimension;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_performance_memory_voice_write_guard
BEFORE INSERT OR UPDATE ON public.performance_memory
FOR EACH ROW EXECUTE FUNCTION public.enforce_voice_write_preference_only();

-- RLS + erasure cascade are UNAFFECTED by this migration: pattern_key is an
-- additive column on an already-cascaded, already-RLS-enabled table
-- (performance_memory ON DELETE CASCADE from businesses, RLS policies from
-- 20260719010000_governed_memory.sql:240-257, unchanged here). The existing
-- docs/decisions/0010-legal-surface.md §D2.5 row for performance_memory
-- already covers it — no new row needed.
