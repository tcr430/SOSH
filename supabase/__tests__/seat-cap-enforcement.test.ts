import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPlanCapabilities } from '@/lib/stripe/plan'
import type { Plan } from '@/lib/db/types'

// Gates on a live Supabase instance, like the other supabase/__tests__ integration suites.
const INTEGRATION = process.env.SEAT_CAP_INTEGRATION_TEST_ENABLED === 'true'

const ALL_PLANS: Plan[] = ['trial', 'plus', 'pro', 'agency']

describe.skipIf(!INTEGRATION)('seat cap enforcement (ADR 0013 §6.6)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const businessIds: string[] = []
  const userIds: string[] = []

  async function makeBusiness(plan: Plan) {
    const { data: owner, error: ownerErr } = await admin.auth.admin.createUser({
      email: `seatcap-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (ownerErr) throw ownerErr
    userIds.push(owner.user.id)

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: `Seat Cap Business (${plan})`, owner_id: owner.user.id, plan })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessIds.push(biz.id)
    return biz.id as string
  }

  async function insertMember(businessId: string, status: 'active' | 'invited' = 'invited') {
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email: `seatcap-member-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userErr) throw userErr
    userIds.push(user.user.id)

    return admin.from('business_members').insert({
      business_id: businessId,
      user_id: status === 'active' ? user.user.id : null,
      email: user.user.email,
      role: 'editor',
      status,
    })
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

  it.each(ALL_PLANS)('plan_max_seats(%s) === getPlanCapabilities(%s).maxSeats (SEAT-CAP-SSOT-SYNC)', async (plan) => {
    const { data, error } = await admin.rpc('plan_max_seats', { p_plan: plan })
    expect(error).toBeNull()
    expect(data).toBe(getPlanCapabilities(plan).maxSeats)
  })

  it('rejects an INSERT that would exceed the plan cap (trial, max=10)', async () => {
    const businessId = await makeBusiness('trial')
    // Fill to cap (10 seat-consuming rows).
    for (let i = 0; i < 10; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
    }
    // 11th insert must be rejected.
    const { error } = await insertMember(businessId, 'invited')
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/seat cap reached/)
  })

  it('allows an INSERT below cap', async () => {
    const businessId = await makeBusiness('plus')
    for (let i = 0; i < 9; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
    }
  })

  it('unlimited plan (pro) always allows inserts', async () => {
    const businessId = await makeBusiness('pro')
    for (let i = 0; i < 15; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
    }
  })

  it('overage lock: a Pro→Plus downgrade blocks further invites (SEAT-OVERAGE-LOCK)', async () => {
    const businessId = await makeBusiness('pro')
    // 12 seats while unlimited — all allowed.
    for (let i = 0; i < 12; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
    }
    // Downgrade to plus (max=10); used(12) already exceeds max(10).
    const { error: downgradeErr } = await admin
      .from('businesses')
      .update({ plan: 'plus' })
      .eq('id', businessId)
    expect(downgradeErr).toBeNull()

    // Any further invite is rejected by the same cap trigger.
    const { error } = await insertMember(businessId, 'invited')
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/seat cap reached/)
  })
})
