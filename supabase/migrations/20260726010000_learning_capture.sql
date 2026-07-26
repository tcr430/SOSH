-- ADR 0018 §2.3/§3.3 — Diff-Based Learning Capture, Track C schema (Session 25 C2.2)
--
-- Two tables:
--   post_ai_originals — immutable snapshot of what the model generated, taken
--     at generation/regeneration time (§2.3). Write-once: never updated.
--   post_edit_signals — durable outbox row per (post, ai_original) pending
--     Tier-0/Tier-1 distillation, enqueued ONLY on a draft->approved
--     transition (§3.3). No diffing, text processing, or memory writes happen
--     here — that is the bright line (§0.2/A-1): this migration only ever
--     copies NEW.content/NEW.hashtags into a queue row.
--
-- RLS uses the InitPlan-wrapped form
-- `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`,
-- copied from governed_memory.sql:232-257 — NOT the bare, per-row-evaluated
-- `= ANY (public.get_user_business_ids())` form ([db-NIT-1]).

-- ─── post_ai_originals (ADR §2.3) ───────────────────────────────────────────
--
-- Multi-parent FK (business_id + post_id + campaign_id) is intentional
-- defense in depth ([db-NIT-2]): post_id -> posts already cascades through
-- campaign_id -> campaigns -> businesses, but a direct business_id/campaign_id
-- FK means this row is still purged even if that chain is ever restructured.
--
-- No updated_at column and no set_updated_at() trigger: the row is immutable
-- by design (write-once trigger below), so an updated_at column would be a
-- lie about a column that can never change after insert.

CREATE TABLE public.post_ai_originals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  post_id          uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  campaign_id      uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  revision         int         NOT NULL DEFAULT 1 CHECK (revision >= 1),
  generation_kind  text        NOT NULL CHECK (generation_kind IN ('initial', 'regeneration')),
  format           text        NOT NULL CHECK (format IN ('single', 'thread')),
  payload          jsonb       NOT NULL,
  rendered_content text        NOT NULL,
  hashtags         text[]      NOT NULL DEFAULT '{}',
  schema_version   int         NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, revision)
);

CREATE INDEX post_ai_originals_business_id_idx ON public.post_ai_originals (business_id);
CREATE INDEX post_ai_originals_campaign_id_idx ON public.post_ai_originals (campaign_id);

-- [db-BLOCKER-1]/[sec-HIGH-1] WRITE-ONCE: BEFORE UPDATE ONLY. NEVER add
-- OR DELETE to this trigger. A BEFORE DELETE trigger fires identically on an
-- FK-cascade delete and a direct one — there is no way inside a trigger body
-- to distinguish "this row is being purged because purge_business deleted its
-- parent business" from "someone issued DELETE FROM post_ai_originals
-- directly". purge_business (20260702120700_purge_business_member_delete.sql
-- :62, `DELETE FROM public.businesses WHERE id = p_business_id;`) has NO
-- EXCEPTION block anywhere in its body — a BEFORE DELETE guard here would
-- raise inside that statement and abort GDPR erasure for every business that
-- ever generated a post. So this table's write-once guard covers UPDATE only;
-- deletion (direct or cascaded) is always allowed.
CREATE OR REPLACE FUNCTION public.reject_post_ai_originals_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'post_ai_originals rows are immutable (write-once, ADR 0018 §2.5)';
END;
$$;

CREATE TRIGGER trg_post_ai_originals_write_once
BEFORE UPDATE ON public.post_ai_originals
FOR EACH ROW EXECUTE FUNCTION public.reject_post_ai_originals_update();

ALTER TABLE public.post_ai_originals ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_ai_originals_select_own
  ON public.post_ai_originals FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY post_ai_originals_insert_own
  ON public.post_ai_originals FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- This policy can never actually let an UPDATE through in practice: the
-- BEFORE UPDATE write-once trigger above unconditionally rejects every
-- update regardless of what RLS would otherwise permit. Kept anyway as
-- harmless defense-in-depth (database-reviewer, C2.2 pass) — noted here so a
-- future reader doesn't assume updates are reachable through this policy.
CREATE POLICY post_ai_originals_update_own
  ON public.post_ai_originals FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- EXCEPTION to the usual four-policy set: NO authenticated DELETE policy.
-- This is the app-layer half of write-once (§2.5) — same posture as
-- email_outbox's no-authenticated-DELETE (20260607100000_email_outbox.sql
-- :41-43). Deletion of these rows happens only via the businesses cascade
-- (service-role, purge_business) or a future service-role retention job.

-- ─── post_edit_signals (ADR §3.3) ───────────────────────────────────────────

CREATE TABLE public.post_edit_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  post_id         uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  campaign_id     uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  ai_original_id  uuid        NOT NULL REFERENCES public.post_ai_originals(id) ON DELETE CASCADE,
  human_content   text        NOT NULL,
  human_hashtags  text[]      NOT NULL DEFAULT '{}',
  approved_at     timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'abandoned')),
  attempts        int         NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  processed_at    timestamptz,
  class           text        CHECK (class IS NULL OR class IN ('preference', 'correction', 'inconclusive')),
  pattern_key     text,
  signals         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, ai_original_id)
);

-- Claimable partial index for the (future) tick worker: only pending rows
-- ready to run, ordered by readiness. Mirrors email_outbox_drainable_idx.
CREATE INDEX post_edit_signals_claimable_idx
  ON public.post_edit_signals (next_attempt_at)
  WHERE status = 'pending';

-- Covering partial index for §9.6-style pattern-key recompute scans against
-- already-processed signals.
CREATE INDEX post_edit_signals_processed_covering_idx
  ON public.post_edit_signals (business_id, pattern_key) INCLUDE (campaign_id)
  WHERE status = 'processed';

-- Explicit FK indexes: neither is implied by the UNIQUE constraint, which
-- leads on post_id.
CREATE INDEX post_edit_signals_ai_original_id_idx ON public.post_edit_signals (ai_original_id);
CREATE INDEX post_edit_signals_campaign_id_idx ON public.post_edit_signals (campaign_id);

-- Plain business_id index (database-reviewer, C2.2 pre-commit pass): every
-- RLS policy below filters on business_id regardless of status, but the only
-- other index containing business_id is the processed-only partial covering
-- index above — it cannot serve a general "my own signals" or "my pending/
-- failed signals" query. Mirrors the plain business_id indexes already on
-- post_ai_originals and posts.
CREATE INDEX post_edit_signals_business_id_idx
  ON public.post_edit_signals (business_id, created_at DESC);

CREATE TRIGGER trg_post_edit_signals_updated_at
BEFORE UPDATE ON public.post_edit_signals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.post_edit_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_edit_signals_select_own
  ON public.post_edit_signals FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY post_edit_signals_insert_own
  ON public.post_edit_signals FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY post_edit_signals_update_own
  ON public.post_edit_signals FOR UPDATE TO authenticated
  USING      (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY post_edit_signals_delete_own
  ON public.post_edit_signals FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ─── Enqueue-only capture trigger (LEARN-TRIGGER-ENQUEUE-ONLY, §0.2/A-1) ────
--
-- Fires on EVERY posts UPDATE (no WHEN clause — the transition guard lives in
-- the body per [sec-LOW-2], so it is visible to anyone reading the function,
-- not hidden in catalog metadata). On draft->approved, enqueues exactly one
-- post_edit_signals row from the latest snapshot. Nothing else: no diffing,
-- no text processing, no network calls, no memory writes. SECURITY DEFINER
-- because approvals happen on the authenticated path (posts RLS lets the
-- owning business's members UPDATE their own posts) but this function must
-- write to post_edit_signals/read post_ai_originals regardless of which
-- authenticated user's UPDATE fired it — same posture as the claim RPC below.
CREATE OR REPLACE FUNCTION public.enqueue_post_edit_signal()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_origin_id uuid;
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    -- Sequencing assumption (database-reviewer, C2.2 pass), stated explicitly
    -- rather than left implicit: this lookup takes no lock, so it assumes
    -- regeneration happens-before approval for a given post in the product's
    -- actual workflow, never concurrently on the same post. If a regenerate
    -- ever raced a concurrent approve on the same post_id, this could enqueue
    -- against a stale (non-latest) ai_original_id. Not addressed here — the
    -- product flow never triggers a concurrent regenerate+approve on one
    -- post, so this is a documented invariant, not a defect.
    SELECT id INTO v_origin_id
      FROM public.post_ai_originals
     WHERE post_id = NEW.id
     ORDER BY revision DESC
     LIMIT 1;

    -- [db-MAJOR-1]: a snapshot-less post (manual origin, or any post with no
    -- post_ai_originals row) must NOT fail the approve — just skip.
    IF v_origin_id IS NOT NULL THEN
      INSERT INTO public.post_edit_signals
        (business_id, post_id, campaign_id, ai_original_id, human_content, human_hashtags, approved_at)
      VALUES
        (NEW.business_id, NEW.id, NEW.campaign_id, v_origin_id, NEW.content, NEW.hashtags, now())
      ON CONFLICT (post_id, ai_original_id) DO UPDATE
        SET human_content  = EXCLUDED.human_content,
            human_hashtags = EXCLUDED.human_hashtags,
            approved_at    = EXCLUDED.approved_at,
            updated_at     = now()
        WHERE post_edit_signals.status = 'pending';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_posts_enqueue_edit_signal
AFTER UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.enqueue_post_edit_signal();

-- ─── claim_post_edit_signals — atomic batch claim, mirrors claim_email_outbox
-- (20260607100000_email_outbox.sql:49-64) exactly in shape. ─────────────────

CREATE OR REPLACE FUNCTION public.claim_post_edit_signals(batch_size int)
RETURNS SETOF public.post_edit_signals
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.post_edit_signals
     SET status = 'processing', updated_at = now()
   WHERE id IN (
     SELECT id FROM public.post_edit_signals
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT batch_size
   )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_post_edit_signals(int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_post_edit_signals(int) TO service_role;
