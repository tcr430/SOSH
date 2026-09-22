import type { AiBudgetDailyRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0027 §7.4 (Session 34 K2.6) — the ONLY module that touches the planner_cents purpose of
// ai_budget_daily. Every caller (the K2.7 orchestrator, the plan_analysis_status='capped' surface)
// goes through here, never through a direct `.from('ai_budget_daily')` elsewhere. MIRRORS
// lib/db/signal-triage-budget.ts line for line (QUAL-NO-SECOND-BUDGET-TABLE — a fourth purpose on
// the shared table, not a second table): every function is SERVICE-ROLE via the lazy-import
// pattern, the table has no authenticated policy at all, and a `null` return means the reservation
// was REFUSED, never an error — the caller treats it as capped and never retries it as a failure.
const PURPOSE = 'planner_cents' as const

export async function reservePlannerBudget(
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

// Settles the worst-case reservation down to actual spend, on EVERY orchestrator outcome including
// failure (ADR 0027 §3.3).
export async function reconcilePlannerBudget(
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

// The plan_analysis_status='capped' surface needs a boolean, never raw reserved_units (there is no
// authenticated SELECT policy on this table by design). Reuses reserve_ai_budget with a ZERO-unit
// reservation so the day is computed SERVER-SIDE, the same trick isTriageBudgetCapped uses.
export async function isPlannerBudgetCapped(businessId: string, capCents: number): Promise<boolean> {
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
