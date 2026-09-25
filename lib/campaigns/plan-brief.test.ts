import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/campaigns/planner/orchestrator', () => ({ runPlannerForCampaign: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({ setBriefPlanAnalysis: vi.fn(), getBriefByCampaign: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import { runPlannerForCampaign, type PlanAnalysisOutcome } from '@/lib/campaigns/planner/orchestrator'
import { setBriefPlanAnalysis, getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { planBrief } from './plan-brief'

// ADR 0027 §3.3 (Session 34 K2.7) — the persisted outcome. Fail-soft is safe ONLY because "unavailable" and
// "proposed nothing" are recorded distinctly; these tests assert against what is WRITTEN to the brief (the
// setBriefPlanAnalysis arguments — the persisted column), not against anything a component would receive.
//
// SHARED-FUNCTION CALLERS: planBrief has ONE production caller, lib/campaigns/prepare-brief.ts (K2.12), which createCampaignAction
// reaches on the request path; its wiring is tested in prepare-brief.test.ts and campaigns/new/actions.test.ts. K2.7 shipped it
// unwired and K2.12 wired it (ADR 0027 §V.8). A comment here once named the campaign-creation action as the direct caller; it
// calls prepareBriefForCampaign, not planBrief.

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

  // Session 34-D D10 (MINOR-3): the record has THREE outcomes and the two bad ones are separately alertable.
  it('a FAILED record is captured with phase plan-analysis-record-failed, and does not throw', async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcomes.proposedTwo)
    const err = new Error('update failed')
    vi.mocked(setBriefPlanAnalysis).mockRejectedValue(err)
    await expect(planBrief(client, CAMPAIGN_ID)).resolves.toBe(outcomes.proposedTwo)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { campaign_id: CAMPAIGN_ID, phase: 'plan-analysis-record-failed' },
    })
  })

  it('a NO-OP record (null: the not_run guard excluded the row) is captured with phase plan-analysis-record-noop and the status already there, and does not throw', async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcomes.proposedTwo)
    vi.mocked(setBriefPlanAnalysis).mockResolvedValue(null as never)
    vi.mocked(getBriefByCampaign).mockResolvedValue({ plan_analysis_status: 'ok' } as never)
    await expect(planBrief(client, CAMPAIGN_ID)).resolves.toBe(outcomes.proposedTwo)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    const [, hint] = vi.mocked(Sentry.captureException).mock.calls[0] as [unknown, { tags: Record<string, string> }]
    expect(hint.tags).toEqual({ campaign_id: CAMPAIGN_ID, phase: 'plan-analysis-record-noop', existing_status: 'ok' })
  })

  it('a no-op whose follow-up status read ALSO fails still does not throw, and reports existing_status unknown', async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcomes.proposedTwo)
    vi.mocked(setBriefPlanAnalysis).mockResolvedValue(null as never)
    vi.mocked(getBriefByCampaign).mockRejectedValue(new Error('read failed'))
    await expect(planBrief(client, CAMPAIGN_ID)).resolves.toBe(outcomes.proposedTwo)
    const [, hint] = vi.mocked(Sentry.captureException).mock.calls[0] as [unknown, { tags: Record<string, string> }]
    expect(hint.tags.phase).toBe('plan-analysis-record-noop')
    expect(hint.tags.existing_status).toBe('unknown')
  })

  it('a WRITTEN record captures nothing', async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcomes.proposedTwo)
    await planBrief(client, CAMPAIGN_ID)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('runs the planner with the caller client and the campaign id, once', async () => {
    vi.mocked(runPlannerForCampaign).mockResolvedValue(outcomes.proposedNothing)
    await planBrief(client, CAMPAIGN_ID)
    expect(runPlannerForCampaign).toHaveBeenCalledTimes(1)
    expect(runPlannerForCampaign).toHaveBeenCalledWith(client, CAMPAIGN_ID)
  })
})
