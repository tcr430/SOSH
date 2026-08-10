import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Guard ─────────────────────────────────────────────────────────────────

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error('getAnthropicClient cannot be called in browser code')
  }
}

// ─── Interface ─────────────────────────────────────────────────────────────

// The minimal surface runner.ts needs. Both the real Anthropic SDK and
// MockAnthropicClient satisfy this interface via structural typing.
export interface AiClientLike {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>
  }
}

// ─── Mock client ───────────────────────────────────────────────────────────

// ADR 0021 §10.4 (Session 28 E5.8) — the eval harness's deterministic-replay
// hook. Neither runPrompt nor runToolLoop accepts an injectable AiClientLike
// (by design — see lib/ai/runner.ts's/tool-runner.ts's own headers), so
// per-corpus-example cassette replay has to happen at THIS existing mock
// boundary, not a new one. When the queue is set and non-empty, each call
// consumes the next response in FIFO order — this is what lets a single
// corpus example's cassette express a multi-turn tool-use conversation, not
// just a fixed per-model response. The harness clears the queue after each
// example; every other caller (production tests, `AI_PROVIDER=mock` in
// app-tests.yml) never sets it, so their behaviour is byte-identical to
// before this addition.
declare global {
  // eslint-disable-next-line no-var -- `var` is required for global augmentation
  var __evalCassetteQueue: Anthropic.Message[] | undefined
}

// Replays fixture JSON. Routing:
// 1. If globalThis.__evalCassetteQueue is set and non-empty: shift() the
//    next recorded response (the eval harness's cassette replay).
// 2. If _sosh.promptId === 'post-generation': load __fixtures__/post-generation/{platform}.json
//    where platform comes from _sosh.input.targetPlatform.
// 3. Otherwise: load __fixtures__/{model}.json (original behaviour).
// Only active when AI_PROVIDER=mock (set in CI / tests).
class MockAnthropicClient implements AiClientLike {
  messages = {
    create: async (
      params: Anthropic.MessageCreateParamsNonStreaming & { _sosh?: { promptId: string; input: unknown } },
    ): Promise<Anthropic.Message> => {
      if (Array.isArray(globalThis.__evalCassetteQueue) && globalThis.__evalCassetteQueue.length > 0) {
        return globalThis.__evalCassetteQueue.shift() as Anthropic.Message
      }

      let fixturePath: string

      const sosh = params._sosh
      if (sosh?.promptId === 'post-generation') {
        const platform = (sosh.input as { targetPlatform?: string }).targetPlatform ?? 'unknown'
        fixturePath = resolve(
          process.cwd(),
          'lib/ai/__fixtures__/post-generation',
          `${platform}.json`,
        )
      } else {
        fixturePath = resolve(
          process.cwd(),
          'lib/ai/__fixtures__',
          `${params.model}.json`,
        )
      }

      try {
        return JSON.parse(readFileSync(fixturePath, 'utf-8')) as Anthropic.Message
      } catch {
        const hint = sosh?.promptId === 'post-generation'
          ? `create lib/ai/__fixtures__/post-generation/{platform}.json`
          : `create lib/ai/__fixtures__/${params.model}.json`
        throw new Error(`MockAnthropicClient: fixture not found — ${hint}`)
      }
    },
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _realClient: Anthropic | null = null
let _mockClient: MockAnthropicClient | null = null

// Lazy-imports config to avoid publicSchema.parse() at module load time,
// which would crash tests that run without NEXT_PUBLIC_* env vars (ADR C-8,
// cerebrum.md Do-Not-Repeat 2026-05-03).
export async function getAnthropicClient(): Promise<AiClientLike> {
  assertServer()
  const { config } = await import('@/lib/config')

  if (config.server.AI_PROVIDER === 'mock') {
    if (!_mockClient) _mockClient = new MockAnthropicClient()
    return _mockClient
  }

  if (!_realClient) {
    _realClient = new Anthropic({ apiKey: config.server.ANTHROPIC_API_KEY })
  }
  return _realClient
}

// Resets singleton state. Only for use in test teardown.
export function _resetClient(): void {
  _realClient = null
  _mockClient = null
}
