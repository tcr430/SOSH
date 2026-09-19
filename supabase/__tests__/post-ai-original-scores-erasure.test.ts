import { describe, it, expect } from 'vitest'

// ADR 0024 §8.2 (Session 31, H2.4) — QUAL-SCORE-ERASURE (Tier 1), live
// Postgres. Erasure must be proven to reach the NEW score columns
// specifically, on the PROMOTE-CASCADE-COMPLETE precedent
// (supabase/__tests__/studio-promote-schema.test.ts:261-289, ADR 0022 §11.1):
// write a post_ai_originals row CARRYING THE NEW SCORE COLUMNS, run
// purge_business, assert the row is gone. The existing business_id
// ON DELETE CASCADE (20260726010000_learning_capture.sql:30) covers this
// structurally; this test PROVES it rather than assuming it.

describe('post_ai_originals score columns — erasure (ADR 0024 §8.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any

  async function createUser(label: string) {
    const email = `qualscore-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  it('QUAL-SCORE-ERASURE: purge_business on a business with a scored post_ai_originals row completes without error and leaves none', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('purge')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Quality Score Erasure Business', owner_id: owner.id, plan: 'pro' })
      .select('id')
      .single()
    if (bizErr) throw bizErr

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: biz.id,
        name: 'Quality Score Erasure Campaign',
        objective: 'Test QUAL-SCORE-ERASURE',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-07-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campaignErr) throw campaignErr

    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaign.id,
        business_id: biz.id,
        platform: 'linkedin',
        content: 'Scored candidate winner content',
        scheduled_at: '2026-07-15T12:00:00Z',
        status: 'draft',
      })
      .select('id')
      .single()
    if (postErr) throw postErr

    const dimensionScores = {
      specificity: { score: 80, note: 'concrete' },
      originality: { score: 75, note: 'fresh angle' },
      evidenceSufficiency: { score: 70, note: 'cited' },
      audienceRelevance: { score: 85, note: 'on target' },
      platformNativeness: { score: 90, note: 'native' },
      brandVoiceAlignment: { score: 88, note: 'on voice' },
      openingStrength: { score: 82, note: 'strong hook' },
      ctaFit: { score: 60, note: 'clear' },
      unsupportedClaimsRisk: { score: 95, note: 'no risky claims' },
      redundancy: { score: 92, note: 'no repetition' },
    }

    const { data: origin, error: originErr } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: biz.id,
        post_id: post.id,
        campaign_id: campaign.id,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content: 'Scored candidate winner content', hashtags: [] },
        rendered_content: 'Scored candidate winner content',
        schema_version: 2,
        overall_score: 82,
        dimension_scores: dimensionScores,
        candidate_count: 3,
        cleared_quality_threshold: true,
      })
      .select('id')
      .single()
    if (originErr) throw originErr

    // Sanity check: the row really does carry the new columns before we
    // erase it — otherwise a false pass would prove nothing about them.
    const { data: before, error: beforeErr } = await admin
      .from('post_ai_originals')
      .select('overall_score, dimension_scores, candidate_count, cleared_quality_threshold')
      .eq('id', origin.id)
      .single()
    if (beforeErr) throw beforeErr
    expect(before.overall_score).toBe(82)
    expect(before.candidate_count).toBe(3)
    expect(before.cleared_quality_threshold).toBe(true)
    expect(before.dimension_scores).toEqual(dimensionScores)

    // The assertion that matters: purge_business itself must not error — a
    // BEFORE DELETE guard would abort the cascade and surface here, exactly
    // as [db-BLOCKER-1] named for post_ai_originals's sibling table.
    const { error: purgeErr } = await admin.rpc('purge_business', { p_business_id: biz.id })
    expect(purgeErr).toBeNull()

    const { data: originsAfter, error: originsAfterErr } = await admin
      .from('post_ai_originals')
      .select('id')
      .eq('business_id', biz.id)
    expect(originsAfterErr).toBeNull()
    expect(originsAfter ?? []).toHaveLength(0)

    await admin.auth.admin.deleteUser(owner.id)
  })
})
