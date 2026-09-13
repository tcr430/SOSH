-- ADR 0025 §7.3/§7.4 (Session 32 I2.4) — the legal precondition for
-- importing anything (§8.1): platform_user_id must be un-rewritable by an
-- authenticated member, or the backfill could be pointed at a third
-- party's timeline. Two defences, both required — this migration is the
-- first (the second, token identity verification on every run's first
-- page, is code: twitter-provider.ts's verifyReadIdentity, I2.3).
--
-- WHY A COLUMN-LEVEL REVOKE ALONE DOES NOT WORK: `authenticated` holds a
-- TABLE-LEVEL UPDATE grant on every public table
-- (20260707190000_service_role_table_grants.sql:28 —
-- "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO
-- anon, authenticated, service_role"), and Postgres does not subtract a
-- column-level REVOKE from a table-level GRANT — the table-level grant
-- still wins. The only way to narrow `authenticated`'s UPDATE surface is
-- to REVOKE the table-level grant entirely, then re-GRANT UPDATE on an
-- explicit column allowlist. Confirmed live (I2.0): `authenticated`
-- currently holds table-level UPDATE on social_accounts via that same
-- migration.
--
-- ALLOWLIST, enumerated from the LIVE table definition dumped at I2.0
-- (13 columns before this migration's ADD COLUMN below):
--   id, business_id, platform, platform_user_id, platform_username,
--   platform_display_name, vault_access_token_id, vault_refresh_token_id,
--   token_expires_at, is_active, connected_at, created_at, updated_at
-- EXCEPT (ADR §7.3, verbatim): id, business_id, platform, platform_user_id,
-- vault_access_token_id, vault_refresh_token_id, is_active,
-- token_expires_at, scopes_granted (added below), connected_at.
-- ALLOWLIST = platform_username, platform_display_name, created_at,
-- updated_at. A column added later is NOT updatable by `authenticated`
-- until it is explicitly added here — fail-closed by construction, not by
-- convention.
--
-- The RLS policy `social_accounts_update_own` is UNCHANGED and stays the row
-- filter; this migration only narrows which COLUMNS an authenticated write
-- may touch, once RLS has already let the row through. CORRECTED
-- (Session 32 I2.4 security review): the policy in force today is
-- 20260702120400_campaigns_social_accounts_role_policies.sql:45-50, not
-- 20260430120017_fix_rls_function_caching.sql:69-72 — the later migration
-- DROPs and recreates it with an ADDED `user_can(business_id,
-- 'connect_accounts')` capability check on top of the same business_id
-- scoping (strictly narrower, not looser, than the policy the original
-- comment named).


--
-- Default privileges (20260707190000:32, ALTER DEFAULT PRIVILEGES) are
-- UNAFFECTED — they govern tables created by FUTURE migrations, not this
-- one. The trial trigger (20260430120008_social_accounts_trial_trigger.sql)
-- is untouched.

-- ─── §7.4 — scopes_granted ───────────────────────────────────────────────────

ALTER TABLE public.social_accounts
  ADD COLUMN scopes_granted text[] NULL;

-- ─── §7.3 — replace the table-level UPDATE grant with a column allowlist ────

REVOKE UPDATE ON public.social_accounts FROM authenticated, anon;

GRANT UPDATE (
  platform_username,
  platform_display_name,
  created_at,
  updated_at
) ON public.social_accounts TO authenticated;
