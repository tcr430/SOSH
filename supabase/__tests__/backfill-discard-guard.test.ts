import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// MINOR-4 (Session 32-D, D3, ADR 0025 §6.4/§9.4). discard_backfill_run's
// non-null p_user_id path now requires status='active' AND (role='approver'
// OR is_admin) — the same gate ratify_backfill_run enforces — instead of any
// active member. The NULL p_user_id system path (deactivateSocialAccount)
// is unchanged and still succeeds unconditionally.
describe('discard_backfill_run approver/admin guard (ADR 0025 §6.4, MINOR-4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let approverId: string
  let viewerId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    async function createUser(label: string) {
      const email = `discard-guard-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
      const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
      if (error) throw error
      return { id: data.user.id as string, email }
    }

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Discard Guard Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const approver = await createUser('approver')
    approverId = approver.id
    const viewer = await createUser('viewer')
    viewerId = viewer.id

    const { error: membersErr } = await admin.from('business_members').insert([
      { business_id: businessId, user_id: approverId, email: approver.email, role: 'approver', status: 'active' },
      { business_id: businessId, user_id: viewerId, email: viewer.email, role: 'viewer', status: 'active' },
    ])
    if (membersErr) throw membersErr
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    for (const id of [ownerId, approverId, viewerId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  let runCounter = 0
  async function makeRun() {
    runCounter += 1
    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: `x-discard-guard-${runCounter}`,
        platform_username: `discard_guard_${runCounter}`,
        vault_access_token_id: `00000000-0000-4000-8000-0000000000${String(50 + runCounter)}`,
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr

    const { data, error } = await admin
      .from('social_backfill_runs')
      .insert({
        business_id: businessId,
        social_account_id: account.id,
        platform: 'twitter',
        status: 'awaiting_ratification',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  it('a viewer discard raises', async () => {
    const runId = await makeRun()
    const { error } = await admin.rpc('discard_backfill_run', { p_run_id: runId, p_user_id: viewerId })
    expect(error).not.toBeNull()

    const { data: run } = await admin.from('social_backfill_runs').select('status').eq('id', runId).single()
    expect(run.status).toBe('awaiting_ratification')
  })

  it('an approver discard succeeds', async () => {
    const runId = await makeRun()
    const { data, error } = await admin.rpc('discard_backfill_run', { p_run_id: runId, p_user_id: approverId })
    if (error) throw error
    expect(data[0].status).toBe('discarded')
  })

  it('a NULL p_user_id (system/disconnect path) discard succeeds unconditionally', async () => {
    const runId = await makeRun()
    const { data, error } = await admin.rpc('discard_backfill_run', { p_run_id: runId, p_user_id: null })
    if (error) throw error
    expect(data[0].status).toBe('discarded')
  })
})
