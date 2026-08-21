-- Mode 1 Studio — studio_drafts (ADR 0019 §2.2).
--
-- A Studio draft is pre-campaign, pre-platform scratch content: the founder
-- rejected nullable campaign_id/platform on `posts` (option (a) — ADR 0019
-- §2.3) because posts.campaign_id is NOT NULL REFERENCES campaigns(id) ON
-- DELETE CASCADE and posts.platform is NOT NULL (supabase/migrations/
-- 20260430120010_posts.sql:17,19-20), and every list query that joins
-- campaigns!inner (lib/db/posts.ts:70,130) would either break or need a
-- parallel nullable-join code path duplicated everywhere. A separate table
-- avoids both.
--
-- Backfill: NONE. This is a new feature table with no prior data anywhere in
-- the schema to migrate (L-13).

CREATE TABLE public.studio_drafts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- A draft may legitimately be empty (a fresh, unstarted Studio session).
  content              text        NOT NULL DEFAULT '',
  -- Deliberately NULLABLE, unlike posts.platform's NOT NULL ([db-MINOR-1]):
  -- a draft has no target platform until the author picks one.
  platform             text
                          CHECK (platform IS NULL OR platform IN ('linkedin','twitter','instagram','facebook','threads')),
  -- Deterministic diff/verifier keying, generated so the app can never write
  -- a stale hash out of sync with content ([db-MAJOR-5]).
  content_hash         text        GENERATED ALWAYS AS (encode(sha256(content::bytea), 'hex')) STORED,
  -- AI-suggested edits, computed against a specific content_hash so a stale
  -- suggestion (content changed since) is detectable without a second table
  -- (a second table would add its own RLS/cascade/purge surface and make
  -- accept non-atomic). Capped to bound user-controlled jsonb growth,
  -- mirroring ADR 0016 §15's topContent cap precedent. pg_column_size bounds
  -- ON-DISK (post-TOAST-compression) size, not logical/decompressed JSON
  -- size — database-reviewer (D2.1) flagged this distinction; the intent
  -- here is storage-growth bounding (matching the ADR 0016 §15 precedent
  -- this mirrors), so pg_column_size is the correct idiom, not a gap.
  suggestions          jsonb
                          CHECK (suggestions IS NULL OR pg_column_size(suggestions) <= 20000),
  -- A sha256 hex digest (same shape content_hash produces), so its format is
  -- enforced the same way rather than left as unconstrained free text
  -- (database-reviewer, D2.1).
  suggestions_for_hash text
                          CHECK (suggestions_for_hash IS NULL OR suggestions_for_hash ~ '^[0-9a-f]{64}$'),
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- NOT added, explicitly (ADR 0019 §2.2/§0.2):
--   - a status enum shadowing posts' draft→approved→... state machine;
--   - a role column;
--   - a nullable campaign_id "for the future promote step" — that
--     reintroduces option (a) in miniature and is refused (A-4).

CREATE TRIGGER trg_studio_drafts_updated_at
BEFORE UPDATE ON public.studio_drafts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trailing `id` because updated_at is not unique — without it, the bounded
-- list query is non-deterministic across ties at the same updated_at.
CREATE INDEX studio_drafts_business_id_updated_at_idx
  ON public.studio_drafts (business_id, updated_at DESC, id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.studio_drafts ENABLE ROW LEVEL SECURITY;

-- InitPlan form (business_id = ANY (SELECT unnest(...))) copied from
-- 20260430120017_fix_rls_function_caching.sql:110-132 — the bare unwrapped
-- form evaluates get_user_business_ids() once PER ROW; the SELECT-wrapped
-- form lets Postgres cache it once per statement.

CREATE POLICY studio_drafts_select_own
  ON public.studio_drafts FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY studio_drafts_insert_own
  ON public.studio_drafts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY studio_drafts_update_own
  ON public.studio_drafts FOR UPDATE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY studio_drafts_delete_own
  ON public.studio_drafts FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

-- ⚠️ Deliberately NO BEFORE DELETE trigger of any kind (ADR 0019 §12.2).
-- purge_business's root DELETE FROM public.businesses (20260702120700_
-- purge_business_member_delete.sql:62) has no EXCEPTION block anywhere in
-- its body, and a raising BEFORE DELETE guard fires identically on an
-- FK-cascade delete and a direct one — there is no way to distinguish them
-- from inside the trigger. A guard here would abort GDPR erasure for every
-- business that ever created a Studio draft. purge_business itself needs no
-- edit: this table's ON DELETE CASCADE is sufficient and is exercised by its
-- existing root delete.
