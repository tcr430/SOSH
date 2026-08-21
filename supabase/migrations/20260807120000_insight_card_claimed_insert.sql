-- A-5 (ADJUDICATED, Session 28-D §4) — the single-statement conditional card
-- insert that closes MAJOR-1. §0.2 A-4′ binds Stage D's card insert to the
-- claim it consumes: "if the claim is gone, zero rows, no card." The
-- Builder shipped the inverse — an unconditional insertCard, then a
-- SEPARATE atomic setCandidateTriageOutcome('carded') call, with a
-- compensating deleteCardById if that second call matched zero rows. A
-- crash, a lost connection, or a failing delete in the window between those
-- two non-atomic steps left a status='pending' card in the feed describing
-- release text a re-score had already superseded — the precise outcome
-- A-4′ was chosen to make impossible. It also opened a service-role DELETE
-- into a table this migration's own predecessor
-- (20260807100000_mode3_insight_cards.sql:89-94) deliberately gave no
-- DELETE policy, on the stated ground that cards are the eval corpus's
-- history.
--
-- This function folds BOTH facts — "was the claim still live" and "does the
-- card now exist" — into ONE SQL statement (a data-modifying CTE feeding a
-- data-modifying INSERT), not two round-trips with a rollback compensating
-- for the second one's failure. The UPDATE is the claim consumption A-4′
-- describes; its RETURNING clause is the INSERT's only row source, so a
-- card can only ever be written where the claim was live in THIS statement.
-- ON CONFLICT (signal_candidate_id) DO NOTHING is the arbiter for the
-- table's existing UNIQUE constraint (20260807100000:16-19) — reachable
-- only as an idempotent no-op on a same-claim retry, never as the ordinary
-- path, because the claim (and therefore this function) does not run twice
-- against the same live claim.
--
-- Zero rows back is the fail-closed path (a concurrent re-score's A-4′
-- reset already moved the candidate off 'triaging'/this claim), never an
-- error — the caller (lib/db/insight-cards.ts insertCard) turns an empty
-- result into a typed 'claim_lost' outcome, not a thrown exception.
--
-- status is deliberately absent from both the INSERT's column list and this
-- function's parameters — it is set by the table's own DEFAULT 'pending'
-- (20260807100000:42), preserving §7.4 kill point 3: no code path, migration
-- included, ever assigns insight_cards.status directly.

CREATE OR REPLACE FUNCTION public.insert_insight_card_if_claimed(
  p_signal_candidate_id uuid,
  p_claimed_at          timestamptz,
  p_observation         text,
  p_why_it_matters      text,
  p_audience            text,
  p_angle_options       jsonb,
  p_evidence            jsonb,
  p_suggested_objective text,
  p_novelty             numeric,
  p_freshness           numeric,
  p_sensitivity         numeric,
  p_confidence          numeric,
  p_rubric_scores       jsonb,
  p_score               numeric,
  p_occurred_at         timestamptz
)
RETURNS SETOF public.insight_cards
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimed AS (
    UPDATE public.signal_candidates
       SET status = 'carded', triage_claimed_at = NULL
     WHERE id = p_signal_candidate_id
       AND status = 'triaging'
       AND triage_claimed_at = p_claimed_at
    RETURNING business_id, id AS signal_candidate_id
  )
  INSERT INTO public.insight_cards (
    business_id, signal_candidate_id, observation, why_it_matters, audience,
    angle_options, evidence, suggested_objective, novelty, freshness,
    sensitivity, confidence, rubric_scores, score, occurred_at
  )
  SELECT claimed.business_id, claimed.signal_candidate_id, p_observation, p_why_it_matters, p_audience,
         p_angle_options, p_evidence, p_suggested_objective, p_novelty, p_freshness,
         p_sensitivity, p_confidence, p_rubric_scores, p_score, p_occurred_at
    FROM claimed
  ON CONFLICT (signal_candidate_id) DO NOTHING
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.insert_insight_card_if_claimed(
  uuid, timestamptz, text, text, text, jsonb, jsonb, text, numeric, numeric, numeric, numeric, jsonb, numeric, timestamptz
) FROM public;
GRANT EXECUTE ON FUNCTION public.insert_insight_card_if_claimed(
  uuid, timestamptz, text, text, text, jsonb, jsonb, text, numeric, numeric, numeric, numeric, jsonb, numeric, timestamptz
) TO service_role;
