-- Migration 7: trial_state
--
-- One row per business, tracking trial enforcement state. Created automatically
-- by a trigger on businesses INSERT so the app never needs to remember.
--
-- trial_started_at is NULL until the first social_account is connected
-- (set by the trigger in migration 8). The 14-day trial clock begins then.
--
-- RLS: authenticated users may SELECT their own trial_state; INSERT/UPDATE/DELETE
-- is restricted to service_role (enforced by omission — no write policies).

CREATE TABLE public.trial_state (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid        NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  trial_started_at         timestamptz,
  campaigns_created_count  int         NOT NULL DEFAULT 0,
  posts_generated_count    int         NOT NULL DEFAULT 0,
  work_email_verified      boolean     NOT NULL DEFAULT false,
  trial_card_fingerprint   text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_trial_state_updated_at
BEFORE UPDATE ON public.trial_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.trial_state ENABLE ROW LEVEL SECURITY;

-- SELECT only: authenticated users can read their own trial state.
-- No INSERT/UPDATE/DELETE policies — writes are service-role only.
CREATE POLICY trial_state_select_own
  ON public.trial_state FOR SELECT TO authenticated
  USING (business_id = ANY (public.get_user_business_ids()));

-- Trigger: auto-create a trial_state row when a business is inserted.
-- Bundled here because this trigger belongs to the trial_state lifecycle.
CREATE OR REPLACE FUNCTION public.create_trial_state_for_new_business()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.trial_state (business_id) VALUES (NEW.id)
  ON CONFLICT (business_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_businesses_create_trial_state
AFTER INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.create_trial_state_for_new_business();
