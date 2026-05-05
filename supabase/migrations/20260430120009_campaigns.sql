-- Migration 9: campaigns
--
-- A user-defined content initiative. Campaigns own posts. Soft-deleted via
-- deleted_at (campaigns reference posts that may be billing-relevant).

CREATE TABLE public.campaigns (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  objective             text        NOT NULL,
  special_instructions  text,
  platforms             text[]      NOT NULL
                          CHECK (
                            platforms <@ ARRAY['linkedin','twitter','instagram','facebook','threads']::text[]
                            AND cardinality(platforms) >= 1
                          ),
  frequency             text        NOT NULL
                          CHECK (frequency IN ('daily','3x_week','weekly','custom')),
  posts_per_week        int         NOT NULL
                          CHECK (posts_per_week BETWEEN 1 AND 21),
  start_date            date        NOT NULL,
  end_date              date        CHECK (end_date IS NULL OR end_date >= start_date),
  status                text        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','paused','completed')),
  total_posts_planned   int         NOT NULL DEFAULT 0,
  total_posts_published int         NOT NULL DEFAULT 0,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_business_id_idx
  ON public.campaigns (business_id);

CREATE INDEX campaigns_business_id_status_idx
  ON public.campaigns (business_id, status);

CREATE TRIGGER trg_campaigns_updated_at
BEFORE UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_select_own
  ON public.campaigns FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY campaigns_insert_own
  ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY campaigns_update_own
  ON public.campaigns FOR UPDATE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()))
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY campaigns_delete_own
  ON public.campaigns FOR DELETE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));
