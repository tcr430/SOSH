import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-COST-CEILINGED (ADR 0025 §12 constraint 22, Tier 1). The
// SIGNAL3-COST-CEILING-ATOMIC idiom: reserve_backfill_spend is one
// conditional UPDATE, never read-then-write — proven here under both
// sequential exhaustion and genuine concurrency.
describe('reserve_backfill_spend (ADR 0025 §6.1/§6.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-spend-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Spend Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-spend-user',
        platform_username: 'spend_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000050',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  async function newRun() {
    const { data, error } = await admin.rpc('enqueue_backfill_run', {
      p_business_id: businessId,
      p_social_account_id: socialAccountId,
      p_platform: 'twitter',
    })
    if (error) throw error
    const run = (data as Array<{ id: string; ceiling_cents: number }>)[0]
    expect(run.ceiling_cents).toBe(50)
    return run.id as string
  }

  it('reservations totalling exactly the 50-cent ceiling succeed; the next 1-cent reservation is refused', async () => {
    const runId = await newRun()

    const first = await admin.rpc('reserve_backfill_spend', { p_run_id: runId, p_estimate_cents: 25 })
    if (first.error) throw first.error
    expect((first.data as unknown[]).length).toBe(1)

    const second = await admin.rpc('reserve_backfill_spend', { p_run_id: runId, p_estimate_cents: 25 })
    if (second.error) throw second.error
    expect((second.data as unknown[]).length).toBe(1)

    const third = await admin.rpc('reserve_backfill_spend', { p_run_id: runId, p_estimate_cents: 1 })
    if (third.error) throw third.error
    expect((third.data as unknown[]).length).toBe(0)

    await admin.rpc('discard_backfill_run', { p_run_id: runId, p_user_id: null })
  })

  it('two concurrent 30-cent reservations against a 50-cent ceiling — exactly one succeeds', async () => {
    const runId = await newRun()

    const [resultA, resultB] = await Promise.all([
      admin.rpc('reserve_backfill_spend', { p_run_id: runId, p_estimate_cents: 30 }),
      admin.rpc('reserve_backfill_spend', { p_run_id: runId, p_estimate_cents: 30 }),
    ])
    if (resultA.error) throw resultA.error
    if (resultB.error) throw resultB.error

    const succeeded = [resultA, resultB].filter((r) => (r.data as unknown[]).length === 1)
    expect(succeeded).toHaveLength(1)

    const { data: runRow } = await admin.from('social_backfill_runs').select('spend_cents').eq('id', runId).single()
    expect(runRow.spend_cents).toBe(30)

    await admin.rpc('discard_backfill_run', { p_run_id: runId, p_user_id: null })
  })
})
