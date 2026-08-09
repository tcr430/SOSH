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
// ADR 0017 §4.4/§7 (B2.6 BLOCKER fix) — both native-generation format-family
// prompts (lib/ai/prompts/formats/native-generation-prompt.ts) join
// 'post-generation' in the batch-tracked set: generate.ts's STEP 11 calls
// incrementPostsGeneratedBy(businessId, postsCreated) ONCE after the batch
// insert, exactly like the old flat post-generation flow did. Without this,
// every native-generation call (N per campaign, not 1) AND every hook-loop
// regeneration would ALSO increment the per-call counter here, on top of the
// batch increment — B2.4 flagged this exact gap as "B2.6 must resolve";
// it was not resolved when generate.ts first landed, and is fixed here.
const NATIVE_GENERATION_PROMPT_IDS = new Set(['native-generation-single', 'native-generation-thread'])
const RUBRIC_PROMPT_ID = 'rubric'
// Must match lib/signals/triage/card.ts's own CARD_GENERATION_PROMPT_ID
// exactly — duplicated as a literal (not imported) because lib/ai/ must not
// depend on lib/signals/ (the dependency runs the other way, ADR 0021 §2.1).
const CARD_GENERATION_PROMPT_ID = 'signal-card-generation'
const RETRY_DELAY_MS = 2000
const CACHE_CONTROL_CHAR_THRESHOLD = 4096 // chars / 4 ≈ tokens; 4096 chars ≈ 1024 tokens
const DEFAULT_MAX_TOKENS = 4096

function isBrandVoice(promptId: string): boolean {
  return promptId === BRAND_VOICE_PROMPT_ID
}

// R-1 (ADR 0004) + B2.6 — orchestrator owns the bulk counter increment for
// post-generation. Runner skips step-8 for these prompt ids to avoid
// per-call over-counting; the caller batch-increments once after insert.
function isPostGeneration(promptId: string): boolean {
  return promptId === POST_GENERATION_PROMPT_ID || NATIVE_GENERATION_PROMPT_IDS.has(promptId)
}

// A scoring call (the rubric, ADR §6/§7) never generates a post and never
// consumes brand-voice quota — it must increment NEITHER trial counter.
// ADR 0021 §4.2 (Session 28 E5.7) — CARD_GENERATION_PROMPT_ID joins this set
// for the same reason: a triage card is not a post the user requested
// generated, and incrementing posts_generated_count for it would silently
// eat into the trial post cap for a feature the user never asked to run.
function isScoringOnly(promptId: string): boolean {
  return promptId === RUBRIC_PROMPT_ID || promptId === CARD_GENERATION_PROMPT_ID
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

  // L-8 (ADR 0016 §7) — no raw JSON.stringify(context) dump. Everything a
  // prompt needs from the context is already rendered by
  // buildSystemPrompt (stable, cache_control-eligible above) and
  // buildUserMessage (per-call, retrieved slice). The dump was redundant
  // over-inclusion that also sat UNCACHED, on top of poisoning nothing but
  // wasting tokens every call — removing it is pure cache-economics cleanup,
  // not a behaviour change: no prompt template reads a field that isn't
  // already rendered through one of these two functions.
  const userMsg = prompt.buildUserMessage(input, context)

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: userMsg }],
    },
  ]

  const sdkParams: Anthropic.MessageCreateParamsNonStreaming & { _sosh?: { promptId: string; input: unknown } } = {
    model: MODELS[prompt.modelKey].id,
    // ADR 0019 §4.5, founder ruling A-5 — the WHOLE change: one optional
    // field, one ??. Every existing prompt leaves maxTokens unset, so this
    // resolves to exactly DEFAULT_MAX_TOKENS for all of them, unchanged
    // (STUDIO-RUNNER-DEFAULT-PRESERVED, lib/ai/runner.test.ts).
    max_tokens: prompt.maxTokens ?? DEFAULT_MAX_TOKENS,
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

    // Step 5: Parse output. ADR 0019 §5.4 [sec-HIGH-7] — check stop_reason
    // BEFORE attempting to parse: a response cut off by max_tokens is not
    // malformed content, it's an availability failure, and treating it as
    // invalid_response makes truncation indistinguishable from a genuine
    // parse failure (callWithRetry only retries 429/5xx, never either of
    // these) — a long draft would fail 100% of the time with a misleading
    // error and no actionable message.
    if (response.stop_reason === 'max_tokens') {
      const err = new AiError('response_truncated', 'Response truncated at max_tokens')
      usageErrorCode = err.code
      throw err
    }

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
    // R-1 (ADR 0004): post-generation (flat + native-generation-*) skips this
    // — the orchestrator batch-increments once after insert. A scoring-only
    // call (rubric) skips this too — it never generates a post or consumes
    // brand-voice quota (B2.6 BLOCKER fix).
    if (context.trialState !== null && !isPostGeneration(prompt.id) && !isScoringOnly(prompt.id)) {
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
