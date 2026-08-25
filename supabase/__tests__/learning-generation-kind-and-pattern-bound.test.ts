import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0018 Amd A.1, A.2 — Session 29, Track F, F1b.2. Tier-1, live Postgres.
//
// LEARN-GENERATION-KIND-WIDENED: post_ai_originals_generation_kind_check
// accepts the widened three-value set and still rejects a bogus value.
//
// MEM-PATTERN-BOUNDED: performance_memory_pattern_length_check is a Postgres
// CHECK — ADR 0022 §18.1 established that BOTH production callers of
// upsertDistilledPerformancePattern mock it (promote.test.ts:16-18,
// summarize.test.ts:23-25) and that memory-performance.test.ts:168 runs the
// real body against a STUBBED client, which cannot fire a CHECK. This test
// is the only place this constraint is actually discharged — it must run
// against live Postgres in supabase/__tests__/, not anywhere else.

describe('post_ai_originals.generation_kind CHECK widened to include studio_promoted (ADR 0018 Amd A.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignId: string
  let postId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: `learn-genkind-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (authErr) throw authErr
    ownerId = authUser.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Learn GenKind Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Learn GenKind Campaign',
        objective: 'Test generation_kind widening',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-08-01',
        origin: 'manual',
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
        content: 'GenKind fixture content',
        scheduled_at: '2026-08-02T09:00:00Z',
      })
      .select('id')
      .single()
    if (postErr) throw postErr
    postId = post.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('post_ai_originals').delete().eq('business_id', businessId)
    await admin.from('posts').delete().eq('business_id', businessId)
    await admin.from('campaigns').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  function insertOrigin(generation_kind: string, revision: number) {
    return admin
      .from('post_ai_originals')
      .insert({
        business_id: businessId,
        post_id: postId,
        campaign_id: campaignId,
        revision,
        generation_kind,
        format: 'single',
        payload: { content: 'x', hashtags: [] },
        rendered_content: 'x',
        schema_version: 1,
      })
      .select('id, generation_kind')
      .single()
  }

  it.each([
    ['initial', 1],
    ['regeneration', 2],
    ['studio_promoted', 3],
  ] as const)('accepts generation_kind=%s', async (kind, revision) => {
    const { data, error } = await insertOrigin(kind, revision)
    expect(error).toBeNull()
    expect(data.generation_kind).toBe(kind)
  })

  it('rejects an invalid generation_kind value (CHECK still enforced after widening)', async () => {
    const { error } = await insertOrigin('not_a_real_kind', 4)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/post_ai_originals_generation_kind_check/)
  })
})

describe('performance_memory.pattern length bound (ADR 0018 Amd A.2, MEM-PATTERN-BOUNDED)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      email: `learn-patternbound-${Date.now()}@integration.test`,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (authErr) throw authErr
    ownerId = authUser.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Pattern Bound Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('performance_memory').delete().eq('business_id', businessId)
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  // source='distilled' rows carry a required pattern_key
  // (performance_memory_distilled_requires_pattern_key,
  // 20260726020000_performance_memory_pattern_key.sql:18-19) unrelated to
  // this migration's length bound — each insert needs its own key so the
  // (business_id, dimension, coalesce(platform,''), pattern_key) unique
  // index doesn't collide across the three tests in this block.
  let patternKeyCounter = 0
  function insertPattern(pattern: string) {
    patternKeyCounter += 1
    return admin
      .from('performance_memory')
      .insert({
        business_id: businessId,
        source: 'distilled',
        scope: 'platform',
        scope_ref: 'linkedin',
        dimension: 'format',
        platform: 'linkedin',
        pattern_key: `pattern-bound-test-${patternKeyCounter}`,
        pattern,
      })
      .select('id, pattern')
      .single()
  }

  it('MEM-PATTERN-BOUNDED: a 501-character pattern is REJECTED by Postgres', async () => {
    const { error } = await insertPattern('x'.repeat(501))
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/performance_memory_pattern_length_check/)
  })

  it('MEM-PATTERN-BOUNDED: a 500-character pattern is accepted', async () => {
    const pattern = 'x'.repeat(500)
    const { data, error } = await insertPattern(pattern)
    expect(error).toBeNull()
    expect(data.pattern).toHaveLength(500)
  })

  it('MEM-PATTERN-BOUNDED: an UPDATE growing pattern past 500 characters is REJECTED', async () => {
    const { data: row, error: insertErr } = await insertPattern('x'.repeat(10))
    expect(insertErr).toBeNull()

    const { error } = await admin
      .from('performance_memory')
      .update({ pattern: 'x'.repeat(501) })
      .eq('id', row.id)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/performance_memory_pattern_length_check/)
  })
})
