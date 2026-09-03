-- ADR 0023 §3.1/§9.4 (Session 30 G1b.5) — gap found integrating G1b.4's
-- conditional-GET client with G1b.1's watched_feeds schema: G1b.4 built
-- If-None-Match support ("Conditional GET... Mirror the path the GitHub
-- client already models") but watched_feeds carries no column to PERSIST
-- an ETag across polling ticks — the capability existed with nothing to
-- store it in, so it could never actually save a redundant fetch.
--
-- Mirrors watched_repos.releases_etag exactly
-- (20260731090000_signal_ingestion.sql:62) — one nullable text column, no
-- new index (releases_etag itself carries none either), no RLS change
-- (existing watched_feeds policies already cover every column on the row).
--
-- Backfill: NONE — every existing watched_feeds row (there are none yet in
-- production; this ships before G1b.9's settings surface can create any)
-- gets NULL, which is the correct "never successfully polled" state.

ALTER TABLE public.watched_feeds
  ADD COLUMN etag text;
