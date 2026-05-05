-- Migration 018: Fix publishing queue index column list
--
-- The original index only covered (scheduled_at). Adding status as the leading
-- column lets the planner satisfy the status = 'approved' predicate from the
-- index itself before performing any range scan on scheduled_at, and makes
-- index-only scans possible for the publishing worker query:
--   WHERE status = 'approved' AND scheduled_at <= now()

DROP INDEX IF EXISTS public.posts_publishing_queue_idx;

CREATE INDEX posts_publishing_queue_idx
  ON public.posts (status, scheduled_at)
  WHERE status = 'approved';
