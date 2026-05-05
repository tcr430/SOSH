-- Migration 1: Extensions
-- Enables Postgres extensions required by the SOSH schema.
--
-- pgcrypto: gen_random_uuid() (for uuid PKs)
-- supabase_vault: vault.secrets, vault.create_secret(), vault.update_secret(),
--                 vault.delete_secret(), vault.decrypted_secrets view.
--                 Used by social_accounts to store OAuth tokens out-of-band.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
