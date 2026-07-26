import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0018 §3.3 (LEARN-TRIGGER-ENQUEUE-ONLY, LEARN-CAPTURE-ALL-CALLERS,
// LEARN-MODE-AGNOSTIC, LEARN-TICK-IDEMPOTENT layer 1) — Tier-1, live Postgres.
//
// The capture trigger is proven here via a RAW `UPDATE posts SET
// status='approved'` issued directly against Postgres through a plain `pg`
// client — no Supabase client, no /lib/db function, no application code
// anywhere in the call path. This IS the proof of LEARN-CAPTURE-ALL-CALLERS
// (the trigger fires regardless of which caller performed the transition)
// and LEARN-MODE-AGNOSTIC (it doesn't care whether the transition came from
// Mode 1 or Mode 2 app code, or from no app code at all).

describe('learning capture — enqueue trigger + claim RPC (ADR 0018 §3.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let ownerId: string
  let businessId: string
  let campaignId: string

  async function createUser(label: string) {
    const email = `learncap-trg-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  async function createPost(status: 'draft' | 'approved', content = 'AI-generated content') {
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content,
        hashtags: ['#ai'],
        scheduled_at: '2026-07-15T12:00:00Z',
        status,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function createOrigin(postId: string, content = 'AI-generated content') {
    const { data, error } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: businessId,
        post_id: postId,
        campaign_id: campaignId,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content, hashtags: ['#ai'] },
        rendered_content: content,
        hashtags: ['#ai'],
        schema_version: 1,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function getSignalForPost(postId: string) {
    const { data, error } = await admin
      .from('post_edit_signals')
      .select('*')
      .eq('post_id', postId)
      .maybeSingle()
    if (error) throw error
    return data
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for raw-SQL trigger tests')
    pg = new Client({ connectionString: url })
    await pg.connect()

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Trigger Test Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Trigger Test Campaign',
        objective: 'Test enqueue trigger',
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
    if (pg) await pg.end()
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

  it('fires on a raw UPDATE posts SET status=\'approved\' issued with NO application code involved', async () => {
    const postId = await createPost('draft', 'Raw SQL proof content')
    await createOrigin(postId, 'Raw SQL proof content')

    // Plain pg client, direct SQL — no Supabase client, no /lib/db function.
    await pg.query(`UPDATE public.posts SET status = 'approved' WHERE id = $1`, [postId])

    const signal = await getSignalForPost(postId)
    expect(signal).not.toBeNull()
    expect(signal.human_content).toBe('Raw SQL proof content')
    expect(signal.status).toBe('pending')
  })

  it('does NOT fire on an unrelated posts UPDATE (schedule change, status unchanged)', async () => {
    const postId = await createPost('draft', 'Unrelated update content')
    await createOrigin(postId, 'Unrelated update content')

    await pg.query(`UPDATE public.posts SET scheduled_at = $2 WHERE id = $1`, [
      postId,
      '2026-08-01T09:00:00Z',
    ])

    const signal = await getSignalForPost(postId)
    expect(signal).toBeNull()
  })

  it('does NOT fire on a status transition other than draft->approved', async () => {
    const postId = await createPost('approved', 'Already approved content')
    await createOrigin(postId, 'Already approved content')

    await pg.query(`UPDATE public.posts SET status = 'scheduled' WHERE id = $1`, [postId])

    const signal = await getSignalForPost(postId)
    expect(signal).toBeNull()
  })

  it('[db-MAJOR-1] SKIPS a snapshot-less post without failing the UPDATE', async () => {
    const postId = await createPost('draft', 'No snapshot content')
    // Deliberately no createOrigin() call.

    await expect(
      pg.query(`UPDATE public.posts SET status = 'approved' WHERE id = $1`, [postId]),
    ).resolves.not.toThrow()

    const signal = await getSignalForPost(postId)
    expect(signal).toBeNull()

    const { data: post, error } = await admin.from('posts').select('status').eq('id', postId).single()
    expect(error).toBeNull()
    expect(post.status).toBe('approved')
  })

  it('UNIQUE (post_id, ai_original_id) rejects a duplicate direct insert', async () => {
    const postId = await createPost('draft', 'Unique constraint content')
    const originId = await createOrigin(postId, 'Unique constraint content')
    await pg.query(`UPDATE public.posts SET status = 'approved' WHERE id = $1`, [postId])

    const { error } = await admin.from('post_edit_signals').insert({
      business_id: businessId,
      post_id: postId,
      campaign_id: campaignId,
      ai_original_id: originId,
      human_content: 'manual duplicate attempt',
      approved_at: new Date().toISOString(),
    })
    expect(error).not.toBeNull()
    expect(error.code).toBe('23505')
  })

  it('unapprove -> re-approve REFRESHES a pending row (LEARN-TICK-IDEMPOTENT layer 1)', async () => {
    const postId = await createPost('draft', 'First edit')
    await createOrigin(postId, 'First edit')
    await pg.query(`UPDATE public.posts SET status = 'approved' WHERE id = $1`, [postId])

    const first = await getSignalForPost(postId)
    expect(first).not.toBeNull()
    expect(first.human_content).toBe('First edit')

    // Unapprove (back to draft) then re-approve with different content —
    // §0.2/A-1 names this real duplicate-signal path explicitly.
    await pg.query(`UPDATE public.posts SET status = 'draft' WHERE id = $1`, [postId])
    await pg.query(`UPDATE public.posts SET content = $2, status = 'approved' WHERE id = $1`, [
      postId,
      'Second edit after re-approve',
    ])

    const second = await getSignalForPost(postId)
    expect(second).not.toBeNull()
    expect(second.id).toBe(first.id) // same row, refreshed — not a new row
    expect(second.human_content).toBe('Second edit after re-approve')
  })

  it('unapprove -> re-approve LEAVES a processed row untouched', async () => {
    const postId = await createPost('draft', 'Will be processed')
    await createOrigin(postId, 'Will be processed')
    await pg.query(`UPDATE public.posts SET status = 'approved' WHERE id = $1`, [postId])

    const pending = await getSignalForPost(postId)
    expect(pending).not.toBeNull()

    // Mark it processed, as the (not-yet-built) distillation worker would.
    const { error: markErr } = await admin
      .from('post_edit_signals')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', pending.id)
    expect(markErr).toBeNull()

    await pg.query(`UPDATE public.posts SET status = 'draft' WHERE id = $1`, [postId])
    await pg.query(`UPDATE public.posts SET content = $2, status = 'approved' WHERE id = $1`, [
      postId,
      'Attempted overwrite of processed row',
    ])

    const stillProcessed = await getSignalForPost(postId)
    expect(stillProcessed.id).toBe(pending.id)
    expect(stillProcessed.status).toBe('processed')
    expect(stillProcessed.human_content).toBe('Will be processed') // untouched
  })

  it('a bulk approve of N rows in ONE statement produces N outbox rows', async () => {
    const N = 4
    const postIds: string[] = []
    for (let i = 0; i < N; i++) {
      const postId = await createPost('draft', `Bulk content ${i}`)
      await createOrigin(postId, `Bulk content ${i}`)
      postIds.push(postId)
    }

    // One SQL statement, N rows, FOR EACH ROW fires once per row.
    await pg.query(`UPDATE public.posts SET status = 'approved' WHERE id = ANY($1::uuid[])`, [postIds])

    const { data: allSignals, error } = await admin
      .from('post_edit_signals')
      .select('id')
      .in('post_id', postIds)
    expect(error).toBeNull()
    expect(allSignals ?? []).toHaveLength(N)
  })

  it('claim_post_edit_signals returns DISJOINT sets under concurrent calls', async () => {
    // Drain any 'pending' rows left over from earlier tests in this file
    // first — claim_post_edit_signals has no business/test scoping (it's a
    // global service-role queue by design), and ORDER BY next_attempt_at
    // means an older backlog would be claimed before this test's own rows,
    // making the ourSignalIds filter below see nothing.
    await pg.query(`SELECT * FROM public.claim_post_edit_signals($1)`, [1000])

    const N = 4
    const postIds: string[] = []
    for (let i = 0; i < N; i++) {
      const postId = await createPost('draft', `Claim content ${i}`)
      await createOrigin(postId, `Claim content ${i}`)
      postIds.push(postId)
    }
    await pg.query(`UPDATE public.posts SET status = 'approved' WHERE id = ANY($1::uuid[])`, [postIds])

    // Confirm exactly N claimable signal rows exist for THIS test's posts
    // before claiming, so the disjointness check below is scoped cleanly.
    const { data: preClaim, error: preClaimErr } = await admin
      .from('post_edit_signals')
      .select('id')
      .in('post_id', postIds)
      .eq('status', 'pending')
    expect(preClaimErr).toBeNull()
    expect(preClaim ?? []).toHaveLength(N)
    const ourSignalIds = new Set((preClaim ?? []).map((r: { id: string }) => r.id))

    const url = process.env.DATABASE_URL as string
    const pgA = new Client({ connectionString: url })
    const pgB = new Client({ connectionString: url })
    await pgA.connect()
    await pgB.connect()
    try {
      const [resA, resB] = await Promise.all([
        pgA.query(`SELECT * FROM public.claim_post_edit_signals($1)`, [2]),
        pgB.query(`SELECT * FROM public.claim_post_edit_signals($1)`, [2]),
      ])
      // Scope to our own rows — a shared test DB may have other claimable
      // pending rows from other suites' fixtures.
      const idsA: string[] = resA.rows.map((r: { id: string }) => r.id).filter((id: string) => ourSignalIds.has(id))
      const idsB: string[] = resB.rows.map((r: { id: string }) => r.id).filter((id: string) => ourSignalIds.has(id))

      const overlap = idsA.filter((id) => idsB.includes(id))
      expect(overlap).toHaveLength(0)

      // Both batches target our N=4 rows with batch_size=2 each — disjoint
      // and together they must claim all 4, since nothing else contends for
      // these specific rows.
      const combined = new Set([...idsA, ...idsB])
      expect(combined.size).toBe(N)
    } finally {
      await pgA.end()
      await pgB.end()
    }
  })
})
