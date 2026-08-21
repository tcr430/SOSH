-- Mode 3 Part 1 — GitHub signal ingestion (ADR 0020 §3).
--
-- Four tables: github_connections (one per business), watched_repos (up to
-- 20 active per business, cap enforced app-side — SIGNAL-WATCHLIST-BOUNDED),
-- signals (the raw, untrusted third-party store), signal_candidates
-- (Stage B's deterministic score, ADR 0020 §6). Two tables for raw vs scored
-- (§3.1): Postgres RLS/GRANT are table-grained, not column-grained, so a
-- single table permitting the triage UPDATE would also permit an UPDATE
-- touching untrusted body text.
--
-- Backfill: NONE. Every one of these four tables is new feature surface with
-- no prior data anywhere in the schema to migrate (L-13).

-- ─── github_connections (§3.2) ──────────────────────────────────────────────

CREATE TABLE public.github_connections (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  installation_id         bigint      NOT NULL,
  account_login           text        NOT NULL,
  is_active               boolean     NOT NULL DEFAULT true,
  connected_by            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at            timestamptz NOT NULL DEFAULT now(),
  -- Separate claim/completion stamps ([db-MODERATE-B-iii]): one combined
  -- "last polled" stamp cannot distinguish a crashed tick (claimed, never
  -- completed) from a completed one. §4.2's atomic claim sets
  -- last_poll_started_at; a successful tick also sets last_poll_completed_at.
  last_poll_started_at   timestamptz,
  last_poll_completed_at timestamptz,
  last_poll_status        text,
  rate_limited_until      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id),
  UNIQUE (installation_id)
);

-- ⚠️ No vault_*_token_id column of any kind, deliberately (ADR 0020 §2.3):
-- this design never persists a long-lived credential. A GitHub App
-- installation token is minted per poller tick, held in memory only, and
-- never written to any table. This comment is the tripwire — if a future
-- change ever needs to add a vault_access_token_id/vault_refresh_token_id
-- column here, that is a signal the credential model has changed and needs
-- its own ADR, not a silent addition.

CREATE TRIGGER trg_github_connections_updated_at
BEFORE UPDATE ON public.github_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── watched_repos (§3.2, L-4/D-4) ──────────────────────────────────────────

CREATE TABLE public.watched_repos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  connection_id uuid        NOT NULL REFERENCES public.github_connections(id) ON DELETE CASCADE,
  -- GitHub's immutable numeric repo id, not owner/name — a repo rename must
  -- not orphan this row.
  repo_id       bigint      NOT NULL,
  owner         text        NOT NULL,
  name          text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  releases_etag text,
  last_polled_at timestamptz,
  -- Relevance weight, 0..10, constant 10 in v1 (§6.1) — the column exists now
  -- so a future per-repo tuning UI is a data change, not a migration.
  weight        integer     NOT NULL DEFAULT 10 CHECK (weight BETWEEN 0 AND 10),
  added_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, repo_id)
);

-- Watch-list cap of 20 active repos per business is enforced in the Server
-- Action (SIGNAL-WATCHLIST-BOUNDED, ADR 0020 §3.2) — a CHECK constraint
-- cannot see sibling rows, and this is a UX/cost guardrail, not a dedup or
-- security boundary, so the small TOCTOU window under concurrent adds is
-- accepted rather than paying for a BEFORE INSERT trigger.

CREATE TRIGGER trg_watched_repos_updated_at
BEFORE UPDATE ON public.watched_repos
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── signals (§3.3) — the raw, untrusted store ──────────────────────────────

CREATE TABLE public.signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  watched_repo_id uuid        NOT NULL REFERENCES public.watched_repos(id) ON DELETE CASCADE,
  -- CHECK constraints on source, kind AND length(body) — not just on
  -- ingested_via ([db-MINOR]: inconsistent enum-hardening on adjacent
  -- columns in the same DDL is worth fixing while the table is new).
  source          text        NOT NULL CHECK (source IN ('github')),
  kind            text        NOT NULL CHECK (kind IN ('release')),
  -- 'github:release:{release_id}' — the idempotency key (§4.3), paired with
  -- business_id/source in the UNIQUE constraint below.
  external_id     text        NOT NULL,
  title           text        NOT NULL,
  -- Defence-in-depth behind the app-layer cap: this is explicitly untrusted
  -- third-party text, and an app-layer bug must not be able to write
  -- unbounded content (SIGNAL-BODY-CAPPED, DB half).
  body            text        NOT NULL DEFAULT '' CHECK (length(body) <= 8000),
  body_truncated  boolean     NOT NULL DEFAULT false,
  html_url        text,
  occurred_at     timestamptz NOT NULL,
  is_prerelease   boolean     NOT NULL DEFAULT false,
  -- A property of the release, not a person (ADR 0020 §5.3/§9.2) — no
  -- contributor identity field is ever stored on this row.
  author_is_bot   boolean     NOT NULL DEFAULT false,
  ingested_via    text        NOT NULL DEFAULT 'poll' CHECK (ingested_via IN ('poll', 'webhook')),
  -- Generated column on the studio_drafts.sql:26 precedent — computed over
  -- title || body, so edit-detection (§4.4) is an exact comparison, never an
  -- app-computed value that could drift from the actual row content.
  -- database-reviewer (E2.1 pass, MINOR-1): a NUL-byte separator between
  -- title and body so (title='ab',body='c') and (title='a',body='bc') never
  -- collide — "hash differs ⇒ content differs" holds unconditionally, not
  -- just usually. Postgres `text` cannot itself contain a NUL byte (a hard
  -- server-side limitation, not an encoding choice), so the concatenation is
  -- done in `bytea` — the direct `::bytea` cast (immutable, same idiom as
  -- studio_drafts.sql:26's `content::bytea`) on each field, joined with a
  -- `bytea` NUL literal, never forming an in-flight `text` value with an
  -- embedded NUL. (convert_to() was tried first and rejected: it is STABLE,
  -- not IMMUTABLE, so Postgres refuses it in a generated column expression.)
  content_hash    text        GENERATED ALWAYS AS (
                                encode(sha256(title::bytea || '\x00'::bytea || body::bytea), 'hex')
                              ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, source, external_id)
);

-- ⚠️ SIGNAL-RAW-IMMUTABLE-IDENTITY (§3.3/§4.4). A release's GitHub id is
-- immutable, so an edited release is the SAME row, not a new one — this
-- table is mutable in content only. Permits title/body/content_hash (via the
-- generated column recompute)/body_truncated/updated_at to change; raises on
-- any change to business_id, watched_repo_id, external_id, created_at. Also
-- stamps updated_at itself (folded in here rather than a second trigger, so
-- there is exactly one BEFORE UPDATE trigger on this table to reason about).
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

CREATE TRIGGER trg_signals_guard_identity_update
BEFORE UPDATE ON public.signals
FOR EACH ROW EXECUTE FUNCTION public.guard_signals_identity_update();

-- ─── signal_candidates (§3.4) — Stage B's scored output ─────────────────────

CREATE TABLE public.signal_candidates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  signal_id    uuid        NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  score        numeric     NOT NULL CHECK (score >= 0),
  score_inputs jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Denormalised from signals.occurred_at ([db-MAJOR-C]): Postgres cannot
  -- build a composite index spanning two tables, and the feed's
  -- ORDER BY score DESC, occurred_at DESC, id ASC spans both — copied at
  -- insert and refreshed on the same upsert whenever the signal's content
  -- changes and is re-scored (§4.4).
  occurred_at  timestamptz NOT NULL,
  -- ADR 0021 widens this; this ADR issues only 'new'.
  status       text        NOT NULL DEFAULT 'new' CHECK (status IN ('new')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- ⚠️ [db-BLOCKER], now closed: without this unique index, ON CONFLICT
  -- (signal_id) has no arbiter and every re-score silently inserts a
  -- duplicate candidate row rather than updating the existing one.
  UNIQUE (signal_id)
);

CREATE TRIGGER trg_signal_candidates_updated_at
BEFORE UPDATE ON public.signal_candidates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ⚠️ Deliberately NO BEFORE DELETE trigger on ANY of the four tables above,
-- for the exact reason recorded at studio_drafts.sql:88-96: purge_business's
-- root DELETE FROM public.businesses (20260702120700_purge_business_member_
-- delete.sql:62) has no EXCEPTION block anywhere in its body, and a raising
-- BEFORE DELETE guard fires identically on an FK-cascade delete and a direct
-- one — there is no way to distinguish them from inside the trigger. A guard
-- here would abort GDPR erasure for every business that ever connected
-- GitHub or ingested a signal. purge_business itself needs no edit: every
-- one of these four tables' ON DELETE CASCADE is sufficient and is exercised
-- by its existing root delete at :62.

-- ─── Indexes (§3.6 — seven total) ───────────────────────────────────────────

-- 1: UNIQUE (business_id, source, external_id) on signals — idempotency arbiter (declared above)
-- 2: UNIQUE (signal_id) on signal_candidates — candidate arbiter (declared above)

-- 3: Poller claim, bounded with ORDER BY last_poll_started_at ASC NULLS FIRST + LIMIT (§4.2/L-13).
CREATE INDEX github_connections_poll_claim_idx
  ON public.github_connections (is_active, last_poll_started_at);

-- 4: Watched repos for a connection. [db-BLOCKER-C]: bare FK in the draft —
-- the only unique index on watched_repos leads with business_id and does not
-- serve a connection_id lookup.
CREATE INDEX watched_repos_connection_id_idx
  ON public.watched_repos (connection_id);

-- 5: Signals for a watched repo. [db-BLOCKER-C]: same gap as above, bare FK.
CREATE INDEX signals_watched_repo_id_idx
  ON public.signals (watched_repo_id);

-- 6: Recent signals for a business (trailing id for deterministic ordering
-- across ties at the same occurred_at, same rationale as
-- studio_drafts_business_id_updated_at_idx).
CREATE INDEX signals_business_id_occurred_at_idx
  ON public.signals (business_id, occurred_at DESC, id);

-- 7: Candidate feed, bounded, ORDER BY score DESC, occurred_at DESC, id ASC.
-- Partial on the studio_drafts.sql:60-62 pattern.
CREATE INDEX signal_candidates_feed_idx
  ON public.signal_candidates (business_id, score DESC, occurred_at DESC, id ASC)
  WHERE status = 'new';

-- database-reviewer (E2.1 pass, additions beyond §3.6's named seven):

-- MODERATE-1: connected_by/added_by are FK columns to auth.users(id) with no
-- supporting index — the same bare-FK gap §3.6 fixed for connection_id and
-- watched_repo_id above, missed for these two audit-attribution columns.
CREATE INDEX github_connections_connected_by_idx
  ON public.github_connections (connected_by);
CREATE INDEX watched_repos_added_by_idx
  ON public.watched_repos (added_by);

-- MODERATE-2: signal_candidates_feed_idx above is partial (WHERE status =
-- 'new'), so it cannot serve a plain business_id-only query (an admin/debug
-- path, or any query issued once ADR 0021 widens status beyond 'new'). A
-- non-partial index on the FK column itself closes that gap.
CREATE INDEX signal_candidates_business_id_idx
  ON public.signal_candidates (business_id);

-- ─── RLS (§3.5) ──────────────────────────────────────────────────────────────
--
-- InitPlan form, verbatim from 20260730100000_studio_drafts.sql:71-86 — the
-- SELECT-wrapped form lets Postgres cache get_user_business_ids() once per
-- statement rather than evaluating it once per row.

ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watched_repos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_candidates  ENABLE ROW LEVEL SECURITY;

-- github_connections — SELECT only. The poller writes as service-role;
-- connect/disconnect are gated at the app layer (§8.5), not by an
-- authenticated-role write policy here.
CREATE POLICY github_connections_select_own
  ON public.github_connections FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- watched_repos — SELECT, INSERT, UPDATE. ⚠️ NO DELETE POLICY ([db-MAJOR-D]):
-- signals.watched_repo_id cascades from watched_repos, so a user hard-delete
-- would annihilate that repo's entire signal history. Unwatching is
-- is_active = false, not a DELETE. Absence of a policy is deny-by-default
-- under RLS — the correct expression of "no authenticated DELETE path".
CREATE POLICY watched_repos_select_own
  ON public.watched_repos FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY watched_repos_insert_own
  ON public.watched_repos FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY watched_repos_update_own
  ON public.watched_repos FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- signals — SELECT only. Written exclusively by service-role (the poller).
CREATE POLICY signals_select_own
  ON public.signals FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- signal_candidates — SELECT only in this ADR. ADR 0021 adds the triage
-- UPDATE policy; not built here.
CREATE POLICY signal_candidates_select_own
  ON public.signal_candidates FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- [db-D]: pair every absent write policy with an explicit REVOKE + a
-- narrowly-scoped GRANT, so read-only is enforced at two independent layers
-- (RLS policy absence AND privilege absence) rather than resting on the
-- absence of a policy alone. Supabase's platform-level default grants ALL on
-- every public-schema table to `authenticated`; these statements narrow that
-- back down per table to exactly the operations §3.5's table allows.
REVOKE ALL ON public.github_connections FROM authenticated;
GRANT SELECT ON public.github_connections TO authenticated;

REVOKE ALL ON public.watched_repos FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.watched_repos TO authenticated;

REVOKE ALL ON public.signals FROM authenticated;
GRANT SELECT ON public.signals TO authenticated;

REVOKE ALL ON public.signal_candidates FROM authenticated;
GRANT SELECT ON public.signal_candidates TO authenticated;
