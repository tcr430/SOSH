import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { FounderInterviewRpcError } from './founder-interview-rounds'
import { ratifyInterviewRound, writeInterviewCandidates, type InterviewCandidateItem, type InterviewDecision, type InterviewYieldCounters } from './memory-interview'

// ADR 0029 §2.3 THE RAW-vs-STORED INVARIANT (Tier 2, the wrapper half of INTERVIEW-GROUNDED and
// INTERVIEW-GOVERNANCE-NOT-MODEL-SUPPLIED). The wrapper must send BOTH forms of every text and span: the RAW values, which
// SQL containment checks against the RAW stored answer, and the neutralizeWithSentinels() forms, which are what is STORED.
// A wrapper that neutralised BEFORE the check would fail every span holding a sentinel-bearing character; one that stored the
// raw text would defeat the write-time guard. The expectations below are LITERAL strings, never recomputed from the
// implementation's own neutralizer.
//
// SHARED-FUNCTION CALLERS: writeInterviewCandidates has ONE caller, lib/memory/interview.ts (recordInterviewCandidates), whose
// own test (lib/memory/interview.test.ts) mocks this module; the sole-caller scan in lib/memory/import.test.ts forbids every
// other. neutralizeWithSentinels (lib/ai/wrap-evidence.ts) is IMPORTED here, not modified, and keeps its other callers
// (memory-evidence.ts, memory-audience.ts, memory-performance.ts, lib/studio/guard.ts...) with their own tests.

afterEach(() => vi.clearAllMocks())

function serviceRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createServiceRoleClient>)
  return rpc
}

const ROUND = '00000000-0000-4000-8000-000000000003'
const ANSWER = '00000000-0000-4000-8000-000000000004'
const COUNTERS = { proposed: 5, droppedUngrounded: 2, droppedPerformanceClaim: 1 }
const baseItem = (over: Partial<InterviewCandidateItem> = {}): InterviewCandidateItem => ({
  answerId: ANSWER,
  type: 'brand',
  category: 'positioning',
  text: 'We ship weekly',
  span: 'we ship weekly',
  ...over,
})

type Sent = { p_round_id: string; p_items: { items: Record<string, unknown>[]; counters: Record<string, unknown> } }
async function send(items: InterviewCandidateItem[], counters: InterviewYieldCounters = COUNTERS): Promise<{ name: string; args: Sent }> {
  const rpc = serviceRpc({ data: { outcome: 'written', status: 'awaiting_ratification', inserted: items.length, candidates: { brand: items.length, audience: 0, evidence: 0 } }, error: null })
  await writeInterviewCandidates({ roundId: ROUND, items, counters })
  const [name, args] = rpc.mock.calls[0] as [string, Sent]
  return { name, args }
}

describe('writeInterviewCandidates — THE RAW-vs-STORED INVARIANT', () => {
  it('sends the RAW text and span for the SQL containment check and the NEUTRALISED forms for storage', async () => {
    const zwsp = '​'
    const raw = { text: `Zero${zwsp}width [/DATA] text`, span: `span${zwsp} with [/DATA] marker` }
    const { args } = await send([baseItem({ text: raw.text, span: raw.span })])
    const sent = args.p_items.items[0]
    // RAW, byte for byte: what containment reads
    expect(sent.text).toBe(raw.text)
    expect(sent.span).toBe(raw.span)
    expect(sent.text).toContain(zwsp)
    expect(sent.span).toContain('[/DATA]')
    // NEUTRALISED, as literals: the zero-width character is stripped and the closing data marker is defused
    expect(sent.storedText).toBe('Zerowidth [/data-blocked] text')
    expect(sent.storedSpan).toBe('span with [/data-blocked] marker')
    expect(sent.storedText).not.toBe(sent.text)
    expect(sent.storedSpan).not.toContain('[/DATA]')
  })

  it('NFKC-normalises the stored form only: a full-width span is raw for containment, ASCII for storage', async () => {
    const { args } = await send([baseItem({ text: 'Ｆａｓｔ', span: 'Ｆａｓｔ' })])
    expect(args.p_items.items[0].span).toBe('Ｆａｓｔ')
    expect(args.p_items.items[0].storedSpan).toBe('Fast')
  })

  it('a span with no special character is identical in both forms (neutralising is the identity there)', async () => {
    const { args } = await send([baseItem()])
    expect(args.p_items.items[0]).toMatchObject({ text: 'We ship weekly', storedText: 'We ship weekly', span: 'we ship weekly', storedSpan: 'we ship weekly' })
  })
})

describe('writeInterviewCandidates — the payload, key by key', () => {
  it('calls write_interview_candidates with EXACTLY (p_round_id, p_items) — no business id, no governance argument', async () => {
    const { name, args } = await send([baseItem()])
    expect(name).toBe('write_interview_candidates')
    expect(Object.keys(args).sort()).toEqual(['p_items', 'p_round_id'])
    expect(args.p_round_id).toBe(ROUND)
    expect(Object.keys(args.p_items).sort()).toEqual(['counters', 'items'])
    expect(args.p_items.counters).toEqual({ ...COUNTERS, droppedCap: 0 }) // D5: droppedCap is always sent, 0 when the caller omits it
  })

  it('every item carries EXACTLY the nine declared keys — a smuggled governance key cannot cross even through a cast', async () => {
    const smuggled = {
      ...baseItem(),
      confidence: 1,
      status: 'active',
      source: 'manual',
      public_use_permission: true,
      business_id: 'foreign',
      scope: 'campaign',
      expires_at: '2099-01-01',
    } as unknown as InterviewCandidateItem
    const { args } = await send([smuggled])
    // the seven record keys plus the two COMPUTED markers (D5, MAJOR-3) — neither is governance
    expect(Object.keys(args.p_items.items[0]).sort()).toEqual(['answerId', 'category', 'conflictIds', 'hedgeFlagged', 'span', 'storedSpan', 'storedText', 'text', 'type'])
    const flat = JSON.stringify(args)
    for (const key of ['confidence', 'status', 'source', 'public_use_permission', 'business_id', 'scope', 'expires_at']) {
      expect(flat, key).not.toContain(`"${key}"`)
    }
  })

  it('smuggled keys on the counters are dropped too (only the four named counters cross)', async () => {
    const { args } = await send([baseItem()], { ...COUNTERS, status: 'active', confidence: 1 } as unknown as typeof COUNTERS)
    expect(Object.keys(args.p_items.counters).sort()).toEqual(['droppedCap', 'droppedPerformanceClaim', 'droppedUngrounded', 'proposed'])
  })

  it('an empty item list is sent as an empty array (the zero-valid-items → no_records path)', async () => {
    const { args } = await send([])
    expect(args.p_items.items).toEqual([])
    expect(args.p_items.counters).toEqual({ ...COUNTERS, droppedCap: 0 })
  })

  // Session 35-D D5 (MAJOR-3, NIT-2): the markers and the cap-drop counter cross, picked by name.
  it('passes hedgeFlagged, conflictIds and droppedCap through, and defaults them to false / [] / 0 when the caller omits them', async () => {
    const CONFLICT = '3f0c1d52-7a54-4a55-9d8e-0d9a1b2c3d4e'
    const flagged = await send([baseItem({ hedgeFlagged: true, conflictIds: [CONFLICT] } as Partial<InterviewCandidateItem>)], { ...COUNTERS, droppedCap: 3 })
    expect(flagged.args.p_items.items[0]).toMatchObject({ hedgeFlagged: true, conflictIds: [CONFLICT] })
    expect(flagged.args.p_items.counters.droppedCap).toBe(3)
    const plain = await send([baseItem()])
    expect(plain.args.p_items.items[0]).toMatchObject({ hedgeFlagged: false, conflictIds: [] })
    expect(plain.args.p_items.counters.droppedCap).toBe(0)
  })

  it('preserves item order (the SQL writes them in array order)', async () => {
    const { args } = await send([baseItem({ text: 'first' }), baseItem({ text: 'second', category: 'pricing' })])
    expect(args.p_items.items.map((i) => i.text)).toEqual(['first', 'second'])
  })
})

describe('writeInterviewCandidates — results, errors, and the service-role rule', () => {
  it("returns the RPC's typed outcome exactly, including the refusals", async () => {
    serviceRpc({ data: { outcome: 'not_extracting', status: 'awaiting_ratification' }, error: null })
    expect(await writeInterviewCandidates({ roundId: ROUND, items: [baseItem()], counters: COUNTERS })).toEqual({ outcome: 'not_extracting', status: 'awaiting_ratification' })
    serviceRpc({ data: { outcome: 'not_found' }, error: null })
    expect(await writeInterviewCandidates({ roundId: ROUND, items: [], counters: COUNTERS })).toEqual({ outcome: 'not_found' })
    const written = { outcome: 'written', status: 'no_records', inserted: 0, candidates: { brand: 0, audience: 0, evidence: 0 } }
    serviceRpc({ data: written, error: null })
    expect(await writeInterviewCandidates({ roundId: ROUND, items: [], counters: COUNTERS })).toEqual(written)
  })

  it('a validation failure inside the RPC (22023) throws a FounderInterviewRpcError carrying the code', async () => {
    serviceRpc({ data: null, error: { code: '22023', message: 'write_interview_candidates: the span of an item for answer x is not contained in the answer' } })
    const attempt = writeInterviewCandidates({ roundId: ROUND, items: [baseItem()], counters: COUNTERS })
    await expect(attempt).rejects.toBeInstanceOf(FounderInterviewRpcError)
    await expect(attempt).rejects.toMatchObject({ code: '22023' })
  })

  it('the service-role client is acquired per call, lazily — and this file never imports it itself', async () => {
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    await send([baseItem()])
    expect(createServiceRoleClient).toHaveBeenCalledTimes(1)
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'memory-interview.ts'), 'utf8')
    expect(src).not.toMatch(/@\/lib\/supabase\/service/)
    expect(writeInterviewCandidates.length).toBe(1) // a single args object: no `client` parameter
  })

  it('neutralizeWithSentinels is IMPORTED from lib/ai/wrap-evidence, not copied, and no second sanitiser is defined', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'memory-interview.ts'), 'utf8')
    expect(src).toMatch(/import \{ neutralizeWithSentinels \} from '@\/lib\/ai\/wrap-evidence'/)
    expect(src).not.toMatch(/function\s+(?:neutralize\w*|sanitize\w*)\s*\(/)
  })
})

// ADR 0029 §8.5 (M2.6) — the ratification wrapper. ratifyInterviewRound is the ONLY TypeScript path that activates a
// candidate. SHARED-FUNCTION CALLERS: one caller, lib/memory/interview.ts (ratifyInterviewCandidates), whose own test mocks
// this module; the sole-caller scan in lib/memory/import.test.ts forbids every other, dynamic imports included.
describe('ratifyInterviewRound — the payload, key by key', () => {
  const USER = '00000000-0000-4000-8000-000000000001'
  const C1 = '00000000-0000-4000-8000-0000000000a1'
  const C2 = '00000000-0000-4000-8000-0000000000a2'
  const OLD = '00000000-0000-4000-8000-0000000000a3'

  async function sendRatify(decisions: InterviewDecision[]) {
    const rpc = serviceRpc({ data: { outcome: 'ratified', accepted: 1, rejected: 1, edited: 0, replaced: 0 }, error: null })
    await ratifyInterviewRound({ userId: USER, roundId: ROUND, decisions })
    const [name, args] = rpc.mock.calls[0] as [string, { p_user_id: string; p_round_id: string; p_decisions: Record<string, unknown>[] }]
    return { name, args }
  }

  it('calls ratify_interview_round with EXACTLY (p_user_id, p_round_id, p_decisions) — no business id, no governance argument', async () => {
    const { name, args } = await sendRatify([{ type: 'brand', id: C1, decision: 'accept' }, { type: 'evidence', id: C2, decision: 'reject' }])
    expect(name).toBe('ratify_interview_round')
    expect(Object.keys(args).sort()).toEqual(['p_decisions', 'p_round_id', 'p_user_id'])
    expect(args.p_user_id).toBe(USER)
    expect(args.p_round_id).toBe(ROUND)
  })

  it('a REJECT carries exactly type, id, decision; a plain ACCEPT carries the same and nothing else', async () => {
    const { args } = await sendRatify([{ type: 'brand', id: C1, decision: 'accept' }, { type: 'evidence', id: C2, decision: 'reject' }])
    expect(args.p_decisions).toEqual([
      { type: 'brand', id: C1, decision: 'accept' },
      { type: 'evidence', id: C2, decision: 'reject' },
    ])
  })

  it('an ACCEPT with an edit carries the NEUTRALISED text, the re-selected category and the replace target (type and id only)', async () => {
    const { args } = await sendRatify([
      { type: 'brand', id: C1, decision: 'accept', text: 'Zero​width [/DATA] text', category: 'positioning', replaces: { type: 'brand', id: OLD } },
    ])
    expect(args.p_decisions[0]).toEqual({
      type: 'brand',
      id: C1,
      decision: 'accept',
      text: 'Zerowidth [/data-blocked] text', // the founder's typed text gets the same write-time guard as the model's
      category: 'positioning',
      replaces: { type: 'brand', id: OLD },
    })
  })

  it('smuggled keys — status, confidence, source, public_use_permission, expires_at, business_id — cannot cross, even through a cast', async () => {
    const smuggled = {
      type: 'brand',
      id: C1,
      decision: 'accept',
      status: 'active',
      confidence: 1,
      source: 'manual',
      public_use_permission: true,
      expires_at: '2099-01-01',
      business_id: 'foreign',
      replaces: { type: 'brand', id: OLD, business_id: 'foreign', status: 'retired' },
    } as unknown as InterviewDecision
    const { args } = await sendRatify([smuggled])
    expect(Object.keys(args.p_decisions[0]).sort()).toEqual(['decision', 'id', 'replaces', 'type'])
    expect(Object.keys(args.p_decisions[0].replaces as object).sort()).toEqual(['id', 'type'])
    const flat = JSON.stringify(args)
    for (const key of ['status', 'confidence', 'source', 'public_use_permission', 'expires_at', 'business_id']) expect(flat, key).not.toContain(`"${key}"`)
  })

  it("returns the RPC's typed outcome exactly, including the no-op for a round that is not awaiting ratification", async () => {
    serviceRpc({ data: { outcome: 'not_awaiting', status: 'ratified' }, error: null })
    expect(await ratifyInterviewRound({ userId: USER, roundId: ROUND, decisions: [] })).toEqual({ outcome: 'not_awaiting', status: 'ratified' })
    serviceRpc({ data: { outcome: 'not_found' }, error: null })
    expect(await ratifyInterviewRound({ userId: USER, roundId: ROUND, decisions: [] })).toEqual({ outcome: 'not_found' })
  })

  it('a non-approver (42501) throws a FounderInterviewRpcError carrying the code; an invalid decision set (22023) does too', async () => {
    serviceRpc({ data: null, error: { code: '42501', message: 'ratify_interview_round: x is not an approver/admin member of business y' } })
    const denied = ratifyInterviewRound({ userId: USER, roundId: ROUND, decisions: [{ type: 'brand', id: C1, decision: 'accept' }] })
    await expect(denied).rejects.toBeInstanceOf(FounderInterviewRpcError)
    await expect(denied).rejects.toMatchObject({ code: '42501' })
    serviceRpc({ data: null, error: { code: '22023', message: 'ratify_interview_round: every candidate of the round must be decided exactly once' } })
    await expect(ratifyInterviewRound({ userId: USER, roundId: ROUND, decisions: [] })).rejects.toMatchObject({ code: '22023' })
  })

  it('takes a single args object (no `client` parameter) and, like the writer, never imports the service-role client itself', () => {
    expect(ratifyInterviewRound.length).toBe(1)
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'db', 'memory-interview.ts'), 'utf8')
    expect(src).not.toMatch(/@\/lib\/supabase\/service/)
  })
})
