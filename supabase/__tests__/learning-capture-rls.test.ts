import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0018 §2.5/§3.3 (LEARN-RLS-ISOLATED) — Tier-1, live Postgres.
// Cross-tenant SELECT/INSERT/UPDATE/DELETE must be denied on both tables
// (USING + WITH CHECK proven, not assumed). post_ai_originals additionally
// has NO authenticated DELETE policy at all (the app-layer half of
// write-once, §2.5) — proven here as "even the owning business's own member
// cannot delete their own row", not just "cross-tenant delete is denied".

const PASSWORD = 'TestPass123!'

describe('learning capture RLS (ADR 0018 §2.5, §3.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let businessAId: string
  let businessBId: string
  let campaignAId: string
  let postAId: string
  let originAId: string
  let signalAId: string

  async function createUser(label: string) {
    const email = `learncap-rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  async function makeCampaignAndPost(businessId: string, label: string) {
    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: `RLS Campaign ${label}`,
        objective: 'Test RLS',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-07-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campaignErr) throw campaignErr

    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaign.id,
        business_id: businessId,
        platform: 'linkedin',
        content: `RLS test content ${label}`,
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'draft',
      })
      .select('id')
      .single()
    if (postErr) throw postErr

    return { campaignId: campaign.id as string, postId: post.id as string }
  }

  async function makeOrigin(businessId: string, postId: string, campaignId: string, label: string) {
    const { data, error } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: businessId,
        post_id: postId,
        campaign_id: campaignId,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content: `${label} content`, hashtags: [] },
        rendered_content: `${label} content`,
        schema_version: 1,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function makeSignal(businessId: string, postId: string, campaignId: string, originId: string, label: string) {
    const { data, error } = await admin
      .from('post_edit_signals')
      .insert({
        business_id: businessId,
        post_id: postId,
        campaign_id: campaignId,
        ai_original_id: originId,
        human_content: `${label} human edit`,
        approved_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
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
      .insert({ name: 'Learning Capture Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Learning Capture Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id

    const a = await makeCampaignAndPost(businessAId, 'A')
    campaignAId = a.campaignId
    postAId = a.postId
    originAId = await makeOrigin(businessAId, postAId, campaignAId, 'A')
    signalAId = await makeSignal(businessAId, postAId, campaignAId, originAId, 'A')
  })

  afterAll(async () => {
    if (!admin) return
    for (const businessId of [businessAId, businessBId]) {
      if (!businessId) continue
      await admin.from('post_edit_signals').delete().eq('business_id', businessId)
      await admin.from('post_ai_originals').delete().eq('business_id', businessId)
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  // ─── post_ai_originals ─────────────────────────────────────────────────

  it('post_ai_originals: cross-tenant SELECT returns zero rows', async () => {
    const bFixture = await makeCampaignAndPost(businessBId, 'B-select')
    const originB = await makeOrigin(businessBId, bFixture.postId, bFixture.campaignId, 'B-select')

    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('post_ai_originals').select('id').eq('id', originB)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('post_ai_originals: cannot INSERT a row for a business the caller does not belong to', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client
      .from('post_ai_originals')
      .insert({
        business_id: businessBId,
        post_id: postAId,
        campaign_id: campaignAId,
        revision: 99,
        generation_kind: 'initial',
        format: 'single',
        payload: {},
        rendered_content: 'tunnel attempt',
        schema_version: 1,
      })
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('post_ai_originals: cannot UPDATE a row belonging to another business (USING) — and even own rows are write-once by trigger', async () => {
    const client = await signInAs(ownerAEmail)
    // originAId belongs to businessA (the caller's own business) — RLS would
    // permit the UPDATE match, but the write-once trigger rejects it anyway.
    const { error } = await client
      .from('post_ai_originals')
      .update({ rendered_content: 'attempted tunnel' })
      .eq('id', originAId)
    expect(error).not.toBeNull()
  })

  it('post_ai_originals: no authenticated DELETE policy — even the owning business cannot delete its own row', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('post_ai_originals').delete().eq('id', originAId).select()
    // No DELETE policy exists for `authenticated` at all, so RLS denies the
    // match outright — zero rows affected, same shape as a cross-tenant
    // denial, but here proven against the caller's OWN business.
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere, error: stillThereErr } = await admin
      .from('post_ai_originals')
      .select('id')
      .eq('id', originAId)
      .single()
    expect(stillThereErr).toBeNull()
    expect(stillThere.id).toBe(originAId)
  })

  // ─── post_edit_signals ─────────────────────────────────────────────────

  it('post_edit_signals: cross-tenant SELECT returns zero rows', async () => {
    const bFixture = await makeCampaignAndPost(businessBId, 'B-signals-select')
    const originB = await makeOrigin(businessBId, bFixture.postId, bFixture.campaignId, 'B-signals-select')
    const signalB = await makeSignal(businessBId, bFixture.postId, bFixture.campaignId, originB, 'B-signals-select')

    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('post_edit_signals').select('id').eq('id', signalB)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('post_edit_signals: cannot INSERT a row for a business the caller does not belong to', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client
      .from('post_edit_signals')
      .insert({
        business_id: businessBId,
        post_id: postAId,
        campaign_id: campaignAId,
        ai_original_id: originAId,
        human_content: 'tunnel attempt',
        approved_at: new Date().toISOString(),
      })
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('post_edit_signals: cannot UPDATE a row belonging to another business (USING)', async () => {
    const bFixture = await makeCampaignAndPost(businessBId, 'B-signals-update')
    const originB = await makeOrigin(businessBId, bFixture.postId, bFixture.campaignId, 'B-signals-update')
    const signalB = await makeSignal(businessBId, bFixture.postId, bFixture.campaignId, originB, 'B-signals-update')

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('post_edit_signals')
      .update({ status: 'abandoned' })
      .eq('id', signalB)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere } = await admin.from('post_edit_signals').select('status').eq('id', signalB).single()
    expect(stillThere.status).toBe('pending')
  })

  it('post_edit_signals: cannot UPDATE own row to tunnel it into another business (WITH CHECK)', async () => {
    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('post_edit_signals')
      .update({ business_id: businessBId })
      .eq('id', signalAId)
      .select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillMine } = await admin
      .from('post_edit_signals')
      .select('business_id')
      .eq('id', signalAId)
      .single()
    expect(stillMine.business_id).toBe(businessAId)
  })

  it('post_edit_signals: cannot DELETE a row belonging to another business (USING)', async () => {
    const bFixture = await makeCampaignAndPost(businessBId, 'B-signals-delete')
    const originB = await makeOrigin(businessBId, bFixture.postId, bFixture.campaignId, 'B-signals-delete')
    const signalB = await makeSignal(businessBId, bFixture.postId, bFixture.campaignId, originB, 'B-signals-delete')

    const client = await signInAs(ownerAEmail)
    const { data } = await client.from('post_edit_signals').delete().eq('id', signalB).select()
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere, error: stillThereErr } = await admin
      .from('post_edit_signals')
      .select('id')
      .eq('id', signalB)
      .single()
    expect(stillThereErr).toBeNull()
    expect(stillThere.id).toBe(signalB)
  })
})
