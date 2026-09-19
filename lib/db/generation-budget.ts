import type { AiBudgetDailyRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0024 §7.5a/§7.9 (Session 31, H2.9) — the generation_posts purpose of
// ai_budget_daily (renamed from signal_triage_budget at H2.8, purpose
// discriminator added §7.5b). This is a DIFFERENT caller of the same RPCs
// lib/db/signal-triage-budget.ts calls — that module stays triage-only,
// hardcoding purpose='triage_cents'; this one hardcodes 'generation_posts'.
// The purpose discriminator (UNIQUE (business_id, purpose, day)) is what
// keeps the two ceilings from sharing a counter (QUAL-BUDGET-PURPOSE-
// ISOLATED) — a triage-heavy morning can never starve post generation, and
// vice versa. Every function is SERVICE-ROLE and acquires its own client
// via the lazy-import pattern (CLAUDE.md) — the table has no authenticated
// policy at all (deny-by-default), so there is no authenticated-client
// variant to offer.
const PURPOSE = 'generation_posts' as const

// ADR §7.5 — ONE reservation, ONE unit, BEFORE the fan-out (never per
// candidate: per-candidate reservation reopens the check-then-call race
// N-fold inside a single generation, L-6's named loser). A `null` return
// means the reservation was refused — today's Pro cap is already spent —
// the caller's "capped" signal, not an error.
export async function reserveGenerationPost(
  businessId: string,
  capPosts: number,
): Promise<AiBudgetDailyRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reserve_ai_budget', {
    p_business_id: businessId,
    p_purpose: PURPOSE,
    p_units: 1,
    p_cap: capPosts,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as AiBudgetDailyRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §7.5a — a HARD-FAILED generation (0 of N candidates) releases its
// unit; a generation that succeeds keeps it, whether it produced 3
// candidates or 1 (so no caller path exists for a "release on success").
// Settles the 1-unit reservation down to 0 actual spend for this attempt.
export async function releaseGenerationPost(businessId: string): Promise<AiBudgetDailyRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reconcile_ai_budget', {
    p_business_id: businessId,
    p_purpose: PURPOSE,
    p_reserved_units: 1,
    p_actual_units: 0,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as AiBudgetDailyRow[] | null) ?? []
  return rows[0] ?? null
}
