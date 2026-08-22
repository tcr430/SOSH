-- ADR 0022 §2.3, §3.1, §12.2 — Studio "promote-to-campaign" schema
-- (Session 29, Track F, F1b.1). ADR 0017 Amendment B (campaigns.origin) and
-- ADR 0019 Amendment A.1 (studio_drafts columns).
--
-- Two additive changes, no new table:
--   1. campaigns_origin_check widens to a FOURTH value, 'studio_promoted'
--      (ADR 0017 §3.1 amendment, ADR 0022 §2.3).
--   2. studio_drafts gains three nullable columns carrying the promote
--      transition (ADR 0019 §2.6 Amendment A.1, ADR 0022 §3.1, §4.2).
--
-- Backfill: NONE for either change, stated explicitly (L-12):
--   - The origin CHECK widening admits a new value; every existing row is
--     already 'manual', 'objective_generated' or 'signal_generated' and
--     satisfies the wider constraint unchanged — nothing to backfill.
--   - The three new studio_drafts columns are all NULL for every existing
--     row, and that is correct, not a gap: no draft has ever been promoted
--     before this migration exists, so there is no legitimate non-NULL
--     value to backfill any of them with (mirrors the insight_cards
--     campaign_id precedent, 20260814220000_insight_card_campaign_id.sql).
--
-- ADR 0010 Amendment 2 §D2.5: NO new cascade row required (ADR 0022 §12.2).
-- All three new columns land on studio_drafts, an ALREADY-COVERED table
-- whose own cascade row exists and whose business_id already carries
-- ON DELETE CASCADE from businesses (20260730100000_studio_drafts.sql:17).
-- CLAUDE.md's erasure-cascade rule is about a table gaining reachability
-- from businesses for the first time, not about columns added to a table
-- already reachable — the Session 28-D D7 insight_cards.campaign_id
-- precedent settles this case exactly the same way. purge_business needs
-- no edit for the same reason.

-- ─── campaigns.origin += 'studio_promoted' (ADR 0017 Amd B, ADR 0022 §2.3) ──
--
-- Widening an EXISTING named CHECK, not creating a new one — mirrors
-- campaigns_status_check's own widening at 20260722190000:170-179 (DROP
-- CONSTRAINT IF EXISTS, then re-ADD NOT VALID, then VALIDATE as a separate
-- statement), rather than the origin check's original creation at :112-118
-- (which had no prior constraint to drop). The NOT VALID / VALIDATE
-- low-lock sequencing itself is identical to both precedents.

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_origin_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_origin_check
    CHECK (origin IN ('manual', 'objective_generated', 'signal_generated', 'studio_promoted'))
    NOT VALID;

ALTER TABLE public.campaigns
  VALIDATE CONSTRAINT campaigns_origin_check;

-- No DEFAULT is (re)introduced — origin is deliberately non-defaulted since
-- 20260722190000_mode2_brief_and_roles.sql:109-110 so every INSERT states
-- its origin explicitly ([db-MAJOR-3]); this migration does not disturb
-- that.

-- ─── studio_drafts += promote columns (ADR 0019 Amd A.1, ADR 0022 §3.1/§4.2) ──

ALTER TABLE public.studio_drafts
  -- The claim (§3.1): atomically claimed with a conditional UPDATE guarded
  -- on promotion_claimed_at IS NULL, before createCampaign runs (F1b.3).
  -- Nullable: unclaimed is the default/steady state for every draft.
  ADD COLUMN promotion_claimed_at timestamptz NULL,
  -- The result (§3.1): written back immediately after createCampaign,
  -- itself guarded on promoted_campaign_id IS NULL. A directional,
  -- single-purpose FK ("this draft became this campaign") — not a bare
  -- campaign_id, deliberately (§13.3) — superseding ADR 0019's A-4 refusal
  -- of a draft->campaign FK now that promote is a real, day-one consumer.
  -- ON DELETE SET NULL, not CASCADE: deleting the campaign must not delete
  -- the draft it came from.
  ADD COLUMN promoted_campaign_id uuid NULL REFERENCES public.campaigns(id) ON DELETE SET NULL,
  -- The retained accepted-suggestion revision (§4.2): studio_drafts has no
  -- column holding the accepted AI-generated revision separately from
  -- content (it is merged into content on accept) — ADR 0019 §2.6's
  -- original plan to snapshot "the accepted-suggestion revision" into
  -- post_ai_originals at promote time is not implementable without this
  -- column. NULL when the draft was never suggested-on (human-authored,
  -- no AI baseline exists); promote then writes no post_ai_originals
  -- snapshot at all, per §4.2's corollary — a snapshot is written if and
  -- only if a genuine model-generated baseline exists here.
  ADD COLUMN accepted_revision text NULL;

-- No new RLS policy. studio_drafts_select_own / _insert_own / _update_own /
-- _delete_own (20260730100000_studio_drafts.sql:71-86) are column-agnostic
-- — each gates on business_id alone via USING (and, for INSERT/UPDATE,
-- WITH CHECK) — so they apply to the widened row shape unchanged. No
-- BEFORE DELETE trigger is added, for the same reason none exists on this
-- table today (20260730100000_studio_drafts.sql:88-96): it would abort
-- GDPR erasure identically on an FK-cascade delete and a direct one.

-- No index on promoted_campaign_id. No query in this codebase looks up a
-- studio_drafts row BY promoted_campaign_id (the direction of lookup is
-- always draft -> campaign, by draft id); the existing
-- studio_drafts_business_id_updated_at_idx partial index already serves
-- every list query this table supports. Mirrors the insight_cards.campaign_id
-- precedent's same no-index decision (20260814220000_insight_card_campaign_id.sql:38-44).
