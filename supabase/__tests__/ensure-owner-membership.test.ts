import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createBusiness } from '@/lib/db/businesses'
import { countSeatUsage, listMembers } from '@/lib/db/business-members'

// Gates on a live Supabase instance, like the other supabase/__tests__ integration suites.
const INTEGRATION = process.env.ENSURE_OWNER_MEMBERSHIP_INTEGRATION_TEST_ENABLED === 'true'

const PASSWORD = 'TestPass123!'

// Experimental (2026-07-07): a rapid-fire burst of business_members INSERTs
// (each firing enforce_seat_cap + protect_primary_admin_membership triggers)
// immediately preceded a Postgres backend SIGSEGV in CI (see .wolf/buglog.json
// bug-115) on ghcr.io/supabase/postgres:17.6.1.111. No JS-level concurrency
// exists in this file already -- every insert is sequential -- so this delay
// is a request-rate experiment, not a fix for actual concurrency.
const HEAVY_LOOP_DELAY_MS = 50
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!INTEGRATION)('trg_ensure_owner_membership (ADR 0013 Rev B / 21A-D / MAJOR-1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const businessIds: string[] = []
  const userIds: string[] = []

  async function createUser(label: string) {
    const email = `ensureowner-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    userIds.push(data.user.id)
    return { id: data.user.id as string, email }
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

  it('createBusiness() (lib/db/businesses.ts) produces exactly one owner business_members row (approver+is_admin+active)', async () => {
    const owner = await createUser('via-createbusiness')
    const business = await createBusiness(admin, { name: 'Ensure Owner via createBusiness', owner_id: owner.id, plan: 'plus' })
    businessIds.push(business.id)

    const { data: rows, error } = await admin
      .from('business_members')
      .select('*')
      .eq('business_id', business.id)
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(owner.id)
    expect(rows[0].role).toBe('approver')
    expect(rows[0].is_admin).toBe(true)
    expect(rows[0].status).toBe('active')
  })

  it('a raw insert into businesses produces the same owner row (proves the DB trigger, not app code, is the mechanism)', async () => {
    const owner = await createUser('via-raw-insert')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Ensure Owner via raw insert', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessIds.push(biz.id)

    const { data: rows, error } = await admin
      .from('business_members')
      .select('*')
      .eq('business_id', biz.id)
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(owner.id)
    expect(rows[0].role).toBe('approver')
    expect(rows[0].is_admin).toBe(true)
    expect(rows[0].status).toBe('active')
  })

  it('countSeatUsage reports exactly 1 active seat right after business creation', async () => {
    const owner = await createUser('seat-count')
    const business = await createBusiness(admin, { name: 'Ensure Owner seat count', owner_id: owner.id, plan: 'plus' })
    businessIds.push(business.id)

    const result = await countSeatUsage(admin, business.id)
    expect(result).toEqual({ activeCount: 1, pendingCount: 0 })
  })

  it('listMembers includes the owner right after business creation', async () => {
    const owner = await createUser('list-members')
    const business = await createBusiness(admin, { name: 'Ensure Owner list members', owner_id: owner.id, plan: 'plus' })
    businessIds.push(business.id)

    const members = await listMembers(admin, business.id)
    expect(members).toHaveLength(1)
    expect(members[0].user_id).toBe(owner.id)
  })

  it('is idempotent: a manual M7-style re-insert against the trigger-created row hits the partial unique index, not a duplicate (23505)', async () => {
    const owner = await createUser('idempotent')
    const business = await createBusiness(admin, { name: 'Ensure Owner idempotent', owner_id: owner.id, plan: 'plus' })
    businessIds.push(business.id)

    const { error } = await admin.from('business_members').insert({
      business_id: business.id,
      user_id: owner.id,
      email: owner.email.toLowerCase(),
      role: 'approver',
      is_admin: true,
      status: 'active',
    })
    expect(error).not.toBeNull()
    expect(error.code).toBe('23505')

    const { data: rows } = await admin.from('business_members').select('id').eq('business_id', business.id)
    expect(rows).toHaveLength(1)
  })

  it('the auto-provisioned owner counts toward the seat cap: plus plan (max=10) — owner + 9 invites = at cap, the 10th invite rejected', async () => {
    const owner = await createUser('seat-cap-owner')
    const business = await createBusiness(admin, { name: 'Ensure Owner seat cap', owner_id: owner.id, plan: 'plus' })
    businessIds.push(business.id)

    for (let i = 0; i < 9; i++) {
      const invitee = await createUser(`seat-cap-invite-${i}`)
      const { error } = await admin.from('business_members').insert({
        business_id: business.id,
        email: invitee.email,
        role: 'editor',
        status: 'invited',
      })
      expect(error).toBeNull()
      await sleep(HEAVY_LOOP_DELAY_MS)
    }

    const atCap = await countSeatUsage(admin, business.id)
    expect(atCap.activeCount + atCap.pendingCount).toBe(10)

    const tenthInvitee = await createUser('seat-cap-invite-9')
    const { error } = await admin.from('business_members').insert({
      business_id: business.id,
      email: tenthInvitee.email,
      role: 'editor',
      status: 'invited',
    })
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/seat cap reached/)
  })
})
