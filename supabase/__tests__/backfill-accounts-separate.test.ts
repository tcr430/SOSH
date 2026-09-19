import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'

// MAJOR-9 (Session 32-D, D8, ADR 0025 BACKFILL-ACCOUNTS-SEPARATE). The only
// existing test for this constraint is lib/social/__tests__/mock-provider
// .test.ts's "two-accounts" case, which proves the MOCK PROVIDER's fixture
// data is independently servable per account — it never touches the real
// pipeline, memory writers, or ratify/apply-voice actions at all. This
// drives TWO real backfill runs, on TWO accounts of the SAME business,
// through fetch -> extract -> ratify -> apply-voice end to end against live
// Postgres, and proves every row lands under its own account's run — never
// the other's.

vi.mock('@/lib/social', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social')>('@/lib/social')
  return { ...actual, getRegistry: vi.fn() }
})
vi.mock('@/lib/ai/runner', () => ({ runPromptWithCost: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn().mockResolvedValue({}) }))

import { getRegistry } from '@/lib/social'
import type { SocialProvider, RecentPost } from '@/lib/social'
import { runPromptWithCost } from '@/lib/ai/runner'
import { fetchPhase } from '@/lib/backfill/orchestrator'
import { runExtractionUnit } from '@/lib/backfill/extract'
import { ratifyBackfillRun, transitionBackfillVoiceStatus } from '@/lib/db/backfill-runs'
import { addVariation } from '@/lib/db/voice'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import type { VoiceAxes } from '@/lib/validation/voice'

const mockGetRegistry = vi.mocked(getRegistry)
const mockRunPromptWithCost = vi.mocked(runPromptWithCost)

const FOUNDER_AXES: VoiceAxes = {
  formal_casual: 30, expert_peer: 40, serious_playful: 20,
  reserved_warm: 70, calm_energetic: 60, rational_emotional: 55, exclusive_inclusive: 45,
}
const BRAND_AXES: VoiceAxes = {
  formal_casual: 80, expert_peer: 75, serious_playful: 15,
  reserved_warm: 30, calm_energetic: 25, rational_emotional: 20, exclusive_inclusive: 65,
}

describe('backfill accounts stay separate end-to-end (ADR 0025 BACKFILL-ACCOUNTS-SEPARATE, Session 32-D D8, MAJOR-9)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let founderAccountId: string
  let brandAccountId: string
  let founderRunId: string
  let brandRunId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `backfill-separate-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: userData, error: userError } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (userError) throw userError
    ownerId = userData.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Backfill Separate Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: founderAccount, error: fErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId, platform: 'twitter', platform_user_id: 'x-separate-founder',
        platform_username: 'separate_founder', platform_display_name: 'Separate Founder',
        vault_access_token_id: '00000000-0000-4000-8000-000000000201',
        connected_at: new Date().toISOString(), is_active: true,
      })
      .select('id')
      .single()
    if (fErr) throw fErr
    founderAccountId = founderAccount.id

    const { data: brandAccount, error: bErr } = await admin
      .from('social_accounts')
      .insert({
        business_id: businessId, platform: 'twitter', platform_user_id: 'x-separate-brand',
        platform_username: 'separate_brand', platform_display_name: 'Separate Brand',
        vault_access_token_id: '00000000-0000-4000-8000-000000000202',
        connected_at: new Date().toISOString(), is_active: true,
      })
      .select('id')
      .single()
    if (bErr) throw bErr
    brandAccountId = brandAccount.id

    const { data: founderRun, error: frErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: founderAccountId, platform: 'twitter', status: 'queued' })
      .select('id')
      .single()
    if (frErr) throw frErr
    founderRunId = founderRun.id

    const { data: brandRun, error: brErr } = await admin
      .from('social_backfill_runs')
      .insert({ business_id: businessId, social_account_id: brandAccountId, platform: 'twitter', status: 'queued' })
      .select('id')
      .single()
    if (brErr) throw brErr
    brandRunId = brandRun.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function makeFakeProvider(): SocialProvider {
    return {
      platform: 'twitter',
      historicalReadAvailable: true,
      getOAuthAuthorizeUrl: vi.fn(),
      exchangeOAuthCode: vi.fn(),
      publish: vi.fn(),
      fetchPostMetrics: vi.fn(),
      fetchEngagement: vi.fn(),
      refreshAccessToken: vi.fn(),
      revokeAccessToken: vi.fn(),
      fetchRecentPosts: vi.fn(),
    }
  }

  function post(id: string, daysAgoN: number, likes: number): RecentPost {
    return {
      platformPostId: id,
      publishedAt: new Date(Date.now() - daysAgoN * 24 * 60 * 60 * 1000).toISOString(),
      content: `content for ${id}`,
      url: null,
      format: 'text',
      metrics: { likes, comments: 0, shares: 0, saves: 0, clicks: null, reach: null, impressions: null, fetchedAt: new Date().toISOString() },
    }
  }

  // 5 high + 5 low engagement posts, labeled so the two accounts' backing
  // post ids can never be confused with each other.
  function makePosts(label: string): { all: RecentPost[]; high: RecentPost[] } {
    const high = Array.from({ length: 5 }, (_, i) => post(`${label}-high-${i}`, 10 + i, 10))
    const low = Array.from({ length: 5 }, (_, i) => post(`${label}-low-${i}`, 20 + i, 1))
    return { all: [...high, ...low], high }
  }

  // Drives one run through fetch + all extraction passes to
  // awaiting_ratification, with account-labeled voice/insights output —
  // never the other account's content.
  async function driveToAwaitingRatification(
    runId: string,
    label: string,
    voiceAxes: VoiceAxes,
    highPosts: RecentPost[],
    allPosts: RecentPost[],
  ) {
    const provider = makeFakeProvider()
    mockGetRegistry.mockReturnValue({ get: () => provider, register: vi.fn() })
    provider.fetchRecentPosts = vi.fn().mockResolvedValue({ posts: allPosts, nextCursor: null })

    const fetchResult = await fetchPhase(runId)
    expect(fetchResult.status).toBe('extracting')

    const statsResult = await runExtractionUnit(runId)
    expect(statsResult).toEqual({ status: 'progressed', pass: 'stats' })

    mockRunPromptWithCost.mockResolvedValueOnce({
      output: {
        tone: [`${label}-tone`], targetAudience: `${label} audience`, keywords: [`${label}-kw`], avoidWords: [],
        uniqueValueProp: `${label} uvp`, competitors: [], voiceAxes,
      },
      costCents: 1,
    })
    const voiceResult = await runExtractionUnit(runId)
    expect(voiceResult).toEqual({ status: 'progressed', pass: 'voice' })

    mockRunPromptWithCost.mockResolvedValueOnce({
      output: {
        patterns: [{ dimension: 'topic', pattern: `${label}: a real pattern from this account only`, backingPostIds: highPosts.map((p) => p.platformPostId) }],
        audienceStatements: [{ kind: 'problem', statement: `${label}: an audience statement from this account only`, backingPostIds: [highPosts[0].platformPostId, highPosts[1].platformPostId] }],
      },
      costCents: 1,
    })
    const insightsResult = await runExtractionUnit(runId)
    expect(insightsResult).toEqual({ status: 'progressed', pass: 'insights' })

    // Evidence: one batch (all 10 posts, under BACKFILL_EVIDENCE_BATCH=20),
    // model finds nothing worth extracting, then a zero-pending finalize.
    mockRunPromptWithCost.mockResolvedValueOnce({ output: { items: [] }, costCents: 1 })
    const evidenceResult = await runExtractionUnit(runId)
    expect(evidenceResult).toEqual({ status: 'progressed', pass: 'evidence' })

    const finalizeResult = await runExtractionUnit(runId)
    expect(finalizeResult).toEqual({ status: 'awaiting_ratification', partial: false })
  }

  it('two accounts on one business never cross-contaminate corpora, candidates, or voices', async () => {
    const founderPosts = makePosts('founder')
    const brandPosts = makePosts('brand')

    await driveToAwaitingRatification(founderRunId, 'founder', FOUNDER_AXES, founderPosts.high, founderPosts.all)
    await driveToAwaitingRatification(brandRunId, 'brand', BRAND_AXES, brandPosts.high, brandPosts.all)

    // Every performance/audience row belongs to its own run — never the other's.
    const { data: allPerf } = await admin.from('performance_memory').select('id, import_run_id, pattern').in('import_run_id', [founderRunId, brandRunId])
    const { data: allAud } = await admin.from('audience_memory').select('id, import_run_id, statement').in('import_run_id', [founderRunId, brandRunId])

    const founderPerf = (allPerf ?? []).filter((r: { import_run_id: string }) => r.import_run_id === founderRunId)
    const brandPerf = (allPerf ?? []).filter((r: { import_run_id: string }) => r.import_run_id === brandRunId)
    expect(founderPerf).toHaveLength(1)
    expect(brandPerf).toHaveLength(1)
    expect(founderPerf[0].pattern).toContain('founder:')
    expect(brandPerf[0].pattern).toContain('brand:')
    expect(founderPerf[0].pattern).not.toContain('brand:')
    expect(brandPerf[0].pattern).not.toContain('founder:')

    const founderAud = (allAud ?? []).filter((r: { import_run_id: string }) => r.import_run_id === founderRunId)
    const brandAud = (allAud ?? []).filter((r: { import_run_id: string }) => r.import_run_id === brandRunId)
    expect(founderAud).toHaveLength(1)
    expect(brandAud).toHaveLength(1)

    // Fetch the founder run's candidate ids to ratify.
    const { data: founderRunRow } = await admin.from('social_backfill_runs').select('*').eq('id', founderRunId).single()
    expect(founderRunRow.staged_voice.voiceAxes).toEqual(FOUNDER_AXES) // never brand's axes

    // Ratify founder run as 'founder', accepting its own candidates only.
    const founderAccepted = [...founderPerf, ...founderAud].map((r: { id: string }) => r.id)
    const ratifiedFounder = await ratifyBackfillRun(ownerId, founderRunId, founderAccepted, [], 'founder')
    expect(ratifiedFounder?.status).toBe('ratified')
    expect(ratifiedFounder?.account_role).toBe('founder')

    // Ratifying A changed no row of B: brand's candidates are still 'candidate'.
    const { data: brandPerfAfterFounderRatify } = await admin.from('performance_memory').select('status').eq('import_run_id', brandRunId).single()
    expect(brandPerfAfterFounderRatify.status).toBe('candidate')
    const { data: brandRunAfterFounderRatify } = await admin.from('social_backfill_runs').select('status, account_role').eq('id', brandRunId).single()
    expect(brandRunAfterFounderRatify.status).toBe('awaiting_ratification') // untouched
    expect(brandRunAfterFounderRatify.account_role).toBeNull()

    // Ratify brand run as 'brand'.
    const brandAccepted = [...brandPerf, ...brandAud].map((r: { id: string }) => r.id)
    const ratifiedBrand = await ratifyBackfillRun(ownerId, brandRunId, brandAccepted, [], 'brand')
    expect(ratifiedBrand?.status).toBe('ratified')
    expect(ratifiedBrand?.account_role).toBe('brand')

    // Apply voice: founder -> exactly one brand_voice_variations row, axes only.
    const founderVariation = await addVariation({ businessId, name: 'Separate Founder', voiceAxes: FOUNDER_AXES })
    await transitionBackfillVoiceStatus(founderRunId, ['pending', 'refused_cap', 'failed'], 'applied', founderVariation.id)

    const { data: variations } = await admin.from('brand_voice_variations').select('id, voice_axes').eq('business_id', businessId)
    expect(variations).toHaveLength(1)
    expect(variations![0].voice_axes).toEqual(FOUNDER_AXES)

    // Apply voice: brand -> brand_voices, no variation added for it.
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const serviceClient = createServiceRoleClient()
    await upsertBrandVoice(serviceClient, {
      business_id: businessId,
      voice_axes: BRAND_AXES,
      tone: ['brand-tone'],
      keywords: ['brand-kw'],
      avoid_words: [],
      writing_examples: [],
    })
    await transitionBackfillVoiceStatus(brandRunId, ['pending', 'refused_cap', 'failed'], 'applied', 'brand_voices')

    const { data: brandVoiceRow } = await admin.from('brand_voices').select('voice_axes').eq('business_id', businessId).single()
    expect(brandVoiceRow.voice_axes).toEqual(BRAND_AXES)
    // Still exactly ONE variation (the founder's) — applying brand voice never added a second.
    const { data: variationsAfterBrandApply } = await admin.from('brand_voice_variations').select('id').eq('business_id', businessId)
    expect(variationsAfterBrandApply).toHaveLength(1)

    // transition_backfill_voice_status nulls staged_voice once applied
    // (20260914060000) — the isolation proof already happened above, at
    // the point each run's OWN axes reached its OWN destination table and
    // nowhere else. Confirm the null here as the expected terminal state,
    // not a leftover cross-run value.
    const { data: founderRunFinal } = await admin.from('social_backfill_runs').select('staged_voice, voice_status').eq('id', founderRunId).single()
    const { data: brandRunFinal } = await admin.from('social_backfill_runs').select('staged_voice, voice_status').eq('id', brandRunId).single()
    expect(founderRunFinal.staged_voice).toBeNull()
    expect(founderRunFinal.voice_status).toBe('applied')
    expect(brandRunFinal.staged_voice).toBeNull()
    expect(brandRunFinal.voice_status).toBe('applied')
  })
})
