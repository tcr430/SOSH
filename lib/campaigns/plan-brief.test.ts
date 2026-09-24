import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/campaigns/planner/orchestrator', () => ({ runPlannerForCampaign: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({ setBriefPlanAnalysis: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import { runPlannerForCampaign, type PlanAnalysisOutcome } from '@/lib/campaigns/planner/orchestrator'
import { setBriefPlanAnalysis } from '@/lib/db/campaign-briefs'
import { planBrief } from './plan-brief'

// ADR 0027 §3.3 (Session 34 K2.7) — the persisted outcome. Fail-soft is safe ONLY because "unavailable" and
// "proposed nothing" are recorded distinctly; these tests assert against what is WRITTEN to the brief (the
// setBriefPlanAnalysis arguments — the persisted column), not against anything a component would receive.
//
// SHARED-FUNCTION CALLERS: planBrief has NO production caller today. K2.7 shipped it unwired by user ruling (the ADR's
// "brief surface" that was to call assembleBrief does not exist; only the two worker callers do, and ruling A-8 excludes
// them), so its only callers are this file and lib/campaigns/planner/__tests__/gates-unchanged.test.ts. A comment here
// previously named the campaign-creation action as the caller; it does not call planBrief (corrected at K2.11).

const client = {} as SupabaseClient
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'

const outcomes: Record<string, PlanAnalysisOutcome> = {
  proposedNothing: { status: 'ok', reason: null, proposalCount: 0, droppedCount: 0 },
  proposedTwo: { status: 'ok', reason: null, proposalCount: 2, droppedCount: 0 },
  unavailable: { status: 'unavailable', reason: 'wall_clock_exceeded', proposalCount: 0, droppedCount: 0 },
  capped: { status: 'capped', reason: 'daily_cap', proposalCount: 0, droppedCount: 0 },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(setBriefPlanAnalysis).mockResolvedValue({} as never)
})

describe('planBrief persists the planner outcome on the brief', () => {
  it.each(Object.entries(outcomes))('records %s exactly as the planner reported it', async (_name, outcome) => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcome)
    const returned = await planBrief(client, CAMPAIGN_ID)
    expect(returned).toBe(outcome)
    expect(setBriefPlanAnalysis).toHaveBeenCalledWith(client, CAMPAIGN_ID, { status: outcome.status, reason: outcome.reason })
  })

  it("'unavailable' and 'proposed nothing' are recorded as DIFFERENT persisted statuses", async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValueOnce(outcomes.proposedNothing)
    await planBrief(client, CAMPAIGN_ID)
    vi.mocked(runPlannerForCampaign).mockResolvedValueOnce(outcomes.unavailable)
    await planBrief(client, CAMPAIGN_ID)
    const [first, second] = vi.mocked(setBriefPlanAnalysis).mock.calls.map((c) => c[2])
    expect(first.status).toBe('ok')
    expect(second.status).toBe('unavailable')
    expect(second.reason).toBe('wall_clock_exceeded')
    expect(first).not.toEqual(second)
  })

  it('a failure to RECORD the outcome does not throw — fail-soft extends to the bookkeeping', async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcomes.proposedTwo)
    vi.mocked(setBriefPlanAnalysis).mockRejectedValue(new Error('update failed'))
    await expect(planBrief(client, CAMPAIGN_ID)).resolves.toBe(outcomes.proposedTwo)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('runs the planner with the caller client and the campaign id, once', async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcomes.proposedNothing)
    await planBrief(client, CAMPAIGN_ID)
    expect(runPlannerForCampaign).toHaveBeenCalledTimes(1)
    expect(runPlannerForCampaign).toHaveBeenCalledWith(client, CAMPAIGN_ID)
  })
})
