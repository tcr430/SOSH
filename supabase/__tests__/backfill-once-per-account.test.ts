import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-ONCE-PER-ACCOUNT (ADR 0025 §12 constraint 18, Tier 1). Exercises
// enqueue_backfill_run / resume_backfill_run / discard_backfill_run directly
// via RPC against live Postgres — never a read-then-assert on application
// logic, the RPCs' own atomicity is what is under test.
describe('enqueue_backfill_run / resume_backfill_run / discard_backfill_run (ADR 0025 §6.5)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-once-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Once Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-once-user',
        platform_username: 'once_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000030',
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

  async function enqueue() {
    const { data, error } = await admin.rpc('enqueue_backfill_run', {
      p_business_id: businessId,
      p_social_account_id: socialAccountId,
      p_platform: 'twitter',
    })
    if (error) throw error
    return (data as Array<{ id: string; status: string }>)[0] ?? null
  }

  it('the full lifecycle: second enqueue while queued returns null; a failed run stays the SAME row on resume; a discard frees the slot; the 4th run overall is refused', async () => {
    // 1st enqueue succeeds.
    const run1 = await enqueue()
    expect(run1).not.toBeNull()
    expect(run1!.status).toBe('queued')

    // 2nd enqueue while run1 is still 'queued' (live) returns null.
    const secondWhileQueued = await enqueue()
    expect(secondWhileQueued).toBeNull()

    // Simulate a failed run (not via the RPC — a direct status flip, as the
    // orchestrator's tick would do on a real fetch failure).
    const { error: failErr } = await admin
      .from('social_backfill_runs')
      .update({ status: 'failed', error_code: 'network' })
      .eq('id', run1!.id)
    if (failErr) throw failErr

    // Still refused — a failed run occupies the slot until resumed.
    const secondWhileFailed = await enqueue()
    expect(secondWhileFailed).toBeNull()

    // resume_backfill_run keeps the SAME id.
    const { data: resumedData, error: resumeErr } = await admin.rpc('resume_backfill_run', { p_run_id: run1!.id })
    if (resumeErr) throw resumeErr
    const resumed = (resumedData as Array<{ id: string; status: string }>)[0]
    expect(resumed.id).toBe(run1!.id)
    expect(resumed.status).toBe('queued')

    // Discard run1 — frees the slot for a new run.
    const { error: discard1Err } = await admin.rpc('discard_backfill_run', { p_run_id: run1!.id, p_user_id: null })
    if (discard1Err) throw discard1Err

    // 2nd run overall now succeeds.
    const run2 = await enqueue()
    expect(run2).not.toBeNull()
    expect(run2!.id).not.toBe(run1!.id)

    const { error: discard2Err } = await admin.rpc('discard_backfill_run', { p_run_id: run2!.id, p_user_id: null })
    if (discard2Err) throw discard2Err

    // 3rd run overall succeeds (2 discards + this one = 3 total, at the cap).
    const run3 = await enqueue()
    expect(run3).not.toBeNull()

    const { error: discard3Err } = await admin.rpc('discard_backfill_run', { p_run_id: run3!.id, p_user_id: null })
    if (discard3Err) throw discard3Err

    // 4th run overall is refused — BACKFILL_MAX_RUNS_PER_ACCOUNT = 3 reached,
    // even though the slot is free (all three are discarded).
    const run4 = await enqueue()
    expect(run4).toBeNull()
  })

  it('caller_bug is not resumable', async () => {
    const { data: biz2, error: biz2Err } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Once Business 2', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (biz2Err) throw biz2Err

    const { data: account2, error: acct2Err } = await admin
      .from('social_accounts')
      .insert({
        business_id: biz2.id,
        platform: 'twitter',
        platform_user_id: 'x-once-user-2',
        platform_username: 'once_handle_2',
        vault_access_token_id: '00000000-0000-4000-8000-000000000031',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acct2Err) throw acct2Err

    const { data: runData, error: runErr } = await admin.rpc('enqueue_backfill_run', {
      p_business_id: biz2.id,
      p_social_account_id: account2.id,
      p_platform: 'twitter',
    })
    if (runErr) throw runErr
    const run = (runData as Array<{ id: string }>)[0]

    const { error: failErr } = await admin
      .from('social_backfill_runs')
      .update({ status: 'failed', error_code: 'caller_bug' })
      .eq('id', run.id)
    if (failErr) throw failErr

    const { data: resumeData, error: resumeErr } = await admin.rpc('resume_backfill_run', { p_run_id: run.id })
    if (resumeErr) throw resumeErr
    expect((resumeData as unknown[]).length).toBe(0)

    await admin.from('businesses').delete().eq('id', biz2.id)
  })
})
