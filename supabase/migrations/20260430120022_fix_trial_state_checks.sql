-- Migration 022: Add non-negative CHECK constraints to trial_state counters
--
-- campaigns_created_count and posts_generated_count are incremented by the
-- service-role worker. They should never go below zero; the constraint makes
-- that invariant explicit and catches any accidental decrement logic.

ALTER TABLE public.trial_state
  ADD CONSTRAINT trial_state_campaigns_created_count_check
    CHECK (campaigns_created_count >= 0),
  ADD CONSTRAINT trial_state_posts_generated_count_check
    CHECK (posts_generated_count >= 0);
