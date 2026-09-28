-- ADR 0029 (Session 35, M2.6) — FIXES from the database-reviewer's read of the five Session 35 migrations. Each is a FORWARD
-- migration over an already-COMMITTED migration (M2.3-M2.5 are never edited); the findings against the still-uncommitted M2.6
-- migration were fixed in that file directly. Finding -> fix:
--
--   MINOR-3  reconcile_interview_spend was not bound to an attempt: attempt 1's late failure could flip attempt 2's live round
--            and take back 10 cents attempt 2 had reserved. It now takes p_attempt (the attempt claim_interview_extraction
--            returned) and acts only while extraction_attempts = p_attempt. A stale reconcile returns not_extracting and
--            changes nothing. p_attempt is optional so an existing four-argument call still resolves; the lib/db wrapper makes
--            it REQUIRED.
--   MINOR-4  The reconcile-before-writer ordering is now a documented, TESTED contract (the writer moves the round out of
--            'extracting', after which reconcile is not_extracting), and a clamped spend is REPORTED (clamped: true) instead of
--            silently under-recorded.
--   MINOR-5  save / skip vs submit time-of-check race: save and skip take the round FOR SHARE and submit takes it FOR UPDATE, each
--            in its own statement before the guarded UPDATE, so they serialise and the UPDATE sees the committed status.
--   MINOR-6  The writer's UUID pattern admitted 36-character non-UUIDs that then failed on the cast with 22P02: it is now the
--            strict 8-4-4-4-12 pattern (ratify's, still uncommitted, was fixed in its own file).
--   NIT-8    create_interview_round refuses a soft-deleted business (snooze already did); answers can no longer carry a slot
--            category that belongs to another slot type (slot_type / slot_category are now checked TOGETHER).
--   NIT-9    Indexes for the three ON DELETE SET NULL user FKs and for the sweep's expiry predicates.
--
-- Not changed here, with the reason: MAJOR-1 (submitted rounds never swept) and MINOR-7 are fixed in the M2.6 migration and its
-- wrapper; MINOR-2 (retention of REJECTED candidates) needs a founder ruling — ADR 0029 6.3 is silent — and is reported, not
-- decided; NIT-8's not_found-before-membership order is ADR-mandated for ratify and the ids are unguessable uuids; NIT-10 (a
-- refused claim is not terminal until the 7-day sweep) is what ADR 5.2 specifies.

-- ─── 1. reconcile_interview_spend — bound to an attempt (MINOR-3), clamp reported (MINOR-4) ──────────────────────────────
--
-- The signature changes (a fifth, optional parameter), so the old function is DROPPED first: leaving both would make a
-- four-argument call ambiguous.

DROP FUNCTION public.reconcile_interview_spend(uuid, integer, text, text);

CREATE FUNCTION public.reconcile_interview_spend(
  p_round_id     uuid,
  p_actual_cents integer,
  p_outcome      text,
  p_error_code   text DEFAULT NULL,
  p_attempt      integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   text;
  v_spend    int;
  v_ceiling  int;
  v_before   int;
  v_raw      int;
  v_clamped  boolean;
BEGIN
  IF p_actual_cents IS NULL OR p_actual_cents < 0 THEN
    RAISE EXCEPTION 'reconcile_interview_spend: p_actual_cents must be a non-negative integer' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'reconcile_interview_spend: p_outcome must be succeeded or failed' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'failed' AND (p_error_code IS NULL OR btrim(p_error_code) = '') THEN
    RAISE EXCEPTION 'reconcile_interview_spend: a failed outcome needs an error code' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'succeeded' AND p_error_code IS NOT NULL THEN
    RAISE EXCEPTION 'reconcile_interview_spend: a succeeded outcome carries no error code' USING ERRCODE = '22023';
  END IF;

  -- Lock the round and read its spend, so the clamp below can be REPORTED.
  SELECT spend_cents, ceiling_cents INTO v_before, v_ceiling
    FROM public.founder_interview_rounds
   WHERE id = p_round_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_extracting');
  END IF;
  v_raw := GREATEST(0, v_before - 10 + p_actual_cents);
  v_clamped := v_raw > v_ceiling;

  -- Acts ONLY while the round is 'extracting' AND (when the caller names its attempt) it is still THAT attempt: a late
  -- reconcile from a superseded attempt matches nothing. ORDER CONTRACT: the orchestrator reconciles a SUCCESS before it calls
  -- write_interview_candidates, because the writer moves the round out of 'extracting'.
  UPDATE public.founder_interview_rounds
     SET spend_cents = LEAST(ceiling_cents, v_raw),
         status = CASE
                    WHEN p_outcome = 'failed' AND extraction_attempts >= 3 THEN 'failed'
                    WHEN p_outcome = 'failed' THEN 'extraction_failed'
                    ELSE status
                  END,
         error_code = CASE WHEN p_outcome = 'failed' THEN p_error_code ELSE NULL END,
         terminal_at = CASE WHEN p_outcome = 'failed' AND extraction_attempts >= 3 THEN now() ELSE terminal_at END
   WHERE id = p_round_id
     AND status = 'extracting'
     AND (p_attempt IS NULL OR extraction_attempts = p_attempt)
  RETURNING status, spend_cents INTO v_status, v_spend;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_extracting');
  END IF;
  RETURN jsonb_build_object('outcome', 'reconciled', 'status', v_status, 'spendCents', v_spend, 'clamped', v_clamped);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_interview_spend(uuid, integer, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_interview_spend(uuid, integer, text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_interview_spend(uuid, integer, text, text, integer) TO service_role;

-- ─── 2. save / skip / submit — serialise with each other (MINOR-5) ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_interview_answer(
  p_user_id   uuid,
  p_answer_id uuid,
  p_text      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_round_id    uuid;
  v_updated     uuid;
BEGIN
  SELECT business_id, round_id INTO v_business_id, v_round_id FROM public.founder_interview_answers WHERE id = p_answer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND role IN ('editor', 'approver')
  ) THEN
    RAISE EXCEPTION 'save_interview_answer: % is not an author-level member of the answer''s business', p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- 6.2 / 7.1: at most 2000 characters (Zod first, this second, the column CHECK third).
  IF p_text IS NULL OR btrim(p_text) = '' OR char_length(p_text) > 2000 THEN
    RAISE EXCEPTION 'save_interview_answer: text must be 1..2000 characters and not blank' USING ERRCODE = '22023';
  END IF;

  -- [db-review MINOR-5] Lock the round FOR SHARE in its OWN statement before the UPDATE. A concurrent submit takes the round
  -- FOR UPDATE, so the two now serialise, and the UPDATE below gets a FRESH snapshot that sees the round's committed status:
  -- a save that started before a submit committed can no longer land after it (READ COMMITTED evaluates r.status = 'open'
  -- against the statement snapshot, which a lock on a DIFFERENT row does not refresh).
  PERFORM 1 FROM public.founder_interview_rounds WHERE id = v_round_id FOR SHARE;

  UPDATE public.founder_interview_answers a
     SET answer_text = p_text,
         char_count  = char_length(p_text),
         status      = 'answered',
         answered_by = p_user_id,
         answered_at = now()
    FROM public.founder_interview_rounds r
   WHERE a.id = p_answer_id
     AND r.id = a.round_id
     AND r.status = 'open'
  RETURNING a.id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_open');
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'answerId', v_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_interview_answer(
  p_user_id   uuid,
  p_answer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_round_id    uuid;
  v_updated     uuid;
BEGIN
  SELECT business_id, round_id INTO v_business_id, v_round_id FROM public.founder_interview_answers WHERE id = p_answer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND role IN ('editor', 'approver')
  ) THEN
    RAISE EXCEPTION 'skip_interview_answer: % is not an author-level member of the answer''s business', p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- [db-review MINOR-5] see save_interview_answer: serialise with a concurrent submit.
  PERFORM 1 FROM public.founder_interview_rounds WHERE id = v_round_id FOR SHARE;

  UPDATE public.founder_interview_answers a
     SET status      = 'skipped',
         answer_text = NULL,
         char_count  = NULL,
         answered_by = p_user_id,
         answered_at = now()
    FROM public.founder_interview_rounds r
   WHERE a.id = p_answer_id
     AND r.id = a.round_id
     AND r.status = 'open'
     AND a.status IN ('pending', 'answered')
  RETURNING a.id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_skippable');
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'answerId', v_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_interview_round(
  p_user_id  uuid,
  p_round_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_updated     uuid;
  v_status      text;
BEGIN
  SELECT business_id INTO v_business_id FROM public.founder_interview_rounds WHERE id = p_round_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND role IN ('editor', 'approver')
  ) THEN
    RAISE EXCEPTION 'submit_interview_round: % is not an author-level member of the round''s business', p_user_id
      USING ERRCODE = '42501';
  END IF;

  -- [db-review MINOR-5] Lock the round FOR UPDATE in its OWN statement first, so the answered-count below is evaluated with a
  -- fresh snapshot that includes a save/skip which held the round FOR SHARE and has since committed (a submit can no longer
  -- count zero answered rows while a save is in flight).
  PERFORM 1 FROM public.founder_interview_rounds WHERE id = p_round_id FOR UPDATE;

  UPDATE public.founder_interview_rounds
     SET status = 'submitted', submitted_at = now()
   WHERE id = p_round_id
     AND status = 'open'
     AND EXISTS (
       SELECT 1 FROM public.founder_interview_answers
        WHERE round_id = p_round_id AND status = 'answered'
     )
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    SELECT status INTO v_status FROM public.founder_interview_rounds WHERE id = p_round_id;
    IF v_status = 'open' THEN
      RETURN jsonb_build_object('outcome', 'no_answers');
    END IF;
    RETURN jsonb_build_object('outcome', 'not_open');
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'roundId', v_updated);
END;
$$;

-- ─── 3. create_interview_round — refuses a soft-deleted business (NIT-8) ───────────────────────────────────────────────

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

  -- 3. The 30-day rule, re-checked here: no round created for the business in 30 days, ANY status.
  IF EXISTS (
    SELECT 1 FROM public.founder_interview_rounds
     WHERE business_id = p_business_id
       AND created_at > now() - interval '30 days'
  ) THEN
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

-- ─── 4. write_interview_candidates — the strict UUID pattern (MINOR-6) ─────────────────────────────────────────────────

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
       OR (v_item ->> 'answerId') IS NULL OR (v_item ->> 'answerId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
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

-- ─── 5. A slot's category must belong to its slot type (NIT-8) ─────────────────────────────────────────────────────────

ALTER TABLE public.founder_interview_answers
  ADD CONSTRAINT founder_interview_answers_slot_pair_check
    CHECK (
         (slot_type = 'brand'    AND slot_category IN ('positioning', 'capability', 'pricing', 'competitor'))
      OR (slot_type = 'audience' AND slot_category IN ('problem', 'objection', 'question', 'trigger'))
      OR (slot_type = 'evidence' AND slot_category IN ('quote', 'case_study', 'usage_data'))
    );

-- ─── 6. Indexes (NIT-9) ───────────────────────────────────────────────────────────────────────────────────────────────
-- The three auth.users FKs are ON DELETE SET NULL: without an index a user deletion scans both tables. Partial, because most
-- rows have a NULL or long-lived value and only a deletion probes them.

CREATE INDEX founder_interview_rounds_created_by_idx  ON public.founder_interview_rounds  (created_by)  WHERE created_by  IS NOT NULL;
CREATE INDEX founder_interview_rounds_ratified_by_idx ON public.founder_interview_rounds  (ratified_by) WHERE ratified_by IS NOT NULL;
CREATE INDEX founder_interview_answers_answered_by_idx ON public.founder_interview_answers (answered_by) WHERE answered_by IS NOT NULL;

-- The sweep's expiry predicates (step 2): open rounds by created_at, awaiting rounds by extracted_at.
CREATE INDEX founder_interview_rounds_open_expiry_idx     ON public.founder_interview_rounds (created_at)   WHERE status = 'open';
CREATE INDEX founder_interview_rounds_awaiting_expiry_idx ON public.founder_interview_rounds (extracted_at) WHERE status = 'awaiting_ratification';
-- ...and step 1's submitted rounds (MAJOR-1) by submitted_at.
CREATE INDEX founder_interview_rounds_submitted_stuck_idx ON public.founder_interview_rounds (submitted_at) WHERE status = 'submitted';
