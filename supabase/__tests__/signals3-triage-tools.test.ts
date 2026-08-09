import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0021 §2.3 (Session 28 E5.5) — SIGNAL3-TOOLS-TENANT-BOUND, Tier 1.
// [sec-MEDIUM-3]: service-role bypasses RLS, so the `.eq('business_id', …)`
// filter inside each backing function is the SOLE tenancy boundary for these
// tools — a mocked-client test can only prove the mock was CALLED with the
// right argument, never that a foreign row is actually absent from the
// result. This seeds TWO real businesses with real rows in all four backing
// tables and asserts each tool, run under service-role, returns zero rows
// belonging to the other business.

const MEMORY_TABLES = ['evidence_memory', 'audience_memory', 'brand_memory'] as const

describe('buildTriageTools tenancy (ADR 0021 §2.3, live Postgres)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let businessAId: string
  let businessBId: string
  let evidenceAId: string
  let evidenceBId: string

  async function createUser(label: string) {
    const email = `signals3-tools-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    return data.user.id as string
  }

  async function insertBusiness(name: string, ownerId: string) {
    const { data, error } = await admin.from('businesses').insert({ name, owner_id: ownerId, plan: 'plus' }).select('id').single()
    if (error) throw error
    return data.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    ownerAId = await createUser('owner-a')
    ownerBId = await createUser('owner-b')
    businessAId = await insertBusiness('Triage Tools Business A', ownerAId)
    businessBId = await insertBusiness('Triage Tools Business B', ownerBId)

    // status: 'active' explicitly — governed_memory's DEFAULT is 'candidate'
    // (20260719010000_governed_memory.sql:34), and retrieveRelevant's
    // isEligible() (lib/memory/scoring.ts) filters to 'active' only.
    const { data: evA, error: evAErr } = await admin
      .from('evidence_memory')
      .insert({ business_id: businessAId, source: 'manual', scope: 'brand', status: 'active', kind: 'quote', content: 'Business A evidence' })
      .select('id')
      .single()
    if (evAErr) throw evAErr
    evidenceAId = evA.id

    const { data: evB, error: evBErr } = await admin
      .from('evidence_memory')
      .insert({ business_id: businessBId, source: 'manual', scope: 'brand', status: 'active', kind: 'quote', content: 'Business B evidence' })
      .select('id')
      .single()
    if (evBErr) throw evBErr
    evidenceBId = evB.id

    await admin
      .from('audience_memory')
      .insert({ business_id: businessAId, source: 'manual', scope: 'brand', status: 'active', kind: 'problem', statement: 'Business A audience note' })
    await admin
      .from('audience_memory')
      .insert({ business_id: businessBId, source: 'manual', scope: 'brand', status: 'active', kind: 'problem', statement: 'Business B audience note' })

    await admin
      .from('brand_memory')
      .insert({ business_id: businessAId, source: 'manual', scope: 'brand', status: 'active', category: 'positioning', statement: 'Business A brand claim' })
    await admin
      .from('brand_memory')
      .insert({ business_id: businessBId, source: 'manual', scope: 'brand', status: 'active', category: 'positioning', statement: 'Business B brand claim' })

    const { error: campAErr } = await admin.from('campaigns').insert({
      business_id: businessAId,
      name: 'Business A campaign',
      objective: 'Grow Business A',
      platforms: ['linkedin'],
      frequency: 'weekly',
      posts_per_week: 1,
      start_date: '2026-01-01',
      origin: 'manual',
    })
    if (campAErr) throw campAErr
    const { error: campBErr } = await admin.from('campaigns').insert({
      business_id: businessBId,
      name: 'Business B campaign',
      objective: 'Grow Business B',
      platforms: ['linkedin'],
      frequency: 'weekly',
      posts_per_week: 1,
      start_date: '2026-01-01',
      origin: 'manual',
    })
    if (campBErr) throw campBErr
  })

  afterAll(async () => {
    if (!admin) return
    for (const table of MEMORY_TABLES) {
      await admin.from(table).delete().eq('business_id', businessAId)
      await admin.from(table).delete().eq('business_id', businessBId)
    }
    await admin.from('campaigns').delete().eq('business_id', businessAId)
    await admin.from('campaigns').delete().eq('business_id', businessBId)
    if (businessAId) await admin.from('businesses').delete().eq('id', businessAId)
    if (businessBId) await admin.from('businesses').delete().eq('id', businessBId)
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it('SIGNAL3-TOOLS-TENANT-BOUND: list_evidence for business A returns zero business-B rows', async () => {
    const { buildTriageTools } = await import('@/lib/signals/triage/tools')
    const tools = buildTriageTools(admin, businessAId)
    const listEvidence = tools.find((t) => t.name === 'list_evidence')!
    const result = (await listEvidence.execute({})) as { ids: string[]; evidence: string }
    expect(result.ids).toContain(evidenceAId)
    expect(result.ids).not.toContain(evidenceBId)
    expect(result.evidence).toContain('Business A evidence')
    expect(result.evidence).not.toContain('Business B evidence')
  })

  it('SIGNAL3-TOOLS-TENANT-BOUND: list_evidence for business B returns zero business-A rows', async () => {
    const { buildTriageTools } = await import('@/lib/signals/triage/tools')
    const tools = buildTriageTools(admin, businessBId)
    const listEvidence = tools.find((t) => t.name === 'list_evidence')!
    const result = (await listEvidence.execute({})) as { ids: string[]; evidence: string }
    expect(result.ids).toContain(evidenceBId)
    expect(result.ids).not.toContain(evidenceAId)
    expect(result.evidence).toContain('Business B evidence')
    expect(result.evidence).not.toContain('Business A evidence')
  })

  it('SIGNAL3-TOOLS-TENANT-BOUND: list_audience_notes never leaks the other business', async () => {
    const { buildTriageTools } = await import('@/lib/signals/triage/tools')
    const toolsA = buildTriageTools(admin, businessAId)
    const result = (await toolsA.find((t) => t.name === 'list_audience_notes')!.execute({})) as Array<{
      id: string
      statement: string
    }>
    expect(result.some((r) => r.statement.includes('Business A audience note'))).toBe(true)
    expect(result.some((r) => r.statement.includes('Business B audience note'))).toBe(false)
  })

  it('SIGNAL3-TOOLS-TENANT-BOUND: list_brand_claims never leaks the other business', async () => {
    const { buildTriageTools } = await import('@/lib/signals/triage/tools')
    const toolsB = buildTriageTools(admin, businessBId)
    const result = (await toolsB.find((t) => t.name === 'list_brand_claims')!.execute({})) as Array<{
      id: string
      statement: string
    }>
    expect(result.some((r) => r.statement.includes('Business B brand claim'))).toBe(true)
    expect(result.some((r) => r.statement.includes('Business A brand claim'))).toBe(false)
  })

  it('SIGNAL3-TOOLS-TENANT-BOUND: list_recent_campaigns never leaks the other business', async () => {
    const { buildTriageTools } = await import('@/lib/signals/triage/tools')
    const toolsA = buildTriageTools(admin, businessAId)
    const result = (await toolsA.find((t) => t.name === 'list_recent_campaigns')!.execute({})) as Array<{
      id: string
      name: string
    }>
    expect(result.some((r) => r.name.includes('Business A campaign'))).toBe(true)
    expect(result.some((r) => r.name.includes('Business B campaign'))).toBe(false)
  })
})
