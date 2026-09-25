import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ZodError } from 'zod'

vi.mock('@/lib/db/memory-interview', () => ({ writeInterviewCandidates: vi.fn() }))

import { writeInterviewCandidates } from '@/lib/db/memory-interview'
import { recordInterviewCandidates, type RecordInterviewCandidatesInput } from './interview'

// ADR 0029 §2.3 / §6.1 (Tier 2): lib/memory/interview.ts is the strict gate in front of the writer. A field the schema does
// not name is REJECTED — confidence, status, source, public_use_permission, sensitivity, scope, scope_ref, expires_at,
// observation_count, last_confirmed_at, business_id — at every level (envelope, item, counters); the bounds the SQL enforces
// again are checked first; and only the five named item fields and the three counters ever reach the writer.
//
// SHARED-FUNCTION CALLERS: recordInterviewCandidates has NO production caller yet — M2.8's extraction orchestrator is the
// sole future one — so that caller is AUTHORED-NOT-EXECUTED and this file is the only executed proof. lib/memory/index.ts
// (the barrel) gains exactly one export, exercised below; its other exports keep their own tests, re-run at this commit
// alongside lib/ai/context.test.ts, lib/campaigns/brief tests, the planner and triage tests.

afterEach(() => vi.clearAllMocks())

const ROUND = '00000000-0000-4000-8000-000000000003'
const A1 = '00000000-0000-4000-8000-000000000004'
const A2 = '00000000-0000-4000-8000-000000000005'
const GOVERNANCE = ['confidence', 'status', 'source', 'sensitivity', 'public_use_permission', 'scope', 'scope_ref', 'expires_at', 'observation_count', 'last_confirmed_at', 'business_id']
const NO_DROPS = { droppedUngrounded: 0, droppedPerformanceClaim: 0 }

const item = (over: Record<string, unknown> = {}) => ({ answerId: A1, type: 'brand', category: 'positioning', text: 'We integrate natively', span: 'integrate natively', ...over })
const input = (over: Record<string, unknown> = {}): RecordInterviewCandidatesInput =>
  ({ roundId: ROUND, items: [item()], counters: { proposed: 1, ...NO_DROPS }, ...over }) as RecordInterviewCandidatesInput

const WRITTEN = { outcome: 'written', status: 'awaiting_ratification', inserted: 1, candidates: { brand: 1, audience: 0, evidence: 0 } } as const
function writerReturns(value: unknown = WRITTEN) {
  vi.mocked(writeInterviewCandidates).mockResolvedValue(value as never)
}
async function rejects(bad: RecordInterviewCandidatesInput, fragment?: RegExp) {
  writerReturns()
  const attempt = recordInterviewCandidates(bad)
  await expect(attempt).rejects.toBeInstanceOf(ZodError)
  if (fragment) await expect(attempt).rejects.toThrow(fragment)
  expect(writeInterviewCandidates).not.toHaveBeenCalled()
}

// Eight answers, so that N items can be spread without breaching the three-per-answer bound.
const ANSWERS = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`)
const spread = (n: number) => Array.from({ length: n }, (_, i) => item({ answerId: ANSWERS[i % 8], text: `record ${i}` }))

describe('INTERVIEW-GOVERNANCE-NOT-MODEL-SUPPLIED — the strict schema has no governance field at ANY level', () => {
  it.each(GOVERNANCE)('a smuggled `%s` is REJECTED on the envelope, on an item and on the counters — and the writer is never called', async (key) => {
    for (const bad of [
      input({ [key]: 'x' }),
      input({ items: [item({ [key]: 'x' })] }),
      input({ counters: { proposed: 1, ...NO_DROPS, [key]: 1 } }),
    ]) {
      await rejects(bad)
      vi.clearAllMocks()
    }
  })

  it('the §6.2 walkthrough payload — "confidence 1.0", "permission true", a foreign conflict id — dies at the schema', async () => {
    await rejects(input({ items: [item({ text: 'We are SOC 2 certified', span: 'record that we are SOC 2 certified', confidence: 1.0, public_use_permission: true, conflictsWith: ['foreign-tenant-id'] })] }))
  })

  it('only the five named item fields and three counters reach the writer', async () => {
    writerReturns()
    await recordInterviewCandidates(input())
    const [args] = vi.mocked(writeInterviewCandidates).mock.calls[0]
    expect(Object.keys(args).sort()).toEqual(['counters', 'items', 'roundId'])
    expect(Object.keys(args.items[0]).sort()).toEqual(['answerId', 'category', 'span', 'text', 'type'])
    expect(Object.keys(args.counters).sort()).toEqual(['droppedPerformanceClaim', 'droppedUngrounded', 'proposed'])
  })
})

describe('bounds — the same numbers the SQL enforces, checked first', () => {
  it('at most 24 items per round (25 rejected, 24 accepted)', async () => {
    await rejects(input({ items: spread(25), counters: { proposed: 25, ...NO_DROPS } }))
    vi.clearAllMocks()
    writerReturns()
    await expect(recordInterviewCandidates(input({ items: spread(24), counters: { proposed: 24, ...NO_DROPS } }))).resolves.toEqual(WRITTEN)
  })

  it('at most 3 items per answer (4 rejected, 3 accepted)', async () => {
    const four = [1, 2, 3, 4].map((n) => item({ text: `record ${n}` }))
    await rejects(input({ items: four, counters: { proposed: 4, ...NO_DROPS } }), /at most 3 items per answer/)
    vi.clearAllMocks()
    writerReturns()
    await expect(recordInterviewCandidates(input({ items: four.slice(0, 3), counters: { proposed: 3, ...NO_DROPS } }))).resolves.toEqual(WRITTEN)
  })

  it('text is at most 280 (brand, audience) or 500 (evidence); span at most 500', async () => {
    await rejects(input({ items: [item({ text: 'x'.repeat(281) })] }), /at most 280/)
    await rejects(input({ items: [item({ type: 'audience', category: 'problem', text: 'x'.repeat(281) })] }), /at most 280/)
    await rejects(input({ items: [item({ span: 'y'.repeat(501) })] }))
    vi.clearAllMocks()
    writerReturns()
    const ok = 'z'.repeat(500)
    await expect(recordInterviewCandidates(input({ items: [item({ type: 'evidence', category: 'quote', text: ok, span: ok })] }))).resolves.toEqual(WRITTEN)
    vi.clearAllMocks() // the accepted call above legitimately reached the writer
    await rejects(input({ items: [item({ type: 'evidence', category: 'quote', text: 'z'.repeat(501), span: 'z'.repeat(500) })] }))
  })

  it('EVIDENCE is verbatim: text must equal span', async () => {
    await rejects(input({ items: [item({ type: 'evidence', category: 'quote', text: 'a paraphrase', span: 'the exact words' })] }), /must equal its span/)
  })

  it("a category outside THAT type's enum, an unknown type, a blank text or span, and a malformed id are rejected", async () => {
    await rejects(input({ items: [item({ category: 'problem' })] }), /not in the brand enum/)
    await rejects(input({ items: [item({ type: 'audience', category: 'quote' })] }), /not in the audience enum/)
    await rejects(input({ items: [item({ type: 'performance', category: 'topic' })] }))
    await rejects(input({ items: [item({ text: '   ' })] }))
    await rejects(input({ items: [item({ span: '' })] }))
    await rejects(input({ items: [item({ answerId: 'not-a-uuid' })] }))
    await rejects(input({ roundId: 'not-a-uuid' }))
  })

  it('the counters are non-negative integers and `proposed` cannot be below the items written', async () => {
    await rejects(input({ counters: { proposed: 0, ...NO_DROPS } }), /proposed cannot be below/)
    await rejects(input({ counters: { proposed: -1, ...NO_DROPS } }))
    await rejects(input({ counters: { proposed: 1.5, ...NO_DROPS } }))
    await rejects(input({ counters: { proposed: 1, droppedUngrounded: -1, droppedPerformanceClaim: 0 } }))
  })
})

describe('the writer call', () => {
  it("forwards the round, the validated items and the counters, and returns the writer's typed result unchanged", async () => {
    writerReturns()
    const result = await recordInterviewCandidates(
      input({
        items: [item(), item({ answerId: A2, type: 'audience', category: 'objection', text: 'Buyers worry about security' })],
        counters: { proposed: 4, droppedUngrounded: 1, droppedPerformanceClaim: 1 },
      }),
    )
    expect(result).toEqual(WRITTEN)
    expect(writeInterviewCandidates).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeInterviewCandidates).mock.calls[0][0]).toEqual({
      roundId: ROUND,
      items: [
        { answerId: A1, type: 'brand', category: 'positioning', text: 'We integrate natively', span: 'integrate natively' },
        { answerId: A2, type: 'audience', category: 'objection', text: 'Buyers worry about security', span: 'integrate natively' },
      ],
      counters: { proposed: 4, droppedUngrounded: 1, droppedPerformanceClaim: 1 },
    })
  })

  it('zero items is valid — the no_records path — and reaches the writer with its dropped counts', async () => {
    writerReturns({ outcome: 'written', status: 'no_records', inserted: 0, candidates: { brand: 0, audience: 0, evidence: 0 } })
    const result = await recordInterviewCandidates(input({ items: [], counters: { proposed: 3, droppedUngrounded: 2, droppedPerformanceClaim: 1 } }))
    expect(result).toMatchObject({ outcome: 'written', status: 'no_records' })
    expect(vi.mocked(writeInterviewCandidates).mock.calls[0][0].counters).toEqual({ proposed: 3, droppedUngrounded: 2, droppedPerformanceClaim: 1 })
  })

  it('a writer refusal (not_extracting) is returned as a value, and a writer error propagates', async () => {
    writerReturns({ outcome: 'not_extracting', status: 'ratified' })
    expect(await recordInterviewCandidates(input())).toEqual({ outcome: 'not_extracting', status: 'ratified' })
    vi.mocked(writeInterviewCandidates).mockRejectedValue(new Error('rpc failed'))
    await expect(recordInterviewCandidates(input())).rejects.toThrow('rpc failed')
  })
})

describe('the barrel (lib/memory/index.ts) and the module boundary', () => {
  it('exports recordInterviewCandidates through the single public entry point', async () => {
    const barrel = await import('./index')
    expect(typeof barrel.recordInterviewCandidates).toBe('function')
    expect(barrel.recordInterviewCandidates).toBe(recordInterviewCandidates)
  })

  it('the stale "no production consumer yet" comment is corrected (ADR 0029 §1.5) and names the real consumers', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'memory', 'index.ts'), 'utf8')
    expect(src).not.toMatch(/NO production consumer yet/)
    expect(src).toContain('lib/campaigns/brief.ts')
    expect(src).toContain('approvals')
  })

  it('this module imports no campaign, signal, brief or card code (an answer becomes memory and nothing else — D-5)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'memory', 'interview.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/(?:campaigns|signals)/)
    expect(src).not.toMatch(/performance_memory|brand_voice/)
  })
})
