-- Session 31-D, D17 (NIT-3) — cosmetic-only: renames the three constraints
-- on public.ai_budget_daily that still carry their pre-rename names.
-- Postgres carries constraint names through an ALTER TABLE ... RENAME TO
-- (20260909110000_ai_budget_daily_rename.sql), so
-- signal_triage_budget_pkey, signal_triage_budget_business_id_fkey and
-- signal_triage_budget_reserved_cents_check survived unchanged even though
-- the table and its reserved_cents -> reserved_units column were both
-- renamed. Definitions are correct (the CHECK reads
-- "reserved_units >= 0" already) — only the NAMES are stale. The Tier-1
-- "no signal_triage_budget object survives the rename" case
-- (signals3-triage-state.test.ts:263) probes the table and the two RPCs
-- only, so this drift was invisible to it. No behavior change: renaming a
-- constraint does not alter what it enforces.

ALTER TABLE public.ai_budget_daily
  RENAME CONSTRAINT signal_triage_budget_pkey TO ai_budget_daily_pkey;

ALTER TABLE public.ai_budget_daily
  RENAME CONSTRAINT signal_triage_budget_business_id_fkey TO ai_budget_daily_business_id_fkey;

ALTER TABLE public.ai_budget_daily
  RENAME CONSTRAINT signal_triage_budget_reserved_cents_check TO ai_budget_daily_reserved_units_check;
