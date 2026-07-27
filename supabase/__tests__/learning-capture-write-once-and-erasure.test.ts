import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0018 §2.5 (LEARN-SNAPSHOT-WRITE-ONCE) + §8 (erasure) — Tier-1, live
// Postgres. Two properties this suite exists to prove:
//   1. post_ai_originals rejects ANY update (the write-once trigger).
//   2. Deleting a business that owns rows in BOTH new tables SUCCEEDS and
//      purges them — [db-BLOCKER-1]'s failure mode was erasure DENIAL (a
//      BEFORE DELETE guard would abort the cascade), so this asserts the
//      delete call itself returns no error, not merely that rows are absent
//      afterward (a rows-are-gone check inside an already-aborted
//      transaction would never be reached).

describe('learning capture — write-once trigger + erasure (ADR 0018 §2.5, §8)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignId: string
  let postId: string
  let originId: string

  async function createUser(label: string) {
    const email = `learncap-wo-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Write-Once Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Write-Once Campaign',
        objective: 'Test write-once + erasure',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-07-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campaignErr) throw campaignErr
    campaignId = campaign.id

    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'Original AI content',
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'draft',
      })
      .select('id')
      .single()
    if (postErr) throw postErr
    postId = post.id

    const { data: origin, error: originErr } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: businessId,
        post_id: postId,
        campaign_id: campaignId,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content: 'Original AI content', hashtags: [] },
        rendered_content: 'Original AI content',
        schema_version: 1,
      })
      .select('id')
      .single()
    if (originErr) throw originErr
    originId = origin.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('post_edit_signals').delete().eq('business_id', businessId)
      await admin.from('post_ai_originals').delete().eq('business_id', businessId)
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('LEARN-SNAPSHOT-WRITE-ONCE: any UPDATE on post_ai_originals is rejected', async () => {
    const { error } = await admin
      .from('post_ai_originals')
      .update({ rendered_content: 'tampered content' })
      .eq('id', originId)
    expect(error).not.toBeNull()
    expect(error.message).toContain('immutable')

    const { data: unchanged, error: readErr } = await admin
      .from('post_ai_originals')
      .select('rendered_content')
      .eq('id', originId)
      .single()
    expect(readErr).toBeNull()
    expect(unchanged.rendered_content).toBe('Original AI content')
  })

  it('erasure SUCCEEDS: deleting a business with rows in both tables completes without error and purges them', async () => {
    const owner = await createUser('erasure-owner')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Erasure Business', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: biz.id,
        name: 'Erasure Campaign',
        objective: 'Test erasure',
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
        business_id: biz.id,
        platform: 'linkedin',
        content: 'Erasure test content',
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'draft',
      })
      .select('id')
      .single()
    if (postErr) throw postErr

    const { data: origin, error: originErr } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: biz.id,
        post_id: post.id,
        campaign_id: campaign.id,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content: 'Erasure test content', hashtags: [] },
        rendered_content: 'Erasure test content',
        schema_version: 1,
      })
      .select('id')
      .single()
    if (originErr) throw originErr

    const { error: signalErr } = await admin.from('post_edit_signals').insert({
      business_id: biz.id,
      post_id: post.id,
      campaign_id: campaign.id,
      ai_original_id: origin.id,
      human_content: 'Human edited content',
      approved_at: new Date().toISOString(),
    })
    expect(signalErr).toBeNull()

    // The assertion that matters: the delete call itself must not error.
    // [db-BLOCKER-1]'s failure mode was the cascade being ABORTED (a BEFORE
    // DELETE guard raising inside purge_business's root DELETE), which would
    // surface here as deleteErr being non-null — a rows-are-gone check alone
    // would never be reached in that failure mode since the whole
    // transaction rolls back.
    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', biz.id)
    expect(deleteErr).toBeNull()

    const { data: originsAfter, error: originsAfterErr } = await admin
      .from('post_ai_originals')
      .select('id')
      .eq('business_id', biz.id)
    expect(originsAfterErr).toBeNull()
    expect(originsAfter ?? []).toHaveLength(0)

    const { data: signalsAfter, error: signalsAfterErr } = await admin
      .from('post_edit_signals')
      .select('id')
      .eq('business_id', biz.id)
    expect(signalsAfterErr).toBeNull()
    expect(signalsAfter ?? []).toHaveLength(0)

    await admin.auth.admin.deleteUser(owner.id)
  })
})
