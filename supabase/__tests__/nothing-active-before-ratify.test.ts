import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-NOTHING-ACTIVE-BEFORE-RATIFY (ADR 0025 §12 constraint 21, Tier
// 1). Every import RPC produces status='candidate'; the ONLY transition to
// 'active' for an import row is ratify_backfill_run — every other
// available path (promote_performance_pattern, which filters
// source='distilled' and so never matches; discard_backfill_run, which
// retires) is attempted and confirmed NOT to activate it.
describe('nothing is active before ratify (ADR 0025 §6.4/§9.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string
  let approverId: string
  let approverEmail: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `nothing-active-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Nothing Active Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    approverEmail = `nothing-active-approver-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: approverData, error: approverErr } = await admin.auth.admin.createUser({
      email: approverEmail,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (approverErr) throw approverErr
    approverId = approverData.user.id
    const { error: memberErr } = await admin
      .from('business_members')
      .insert({ business_id: businessId, user_id: approverId, email: approverEmail, role: 'approver', status: 'active' })
    if (memberErr) throw memberErr

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-nothing-active-user',
        platform_username: 'nothing_active_handle',
        vault_access_token_id: '00000000-0000-4000-8000-0000000000a0',
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
    for (const id of [ownerId, approverId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  let runCounter = 0

  // Each call needs its OWN account — social_backfill_runs_live_account_uq
  // (BACKFILL-ONCE-PER-ACCOUNT) is a real DB constraint that blocks a second
  // non-discarded run for the same account, and this helper is called once
  // per test against a shared business.
  async function makeRun() {
    runCounter += 1
    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: `x-nothing-active-user-${runCounter}`,
        platform_username: `nothing_active_handle_${runCounter}`,
        vault_access_token_id: `00000000-0000-4000-8000-0000000000${String(10 + runCounter).padStart(2, '0')}`,
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
        // MINOR-3 (Session 32-D, D3) — every import RPC now writes zero
        // rows unless the run is 'extracting'; every test here imports
        // first, so the run must start there, not 'awaiting_ratification'.
        status: 'extracting',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  it('every import RPC produces candidate', async () => {
    const runId = await makeRun()

    const evidence = await admin.rpc('import_evidence_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['p1'],
      p_kind: 'quote',
      p_content: 'candidate proof evidence',
      p_source_url: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (evidence.error) throw evidence.error
    expect(evidence.data[0].status).toBe('candidate')

    const audience = await admin.rpc('import_audience_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['p2'],
      p_segment: null,
      p_kind: 'problem',
      p_statement: 'candidate proof audience',
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.3,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (audience.error) throw audience.error
    expect(audience.data[0].status).toBe('candidate')

    const performance = await admin.rpc('import_performance_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['p3'],
      p_dimension: 'topic',
      p_pattern: 'candidate proof performance',
      p_platform: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.6,
      p_observation_count: 5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (performance.error) throw performance.error
    expect(performance.data[0].status).toBe('candidate')
  })

  it('promote_performance_pattern (distilled-only) never activates an import row', async () => {
    const runId = await makeRun()
    const { data: rows, error } = await admin.rpc('import_performance_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['promote-attempt-post'],
      p_dimension: 'topic',
      p_pattern: 'promote attempt pattern',
      p_platform: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.6,
      p_observation_count: 5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (error) throw error
    const row = rows[0]

    const { data: promoteResult, error: promoteErr } = await admin.rpc('promote_performance_pattern', {
      p_business_id: businessId,
      p_pattern_key: null,
      p_dimension: 'topic',
      p_platform: null,
    })
    if (promoteErr) throw promoteErr
    expect(promoteResult ?? []).toEqual([])

    const { data: afterRow } = await admin.from('performance_memory').select('status').eq('id', row.id).single()
    expect(afterRow.status).toBe('candidate')
  })

  it('discard_backfill_run retires, never activates', async () => {
    const runId = await makeRun()
    const { data: rows, error } = await admin.rpc('import_evidence_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['discard-attempt-post'],
      p_kind: 'quote',
      p_content: 'discard attempt evidence',
      p_source_url: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (error) throw error
    const row = rows[0]

    const { error: discardErr } = await admin.rpc('discard_backfill_run', { p_run_id: runId, p_user_id: null })
    if (discardErr) throw discardErr

    const { data: afterRow } = await admin.from('evidence_memory').select('status').eq('id', row.id).single()
    expect(afterRow.status).toBe('retired')
  })

  it('ratify_backfill_run IS the transition to active', async () => {
    const runId = await makeRun()
    const { data: rows, error } = await admin.rpc('import_audience_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['ratify-activates-post'],
      p_segment: null,
      p_kind: 'problem',
      p_statement: 'ratify activates this row',
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.3,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (error) throw error
    const row = rows[0]

    // MAJOR-2 (Session 32-D, D3) — ratify now refuses a run that is not
    // 'awaiting_ratification'; this run started 'extracting' so the import
    // RPC above would write.
    const { error: transitionErr } = await admin
      .from('social_backfill_runs')
      .update({ status: 'awaiting_ratification' })
      .eq('id', runId)
    if (transitionErr) throw transitionErr

    const { error: ratifyErr } = await admin.rpc('ratify_backfill_run', {
      p_user_id: approverId,
      p_run_id: runId,
      p_accepted_ids: [row.id],
      p_rejected_ids: [],
      p_account_role: 'brand',
    })
    if (ratifyErr) throw ratifyErr

    const { data: afterRow } = await admin.from('audience_memory').select('status').eq('id', row.id).single()
    expect(afterRow.status).toBe('active')
  })
})
