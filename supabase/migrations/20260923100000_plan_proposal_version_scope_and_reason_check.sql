-- Migration: scope apply_brief_proposals to the brief's CURRENT version, supersede the leftovers,
-- and close plan_analysis_reason to a CHECK (ADR 0027 §5.5/§5.7/§3.3 — Session 34 K2.7 security-review
-- findings F2 and F3). A FORWARD migration: 20260922110000 and 20260922100000 are already committed.
--
-- F2 (apply_brief_proposals ignored brief_version). The RPC bumps the brief's version and rewrites the
-- roleSequence, renumbering every `order`. It did NOT supersede the batch's siblings, and none of its three
-- proposal predicates filtered on p.brief_version, so a proposal written against version 1 stayed
-- 'pending' at target_order N while the array beneath it had shifted. A later call that named its id dropped
-- WHATEVER NOW SAT AT INDEX N — a different post than the human had reviewed. Two fixes, both required:
--   (1) every predicate that selects proposals now also requires p.brief_version = p_expected_version, so a
--       proposal can only ever be applied against the version it was written for;
--   (2) after the version bump, every proposal still pending for that brief is SUPERSEDED
--       ('version_advanced') in the same transaction — ADR 0027 §5.7: a pending proposal is superseded the
--       moment its brief version advances. (revise_/approve_ already did this; apply_ was the third
--       version-advancing path and had been missed.) Without (2), (1) alone would leave dead-but-pending rows
--       in the human's review list.
--   The supersede uses the same session-local flag the K2.5 legality trigger requires
--   (app.plan_proposal_supersede, set_config(..., true) = transaction-local), so the trigger is not bypassed.
--
-- F3 (plan_analysis_reason had no CHECK). The column is RENDERED TO A HUMAN and must never be able to carry
-- model text; until now that was enforced only by a TypeScript type. Two named CHECKs:
--   * the value is NULL or one of the fourteen closed literals (the eleven runtime loop-failure reasons plus
--     internal_error / no_brief / daily_cap — kept in step with lib/db/types.ts PLAN_ANALYSIS_REASONS by a
--     test that reads this file);
--   * a reason is only meaningful on an outcome that failed: 'not_run' and 'ok' carry NULL.
--   A nullable column needs no NOT NULL companion (the "NULL LIKE 'x%' satisfies a CHECK" trap is about
--   namespace CHECKs on a column that must be present; here NULL is legitimate and spelled out).

-- ─── F2: apply_brief_proposals, version-scoped, superseding its leftovers ────

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

  v_role_seq_len := jsonb_array_length(coalesce(v_brief.content -> 'roleSequence', '[]'::jsonb));

  -- (e) a stale target_order. Version-scoped (F2): a proposal from an earlier version is not "stale at the
  -- end of the array", it is simply not a proposal for THIS array, and is excluded here and below.
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

  -- (f) flip exactly the given, still-pending, same-brief, SAME-VERSION ids pending -> accepted. Ids that
  -- do not match (foreign, already-decided, a different brief, or written against another version) are
  -- silently excluded.
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

  -- Every id was stale / foreign / wrong-version: nothing applied, nothing bumped (K2.6 MODERATE).
  IF array_length(v_accepted_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_proposals_applied');
  END IF;

  -- (g) rebuild roleSequence — request_evidence applies nothing to content (ruling A-9).
  WITH orig AS (
    SELECT (elem ->> 'order')::int AS idx, elem AS entry
      FROM jsonb_array_elements(coalesce(v_brief.content -> 'roleSequence', '[]'::jsonb)) AS elem
  ),
  applied AS (
    SELECT p.target_order, p.kind, p.proposed_role, p.proposed_order
      FROM public.campaign_plan_proposals p
     WHERE p.id = ANY (v_accepted_ids)
       AND p.kind IN ('drop', 'substitute', 'reorder')
  ),
  resolved AS (
    SELECT
      o.idx,
      o.entry,
      (o.idx NOT IN (SELECT target_order FROM applied WHERE kind = 'drop')) AS keep,
      coalesce((SELECT a.proposed_role FROM applied a WHERE a.target_order = o.idx AND a.kind = 'substitute'), o.entry ->> 'role') AS final_role,
      coalesce((SELECT a.proposed_order FROM applied a WHERE a.target_order = o.idx AND a.kind = 'reorder'), o.idx) AS sort_key
    FROM orig o
  ),
  ranked AS (
    SELECT row_number() OVER (ORDER BY sort_key, idx) - 1 AS new_order, final_role, entry
      FROM resolved WHERE keep
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object('order', new_order, 'role', final_role, 'platform', entry -> 'platform', 'angle', entry -> 'angle')
    ORDER BY new_order
  ), '[]'::jsonb)
    INTO v_new_role_seq
    FROM ranked;

  -- (h) write content + version = p_expected_version + 1, GUARDED on version = p_expected_version.
  UPDATE public.campaign_briefs
     SET content = jsonb_set(content, '{roleSequence}', v_new_role_seq), version = p_expected_version + 1, status = 'draft'
   WHERE id = p_brief_id AND business_id = p_business_id AND version = p_expected_version
  RETURNING * INTO v_updated_brief;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'concurrent_edit');
  END IF;

  -- (i) F2 fix (2): the version just advanced, so every proposal still pending for this brief was written
  -- against an array that no longer exists. Supersede them here, in the SAME transaction as the bump, never
  -- as a later step a crash could skip. Transaction-local flag, as revise_/approve_ set it.
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

-- ─── F3: plan_analysis_reason is a closed set ────────────────────────────────

ALTER TABLE public.campaign_briefs
  ADD CONSTRAINT campaign_briefs_plan_analysis_reason_check
    CHECK (
      plan_analysis_reason IS NULL OR plan_analysis_reason IN (
        'quota_exceeded', 'rate_limited', 'wall_clock_exceeded', 'input_token_cap_exceeded',
        'output_token_per_turn_exceeded', 'output_token_cap_exceeded', 'retry_budget_exhausted',
        'max_turns_exceeded', 'response_truncated', 'invalid_response', 'provider_error',
        'internal_error', 'no_brief', 'daily_cap'
      )
    ),
  ADD CONSTRAINT campaign_briefs_plan_analysis_reason_pairing_check
    CHECK (plan_analysis_reason IS NULL OR plan_analysis_status IN ('unavailable', 'capped'));
