-- ADR 0025 §9.1/§9.4/§6.3-6.5 (Session 32 I2.5) — the two business-scoped
-- tables the backfill orchestrator runs against, and the RPCs that operate
-- on them. Columns transcribed verbatim from ADR §9.1; every function
-- follows the house SECURITY DEFINER pattern (REVOKE ALL FROM PUBLIC, THEN
-- a SEPARATE REVOKE EXECUTE FROM anon, authenticated — a bare "REVOKE ALL
-- FROM PUBLIC" does not touch Supabase's ALTER DEFAULT PRIVILEGES named
-- grants to anon/authenticated, the exact privilege-escalation
-- 20260912090000_ai_budget_rpc_revoke_named_roles.sql closed).

-- ─── social_backfill_runs ────────────────────────────────────────────────────

CREATE TABLE public.social_backfill_runs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  social_account_id     uuid        NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform              text        NOT NULL
                                     CHECK (platform IN ('linkedin','twitter','instagram','facebook','threads')),
  status                text        NOT NULL DEFAULT 'queued'
                                     CHECK (status IN (
                                       'queued','fetching','extracting','awaiting_ratification',
                                       'ratified','unsupported','failed','discarded'
                                     )),
  partial               boolean     NOT NULL DEFAULT false,
  account_role          text        NULL CHECK (account_role IN ('brand','founder')),
  weighting             text        NULL,
  posts_fetched         integer     NOT NULL DEFAULT 0,
  posts_extracted       integer     NOT NULL DEFAULT 0,
  platform_posts_read   integer     NOT NULL DEFAULT 0,
  spend_cents           integer     NOT NULL DEFAULT 0,
  ceiling_cents         integer     NOT NULL DEFAULT 50,
  passes_done           integer     NOT NULL DEFAULT 0,
  summary               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  staged_voice          jsonb       NULL,
  voice_status          text        NULL CHECK (voice_status IN ('pending','applied','refused_cap','failed','declined')),
  voice_applied_to      text        NULL,
  voice_applied_at      timestamptz NULL,
  error_code            text        NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz NULL,
  completed_at          timestamptz NULL,
  ratified_at           timestamptz NULL
);

-- BACKFILL-ONCE-PER-ACCOUNT (§12 constraint 18): at most one LIVE
-- (non-discarded) run per account — a `failed` run occupies the slot until
-- resumed, never replaced (§6.5).
CREATE UNIQUE INDEX social_backfill_runs_live_account_uq
  ON public.social_backfill_runs (social_account_id)
  WHERE status <> 'discarded';

-- The claim/tick index — every state the cron tick's bounded work touches.
CREATE INDEX social_backfill_runs_claim_idx
  ON public.social_backfill_runs (status, updated_at)
  WHERE status IN ('queued','fetching','extracting');

CREATE INDEX social_backfill_runs_business_id_idx ON public.social_backfill_runs (business_id);
CREATE INDEX social_backfill_runs_social_account_id_idx ON public.social_backfill_runs (social_account_id);

CREATE TRIGGER trg_social_backfill_runs_updated_at
  BEFORE UPDATE ON public.social_backfill_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_backfill_runs ENABLE ROW LEVEL SECURITY;

-- Table-level default privileges (20260707190000:32) grant authenticated
-- SELECT/INSERT/UPDATE/DELETE at CREATE time — narrowed back down
-- explicitly, matching the ai_budget_daily precedent's double-layer
-- defense (RLS zero-policy alone is not treated as sufficient by this
-- codebase's own house pattern).
REVOKE ALL ON public.social_backfill_runs FROM authenticated, anon;
GRANT SELECT ON public.social_backfill_runs TO authenticated;

-- ONE SELECT policy for members (InitPlan-wrapped form), so the onboarding
-- page can show progress. NO INSERT/UPDATE/DELETE policy for authenticated
-- — every write is service-role.
CREATE POLICY social_backfill_runs_select_own
  ON public.social_backfill_runs FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ─── social_backfill_posts ───────────────────────────────────────────────────

CREATE TABLE public.social_backfill_posts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  run_id             uuid        NOT NULL REFERENCES public.social_backfill_runs(id) ON DELETE CASCADE,
  social_account_id  uuid        NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform_post_id   text        NOT NULL,
  published_at       timestamptz NOT NULL,
  content            text        NOT NULL,
  url                text        NULL,
  format             text        NOT NULL CHECK (format IN ('text','image','video','link','multi','other')),
  metrics            jsonb       NULL,
  lift               numeric     NULL,
  extraction_status  text        NOT NULL DEFAULT 'pending'
                                  CHECK (extraction_status IN ('pending','claimed','extracted','skipped','failed')),
  claimed_at         timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (social_account_id, platform_post_id)
);

CREATE INDEX social_backfill_posts_claim_idx
  ON public.social_backfill_posts (run_id, extraction_status, published_at);

CREATE INDEX social_backfill_posts_business_id_idx ON public.social_backfill_posts (business_id);

ALTER TABLE public.social_backfill_posts ENABLE ROW LEVEL SECURITY;

-- NO policy at all — deny by default (§9.1: "RLS enabled with no policy for
-- authenticated at all"). Also explicitly REVOKEd at the table-privilege
-- layer, same double-layer reasoning as above: staged post text is raw,
-- untrusted, short-lived customer content that must never be readable by
-- an authenticated client directly.
REVOKE ALL ON public.social_backfill_posts FROM authenticated, anon;

-- ─── claim_backfill_posts — mirrors claim_post_edit_signals exactly in shape
-- (20260726010000_learning_capture.sql:231-249) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_backfill_posts(p_run_id uuid, p_limit integer)
RETURNS SETOF public.social_backfill_posts
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_posts
     SET extraction_status = 'claimed', claimed_at = now()
   WHERE id IN (
     SELECT id FROM public.social_backfill_posts
      WHERE run_id = p_run_id AND extraction_status = 'pending'
      ORDER BY published_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_backfill_posts(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_backfill_posts(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_backfill_posts(uuid, integer) TO service_role;

-- ─── reserve_backfill_spend / reconcile_backfill_spend — the
-- SIGNAL3-COST-CEILING-ATOMIC idiom (reserve_ai_budget precedent,
-- 20260909110000_ai_budget_daily_rename.sql:97-117), scoped to a single
-- run row rather than an upsert since the row already exists at enqueue.
-- Zero rows returned means "not reserved" — the caller checks row count,
-- never re-reads first. ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reserve_backfill_spend(p_run_id uuid, p_estimate_cents integer)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET spend_cents = spend_cents + p_estimate_cents
   WHERE id = p_run_id
     AND spend_cents + p_estimate_cents <= ceiling_cents
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.reserve_backfill_spend(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_backfill_spend(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_backfill_spend(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_backfill_spend(p_run_id uuid, p_reserved_cents integer, p_actual_cents integer)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET spend_cents = GREATEST(spend_cents + (p_actual_cents - p_reserved_cents), 0)
   WHERE id = p_run_id
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.reconcile_backfill_spend(uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_backfill_spend(uuid, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_backfill_spend(uuid, integer, integer) TO service_role;

-- ─── enqueue_backfill_run — atomic, no read-then-write. The NOT EXISTS /
-- count(*) < 3 pre-checks are an optimization to avoid throwing in the
-- common case; the ACTUAL atomicity guarantee is the partial UNIQUE index
-- above (social_backfill_runs_live_account_uq), which a concurrent racing
-- insert can still violate — caught here and turned into "no row returned"
-- (never an uncaught exception) so the caller's "returns the run or null"
-- contract holds under a genuine race, not just in the common case. ────────

CREATE OR REPLACE FUNCTION public.enqueue_backfill_run(p_business_id uuid, p_social_account_id uuid, p_platform text)
RETURNS SETOF public.social_backfill_runs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.social_backfill_runs (business_id, social_account_id, platform, status)
  SELECT p_business_id, p_social_account_id, p_platform, 'queued'
   WHERE NOT EXISTS (
     SELECT 1 FROM public.social_backfill_runs
      WHERE social_account_id = p_social_account_id AND status <> 'discarded'
   )
   AND (
     SELECT count(*) FROM public.social_backfill_runs
      WHERE social_account_id = p_social_account_id
   ) < 3
  RETURNING *;
EXCEPTION WHEN unique_violation THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_backfill_run(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_backfill_run(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_backfill_run(uuid, uuid, text) TO service_role;

-- ─── resume_backfill_run — failed -> queued, same row. error_code =
-- 'caller_bug' (§2.5: a wrong constant, retrying cannot fix it) is
-- excluded — not resumable. ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resume_backfill_run(p_run_id uuid)
RETURNS SETOF public.social_backfill_runs
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.social_backfill_runs
     SET status = 'queued', updated_at = now()
   WHERE id = p_run_id
     AND status = 'failed'
     AND error_code IS DISTINCT FROM 'caller_bug'
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.resume_backfill_run(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resume_backfill_run(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_backfill_run(uuid) TO service_role;

-- ─── discard_backfill_run — ADR §6.4 requires discard to retire candidates
-- and purge staging "in one transaction"; a SECURITY DEFINER plpgsql
-- function body IS one transaction — this is a transcription of that
-- requirement, not a new decision. Same grant/membership shape as
-- ratify_backfill_run (§9.4): p_user_id is checked against business_members
-- when non-null (active membership; the owner-without-a-member-row case is
-- covered the same way user_can's own owner override is,
-- 20260702120200_user_can.sql:19-22 — discard is not ratify's
-- approver/is_admin-gated action, so any active member or the owner may
-- discard their own business's run). NULL is permitted ONLY for the
-- disconnect/system path (I2.9), which has no authenticated session to
-- name a user from. Candidate retirement (the memory-row side) is added in
-- I2.6 via CREATE OR REPLACE, once the import/provenance columns exist on
-- the four memory tables — this function is created here so the staging
-- purge half is not blocked on that later step. ────────────────────────────

CREATE OR REPLACE FUNCTION public.discard_backfill_run(p_run_id uuid, p_user_id uuid)
RETURNS SETOF public.social_backfill_runs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id
    FROM public.social_backfill_runs
   WHERE id = p_run_id;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.business_members
       WHERE business_id = v_business_id AND user_id = p_user_id AND status = 'active'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.businesses
       WHERE id = v_business_id AND owner_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'discard_backfill_run: % is not an active member of business %', p_user_id, v_business_id;
    END IF;
  END IF;

  DELETE FROM public.social_backfill_posts WHERE run_id = p_run_id;

  RETURN QUERY
  UPDATE public.social_backfill_runs
     SET status = 'discarded', staged_voice = NULL, updated_at = now()
   WHERE id = p_run_id
     AND status NOT IN ('ratified', 'discarded')
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.discard_backfill_run(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.discard_backfill_run(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_backfill_run(uuid, uuid) TO service_role;

-- ─── ai_budget_daily purpose CHECK — add 'backfill_cents' ───────────────────
--
-- Looked up in pg_constraint BY ITS DEFINITION (never a guessed name): a
-- wrong DROP CONSTRAINT IF EXISTS guess would silently no-op, leave the old
-- CHECK in place, and reject every backfill_cents write. RAISES unless
-- exactly one row matches (I2.0 confirmed live: exactly one,
-- ai_budget_daily_purpose_check, def
-- "CHECK ((purpose = ANY (ARRAY['triage_cents'::text, 'generation_posts'::text])))").

DO $$
DECLARE
  v_conname text;
  v_count   int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'ai_budget_daily'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%purpose%';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ai_budget_daily purpose CHECK lookup found % row(s) by definition, expected exactly 1', v_count;
  END IF;

  SELECT c.conname INTO v_conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'ai_budget_daily'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%purpose%';

  EXECUTE format('ALTER TABLE public.ai_budget_daily DROP CONSTRAINT %I', v_conname);
END $$;

ALTER TABLE public.ai_budget_daily
  ADD CONSTRAINT ai_budget_daily_purpose_check
    CHECK (purpose IN ('triage_cents', 'generation_posts', 'backfill_cents'));
