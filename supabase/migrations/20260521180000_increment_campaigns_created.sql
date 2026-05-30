-- Atomic increment for trial_state.campaigns_created_count.
-- Follows the same pattern as increment_brand_voice_attempts (migration 025).
-- Called by the campaign creation Server Action after a campaign is saved.

CREATE OR REPLACE FUNCTION public.increment_campaigns_created(p_business_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.trial_state
  SET campaigns_created_count = campaigns_created_count + 1,
      updated_at = now()
  WHERE business_id = p_business_id;
$$;

REVOKE ALL ON FUNCTION public.increment_campaigns_created(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_campaigns_created(uuid) TO service_role;
