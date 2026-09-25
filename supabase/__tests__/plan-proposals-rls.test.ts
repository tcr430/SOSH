import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §9.2 (K2.5) — AGENCY-RLS-ISOLATED, constraint 45. The outcome_tables.sql posture:
// exactly one authenticated SELECT policy, no authenticated write grant at all (decide/apply/
// supersede all go through the K2.6 RPCs), service-role INSERT succeeds, anon sees nothing.

describe('campaign_plan_proposals RLS (ADR 0027 §9.2, constraint 45, live Postgres)', () => {
  let w: World
  let otherW: World
  let member: SupabaseClient
  let anon: SupabaseClient
  let pg: Client
  let briefId: string
  let campaignId: string
  let proposalId: string

  beforeAll(async () => {
    w = await createWorld('plan-rls-a')
    otherW = await createWorld('plan-rls-b')
    campaignId = await createCampaign(w)
    briefId = await createBrief(w, campaignId)
    const { data, error } = await insertProposal(w, { briefId, campaignId })
    if (error) throw error
    proposalId = data.id

    member = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const { error: signInErr } = await member.auth.signInWithPassword({ email: w.email, password: 'TestPass123!' })
    if (signInErr) throw signInErr

    anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    pg = new Client({ connectionString: url })
    await pg.connect()
  })

  afterAll(async () => {
    await destroyWorld(w)
    await destroyWorld(otherW)
    await pg?.end()
  })

  it('service-role INSERT succeeds', async () => {
    const otherCampaignId = await createCampaign(otherW)
    const otherBriefId = await createBrief(otherW, otherCampaignId)
    const { error } = await insertProposal(otherW, { briefId: otherBriefId, campaignId: otherCampaignId })
    expect(error).toBeNull()
  })

  it('tenant A cannot SELECT tenant B rows, but can SELECT its own', async () => {
    const { data: own } = await member.from('campaign_plan_proposals').select('id').eq('id', proposalId)
    expect(own).toHaveLength(1)

    const { data: crossTenant } = await member.from('campaign_plan_proposals').select('id').eq('business_id', otherW.businessId)
    expect(crossTenant ?? []).toHaveLength(0)
  })

  it('authenticated INSERT fails 42501', async () => {
    const { error } = await member.from('campaign_plan_proposals').insert({
      business_id: w.businessId,
      brief_id: briefId,
      campaign_id: campaignId,
      brief_version: 1,
      kind: 'drop',
      target_order: 1,
      reason: 'authenticated attempt',
      planner_run_id: crypto.randomUUID(),
      model: 'claude-sonnet-5',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('authenticated UPDATE fails 42501', async () => {
    const { error } = await member.from('campaign_plan_proposals').update({ reason: 'rewritten' }).eq('id', proposalId)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('authenticated DELETE fails 42501', async () => {
    const { error } = await member.from('campaign_plan_proposals').delete().eq('id', proposalId)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('authenticated has no INSERT/UPDATE/DELETE/TRUNCATE grant at the Postgres level', async () => {
    const { rows } = await pg.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'campaign_plan_proposals' AND grantee = 'authenticated'`,
    )
    const privileges = rows.map((r) => r.privilege_type)
    expect(privileges).not.toContain('INSERT')
    expect(privileges).not.toContain('UPDATE')
    expect(privileges).not.toContain('DELETE')
    expect(privileges).not.toContain('TRUNCATE')
    expect(privileges).toContain('SELECT')
  })

  it('anon sees nothing — denied at the grant level (REVOKE ALL FROM anon), stronger than an RLS-filtered empty result', async () => {
    const { data, error } = await anon.from('campaign_plan_proposals').select('id')
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })
})
