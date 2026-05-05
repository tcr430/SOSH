-- Migration 023: Add non-negative CHECK constraints to post_metrics columns
--
-- Social platform APIs never return negative engagement counts. NULL means
-- "not exposed by the platform"; zero is a real value. The constraints prevent
-- bad data from a metrics worker bug from silently corrupting analytics.
-- NULLs pass CHECK constraints in PostgreSQL, so nullable columns are safe.

ALTER TABLE public.post_metrics
  ADD CONSTRAINT post_metrics_likes_check      CHECK (likes >= 0),
  ADD CONSTRAINT post_metrics_comments_check   CHECK (comments >= 0),
  ADD CONSTRAINT post_metrics_shares_check     CHECK (shares >= 0),
  ADD CONSTRAINT post_metrics_saves_check      CHECK (saves >= 0),
  ADD CONSTRAINT post_metrics_clicks_check     CHECK (clicks >= 0),
  ADD CONSTRAINT post_metrics_reach_check      CHECK (reach >= 0),
  ADD CONSTRAINT post_metrics_impressions_check CHECK (impressions >= 0);
