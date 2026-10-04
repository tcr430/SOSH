-- ADR 0030 §2.1, §4.1, §6.6 (Session 36, L2.3; founder rulings A-3 and A-4) — the substrate's schema, ONE migration:
-- the ADR requires the confidence ceilings "in the same migration as the source swap".
--
--   1. SOURCE SWAP, BY NAME (§2.1): 'dismissal' joins audience_memory_source_check ONLY. The other three tables' source
--      CHECKs are not touched. The definition-regex lookup that 20260925110000:196-208 used is NOT used here (that
--      migration re-added all four CHECKs explicitly named precisely so this swap would be cheap): DROP CONSTRAINT <name>,
--      ADD ... NOT VALID, VALIDATE CONSTRAINT.
--   2. PROVENANCE MARKER (§6.6, A-3): audience_memory.decision_key, its biconditional and namespace CHECKs, a partial
--      UNIQUE index, and a SIBLING BEFORE UPDATE immutability trigger. enforce_memory_import_immutable and
--      enforce_memory_interview_immutable are NOT edited. NO foreign key (a removed watched source leaves a row that is
--      never recomputed again; it expires from retrieval in <= 180 days and remains until business purge).
--   3. EIGHT CEILING CHECKS (§4.1, A-4), each named, each NOT VALID then VALIDATE, predicate form
--      `source <> 'X' OR confidence <= N`. NO outcome ceiling ([db-1]: acknowledge_campaign_retrospective computes
--      round(wilson * n/(n+10), 2) with no clamp, which can exceed 0.95 at large n, and a CHECK there would abort a
--      legitimate recompute). NO manual ceiling ([db-2]: the member path is closed, ADR 0030 §2.4). None of these
--      predicates begins `CHECK ((source = ANY (ARRAY[`, so the old lookup-regex shape used by
--      performance-memory-outcome-schema.test.ts stays unambiguous ([db-3]).
--
-- Every ceiling equals the writer's SHIPPED maximum, so VALIDATE cannot fail on an existing row (L-2). confidence is
-- numeric(3,2): a value is stored rounded to two decimals.
--
-- NOT touched, on purpose: promote_performance_pattern / promote_outcome_pattern (ADR 0018 / 0026 own the promotion rules
-- and the minimum-n floor), any shipped confidence constant, and any writer RPC. The L2.0 live check found every existing
-- writer RPC already closed to anon / authenticated / public, so no privilege-narrowing migration is required.

-- ─── 1. Source swap, by name ────────────────────────────────────────────────

ALTER TABLE public.audience_memory DROP CONSTRAINT audience_memory_source_check;
ALTER TABLE public.audience_memory
  ADD CONSTRAINT audience_memory_source_check
  CHECK (source IN ('manual', 'distilled', 'import', 'interview', 'dismissal')) NOT VALID;
ALTER TABLE public.audience_memory VALIDATE CONSTRAINT audience_memory_source_check;

-- ─── 2. The decision_key provenance marker ──────────────────────────────────

ALTER TABLE public.audience_memory ADD COLUMN decision_key text;

ALTER TABLE public.audience_memory
  ADD CONSTRAINT audience_memory_decision_key_marker_check
  CHECK ((source = 'dismissal') = (decision_key IS NOT NULL)) NOT VALID;
ALTER TABLE public.audience_memory VALIDATE CONSTRAINT audience_memory_decision_key_marker_check;

ALTER TABLE public.audience_memory
  ADD CONSTRAINT audience_memory_decision_key_namespace_check
  CHECK (source <> 'dismissal' OR decision_key LIKE 'dismissal:%') NOT VALID;
ALTER TABLE public.audience_memory VALIDATE CONSTRAINT audience_memory_decision_key_namespace_check;

-- One live dismissal row per (business, watched source). Its predicate is repeated by the recompute's ON CONFLICT (W7).
CREATE UNIQUE INDEX audience_memory_dismissal_key_uq
  ON public.audience_memory (business_id, decision_key)
  WHERE source = 'dismissal' AND deleted_at IS NULL;

-- A NEW function beside enforce_memory_import_immutable and enforce_memory_interview_immutable, which are NOT edited:
-- all fire BEFORE UPDATE and each guards its own columns. This one rejects any change to source or decision_key on a
-- dismissal row (and any attempt to turn another source's row INTO one), and PERMITS the recompute's changes to statement,
-- confidence, observation_count, status, last_confirmed_at and expires_at. The WHEN clause keeps it off every other row, so
-- no existing writer's UPDATE path can be affected (L-2).
CREATE OR REPLACE FUNCTION public.enforce_memory_dismissal_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.decision_key IS DISTINCT FROM OLD.decision_key
  THEN
    RAISE EXCEPTION 'memory dismissal provenance columns (source, decision_key) are immutable once written';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_memory_dismissal_immutable() FROM public, anon, authenticated;

CREATE TRIGGER trg_audience_memory_dismissal_immutable
  BEFORE UPDATE ON public.audience_memory
  FOR EACH ROW
  WHEN (OLD.source = 'dismissal' OR NEW.source = 'dismissal')
  EXECUTE FUNCTION public.enforce_memory_dismissal_immutable();

-- ─── 3. The eight ceiling CHECKs ────────────────────────────────────────────

-- import: <= 0.60 (BACKFILL_CONFIDENCE_CEILING) on evidence, audience, performance
ALTER TABLE public.evidence_memory    ADD CONSTRAINT evidence_memory_import_confidence_ceiling    CHECK (source <> 'import' OR confidence <= 0.60) NOT VALID;
ALTER TABLE public.audience_memory    ADD CONSTRAINT audience_memory_import_confidence_ceiling    CHECK (source <> 'import' OR confidence <= 0.60) NOT VALID;
ALTER TABLE public.performance_memory ADD CONSTRAINT performance_memory_import_confidence_ceiling CHECK (source <> 'import' OR confidence <= 0.60) NOT VALID;

-- interview: <= 0.60 (interview brand 0.6 is the shipped maximum) on brand, evidence, audience
ALTER TABLE public.brand_memory       ADD CONSTRAINT brand_memory_interview_confidence_ceiling    CHECK (source <> 'interview' OR confidence <= 0.60) NOT VALID;
ALTER TABLE public.evidence_memory    ADD CONSTRAINT evidence_memory_interview_confidence_ceiling CHECK (source <> 'interview' OR confidence <= 0.60) NOT VALID;
ALTER TABLE public.audience_memory    ADD CONSTRAINT audience_memory_interview_confidence_ceiling CHECK (source <> 'interview' OR confidence <= 0.60) NOT VALID;

-- dismissal: <= 0.50 (ADR 0030 §6.4: round(0.5 * n / (n + 3), 2) can approach but never reach 0.50)
ALTER TABLE public.audience_memory    ADD CONSTRAINT audience_memory_dismissal_confidence_ceiling CHECK (source <> 'dismissal' OR confidence <= 0.50) NOT VALID;

-- distilled: <= 0.95 (LEARN_CONFIDENCE_CEILING, lib/learning/promote.ts)
ALTER TABLE public.performance_memory ADD CONSTRAINT performance_memory_distilled_confidence_ceiling CHECK (source <> 'distilled' OR confidence <= 0.95) NOT VALID;

ALTER TABLE public.evidence_memory    VALIDATE CONSTRAINT evidence_memory_import_confidence_ceiling;
ALTER TABLE public.audience_memory    VALIDATE CONSTRAINT audience_memory_import_confidence_ceiling;
ALTER TABLE public.performance_memory VALIDATE CONSTRAINT performance_memory_import_confidence_ceiling;
ALTER TABLE public.brand_memory       VALIDATE CONSTRAINT brand_memory_interview_confidence_ceiling;
ALTER TABLE public.evidence_memory    VALIDATE CONSTRAINT evidence_memory_interview_confidence_ceiling;
ALTER TABLE public.audience_memory    VALIDATE CONSTRAINT audience_memory_interview_confidence_ceiling;
ALTER TABLE public.audience_memory    VALIDATE CONSTRAINT audience_memory_dismissal_confidence_ceiling;
ALTER TABLE public.performance_memory VALIDATE CONSTRAINT performance_memory_distilled_confidence_ceiling;
