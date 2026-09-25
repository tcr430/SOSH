import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief, insertProposal } from '../__helpers__/plan-proposal-fixtures'
import { listCurrentVersionPlanProposals } from '@/lib/db/campaign-plan-proposals'

// ADR 0027 §8.2/§8.5 — Session 34-D D10 (MINOR-7), against LIVE Postgres. The brief page reads the CURRENT VERSION's
// proposals in every status (decided and 'brief_frozen' rows must render), bounded and ordered target_order,
// created_at, id — which is exactly campaign_plan_proposals_brief_version_idx (D5's non-partial index). The former read
// filtered by brief_id alone, so an earlier version's rows reached the screen (BLOCKER-1's stale rows were
// selectable). Two properties are proved here: WHAT is returned (the real function) and HOW it is executed (EXPLAIN).

describe('the brief page read: current version, every status, on the index (ADR 0027 §8.2, MINOR-7, live Postgres)', () => {
  let w: World
  let pg: Client
  let campaignId: string
  let briefId: string

  beforeAll(async () => {
    w = await createWorld('plan-current-version')
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
    campaignId = await createCampaign(w)
    // A brief now at version 2: a round already advanced it, so version-1 proposals are history.
    briefId = await createBrief(w, campaignId, { status: 'critiqued', version: 2, content: { roleSequence: [] } })
  })

  afterAll(async () => {
    await pg?.end()
    await destroyWorld(w)
  })

  const seed = async (spec: Parameters<typeof insertProposal>[1]) => {
    const { data, error } = await insertProposal(w, spec)
    if (error) throw error
    return data.id as string
  }

  it('returns ONLY the current version, in EVERY status, ordered target_order then created_at then id', async () => {
    const staleV1Pending = await seed({ briefId, campaignId, briefVersion: 1, kind: 'drop', targetOrder: 0, status: 'pending' })
    const staleV1Superseded = await seed({ briefId, campaignId, briefVersion: 1, kind: 'drop', targetOrder: 1, status: 'superseded', superseded_reason: 'version_advanced' })
    const v2Pending = await seed({ briefId, campaignId, briefVersion: 2, kind: 'drop', targetOrder: 2, status: 'pending' })
    const v2Rejected = await seed({ briefId, campaignId, briefVersion: 2, kind: 'drop', targetOrder: 0, status: 'rejected', decidedBy: w.userId, decidedAt: new Date().toISOString() })
    const v2Frozen = await seed({ briefId, campaignId, briefVersion: 2, kind: 'drop', targetOrder: 1, status: 'superseded', superseded_reason: 'brief_frozen' })

    const rows = await listCurrentVersionPlanProposals(w.admin, briefId, 2)
    const ids = rows.map((r) => r.id)

    // current version only — the two version-1 rows (one of them still PENDING) are absent
    expect(ids).not.toContain(staleV1Pending)
    expect(ids).not.toContain(staleV1Superseded)
    expect(rows.every((r) => r.brief_version === 2)).toBe(true)
    // every status of the current version renders (§8.2's decided and brief_frozen states)
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['pending', 'rejected', 'superseded']))
    expect(rows.find((r) => r.id === v2Frozen)?.superseded_reason).toBe('brief_frozen')
    // ORDER BY target_order, created_at, id
    expect(ids).toEqual([v2Rejected, v2Frozen, v2Pending])
    expect(rows.map((r) => r.target_order)).toEqual([0, 1, 2])
  })

  it("a version with no proposals reads as an empty list (never another version's rows)", async () => {
    expect(await listCurrentVersionPlanProposals(w.admin, briefId, 3)).toEqual([])
  })

  it('is bounded: an explicit limit caps the read', async () => {
    const rows = await listCurrentVersionPlanProposals(w.admin, briefId, 2, 1)
    expect(rows).toHaveLength(1)
  })

  it("EXPLAIN: the page's predicate and ORDER BY use campaign_plan_proposals_brief_version_idx and need NO sort", async () => {
    await pg.query('BEGIN')
    try {
      // The table is tiny, so the planner would seq-scan it; turning that off asks the planner which INDEX it would
      // choose, which is the question (does an index match the predicate AND the order?).
      await pg.query('SET LOCAL enable_seqscan = off')
      const { rows } = await pg.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT * FROM public.campaign_plan_proposals
          WHERE brief_id = $1 AND brief_version = $2
          ORDER BY target_order ASC, created_at ASC, id ASC
          LIMIT 50`,
        [briefId, 2],
      )
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n')
      expect(plan, plan).toContain('campaign_plan_proposals_brief_version_idx')
      expect(plan, plan).not.toMatch(/\bSort\b/)
    } finally {
      await pg.query('ROLLBACK')
    }
  })
})
