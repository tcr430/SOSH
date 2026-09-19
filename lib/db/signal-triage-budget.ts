import type { AiBudgetDailyRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0021 §10.1 (Session 28 E5.3) — the ONLY module that touches the
// triage_cents purpose of ai_budget_daily (ADR 0024 §7.5b, Session 31 H2.8
// — renamed from signal_triage_budget, purpose discriminator added). Every
// caller (the triage loop, the feed's paused state) goes through here,
// never through a direct `.from('ai_budget_daily')` elsewhere. Every
// function is SERVICE-ROLE and acquires its own client via the lazy-import
// pattern (CLAUDE.md) — the table has no authenticated policy at all
// (§8.1, deny-by-default), so there is no authenticated-client variant to
// offer.
//
// This module hardcodes purpose='triage_cents' — it is still triage-only.
// H2.9's generation-posts reservation is a DIFFERENT caller of the same
// renamed RPCs, not a change to the functions below.
const PURPOSE = 'triage_cents' as const

// §3.3 — the guarded-upsert RPC ([db-BLOCKER-1] closed). A `null` return
// means the reservation was refused (this call would push the day's total
// over p_cap) — the no-op signal, not an error; the caller treats it as
// "capped," never retries it as a failure.
export async function reserveTriageBudget(
  businessId: string,
  cents: number,
  capCents: number,
): Promise<AiBudgetDailyRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reserve_ai_budget', {
    p_business_id: businessId,
    p_purpose: PURPOSE,
    p_units: cents,
    p_cap: capCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as AiBudgetDailyRow[] | null) ?? []
  return rows[0] ?? null
}

// §3.3 — settles the worst-case reservation down to actual spend, once
// runner.ts's `finally` block has recorded the real cost to ai_usage.
export async function reconcileTriageBudget(
  businessId: string,
  reservedCents: number,
  actualCents: number,
): Promise<AiBudgetDailyRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reconcile_ai_budget', {
    p_business_id: businessId,
    p_purpose: PURPOSE,
    p_reserved_units: reservedCents,
    p_actual_units: actualCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as AiBudgetDailyRow[] | null) ?? []
  return rows[0] ?? null
}

// §3.4 — the feed's "paused — daily limit reached" state needs a boolean,
// never raw reserved_units (there is no authenticated SELECT policy on this
// table by design, §8.1, and this helper does not become one). Reuses
// reserve_ai_budget with a ZERO-unit reservation rather than computing
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
  const { data, error } = await client.rpc('reserve_ai_budget', {
    p_business_id: businessId,
    p_purpose: PURPOSE,
    p_units: 0,
    p_cap: capCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as AiBudgetDailyRow[] | null) ?? []
  return rows.length === 0
}
