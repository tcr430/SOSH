import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// Gates on a live Supabase instance, like lib/deletion/__integration__/purge-business.test.ts.
const INTEGRATION = process.env.MEMBERS_INTEGRATION_TEST_ENABLED === 'true'

const PASSWORD = 'TestPass123!'

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

    // The primary-admin row (L-8, exercised by trg_protect_primary_admin_membership)
    // is now auto-provisioned by trg_ensure_owner_membership (21A-D/MAJOR-1) — no
    // manual insert needed; a manual one here would 23505 against the trigger's row.
  })

  afterAll(async () => {
    if (!client || !businessId) return
    await client.from('business_members').delete().eq('business_id', businessId)
    await client.from('businesses').delete().eq('id', businessId)
    if (ownerId) await client.auth.admin.deleteUser(ownerId)
  })

  // Returns an anon-key client signed in as the given user — RLS applies to every query.
  async function signInAs(email: string) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    const authClient = createClient(url, anonKey)
    const { error } = await authClient.auth.signInWithPassword({ email, password: PASSWORD })
    if (error) throw error
    return authClient
  }

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

  // D1 / RLS-INVITED-VISIBLE-ALL — the visibility half (§2.1, L-16). Pending
  // rows are visible to every member of the tenant, not just admins; the
  // hijack vector this opens is closed at accept time by email-match, not by
  // restricting visibility here.
  it('a peer active member can SELECT a pending (invited) row of the same business', async () => {
    const { data: authUser } = await client.auth.admin.createUser({
      email: `members-peer-${Date.now()}@integration.test`,
      password: PASSWORD,
      email_confirm: true,
    })
    const peerId = authUser.user.id

    const peerRow = await client
      .from('business_members')
      .insert({
        business_id: businessId,
        user_id: peerId,
        email: authUser.user.email,
        role: 'editor',
        status: 'active',
      })
      .select('id')
      .single()
    expect(peerRow.error).toBeNull()

    const pendingRow = await client
      .from('business_members')
      .insert({
        business_id: businessId,
        email: `pending-visible-${Date.now()}@integration.test`,
        role: 'viewer',
        status: 'invited',
      })
      .select('id')
      .single()
    expect(pendingRow.error).toBeNull()

    const peerClient = await signInAs(authUser.user.email)
    const { data, error } = await peerClient
      .from('business_members')
      .select('id')
      .eq('id', pendingRow.data.id)
    expect(error).toBeNull()
    expect((data ?? []).map((r: { id: string }) => r.id)).toContain(pendingRow.data.id)

    await client.from('business_members').delete().eq('id', pendingRow.data.id)
    await client.from('business_members').delete().eq('id', peerRow.data.id)
    await client.auth.admin.deleteUser(peerId)
  })

  // SEAT-STATUS-3 — the status enum is exactly ('invited','active','revoked');
  // a 4th value must be rejected by the CHECK constraint on both INSERT and UPDATE.
  it('rejects a 4th status value on INSERT (CHECK constraint)', async () => {
    const { error } = await client.from('business_members').insert({
      business_id: businessId,
      email: `bad-status-insert-${Date.now()}@integration.test`,
      role: 'viewer',
      status: 'removed',
    })
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/business_members_status_check|violates check constraint/)
  })

  it('rejects a 4th status value on UPDATE (CHECK constraint)', async () => {
    const row = await client
      .from('business_members')
      .insert({
        business_id: businessId,
        email: `bad-status-update-${Date.now()}@integration.test`,
        role: 'viewer',
        status: 'invited',
      })
      .select('id')
      .single()
    expect(row.error).toBeNull()

    const { error } = await client
      .from('business_members')
      .update({ status: 'removed' })
      .eq('id', row.data.id)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/business_members_status_check|violates check constraint/)

    await client.from('business_members').delete().eq('id', row.data.id)
  })
})
