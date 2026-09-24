-- Migration: performance_memory — ADR 0016 Amendment C, the schema half
-- (ADR 0026 §5.1, §5.3, §5.5; founder ruling A-2 — Session 33 J2.5)
--
-- WHAT THIS DOES
--   performance_memory gains a THIRD writer: source = 'outcome' (the outcome loop, ADR 0026),
--   beside source = 'distilled' (ADR 0018, the edit-learning pipeline) and source = 'import'
--   (ADR 0025). The three are distinguished IN THE ROW and enforced by the database, not by
--   convention. This migration ships ONLY the schema and the write protection. Every RPC that
--   writes or transitions an outcome row (upsert / promote / demote / acknowledge, and the one
--   shared Wilson function) is J2.6, so the floor lives in SQL and the first promotion that ever
--   runs is gated by construction.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH
--   * performance_memory_distilled_pattern_key_uq and its predicate (a Tier-1 test pins its
--     exact definition), and upsert_distilled_performance_pattern's ON CONFLICT ... WHERE
--     source = 'distilled': Postgres infers a partial index for ON CONFLICT by exact predicate
--     match, so the new SIBLING index below can never be inferred by it.
--   * trg_performance_memory_voice_write_guard / enforce_voice_write_preference_only. It fires
--     only for source = 'distilled' AND dimension IN ('format', 'hook'). No outcome row can
--     satisfy that: source = 'outcome' by construction, and 'hook' is not an outcome dimension
--     (see performance_memory_outcome_dimension_check). ADR 0026 §5.1, [db-7].
--   * trg_performance_memory_import_immutable (ADR 0025): still makes source, import_run_id and
--     import_source_post_ids immutable on EVERY row. That is why an outcome row's `source` can
--     never be rewritten by any role, and why a manual row can never be turned into another
--     source.
--
-- THE CHECK WIDENINGS ARE FOUND BY DEFINITION, NEVER BY A GUESSED NAME (J2.0 premise 3).
-- The source and dimension CHECKs were created inline in 20260719010000, so their names are
-- Postgres-generated. A `DROP CONSTRAINT IF EXISTS <guess>` would silently no-op on a
-- misspelling and leave the OLD, narrower CHECK in place (the exact failure ADR 0025's ai_budget
-- migration documents). So: find the one CHECK whose definition is `source = ANY (ARRAY[...])`
-- (resp. dimension), RAISE unless exactly one matches, drop it by the name found, re-add it
-- EXPLICITLY NAMED as NOT VALID, and VALIDATE in a separate statement ([db-7]: the table is
-- populated, so the validating scan happens under a weaker lock than ADD would take).
--
-- WRITE PROTECTION ([db-3], ADR 0026 §5.5). The authenticated policies check only business_id,
-- so today a member could insert or update a row with ANY source and, once the stats columns
-- exist, forge outcome_n / outcome_wins. Closed in two layers:
--   1. performance_memory_insert_own's WITH CHECK gains `AND source = 'manual'`.
--   2. A BEFORE UPDATE trigger, in the shape of enforce_voice_write_preference_only's
--      "retirement is always allowed" branch, restricting only CLIENT roles (current_user is
--      'authenticated' or 'anon'). current_user, not a JWT claim: PostgREST switches the
--      database role after verifying the token, and SECURITY DEFINER functions (the J2.6 RPCs)
--      run as their owner — so the service-role worker and the RPCs are never restricted, and
--      no claim can be spoofed.
-- J2.0 grep (2026-09-19, re-run at J2.5): no app/** code writes performance_memory with an
-- authenticated client. The only writers are service-role RPCs in lib/db/memory-performance.ts
-- (distilled upsert / promote / demote, import); scripts/learning-report.ts only reads. A newly
-- found authenticated writer would be a STOP, not a policy exception.

-- ─── 1. Widen the source CHECK — by definition ───────────────────────────────

DO $$
DECLARE
  v_count int;
  v_name  text;
BEGIN
  SELECT count(*), min(conname)
    INTO v_count, v_name
    FROM pg_constraint
   WHERE conrelid = 'public.performance_memory'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ '^CHECK \(\(source = ANY \(ARRAY\[';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'performance_memory source CHECK: expected exactly one match by definition, found %', v_count;
  END IF;
  EXECUTE format('ALTER TABLE public.performance_memory DROP CONSTRAINT %I', v_name);
END $$;

ALTER TABLE public.performance_memory
  ADD CONSTRAINT performance_memory_source_check
    CHECK (source IN ('manual', 'distilled', 'import', 'outcome'))
    NOT VALID;

ALTER TABLE public.performance_memory
  VALIDATE CONSTRAINT performance_memory_source_check;

-- ─── 2. Widen the dimension CHECK — by definition ────────────────────────────

DO $$
DECLARE
  v_count int;
  v_name  text;
BEGIN
  SELECT count(*), min(conname)
    INTO v_count, v_name
    FROM pg_constraint
   WHERE conrelid = 'public.performance_memory'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ '^CHECK \(\(dimension = ANY \(ARRAY\[';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'performance_memory dimension CHECK: expected exactly one match by definition, found %', v_count;
  END IF;
  EXECUTE format('ALTER TABLE public.performance_memory DROP CONSTRAINT %I', v_name);
END $$;

ALTER TABLE public.performance_memory
  ADD CONSTRAINT performance_memory_dimension_check
    CHECK (dimension IN ('topic', 'hook', 'format', 'proof_type',
                         'role', 'origin_mode', 'length_band', 'cta', 'hypothesis'))
    NOT VALID;

ALTER TABLE public.performance_memory
  VALIDATE CONSTRAINT performance_memory_dimension_check;

-- ─── 3. Outcome stats columns (ADR 0026 §5.3) — typed, on the row ────────────
-- A future T1-B reader gets n, interval, basis and provenance as a plain WHERE
-- source = 'outcome' query — no second computation, no side-table join.

ALTER TABLE public.performance_memory
  ADD COLUMN outcome_n                  int,
  ADD COLUMN outcome_wins               int,
  ADD COLUMN outcome_distinct_campaigns int,
  ADD COLUMN interval_low               numeric(4,3),
  ADD COLUMN interval_high              numeric(4,3),
  ADD COLUMN metric_basis               text,
  ADD COLUMN baseline_seeded            boolean,
  -- Nullable for EVERY row, outcome or not: stamped by demote_outcome_pattern (J2.6).
  ADD COLUMN contradicted_at            timestamptz;

-- Every constraint is added NOT VALID and validated in its own statement below ([db-7]).
ALTER TABLE public.performance_memory
  -- The marker idiom of pattern_key's CHECK and ADR 0025's import markers: an EQUIVALENCE, so a
  -- stat can neither be set on a non-outcome row nor left NULL on an outcome row.
  ADD CONSTRAINT performance_memory_outcome_n_marker_check
    CHECK ((outcome_n IS NOT NULL) = (source = 'outcome')) NOT VALID,
  ADD CONSTRAINT performance_memory_outcome_wins_marker_check
    CHECK ((outcome_wins IS NOT NULL) = (source = 'outcome')) NOT VALID,
  ADD CONSTRAINT performance_memory_outcome_distinct_campaigns_marker_check
    CHECK ((outcome_distinct_campaigns IS NOT NULL) = (source = 'outcome')) NOT VALID,
  ADD CONSTRAINT performance_memory_interval_low_marker_check
    CHECK ((interval_low IS NOT NULL) = (source = 'outcome')) NOT VALID,
  ADD CONSTRAINT performance_memory_interval_high_marker_check
    CHECK ((interval_high IS NOT NULL) = (source = 'outcome')) NOT VALID,
  ADD CONSTRAINT performance_memory_metric_basis_marker_check
    CHECK ((metric_basis IS NOT NULL) = (source = 'outcome')) NOT VALID,
  ADD CONSTRAINT performance_memory_baseline_seeded_marker_check
    CHECK ((baseline_seeded IS NOT NULL) = (source = 'outcome')) NOT VALID,
  ADD CONSTRAINT performance_memory_metric_basis_check
    CHECK (metric_basis IS NULL OR metric_basis IN ('rate', 'count')) NOT VALID,
  -- Integrity beyond the ADR text, cheap and never wrong: a win count cannot exceed n, distinct
  -- campaigns cannot exceed n, and an interval's low bound cannot exceed its high bound. All NULL
  -- (hence satisfied) on a non-outcome row.
  ADD CONSTRAINT performance_memory_outcome_counts_check
    CHECK (outcome_n IS NULL OR (outcome_n >= 0
                                 AND outcome_wins BETWEEN 0 AND outcome_n
                                 AND outcome_distinct_campaigns BETWEEN 0 AND outcome_n)) NOT VALID,
  ADD CONSTRAINT performance_memory_outcome_interval_check
    CHECK (interval_low IS NULL OR interval_high IS NULL OR interval_low <= interval_high) NOT VALID;

-- ─── 4. Provenance in the row: namespace CHECKs (ADR 0026 §5.1, [db-1]) ──────
-- The key is caller-supplied text; `source` is CHECK-constrained and set inside the RPC. Without
-- these, "a literal key collision across writers is impossible" would be a convention. With them
-- it is a guarantee.

ALTER TABLE public.performance_memory
  -- `NULL LIKE ...` is NULL, which a CHECK treats as satisfied — so a NULL key needs its OWN check.
  ADD CONSTRAINT performance_memory_outcome_requires_pattern_key
    CHECK (source <> 'outcome' OR pattern_key IS NOT NULL) NOT VALID,
  ADD CONSTRAINT performance_memory_outcome_key_namespace_check
    CHECK (source <> 'outcome' OR pattern_key LIKE 'outcome:%') NOT VALID,
  ADD CONSTRAINT performance_memory_distilled_key_namespace_check
    CHECK (source <> 'distilled' OR pattern_key IS NULL OR pattern_key NOT LIKE 'outcome:%') NOT VALID,
  -- An outcome row may only use a PROMOTABLE dimension or 'hypothesis' (ADR 0026 §4.1, §8.4).
  -- 'hook' and 'proof_type' are descriptive-only and 'topic' has no controlled vocabulary, so
  -- they can never become an outcome pattern — enforced here, not merely in the extractor
  -- (OUTCOME-DESCRIPTIVE-ONLY, constraint 7). Also what keeps the voice-write guard's
  -- ('format', 'hook') condition unreachable from an outcome row's `hook`.
  ADD CONSTRAINT performance_memory_outcome_dimension_check
    CHECK (source <> 'outcome' OR dimension IN ('role', 'format', 'length_band', 'cta', 'origin_mode', 'hypothesis')) NOT VALID;

ALTER TABLE public.performance_memory
  VALIDATE CONSTRAINT performance_memory_outcome_n_marker_check,
  VALIDATE CONSTRAINT performance_memory_outcome_wins_marker_check,
  VALIDATE CONSTRAINT performance_memory_outcome_distinct_campaigns_marker_check,
  VALIDATE CONSTRAINT performance_memory_interval_low_marker_check,
  VALIDATE CONSTRAINT performance_memory_interval_high_marker_check,
  VALIDATE CONSTRAINT performance_memory_metric_basis_marker_check,
  VALIDATE CONSTRAINT performance_memory_baseline_seeded_marker_check,
  VALIDATE CONSTRAINT performance_memory_metric_basis_check,
  VALIDATE CONSTRAINT performance_memory_outcome_counts_check,
  VALIDATE CONSTRAINT performance_memory_outcome_interval_check,
  VALIDATE CONSTRAINT performance_memory_outcome_requires_pattern_key,
  VALIDATE CONSTRAINT performance_memory_outcome_key_namespace_check,
  VALIDATE CONSTRAINT performance_memory_distilled_key_namespace_check,
  VALIDATE CONSTRAINT performance_memory_outcome_dimension_check;

-- ─── 5. The SIBLING partial UNIQUE index (ADR 0026 §5.1) ─────────────────────
-- Disjoint from performance_memory_distilled_pattern_key_uq by predicate. A second upsert on the
-- same outcome key updates the row in place (recompute, §5.2). Plain CREATE INDEX (not
-- CONCURRENTLY): the table is small and a migration runs in a transaction.

CREATE UNIQUE INDEX performance_memory_outcome_pattern_key_uq
  ON public.performance_memory (business_id, dimension, coalesce(platform, ''), pattern_key)
  WHERE source = 'outcome' AND deleted_at IS NULL;

-- ─── 6. Write protection, layer 1: only 'manual' rows may be INSERTed by a member ─

ALTER POLICY performance_memory_insert_own ON public.performance_memory
  WITH CHECK (
    business_id = ANY (SELECT unnest(public.get_user_business_ids()))
    AND source = 'manual'
  );

-- ─── 7. Write protection, layer 2: the BEFORE UPDATE trigger ─────────────────
-- Three branches, each independently load-bearing (each has a Tier-1 test that fails without it):
--   B (every role)         an outcome row's pattern_key and dimension are immutable. (`source` is
--                          already immutable on every row via trg_performance_memory_import_immutable.)
--   A (client roles)       a NON-manual row may be changed only to retire it (status = 'retired') or to
--                          soft-delete it (deleted_at set) — the retirement branch's shape. Promotion
--                          (candidate -> active), un-retiring and content edits are rejected.
--   C (client roles)       on an outcome row, a stats column (or contradicted_at) can NOT change, even
--                          while retiring — otherwise "retire + forge outcome_n" would slip through A.
-- Manual rows are unrestricted for a client (they are the member's own notes). The service role and
-- SECURITY DEFINER RPCs (current_user = their owner) are unrestricted where they must write.

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
         NEW.interval_low, NEW.interval_high, NEW.metric_basis, NEW.baseline_seeded, NEW.contradicted_at
       ) IS DISTINCT FROM (
         OLD.outcome_n, OLD.outcome_wins, OLD.outcome_distinct_campaigns,
         OLD.interval_low, OLD.interval_high, OLD.metric_basis, OLD.baseline_seeded, OLD.contradicted_at
       )
    THEN
      RAISE EXCEPTION 'outcome performance_memory statistics are written only by the outcome RPCs (ADR 0026 s5.5)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_performance_memory_write_protection() FROM public, anon, authenticated;

CREATE TRIGGER trg_performance_memory_outcome_write_protect
BEFORE UPDATE ON public.performance_memory
FOR EACH ROW EXECUTE FUNCTION public.enforce_performance_memory_write_protection();
