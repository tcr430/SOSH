-- Mode 3's second signal source: market-responsive ingestion (ADR 0023 §3.2,
-- §7.6, §10.1). RSS/Atom feeds, widening the existing `signals` table via its
-- `source` dimension rather than a parallel `market_signals` table — ADR
-- 0023 §3.2 argues a second raw-signal table would duplicate RLS, the
-- REVOKE/GRANT pair, and the §D2.5 cascade/purge_business obligation
-- forever, for zero benefit (GitHub and RSS need an identical RLS shape).
--
-- Backfill: NONE. No rss row exists anywhere in the schema yet, and every
-- pre-existing github row already satisfies both widened CHECKs and the new
-- exactly-one-parent CHECK trivially: source='github', watched_repo_id was
-- already NOT NULL, and watched_feed_id cannot yet be non-null because the
-- column does not exist until this migration creates it (L-10).

-- ─── watched_feeds (§3.2/§8.2), parallel in shape to watched_repos
-- (20260731090000_signal_ingestion.sql:52-70) ────────────────────────────────

CREATE TABLE public.watched_feeds (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  url           text        NOT NULL,
  -- App-computed (§3.2/§8.2): normalized — lowercase scheme+host, strip
  -- fragment and known tracking parameters, trim the trailing slash — then
  -- hashed. Not a generated column: Postgres cannot trivially express this
  -- normalization, the same reason external_id's rss:sha256(canonical_link)
  -- form (§3.4) is computed by the ingestion parser, not by the database.
  url_hash      text        NOT NULL,
  label         text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  -- Relevance weight, 0..10, constant 10 in v1 (§8.2, mirroring
  -- watched_repos.weight, :64-66) — same future per-feed-tuning rationale.
  weight        integer     NOT NULL DEFAULT 10 CHECK (weight BETWEEN 0 AND 10),
  added_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- §9.4 poll-state, per that section's explicit column list (not an exact
  -- shape-mirror of github_connections' own poll-state columns
  -- (20260731090000_signal_ingestion.sql:28-31, corrected from ADR 0023's
  -- stale ":333" citation at G1b.0 — that file has only 314 lines):
  -- github_connections has no last_error_code/consecutive_failure_count,
  -- since a feed's per-item failure mode (a fetch/parse error) differs from
  -- a connection's (an installation/rate-limit error).
  last_fetch_at              timestamptz,
  last_fetch_status          text,
  last_error_code            text,
  consecutive_failure_count  integer     NOT NULL DEFAULT 0,
  rate_limited_until         timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, url_hash)
);

CREATE TRIGGER trg_watched_feeds_updated_at
BEFORE UPDATE ON public.watched_feeds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Watch-list cap enforcement (mirroring SIGNAL-WATCHLIST-BOUNDED,
-- ADR 0020 §3.2) is an app-layer Server Action concern (ADR 0023 §8.2/§9.2),
-- not a CHECK constraint here — a CHECK cannot see sibling rows.

-- ─── signals: widen source/kind (§3.2) ──────────────────────────────────────
--
-- NOT VALID + VALIDATE two-step (20260807110000_mode3_triage_state.sql:24-33
-- precedent), retained for PATTERN CONSISTENCY and future-migration safety —
-- corrected (Session 30-D D7, MINOR-4): both statements run in the SAME
-- transaction here, so the ADD's ACCESS EXCLUSIVE lock is held to commit and
-- VALIDATE's weaker SHARE UPDATE EXCLUSIVE never actually gets a window in
-- THIS migration. Harmless as executed (backfill is genuinely NONE, table
-- small at ship time) — but to obtain the weaker lock's real benefit, the
-- VALIDATE step must run in a SEPARATE transaction (a follow-on migration),
-- not merely as a second statement in the same one. Do not copy this
-- migration's two-step onto a table where the lock window actually matters
-- without splitting it across transactions. Backfill: NONE — every existing
-- row has source='github', which trivially satisfies the widened CHECK
-- without needing to change.

ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_source_check;
ALTER TABLE public.signals
  ADD CONSTRAINT signals_source_check
    CHECK (source IN ('github', 'rss'))
    NOT VALID;
ALTER TABLE public.signals
  VALIDATE CONSTRAINT signals_source_check;

ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_kind_check;
ALTER TABLE public.signals
  ADD CONSTRAINT signals_kind_check
    CHECK (kind IN ('release', 'article'))
    NOT VALID;
ALTER TABLE public.signals
  VALIDATE CONSTRAINT signals_kind_check;

-- ─── signals: nullable watched_repo_id, new watched_feed_id, exactly-one-
-- parent CHECK (§3.2) ────────────────────────────────────────────────────────

ALTER TABLE public.signals
  ALTER COLUMN watched_repo_id DROP NOT NULL;

ALTER TABLE public.signals
  ADD COLUMN watched_feed_id uuid NULL REFERENCES public.watched_feeds(id) ON DELETE CASCADE;

-- Backfill: NONE — every existing row is source='github' with a (formerly
-- NOT NULL, still populated) watched_repo_id and a necessarily-null
-- watched_feed_id (the column did not exist until the ADD COLUMN above), so
-- every existing row already satisfies this CHECK without modification
-- (L-10). NOT VALID + VALIDATE, same two-step as the two CHECKs above and the
-- same correction applies (Session 30-D D7, MINOR-4): both statements share
-- this migration's one transaction, so this does not actually obtain a
-- weaker lock window here either — retained for pattern consistency, real
-- benefit requires a separate-transaction VALIDATE in a follow-on migration.
ALTER TABLE public.signals
  ADD CONSTRAINT signals_exactly_one_parent_check
    CHECK (
      (source = 'github' AND watched_repo_id IS NOT NULL AND watched_feed_id IS NULL) OR
      (source = 'rss'    AND watched_feed_id IS NOT NULL AND watched_repo_id IS NULL)
    )
    NOT VALID;
ALTER TABLE public.signals
  VALIDATE CONSTRAINT signals_exactly_one_parent_check;

-- ─── The fifth identity guard: watched_feed_id is immutable (§3.2) ──────────
--
-- CREATE OR REPLACE, not a new trigger — exactly one BEFORE UPDATE trigger on
-- this table remains, per the original function's own stated reason
-- (20260731090000_signal_ingestion.sql:135-137). IS DISTINCT FROM treats
-- NULL-vs-NULL as not distinct, so an existing github row (watched_feed_id
-- NULL before and after any unrelated update) is unaffected.
CREATE OR REPLACE FUNCTION public.guard_signals_identity_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'signals.business_id is immutable (ADR 0020 §3.3)';
  END IF;
  IF NEW.watched_repo_id IS DISTINCT FROM OLD.watched_repo_id THEN
    RAISE EXCEPTION 'signals.watched_repo_id is immutable (ADR 0020 §3.3)';
  END IF;
  IF NEW.watched_feed_id IS DISTINCT FROM OLD.watched_feed_id THEN
    RAISE EXCEPTION 'signals.watched_feed_id is immutable (ADR 0023 §3.2)';
  END IF;
  IF NEW.external_id IS DISTINCT FROM OLD.external_id THEN
    RAISE EXCEPTION 'signals.external_id is immutable (ADR 0020 §3.3)';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'signals.created_at is immutable (ADR 0020 §3.3)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─── Indexes (§7.6) ──────────────────────────────────────────────────────────

-- signals_watched_repo_id_idx precedent (20260731090000_signal_ingestion.sql:219-220).
CREATE INDEX signals_watched_feed_id_idx
  ON public.signals (watched_feed_id);

-- watched_repos_added_by_idx precedent (20260731090000_signal_ingestion.sql:241-242).
CREATE INDEX watched_feeds_added_by_idx
  ON public.watched_feeds (added_by);

-- ─── RLS (§7.6) ───────────────────────────────────────────────────────────────
--
-- InitPlan form, verbatim from watched_repos' policies
-- (20260731090000_signal_ingestion.sql:274-285).

ALTER TABLE public.watched_feeds ENABLE ROW LEVEL SECURITY;

-- SELECT, INSERT, UPDATE. NO DELETE POLICY (mirrors watched_repos,
-- :269-273): signals.watched_feed_id cascades from watched_feeds, so a user
-- hard-delete would annihilate that feed's entire signal history.
-- Unwatching is is_active = false, not a DELETE. Absence of a policy is
-- deny-by-default under RLS — the correct expression of "no authenticated
-- DELETE path".
CREATE POLICY watched_feeds_select_own
  ON public.watched_feeds FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY watched_feeds_insert_own
  ON public.watched_feeds FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY watched_feeds_update_own
  ON public.watched_feeds FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- [db-D] pair the absent write policy with an explicit REVOKE + a
-- narrowly-scoped GRANT (20260731090000_signal_ingestion.sql:298-303,
-- :307-311 precedent) — read/write is enforced at two independent layers
-- (RLS policy absence AND privilege absence), not on policy absence alone.
REVOKE ALL ON public.watched_feeds FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.watched_feeds TO authenticated;

-- No BEFORE DELETE trigger on watched_feeds, for the exact reason recorded
-- at 20260731090000_signal_ingestion.sql:192-201: a raising guard fires
-- identically on an FK-cascade delete and a direct one — there is no way to
-- distinguish them from inside the trigger — and would abort GDPR erasure
-- for every business that ever added a watched feed. purge_business itself
-- needs no edit: this table's ON DELETE CASCADE is sufficient and is
-- exercised by its existing root delete
-- (20260702120700_purge_business_member_delete.sql:62).
-- SIGNAL-MR-CASCADE-COMPLETE proves this against live Postgres rather than
-- by analogy.
