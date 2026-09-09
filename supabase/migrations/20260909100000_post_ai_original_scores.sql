-- ADR 0024 §8.2 (Session 31, H2.4) — the winning candidate's rubric score, on
-- the existing post_ai_originals (20260726010000_learning_capture.sql:28-42).
--
-- COLUMNS, NOT A TABLE (§9, the Session 29-D §D2.5 precedent — ADR 0022's
-- three new studio_drafts columns needed no new cascade row): the existing
-- post_ai_originals row already covers the whole table via
-- business_id ... ON DELETE CASCADE (learning_capture.sql:30), so NO new row
-- is owed in ADR 0010 Amendment 2 §D2.5.
--
-- WHY post_ai_originals, NOT posts.ai_generation_metadata (§8.2): this table
-- is schema-versioned, single-writer, and write-once (the
-- trg_post_ai_originals_write_once BEFORE UPDATE trigger at :67-68) — the
-- ADR 0018-governed record of what the model produced. ai_generation_metadata
-- is an unvalidated JSONB blob carrying recorded debt
-- (docs/reviews/session-18b3-review.md, M2); a governed score does not belong
-- on an ungoverned blob.
--
-- Naming follows the campaign_briefs.overall_score precedent
-- (20260722190000_mode2_brief_and_roles.sql:34) rather than inventing a new
-- convention.
--
-- Nullable, not backfilled: every row written before this migration ships
-- reflects the single-candidate/single-dimension retry this ADR replaces —
-- there is no ten-dimension score to backfill for it, and post_ai_originals
-- is immutable (write-once) so no later job could compute one retroactively
-- even if we wanted to. NULL on these four columns on an old row is an
-- honest "not scored under this contract," not a data gap to paper over.
--
-- Bumped IN THIS MIGRATION (§8.2): the app-side AI_ORIGINAL_SCHEMA_VERSION
-- constant (lib/db/post-ai-originals.ts) moves 1 -> 2 in the same H2.4 step,
-- so every row written from here on carries schema_version = 2 and these four
-- columns populated together, atomically, at insert (write-once — never
-- UPDATEd on afterwards, §2.9/§8.1: losing candidates write no row at all).

ALTER TABLE public.post_ai_originals
  ADD COLUMN overall_score numeric
    CHECK (overall_score >= 0 AND overall_score <= 100),
  -- The full ten-dimension breakdown (rubric.ts's RubricOutputSchema
  -- `dimensions` object verbatim: specificity, originality,
  -- evidenceSufficiency, audienceRelevance, platformNativeness,
  -- brandVoiceAlignment, openingStrength, ctaFit, unsupportedClaimsRisk,
  -- redundancy — each { score, note }). jsonb, not ten columns: the shape is
  -- owned by RubricOutputSchema (lib/ai/prompts/rubric.ts), not by this
  -- migration, and mirrors insight_cards.rubric_scores
  -- (20260807100000_mode3_insight_cards.sql:36) for the same reason.
  ADD COLUMN dimension_scores jsonb,
  ADD COLUMN candidate_count int
    CHECK (candidate_count IS NULL OR candidate_count >= 1),
  ADD COLUMN cleared_quality_threshold boolean;
