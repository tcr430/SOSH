import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  createStudioDraft,
  persistSuggestions,
  acceptSuggestion,
  listStudioDrafts,
  softDeleteStudioDraft,
  saveStudioDraft,
  type PersistSuggestionsResult,
} from '@/lib/db/studio-drafts'
import type { StudioDraftRow } from '@/lib/db/types'

// MAJOR-1 (Session 26-D correction) — persistSuggestions now returns a
// discriminated union (mirroring acceptSuggestion's). Test call sites that
// use the returned row unwrap through this helper rather than each
// re-deriving the same "expected saved, got X" check.
function unwrapSaved(result: PersistSuggestionsResult): StudioDraftRow {
  if (result.outcome !== 'saved') throw new Error(`expected persistSuggestions to save, got outcome: ${result.outcome}`)
  return result.draft
}

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

// ADR 0019 §10.2 / §2.6 — D2.2. STUDIO-STALE-SUGGESTION-GUARDED (both races,
// exercised through the real lib/db/studio-drafts.ts functions, not raw
// table calls — the correctness property is the atomic UPDATE's WHERE
// clause, so the test must go through the same statement the app uses) and
// STUDIO-LEARNING-REUSED (the negative form: drafting/accepting in Studio
// creates no posts row and no post_edit_signals row).
describe('studio_drafts — accept/suggest guards and learning-reuse boundary (ADR 0019 §10.2, §2.6)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let ownerEmail: string
  let businessId: string

  async function createUser(label: string) {
    const email = `studio-guard-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function signIn(email: string) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
    }
    const client = createClient(url, anonKey)
    const { error } = await client.auth.signInWithPassword({ email, password: 'TestPass123!' })
    if (error) throw error
    return client
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id
    ownerEmail = owner.email

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Studio Guard Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('studio_drafts').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('STUDIO-STALE-SUGGESTION-GUARDED (a): accept fails when content changed since generation', async () => {
    const client = await signIn(ownerEmail)

    const draft = await createStudioDraft(client, { business_id: businessId, content: 'v1' })
    const afterSuggest = unwrapSaved(
      await persistSuggestions(
        client,
        draft.id,
        businessId,
        'v1',
        [{ kind: 'model_judgment', text: 'tighten the opener' }],
        draft.content_hash,
      ),
    )
    const expectedContentHash = afterSuggest.content_hash
    const expectedSuggestionsHash = afterSuggest.suggestions_for_hash as string

    // The user edits the draft after suggestions were generated.
    const { error: editErr } = await client
      .from('studio_drafts')
      .update({ content: 'v2 — edited after suggest' })
      .eq('id', draft.id)
    expect(editErr).toBeNull()

    const result = await acceptSuggestion(
      client,
      draft.id,
      businessId,
      'accepted text that should NOT be applied',
      expectedContentHash,
      expectedSuggestionsHash,
    )
    expect(result.outcome).toBe('stale')

    const { data: unchanged } = await admin
      .from('studio_drafts')
      .select('content')
      .eq('id', draft.id)
      .single()
    expect(unchanged.content).toBe('v2 — edited after suggest')
  })

  it('MAJOR-1 (Session 26-D correction): persistSuggestions is guarded by content_hash — a concurrent save between the suggest call\'s content read and its write is NOT silently reverted', async () => {
    const client = await signIn(ownerEmail)

    const draft = await createStudioDraft(client, { business_id: businessId, content: 'v1' })
    const staleHash = draft.content_hash // what a suggest call would have read before its model round trip

    // Simulates a second tab/device saving a newer version WHILE the first
    // tab's suggest call is still in flight (model round trip already spent).
    await saveStudioDraft(client, draft.id, businessId, 'v2 — saved by another tab', undefined)

    const result = await persistSuggestions(
      client,
      draft.id,
      businessId,
      'v1 — STALE, must not overwrite v2',
      [{ kind: 'model_judgment', text: 'generated against the stale v1 read' }],
      staleHash,
    )
    expect(result.outcome).toBe('superseded')

    const { data: unchanged } = await admin
      .from('studio_drafts')
      .select('content')
      .eq('id', draft.id)
      .single()
    expect(unchanged.content).toBe('v2 — saved by another tab')
  })

  it('STUDIO-STALE-SUGGESTION-GUARDED (b): accept fails when the suggestion set was superseded by a regenerate, content unchanged', async () => {
    const client = await signIn(ownerEmail)

    const draft = await createStudioDraft(client, { business_id: businessId, content: 'same content throughout' })
    const firstSuggest = unwrapSaved(
      await persistSuggestions(
        client,
        draft.id,
        businessId,
        'same content throughout',
        [{ kind: 'model_judgment', text: 'first pass suggestion' }],
        draft.content_hash,
      ),
    )
    // Regenerate — content is identical, but the returned set differs, so
    // content_hash stays the same while suggestions_for_hash must change.
    // Guarded on the SAME draft.content_hash as the first call: content
    // never moved between the two persistSuggestions calls.
    const secondSuggest = unwrapSaved(
      await persistSuggestions(
        client,
        draft.id,
        businessId,
        'same content throughout',
        [{ kind: 'model_judgment', text: 'second pass, different suggestion' }],
        draft.content_hash,
      ),
    )
    expect(secondSuggest.content_hash).toBe(firstSuggest.content_hash)
    expect(secondSuggest.suggestions_for_hash).not.toBe(firstSuggest.suggestions_for_hash)

    // Client is holding the FIRST (now-superseded) suggestions_for_hash.
    const result = await acceptSuggestion(
      client,
      draft.id,
      businessId,
      'accepted text that should NOT be applied',
      firstSuggest.content_hash,
      firstSuggest.suggestions_for_hash as string,
    )
    expect(result.outcome).toBe('stale')

    const { data: unchanged } = await admin
      .from('studio_drafts')
      .select('content, suggestions_for_hash')
      .eq('id', draft.id)
      .single()
    expect(unchanged.content).toBe('same content throughout')
    expect(unchanged.suggestions_for_hash).toBe(secondSuggest.suggestions_for_hash)
  })

  it('clean case: accept matches exactly one row and clears both suggestion columns in the same statement', async () => {
    const client = await signIn(ownerEmail)

    const draft = await createStudioDraft(client, { business_id: businessId, content: 'clean case content' })
    const suggested = unwrapSaved(
      await persistSuggestions(
        client,
        draft.id,
        businessId,
        'clean case content',
        [{ kind: 'model_judgment', text: 'a real suggestion' }],
        draft.content_hash,
      ),
    )

    const result = await acceptSuggestion(
      client,
      draft.id,
      businessId,
      'clean case content, revised',
      suggested.content_hash,
      suggested.suggestions_for_hash as string,
    )
    expect(result.outcome).toBe('accepted')
    if (result.outcome === 'accepted') {
      expect(result.draft.content).toBe('clean case content, revised')
      expect(result.draft.suggestions).toBeNull()
      expect(result.draft.suggestions_for_hash).toBeNull()
    }
  })

  it('soft-delete: a deleted draft is absent from the list and not acceptable', async () => {
    const client = await signIn(ownerEmail)

    const draft = await createStudioDraft(client, { business_id: businessId, content: 'to be soft-deleted' })
    const suggested = unwrapSaved(
      await persistSuggestions(
        client,
        draft.id,
        businessId,
        'to be soft-deleted',
        [{ kind: 'model_judgment', text: 'irrelevant, draft will be deleted' }],
        draft.content_hash,
      ),
    )

    await softDeleteStudioDraft(client, draft.id, businessId)

    const list = await listStudioDrafts(client, businessId)
    expect(list.map((d) => d.id)).not.toContain(draft.id)

    const result = await acceptSuggestion(
      client,
      draft.id,
      businessId,
      'should not apply',
      suggested.content_hash,
      suggested.suggestions_for_hash as string,
    )
    expect(result.outcome).toBe('stale')
  })

  it('STUDIO-LEARNING-REUSED: drafting and accepting in Studio creates no posts row and no post_edit_signals row', async () => {
    const client = await signIn(ownerEmail)

    const draft = await createStudioDraft(client, { business_id: businessId, content: 'learning boundary content' })
    const suggested = unwrapSaved(
      await persistSuggestions(
        client,
        draft.id,
        businessId,
        'learning boundary content',
        [{ kind: 'model_judgment', text: 'a suggestion' }],
        draft.content_hash,
      ),
    )
    const result = await acceptSuggestion(
      client,
      draft.id,
      businessId,
      'learning boundary content, accepted',
      suggested.content_hash,
      suggested.suggestions_for_hash as string,
    )
    expect(result.outcome).toBe('accepted')

    const { data: posts, error: postsErr } = await admin
      .from('posts')
      .select('id')
      .eq('business_id', businessId)
    expect(postsErr).toBeNull()
    expect(posts ?? []).toHaveLength(0)

    const { data: signals, error: signalsErr } = await admin
      .from('post_edit_signals')
      .select('id')
      .eq('business_id', businessId)
    expect(signalsErr).toBeNull()
    expect(signals ?? []).toHaveLength(0)
  })
})
