-- Session 32-D, D7 (discovered while writing the D7 Tier-1 purge test, out
-- of scope for MAJOR-4/MAJOR-10 but a real production-breaking gap left
-- unfixed since Session 6D): lib/db/social-accounts.ts's
-- deactivateSocialAccount unconditionally sets vault_access_token_id AND
-- vault_refresh_token_id to NULL on disconnect (CLAUDE.md's GDPR
-- disconnect spec — "On disconnect: set is_active = false, null the vault
-- ID columns, delete the vault secrets"). Session 6D (docs/current-phase.md)
-- widened the TypeScript SocialAccountUpdate type to allow null on both
-- columns, but no migration ever relaxed the live schema to match:
-- vault_access_token_id has been `NOT NULL` since its original migration
-- (20260430120006_social_accounts.sql) and still is. Every real account
-- disconnect has been crashing on this UPDATE since Session 6D —
-- apparently never exercised against live Postgres until Session 32-D's
-- new backfill-staging-purge.test.ts tripped it.
--
-- vault_refresh_token_id is already nullable (an account connected before
-- refresh-token support, or a platform with no refresh flow, never had one)
-- — only vault_access_token_id needs the constraint dropped here.
--
-- No authenticated/anon UPDATE grant exists on this column
-- (20260913120000_social_accounts_identity_lock.sql's column allowlist
-- excludes it) — only the service-role deactivateSocialAccount path writes
-- it, so this is a pure constraint relaxation with no RLS/grant surface
-- change.

ALTER TABLE public.social_accounts
  ALTER COLUMN vault_access_token_id DROP NOT NULL;
