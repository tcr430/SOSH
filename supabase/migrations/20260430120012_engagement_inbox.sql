-- Migration 12: engagement_inbox
--
-- Comments, DMs, and mentions land here after ingestion from platform APIs.
-- Each row is classified by sentiment and may carry an AI draft reply.
--
-- UNIQUE (platform, platform_item_id) prevents duplicate ingestion. This
-- constraint is global (not per-business) because platform_item_id is unique
-- within a platform regardless of which SOSH business received it.
--
-- post_id is nullable (DMs and mentions may not relate to a specific post) and
-- uses SET NULL on cascade so engagement context is not lost when a post is
-- soft-deleted.

CREATE TABLE public.engagement_inbox (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  post_id              uuid        REFERENCES public.posts(id) ON DELETE SET NULL,
  platform             text        NOT NULL
                         CHECK (platform IN ('linkedin','twitter','instagram','facebook','threads')),
  type                 text        NOT NULL
                         CHECK (type IN ('comment','dm','mention')),
  platform_item_id     text        NOT NULL,
  author_username      text        NOT NULL,
  author_display_name  text,
  content              text        NOT NULL,
  received_at          timestamptz NOT NULL,
  sentiment            text        CHECK (sentiment IN ('positive','neutral','negative','urgent')),
  ai_draft_reply       text,
  status               text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','replied','ignored','auto_replied')),
  replied_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_item_id)
);

-- Primary inbox query: per-business, filtered by status, sorted newest first.
CREATE INDEX engagement_inbox_business_status_received_idx
  ON public.engagement_inbox (business_id, status, received_at DESC);

-- Filter panel: by type and status.
CREATE INDEX engagement_inbox_business_type_status_idx
  ON public.engagement_inbox (business_id, type, status);

-- Surfaces engagement on a specific post; partial to exclude the many NULL rows.
CREATE INDEX engagement_inbox_post_id_idx
  ON public.engagement_inbox (post_id)
  WHERE post_id IS NOT NULL;

CREATE TRIGGER trg_engagement_inbox_updated_at
BEFORE UPDATE ON public.engagement_inbox
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.engagement_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY engagement_inbox_select_own
  ON public.engagement_inbox FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY engagement_inbox_insert_own
  ON public.engagement_inbox FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY engagement_inbox_update_own
  ON public.engagement_inbox FOR UPDATE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()))
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY engagement_inbox_delete_own
  ON public.engagement_inbox FOR DELETE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));
