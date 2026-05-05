-- Migration 11: post_metrics
--
-- Latest-known platform metrics for a post. One row per post, updated in place
-- by the metrics worker via: INSERT ... ON CONFLICT (post_id) DO UPDATE.
--
-- Nullable metrics mean "platform doesn't expose this metric". Zero is a real
-- value (a post with no likes); NULL means the data is unavailable.
--
-- business_id is denormalised for RLS efficiency.

CREATE TABLE public.post_metrics (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        uuid        NOT NULL UNIQUE REFERENCES public.posts(id) ON DELETE CASCADE,
  business_id    uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  likes          int,
  comments       int,
  shares         int,
  saves          int,
  clicks         int,
  reach          int,
  impressions    int,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX post_metrics_business_id_idx
  ON public.post_metrics (business_id);

-- Used by the metrics worker to find rows that haven't been synced recently.
CREATE INDEX post_metrics_last_synced_at_idx
  ON public.post_metrics (last_synced_at);

CREATE TRIGGER trg_post_metrics_updated_at
BEFORE UPDATE ON public.post_metrics
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.post_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_metrics_select_own
  ON public.post_metrics FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY post_metrics_insert_own
  ON public.post_metrics FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY post_metrics_update_own
  ON public.post_metrics FOR UPDATE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()))
  WITH CHECK (business_id = ANY (public.get_user_business_ids()));

CREATE POLICY post_metrics_delete_own
  ON public.post_metrics FOR DELETE TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));
