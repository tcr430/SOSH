-- ADR 0012 CAL-1: index-only migration; no column, no grouping stored.
-- Supports listPostsForCalendar range scans scoped to a business.
create index if not exists idx_posts_business_scheduled_at
  on public.posts (business_id, scheduled_at) where deleted_at is null;
