-- Migration 26: post_generation_sessions + increment_posts_generated_by
--
-- post_generation_sessions is the durable state record for one "Generate Posts"
-- click. The client polls it; the orchestrator writes to it via service-role.
-- Authenticated users have SELECT only — all writes go through the AI orchestrator.
--
-- increment_posts_generated_by(business_id, amount) is the bulk-increment RPC
-- called once after the batch insert, replacing the per-call increment that
-- runner.ts skips for prompt_id = 'post-generation' (ADR 0004 R-1).

CREATE TABLE public.post_generation_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id   uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'generating', 'complete', 'failed')),
  error_code    text,
  posts_planned int         NOT NULL CHECK (posts_planned >= 1),
  posts_created int         NOT NULL DEFAULT 0 CHECK (posts_created >= 0),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX post_generation_sessions_campaign_id_created_at_idx
  ON public.post_generation_sessions (campaign_id, created_at DESC);

CREATE INDEX post_generation_sessions_business_id_created_at_idx
  ON public.post_generation_sessions (business_id, created_at DESC);

CREATE TRIGGER trg_post_generation_sessions_updated_at
BEFORE UPDATE ON public.post_generation_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.post_generation_sessions ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read their own sessions (for polling).
-- All writes (INSERT/UPDATE) are service_role only — service_role bypasses RLS.
CREATE POLICY post_generation_sessions_select_own
  ON public.post_generation_sessions FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

-- Bulk-increment RPC: increments trial_state.posts_generated_count by `p_amount`
-- in a single atomic UPDATE (no read round-trip). Mirrors increment_posts_generated
-- (migration 025) but takes an amount instead of always adding 1.
CREATE OR REPLACE FUNCTION public.increment_posts_generated_by(
  p_business_id uuid,
  p_amount      int
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.trial_state
  SET posts_generated_count = posts_generated_count + p_amount,
      updated_at = now()
  WHERE business_id = p_business_id;
$$;

REVOKE ALL ON FUNCTION public.increment_posts_generated_by(uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_posts_generated_by(uuid, int) TO service_role;
