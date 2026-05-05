-- Migration 24: vault_helpers
--
-- Public wrapper function for reading Supabase Vault secrets by UUID.
-- The vault schema is not exposed via PostgREST by default, so this
-- SECURITY DEFINER function acts as a bridge callable via .rpc().
-- Restricted to service_role only — anon and authenticated cannot call it.

CREATE OR REPLACE FUNCTION public.get_vault_secret(secret_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE id = secret_id;
$$;

REVOKE ALL ON FUNCTION public.get_vault_secret(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_vault_secret(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vault_secret(uuid) TO service_role;
