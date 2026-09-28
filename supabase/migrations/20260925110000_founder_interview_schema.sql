-- ADR 0029 (Session 35, M2.3) — the founder input engine's SCHEMA. No RPC yet (M2.4-M2.6).
--
--   §2.1  'interview' joins the source CHECK on brand_memory, evidence_memory, audience_memory ONLY
--   §2.2  the answer pointer and its four CHECKs, the sibling immutability trigger
--   §2.3  the three partial UNIQUE dedupe indexes the writer's ON CONFLICT DO NOTHING targets
--   §5.2  the round status set and the one-open-round partial UNIQUE
--   §5.8  businesses.interview_snoozed_until
--   §9.1  founder_interview_rounds and founder_interview_answers, verbatim
--   §9.2  RLS: ONE SELECT policy each, every write a service-role RPC
--
-- The two new tables come FIRST because the memory columns reference founder_interview_answers.
-- The fourth governed-memory table's source CHECK is NOT touched (D-4: this writer never writes it).
-- enforce_memory_import_immutable is NOT edited (db-MINOR-1): a new sibling function is added.
--
-- The two ADR 0010 Amendment 2 §D2.5 cascade rows for these tables are added in THIS commit
-- (docs/decisions/0010-legal-surface.md), per that ADR's mandatory rule.

-- ─── 1. founder_interview_rounds (§9.1) ─────────────────────────────────────

CREATE TABLE public.founder_interview_rounds (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                 uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- The §5.2 lifecycle. Terminal: ratified, skipped, expired, failed, no_records.
  status                      text        NOT NULL DEFAULT 'open'
    CONSTRAINT founder_interview_rounds_status_check
    CHECK (status IN ('open', 'submitted', 'skipped', 'extracting', 'extraction_failed',
                      'awaiting_ratification', 'no_records', 'ratified', 'expired', 'failed')),

  -- §3.6: the 5..8 bound, enforced a second time here (Zod first, the create RPC third).
  question_count              int         NOT NULL
    CONSTRAINT founder_interview_rounds_question_count_check
    CHECK (question_count BETWEEN 5 AND 8),
  bank_version                int         NOT NULL,

  created_by                  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  submitted_at                timestamptz,
  claimed_at                  timestamptz,

  -- §7.2: the per-round cost ceiling and the attempt cap. A reservation is one conditional UPDATE
  -- on THIS row, never an upsert; these CHECKs are the last line behind its guard.
  extraction_attempts         int         NOT NULL DEFAULT 0
    CONSTRAINT founder_interview_rounds_attempts_check
    CHECK (extraction_attempts BETWEEN 0 AND 3),
  spend_cents                 int         NOT NULL DEFAULT 0
    CONSTRAINT founder_interview_rounds_spend_nonneg_check
    CHECK (spend_cents >= 0),
  ceiling_cents               int         NOT NULL DEFAULT 30
    CONSTRAINT founder_interview_rounds_ceiling_positive_check
    CHECK (ceiling_cents > 0),
  CONSTRAINT founder_interview_rounds_spend_within_ceiling_check
    CHECK (spend_cents <= ceiling_cents),

  error_code                  text,
  extracted_at                timestamptz,
  ratified_at                 timestamptz,
  ratified_by                 uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  terminal_at                 timestamptz,

  -- §10.5 yield counters — the fidelity signal. Written by the writer and ratify RPCs.
  items_proposed              int         NOT NULL DEFAULT 0 CHECK (items_proposed >= 0),
  dropped_ungrounded          int         NOT NULL DEFAULT 0 CHECK (dropped_ungrounded >= 0),
  dropped_performance_claim   int         NOT NULL DEFAULT 0 CHECK (dropped_performance_claim >= 0),
  candidates_written_brand    int         NOT NULL DEFAULT 0 CHECK (candidates_written_brand >= 0),
  candidates_written_audience int         NOT NULL DEFAULT 0 CHECK (candidates_written_audience >= 0),
  candidates_written_evidence int         NOT NULL DEFAULT 0 CHECK (candidates_written_evidence >= 0),
  accepted                    int         NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  rejected                    int         NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  edited                      int         NOT NULL DEFAULT 0 CHECK (edited >= 0),
  replaced                    int         NOT NULL DEFAULT 0 CHECK (replaced >= 0),

  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- INTERVIEW-ONE-OPEN-ROUND [db-MAJOR-2]: one NON-terminal round per business. extraction_failed is
-- retryable in place and awaiting_ratification is still open, so both are non-terminal here.
CREATE UNIQUE INDEX founder_interview_rounds_one_open_uq
  ON public.founder_interview_rounds (business_id)
  WHERE status NOT IN ('ratified', 'skipped', 'expired', 'failed', 'no_records');

-- The due computation (§5.1) and the round list (§9.5): a business's rounds, newest first.
CREATE INDEX founder_interview_rounds_business_created_idx
  ON public.founder_interview_rounds (business_id, created_at DESC);

-- The sweep (§5.4): stuck rounds by claim age, terminal rounds by terminal age.
CREATE INDEX founder_interview_rounds_stuck_idx
  ON public.founder_interview_rounds (status, claimed_at)
  WHERE status IN ('extracting', 'extraction_failed');
CREATE INDEX founder_interview_rounds_terminal_idx
  ON public.founder_interview_rounds (status, terminal_at)
  WHERE terminal_at IS NOT NULL;

CREATE TRIGGER trg_founder_interview_rounds_updated_at
BEFORE UPDATE ON public.founder_interview_rounds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 2. founder_interview_answers (§9.1) ────────────────────────────────────
--
-- A row is NEVER hard-deleted except by cascade: retention REDACTS its text and keeps the row as a
-- provenance stub (§6.3), so interview memory's answer pointer never dangles.

CREATE TABLE public.founder_interview_answers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  round_id        uuid        NOT NULL REFERENCES public.founder_interview_rounds(id) ON DELETE CASCADE,

  position        int         NOT NULL
    CONSTRAINT founder_interview_answers_position_check CHECK (position BETWEEN 1 AND 8),
  question_key    text        NOT NULL,
  bank_version    int         NOT NULL,
  slot_type       text        NOT NULL
    CONSTRAINT founder_interview_answers_slot_type_check
    CHECK (slot_type IN ('brand', 'audience', 'evidence')),
  slot_category   text        NOT NULL
    CONSTRAINT founder_interview_answers_slot_category_check
    CHECK (slot_category IN ('positioning', 'capability', 'pricing', 'competitor',
                             'problem', 'objection', 'question', 'trigger',
                             'quote', 'case_study', 'usage_data')),

  status          text        NOT NULL DEFAULT 'pending'
    CONSTRAINT founder_interview_answers_status_check
    CHECK (status IN ('pending', 'answered', 'skipped')),

  -- §6.2 / §7.1: at most 2000 characters (Zod first, this CHECK second).
  answer_text     text
    CONSTRAINT founder_interview_answers_text_len_check
    CHECK (answer_text IS NULL OR char_length(answer_text) <= 2000),
  char_count      int         CHECK (char_count IS NULL OR char_count >= 0),

  answered_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at     timestamptz,
  redacted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT founder_interview_answers_round_position_uq UNIQUE (round_id, position),
  CONSTRAINT founder_interview_answers_round_question_uq UNIQUE (round_id, question_key),

  -- An answered row has its timestamp; a redacted row has no text (the stub survives).
  CONSTRAINT founder_interview_answers_answered_has_time_check
    CHECK (status <> 'answered' OR answered_at IS NOT NULL),
  CONSTRAINT founder_interview_answers_redacted_has_no_text_check
    CHECK (redacted_at IS NULL OR answer_text IS NULL)
);

-- The cooldown lookup (§3.3): has this business answered / skipped this key recently?
CREATE INDEX founder_interview_answers_cooldown_idx
  ON public.founder_interview_answers (business_id, question_key, answered_at DESC);

CREATE TRIGGER trg_founder_interview_answers_updated_at
BEFORE UPDATE ON public.founder_interview_answers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. RLS (§9.2) — the ADR 0027 §9.1 posture, not the four-policy block ────
--
-- ONE policy each: SELECT for authenticated, InitPlan-wrapped. No INSERT/UPDATE/DELETE policy and no
-- write grant: EVERY write is a service-role RPC, so there is no USING / WITH CHECK pair to omit.

ALTER TABLE public.founder_interview_rounds  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_interview_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY founder_interview_rounds_select_own
  ON public.founder_interview_rounds FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY founder_interview_answers_select_own
  ON public.founder_interview_answers FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

REVOKE ALL ON public.founder_interview_rounds  FROM anon;
REVOKE ALL ON public.founder_interview_answers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.founder_interview_rounds  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.founder_interview_answers FROM authenticated;

-- ─── 4. businesses.interview_snoozed_until (§5.8) ───────────────────────────
-- An existing table already in ADR 0010 §D2.5; no new cascade row.

ALTER TABLE public.businesses
  ADD COLUMN interview_snoozed_until timestamptz NULL;

-- ─── 5. 'interview' joins the source CHECK (§2.1, founder ruling A-2) ───────
--
-- The three tables' source CHECK is INLINE and UNNAMED (governed_memory.sql:31, :92, :148), so its
-- name is a Postgres default nobody asserted. Each block finds it in pg_constraint BY DEFINITION,
-- RAISES unless exactly one row matches, drops it BY THAT NAME, and re-adds it EXPLICITLY NAMED —
-- the 20260922110000:394-430 idiom, with the anchored pattern of 20260919130000:58-63 (an unanchored
-- LIKE '%source%' would also match the import-marker CHECKs). A guessed DROP CONSTRAINT IF EXISTS
-- would silently no-op and reject every 'interview' write. ONE BLOCK PER TABLE, REPEATED, NOT
-- LOOPED [db-MINOR-3]. The tables are populated, so the re-add is NOT VALID and a separate VALIDATE
-- CONSTRAINT follows (the ADR 0026 §5.1 [db-7] precedent).

DO $$
DECLARE
  v_conname text;
  v_count   int;
BEGIN
  SELECT count(*), min(c.conname) INTO v_count, v_conname
    FROM pg_constraint c
   WHERE c.conrelid = 'public.brand_memory'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ~ '^CHECK \(\(source = ANY \(ARRAY\[';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'brand_memory source CHECK lookup found % row(s) by definition, expected exactly 1', v_count;
  END IF;
  EXECUTE format('ALTER TABLE public.brand_memory DROP CONSTRAINT %I', v_conname);
END $$;

ALTER TABLE public.brand_memory
  ADD CONSTRAINT brand_memory_source_check
    CHECK (source IN ('manual', 'distilled', 'import', 'interview')) NOT VALID;
ALTER TABLE public.brand_memory VALIDATE CONSTRAINT brand_memory_source_check;

DO $$
DECLARE
  v_conname text;
  v_count   int;
BEGIN
  SELECT count(*), min(c.conname) INTO v_count, v_conname
    FROM pg_constraint c
   WHERE c.conrelid = 'public.evidence_memory'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ~ '^CHECK \(\(source = ANY \(ARRAY\[';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'evidence_memory source CHECK lookup found % row(s) by definition, expected exactly 1', v_count;
  END IF;
  EXECUTE format('ALTER TABLE public.evidence_memory DROP CONSTRAINT %I', v_conname);
END $$;

ALTER TABLE public.evidence_memory
  ADD CONSTRAINT evidence_memory_source_check
    CHECK (source IN ('manual', 'distilled', 'import', 'interview')) NOT VALID;
ALTER TABLE public.evidence_memory VALIDATE CONSTRAINT evidence_memory_source_check;

DO $$
DECLARE
  v_conname text;
  v_count   int;
BEGIN
  SELECT count(*), min(c.conname) INTO v_count, v_conname
    FROM pg_constraint c
   WHERE c.conrelid = 'public.audience_memory'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ~ '^CHECK \(\(source = ANY \(ARRAY\[';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'audience_memory source CHECK lookup found % row(s) by definition, expected exactly 1', v_count;
  END IF;
  EXECUTE format('ALTER TABLE public.audience_memory DROP CONSTRAINT %I', v_conname);
END $$;

ALTER TABLE public.audience_memory
  ADD CONSTRAINT audience_memory_source_check
    CHECK (source IN ('manual', 'distilled', 'import', 'interview')) NOT VALID;
ALTER TABLE public.audience_memory VALIDATE CONSTRAINT audience_memory_source_check;

-- ─── 6. The answer pointer and its four CHECKs (§2.2) ───────────────────────
--
-- ON DELETE NO ACTION, exactly as import_run_id (20260913140000:11-29): the business purge deletes
-- answers and memory rows in ONE statement and NO ACTION is checked at statement end; RESTRICT would
-- fail that cascade. SET NULL would violate the biconditional; CASCADE would let answer cleanup
-- silently erase memory the founder ratified. An answer row is never hard-deleted otherwise.
--
-- None of these CHECKs starts `CHECK ((source = ANY (ARRAY[`, so section 5's lookup stays exactly-one
-- for any later widening.

ALTER TABLE public.brand_memory
  ADD COLUMN interview_answer_id          uuid    NULL REFERENCES public.founder_interview_answers(id) ON DELETE NO ACTION,
  ADD COLUMN interview_span               text    NULL,
  ADD COLUMN interview_span_redacted_at   timestamptz NULL,
  ADD COLUMN interview_extracted_text     text    NULL,
  ADD COLUMN interview_edited             boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT brand_memory_interview_answer_id_marker_check
    CHECK ((source = 'interview') = (interview_answer_id IS NOT NULL)),
  ADD CONSTRAINT brand_memory_interview_extracted_text_marker_check
    CHECK ((source = 'interview') = (interview_extracted_text IS NOT NULL)),
  ADD CONSTRAINT brand_memory_interview_span_or_redacted_check
    CHECK (source <> 'interview' OR interview_span IS NOT NULL OR interview_span_redacted_at IS NOT NULL),
  ADD CONSTRAINT brand_memory_interview_clean_check
    CHECK (source = 'interview' OR (interview_span IS NULL AND interview_span_redacted_at IS NULL AND interview_edited = false)),
  ADD CONSTRAINT brand_memory_interview_span_len_check
    CHECK (interview_span IS NULL OR char_length(interview_span) <= 500);
CREATE INDEX brand_memory_interview_answer_id_idx ON public.brand_memory (interview_answer_id);

ALTER TABLE public.evidence_memory
  ADD COLUMN interview_answer_id          uuid    NULL REFERENCES public.founder_interview_answers(id) ON DELETE NO ACTION,
  ADD COLUMN interview_span               text    NULL,
  ADD COLUMN interview_span_redacted_at   timestamptz NULL,
  ADD COLUMN interview_extracted_text     text    NULL,
  ADD COLUMN interview_edited             boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT evidence_memory_interview_answer_id_marker_check
    CHECK ((source = 'interview') = (interview_answer_id IS NOT NULL)),
  ADD CONSTRAINT evidence_memory_interview_extracted_text_marker_check
    CHECK ((source = 'interview') = (interview_extracted_text IS NOT NULL)),
  ADD CONSTRAINT evidence_memory_interview_span_or_redacted_check
    CHECK (source <> 'interview' OR interview_span IS NOT NULL OR interview_span_redacted_at IS NOT NULL),
  ADD CONSTRAINT evidence_memory_interview_clean_check
    CHECK (source = 'interview' OR (interview_span IS NULL AND interview_span_redacted_at IS NULL AND interview_edited = false)),
  ADD CONSTRAINT evidence_memory_interview_span_len_check
    CHECK (interview_span IS NULL OR char_length(interview_span) <= 500);
CREATE INDEX evidence_memory_interview_answer_id_idx ON public.evidence_memory (interview_answer_id);

ALTER TABLE public.audience_memory
  ADD COLUMN interview_answer_id          uuid    NULL REFERENCES public.founder_interview_answers(id) ON DELETE NO ACTION,
  ADD COLUMN interview_span               text    NULL,
  ADD COLUMN interview_span_redacted_at   timestamptz NULL,
  ADD COLUMN interview_extracted_text     text    NULL,
  ADD COLUMN interview_edited             boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT audience_memory_interview_answer_id_marker_check
    CHECK ((source = 'interview') = (interview_answer_id IS NOT NULL)),
  ADD CONSTRAINT audience_memory_interview_extracted_text_marker_check
    CHECK ((source = 'interview') = (interview_extracted_text IS NOT NULL)),
  ADD CONSTRAINT audience_memory_interview_span_or_redacted_check
    CHECK (source <> 'interview' OR interview_span IS NOT NULL OR interview_span_redacted_at IS NOT NULL),
  ADD CONSTRAINT audience_memory_interview_clean_check
    CHECK (source = 'interview' OR (interview_span IS NULL AND interview_span_redacted_at IS NULL AND interview_edited = false)),
  ADD CONSTRAINT audience_memory_interview_span_len_check
    CHECK (interview_span IS NULL OR char_length(interview_span) <= 500);
CREATE INDEX audience_memory_interview_answer_id_idx ON public.audience_memory (interview_answer_id);

-- ─── 7. The writer's dedupe indexes (§2.3, [db-MAJOR-1]) ────────────────────
--
-- The targets of write_interview_candidates' ON CONFLICT DO NOTHING (M2.5), with the TYPE column in
-- the key so two records of different category from one answer never collide. Scoped to
-- source = 'interview', the 20260913140000:117-123 idiom.

CREATE UNIQUE INDEX brand_memory_interview_answer_category_statement_uq
  ON public.brand_memory (interview_answer_id, category, md5(lower(statement)))
  WHERE source = 'interview';

CREATE UNIQUE INDEX audience_memory_interview_answer_kind_statement_uq
  ON public.audience_memory (interview_answer_id, kind, md5(lower(statement)))
  WHERE source = 'interview';

CREATE UNIQUE INDEX evidence_memory_interview_answer_kind_content_uq
  ON public.evidence_memory (interview_answer_id, kind, md5(content))
  WHERE source = 'interview';

-- ─── 8. The sibling immutability trigger (§2.2, INTERVIEW-PROVENANCE-IMMUTABLE) ──
--
-- A NEW function beside enforce_memory_import_immutable, which is NOT edited [db-MINOR-1]: both
-- fire BEFORE UPDATE, and the import function still guards its own three columns. This one rejects
-- any change to source, interview_answer_id and interview_extracted_text, and permits
-- interview_span to change ONLY to NULL in the very statement that SETS interview_span_redacted_at
-- (retention, §6.3). interview_edited and the record text stay editable at ratification (§8.4);
-- the model's original survives in interview_extracted_text.

CREATE OR REPLACE FUNCTION public.enforce_memory_interview_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.interview_answer_id IS DISTINCT FROM OLD.interview_answer_id
     OR NEW.interview_extracted_text IS DISTINCT FROM OLD.interview_extracted_text
  THEN
    RAISE EXCEPTION 'memory interview provenance columns (source, interview_answer_id, interview_extracted_text) are immutable once written';
  END IF;

  -- The redaction stamp is written once, and only together with span -> NULL.
  IF NEW.interview_span_redacted_at IS DISTINCT FROM OLD.interview_span_redacted_at THEN
    IF OLD.interview_span_redacted_at IS NOT NULL
       OR NEW.interview_span_redacted_at IS NULL
       OR NEW.interview_span IS NOT NULL
    THEN
      RAISE EXCEPTION 'interview_span_redacted_at may only be set once, in the statement that nulls interview_span';
    END IF;
  END IF;

  -- The span may change only to NULL, and only in the statement that sets the redaction stamp.
  IF NEW.interview_span IS DISTINCT FROM OLD.interview_span THEN
    IF NEW.interview_span IS NOT NULL
       OR NEW.interview_span_redacted_at IS NULL
       OR OLD.interview_span_redacted_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'interview_span may only change to NULL, in the same statement that sets interview_span_redacted_at';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brand_memory_interview_immutable
  BEFORE UPDATE ON public.brand_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_interview_immutable();

CREATE TRIGGER trg_evidence_memory_interview_immutable
  BEFORE UPDATE ON public.evidence_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_interview_immutable();

CREATE TRIGGER trg_audience_memory_interview_immutable
  BEFORE UPDATE ON public.audience_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_interview_immutable();
