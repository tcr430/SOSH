import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// ADR 0019 §2.2 / §12 — STUDIO-RLS-ISOLATED, STUDIO-CASCADE-COMPLETE (Tier-1,
// live Postgres). Cross-tenant SELECT/INSERT/UPDATE/DELETE must be denied
// (USING + WITH CHECK proven, not assumed — a missing WITH CHECK is tenant
// tunnelling), business erasure (both a direct DELETE and purge_business)
// must cascade studio_drafts away, content_hash must be DB-generated (never
// app-writable) and self-updating, and the partial index's soft-delete
// predicate must actually exclude deleted rows.

const PASSWORD = 'TestPass123!'

describe('studio_drafts (ADR 0019 §2.2, §12)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let ownerAEmail: string
  let businessAId: string
  let businessBId: string

  async function createUser(label: string) {
    const email = `studio-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
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

    const ownerA = await createUser('owner-a')
    ownerAId = ownerA.id
    ownerAEmail = ownerA.email
    const ownerB = await createUser('owner-b')
    ownerBId = ownerB.id

    const { data: bizA, error: bizAErr } = await admin
      .from('businesses')
      .insert({ name: 'Studio Business A', owner_id: ownerAId, plan: 'plus' })
      .select('id')
      .single()
    if (bizAErr) throw bizAErr
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await admin
      .from('businesses')
      .insert({ name: 'Studio Business B', owner_id: ownerBId, plan: 'plus' })
      .select('id')
      .single()
    if (bizBErr) throw bizBErr
    businessBId = bizB.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('studio_drafts').delete().eq('business_id', businessAId)
    await admin.from('studio_drafts').delete().eq('business_id', businessBId)
    if (businessAId) await admin.from('businesses').delete().eq('id', businessAId)
    if (businessBId) await admin.from('businesses').delete().eq('id', businessBId)
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('STUDIO-RLS-ISOLATED: cross-tenant SELECT returns zero rows', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessBId, content: 'B-only content' })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data, error } = await client.from('studio_drafts').select('id').eq('id', row.id)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('STUDIO-RLS-ISOLATED: cannot INSERT a draft for a business the caller does not belong to', async () => {
    const client = await signInAs(ownerAEmail)
    const { data, error } = await client
      .from('studio_drafts')
      .insert({ business_id: businessBId, content: 'attempted cross-tenant insert' })
      .select()
    expect(error).not.toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('STUDIO-RLS-ISOLATED: cannot UPDATE a draft belonging to another business (USING)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessBId, content: 'original B content' })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('studio_drafts')
      .update({ content: 'tampered by A' })
      .eq('id', row.id)
      .select()
    // RLS's USING clause makes the row invisible to the UPDATE match — zero rows affected.
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere } = await admin.from('studio_drafts').select('content').eq('id', row.id).single()
    expect(stillThere.content).toBe('original B content')
  })

  it('STUDIO-RLS-ISOLATED: cannot UPDATE own draft to tunnel it into another business (WITH CHECK)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessAId, content: 'A content' })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client
      .from('studio_drafts')
      .update({ business_id: businessBId })
      .eq('id', row.id)
      .select()
    // RLS's WITH CHECK clause rejects the post-update row — zero rows affected.
    expect(data ?? []).toHaveLength(0)

    const { data: stillMine } = await admin.from('studio_drafts').select('business_id').eq('id', row.id).single()
    expect(stillMine.business_id).toBe(businessAId)
  })

  it('STUDIO-RLS-ISOLATED: cannot DELETE a draft belonging to another business (USING)', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessBId, content: 'B content to protect' })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const client = await signInAs(ownerAEmail)
    const { data } = await client.from('studio_drafts').delete().eq('id', row.id).select()
    // RLS's DELETE USING clause makes the row invisible to the match — zero rows affected.
    expect(data ?? []).toHaveLength(0)

    const { data: stillThere, error: stillThereErr } = await admin
      .from('studio_drafts')
      .select('id')
      .eq('id', row.id)
      .single()
    expect(stillThereErr).toBeNull()
    expect(stillThere.id).toBe(row.id)
  })

  it('content_hash is generated: a direct app-supplied write is rejected', async () => {
    const { error } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessAId, content: 'x', content_hash: 'attacker-supplied-hash' })
    expect(error).not.toBeNull()
  })

  it('content_hash updates automatically when content changes', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessAId, content: 'first version' })
      .select('id, content_hash')
      .single()
    expect(insertErr).toBeNull()
    const firstHash = row.content_hash
    expect(typeof firstHash).toBe('string')
    expect(firstHash.length).toBeGreaterThan(0)

    const { data: updated, error: updateErr } = await admin
      .from('studio_drafts')
      .update({ content: 'second version, different bytes' })
      .eq('id', row.id)
      .select('content_hash')
      .single()
    expect(updateErr).toBeNull()
    expect(updated.content_hash).not.toBe(firstHash)
  })

  it('soft-delete predicate: a deleted_at row is excluded from the deleted_at IS NULL partial-index query pattern', async () => {
    const { data: row, error: insertErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: businessAId, content: 'will be soft-deleted' })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    await admin.from('studio_drafts').update({ deleted_at: new Date().toISOString() }).eq('id', row.id)

    // The query pattern the partial index (business_id, updated_at DESC, id)
    // WHERE deleted_at IS NULL is built to serve.
    const { data: visible, error: listErr } = await admin
      .from('studio_drafts')
      .select('id')
      .eq('business_id', businessAId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })

    expect(listErr).toBeNull()
    expect((visible ?? []).map((r: { id: string }) => r.id)).not.toContain(row.id)
  })

  it('STUDIO-CASCADE-COMPLETE: deleting the business completes without error and removes its drafts', async () => {
    const owner = await createUser('cascade-direct')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Studio Cascade Direct', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const { error: draftErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: biz.id, content: 'about to be cascaded' })
    expect(draftErr).toBeNull()

    // The assertion that matters: the delete call itself must not error — a
    // BEFORE DELETE guard would abort the cascade and surface here.
    const { error: deleteErr } = await admin.from('businesses').delete().eq('id', biz.id)
    expect(deleteErr).toBeNull()

    const { data: draftsAfter, error: draftsAfterErr } = await admin
      .from('studio_drafts')
      .select('id')
      .eq('business_id', biz.id)
    expect(draftsAfterErr).toBeNull()
    expect(draftsAfter ?? []).toHaveLength(0)

    await admin.auth.admin.deleteUser(owner.id)
  })

  it('STUDIO-CASCADE-COMPLETE: purge_business on a business with drafts completes without error and leaves none', async () => {
    const owner = await createUser('cascade-purge')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Studio Cascade Purge', owner_id: owner.id, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const { error: draftErr } = await admin
      .from('studio_drafts')
      .insert({ business_id: biz.id, content: 'about to be purged' })
    expect(draftErr).toBeNull()

    const { error: purgeErr } = await admin.rpc('purge_business', { p_business_id: biz.id })
    expect(purgeErr).toBeNull()

    const { data: draftsAfter, error: draftsAfterErr } = await admin
      .from('studio_drafts')
      .select('id')
      .eq('business_id', biz.id)
    expect(draftsAfterErr).toBeNull()
    expect(draftsAfter ?? []).toHaveLength(0)

    await admin.auth.admin.deleteUser(owner.id)
  })
})
