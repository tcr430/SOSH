import { describe, it, expect } from 'vitest'
import { placeRatifiedProposals, type RatifiedProposal, type RoleSequence } from './role-sequence'

// ADR 0027 §5.5 — AGENCY-REORDER-RATIFIED-EXACT, the pure reference (Session 34-D D5, MAJOR-1). The RPC
// (supabase/migrations/20260924100000_...sql) implements the SAME rule; supabase/__tests__/plan-proposals-ratify.test.ts
// asserts the two agree. THE RULE: proposedOrder is the entry's 0-based position in the RESULTING sequence (after
// drops), and every un-pinned entry keeps its relative order and fills the remaining positions.

const seq = (n: number): RoleSequence =>
  Array.from({ length: n }, (_, i) => ({ order: i, role: 'anchor_thesis' as const, platform: 'linkedin' as const, angle: `r${i}` }))

const angles = (result: ReturnType<typeof placeRatifiedProposals>) => {
  if (!result.ok) throw new Error(`refused: ${result.outcome}`)
  return result.roleSequence.map((e) => e.angle)
}
const orders = (result: ReturnType<typeof placeRatifiedProposals>) => {
  if (!result.ok) throw new Error(`refused: ${result.outcome}`)
  return result.roleSequence.map((e) => e.order)
}

const reorder = (targetOrder: number, proposedOrder: number): RatifiedProposal => ({ kind: 'reorder', targetOrder, proposedOrder })
const drop = (targetOrder: number): RatifiedProposal => ({ kind: 'drop', targetOrder })
const substitute = (targetOrder: number, proposedRole: string): RatifiedProposal => ({ kind: 'substitute', targetOrder, proposedRole })

describe("placeRatifiedProposals — the Reviewer's two cases land where the ratified sentence says (MAJOR-1)", () => {
  it('move 3 -> 0: r3 is at position 0, not 1', () => {
    expect(angles(placeRatifiedProposals(seq(4), [reorder(3, 0)]))).toEqual(['r3', 'r0', 'r1', 'r2'])
  })

  it('move 0 -> 3: r0 is at position 3, not 2', () => {
    expect(angles(placeRatifiedProposals(seq(4), [reorder(0, 3)]))).toEqual(['r1', 'r2', 'r3', 'r0'])
  })

  it('an interior move in each direction', () => {
    expect(angles(placeRatifiedProposals(seq(5), [reorder(1, 3)]))).toEqual(['r0', 'r2', 'r3', 'r1', 'r4'])
    expect(angles(placeRatifiedProposals(seq(5), [reorder(3, 1)]))).toEqual(['r0', 'r3', 'r1', 'r2', 'r4'])
  })

  it('order is re-derived from position: contiguous 0..n-1', () => {
    expect(orders(placeRatifiedProposals(seq(4), [reorder(3, 0)]))).toEqual([0, 1, 2, 3])
  })

  it('moving to its own position changes nothing', () => {
    expect(angles(placeRatifiedProposals(seq(4), [reorder(2, 2)]))).toEqual(['r0', 'r1', 'r2', 'r3'])
  })
})

describe('placeRatifiedProposals — how the kinds compose', () => {
  it('reorder + drop: proposedOrder counts positions in the RESULT (after the drop)', () => {
    // drop r1 -> survivors r0,r2,r3 (length 3); r3 pinned at 0 -> r3,r0,r2
    expect(angles(placeRatifiedProposals(seq(4), [drop(1), reorder(3, 0)]))).toEqual(['r3', 'r0', 'r2'])
  })

  it('reorder + substitute: the substituted entry keeps its place and changes only its role', () => {
    const result = placeRatifiedProposals(seq(4), [substitute(1, 'customer_proof'), reorder(3, 0)])
    expect(angles(result)).toEqual(['r3', 'r0', 'r1', 'r2'])
    if (!result.ok) throw new Error('unexpected refusal')
    expect(result.roleSequence[2].role).toBe('customer_proof')
  })

  it('an entry that is both substituted and reordered carries its new role to its pinned slot', () => {
    const result = placeRatifiedProposals(seq(3), [substitute(2, 'follow_up'), reorder(2, 0)])
    if (!result.ok) throw new Error('unexpected refusal')
    expect(result.roleSequence[0]).toMatchObject({ angle: 'r2', role: 'follow_up', order: 0 })
  })

  it('two reorders to DIFFERENT slots compose deterministically and independent of listing order', () => {
    const a = placeRatifiedProposals(seq(4), [reorder(3, 0), reorder(0, 3)])
    const b = placeRatifiedProposals(seq(4), [reorder(0, 3), reorder(3, 0)])
    expect(angles(a)).toEqual(['r3', 'r1', 'r2', 'r0'])
    expect(angles(b)).toEqual(angles(a))
  })

  it('request_evidence changes nothing', () => {
    expect(angles(placeRatifiedProposals(seq(3), [{ kind: 'request_evidence', targetOrder: 1 }]))).toEqual(['r0', 'r1', 'r2'])
  })
})

describe('placeRatifiedProposals — a combination the sentence cannot satisfy is REFUSED, never reinterpreted', () => {
  it('two reorders to ONE slot -> conflicting_reorders', () => {
    const result = placeRatifiedProposals(seq(4), [reorder(0, 2), reorder(3, 2)])
    expect(result).toMatchObject({ ok: false, outcome: 'conflicting_reorders' })
  })

  it("a reorder to a slot past the RESULT's end (a drop shortened it) -> invalid_reorder_target", () => {
    // drop r1 -> length 3; slot 3 does not exist
    expect(placeRatifiedProposals(seq(4), [drop(1), reorder(0, 3)])).toMatchObject({ ok: false, outcome: 'invalid_reorder_target' })
  })

  it("a reorder to a slot past the sequence's end -> invalid_reorder_target", () => {
    expect(placeRatifiedProposals(seq(3), [reorder(0, 5)])).toMatchObject({ ok: false, outcome: 'invalid_reorder_target' })
  })

  it('a round of drops covering every entry -> empty_sequence (MINOR-8)', () => {
    expect(placeRatifiedProposals(seq(2), [drop(0), drop(1)])).toEqual({ ok: false, outcome: 'empty_sequence' })
  })
})
