import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createPostAiOriginal, listLatestPostAiOriginalsByPostIds, AI_ORIGINAL_SCHEMA_VERSION } from '@/lib/db/post-ai-originals'

// Session 29-D, D9 (MINOR-6) — PROMOTE-AI-ORIGINALS-PER-POST-BOUNDED. Tier-1,
// live Postgres: the regression this closes is specifically a DB-ordering
// property (which rows a LIMIT-capped, post_id-major ORDER BY keeps or
// drops) that a mocked client cannot exhibit — the old code's bug was
// invisible to any Tier-2 test that supplies its own already-correct mock
// data. Real Postgres, real >20-revision data, real DISTINCT ON RPC.

const PASSWORD = 'TestPass123!'

describe('listLatestPostAiOriginalsByPostIds — per-post bounded, not per-list capped (ADR 0022 §10, Session 29-D D9)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignId: string
  let authedClient: SupabaseClient

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `ai-originals-per-post-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    ownerId = data.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'AI Originals Per-Post Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'AI Originals Per-Post Campaign',
        objective: 'Test objective',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 3,
        start_date: '2026-08-01',
        origin: 'manual',
      })
      .select('id')
      .single()
    if (campErr) throw campErr
    campaignId = campaign.id

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    authedClient = createClient(url, anonKey)
    const { error: signInErr } = await authedClient.auth.signInWithPassword({ email, password: PASSWORD })
    if (signInErr) throw signInErr
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('post_ai_originals').delete().eq('business_id', businessId)
    await admin.from('posts').delete().eq('business_id', businessId)
    await admin.from('campaigns').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('returns EVERY requested post its own latest revision, even when one post alone carries more revisions than the old per-LIST cap', async () => {
    const { data: posts, error: postsErr } = await admin
      .from('posts')
      .insert([
        { campaign_id: campaignId, business_id: businessId, platform: 'linkedin', content: 'Post A', scheduled_at: '2026-09-01T09:00:00.000Z', status: 'draft' },
        { campaign_id: campaignId, business_id: businessId, platform: 'linkedin', content: 'Post B', scheduled_at: '2026-09-02T09:00:00.000Z', status: 'draft' },
      ])
      .select('id')
    if (postsErr) throw postsErr

    // Deterministic regardless of which post_id sorts first alphabetically:
    // give the FIRST-sorting post 41 revisions (one more than the old cap of
    // postIds.length * 20 = 2 * 20 = 40), and the SECOND-sorting post exactly
    // 1. Under the old post_id-major ORDER BY + LIMIT 40, the second post's
    // sole row would never be reached — it would render nothing, silently.
    const [heavyPostId, lightPostId] = [posts[0].id, posts[1].id].sort()

    for (let revision = 1; revision <= 41; revision++) {
      await createPostAiOriginal(admin, {
        business_id: businessId,
        post_id: heavyPostId,
        campaign_id: campaignId,
        revision,
        generation_kind: revision === 1 ? 'initial' : 'regeneration',
        format: 'single',
        payload: { format: 'single', body: `Heavy post revision ${revision}`, imageBrief: null, scriptBrief: null },
        rendered_content: `Heavy post revision ${revision}`,
        schema_version: AI_ORIGINAL_SCHEMA_VERSION,
      })
    }
    await createPostAiOriginal(admin, {
      business_id: businessId,
      post_id: lightPostId,
      campaign_id: campaignId,
      revision: 1,
      generation_kind: 'initial',
      format: 'single',
      payload: { format: 'single', body: 'Light post only revision', imageBrief: null, scriptBrief: null },
      rendered_content: 'Light post only revision',
      schema_version: AI_ORIGINAL_SCHEMA_VERSION,
    })

    const result = await listLatestPostAiOriginalsByPostIds(authedClient, [heavyPostId, lightPostId])

    expect(result.size).toBe(2)
    expect(result.get(heavyPostId)?.revision).toBe(41)
    expect(result.get(heavyPostId)?.rendered_content).toBe('Heavy post revision 41')
    // THE regression this closes: the light post must NOT have fallen off.
    expect(result.get(lightPostId)?.revision).toBe(1)
    expect(result.get(lightPostId)?.rendered_content).toBe('Light post only revision')
  })
})
