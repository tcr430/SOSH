import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { server: { AI_PLANNER_DAILY_CAP_CENTS: 300 } } }))
vi.mock('@/lib/ai/client', () => ({ getAnthropicClient: vi.fn() }))
vi.mock('@/lib/db/ai-usage', () => ({ recordAiUsage: vi.fn(), countRecentCalls: vi.fn() }))
vi.mock('@/lib/ai/tool-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/tool-runner')>()
  return { ...actual, runToolLoop: vi.fn() }
})
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn() }))
vi.mock('@/lib/db/campaigns', () => ({ getCampaignById: vi.fn() }))
vi.mock('@/lib/db/campaign-briefs', () => ({ getBriefByCampaign: vi.fn() }))
vi.mock('@/lib/db/planner-budget', () => ({ reservePlannerBudget: vi.fn(), reconcilePlannerBudget: vi.fn() }))
vi.mock('@/lib/db/campaign-plan-proposals', () => ({ insertPlanProposals: vi.fn() }))
vi.mock('../tools', () => ({ buildPlannerTools: vi.fn() }))

import * as Sentry from '@sentry/nextjs'
import { PLAN_ANALYSIS_REASONS } from '@/lib/db/types'
import { runToolLoop, TOOL_LOOP_FAILURE_REASONS, type ToolLoopFailureReason } from '@/lib/ai/tool-runner'
import { MODELS } from '@/lib/ai/models'
import { buildCustomerContext } from '@/lib/ai/context'
import { getCampaignById } from '@/lib/db/campaigns'
import { getBriefByCampaign } from '@/lib/db/campaign-briefs'
import { reservePlannerBudget, reconcilePlannerBudget } from '@/lib/db/planner-budget'
import { insertPlanProposals } from '@/lib/db/campaign-plan-proposals'
import { PlannerDecisionSchema, PLANNER_PROMPT_ID, PLANNER_PROMPT_VERSION } from '@/lib/ai/prompts/campaign-planner'
import { buildPlannerTools } from '../tools'
import {
  AI_PLANNER_MAX_TOOL_CALLS,
  AI_PLANNER_MAX_TURNS,
  AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS,
  AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN,
  AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS,
  AI_PLANNER_MAX_WALL_CLOCK_MS,
  AI_PLANNER_RETRY_BUDGET,
  PLANNER_RESERVATION_CENTS,
} from '../constants'
import { runPlannerForCampaign, PLAN_STATUS_FOR_LOOP_FAILURE } from '../orchestrator'

// ADR 0027 §2.2/§3.2/§3.3/§7.2/§7.4 (Session 34 K2.7) — the orchestrator's Tier-2 behaviour.
//
// SHARED-FUNCTION CALLERS (ADR 0015): runPlannerForCampaign has exactly ONE production caller,
// lib/campaigns/plan-brief.ts:planBrief (tested in lib/campaigns/plan-brief.test.ts). runToolLoop's loop
// behaviour under the planner's bounds is exercised by lib/ai/tool-runner-generic.test.ts; here it is mocked and
// the assertions are about what the ORCHESTRATOR hands it and what it does with what comes back.

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'
const BRIEF_ID = '33333333-3333-4333-8333-333333333333'

const client = {} as SupabaseClient

const campaign = {
  id: CAMPAIGN_ID,
  business_id: BUSINESS_ID,
  objective: 'Launch the new integrations',
  platforms: ['linkedin'],
  voice_variation_id: null,
}
const brief = {
  id: BRIEF_ID,
  business_id: BUSINESS_ID,
  campaign_id: CAMPAIGN_ID,
  version: 2,
  content: {
    narrative: 'Integrations save time.',
    proofPlan: 'Cite a customer.',
    pinnedEvidence: [],
    roleSequence: [
      { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the thesis' },
      { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'a customer story' },
      { order: 2, role: 'follow_up', platform: 'linkedin', angle: 'next steps' },
    ],
  },
}
const mockContext = { business: { id: BUSINESS_ID, name: 'Acme', language: 'en' }, trialState: null }
const COST = 7

function decisionResult(proposals: unknown[]) {
  return { outcome: 'decision' as const, decision: { proposals }, costCents: COST }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getCampaignById).mockResolvedValue(campaign as never)
  vi.mocked(getBriefByCampaign).mockResolvedValue(brief as never)
  vi.mocked(reservePlannerBudget).mockResolvedValue({} as never)
  vi.mocked(reconcilePlannerBudget).mockResolvedValue({} as never)
  vi.mocked(buildCustomerContext).mockResolvedValue(mockContext as never)
  vi.mocked(buildPlannerTools).mockReturnValue([])
  vi.mocked(insertPlanProposals).mockImplementation(async (rows) => rows as never)
})

function loopInput() {
  return vi.mocked(runToolLoop).mock.calls[0][0]
}

describe('AGENCY-LOOP-BOUNDED — the orchestrator hands the loop exactly the ADR §3.2 bounds (constraint 12)', () => {
  // One reddenable case per bound, IMPORTING the exported constants — never a literal. Editing a constant, or the
  // orchestrator's use of it, reddens exactly the named bound.
  const BOUND_CASES: Array<[string, number]> = [
    ['maxToolCalls', AI_PLANNER_MAX_TOOL_CALLS],
    ['maxTurns', AI_PLANNER_MAX_TURNS],
    ['maxCumulativeInputTokens', AI_PLANNER_MAX_CUMULATIVE_INPUT_TOKENS],
    ['maxOutputTokensPerTurn', AI_PLANNER_MAX_OUTPUT_TOKENS_PER_TURN],
    ['maxCumulativeOutputTokens', AI_PLANNER_MAX_CUMULATIVE_OUTPUT_TOKENS],
    ['maxWallClockMs', AI_PLANNER_MAX_WALL_CLOCK_MS],
    ['retryBudget', AI_PLANNER_RETRY_BUDGET],
  ]

  it.each(BOUND_CASES)('bound %s is the imported constant', async (key, expected) => {
    vi.mocked(runToolLoop).mockResolvedValue(decisionResult([]) as never)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    const bounds = loopInput().bounds as unknown as Record<string, number>
    expect(bounds[key]).toBe(expected)
  })

  it('passes ONLY the seven bounds — no eighth key rides along', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(decisionResult([]) as never)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(Object.keys(loopInput().bounds as object).sort()).toEqual(BOUND_CASES.map((c) => c[0]).sort())
  })

  it('uses its OWN prompt id/version/model, the strict planner schema, and is trial-exempt (AGENCY-PLANNER-TRIAL-EXEMPT)', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(decisionResult([]) as never)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    const input = loopInput()
    expect(input.promptId).toBe(PLANNER_PROMPT_ID)
    expect(input.promptId).not.toBe('signal-triage')
    expect(input.promptVersion).toBe(PLANNER_PROMPT_VERSION)
    expect(input.model).toBe('SONNET_4_6')
    expect(input.enforceTrialQuota).toBe(false)
    expect(input.outputSchema).toBe(PlannerDecisionSchema)
  })
})

describe('AGENCY-TOOLS-ONCE-PER-CAMPAIGN — Tier 2 half (constraint 8)', () => {
  it('builds the tools exactly once per campaign, bound to the caller client, business and campaign', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(decisionResult([]) as never)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(buildPlannerTools).toHaveBeenCalledTimes(1)
    expect(buildPlannerTools).toHaveBeenCalledWith(client, BUSINESS_ID, CAMPAIGN_ID)
    expect(runToolLoop).toHaveBeenCalledTimes(1)
  })
})

describe('AGENCY-BOUND-FAILURE-DEFINED — the eleven-outcome mapping (constraint 13)', () => {
  it('maps EXACTLY the eleven runtime reasons, every one to unavailable, none to ok', () => {
    expect(TOOL_LOOP_FAILURE_REASONS).toHaveLength(11)
    expect(Object.keys(PLAN_STATUS_FOR_LOOP_FAILURE).sort()).toEqual([...TOOL_LOOP_FAILURE_REASONS].sort())
    for (const reason of TOOL_LOOP_FAILURE_REASONS) {
      expect(PLAN_STATUS_FOR_LOOP_FAILURE[reason], reason).toBe('unavailable')
      expect(PLAN_STATUS_FOR_LOOP_FAILURE[reason], reason).not.toBe('ok')
    }
  })

  it.each([...TOOL_LOOP_FAILURE_REASONS])(
    'loop failure %s: outcome unavailable + that reason, ZERO proposals, reservation reconciled to actual cost',
    async (reason: ToolLoopFailureReason) => {
      vi.mocked(runToolLoop).mockResolvedValue({ outcome: 'failed', reason, costCents: COST } as never)
      const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
      expect(outcome).toEqual({ status: 'unavailable', reason, proposalCount: 0, droppedCount: 0 })
      expect(insertPlanProposals).not.toHaveBeenCalled()
      // the orchestrator.ts:137 shape, on the FAILURE outcome too — a failed loop still burned tokens.
      expect(reconcilePlannerBudget).toHaveBeenCalledWith(BUSINESS_ID, PLANNER_RESERVATION_CENTS, COST)
    },
  )

  it("'unavailable' is distinguishable from 'proposed nothing' — both write zero rows, the STATUS differs", async () => {
    vi.mocked(runToolLoop).mockResolvedValueOnce(decisionResult([]) as never)
    const proposedNothing = await runPlannerForCampaign(client, CAMPAIGN_ID)
    vi.mocked(runToolLoop).mockResolvedValueOnce({ outcome: 'failed', reason: 'provider_error', costCents: 0 } as never)
    const failed = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(proposedNothing.status).toBe('ok')
    expect(proposedNothing.reason).toBeNull()
    expect(failed.status).toBe('unavailable')
    expect(failed.status).not.toBe(proposedNothing.status)
    expect(proposedNothing.proposalCount).toBe(0)
    expect(failed.proposalCount).toBe(0)
  })
})

describe('reservation, reconciliation and the cap (ADR 0027 §7.4)', () => {
  it('reserves 24 cents against the configured daily cap BEFORE calling the model', async () => {
    const order: string[] = []
    vi.mocked(reservePlannerBudget).mockImplementation(async () => {
      order.push('reserve')
      return {} as never
    })
    vi.mocked(runToolLoop).mockImplementation(async () => {
      order.push('loop')
      return decisionResult([]) as never
    })
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(PLANNER_RESERVATION_CENTS).toBe(24)
    expect(reservePlannerBudget).toHaveBeenCalledWith(BUSINESS_ID, 24, 300)
    expect(order).toEqual(['reserve', 'loop'])
  })

  it('reconciles the SUCCESS outcome to actual spend too', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(decisionResult([]) as never)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(reconcilePlannerBudget).toHaveBeenCalledTimes(1)
    expect(reconcilePlannerBudget).toHaveBeenCalledWith(BUSINESS_ID, PLANNER_RESERVATION_CENTS, COST)
  })

  it("at the cap the run is 'capped': the model is never called, nothing is reconciled, nothing is written, and it does not throw", async () => {
    vi.mocked(reservePlannerBudget).mockResolvedValue(null)
    const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(outcome).toEqual({ status: 'capped', reason: 'daily_cap', proposalCount: 0, droppedCount: 0 })
    expect(runToolLoop).not.toHaveBeenCalled()
    expect(buildPlannerTools).not.toHaveBeenCalled()
    expect(reconcilePlannerBudget).not.toHaveBeenCalled()
    expect(insertPlanProposals).not.toHaveBeenCalled()
  })

  it('a reconcile failure does not discard a good plan', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(
      decisionResult([{ kind: 'drop', targetOrder: 1, reason: 'No customer evidence exists.' }]) as never,
    )
    vi.mocked(reconcilePlannerBudget).mockRejectedValue(new Error('rpc down'))
    const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(outcome.status).toBe('ok')
    expect(outcome.proposalCount).toBe(1)
  })
})

describe('fail-soft: the orchestrator never throws (ADR 0027 §3.3)', () => {
  it('a failure BEFORE the loop returns gives the reservation back (0 spent) and reports internal_error', async () => {
    vi.mocked(buildCustomerContext).mockRejectedValue(new Error('context build failed'))
    const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(outcome).toEqual({ status: 'unavailable', reason: 'internal_error', proposalCount: 0, droppedCount: 0 })
    expect(runToolLoop).not.toHaveBeenCalled()
    expect(reconcilePlannerBudget).toHaveBeenCalledTimes(1)
    expect(reconcilePlannerBudget).toHaveBeenCalledWith(BUSINESS_ID, PLANNER_RESERVATION_CENTS, 0)
  })

  it('a persistence failure after the loop does NOT refund the reservation a second time', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(
      decisionResult([{ kind: 'drop', targetOrder: 1, reason: 'No customer evidence exists.' }]) as never,
    )
    vi.mocked(insertPlanProposals).mockRejectedValue(new Error('insert failed'))
    const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(outcome.status).toBe('unavailable')
    expect(outcome.reason).toBe('internal_error')
    // exactly ONE reconcile, with the ACTUAL cost — a second call with 0 would double-refund the day's budget.
    expect(reconcilePlannerBudget).toHaveBeenCalledTimes(1)
    expect(reconcilePlannerBudget).toHaveBeenCalledWith(BUSINESS_ID, PLANNER_RESERVATION_CENTS, COST)
  })

  it('a missing brief is unavailable/no_brief, before anything is reserved', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(null)
    const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(outcome).toEqual({ status: 'unavailable', reason: 'no_brief', proposalCount: 0, droppedCount: 0 })
    expect(reservePlannerBudget).not.toHaveBeenCalled()
  })

  it('an unreadable campaign is unavailable/internal_error and never throws', async () => {
    vi.mocked(getCampaignById).mockRejectedValue(new Error('not found'))
    await expect(runPlannerForCampaign(client, CAMPAIGN_ID)).resolves.toMatchObject({ status: 'unavailable', reason: 'internal_error' })
    expect(reservePlannerBudget).not.toHaveBeenCalled()
  })
})

describe('the persisted reason is a CLOSED set (K2.7 security review F3, F4)', () => {
  it('PLAN_ANALYSIS_REASONS is exactly the eleven loop reasons plus internal_error, no_brief, daily_cap', () => {
    expect([...PLAN_ANALYSIS_REASONS].sort()).toEqual(
      [...TOOL_LOOP_FAILURE_REASONS, 'internal_error', 'no_brief', 'daily_cap'].sort(),
    )
  })

  it('every outcome the orchestrator can return carries a reason from the closed set (or null when ok)', async () => {
    const seen: Array<string | null> = []
    vi.mocked(getBriefByCampaign).mockResolvedValueOnce(null)
    seen.push((await runPlannerForCampaign(client, CAMPAIGN_ID)).reason)
    vi.mocked(reservePlannerBudget).mockResolvedValueOnce(null)
    seen.push((await runPlannerForCampaign(client, CAMPAIGN_ID)).reason)
    vi.mocked(buildCustomerContext).mockRejectedValueOnce(new Error('boom'))
    seen.push((await runPlannerForCampaign(client, CAMPAIGN_ID)).reason)
    for (const reason of TOOL_LOOP_FAILURE_REASONS) {
      vi.mocked(runToolLoop).mockResolvedValueOnce({ outcome: 'failed', reason, costCents: 0 } as never)
      seen.push((await runPlannerForCampaign(client, CAMPAIGN_ID)).reason)
    }
    expect(seen).toHaveLength(14)
    for (const reason of seen) expect(PLAN_ANALYSIS_REASONS as readonly (string | null)[]).toContain(reason)
  })

  it('an internal error never puts the thrown message (which may carry row detail) into the Sentry event', async () => {
    const secret = 'Failing row contains (zero-width secret reason text)'
    vi.mocked(buildCustomerContext).mockRejectedValue(new Error(secret))
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    const calls = vi.mocked(Sentry.captureException).mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    for (const [err, hint] of calls) {
      expect(String((err as Error).message)).not.toContain(secret)
      expect(JSON.stringify(hint)).not.toContain(secret)
    }
  })
})

describe('persistence: one run id, every kind, proposes only (constraints 25 and 36)', () => {
  it('writes every proposal kind with its reason, ONE shared planner_run_id, the brief version, and the model id', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(
      decisionResult([
        { kind: 'drop', targetOrder: 2, reason: 'Nothing supports a follow-up.' },
        { kind: 'substitute', targetOrder: 1, proposedRole: 'objection_response', reason: 'No customer evidence exists.' },
        { kind: 'reorder', targetOrder: 0, proposedOrder: 1, reason: 'The story should lead.' },
        { kind: 'request_evidence', targetOrder: 1, reason: 'A customer quote would keep this post.' },
      ]) as never,
    )
    const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(outcome).toEqual({ status: 'ok', reason: null, proposalCount: 4, droppedCount: 0 })

    const rows = vi.mocked(insertPlanProposals).mock.calls[0][0]
    expect(rows.map((r) => r.kind).sort()).toEqual(['drop', 'reorder', 'request_evidence', 'substitute'])
    expect(new Set(rows.map((r) => r.planner_run_id)).size).toBe(1)
    expect(rows[0].planner_run_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    for (const r of rows) {
      expect(r.business_id).toBe(BUSINESS_ID)
      expect(r.brief_id).toBe(BRIEF_ID)
      expect(r.campaign_id).toBe(CAMPAIGN_ID)
      expect(r.brief_version).toBe(2)
      expect(r.model).toBe(MODELS.SONNET_4_6.id)
      expect(r.reason.length).toBeGreaterThan(0)
    }
    // request_evidence is ADVISORY: it carries no role and no order, so there is nothing for an apply to change.
    const advisory = rows.find((r) => r.kind === 'request_evidence')!
    expect(advisory.proposed_role).toBeNull()
    expect(advisory.proposed_order).toBeNull()
  })

  it('a second run gets a DIFFERENT planner_run_id', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(
      decisionResult([{ kind: 'drop', targetOrder: 1, reason: 'No customer evidence exists.' }]) as never,
    )
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    const first = vi.mocked(insertPlanProposals).mock.calls[0][0][0].planner_run_id
    const second = vi.mocked(insertPlanProposals).mock.calls[1][0][0].planner_run_id
    expect(first).not.toBe(second)
  })

  it('drops an unappliable proposal individually and reports the count, instead of failing the whole run', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(
      decisionResult([
        { kind: 'drop', targetOrder: 99, reason: 'A stale target.' },
        { kind: 'drop', targetOrder: 1, reason: 'No customer evidence exists.' },
      ]) as never,
    )
    const outcome = await runPlannerForCampaign(client, CAMPAIGN_ID)
    expect(outcome).toEqual({ status: 'ok', reason: null, proposalCount: 1, droppedCount: 1 })
  })
})

// Session 34-D D8 (MAJOR-4): planner_run_id is "the ai_usage row the spend belongs to" (ADR 0027 §5.3, [db-MAJOR-B]).
// The orchestrator mints the id BEFORE the loop, hands it to runToolLoop as the id of the loop's ONE ai_usage row,
// and persists the SAME value on every proposal it writes. The live join is proved in
// supabase/__tests__/plan-proposals-run-id-join.test.ts; the loop's insert-under-that-id in
// lib/ai/tool-runner-run-id.test.ts; here, the two ends are asserted to be one value.
describe('MAJOR-4 — the run id handed to the loop IS the planner_run_id persisted on every proposal', () => {
  it('runToolLoop receives usageId, and every persisted proposal row carries EXACTLY that value', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(
      decisionResult([
        { kind: 'drop', targetOrder: 1, reason: 'No customer evidence exists.' },
        { kind: 'drop', targetOrder: 2, reason: 'Nothing supports the follow-up.' },
      ]) as never,
    )

    await runPlannerForCampaign(client, CAMPAIGN_ID)

    const { usageId } = loopInput()
    expect(usageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    const rows = vi.mocked(insertPlanProposals).mock.calls[0][0] as Array<{ planner_run_id: string }>
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.planner_run_id).toBe(usageId)
  })

  it('a NEW id is minted for each run — never a constant, never reused across runs', async () => {
    vi.mocked(runToolLoop).mockResolvedValue(decisionResult([{ kind: 'drop', targetOrder: 1, reason: 'r' }]) as never)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    await runPlannerForCampaign(client, CAMPAIGN_ID)
    const ids = vi.mocked(runToolLoop).mock.calls.map((c) => c[0].usageId)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})
