-- Migration: the three campaign_plan_proposals RPCs and the fourth ai_budget_daily purpose
-- (ADR 0027 §5.5, §5.6, §5.7, §7.4 — Session 34 K2.6)
--
-- WHAT THIS ADDS
--   assert_plan_proposal_author  a shared capability-check helper (p_user_id verified, NOT
--                                 auth.uid() — these RPCs run under the service-role connection,
--                                 which has no JWT session, so auth.uid() is unavailable inside
--                                 them; user_can() itself cannot be reused as-is because it reads
--                                 auth.uid() internally — this replicates its 'author' branch
--                                 logic against an EXPLICIT, caller-supplied, already-verified id).
--   apply_brief_proposals        ratifies a batch of pending proposals against a brief in one
--                                 transaction (ADR §5.5).
--   decide_plan_proposal         accept/reject ONE proposal, the acknowledge_campaign_retrospective
--                                 shape (ADR §5.6).
--   approve_brief_and_supersede_proposals / revise_brief_and_supersede_proposals
--                                 the freeze/version-advance + supersede fix (ADR §5.7).
--   ai_budget_daily              gains the 'planner_cents' purpose (ADR §7.4).
--
-- EVERY RPC BELOW: SECURITY DEFINER, search_path pinned, REVOKE ALL FROM public/anon/authenticated,
-- GRANT EXECUTE TO service_role only — these are called from Server Actions via the service-role
-- client, never directly by PostgREST from the browser.

-- ─── FK indexes for brief_id and campaign_id (K2.5 correction — database-reviewer finding, MAJOR) ──
--
-- K2.5's own migration comment claimed brief_id's FK was "covered by the review index's leading
-- column" and provided no index for campaign_id at all. Both claims are wrong: the review index
-- (campaign_plan_proposals_review_idx) is PARTIAL (WHERE status = 'pending'), and decided history
-- is explicitly permanent (accepted/rejected/superseded rows are the audit trail, K2.5's own
-- header). A cascade DELETE from campaign_briefs or campaigns issues an unfiltered
-- `WHERE brief_id = $1` / `WHERE campaign_id = $1` — Postgres cannot use a partial index unless the
-- query provably implies its predicate, which an unfiltered cascade delete does not. As a business
-- accumulates decided (non-pending) proposals, every purge_business call or campaign delete
-- touching that brief seq-scans this table — the exact insight_cards MODERATE-2 lesson K2.5's own
-- comments cite but did not actually apply to these two columns. K2.5 is already committed, so this
-- is a forward migration (this file), not an edit to that one.

CREATE INDEX campaign_plan_proposals_brief_id_idx ON public.campaign_plan_proposals (brief_id);
CREATE INDEX campaign_plan_proposals_campaign_id_idx ON public.campaign_plan_proposals (campaign_id);

-- ─── assert_plan_proposal_author — the shared capability check ──────────────
--
-- Replicates user_can()'s 'author' branch (20260702120200_user_can.sql:19-33) with p_user_id in
-- place of auth.uid() — the owner override (owner_id = p_user_id) first, then an active
-- business_members row with role IN ('editor','approver'). RAISES ERRCODE 42501 rather than
-- returning boolean: every caller wants "stop right here" on failure, not a value to branch on.

CREATE OR REPLACE FUNCTION public.assert_plan_proposal_author(p_business_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND owner_id = p_user_id AND deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT m.role INTO v_role
    FROM public.business_members m
   WHERE m.business_id = p_business_id AND m.user_id = p_user_id AND m.status = 'active'
   LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('editor', 'approver') THEN
    RAISE EXCEPTION 'user % lacks author capability on business %', p_user_id, p_business_id
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_plan_proposal_author(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_plan_proposal_author(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_plan_proposal_author(uuid, uuid) TO service_role;

-- ─── apply_brief_proposals (§5.5) ────────────────────────────────────────────
--
-- ONE CALL PER RATIFICATION ROUND ([cr-5], [db-Q3]): the loser is N read-modify-writes of a jsonb
-- column, N version bumps and N re-critiques. request_evidence proposals are accepted (flipped to
-- 'accepted') but change NOTHING in content — there is no evidence-id write surface this session
-- (ruling A-9).
--
-- THE ARRAY-REBUILD ALGORITHM (item g, "re-deriving order from array position"): every original
-- roleSequence entry is resolved ONCE, independent of the others — 'drop' removes it, 'substitute'
-- overrides its role, 'reorder' overrides its SORT KEY (not its final index directly — the final
-- index is re-derived from array position after sorting). Entries untouched by any proposal in this
-- batch keep their OWN original index as their sort key, so they stay in their relative place. This
-- resolves a whole BATCH against the brief's content AS IT WAS READ (a single consistent snapshot,
-- held by the FOR UPDATE lock below) rather than applying proposals one at a time, which would make
-- later proposals' target_order stale the moment an earlier one shifted the array.
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

  -- (e) a stale target_order — the ONLY place this is checkable, since the proposal row itself
  -- cannot know the brief's CURRENT roleSequence length.
  SELECT p.id INTO v_bad_proposal
    FROM public.campaign_plan_proposals p
   WHERE p.id = ANY (p_proposal_ids)
     AND p.brief_id = p_brief_id
     AND p.business_id = p_business_id
     AND p.status = 'pending'
     AND p.target_order >= v_role_seq_len
   LIMIT 1;

  IF v_bad_proposal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'stale_target_order', 'proposalId', v_bad_proposal);
  END IF;

  -- database-reviewer finding (K2.6 pre-commit review, MAJOR): reject a batch containing BOTH a
  -- 'drop' AND a 'substitute'/'reorder' at the SAME target_order. Without this check both would be
  -- flipped to 'accepted' by the UPDATE below, but the array-rebuild's drop-wins semantics (the
  -- 'keep' predicate ignores everything else once an index is dropped) would silently discard the
  -- substitute/reorder's effect — permanently recording "accepted" for a decision that never
  -- actually changed the brief. A typed outcome here forces the caller to re-present the conflict
  -- to the human rather than let the audit trail lie.
  SELECT p.id INTO v_bad_proposal
    FROM public.campaign_plan_proposals p
   WHERE p.id = ANY (p_proposal_ids)
     AND p.brief_id = p_brief_id
     AND p.business_id = p_business_id
     AND p.status = 'pending'
     AND p.kind IN ('substitute', 'reorder')
     AND EXISTS (
       SELECT 1 FROM public.campaign_plan_proposals d
        WHERE d.id = ANY (p_proposal_ids)
          AND d.brief_id = p_brief_id
          AND d.business_id = p_business_id
          AND d.status = 'pending'
          AND d.kind = 'drop'
          AND d.target_order = p.target_order
     )
   LIMIT 1;

  IF v_bad_proposal IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'conflicting_proposals', 'proposalId', v_bad_proposal);
  END IF;

  -- (f) flip exactly the given, still-pending, same-brief ids pending -> accepted. Ids that do not
  -- match (foreign, already-decided, or belonging to a different brief) are silently excluded.
  -- array_agg over the UPDATE's own RETURNING set makes the accepted-id list (and so the loser
  -- count) directly observable — NULL when zero rows matched, normalised to '{}' just below.
  WITH updated AS (
    UPDATE public.campaign_plan_proposals p
       SET status = 'accepted', decided_by = p_user_id, decided_at = now()
     WHERE p.id = ANY (p_proposal_ids)
       AND p.brief_id = p_brief_id
       AND p.business_id = p_business_id
       AND p.status = 'pending'
       AND p.kind IN ('drop', 'substitute', 'reorder', 'request_evidence')
    RETURNING p.id
  )
  SELECT array_agg(id) INTO v_accepted_ids FROM updated;

  IF v_accepted_ids IS NULL THEN
    v_accepted_ids := ARRAY[]::uuid[];
  END IF;

  -- database-reviewer finding (K2.6 pre-commit review, MODERATE): every id in p_proposal_ids was
  -- stale (already decided by a concurrent decide_plan_proposal/supersede call, or simply
  -- foreign) — v_accepted_ids is empty. Without this check the function would fall through to the
  -- version-bumping UPDATE below with an UNCHANGED roleSequence, returning 'outcome: ok' and
  -- bumping version anyway — indistinguishable from a real application to the caller, and capable
  -- of spuriously invalidating a DIFFERENT, legitimate concurrent caller's p_expected_version for
  -- no actual content change. A typed outcome here lets the caller re-read and re-present instead.
  IF array_length(v_accepted_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_proposals_applied');
  END IF;

  -- (g) rebuild roleSequence — request_evidence proposals apply nothing to content (ruling A-9), so
  -- only drop/substitute/reorder among the just-accepted ids participate in the rebuild below.
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
  -- The FOR UPDATE lock above already serialises this against a concurrent caller of THIS function,
  -- so this guarded UPDATE cannot itself return zero rows once the pre-checks above passed — it is
  -- defense in depth (CLAUDE.md's atomic-state-transition convention), not a live race here.
  UPDATE public.campaign_briefs
     SET content = jsonb_set(content, '{roleSequence}', v_new_role_seq), version = p_expected_version + 1, status = 'draft'
   WHERE id = p_brief_id AND business_id = p_business_id AND version = p_expected_version
  RETURNING * INTO v_updated_brief;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'concurrent_edit');
  END IF;

  RETURN jsonb_build_object('outcome', 'ok', 'brief', to_jsonb(v_updated_brief), 'acceptedIds', to_jsonb(v_accepted_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.apply_brief_proposals(uuid, uuid, int, uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_brief_proposals(uuid, uuid, int, uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_brief_proposals(uuid, uuid, int, uuid, uuid[]) TO service_role;

-- ─── decide_plan_proposal (§5.6) — the acknowledge_campaign_retrospective shape ──
--
-- Accepts ONLY 'accepted'/'rejected' — a human can never write 'superseded' (checked by NAME
-- before the UPDATE, so a bad value fails loudly rather than silently matching zero rows and being
-- misread as already_decided). IF NOT FOUND THEN RETURN NULL — the already_decided signal
-- (20260919140000_outcome_rpcs.sql:349-352's precedent), never a raised exception.

CREATE OR REPLACE FUNCTION public.decide_plan_proposal(
  p_business_id  uuid,
  p_proposal_id  uuid,
  p_user_id      uuid,
  p_status       text
)
RETURNS public.campaign_plan_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.campaign_plan_proposals;
BEGIN
  IF p_status NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'decide_plan_proposal: % is not a human-writable status', p_status;
  END IF;

  PERFORM public.assert_plan_proposal_author(p_business_id, p_user_id);

  UPDATE public.campaign_plan_proposals p
     SET status = p_status, decided_by = p_user_id, decided_at = now()
   WHERE p.id = p_proposal_id
     AND p.business_id = p_business_id
     AND p.status = 'pending'
  RETURNING p.* INTO v_row;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_plan_proposal(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decide_plan_proposal(uuid, uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_plan_proposal(uuid, uuid, uuid, text) TO service_role;

-- ─── approve_brief_and_supersede_proposals / revise_brief_and_supersede_proposals (§5.7) ──
--
-- THE GENUINE HOLE: approveBrief/reviseBrief (lib/db/campaign-briefs.ts) are each a SINGLE
-- un-transacted PostgREST UPDATE. If the supersede were a SECOND statement issued afterward from
-- the app layer, the window between them is a window in which a human's decide_plan_proposal call
-- accepts a proposal against an already-frozen (or already-version-advanced) brief: the
-- write-back would then be rejected by the K2.5 legality trigger's write-once guard on a LATER
-- attempt to apply it, and the user watches the proposal read 'accepted' while the brief silently
-- never reflects it. Fix: ONE function body — one transaction — doing the guarded campaign_briefs
-- UPDATE and the supersede UPDATE together. Each function PERFORMs
-- set_config('app.plan_proposal_supersede', 'true', true) (SET LOCAL semantics — scoped to this
-- transaction only, per the K2.5 legality trigger's positive machine-only guard) immediately before
-- its own supersede UPDATE.

CREATE OR REPLACE FUNCTION public.approve_brief_and_supersede_proposals(
  p_business_id uuid,
  p_brief_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_brief public.campaign_briefs;
BEGIN
  UPDATE public.campaign_briefs
     SET status = 'approved', frozen_at = now()
   WHERE id = p_brief_id AND business_id = p_business_id AND status = 'critiqued' AND deleted_at IS NULL
  RETURNING * INTO v_updated_brief;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid_state');
  END IF;

  PERFORM set_config('app.plan_proposal_supersede', 'true', true);
  UPDATE public.campaign_plan_proposals
     SET status = 'superseded', superseded_reason = 'brief_frozen'
   WHERE brief_id = p_brief_id AND business_id = p_business_id AND status = 'pending';

  RETURN jsonb_build_object('outcome', 'ok', 'brief', to_jsonb(v_updated_brief));
END;
$$;

REVOKE ALL ON FUNCTION public.approve_brief_and_supersede_proposals(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_brief_and_supersede_proposals(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_brief_and_supersede_proposals(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revise_brief_and_supersede_proposals(
  p_business_id      uuid,
  p_brief_id         uuid,
  p_expected_version int,
  p_content          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_brief public.campaign_briefs;
BEGIN
  UPDATE public.campaign_briefs
     SET status = 'draft', version = p_expected_version + 1, content = p_content
   WHERE id = p_brief_id AND business_id = p_business_id AND status = 'critiqued'
     AND version = p_expected_version AND deleted_at IS NULL
  RETURNING * INTO v_updated_brief;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'concurrent_edit');
  END IF;

  PERFORM set_config('app.plan_proposal_supersede', 'true', true);
  UPDATE public.campaign_plan_proposals
     SET status = 'superseded', superseded_reason = 'version_advanced'
   WHERE brief_id = p_brief_id AND business_id = p_business_id AND status = 'pending';

  RETURN jsonb_build_object('outcome', 'ok', 'brief', to_jsonb(v_updated_brief));
END;
$$;

REVOKE ALL ON FUNCTION public.revise_brief_and_supersede_proposals(uuid, uuid, int, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revise_brief_and_supersede_proposals(uuid, uuid, int, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revise_brief_and_supersede_proposals(uuid, uuid, int, jsonb) TO service_role;

-- ─── ai_budget_daily purpose CHECK — add 'planner_cents' (§7.4, ruling A-6) ──
--
-- Looked up in pg_constraint BY ITS DEFINITION (never a guessed name), copying
-- 20260913130000_social_backfill_runs_and_posts.sql:293-330 line for line: a wrong
-- DROP CONSTRAINT IF EXISTS guess would silently no-op, leave the old CHECK in place, and reject
-- every planner_cents write. RAISES unless exactly one row matches. purpose is ALREADY NOT NULL
-- (20260909110000:57-62) — the "a new CHECK needs a NOT NULL companion" rule does not bite here.

DO $$
DECLARE
  v_conname text;
  v_count   int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'ai_budget_daily'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%purpose%';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ai_budget_daily purpose CHECK lookup found % row(s) by definition, expected exactly 1', v_count;
  END IF;

  SELECT c.conname INTO v_conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'ai_budget_daily'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%purpose%';

  EXECUTE format('ALTER TABLE public.ai_budget_daily DROP CONSTRAINT %I', v_conname);
END $$;

ALTER TABLE public.ai_budget_daily
  ADD CONSTRAINT ai_budget_daily_purpose_check
    CHECK (purpose IN ('triage_cents', 'generation_posts', 'backfill_cents', 'planner_cents'));

-- ─── reserve_ai_budget — THE FIRST-CALL-OF-DAY CAP BUG (discovered writing K2.6's ai-budget-
-- purpose.test.ts edit, the case the guide names as "the FIRST-CALL-OF-DAY CASE that caught ADR
-- 0021's [db-BLOCKER-1]") ─────────────────────────────────────────────────────────────────────
--
-- 20260909110000_ai_budget_daily_rename.sql's reserve_ai_budget guards the cap ONLY on the
-- `ON CONFLICT ... DO UPDATE ... WHERE reserved_units + p_units <= p_cap` branch. That WHERE
-- clause governs the UPDATE path alone — Postgres never evaluates it for a plain INSERT with no
-- existing conflicting row. Confirmed live before this fix: a FRESH business/purpose/day with NO
-- prior row, reserving p_units=500 against p_cap=300, SUCCEEDS and writes reserved_units=500 — the
-- very case this guide names as ADR 0021's already-caught [db-BLOCKER-1], apparently regressed (or
-- never actually closed at the RPC level) somewhere between then and now. This affects ALL FOUR
-- purposes sharing this one function, not just the new planner_cents value K2.6 adds — a business's
-- very first AI action of the day, of any kind, could reserve unboundedly past its daily cap.
--
-- FIX: the INSERT's source rows are now a guarded SELECT (`SELECT ... WHERE p_units <= p_cap`)
-- rather than a bare VALUES list. When the guard fails, the SELECT contributes ZERO rows to
-- insert, so ON CONFLICT never even evaluates (there is nothing to conflict), and the function
-- returns zero rows — the exact "refused, not retried, never an error" contract every caller
-- (lib/db/signal-triage-budget.ts, lib/db/generation-budget.ts, lib/db/backfill-budget.ts,
-- lib/db/planner-budget.ts) already relies on for a denied reservation. The DO UPDATE branch and
-- its own guard are UNCHANGED — this closes only the previously-unguarded INSERT path, verified
-- live for both a same-day-under-cap success and a same-day-over-cap-on-the-update-branch refusal
-- before this migration was written (see the K2.6 commit body for the transcript).

CREATE OR REPLACE FUNCTION public.reserve_ai_budget(
  p_business_id uuid,
  p_purpose     text,
  p_units       integer,
  p_cap         integer
)
RETURNS SETOF public.ai_budget_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.ai_budget_daily (business_id, purpose, day, reserved_units)
  SELECT p_business_id, p_purpose, (now() AT TIME ZONE 'utc')::date, p_units
   WHERE p_units <= p_cap
  ON CONFLICT (business_id, purpose, day) DO UPDATE
     SET reserved_units = public.ai_budget_daily.reserved_units + p_units
   WHERE public.ai_budget_daily.reserved_units + p_units <= p_cap
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) TO service_role;
