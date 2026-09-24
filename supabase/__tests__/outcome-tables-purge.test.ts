import { describe, it, expect } from 'vitest'

// ADR 0026 §11 — OUTCOME-CASCADE-COMPLETE (34, Tier 1 half; the Tier-3 half is the
// §D2.5 rows, lib/db/__tests__/d2.5-outcome-rows.test.ts). purge_business over a
// business holding rows in post_dimensions, post_outcomes AND
// campaign_retrospectives must SUCCEED and leave zero of each.
//
// This is the test that catches the mistake ADR 0018 [db-BLOCKER-1] records: a
// BEFORE DELETE trigger on any child table fires on the FK cascade and aborts the
// purge. purge_business itself is unchanged — everything cascades from the root
// `DELETE FROM public.businesses` (20260702120700:62).
describe('purge_business covers post_dimensions / post_outcomes / campaign_retrospectives (ADR 0026 §11)', () => {
  it('a business with rows in all three tables is purged successfully and left with zero of each', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = createServiceRoleClient()

    const email = `outcome-purge-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userError) throw userError
    const ownerId = userData.user.id as string

    try {
      const { data: biz, error: bizErr } = await admin
        .from('businesses')
        .insert({ name: 'Outcome Purge Business', owner_id: ownerId, plan: 'plus' })
        .select('id')
        .single()
      if (bizErr) throw bizErr
      const businessId = biz.id as string

      const { data: campaign, error: campErr } = await admin
        .from('campaigns')
        .insert({
          business_id: businessId,
          name: 'Purge Campaign',
          objective: 'fixtures',
          platforms: ['linkedin'],
          frequency: 'weekly',
          posts_per_week: 1,
          start_date: '2026-09-01',
          origin: 'objective_generated',
        })
        .select('id')
        .single()
      if (campErr) throw campErr

      // Several posts: the cascade must clear ALL of them, not just one.
      const originIds: string[] = []
      const postIds: string[] = []
      for (let i = 0; i < 3; i += 1) {
        const { data: post, error: postErr } = await admin
          .from('posts')
          .insert({
            campaign_id: campaign.id,
            business_id: businessId,
            platform: 'linkedin',
            content: `Purge post ${i}`,
            hashtags: [],
            scheduled_at: '2026-09-15T12:00:00Z',
            status: 'draft',
            role: 'anchor_thesis',
          })
          .select('id')
          .single()
        if (postErr) throw postErr
        postIds.push(post.id)

        const { data: origin, error: originErr } = await admin
          .from('post_ai_originals')
          .insert({
            business_id: businessId,
            post_id: post.id,
            campaign_id: campaign.id,
            revision: 1,
            generation_kind: 'initial',
            format: 'single',
            payload: { content: 'x' },
            rendered_content: 'x',
            hashtags: [],
            schema_version: 1,
          })
          .select('id')
          .single()
        if (originErr) throw originErr
        originIds.push(origin.id)

        const { error: outErr } = await admin.from('post_outcomes').insert({
          post_id: post.id,
          business_id: businessId,
          campaign_id: campaign.id,
          platform: 'linkedin',
          published_at: '2026-09-01T12:00:00Z',
          ai_original_id: origin.id,
          metric_basis: 'count',
          value: 10 + i,
          measured_at: '2026-09-08T12:00:00Z',
        })
        if (outErr) throw outErr
      }

      const { error: retroErr } = await admin.from('campaign_retrospectives').insert({
        campaign_id: campaign.id,
        business_id: businessId,
        hypothesis_snapshot: 'Purge hypothesis (member-authored text)',
        hypothesis_source: 'brief',
        criteria_snapshot: { metric: 'win_rate', target: 0.5, evaluationWindowDays: 7 },
        verdict: 'supported',
        n: 3,
        wins: 3,
        completed_at: '2026-09-15T12:00:00Z',
        acknowledged_by: ownerId,
        acknowledged_at: '2026-09-16T12:00:00Z',
        status: 'acknowledged',
        note: 'Optional member note',
      })
      if (retroErr) throw retroErr

      // Precondition: every table really holds rows for this business (the trigger tagged all three).
      for (const table of ['post_dimensions', 'post_outcomes', 'campaign_retrospectives']) {
        const { data } = await admin.from(table).select('business_id').eq('business_id', businessId)
        expect((data ?? []).length, `${table} precondition`).toBeGreaterThanOrEqual(1)
      }
      const { data: dimsBefore } = await admin.from('post_dimensions').select('ai_original_id').eq('business_id', businessId)
      expect(dimsBefore).toHaveLength(3)

      const { data: purgeResult, error: purgeErr } = await admin.rpc('purge_business', { p_business_id: businessId })
      expect(purgeErr, 'purge_business must SUCCEED with rows in all three tables').toBeNull()
      expect(purgeResult.already_purged).toBe(false)

      for (const table of ['post_dimensions', 'post_outcomes', 'campaign_retrospectives', 'post_ai_originals', 'posts', 'campaigns']) {
        const { data } = await admin.from(table).select('business_id').eq('business_id', businessId)
        expect(data ?? [], `${table} must be empty after purge`).toEqual([])
      }
      const { data: byPost } = await admin.from('post_outcomes').select('post_id').in('post_id', postIds)
      const { data: byOrigin } = await admin.from('post_dimensions').select('ai_original_id').in('ai_original_id', originIds)
      expect(byPost ?? []).toEqual([])
      expect(byOrigin ?? []).toEqual([])
    } finally {
      await admin.auth.admin.deleteUser(ownerId)
    }
  })
})
