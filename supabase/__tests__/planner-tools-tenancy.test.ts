import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0027 §2.4 (K2.4) — AGENCY-TOOLS-TENANT-BOUND, Tier 1, live Postgres.
//
// [test-Q2] THE OBVIOUS VERSION IS A FALSE-GREEN GENERATOR: two businesses owned by two DIFFERENT users (the
// lib/signals/triage precedent, supabase/__tests__/signals3-triage-tools.test.ts) never puts one user's
// get_user_business_ids() SET across more than one business, so it can never distinguish "the tool filters by
// the EXACT bound business_id" from "the tool merely filters by whatever the caller happens to be scoped to."
// This test seeds ONE auth user U reachable to BOTH business A (owner) and business B (an active
// business_members row) — the case RLS alone does NOT close — plus business C, owned by someone else, U has NO
// relationship to. Rows exist in EVERY backing table for A, B and C, all status='active' scope='brand' (a
// careless seed left at governed_memory's DEFAULT 'candidate' would be VACUOUSLY GREEN, since isEligible()
// filters to 'active' only). Assertions run IN ORDER per the guide: the POSITIVE CONTROL first (a tool bound to
// A returns A's row), then zero B rows, then zero C rows, then that a tool bound to C returns ZERO ROWS WITHOUT
// ERRORING — pinning the silent-failure shape (a future .single()/throw regression must be caught here, not
// discovered as a 500 in production).
//
// The planner's own `client` parameter is service-role in production (the orchestrator, K2.7, acquires it —
// AGENCY-NO-SERVICE-ROLE-IN-TOOLS forbids the tools module itself from doing so). Service-role bypasses RLS
// entirely, so under this client the EXPLICIT `.eq('business_id', businessId)` inside each backing function is
// the SOLE tenancy boundary — there is no RLS fallback to rescue a missing filter. The multi-business-reachable
// seed for U still matters: it proves the boundary is the explicit column filter and not an accident of no two
// businesses in this seed ever sharing an owner.

const NOW_ISO = new Date().toISOString()

describe('buildPlannerTools tenancy (ADR 0027 §2.4, constraint 3, live Postgres)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let userUId: string
  let ownerCId: string
  let businessAId: string
  let businessBId: string
  let businessCId: string
  let campaignAId: string
  let campaignBId: string
  let campaignCId: string
  let evidenceAId: string

  async function createUser(label: string) {
    const email = `planner-tools-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    return data.user.id as string
  }

  async function insertBusiness(name: string, ownerId: string) {
    const { data, error } = await admin.from('businesses').insert({ name, owner_id: ownerId, plan: 'plus' }).select('id').single()
    if (error) throw error
    return data.id as string
  }

  async function insertCampaign(businessId: string, name: string) {
    const { data, error } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name,
        objective: `Grow ${name}`,
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-01-01',
        origin: 'manual',
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function seedBackingRows(businessId: string, campaignId: string, label: string) {
    const memoryBase = { business_id: businessId, source: 'manual', scope: 'brand', status: 'active' }
    const { data: ev, error: evErr } = await admin
      .from('evidence_memory')
      .insert({ ...memoryBase, kind: 'quote', content: `${label} evidence` })
      .select('id')
      .single()
    if (evErr) throw evErr

    await admin.from('audience_memory').insert({ ...memoryBase, kind: 'problem', statement: `${label} audience note` })
    await admin.from('brand_memory').insert({ ...memoryBase, category: 'positioning', statement: `${label} brand claim` })

    await admin.from('posts').insert({
      campaign_id: campaignId,
      business_id: businessId,
      platform: 'linkedin',
      content: `${label} published post`,
      status: 'published',
      scheduled_at: NOW_ISO,
      published_at: NOW_ISO,
    })

    // The three-hop signal chain (insight_cards -> signal_candidates -> signals), for get_campaign_signal.
    const { data: conn, error: connErr } = await admin
      .from('github_connections')
      .insert({ business_id: businessId, installation_id: Math.floor(Math.random() * 1_000_000_000), account_login: 'acme' })
      .select('id')
      .single()
    if (connErr) throw connErr
    const { data: repo, error: repoErr } = await admin
      .from('watched_repos')
      .insert({ business_id: businessId, connection_id: conn.id, repo_id: Math.floor(Math.random() * 1_000_000_000), owner: 'acme', name: label })
      .select('id')
      .single()
    if (repoErr) throw repoErr
    const { data: signal, error: signalErr } = await admin
      .from('signals')
      .insert({
        business_id: businessId,
        watched_repo_id: repo.id,
        source: 'github',
        kind: 'release',
        external_id: `release-${label}`,
        title: `${label} signal title`,
        body: `${label} signal body`,
        occurred_at: NOW_ISO,
      })
      .select('id')
      .single()
    if (signalErr) throw signalErr
    const { data: candidate, error: candidateErr } = await admin
      .from('signal_candidates')
      .insert({ business_id: businessId, signal_id: signal.id, score: 10, occurred_at: NOW_ISO })
      .select('id')
      .single()
    if (candidateErr) throw candidateErr
    const { error: cardErr } = await admin.from('insight_cards').insert({
      business_id: businessId,
      signal_candidate_id: candidate.id,
      campaign_id: campaignId,
      observation: `${label} observation`,
      why_it_matters: `${label} why it matters`,
      audience: `${label} audience`,
      angle_options: [],
      evidence: [],
      novelty: 50,
      freshness: 50,
      sensitivity: 10,
      confidence: 80,
      rubric_scores: {},
      score: 10,
      occurred_at: NOW_ISO,
    })
    if (cardErr) throw cardErr

    return { evidenceId: ev.id as string }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    userUId = await createUser('user-u')
    ownerCId = await createUser('owner-c')

    businessAId = await insertBusiness('Planner Tools Business A', userUId)
    businessBId = await insertBusiness('Planner Tools Business B', ownerCId)
    businessCId = await insertBusiness('Planner Tools Business C', ownerCId)

    // U reaches A (owner) and B (active member) — the case RLS alone does not close. U has NO relationship to C.
    const { error: memberErr } = await admin.from('business_members').insert({
      business_id: businessBId,
      user_id: userUId,
      email: 'planner-tools-user-u@integration.test',
      role: 'viewer',
      status: 'active',
      accepted_at: NOW_ISO,
    })
    if (memberErr) throw memberErr

    campaignAId = await insertCampaign(businessAId, 'Business A campaign')
    campaignBId = await insertCampaign(businessBId, 'Business B campaign')
    campaignCId = await insertCampaign(businessCId, 'Business C campaign')

    const seededA = await seedBackingRows(businessAId, campaignAId, 'Business A')
    evidenceAId = seededA.evidenceId
    await seedBackingRows(businessBId, campaignBId, 'Business B')
    await seedBackingRows(businessCId, campaignCId, 'Business C')
  })

  afterAll(async () => {
    if (!admin) return
    for (const businessId of [businessAId, businessBId, businessCId]) {
      if (!businessId) continue
      await admin.from('businesses').delete().eq('id', businessId)
    }
    for (const id of [userUId, ownerCId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('POSITIVE CONTROL: a tool bound to business A returns business A rows', async () => {
    const { buildPlannerTools } = await import('@/lib/campaigns/planner/tools')
    const tools = buildPlannerTools(admin, businessAId, campaignAId)

    const evidence = (await tools.find((t) => t.name === 'list_evidence')!.execute({})) as unknown as {
      ids: string[]
      evidence: string
    }
    expect(evidence.ids).toContain(evidenceAId)
    expect(evidence.evidence).toContain('Business A evidence')

    const audience = (await tools.find((t) => t.name === 'list_audience_notes')!.execute({})) as unknown as Array<{ statement: string }>
    expect(audience.some((r) => r.statement.includes('Business A audience note'))).toBe(true)

    const brand = (await tools.find((t) => t.name === 'list_brand_claims')!.execute({})) as unknown as Array<{ statement: string }>
    expect(brand.some((r) => r.statement.includes('Business A brand claim'))).toBe(true)

    const campaigns = (await tools.find((t) => t.name === 'list_recent_campaigns')!.execute({})) as unknown as Array<{ name: string }>
    expect(campaigns.some((r) => r.name.includes('Business A campaign'))).toBe(true)

    const signal = (await tools.find((t) => t.name === 'get_campaign_signal')!.execute({})) as unknown as { signal: string | null }
    expect(signal.signal).toContain('Business A signal')

    const posts = (await tools.find((t) => t.name === 'list_recent_posts')!.execute({})) as unknown as string[]
    expect(posts.some((p) => p.includes('Business A published post'))).toBe(true)
  })

  it('a tool bound to business A (owned by U, who ALSO reaches B) returns ZERO business-B rows', async () => {
    const { buildPlannerTools } = await import('@/lib/campaigns/planner/tools')
    const tools = buildPlannerTools(admin, businessAId, campaignAId)

    const evidence = (await tools.find((t) => t.name === 'list_evidence')!.execute({})) as unknown as { evidence: string }
    expect(evidence.evidence).not.toContain('Business B evidence')

    const audience = (await tools.find((t) => t.name === 'list_audience_notes')!.execute({})) as unknown as Array<{ statement: string }>
    expect(audience.some((r) => r.statement.includes('Business B audience note'))).toBe(false)

    const brand = (await tools.find((t) => t.name === 'list_brand_claims')!.execute({})) as unknown as Array<{ statement: string }>
    expect(brand.some((r) => r.statement.includes('Business B brand claim'))).toBe(false)

    const campaigns = (await tools.find((t) => t.name === 'list_recent_campaigns')!.execute({})) as unknown as Array<{ name: string }>
    expect(campaigns.some((r) => r.name.includes('Business B campaign'))).toBe(false)

    const signal = (await tools.find((t) => t.name === 'get_campaign_signal')!.execute({})) as unknown as { signal: string | null }
    expect(signal.signal ?? '').not.toContain('Business B signal')

    const posts = (await tools.find((t) => t.name === 'list_recent_posts')!.execute({})) as unknown as string[]
    expect(posts.some((p) => p.includes('Business B published post'))).toBe(false)
  })

  it('a tool bound to business A returns ZERO business-C rows (the RLS arm — U has no relationship to C)', async () => {
    const { buildPlannerTools } = await import('@/lib/campaigns/planner/tools')
    const tools = buildPlannerTools(admin, businessAId, campaignAId)

    const evidence = (await tools.find((t) => t.name === 'list_evidence')!.execute({})) as unknown as { evidence: string }
    expect(evidence.evidence).not.toContain('Business C evidence')

    const campaigns = (await tools.find((t) => t.name === 'list_recent_campaigns')!.execute({})) as unknown as Array<{ name: string }>
    expect(campaigns.some((r) => r.name.includes('Business C campaign'))).toBe(false)

    const posts = (await tools.find((t) => t.name === 'list_recent_posts')!.execute({})) as unknown as string[]
    expect(posts.some((p) => p.includes('Business C published post'))).toBe(false)
  })

  it('get_campaign_signal bound to a business/campaign pair with no linked insight_card returns ZERO ROWS WITHOUT ERRORING — pins the silent-failure shape', async () => {
    const { buildPlannerTools } = await import('@/lib/campaigns/planner/tools')
    // Bound to businessCId + campaignAId deliberately: no insight_card links campaignAId to businessCId (C's
    // own campaign is campaignCId), so the three-hop walk finds nothing at the FIRST hop. getSignalForCampaign
    // must resolve to null there, not throw — the exact shape a future .single() regression (which throws
    // PGRST116 on zero rows) would break, and exactly what .maybeSingle() at every hop exists to guarantee.
    const tools = buildPlannerTools(admin, businessCId, campaignAId)
    await expect(tools.find((t) => t.name === 'get_campaign_signal')!.execute({})).resolves.toEqual({ signal: null })
  })
})
