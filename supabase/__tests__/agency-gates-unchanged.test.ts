import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { schedulePost, updatePost, listPostsDue, claimPostsForPublishing, publishPostComplete } from '@/lib/db/posts'

// ADR 0027 §10.3 item 2 — AGENCY-GATES-UNCHANGED (constraint 44), Tier 1 part (b): THE INVARIANT THE GATE RESTS
// ON, against live Postgres. Nothing in Session 34 touches publication, so what is proved here is that the
// invariant the human-approval gate rests on still holds on the shipped code:
//
//   a post inserted as 'draft' is never PUBLISHED by any path the product has. The only route to publication is
//   draft -> approved (approver capability, DB trigger) -> claim_posts_for_publishing (selects ONLY
//   status='approved') -> scheduled -> publish_post_complete (guarded by status='scheduled').
//
// Every step is exercised through the REAL lib/db function, not a re-typed WHERE clause (Session 22-E NEW-2), and
// each refusal has a POSITIVE CONTROL (an approved twin is claimed / listed / scheduled) so it is never vacuous.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM. The posts trigger (20260702120300, enforce_post_transition_capability)
// gates ONLY the *grant of approval*. A holder of the 'author' capability CAN raw-write draft -> scheduled and
// draft -> published on their own row through RLS (probed live at K2.11; recorded in docs/backlog.md). That is a
// state-integrity gap, not a publication bypass: no worker path consumes a row merely because it is 'scheduled',
// only rows the claim RPC returned from 'approved'. The last test pins THAT (the row is never claimed); it does
// not assert the raw write is denied, because it is not.
//
// SHARED-FUNCTION CALLERS (ADR 0015), each `git grep`-ed at K2.11: claimPostsForPublishing <- lib/publishing/
// orchestrator.ts:92 (the publish cron) — asserted here on the real function. schedulePost and listPostsDue have
// NO production caller (only lib/db/posts.ts itself); they are asserted because they encode the same guard, and are
// marked as such rather than counted as coverage of a live path.

const PASSWORD = 'TestPass123!'

describe('AGENCY-GATES-UNCHANGED (b) — a draft is never published (live Postgres)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let businessId: string
  let campaignId: string
  let ownerId: string
  let editorId: string
  let editorEmail: string

  async function createUser(label: string) {
    const email = `agencygates-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function createPost(status: 'draft' | 'approved') {
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'Agency gates test post',
        scheduled_at: '2026-07-15T12:00:00Z',
        status,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function statusOf(id: string): Promise<string> {
    const { data, error } = await admin.from('posts').select('status').eq('id', id).single()
    if (error) throw error
    return data.status as string
  }

  async function signInAsEditor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email: editorEmail, password: PASSWORD })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Agency Gates Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Agency Gates Campaign',
        objective: 'Test the gates',
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

    const editor = await createUser('editor')
    editorId = editor.id
    editorEmail = editor.email
    const { error: memberErr } = await admin
      .from('business_members')
      .insert({ business_id: businessId, user_id: editorId, email: editorEmail, role: 'editor', status: 'active' })
    if (memberErr) throw memberErr
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('business_members').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    for (const id of [ownerId, editorId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('schedulePost refuses a draft (zero rows, throws) and leaves it draft; its approved twin schedules (positive control)', async () => {
    const draftId = await createPost('draft')
    const approvedId = await createPost('approved')

    // Zero rows from `.single()` surfaces as PostgREST's PGRST116 ("Cannot coerce the result to a single JSON
    // object"), not the function's own friendlier message: either way it THROWS and the row is untouched.
    await expect(schedulePost(admin, draftId)).rejects.toThrow(/Cannot coerce|not found or not in 'approved' status/)
    expect(await statusOf(draftId)).toBe('draft')

    const scheduled = await schedulePost(admin, approvedId)
    expect(scheduled.status).toBe('scheduled')
  })

  it('the generic updatePost transition map admits no draft -> scheduled / published, and the throw precedes any write', async () => {
    const draftId = await createPost('draft')
    for (const to of ['scheduled', 'published'] as const) {
      await expect(updatePost(admin, draftId, { status: to }), `draft -> ${to}`).rejects.toThrow(/Invalid status transition: draft/)
    }
    expect(await statusOf(draftId)).toBe('draft')
  })

  it('claim_posts_for_publishing claims the due APPROVED post and never the due DRAFT (positive control + refusal)', async () => {
    const draftId = await createPost('draft')
    const approvedId = await createPost('approved')

    const claimed = await claimPostsForPublishing(admin, 1000, new Date('2026-08-01T00:00:00Z'))
    const ids = claimed.map((p) => p.id)
    expect(ids, 'positive control: the approved twin must be claimed').toContain(approvedId)
    expect(ids).not.toContain(draftId)
    expect(await statusOf(draftId)).toBe('draft')
    expect(await statusOf(approvedId)).toBe('scheduled')
  })

  it('listPostsDue lists the due APPROVED post and not the DRAFT', async () => {
    const draftId = await createPost('draft')
    const approvedId = await createPost('approved')
    const due = (await listPostsDue(admin)).map((p) => p.id)
    expect(due).toContain(approvedId)
    expect(due).not.toContain(draftId)
  })

  it("publish_post_complete is guarded by status='scheduled': null for a draft and for an approved post, mutating neither", async () => {
    const draftId = await createPost('draft')
    const approvedId = await createPost('approved')
    for (const id of [draftId, approvedId]) {
      const row = await publishPostComplete(admin, id, {
        platformPostId: 'urn:test:1',
        platformUrl: null,
        publishedAt: new Date('2026-08-01T00:00:00Z'),
      })
      expect(row, `publishPostComplete on ${id}`).toBeNull()
    }
    expect(await statusOf(draftId)).toBe('draft')
    expect(await statusOf(approvedId)).toBe('approved')
  })

  it('an editor (author, not approver) cannot grant approval: a draft cannot enter the claimable set below approver', async () => {
    const draftId = await createPost('draft')
    const client = await signInAsEditor()
    const { error } = await client.from('posts').update({ status: 'approved' }).eq('id', draftId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/approve capability required/)
    expect(await statusOf(draftId)).toBe('draft')
  })

  it("a draft an editor raw-writes to 'scheduled' is still never claimed for publishing (the gate is the claim RPC, not the trigger)", async () => {
    const draftId = await createPost('draft')
    const approvedId = await createPost('approved')
    const client = await signInAsEditor()
    // Not asserted to fail: the trigger permits this write (see the header). The property is what happens NEXT.
    await client.from('posts').update({ status: 'scheduled' }).eq('id', draftId)

    const claimed = await claimPostsForPublishing(admin, 1000, new Date('2026-08-01T00:00:00Z'))
    const ids = claimed.map((p) => p.id)
    expect(ids, 'positive control: the approved twin must be claimed').toContain(approvedId)
    expect(ids).not.toContain(draftId)
  })
})
