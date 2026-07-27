import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0016 Amendment B / ADR 0018 §7.2, §5.3 — Tier-1, live Postgres.
//
//   1. [db-MAJOR-2]: a distilled row with a NULL pattern_key is rejected by
//      the CHECK; a manual row with a NULL pattern_key is accepted.
//   2. The partial UNIQUE dedupes distilled rows on
//      (business_id, dimension, coalesce(platform,''), pattern_key) —
//      proven to collide, to exclude soft-deleted rows, and to NOT apply to
//      manual rows sharing the same tuple.
//   3. LEARN-VOICE-WRITE-TRIGGER: a format/hook distilled write sourced from
//      a correction-class signal is rejected by the DB, the same write from
//      a preference-class signal succeeds, and a topic-dimension write from
//      a correction-class signal succeeds (only format/hook are
//      voice-directed).

describe('performance_memory.pattern_key + LEARN-VOICE-WRITE-TRIGGER (ADR 0016 Amendment B, ADR 0018 §5.3/§7.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignId: string

  async function createUser(label: string) {
    const email = `perfmem-pk-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  // Seeds a post_edit_signals row directly (bypassing the enqueue trigger,
  // whose class is always NULL fresh out of capture) with an explicit class,
  // as the (not-yet-built) Tier-0 classifier would after processing. Each
  // call creates its OWN post + post_ai_originals fixture — post_edit_signals
  // has UNIQUE (post_id, ai_original_id), so reusing one post/origin pair
  // across multiple signal rows in this test file would collide.
  async function createSignal(patternKey: string, signalClass: 'preference' | 'correction' | 'inconclusive' | null) {
    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'Pattern key signal fixture content',
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
        payload: { content: 'Pattern key signal fixture content', hashtags: [] },
        rendered_content: 'Pattern key signal fixture content',
        schema_version: 1,
      })
      .select('id')
      .single()
    if (originErr) throw originErr

    const { data, error } = await admin
      .from('post_edit_signals')
      .insert({
        business_id: businessId,
        post_id: post.id,
        campaign_id: campaignId,
        ai_original_id: origin.id,
        human_content: 'Human edited content',
        approved_at: new Date().toISOString(),
        status: 'processed',
        class: signalClass,
        pattern_key: patternKey,
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
      .insert({ name: 'Pattern Key Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Pattern Key Campaign',
        objective: 'Test pattern_key + voice write trigger',
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
      await admin.from('performance_memory').delete().eq('business_id', businessId)
      await admin.from('post_edit_signals').delete().eq('business_id', businessId)
      await admin.from('post_ai_originals').delete().eq('business_id', businessId)
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  // ─── [db-MAJOR-2] CHECK ──────────────────────────────────────────────────

  it('rejects a distilled row with a NULL pattern_key', async () => {
    const { error } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'topic',
      pattern: 'A distilled pattern with no key',
      pattern_key: null,
    })
    expect(error).not.toBeNull()
    expect(error.code).toBe('23514') // check_violation
  })

  it('accepts a manual row with a NULL pattern_key', async () => {
    const { error } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'manual',
      scope: 'brand',
      dimension: 'topic',
      pattern: 'A manually-entered pattern',
      pattern_key: null,
    })
    expect(error).toBeNull()
  })

  // ─── partial UNIQUE dedupe ───────────────────────────────────────────────

  it('two distilled rows with the same (business_id, dimension, coalesce(platform,\'\'), pattern_key) collide', async () => {
    const key = `dedupe-test-${Date.now()}`
    const { error: firstErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'topic',
      platform: 'linkedin',
      pattern: 'First observation',
      pattern_key: key,
    })
    expect(firstErr).toBeNull()

    const { error: secondErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'topic',
      platform: 'linkedin',
      pattern: 'Second observation, same key',
      pattern_key: key,
    })
    expect(secondErr).not.toBeNull()
    expect(secondErr.code).toBe('23505') // unique_violation
  })

  it('a soft-deleted row does not block a new one with the same tuple', async () => {
    const key = `softdelete-test-${Date.now()}`
    const { data: first, error: firstErr } = await admin
      .from('performance_memory')
      .insert({
        business_id: businessId,
        source: 'distilled',
        scope: 'brand',
        dimension: 'topic',
        platform: 'linkedin',
        pattern: 'To be soft-deleted',
        pattern_key: key,
      })
      .select('id')
      .single()
    expect(firstErr).toBeNull()

    const { error: softDeleteErr } = await admin
      .from('performance_memory')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', first.id)
    expect(softDeleteErr).toBeNull()

    const { error: secondErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'topic',
      platform: 'linkedin',
      pattern: 'Replaces the soft-deleted row',
      pattern_key: key,
    })
    expect(secondErr).toBeNull()
  })

  it('a manual row with the same tuple as an existing distilled row does NOT collide', async () => {
    const key = `manual-vs-distilled-${Date.now()}`
    const { error: distilledErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'topic',
      platform: 'linkedin',
      pattern: 'Distilled row',
      pattern_key: key,
    })
    expect(distilledErr).toBeNull()

    const { error: manualErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'manual',
      scope: 'brand',
      dimension: 'topic',
      platform: 'linkedin',
      pattern: 'Manual row, same tuple, different source',
      pattern_key: key,
    })
    expect(manualErr).toBeNull()
  })

  // ─── LEARN-VOICE-WRITE-TRIGGER ───────────────────────────────────────────

  it('LEARN-VOICE-WRITE-TRIGGER: rejects a format-dimension distilled write sourced from a correction-class signal', async () => {
    const key = `voice-correction-${Date.now()}`
    await createSignal(key, 'correction')

    const { error } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'format',
      pattern: 'Voice-directed pattern from a correction signal',
      pattern_key: key,
    })
    expect(error).not.toBeNull()
    expect(error.message).toContain('LEARN-VOICE-WRITE-TRIGGER')
  })

  it('LEARN-VOICE-WRITE-TRIGGER: accepts the same write when the contributing signal is preference-class', async () => {
    const key = `voice-preference-${Date.now()}`
    await createSignal(key, 'preference')

    const { error } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'format',
      pattern: 'Voice-directed pattern from a preference signal',
      pattern_key: key,
    })
    expect(error).toBeNull()
  })

  // database-reviewer (C2.3 pass, MAJOR fix): a row that becomes tainted
  // AFTER insertion (its contributing signal gets reclassified away from
  // 'preference') must still be retirable — the guard that flags the taint
  // must never also be the thing blocking its own remediation.
  it('LEARN-VOICE-WRITE-TRIGGER: a row tainted AFTER insertion can still be retired and have unrelated fields updated', async () => {
    const key = `voice-retire-${Date.now()}`
    const signalId = await createSignal(key, 'preference')

    const { data: row, error: insertErr } = await admin
      .from('performance_memory')
      .insert({
        business_id: businessId,
        source: 'distilled',
        scope: 'brand',
        dimension: 'format',
        pattern: 'Later tainted pattern',
        pattern_key: key,
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    // Taint it: reclassify the contributing signal away from 'preference'.
    const { error: reclassifyErr } = await admin
      .from('post_edit_signals')
      .update({ class: 'correction' })
      .eq('id', signalId)
    expect(reclassifyErr).toBeNull()

    // An unrelated-field update on the now-tainted row must still succeed —
    // source/dimension/pattern_key are unchanged, so the guard doesn't re-run.
    const { error: unrelatedUpdateErr } = await admin
      .from('performance_memory')
      .update({ confidence: 0.6 })
      .eq('id', row.id)
    expect(unrelatedUpdateErr).toBeNull()

    // Retirement must succeed too — the explicit escape hatch.
    const { error: retireErr } = await admin
      .from('performance_memory')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', row.id)
    expect(retireErr).toBeNull()
  })

  it('LEARN-VOICE-WRITE-TRIGGER: a topic-dimension write from a correction-class signal succeeds (only format/hook are voice-directed)', async () => {
    const key = `topic-correction-${Date.now()}`
    await createSignal(key, 'correction')

    const { error } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'topic',
      pattern: 'Non-voice pattern from a correction signal',
      pattern_key: key,
    })
    expect(error).toBeNull()
  })

  it('LEARN-VOICE-WRITE-TRIGGER: rejects a hook-dimension write when the contributing signal is unclassified (NULL, fail-closed)', async () => {
    const key = `voice-null-class-${Date.now()}`
    await createSignal(key, null)

    const { error } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      scope: 'brand',
      dimension: 'hook',
      pattern: 'Voice-directed pattern from an unclassified signal',
      pattern_key: key,
    })
    expect(error).not.toBeNull()
    expect(error.message).toContain('LEARN-VOICE-WRITE-TRIGGER')
  })
})
