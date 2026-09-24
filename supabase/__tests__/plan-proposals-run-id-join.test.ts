import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief } from '../__helpers__/plan-proposal-fixtures'

// ADR 0027 §5.3 — AGENCY-PROPOSAL-PROVENANCE, Session 34-D D8 (MAJOR-4). planner_run_id is "the ai_usage row the
// spend belongs to" ([db-MAJOR-B]: "without a run id, planner_cents spend has no row linking it to what it
// bought"). The earlier Tier-1 test proved only NOT NULL. This one proves the LINK: the planner mints the id, the
// loop's ONE ai_usage row is inserted under it (runToolLoop's `usageId`), and every proposal persisted for that run
// carries the same value — so a plain join returns each proposal's spend. No FK (the decision table names it the
// loser); the join is by value.
//
// Both real writers are used: recordAiUsage (what runToolLoop's finally block calls, with the id) and
// persistPlannerProposals (what the orchestrator calls, with the same id).

const ROLE_SEQ = [
  { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'a0' },
  { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'a1' },
  { order: 2, role: 'follow_up', platform: 'linkedin', angle: 'a2' },
]

describe('campaign_plan_proposals JOIN ai_usage ON planner_run_id = ai_usage.id (ADR 0027 §5.3, live Postgres)', () => {
  let w: World
  let pg: Client

  beforeAll(async () => {
    w = await createWorld('plan-run-id-join')
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
  })

  afterAll(async () => {
    await pg?.end()
    await destroyWorld(w)
  })

  async function persistRun(runId: string) {
    const { recordAiUsage } = await import('@/lib/db/ai-usage')
    const { persistPlannerProposals } = await import('@/lib/campaigns/planner/persist')
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, { status: 'draft', content: { roleSequence: ROLE_SEQ } })

    // What runToolLoop's finally block does when handed `usageId`: ONE row, under the caller's id.
    await recordAiUsage({
      id: runId,
      business_id: w.businessId,
      prompt_id: 'campaign-planner',
      prompt_version: 1,
      model: 'claude-sonnet-5',
      input_tokens: 1200,
      output_tokens: 300,
      cost_cents: 7,
      latency_ms: 4200,
      success: true,
      error_code: null,
    })

    // What the orchestrator does with the SAME id after the loop.
    const { inserted } = await persistPlannerProposals(
      [
        { kind: 'drop', targetOrder: 1, reason: 'No customer evidence exists.' },
        { kind: 'drop', targetOrder: 2, reason: 'Nothing supports the follow-up.' },
      ],
      { businessId: w.businessId, briefId, campaignId, briefVersion: 1, model: 'claude-sonnet-5', plannerRunId: runId, roleSequence: ROLE_SEQ as never },
    )
    return { briefId, insertedCount: inserted.length }
  }

  it('the join returns EVERY proposal of the run, each with the ai_usage row it was bought by', async () => {
    const runId = crypto.randomUUID()
    const { briefId, insertedCount } = await persistRun(runId)
    expect(insertedCount).toBe(2)

    const { rows } = await pg.query<{ proposal_id: string; usage_id: string; cost_cents: number; prompt_id: string }>(
      `SELECT p.id AS proposal_id, u.id AS usage_id, u.cost_cents, u.prompt_id
         FROM public.campaign_plan_proposals p
         JOIN public.ai_usage u ON u.id = p.planner_run_id
        WHERE p.brief_id = $1
        ORDER BY p.target_order`,
      [briefId],
    )
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.usage_id).toBe(runId)
      expect(row.prompt_id).toBe('campaign-planner')
      expect(Number(row.cost_cents)).toBe(7)
    }
  })

  it('a proposal whose run id was NOT written as an ai_usage row does NOT join — the old crypto.randomUUID() shape (the defect)', async () => {
    const { persistPlannerProposals } = await import('@/lib/campaigns/planner/persist')
    const campaignId = await createCampaign(w)
    const briefId = await createBrief(w, campaignId, { status: 'draft', content: { roleSequence: ROLE_SEQ } })
    await persistPlannerProposals([{ kind: 'drop', targetOrder: 1, reason: 'r' }], {
      businessId: w.businessId,
      briefId,
      campaignId,
      briefVersion: 1,
      model: 'claude-sonnet-5',
      plannerRunId: crypto.randomUUID(), // minted and never given to the loop: no ai_usage row carries it
      roleSequence: ROLE_SEQ as never,
    })
    const { rows } = await pg.query(
      `SELECT 1 FROM public.campaign_plan_proposals p JOIN public.ai_usage u ON u.id = p.planner_run_id WHERE p.brief_id = $1`,
      [briefId],
    )
    expect(rows).toHaveLength(0)
  })
})
