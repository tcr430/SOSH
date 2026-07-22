import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const PASSWORD = 'TestPass123!'

describe('get_user_business_ids() — read blast-radius matrix (ADR 0013 §3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any

  let businessAId: string
  let businessBId: string
  let businessCId: string // soft-deleted
  let postAId: string
  let campaignAId: string
  let socialAccountAId: string
  let postMetricAId: string

  let ownerAEmail: string
  let ownerBEmail: string
  let ownerCEmail: string
  let activeMemberEmail: string
  let invitedMemberEmail: string
  let revokedMemberEmail: string

  let ownerAId: string
  let ownerBId: string
  let ownerCId: string
  let activeMemberId: string
  let invitedMemberId: string
  let revokedMemberId: string

  async function createUser(label: string) {
    const email = `matrix-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  // Returns an anon-key client signed in as the given user — RLS applies to every query.
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

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const ownerA = await createUser('owner-a')
    ownerAId = ownerA.id
    ownerAEmail = ownerA.email
    const ownerB = await createUser('owner-b')
    ownerBId = ownerB.id
    ownerBEmail = ownerB.email
    const ownerC = await createUser('owner-c')
    ownerCId = ownerC.id
    ownerCEmail = ownerC.email

    const activeMember = await createUser('active-member')
    activeMemberId = activeMember.id
    activeMemberEmail = activeMember.email
    const invitedMember = await createUser('invited-member')
    invitedMemberId = invitedMember.id
    invitedMemberEmail = invitedMember.email
    const revokedMember = await createUser('revoked-member')
    revokedMemberId = revokedMember.id
    revokedMemberEmail = revokedMember.email

    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'Matrix Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Matrix Business B (cross-tenant)', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id

    const { data: bizC, error: bizCErr } = await admin
      .from('businesses')
      .insert({ name: 'Matrix Business C (soft-deleted)', owner_id: ownerCId, plan: 'plus' })
      .select('id')
      .single()
    if (bizCErr) throw bizCErr
    businessCId = bizC.id
    const { error: softDeleteErr } = await admin
      .from('businesses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', businessCId)
    if (softDeleteErr) throw softDeleteErr

    // Active member of business A.
    const { error: activeErr } = await admin.from('business_members').insert({
      business_id: businessAId,
      user_id: activeMemberId,
      email: activeMemberEmail,
      role: 'editor',
      status: 'active',
    })
    if (activeErr) throw activeErr

    // A membership row bound to a user but still 'invited' (not yet active) — must not grant access.
    const { error: invitedErr } = await admin.from('business_members').insert({
      business_id: businessAId,
      user_id: invitedMemberId,
      email: invitedMemberEmail,
      role: 'editor',
      status: 'invited',
    })
    if (invitedErr) throw invitedErr

    // A revoked membership — must not grant access.
    const { error: revokedRowErr } = await admin.from('business_members').insert({
      business_id: businessAId,
      user_id: revokedMemberId,
      email: revokedMemberEmail,
      role: 'editor',
      status: 'active',
    })
    if (revokedRowErr) throw revokedRowErr
    const { error: revokeErr } = await admin
      .from('business_members')
      .update({ status: 'revoked' })
      .eq('business_id', businessAId)
      .eq('user_id', revokedMemberId)
    if (revokeErr) throw revokeErr

    // A campaign + post on business A — the "posts specifically" leg of the matrix.
    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessAId,
        name: 'Matrix Campaign',
        objective: 'Test read matrix',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-07-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campaignErr) throw campaignErr
    campaignAId = campaign.id

    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaign.id,
        business_id: businessAId,
        platform: 'linkedin',
        content: 'Matrix test post',
        scheduled_at: '2026-07-10T12:00:00Z',
      })
      .select('id')
      .single()
    if (postErr) throw postErr
    postAId = post.id

    // MAJOR-2 — widen the matrix to campaigns/social_accounts/post_metrics,
    // all gated by the same get_user_business_ids() helper as businesses/posts.
    const { data: socialAccount, error: socialAccountErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessAId,
        platform: 'linkedin',
        platform_user_id: 'matrix-platform-user',
        platform_username: 'matrix-handle',
        vault_access_token_id: '00000000-0000-0000-0000-000000000001',
      })
      .select('id')
      .single()
    if (socialAccountErr) throw socialAccountErr
    socialAccountAId = socialAccount.id

    const { data: postMetric, error: postMetricErr } = await admin
      .from('post_metrics')
      .insert({ post_id: postAId, business_id: businessAId, likes: 1 })
      .select('id')
      .single()
    if (postMetricErr) throw postMetricErr
    postMetricAId = postMetric.id
  })

  afterAll(async () => {
    if (!admin) return
    for (const id of [businessAId, businessBId, businessCId]) {
      if (id) await admin.from('business_members').delete().eq('business_id', id)
    }
    if (businessAId) {
      await admin.from('post_metrics').delete().eq('business_id', businessAId)
      await admin.from('social_accounts').delete().eq('business_id', businessAId)
      await admin.from('posts').delete().eq('business_id', businessAId)
      await admin.from('campaigns').delete().eq('business_id', businessAId)
    }
    for (const id of [businessAId, businessBId, businessCId]) {
      if (id) await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of [ownerAId, ownerBId, ownerCId, activeMemberId, invitedMemberId, revokedMemberId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  // MAJOR-2 — the same visibility outcome (visible/not-visible for business A's
  // rows) asserted for campaigns, social_accounts, and post_metrics, mirroring
  // the businesses/posts checks each actor test already performs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function expectWideMatrix(client: any, shouldSee: boolean) {
    const { data: campaigns } = await client.from('campaigns').select('id').eq('id', campaignAId)
    const { data: socialAccounts } = await client.from('social_accounts').select('id').eq('id', socialAccountAId)
    const { data: postMetrics } = await client.from('post_metrics').select('id').eq('id', postMetricAId)
    if (shouldSee) {
      expect((campaigns ?? []).map((c: { id: string }) => c.id)).toContain(campaignAId)
      expect((socialAccounts ?? []).map((s: { id: string }) => s.id)).toContain(socialAccountAId)
      expect((postMetrics ?? []).map((m: { id: string }) => m.id)).toContain(postMetricAId)
    } else {
      expect(campaigns ?? []).toHaveLength(0)
      expect(socialAccounts ?? []).toHaveLength(0)
      expect(postMetrics ?? []).toHaveLength(0)
    }
  }

  it('owner sees own business row (representative table) and own post', async () => {
    const client = await signInAs(ownerAEmail)
    const { data: businesses } = await client.from('businesses').select('id')
    expect((businesses ?? []).map((b: { id: string }) => b.id)).toContain(businessAId)

    const { data: posts } = await client.from('posts').select('id').eq('id', postAId)
    expect((posts ?? []).map((p: { id: string }) => p.id)).toContain(postAId)

    await expectWideMatrix(client, true)
  })

  it('active member (status=active, user_id bound) sees the business row and its post', async () => {
    const client = await signInAs(activeMemberEmail)
    const { data: businesses } = await client.from('businesses').select('id')
    expect((businesses ?? []).map((b: { id: string }) => b.id)).toContain(businessAId)

    const { data: posts } = await client.from('posts').select('id').eq('id', postAId)
    expect((posts ?? []).map((p: { id: string }) => p.id)).toContain(postAId)

    await expectWideMatrix(client, true)
  })

  it('invited member (status=invited, user_id bound) sees nothing', async () => {
    const client = await signInAs(invitedMemberEmail)
    const { data: businesses } = await client.from('businesses').select('id')
    expect((businesses ?? []).map((b: { id: string }) => b.id)).not.toContain(businessAId)

    const { data: posts } = await client.from('posts').select('id').eq('id', postAId)
    expect(posts ?? []).toHaveLength(0)

    await expectWideMatrix(client, false)
  })

  it('revoked member sees nothing', async () => {
    const client = await signInAs(revokedMemberEmail)
    const { data: businesses } = await client.from('businesses').select('id')
    expect((businesses ?? []).map((b: { id: string }) => b.id)).not.toContain(businessAId)

    const { data: posts } = await client.from('posts').select('id').eq('id', postAId)
    expect(posts ?? []).toHaveLength(0)

    await expectWideMatrix(client, false)
  })

  it('cross-tenant user (member of business B) sees no rows of business A', async () => {
    const client = await signInAs(ownerBEmail)
    const { data: businesses } = await client.from('businesses').select('id')
    const ids = (businesses ?? []).map((b: { id: string }) => b.id)
    expect(ids).toContain(businessBId)
    expect(ids).not.toContain(businessAId)

    const { data: posts } = await client.from('posts').select('id').eq('id', postAId)
    expect(posts ?? []).toHaveLength(0)

    await expectWideMatrix(client, false)
  })

  it('member (owner) of a soft-deleted business sees nothing for that business', async () => {
    const client = await signInAs(ownerCEmail)
    const { data: businesses } = await client.from('businesses').select('id')
    expect((businesses ?? []).map((b: { id: string }) => b.id)).not.toContain(businessCId)

    await expectWideMatrix(client, false)
  })

  it('non-recursion: an active member can query business_members without error', async () => {
    const client = await signInAs(activeMemberEmail)
    const { data, error } = await client
      .from('business_members')
      .select('id')
      .eq('business_id', businessAId)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })
})
