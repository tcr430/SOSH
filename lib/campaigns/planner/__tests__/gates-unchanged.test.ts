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
vi.mock('@/lib/db/planner-budget', () => ({ reservePlannerBudget: vi.fn(), reconcilePlannerBudget: vi.fn() }))
vi.mock('@/lib/db/campaign-plan-proposals', () => ({ insertPlanProposals: vi.fn() }))
vi.mock('../tools', () => ({ buildPlannerTools: vi.fn() }))
// NOT mocked, on purpose: '@/lib/db/campaign-briefs'. The real getBriefByCampaign / setBriefPlanAnalysis /
// createBrief run against the recording client below, so this test observes the actual WRITE the planner path
// makes to campaign_briefs rather than an argument a mock swallowed.

import { runToolLoop } from '@/lib/ai/tool-runner'
import { buildCustomerContext } from '@/lib/ai/context'
import { getCampaignById } from '@/lib/db/campaigns'
import { reservePlannerBudget, reconcilePlannerBudget } from '@/lib/db/planner-budget'
import { insertPlanProposals } from '@/lib/db/campaign-plan-proposals'
import { createBrief } from '@/lib/db/campaign-briefs'
import { buildPlannerTools } from '../tools'
import { planBrief } from '@/lib/campaigns/plan-brief'

// ADR 0027 §10.3 item 1 — AGENCY-GATES-UNCHANGED (constraint 44), Tier 2 part (a), THE REAL CONSTRAINT: a
// planner-produced brief lands in the SAME UNAPPROVED STATE a manually created one does, and NOTHING on the
// planner path writes an approved status. This is the assertion that catches gate removal on the new path.
//
// It is deliberately a BEHAVIOUR test over a recording client and not a manifest scan ([test-Q6]): a scan of
// "the gate call sites" fails only when the manifest and the tree disagree, and whoever removes a gate edits
// both in one commit. Part (b) (Tier 1, supabase/__tests__/agency-gates-unchanged.test.ts) and part (c) (Tier 3,
// the pasted diff transcript in docs/reviews/session-34-k211-tier3.md) are the other two thirds. The human
// ratify RPC leaving the brief 'draft' is proved on live Postgres by supabase/__tests__/plan-proposals-ratify.test.ts.
//
// REDDENING MUTATION (transcript in the K2.11 commit body): make setBriefPlanAnalysis (the planner path's ONLY
// write to campaign_briefs) also write `status: 'approved'` -> every case in the first describe fails.
//
// SHARED-FUNCTION CALLERS (ADR 0015): planBrief's one production caller is lib/campaigns/prepare-brief.ts (wired at K2.12; it
// was unwired when this test was written, K2.11), so its callers are that module, this file and plan-brief.test.ts.
// createBrief's one production caller is lib/campaigns/brief.ts (assembleBrief), exercised here on the write it makes.

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222'
const BRIEF_ID = '33333333-3333-4333-8333-333333333333'

type Write = { table: string; verb: string; payload: unknown }

const brief = {
  id: BRIEF_ID,
  business_id: BUSINESS_ID,
  campaign_id: CAMPAIGN_ID,
  version: 1,
  status: 'critiqued',
  plan_analysis_status: 'not_run',
  content: {
    narrative: 'n',
    proofPlan: 'p',
    pinnedEvidence: [],
    roleSequence: [
      { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the thesis' },
      { order: 1, role: 'customer_proof', platform: 'linkedin', angle: 'a story' },
    ],
  },
}

// Records every write verb and every rpc, and answers reads/writes with the brief row. An `unknown`-typed Proxy:
// no `any`, and no chain method can be added to the client without this test seeing it.
function recordingClient() {
  const writes: Write[] = []
  const rpcs: Array<{ name: string; args: unknown }> = []
  const WRITE_VERBS = new Set(['insert', 'update', 'upsert', 'delete'])
  const chain = (table: string): unknown => {
    const proxy: unknown = new Proxy({} as Record<string, unknown>, {
      get(_target, prop: string) {
        if (prop === 'then') return undefined
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve({ data: table === 'campaign_briefs' ? brief : null, error: null })
        }
        if (WRITE_VERBS.has(prop)) {
          return (payload?: unknown) => {
            writes.push({ table, verb: prop, payload })
            return proxy
          }
        }
        return () => proxy
      },
    })
    return proxy
  }
  const client = {
    from: (table: string) => chain(table),
    rpc: (name: string, args: unknown) => {
      rpcs.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as SupabaseClient
  return { client, writes, rpcs }
}

const validProposals = [
  { kind: 'drop', targetOrder: 1, reason: 'No customer evidence exists.' },
  { kind: 'reorder', targetOrder: 0, proposedOrder: 1, reason: 'The story should lead.' },
]

// One case per way a planner run can end: proposed n, proposed nothing, unavailable, capped.
const RUNS: Array<[string, () => void]> = [
  ['proposed two', () => vi.mocked(runToolLoop).mockResolvedValue({ outcome: 'decision', decision: { proposals: validProposals }, costCents: 5 } as never)],
  ['proposed nothing', () => vi.mocked(runToolLoop).mockResolvedValue({ outcome: 'decision', decision: { proposals: [] }, costCents: 5 } as never)],
  ['is unavailable', () => vi.mocked(runToolLoop).mockResolvedValue({ outcome: 'failed', reason: 'provider_error', costCents: 0 } as never)],
  ['is capped', () => vi.mocked(reservePlannerBudget).mockResolvedValue(null)],
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getCampaignById).mockResolvedValue({
    id: CAMPAIGN_ID,
    business_id: BUSINESS_ID,
    objective: 'Launch',
    platforms: ['linkedin'],
    voice_variation_id: null,
  } as never)
  vi.mocked(reservePlannerBudget).mockResolvedValue({} as never)
  vi.mocked(reconcilePlannerBudget).mockResolvedValue({} as never)
  vi.mocked(buildCustomerContext).mockResolvedValue({ business: { id: BUSINESS_ID, name: 'Acme', language: 'en' }, trialState: null } as never)
  vi.mocked(buildPlannerTools).mockReturnValue([])
  vi.mocked(insertPlanProposals).mockImplementation(async (rows) => rows as never)
})

describe('AGENCY-GATES-UNCHANGED (a) — nothing on the planner path writes an approved brief', () => {
  it.each(RUNS)('a real planBrief run that %s writes ONLY the two plan_analysis columns to campaign_briefs', async (_name, arrange) => {
    arrange()
    const { client, writes, rpcs } = recordingClient()
    await planBrief(client, CAMPAIGN_ID)

    // The positive control: the run DID write, so "no approved write" is not vacuously true.
    const briefWrites = writes.filter((w) => w.table === 'campaign_briefs')
    expect(briefWrites, 'the planner path recorded no brief write at all').toHaveLength(1)
    expect(briefWrites[0].verb).toBe('update')

    // Exactly the two bookkeeping columns: no `status`, no `frozen_at`, no `content`, no `version`.
    expect(Object.keys(briefWrites[0].payload as object).sort()).toEqual(['plan_analysis_reason', 'plan_analysis_status'])

    // No write anywhere on this path carries an approved status, on any table, and there is no rpc at all
    // (the apply RPC belongs to the HUMAN ratify action, never to a planner run).
    for (const w of writes) {
      expect(JSON.stringify(w.payload), `${w.table}.${w.verb}`).not.toMatch(/"status":"(approved|scheduled|published)"/)
    }
    expect(rpcs).toEqual([])
  })

  it('the proposals a planner run persists go through insertPlanProposals, never written through the client', async () => {
    RUNS[0][1]()
    const { client, writes } = recordingClient()
    await planBrief(client, CAMPAIGN_ID)
    expect(insertPlanProposals).toHaveBeenCalledTimes(1)
    expect(writes.some((w) => w.table === 'campaign_plan_proposals')).toBe(false)
  })
})

describe('AGENCY-GATES-UNCHANGED (a) — a brief a planner will analyse is created in the same state as any other', () => {
  it("createBrief writes status 'draft' and has no parameter through which a caller (or a planner) could pick another", async () => {
    const { client, writes } = recordingClient()
    await createBrief(client, CAMPAIGN_ID, brief.content as never)
    const inserts = writes.filter((w) => w.table === 'campaign_briefs' && w.verb === 'insert')
    expect(inserts).toHaveLength(1)
    expect((inserts[0].payload as { status: string }).status).toBe('draft')
    // Arity is the "no status parameter" proof: (client, campaignId, content).
    expect(createBrief.length).toBe(3)
  })
})
