import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-BUDGET-PURPOSE (ADR 0025 §12 constraint 23, Tier 1). The
// ai_budget_daily purpose CHECK, re-added by name
// (20260913130000_social_backfill_runs_and_posts.sql) after a
// lookup-by-definition (never a guessed DROP CONSTRAINT IF EXISTS).
// Existing writers of this table by purpose: lib/db/signal-triage-budget.ts
// (purpose='triage_cents') and lib/db/generation-budget.ts
// (purpose='generation_posts') — both still accepted; 'backfill_cents' is
// the new value this step adds; anything else is rejected.
describe('ai_budget_daily.purpose CHECK (ADR 0025 §6.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `ai-budget-purpose-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'AI Budget Purpose Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it.each(['triage_cents', 'generation_posts', 'backfill_cents'])('purpose=%s is accepted', async (purpose) => {
    const { error } = await admin.rpc('reserve_ai_budget', {
      p_business_id: businessId,
      p_purpose: purpose,
      p_units: 1,
      p_cap: 1000,
    })
    expect(error).toBeNull()
  })

  it("purpose='bogus' is rejected by the named CHECK constraint (ai_budget_daily_purpose_check)", async () => {
    const { error } = await admin.rpc('reserve_ai_budget', {
      p_business_id: businessId,
      p_purpose: 'bogus',
      p_units: 1,
      p_cap: 1000,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('ai_budget_daily_purpose_check')
  })
})
