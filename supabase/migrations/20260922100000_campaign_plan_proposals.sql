-- Migration: campaign_plan_proposals, its legality trigger, the two campaign_briefs columns
-- (ADR 0027 §3.3, §5.3, §5.6, §8.5, §9.1-9.3 — Session 34 K2.5)
--
-- WHAT THIS ADDS
--   campaign_plan_proposals   one row per planner-proposed brief change (drop / substitute /
--                             reorder / request_evidence), decided only through the K2.6 RPCs.
--   campaign_briefs           two new columns recording whether/why the planner ran.
--
-- INVARIANTS (each has a Tier-1 test in supabase/__tests__/plan-proposals-*.test.ts)
--   * kind AND status ARE NOT NULL, checked by NAME, never a bare `text CHECK (x IN (...))`
--     that would silently admit NULL (an IN test against NULL is neither true nor false, so a
--     bare CHECK never rejects it — the standing rule this migration follows, not rediscovers).
--   * ONE PER-KIND TABLE-LEVEL CHECK (not jsonb): substitute requires proposed_role and forbids
--     proposed_order; reorder the inverse; drop and request_evidence forbid both.
--   * proposed_role IS RESTRICTED TO THE IDENTICAL SIX-VALUE VOCABULARY AS posts_role_check
--     (20260722190000_mode2_brief_and_roles.sql) — a role a human accepts here must be one
--     generation-time posts.role can later accept.
--   * A PARTIAL UNIQUE on (brief_id, brief_version, kind, target_order) WHERE status = 'pending':
--     a second planner run must not silently double the list a human reads. Decided history
--     (accepted/rejected/superseded) survives past the partial index — only 'pending' collides.
--   * NO deleted_at. Proposals are the decision audit, not soft-deletable. A pending proposal is
--     SUPERSEDED (never expired) the moment its brief version advances or freezes — no reaper.
--   * THE LEGALITY TRIGGER (BEFORE UPDATE, never BEFORE DELETE — a BEFORE DELETE trigger fires
--     on FK-cascade deletes too and would abort GDPR erasure, the standing ADR 0018 lesson):
--       (1) terminal is terminal — accepted/rejected/superseded -> anything else raises;
--       (2) 'superseded' is machine-only, enforced POSITIVELY, not merely by grant absence: a
--           transition to 'superseded' is rejected unless the session-local flag
--           app.plan_proposal_supersede is set to 'true' — set (via SET LOCAL, so it cannot leak
--           past the enclosing transaction) by the K2.6 freeze/version-advance RPC immediately
--           before its own UPDATE. A direct admin/service-role UPDATE (the case
--           `authenticated` grant absence alone does not cover, since service-role bypasses
--           grants and RLS both) cannot set this flag and is rejected here;
--       (3)+(4) decided_at set IFF status IN ('accepted','rejected'), NULL for 'superseded' — a
--           pure same-row property, expressed as a table CHECK below rather than duplicated in
--           the trigger. decided_by is deliberately NOT required by that CHECK: it is
--           ON DELETE SET NULL (§9.3), and requiring it NOT NULL for an 'accepted' row would
--           make the FK's own SET NULL action illegal the instant it fired;
--       (5) PAYLOAD WRITE-ONCE on reason, kind, target_order, proposed_role, proposed_order,
--           brief_id, brief_version, business_id and planner_run_id (the
--           enforce_post_role_write_once shape) — a decided row's payload cannot be rewritten
--           after the fact, or the audit trail is worthless.
--   * RLS — the outcome_tables.sql posture (post_dimensions/post_outcomes/campaign_retrospectives),
--     NOT governed_memory's four-policy any-member-CRUD block: ONE SELECT policy, InitPlan form;
--     no authenticated INSERT/UPDATE/DELETE/TRUNCATE grant at all (decide/apply/supersede all go
--     through SECURITY DEFINER RPCs, K2.6); service-role INSERT only (the planner orchestrator,
--     K2.7); NO DELETE policy (the 20260919160000_outcome_delete_guard.sql lesson: a DELETE
--     policy on an audit-shaped table is a standing hazard, not a convenience).
--   * GDPR (L-8). Cascades from businesses (and independently from campaign_briefs, campaigns)
--     ON DELETE CASCADE. The ADR 0010 Amendment 2 §D2.5 row ships in the SAME commit as this
--     file. purge_business needs no change — the root DELETE FROM public.businesses cascade
--     suffices, the same posture as every other ADR 0026 outcome-loop table.

-- ─── campaign_plan_proposals (§5.3, §9.1) ────────────────────────────────────

CREATE TABLE public.campaign_plan_proposals (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  brief_id           uuid        NOT NULL,
  campaign_id        uuid        NOT NULL,
  brief_version      int         NOT NULL CHECK (brief_version >= 1),
  kind               text        NOT NULL,
  target_order       int         NOT NULL CHECK (target_order >= 0),
  -- Restricted to the IDENTICAL six-value vocabulary as posts_role_check
  -- (20260722190000_mode2_brief_and_roles.sql:135-141) — a role a human accepts here must be one
  -- generation-time posts.role can later accept, or the acceptance is a dead end one stage late.
  proposed_role      text,
  proposed_order     int         CHECK (proposed_order IS NULL OR proposed_order >= 0),
  -- NOT NULL does not exclude the empty string — the length floor is deliberate, not decorative.
  reason             text        NOT NULL,
  status             text        NOT NULL DEFAULT 'pending',
  superseded_reason  text,
  -- The ai_usage row the spend belongs to, and the model that produced this proposal ([db-MAJOR-B]).
  planner_run_id     uuid        NOT NULL,
  model              text        NOT NULL,
  decided_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaign_plan_proposals_brief_id_fkey
    FOREIGN KEY (brief_id) REFERENCES public.campaign_briefs(id) ON DELETE CASCADE,
  CONSTRAINT campaign_plan_proposals_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE,

  CONSTRAINT campaign_plan_proposals_kind_check
    CHECK (kind IN ('drop', 'substitute', 'reorder', 'request_evidence')),
  CONSTRAINT campaign_plan_proposals_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  CONSTRAINT campaign_plan_proposals_superseded_reason_check
    CHECK (superseded_reason IS NULL OR superseded_reason IN ('version_advanced', 'brief_frozen')),
  CONSTRAINT campaign_plan_proposals_proposed_role_check
    CHECK (proposed_role IS NULL OR proposed_role IN (
      'anchor_thesis', 'founder_perspective', 'customer_proof',
      'objection_response', 'conversation_starter', 'follow_up'
    )),
  CONSTRAINT campaign_plan_proposals_reason_length_check
    CHECK (char_length(reason) BETWEEN 1 AND 1000),

  -- ONE PER-KIND TABLE-LEVEL CHECK, not jsonb — a table-level CHECK sees the whole row at
  -- INSERT/UPDATE (the insight_cards.dismiss_reason shape); three typed scalars is exactly the
  -- case where jsonb would be the wrong tool.
  CONSTRAINT campaign_plan_proposals_payload_shape_check
    CHECK (
      (kind = 'substitute' AND proposed_role IS NOT NULL AND proposed_order IS NULL)
      OR (kind = 'reorder' AND proposed_role IS NULL AND proposed_order IS NOT NULL)
      OR (kind IN ('drop', 'request_evidence') AND proposed_role IS NULL AND proposed_order IS NULL)
    ),

  -- decided_at set IFF status IN ('accepted','rejected'); NULL otherwise (including
  -- 'superseded' — a machine transition records no deciding human). decided_by is NOT required
  -- by this CHECK, deliberately: it is ON DELETE SET NULL (§9.3 — deleting the deciding
  -- auth.users row must leave the proposal INTACT, decided_by NULL, status UNCHANGED), and a
  -- CHECK requiring decided_by IS NOT NULL for an already-'accepted' row would make that FK
  -- action itself illegal the moment it fired. decided_at is the permanent, FK-independent proof
  -- a decision happened; decided_by is best-effort attribution that may later go missing.
  CONSTRAINT campaign_plan_proposals_decided_pairing_check
    CHECK (
      (status IN ('accepted', 'rejected') AND decided_at IS NOT NULL)
      OR (status NOT IN ('accepted', 'rejected') AND decided_by IS NULL AND decided_at IS NULL)
    )
);

-- BACKFILL-ONCE-PER-SLOT shape: a second planner run for the same (brief_id, brief_version,
-- kind, target_order) must not double the pending list a human reviews. Partial-on-pending —
-- decided history is never touched by this constraint. Postgres has no partial UNIQUE
-- CONSTRAINT syntax, so the arbiter is this index directly (the social_backfill_runs_live_
-- account_uq precedent, 20260913130000_social_backfill_runs_and_posts.sql:48-49).
CREATE UNIQUE INDEX campaign_plan_proposals_pending_slot_uq
  ON public.campaign_plan_proposals (brief_id, brief_version, kind, target_order)
  WHERE status = 'pending';

-- ─── Indexes (§8.5) — three, because the first cannot serve the other two jobs ──

-- The partial review index — mirrors insight_cards_feed_idx, tie-broken by id for stable
-- pagination.
CREATE INDEX campaign_plan_proposals_review_idx
  ON public.campaign_plan_proposals (brief_id, brief_version, target_order, created_at, id)
  WHERE status = 'pending';

-- The bare-FK index (the insight_cards.sql MODERATE-2 lesson): NOT covered by the review index
-- above (that index's leading column is brief_id, not business_id) — needed for the cascade
-- delete and any non-pending read.
CREATE INDEX campaign_plan_proposals_business_id_idx
  ON public.campaign_plan_proposals (business_id);

-- FK index: deleting an auth user (SET NULL) must not seq-scan the table. Verbatim
-- campaign_retrospectives_acknowledged_by_idx shape.
CREATE INDEX campaign_plan_proposals_decided_by_idx
  ON public.campaign_plan_proposals (decided_by) WHERE decided_by IS NOT NULL;

-- brief_id's own FK index is covered by the review index's leading column (brief_id) — no
-- separate (brief_id) index is created, the same convention campaign_briefs and insight_cards
-- both follow.

CREATE TRIGGER trg_campaign_plan_proposals_updated_at
BEFORE UPDATE ON public.campaign_plan_proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS (§9.2) — the outcome_tables.sql posture, NOT governed_memory's block ──

ALTER TABLE public.campaign_plan_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_plan_proposals_select_own
  ON public.campaign_plan_proposals FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- Defence in depth: no write privilege for anon/authenticated at all. New public tables get
-- default ALL grants INCLUDING TRUNCATE; the resulting denial without this REVOKE is 42501,
-- which is never retried, so this is a correctness requirement, not belt-and-braces.
REVOKE ALL ON public.campaign_plan_proposals FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.campaign_plan_proposals FROM authenticated;
-- SELECT stays available to `authenticated` per the default grant + the RLS policy above.

-- NO DELETE policy at all (20260919160000_outcome_delete_guard.sql lesson) — decided history is
-- the audit trail and survives past a brief's own lifecycle.

-- ─── The legality trigger (§5.6) — BEFORE UPDATE only, NEVER BEFORE DELETE ──

CREATE OR REPLACE FUNCTION public.enforce_campaign_plan_proposal_legal_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- (1) terminal is terminal.
  IF OLD.status IN ('accepted', 'rejected', 'superseded') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'campaign_plan_proposals.status transition % -> % is not permitted (ADR 0027 §5.6, proposal %)', OLD.status, NEW.status, OLD.id;
  END IF;

  -- (2) 'superseded' is MACHINE-ONLY, enforced positively here (not just by grant absence): the
  -- K2.6 freeze/version-advance RPC sets this session-local flag immediately before its
  -- UPDATE ... SET status = 'superseded' statement (SET LOCAL, so it never leaks past the
  -- enclosing transaction). A direct UPDATE — including one issued by a human via a raw
  -- service-role script, or an attacker who somehow reached an authenticated UPDATE despite the
  -- missing grant — cannot set this flag and is rejected here.
  IF NEW.status = 'superseded' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF coalesce(current_setting('app.plan_proposal_supersede', true), 'false') <> 'true' THEN
      RAISE EXCEPTION 'campaign_plan_proposals transition to superseded must go through the supersede RPC (ADR 0027 §5.6/§5.7, proposal %)', OLD.id;
    END IF;
  END IF;

  -- (5) PAYLOAD WRITE-ONCE — a decided (or otherwise updated) row's proposal content cannot be
  -- rewritten after the fact, mirroring enforce_post_role_write_once's shape.
  IF NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.target_order IS DISTINCT FROM OLD.target_order
    OR NEW.proposed_role IS DISTINCT FROM OLD.proposed_role
    OR NEW.proposed_order IS DISTINCT FROM OLD.proposed_order
    OR NEW.brief_id IS DISTINCT FROM OLD.brief_id
    OR NEW.brief_version IS DISTINCT FROM OLD.brief_version
    OR NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.planner_run_id IS DISTINCT FROM OLD.planner_run_id
  THEN
    RAISE EXCEPTION 'campaign_plan_proposals payload columns are write-once and cannot change after creation (proposal %)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_campaign_plan_proposal_legal_transition
  BEFORE UPDATE ON public.campaign_plan_proposals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_plan_proposal_legal_transition();

-- ─── campaign_briefs gains two columns (§3.3) ────────────────────────────────
--
-- THE DEFAULT IS 'not_run', NEVER 'ok'. If the default were 'ok', every row written by any
-- existing or future path would masquerade as successfully analysed and no amount of Tier-2
-- testing would recover it — the single highest-value assertion in this migration.
-- campaign_briefs is ALREADY in the §D2.5 cascade table — no new row is owed for it (a new
-- COLUMN on an existing cascaded table, not a new table, the 20260904100000 precedent).

ALTER TABLE public.campaign_briefs
  ADD COLUMN plan_analysis_status text NOT NULL DEFAULT 'not_run',
  ADD COLUMN plan_analysis_reason text;

ALTER TABLE public.campaign_briefs
  ADD CONSTRAINT campaign_briefs_plan_analysis_status_check
    CHECK (plan_analysis_status IN ('not_run', 'ok', 'unavailable', 'capped'));
