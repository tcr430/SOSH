import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0024 §7.4/§7.5/§7.5a (Session 31, H2.9) — QUAL-PRO-DAILY-POST-CAP
// (Tier 1). The RPC mechanics themselves (guarded upsert, atomicity) are
// already proven generically against purpose='triage_cents' in
// signals3-triage-state.test.ts's QUAL-COST-CEILING-EXTENDED cases, and
// purpose isolation at cap=15 is already proven there too
// (QUAL-BUDGET-PURPOSE-ISOLATED). This file proves the three facts specific
// to the Pro daily post cap itself: the 15-post ceiling under concurrency,
// the UTC day boundary, and release-on-hard-fail — all under
// purpose='generation_posts'.
describe('ai_budget_daily — generation_posts (ADR 0024 §7.5a, H2.9, QUAL-PRO-DAILY-POST-CAP)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  const ownerIds: string[] = []
  const businessIds: string[] = []

  async function createUser(label: string) {
    const email = `ai-budget-gen-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    ownerIds.push(data.user.id as string)
    return data.user.id as string
  }

  async function insertBusiness(name: string) {
    const ownerId = await createUser(name.replace(/\s+/g, '-'))
    const { data, error } = await admin.from('businesses').insert({ name, owner_id: ownerId, plan: 'pro' }).select('id').single()
    if (error) throw error
    businessIds.push(data.id as string)
    return data.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()
  })

  afterAll(async () => {
    if (!admin) return
    for (const id of businessIds) {
      await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of ownerIds) {
      await admin.auth.admin.deleteUser(id)
    }
  })

  it('the 15-post/day ceiling is enforced under two concurrent reservations — exactly one wins once the cap is exhausted', async () => {
    const biz = await insertBusiness('Pro Cap Race Business')

    // Fill 14 of the 15 units first, so the concurrent pair below races over
    // the LAST unit — the sharpest form of the check-then-call race (ADR
    // §7.5's named failure mode).
    const filled = await admin.rpc('reserve_ai_budget', {
      p_business_id: biz, p_purpose: 'generation_posts', p_units: 14, p_cap: 15,
    })
    expect(filled.error).toBeNull()

    const [first, second] = await Promise.all([
      admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'generation_posts', p_units: 1, p_cap: 15 }),
      admin.rpc('reserve_ai_budget', { p_business_id: biz, p_purpose: 'generation_posts', p_units: 1, p_cap: 15 }),
    ])

    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    const wonCount = [first, second].filter((r) => (r.data ?? []).length === 1).length
    const deniedCount = [first, second].filter((r) => (r.data ?? []).length === 0).length
    expect(wonCount).toBe(1)
    expect(deniedCount).toBe(1)

    const { data: row } = await admin
      .from('ai_budget_daily')
      .select('reserved_units')
      .eq('business_id', biz)
      .eq('purpose', 'generation_posts')
      .single()
    expect(Number(row.reserved_units)).toBe(15)
  })

  it('the 16th reservation of the day is refused once the cap is exhausted — zero rows, not an error', async () => {
    const biz = await insertBusiness('Pro Cap Exhausted Business')

    for (let i = 0; i < 15; i++) {
      const { error } = await admin.rpc('reserve_ai_budget', {
        p_business_id: biz, p_purpose: 'generation_posts', p_units: 1, p_cap: 15,
      })
      expect(error).toBeNull()
    }

    const denied = await admin.rpc('reserve_ai_budget', {
      p_business_id: biz, p_purpose: 'generation_posts', p_units: 1, p_cap: 15,
    })
    expect(denied.error).toBeNull()
    expect(denied.data ?? []).toHaveLength(0)
  })

  it('a stale reservation dated YESTERDAY at the cap does not block TODAY — the RPC pins day server-side, not client-side', async () => {
    const biz = await insertBusiness('Pro Cap Day Boundary Business')

    // Directly insert yesterday's row, already at the cap — this can only
    // happen via a direct insert (never through the RPC, which always pins
    // `day` to today via `(now() AT TIME ZONE 'utc')::date`), so it
    // simulates "yesterday's ledger was full."
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { error: seedErr } = await admin
      .from('ai_budget_daily')
      .insert({ business_id: biz, purpose: 'generation_posts', day: yesterday, reserved_units: 15 })
    expect(seedErr).toBeNull()

    // Today's reservation must succeed — the RPC's own (now() AT TIME ZONE
    // 'utc')::date computation is a DIFFERENT row (UNIQUE (business_id,
    // purpose, day)), never yesterday's.
    const today = await admin.rpc('reserve_ai_budget', {
      p_business_id: biz, p_purpose: 'generation_posts', p_units: 1, p_cap: 15,
    })
    expect(today.error).toBeNull()
    expect(today.data ?? []).toHaveLength(1)

    const { data: rows } = await admin
      .from('ai_budget_daily')
      .select('day, reserved_units')
      .eq('business_id', biz)
      .eq('purpose', 'generation_posts')
      .order('day', { ascending: true })
    expect(rows).toHaveLength(2)
    expect(Number(rows[0].reserved_units)).toBe(15) // yesterday, untouched
    expect(Number(rows[1].reserved_units)).toBe(1) // today, independent
  })

  it('a hard-failed generation releases its unit through reconcile_ai_budget — settles 1 reserved down to 0 actual', async () => {
    const biz = await insertBusiness('Pro Cap Release Business')

    const reserved = await admin.rpc('reserve_ai_budget', {
      p_business_id: biz, p_purpose: 'generation_posts', p_units: 1, p_cap: 15,
    })
    expect(reserved.data?.[0]).toBeDefined()
    expect(Number(reserved.data[0].reserved_units)).toBe(1)

    const released = await admin.rpc('reconcile_ai_budget', {
      p_business_id: biz, p_purpose: 'generation_posts', p_reserved_units: 1, p_actual_units: 0,
    })
    expect(released.error).toBeNull()
    expect(Number(released.data[0].reserved_units)).toBe(0)

    // The full daily allowance is available again — proves the release is
    // real, not just a number written and ignored.
    const after = await admin.rpc('reserve_ai_budget', {
      p_business_id: biz, p_purpose: 'generation_posts', p_units: 15, p_cap: 15,
    })
    expect(after.error).toBeNull()
    expect(after.data ?? []).toHaveLength(1)
  })
})

// Session 31-D, D5 (MAJOR-5). 20260909110000_ai_budget_daily_rename.sql's
// `REVOKE ALL ... FROM public` did NOT reach the NAMED anon/authenticated
// grants Supabase's ALTER DEFAULT PRIVILEGES issues at CREATE FUNCTION time
// — a permission test that only proves the happy path (the describe block
// above) proves nothing about this. 20260912090000_ai_budget_rpc_revoke_
// named_roles.sql adds the missing named REVOKE; this suite is the
// compensating proof, mirroring vault-update-secret.test.ts's exact shape
// (anon-denied / authenticated-denied / service-role-granted-as-control).
describe('reserve_ai_budget / reconcile_ai_budget — EXECUTE denied to anon/authenticated (Session 31-D, D5, MAJOR-5)', () => {
  const PASSWORD = 'TestPass123!'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let userId: string
  let userEmail: string
  let businessId: string

  async function signInAsUser() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email: userEmail, password: PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    userEmail = `ai-budget-perm-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email: userEmail,
      password: PASSWORD,
      email_confirm: true,
    })
    if (userErr) throw userErr
    userId = user.user.id as string

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'D5 Permission Test Business', owner_id: userId, plan: 'pro' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id as string
  })

  afterAll(async () => {
    if (admin && businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (admin && userId) await admin.auth.admin.deleteUser(userId)
  })

  it('EXECUTE on reserve_ai_budget is denied to anon — the failure scenario the finding names', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('Supabase env vars required')
    const anon = createClient(url, anonKey)
    const { error, data } = await anon.rpc('reserve_ai_budget', {
      p_business_id: businessId, p_purpose: 'generation_posts', p_units: 15, p_cap: 15,
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    // Confirm the denial actually held — no row was written for this call.
    const { data: rows } = await admin.from('ai_budget_daily').select('reserved_units').eq('business_id', businessId)
    expect(rows ?? []).toHaveLength(0)
  })

  it('EXECUTE on reserve_ai_budget is denied to authenticated — a signed-in customer targeting ANOTHER tenant\'s business_id', async () => {
    const client = await signInAsUser()
    const { error, data } = await client.rpc('reserve_ai_budget', {
      p_business_id: businessId, p_purpose: 'generation_posts', p_units: 15, p_cap: 15,
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    const { data: rows } = await admin.from('ai_budget_daily').select('reserved_units').eq('business_id', businessId)
    expect(rows ?? []).toHaveLength(0)
  })

  it('EXECUTE on reconcile_ai_budget is denied to authenticated — a signed-in customer cannot zero another tenant\'s counter', async () => {
    const seeded = await admin.rpc('reserve_ai_budget', {
      p_business_id: businessId, p_purpose: 'generation_posts', p_units: 5, p_cap: 15,
    })
    expect(seeded.error).toBeNull()

    const client = await signInAsUser()
    const { error, data } = await client.rpc('reconcile_ai_budget', {
      p_business_id: businessId, p_purpose: 'generation_posts', p_reserved_units: 5, p_actual_units: 0,
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()

    // The reservation must be unchanged — the "competitor zeroes your
    // counter" scenario the finding describes did not happen.
    const { data: row } = await admin
      .from('ai_budget_daily')
      .select('reserved_units')
      .eq('business_id', businessId)
      .eq('purpose', 'generation_posts')
      .single()
    expect(Number(row.reserved_units)).toBe(5)
  })

  it('EXECUTE is granted to service_role on both RPCs (positive control for the three denials above)', async () => {
    const reserved = await admin.rpc('reserve_ai_budget', {
      p_business_id: businessId, p_purpose: 'generation_posts', p_units: 1, p_cap: 15,
    })
    expect(reserved.error).toBeNull()

    const reconciled = await admin.rpc('reconcile_ai_budget', {
      p_business_id: businessId, p_purpose: 'generation_posts', p_reserved_units: 1, p_actual_units: 0,
    })
    expect(reconciled.error).toBeNull()
  })
})
