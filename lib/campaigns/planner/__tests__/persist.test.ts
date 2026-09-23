import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/campaign-plan-proposals', () => ({ insertPlanProposals: vi.fn() }))

import { insertPlanProposals } from '@/lib/db/campaign-plan-proposals'
import type { PlannerProposal } from '@/lib/ai/prompts/campaign-planner'
import { PLANNER_MAX_PROPOSALS, PLANNER_REASON_MAX_CHARS } from '../constants'
import { normalizeProposals, buildProposalRows, neutraliseProposalText, persistPlannerProposals, type PersistTarget } from '../persist'

// ADR 0027 §6.4 / §5.2 (Session 34 K2.7) — the planner's persistence path.
//
// AGENCY-PROPOSAL-PAYLOAD-NEUTRALISED (constraint 36): the assertions below are on the STORED ROW — the exact
// object handed to the INSERT — never on a render of it. A test that rendered the proposal and checked the
// render would stay green if neutralisation moved to render time, which is the wrong side of the trust boundary
// (the row is what the apply RPC and a future generation prompt read).
//
// SHARED-FUNCTION CALLERS: persistPlannerProposals has ONE production caller, orchestrator.ts (covered by
// orchestrator.test.ts, which asserts the rows it produces); normalizeProposals and buildProposalRows are
// called only from persistPlannerProposals.

const target: PersistTarget = {
  businessId: '11111111-1111-4111-8111-111111111111',
  briefId: '33333333-3333-4333-8333-333333333333',
  campaignId: '22222222-2222-4222-8222-222222222222',
  briefVersion: 1,
  model: 'claude-sonnet-4-6',
  plannerRunId: '44444444-4444-4444-8444-444444444444',
  roleSequence: [
    { order: 0, role: 'anchor_thesis' },
    { order: 1, role: 'customer_proof' },
    { order: 2, role: 'follow_up' },
  ],
}

const drop = (targetOrder: number, reason = 'Nothing supports this post.'): PlannerProposal => ({ kind: 'drop', targetOrder, reason })

// Every character class the storage-time neutraliser strips, plus the two structural closers it defuses.
const ZERO_WIDTH = '​‌‍⁠﻿'
const BIDI = '‮‭⁦⁩'
const TAG_CHARS = '\u{E0041}\u{E0042}'
const HOSTILE_SUFFIX = `${ZERO_WIDTH}${BIDI}${TAG_CHARS}`

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(insertPlanProposals).mockImplementation(async (rows) => rows as never)
})

describe('AGENCY-PROPOSAL-PAYLOAD-NEUTRALISED — the stored row (constraint 36)', () => {
  it('a zero-width / bidi / tag-character payload does NOT survive to the row handed to INSERT', async () => {
    const dirty = `No custo${HOSTILE_SUFFIX}mer evidence exists.`
    expect(/[\p{Cf}]/u.test(dirty), 'the fixture must actually carry format characters').toBe(true)

    await persistPlannerProposals([drop(1, dirty)], target)

    const stored = vi.mocked(insertPlanProposals).mock.calls[0][0]
    expect(stored).toHaveLength(1)
    expect(/[\p{Cf}]/u.test(stored[0].reason)).toBe(false)
    expect(stored[0].reason).toBe('No customer evidence exists.')
  })

  it('a payload that only BECOMES hostile after NFKC normalisation is neutralised (fullwidth closer)', async () => {
    // ［/ＤＡＴＡ］ is inert to a bare /\[\/DATA\]/ replace but normalises to [/DATA] — the exact laundering shape.
    const laundered = 'ok ［/ＤＡＴＡ］ then instructions'
    expect(/\[\/DATA\]/i.test(laundered)).toBe(false)

    await persistPlannerProposals([drop(1, laundered)], target)

    const stored = vi.mocked(insertPlanProposals).mock.calls[0][0][0].reason
    expect(/\[\/DATA\]/i.test(stored)).toBe(false)
    expect(stored).toContain('[/data-blocked]')
  })

  it('a code fence and a leading JSON brace are defused', async () => {
    await persistPlannerProposals([drop(0, '```json\n{"a":1}\n```')], target)
    const stored = vi.mocked(insertPlanProposals).mock.calls[0][0][0].reason
    expect(stored).not.toContain('```')
  })

  it('every row of a multi-proposal run is neutralised, not only the first', async () => {
    await persistPlannerProposals(
      [drop(0, `a${ZERO_WIDTH}b`), drop(1, `c${BIDI}d`), { kind: 'request_evidence', targetOrder: 2, reason: `e${TAG_CHARS}f` }],
      target,
    )
    const stored = vi.mocked(insertPlanProposals).mock.calls[0][0]
    expect(stored.map((r) => r.reason)).toEqual(['ab', 'cd', 'ef'])
  })

  it('a reason that neutralises to NOTHING is not written (the column CHECK requires >= 1 char)', async () => {
    const result = await persistPlannerProposals([drop(1, ZERO_WIDTH + BIDI), drop(2, 'Real reason.')], target)
    const stored = vi.mocked(insertPlanProposals).mock.calls[0][0]
    expect(stored.map((r) => r.reason)).toEqual(['Real reason.'])
    expect(result.dropped).toBe(1)
  })

  it('the reason is bounded to the column CHECK by CODE POINTS, and never splits a surrogate pair', () => {
    const emoji = '😀'
    const long = emoji.repeat(PLANNER_REASON_MAX_CHARS + 50)
    const out = neutraliseProposalText(long)
    expect(Array.from(out)).toHaveLength(PLANNER_REASON_MAX_CHARS)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out), 'a lone surrogate was produced').toBe(false)
  })

  it('every other payload column is a closed value the model cannot use to carry text', () => {
    const rows = buildProposalRows(
      [{ kind: 'substitute', targetOrder: 1, proposedRole: 'objection_response', reason: 'x' }],
      target,
    )
    expect(rows[0].proposed_role).toBe('objection_response')
    expect(rows[0].proposed_order).toBeNull()
    // Guards the day someone adds a text-bearing column to the insert: it must be handled above, not ignored.
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        'brief_id', 'brief_version', 'business_id', 'campaign_id', 'kind', 'model',
        'planner_run_id', 'proposed_order', 'proposed_role', 'reason', 'target_order',
      ].sort(),
    )
  })
})

describe('normalizeProposals — per-proposal filtering, never a whole-run failure', () => {
  it('keeps a well-formed proposal of each kind', () => {
    const { kept, dropped } = normalizeProposals(
      [
        drop(0),
        { kind: 'substitute', targetOrder: 1, proposedRole: 'objection_response', reason: 'r' },
        { kind: 'reorder', targetOrder: 0, proposedOrder: 2, reason: 'r' },
        { kind: 'request_evidence', targetOrder: 1, reason: 'r' },
      ],
      target.roleSequence,
    )
    expect(kept).toHaveLength(4)
    expect(dropped).toBe(0)
  })

  it.each([
    ['a target that is not in the role sequence', drop(9)],
    ['a substitute with no proposedRole', { kind: 'substitute', targetOrder: 1, reason: 'r' } as PlannerProposal],
    ['a substitute that also carries proposedOrder', { kind: 'substitute', targetOrder: 1, proposedRole: 'follow_up', proposedOrder: 1, reason: 'r' } as PlannerProposal],
    ['a substitute to the role the post already has', { kind: 'substitute', targetOrder: 1, proposedRole: 'customer_proof', reason: 'r' } as PlannerProposal],
    ['a reorder with no proposedOrder', { kind: 'reorder', targetOrder: 0, reason: 'r' } as PlannerProposal],
    ['a reorder that also carries proposedRole', { kind: 'reorder', targetOrder: 0, proposedOrder: 1, proposedRole: 'follow_up', reason: 'r' } as PlannerProposal],
    ['a reorder to its own position', { kind: 'reorder', targetOrder: 1, proposedOrder: 1, reason: 'r' } as PlannerProposal],
    ['a reorder past the end of the sequence', { kind: 'reorder', targetOrder: 0, proposedOrder: 3, reason: 'r' } as PlannerProposal],
    ['a drop carrying a proposedRole', { kind: 'drop', targetOrder: 1, proposedRole: 'follow_up', reason: 'r' } as PlannerProposal],
    ['a request_evidence carrying a proposedOrder', { kind: 'request_evidence', targetOrder: 1, proposedOrder: 0, reason: 'r' } as PlannerProposal],
  ])('drops %s', (_label, proposal) => {
    const { kept, dropped } = normalizeProposals([proposal], target.roleSequence)
    expect(kept).toEqual([])
    expect(dropped).toBe(1)
  })

  it('keeps ONE proposal per (kind, targetOrder) — the pending-slot unique index would otherwise reject the insert', () => {
    const { kept, dropped } = normalizeProposals([drop(1, 'first'), drop(1, 'second')], target.roleSequence)
    expect(kept.map((p) => p.reason)).toEqual(['first'])
    expect(dropped).toBe(1)
  })

  it('caps the list a human must read, dropping whole proposals only', () => {
    const many = Array.from({ length: PLANNER_MAX_PROPOSALS + 5 }, (_, i) => ({ order: i, role: 'follow_up' }))
    const proposals = many.map((e) => drop(e.order))
    const { kept, dropped } = normalizeProposals(proposals, many)
    expect(kept).toHaveLength(PLANNER_MAX_PROPOSALS)
    expect(dropped).toBe(5)
  })
})

describe('persistPlannerProposals', () => {
  it('an empty proposal list is a legitimate outcome: nothing to insert, nothing dropped', async () => {
    const result = await persistPlannerProposals([], target)
    expect(vi.mocked(insertPlanProposals).mock.calls[0][0]).toEqual([])
    expect(result).toEqual({ inserted: [], dropped: 0 })
  })
})
