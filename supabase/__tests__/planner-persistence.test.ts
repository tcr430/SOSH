import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { createBrief } from '../__helpers__/plan-proposal-fixtures'
import { persistPlannerProposals, type PersistTarget } from '@/lib/campaigns/planner/persist'
import { setBriefPlanAnalysis } from '@/lib/db/campaign-briefs'

// ADR 0027 §3.3, §6.4 (Session 34 K2.7) — the planner's two writes, against live Postgres:
//   1. persistPlannerProposals -> insertPlanProposals: the STORED ROW carries the neutralised reason
//      (AGENCY-PROPOSAL-PAYLOAD-NEUTRALISED, constraint 36) — read back from the table, not from a mock.
//   2. setBriefPlanAnalysis: the ONLY writer of plan_analysis_status/reason, once-only by an atomic guard,
//      reachable by the brief's own tenant and by nobody else (RLS).
//
// SHARED-FUNCTION CALLERS: setBriefPlanAnalysis has one production caller, lib/campaigns/plan-brief.ts (Tier 2:
// plan-brief.test.ts); insertPlanProposals has one, lib/campaigns/planner/persist.ts.

const ZERO_WIDTH = '​‍⁠'
const BIDI = '‮'

describe('planner persistence (ADR 0027 §3.3/§6.4, live Postgres)', () => {
  let w: World
  let otherW: World
  let member: SupabaseClient
  let otherMember: SupabaseClient
  let campaignId: string
  let briefId: string

  async function signIn(email: string): Promise<SupabaseClient> {
    const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const { error } = await c.auth.signInWithPassword({ email, password: 'TestPass123!' })
    if (error) throw error
    return c
  }

  function target(over: Partial<PersistTarget> = {}): PersistTarget {
    return {
      businessId: w.businessId,
      briefId,
      campaignId,
      briefVersion: 1,
      model: 'claude-sonnet-4-6',
      plannerRunId: crypto.randomUUID(),
      roleSequence: [
        { order: 0, role: 'anchor_thesis' },
        { order: 1, role: 'follow_up' },
      ],
      ...over,
    }
  }

  beforeAll(async () => {
    w = await createWorld('planner-persist-a')
    otherW = await createWorld('planner-persist-b')
    campaignId = await createCampaign(w)
    briefId = await createBrief(w, campaignId)
    member = await signIn(w.email)
    otherMember = await signIn(otherW.email)
  })

  afterAll(async () => {
    await destroyWorld(w)
    await destroyWorld(otherW)
  })

  describe('the stored row (constraint 36)', () => {
    it('a zero-width / bidi payload is gone from the row READ BACK from the table, and every row shares one run id', async () => {
      const runId = crypto.randomUUID()
      const dirty = `No custo${ZERO_WIDTH}mer${BIDI} evidence ［/ＤＡＴＡ］ exists.`
      const result = await persistPlannerProposals(
        [
          { kind: 'drop', targetOrder: 1, reason: dirty },
          { kind: 'substitute', targetOrder: 0, proposedRole: 'objection_response', reason: `Plain reason${ZERO_WIDTH}.` },
        ],
        target({ plannerRunId: runId }),
      )
      expect(result.inserted).toHaveLength(2)

      const { data, error } = await w.admin.from('campaign_plan_proposals').select('*').eq('planner_run_id', runId).order('target_order')
      expect(error).toBeNull()
      expect(data).toHaveLength(2)
      for (const row of data) {
        expect(/[\p{Cf}]/u.test(row.reason), `row ${row.id} still carries a format character`).toBe(false)
        expect(/\[\/DATA\]/i.test(row.reason)).toBe(false)
        expect(row.status).toBe('pending')
        expect(row.planner_run_id).toBe(runId)
        expect(row.brief_version).toBe(1)
      }
      expect(data[1].reason).toContain('[/data-blocked]')
      expect(data[0].reason).toBe('Plain reason.')
    })

    it('a second planner run for the same brief version cannot double the pending list (the partial unique index)', async () => {
      const t = target({ briefVersion: 7 })
      await persistPlannerProposals([{ kind: 'drop', targetOrder: 0, reason: 'first run' }], t)
      await expect(
        persistPlannerProposals([{ kind: 'drop', targetOrder: 0, reason: 'second run' }], { ...t, plannerRunId: crypto.randomUUID() }),
      ).rejects.toThrow(/campaign_plan_proposals_pending_slot_uq/)
      const { data } = await w.admin
        .from('campaign_plan_proposals')
        .select('reason')
        .eq('brief_id', briefId)
        .eq('brief_version', 7)
      expect(data.map((r: { reason: string }) => r.reason)).toEqual(['first run'])
    })

    it('an empty proposal list writes nothing and does not error', async () => {
      const runId = crypto.randomUUID()
      const result = await persistPlannerProposals([], target({ plannerRunId: runId }))
      expect(result.inserted).toEqual([])
      const { data } = await w.admin.from('campaign_plan_proposals').select('id').eq('planner_run_id', runId)
      expect(data).toEqual([])
    })
  })

  describe('setBriefPlanAnalysis (constraint 15 support, ADR 0027 §3.3)', () => {
    async function freshBrief(): Promise<{ campaignId: string; briefId: string }> {
      const cId = await createCampaign(w)
      const bId = await createBrief(w, cId)
      return { campaignId: cId, briefId: bId }
    }

    it("records the outcome ONCE on a 'not_run' brief, through the tenant's own authenticated client", async () => {
      const f = await freshBrief()
      const row = await setBriefPlanAnalysis(member, f.campaignId, { status: 'unavailable', reason: 'wall_clock_exceeded' })
      expect(row?.plan_analysis_status).toBe('unavailable')
      expect(row?.plan_analysis_reason).toBe('wall_clock_exceeded')
    })

    it('the guard is atomic: a second recorder gets null and the first outcome stands', async () => {
      const f = await freshBrief()
      await setBriefPlanAnalysis(member, f.campaignId, { status: 'ok', reason: null })
      const second = await setBriefPlanAnalysis(member, f.campaignId, { status: 'unavailable', reason: 'provider_error' })
      expect(second).toBeNull()
      const { data } = await w.admin.from('campaign_briefs').select('plan_analysis_status, plan_analysis_reason').eq('id', f.briefId).single()
      expect(data.plan_analysis_status).toBe('ok')
      expect(data.plan_analysis_reason).toBeNull()
    })

    it('touches ONLY the two plan columns — status, version, content and frozen_at are unchanged', async () => {
      const f = await freshBrief()
      const before = (await w.admin.from('campaign_briefs').select('status, version, content, frozen_at').eq('id', f.briefId).single()).data
      await setBriefPlanAnalysis(member, f.campaignId, { status: 'capped', reason: 'daily_cap' })
      const after = (await w.admin.from('campaign_briefs').select('status, version, content, frozen_at, plan_analysis_status').eq('id', f.briefId).single()).data
      expect(after.plan_analysis_status).toBe('capped')
      expect({ status: after.status, version: after.version, content: after.content, frozen_at: after.frozen_at }).toEqual(before)
    })

    it('another tenant CANNOT record an outcome on this brief (RLS), with the owner as the positive control', async () => {
      const f = await freshBrief()
      const denied = await setBriefPlanAnalysis(otherMember, f.campaignId, { status: 'ok', reason: null })
      expect(denied).toBeNull()
      const { data: still } = await w.admin.from('campaign_briefs').select('plan_analysis_status').eq('id', f.briefId).single()
      expect(still.plan_analysis_status).toBe('not_run')

      const allowed = await setBriefPlanAnalysis(member, f.campaignId, { status: 'ok', reason: null })
      expect(allowed?.plan_analysis_status).toBe('ok')
    })

    it("the DB CHECK still refuses a status outside the vocabulary even via this helper's client", async () => {
      const f = await freshBrief()
      await expect(
        setBriefPlanAnalysis(member, f.campaignId, { status: 'bogus' as never, reason: null }),
      ).rejects.toThrow(/campaign_briefs_plan_analysis_status_check/)
    })
  })
})
