import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { AiClientLike } from '../../lib/ai/client'
import { TRIAGE_MAX_TURNS } from '../../lib/ai/tool-runner'
import {
  runBoundedTriageLoop,
  buildStubTriageTools,
  buildDegradedSystemPrompt,
  mergeCassetteIntoCorpus,
  toFakeCandidate,
} from './live-triage-run'

// ADR 0023 §2.4.1/§10.5 (Session 30 G1b.13) — this file tests the PURE and
// INJECTABLE-CLIENT pieces of live-triage-run.ts. It never calls the real
// Anthropic API — runBoundedTriageLoop's `client` parameter exists exactly
// so this is possible, per the build guide's own "no live call in a test"
// discipline (the harness distinguishes the deterministic replay,
// run-triage-eval.ts, from the one-off live run this script performs — a
// test file calling the real API would blur that line). main() itself
// (the real network calls + file writes) is intentionally NOT covered here
// — it is Tier E, run once, out-of-band, by a human invoking the script.

function textResponse(json: unknown): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: JSON.stringify(json), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, service_tier: null },
  } as unknown as Anthropic.Message
}

function toolUseResponse(name: string, input: unknown): Anthropic.Message {
  return {
    id: 'msg_tool',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'tool_use', id: 'tool_1', name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 80, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, service_tier: null },
  } as unknown as Anthropic.Message
}

const VALID_DECISION = { verdict: 'card', reason: 'a real reason', citableEvidenceIds: [], citableBrandIds: [], audienceNote: 'note' }

describe('runBoundedTriageLoop', () => {
  it('a text decision on the first turn returns outcome: decision with cost and turn/tool counts', async () => {
    const create = vi.fn().mockResolvedValue(textResponse(VALID_DECISION))
    const client: AiClientLike = { messages: { create } }

    const result = await runBoundedTriageLoop(client, 'system', 'user', buildStubTriageTools())

    expect(result.outcome).toBe('decision')
    expect(result.decision).toEqual(VALID_DECISION)
    expect(result.turnsUsed).toBe(1)
    expect(result.toolCallsUsed).toBe(0)
    expect(result.costCents).toBeGreaterThan(0)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('dispatches a tool_use block, feeds back a tool_result, then accepts the following decision', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse('list_evidence', { objective: 'x' }))
      .mockResolvedValueOnce(textResponse(VALID_DECISION))
    const client: AiClientLike = { messages: { create } }
    const tools = buildStubTriageTools()
    const evidenceExecute = vi.spyOn(tools[0], 'execute')

    const result = await runBoundedTriageLoop(client, 'system', 'user', tools)

    expect(result.outcome).toBe('decision')
    expect(result.turnsUsed).toBe(2)
    expect(result.toolCallsUsed).toBe(1)
    expect(evidenceExecute).toHaveBeenCalledWith({ objective: 'x' })

    // The second request must carry the assistant tool_use turn AND the
    // tool_result reply — otherwise the API would reject the conversation.
    const secondCallArgs = create.mock.calls[1][0] as Anthropic.MessageCreateParamsNonStreaming
    const roles = secondCallArgs.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user'])
  })

  it('an unparseable decision returns outcome: failed, reason invalid_response', async () => {
    const create = vi.fn().mockResolvedValue(textResponse({ verdict: 'not-a-real-verdict' }))
    const client: AiClientLike = { messages: { create } }

    const result = await runBoundedTriageLoop(client, 'system', 'user', buildStubTriageTools())

    expect(result.outcome).toBe('failed')
    expect(result.failureReason).toBe('invalid_response')
  })

  it('a model that only ever calls tools, never deciding, exhausts TRIAGE_MAX_TURNS and fails max_turns_exceeded', async () => {
    const create = vi.fn().mockResolvedValue(toolUseResponse('list_evidence', {}))
    const client: AiClientLike = { messages: { create } }

    const result = await runBoundedTriageLoop(client, 'system', 'user', buildStubTriageTools())

    expect(result.outcome).toBe('failed')
    expect(result.failureReason).toBe('max_turns_exceeded')
    expect(result.turnsUsed).toBe(TRIAGE_MAX_TURNS)
    expect(create).toHaveBeenCalledTimes(TRIAGE_MAX_TURNS)
  })

  it('an unknown tool name is absorbed as an error tool_result rather than crashing the loop', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse('not_a_real_tool', {}))
      .mockResolvedValueOnce(textResponse(VALID_DECISION))
    const client: AiClientLike = { messages: { create } }

    const result = await runBoundedTriageLoop(client, 'system', 'user', buildStubTriageTools())

    expect(result.outcome).toBe('decision')
    // An unknown-tool turn does not consume a real tool call.
    expect(result.toolCallsUsed).toBe(0)
    expect(result.turnsUsed).toBe(2)
  })
})

describe('buildStubTriageTools', () => {
  it('exposes the same four tool names as production, each resolving to an empty result', async () => {
    const tools = buildStubTriageTools()
    expect(tools.map((t) => t.name)).toEqual(['list_evidence', 'list_audience_notes', 'list_brand_claims', 'list_recent_campaigns'])
    expect(await tools[0].execute({})).toEqual({ ids: [], evidence: '' })
    expect(await tools[1].execute({})).toEqual([])
    expect(await tools[2].execute({})).toEqual([])
    expect(await tools[3].execute({})).toEqual([])
  })
})

describe('buildDegradedSystemPrompt', () => {
  it('appends an override that contradicts the clean prompt, without removing the clean text', () => {
    const clean = 'Decide "card" only if genuinely noteworthy.'
    const degraded = buildDegradedSystemPrompt(clean)
    expect(degraded).toContain(clean)
    expect(degraded).toContain('Always decide "card"')
  })
})

describe('mergeCassetteIntoCorpus', () => {
  function makeCorpus() {
    return {
      corpusVersion: 2,
      labelCommitSha: 'abc',
      cassetteCommitSha: null,
      examples: [
        {
          id: 'mr-01',
          source: 'market_responsive' as const,
          signal: { title: 't', html_url: null, occurred_at: '2026-01-01T00:00:00Z', is_prerelease: false, author_is_bot: false, body: 'b' },
          stubMemory: {},
          expectedVerdict: 'card' as const,
          cassette: undefined as Array<{ verdict: string; reason: string; citableEvidenceIds: string[]; citableBrandIds: string[]; audienceNote: string }> | undefined,
        },
      ],
    }
  }

  it('sets the cassette field to [decision]', () => {
    const corpus = makeCorpus()
    mergeCassetteIntoCorpus(corpus, 'mr-01', { verdict: 'card', reason: 'r', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' })
    expect(corpus.examples[0].cassette).toEqual([{ verdict: 'card', reason: 'r', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' }])
  })

  it('throws on an unknown example id', () => {
    const corpus = makeCorpus()
    expect(() => mergeCassetteIntoCorpus(corpus, 'nope', { verdict: 'card', reason: '', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' })).toThrow(/no example with id/)
  })

  it('throws rather than silently overwriting an existing cassette', () => {
    const corpus = makeCorpus()
    corpus.examples[0].cassette = [{ verdict: 'card', reason: 'first', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' }]
    expect(() => mergeCassetteIntoCorpus(corpus, 'mr-01', { verdict: 'no_card', reason: 'second', citableEvidenceIds: [], citableBrandIds: [], audienceNote: '' })).toThrow(/already has a cassette/)
  })
})

describe('toFakeCandidate', () => {
  it('carries the signal title/body/source through so the real prompt builders can consume it', () => {
    const example = {
      id: 'mr-02',
      source: 'market_responsive' as const,
      signal: { title: 'Headline', html_url: 'https://example.test/a', occurred_at: '2026-02-02T00:00:00Z', is_prerelease: false, author_is_bot: false, body: 'Body text' },
      stubMemory: {},
      expectedVerdict: 'no_card' as const,
      expectedDismissReason: 'weak_evidence',
    }
    const candidate = toFakeCandidate(example)
    expect(candidate.signals.source).toBe('rss')
    expect(candidate.signals.watched_feed_id).toBeNull()
    expect(String(candidate.signals.title)).toBe('Headline')
    expect(String(candidate.signals.body)).toBe('Body text')
  })
})
