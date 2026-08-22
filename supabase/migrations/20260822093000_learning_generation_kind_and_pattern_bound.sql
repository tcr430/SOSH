-- ADR 0018 Amd A.1, A.2 — Session 29, Track F, F1b.2. Two additive,
-- unrelated changes bundled in one migration (same posture as F1b.1):
--
--   1. post_ai_originals.generation_kind CHECK widens to a THIRD value,
--      'studio_promoted' (ADR 0018 Amd A.1) — the promote path (§5) writes a
--      post_ai_originals snapshot at promote time when a genuine
--      model-generated baseline exists (studio_drafts.accepted_revision is
--      non-NULL), and that snapshot's generation_kind must say so truthfully
--      rather than lying as 'initial' or 'regeneration'.
--   2. performance_memory.pattern gains a 500-character CHECK bound
--      (ADR 0018 Amd A.2) — pure defence-in-depth on the promote-path writer
--      boundary (A-5). Both production writers are already bounded well
--      under 500 (learning-summarizer.ts's Zod .max(200), and
--      renderPatternStatement's ~80-char fixed-label statements), so this
--      CHECK can never fire from a legitimate Track C write. That is the
--      INTENDED property, not slack to "tighten" later — see the comment
--      on the constraint itself.
--
-- Backfill: NONE for either change.
--   - Widening generation_kind's CHECK admits a new value; every existing
--     row is already 'initial' or 'regeneration' and satisfies the wider
--     constraint unchanged — a CHECK widening cannot invalidate an existing
--     row.
--   - The pattern length bound is NOT VALID + VALIDATE (see below); no
--     existing performance_memory.pattern row can exceed 500 characters
--     today (Track C's only two writers were already capped at 200/~80
--     before this migration), so VALIDATE is expected to pass immediately,
--     but the NOT VALID + VALIDATE sequencing is used anyway to match the
--     low-lock precedent (20260722190000:112-118, F1b.1's origin-check
--     widening) rather than assume a single-pass ADD CONSTRAINT is safe.
--
-- ADR 0010 Amendment 2 §D2.5: NO new cascade row required. Both changes
-- widen/add a CHECK on columns of ALREADY-COVERED tables (post_ai_originals,
-- performance_memory) — neither table gains reachability from businesses for
-- the first time. Same reasoning as F1b.1's studio_drafts columns and the
-- Session 28-D D7 insight_cards.campaign_id precedent.

-- ─── post_ai_originals.generation_kind += 'studio_promoted' (ADR 0018 Amd A.1) ──

ALTER TABLE public.post_ai_originals
  DROP CONSTRAINT IF EXISTS post_ai_originals_generation_kind_check;

ALTER TABLE public.post_ai_originals
  ADD CONSTRAINT post_ai_originals_generation_kind_check
    CHECK (generation_kind IN ('initial', 'regeneration', 'studio_promoted'))
    NOT VALID;

ALTER TABLE public.post_ai_originals
  VALIDATE CONSTRAINT post_ai_originals_generation_kind_check;

-- ─── performance_memory.pattern length bound (ADR 0018 Amd A.2) ────────────
--
-- KEEP 500. DO NOT REDUCE IT TO 200. The two production writers of
-- performance_memory.pattern are already bounded well under this: a Zod
-- .max(200) at lib/ai/prompts/learning-summarizer.ts:16, and
-- renderPatternStatement's closed 9-entry KIND_LABEL table (~80 chars max)
-- at lib/learning/orchestrator.ts:273. A 500-char CHECK therefore can NEVER
-- fire from a legitimate Track C write — that is the intended property: this
-- constraint is pure defence-in-depth on the §5 promote-path writer boundary
-- (A-5), not a live participant in distillation. Do not "tighten" it to 200
-- as if the headroom were an oversight (ADR 0018 Amendment A.2, ADR 0022
-- §17's corollary — both explicit on this point).

ALTER TABLE public.performance_memory
  ADD CONSTRAINT performance_memory_pattern_length_check
    CHECK (char_length(pattern) <= 500)
    NOT VALID;

ALTER TABLE public.performance_memory
  VALIDATE CONSTRAINT performance_memory_pattern_length_check;
