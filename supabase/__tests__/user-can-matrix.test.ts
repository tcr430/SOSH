import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { MemberRole } from '@/lib/db/types'

// Gates on a live Supabase instance, like the other supabase/__tests__ integration suites.
// Reads process.env directly (not @/lib/config) so this file has no import-time env
// validation cost when skipped — matches lib/email/__integration__/round-trip.test.ts.
const INTEGRATION = process.env.USER_CAN_INTEGRATION_TEST_ENABLED === 'true'

const PASSWORD = 'TestPass123!'

// Experimental (2026-07-07): a Postgres backend SIGSEGV in CI (see
// .wolf/buglog.json bug-115) reproduced twice immediately after a rapid-fire
// burst of user_can() RPC calls from this file's it.each loop. No JS-level
// concurrency exists here -- every call is sequential -- so this delay is a
// request-rate experiment, not a fix for actual concurrency.
const HEAVY_LOOP_DELAY_MS = 50
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const CAPABILITIES = [
  'author',
  'reschedule',
  'approve',
  'connect_accounts',
  'manage_members',
  'manage_billing',
] as const

// ADR 0013 §4 / L-2 — the authoritative expected matrix.
function expectedFor(role: MemberRole, isAdmin: boolean): Record<(typeof CAPABILITIES)[number], boolean> {
  return {
    author: role === 'editor' || role === 'approver',
    reschedule: role === 'editor' || role === 'approver',
    approve: role === 'approver',
    connect_accounts: role === 'approver' || isAdmin,
    manage_members: isAdmin,
    manage_billing: isAdmin,
  }
}

describe.skipIf(!INTEGRATION)('user_can() — role×capability matrix (ADR 0013 §4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let businessId: string
  let ownerId: string
  let ownerEmail: string
  let nonMemberId: string
  let nonMemberEmail: string

  const combos: Array<{ role: MemberRole; isAdmin: boolean }> = [
    { role: 'viewer', isAdmin: false },
    { role: 'viewer', isAdmin: true },
    { role: 'editor', isAdmin: false },
    { role: 'editor', isAdmin: true },
    { role: 'approver', isAdmin: false },
    { role: 'approver', isAdmin: true },
  ]
  const members: Array<{ role: MemberRole; isAdmin: boolean; id: string; email: string }> = []

  async function createUser(label: string) {
    const email = `usercan-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id
    ownerEmail = owner.email

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'user_can Matrix Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    for (const combo of combos) {
      const user = await createUser(`${combo.role}-${combo.isAdmin ? 'admin' : 'noadmin'}`)
      const { error } = await admin.from('business_members').insert({
        business_id: businessId,
        user_id: user.id,
        email: user.email,
        role: combo.role,
        is_admin: combo.isAdmin,
        status: 'active',
      })
      if (error) throw error
      members.push({ ...combo, id: user.id, email: user.email })
    }

    const nonMember = await createUser('nonmember')
    nonMemberId = nonMember.id
    nonMemberEmail = nonMember.email
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('business_members').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    const ids = [ownerId, nonMemberId, ...members.map((m) => m.id)]
    for (const id of ids) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it.each(combos)('role=$role is_admin=$isAdmin resolves every capability per L-2', async ({ role, isAdmin }) => {
    const member = members.find((m) => m.role === role && m.isAdmin === isAdmin)
    if (!member) throw new Error('fixture member not found')
    const client = await signInAs(member.email)
    const expected = expectedFor(role, isAdmin)

    for (const capability of CAPABILITIES) {
      const { data, error } = await client.rpc('user_can', {
        p_business_id: businessId,
        p_capability: capability,
      })
      expect(error).toBeNull()
      expect(data).toBe(expected[capability])
      await sleep(HEAVY_LOOP_DELAY_MS)
    }
  })

  it('owner override resolves approver+admin for every capability, with no member row', async () => {
    const client = await signInAs(ownerEmail)
    for (const capability of CAPABILITIES) {
      const { data, error } = await client.rpc('user_can', {
        p_business_id: businessId,
        p_capability: capability,
      })
      expect(error).toBeNull()
      expect(data).toBe(true)
    }
  })

  it('non-member resolves false for every capability', async () => {
    const client = await signInAs(nonMemberEmail)
    for (const capability of CAPABILITIES) {
      const { data, error } = await client.rpc('user_can', {
        p_business_id: businessId,
        p_capability: capability,
      })
      expect(error).toBeNull()
      expect(data).toBe(false)
    }
  })

  it('unknown capability resolves false even for an approver+admin', async () => {
    const member = members.find((m) => m.role === 'approver' && m.isAdmin === true)
    if (!member) throw new Error('fixture member not found')
    const client = await signInAs(member.email)
    const { data, error } = await client.rpc('user_can', {
      p_business_id: businessId,
      p_capability: 'delete_account',
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  // F3 — 'transfer_ownership' is not a real capability (n1: no owner-transfer
  // feature exists, §0/§4); an approver+admin must not get a free pass on it.
  it("unknown capability 'transfer_ownership' resolves false even for an approver+admin", async () => {
    const member = members.find((m) => m.role === 'approver' && m.isAdmin === true)
    if (!member) throw new Error('fixture member not found')
    const client = await signInAs(member.email)
    const { data, error } = await client.rpc('user_can', {
      p_business_id: businessId,
      p_capability: 'transfer_ownership',
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('null auth (unauthenticated anon client) resolves false', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('Supabase env vars required')
    const anon = createClient(url, anonKey)
    const { data, error } = await anon.rpc('user_can', {
      p_business_id: businessId,
      p_capability: 'author',
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })
})
