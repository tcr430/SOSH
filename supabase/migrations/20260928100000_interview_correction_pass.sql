-- ADR 0029 (Session 35-D, D4) — THE CORRECTION-PASS MIGRATION. The ONLY migration of the pass. A FORWARD migration over five
-- committed migrations (20260925110000, 120000-150000): none of them is edited. Finding -> change:
--
--   MAJOR-3  hedge flag + conflict ids were computed by the extraction and DISCARDED (extract.ts "these are NOT persisted"), so the
--            ratify RPC's replace branch was unreachable from the product. brand_memory, evidence_memory and audience_memory gain
--            interview_hedge_flagged boolean and interview_conflict_ids uuid[] (<= 5). Both are NULL unless source = 'interview',
--            and immutable after insert (enforce_memory_interview_immutable). write_interview_candidates persists them, and it
--            KEEPS a conflict id only when it is a live row of the SAME table and the SAME business (business_id = the LOCKED
--            ROUND's); any other id is dropped and COUNTED in founder_interview_rounds.dropped_conflict_foreign, never stored.
--   MAJOR-4  (founder ruling A-6(a)) a REJECTED candidate is deleted at its round's answer-redaction deadline
--            (terminal_at + 30 d). The schema carried no way to tell a rejected candidate from a row a LATER round replaced (both
--            are 'retired' in a ratified round), so the three memory tables gain interview_rejected boolean, set ONLY by
--            ratify_interview_round's REJECT branch, in the same UPDATE that retires the candidate. The sweep deletes only
--            status = 'retired' AND interview_rejected rows of RATIFIED rounds. A replaced row and an ACTIVE row are never deleted.
--   MINOR-6  (founder ruling A-7(a)) create_interview_round: a 'failed' round does not count toward the 30-day rule, but at most
--            TWO rounds of any status may be created per 30 days (A-4's spend bound stays structural: <= 2 x 30 cents / 30 days).
--   NIT-2    founder_interview_rounds.dropped_cap: the per-answer cap drop is counted, written by the same writer call.
--
-- Replaced here (CREATE OR REPLACE, EXECUTE re-stated exactly as the originals — SECURITY DEFINER,
-- search_path = public, pg_temp, service_role ONLY): enforce_memory_interview_immutable (trigger), write_interview_candidates,
-- ratify_interview_round (one added assignment, on REJECT), sweep_interview_data (a new step 4b), create_interview_round.
-- Not a governance change: the two marker keys of p_items are COMPUTED fields. The writer still reads no jsonb key named
-- confidence, status, source, sensitivity, public_use_permission, scope, scope_ref, expires_at, observation_count,
-- last_confirmed_at or business_id (interview-writer.test.ts re-proves it over pg_proc.prosrc).

-- ─── 1. The round's two new counters (NIT-2, MAJOR-3) ────────────────────────────────────────────────────────────────────

ALTER TABLE public.founder_interview_rounds
  ADD COLUMN dropped_cap              int NOT NULL DEFAULT 0 CONSTRAINT founder_interview_rounds_dropped_cap_check CHECK (dropped_cap >= 0),
  ADD COLUMN dropped_conflict_foreign int NOT NULL DEFAULT 0 CONSTRAINT founder_interview_rounds_dropped_conflict_foreign_check CHECK (dropped_conflict_foreign >= 0);

-- ─── 2. The marker columns on the three interview-capable memory tables ──────────────────────────────────────────────────
--
-- interview_hedge_flagged / interview_conflict_ids: NULL for every non-interview row (CHECK) and for every interview row written
-- before this migration (unknown, never backfilled); the writer always sets both on a new row (false / '{}').
-- interview_rejected: NOT NULL DEFAULT false (a constant default: no table rewrite); true only on an interview row.

ALTER TABLE public.brand_memory
  ADD COLUMN interview_hedge_flagged boolean NULL,
  ADD COLUMN interview_conflict_ids  uuid[]  NULL,
  ADD COLUMN interview_rejected      boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT brand_memory_interview_markers_clean_check
    CHECK (source = 'interview' OR (interview_hedge_flagged IS NULL AND interview_conflict_ids IS NULL AND interview_rejected = false)),
  ADD CONSTRAINT brand_memory_interview_conflict_ids_len_check
    CHECK (interview_conflict_ids IS NULL OR cardinality(interview_conflict_ids) <= 5);

ALTER TABLE public.evidence_memory
  ADD COLUMN interview_hedge_flagged boolean NULL,
  ADD COLUMN interview_conflict_ids  uuid[]  NULL,
  ADD COLUMN interview_rejected      boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT evidence_memory_interview_markers_clean_check
    CHECK (source = 'interview' OR (interview_hedge_flagged IS NULL AND interview_conflict_ids IS NULL AND interview_rejected = false)),
  ADD CONSTRAINT evidence_memory_interview_conflict_ids_len_check
    CHECK (interview_conflict_ids IS NULL OR cardinality(interview_conflict_ids) <= 5);

ALTER TABLE public.audience_memory
  ADD COLUMN interview_hedge_flagged boolean NULL,
  ADD COLUMN interview_conflict_ids  uuid[]  NULL,
  ADD COLUMN interview_rejected      boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT audience_memory_interview_markers_clean_check
    CHECK (source = 'interview' OR (interview_hedge_flagged IS NULL AND interview_conflict_ids IS NULL AND interview_rejected = false)),
  ADD CONSTRAINT audience_memory_interview_conflict_ids_len_check
    CHECK (interview_conflict_ids IS NULL OR cardinality(interview_conflict_ids) <= 5);

-- The sweep's A-6(a) step reads retired + rejected rows: a partial index keeps that probe off a full scan of the memory tables.
-- (The predicate matches the sweep's own: status = 'retired' AND interview_rejected — the trigger keeps a rejected row retired.)
CREATE INDEX brand_memory_interview_rejected_idx    ON public.brand_memory    (interview_answer_id) WHERE interview_rejected AND status = 'retired';
CREATE INDEX evidence_memory_interview_rejected_idx ON public.evidence_memory (interview_answer_id) WHERE interview_rejected AND status = 'retired';
CREATE INDEX audience_memory_interview_rejected_idx ON public.audience_memory (interview_answer_id) WHERE interview_rejected AND status = 'retired';

-- [db-review MINOR-3] interview_conflict_ids has no FK: an id can dangle after a later delete (the sweep deletes rejected rows).
-- That is by design and harmless — the ids are ADVISORY display hints. Readers must not trust them: the ratify RPC re-verifies a
-- replace target IN SQL (active, source = 'interview', same business) before it retires anything.
COMMENT ON COLUMN public.brand_memory.interview_conflict_ids    IS 'ADVISORY, no FK: may dangle. ratify_interview_round re-verifies any replace target in SQL.';
COMMENT ON COLUMN public.evidence_memory.interview_conflict_ids IS 'ADVISORY, no FK: may dangle. ratify_interview_round re-verifies any replace target in SQL.';
COMMENT ON COLUMN public.audience_memory.interview_conflict_ids IS 'ADVISORY, no FK: may dangle. ratify_interview_round re-verifies any replace target in SQL.';

-- ─── 3. The immutability trigger, extended ───────────────────────────────────────────────────────────────────────────────
--
-- The original guards (source, interview_answer_id, interview_extracted_text, the span redaction) are restated VERBATIM. New:
-- the two markers are immutable after insert; interview_rejected may go false -> true ONLY in the statement that moves a
-- CANDIDATE to 'retired' (ratify's reject), and never back.

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

  IF NEW.interview_hedge_flagged IS DISTINCT FROM OLD.interview_hedge_flagged
     OR NEW.interview_conflict_ids IS DISTINCT FROM OLD.interview_conflict_ids
  THEN
    RAISE EXCEPTION 'memory interview markers (interview_hedge_flagged, interview_conflict_ids) are immutable once written';
  END IF;

  IF NEW.interview_rejected IS DISTINCT FROM OLD.interview_rejected THEN
    IF OLD.interview_rejected OR NOT NEW.interview_rejected OR OLD.status <> 'candidate' OR NEW.status <> 'retired' THEN
      RAISE EXCEPTION 'interview_rejected may only be set, once, in the statement that retires a candidate';
    END IF;
  END IF;

  -- [db-review MINOR-2] A rejected row STAYS retired: were it ever restored to active/candidate and retired again by a later
  -- replace, the stale flag would let the sweep's step 4b delete a row the founder had restored.
  IF OLD.interview_rejected AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'a rejected interview candidate stays retired (interview_rejected is set)';
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

-- ─── 4. write_interview_candidates — persists the markers, tenant-bounds the conflict ids, counts the cap drop ─────────────
--
-- p_items keeps its shape and gains OPTIONAL keys, so every existing caller still resolves:
--   item:     { ..., "hedgeFlagged": boolean, "conflictIds": [uuid, ... <= 5] }
--   counters: { ..., "droppedCap": n }
-- A malformed marker RAISES 22023 (a defect or a tampered call); a well-formed conflict id that is not a live row of the SAME
-- table and the SAME business is DROPPED and counted (the model may name an id it was never sent). The return object is UNCHANGED.

CREATE OR REPLACE FUNCTION public.write_interview_candidates(
  p_round_id uuid,
  p_items    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id     uuid;
  v_status          text;
  v_items           jsonb;
  v_counters        jsonb;
  v_n_items         int;
  v_proposed        int;
  v_dropped_ung     int;
  v_dropped_perf    int;
  v_dropped_cap     int;
  v_dropped_cf      int := 0;
  v_item            jsonb;
  v_type            text;
  v_cat             text;
  v_raw_text        text;
  v_raw_span        text;
  v_stored_text     text;
  v_stored_span     text;
  v_max_text        int;
  v_answer_id       uuid;
  v_answer_text     text;
  v_answered_at     timestamptz;
  v_expires         timestamptz;
  v_rows            int;
  v_inserted        int := 0;
  v_brand           int;
  v_audience        int;
  v_evidence        int;
  v_new_status      text;
  v_hedge           boolean;
  v_kept            uuid[];
  v_cid             uuid;
  v_cid_ok          boolean;
BEGIN
  -- (a) Lock the round, derive the business from IT, and write nothing unless it is extracting.
  SELECT business_id, status INTO v_business_id, v_status
    FROM public.founder_interview_rounds
   WHERE id = p_round_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_status <> 'extracting' THEN
    RETURN jsonb_build_object('outcome', 'not_extracting', 'status', v_status);
  END IF;

  -- (b) Validate the envelope.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'object' THEN
    RAISE EXCEPTION 'write_interview_candidates: p_items must be a jsonb object { items, counters }' USING ERRCODE = '22023';
  END IF;
  v_items := p_items -> 'items';
  v_counters := p_items -> 'counters';
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'write_interview_candidates: items must be a jsonb array' USING ERRCODE = '22023';
  END IF;
  v_n_items := jsonb_array_length(v_items);
  IF v_n_items > 24 THEN
    RAISE EXCEPTION 'write_interview_candidates: at most 24 items per round, got %', v_n_items USING ERRCODE = '22023';
  END IF;
  IF v_counters IS NULL OR jsonb_typeof(v_counters) <> 'object'
     OR (v_counters ->> 'proposed') IS NULL OR (v_counters ->> 'proposed') !~ '^[0-9]{1,6}$'
     OR (v_counters ->> 'droppedUngrounded') IS NULL OR (v_counters ->> 'droppedUngrounded') !~ '^[0-9]{1,6}$'
     OR (v_counters ->> 'droppedPerformanceClaim') IS NULL OR (v_counters ->> 'droppedPerformanceClaim') !~ '^[0-9]{1,6}$'
  THEN
    RAISE EXCEPTION 'write_interview_candidates: counters must carry non-negative integers proposed, droppedUngrounded, droppedPerformanceClaim'
      USING ERRCODE = '22023';
  END IF;
  v_proposed := (v_counters ->> 'proposed')::int;
  v_dropped_ung := (v_counters ->> 'droppedUngrounded')::int;
  v_dropped_perf := (v_counters ->> 'droppedPerformanceClaim')::int;
  -- [NIT-2] droppedCap is OPTIONAL (an older caller omits it): absent counts as 0, present must be a non-negative integer.
  IF v_counters ? 'droppedCap' THEN
    IF (v_counters ->> 'droppedCap') IS NULL OR (v_counters ->> 'droppedCap') !~ '^[0-9]{1,6}$' THEN
      RAISE EXCEPTION 'write_interview_candidates: droppedCap must be a non-negative integer' USING ERRCODE = '22023';
    END IF;
    v_dropped_cap := (v_counters ->> 'droppedCap')::int;
  ELSE
    v_dropped_cap := 0;
  END IF;
  IF v_proposed < v_n_items THEN
    RAISE EXCEPTION 'write_interview_candidates: proposed (%) cannot be below the items written (%)', v_proposed, v_n_items
      USING ERRCODE = '22023';
  END IF;

  -- (b) Validate every item BEFORE any insert. At most 3 items per answer.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) i GROUP BY i ->> 'answerId' HAVING count(*) > 3
  ) THEN
    RAISE EXCEPTION 'write_interview_candidates: at most 3 items per answer' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR (v_item ->> 'answerId') IS NULL OR (v_item ->> 'answerId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR (v_item ->> 'type') IS NULL OR (v_item ->> 'category') IS NULL
       OR (v_item ->> 'text') IS NULL OR (v_item ->> 'span') IS NULL
       OR (v_item ->> 'storedText') IS NULL OR (v_item ->> 'storedSpan') IS NULL
    THEN
      RAISE EXCEPTION 'write_interview_candidates: every item needs answerId, type, category, text, span, storedText and storedSpan'
        USING ERRCODE = '22023';
    END IF;

    -- [MAJOR-3] the two optional markers: SHAPE only here (their meaning is checked at insert).
    IF (v_item -> 'hedgeFlagged') IS NOT NULL AND jsonb_typeof(v_item -> 'hedgeFlagged') NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'write_interview_candidates: hedgeFlagged must be a boolean' USING ERRCODE = '22023';
    END IF;
    IF (v_item -> 'conflictIds') IS NOT NULL AND jsonb_typeof(v_item -> 'conflictIds') <> 'null' THEN
      IF jsonb_typeof(v_item -> 'conflictIds') <> 'array'
         OR jsonb_array_length(v_item -> 'conflictIds') > 5
         OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_item -> 'conflictIds') c
               WHERE jsonb_typeof(c) <> 'string'
                  OR (c #>> '{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            )
      THEN
        RAISE EXCEPTION 'write_interview_candidates: conflictIds must be an array of at most 5 uuid strings' USING ERRCODE = '22023';
      END IF;
    END IF;

    v_type := v_item ->> 'type';
    v_cat := v_item ->> 'category';
    v_raw_text := v_item ->> 'text';
    v_raw_span := v_item ->> 'span';
    v_stored_text := v_item ->> 'storedText';
    v_stored_span := v_item ->> 'storedSpan';
    v_answer_id := (v_item ->> 'answerId')::uuid;

    -- type, and the category/kind within THAT table's enum
    IF NOT (
         (v_type = 'brand'    AND v_cat IN ('positioning', 'capability', 'pricing', 'competitor', 'other'))
      OR (v_type = 'audience' AND v_cat IN ('problem', 'objection', 'question', 'trigger', 'other'))
      OR (v_type = 'evidence' AND v_cat IN ('quote', 'case_study', 'usage_data', 'other'))
    ) THEN
      RAISE EXCEPTION 'write_interview_candidates: type % / category % is not in the table''s enum', v_type, v_cat
        USING ERRCODE = '22023';
    END IF;

    -- lengths: text <= 280 (brand, audience) or 500 (evidence); span <= 500; blank is not a record. The STORED forms
    -- are bounded too, because neutralising can only lengthen text and the columns' CHECKs are the last line.
    v_max_text := CASE WHEN v_type = 'evidence' THEN 500 ELSE 280 END;
    IF btrim(v_raw_text) = '' OR btrim(v_raw_span) = ''
       OR char_length(v_raw_text) > v_max_text OR char_length(v_raw_span) > 500
       OR btrim(v_stored_text) = '' OR btrim(v_stored_span) = ''
       OR char_length(v_stored_text) > v_max_text OR char_length(v_stored_span) > 500
    THEN
      RAISE EXCEPTION 'write_interview_candidates: text must be 1..% characters and span 1..500 (raw and stored)', v_max_text
        USING ERRCODE = '22023';
    END IF;

    -- the answer must belong to THIS round (and therefore this business) and be answered
    SELECT answer_text, answered_at INTO v_answer_text, v_answered_at
      FROM public.founder_interview_answers
     WHERE id = v_answer_id
       AND round_id = p_round_id
       AND business_id = v_business_id
       AND status = 'answered';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'write_interview_candidates: answer % is not an answered question of round %', v_answer_id, p_round_id
        USING ERRCODE = '22023';
    END IF;
    -- a REDACTED answer has no text: never re-ground against a stub [db-MINOR-2]
    IF v_answer_text IS NULL THEN
      RAISE EXCEPTION 'write_interview_candidates: answer % has been redacted and cannot be grounded against', v_answer_id
        USING ERRCODE = '22023';
    END IF;

    -- GROUNDING, re-checked in SQL on RAW text: the raw span is an exact substring of the raw stored answer
    IF strpos(v_answer_text, v_raw_span) = 0 THEN
      RAISE EXCEPTION 'write_interview_candidates: the span of an item for answer % is not contained in the answer', v_answer_id
        USING ERRCODE = '22023';
    END IF;

    -- evidence is VERBATIM: its text equals its span (raw), and so do their stored forms
    IF v_type = 'evidence' AND (v_raw_text <> v_raw_span OR v_stored_text <> v_stored_span) THEN
      RAISE EXCEPTION 'write_interview_candidates: an evidence item''s text must equal its span' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- (c) Insert. Governance is FIXED HERE (ADR 2.3, 2.6): source 'interview', status 'candidate', sensitivity
  -- 'internal', public_use_permission false, scope 'brand', scope_ref NULL, observation_count 1, confidence by table
  -- (brand 0.6 / audience 0.5 / evidence 0.4), last_confirmed_at = the ANSWER's answered_at (read from the answer row),
  -- expires_at from category/kind + answered_at. interview_extracted_text = the stored item text (immutable thereafter).
  -- The two markers are COMPUTED fields, not governance: hedge defaults false, conflict ids default '{}' (NULL stays "written
  -- before D4"), and each conflict id survives only as a live row of the SAME table and the ROUND'S business [MAJOR-3].
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_type := v_item ->> 'type';
    v_cat := v_item ->> 'category';
    v_stored_text := v_item ->> 'storedText';
    v_stored_span := v_item ->> 'storedSpan';
    v_answer_id := (v_item ->> 'answerId')::uuid;
    SELECT answered_at INTO v_answered_at FROM public.founder_interview_answers WHERE id = v_answer_id;

    v_hedge := COALESCE((v_item ->> 'hedgeFlagged')::boolean, false);
    v_kept := ARRAY[]::uuid[];
    IF jsonb_typeof(v_item -> 'conflictIds') = 'array' THEN
      FOR v_cid IN
        SELECT DISTINCT (c #>> '{}')::uuid FROM jsonb_array_elements(v_item -> 'conflictIds') c ORDER BY 1
      LOOP
        v_cid_ok := CASE v_type
          WHEN 'brand' THEN EXISTS (
            SELECT 1 FROM public.brand_memory WHERE id = v_cid AND business_id = v_business_id AND deleted_at IS NULL)
          WHEN 'audience' THEN EXISTS (
            SELECT 1 FROM public.audience_memory WHERE id = v_cid AND business_id = v_business_id AND deleted_at IS NULL)
          ELSE EXISTS (
            SELECT 1 FROM public.evidence_memory WHERE id = v_cid AND business_id = v_business_id AND deleted_at IS NULL)
        END;
        IF v_cid_ok THEN
          v_kept := v_kept || v_cid;
        ELSE
          v_dropped_cf := v_dropped_cf + 1;
        END IF;
      END LOOP;
    END IF;

    IF v_type = 'brand' THEN
      v_expires := CASE v_cat
        WHEN 'pricing' THEN v_answered_at + interval '180 days'
        WHEN 'competitor' THEN v_answered_at + interval '365 days'
        WHEN 'other' THEN v_answered_at + interval '365 days'
        ELSE v_answered_at + interval '540 days'          -- positioning, capability
      END;
      INSERT INTO public.brand_memory
        (business_id, source, confidence, observation_count, status, sensitivity, public_use_permission, scope, scope_ref,
         last_confirmed_at, expires_at, category, statement, interview_answer_id, interview_span, interview_extracted_text,
         interview_hedge_flagged, interview_conflict_ids)
      VALUES
        (v_business_id, 'interview', 0.6, 1, 'candidate', 'internal', false, 'brand', NULL,
         v_answered_at, v_expires, v_cat, v_stored_text, v_answer_id, v_stored_span, v_stored_text,
         v_hedge, v_kept)
      ON CONFLICT (interview_answer_id, category, md5(lower(statement))) WHERE source = 'interview' DO NOTHING;
    ELSIF v_type = 'audience' THEN
      v_expires := v_answered_at + interval '365 days';   -- every audience kind
      INSERT INTO public.audience_memory
        (business_id, source, confidence, observation_count, status, sensitivity, public_use_permission, scope, scope_ref,
         last_confirmed_at, expires_at, kind, statement, interview_answer_id, interview_span, interview_extracted_text,
         interview_hedge_flagged, interview_conflict_ids)
      VALUES
        (v_business_id, 'interview', 0.5, 1, 'candidate', 'internal', false, 'brand', NULL,
         v_answered_at, v_expires, v_cat, v_stored_text, v_answer_id, v_stored_span, v_stored_text,
         v_hedge, v_kept)
      ON CONFLICT (interview_answer_id, kind, md5(lower(statement))) WHERE source = 'interview' DO NOTHING;
    ELSE
      v_expires := CASE WHEN v_cat = 'usage_data' THEN v_answered_at + interval '365 days' ELSE NULL END;  -- quote, case_study, other: NULL
      INSERT INTO public.evidence_memory
        (business_id, source, confidence, observation_count, status, sensitivity, public_use_permission, scope, scope_ref,
         last_confirmed_at, expires_at, kind, content, interview_answer_id, interview_span, interview_extracted_text,
         interview_hedge_flagged, interview_conflict_ids)
      VALUES
        (v_business_id, 'interview', 0.4, 1, 'candidate', 'internal', false, 'brand', NULL,
         v_answered_at, v_expires, v_cat, v_stored_text, v_answer_id, v_stored_span, v_stored_text,
         v_hedge, v_kept)
      ON CONFLICT (interview_answer_id, kind, md5(content)) WHERE source = 'interview' DO NOTHING;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_inserted := v_inserted + v_rows;
  END LOOP;

  -- (d) The yield counters, RECOMPUTED from the candidate rows that exist for this round (never incremented), and the
  -- flip: 'no_records' when the round holds no candidate at all, else 'awaiting_ratification' — ONE conditional UPDATE
  -- guarded on 'extracting'. no_records is TERMINAL, so it stamps terminal_at.
  SELECT count(*) INTO v_brand
    FROM public.brand_memory m
    JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
   WHERE a.round_id = p_round_id;
  SELECT count(*) INTO v_audience
    FROM public.audience_memory m
    JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
   WHERE a.round_id = p_round_id;
  SELECT count(*) INTO v_evidence
    FROM public.evidence_memory m
    JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
   WHERE a.round_id = p_round_id;
  v_new_status := CASE WHEN v_brand + v_audience + v_evidence = 0 THEN 'no_records' ELSE 'awaiting_ratification' END;

  UPDATE public.founder_interview_rounds
     SET status                      = v_new_status,
         extracted_at                = now(),
         terminal_at                 = CASE WHEN v_new_status = 'no_records' THEN now() ELSE terminal_at END,
         items_proposed              = v_proposed,
         dropped_ungrounded          = v_dropped_ung,
         dropped_performance_claim   = v_dropped_perf,
         dropped_cap                 = v_dropped_cap,
         dropped_conflict_foreign    = v_dropped_cf,
         candidates_written_brand    = v_brand,
         candidates_written_audience = v_audience,
         candidates_written_evidence = v_evidence
   WHERE id = p_round_id
     AND status = 'extracting';

  RETURN jsonb_build_object(
    'outcome', 'written',
    'status', v_new_status,
    'inserted', v_inserted,
    'candidates', jsonb_build_object('brand', v_brand, 'audience', v_audience, 'evidence', v_evidence)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_interview_candidates(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_interview_candidates(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_interview_candidates(uuid, jsonb) TO service_role;

-- ─── 5. ratify_interview_round — REJECT records the rejection (A-6(a)) ──────────────────────────────────────────────────
--
-- The ONLY change from the 20260925140000 body: the reject UPDATE also sets interview_rejected = true, so the sweep can tell a
-- rejected candidate from a row a later round replaced. (Restated below in full: CREATE OR REPLACE replaces the whole body.)

CREATE OR REPLACE FUNCTION public.ratify_interview_round(
  p_user_id   uuid,
  p_round_id  uuid,
  p_decisions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id  uuid;
  v_status       text;
  v_n_decisions  int;
  v_n_candidates int;
  v_d            jsonb;
  v_plan         jsonb := '[]'::jsonb;
  v_step         jsonb;
  v_type         text;
  v_id           uuid;
  v_decision     text;
  v_table        text;
  v_col          text;
  v_textcol      text;
  v_cur_cat      text;
  v_cur_text     text;
  v_answered_at  timestamptz;
  v_final_cat    text;
  v_final_text   text;
  v_edited       boolean;
  v_expires      timestamptz;
  v_rep          jsonb;
  v_rep_type     text;
  v_rep_id       uuid;
  v_rep_table    text;
  v_probe        int;
  v_rows         int;
  v_seen         text[] := ARRAY[]::text[];
  v_rep_seen     text[] := ARRAY[]::text[];
  v_key          text;
  v_accepted     int := 0;
  v_rejected     int := 0;
  v_edited_n     int := 0;
  v_replaced     int := 0;
BEGIN
  -- (1) Lock the round and derive the business FROM IT. There is no business parameter to trust.
  SELECT business_id, status INTO v_business_id, v_status
    FROM public.founder_interview_rounds
   WHERE id = p_round_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- (2) A round not awaiting ratification touches NOTHING — checked here, BEFORE any memory write, not discovered only at
  --     the final UPDATE's guard.
  IF v_status <> 'awaiting_ratification' THEN
    RETURN jsonb_build_object('outcome', 'not_awaiting', 'status', v_status);
  END IF;

  -- (3) Approver OR admin, ACTIVE, of THIS business (the ADR 0025 predicate, copied).
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND (role = 'approver' OR is_admin)
  ) THEN
    RAISE EXCEPTION 'ratify_interview_round: % is not an approver/admin member of business %', p_user_id, v_business_id
      USING ERRCODE = '42501';
  END IF;

  -- (4) Validate the whole decision set; nothing is written until every decision is valid.
  IF p_decisions IS NULL OR jsonb_typeof(p_decisions) <> 'array' THEN
    RAISE EXCEPTION 'ratify_interview_round: p_decisions must be a jsonb array' USING ERRCODE = '22023';
  END IF;
  v_n_decisions := jsonb_array_length(p_decisions);
  IF v_n_decisions > 24 THEN
    RAISE EXCEPTION 'ratify_interview_round: at most 24 decisions, got %', v_n_decisions USING ERRCODE = '22023';
  END IF;

  -- NO ACCEPT-ALL: as many decisions as there are candidates, and (below) each one a distinct candidate of THIS round.
  SELECT (SELECT count(*) FROM public.brand_memory m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
           WHERE a.round_id = p_round_id AND m.status = 'candidate' AND m.source = 'interview' AND m.deleted_at IS NULL)
       + (SELECT count(*) FROM public.audience_memory m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
           WHERE a.round_id = p_round_id AND m.status = 'candidate' AND m.source = 'interview' AND m.deleted_at IS NULL)
       + (SELECT count(*) FROM public.evidence_memory m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
           WHERE a.round_id = p_round_id AND m.status = 'candidate' AND m.source = 'interview' AND m.deleted_at IS NULL)
    INTO v_n_candidates;
  IF v_n_decisions <> v_n_candidates THEN
    RAISE EXCEPTION 'ratify_interview_round: every candidate of the round must be decided exactly once (% candidates, % decisions)',
      v_n_candidates, v_n_decisions USING ERRCODE = '22023';
  END IF;

  FOR v_d IN SELECT value FROM jsonb_array_elements(p_decisions) LOOP
    IF jsonb_typeof(v_d) <> 'object'
       OR (v_d ->> 'type') IS NULL OR (v_d ->> 'decision') IS NULL
       OR (v_d ->> 'id') IS NULL OR (v_d ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN
      RAISE EXCEPTION 'ratify_interview_round: every decision must carry a type, a uuid id and a decision' USING ERRCODE = '22023';
    END IF;
    v_type := v_d ->> 'type';
    v_decision := v_d ->> 'decision';
    v_id := (v_d ->> 'id')::uuid;
    IF v_type NOT IN ('brand', 'audience', 'evidence') THEN
      RAISE EXCEPTION 'ratify_interview_round: type must be brand, audience or evidence' USING ERRCODE = '22023';
    END IF;
    IF v_decision NOT IN ('accept', 'reject') THEN
      RAISE EXCEPTION 'ratify_interview_round: decision must be accept or reject' USING ERRCODE = '22023';
    END IF;

    -- each candidate exactly once
    v_key := v_type || ':' || v_id::text;
    IF v_key = ANY (v_seen) THEN
      RAISE EXCEPTION 'ratify_interview_round: candidate % is decided more than once', v_id USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_key;

    v_table := CASE v_type WHEN 'brand' THEN 'brand_memory' WHEN 'audience' THEN 'audience_memory' ELSE 'evidence_memory' END;
    v_col := CASE v_type WHEN 'brand' THEN 'category' ELSE 'kind' END;
    v_textcol := CASE v_type WHEN 'evidence' THEN 'content' ELSE 'statement' END;

    -- the id must be an interview CANDIDATE of THIS round, and of this business
    v_cur_cat := NULL; v_cur_text := NULL; v_answered_at := NULL;
    EXECUTE format(
      'SELECT m.%I, m.%I, a.answered_at FROM public.%I m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id '
      || 'WHERE m.id = $1 AND a.round_id = $2 AND m.business_id = $3 AND m.source = ''interview'' AND m.status = ''candidate'' AND m.deleted_at IS NULL',
      v_col, v_textcol, v_table)
      INTO v_cur_cat, v_cur_text, v_answered_at
      USING v_id, p_round_id, v_business_id;
    IF v_cur_cat IS NULL THEN
      RAISE EXCEPTION 'ratify_interview_round: % is not an interview candidate of this round', v_id USING ERRCODE = '22023';
    END IF;

    v_final_cat := v_cur_cat;
    v_final_text := v_cur_text;
    v_edited := false;
    v_rep := NULL;

    IF v_decision = 'reject' THEN
      IF (v_d ->> 'text') IS NOT NULL OR (v_d ->> 'category') IS NOT NULL
         OR ((v_d -> 'replaces') IS NOT NULL AND jsonb_typeof(v_d -> 'replaces') <> 'null')
      THEN
        RAISE EXCEPTION 'ratify_interview_round: only an accepted candidate may carry an edit or a replace target' USING ERRCODE = '22023';
      END IF;
    ELSE
      -- a re-selected category/kind, within THAT table's enum; expiry is recomputed from the FINAL value
      IF (v_d ->> 'category') IS NOT NULL THEN
        v_final_cat := v_d ->> 'category';
        IF NOT (
             (v_type = 'brand'    AND v_final_cat IN ('positioning', 'capability', 'pricing', 'competitor', 'other'))
          OR (v_type = 'audience' AND v_final_cat IN ('problem', 'objection', 'question', 'trigger', 'other'))
          OR (v_type = 'evidence' AND v_final_cat IN ('quote', 'case_study', 'usage_data', 'other'))
        ) THEN
          RAISE EXCEPTION 'ratify_interview_round: category "%" is not in the % enum', v_final_cat, v_type USING ERRCODE = '22023';
        END IF;
      END IF;
      -- an edit: brand/audience text only, 1..280; evidence stays VERBATIM
      IF (v_d ->> 'text') IS NOT NULL THEN
        IF v_type = 'evidence' THEN
          RAISE EXCEPTION 'ratify_interview_round: evidence records cannot be edited (their text is verbatim)' USING ERRCODE = '22023';
        END IF;
        v_final_text := v_d ->> 'text';
        IF btrim(v_final_text) = '' OR char_length(v_final_text) > 280 THEN
          RAISE EXCEPTION 'ratify_interview_round: edited text must be 1..280 characters and not blank' USING ERRCODE = '22023';
        END IF;
      END IF;
      v_edited := (v_final_text IS DISTINCT FROM v_cur_text) OR (v_final_cat IS DISTINCT FROM v_cur_cat);

      -- replace: an ACTIVE, source = 'interview' row of THE SAME BUSINESS, re-verified here in SQL [sec-MEDIUM-a]
      IF (v_d -> 'replaces') IS NOT NULL AND jsonb_typeof(v_d -> 'replaces') <> 'null' THEN
        v_rep := v_d -> 'replaces';
        IF jsonb_typeof(v_rep) <> 'object' OR (v_rep ->> 'type') IS NULL OR (v_rep ->> 'id') IS NULL
           OR (v_rep ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR (v_rep ->> 'type') NOT IN ('brand', 'audience', 'evidence')
        THEN
          RAISE EXCEPTION 'ratify_interview_round: replaces must carry a type and a uuid id' USING ERRCODE = '22023';
        END IF;
        v_rep_type := v_rep ->> 'type';
        v_rep_id := (v_rep ->> 'id')::uuid;
        v_rep_table := CASE v_rep_type WHEN 'brand' THEN 'brand_memory' WHEN 'audience' THEN 'audience_memory' ELSE 'evidence_memory' END;
        v_probe := NULL;
        EXECUTE format(
          'SELECT 1 FROM public.%I WHERE id = $1 AND business_id = $2 AND source = ''interview'' AND status = ''active'' AND deleted_at IS NULL',
          v_rep_table)
          INTO v_probe
          USING v_rep_id, v_business_id;
        IF v_probe IS NULL THEN
          RAISE EXCEPTION 'ratify_interview_round: replace target % is not an active interview record of this business', v_rep_id USING ERRCODE = '22023';
        END IF;
        v_key := v_rep_type || ':' || v_rep_id::text;
        IF v_key = ANY (v_rep_seen) THEN
          RAISE EXCEPTION 'ratify_interview_round: replace target % is used more than once', v_rep_id USING ERRCODE = '22023';
        END IF;
        v_rep_seen := v_rep_seen || v_key;
      END IF;
    END IF;

    -- expiry from the FINAL category/kind, anchored on the ANSWER's answered_at (ADR 0029 2.6) — never now()
    v_expires := CASE v_type
      WHEN 'brand' THEN CASE v_final_cat
        WHEN 'pricing' THEN v_answered_at + interval '180 days'
        WHEN 'competitor' THEN v_answered_at + interval '365 days'
        WHEN 'other' THEN v_answered_at + interval '365 days'
        ELSE v_answered_at + interval '540 days'
      END
      WHEN 'audience' THEN v_answered_at + interval '365 days'
      ELSE CASE WHEN v_final_cat = 'usage_data' THEN v_answered_at + interval '365 days' ELSE NULL END
    END;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'type', v_type, 'id', v_id, 'decision', v_decision, 'category', v_final_cat, 'text', v_final_text,
      'edited', v_edited, 'expires', v_expires, 'repType', v_rep_type, 'repId', CASE WHEN v_rep IS NULL THEN NULL ELSE v_rep_id END));
    v_rep_type := NULL; v_rep_id := NULL;
  END LOOP;

  -- (5) Per-item conditional UPDATEs. Every UPDATE is guarded on the row still being an interview candidate (or, for a replace
  --     target, still active) and must touch exactly one row: a miss raises and rolls the whole call back.
  FOR v_step IN SELECT value FROM jsonb_array_elements(v_plan) LOOP
    v_type := v_step ->> 'type';
    v_id := (v_step ->> 'id')::uuid;
    v_table := CASE v_type WHEN 'brand' THEN 'brand_memory' WHEN 'audience' THEN 'audience_memory' ELSE 'evidence_memory' END;
    v_col := CASE v_type WHEN 'brand' THEN 'category' ELSE 'kind' END;
    v_textcol := CASE v_type WHEN 'evidence' THEN 'content' ELSE 'statement' END;

    IF (v_step ->> 'decision') = 'accept' THEN
      v_expires := (v_step ->> 'expires')::timestamptz;
      BEGIN
        EXECUTE format(
          'UPDATE public.%I SET status = ''active'', %I = $3, %I = $4, interview_edited = interview_edited OR $5, expires_at = $6 '
          || 'WHERE id = $1 AND business_id = $2 AND status = ''candidate'' AND source = ''interview''',
          v_table, v_col, v_textcol)
          USING v_id, v_business_id, v_step ->> 'category', v_step ->> 'text', (v_step ->> 'edited')::boolean, v_expires;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'ratify_interview_round: the edit of % collides with another candidate of the same answer and category', v_id
          USING ERRCODE = '22023';
      END;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'ratify_interview_round: candidate % could not be activated', v_id USING ERRCODE = '22023';
      END IF;
      v_accepted := v_accepted + 1;
      IF (v_step ->> 'edited')::boolean THEN v_edited_n := v_edited_n + 1; END IF;

      IF (v_step ->> 'repId') IS NOT NULL THEN
        v_rep_table := CASE v_step ->> 'repType' WHEN 'brand' THEN 'brand_memory' WHEN 'audience' THEN 'audience_memory' ELSE 'evidence_memory' END;
        EXECUTE format(
          'UPDATE public.%I SET status = ''retired'' WHERE id = $1 AND business_id = $2 AND source = ''interview'' AND status = ''active''',
          v_rep_table)
          USING (v_step ->> 'repId')::uuid, v_business_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RAISE EXCEPTION 'ratify_interview_round: replace target % could not be retired', v_step ->> 'repId' USING ERRCODE = '22023';
        END IF;
        v_replaced := v_replaced + 1;
      END IF;
    ELSE
      EXECUTE format(
        'UPDATE public.%I SET status = ''retired'', interview_rejected = true WHERE id = $1 AND business_id = $2 AND status = ''candidate'' AND source = ''interview''',
        v_table)
        USING v_id, v_business_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'ratify_interview_round: candidate % could not be retired', v_id USING ERRCODE = '22023';
      END IF;
      v_rejected := v_rejected + 1;
    END IF;
  END LOOP;

  -- (6) Flip to 'ratified', guarded on 'awaiting_ratification'. ratified_by is the verified approver; terminal_at starts the
  --     30-day redaction clock (6.3).
  UPDATE public.founder_interview_rounds
     SET status = 'ratified',
         ratified_at = now(),
         ratified_by = p_user_id,
         terminal_at = now(),
         accepted = v_accepted,
         rejected = v_rejected,
         edited = v_edited_n,
         replaced = v_replaced
   WHERE id = p_round_id
     AND status = 'awaiting_ratification';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ratify_interview_round: round % left awaiting_ratification during the call', p_round_id USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('outcome', 'ratified', 'accepted', v_accepted, 'rejected', v_rejected, 'edited', v_edited_n, 'replaced', v_replaced);
END;
$$;

REVOKE ALL ON FUNCTION public.ratify_interview_round(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ratify_interview_round(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ratify_interview_round(uuid, uuid, jsonb) TO service_role;

-- ─── 6. sweep_interview_data — step 4b: delete REJECTED candidates of RATIFIED rounds (A-6(a)) ─────────────────────────────
--
-- Founder ruling A-6(a): a rejected candidate is an "unratified candidate" under A-3, and is deleted at its round's
-- answer-redaction deadline (terminal_at + 30 days) — NOT 30 days after that, because a rejected evidence row's content is a
-- verbatim excerpt of the answer, and keeping it past the answer's redaction would defeat the redaction. Step 3 runs first, so a
-- row is redacted and then deleted in the same run.
--
-- WHAT 4b TAKES: source = 'interview' AND status = 'retired' AND interview_rejected (set only by ratify's REJECT) AND the round is
-- RATIFIED. WHAT IT NEVER TAKES: an ACTIVE row (its span is NULLed by step 3, its text is never touched) and a row a later round
-- REPLACED (retired, interview_rejected = false). Rows rejected before this migration carry no marker and are not deleted: the
-- feature had shipped to no customer (docs/current-phase.md), so there are none in production. The return object is UNCHANGED
-- (six counters): 4b's deletions are counted in candidatesDeleted.
--
-- The rest of the body is the 20260925140000 function, restated in full.

CREATE OR REPLACE FUNCTION public.sweep_interview_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit        constant int := 500;
  v_failed       int := 0;
  v_expired      int := 0;
  v_expired_ids  uuid[];
  v_retired      int := 0;
  v_rows         int;
  v_answers      int := 0;
  v_spans        int := 0;
  v_deleted      int := 0;
BEGIN
  -- (1) Stuck rounds -> failed: an extracting / extraction_failed round whose last claim is older than 7 days, AND (db-review
  --     MAJOR-1) a SUBMITTED round older than 7 days. A submitted round is one whose after() extraction never ran (it is
  --     best-effort, ADR 5.3): it is non-terminal, so it would otherwise block the business's one-open-round slot forever and
  --     never reach a terminal_at, so its answers would never be redacted (6.3). An existing error_code (the last failure's)
  --     is kept.
  WITH stuck AS (
    SELECT id FROM public.founder_interview_rounds
     WHERE (status IN ('extracting', 'extraction_failed') AND claimed_at < now() - interval '7 days')
        OR (status = 'submitted' AND submitted_at < now() - interval '7 days')
     ORDER BY COALESCE(claimed_at, submitted_at)
     LIMIT v_limit
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.founder_interview_rounds r
     SET status = 'failed',
         terminal_at = now(),
         error_code = COALESCE(r.error_code, 'stuck')
    FROM stuck
   WHERE r.id = stuck.id
     AND r.status IN ('extracting', 'extraction_failed', 'submitted');
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  -- (2) Expiry: open 30 days after created_at, awaiting_ratification 30 days after extracted_at.
  WITH due AS (
    SELECT id FROM public.founder_interview_rounds
     WHERE (status = 'open' AND created_at < now() - interval '30 days')
        OR (status = 'awaiting_ratification' AND extracted_at < now() - interval '30 days')
     ORDER BY created_at
     LIMIT v_limit
       FOR UPDATE SKIP LOCKED
  ), expired AS (
    UPDATE public.founder_interview_rounds r
       SET status = 'expired', terminal_at = now()
      FROM due
     WHERE r.id = due.id
       AND r.status IN ('open', 'awaiting_ratification')
    RETURNING r.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_expired_ids FROM expired;
  v_expired := COALESCE(cardinality(v_expired_ids), 0);

  -- ...and their still-CANDIDATE rows are retired (bounded by the expired rounds above, at most 24 rows each).
  IF v_expired > 0 THEN
    UPDATE public.brand_memory m SET status = 'retired'
      FROM public.founder_interview_answers a
     WHERE a.id = m.interview_answer_id AND a.round_id = ANY (v_expired_ids) AND m.status = 'candidate' AND m.source = 'interview';
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_retired := v_retired + v_rows;
    UPDATE public.audience_memory m SET status = 'retired'
      FROM public.founder_interview_answers a
     WHERE a.id = m.interview_answer_id AND a.round_id = ANY (v_expired_ids) AND m.status = 'candidate' AND m.source = 'interview';
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_retired := v_retired + v_rows;
    UPDATE public.evidence_memory m SET status = 'retired'
      FROM public.founder_interview_answers a
     WHERE a.id = m.interview_answer_id AND a.round_id = ANY (v_expired_ids) AND m.status = 'candidate' AND m.source = 'interview';
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_retired := v_retired + v_rows;
  END IF;

  -- (3) Redaction, 30 days after the round's terminal_at: the answer text, then the grounding span of every interview row.
  UPDATE public.founder_interview_answers
     SET answer_text = NULL, redacted_at = now()
   WHERE id IN (
     SELECT a.id FROM public.founder_interview_answers a
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE r.terminal_at < now() - interval '30 days'
        AND a.answer_text IS NOT NULL
        AND a.redacted_at IS NULL
      ORDER BY a.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_answers = ROW_COUNT;

  UPDATE public.brand_memory
     SET interview_span = NULL, interview_span_redacted_at = now()
   WHERE id IN (
     SELECT m.id FROM public.brand_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE r.terminal_at < now() - interval '30 days'
        AND m.interview_span IS NOT NULL
        AND m.interview_span_redacted_at IS NULL
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_spans := v_spans + v_rows;
  UPDATE public.audience_memory
     SET interview_span = NULL, interview_span_redacted_at = now()
   WHERE id IN (
     SELECT m.id FROM public.audience_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE r.terminal_at < now() - interval '30 days'
        AND m.interview_span IS NOT NULL
        AND m.interview_span_redacted_at IS NULL
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_spans := v_spans + v_rows;
  UPDATE public.evidence_memory
     SET interview_span = NULL, interview_span_redacted_at = now()
   WHERE id IN (
     SELECT m.id FROM public.evidence_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE r.terminal_at < now() - interval '30 days'
        AND m.interview_span IS NOT NULL
        AND m.interview_span_redacted_at IS NULL
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_spans := v_spans + v_rows;

  -- (4) Delete the RETIRED candidates of EXPIRED rounds 30 days after their retirement (= the round's terminal_at).
  DELETE FROM public.brand_memory
   WHERE id IN (
     SELECT m.id FROM public.brand_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE m.source = 'interview' AND m.status = 'retired'
        AND r.status = 'expired' AND r.terminal_at < now() - interval '30 days'
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_deleted := v_deleted + v_rows;
  DELETE FROM public.audience_memory
   WHERE id IN (
     SELECT m.id FROM public.audience_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE m.source = 'interview' AND m.status = 'retired'
        AND r.status = 'expired' AND r.terminal_at < now() - interval '30 days'
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_deleted := v_deleted + v_rows;
  DELETE FROM public.evidence_memory
   WHERE id IN (
     SELECT m.id FROM public.evidence_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE m.source = 'interview' AND m.status = 'retired'
        AND r.status = 'expired' AND r.terminal_at < now() - interval '30 days'
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_deleted := v_deleted + v_rows;


  -- (4b) A-6(a): delete the REJECTED candidates of RATIFIED rounds at terminal_at + 30 days (= the answer-redaction deadline).
  DELETE FROM public.brand_memory
   WHERE id IN (
     SELECT m.id FROM public.brand_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE m.source = 'interview' AND m.status = 'retired' AND m.interview_rejected
        AND r.status = 'ratified' AND r.terminal_at < now() - interval '30 days'
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_deleted := v_deleted + v_rows;
  DELETE FROM public.audience_memory
   WHERE id IN (
     SELECT m.id FROM public.audience_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE m.source = 'interview' AND m.status = 'retired' AND m.interview_rejected
        AND r.status = 'ratified' AND r.terminal_at < now() - interval '30 days'
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_deleted := v_deleted + v_rows;
  DELETE FROM public.evidence_memory
   WHERE id IN (
     SELECT m.id FROM public.evidence_memory m
       JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id
       JOIN public.founder_interview_rounds r ON r.id = a.round_id
      WHERE m.source = 'interview' AND m.status = 'retired' AND m.interview_rejected
        AND r.status = 'ratified' AND r.terminal_at < now() - interval '30 days'
      ORDER BY m.created_at
      LIMIT v_limit
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_deleted := v_deleted + v_rows;

  RETURN jsonb_build_object(
    'failedStuck', v_failed,
    'expired', v_expired,
    'candidatesRetired', v_retired,
    'answersRedacted', v_answers,
    'spansRedacted', v_spans,
    'candidatesDeleted', v_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_interview_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sweep_interview_data() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_interview_data() TO service_role;

-- ─── 7. create_interview_round — A-7(a): a failed round does not count, but two creations per 30 days is the ceiling ───────
--
-- Founder ruling A-7(a). Step 3 (the 30-day rule) changes; steps 1, 2, 4 and 5 are the 20260925150000 body, restated in full.
-- A round that is NOT failed and was created in the last 30 days still blocks (too_soon). A failed one does not, but a second
-- creation is the last: if TWO rounds of ANY status were created in the last 30 days, a third is refused (too_soon). So a
-- deterministic self-lockout (a lost extraction, an injected answer) is recoverable once, and the spend bound A-4 relies on
-- stays structural: at most 2 x 30 cents of extraction per business per 30 days, with no fifth budget purpose.

CREATE OR REPLACE FUNCTION public.create_interview_round(
  p_user_id     uuid,
  p_business_id uuid,
  p_questions   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count    int;
  v_distinct int;
  v_bank     int;
  v_round_id uuid;
BEGIN
  -- 1. Membership FIRST, before anything else is read or written.
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND role IN ('editor', 'approver')
       AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND b.deleted_at IS NULL)  -- [db-review NIT-8]
  ) THEN
    RAISE EXCEPTION 'create_interview_round: % is not an author-level member of business %', p_user_id, p_business_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. The shape: an array of 5..8 well-formed elements with distinct keys and ONE bank version.
  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'create_interview_round: p_questions must be a jsonb array' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_questions);
  IF v_count < 5 OR v_count > 8 THEN
    RAISE EXCEPTION 'create_interview_round: p_questions must hold 5..8 questions, got %', v_count USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_questions) q
     WHERE jsonb_typeof(q) <> 'object'
        OR q->>'questionKey' IS NULL OR btrim(q->>'questionKey') = ''
        OR q->>'slotType' IS NULL
        OR q->>'slotCategory' IS NULL
        OR q->>'bankVersion' IS NULL OR (q->>'bankVersion') !~ '^[0-9]{1,9}$'
  ) THEN
    RAISE EXCEPTION 'create_interview_round: every question needs questionKey, slotType, slotCategory and an integer bankVersion'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT q->>'questionKey') FROM jsonb_array_elements(p_questions) q) <> v_count THEN
    RAISE EXCEPTION 'create_interview_round: questionKey values must be distinct' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT (q->>'bankVersion')::int), min((q->>'bankVersion')::int)
    INTO v_distinct, v_bank
    FROM jsonb_array_elements(p_questions) q;
  IF v_distinct <> 1 THEN
    RAISE EXCEPTION 'create_interview_round: every question must carry the same bankVersion' USING ERRCODE = '22023';
  END IF;

  -- 3. The 30-day rule, re-checked here (A-7(a)): a NON-failed round created in the last 30 days blocks, and so do two rounds of
  --    ANY status created in the last 30 days (a failed round does not count toward the first, but it does toward the second).
  --    [db-review MINOR-1] Two concurrent creations for one business are SERIALISED by a transaction-scoped advisory lock keyed on
  --    the business, so both cannot read "one round in the window" and then both insert (the one-open-round unique index alone
  --    stops that only while the first round is still non-terminal).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.founder_interview_rounds
     WHERE business_id = p_business_id
       AND status <> 'failed'
       AND created_at > now() - interval '30 days'
  ) OR (
    SELECT count(*) FROM public.founder_interview_rounds
     WHERE business_id = p_business_id
       AND created_at > now() - interval '30 days'
  ) >= 2
  THEN
    RETURN jsonb_build_object('outcome', 'too_soon');
  END IF;

  -- 4. The round. A concurrent create (or an older round still non-terminal) trips the one-open-round
  --    partial UNIQUE (M2.3); that is a typed outcome, not an error.
  BEGIN
    INSERT INTO public.founder_interview_rounds (business_id, status, question_count, bank_version, created_by)
    VALUES (p_business_id, 'open', v_count, v_bank, p_user_id)
    RETURNING id INTO v_round_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'round_open');
  END;

  -- 5. One 'pending' answer row per question, positions 1..n in array order.
  INSERT INTO public.founder_interview_answers
    (business_id, round_id, position, question_key, bank_version, slot_type, slot_category)
  SELECT p_business_id, v_round_id, t.ord::int, t.q->>'questionKey', (t.q->>'bankVersion')::int,
         t.q->>'slotType', t.q->>'slotCategory'
    FROM jsonb_array_elements(p_questions) WITH ORDINALITY AS t(q, ord);

  RETURN jsonb_build_object('outcome', 'ok', 'roundId', v_round_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_interview_round(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_interview_round(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_interview_round(uuid, uuid, jsonb) TO service_role;
