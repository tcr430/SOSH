import type { z } from 'zod'
import type { ModelKey } from '@/lib/ai/models'
import type { CustomerContext } from '@/lib/ai/context'

export interface Prompt<TInput, TOutput> {
  readonly id: string
  readonly version: number
  readonly modelKey: ModelKey
  readonly outputSchema: z.ZodType<TOutput>
  readonly buildSystemPrompt: (ctx: CustomerContext) => string
  readonly buildUserMessage: (input: TInput, ctx: CustomerContext) => string
  // ADR 0019 §4.5 — founder ruling A-5. Optional; runner.ts:131 reads
  // `prompt.maxTokens ?? DEFAULT_MAX_TOKENS`, so every existing prompt
  // (none of which sets this) is UNCHANGED behaviour — proven, not just
  // claimed, by STUDIO-RUNNER-DEFAULT-PRESERVED (lib/ai/runner.test.ts).
  readonly maxTokens?: number
  // ADR 0024 §3.1 — sampling and thinking as versioned prompt properties,
  // the direct sibling of maxTokens above. Optional; runner.ts reads
  // `prompt.temperature` / `prompt.thinking` with the same `??`-and-omit
  // shape, so every existing prompt (none of which sets these) is
  // UNCHANGED behaviour — proven by QUAL-SAMPLING-DEFAULT-PRESERVED
  // (lib/ai/runner.test.ts). A change to either value, or to modelKey or
  // maxTokens, must bump `version` in the same commit (ADR C-4, extended by
  // ADR 0024 §3.2) — enforced by
  // lib/ai/prompts/prompt-properties.frozen-table.test.ts.
  readonly temperature?: number
  // Thinking budget in tokens. Spent OUT OF maxTokens, not additive to it
  // (ADR 0024 §3.3a) — a prompt declaring `thinking` must also declare a
  // `maxTokens` large enough to leave room for visible output.
  readonly thinking?: number
}
