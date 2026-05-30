import Anthropic from '@anthropic-ai/sdk'
import { AiError } from './errors'
import { MODELS, calculateCostCents } from './models'
import { safeParseOrAiError } from './parsers'
import { getAnthropicClient, type AiClientLike } from './client'
import type { Prompt } from './prompts/types'
import type { CustomerContext } from './context'
import { countRecentCalls, recordAiUsage } from '@/lib/db/ai-usage'
import { incrementBrandVoiceAttempts, incrementPostsGenerated } from '@/lib/db/trial-state'

const BRAND_VOICE_PROMPT_ID = 'brand-voice-inference'
const POST_GENERATION_PROMPT_ID = 'post-generation'
const RETRY_DELAY_MS = 2000
const CACHE_CONTROL_CHAR_THRESHOLD = 4096 // chars / 4 ≈ tokens; 4096 chars ≈ 1024 tokens
const DEFAULT_MAX_TOKENS = 4096

function isBrandVoice(promptId: string): boolean {
  return promptId === BRAND_VOICE_PROMPT_ID
}

// R-1 (ADR 0004): orchestrator owns the bulk counter increment for post-generation.
// Runner skips step-8 for this prompt id to avoid per-call undercounting.
function isPostGeneration(promptId: string): boolean {
  return promptId === POST_GENERATION_PROMPT_ID
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function mapSdkError(err: unknown): AiError {
  const status = (err as { status?: number }).status
  const msg = (err as { message?: string }).message ?? 'Unknown error'
  if (status === 429) return new AiError('rate_limit', `API rate limit: ${msg}`)
  if (status !== undefined && status >= 500) return new AiError('provider_error', `API server error ${status}: ${msg}`)
  return new AiError('provider_error', `API error: ${msg}`)
}

async function callWithRetry(
  client: AiClientLike,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params)
  } catch (firstErr: unknown) {
    const status = (firstErr as { status?: number }).status
    if (status === 429 || (status !== undefined && status >= 500)) {
      await sleep(RETRY_DELAY_MS)
      return await client.messages.create(params) // second failure propagates to caller
    }
    throw firstErr
  }
}

export async function runPrompt<TInput, TOutput>(
  prompt: Prompt<TInput, TOutput>,
  context: CustomerContext,
  input: TInput,
): Promise<TOutput> {
  // ── STEP 1: Trial cap check (must be first — C-1) ─────────────────────
  if (context.trialState !== null) {
    if (isBrandVoice(prompt.id) && context.trialState.brandVoiceAttemptsRemaining <= 0) {
      throw new AiError('quota_exceeded', 'Brand voice inference trial limit reached')
    }
    if (!isBrandVoice(prompt.id) && context.trialState.postsRemaining <= 0) {
      throw new AiError('quota_exceeded', 'Post generation trial limit reached')
    }
  }

  // ── STEP 2: Rate limit check ──────────────────────────────────────────
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const { config } = await import('@/lib/config')
  const serviceClient = createServiceRoleClient()

  const recentCount = await countRecentCalls(serviceClient, context.business.id, 60, prompt.id)
  const rateLimit = isBrandVoice(prompt.id)
    ? config.server.AI_RATE_LIMIT_BRAND_VOICE_PER_MIN
    : config.server.AI_RATE_LIMIT_POST_GENERATION_PER_MIN
  if (recentCount >= rateLimit) {
    throw new AiError('rate_limited', 'Rate limit exceeded — try again in a moment')
  }

  // ── STEP 3: Assemble messages ─────────────────────────────────────────
  const systemText = prompt.buildSystemPrompt(context)
  const isLarge = systemText.length > CACHE_CONTROL_CHAR_THRESHOLD
  const systemContent: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: systemText,
      ...(isLarge ? { cache_control: { type: 'ephemeral' } } : {}),
    },
  ]

  const userContextMsg = JSON.stringify(context)
  const userMsg = prompt.buildUserMessage(input, context)

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: userContextMsg },
        { type: 'text', text: userMsg },
      ],
    },
  ]

  const sdkParams: Anthropic.MessageCreateParamsNonStreaming & { _sosh?: { promptId: string; input: unknown } } = {
    model: MODELS[prompt.modelKey].id,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: systemContent,
    messages,
    // _sosh is stripped by the real Anthropic SDK (unknown fields ignored).
    // MockAnthropicClient reads it to route to per-prompt-id fixtures.
    _sosh: { promptId: prompt.id, input },
  }

  // ── STEPS 4-8: SDK call, parse, cost, usage, increment ───────────────
  const aiClient = await getAnthropicClient()
  const startTime = Date.now()

  let response: Anthropic.Message | null = null
  let costCents = 0
  // Track usage outcome in plain primitives (avoids TS CFA narrowing to never
  // when try/finally joins exception and normal paths).
  let usageSuccess = false
  let usageErrorCode: string | null = null

  try {
    // Step 4: SDK call with one retry
    try {
      response = await callWithRetry(aiClient, sdkParams)
    } catch (sdkErr: unknown) {
      const err = sdkErr instanceof AiError ? sdkErr : mapSdkError(sdkErr)
      usageErrorCode = err.code
      throw err
    }

    // Step 5: Parse output
    const textBlock = response.content.find(b => b.type === 'text')
    const rawText = textBlock?.type === 'text' ? textBlock.text : ''
    let parsed: TOutput
    try {
      parsed = safeParseOrAiError(prompt.outputSchema, rawText)
    } catch (parseErr: unknown) {
      const err =
        parseErr instanceof AiError
          ? parseErr
          : new AiError('invalid_response', String(parseErr))
      usageErrorCode = err.code
      throw err
    }

    // Step 6: Compute cost
    costCents = calculateCostCents(
      prompt.modelKey,
      response.usage.input_tokens,
      response.usage.output_tokens,
      (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
    )

    // Step 8: Increment trial counter (success path only).
    // R-1 (ADR 0004): post-generation skips this — orchestrator calls
    // incrementPostsGeneratedBy(businessId, count) once after batch insert.
    if (context.trialState !== null && !isPostGeneration(prompt.id)) {
      try {
        if (isBrandVoice(prompt.id)) {
          await incrementBrandVoiceAttempts(context.business.id)
        } else {
          await incrementPostsGenerated(context.business.id)
        }
      } catch (counterErr: unknown) {
        console.error('runner: failed to increment trial counter', counterErr)
      }
    }

    usageSuccess = true
    return parsed
  } finally {
    // Step 7: Insert ai_usage — always, never throws
    const latencyMs = Date.now() - startTime
    try {
      await recordAiUsage({
        business_id: context.business.id,
        prompt_id: prompt.id,
        prompt_version: prompt.version,
        model: MODELS[prompt.modelKey].id,
        input_tokens:
          (response?.usage.input_tokens ?? 0) +
          ((response?.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0),
        output_tokens: response?.usage.output_tokens ?? 0,
        cost_cents: costCents,
        latency_ms: latencyMs,
        success: usageSuccess,
        error_code: usageErrorCode,
      })
    } catch (usageErr: unknown) {
      console.error('runner: failed to record ai_usage', usageErr)
    }
  }
}
