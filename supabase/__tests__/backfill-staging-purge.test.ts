import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// MAJOR-10 (Session 32-D, D7, ADR 0025 §8.3/§6.4 BACKFILL-STAGING-PURGED).
// lib/backfill/__tests__/staging-lifecycle.test.ts regex-matched DELETE text
// in the migration SQL — that proves a string exists in a file, not that a
// SECURITY DEFINER function actually purges anything at runtime. This file
// drives the REAL RPCs (and the real lib/db wrappers around them) against
// live Postgres for all four named purge paths: discard, both TTL sweeps,
// and disconnect (deactivateSocialAccount -> the real discard RPC).
describe('BACKFILL-STAGING-PURGED — real purge behavior (ADR 0025 §8.3/§6.4, Session 32-D D7)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-purge-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Purge Business', owner_id: ownerId, plan: 'plus' })
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

  let runCounter = 0
  // A fresh account per run — social_backfill_runs_live_account_uq
  // (BACKFILL-ONCE-PER-ACCOUNT) blocks a second non-discarded run on the
  // same account.
  async function makeAccount() {
    runCounter += 1
    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: `x-purge-user-${runCounter}`,
        platform_username: `purge_handle_${runCounter}`,
        vault_access_token_id: `00000000-0000-4000-8000-0000000000${String(70 + runCounter).padStart(2, '0')}`,
        connected_at: new Date().toISOString(),
        is_active: true,
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    return account.id as string
  }

  async function makeRun(socialAccountId: string, overrides: Record<string, unknown>) {
    const { data, error } = await admin
      .from('social_backfill_runs')
      .insert({
        business_id: businessId,
        social_account_id: socialAccountId,
        platform: 'twitter',
        ...overrides,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function insertStagingPost(runId: string, socialAccountId: string) {
    const { error } = await admin.from('social_backfill_posts').insert({
      business_id: businessId,
      run_id: runId,
      social_account_id: socialAccountId,
      platform_post_id: `purge-post-${runId}`,
      published_at: new Date().toISOString(),
      content: 'staged content pending purge',
      format: 'text',
    })
    if (error) throw error
  }

  async function stagingCount(runId: string): Promise<number> {
    const { data, error } = await admin.from('social_backfill_posts').select('id').eq('run_id', runId)
    if (error) throw error
    return (data ?? []).length
  }

  it('discard_backfill_run (via the real discardBackfillRun wrapper) purges staging for the run', async () => {
    const { discardBackfillRun } = await import('@/lib/db/backfill-runs')
    const accountId = await makeAccount()
    const runId = await makeRun(accountId, { status: 'awaiting_ratification' })
    await insertStagingPost(runId, accountId)
    expect(await stagingCount(runId)).toBe(1)

    const result = await discardBackfillRun(runId, null)
    expect(result?.status).toBe('discarded')
    expect(await stagingCount(runId)).toBe(0)
  })

  it('sweep_expired_backfill_staging (via sweepExpiredBackfillStaging) purges staging for a run whose completed_at is past the TTL, leaves a fresh run untouched', async () => {
    const { sweepExpiredBackfillStaging } = await import('@/lib/db/backfill-runs')
    const staleAccountId = await makeAccount()
    const staleRunId = await makeRun(staleAccountId, { status: 'awaiting_ratification', completed_at: daysAgo(31) })
    await insertStagingPost(staleRunId, staleAccountId)

    const freshAccountId = await makeAccount()
    const freshRunId = await makeRun(freshAccountId, { status: 'awaiting_ratification', completed_at: daysAgo(5) })
    await insertStagingPost(freshRunId, freshAccountId)

    const purged = await sweepExpiredBackfillStaging(30)
    expect(purged).toBeGreaterThanOrEqual(1)
    expect(await stagingCount(staleRunId)).toBe(0)
    expect(await stagingCount(freshRunId)).toBe(1) // untouched
  })

  it('sweep_expired_staged_voice (via sweepExpiredStagedVoice) nulls staged_voice for a run ratified past the TTL, leaves a freshly-ratified run untouched', async () => {
    const { sweepExpiredStagedVoice } = await import('@/lib/db/backfill-runs')
    const staleAccountId = await makeAccount()
    const staleRunId = await makeRun(staleAccountId, {
      status: 'ratified',
      ratified_at: daysAgo(31),
      staged_voice: { tone: ['direct'] },
    })

    const freshAccountId = await makeAccount()
    const freshRunId = await makeRun(freshAccountId, {
      status: 'ratified',
      ratified_at: daysAgo(5),
      staged_voice: { tone: ['direct'] },
    })

    const nulled = await sweepExpiredStagedVoice(30)
    expect(nulled).toBeGreaterThanOrEqual(1)

    const { data: staleRun } = await admin.from('social_backfill_runs').select('staged_voice').eq('id', staleRunId).single()
    expect(staleRun.staged_voice).toBeNull()

    const { data: freshRun } = await admin.from('social_backfill_runs').select('staged_voice').eq('id', freshRunId).single()
    expect(freshRun.staged_voice).toEqual({ tone: ['direct'] }) // untouched
  })

  it('deactivateSocialAccount discards the account\'s live run through the real discard RPC, purging its staging', async () => {
    const { deactivateSocialAccount } = await import('@/lib/db/social-accounts')
    const accountId = await makeAccount()
    const runId = await makeRun(accountId, { status: 'extracting' }) // a "live" (non-discarded) run
    await insertStagingPost(runId, accountId)
    expect(await stagingCount(runId)).toBe(1)

    await deactivateSocialAccount(accountId)

    const { data: run } = await admin.from('social_backfill_runs').select('status').eq('id', runId).single()
    expect(run.status).toBe('discarded')
    expect(await stagingCount(runId)).toBe(0)

    const { data: account } = await admin.from('social_accounts').select('is_active').eq('id', accountId).single()
    expect(account.is_active).toBe(false)
  })
})
