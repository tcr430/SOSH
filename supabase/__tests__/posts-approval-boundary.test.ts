import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
// Session 22-E (review finding NEW-2): the bulk case below calls the REAL
// function rather than re-typing its WHERE clause inline. A hand-rolled mirror
// of the query proves only that Postgres honours a predicate — it stays green
// if someone deletes a filter from bulkApproveDraftPosts itself, which is the
// mutation this suite exists to catch.
import { bulkApproveDraftPosts } from '@/lib/db/posts'

const PASSWORD = 'TestPass123!'

describe('posts approval boundary — DB-enforced (ADR 0013 §5)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let businessId: string
  let campaignId: string
  let ownerId: string
  let viewerId: string
  let editorId: string
  let approverId: string
  let viewerEmail: string
  let editorEmail: string
  let approverEmail: string

  async function createUser(label: string) {
    const email = `postsapproval-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

  // Seeds a post row directly via service-role (bypasses RLS) at a given status,
  // so each test starts from a known fixture state independent of the boundary
  // under test.
  async function createPost(status: 'draft' | 'approved') {
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'Approval boundary test post',
        scheduled_at: '2026-07-15T12:00:00Z',
        status,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Approval Boundary Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Approval Boundary Campaign',
        objective: 'Test approval boundary',
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

    const viewer = await createUser('viewer')
    viewerId = viewer.id
    viewerEmail = viewer.email
    const editor = await createUser('editor')
    editorId = editor.id
    editorEmail = editor.email
    const approver = await createUser('approver')
    approverId = approver.id
    approverEmail = approver.email

    const roles: Array<{ id: string; email: string; role: string }> = [
      { id: viewerId, email: viewerEmail, role: 'viewer' },
      { id: editorId, email: editorEmail, role: 'editor' },
      { id: approverId, email: approverEmail, role: 'approver' },
    ]
    for (const r of roles) {
      const { error } = await admin.from('business_members').insert({
        business_id: businessId,
        user_id: r.id,
        email: r.email,
        role: r.role,
        status: 'active',
      })
      if (error) throw error
    }
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('business_members').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    for (const id of [ownerId, viewerId, editorId, approverId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('viewer: any posts UPDATE is denied', async () => {
    const postId = await createPost('draft')
    const client = await signInAs(viewerEmail)
    const { data, error } = await client
      .from('posts')
      .update({ content: 'viewer edit attempt' })
      .eq('id', postId)
      .select()
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0) // RLS USING excludes the row — zero rows affected
  })

  it('editor: edit/reschedule with status unchanged is allowed', async () => {
    const postId = await createPost('draft')
    const client = await signInAs(editorEmail)
    const { data, error } = await client
      .from('posts')
      .update({ content: 'editor edit' })
      .eq('id', postId)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].content).toBe('editor edit')
  })

  it('editor: approved->draft (unapprove) is allowed', async () => {
    const postId = await createPost('approved')
    const client = await signInAs(editorEmail)
    const { data, error } = await client
      .from('posts')
      .update({ status: 'draft' })
      .eq('id', postId)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('draft')
  })

  it('editor: approved->skipped (remove) is allowed', async () => {
    const postId = await createPost('approved')
    const client = await signInAs(editorEmail)
    const { data, error } = await client
      .from('posts')
      .update({ status: 'skipped' })
      .eq('id', postId)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('skipped')
  })

  it('editor: draft->approved (raw write) is DENIED by the trigger', async () => {
    const postId = await createPost('draft')
    const client = await signInAs(editorEmail)
    const { error } = await client
      .from('posts')
      .update({ status: 'approved' })
      .eq('id', postId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/approve capability required/)

    // Confirm the row was NOT mutated.
    const { data: check } = await admin.from('posts').select('status').eq('id', postId).single()
    expect(check.status).toBe('draft')
  })

  it('approver: draft->approved is allowed', async () => {
    const postId = await createPost('draft')
    const client = await signInAs(approverEmail)
    const { data, error } = await client
      .from('posts')
      .update({ status: 'approved' })
      .eq('id', postId)
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('approved')
  })

  it('service-role: approved->scheduled->published is allowed (auth.uid() NULL exempt)', async () => {
    const postId = await createPost('approved')

    const step1 = await admin.from('posts').update({ status: 'scheduled' }).eq('id', postId).select()
    expect(step1.error).toBeNull()
    expect(step1.data[0].status).toBe('scheduled')

    const step2 = await admin.from('posts').update({ status: 'published' }).eq('id', postId).select()
    expect(step2.error).toBeNull()
    expect(step2.data[0].status).toBe('published')
  })

  it('atomic guard: a stale draft->approved by an approver yields zero rows, not an exception (SEAT-ATOMIC-GUARD-INTACT)', async () => {
    // Post is already approved — a caller racing against a concurrent approval
    // uses the same .eq('status','draft') guard as approvePost() in lib/db/posts.ts.
    const postId = await createPost('approved')
    const client = await signInAs(approverEmail)
    const { data, error } = await client
      .from('posts')
      .update({ status: 'approved' })
      .eq('id', postId)
      .eq('status', 'draft') // atomic guard — row is NOT in 'draft', so this matches nothing
      .select()
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  // ADR 0014 Amendment A1 — bulk approve's platform predicate narrows the SAME
  // update statement, it does not open a new write path. These two tests prove
  // that at the real DB boundary, not just at the mock/unit layer.

  async function createPostOnPlatform(platform: 'linkedin' | 'twitter', status: 'draft' | 'approved') {
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform,
        content: 'Bulk approve boundary test post',
        scheduled_at: '2026-07-15T12:00:00Z',
        status,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  // Session 22-D (BLOCKER-1/2) — bulkApproveDraftPosts now issues
  // `.in('id', renderedIds).eq('campaign_id', ...).eq('business_id', ...)`
  // instead of a platform predicate. These tests exercise that exact shape
  // at the real DB boundary, not just at the mock/unit layer.

  it('APV-BULK-DB-BOUNDARY: an editor calling the predicate\'d (id-based) bulk-approve UPDATE directly is denied by the trigger; zero rows flip', async () => {
    const postId = await createPost('draft')
    const client = await signInAs(editorEmail)
    const { error } = await client
      .from('posts')
      .update({ status: 'approved' })
      .in('id', [postId])
      .eq('campaign_id', campaignId)
      .eq('business_id', businessId)
      .eq('status', 'draft')
      .is('deleted_at', null)
      .select()
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/approve capability required/)

    const { data: check } = await admin.from('posts').select('status').eq('id', postId).single()
    expect(check.status).toBe('draft')
    // Cleanup: keep the fixture set isolated from later tests in this file.
    await admin.from('posts').delete().eq('id', postId)
  })

  it('THE 21C M1 SCENARIO, now id-based: 3 linkedin + 2 twitter drafts, an id list of just the 2 twitter ids flips EXACTLY those 2', async () => {
    // NEW-10 (Session 22-F): earlier tests in this file leave undeleted draft
    // rows in the same campaign. The `.in('id', renderedIds)` predicate relies
    // on those leftovers to turn RED if deleted — but only incidentally, since
    // that depends on fixture order and vitest not shuffling. Capture them
    // explicitly and assert they're untouched, so the protection is intended
    // rather than emergent from other tests' hygiene.
    const { data: preExistingDrafts } = await admin
      .from('posts')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('status', 'draft')
    const preExistingDraftIds = (preExistingDrafts ?? []).map((r: { id: string }) => r.id)

    const linkedinIds = await Promise.all([
      createPostOnPlatform('linkedin', 'draft'),
      createPostOnPlatform('linkedin', 'draft'),
      createPostOnPlatform('linkedin', 'draft'),
    ])
    const twitterIds = await Promise.all([
      createPostOnPlatform('twitter', 'draft'),
      createPostOnPlatform('twitter', 'draft'),
    ])

    const client = await signInAs(approverEmail)
    const { data, error } = await client
      .from('posts')
      .update({ status: 'approved' })
      .in('id', twitterIds)
      .eq('campaign_id', campaignId)
      .eq('business_id', businessId)
      .eq('status', 'draft')
      .is('deleted_at', null)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(new Set(data!.map(r => r.id))).toEqual(new Set(twitterIds))

    const { data: linkedinRows } = await admin
      .from('posts')
      .select('status')
      .in('id', linkedinIds)
    expect(linkedinRows!.every((r: { status: string }) => r.status === 'draft')).toBe(true)

    if (preExistingDraftIds.length > 0) {
      const { data: preExistingCheck } = await admin
        .from('posts')
        .select('status')
        .in('id', preExistingDraftIds)
      expect(preExistingCheck!.every((r: { status: string }) => r.status === 'draft')).toBe(true)
    }

    await admin.from('posts').delete().in('id', [...linkedinIds, ...twitterIds])
  })

  it('BLOCKER-1/2: renderedIds spanning multiple campaigns/businesses cannot approve a row outside campaignId+businessId', async () => {
    const inScopeId = await createPostOnPlatform('linkedin', 'draft')

    // NEW-9 (Session 22-F): pin .eq('status','draft') and .is('deleted_at',
    // null) against the REAL function, not just the Tier-2 mock. Unlike
    // campaign_id/business_id (see the honest-scope note below), no FK
    // forbids either state, so each is independently achievable here:
    // alreadyApprovedId is in-scope but already approved; softDeletedId is
    // in-scope, draft, but soft-deleted. Neither should flip, and if either
    // guard predicate is removed from bulkApproveDraftPosts, `count` below
    // stops matching 1 (verified locally by temporarily deleting each
    // predicate and confirming this test goes RED, then restoring it).
    const alreadyApprovedId = await createPostOnPlatform('linkedin', 'approved')
    const softDeletedId = await createPostOnPlatform('linkedin', 'draft')
    const { error: softDeleteErr } = await admin
      .from('posts')
      .update({ deleted_at: '2026-07-15T00:00:00Z' })
      .eq('id', softDeletedId)
    if (softDeleteErr) throw softDeleteErr

    // A second business the approver is an ACTIVE APPROVER OF — deliberately,
    // and this is the whole point of the fixture (Session 22-E, NEW-3).
    //
    // The pre-22-E version made this business one the approver had no
    // membership in. That looked like a cross-tenant test but wasn't a useful
    // one: get_user_business_ids() = owned ∪ active memberships, so RLS
    // (posts_update_own) rejected the foreign row before the function's own
    // predicate was ever consulted. The test therefore passed identically with
    // bulkApproveDraftPosts' filters deleted — it pinned RLS, which is covered
    // by get-user-business-ids-matrix.test.ts, not the function under test.
    //
    // With membership, RLS permits BOTH rows and the function's own
    // campaign_id/business_id predicate is the only thing that narrows the
    // write. Honest scope note (corrected twice now — Session 22-F NEW-8,
    // Session 22-G NEW-14): campaign_id and business_id are
    // JOINTLY-but-not-individually load-bearing here — NOT "by the FK".
    // posts.campaign_id -> campaigns(id) and posts.business_id ->
    // businesses(id) are two INDEPENDENT ON DELETE CASCADE foreign keys;
    // there is no composite FK, CHECK, generated column, or trigger tying
    // posts.business_id to campaigns(campaign_id).business_id. business_id is
    // denormalised from the parent campaign, and lib/db/posts.ts being the
    // sole writer that keeps it consistent
    // (supabase/migrations/20260430120010_posts.sql:7-8) is an
    // APPLICATION-LEVEL CONVENTION, not a DB invariant — a service-role path
    // that bypasses lib/db/ could create the very same-campaign
    // cross-business row this comment says "cannot exist," at which point
    // both predicates would become independently provable. Given that
    // convention holds for this fixture, deleting campaign_id ALONE still
    // leaves this test green (business_id then excludes otherPost, since it
    // lives in otherBiz); deleting business_id ALONE also leaves it green
    // (campaign_id excludes otherPost, since it lives in otherCampaign). Only
    // their conjunction is provable by any fixture — neither predicate is
    // individually load-bearing, and the asymmetry is not real.
    //
    // NEW-11 (Session 22-F): otherBiz/otherCampaign/otherPost teardown runs in
    // a finally block so a failing assertion above can't strand this business
    // tree — businesses.owner_id is ON DELETE RESTRICT, so an orphaned
    // otherBiz blocks afterAll's deleteUser(ownerId) too.
    let otherBiz: { id: string } | null = null
    let otherCampaign: { id: string } | null = null
    let otherPost: { id: string } | null = null

    try {
      const { data: otherBizData, error: otherBizErr } = await admin
        .from('businesses')
        .insert({ name: 'Second Business (approver is an active member)', owner_id: ownerId, plan: 'plus' })
        .select('id')
        .single()
      if (otherBizErr) throw otherBizErr
      otherBiz = otherBizData
      const { error: otherMemberErr } = await admin.from('business_members').insert({
        business_id: otherBiz!.id,
        user_id: approverId,
        email: approverEmail,
        role: 'approver',
        status: 'active',
      })
      if (otherMemberErr) throw otherMemberErr
      const { data: otherCampaignData, error: otherCampaignErr } = await admin
        .from('campaigns')
        .insert({
          business_id: otherBiz!.id,
          name: 'Cross-Tenant Campaign',
          objective: 'Test cross-tenant isolation',
          platforms: ['linkedin'],
          frequency: 'weekly',
          posts_per_week: 1,
          start_date: '2026-07-01',
          origin: 'objective_generated',
        })
        .select('id')
        .single()
      if (otherCampaignErr) throw otherCampaignErr
      otherCampaign = otherCampaignData
      const { data: otherPostData, error: otherPostErr } = await admin
        .from('posts')
        .insert({
          campaign_id: otherCampaign!.id,
          business_id: otherBiz!.id,
          platform: 'linkedin',
          content: 'Cross-tenant draft',
          scheduled_at: '2026-07-15T12:00:00Z',
          status: 'draft',
        })
        .select('id')
        .single()
      if (otherPostErr) throw otherPostErr
      otherPost = otherPostData

      const client = await signInAs(approverEmail)

      // Sanity-check the premise: this approver CAN reach the other business's
      // draft under RLS. If this write were permitted, the exclusion below would
      // be the function's doing, not RLS's. (Rolled straight back.)
      const { data: rlsReach } = await client
        .from('posts')
        .update({ status: 'approved' })
        .eq('id', otherPost!.id)
        .select('id')
      expect(rlsReach).toHaveLength(1)
      await admin.from('posts').update({ status: 'draft' }).eq('id', otherPost!.id)

      const count = await bulkApproveDraftPosts(
        client,
        campaignId,
        [inScopeId, otherPost!.id, alreadyApprovedId, softDeletedId],
        businessId,
      )
      expect(count).toBe(1)

      const { data: inScopeCheck } = await admin.from('posts').select('status').eq('id', inScopeId).single()
      expect(inScopeCheck.status).toBe('approved')
      const { data: otherCheck } = await admin.from('posts').select('status').eq('id', otherPost!.id).single()
      expect(otherCheck.status).toBe('draft')
      const { data: approvedCheck } = await admin
        .from('posts')
        .select('status')
        .eq('id', alreadyApprovedId)
        .single()
      expect(approvedCheck.status).toBe('approved')
      const { data: deletedCheck } = await admin
        .from('posts')
        .select('status, deleted_at')
        .eq('id', softDeletedId)
        .single()
      expect(deletedCheck.status).toBe('draft')
      expect(deletedCheck.deleted_at).not.toBeNull()
    } finally {
      if (otherPost) await admin.from('posts').delete().eq('id', otherPost!.id)
      if (otherCampaign) await admin.from('campaigns').delete().eq('id', otherCampaign.id)
      if (otherBiz) {
        await admin.from('business_members').delete().eq('business_id', otherBiz.id)
        await admin.from('businesses').delete().eq('id', otherBiz.id)
      }
      await admin.from('posts').delete().in('id', [inScopeId, alreadyApprovedId, softDeletedId])
    }
  })
})
