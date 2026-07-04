import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { countSeatUsage } from '@/lib/db/business-members'

// Gates on a live Supabase instance, like the other supabase/__tests__ integration suites.
// Reads process.env directly (not @/lib/config) so this file has no import-time env
// validation cost when skipped — matches lib/email/__integration__/round-trip.test.ts.
const INTEGRATION = process.env.ACCEPT_INVITE_INTEGRATION_TEST_ENABLED === 'true'

const PASSWORD = 'TestPass123!'

describe.skipIf(!INTEGRATION)('accept_invite() RPC (ADR 0013 §7.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let businessId: string
  let ownerId: string
  const userIds: string[] = []

  async function createUser(label: string) {
    const email = `acceptinvite-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    userIds.push(data.user.id)
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

  async function insertInvite(email: string, invitedAt?: string) {
    const { data, error } = await admin
      .from('business_members')
      .insert({
        business_id: businessId,
        email,
        role: 'editor',
        status: 'invited',
        ...(invitedAt ? { invited_at: invitedAt } : {}),
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

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Accept Invite Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('business_members').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    for (const id of userIds) {
      await admin.auth.admin.deleteUser(id)
    }
  })

  it('binds on email-match', async () => {
    const user = await createUser('match')
    const memberId = await insertInvite(user.email)
    const client = await signInAs(user.email)

    const { data, error } = await client.rpc('accept_invite', {
      p_member_id: memberId,
      p_business_id: businessId,
    })
    expect(error).toBeNull()
    expect(data.status).toBe('active')
    expect(data.user_id).toBe(user.id)
  })

  it('rejects on email-mismatch', async () => {
    const mismatchedUser = await createUser('mismatch')
    const memberId = await insertInvite('someone-else@integration.test')
    const client = await signInAs(mismatchedUser.email)

    const { error } = await client.rpc('accept_invite', {
      p_member_id: memberId,
      p_business_id: businessId,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invite not available/)
  })

  it('rejects an invite older than 7 days (DB-side expiry) even with a valid token', async () => {
    const user = await createUser('expired')
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const memberId = await insertInvite(user.email, eightDaysAgo)
    const client = await signInAs(user.email)

    const { error } = await client.rpc('accept_invite', {
      p_member_id: memberId,
      p_business_id: businessId,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invite not available/)
  })

  it('double-membership pre-check raises a clean error, not a raw 23505', async () => {
    // Two DIFFERENT emails (the uniq_email partial index would otherwise block
    // a second invited/active row sharing one email): row1 is already-active
    // for this user under an unrelated email string; row2 is a pending invite
    // whose email matches the user's real auth email, so email-match alone
    // would pass — the double-membership EXISTS check must fire first.
    const user = await createUser('doublemember')

    const { error: activeErr } = await admin.from('business_members').insert({
      business_id: businessId,
      user_id: user.id,
      email: 'already-active-alias@integration.test',
      role: 'editor',
      status: 'active',
    })
    expect(activeErr).toBeNull()

    const pendingMemberId = await insertInvite(user.email)
    const client = await signInAs(user.email)

    const { error } = await client.rpc('accept_invite', {
      p_member_id: pendingMemberId,
      p_business_id: businessId,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/already an active member/)
  })

  it('is idempotent: a second accept by the same user on the same row returns the row unchanged', async () => {
    const user = await createUser('idempotent')
    const memberId = await insertInvite(user.email)
    const client = await signInAs(user.email)

    const first = await client.rpc('accept_invite', {
      p_member_id: memberId,
      p_business_id: businessId,
    })
    expect(first.error).toBeNull()

    const second = await client.rpc('accept_invite', {
      p_member_id: memberId,
      p_business_id: businessId,
    })
    expect(second.error).toBeNull()
    expect(second.data.id).toBe(memberId)
    expect(second.data.status).toBe('active')
    expect(second.data.user_id).toBe(user.id)
  })

  // D4 — third-party replay: once user A has bound a row, user B (any other
  // account, including one whose email doesn't match) calling accept_invite
  // on that same row must get the same generic error as any other rejection,
  // and A's row must be provably unchanged.
  it('third-party replay: a different user calling accept_invite on an already-bound row is rejected generically, A unchanged', async () => {
    const userA = await createUser('replay-a')
    const memberId = await insertInvite(userA.email)
    const clientA = await signInAs(userA.email)

    const boundResult = await clientA.rpc('accept_invite', {
      p_member_id: memberId,
      p_business_id: businessId,
    })
    expect(boundResult.error).toBeNull()
    expect(boundResult.data.status).toBe('active')
    expect(boundResult.data.user_id).toBe(userA.id)

    const userB = await createUser('replay-b')
    const clientB = await signInAs(userB.email)

    const { error } = await clientB.rpc('accept_invite', {
      p_member_id: memberId,
      p_business_id: businessId,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invite not available/)

    const { data: rowAfter, error: readErr } = await admin
      .from('business_members')
      .select('*')
      .eq('id', memberId)
      .single()
    expect(readErr).toBeNull()
    expect(rowAfter.user_id).toBe(userA.id)
    expect(rowAfter.status).toBe('active')
  })

  it('revoke frees the seat (drops out of countSeatUsage) and re-invite of the revoked email is allowed', async () => {
    const before = await countSeatUsage(admin, businessId)
    const email = `revoke-reinvite-${Date.now()}@integration.test`
    const memberId = await insertInvite(email)

    const afterInvite = await countSeatUsage(admin, businessId)
    expect(afterInvite.pendingCount).toBe(before.pendingCount + 1)

    const { error: revokeErr } = await admin
      .from('business_members')
      .update({ status: 'revoked' })
      .eq('id', memberId)
    expect(revokeErr).toBeNull()

    const afterRevoke = await countSeatUsage(admin, businessId)
    expect(afterRevoke.pendingCount).toBe(before.pendingCount)

    // Re-invite of the same (now-revoked) email is allowed — partial unique
    // indexes exclude status='revoked' (SEAT-REVOKE-FREES-SEAT).
    const { error: reinviteErr } = await admin
      .from('business_members')
      .insert({ business_id: businessId, email, role: 'viewer', status: 'invited' })
    expect(reinviteErr).toBeNull()
  })
})
