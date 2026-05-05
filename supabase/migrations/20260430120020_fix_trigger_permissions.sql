-- Migration 020: Revoke public execute permission on trigger functions
--
-- Trigger functions should only be invoked by the trigger mechanism, never
-- called directly by application code or end users. Revoking the default
-- public grant closes that avenue.

REVOKE ALL ON FUNCTION public.create_trial_state_for_new_business() FROM public;
REVOKE ALL ON FUNCTION public.start_trial_on_first_social_account() FROM public;
