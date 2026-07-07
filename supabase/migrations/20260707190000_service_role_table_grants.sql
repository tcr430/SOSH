-- Explicit table privileges for anon/authenticated/service_role (fixes CI:
-- 42501 permission denied for table businesses, posts, business_members, ...).
--
-- Table-level GRANTs and RLS are two independent layers: RLS filters *rows*
-- a role is allowed to see once it already has the underlying privilege; the
-- GRANT is what allows the role to touch the table at all. service_role
-- additionally bypasses RLS via BYPASSRLS, but anon/authenticated do not --
-- for them, GRANT + RLS both have to allow an operation, which is exactly
-- the intended defense-in-depth (RLS policies below are still what actually
-- restricts rows per tenant; this migration does not weaken that).
--
-- Every migration in this project up to now created tables without ever
-- issuing an explicit GRANT to any of these three roles, relying entirely on
-- the Supabase platform's ambient default privileges for the public schema.
-- That assumption silently broke in this CI environment for multiple tables
-- (businesses for service_role; posts and business_members for authenticated,
-- surfaced by the RLS-enforced test suite) and the DB-tests workflow's "wait
-- for PostgREST schema cache" retry loop spun for 30s against what is
-- actually a permanent 42501, not a transient cache-warmup race.
--
-- Grant explicitly instead of depending on implicit platform defaults: once
-- for every table that already exists, and via ALTER DEFAULT PRIVILEGES for
-- every table created by future migrations. Idempotent -- re-running GRANT /
-- ALTER DEFAULT PRIVILEGES is a no-op if the privilege already holds.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
