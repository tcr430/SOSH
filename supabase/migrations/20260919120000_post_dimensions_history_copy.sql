-- Migration: post_dimensions history copy (ADR 0026 §4.5, L-4 — Session 33 J2.3)
--
-- The ONLY non-trigger writer of post_dimensions (the other is public.tag_post_dimensions(),
-- 20260919110000). It COPIES, for snapshots that already exist, the three dimensions that were
-- ASSIGNED AT GENERATION and are therefore facts, not guesses:
--
--   role         <- posts.role        (written from the frozen roleSequence before generation)
--   format       <- post_ai_originals.format  (the output discriminant)
--   origin_mode  <- campaigns.origin  (the campaign row)
--
-- hook_type and proof_type are deliberately NOT set (NULL): neither was recorded at
-- generation time for these rows, and inferring them now is exactly the retroactive
-- classification L-4 forbids. Measured dimensions (length_band, cta_present, hook_survived) are
-- computed normally at maturity, from the published artefact, by the extractor.
--
-- IMPORTS ARE NEVER TOUCHED: imported posts live in social_backfill_posts, carry no
-- post_ai_originals row and can never be observations (ADR 0026 §4.5, §9; ruling A-4). Human-
-- written posts have no snapshot and get no row.
--
-- Idempotent (ON CONFLICT DO NOTHING on the primary key) and safe to re-run. Every enum column is
-- sanitised exactly as the trigger does, so an out-of-vocabulary legacy value becomes NULL and
-- can never abort the migration. Every join is business-scoped. In production this set is
-- expected to be EMPTY (no real customer has published, docs/current-phase.md); a single
-- INSERT ... SELECT is therefore proportionate, and there is no batching to get wrong.

INSERT INTO public.post_dimensions (
  ai_original_id, business_id, post_id, campaign_id, platform, taxonomy_version,
  role, format, origin_mode
)
SELECT
  o.id,
  o.business_id,
  o.post_id,
  o.campaign_id,
  p.platform,
  1,
  CASE WHEN p.role IN ('anchor_thesis', 'founder_perspective', 'customer_proof',
                       'objection_response', 'conversation_starter', 'follow_up')
       THEN p.role END,
  CASE WHEN o.format IN ('single', 'thread', 'carousel') THEN o.format END,
  CASE WHEN c.origin IN ('manual', 'objective_generated', 'signal_generated', 'studio_promoted')
       THEN c.origin END
FROM public.post_ai_originals AS o
JOIN public.posts     AS p ON p.id = o.post_id     AND p.business_id = o.business_id
JOIN public.campaigns AS c ON c.id = o.campaign_id AND c.business_id = o.business_id
ON CONFLICT (ai_original_id) DO NOTHING;
