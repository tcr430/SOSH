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

// Replays fixture JSON. Routing:
// 1. If _sosh.promptId === 'post-generation': load __fixtures__/post-generation/{platform}.json
//    where platform comes from _sosh.input.targetPlatform.
// 2. Otherwise: load __fixtures__/{model}.json (original behaviour).
// Only active when AI_PROVIDER=mock (set in CI / tests).
class MockAnthropicClient implements AiClientLike {
  messages = {
    create: async (
      params: Anthropic.MessageCreateParamsNonStreaming & { _sosh?: { promptId: string; input: unknown } },
    ): Promise<Anthropic.Message> => {
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
