import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0028 §9.2 (N2.4) — posts.social_account_id, live-Postgres proof.
//
// Covers: the FK exists and points at social_accounts; deleting a
// social_accounts row SETs NULL on referencing posts (never CASCADE-deletes
// them); posts RLS is unchanged/tenant-scoped through the new column in both
// directions with a real signed-in owner-B session (mirrors the cross-tenant
// fixture pattern in posts-approval-boundary.test.ts); a business deletion
// still cascades through posts regardless of social_account_id, and the
// delete call itself must return no error (erasure SUCCESS), not merely
// leave no rows behind afterward (mirrors
// learning-capture-write-once-and-erasure.test.ts's guard against a
// swallowed trigger failure masquerading as a clean delete).

const PASSWORD = 'TestPass123!'

describe('posts.social_account_id — DB-enforced (ADR 0028 §9.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let ownerEmail: string
  let businessId: string
  let campaignId: string
  let socialAccountId: string

  async function createUser(label: string) {
    const email = `postssocial-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function signInAs(email: string) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return client
  }

  async function createPost(overrides: { social_account_id?: string | null } = {}) {
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'social_account_id boundary test post',
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'draft',
        social_account_id: overrides.social_account_id ?? socialAccountId,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id
    ownerEmail = owner.email

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Social Account Id Boundary Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Social Account Id Boundary Campaign',
        objective: 'Test social_account_id boundary',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-07-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campaignErr) throw campaignErr
    campaignId = campaign.id

    const { data: account, error: accountErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'linkedin',
        platform_user_id: 'native-linkedin-user-1',
        platform_username: 'native-linkedin-user-1',
        vault_access_token_id: '00000000-0000-4000-8000-000000000001',
      })
      .select('id')
      .single()
    if (accountErr) throw accountErr
    socialAccountId = account.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('social_accounts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('POSTS-SOCIAL-ACCOUNT-FK-EXISTS: the column accepts a social_accounts id and rejects a non-existent one', async () => {
    const postId = await createPost()
    const { data: check } = await admin.from('posts').select('social_account_id').eq('id', postId).single()
    expect(check.social_account_id).toBe(socialAccountId)
    await admin.from('posts').delete().eq('id', postId)

    const { error: fkErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'invalid FK test',
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'draft',
        social_account_id: '00000000-0000-4000-8000-0000000000ff',
      })
    expect(fkErr).not.toBeNull()
    expect(fkErr!.message).toMatch(/foreign key/i)
  })

  it('POSTS-SOCIAL-ACCOUNT-SET-NULL-NOT-CASCADE: disconnecting (deleting) a social_accounts row SETs NULL on referencing posts, never deletes them', async () => {
    const { data: account, error: accountErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'twitter',
        platform_user_id: 'native-twitter-user-1',
        platform_username: 'native-twitter-user-1',
        vault_access_token_id: '00000000-0000-4000-8000-000000000002',
      })
      .select('id')
      .single()
    if (accountErr) throw accountErr

    const postId = await createPost({ social_account_id: account.id })
    const publishedAt = '2026-07-15T12:00:00Z'
    await admin.from('posts').update({ status: 'published', published_at: publishedAt }).eq('id', postId)

    const { error: deleteErr } = await admin.from('social_accounts').delete().eq('id', account.id)
    expect(deleteErr).toBeNull()

    const { data: postAfter, error: postAfterErr } = await admin
      .from('posts')
      .select('id, social_account_id, published_at, status')
      .eq('id', postId)
      .single()
    expect(postAfterErr).toBeNull()
    expect(postAfter).not.toBeNull()
    expect(postAfter.social_account_id).toBeNull()
    expect(new Date(postAfter.published_at).getTime()).toBe(new Date(publishedAt).getTime())
    expect(postAfter.status).toBe('published')

    await admin.from('posts').delete().eq('id', postId)
  })

  it('POSTS-SOCIAL-ACCOUNT-RLS-UNCHANGED: the tenant owner can read/update posts through the new column', async () => {
    const postId = await createPost()
    const client = await signInAs(ownerEmail)

    const { data: readData, error: readErr } = await client
      .from('posts')
      .select('id, social_account_id')
      .eq('id', postId)
      .single()
    expect(readErr).toBeNull()
    expect(readData!.social_account_id).toBe(socialAccountId)

    const { data: updateData, error: updateErr } = await client
      .from('posts')
      .update({ content: 'owner edit through social_account_id column' })
      .eq('id', postId)
      .select()
    expect(updateErr).toBeNull()
    expect(updateData).toHaveLength(1)

    await admin.from('posts').delete().eq('id', postId)
  })

  it('POSTS-SOCIAL-ACCOUNT-RLS-CROSS-TENANT: a second business owner cannot read or update a post via the new column, in either direction', async () => {
    let otherOwnerId: string | undefined
    let otherBizId: string | undefined
    let postId: string | undefined

    try {
      postId = await createPost()

      const otherOwner = await createUser('other-owner')
      otherOwnerId = otherOwner.id
      const { data: otherBiz, error: otherBizErr } = await admin
        .from('businesses')
        .insert({ name: 'Cross-Tenant Social Account Business', owner_id: otherOwnerId, plan: 'plus' })
        .select('id')
        .single()
      if (otherBizErr) throw otherBizErr
      otherBizId = otherBiz.id

      const otherClient = await signInAs(otherOwner.email)

      // Direction 1: the foreign owner cannot SELECT the in-scope post at all.
      const { data: readData, error: readErr } = await otherClient
        .from('posts')
        .select('id')
        .eq('id', postId)
      expect(readErr).toBeNull()
      expect(readData ?? []).toHaveLength(0)

      // Direction 2: the foreign owner's UPDATE affects zero rows (RLS USING excludes it).
      const { data: updateData, error: updateErr } = await otherClient
        .from('posts')
        .update({ social_account_id: null })
        .eq('id', postId)
        .select()
      expect(updateErr).toBeNull()
      expect(updateData ?? []).toHaveLength(0)

      // Confirm the row is untouched.
      const { data: check } = await admin.from('posts').select('social_account_id').eq('id', postId).single()
      expect(check.social_account_id).toBe(socialAccountId)
    } finally {
      if (postId) await admin.from('posts').delete().eq('id', postId)
      if (otherBizId) await admin.from('businesses').delete().eq('id', otherBizId)
      if (otherOwnerId) await admin.auth.admin.deleteUser(otherOwnerId)
    }
  })

  it('POSTS-SOCIAL-ACCOUNT-ERASURE-SUCCESS: business deletion cascades through posts regardless of social_account_id, and the delete call itself succeeds', async () => {
    let eraseBizId: string | undefined
    let eraseOwnerId: string | undefined

    try {
      const eraseOwner = await createUser('erasure-owner')
      eraseOwnerId = eraseOwner.id
      const { data: eraseBiz, error: eraseBizErr } = await admin
        .from('businesses')
        .insert({ name: 'Erasure Boundary Business', owner_id: eraseOwnerId, plan: 'plus' })
        .select('id')
        .single()
      if (eraseBizErr) throw eraseBizErr
      eraseBizId = eraseBiz.id

      const { data: eraseCampaign, error: eraseCampaignErr } = await admin
        .from('campaigns')
        .insert({
          business_id: eraseBizId,
          name: 'Erasure Boundary Campaign',
          objective: 'Test erasure boundary',
          platforms: ['linkedin'],
          frequency: 'weekly',
          posts_per_week: 1,
          start_date: '2026-07-01',
          origin: 'objective_generated',
        })
        .select('id')
        .single()
      if (eraseCampaignErr) throw eraseCampaignErr

      const { data: eraseAccount, error: eraseAccountErr } = await admin
        .from('social_accounts')
        .insert({
          business_id: eraseBizId,
          platform: 'linkedin',
          platform_user_id: 'erasure-linkedin-user-1',
          platform_username: 'erasure-linkedin-user-1',
          vault_access_token_id: '00000000-0000-4000-8000-000000000003',
        })
        .select('id')
        .single()
      if (eraseAccountErr) throw eraseAccountErr

      const { data: erasePost, error: erasePostErr } = await admin
        .from('posts')
        .insert({
          campaign_id: eraseCampaign.id,
          business_id: eraseBizId,
          platform: 'linkedin',
          content: 'erasure boundary post, linked to a social account',
          scheduled_at: '2026-07-15T12:00:00Z',
          status: 'draft',
          social_account_id: eraseAccount.id,
        })
        .select('id')
        .single()
      if (erasePostErr) throw erasePostErr

      // The delete call itself must return no error — a rows-are-gone check
      // alone would never be reached if a trigger raised inside the cascade
      // and rolled the whole transaction back.
      const { error: deleteErr } = await admin.from('businesses').delete().eq('id', eraseBizId)
      expect(deleteErr).toBeNull()

      const { data: postsAfter, error: postsAfterErr } = await admin
        .from('posts')
        .select('id')
        .eq('id', erasePost.id)
      expect(postsAfterErr).toBeNull()
      expect(postsAfter ?? []).toHaveLength(0)

      const { data: accountsAfter, error: accountsAfterErr } = await admin
        .from('social_accounts')
        .select('id')
        .eq('id', eraseAccount.id)
      expect(accountsAfterErr).toBeNull()
      expect(accountsAfter ?? []).toHaveLength(0)

      eraseBizId = undefined // already gone; skip cleanup below
    } finally {
      if (eraseBizId) await admin.from('businesses').delete().eq('id', eraseBizId)
      if (eraseOwnerId) await admin.auth.admin.deleteUser(eraseOwnerId)
    }
  })
})
