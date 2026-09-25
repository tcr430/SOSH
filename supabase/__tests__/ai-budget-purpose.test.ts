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

  it.each(['triage_cents', 'generation_posts', 'backfill_cents', 'planner_cents'])('purpose=%s is accepted', async (purpose) => {
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

  // ADR 0027 §7.4 (K2.6) — 41 AGENCY-COST-CEILING-EXTENDED, 42 AGENCY-BUDGET-PURPOSE-ISOLATED.
  // Each of these three tests uses its OWN fresh business — the it.each block above already
  // reserves 1 planner_cents unit against the shared businessId, so reusing it here would make the
  // cap arithmetic below silently wrong depending on suite run order.

  async function freshBusiness(label: string): Promise<string> {
    const { data, error } = await admin
      .from('businesses')
      .insert({ name: `AI Budget ${label} Business`, owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  it('TWO CONCURRENT RESERVATIONS against one cap — exactly one wins once the cap is exhausted', async () => {
    const biz = await freshBusiness('Concurrent')

    const first = await admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'planner_cents', p_units: 24, p_cap: 30 })
    expect(first.error).toBeNull()
    expect(first.data ?? []).toHaveLength(1)

    const [a, b] = await Promise.all([
      admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'planner_cents', p_units: 6, p_cap: 30 }),
      admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'planner_cents', p_units: 6, p_cap: 30 }),
    ])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    const won = [a, b].filter((r) => (r.data ?? []).length === 1).length
    const denied = [a, b].filter((r) => (r.data ?? []).length === 0).length
    expect(won).toBe(1)
    expect(denied).toBe(1)

    const { data: row } = await admin.from('ai_budget_daily').select('reserved_units').eq('business_id', biz).eq('purpose', 'planner_cents').single()
    expect(Number(row.reserved_units)).toBe(30)

    await admin.from('businesses').delete().eq('id', biz)
  })

  // THE FIRST-CALL-OF-DAY CASE that caught ADR 0021's [db-BLOCKER-1] — discovered regressed while
  // writing this test: reserve_ai_budget's cap guard previously applied ONLY to the
  // ON CONFLICT DO UPDATE branch, never to the initial INSERT (no existing row to conflict
  // against), so a business's very FIRST reservation of the day, of ANY purpose, could blow
  // straight through the cap. Fixed in this same migration (K2.6) via a guarded-SELECT INSERT
  // source, verified live before the migration was written (see the K2.6 commit body).
  it('THE FIRST-CALL-OF-DAY CASE: a single reservation that alone exceeds the cap is refused, not silently accepted', async () => {
    const biz = await freshBusiness('FirstCall')

    const overCap = await admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'planner_cents', p_units: 500, p_cap: 300 })
    expect(overCap.error).toBeNull()
    expect(overCap.data ?? []).toHaveLength(0)

    const { data: rows } = await admin.from('ai_budget_daily').select('id').eq('business_id', biz).eq('purpose', 'planner_cents')
    expect(rows ?? []).toHaveLength(0)

    const underCap = await admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'planner_cents', p_units: 200, p_cap: 300 })
    expect(underCap.error).toBeNull()
    expect(underCap.data ?? []).toHaveLength(1)

    await admin.from('businesses').delete().eq('id', biz)
  })

  it('cross-purpose isolation: a planner_cents reservation AT CAP does not deny a generation_posts reservation the same day', async () => {
    const biz = await freshBusiness('CrossPurpose')

    const capped = await admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'planner_cents', p_units: 300, p_cap: 300 })
    expect(capped.error).toBeNull()
    expect(capped.data ?? []).toHaveLength(1)

    const stillCapped = await admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'planner_cents', p_units: 1, p_cap: 300 })
    expect(stillCapped.data ?? []).toHaveLength(0)

    const otherPurpose = await admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'generation_posts', p_units: 1, p_cap: 15 })
    expect(otherPurpose.error).toBeNull()
    expect(otherPurpose.data ?? []).toHaveLength(1)

    await admin.from('businesses').delete().eq('id', biz)
  })
})
