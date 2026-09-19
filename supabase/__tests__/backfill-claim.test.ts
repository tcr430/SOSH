import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// BACKFILL-CLAIM-ATOMIC (ADR 0025 §12 constraint 19, Tier 1). Two concurrent
// claim_backfill_posts calls over the same run must never return an
// overlapping staging row — FOR UPDATE SKIP LOCKED is what's under test.
describe('claim_backfill_posts concurrency (ADR 0025 §6.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let runId: string
  const POST_COUNT = 20

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-claim-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Claim Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: account, error: acctErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'x-claim-user',
        platform_username: 'claim_handle',
        vault_access_token_id: '00000000-0000-4000-8000-000000000040',
        connected_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (acctErr) throw acctErr
    const socialAccountId = account.id

    const { data: run, error: runErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: socialAccountId, platform: 'twitter' })
      .select('id')
      .single()
    if (runErr) throw runErr
    runId = run.id

    const posts = Array.from({ length: POST_COUNT }, (_, i) => ({
      business_id: businessId,
      run_id: runId,
      social_account_id: socialAccountId,
      platform_post_id: `claim-post-${i}`,
      published_at: new Date(Date.now() - i * 1000).toISOString(),
      content: `Claim test post ${i}`,
      format: 'text',
    }))
    const { error: postsErr } = await admin.from('social_backfill_posts').insert(posts)
    if (postsErr) throw postsErr
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('two concurrent claims never return an overlapping row', async () => {
    const [resultA, resultB] = await Promise.all([
      admin.rpc('claim_backfill_posts', { p_run_id: runId, p_limit: 10 }),
      admin.rpc('claim_backfill_posts', { p_run_id: runId, p_limit: 10 }),
    ])
    if (resultA.error) throw resultA.error
    if (resultB.error) throw resultB.error

    const idsA = new Set((resultA.data as Array<{ id: string }>).map((r) => r.id))
    const idsB = new Set((resultB.data as Array<{ id: string }>).map((r) => r.id))

    expect(idsA.size).toBeGreaterThan(0)
    expect(idsB.size).toBeGreaterThan(0)

    const overlap = [...idsA].filter((id) => idsB.has(id))
    expect(overlap).toEqual([])

    // Together they must have claimed every post exactly once (10 + 10 = 20).
    expect(idsA.size + idsB.size).toBe(POST_COUNT)

    const { data: stillPending } = await admin
      .from('social_backfill_posts')
      .select('id')
      .eq('run_id', runId)
      .eq('extraction_status', 'pending')
    expect(stillPending ?? []).toEqual([])
  })
})
