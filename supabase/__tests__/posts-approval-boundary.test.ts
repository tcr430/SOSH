import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

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
})
