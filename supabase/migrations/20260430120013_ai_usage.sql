-- Migration 13: ai_usage
--
-- Append-only audit and cost log for every Anthropic SDK call made through
-- /lib/ai/. Rows are written by the service-role client and are immutable in
-- normal operation (no updates, no deletes).
--
-- No updated_at column (rows are immutable).
-- No INSERT/UPDATE/DELETE policies for authenticated — service role bypasses RLS.
--
-- cost_cents is computed at write time from the Anthropic SDK response using
-- pricing logic in /lib/ai/pricing.ts.

CREATE TABLE public.ai_usage (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  prompt_id      text        NOT NULL,
  prompt_version int         NOT NULL,
  model          text        NOT NULL,
  input_tokens   int         NOT NULL CHECK (input_tokens >= 0),
  output_tokens  int         NOT NULL CHECK (output_tokens >= 0),
  cost_cents     int         NOT NULL CHECK (cost_cents >= 0),
  latency_ms     int         NOT NULL CHECK (latency_ms >= 0),
  success        boolean     NOT NULL,
  error_code     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Per-business cost rollups (e.g. monthly spend dashboard).
CREATE INDEX ai_usage_business_id_created_at_idx
  ON public.ai_usage (business_id, created_at DESC);

-- Prompt performance analysis and A/B comparison.
CREATE INDEX ai_usage_prompt_id_version_created_at_idx
  ON public.ai_usage (prompt_id, prompt_version, created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- SELECT only: authenticated users can see their own usage.
-- No INSERT/UPDATE/DELETE policies — writes are service-role only.
CREATE POLICY ai_usage_select_own
  ON public.ai_usage FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));
