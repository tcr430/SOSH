-- Mode 3 Part 2 — triage state on signal_candidates + the cost-ceiling RPCs
-- (ADR 0021 §2.9, §2.11, §3.3, §0.2 A-4′).
--
-- Three changes to Session 27's existing signal_candidates table (widen
-- status, add a claim column, add a claim index) plus two new RPCs. No new
-- tables here — insight_cards / signal_triage_budget shipped in E5.1
-- (20260807100000_mode3_insight_cards.sql).

-- ─── signal_candidates.status widened (§2.11) ───────────────────────────────
--
-- Pre-sanctioned by ADR 0020 §13.2 ("the CHECK widens in ADR 0021's
-- migration") — NOT a Session 27 amendment. Five values, authoritative list:
-- 'new' (ADR 0020's poller, the only value Session 27 ships), 'triaging'
-- (Stage C's atomic claim, §2.9), 'carded' (Stage D, terminal), 'no_card'
-- (Stage C verdict or the Tier-0 age gate, terminal), 'triage_failed' (any
-- bound breach, reclaimable — not terminal).
--
-- NOT VALID / VALIDATE two-step (the campaigns.status precedent,
-- 20260722190000_mode2_brief_and_roles.sql:170-179) rather than a naive
-- single-statement rewrite: signal_candidates is a live, hourly-written table
-- by the time this ships, so holding an ACCESS EXCLUSIVE lock for a full
-- validation scan matters more here than it did for campaigns.

ALTER TABLE public.signal_candidates
  DROP CONSTRAINT IF EXISTS signal_candidates_status_check;

ALTER TABLE public.signal_candidates
  ADD CONSTRAINT signal_candidates_status_check
    CHECK (status IN ('new', 'triaging', 'carded', 'no_card', 'triage_failed'))
    NOT VALID;

ALTER TABLE public.signal_candidates
  VALIDATE CONSTRAINT signal_candidates_status_check;

-- ─── triage_claimed_at (§2.9) ────────────────────────────────────────────────

ALTER TABLE public.signal_candidates
  ADD COLUMN triage_claimed_at timestamptz;

-- Claim index (§2.9), the watermark pattern already in the family
-- (github_connections_poll_claim_idx, 20260731090000_signal_ingestion.sql:208-210)
-- adapted to a partial form: the stale-claim reclaim sweep's predicate is
-- `status = 'triaging' AND triage_claimed_at < cutoff`, and only rows
-- currently 'triaging' are ever candidates for that sweep, so a partial
-- index keeps it small regardless of total table size.
CREATE INDEX signal_candidates_triage_claim_idx
  ON public.signal_candidates (triage_claimed_at)
  WHERE status = 'triaging';

-- ─── upsert_signal_candidate amended — A-4′ (ADJUDICATED, §0.2) ────────────
--
-- ⚠️ This is an adjudicated change to a Session 27 RPC
-- (20260806090000_signal_candidates_guarded_upsert.sql), not a quiet edit.
-- §0.2 A-4′: the original A-4 proposal (widen the guard to
-- `WHERE status IN ('new','triaging')` with no other change) was REJECTED in
-- that form — it would let a re-score silently resurrect a candidate stuck
-- mid-triage without releasing its claim, leaving a stale 'triaging' row that
-- also has fresh content. A-4′ replaces it: the guard still matches
-- ('new','triaging') non-terminal states, but a match on a 'triaging' row now
-- ALSO resets status to 'new' and clears triage_claimed_at — the re-score
-- returns the row to the front of the queue rather than leaving it claimed
-- with stale content. Every terminal status ('carded','no_card',
-- 'triage_failed') is still refused exactly as before this change. Rule,
-- stated once: terminal states refuse; non-terminal states restart.
--
-- Stage D's card insert (E5.6+) is conditional on the exact claim
-- (triage_claimed_at) it read before starting the loop still being held —
-- this reset is what makes that conditional insert write zero rows when a
-- re-score lands mid-flight (SIGNAL3-RESCORE-INVALIDATES-TRIAGE).

CREATE OR REPLACE FUNCTION public.upsert_signal_candidate(
  p_business_id  uuid,
  p_signal_id    uuid,
  p_score        numeric,
  p_score_inputs jsonb,
  p_occurred_at  timestamptz
)
RETURNS SETOF public.signal_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.signal_candidates (business_id, signal_id, score, score_inputs, occurred_at)
  VALUES (p_business_id, p_signal_id, p_score, p_score_inputs, p_occurred_at)
  ON CONFLICT (signal_id) DO UPDATE
     SET score              = EXCLUDED.score,
         score_inputs       = EXCLUDED.score_inputs,
         occurred_at        = EXCLUDED.occurred_at,
         status             = 'new',
         triage_claimed_at  = NULL
   WHERE public.signal_candidates.status IN ('new', 'triaging')
  RETURNING *;
END;
$$;

-- REVOKE/GRANT unchanged from Session 27 (CREATE OR REPLACE preserves the
-- function's existing privileges), restated here for an explicit audit trail
-- rather than left implicit.
REVOKE ALL ON FUNCTION public.upsert_signal_candidate(uuid, uuid, numeric, jsonb, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_signal_candidate(uuid, uuid, numeric, jsonb, timestamptz) TO service_role;

-- ─── reserve_triage_budget (§3.3, [db-BLOCKER-1] closed) ────────────────────
--
-- The guarded-upsert shape at 20260806090000_signal_candidates_guarded_upsert.sql:19-42,
-- reused for a different arbiter. [db-BLOCKER-1]: a bare conditional
-- `UPDATE ... WHERE reserved_cents + N <= cap` matches ZERO rows on a
-- business's first call of the day (no row exists yet), and the caller's own
-- protocol reads zero rows as "capped" — that would deny every business's
-- first call of every day. ONE statement closes it: INSERT ... ON CONFLICT
-- (business_id, day) DO UPDATE ... WHERE ... — the first call of the day
-- takes the INSERT branch unconditionally (there is nothing to guard against
-- yet); every subsequent call that day takes the DO UPDATE branch, guarded.
-- Postgres's row lock on the conflicting tuple (the same guarantee
-- upsert_signal_candidate's WHERE clause relies on) makes this atomic across
-- concurrent first-calls of the day too — a two-statement "insert if
-- missing, then update" from the app would reopen the exact race this table
-- exists to close.
--
-- database-reviewer (E5.1+E5.2 pass, MINOR-3): the INSERT branch is not
-- itself capped — safe today only because every call site reserves a fixed
-- worst-case constant (22¢, §2.6) that is structurally always well under
-- TRIAGE_DAILY_CAP_CENTS (125¢). The invariant `p_cents < p_cap` is
-- load-bearing and must hold by construction at every call site; nothing in
-- this SQL enforces it.
--
-- `day` is computed INSIDE the RPC as (now() AT TIME ZONE 'utc')::date —
-- pinned server-side, never passed by the caller, so "why did my quota reset
-- at a strange hour" has one answer on file rather than depending on app-side
-- clock/timezone handling.

CREATE OR REPLACE FUNCTION public.reserve_triage_budget(
  p_business_id uuid,
  p_cents       integer,
  p_cap         integer
)
RETURNS SETOF public.signal_triage_budget
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.signal_triage_budget (business_id, day, reserved_cents)
  VALUES (p_business_id, (now() AT TIME ZONE 'utc')::date, p_cents)
  ON CONFLICT (business_id, day) DO UPDATE
     SET reserved_cents = public.signal_triage_budget.reserved_cents + p_cents
   WHERE public.signal_triage_budget.reserved_cents + p_cents <= p_cap
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_triage_budget(uuid, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_triage_budget(uuid, integer, integer) TO service_role;

-- ─── reconcile_triage_budget (§3.3) ──────────────────────────────────────────
--
-- Settles the worst-case reservation against actual spend after the call
-- completes (actual cost is known only once runner.ts's `finally` block has
-- recorded it to ai_usage — the audit truth, unchanged by this table, §3.2).
-- A plain atomic UPDATE, not a guarded upsert: the row already exists (this
-- business already reserved today, or this function would never be called),
-- so there is no first-call race to close here — only the same-row identity
-- lookup. GREATEST(...,0) is a defensive floor matching the
-- reserved_cents >= 0 CHECK, guarding against a reconcile landing after a
-- concurrent reconcile already brought the balance to zero.

CREATE OR REPLACE FUNCTION public.reconcile_triage_budget(
  p_business_id    uuid,
  p_reserved_cents integer,
  p_actual_cents   integer
)
RETURNS SETOF public.signal_triage_budget
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.signal_triage_budget
     SET reserved_cents = GREATEST(reserved_cents + (p_actual_cents - p_reserved_cents), 0)
   WHERE business_id = p_business_id
     AND day = (now() AT TIME ZONE 'utc')::date
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_triage_budget(uuid, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_triage_budget(uuid, integer, integer) TO service_role;
