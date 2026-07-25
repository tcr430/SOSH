-- ADR 0017 §2, §3, §11 — Mode 2 Upgrade (Track B / Session 24 B2.0)
--
-- Three additive changes, one new table:
--   1. campaign_briefs — the brief artifact (§2.1), RLS + cascade (§2.5),
--      frozen_at guard trigger (§2.4/§5.2).
--   2. campaigns.origin — full three-value enum shipped now, backfilled to
--      'objective_generated' (§3.1, [db-MAJOR-3]).
--   3. posts.role — nullable campaign post-role vocabulary, write-once via
--      DB trigger (§3.2, [db-MAJOR-2]).
--   4. campaigns.status — extended with 'awaiting_brief' (§11, [db-MINOR-1]).
--
-- All new/extended CHECK constraints use the NOT VALID / VALIDATE CONSTRAINT
-- low-lock pattern ([db-MINOR-1]) rather than a naive drop/add that holds
-- ACCESS EXCLUSIVE through a full validation scan.
--
-- MODE2-ACTIVATE-GUARD-MIGRATED ([db-BLOCKER-1]): generate.ts's final atomic
-- guard changes from .eq('status','draft') to .eq('status','awaiting_brief')
-- in a LATER session step (B2.6), not here. This migration proves — not
-- assumes — that no campaign is stranded by that future change: it asserts
-- zero live 'draft' campaigns exist today (Track B is pre-launch, Phase 1
-- MVP, so the expected count is zero). A nonzero count fails the migration
-- loudly so it can be triaged by hand rather than silently orphaning rows.

-- ─── campaign_briefs (ADR §2.1) ─────────────────────────────────────────────

CREATE TABLE public.campaign_briefs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id    uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  content        jsonb       NOT NULL,
  status         text        NOT NULL
                   CHECK (status IN ('draft', 'critiqued', 'approved', 'generated')),
  version        int         NOT NULL DEFAULT 1 CHECK (version >= 1),
  overall_score  numeric     CHECK (overall_score >= 0 AND overall_score <= 100),
  critique       jsonb,
  frozen_at      timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- UNIQUE(campaign_id) enforces the 1:1 brief-per-campaign invariant
  -- ([db-MAJOR-1] — a bare FK does not) and IS the by-campaign lookup index,
  -- so no separate (campaign_id) index is created.
  CONSTRAINT campaign_briefs_campaign_id_key UNIQUE (campaign_id)
);

-- Partial retrieval index, matching the governed-memory convention
-- ([db-MINOR-2], governed_memory.sql:52-54).
CREATE INDEX campaign_briefs_business_id_status_idx
  ON public.campaign_briefs (business_id, status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_campaign_briefs_updated_at
BEFORE UPDATE ON public.campaign_briefs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaign_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_briefs_select_own
  ON public.campaign_briefs FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY campaign_briefs_insert_own
  ON public.campaign_briefs FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY campaign_briefs_update_own
  ON public.campaign_briefs FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY campaign_briefs_delete_own
  ON public.campaign_briefs FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- frozen_at guard (§2.4/§5.2, [type-5]): once frozen_at is set, content is
-- immutable. This is what actually stops a concurrent edit from mutating the
-- brief mid-batch across the N per-platform generation calls — a TS
-- `readonly` cannot enforce this, only the DB can.
CREATE OR REPLACE FUNCTION public.enforce_campaign_brief_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL AND NEW.content IS DISTINCT FROM OLD.content THEN
    RAISE EXCEPTION 'campaign_briefs.content cannot change once frozen_at is set (brief %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_campaign_brief_frozen
  BEFORE UPDATE ON public.campaign_briefs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_brief_frozen();

-- ─── campaigns.origin (ADR §3.1, Q3) ────────────────────────────────────────
--
-- Full three-value enum shipped now (forward-compat, one migration); Track B
-- only ever produces 'objective_generated'. 'manual' (Mode 1) and
-- 'signal_generated' (Mode 3) are reserved, same posture as the unimplemented
-- 'agency' plan value.
--
-- ADD COLUMN ... DEFAULT backfills every existing row (they *were*
-- objective-generated) as a metadata-only operation on PG12+; the default is
-- then dropped so every future INSERT must state origin explicitly
-- ([db-MAJOR-3]) — CampaignInsert.origin becomes required in lib/db/types.ts.

ALTER TABLE public.campaigns
  ADD COLUMN origin text NOT NULL DEFAULT 'objective_generated';

ALTER TABLE public.campaigns
  ALTER COLUMN origin DROP DEFAULT;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_origin_check
    CHECK (origin IN ('manual', 'objective_generated', 'signal_generated'))
    NOT VALID;

ALTER TABLE public.campaigns
  VALIDATE CONSTRAINT campaigns_origin_check;

-- ─── posts.role (ADR §3.2, Q2) ──────────────────────────────────────────────
--
-- The campaign POST-ROLE vocabulary (L-5) — distinct from the thread-internal
-- tweet-role (hook|body|pull_quote|close, L-4), which lives inside the thread
-- format-family JSON and never touches this column. NULLABLE: existing rows
-- predate roles and get no fabricated arc ([db-MAJOR-2] backfill decision).
--
-- Write-once is enforced at TWO layers: PostUpdate excludes 'role' from its
-- mutable Omit set (lib/db/types.ts) AND this DB trigger rejects a role
-- change once set. App-layer exclusion alone is insufficient because the
-- service-role orchestrator (generate.ts) writes outside the PostUpdate type
-- and bypasses RLS.

ALTER TABLE public.posts
  ADD COLUMN role text;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_role_check
    CHECK (role IN (
      'anchor_thesis', 'founder_perspective', 'customer_proof',
      'objection_response', 'conversation_starter', 'follow_up'
    ))
    NOT VALID;

ALTER TABLE public.posts
  VALIDATE CONSTRAINT posts_role_check;

CREATE OR REPLACE FUNCTION public.enforce_post_role_write_once()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND OLD.role IS NOT NULL THEN
    RAISE EXCEPTION 'posts.role is write-once and cannot change after it is set (post %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_post_role_write_once
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_role_write_once();

-- ─── campaigns.status += 'awaiting_brief' (ADR §11, [db-MINOR-1]) ──────────
--
-- The pause point between brief assembly (Stage A-C) and generation
-- (Stage D-F). NOT VALID / VALIDATE rather than a naive drop/add.
--
-- Constraint name is Postgres's default auto-name for the inline column
-- CHECK declared in 20260430120009_campaigns.sql:23-24
-- (`status text NOT NULL DEFAULT 'draft' CHECK (status IN (...))`).

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'awaiting_brief', 'active', 'paused', 'completed'))
    NOT VALID;

ALTER TABLE public.campaigns
  VALIDATE CONSTRAINT campaigns_status_check;

-- ─── MODE2-ACTIVATE-GUARD-MIGRATED stuck-row assert ([db-BLOCKER-1]) ───────
--
-- generate.ts's final atomic guard is changed from .eq('status','draft') to
-- .eq('status','awaiting_brief') in a later Builder step (B2.6). That change
-- is behavioral, not additive: any campaign already sitting in 'draft' at
-- that deploy (created under the old one-shot flow, never routed through
-- brief assembly) would fail the new guard forever. Prove — don't assume —
-- that zero such campaigns exist as of this migration.

DO $$
DECLARE
  stuck_draft_count int;
BEGIN
  SELECT count(*) INTO stuck_draft_count
    FROM public.campaigns
   WHERE status = 'draft' AND deleted_at IS NULL;

  IF stuck_draft_count > 0 THEN
    RAISE EXCEPTION
      'MODE2-ACTIVATE-GUARD-MIGRATED: % campaign(s) in status=draft at migration time. '
      'generate.ts''s guard moves from draft to awaiting_brief in session-24 B2.6; these '
      'rows must be backfilled a draft brief in awaiting_brief state or transitioned '
      'through the new path BEFORE that step ships, per ADR 0017 §11.',
      stuck_draft_count;
  END IF;
END;
$$;
