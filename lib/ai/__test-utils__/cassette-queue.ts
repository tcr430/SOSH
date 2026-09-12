import type Anthropic from '@anthropic-ai/sdk'

// ADR 0024 §4.5(3), §10.2 (Session 31, H2.3) — __evalCassetteQueue
// (lib/ai/client.ts:38-41 declaration, :55-56 the shift()) is a single
// GLOBAL FIFO that MockAnthropicClient consumes ahead of its normal
// fixture-file routing. It exists today for the eval harness's
// per-corpus-example cassette replay; it is ALSO exactly the mechanism
// argmax-determinism tests need — a sequence of DISTINCT payloads for one
// promptId, so N candidate calls don't return byte-identical JSON and
// collapse into an untestable N-way tie (ADR §4.5 blocker 2). Built ON that
// existing mechanism, not a second one beside it.
//
// Because the queue is a single global, a test that leaves it non-empty
// POISONS THE NEXT FILE. enqueueCassettes / drainCassetteQueue below are the
// ONLY sanctioned way to touch it from a test — every step after H2.3 that
// needs distinct candidate payloads goes through this helper.

/**
 * Loads a sequence of distinct Anthropic responses into the global cassette
 * queue. MockAnthropicClient.messages.create shift()s one per call, in
 * order, ahead of its normal per-promptId fixture routing.
 */
export function enqueueCassettes(messages: Anthropic.Message[]): void {
  globalThis.__evalCassetteQueue = [...messages]
}

/**
 * Call unconditionally in test teardown (afterEach / finally). FAILS LOUDLY
 * — throws — if the queue is non-empty, rather than silently letting a
 * leftover cassette carry into the next test file. A harness whose failure
 * mode is silent is worse than no harness.
 */
export function drainCassetteQueue(): void {
  const remaining = globalThis.__evalCassetteQueue?.length ?? 0
  globalThis.__evalCassetteQueue = undefined
  if (remaining > 0) {
    throw new Error(
      `drainCassetteQueue: ${remaining} cassette(s) left unconsumed — a test enqueued more responses than it consumed, which would poison the next test file's queue.`,
    )
  }
}

/** Builds a minimal text-block Anthropic.Message wrapping a JSON body — the shape MockAnthropicClient / runner.ts's parse path expect. */
export function makeCassetteMessage(body: unknown): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: [{ type: 'text', text: JSON.stringify(body), citations: [] }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Message
}
