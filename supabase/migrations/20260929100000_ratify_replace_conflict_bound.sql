-- ADR 0029 (Session 35-D, post-D11 follow-up) — RATIFY REPLACE BOUND TO THE CANDIDATE'S OWN CONFLICT IDS.
--
-- D5's security-reviewer (docs/reviews/session-35-reviewer.md, D5 appendix, MINOR-1; ADR 0029 §C.3/§C.9) found that
-- ratify_interview_round's `replaces` verification checked the target was an ACTIVE, source = 'interview' row of the
-- SAME BUSINESS — but not that the target was one of the ACCEPTED candidate's own persisted `interview_conflict_ids`,
-- nor that it matched the candidate's type. An approver or admin who hand-crafts a Server Action call (bypassing the
-- UI, which only ever offers a target drawn from `item.conflicts`) could therefore replace ANY active interview
-- record of their own business with an unrelated accepted candidate, including one of a different type. The caller
-- was already an approver/admin of that business and the target was already same-business/active/interview-sourced,
-- so this was scoped, not a tenant-isolation break — but it let a human decision silently exceed what the model's own
-- conflict detection (ADR §4.5) ever proposed.
--
-- FIX, the smallest that closes it: the candidate lookup at the top of the decision loop now ALSO reads
-- `interview_conflict_ids` (already persisted per candidate since D4), and the replace-target validation additionally
-- requires `v_rep_id = ANY (v_cur_conflict_ids)` AND `v_rep_type = v_type` (same type as the candidate — matching
-- InterviewPanel.tsx's own resolution, which looks up a conflict id ONLY among the targets of the candidate's OWN
-- type; cross-type replace was never offered and is not intended here — a loser, not a silent restriction). A
-- pre-D4 candidate (none exist in production; the feature has shipped to no customer) has `interview_conflict_ids
-- IS NULL`, so `ANY (NULL)` is never true and such a candidate simply cannot carry a Replace — the same outcome the
-- UI already produces for it (no conflicts to resolve, so no Replace button).
--
-- Everything else in the function body is IDENTICAL to the current definition (20260928100000:463-750); restated in
-- full because CREATE OR REPLACE replaces the whole body. No other RPC in this migration.

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
  v_cur_conflict_ids uuid[];
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

    -- the id must be an interview CANDIDATE of THIS round, and of this business. [post-D11 follow-up] Also reads
    -- interview_conflict_ids, so a REPLACE below can be bound to what THIS candidate's own conflicts actually are.
    v_cur_cat := NULL; v_cur_text := NULL; v_cur_conflict_ids := NULL; v_answered_at := NULL;
    EXECUTE format(
      'SELECT m.%I, m.%I, m.interview_conflict_ids, a.answered_at FROM public.%I m JOIN public.founder_interview_answers a ON a.id = m.interview_answer_id '
      || 'WHERE m.id = $1 AND a.round_id = $2 AND m.business_id = $3 AND m.source = ''interview'' AND m.status = ''candidate'' AND m.deleted_at IS NULL',
      v_col, v_textcol, v_table)
      INTO v_cur_cat, v_cur_text, v_cur_conflict_ids, v_answered_at
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

      -- replace: an ACTIVE, source = 'interview' row of THE SAME BUSINESS, re-verified here in SQL [sec-MEDIUM-a] —
      -- [post-D11 follow-up] AND one of THIS candidate's own persisted interview_conflict_ids, AND the same type. A
      -- candidate with no conflict ids (NULL, or an id not among them) cannot replace anything: ANY (NULL) is never
      -- true, and a target of a different type is rejected before the active/business/source probe even runs.
      IF (v_d -> 'replaces') IS NOT NULL AND jsonb_typeof(v_d -> 'replaces') <> 'null' THEN
        v_rep := v_d -> 'replaces';
        IF jsonb_typeof(v_rep) <> 'object' OR (v_rep ->> 'type') IS NULL OR (v_rep ->> 'id') IS NULL
           OR (v_rep ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' OR (v_rep ->> 'type') NOT IN ('brand', 'audience', 'evidence')
        THEN
          RAISE EXCEPTION 'ratify_interview_round: replaces must carry a type and a uuid id' USING ERRCODE = '22023';
        END IF;
        v_rep_type := v_rep ->> 'type';
        v_rep_id := (v_rep ->> 'id')::uuid;
        IF v_rep_type <> v_type THEN
          RAISE EXCEPTION 'ratify_interview_round: replace target % is not the same type as the candidate replacing it', v_rep_id USING ERRCODE = '22023';
        END IF;
        IF v_cur_conflict_ids IS NULL OR NOT (v_rep_id = ANY (v_cur_conflict_ids)) THEN
          RAISE EXCEPTION 'ratify_interview_round: replace target % is not one of this candidate''s own conflict ids', v_rep_id USING ERRCODE = '22023';
        END IF;
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
