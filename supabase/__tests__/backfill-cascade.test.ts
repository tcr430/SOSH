import { describe, it, expect } from 'vitest'

// BACKFILL-CASCADE-COMPLETE (ADR 0025 §12 constraint 48, Tier 1). Deleting a
// business must leave zero social_backfill_runs and zero social_backfill_posts
// rows behind — both tables cascade from businesses ON DELETE (business_id
// on both, social_account_id/run_id as secondary cascade paths). The §D2.5
// row-presence half of this constraint is a Tier-2 companion
// (lib/db/__tests__/d2.5-backfill-rows.test.ts), not this SQL test.
describe('social_backfill_runs / social_backfill_posts cascade from businesses (ADR 0025 §9.2)', () => {
  it('deleting a business leaves zero runs and zero staging rows', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = createServiceRoleClient()

    const email = `backfill-cascade-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    const ownerId = userData.user.id as string

    try {
      const { data: biz, error: bizErr } = await admin
        .from('businesses')
        .insert({ name: 'Backfill Cascade Business', owner_id: ownerId, plan: 'plus' })
        .select('id')
        .single()
      if (bizErr) throw bizErr
      const businessId = biz.id as string

      const { data: account, error: acctErr } = await admin
        .from('social_accounts')
        .insert({
          business_id: businessId,
          platform: 'twitter',
          platform_user_id: 'x-cascade-user',
          platform_username: 'cascade_handle',
          vault_access_token_id: '00000000-0000-4000-8000-000000000020',
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
        platform_post_id: 'cascade-post-1',
        published_at: new Date().toISOString(),
        content: 'cascade test content',
        format: 'text',
      })
      if (postErr) throw postErr

      const { error: deleteErr } = await admin.from('businesses').delete().eq('id', businessId)
      if (deleteErr) throw deleteErr

      const { data: remainingRuns } = await admin.from('social_backfill_runs').select('id').eq('business_id', businessId)
      const { data: remainingPosts } = await admin.from('social_backfill_posts').select('id').eq('business_id', businessId)

      expect(remainingRuns ?? []).toEqual([])
      expect(remainingPosts ?? []).toEqual([])
    } finally {
      await admin.auth.admin.deleteUser(ownerId)
    }
  })
})
