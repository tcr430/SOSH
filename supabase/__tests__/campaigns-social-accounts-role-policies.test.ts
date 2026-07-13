import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const PASSWORD = 'TestPass123!'

describe('campaigns/social_accounts role policies (ADR 0013 §5.3/§5.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let businessId: string
  let ownerId: string
  let viewerId: string
  let editorId: string
  let viewerEmail: string
  let editorEmail: string

  async function createUser(label: string) {
    const email = `campsocial-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Campaigns/Social Role Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const viewer = await createUser('viewer')
    viewerId = viewer.id
    viewerEmail = viewer.email
    const editor = await createUser('editor')
    editorId = editor.id
    editorEmail = editor.email

    for (const r of [
      { id: viewerId, email: viewerEmail, role: 'viewer' },
      { id: editorId, email: editorEmail, role: 'editor' },
    ]) {
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
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('social_accounts').delete().eq('business_id', businessId)
      await admin.from('business_members').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    for (const id of [ownerId, viewerId, editorId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('viewer cannot create a campaign', async () => {
    const client = await signInAs(viewerEmail)
    const { data, error } = await client
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Viewer Attempt',
        objective: 'Should be denied',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-07-01',
      })
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('editor+ can create a campaign', async () => {
    const client = await signInAs(editorEmail)
    const { data, error } = await client
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Editor Campaign',
        objective: 'Should be allowed',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-07-01',
      })
      .select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('a raw authenticated write to social_accounts without connect_accounts is denied (viewer)', async () => {
    const client = await signInAs(viewerEmail)
    const { data, error } = await client
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'linkedin',
        platform_user_id: 'viewer-attempt',
        platform_username: 'viewer',
        vault_access_token_id: '00000000-0000-0000-0000-000000000000',
      })
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('a raw authenticated write to social_accounts without connect_accounts is denied (editor, non-approver non-admin)', async () => {
    const client = await signInAs(editorEmail)
    const { data, error } = await client
      .from('social_accounts')
      .insert({
        business_id: businessId,
        platform: 'linkedin',
        platform_user_id: 'editor-attempt',
        platform_username: 'editor',
        vault_access_token_id: '00000000-0000-0000-0000-000000000000',
      })
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })
})
