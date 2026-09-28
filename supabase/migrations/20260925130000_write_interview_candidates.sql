-- ADR 0029 (Session 35, M2.5) — THE WRITER: write_interview_candidates. The ONLY SQL path that produces
-- source = 'interview' rows in brand_memory, evidence_memory and audience_memory (ADR 0029 2.3, 2.6).
--
--   write_interview_candidates(p_round_id uuid, p_items jsonb)     -> jsonb
--
-- SIGNATURE IS EXACTLY (uuid, jsonb). There is NO p_business_id [sec-HIGH-a]: the business is derived from the
-- round row this function locks. There is NO governance parameter: every governance column below is FIXED IN SQL
-- and no key of p_items can reach it — the function never READS a key named confidence, status, source,
-- sensitivity, public_use_permission, scope, scope_ref, expires_at, observation_count, last_confirmed_at or
-- business_id, so a payload that smuggles one is ignored, not honoured (the Tier-1 test proves it).
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp; REVOKE ALL FROM PUBLIC; REVOKE EXECUTE
-- FROM anon, authenticated; GRANT EXECUTE TO service_role ONLY (the 20260913140000:179-181 shape).
--
-- p_items IS A JSON OBJECT, not the bare array ADR 2.3 describes, because the writer must also record the round's
-- yield counters (ADR 10.5) for items that were dropped BEFORE this call (ungrounded, or a performance claim —
-- ADR 4.3, 4.7): only the TypeScript extraction knows them, and the signature is fixed at (uuid, jsonb).
--
--   { "items": [ { answerId, type, category, text, span, storedText, storedSpan } ... <= 24 ],
--     "counters": { "proposed": n, "droppedUngrounded": n, "droppedPerformanceClaim": n } }
--
-- THE RAW-vs-STORED INVARIANT (ADR 2.3, binding). `text` and `span` are the RAW values: they are what the SQL
-- CONTAINMENT check reads (the raw span must be an exact substring of the RAW stored answer). `storedText` and
-- `storedSpan` are the SAME strings after neutralizeWithSentinels() (lib/db/memory-interview.ts applies it at this
-- single write choke point): they are what is STORED. Neutralising alters text (NFKC, stripped format characters, a
-- zero-width space, "[/DATA]" rewritten), so checking containment on the neutralised span would fail every span that
-- contains such a character, and storing the raw text would defeat the write-time guard.
--
-- ORDER, in ONE transaction:
--   (a) lock the round FOR UPDATE; return WITHOUT writing unless status = 'extracting';
--   (b) validate EVERYTHING before writing anything (a raise rolls the whole call back);
--   (c) insert candidates with the governance fixed here;
--   (d) recompute the yield counters and flip the round — ONE conditional UPDATE guarded on 'extracting'.
--
-- RETRY-SAFE. The inserts are ON CONFLICT DO NOTHING against the M2.3 partial UNIQUE indexes, and step (d) counts
-- the candidate rows that EXIST for the round (never "rows this call inserted"), so a retry that inserts nothing
-- does not flip a round that already has candidates to 'no_records'. A second call after the flip returns
-- not_extracting and writes nothing. Counters are RECOMPUTED, never incremented.
--
-- Outcomes: written { status, inserted, candidates {brand,audience,evidence} } | not_found | not_extracting { status }.
-- A validation failure RAISES 22023 (the TypeScript layer drops and counts ungrounded items first, so a violation
-- here is a defect or a tampered call, not a normal outcome).

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
       OR (v_item ->> 'answerId') IS NULL OR (v_item ->> 'answerId') !~ '^[0-9a-fA-F-]{36}$'
       OR (v_item ->> 'type') IS NULL OR (v_item ->> 'category') IS NULL
       OR (v_item ->> 'text') IS NULL OR (v_item ->> 'span') IS NULL
       OR (v_item ->> 'storedText') IS NULL OR (v_item ->> 'storedSpan') IS NULL
    THEN
      RAISE EXCEPTION 'write_interview_candidates: every item needs answerId, type, category, text, span, storedText and storedSpan'
        USING ERRCODE = '22023';
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
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_type := v_item ->> 'type';
    v_cat := v_item ->> 'category';
    v_stored_text := v_item ->> 'storedText';
    v_stored_span := v_item ->> 'storedSpan';
    v_answer_id := (v_item ->> 'answerId')::uuid;
    SELECT answered_at INTO v_answered_at FROM public.founder_interview_answers WHERE id = v_answer_id;

    IF v_type = 'brand' THEN
      v_expires := CASE v_cat
        WHEN 'pricing' THEN v_answered_at + interval '180 days'
        WHEN 'competitor' THEN v_answered_at + interval '365 days'
        WHEN 'other' THEN v_answered_at + interval '365 days'
        ELSE v_answered_at + interval '540 days'          -- positioning, capability
      END;
      INSERT INTO public.brand_memory
        (business_id, source, confidence, observation_count, status, sensitivity, public_use_permission, scope, scope_ref,
         last_confirmed_at, expires_at, category, statement, interview_answer_id, interview_span, interview_extracted_text)
      VALUES
        (v_business_id, 'interview', 0.6, 1, 'candidate', 'internal', false, 'brand', NULL,
         v_answered_at, v_expires, v_cat, v_stored_text, v_answer_id, v_stored_span, v_stored_text)
      ON CONFLICT (interview_answer_id, category, md5(lower(statement))) WHERE source = 'interview' DO NOTHING;
    ELSIF v_type = 'audience' THEN
      v_expires := v_answered_at + interval '365 days';   -- every audience kind
      INSERT INTO public.audience_memory
        (business_id, source, confidence, observation_count, status, sensitivity, public_use_permission, scope, scope_ref,
         last_confirmed_at, expires_at, kind, statement, interview_answer_id, interview_span, interview_extracted_text)
      VALUES
        (v_business_id, 'interview', 0.5, 1, 'candidate', 'internal', false, 'brand', NULL,
         v_answered_at, v_expires, v_cat, v_stored_text, v_answer_id, v_stored_span, v_stored_text)
      ON CONFLICT (interview_answer_id, kind, md5(lower(statement))) WHERE source = 'interview' DO NOTHING;
    ELSE
      v_expires := CASE WHEN v_cat = 'usage_data' THEN v_answered_at + interval '365 days' ELSE NULL END;  -- quote, case_study, other: NULL
      INSERT INTO public.evidence_memory
        (business_id, source, confidence, observation_count, status, sensitivity, public_use_permission, scope, scope_ref,
         last_confirmed_at, expires_at, kind, content, interview_answer_id, interview_span, interview_extracted_text)
      VALUES
        (v_business_id, 'interview', 0.4, 1, 'candidate', 'internal', false, 'brand', NULL,
         v_answered_at, v_expires, v_cat, v_stored_text, v_answer_id, v_stored_span, v_stored_text)
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
