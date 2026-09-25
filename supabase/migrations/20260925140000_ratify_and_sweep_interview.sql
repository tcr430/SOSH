-- ADR 0029 (Session 35, M2.6) — RATIFICATION and RETENTION.
--
--   ratify_interview_round(p_user_id uuid, p_round_id uuid, p_decisions jsonb)   8.5, 4.5, 2.6
--   sweep_interview_data()                                                        5.4, 6.3
--
-- Both: LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp; REVOKE ALL FROM PUBLIC; REVOKE EXECUTE FROM anon,
-- authenticated; GRANT EXECUTE TO service_role ONLY. Neither takes a business id [sec-HIGH-a]: ratify derives it from the round
-- it locks; the sweep takes no arguments at all.
--
-- ═══ ratify_interview_round ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The ONLY path that activates an interview candidate, PER ITEM, by a human. There is NO accept-all: every candidate of the
-- round must be decided exactly once or the call raises. The ORDER is the constraint [db-MAJOR-3] and is implemented
-- literally; each step is numbered where it happens:
--   (1) lock the round FOR UPDATE and derive business_id
--   (2) IF status <> 'awaiting_ratification' THEN RETURN — BEFORE any memory write (the ratify_backfill_run MAJOR-2 fix,
--       20260915120000:34-49). Two ratifiers at the same moment: the second blocks on the lock, then no-ops here.
--   (3) p_user_id must be an ACTIVE member of that business as approver OR is_admin — the ADR 0025 predicate, COPIED from
--       ratify_backfill_run (20260915120000:51-57), not a call into it. user_can cannot run under service role (auth.uid() is NULL).
--   (4) validate EVERYTHING (writing nothing)
--   (5) per-item conditional UPDATEs
--   (6) flip to 'ratified', guarded on 'awaiting_ratification'
--
-- p_decisions: a jsonb ARRAY, one element per candidate:
--   { "type": "brand"|"audience"|"evidence", "id": uuid, "decision": "accept"|"reject",
--     "text": <brand/audience only, 1..280>, "category": <re-selected category/kind>, "replaces": { "type", "id" } }
-- `text`, `category` and `replaces` belong to an ACCEPT only. Evidence text is NEVER editable (it is verbatim, 4.3); its KIND
-- may be re-selected. NO governance value has a field here: status, confidence, source, sensitivity, public_use_permission,
-- scope, expiry, observation_count and last_confirmed_at are fixed by this function or left untouched.
--
-- On ACCEPT: status -> 'active'; the edited text and/or re-selected category are applied; interview_edited becomes true when
-- either differs from what the model wrote; expires_at is RECOMPUTED from the FINAL category and the ANSWER's answered_at
-- (never now()) [sec-MEDIUM-b]; last_confirmed_at and confidence are UNTOUCHED (ADR 0025 5.3: a founder saying "keep this" is
-- not a re-observation); interview_extracted_text is immutable (the sibling trigger) and keeps the model's original.
-- On REJECT: status -> 'retired'. On REPLACE: the named target is retired in the same transaction, after re-verifying IN SQL
-- that it is an ACTIVE, source = 'interview' row of THE SAME BUSINESS [sec-MEDIUM-a]; a row with any other source is never
-- retired here (cross-writer resolution is Track L).
--
-- Outcomes: ratified { accepted, rejected, edited, replaced } | not_awaiting { status } | not_found.
-- Authorisation failure RAISES 42501; an invalid decision set RAISES 22023 and nothing is written.

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
        'UPDATE public.%I SET status = ''retired'' WHERE id = $1 AND business_id = $2 AND status = ''candidate'' AND source = ''interview''',
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

-- ═══ sweep_interview_data ═════════════════════════════════════════════════════════════════════════════════════════════════
-- The daily retention job (app/api/cron/interview-sweep, M2.9). Retention must not depend on the founder returning, so it
-- cannot be on-read (5.4). In THIS order:
--   (1) rounds in extracting / extraction_failed whose last claim is older than 7 days, and SUBMITTED rounds older than 7 days
--       (an extraction that never ran) -> 'failed' (terminal);
--   (2) 'open' rounds 30 days after created_at and 'awaiting_ratification' rounds 30 days after extracted_at -> 'expired'
--       (terminal), their still-'candidate' rows retired;
--   (3) answer_text -> NULL + redacted_at, AND interview_span -> NULL + interview_span_redacted_at, 30 days after the round's
--       terminal_at (ADR 0029 6.3, founder ruling A-3). The stub row survives (question_key, position, status, char_count,
--       answered_at). A ratified record's TEXT is never touched — only its provenance span;
--   (4) DELETE retired candidates of EXPIRED rounds 30 days after their retirement.
--
-- THE DELETION CLOCK. The memory tables carry no retirement timestamp, and updated_at is not one (step 3 itself bumps it). A
-- candidate of an EXPIRED round is retired at the moment the round expires, so the round's terminal_at IS its retirement
-- time — exact, and immune to any later update. Retention of a candidate is therefore terminal_at + 30 days, the same deadline
-- as its answer's redaction (step 3 runs first, so a row is redacted and then deleted in the same run).
--
-- WHAT IT NEVER DELETES. Only retired candidates of EXPIRED rounds. A RATIFIED round's retired rows are either a candidate the
-- founder REJECTED or a row a later round REPLACED, and the two cannot be told apart without a marker the schema does not
-- carry; neither is a "never-ratified" candidate, so neither is deleted (a ratified active row is never touched at all beyond
-- its span). ADR 0029 6.3 does not say how long a REJECTED candidate's text is retained; it stays retired, span redacted.
--
-- BOUNDED. Every step processes at most v_limit (500) rows per run, oldest first, so one tick can never become an unbounded
-- transaction; the daily cadence drains any backlog. Rounds are taken FOR UPDATE SKIP LOCKED, so the sweep never blocks a
-- ratification in flight (it takes that round on the next run). Idempotent: a second run changes nothing.
--
-- Returns counters for the route's one canonical log line.

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
