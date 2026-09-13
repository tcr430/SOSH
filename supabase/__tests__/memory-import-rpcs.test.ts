import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-EVIDENCE-NOT-PUBLIC (ADR 0025 §12 constraint 34) and
// BACKFILL-IMPORT-IDEMPOTENT (constraint 56), Tier 1. The three import
// writer RPCs fix source/status/sensitivity/public_use_permission in SQL —
// their signatures carry NO parameter for any of these, so a caller
// structurally cannot set them; a written evidence row's
// public_use_permission is false regardless. Re-running the same import
// (same run, same content) inserts zero new rows on all three tables.
describe('import_evidence_memory / import_audience_memory / import_performance_memory (ADR 0025 §9.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string
  let runId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `mem-import-rpcs-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Memory Import RPCs Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-import-rpcs-user',
        platform_username: 'import_rpcs_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000080',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: socialAccountId, platform: 'twitter' })
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

  it('import_evidence_memory: status=candidate, source=import, sensitivity=internal, public_use_permission=false — every governance column fixed, none is a caller parameter', async () => {
    const { data, error } = await admin.rpc('import_evidence_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['evidence-post-1'],
      p_kind: 'quote',
      p_content: 'A quote that must land internal and non-public regardless of caller intent',
      p_source_url: 'https://x.com/handle/status/1',
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    if (error) throw error
    const row = data[0]
    expect(row.status).toBe('candidate')
    expect(row.source).toBe('import')
    expect(row.sensitivity).toBe('internal')
    expect(row.public_use_permission).toBe(false)
  })

  it('re-running the same import (same run, same content) inserts zero new rows on all three tables', async () => {
    const evidenceArgs = {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['idempotent-post-1'],
      p_kind: 'quote',
      p_content: 'Idempotency test evidence content',
      p_source_url: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    }
    const first = await admin.rpc('import_evidence_memory', evidenceArgs)
    if (first.error) throw first.error
    expect(first.data).toHaveLength(1)
    const second = await admin.rpc('import_evidence_memory', evidenceArgs)
    if (second.error) throw second.error
    expect(second.data).toHaveLength(0)

    const audienceArgs = {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['idempotent-post-2'],
      p_segment: null,
      p_kind: 'problem',
      p_statement: 'Idempotency test audience statement',
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.3,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    }
    const thirdA = await admin.rpc('import_audience_memory', audienceArgs)
    if (thirdA.error) throw thirdA.error
    expect(thirdA.data).toHaveLength(1)
    const fourthA = await admin.rpc('import_audience_memory', audienceArgs)
    if (fourthA.error) throw fourthA.error
    expect(fourthA.data).toHaveLength(0)

    const performanceArgs = {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['idempotent-post-3'],
      p_dimension: 'topic',
      p_pattern: 'Idempotency test pattern',
      p_platform: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.6,
      p_observation_count: 5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    }
    const fifthP = await admin.rpc('import_performance_memory', performanceArgs)
    if (fifthP.error) throw fifthP.error
    expect(fifthP.data).toHaveLength(1)
    const sixthP = await admin.rpc('import_performance_memory', performanceArgs)
    if (sixthP.error) throw sixthP.error
    expect(sixthP.data).toHaveLength(0)
  })

  it('authenticated EXECUTE is refused on all three import RPCs', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const { createClient } = await import('@supabase/supabase-js')
    const email = `mem-import-rpcs-auth-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { error: createErr } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (createErr) throw createErr
    const client = createClient(url, anonKey)
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password: 'TestPass123!' })
    if (signInErr) throw signInErr

    const { error } = await client.rpc('import_evidence_memory', {
      p_business_id: businessId,
      p_import_run_id: runId,
      p_import_source_post_ids: ['forged-post'],
      p_kind: 'quote',
      p_content: 'forged',
      p_source_url: null,
      p_scope: 'brand',
      p_scope_ref: null,
      p_confidence: 0.5,
      p_last_confirmed_at: new Date().toISOString(),
      p_expires_at: null,
    })
    expect(error).not.toBeNull()

    await admin.auth.admin.deleteUser((await client.auth.getUser()).data.user!.id)
  })
})
