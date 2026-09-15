import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BLOCKER-3's writer (Session 32-D, D3, ADR 0025 §4.1). resolve_backfill_posts
// increments the run's posts_extracted by rows it moves to 'extracted' or
// 'skipped' — posts PROCESSED, never staged, and never 'failed'.
// Re-resolving already-resolved ids (extraction_status no longer 'claimed')
// must not double-count.
describe('resolve_backfill_posts maintains posts_extracted (ADR 0025 §4.1, BLOCKER-3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let socialAccountId: string
  let runId: string
  let postIds: string[]

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-resolve-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Resolve Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-resolve-user',
        platform_username: 'resolve_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000070',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    socialAccountId = account.id

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: socialAccountId, platform: 'twitter', status: 'extracting' })
      .select('id')
      .single()
    if (runErr) throw runErr
    runId = run.id

    const posts = Array.from({ length: 5 }, (_, i) => ({
      business_id: businessId,
      run_id: runId,
      social_account_id: socialAccountId,
      platform_post_id: `resolve-post-${i}`,
      published_at: new Date(Date.now() - i * 1000).toISOString(),
      content: `Resolve test post ${i}`,
      format: 'text',
      extraction_status: 'claimed',
    }))
    const { data: inserted, error: postsErr } = await admin.from('social_backfill_posts').insert(posts).select('id')
    if (postsErr) throw postsErr
    postIds = (inserted as Array<{ id: string }>).map((r) => r.id)
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('claim 5, resolve 3 extracted + 2 skipped -> posts_extracted is 5; re-resolving does not double-count', async () => {
    const extractedIds = postIds.slice(0, 3)
    const skippedIds = postIds.slice(3, 5)

    const first = await admin.rpc('resolve_backfill_posts', { p_post_ids: extractedIds, p_status: 'extracted' })
    if (first.error) throw first.error
    expect(first.data).toBe(3)

    const second = await admin.rpc('resolve_backfill_posts', { p_post_ids: skippedIds, p_status: 'skipped' })
    if (second.error) throw second.error
    expect(second.data).toBe(2)

    const { data: runAfter } = await admin.from('social_backfill_runs').select('posts_extracted').eq('id', runId).single()
    expect(runAfter.posts_extracted).toBe(5)

    // Re-resolving the same (already-resolved) ids matches zero rows and
    // does not double-count.
    const third = await admin.rpc('resolve_backfill_posts', { p_post_ids: extractedIds, p_status: 'extracted' })
    if (third.error) throw third.error
    expect(third.data).toBe(0)

    const { data: runStill } = await admin.from('social_backfill_runs').select('posts_extracted').eq('id', runId).single()
    expect(runStill.posts_extracted).toBe(5)
  })

  it("a 'failed' resolution does NOT increment posts_extracted", async () => {
    // A fresh account — social_backfill_runs_live_account_uq blocks a
    // second non-discarded run on the shared fixture's account.
    const { data: freshAccount, error: freshAcctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-resolve-user-fail',
        platform_username: 'resolve_handle_fail',
        vault_access_token_id: '00000000-0000-4000-8000-000000000071',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (freshAcctErr) throw freshAcctErr

    const { data: failRun, error: mkErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: freshAccount.id, platform: 'twitter', status: 'extracting' })
      .select('id')
      .single()
    if (mkErr) throw mkErr

    const { data: failPost, error: postErr } = await admin
      .from('social_backfill_posts')
      .insert({
        business_id: businessId,
        run_id: failRun.id,
        social_account_id: freshAccount.id,
        platform_post_id: 'resolve-fail-post',
        published_at: new Date().toISOString(),
        content: 'will fail',
        format: 'text',
        extraction_status: 'claimed',
      })
      .select('id')
      .single()
    if (postErr) throw postErr

    const { error, data } = await admin.rpc('resolve_backfill_posts', { p_post_ids: [failPost.id], p_status: 'failed' })
    if (error) throw error
    expect(data).toBe(1)

    const { data: runAfter } = await admin.from('social_backfill_runs').select('posts_extracted').eq('id', failRun.id).single()
    expect(runAfter.posts_extracted).toBe(0)
  })
})
