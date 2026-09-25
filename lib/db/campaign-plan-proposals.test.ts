import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  listCurrentVersionPlanProposals,
  decidePlanProposalRpc,
  getPlanProposalById,
  applyBriefProposalsRpc,
  insertPlanProposals,
  PLAN_PROPOSALS_DEFAULT_LIMIT,
} from './campaign-plan-proposals'

// ADR 0027 §8.5 (Session 34 K2.10) — AGENCY-PROPOSAL-BOUNDED-QUERY (33), Tier 2. The list queries that feed the review
// surface are BOUNDED (explicit `limit`, default 50) and ORDERED BY (target_order, created_at, id) ALL ASCENDING —
// mixing a DESC in would stop the ORDER BY matching campaign_plan_proposals_brief_version_idx (D5) and satisfy the house rule
// ("list queries have an explicit ORDER BY matching an existing index") only nominally.
//
// SHARED-FUNCTION CALLERS: listCurrentVersionPlanProposals — one caller, brief/page.tsx (page.test.tsx; live: supabase
// __tests__/plan-proposals-current-version-read.test.ts). Session 34-D D10 (MINOR-7): it REPLACED listPlanProposalsForBrief
// (every version, brief_id only) and listPendingPlanProposals was DELETED — it had no production caller, only its own
// test, which is how the page came to call a query that did not match the index. decidePlanProposalRpc — one
// caller, plan-actions.ts (plan-actions.test.ts). applyBriefProposalsRpc — one caller, apply-proposals.ts.

afterEach(() => vi.clearAllMocks())

const ROW = { id: 'p-1', status: 'pending' }
const calls = (fn: unknown) => (fn as { mock: { calls: unknown[][] } }).mock.calls

describe('AGENCY-PROPOSAL-BOUNDED-QUERY — listCurrentVersionPlanProposals (the read brief/page.tsx calls)', () => {
  it('reads campaign_plan_proposals for ONE brief, ordered target_order, created_at, id — ALL ascending — with a limit', async () => {
    const { client, builder, from } = createMockClient([ROW], null)
    await listCurrentVersionPlanProposals(client, 'brief-1', 3)
    expect(from).toHaveBeenCalledWith('campaign_plan_proposals')
    expect(builder.eq).toHaveBeenCalledWith('brief_id', 'brief-1')
    expect(calls(builder.order)).toEqual([
      ['target_order', { ascending: true }],
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('NO order clause is descending (a DESC would stop the ORDER BY matching the review index)', async () => {
    const { client, builder } = createMockClient([], null)
    await listCurrentVersionPlanProposals(client, 'brief-1', 3)
    for (const call of calls(builder.order) as Array<[string, { ascending: boolean }]>) {
      expect(call[1].ascending, `order(${call[0]}) must be ascending`).toBe(true)
    }
  })

  it('defaults the limit to 50 and honours an explicit one', async () => {
    expect(PLAN_PROPOSALS_DEFAULT_LIMIT).toBe(50)
    const a = createMockClient([], null)
    await listCurrentVersionPlanProposals(a.client, 'brief-1', 3)
    expect(a.builder.limit).toHaveBeenCalledWith(50)
    const b = createMockClient([], null)
    await listCurrentVersionPlanProposals(b.client, 'brief-1', 3, 7)
    expect(b.builder.limit).toHaveBeenCalledWith(7)
  })

  it('throws on a DB error and returns [] for null data', async () => {
    await expect(listCurrentVersionPlanProposals(createMockClient(null, { message: 'boom' }).client, 'b', 1)).rejects.toThrow('boom')
    expect(await listCurrentVersionPlanProposals(createMockClient(null, null).client, 'b', 1)).toEqual([])
  })
})

describe('AGENCY-PROPOSAL-BOUNDED-QUERY — Tier-3 source scan (so a removed limit or a planted DESC reddens even if a test mock changes)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'campaign-plan-proposals.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const bodyOf = (name: string) => {
    const start = code.indexOf(`export async function ${name}`)
    expect(start, `${name} not found`).toBeGreaterThan(-1)
    const next = code.indexOf('\nexport ', start + 10)
    return code.slice(start, next === -1 ? undefined : next)
  }

  it.each(['listCurrentVersionPlanProposals'])('%s has an explicit .limit( and no descending order', (fn) => {
    const body = bodyOf(fn)
    expect(body).toMatch(/\.limit\(/)
    expect(body).not.toMatch(/ascending:\s*false/)
    expect([...body.matchAll(/\.order\(/g)]).toHaveLength(3)
  })

  it('the file carries NO descending order anywhere (the table has one index shape)', () => {
    expect(code).not.toMatch(/ascending:\s*false/)
  })
})

describe('decidePlanProposalRpc — the already_decided signal', () => {
  const args = { businessId: 'biz-1', proposalId: 'p-1', userId: 'u-1', status: 'rejected' as const }

  it('calls decide_plan_proposal with the four named parameters, through the service-role client', async () => {
    const { client } = createMockClient({ id: 'p-1', status: 'rejected' }, null)
    vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
    const row = await decidePlanProposalRpc(args)
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('decide_plan_proposal', {
      p_business_id: 'biz-1',
      p_proposal_id: 'p-1',
      p_user_id: 'u-1',
      p_status: 'rejected',
    })
    expect(row).toMatchObject({ id: 'p-1' })
  })

  it("a NULL composite return is `null` (already decided) — including PostgREST's all-fields-NULL object, NOT JSON null", async () => {
    for (const nullish of [null, { id: null, status: null, kind: null }]) {
      const { client } = createMockClient(nullish, null)
      vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
      expect(await decidePlanProposalRpc(args), JSON.stringify(nullish)).toBeNull()
    }
  })

  it('an RPC error is thrown (a real failure), never confused with already_decided', async () => {
    const { client } = createMockClient(null, { message: 'permission denied' })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
    await expect(decidePlanProposalRpc(args)).rejects.toThrow('permission denied')
  })
})

describe('getPlanProposalById / applyBriefProposalsRpc / insertPlanProposals', () => {
  it('getPlanProposalById reads by id with the CALLER client and returns null when absent', async () => {
    const found = createMockClient({ id: 'p-1', status: 'accepted' }, null)
    expect(await getPlanProposalById(found.client, 'p-1')).toMatchObject({ status: 'accepted' })
    expect(found.builder.eq).toHaveBeenCalledWith('id', 'p-1')
    expect(await getPlanProposalById(createMockClient(null, null).client, 'p-1')).toBeNull()
  })

  it('applyBriefProposalsRpc maps the camelCase args onto the five RPC parameters', async () => {
    const { client } = createMockClient({ outcome: 'frozen' }, null)
    vi.mocked(createServiceRoleClient).mockReturnValue(client as never)
    const result = await applyBriefProposalsRpc({ businessId: 'b', briefId: 'br', expectedVersion: 2, userId: 'u', proposalIds: ['p1', 'p2'] })
    expect(result).toEqual({ outcome: 'frozen' })
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('apply_brief_proposals', {
      p_business_id: 'b',
      p_brief_id: 'br',
      p_expected_version: 2,
      p_user_id: 'u',
      p_proposal_ids: ['p1', 'p2'],
    })
  })

  it('insertPlanProposals with no rows does not even acquire the service-role client', async () => {
    expect(await insertPlanProposals([])).toEqual([])
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })
})

// Session 34-D D10 (MINOR-7): the read is the brief's CURRENT VERSION. The former read filtered by brief_id alone, so a
// proposal written against an earlier version reached the screen (BLOCKER-1's stale rows were selectable). The predicate
// pair (brief_id, brief_version) with the all-ASC order is campaign_plan_proposals_brief_version_idx (D5).
describe('AGENCY-PROPOSAL-BOUNDED-QUERY — listCurrentVersionPlanProposals reads ONE VERSION', () => {
  it('filters brief_id AND brief_version, and applies NO status filter (decided and brief_frozen rows must render)', async () => {
    const { client, builder } = createMockClient([ROW], null)
    await listCurrentVersionPlanProposals(client, 'brief-1', 4)
    expect(builder.eq).toHaveBeenCalledWith('brief_id', 'brief-1')
    expect(builder.eq).toHaveBeenCalledWith('brief_version', 4)
    expect(calls(builder.eq).map((c) => c[0])).not.toContain('status')
  })

  it('the version argument is required and is what is filtered on — never a constant', async () => {
    const a = createMockClient([], null)
    await listCurrentVersionPlanProposals(a.client, 'brief-1', 1)
    const b = createMockClient([], null)
    await listCurrentVersionPlanProposals(b.client, 'brief-1', 9)
    expect(a.builder.eq).toHaveBeenCalledWith('brief_version', 1)
    expect(b.builder.eq).toHaveBeenCalledWith('brief_version', 9)
  })

  it('the old every-version read and the dead pending-only read no longer exist', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'campaign-plan-proposals.ts'), 'utf8')
    expect(src).not.toMatch(/listPlanProposalsForBrief|listPendingPlanProposals/)
  })
})
