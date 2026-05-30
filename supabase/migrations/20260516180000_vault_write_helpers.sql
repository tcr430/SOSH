-- Migration: vault_write_helpers
--
-- Public wrappers for writing to and deleting from Supabase Vault,
-- callable via service-role .rpc(). The vault schema is not exposed via
-- PostgREST by default, so these SECURITY DEFINER functions act as bridges.
-- Restricted to service_role — anon and authenticated cannot call them.

CREATE OR REPLACE FUNCTION public.vault_create_secret(
  secret text,
  name text,
  description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT vault.create_secret(secret, name, description);
$$;

REVOKE ALL ON FUNCTION public.vault_create_secret(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_create_secret(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_create_secret(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.vault_delete_secret(secret_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public
AS $$
  DELETE FROM vault.secrets WHERE id = secret_id;
$$;

REVOKE ALL ON FUNCTION public.vault_delete_secret(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_delete_secret(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_delete_secret(uuid) TO service_role;
