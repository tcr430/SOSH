-- Migration 8: social_accounts_trial_trigger
--
-- Starts the 14-day trial clock when the user connects their first social
-- account. This is enforced at the database level (not just app code) because
-- the trial clock is billing-relevant and must not be skippable.
--
-- Depends on: social_accounts (migration 6), trial_state (migration 7).

CREATE OR REPLACE FUNCTION public.start_trial_on_first_social_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count int;
BEGIN
  -- Count social_accounts for this business excluding the row just inserted.
  SELECT count(*) INTO v_existing_count
  FROM public.social_accounts
  WHERE business_id = NEW.business_id
    AND id <> NEW.id;

  -- Only start the clock if this is the first social account.
  IF v_existing_count = 0 THEN
    UPDATE public.trial_state
    SET trial_started_at = now()
    WHERE business_id = NEW.business_id
      AND trial_started_at IS NULL;  -- idempotent: never restart the clock
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_social_accounts_start_trial
AFTER INSERT ON public.social_accounts
FOR EACH ROW EXECUTE FUNCTION public.start_trial_on_first_social_account();
