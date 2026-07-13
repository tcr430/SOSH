import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getPlanCapabilities } from '@/lib/stripe/plan'
import type { Plan } from '@/lib/db/types'

const PASSWORD = 'TestPass123!'

// Experimental (2026-07-07): a rapid-fire burst of business_members INSERTs
// (each firing enforce_seat_cap + protect_primary_admin_membership triggers)
// immediately preceded a Postgres backend SIGSEGV in CI (see .wolf/buglog.json
// bug-115) on ghcr.io/supabase/postgres:17.6.1.111. No JS-level concurrency
// exists in this file already -- every insert is sequential -- so this delay
// is a request-rate experiment, not a fix for actual concurrency.
const HEAVY_LOOP_DELAY_MS = 50
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const ALL_PLANS: Plan[] = ['trial', 'plus', 'pro', 'agency']

describe('seat cap enforcement (ADR 0013 §6.6)', () => {
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

  it('rejects an INSERT that would exceed the plan cap (trial, max=10, auto-owner counts as 1 seat)', async () => {
    const businessId = await makeBusiness('trial')
    // The auto-provisioned owner (trg_ensure_owner_membership, 21A-D/MAJOR-1)
    // already consumes 1 seat, so only 9 more invites fit under max=10.
    for (let i = 0; i < 9; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
      await sleep(HEAVY_LOOP_DELAY_MS)
    }
    // The 10th invite (owner + 9 already used = 10 = cap) must be rejected.
    const { error } = await insertMember(businessId, 'invited')
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/seat cap reached/)
  })

  it('allows an INSERT up to cap (auto-owner + 9 invites = 10 = max)', async () => {
    const businessId = await makeBusiness('plus')
    for (let i = 0; i < 9; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
      await sleep(HEAVY_LOOP_DELAY_MS)
    }
  })

  it('unlimited plan (pro) always allows inserts', async () => {
    const businessId = await makeBusiness('pro')
    for (let i = 0; i < 15; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
      await sleep(HEAVY_LOOP_DELAY_MS)
    }
  })

  it('overage lock: a Pro→Plus downgrade blocks further invites (SEAT-OVERAGE-LOCK)', async () => {
    const businessId = await makeBusiness('pro')
    // Auto-owner (1) + 12 seats while unlimited — all allowed.
    for (let i = 0; i < 12; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
      await sleep(HEAVY_LOOP_DELAY_MS)
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

  // E1 — every other test in this file drives the INSERT through the service-role
  // admin client, which bypasses RLS. This test proves the trigger also blocks
  // the real, authenticated-user request path: the business owner (auto-admin
  // via trg_ensure_owner_membership) signs in with the anon key and issues the
  // over-cap invite themselves, going through business_members_insert RLS
  // (requires manage_members) AND enforce_seat_cap together.
  it('a genuine authenticated admin member (signInAs, anon key) is rejected by the seat cap, not just the service-role path', async () => {
    const { data: owner, error: ownerErr } = await admin.auth.admin.createUser({
      email: `seatcap-e1-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`,
      password: PASSWORD,
      email_confirm: true,
    })
    if (ownerErr) throw ownerErr
    userIds.push(owner.user.id)

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Seat Cap Business (E1 authenticated admin)', owner_id: owner.user.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessIds.push(biz.id)
    const businessId = biz.id as string

    // Auto-owner (1, is_admin=true via trg_ensure_owner_membership) + 8 invited = 9.
    for (let i = 0; i < 8; i++) {
      const { error } = await insertMember(businessId, 'invited')
      expect(error).toBeNull()
      await sleep(HEAVY_LOOP_DELAY_MS)
    }

    const ownerClient = await signInAs(owner.user.email)

    // 9th invite (owner + 9 = 10 = cap) — issued by the real authenticated admin, must succeed.
    const invitee9 = await admin.auth.admin.createUser({
      email: `seatcap-e1-invitee9-${Date.now()}@integration.test`,
      password: PASSWORD,
      email_confirm: true,
    })
    userIds.push(invitee9.data.user.id)
    const ninth = await ownerClient
      .from('business_members')
      .insert({ business_id: businessId, email: invitee9.data.user.email, role: 'editor', status: 'invited' })
    expect(ninth.error).toBeNull()

    // 10th invite — same authenticated admin path, must be rejected by enforce_seat_cap.
    const invitee10 = await admin.auth.admin.createUser({
      email: `seatcap-e1-invitee10-${Date.now()}@integration.test`,
      password: PASSWORD,
      email_confirm: true,
    })
    userIds.push(invitee10.data.user.id)
    const tenth = await ownerClient
      .from('business_members')
      .insert({ business_id: businessId, email: invitee10.data.user.email, role: 'editor', status: 'invited' })
    expect(tenth.error).not.toBeNull()
    expect(tenth.error!.message).toMatch(/seat cap reached/)
  })
})
