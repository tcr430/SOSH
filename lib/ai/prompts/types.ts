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
}
