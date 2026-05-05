-- Migration 10: posts
--
-- The publishable unit. Flat model: one row per (campaign, platform). There is
-- no post_variants child table — cross-platform "approve once" is implemented
-- in app code by creating N rows in one transaction.
--
-- business_id is denormalised from the parent campaign for RLS efficiency.
-- /lib/db/posts.ts is the sole writer and must keep it consistent.
--
-- Status machine (enforced in /lib/db/posts.ts, not by DB triggers):
--   draft → approved → scheduled → published
--   draft → skipped
--   scheduled → failed → scheduled (re-queue)

CREATE TABLE public.posts (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id              uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  business_id              uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform                 text        NOT NULL
                             CHECK (platform IN ('linkedin','twitter','instagram','facebook','threads')),
  content                  text        NOT NULL,
  hashtags                 text[]      NOT NULL DEFAULT '{}',
  media_urls               text[]      NOT NULL DEFAULT '{}',
  scheduled_at             timestamptz NOT NULL,
  published_at             timestamptz,
  platform_post_id         text,
  status                   text        NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','approved','scheduled','published','failed','skipped')),
  rejection_note           text,
  ai_generation_metadata   jsonb       NOT NULL DEFAULT '{}',
  deleted_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Partial index for the publishing worker: find posts due to publish.
-- Used as: WHERE status = 'approved' AND scheduled_at <= now()
CREATE INDEX posts_publishing_queue_idx
  ON public.posts (scheduled_at)
  WHERE status = 'approved';

CREATE INDEX posts_campaign_id_idx
  ON public.posts (campaign_id);

CREATE INDEX posts_business_id_created_at_idx
  ON public.posts (business_id, created_at DESC);

CREATE INDEX posts_business_id_status_idx
  ON public.posts (business_id, status);

CREATE TRIGGER trg_posts_updated_at
BEFORE UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY posts_select_own
  ON public.posts FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY posts_insert_own
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY posts_update_own
  ON public.posts FOR UPDATE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()))
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY posts_delete_own
  ON public.posts FOR DELETE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));
