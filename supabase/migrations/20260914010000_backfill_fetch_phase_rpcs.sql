-- ADR 0025 §2.3/§6.5 (Session 32 I2.8) — the fetch-phase write path. Per
-- lib/db/types.ts's own precedent comment on social_backfill_runs/
-- social_backfill_posts ("no caller-facing insert or update shape... every
-- write goes through the migration's RPCs, never a raw .insert()/.update()
-- call"), the fetch orchestrator gets three narrow RPCs rather than raw
-- supabase-js writes: staging (idempotent, ON CONFLICT DO NOTHING),
-- progress recording, and status transition — all SECURITY DEFINER,
-- service_role only, house grant shape (REVOKE ALL FROM PUBLIC, then a
-- separate REVOKE EXECUTE FROM anon, authenticated, per
-- 20260912090000_ai_budget_rpc_revoke_named_roles.sql's named-grant fix).

-- ─── stage_backfill_posts — BACKFILL-IMPORT-IDEMPOTENT's fetch-side
-- counterpart: re-running a page insert is a no-op on the UNIQUE
-- (social_account_id, platform_post_id) index (already present,
-- 20260913130000:99). Returns the count of rows ACTUALLY inserted (not the
-- input length), so the orchestrator's loop-stop count reflects real
-- staged posts, never inflated by cross-page duplicates. ────────────────────

CREATE OR REPLACE FUNCTION public.stage_backfill_posts(
  p_run_id            uuid,
  p_business_id       uuid,
  p_social_account_id uuid,
  p_posts             jsonb
)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ins AS (
    INSERT INTO public.social_backfill_posts (
      business_id, run_id, social_account_id, platform_post_id,
      published_at, content, url, format, metrics
    )
    SELECT
      p_business_id,
      p_run_id,
      p_social_account_id,
      post ->> 'platform_post_id',
      (post ->> 'published_at')::timestamptz,
      post ->> 'content',
      post ->> 'url',
      post ->> 'format',
      post -> 'metrics'
    FROM jsonb_array_elements(p_posts) AS post
    ON CONFLICT (social_account_id, platform_post_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer FROM ins;
$$;

REVOKE ALL ON FUNCTION public.stage_backfill_posts(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stage_backfill_posts(uuid, uuid, uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_backfill_posts(uuid, uuid, uuid, jsonb) TO service_role;

-- ─── record_backfill_fetch_progress — atomic conditional UPDATE
-- (CLAUDE.md's "state machine transitions use a conditional UPDATE rather
-- than a read-then-update" applied to counters, not just status): guarded
-- to status='fetching' so a progress write racing a discard/disconnect
-- (which flips status away from 'fetching') is a no-op, never resurrecting
-- a cancelled run's counters. ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_backfill_fetch_progress(
  p_run_id                       uuid,
  p_posts_fetched_delta          integer,
  p_platform_posts_read_delta    integer
)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET posts_fetched = posts_fetched + p_posts_fetched_delta,
         platform_posts_read = platform_posts_read + p_platform_posts_read_delta,
         updated_at = now()
   WHERE id = p_run_id
     AND status = 'fetching'
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.record_backfill_fetch_progress(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_backfill_fetch_progress(uuid, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_backfill_fetch_progress(uuid, integer, integer) TO service_role;

-- ─── transition_backfill_run — ONE generic conditional-UPDATE status
-- transition, reused across I2.8 (queued->fetching, fetching->extracting,
-- fetching->unsupported, fetching->failed) and I2.9/I2.13's later
-- transitions, rather than one bespoke RPC per edge. p_from_statuses is an
-- array so a resumed tick (already 'fetching') and a fresh tick (still
-- 'queued') can share one call site. error_code is only ever SET when
-- p_to_status = 'failed' — a transition into any other status leaves the
-- column untouched, so a later resumable retry does not need to clear it
-- itself. started_at is stamped on first entry to 'fetching' only (used by
-- §6.6's latency target, not itself Tier-2 tested). ─────────────────────────

CREATE OR REPLACE FUNCTION public.transition_backfill_run(
  p_run_id         uuid,
  p_from_statuses  text[],
  p_to_status      text,
  p_error_code     text DEFAULT NULL
)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET status = p_to_status,
         error_code = CASE WHEN p_to_status = 'failed' THEN p_error_code ELSE error_code END,
         started_at = CASE WHEN p_to_status = 'fetching' AND started_at IS NULL THEN now() ELSE started_at END,
         updated_at = now()
   WHERE id = p_run_id
     AND status = ANY (p_from_statuses)
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.transition_backfill_run(uuid, text[], text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_backfill_run(uuid, text[], text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_backfill_run(uuid, text[], text, text) TO service_role;
