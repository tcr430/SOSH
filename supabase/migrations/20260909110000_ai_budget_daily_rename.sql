-- ADR 0024 §7.5b (Session 31, H2.8) — signal_triage_budget becomes
-- ai_budget_daily, with a MANDATORY purpose discriminator.
--
-- READ ADR §7.5b IN FULL BEFORE TOUCHING THIS FILE — it corrects a
-- pre-review draft that would have shipped a silent cross-ceiling leak.
--
-- WHY THE DISCRIMINATOR IS MANDATORY, not cosmetic: signal_triage_budget
-- holds ONE reserved_cents per (business_id, day)
-- (20260807100000_mode3_insight_cards.sql:98-108, UNIQUE (business_id, day))
-- and the RPC takes p_cap FROM THE CALLER
-- (20260807110000_mode3_triage_state.sql:133-152). Two consumers with two
-- different caps against one counter means a triage-heavy morning SILENTLY
-- STARVES post generation for the rest of the day: each caller's cap check
-- sees the other's spend, and "budget exceeded" has two causes and no column
-- that distinguishes them.
--
-- EVERYTHING ELSE IS GENUINELY UNCHANGED: the same guarded upsert, the same
-- ON CONFLICT ... DO UPDATE ... WHERE reserved + p_units <= p_cap atomicity,
-- the same server-pinned (now() AT TIME ZONE 'utc')::date, the same
-- SECURITY DEFINER + SET search_path, and the same deny-by-default posture
-- (insight_cards.sql:147-180: RLS enabled, NO POLICY AT ALL, REVOKE ALL FROM
-- authenticated, GRANT EXECUTE TO service_role). The table is
-- service-role-only and STAYS THAT WAY.
--
-- ADR 0010 Amendment 2 §D2.5: the existing row MOVES WITH THE TABLE. This is
-- NOT a new row — same business_id, same ON DELETE CASCADE, same
-- deny-by-default RLS, and the added purpose column carries no personal data
-- and changes no erasure path. (The D2.5 edit — updating the cascade table's
-- entry to the new table name — lands in the same PR as this migration, in
-- docs/decisions/0010-...-amendment-2.md.)
--
-- Per CLAUDE.md's naming rule a rename is its own tracked piece of work. It
-- is executed inside Session 31 because the extension is not expressible
-- without it (founder ruling A-2).
--
-- WARNING: NOT APPLIED / NOT COMMITTED AT H2.4 TIME. Drafted together with
-- H2.4's 20260909100000_post_ai_original_scores.sql per the build guide's
-- explicit requirement (H2.4/H2.8: "invoke ecc:database-reviewer ONCE,
-- scoped to BOTH of them together, BEFORE EITHER IS COMMITTED"). This
-- migration is applied to the live database and committed to git only at
-- H2.8's own step, once its caller moves (lib/db/signal-triage-budget.ts,
-- lib/signals/triage/orchestrator.ts:262, lib/db/types.ts, both
-- supabase/__tests__/signals3-*.test.ts suites) are ready in the SAME PR —
-- applying the rename to the live project before those callers are updated
-- would break production triage RPC calls immediately.

-- ─── Table rename + column changes ──────────────────────────────────────────

ALTER TABLE public.signal_triage_budget RENAME TO ai_budget_daily;

ALTER TABLE public.ai_budget_daily RENAME COLUMN reserved_cents TO reserved_units;

-- purpose is added NOT NULL WITH a DEFAULT so the ALTER TABLE backfills every
-- existing row to 'triage_cents' (the only purpose that has ever written
-- this table) in the same statement, then the default is dropped — new rows
-- must state their purpose explicitly, never inherit a silent default.
ALTER TABLE public.ai_budget_daily
  ADD COLUMN purpose text NOT NULL DEFAULT 'triage_cents'
    CHECK (purpose IN ('triage_cents', 'generation_posts'));

ALTER TABLE public.ai_budget_daily ALTER COLUMN purpose DROP DEFAULT;

-- Old arbiter UNIQUE (business_id, day) -> new UNIQUE (business_id, purpose, day).
-- The old constraint's name follows Postgres's default
-- <table>_<cols>_key convention from CREATE TABLE time (signal_triage_budget
-- table def, insight_cards.sql:107) — DROP CONSTRAINT IF EXISTS covers both
-- the pre-rename and (harmlessly) any already-renamed name.
ALTER TABLE public.ai_budget_daily
  DROP CONSTRAINT IF EXISTS signal_triage_budget_business_id_day_key;
ALTER TABLE public.ai_budget_daily
  ADD CONSTRAINT ai_budget_daily_business_id_purpose_day_key
    UNIQUE (business_id, purpose, day);

-- ─── Trigger renamed WITH the table (mode3_insight_cards.sql:110-112) ───────

ALTER TRIGGER trg_signal_triage_budget_updated_at
  ON public.ai_budget_daily RENAME TO trg_ai_budget_daily_updated_at;

-- ─── RPCs: DROP + RECREATE under new names/signatures ───────────────────────
--
-- Both RPCs are RETURNS SETOF public.signal_triage_budget. A RETURN TYPE
-- CANNOT BE CHANGED BY CREATE OR REPLACE FUNCTION, so both are DROPped and
-- recreated under the new names/signatures, RE-ISSUING THE REVOKE/GRANT PAIR
-- FOR EACH — a recreated SECURITY DEFINER function with no REVOKE is a
-- privilege escalation.

DROP FUNCTION IF EXISTS public.reserve_triage_budget(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.reconcile_triage_budget(uuid, integer, integer);

-- reserve_ai_budget(p_business_id, p_purpose, p_units, p_cap) — the guarded
-- upsert shape unchanged from reserve_triage_budget
-- (20260807110000_mode3_triage_state.sql:133-152), now keyed on
-- (business_id, purpose, day) so a triage_cents reservation at its cap can
-- never deny a generation_posts reservation on the same (business_id, day),
-- and vice versa (QUAL-BUDGET-PURPOSE-ISOLATED).

CREATE OR REPLACE FUNCTION public.reserve_ai_budget(
  p_business_id uuid,
  p_purpose     text,
  p_units       integer,
  p_cap         integer
)
RETURNS SETOF public.ai_budget_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.ai_budget_daily (business_id, purpose, day, reserved_units)
  VALUES (p_business_id, p_purpose, (now() AT TIME ZONE 'utc')::date, p_units)
  ON CONFLICT (business_id, purpose, day) DO UPDATE
     SET reserved_units = public.ai_budget_daily.reserved_units + p_units
   WHERE public.ai_budget_daily.reserved_units + p_units <= p_cap
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, text, integer, integer) TO service_role;

-- reconcile_ai_budget(p_business_id, p_purpose, p_reserved_units, p_actual_units)
-- — unchanged shape from reconcile_triage_budget
-- (20260807110000_mode3_triage_state.sql:169-187), now scoped by purpose too.

CREATE OR REPLACE FUNCTION public.reconcile_ai_budget(
  p_business_id       uuid,
  p_purpose           text,
  p_reserved_units    integer,
  p_actual_units      integer
)
RETURNS SETOF public.ai_budget_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_budget_daily
     SET reserved_units = GREATEST(reserved_units + (p_actual_units - p_reserved_units), 0)
   WHERE business_id = p_business_id
     AND purpose = p_purpose
     AND day = (now() AT TIME ZONE 'utc')::date
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_ai_budget(uuid, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_ai_budget(uuid, text, integer, integer) TO service_role;

-- ─── RLS / grants: unchanged posture, restated under the new table name ────
-- (Postgres carries RLS enablement, policies, REVOKE/GRANT state through a
-- RENAME automatically — nothing here is a behavior change, only an
-- explicit audit-trail restatement.)
--
-- signal_triage_budget had: ALTER TABLE ... ENABLE ROW LEVEL SECURITY, NO
-- POLICY AT ALL, REVOKE ALL ON ... FROM authenticated, no matching GRANT
-- (mode3_insight_cards.sql:147, :180-181). All of this already carried
-- through the RENAME above; nothing to re-issue.
