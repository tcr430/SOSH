-- ADR 0003 §13: Add brand_voice_inference_attempts to trial_state.
-- Enforces the 3-attempt cap during trial (cap value is in config.ts, not here).
-- RLS unchanged — same policies apply. Existing rows backfill to 0 via DEFAULT.

ALTER TABLE trial_state
  ADD COLUMN brand_voice_inference_attempts int NOT NULL DEFAULT 0
    CHECK (brand_voice_inference_attempts >= 0);
