-- Migration: apply_brief_proposals places a ratified reorder EXACTLY where the ratified sentence says, refuses a
-- non-critiqued brief and an empty result with typed outcomes that change ZERO rows, and gains the non-partial
-- index the review page's current-version read needs (ADR 0027 §5.4/§5.5 — Session 34-D D5: MAJOR-1, MINOR-2,
-- MINOR-8, and MINOR-7's index half). A FORWARD migration: 20260922110000 and 20260923100000 are committed and are
-- NOT edited. Constraint: AGENCY-REORDER-RATIFIED-EXACT (Tier 1, supabase/__tests__/plan-proposals-ratify.test.ts,
-- agreeing with the pure reference placeRatifiedProposals in lib/campaigns/role-sequence.ts).
--
-- ═══ THE PLACEMENT RULE (one sentence, and the sentence the human ratifies) ═══════════════════════════════════
-- The planner prompt says: "reorder: move the post at targetOrder to proposedOrder". THE RULE IS:
--   proposed_order is the entry's 0-based position in the RESULTING sequence — after every accepted drop is
--   removed — and every entry that is not the target of an accepted reorder keeps its original relative order
--   and fills the remaining positions, in order.
-- HOW THE PROPOSAL KINDS COMPOSE (deterministic, and independent of the order the ids were submitted in):
--   * target_order ALWAYS names an entry by its ORIGINAL `order` (what the model was shown), never a position in
--     a partly-applied array. There is no sequential application, so no ordering to get wrong.
--   * drop removes the entry; substitute keeps the entry's place and changes only its role;
--   * a reorder PINS its entry to slot proposed_order of the result; the un-pinned survivors, in original order,
--     fill the open slots left to right. (So: r0..r3, move 3 -> 0 gives r3,r0,r1,r2; move 0 -> 3 gives
--     r1,r2,r3,r0 — the Reviewer's two cases land where the sentence says.)
--   * a combination the sentence cannot satisfy is REFUSED with a typed outcome, never reinterpreted:
--       - two reorders to ONE slot                        -> 'conflicting_reorders'  (+ proposalId)
--       - a reorder to a slot past the result's end (a drop shortened the result, or the slot never existed)
--                                                          -> 'invalid_reorder_target' (+ proposalId)
--       - a result with NO entries (every entry dropped)   -> 'empty_sequence'
--     (a drop and a substitute/reorder of the SAME target is still 'conflicting_proposals', as before).
--
-- THE DEFECT (MAJOR-1). The prior body gave a moved entry sort_key = proposed_order and ranked with
-- ORDER BY sort_key, idx: the entry occupying the target slot has the SAME sort_key and wins the idx tiebreak, so
-- the moved entry never reached proposed_order (3 -> 0 gave r0,r3,r1,r2; 0 -> 3 gave r1,r2,r0,r3). The human
-- ratified one sentence and the RPC wrote a different brief, which then freezes and drives N posts.
--
-- MINOR-2: the brief must be 'critiqued' (ADR 0027 §5.4's diagram; ADR 0017 Amendment F.1). A non-critiqued brief
-- returns the typed outcome 'not_critiqued'. It is decided AFTER frozen, concurrent_edit and
-- no_proposals_applied, so a frozen brief still reads 'frozen', a raced brief still reads 'concurrent_edit', and
-- an apply with nothing pending (the version-scope scenario) still reads 'no_proposals_applied'.
-- CONCURRENCY (database-reviewer, D5): the would-be-accepted proposal rows are locked FOR UPDATE, in id order,
-- before anything is computed from them, so a concurrent decide_plan_proposal cannot reject one between the
-- placement computation and the flip.
-- MINOR-8: an empty result returns 'empty_sequence' instead of committing an empty roleSequence.
--
-- EVERY REFUSAL IS DECIDED BEFORE THE PROPOSALS ARE MARKED ACCEPTED. The whole result is computed from the
-- would-be-accepted set first; only then are rows flipped, the brief written and the leftovers superseded. A
-- refusal therefore changes ZERO rows — there is no RAISE after a partial write for a caller to clean up.
--
-- MINOR-7 (index half): the review page reads every proposal of the CURRENT brief version in the order
-- (target_order, created_at, id). The existing review index is PARTIAL (WHERE status = 'pending') and cannot
-- serve a non-pending read. A NON-partial index on (brief_id, brief_version, target_order, created_at, id) does.
-- The partial review index and the partial unique index are untouched.

-- ─── apply_brief_proposals: exact placement, critiqued guard, refusals before writes ────────────────────────

CREATE OR REPLACE FUNCTION public.apply_brief_proposals(
  p_business_id     uuid,
  p_brief_id        uuid,
  p_expected_version int,
  p_user_id         uuid,
  p_proposal_ids    uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brief          public.campaign_briefs;
  v_role_seq_len   int;
  v_bad_proposal   uuid;
  v_candidate_cnt  int;
  v_result_len     int;
  v_dup_reorder    uuid;
  v_bad_reorder    uuid;
  v_new_role_seq   jsonb;
  v_accepted_ids   uuid[];
  v_updated_brief  public.campaign_briefs;
BEGIN
  PERFORM public.assert_plan_proposal_author(p_business_id, p_user_id);

  SELECT * INTO v_brief
    FROM public.campaign_briefs
   WHERE id = p_brief_id AND business_id = p_business_id AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_brief.frozen_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'frozen');
  END IF;

  IF v_brief.version <> p_expected_version THEN
    RETURN jsonb_build_object('outcome', 'concurrent_edit');
  END IF;

  -- Serialise with decide_plan_proposal (database-reviewer MEDIUM, D5): lock the would-be-accepted proposal rows,
  -- in id order (no deadlock with a single-row decide), BEFORE anything is computed from them. decide_plan_proposal
  -- does not lock the brief, so without this a proposal REJECTED between the placement computation below and the
  -- flip would be skipped by the flip yet still applied to the sequence — a brief carrying a change the human
  -- rejected. With the rows locked, a concurrent decide either commits first (the row is no longer 'pending' and
  -- drops out of every predicate below) or waits until this transaction ends.
  PERFORM 1
     FROM public.campaign_plan_proposals p
    WHERE p.id = ANY (p_proposal_ids)
      AND p.brief_id = p_brief_id
      AND p.business_id = p_business_id
      AND p.brief_version = p_expected_version
      AND p.status = 'pending'
    ORDER BY p.id
      FOR UPDATE;

  v_role_seq_len := jsonb_array_length(coalesce(v_brief.content -> 'roleSequence', '[]'::jsonb));

  -- (e) a stale target_order. Version-scoped: a proposal from an earlier version is not "stale at the end of the
  -- array", it is simply not a proposal for THIS array, and is excluded here and below.
  SELECT p.id INTO v_bad_proposal
    FROM public.campaign_plan_proposals p
   WHERE p.id = ANY (p_proposal_ids)
     AND p.brief_id = p_brief_id
     AND p.business_id = p_business_id
     AND p.brief_version = p_expected_version
     AND p.status = 'pending'
     AND p.target_order >= v_role_seq_len
   LIMIT 1;

  IF v_bad_proposal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'stale_target_order', 'proposalId', v_bad_proposal);
  END IF;

  -- A batch containing BOTH a 'drop' AND a 'substitute'/'reorder' at the SAME target_order is refused (K2.6
  -- database-reviewer MAJOR): drop-wins would otherwise silently discard the other's effect while recording
  -- it 'accepted'.
  SELECT p.id INTO v_bad_proposal
    FROM public.campaign_plan_proposals p
   WHERE p.id = ANY (p_proposal_ids)
     AND p.brief_id = p_brief_id
     AND p.business_id = p_business_id
     AND p.brief_version = p_expected_version
     AND p.status = 'pending'
     AND p.kind IN ('substitute', 'reorder')
     AND EXISTS (
       SELECT 1 FROM public.campaign_plan_proposals d
        WHERE d.id = ANY (p_proposal_ids)
          AND d.brief_id = p_brief_id
          AND d.business_id = p_business_id
          AND d.brief_version = p_expected_version
          AND d.status = 'pending'
          AND d.kind = 'drop'
          AND d.target_order = p.target_order
     )
   LIMIT 1;

  IF v_bad_proposal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'conflicting_proposals', 'proposalId', v_bad_proposal);
  END IF;

  -- The would-be-accepted set: exactly the given, still-pending, same-brief, SAME-VERSION ids. Ids that do not
  -- match (foreign, already-decided, a different brief, or written against another version) are silently
  -- excluded. Counted BEFORE anything is written.
  SELECT count(*)::int INTO v_candidate_cnt
    FROM public.campaign_plan_proposals p
   WHERE p.id = ANY (p_proposal_ids)
     AND p.brief_id = p_brief_id
     AND p.business_id = p_business_id
     AND p.brief_version = p_expected_version
     AND p.status = 'pending'
     AND p.kind IN ('drop', 'substitute', 'reorder', 'request_evidence');

  -- Every id was stale / foreign / wrong-version: nothing applied, nothing bumped (K2.6 MODERATE).
  IF v_candidate_cnt = 0 THEN
    RETURN jsonb_build_object('outcome', 'no_proposals_applied');
  END IF;

  -- MINOR-2: proposals are reviewed at 'critiqued' (the human checkpoint). The action checks it too; the RPC is
  -- the stated boundary, so it checks it itself. Decided AFTER 'no_proposals_applied' on purpose: an apply with
  -- nothing left to apply (a stale sibling of a round that already advanced the brief to 'draft') has always
  -- answered 'no_proposals_applied', and plan-proposals-version-scope.test.ts pins that — "nothing to apply" is
  -- the truer answer than "the brief is not critiqued" when no pending proposal remains.
  IF v_brief.status <> 'critiqued' THEN
    RETURN jsonb_build_object('outcome', 'not_critiqued');
  END IF;

  -- (g) compute the RESULTING roleSequence from the would-be-accepted set — request_evidence applies nothing to
  -- content (ruling A-9). See the header for the placement rule. One statement returns the result length, the
  -- first offending reorder of each refusable kind, and the placed sequence, so every refusal is known before
  -- any row changes.
  WITH orig AS (
    SELECT (elem ->> 'order')::int AS idx, ord AS pos, elem AS entry
      FROM jsonb_array_elements(coalesce(v_brief.content -> 'roleSequence', '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  ),
  cand AS (
    SELECT p.id, p.kind, p.target_order, p.proposed_role, p.proposed_order
      FROM public.campaign_plan_proposals p
     WHERE p.id = ANY (p_proposal_ids)
       AND p.brief_id = p_brief_id
       AND p.business_id = p_business_id
       AND p.brief_version = p_expected_version
       AND p.status = 'pending'
       AND p.kind IN ('drop', 'substitute', 'reorder')
  ),
  resolved AS (
    SELECT o.idx, o.pos, o.entry,
           coalesce(sub.proposed_role, o.entry ->> 'role') AS final_role,
           rp.proposed_order AS pin,
           rp.id AS pin_id
      FROM orig o
      LEFT JOIN LATERAL (
        SELECT c.proposed_role FROM cand c
         WHERE c.target_order = o.idx AND c.kind = 'substitute' ORDER BY c.id LIMIT 1
      ) sub ON true
      LEFT JOIN LATERAL (
        SELECT c.id, c.proposed_order FROM cand c
         WHERE c.target_order = o.idx AND c.kind = 'reorder' ORDER BY c.id LIMIT 1
      ) rp ON true
     WHERE NOT EXISTS (SELECT 1 FROM cand c WHERE c.target_order = o.idx AND c.kind = 'drop')
  ),
  len AS (
    SELECT count(*)::int AS n FROM resolved
  ),
  dup AS (
    SELECT r.pin_id FROM resolved r
     WHERE r.pin IS NOT NULL AND (SELECT count(*) FROM resolved x WHERE x.pin = r.pin) > 1
     ORDER BY r.pin_id LIMIT 1
  ),
  bad AS (
    SELECT r.pin_id FROM resolved r, len
     WHERE r.pin IS NOT NULL AND r.pin >= len.n
     ORDER BY r.pin_id LIMIT 1
  ),
  pinned AS (
    SELECT r.pin AS slot, r.final_role, r.entry FROM resolved r WHERE r.pin IS NOT NULL
  ),
  free AS (
    SELECT r.final_role, r.entry, row_number() OVER (ORDER BY r.idx, r.pos) - 1 AS rk
      FROM resolved r WHERE r.pin IS NULL
  ),
  open_slots AS (
    SELECT s AS slot, row_number() OVER (ORDER BY s) - 1 AS rk
      FROM len, generate_series(0, len.n - 1) AS s
     WHERE s NOT IN (SELECT slot FROM pinned)
  ),
  placed AS (
    SELECT slot, final_role, entry FROM pinned
    UNION ALL
    SELECT o.slot, f.final_role, f.entry FROM free f JOIN open_slots o ON o.rk = f.rk
  )
  SELECT (SELECT n FROM len),
         (SELECT pin_id FROM dup),
         (SELECT pin_id FROM bad),
         coalesce(
           (SELECT jsonb_agg(
              jsonb_build_object('order', slot, 'role', final_role, 'platform', entry -> 'platform', 'angle', entry -> 'angle')
              ORDER BY slot
            ) FROM placed),
           '[]'::jsonb)
    INTO v_result_len, v_dup_reorder, v_bad_reorder, v_new_role_seq;

  -- MINOR-8: refuse an empty result (every entry dropped) instead of committing roleSequence = [].
  IF v_result_len = 0 THEN
    RETURN jsonb_build_object('outcome', 'empty_sequence');
  END IF;

  -- MAJOR-1: a reorder the ratified sentence cannot satisfy is refused, never reinterpreted.
  IF v_dup_reorder IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'conflicting_reorders', 'proposalId', v_dup_reorder);
  END IF;

  IF v_bad_reorder IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_reorder_target', 'proposalId', v_bad_reorder);
  END IF;

  -- (f) NOW — every refusal has been decided — flip exactly the would-be-accepted ids pending -> accepted.
  WITH updated AS (
    UPDATE public.campaign_plan_proposals p
       SET status = 'accepted', decided_by = p_user_id, decided_at = now()
     WHERE p.id = ANY (p_proposal_ids)
       AND p.brief_id = p_brief_id
       AND p.business_id = p_business_id
       AND p.brief_version = p_expected_version
       AND p.status = 'pending'
       AND p.kind IN ('drop', 'substitute', 'reorder', 'request_evidence')
    RETURNING p.id
  )
  SELECT array_agg(id) INTO v_accepted_ids FROM updated;

  IF v_accepted_ids IS NULL THEN
    v_accepted_ids := ARRAY[]::uuid[];
  END IF;

  -- (h) write content + version = p_expected_version + 1, GUARDED on version and on status = 'critiqued'.
  UPDATE public.campaign_briefs
     SET content = jsonb_set(content, '{roleSequence}', v_new_role_seq), version = p_expected_version + 1, status = 'draft'
   WHERE id = p_brief_id AND business_id = p_business_id AND version = p_expected_version AND status = 'critiqued'
  RETURNING * INTO v_updated_brief;

  -- Unreachable while the FOR UPDATE above holds (version and status were checked under that lock). If the lock
  -- were ever loosened, a RETURN here would COMMIT the flip above without the brief write — so it RAISES, which
  -- rolls the whole call back and keeps the "a refusal changes zero rows" contract (database-reviewer LOW, D5).
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_brief_proposals: the guarded brief update matched no row' USING ERRCODE = '40001';
  END IF;

  -- (i) the version just advanced, so every proposal still pending for this brief was written against an array
  -- that no longer exists. Supersede them here, in the SAME transaction as the bump, never as a later step a
  -- crash could skip. Transaction-local flag, as revise_/approve_ set it.
  PERFORM set_config('app.plan_proposal_supersede', 'true', true);
  UPDATE public.campaign_plan_proposals
     SET status = 'superseded', superseded_reason = 'version_advanced'
   WHERE brief_id = p_brief_id AND business_id = p_business_id AND status = 'pending';

  RETURN jsonb_build_object('outcome', 'ok', 'brief', to_jsonb(v_updated_brief), 'acceptedIds', to_jsonb(v_accepted_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.apply_brief_proposals(uuid, uuid, int, uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_brief_proposals(uuid, uuid, int, uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_brief_proposals(uuid, uuid, int, uuid, uuid[]) TO service_role;

-- ─── MINOR-7 (index half): a non-partial index for the page's current-version read ──────────────────────────

CREATE INDEX campaign_plan_proposals_brief_version_idx
  ON public.campaign_plan_proposals (brief_id, brief_version, target_order, created_at, id);
