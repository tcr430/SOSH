import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// Gates on a live Supabase instance, like the other supabase/__tests__ integration suites.
const INTEGRATION = process.env.BACKFILL_PURGE_INTEGRATION_TEST_ENABLED === 'true'

const PASSWORD = 'TestPass123!'

const CAPABILITIES = [
  'author',
  'reschedule',
  'approve',
  'connect_accounts',
  'manage_members',
  'manage_billing',
] as const

describe.skipIf(!INTEGRATION)('backfill_owner_members (ADR 0013 §9 M7) + purge_business member delete (§8 M8)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const businessIds: string[] = []
  const userIds: string[] = []

  async function createUser(label: string) {
    const email = `backfillpurge-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    userIds.push(data.user.id)
    return { id: data.user.id as string, email }
  }

  async function createBusiness(ownerId: string, name: string) {
    const { data, error } = await admin
      .from('businesses')
      .insert({ name, owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (error) throw error
    businessIds.push(data.id)
    return data.id as string
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

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
  })

  afterAll(async () => {
    if (!admin) return
    for (const id of businessIds) {
      await admin.from('business_members').delete().eq('business_id', id)
      await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of userIds) {
      await admin.auth.admin.deleteUser(id)
    }
  })

  // The backfill (§9 M7) is one-time migration DML with no callable interface
  // (like the pre-existing trial_state/voice_axes backfills, it has no wrapper
  // RPC). This mirrors the migration's INSERT shape directly — the same
  // pattern business-members-constraints.test.ts already uses at its L-8 setup
  // step — so the test exercises the real target of the partial unique index
  // the migration's ON CONFLICT DO NOTHING relies on.
  async function insertOwnerBackfillRow(businessId: string, owner: { id: string; email: string }) {
    return admin.from('business_members').insert({
      business_id: businessId,
      user_id: owner.id,
      email: owner.email.toLowerCase(),
      role: 'approver',
      is_admin: true,
      status: 'active',
    })
  }

  it('backfills a creator row (approver+is_admin+active) for a business with no member row yet', async () => {
    const owner = await createUser('creator1')
    const businessId = await createBusiness(owner.id, 'Backfill Business 1')

    const { error: insertErr } = await insertOwnerBackfillRow(businessId, owner)
    expect(insertErr).toBeNull()

    const { data: member, error } = await admin
      .from('business_members')
      .select('*')
      .eq('business_id', businessId)
      .eq('user_id', owner.id)
      .single()
    expect(error).toBeNull()
    expect(member.role).toBe('approver')
    expect(member.is_admin).toBe(true)
    expect(member.status).toBe('active')
  })

  it('is idempotent: a second backfill insert for a business already covered hits the partial unique index, not a duplicate row (ROLE-CREATOR-BACKFILL-IDEMPOTENT)', async () => {
    const owner = await createUser('creator2')
    const businessId = await createBusiness(owner.id, 'Backfill Business 2')

    const { error: firstErr } = await insertOwnerBackfillRow(businessId, owner)
    expect(firstErr).toBeNull()
    const first = await admin.from('business_members').select('id').eq('business_id', businessId)
    expect(first.data).toHaveLength(1)

    // The migration's ON CONFLICT (business_id, user_id) WHERE (...) DO NOTHING
    // targets exactly this index (business_members_uniq_user); a raw re-insert
    // without that clause surfaces the same 23505 the migration swallows.
    const { error: secondErr } = await insertOwnerBackfillRow(businessId, owner)
    expect(secondErr).not.toBeNull()
    expect(secondErr!.code).toBe('23505')

    const second = await admin.from('business_members').select('id').eq('business_id', businessId)
    expect(second.data).toHaveLength(1)
    expect(second.data![0].id).toBe(first.data![0].id)
  })

  it('the backfilled creator suffers zero capability regression across all six user_can capabilities (ROLE-CREATOR-NOREG)', async () => {
    const owner = await createUser('creator3')
    const businessId = await createBusiness(owner.id, 'Backfill Business 3')

    const { error: insertErr } = await insertOwnerBackfillRow(businessId, owner)
    expect(insertErr).toBeNull()

    const client = await signInAs(owner.email)
    for (const capability of CAPABILITIES) {
      const { data, error } = await client.rpc('user_can', {
        p_business_id: businessId,
        p_capability: capability,
      })
      expect(error).toBeNull()
      expect(data).toBe(true)
    }
  })

  it('purge_business erases business_members rows for the purged business (RLS-PURGE-EXPLICIT-MEMBER-DELETE)', async () => {
    const owner = await createUser('purgeowner')
    const businessId = await createBusiness(owner.id, 'Purge Business')

    await admin.from('business_members').insert({
      business_id: businessId,
      user_id: owner.id,
      email: owner.email.toLowerCase(),
      role: 'approver',
      is_admin: true,
      status: 'active',
    })

    const before = await admin.from('business_members').select('id').eq('business_id', businessId)
    expect(before.data!.length).toBeGreaterThan(0)

    const { data: result, error } = await admin.rpc('purge_business', { p_business_id: businessId })
    expect(error).toBeNull()
    expect(result.already_purged).toBe(false)

    const after = await admin.from('business_members').select('id').eq('business_id', businessId)
    expect(after.data).toHaveLength(0)

    const bizAfter = await admin.from('businesses').select('id').eq('id', businessId)
    expect(bizAfter.data).toHaveLength(0)

    // Prevent afterAll from trying to clean up an already-purged business.
    businessIds.splice(businessIds.indexOf(businessId), 1)
  })

  it('purge_business remains correct (member rows still gone) whether the DELETE fires explicitly or the ON DELETE CASCADE would also catch it', async () => {
    const owner = await createUser('purgeowner2')
    const businessId = await createBusiness(owner.id, 'Purge Business Cascade Check')

    await admin.from('business_members').insert({
      business_id: businessId,
      user_id: owner.id,
      email: owner.email.toLowerCase(),
      role: 'approver',
      is_admin: true,
      status: 'active',
    })

    const { error } = await admin.rpc('purge_business', { p_business_id: businessId })
    expect(error).toBeNull()

    const { data: membersAfter } = await admin
      .from('business_members')
      .select('id')
      .eq('business_id', businessId)
    expect(membersAfter).toHaveLength(0)

    businessIds.splice(businessIds.indexOf(businessId), 1)
  })
})
