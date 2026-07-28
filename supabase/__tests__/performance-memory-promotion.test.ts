import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0018 §7.3/§7.4 — Tier-1, live Postgres.
//
// promote_performance_pattern / demote_performance_pattern
// (20260726030000_performance_memory_promotion.sql) are each a single
// atomic conditional UPDATE. The property that matters here cannot be
// proven by a mocked-client unit test: under N concurrent callers racing
// the SAME pattern, exactly ONE call may actually flip status — Postgres's
// row lock plus the WHERE clause's own re-check (not a read-then-update in
// application code) is what makes that true.

describe('promote_performance_pattern / demote_performance_pattern concurrency (ADR 0018 §7.3/§7.4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignAId: string
  let campaignBId: string

  async function createUser(label: string) {
    const email = `perfmem-promo-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  // Seeds one 'processed' post_edit_signals row under the given campaign,
  // carrying the given pattern_key and class='preference' — the shape a
  // real Tier-0 classifier would leave behind. Each call creates its own
  // post + post_ai_originals fixture (post_edit_signals has UNIQUE
  // (post_id, ai_original_id), so rows can't be reused across calls).
  async function createProcessedSignal(campaignId: string, patternKey: string) {
    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'Promotion concurrency fixture content',
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'approved',
      })
      .select('id')
      .single()
    if (postErr) throw postErr

    const { data: origin, error: originErr } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: businessId,
        post_id: post.id,
        campaign_id: campaignId,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content: 'Promotion concurrency fixture content', hashtags: [] },
        rendered_content: 'Promotion concurrency fixture content',
        schema_version: 1,
      })
      .select('id')
      .single()
    if (originErr) throw originErr

    const { error } = await admin.from('post_edit_signals').insert({
      business_id: businessId,
      post_id: post.id,
      campaign_id: campaignId,
      ai_original_id: origin.id,
      human_content: 'Human edited content, shorter',
      approved_at: new Date().toISOString(),
      status: 'processed',
      class: 'preference',
      pattern_key: patternKey,
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
      .insert({ name: 'Promotion Concurrency Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    async function createCampaign(name: string) {
      const { data, error } = await admin
        .from('campaigns')
        .insert({
          business_id: businessId,
          name,
          objective: 'Test promotion concurrency',
          platforms: ['linkedin'],
          frequency: 'weekly',
          posts_per_week: 1,
          start_date: '2026-07-01',
          origin: 'objective_generated',
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    }

    campaignAId = await createCampaign('Promotion Concurrency Campaign A')
    campaignBId = await createCampaign('Promotion Concurrency Campaign B')
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('performance_memory').delete().eq('business_id', businessId)
      await admin.from('post_edit_signals').delete().eq('business_id', businessId)
      await admin.from('post_ai_originals').delete().eq('business_id', businessId)
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  function countSuccesses(results: Array<{ data: unknown; error: unknown }>): number {
    return results.filter((r) => {
      if (r.error) return false
      return Array.isArray(r.data) ? r.data.length > 0 : r.data != null
    }).length
  }

  it('promote_performance_pattern promotes EXACTLY ONCE under 10 concurrent calls', async () => {
    const key = `promote-concurrency-${Date.now()}`

    // 5 observations across 2 distinct campaigns — both promotion gates hold.
    await createProcessedSignal(campaignAId, key)
    await createProcessedSignal(campaignAId, key)
    await createProcessedSignal(campaignAId, key)
    await createProcessedSignal(campaignBId, key)
    await createProcessedSignal(campaignBId, key)

    const { error: insertErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'platform',
      scope_ref: 'linkedin',
      dimension: 'format',
      platform: 'linkedin',
      pattern: 'Human editors shorten AI-generated LinkedIn posts',
      pattern_key: key,
      observation_count: 5,
      confidence: 0.714,
    })
    expect(insertErr).toBeNull()

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        admin.rpc('promote_performance_pattern', {
          p_business_id: businessId,
          p_pattern_key: key,
          p_dimension: 'format',
          p_platform: 'linkedin',
        }),
      ),
    )

    expect(countSuccesses(results)).toBe(1)

    const { data: finalRow, error: finalErr } = await admin
      .from('performance_memory')
      .select('status')
      .eq('business_id', businessId)
      .eq('pattern_key', key)
      .single()
    expect(finalErr).toBeNull()
    expect(finalRow.status).toBe('active')
  })

  it('promote_performance_pattern is a no-op when the distinct-campaign gate does not hold (1 campaign)', async () => {
    const key = `promote-single-campaign-${Date.now()}`
    for (let i = 0; i < 5; i++) await createProcessedSignal(campaignAId, key)

    await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'platform',
      scope_ref: 'linkedin',
      dimension: 'format',
      platform: 'linkedin',
      pattern: 'Single-campaign pattern',
      pattern_key: key,
      observation_count: 5,
      confidence: 0.714,
    })

    const { data, error } = await admin.rpc('promote_performance_pattern', {
      p_business_id: businessId,
      p_pattern_key: key,
      p_dimension: 'format',
      p_platform: 'linkedin',
    })
    expect(error).toBeNull()
    expect(Array.isArray(data) ? data.length : 0).toBe(0)

    const { data: finalRow } = await admin
      .from('performance_memory')
      .select('status')
      .eq('business_id', businessId)
      .eq('pattern_key', key)
      .single()
    expect(finalRow.status).toBe('candidate')
  })

  // [Session 25-D correction, MINOR-8] p_net (a caller-trusted number) is
  // replaced by p_contradicting_pattern_key — the RPC now recomputes the
  // contradiction count itself via a live correlated subquery over
  // post_edit_signals, the same rigor promotion's campaign gate already
  // has. net = observation_count (6) - contradictions (4 real seeded
  // signals) = 2, which is < LEARN_DEMOTION_NET (3).
  it('demote_performance_pattern demotes EXACTLY ONCE under 10 concurrent calls, never deleting the row', async () => {
    const key = `demote-concurrency-${Date.now()}`
    const contradictingKey = `${key}-opposite`

    for (let i = 0; i < 4; i++) await createProcessedSignal(campaignAId, contradictingKey)

    const { error: insertErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      status: 'active',
      scope: 'platform',
      scope_ref: 'linkedin',
      dimension: 'format',
      platform: 'linkedin',
      pattern: 'A pattern that has started contradicting itself',
      pattern_key: key,
      observation_count: 6,
      confidence: 0.4,
    })
    expect(insertErr).toBeNull()

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        admin.rpc('demote_performance_pattern', {
          p_business_id: businessId,
          p_pattern_key: key,
          p_dimension: 'format',
          p_platform: 'linkedin',
          p_contradicting_pattern_key: contradictingKey,
        }),
      ),
    )

    expect(countSuccesses(results)).toBe(1)

    const { data: finalRow, error: finalErr } = await admin
      .from('performance_memory')
      .select('status, deleted_at')
      .eq('business_id', businessId)
      .eq('pattern_key', key)
      .single()
    expect(finalErr).toBeNull()
    expect(finalRow.status).toBe('candidate')
    expect(finalRow.deleted_at).toBeNull()
  })

  // net = observation_count (10) - contradictions (5 real seeded signals) =
  // 5, which is >= LEARN_DEMOTION_NET (3) — a genuine no-op, recomputed by
  // the RPC itself rather than trusted from a caller-supplied p_net.
  it('demote_performance_pattern is a no-op when the recomputed net >= LEARN_DEMOTION_NET', async () => {
    const key = `demote-noop-${Date.now()}`
    const contradictingKey = `${key}-opposite`

    for (let i = 0; i < 5; i++) await createProcessedSignal(campaignBId, contradictingKey)

    await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      status: 'active',
      scope: 'platform',
      scope_ref: 'linkedin',
      dimension: 'format',
      platform: 'linkedin',
      pattern: 'A pattern still holding up',
      pattern_key: key,
      observation_count: 10,
      confidence: 0.83,
    })

    const { data, error } = await admin.rpc('demote_performance_pattern', {
      p_business_id: businessId,
      p_pattern_key: key,
      p_dimension: 'format',
      p_platform: 'linkedin',
      p_contradicting_pattern_key: contradictingKey,
    })
    expect(error).toBeNull()
    expect(Array.isArray(data) ? data.length : 0).toBe(0)

    const { data: finalRow } = await admin
      .from('performance_memory')
      .select('status')
      .eq('business_id', businessId)
      .eq('pattern_key', key)
      .single()
    expect(finalRow.status).toBe('active')
  })

  // ─── upsert_distilled_performance_pattern (database-reviewer, C2.6 MAJOR:
  // this RPC had zero Tier-1 coverage — every test above seeded
  // performance_memory via a direct .insert(), never through the RPC
  // itself) ────────────────────────────────────────────────────────────────

  it('upsert_distilled_performance_pattern INSERTs a candidate row with the fixed governance columns', async () => {
    const key = `upsert-insert-${Date.now()}`
    const { data, error } = await admin.rpc('upsert_distilled_performance_pattern', {
      p_business_id: businessId,
      p_dimension: 'format',
      p_pattern: 'First observation of a new pattern',
      p_pattern_key: key,
      p_platform: 'linkedin',
      p_scope: 'platform',
      p_scope_ref: 'linkedin',
      p_confidence: 0,
      p_observation_count: 1,
    })
    expect(error).toBeNull()
    const row = data[0]
    expect(row.source).toBe('distilled')
    expect(row.status).toBe('candidate')
    expect(row.sensitivity).toBe('internal')
    expect(row.public_use_permission).toBe(false)
    expect(row.observation_count).toBe(1)
    expect(row.last_confirmed_at).not.toBeNull()
    expect(row.expires_at).not.toBeNull()
  })

  it('upsert_distilled_performance_pattern ON CONFLICT DO UPDATE refreshes pattern/confidence/observation_count/last_confirmed_at/expires_at', async () => {
    const key = `upsert-conflict-${Date.now()}`
    const { data: first } = await admin.rpc('upsert_distilled_performance_pattern', {
      p_business_id: businessId,
      p_dimension: 'format',
      p_pattern: 'First observation',
      p_pattern_key: key,
      p_platform: 'linkedin',
      p_scope: 'platform',
      p_scope_ref: 'linkedin',
      p_confidence: 0,
      p_observation_count: 1,
    })
    const firstConfirmedAt = first[0].last_confirmed_at

    // Ensure a measurable timestamp difference.
    await new Promise((resolve) => setTimeout(resolve, 10))

    const { data: second, error: secondErr } = await admin.rpc('upsert_distilled_performance_pattern', {
      p_business_id: businessId,
      p_dimension: 'format',
      p_pattern: 'Updated observation, same key',
      p_pattern_key: key,
      p_platform: 'linkedin',
      p_scope: 'platform',
      p_scope_ref: 'linkedin',
      p_confidence: 0.714,
      p_observation_count: 5,
    })
    expect(secondErr).toBeNull()
    const row = second[0]
    expect(row.id).toBe(first[0].id) // same row, not a duplicate
    expect(row.pattern).toBe('Updated observation, same key')
    expect(row.confidence).toBe(0.71)
    expect(row.observation_count).toBe(5)
    expect(new Date(row.last_confirmed_at).getTime()).toBeGreaterThan(new Date(firstConfirmedAt).getTime())
  })

  it('upsert_distilled_performance_pattern does NOT reset an already-ACTIVE row back to candidate on re-observation', async () => {
    const key = `upsert-preserve-active-${Date.now()}`
    const { data: inserted } = await admin.rpc('upsert_distilled_performance_pattern', {
      p_business_id: businessId,
      p_dimension: 'format',
      p_pattern: 'Will be promoted',
      p_pattern_key: key,
      p_platform: 'linkedin',
      p_scope: 'platform',
      p_scope_ref: 'linkedin',
      p_confidence: 0.714,
      p_observation_count: 5,
    })
    await admin.from('performance_memory').update({ status: 'active' }).eq('id', inserted[0].id)

    const { data: reobserved, error } = await admin.rpc('upsert_distilled_performance_pattern', {
      p_business_id: businessId,
      p_dimension: 'format',
      p_pattern: 'One more observation after promotion',
      p_pattern_key: key,
      p_platform: 'linkedin',
      p_scope: 'platform',
      p_scope_ref: 'linkedin',
      p_confidence: 0.75,
      p_observation_count: 6,
    })
    expect(error).toBeNull()
    expect(reobserved[0].status).toBe('active')
  })
})
