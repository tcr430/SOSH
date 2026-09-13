import { describe, it, expect } from 'vitest'

// BACKFILL-PURGE-COVERED (ADR 0025 §12 constraint 49, Tier 1). purge_business
// over a business holding a run, staging and ACTIVE import rows on all four
// memory tables leaves ZERO of each — the import_run_id ON DELETE NO ACTION
// FK must not block the cascade (ADR §5.1: NO ACTION is checked at
// statement end, after the memory rows' own business_id ON DELETE CASCADE
// has already removed them in the same statement).
describe('purge_business covers social_backfill_runs/posts and import memory rows (ADR 0025 §5.1/§9.1)', () => {
  it('a business holding a run, staging, and active import rows on all four memory tables is left with zero of each after purge', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = createServiceRoleClient()

    const email = `purge-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    const ownerId = userData.user.id as string

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Purge Backfill Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    const businessId = biz.id as string

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-purge-user',
        platform_username: 'purge_handle',
        vault_access_token_id: '00000000-0000-4000-8000-0000000000c0',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    const socialAccountId = account.id as string

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: socialAccountId, platform: 'twitter' })
      .select('id')
      .single()
    if (runErr) throw runErr
    const runId = run.id as string

    const { error: postErr } = await admin.from('social_backfill_posts').insert({
      business_id: businessId,
      run_id: runId,
      social_account_id: socialAccountId,
      platform_post_id: 'purge-staging-post-1',
      published_at: new Date().toISOString(),
      content: 'staged content pending purge',
      format: 'text',
    })
    if (postErr) throw postErr

    // Active import rows on all four tables (bypassing ratify — this test
    // is about the cascade, not the ratify path).
    const { error: brandErr } = await admin.from('brand_memory').insert({
      business_id: businessId,
      source: 'import',
      scope: 'brand',
      import_run_id: runId,
      import_source_post_ids: ['purge-post-1'],
      category: 'other',
      statement: 'Purge test brand statement',
      status: 'active',
    })
    if (brandErr) throw brandErr

    const { error: evidenceErr } = await admin.from('evidence_memory').insert({
      business_id: businessId,
      source: 'import',
      scope: 'brand',
      import_run_id: runId,
      import_source_post_ids: ['purge-post-1'],
      kind: 'quote',
      content: 'Purge test evidence content',
      status: 'active',
    })
    if (evidenceErr) throw evidenceErr

    const { error: audienceErr } = await admin.from('audience_memory').insert({
      business_id: businessId,
      source: 'import',
      scope: 'brand',
      import_run_id: runId,
      import_source_post_ids: ['purge-post-1'],
      kind: 'problem',
      statement: 'Purge test audience statement',
      status: 'active',
    })
    if (audienceErr) throw audienceErr

    const { error: performanceErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'import',
      scope: 'brand',
      import_run_id: runId,
      import_source_post_ids: ['purge-post-1'],
      dimension: 'topic',
      pattern: 'Purge test performance pattern',
      status: 'active',
    })
    if (performanceErr) throw performanceErr

    const { data: purgeResult, error: purgeErr } = await admin.rpc('purge_business', { p_business_id: businessId })
    if (purgeErr) throw purgeErr
    expect(purgeResult.already_purged).toBe(false)

    const { data: remainingRuns } = await admin.from('social_backfill_runs').select('id').eq('business_id', businessId)
    const { data: remainingPosts } = await admin.from('social_backfill_posts').select('id').eq('business_id', businessId)
    const { data: remainingBrand } = await admin.from('brand_memory').select('id').eq('business_id', businessId)
    const { data: remainingEvidence } = await admin.from('evidence_memory').select('id').eq('business_id', businessId)
    const { data: remainingAudience } = await admin.from('audience_memory').select('id').eq('business_id', businessId)
    const { data: remainingPerformance } = await admin.from('performance_memory').select('id').eq('business_id', businessId)

    expect(remainingRuns ?? []).toEqual([])
    expect(remainingPosts ?? []).toEqual([])
    expect(remainingBrand ?? []).toEqual([])
    expect(remainingEvidence ?? []).toEqual([])
    expect(remainingAudience ?? []).toEqual([])
    expect(remainingPerformance ?? []).toEqual([])

    await admin.auth.admin.deleteUser(ownerId)
  })
})
