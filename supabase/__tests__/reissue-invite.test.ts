import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { addDays, formatISO, subDays } from 'date-fns'
import { reissueInvite, acceptInvite } from '@/lib/db/business-members'

// Gates on a live Supabase instance, like the other supabase/__tests__ integration suites.
const INTEGRATION = process.env.REISSUE_INVITE_INTEGRATION_TEST_ENABLED === 'true'

const PASSWORD = 'TestPass123!'

describe.skipIf(!INTEGRATION)('reissueInvite (ADR 0014 §4.4, INV-REISSUE-SAME-ROW)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let businessId: string
  let ownerId: string
  const userIds: string[] = []

  async function createUser(label: string) {
    const email = `reissue-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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
    const { createClient } = await import('@supabase/supabase-js')
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

  async function insertInvite(email: string, invitedAt: string) {
    const { data, error } = await admin
      .from('business_members')
      .insert({ business_id: businessId, email, role: 'editor', status: 'invited', invited_at: invitedAt })
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
      .insert({ name: 'Reissue Invite Business', owner_id: ownerId, plan: 'plus' })
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

  it('updates the SAME row (same id), refreshes invited_at, and inserts no new row', async () => {
    const invitee = await createUser('same-row')
    const staleInvitedAt = formatISO(subDays(new Date(), 8)) // already past the 7-day window
    const memberId = await insertInvite(invitee.email, staleInvitedAt)

    const { count: beforeCount } = await admin
      .from('business_members')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('email', invitee.email)
    expect(beforeCount).toBe(1)

    const reissued = await reissueInvite(admin, memberId)

    expect(reissued.id).toBe(memberId)
    expect(new Date(reissued.invited_at).getTime()).toBeGreaterThan(new Date(staleInvitedAt).getTime())

    const { count: afterCount } = await admin
      .from('business_members')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('email', invitee.email)
    expect(afterCount).toBe(1) // no new row — same reserved row, no double-counted seat
  })

  it('a resend actually un-expires the invite: accept_invite fails before reissue, succeeds after', async () => {
    const invitee = await createUser('unexpire')
    const staleInvitedAt = formatISO(subDays(new Date(), 8))
    const memberId = await insertInvite(invitee.email, staleInvitedAt)

    const client = await signInAs(invitee.email)

    // Before reissue: the RPC's own DB-side expiry guard (invited_at > now()-7d) rejects it.
    await expect(acceptInvite(client, memberId, businessId)).rejects.toThrow('invite not available')

    // Resend refreshes invited_at on the same row.
    await reissueInvite(admin, memberId)

    // After reissue: the same row now accepts.
    const result = await acceptInvite(client, memberId, businessId)
    expect(result.outcome).toBe('accepted')
  })

  it('does not affect the (business_id, lower(email)) partial unique index — a second invite to the same email still conflicts while one is pending', async () => {
    const invitee = await createUser('index-guard')
    const invitedAt = formatISO(addDays(new Date(), -1))
    const memberId = await insertInvite(invitee.email, invitedAt)

    await reissueInvite(admin, memberId)

    const { error } = await admin
      .from('business_members')
      .insert({ business_id: businessId, email: invitee.email, role: 'viewer', status: 'invited' })
    expect(error).not.toBeNull() // unique index still enforced — reissue never created a duplicate row
  })
})
