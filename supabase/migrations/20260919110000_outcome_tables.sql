-- Migration: the outcome loop's three business-scoped tables and the tagging trigger
-- (ADR 0026 §4.2, §6.1, §8.3, §11 — Session 33 J2.3)
--
-- WHAT THIS ADDS
--   post_dimensions         one immutable row per AI authorship event (post_ai_originals),
--                           filled by an AFTER INSERT trigger — never by application code.
--   post_outcomes           one immutable row per post: the day-7 frozen outcome (written by
--                           the service-role worker, J2.7/J2.8).
--   campaign_retrospectives one row per campaign: the verdict on its hypothesis (written by
--                           the worker, transitioned only by the acknowledge RPC, J2.10).
--
-- INVARIANTS (each has a Tier-1 test in supabase/__tests__/outcome-*.test.ts)
--   * TAG AT GENERATION, NEVER AFTER (L-4). post_dimensions is written ONLY by
--     public.tag_post_dimensions() (below) and by ONE history-copy migration
--     (20260919120000). Tagging attaches to the ARTEFACT (post_ai_originals), not to a
--     function, so every present and future creator of an AI post — generatePostsForCampaign,
--     the regenerate action, Studio promote — is tagged without being enumerated. Human-written
--     posts have no snapshot and get no row; that is correct. Imports are never tagged.
--   * THE TRIGGER IS TOTAL BY CONSTRUCTION. Reads, then ONE INSERT ... ON CONFLICT DO NOTHING
--     into nullable columns. Every enum column is sanitised (an out-of-vocabulary value becomes
--     NULL, never a CHECK violation), so missing or odd data can never abort the generation
--     that fired it. There is deliberately NO EXCEPTION block: a genuine defect must fail
--     loudly rather than silently untag.
--   * WRITE-ONCE. A BEFORE UPDATE trigger rejects every UPDATE on post_dimensions and
--     post_outcomes, service-role included. There is NO BEFORE DELETE trigger on ANY of the
--     three tables (ADR 0018 [db-BLOCKER-1]): a child BEFORE DELETE trigger fires on FK cascades
--     and would abort purge_business. campaign_retrospectives has no write-once trigger by
--     design: it transitions completed -> acknowledged through the RPC, and its
--     acknowledged_by FK is ON DELETE SET NULL (an UPDATE a write-once trigger would abort).
--   * GDPR (L-8). Each table cascades from businesses ON DELETE CASCADE (redundant cascades via
--     post/campaign/ai_original are defence in depth). The three ADR 0010 Amendment 2 §D2.5
--     rows ship in the SAME commit as this file. purge_business needs no change.
--   * RLS. One SELECT policy each, InitPlan form. NO authenticated INSERT/UPDATE/DELETE policy —
--     writes are the DEFINER trigger, the service-role worker and the acknowledge RPC. As
--     defence in depth the write privileges are also REVOKEd from anon/authenticated (RLS does
--     not govern TRUNCATE, and a permissive policy added later must not silently open a write
--     path).
--
-- proof_type (founder ruling on ADR gap D2, 2026-09-19): the frozen brief's pinnedEvidence
-- carries evidence ids, not kinds, so the kind is read from evidence_memory by id, scoped to
-- the same business. Empty pinned set -> 'none'; one distinct kind -> that kind; MIXED kinds,
-- or no pinned entry resolving, or no frozen brief -> NULL (the column holds one value and
-- silently picking one of several would invent a fact). proof_type is descriptive-only and is
-- never promoted (ADR 0026 §4.1).

-- ─── post_dimensions (ADR 0026 §4.2) ─────────────────────────────────────────

CREATE TABLE public.post_dimensions (
  ai_original_id    uuid        PRIMARY KEY REFERENCES public.post_ai_originals(id) ON DELETE CASCADE,
  business_id       uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  post_id           uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  campaign_id       uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  platform          text        NOT NULL,
  taxonomy_version  int         NOT NULL CHECK (taxonomy_version >= 1),
  role              text        CHECK (role IS NULL OR role IN (
                      'anchor_thesis', 'founder_perspective', 'customer_proof',
                      'objection_response', 'conversation_starter', 'follow_up')),
  format            text        CHECK (format IS NULL OR format IN ('single', 'thread', 'carousel')),
  origin_mode       text        CHECK (origin_mode IS NULL OR origin_mode IN (
                      'manual', 'objective_generated', 'signal_generated', 'studio_promoted')),
  hook_type         text        CHECK (hook_type IS NULL OR hook_type IN (
                      'question', 'statistic', 'contrarian', 'story', 'announcement', 'how_to')),
  proof_type        text        CHECK (proof_type IS NULL OR proof_type IN (
                      'none', 'quote', 'case_study', 'usage_data', 'other')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX post_dimensions_post_id_idx         ON public.post_dimensions (post_id);
CREATE INDEX post_dimensions_campaign_id_idx     ON public.post_dimensions (campaign_id);
CREATE INDEX post_dimensions_business_platform_idx ON public.post_dimensions (business_id, platform);

-- ─── post_outcomes (ADR 0026 §6.1) ───────────────────────────────────────────

CREATE TABLE public.post_outcomes (
  post_id           uuid        PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  business_id       uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id       uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  platform          text        NOT NULL,
  published_at      timestamptz NOT NULL,
  -- The latest revision's snapshot; NULL for a human-written post.
  ai_original_id    uuid        REFERENCES public.post_ai_originals(id) ON DELETE CASCADE,
  metric_basis      text        NOT NULL CHECK (metric_basis IN ('rate', 'count')),
  value             numeric     NOT NULL,
  baseline          numeric,
  baseline_n        int,
  baseline_source   text        CHECK (baseline_source IS NULL OR baseline_source IN ('own', 'import_seed')),
  -- NULL when there is no baseline; the gate uses beat_baseline, log_lift is descriptive.
  log_lift          numeric,
  beat_baseline     boolean,
  -- Measured ONCE from the immutable published artefact (ADR 0026 §4.4).
  length_band       text        CHECK (length_band IS NULL OR length_band IN ('short', 'medium', 'long')),
  cta_present       boolean,
  hook_survived     boolean,
  measured_at       timestamptz NOT NULL
);

CREATE INDEX post_outcomes_business_platform_published_idx
  ON public.post_outcomes (business_id, platform, published_at DESC);
CREATE INDEX post_outcomes_campaign_id_idx ON public.post_outcomes (campaign_id);
-- FK index: deleting a post_ai_originals row (cascade) must not seq-scan post_outcomes.
CREATE INDEX post_outcomes_ai_original_id_idx
  ON public.post_outcomes (ai_original_id) WHERE ai_original_id IS NOT NULL;

-- ─── campaign_retrospectives (ADR 0026 §8.3) ─────────────────────────────────

CREATE TABLE public.campaign_retrospectives (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid        NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  business_id           uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  hypothesis_snapshot   text        NOT NULL,
  hypothesis_source     text        NOT NULL CHECK (hypothesis_source IN ('brief', 'implicit')),
  criteria_snapshot     jsonb       NOT NULL,
  verdict               text        NOT NULL CHECK (verdict IN ('supported', 'not_supported', 'inconclusive')),
  n                     int         NOT NULL CHECK (n >= 0),
  wins                  int         NOT NULL CHECK (wins >= 0),
  interval_low          numeric(4,3),
  interval_high         numeric(4,3),
  median_log_lift       numeric,
  by_role               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status                text        NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'acknowledged')),
  completed_at          timestamptz NOT NULL,
  acknowledged_at       timestamptz,
  acknowledged_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  note                  text        CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX campaign_retrospectives_business_acknowledged_idx
  ON public.campaign_retrospectives (business_id, acknowledged_at DESC);
-- FK index: deleting an auth user (SET NULL) must not seq-scan the table.
CREATE INDEX campaign_retrospectives_acknowledged_by_idx
  ON public.campaign_retrospectives (acknowledged_by) WHERE acknowledged_by IS NOT NULL;

-- ─── RLS: one SELECT policy each, InitPlan form; no authenticated write policy ─

ALTER TABLE public.post_dimensions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_outcomes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_retrospectives  ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_dimensions_select_own
  ON public.post_dimensions FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY post_outcomes_select_own
  ON public.post_outcomes FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY campaign_retrospectives_select_own
  ON public.campaign_retrospectives FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- Defence in depth (see header): no write privilege for anon/authenticated on any of the three.
REVOKE ALL ON public.post_dimensions, public.post_outcomes, public.campaign_retrospectives FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.post_dimensions, public.post_outcomes, public.campaign_retrospectives FROM authenticated;

-- ─── Write-once: BEFORE UPDATE only, NEVER BEFORE DELETE (ADR 0018 [db-BLOCKER-1]) ─

CREATE OR REPLACE FUNCTION public.reject_outcome_table_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (ADR 0026: write-once, OUTCOME-DIMENSIONS-WRITE-ONCE)', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_post_dimensions_write_once
BEFORE UPDATE ON public.post_dimensions
FOR EACH ROW EXECUTE FUNCTION public.reject_outcome_table_update();

CREATE TRIGGER trg_post_outcomes_write_once
BEFORE UPDATE ON public.post_outcomes
FOR EACH ROW EXECUTE FUNCTION public.reject_outcome_table_update();

-- ─── The tagging trigger (ADR 0026 §4.2) ─────────────────────────────────────
-- Named so it cannot collide with the two triggers ADR 0018 owns on this table's family
-- (trg_post_ai_originals_write_once BEFORE UPDATE; trg_posts_enqueue_edit_signal on posts).
-- SECURITY DEFINER: the table owner bypasses RLS (RLS is not FORCEd), so the row lands even
-- though no authenticated write policy exists. Every lookup is business-scoped.

CREATE OR REPLACE FUNCTION public.tag_post_dimensions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role      text;
  v_platform  text;
  v_origin    text;
  v_pinned    jsonb;
  v_kinds     text[];
  v_proof     text;
BEGIN
  SELECT p.role, p.platform
    INTO v_role, v_platform
    FROM public.posts AS p
   WHERE p.id = NEW.post_id AND p.business_id = NEW.business_id;

  SELECT c.origin
    INTO v_origin
    FROM public.campaigns AS c
   WHERE c.id = NEW.campaign_id AND c.business_id = NEW.business_id;

  -- proof_type: read from the frozen brief's pinnedEvidence (campaign_briefs is 1:1 with
  -- campaigns, UNIQUE (campaign_id)). FOUND is false when there is no frozen brief -> NULL.
  SELECT b.content -> 'pinnedEvidence'
    INTO v_pinned
    FROM public.campaign_briefs AS b
   WHERE b.campaign_id = NEW.campaign_id
     AND b.business_id = NEW.business_id
     AND b.frozen_at IS NOT NULL
     AND b.deleted_at IS NULL;

  IF FOUND AND jsonb_typeof(v_pinned) = 'array' THEN
    IF jsonb_array_length(v_pinned) = 0 THEN
      v_proof := 'none';
    ELSE
      SELECT array_agg(DISTINCT em.kind)
        INTO v_kinds
        FROM jsonb_array_elements(v_pinned) AS e(entry)
        JOIN public.evidence_memory AS em
          ON em.id::text = e.entry ->> 'evidenceMemoryId'
         AND em.business_id = NEW.business_id;
      IF v_kinds IS NOT NULL AND cardinality(v_kinds) = 1 THEN
        v_proof := v_kinds[1];
      END IF;
    END IF;
  END IF;

  INSERT INTO public.post_dimensions (
    ai_original_id, business_id, post_id, campaign_id, platform, taxonomy_version,
    role, format, origin_mode, hook_type, proof_type
  ) VALUES (
    NEW.id, NEW.business_id, NEW.post_id, NEW.campaign_id, v_platform, 1,
    CASE WHEN v_role IN ('anchor_thesis', 'founder_perspective', 'customer_proof',
                         'objection_response', 'conversation_starter', 'follow_up')
         THEN v_role END,
    CASE WHEN NEW.format IN ('single', 'thread', 'carousel') THEN NEW.format END,
    CASE WHEN v_origin IN ('manual', 'objective_generated', 'signal_generated', 'studio_promoted')
         THEN v_origin END,
    CASE WHEN NEW.payload ->> 'hookType' IN ('question', 'statistic', 'contrarian', 'story',
                                             'announcement', 'how_to')
         THEN NEW.payload ->> 'hookType' END,
    v_proof
  )
  ON CONFLICT (ai_original_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tag_post_dimensions() FROM public, anon, authenticated;

CREATE TRIGGER trg_post_ai_originals_tag_dimensions
AFTER INSERT ON public.post_ai_originals
FOR EACH ROW EXECUTE FUNCTION public.tag_post_dimensions();
