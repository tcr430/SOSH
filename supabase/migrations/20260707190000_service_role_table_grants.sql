-- Explicit service_role table privileges (fixes CI: 42501 permission denied
-- for table businesses).
--
-- service_role bypasses RLS via the BYPASSRLS role attribute, but RLS bypass
-- and ordinary Postgres table-level GRANTs are orthogonal -- a role can
-- bypass every RLS policy on a table and still be refused by the grant
-- system before RLS is even evaluated. Every migration in this project up to
-- now created tables without ever issuing an explicit GRANT to service_role,
-- relying entirely on the Supabase platform's ambient default privileges for
-- the public schema. That assumption silently broke for public.businesses
-- (and potentially other tables) in CI, and the DB-tests workflow's "wait
-- for PostgREST schema cache" retry loop spun for 30s against what is
-- actually a permanent 42501, not a transient cache-warmup race.
--
-- Grant explicitly instead of depending on implicit platform defaults: once
-- for every table that already exists, and via ALTER DEFAULT PRIVILEGES for
-- every table created by future migrations. Idempotent -- re-running GRANT /
-- ALTER DEFAULT PRIVILEGES is a no-op if the privilege already holds.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
