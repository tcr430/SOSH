import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  createWorld, destroyWorld, seedCell, createRetrospective, type World,
} from '../__helpers__/outcome-fixtures'
import { upsertOutcomePattern, promoteOutcomePattern, listOutcomePatterns } from '@/lib/db/memory-performance'
import {
  getCampaignRetrospective, listCampaignPostStates, getFrozenBriefContent, listCampaignOutcomeCellSources,
} from '@/lib/db/campaign-retrospectives'
import { loadCampaignLearningView } from '@/lib/outcomes/campaign-view'

// ADR 0026 §11 OUTCOME-RLS-ISOLATED, THROUGH THE PRODUCTION READ PATH (Session 33-D D1, MAJOR-1). Tier 1, live Postgres.
//
// outcome-tables-rls.test.ts proves the SELECT policies deny cross-tenant reads. This file proves the policies are
// what the campaign page actually READS THROUGH: loadCampaignLearningView is handed an AUTHENTICATED member's client,
// and every argument it passes (business id, campaign id) is business A's. Under a service-role client that read
// returns A's rows anyway — the businessId filter is an argument, not a boundary. Under B's authenticated client the
// policy is the only thing standing between B and A's data, so a leak here means a reader is not using the client.

const PASSWORD = 'TestPass123!'

async function signInAs(email: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
  const client = createClient(url, anonKey)
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return client
}

describe('campaign learning view — the page path is scoped by RLS, not by its arguments (ADR 0026 §11, MAJOR-1)', () => {
  let a: World
  let b: World
  let campaignA: string
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  beforeAll(async () => {
    a = await createWorld('view-a')
    b = await createWorld('view-b')

    // Business A: a measured campaign (10 posts, 3 campaigns), an ACTIVE pattern, a CANDIDATE pattern,
    // a retrospective and a frozen brief — one row in every table the page reads.
    const ids = await seedCell(a, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
    campaignA = ids[0]
    const input = (value: string) => ({
      business_id: a.businessId, dimension: 'role' as const, value, platform: 'linkedin',
      direction: 'above' as const, pattern: `${value} posts beat usual engagement in 9 of 10 posts (3 campaigns)`,
    })
    await upsertOutcomePattern(input('customer_proof'))
    await promoteOutcomePattern(a.businessId, 'outcome:role:customer_proof:above:linkedin')
    await seedCell(a, { role: 'anchor_thesis', wins: 5, losses: 0, campaigns: 1 })
    await upsertOutcomePattern(input('anchor_thesis'))
    await createRetrospective(a, campaignA)
    const { error } = await a.admin.from('campaign_briefs').insert({
      business_id: a.businessId, campaign_id: campaignA, status: 'approved', content: { hypothesis: 'Proof posts win' },
      frozen_at: new Date().toISOString(),
    })
    if (error) throw error

    clientA = await signInAs(a.email)
    clientB = await signInAs(b.email)
  })

  afterAll(async () => {
    await destroyWorld(a)
    await destroyWorld(b)
  })

  // ── Positive control: the same calls as a member of A DO see A's rows, so the emptiness below is the policy
  // denying B and not a fixture that seeded nothing (or a policy that denies everyone).
  describe('a member of business A, through the page path, sees business A', () => {
    it('every reader returns data', async () => {
      expect(await getCampaignRetrospective(clientA, a.businessId, campaignA), 'campaign_retrospectives').not.toBeNull()
      expect((await listCampaignPostStates(clientA, a.businessId, campaignA)).length, 'posts').toBeGreaterThan(0)
      expect(await getFrozenBriefContent(clientA, a.businessId, campaignA), 'campaign_briefs').not.toBeNull()
      expect((await listCampaignOutcomeCellSources(clientA, a.businessId, campaignA)).length, 'post_outcomes').toBeGreaterThan(0)
      expect((await listOutcomePatterns(clientA, a.businessId, { status: 'active' })).length, 'performance_memory active').toBeGreaterThan(0)
      expect((await listOutcomePatterns(clientA, a.businessId, { status: 'candidate' })).length, 'performance_memory candidate').toBeGreaterThan(0)
    })

    it('the composed view is populated', async () => {
      const view = await loadCampaignLearningView(clientA, a.businessId, campaignA, ['linkedin'])
      expect(view.retro).not.toBeNull()
      expect(view.observed.length).toBeGreaterThan(0)
      expect(view.dueAt).not.toBeNull()
    })
  })

  // ── The point of the test: B's authenticated client, A's ids. The businessId/campaignId arguments are exactly
  // what a service-role read would happily honour; only the SELECT policy stops this.
  describe('a member of business B, handed business A ids, reads ZERO rows', () => {
    it('campaign_retrospectives', async () => {
      expect(await getCampaignRetrospective(clientB, a.businessId, campaignA), 'campaign_retrospectives leaked across tenants').toBeNull()
    })

    it('post_outcomes (and, through it, post_dimensions)', async () => {
      expect(await listCampaignOutcomeCellSources(clientB, a.businessId, campaignA), 'post_outcomes leaked across tenants').toEqual([])
      // The reader's SECOND hop queries post_dimensions by ai_original_id, but only when the first hop returned ids, so
      // an un-leaked first hop never reaches it. Issue that second query directly with A's real ids to prove the
      // post_dimensions policy denies B on its own.
      const { data: ids } = await a.admin.from('post_outcomes').select('ai_original_id').eq('business_id', a.businessId).not('ai_original_id', 'is', null)
      expect((ids as unknown[]).length).toBeGreaterThan(0)
      const { data: dims, error } = await clientB
        .from('post_dimensions')
        .select('ai_original_id, role')
        .eq('business_id', a.businessId)
        .in('ai_original_id', (ids as Array<{ ai_original_id: string }>).map((r) => r.ai_original_id))
      expect(error).toBeNull()
      expect(dims, 'post_dimensions leaked across tenants').toEqual([])
    })

    it('posts and campaign_briefs (the retrospective inputs)', async () => {
      expect(await listCampaignPostStates(clientB, a.businessId, campaignA), 'posts leaked across tenants').toEqual([])
      expect(await getFrozenBriefContent(clientB, a.businessId, campaignA), 'campaign_briefs leaked across tenants').toBeNull()
    })

    it('performance_memory (active and candidate outcome patterns)', async () => {
      expect(await listOutcomePatterns(clientB, a.businessId, { status: 'active' }), 'performance_memory (active) leaked across tenants').toEqual([])
      expect(await listOutcomePatterns(clientB, a.businessId, { status: 'candidate' }), 'performance_memory (candidate) leaked across tenants').toEqual([])
    })

    it('the composed loadCampaignLearningView — the exact path app/[locale]/(dashboard)/campaigns/[id]/page.tsx runs', async () => {
      const view = await loadCampaignLearningView(clientB, a.businessId, campaignA, ['linkedin'])
      expect(view.retro, 'campaign_retrospectives leaked through the composed view').toBeNull()
      expect(view.observed, 'performance_memory / post_outcomes leaked through the composed view').toEqual([])
      expect(view.dueAt, 'posts leaked through the composed view').toBeNull()
    })
  })
})
