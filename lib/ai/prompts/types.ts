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
}
