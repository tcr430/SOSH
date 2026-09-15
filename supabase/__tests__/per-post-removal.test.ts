import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-PER-POST-REMOVABLE (ADR 0025 §12 constraint 43, Tier 1).
// remove_import_source_post deletes exactly the evidence/audience rows
// backed by the removed post, and retires exactly the performance rows
// whose backing set includes it — none other.
describe('remove_import_source_post (ADR §4 A-5)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string
  let runId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `per-post-removal-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Per-Post Removal Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-per-post-user',
        platform_username: 'per_post_handle',
        vault_access_token_id: '00000000-0000-4000-8000-0000000000b0',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      // MINOR-3 (Session 32-D, D3) — import RPCs now write zero rows
      // unless the run is 'extracting'.
      .insert({ business_id: businessId, social_account_id: socialAccountId, platform: 'twitter', status: 'extracting' })
      .select('id')
      .single()
    if (runErr) throw runErr
    runId = run.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('removes exactly the rows backed by the removed post, none other', async () => {
    const evidenceA = await admin.rpc('import_evidence_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['post-A'],
      p_kind: 'quote',
      p_content: 'Evidence backed by post A only',
      p_source_url: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (evidenceA.error) throw evidenceA.error
    const evidenceRowA = evidenceA.data[0]

    const evidenceB = await admin.rpc('import_evidence_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['post-B'],
      p_kind: 'quote',
      p_content: 'Evidence backed by post B only',
      p_source_url: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (evidenceB.error) throw evidenceB.error
    const evidenceRowB = evidenceB.data[0]

    const audienceA = await admin.rpc('import_audience_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['post-A'],
      p_segment: null,
      p_kind: 'problem',
      p_statement: 'Audience backed by post A only',
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.3,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (audienceA.error) throw audienceA.error
    const audienceRowA = audienceA.data[0]

    const audienceB = await admin.rpc('import_audience_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['post-B'],
      p_segment: null,
      p_kind: 'problem',
      p_statement: 'Audience backed by post B only',
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.3,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (audienceB.error) throw audienceB.error
    const audienceRowB = audienceB.data[0]

    const perfA = await admin.rpc('import_performance_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['post-A'],
      p_dimension: 'topic',
      p_pattern: 'Performance backed by post A alone',
      p_platform: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.6,
      p_observation_count: 5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (perfA.error) throw perfA.error
    const perfRowA = perfA.data[0]

    const perfBC = await admin.rpc('import_performance_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['post-B', 'post-C'],
      p_dimension: 'hook',
      p_pattern: 'Performance backed by posts B and C',
      p_platform: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.6,
      p_observation_count: 5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (perfBC.error) throw perfBC.error
    const perfRowBC = perfBC.data[0]

    const { error: removeErr } = await admin.rpc('remove_import_source_post', {
      p_business_id: businessId,
      p_platform_post_id: 'post-A',
    })
    if (removeErr) throw removeErr

    const { data: evidenceAfterA } = await admin.from('evidence_memory').select('id').eq('id', evidenceRowA.id)
    expect(evidenceAfterA ?? []).toEqual([])
    const { data: evidenceAfterB } = await admin.from('evidence_memory').select('id').eq('id', evidenceRowB.id)
    expect(evidenceAfterB).toHaveLength(1)

    const { data: audienceAfterA } = await admin.from('audience_memory').select('id').eq('id', audienceRowA.id)
    expect(audienceAfterA ?? []).toEqual([])
    const { data: audienceAfterB } = await admin.from('audience_memory').select('id').eq('id', audienceRowB.id)
    expect(audienceAfterB).toHaveLength(1)

    const { data: perfAfterA } = await admin.from('performance_memory').select('status').eq('id', perfRowA.id).single()
    expect(perfAfterA.status).toBe('retired')
    const { data: perfAfterBC } = await admin.from('performance_memory').select('status').eq('id', perfRowBC.id).single()
    expect(perfAfterBC.status).toBe('candidate')
  })
})
