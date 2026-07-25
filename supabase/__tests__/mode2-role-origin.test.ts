import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0017 §3.1/§3.2/§11/§12 — MODE2-ORIGIN-ROLE-BACKFILL, MODE2-ROLE-WRITE-ONCE
// (Tier-1, live Postgres). campaigns.origin is required + CHECK-enumerated;
// posts.role is nullable + CHECK-enumerated + write-once via DB trigger;
// campaigns.status accepts the new 'awaiting_brief' value.

describe('origin/role/awaiting_brief CHECK + backfill + write-once (ADR 0017 §3.1, §3.2, §11)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignId: string

  async function insertCampaign(overrides: Record<string, unknown> = {}) {
    return admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Mode 2 Origin/Role Test Campaign',
        objective: 'Drive signups',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 3,
        start_date: '2026-08-01',
        origin: 'objective_generated',
        ...overrides,
      })
      .select('id, origin, status')
      .single()
  }

  async function insertPost(overrides: Record<string, unknown> = {}) {
    return admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'Test post content',
        scheduled_at: '2026-08-02T09:00:00Z',
        ...overrides,
      })
      .select('id, role')
      .single()
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: `mode2-origin-role-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (authErr) throw authErr
    ownerId = authUser.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Mode2 Origin/Role Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await insertCampaign()
    if (campaignErr) throw campaignErr
    campaignId = campaign.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('posts').delete().eq('business_id', businessId)
    await admin.from('campaigns').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  // ─── campaigns.origin ─────────────────────────────────────────────────────

  it('backfilled the campaign created in beforeAll to objective_generated', async () => {
    const { data } = await admin.from('campaigns').select('origin').eq('id', campaignId).single()
    expect(data.origin).toBe('objective_generated')
  })

  it('rejects an INSERT missing origin (no default after backfill, [db-MAJOR-3])', async () => {
    const { error } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Missing Origin',
        objective: 'X',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 3,
        start_date: '2026-08-01',
      })
    expect(error).not.toBeNull()
  })

  it('rejects an invalid origin value (CHECK)', async () => {
    const { error } = await insertCampaign({ origin: 'not_a_real_origin' })
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/campaigns_origin_check/)
  })

  it.each(['manual', 'objective_generated', 'signal_generated'])(
    'accepts origin=%s',
    async (origin) => {
      const { data, error } = await insertCampaign({ origin })
      expect(error).toBeNull()
      expect(data.origin).toBe(origin)
      await admin.from('campaigns').delete().eq('id', data.id)
    },
  )

  // ─── campaigns.status += awaiting_brief ────────────────────────────────────

  it('accepts status=awaiting_brief', async () => {
    const { data, error } = await insertCampaign({ status: 'awaiting_brief' })
    expect(error).toBeNull()
    expect(data.status).toBe('awaiting_brief')
    await admin.from('campaigns').delete().eq('id', data.id)
  })

  it('rejects an invalid status value (CHECK still enforced after extension)', async () => {
    const { error } = await insertCampaign({ status: 'not_a_real_status' })
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/campaigns_status_check/)
  })

  // ─── posts.role ─────────────────────────────────────────────────────────

  it('defaults role to NULL (pre-Mode-2 backfill)', async () => {
    const { data, error } = await insertPost()
    expect(error).toBeNull()
    expect(data.role).toBeNull()
    await admin.from('posts').delete().eq('id', data.id)
  })

  it('rejects an invalid role value (CHECK)', async () => {
    const { error } = await insertPost({ role: 'not_a_real_role' })
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/posts_role_check/)
  })

  it.each([
    'anchor_thesis',
    'founder_perspective',
    'customer_proof',
    'objection_response',
    'conversation_starter',
    'follow_up',
  ])('accepts role=%s', async (role) => {
    const { data, error } = await insertPost({ role })
    expect(error).toBeNull()
    expect(data.role).toBe(role)
    await admin.from('posts').delete().eq('id', data.id)
  })

  it('write-once: allows the first NULL -> role transition', async () => {
    const { data: post, error: insertErr } = await insertPost()
    expect(insertErr).toBeNull()

    const { data, error } = await admin
      .from('posts')
      .update({ role: 'anchor_thesis' })
      .eq('id', post.id)
      .select('role')
      .single()
    expect(error).toBeNull()
    expect(data.role).toBe('anchor_thesis')

    await admin.from('posts').delete().eq('id', post.id)
  })

  it('write-once: rejects a role change once OLD.role IS NOT NULL', async () => {
    const { data: post, error: insertErr } = await insertPost({ role: 'anchor_thesis' })
    expect(insertErr).toBeNull()

    const { error } = await admin
      .from('posts')
      .update({ role: 'follow_up' })
      .eq('id', post.id)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/write-once/)

    const { data: stillOriginal } = await admin.from('posts').select('role').eq('id', post.id).single()
    expect(stillOriginal.role).toBe('anchor_thesis')

    await admin.from('posts').delete().eq('id', post.id)
  })

  it('write-once: re-setting the SAME role value is a no-op, not rejected', async () => {
    const { data: post, error: insertErr } = await insertPost({ role: 'customer_proof' })
    expect(insertErr).toBeNull()

    const { error } = await admin
      .from('posts')
      .update({ role: 'customer_proof', content: 'Updated content, same role' })
      .eq('id', post.id)
    expect(error).toBeNull()

    await admin.from('posts').delete().eq('id', post.id)
  })
})
