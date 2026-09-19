import type { AiBudgetDailyRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0025 §6.3 (Session 32 I2.11) — the 'backfill_cents' purpose of
// ai_budget_daily (the CHECK constraint already includes it,
// 20260913130000_social_backfill_runs_and_posts.sql). A DIFFERENT caller of
// the same reserve_ai_budget/reconcile_ai_budget RPCs
// lib/db/generation-budget.ts and lib/db/signal-triage-budget.ts call — this
// one hardcodes 'backfill_cents', so a backfill-heavy first day can never
// starve post generation or triage, and vice versa (the purpose
// discriminator's whole point, QUAL-BUDGET-PURPOSE-ISOLATED precedent).
const PURPOSE = 'backfill_cents' as const

// Units here are CENTS, not posts (BACKFILL_DAILY_CENTS = 150) — unlike
// generation-budget.ts's 1-unit-per-post reservation, a backfill pass's
// cost varies per call, so the estimate itself is the unit count.
export async function reserveBackfillDailySpend(
  businessId: string,
  estimateCents: number,
  capCents: number,
): Promise<AiBudgetDailyRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reserve_ai_budget', {
    p_business_id: businessId,
    p_purpose: PURPOSE,
    p_units: estimateCents,
    p_cap: capCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as AiBudgetDailyRow[] | null) ?? []
  return rows[0] ?? null
}

export async function reconcileBackfillDailySpend(
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
