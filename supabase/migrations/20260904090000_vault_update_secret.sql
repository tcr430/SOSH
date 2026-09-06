-- Migration: vault_update_secret
--
-- Public wrapper for updating a Supabase Vault secret IN PLACE, callable via
-- service-role .rpc(). The vault schema is not exposed via PostgREST by
-- default, so this SECURITY DEFINER function acts as a bridge — matching
-- vault_create_secret and vault_delete_secret in
-- 20260516180000_vault_write_helpers.sql exactly: same schema, same
-- security posture, same argument style. Restricted to service_role — anon
-- and authenticated cannot call it.
--
-- ADR 0002 §8 requires token refresh to update Vault secrets IN PLACE
-- (never delete-then-create), so that social_accounts.vault_access_token_id
-- stays stable across a refresh. ADR 0028 §4.1 (D-alpha): this function was
-- never written — postiz-provider.ts called the undefined, dotted name
-- 'vault.update_secret' via .rpc() and never checked the result. Token
-- refresh has therefore never worked: it fails silently, then bumps
-- token_expires_at and returns a success TokenSet, so the system believes
-- it refreshed. This is a hard prerequisite for native X, whose access
-- token lives two hours and whose refresh token rotates.
--
-- No backfill: this is a new function, not a data migration. No existing
-- row's shape changes.

CREATE OR REPLACE FUNCTION public.vault_update_secret(
  secret_id uuid,
  new_secret text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT vault.update_secret(secret_id, new_secret);
$$;

REVOKE ALL ON FUNCTION public.vault_update_secret(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vault_update_secret(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_update_secret(uuid, text) TO service_role;
