-- ADR 0029 (Session 35, M2.4) — the interview LIFECYCLE RPCs. Every write to founder_interview_rounds
-- and founder_interview_answers goes through one of these (ADR 0029 9.2: the tables have no authenticated
-- write grant and no write policy). The writer (write_interview_candidates), ratify and the sweep follow in
-- M2.5 / M2.6.
--
--   create_interview_round   5.1        the ONE RPC that takes a business id
--   save_interview_answer    9.2
--   skip_interview_answer    5.8
--   skip_interview_round     5.8
--   submit_interview_round   5.2
--   snooze_interview         5.8        takes a business id (the business row IS the row it writes)
--   claim_interview_extraction 7.2      THE RESERVATION
--   reconcile_interview_spend  7.2
--
-- EVERY function: LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp; REVOKE ALL FROM
-- PUBLIC; REVOKE EXECUTE FROM anon, authenticated; GRANT EXECUTE TO service_role ONLY (the
-- 20260913140000:179-181 shape). That grant IS part of the constraint: p_user_id is trusted ONLY because
-- no member can call these — auth.uid() is NULL under the service-role client and user_can cannot run
-- there, so the Server Action passes the user id it read from supabase.auth.getUser() (ADR 0029 2.5).
--
-- [sec-HIGH-a] NO RPC TRUSTS A BUSINESS ID. save / skip / submit derive business_id from the row they
-- look up (the answer, the round). create_interview_round and snooze_interview have no row yet and take
-- a business id, but VERIFY p_user_id's active editor-or-approver membership of it before anything else.
-- Author-level = role IN ('editor','approver') (the owner resolves as approver): ADR 0029 2.5.
-- NO function takes a governance value (source, status, confidence, sensitivity, public_use_permission,
-- scope, scope_ref, expires_at, observation_count, last_confirmed_at) — the tests read pg_proc to prove it.
--
-- Failure convention. An AUTHORISATION failure RAISES with SQLSTATE 42501 (a caller must never be able to
-- treat "not allowed" as a value). A malformed argument (a programmer error the Server Action's Zod schema
-- already prevents) RAISES 22023. Everything else a caller may legitimately hit — a round that is not open,
-- a round inside the 30-day window, a refused reservation — is a TYPED OUTCOME in the returned jsonb,
-- never a bare null and never an exception.
--
-- Numbers below are transcribed from ADR 0029 (5.1 30 days, 5.8 7 days, 7.2 reservation 10 cents, 10
-- minutes, 3 attempts; the 30-cent ceiling is the column default of M2.3). lib/interview/constants.ts
-- holds the same values for the TypeScript callers.

-- ─── 1. create_interview_round (5.1) ────────────────────────────────────────
--
-- p_questions: a jsonb array of 5..8 objects { questionKey, slotType, slotCategory, bankVersion }. The
-- round takes the (single, shared) bankVersion; each answer row stores its own copy (5.1: "an answer row
-- stores question_key and bank_version"). Outcomes: ok { roundId } | too_soon | round_open.

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

REVOKE ALL ON FUNCTION public.create_interview_round(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_interview_round(uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_interview_round(uuid, uuid, jsonb) TO service_role;

-- ─── 2. save_interview_answer (9.2) ─────────────────────────────────────────
--
-- Derives the business from the ANSWER. ONE conditional UPDATE, guarded on the round being 'open'.
-- Outcomes: ok { answerId } | not_found | not_open.

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
  v_updated     uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.founder_interview_answers WHERE id = p_answer_id;
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

REVOKE ALL ON FUNCTION public.save_interview_answer(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_interview_answer(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_interview_answer(uuid, uuid, text) TO service_role;

-- ─── 3. skip_interview_answer (5.8) ─────────────────────────────────────────
--
-- "Skip this question": the row becomes 'skipped' and any text saved earlier is DROPPED (a skipped
-- question holds no answer). answered_at is stamped with the skip time: it is the COOLDOWN CLOCK for
-- both answered and skipped rows (3.3: a key skipped inside 60 days is not eligible again, and 9.1's
-- (business_id, question_key, answered_at DESC) index is "the cooldown lookup"). Guarded on the round
-- being open and the answer being pending or answered. Outcomes: ok | not_found | not_skippable.

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
  v_updated     uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.founder_interview_answers WHERE id = p_answer_id;
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

REVOKE ALL ON FUNCTION public.skip_interview_answer(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.skip_interview_answer(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skip_interview_answer(uuid, uuid) TO service_role;

-- ─── 4. skip_interview_round (5.8) ──────────────────────────────────────────
--
-- open -> skipped, terminal. Its still-PENDING questions become 'skipped' too, stamped with the same
-- cooldown clock, so "its question keys take the 60-day cooldown" (5.8) holds; questions already
-- answered keep their answer (and the 180-day cooldown). Outcomes: ok { skippedAnswers } | not_found | not_open.

CREATE OR REPLACE FUNCTION public.skip_interview_round(
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
  v_skipped     int;
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
    RAISE EXCEPTION 'skip_interview_round: % is not an author-level member of the round''s business', p_user_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.founder_interview_rounds
     SET status = 'skipped', terminal_at = now()
   WHERE id = p_round_id AND status = 'open'
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_open');
  END IF;

  UPDATE public.founder_interview_answers
     SET status = 'skipped', answered_by = p_user_id, answered_at = now()
   WHERE round_id = p_round_id AND status = 'pending';
  GET DIAGNOSTICS v_skipped = ROW_COUNT;

  RETURN jsonb_build_object('outcome', 'ok', 'skippedAnswers', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.skip_interview_round(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.skip_interview_round(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skip_interview_round(uuid, uuid) TO service_role;

-- ─── 5. submit_interview_round (5.2) ────────────────────────────────────────
--
-- open -> submitted, requires at least ONE answered question, in the same conditional UPDATE.
-- Outcomes: ok | not_found | not_open | no_answers.

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

REVOKE ALL ON FUNCTION public.submit_interview_round(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_interview_round(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_interview_round(uuid, uuid) TO service_role;

-- ─── 6. snooze_interview (5.8) ──────────────────────────────────────────────
--
-- "Not now": businesses.interview_snoozed_until = now() + 7 days. The business row IS the row written,
-- so this takes the business id and VERIFIES p_user_id's author-level membership first. An active snooze
-- is not extended by a repeat click. Outcomes: ok { snoozedUntil } | already_snoozed.

CREATE OR REPLACE FUNCTION public.snooze_interview(
  p_user_id     uuid,
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_until timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = p_business_id
       AND user_id = p_user_id
       AND status = 'active'
       AND role IN ('editor', 'approver')
  ) THEN
    RAISE EXCEPTION 'snooze_interview: % is not an author-level member of business %', p_user_id, p_business_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.businesses
     SET interview_snoozed_until = now() + interval '7 days'
   WHERE id = p_business_id
     AND deleted_at IS NULL
     AND (interview_snoozed_until IS NULL OR interview_snoozed_until <= now())
  RETURNING interview_snoozed_until INTO v_until;

  IF v_until IS NULL THEN
    RETURN jsonb_build_object('outcome', 'already_snoozed');
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'snoozedUntil', v_until);
END;
$$;

REVOKE ALL ON FUNCTION public.snooze_interview(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.snooze_interview(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snooze_interview(uuid, uuid) TO service_role;

-- ─── 7. claim_interview_extraction — THE RESERVATION (7.2, [db-BLOCKER-1]) ──
--
-- ONE conditional UPDATE on the round row that ALREADY EXISTS (it was created at Start, long before
-- extraction): NEVER an upsert, NO INSERT branch. A first-call INSERT branch that skipped the cap is the
-- exact bug 20260922110000:432-454 fixed for ai_budget_daily; there is no INSERT here for it to hide in.
--
-- It sets status 'extracting', reserves 10 cents, counts the attempt and stamps the claim, GUARDED on:
--   (status IN ('submitted','extraction_failed')
--    OR (status = 'extracting' AND claimed_at < now() - interval '10 minutes'))   -- a stuck claim may be re-taken
--   AND spend_cents + 10 <= ceiling_cents                                         -- the per-round ceiling
--   AND extraction_attempts < 3                                                   -- three attempts in total
-- ZERO ROWS UPDATED = REFUSED, and the refusal is a TYPED outcome — never a bare null:
--   not_found | not_claimable | attempts | ceiling
-- classified in that order (an exhausted attempt count is reported as `attempts` even though 30 cents
-- spent would also breach the ceiling). Takes no p_user_id and no business id: it is called by the
-- extraction orchestrator under the service-role client, and derives the business from the round.

CREATE OR REPLACE FUNCTION public.claim_interview_extraction(p_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_attempts    int;
  v_spend       int;
  v_status      text;
  v_claimed_at  timestamptz;
  v_ceiling     int;
BEGIN
  UPDATE public.founder_interview_rounds
     SET status              = 'extracting',
         spend_cents         = spend_cents + 10,
         extraction_attempts = extraction_attempts + 1,
         claimed_at          = now(),
         error_code          = NULL
   WHERE id = p_round_id
     AND (
           status IN ('submitted', 'extraction_failed')
        OR (status = 'extracting' AND claimed_at < now() - interval '10 minutes')
         )
     AND spend_cents + 10 <= ceiling_cents
     AND extraction_attempts < 3
  RETURNING business_id, extraction_attempts, spend_cents
       INTO v_business_id, v_attempts, v_spend;

  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'claimed', 'businessId', v_business_id, 'attempt', v_attempts, 'spendCents', v_spend);
  END IF;

  SELECT status, claimed_at, extraction_attempts, spend_cents, ceiling_cents
    INTO v_status, v_claimed_at, v_attempts, v_spend, v_ceiling
    FROM public.founder_interview_rounds
   WHERE id = p_round_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF NOT (
       v_status IN ('submitted', 'extraction_failed')
    OR (v_status = 'extracting' AND v_claimed_at < now() - interval '10 minutes')
  ) THEN
    RETURN jsonb_build_object('outcome', 'not_claimable', 'status', v_status);
  END IF;
  IF v_attempts >= 3 THEN
    RETURN jsonb_build_object('outcome', 'attempts', 'attempts', v_attempts);
  END IF;
  RETURN jsonb_build_object('outcome', 'ceiling', 'spendCents', v_spend, 'ceilingCents', v_ceiling);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_interview_extraction(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_interview_extraction(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_interview_extraction(uuid) TO service_role;

-- ─── 8. reconcile_interview_spend (7.2) ─────────────────────────────────────
--
-- Replaces the RESERVED 10 cents with the ACTUAL ai_usage cost, on EVERY outcome including failure (the
-- ADR 0027 7.4 shape), guarded on the round still being 'extracting'.
--   p_outcome = 'succeeded'  the spend is corrected; the status stays 'extracting' — write_interview_candidates
--                            (M2.5) is what moves the round on.
--   p_outcome = 'failed'     p_error_code is REQUIRED; the round becomes 'extraction_failed', or 'failed'
--                            (terminal) when the attempts are exhausted.
-- The corrected spend is clamped into [0, ceiling_cents] so a reconciliation can NEVER fail on the
-- spend <= ceiling CHECK: a failure has to be recordable. p_error_code is the fourth parameter the
-- build-guide's three-argument sketch left implicit — a failure needs a code to carry.
-- Outcomes: reconciled { status, spendCents } | not_extracting.

CREATE OR REPLACE FUNCTION public.reconcile_interview_spend(
  p_round_id     uuid,
  p_actual_cents integer,
  p_outcome      text,
  p_error_code   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_spend  int;
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

  UPDATE public.founder_interview_rounds
     SET spend_cents = LEAST(ceiling_cents, GREATEST(0, spend_cents - 10 + p_actual_cents)),
         status = CASE
                    WHEN p_outcome = 'failed' AND extraction_attempts >= 3 THEN 'failed'
                    WHEN p_outcome = 'failed' THEN 'extraction_failed'
                    ELSE status
                  END,
         error_code = CASE WHEN p_outcome = 'failed' THEN p_error_code ELSE NULL END,
         terminal_at = CASE WHEN p_outcome = 'failed' AND extraction_attempts >= 3 THEN now() ELSE terminal_at END
   WHERE id = p_round_id
     AND status = 'extracting'
  RETURNING status, spend_cents INTO v_status, v_spend;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_extracting');
  END IF;
  RETURN jsonb_build_object('outcome', 'reconciled', 'status', v_status, 'spendCents', v_spend);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_interview_spend(uuid, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_interview_spend(uuid, integer, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_interview_spend(uuid, integer, text, text) TO service_role;
