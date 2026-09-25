import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/service'
import { FounderInterviewRpcError } from './founder-interview-rounds'
import { writeInterviewCandidates, type InterviewCandidateItem } from './memory-interview'

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
async function send(items: InterviewCandidateItem[], counters = COUNTERS): Promise<{ name: string; args: Sent }> {
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
    expect(args.p_items.counters).toEqual(COUNTERS)
  })

  it('every item carries EXACTLY the seven declared keys — a smuggled governance key cannot cross even through a cast', async () => {
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
    expect(Object.keys(args.p_items.items[0]).sort()).toEqual(['answerId', 'category', 'span', 'storedSpan', 'storedText', 'text', 'type'])
    const flat = JSON.stringify(args)
    for (const key of ['confidence', 'status', 'source', 'public_use_permission', 'business_id', 'scope', 'expires_at']) {
      expect(flat, key).not.toContain(`"${key}"`)
    }
  })

  it('smuggled keys on the counters are dropped too (only the three named counters cross)', async () => {
    const { args } = await send([baseItem()], { ...COUNTERS, status: 'active', confidence: 1 } as unknown as typeof COUNTERS)
    expect(Object.keys(args.p_items.counters).sort()).toEqual(['droppedPerformanceClaim', 'droppedUngrounded', 'proposed'])
  })

  it('an empty item list is sent as an empty array (the zero-valid-items → no_records path)', async () => {
    const { args } = await send([])
    expect(args.p_items.items).toEqual([])
    expect(args.p_items.counters).toEqual(COUNTERS)
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
