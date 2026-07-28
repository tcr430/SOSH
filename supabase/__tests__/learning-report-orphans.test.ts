import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { findSnapshotOrphans } from '@/scripts/learning-report'

// [Session 25-D correction, MAJOR-3 fix (c)] Tier-1, live Postgres — proves
// findSnapshotOrphans (scripts/learning-report.ts) returns zero on a healthy
// fixture (post + its post_ai_originals snapshot) and non-zero on a seeded
// orphan (a post inserted with no post_ai_originals row at all — the exact
// shape a partially-failed createPosts call leaves behind, per
// docs/reviews/session-25-reviewer.md MAJOR-3). This gives the operator
// report a proven-correct query, not just a plausible-looking one.

describe('findSnapshotOrphans (ADR 0018 §11 correction, MAJOR-3 fix (c))', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignId: string

  async function createUser(label: string) {
    const email = `learnreport-orphan-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function createPost(content: string) {
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content,
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'draft',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function createOrigin(postId: string, content: string) {
    const { error } = await admin.from('post_ai_originals').insert({
      business_id: businessId,
      post_id: postId,
      campaign_id: campaignId,
      revision: 1,
      generation_kind: 'initial',
      format: 'single',
      payload: { content, hashtags: [] },
      rendered_content: content,
      schema_version: 1,
    })
    if (error) throw error
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Orphan Report Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Orphan Report Campaign',
        objective: 'Test snapshot-orphan detection',
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
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('post_ai_originals').delete().eq('business_id', businessId)
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('returns zero orphans on a healthy fixture (post + matching post_ai_originals snapshot)', async () => {
    const postId = await createPost('Healthy post with a snapshot')
    await createOrigin(postId, 'Healthy post with a snapshot')

    const { orphanIds } = await findSnapshotOrphans(admin, businessId)

    expect(orphanIds).not.toContain(postId)
  })

  it('returns the post id as an orphan when it has no post_ai_originals row at all — the MAJOR-3 shape', async () => {
    const orphanPostId = await createPost('Committed post whose snapshot write failed')
    // Deliberately no createOrigin() call — this is the exact state a
    // partially-failed createPosts leaves behind: the post row is committed,
    // deleted_at is NULL, and no post_ai_originals row will ever exist for it.

    const { orphanIds } = await findSnapshotOrphans(admin, businessId)

    expect(orphanIds).toContain(orphanPostId)
  })

  it('excludes a soft-deleted snapshot-less post (deleted_at IS NOT NULL is out of scope)', async () => {
    const deletedPostId = await createPost('Soft-deleted, snapshot-less post')
    const { error: softDeleteErr } = await admin
      .from('posts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', deletedPostId)
    if (softDeleteErr) throw softDeleteErr

    const { orphanIds } = await findSnapshotOrphans(admin, businessId)

    expect(orphanIds).not.toContain(deletedPostId)
  })
})
