import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Gates on a live Supabase instance, like lib/deletion/__integration__/purge-business.test.ts.
const INTEGRATION = process.env.MEMBERS_INTEGRATION_TEST_ENABLED === 'true'

describe.skipIf(!INTEGRATION)('business_members — CHECK/unique-index/trigger integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any
  let businessId: string
  let ownerId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    client = createServiceRoleClient()

    const { data: authUser, error: authErr } = await client.auth.admin.createUser({
      email: `members-test-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (authErr) throw authErr
    ownerId = authUser.user.id

    const { data: biz, error: bizErr } = await client
      .from('businesses')
      .insert({
        name: 'Members Integration Test Business',
        owner_id: ownerId,
        plan: 'plus',
      })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    // Backfill the primary-admin row per L-8, exercised by trg_protect_primary_admin_membership.
    const { error: memberErr } = await client.from('business_members').insert({
      business_id: businessId,
      user_id: ownerId,
      email: 'owner@integration.test',
      role: 'approver',
      is_admin: true,
      status: 'active',
    })
    if (memberErr) throw memberErr
  })

  afterAll(async () => {
    if (!client || !businessId) return
    await client.from('business_members').delete().eq('business_id', businessId)
    await client.from('businesses').delete().eq('id', businessId)
    if (ownerId) await client.auth.admin.deleteUser(ownerId)
  })

  it('rejects an active row with a null user_id (business_members_active_has_user)', async () => {
    const { error } = await client.from('business_members').insert({
      business_id: businessId,
      user_id: null,
      email: 'broken@integration.test',
      role: 'editor',
      status: 'active',
    })
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/business_members_active_has_user/)
  })

  it('allows an invited row with a null user_id', async () => {
    const { data, error } = await client
      .from('business_members')
      .insert({
        business_id: businessId,
        email: 'pending@integration.test',
        role: 'viewer',
        status: 'invited',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data.id).toBeTruthy()
    await client.from('business_members').delete().eq('id', data.id)
  })

  it('blocks a second active/invited row for the same (business_id, lower(email))', async () => {
    const email = `dup-${Date.now()}@integration.test`
    const first = await client
      .from('business_members')
      .insert({ business_id: businessId, email, role: 'editor', status: 'invited' })
      .select('id')
      .single()
    expect(first.error).toBeNull()

    const second = await client
      .from('business_members')
      .insert({ business_id: businessId, email: email.toUpperCase(), role: 'editor', status: 'invited' })
    expect(second.error).not.toBeNull()
    expect(second.error.message).toMatch(/business_members_uniq_email/)

    await client.from('business_members').delete().eq('id', first.data.id)
  })

  it('allows re-invite of a revoked email (uniqueness excludes revoked rows)', async () => {
    const email = `reinvite-${Date.now()}@integration.test`
    const first = await client
      .from('business_members')
      .insert({ business_id: businessId, email, role: 'editor', status: 'invited' })
      .select('id')
      .single()
    expect(first.error).toBeNull()

    await client.from('business_members').update({ status: 'revoked' }).eq('id', first.data.id)

    const second = await client
      .from('business_members')
      .insert({ business_id: businessId, email, role: 'editor', status: 'invited' })
      .select('id')
      .single()
    expect(second.error).toBeNull()
    expect(second.data.id).toBeTruthy()

    await client.from('business_members').delete().eq('id', first.data.id)
    await client.from('business_members').delete().eq('id', second.data.id)
  })

  it('blocks a second active/invited row for the same (business_id, user_id)', async () => {
    const { data: authUser } = await client.auth.admin.createUser({
      email: `members-dup-user-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    const userId = authUser.user.id

    const first = await client
      .from('business_members')
      .insert({
        business_id: businessId,
        user_id: userId,
        email: 'first-row@integration.test',
        role: 'editor',
        status: 'active',
      })
      .select('id')
      .single()
    expect(first.error).toBeNull()

    const second = await client.from('business_members').insert({
      business_id: businessId,
      user_id: userId,
      email: 'second-row@integration.test',
      role: 'viewer',
      status: 'invited',
    })
    expect(second.error).not.toBeNull()
    expect(second.error.message).toMatch(/business_members_uniq_user/)

    await client.from('business_members').delete().eq('id', first.data.id)
    await client.auth.admin.deleteUser(userId)
  })

  it('protect_primary_admin_membership blocks demoting the owner_id row', async () => {
    const { error } = await client
      .from('business_members')
      .update({ is_admin: false })
      .eq('business_id', businessId)
      .eq('user_id', ownerId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/primary admin membership cannot be demoted, revoked, or rebound/)
  })

  it('protect_primary_admin_membership blocks revoking the owner_id row', async () => {
    const { error } = await client
      .from('business_members')
      .update({ status: 'revoked' })
      .eq('business_id', businessId)
      .eq('user_id', ownerId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/primary admin membership cannot be demoted, revoked, or rebound/)
  })

  it('protect_primary_admin_membership blocks rebinding the owner_id row to another user', async () => {
    const { data: authUser } = await client.auth.admin.createUser({
      email: `members-rebind-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    const otherUserId = authUser.user.id

    const { error } = await client
      .from('business_members')
      .update({ user_id: otherUserId })
      .eq('business_id', businessId)
      .eq('user_id', ownerId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/primary admin membership cannot be demoted, revoked, or rebound/)

    await client.auth.admin.deleteUser(otherUserId)
  })

  it('protect_primary_admin_membership is a no-op for a non-owner active row', async () => {
    const { data: authUser } = await client.auth.admin.createUser({
      email: `members-nonowner-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    const userId = authUser.user.id

    const row = await client
      .from('business_members')
      .insert({
        business_id: businessId,
        user_id: userId,
        email: 'nonowner@integration.test',
        role: 'editor',
        is_admin: false,
        status: 'active',
      })
      .select('id')
      .single()
    expect(row.error).toBeNull()

    const { error } = await client
      .from('business_members')
      .update({ status: 'revoked' })
      .eq('id', row.data.id)
    expect(error).toBeNull()

    await client.from('business_members').delete().eq('id', row.data.id)
    await client.auth.admin.deleteUser(userId)
  })

  it('protect_primary_admin_membership is a no-op for an invited row (OLD.user_id NULL)', async () => {
    const row = await client
      .from('business_members')
      .insert({
        business_id: businessId,
        email: `invited-noop-${Date.now()}@integration.test`,
        role: 'viewer',
        status: 'invited',
      })
      .select('id')
      .single()
    expect(row.error).toBeNull()

    const { error } = await client
      .from('business_members')
      .update({ status: 'revoked' })
      .eq('id', row.data.id)
    expect(error).toBeNull()

    await client.from('business_members').delete().eq('id', row.data.id)
  })
})
