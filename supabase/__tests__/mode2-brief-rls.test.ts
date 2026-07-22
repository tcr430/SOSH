import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0017 §2.4/§2.5/§12 — MODE2-BRIEF-RLS-ISOLATED, MODE2-BRIEF-CASCADE-COMPLETE,
// MODE2-BRIEF-FROZEN-GUARD (Tier-1, live Postgres). Cross-tenant SELECT/INSERT/
// UPDATE/DELETE must be denied on campaign_briefs (USING + WITH CHECK proven, not
// assumed); business erasure must cascade brief rows; the frozen_at trigger must
// reject a content change once a brief is frozen.

const PASSWORD = 'TestPass123!'

describe('campaign_briefs RLS + cascade + frozen guard (ADR 0017 §2.4, §2.5, §12)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let businessAId: string
  let businessBId: string
  let campaignAId: string
  let campaignBId: string

  async function createUser(label: string) {
    const email = `mode2-brief-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  async function insertCampaign(businessId: string) {
    const { data, error } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Mode 2 Brief Test Campaign',
        objective: 'Drive signups',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 3,
        start_date: '2026-08-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  function briefPayload(businessId: string, campaignId: string) {
    return {
      business_id: businessId,
      campaign_id: campaignId,
      content: { narrative: 'test narrative' },
      status: 'draft',
    }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const ownerA = await createUser('owner-a')
    ownerAId = ownerA.id
    ownerAEmail = ownerA.email
    const ownerB = await createUser('owner-b')
    ownerBId = ownerB.id

    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'Mode2 Brief Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Mode2 Brief Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id

    campaignAId = await insertCampaign(businessAId)
    campaignBId = await insertCampaign(businessBId)
  })

  // campaign_briefs has UNIQUE(campaign_id) (§2.1) — each test reuses the
  // same two campaigns, so clear any brief left behind before the next test.
  afterEach(async () => {
    if (!admin) return
    await admin.from('campaign_briefs').delete().eq('campaign_id', campaignAId)
    await admin.from('campaign_briefs').delete().eq('campaign_id', campaignBId)
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('campaign_briefs').delete().eq('business_id', businessAId)
    await admin.from('campaign_briefs').delete().eq('business_id', businessBId)
    await admin.from('campaigns').delete().eq('id', campaignAId)
    await admin.from('campaigns').delete().eq('id', campaignBId)
    if (businessAId) await admin.from('businesses').delete().eq('id', businessAId)
    if (businessBId) await admin.from('businesses').delete().eq('id', businessBId)
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('has RLS enabled', async () => {
    const { Client } = await import('pg')
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    const pg = new Client({ connectionString: url })
    await pg.connect()
    try {
      const { rows } = await pg.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'campaign_briefs' AND relnamespace = 'public'::regnamespace`,
      )
      expect(rows[0]?.relrowsecurity).toBe(true)
    } finally {
      await pg.end()
    }
  })

  it('business_id = campaigns.business_id consistency on insert', async () => {
    const { data, error } = await admin
      .from('campaign_briefs')
      .insert(briefPayload(businessAId, campaignAId))
      .select('id, business_id')
      .single()
    expect(error).toBeNull()
    expect(data.business_id).toBe(businessAId)
    await admin.from('campaign_briefs').delete().eq('id', data.id)
  })

  it('cross-tenant SELECT returns zero rows', async () => {
    const { data: row, error: insertErr } = await admin
      .from('campaign_briefs')
      .insert(briefPayload(businessBId, campaignBId))
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('campaign_briefs').select('id').eq('id', row.id)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('cannot INSERT a brief for a business the caller does not belong to', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client
      .from('campaign_briefs')
      .insert(briefPayload(businessBId, campaignBId))
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('cannot UPDATE a brief belonging to another business (USING)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('campaign_briefs')
      .insert(briefPayload(businessBId, campaignBId))
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('campaign_briefs')
      .update({ status: 'critiqued' })
      .eq('id', row.id)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere } = await admin.from('campaign_briefs').select('status').eq('id', row.id).single()
    expect(stillThere.status).toBe('draft')
  })

  it('cannot UPDATE own brief to tunnel it into another business (WITH CHECK)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('campaign_briefs')
      .insert(briefPayload(businessAId, campaignAId))
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('campaign_briefs')
      .update({ business_id: businessBId })
      .eq('id', row.id)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillMine } = await admin.from('campaign_briefs').select('business_id').eq('id', row.id).single()
    expect(stillMine.business_id).toBe(businessAId)
  })

  it('cannot DELETE a brief belonging to another business (USING)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('campaign_briefs')
      .insert(briefPayload(businessBId, campaignBId))
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client.from('campaign_briefs').delete().eq('id', row.id).select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere, error: stillThereErr } = await admin
      .from('campaign_briefs')
      .select('id')
      .eq('id', row.id)
      .single()
    expect(stillThereErr).toBeNull()
    expect(stillThere.id).toBe(row.id)
  })

  it('frozen_at guard: rejects a content UPDATE once frozen', async () => {
    const { data: row, error: insertErr } = await admin
      .from('campaign_briefs')
      .insert(briefPayload(businessAId, campaignAId))
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const { error: freezeErr } = await admin
      .from('campaign_briefs')
      .update({ status: 'approved', frozen_at: new Date().toISOString() })
      .eq('id', row.id)
    expect(freezeErr).toBeNull()

    const { error: contentUpdateErr } = await admin
      .from('campaign_briefs')
      .update({ content: { narrative: 'mutated after freeze' } })
      .eq('id', row.id)
    expect(contentUpdateErr).not.toBeNull()
    expect(contentUpdateErr.message).toMatch(/frozen_at/)

    // Non-content updates remain allowed once frozen.
    const { error: statusUpdateErr } = await admin
      .from('campaign_briefs')
      .update({ status: 'generated' })
      .eq('id', row.id)
    expect(statusUpdateErr).toBeNull()
  })

  it('erasure: deleting a business cascades its campaign_briefs rows', async () => {
    const ownerC = await createUser('owner-c')
    const { data: bizC, error: bizCErr } = await admin
      .from('businesses')
      .insert({ name: 'Mode2 Brief Business C (erasure)', owner_id: ownerC.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizCErr) throw bizCErr

    const campaignCId = await insertCampaign(bizC.id)
    const { error: briefErr } = await admin.from('campaign_briefs').insert(briefPayload(bizC.id, campaignCId))
    expect(briefErr).toBeNull()

    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', bizC.id)
    expect(deleteErr).toBeNull()

    const { data, error } = await admin.from('campaign_briefs').select('id').eq('business_id', bizC.id)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)

    await admin.auth.admin.deleteUser(ownerC.id)
  })
})
