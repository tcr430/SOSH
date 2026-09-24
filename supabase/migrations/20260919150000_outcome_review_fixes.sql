-- Migration: database-review fixes for the J2.3 objects (Session 33 J2.6, ecc:database-reviewer)
--
-- A FORWARD migration: committed migrations are never edited. Two MINOR findings against
-- 20260919110000_outcome_tables.sql, plus one correction to a comment in J2.5.
--
-- 1. tag_post_dimensions() — proof_type was the ONE enum the trigger did not sanitise. It wrote
--    v_kinds[1] raw against CHECK (proof_type IN ('none','quote','case_study','usage_data','other')).
--    That is safe TODAY only because evidence_memory_kind_check admits exactly those four kinds; a future
--    evidence kind would have aborted the AI-original INSERT and with it generation, regeneration and
--    Studio promote (ADR 0018's write path). The header of J2.3 claims "every enum column is sanitised";
--    this makes that claim true. The function body below is the committed one with ONLY that guard added.
-- 2. reject_outcome_table_update() — a trigger function, so it cannot be called directly and there is no
--    exploit, but it was left PUBLIC-executable (NULL ACL). REVOKE for consistency with every other function.
--
-- CORRECTION to 20260919130000_performance_memory_outcome_schema.sql, whose header says VALIDATE CONSTRAINT
-- "happens under a weaker lock than ADD would take". Within a single migration transaction the ACCESS
-- EXCLUSIVE lock taken by DROP CONSTRAINT is held through the VALIDATE, so that benefit does not
-- materialise. The pattern is still correct (never a guessed name, RAISE unless exactly one, explicitly
-- named NOT VALID then VALIDATE) and the table is small, so nothing changes in practice.

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
      IF v_kinds IS NOT NULL AND cardinality(v_kinds) = 1
         AND v_kinds[1] IN ('quote', 'case_study', 'usage_data', 'other')
      THEN
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


-- No BEFORE DELETE trigger anywhere; the function itself is only ever fired by its own BEFORE UPDATE triggers.
REVOKE ALL ON FUNCTION public.reject_outcome_table_update() FROM public, anon, authenticated;
