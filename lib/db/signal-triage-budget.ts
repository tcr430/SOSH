import type { SignalTriageBudgetRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0021 §10.1 (Session 28 E5.3) — the ONLY module that touches
// signal_triage_budget. Every caller (the triage loop, the feed's paused
// state) goes through here, never through a direct
// `.from('signal_triage_budget')` elsewhere. Every function is
// SERVICE-ROLE and acquires its own client via the lazy-import pattern
// (CLAUDE.md) — the table has no authenticated policy at all (§8.1,
// deny-by-default), so there is no authenticated-client variant to offer.

// §3.3 — the guarded-upsert RPC ([db-BLOCKER-1] closed). A `null` return
// means the reservation was refused (this call would push the day's total
// over p_cap) — the no-op signal, not an error; the caller treats it as
// "capped," never retries it as a failure.
export async function reserveTriageBudget(
  businessId: string,
  cents: number,
  capCents: number,
): Promise<SignalTriageBudgetRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reserve_triage_budget', {
    p_business_id: businessId,
    p_cents: cents,
    p_cap: capCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SignalTriageBudgetRow[] | null) ?? []
  return rows[0] ?? null
}

// §3.3 — settles the worst-case reservation down to actual spend, once
// runner.ts's `finally` block has recorded the real cost to ai_usage.
export async function reconcileTriageBudget(
  businessId: string,
  reservedCents: number,
  actualCents: number,
): Promise<SignalTriageBudgetRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reconcile_triage_budget', {
    p_business_id: businessId,
    p_reserved_cents: reservedCents,
    p_actual_cents: actualCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SignalTriageBudgetRow[] | null) ?? []
  return rows[0] ?? null
}

// §3.4 — the feed's "paused — daily limit reached" state needs a boolean,
// never raw reserved_cents (there is no authenticated SELECT policy on this
// table by design, §8.1, and this helper does not become one). Reuses
// reserve_triage_budget with a ZERO-cent reservation rather than computing
// "today" client-side and querying directly: the RPC's day is computed
// server-side ((now() AT TIME ZONE 'utc')::date, §3.3), and a second,
// independently computed client-side date is exactly the drift risk server-
// side computation exists to avoid. A $0 reservation is a true no-op on the
// ledger — it adds nothing on the DO UPDATE branch, and if it happens to be
// the day's first call, a genuine reservation moments later performs the
// identical INSERT ... ON CONFLICT DO UPDATE regardless.
export async function isTriageBudgetCapped(businessId: string, capCents: number): Promise<boolean> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reserve_triage_budget', {
    p_business_id: businessId,
    p_cents: 0,
    p_cap: capCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SignalTriageBudgetRow[] | null) ?? []
  return rows.length === 0
}
