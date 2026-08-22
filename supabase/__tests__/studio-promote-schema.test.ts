import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0022 §2.3, §3.1, §12.2 · ADR 0017 Amd B · ADR 0019 Amd A.1 — Studio
// "promote-to-campaign" schema (Session 29, F1b.1). Tier-1, live Postgres.
// PROMOTE-RLS-ISOLATED: the three new studio_drafts columns are governed by
// the SAME column-agnostic USING/WITH CHECK policies as the rest of the row
// (20260730100000_studio_drafts.sql:71-86) — proven both directions, per the
// Session 26-D MINOR-2 precedent (one direction is not isolation).
// PROMOTE-CASCADE-COMPLETE: deleting the business cascades studio_drafts rows
// carrying the new columns away, and the delete/erasure call itself succeeds
// (a BEFORE DELETE guard would abort it, not merely leave rows behind).
// Also covers: campaigns_origin_check accepts the widened 4-value set and
// still rejects a bogus value.

const PASSWORD = 'TestPass123!'

describe('studio_drafts promote columns — RLS isolation and cascade (ADR 0022 §2.3, §3.1, §12.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let ownerBEmail: string
  let businessAId: string
  let businessBId: string

  async function createUser(label: string) {
    const email = `promote-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

    const ownerA = await createUser('owner-a')
    ownerAId = ownerA.id
    ownerAEmail = ownerA.email
    const ownerB = await createUser('owner-b')
    ownerBId = ownerB.id
    ownerBEmail = ownerB.email

    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'Promote Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Promote Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('studio_drafts').delete().eq('business_id', businessAId)
    await admin.from('studio_drafts').delete().eq('business_id', businessBId)
    if (businessAId) await admin.from('businesses').delete().eq('id', businessAId)
    if (businessBId) await admin.from('businesses').delete().eq('id', businessBId)
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('PROMOTE-RLS-ISOLATED: cross-tenant SELECT of the promote columns returns zero rows (A -> B)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({
        business_id: businessBId,
        content: 'B-only content',
        promotion_claimed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data, error } = await client
      .from('studio_drafts')
      .select('id, promotion_claimed_at, promoted_campaign_id, accepted_revision')
      .eq('id', row.id)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('PROMOTE-RLS-ISOLATED, mirrored B -> A: cross-tenant SELECT of the promote columns returns zero rows with a real signed-in owner-B session against business A\'s row', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({
        business_id: businessAId,
        content: 'A-only content',
        promotion_claimed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerBEmail)
    const { data, error } = await client
      .from('studio_drafts')
      .select('id, promotion_claimed_at, promoted_campaign_id, accepted_revision')
      .eq('id', row.id)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('PROMOTE-RLS-ISOLATED: cannot UPDATE another business\'s promote columns (A -> B, USING)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessBId, content: 'original B content' })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('studio_drafts')
      .update({ promotion_claimed_at: new Date().toISOString() })
      .eq('id', row.id)
      .select()
    // RLS's USING clause makes the row invisible to the UPDATE match — zero rows affected.
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere } = await admin
      .from('studio_drafts')
      .select('promotion_claimed_at')
      .eq('id', row.id)
      .single()
    expect(stillThere.promotion_claimed_at).toBeNull()
  })

  it('PROMOTE-RLS-ISOLATED, mirrored B -> A: cannot UPDATE another business\'s promote columns (USING), a real signed-in owner-B session against business A\'s row', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessAId, content: 'original A content' })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerBEmail)
    const { data } = await client
      .from('studio_drafts')
      .update({ promotion_claimed_at: new Date().toISOString() })
      .eq('id', row.id)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere } = await admin
      .from('studio_drafts')
      .select('promotion_claimed_at')
      .eq('id', row.id)
      .single()
    expect(stillThere.promotion_claimed_at).toBeNull()
  })

  it('PROMOTE-CASCADE-COMPLETE: deleting the business succeeds and removes drafts carrying promote columns', async () => {
    const owner = await createUser('cascade-direct')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Promote Cascade Direct', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const { error: draftErr } = await admin.from('studio_drafts').insert({
      business_id: biz.id,
      content: 'about to be cascaded',
      promotion_claimed_at: new Date().toISOString(),
      accepted_revision: 'the accepted AI revision at promote time',
    })
    expect(draftErr).toBeNull()

    // The assertion that matters: the delete call itself must not error — a
    // BEFORE DELETE guard would abort the cascade and surface here.
    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', biz.id)
    expect(deleteErr).toBeNull()

    const { data: draftsAfter, error: draftsAfterErr } = await admin
      .from('studio_drafts')
      .select('id')
      .eq('business_id', biz.id)
    expect(draftsAfterErr).toBeNull()
    expect(draftsAfter ?? []).toHaveLength(0)

    await admin.auth.admin.deleteUser(owner.id)
  })

  it('PROMOTE-CASCADE-COMPLETE: purge_business on a business with a promote-columns draft completes without error and leaves none', async () => {
    const owner = await createUser('cascade-purge')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Promote Cascade Purge', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const { error: draftErr } = await admin.from('studio_drafts').insert({
      business_id: biz.id,
      content: 'about to be purged',
      promotion_claimed_at: new Date().toISOString(),
      accepted_revision: 'the accepted AI revision',
    })
    expect(draftErr).toBeNull()

    const { error: purgeErr } = await admin.rpc('purge_business', { p_business_id: biz.id })
    expect(purgeErr).toBeNull()

    const { data: draftsAfter, error: draftsAfterErr } = await admin
      .from('studio_drafts')
      .select('id')
      .eq('business_id', biz.id)
    expect(draftsAfterErr).toBeNull()
    expect(draftsAfter ?? []).toHaveLength(0)

    await admin.auth.admin.deleteUser(owner.id)
  })
})

// ADR 0017 Amd B, ADR 0022 §2.3 — campaigns_origin_check widens to a fourth
// value, 'studio_promoted'. Mirrors mode2-role-origin.test.ts's own coverage
// of the original three-value CHECK.
describe('campaigns.origin CHECK widened to include studio_promoted (ADR 0017 Amd B, ADR 0022 §2.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  async function insertCampaign(overrides: Record<string, unknown> = {}) {
    return admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Promote Origin Test Campaign',
        objective: 'Drive signups',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 3,
        start_date: '2026-08-01',
        origin: 'manual',
        ...overrides,
      })
      .select('id, origin')
      .single()
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: `promote-origin-${Date.now()}@integration.test`,
      password: PASSWORD,
      email_confirm: true,
    })
    if (authErr) throw authErr
    ownerId = authUser.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Promote Origin Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('campaigns').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it.each(['manual', 'objective_generated', 'signal_generated', 'studio_promoted'])(
    'accepts origin=%s',
    async (origin) => {
      const { data, error } = await insertCampaign({ origin })
      expect(error).toBeNull()
      expect(data.origin).toBe(origin)
      await admin.from('campaigns').delete().eq('id', data.id)
    },
  )

  it('rejects an invalid origin value (CHECK still enforced after widening)', async () => {
    const { error } = await insertCampaign({ origin: 'not_a_real_origin' })
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/campaigns_origin_check/)
  })
})
