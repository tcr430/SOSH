-- ADR 0023 §8.4/§9.4 (Session 30 G1b.9) — the config surface's "fetch-failing
-- (with last error AND last success time)" state needs a timestamp that
-- survives a run of consecutive failures. last_fetch_at does NOT serve this:
-- recordWatchedFeedPollOutcome (lib/db/watched-feeds.ts) updates it on EVERY
-- poll outcome including 'error', so once a feed starts failing,
-- last_fetch_at reflects the LATEST failed attempt, not the last time it
-- actually succeeded — there was no column anywhere holding that value.
--
-- Mirrors the etag column's own precedent exactly
-- (20260827100000_watched_feeds_etag.sql): one nullable timestamptz column,
-- no new index, no RLS change (existing watched_feeds policies already
-- cover every column on the row).
--
-- Backfill: NONE — no watched_feeds row exists in production yet (this ships
-- in the same session as G1b.9's settings surface, which is the first thing
-- that can create one), so NULL ("never successfully polled") is correct for
-- every row this migration could possibly touch.

ALTER TABLE public.watched_feeds
  ADD COLUMN last_success_at timestamptz;
