import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { MODELS, calculateCostCents } from './models'
import { safeParseOrAiError } from './parsers'
import { getAnthropicClient, type AiClientLike } from './client'
import type { CustomerContext } from './context'
import { countRecentCalls, recordAiUsage } from '@/lib/db/ai-usage'

// ADR 0021 §2.1 (Session 28 E5.4) — a SIBLING of runPrompt (lib/ai/runner.ts),
// not an extension of it. runPrompt is NOT modified: a tool-dispatch branch
// in the single-shot path every Mode 1/2 call depends on is the named loser
// (§2.1). This module shares runPrompt's pre-flight (trial cap, rate limit),
// its cache_control policy, its safeParseOrAiError parse and its
// finally-block ai_usage write — because bypassing them would also bypass
// the rate limit and the usage record on a surface AN ATTACKER CAN TRIGGER
// BY MERGING A RELEASE. Per-call bounds cap the cost of one invocation; they
// do not cap how many invocations a hostile or careless repo owner can
// force — only the shared rate limit does that.
//
// `lib/signals/triage/` (E5.5+) holds the tool definitions, the shortlist/
// claim orchestration and the Stage-C prompt. This module holds ONLY the
// loop: it has no knowledge of GitHub, signals, or memory — it is generic
// bounded tool-use machinery, parameterised by the caller's tools and
// prompt text. The loop NEVER writes to any table — no card, no candidate
// status — that is entirely the caller's job once this returns.

// ─── The bounds, as literal numbers (§2.4) ──────────────────────────────────

export const TRIAGE_MAX_TOOL_CALLS = 4
// 5 requests serve 4 tool calls (§2.6); one spare absorbs a malformed tool
// block or a turn spent forcing a decision once TRIAGE_MAX_TOOL_CALLS is
// spent — not a distinct mechanism, just TRIAGE_MAX_TURNS being one larger
// than the typical-path turn count.
export const TRIAGE_MAX_TURNS = 6
export const TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS = 40_000
export const TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN = 1_024
export const TRIAGE_MAX_CUMULATIVE_OUTPUT_TOKENS = 4_000
// Corrected 2026-08-08 from 60_000 (E-2) — 5 x 60s would have consumed the
// entire worker budget before Stage D, the reservation RPC and the DB
// writes (§3.1's deadline).
export const TRIAGE_MAX_WALL_CLOCK_MS = 45_000
// Shared across the WHOLE loop, not per-call (§2.7) — distinct from
// runner.ts's callWithRetry, which retries exactly once per SDK call.
// Retries do NOT consume TRIAGE_MAX_TOOL_CALLS or TRIAGE_MAX_TURNS (a retry
// is the same turn). A FAILED attempt itself contributes no tokens (there is
// no response to read usage from) — what "retries count toward the token
// cap" means precisely: only the turn's eventual RESOLVED response is
// counted, exactly once, same as any turn (security-reviewer, LOW-1 —
// corrected from an earlier overclaim that retries double-count tokens).
// The real cost of a retry storm is wall-clock (RETRY_DELAY_MS per attempt)
// and, over many turns, the conversation-growth pressure §2.6 already
// describes — not per-attempt token inflation. Do not "fix" this by trying
// to exclude a turn's tokens from the cap because it needed a retry.
export const TRIAGE_RETRY_BUDGET = 2

const RETRY_DELAY_MS = 2000
const CACHE_CONTROL_CHAR_THRESHOLD = 4096 // chars / 4 ≈ tokens; matches runner.ts:25
const TRIAGE_PROMPT_ID = 'signal-triage'
const TRIAGE_PROMPT_VERSION = 1
// security-reviewer (E5.4+E5.5+E5.7 pass, MEDIUM-1): TRIAGE_MAX_WALL_CLOCK_MS
// was only checked BETWEEN turns — a single hanging request could blow past
// it before ever being observed. A per-request timeout, well under the
// per-loop wall-clock bound, closes that gap at the request level too.
const TRIAGE_REQUEST_TIMEOUT_MS = 30_000
// A generic message only — security-reviewer (MEDIUM-... / LOW-2): a raw
// tool error (DB/Supabase internals) must never be relayed into the model's
// context. The real error is logged server-side; the model sees only this.
const TOOL_EXECUTION_ERROR_MESSAGE = 'Tool execution failed.'

// ─── §2.8 — what the loop returns. NOTHING ELSE. ────────────────────────────
//
// No `status` field — that absence IS the security control (§7.4's SECOND
// KILL). "approved" must not be a value the model can emit; z.strictObject
// rejects any extra key the model tries to smuggle in.
export const TriageDecisionSchema = z.strictObject({
  verdict: z.enum(['card', 'no_card']),
  reason: z.string(),
  citableEvidenceIds: z.array(z.string()),
  citableBrandIds: z.array(z.string()),
  audienceNote: z.string(),
})
export type TriageDecision = z.infer<typeof TriageDecisionSchema>

export type TriageLoopFailureReason =
  | 'quota_exceeded'
  | 'rate_limited'
  | 'wall_clock_exceeded'
  | 'input_token_cap_exceeded'
  | 'output_token_per_turn_exceeded'
  | 'output_token_cap_exceeded'
  | 'retry_budget_exhausted'
  | 'max_turns_exceeded'
  | 'response_truncated'
  | 'invalid_response'
  | 'provider_error'

export type TriageLoopResult =
  | { outcome: 'decision'; decision: TriageDecision }
  // §2.5 — on ANY bound breach the loop FAILS CLOSED: it produces no card.
  // The loop itself never writes to insight_cards or signal_candidates; the
  // caller (Stage C orchestration, E5.5+) is responsible for moving the
  // candidate to 'triage_failed' and incrementing the tick counter.
  | { outcome: 'failed'; reason: TriageLoopFailureReason }

// A tool the loop can dispatch. `lib/signals/triage/` supplies the closed
// four-tool inventory (E5.5) — this module has no opinion on what a tool
// does, only on how many times and how long it may run.
export interface TriageTool {
  name: string
  description: string
  inputSchema: Anthropic.Tool.InputSchema
  execute: (input: unknown) => Promise<unknown>
}

export interface RunToolLoopInput {
  context: CustomerContext
  systemPrompt: string
  userMessage: string
  tools: TriageTool[]
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// security-reviewer (MEDIUM-1): enforces TRIAGE_REQUEST_TIMEOUT_MS at the
// individual request level, independent of the between-turns wall-clock
// check. A timeout rejection carries no `status`, so isRetryableStatus is
// false — it is NOT retried (retrying a slow provider spends more wall-clock
// on the same pathology) and propagates straight to 'provider_error'.
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request exceeded ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// §2.7 — the shared retry pool. Each retryable failure consumes one unit of
// `retryState.remaining`; once exhausted, the failure propagates rather than
// retrying again, and the caller maps that into 'retry_budget_exhausted'.
async function callWithRetryBudget(
  client: AiClientLike,
  params: Anthropic.MessageCreateParamsNonStreaming,
  retryState: { remaining: number },
): Promise<Anthropic.Message> {
  try {
    return await withTimeout(client.messages.create(params), TRIAGE_REQUEST_TIMEOUT_MS)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (isRetryableStatus(status) && retryState.remaining > 0) {
      retryState.remaining -= 1
      await sleep(RETRY_DELAY_MS)
      return callWithRetryBudget(client, params, retryState)
    }
    throw err
  }
}

export async function runToolLoop(input: RunToolLoopInput): Promise<TriageLoopResult> {
  const { context, systemPrompt, userMessage, tools } = input

  // ── Pre-flight, shared with runPrompt ──────────────────────────────────
  // STEP 1: Trial cap (runner.ts:79-86). Triage is not brand-voice
  // inference; it consumes the same posts-remaining ceiling as generation —
  // a business that has exhausted its trial does not get unlimited AI spend
  // through a different feature.
  if (context.trialState !== null && context.trialState.postsRemaining <= 0) {
    return { outcome: 'failed', reason: 'quota_exceeded' }
  }

  // STEP 2: Rate limit (runner.ts:88-99). Tagged with its own promptId
  // ('signal-triage') so the count reflects triage calls only, never
  // conflated with actual post-generation volume.
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const { config } = await import('@/lib/config')
  const serviceClient = createServiceRoleClient()
  const recentCount = await countRecentCalls(serviceClient, context.business.id, 60, TRIAGE_PROMPT_ID)
  if (recentCount >= config.server.AI_RATE_LIMIT_POST_GENERATION_PER_MIN) {
    return { outcome: 'failed', reason: 'rate_limited' }
  }

  // STEP 3: cache_control policy (runner.ts:25, :101-110).
  const isLarge = systemPrompt.length > CACHE_CONTROL_CHAR_THRESHOLD
  const systemContent: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: systemPrompt,
      ...(isLarge ? { cache_control: { type: 'ephemeral' } } : {}),
    },
  ]

  const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: userMessage }] },
  ]

  const aiClient = await getAnthropicClient()
  const startTime = Date.now()
  const retryState = { remaining: TRIAGE_RETRY_BUDGET }

  let cumulativeInputTokens = 0
  let cumulativeOutputTokens = 0
  let toolCallsUsed = 0
  let turnsUsed = 0

  // Track usage outcome in plain primitives (runner.ts's own pattern —
  // avoids TS CFA narrowing to never when try/finally joins exception and
  // normal paths).
  let usageSuccess = false
  let usageErrorCode: string | null = null
  let result: TriageLoopResult | null = null

  try {
    while (turnsUsed < TRIAGE_MAX_TURNS) {
      turnsUsed += 1

      if (Date.now() - startTime > TRIAGE_MAX_WALL_CLOCK_MS) {
        usageErrorCode = 'wall_clock_exceeded'
        result = { outcome: 'failed', reason: 'wall_clock_exceeded' }
        break
      }

      // Tools are withheld once the cap is spent — purely budget-driven,
      // not turn-number-driven. In the real API, once a request omits
      // `tools`, the model cannot return a tool_use block, so this alone is
      // what forces the eventual no-tools decision turn (§2.5); no separate
      // "last turn" special case is needed.
      const offerTools = toolCallsUsed < TRIAGE_MAX_TOOL_CALLS

      const sdkParams: Anthropic.MessageCreateParamsNonStreaming & {
        _sosh?: { promptId: string; input: unknown }
      } = {
        model: MODELS.SONNET_4_6.id,
        max_tokens: TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN,
        system: systemContent,
        messages,
        // security-reviewer (MEDIUM-2): disable_parallel_tool_use forces at
        // most ONE tool_use block per turn. Without it, a model requesting
        // multiple independent lookups in one turn would leave this loop's
        // single-tool_result dispatch (below) echoing an assistant turn with
        // tool_use blocks it never answered — a malformed conversation the
        // next request would 400 on, burning budget on an unaccounted-for
        // failure mode §2.6's cost arithmetic never modeled.
        ...(offerTools
          ? { tools: anthropicTools, tool_choice: { type: 'auto' as const, disable_parallel_tool_use: true } }
          : {}),
        _sosh: { promptId: TRIAGE_PROMPT_ID, input: { turn: turnsUsed } },
      }

      let response: Anthropic.Message
      try {
        response = await callWithRetryBudget(aiClient, sdkParams, retryState)
      } catch (err: unknown) {
        const status = (err as { status?: number }).status
        const reason: TriageLoopFailureReason =
          isRetryableStatus(status) && retryState.remaining <= 0 ? 'retry_budget_exhausted' : 'provider_error'
        usageErrorCode = reason
        result = { outcome: 'failed', reason }
        break
      }

      cumulativeInputTokens +=
        response.usage.input_tokens +
        ((response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0)
      cumulativeOutputTokens += response.usage.output_tokens

      if (cumulativeInputTokens > TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS) {
        usageErrorCode = 'input_token_cap_exceeded'
        result = { outcome: 'failed', reason: 'input_token_cap_exceeded' }
        break
      }
      if (response.usage.output_tokens > TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN) {
        usageErrorCode = 'output_token_per_turn_exceeded'
        result = { outcome: 'failed', reason: 'output_token_per_turn_exceeded' }
        break
      }
      if (cumulativeOutputTokens > TRIAGE_MAX_CUMULATIVE_OUTPUT_TOKENS) {
        usageErrorCode = 'output_token_cap_exceeded'
        result = { outcome: 'failed', reason: 'output_token_cap_exceeded' }
        break
      }
      if (response.stop_reason === 'max_tokens') {
        usageErrorCode = 'response_truncated'
        result = { outcome: 'failed', reason: 'response_truncated' }
        break
      }

      const toolUseBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

      if (toolUseBlock) {
        // The assistant turn (which may include a tool_use block) must be
        // echoed back before its tool_result, or the API rejects the
        // conversation shape. ContentBlock -> ContentBlockParam: the
        // response's blocks are structurally a subset of what a request
        // accepts back (text/tool_use), so this is a safe boundary cast,
        // not a blanket `any`.
        messages.push({ role: 'assistant', content: response.content as unknown as Anthropic.ContentBlockParam[] })

        const tool = tools.find((t) => t.name === toolUseBlock.name)
        if (!tool) {
          // Malformed/unknown tool block (name not in the closed inventory,
          // or — defensively — a tool_use arriving on a turn that withheld
          // tools) — absorbed by a spare turn rather than an immediate
          // fail-closed: does NOT consume toolCallsUsed (no real tool
          // executed), but DOES consume a turn, so TRIAGE_MAX_TURNS still
          // bounds the total abuse surface.
          messages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: 'Unknown tool', is_error: true }],
          })
          continue
        }

        try {
          const toolResult = await tool.execute(toolUseBlock.input)
          toolCallsUsed += 1
          messages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(toolResult) }],
          })
        } catch (toolErr: unknown) {
          // security-reviewer (LOW-2): the raw error (DB/Supabase internals
          // once E5.5's tools exist) is logged server-side only. The model
          // sees a generic, constant message — never message text a tool
          // implementation happened to throw.
          console.error('tool-runner: tool execution failed', tool.name, toolErr)
          toolCallsUsed += 1
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: TOOL_EXECUTION_ERROR_MESSAGE,
                is_error: true,
              },
            ],
          })
        }
        continue
      }

      // No tool_use block — a decision attempt. A single malformed decision
      // is a hard parse failure, exactly like runPrompt's own posture: the
      // loop does not keep nudging the model for a better answer.
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      const rawText = textBlock?.text ?? ''
      try {
        const decision = safeParseOrAiError(TriageDecisionSchema, rawText)
        usageSuccess = true
        result = { outcome: 'decision', decision }
      } catch {
        usageErrorCode = 'invalid_response'
        result = { outcome: 'failed', reason: 'invalid_response' }
      }
      break
    }

    if (result === null) {
      // TRIAGE_MAX_TURNS was reached with every turn spent on tool_use
      // blocks (real or malformed) and no turn ever attempting a decision —
      // distinct from 'invalid_response', which means a decision WAS
      // attempted and failed to parse.
      usageErrorCode = 'max_turns_exceeded'
      result = { outcome: 'failed', reason: 'max_turns_exceeded' }
    }
    return result
  } finally {
    // The finally-block ai_usage write (runner.ts:218-239) — ONE record for
    // the whole loop, cumulative across every turn including retries.
    const latencyMs = Date.now() - startTime
    const costCents = calculateCostCents('SONNET_4_6', cumulativeInputTokens, cumulativeOutputTokens, 0)
    try {
      await recordAiUsage({
        business_id: context.business.id,
        prompt_id: TRIAGE_PROMPT_ID,
        prompt_version: TRIAGE_PROMPT_VERSION,
        model: MODELS.SONNET_4_6.id,
        input_tokens: cumulativeInputTokens,
        output_tokens: cumulativeOutputTokens,
        cost_cents: costCents,
        latency_ms: latencyMs,
        success: usageSuccess,
        error_code: usageErrorCode,
      })
    } catch (usageErr: unknown) {
      console.error('tool-runner: failed to record ai_usage', usageErr)
    }
  }
}
