import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { MODELS, calculateCostCents, type ModelKey } from './models'
import { safeParseOrAiError } from './parsers'
import { getAnthropicClient, type AiClientLike } from './client'
import type { CustomerContext } from './context'
import { countRecentCalls, recordAiUsage } from '@/lib/db/ai-usage'
import { assertGuardedToolResult, type GuardedJson } from './wrap-evidence'

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
//
// Session 28-D, D8 (MINOR-4) — "= 2" is derived from WALL-CLOCK and ATTEMPT
// COUNT, not token accounting (ADR §2.4/§2.7 previously justified it via a
// token-cap "feature" the code above already disclaims — amended to match).
// Post-D6 (MAJOR-7), callWithRetryBudget clamps every attempt's timeout to
// the remaining loop budget and refuses a retry that cannot fit
// RETRY_DELAY_MS, so 1 initial attempt + 2 retries is exactly the shape
// TRIAGE_MAX_WALL_CLOCK_MS was chosen to bound (§2.4's own worst-case
// arithmetic) — raising this value would not buy more resilience, only a
// larger share of the 45s ceiling spent retrying instead of attempting.
export const TRIAGE_RETRY_BUDGET = 2

// ADR 0027 §3.1 (Session 34 K2.2) — the seven bounds as ONE object, so a second consumer (the campaign
// planner, lib/campaigns/planner/constants.ts) passes its own numbers instead of inheriting triage's.
// TRIAGE_LOOP_BOUNDS is the NAMED DEFAULT: Stage C passes nothing and behaves byte-identically. The seven
// TRIAGE_* constants above keep their names — renaming them is explicitly forbidden this session
// ([sec-MAJOR-3]); the planner's are new AI_PLANNER_* siblings.
export interface ToolLoopBounds {
  maxToolCalls: number
  maxTurns: number
  maxCumulativeInputTokens: number
  maxOutputTokensPerTurn: number
  maxCumulativeOutputTokens: number
  maxWallClockMs: number
  retryBudget: number
}

export const TRIAGE_LOOP_BOUNDS: ToolLoopBounds = {
  maxToolCalls: TRIAGE_MAX_TOOL_CALLS,
  maxTurns: TRIAGE_MAX_TURNS,
  maxCumulativeInputTokens: TRIAGE_MAX_CUMULATIVE_INPUT_TOKENS,
  maxOutputTokensPerTurn: TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN,
  maxCumulativeOutputTokens: TRIAGE_MAX_CUMULATIVE_OUTPUT_TOKENS,
  maxWallClockMs: TRIAGE_MAX_WALL_CLOCK_MS,
  retryBudget: TRIAGE_RETRY_BUDGET,
}

const RETRY_DELAY_MS = 2000
const CACHE_CONTROL_CHAR_THRESHOLD = 4096 // chars / 4 ≈ tokens; matches runner.ts:25
// The triage defaults for promptId / promptVersion (ADR 0027 §3.1 hardcodes #2-#3). The rate-limit read keys on
// the prompt id, so a shared id would both dilute triage's minute window and let a planner loop mask triage
// volume — every other consumer passes its OWN id (AGENCY-PLANNER-PROMPT-ID-DISTINCT).
export const TRIAGE_PROMPT_ID = 'signal-triage'
export const TRIAGE_PROMPT_VERSION = 1
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

// ADR 0027 §3.3 (AGENCY-FAILURE-REASONS-RUNTIME) — a RUNTIME array with the type derived from it. The union used
// to be type-only and so erased at runtime: an exhaustive mapping test was impossible to write, and a twelfth
// reason added later would fall through whatever default arm a consumer has — under the planner's fail-soft
// design, straight into "the planner proposed nothing". A consumer's mapping is now
// `satisfies Record<ToolLoopFailureReason, ...>`, so a member added without a mapping fails to COMPILE.
// ELEVEN non-decision outcomes, not nine.
export const TOOL_LOOP_FAILURE_REASONS = [
  'quota_exceeded',
  'rate_limited',
  'wall_clock_exceeded',
  'input_token_cap_exceeded',
  'output_token_per_turn_exceeded',
  'output_token_cap_exceeded',
  'retry_budget_exhausted',
  'max_turns_exceeded',
  'response_truncated',
  'invalid_response',
  'provider_error',
] as const

export type ToolLoopFailureReason = (typeof TOOL_LOOP_FAILURE_REASONS)[number]
// Kept under its original name: Stage C's orchestrator and tests import it.
export type TriageLoopFailureReason = ToolLoopFailureReason

// Generic over the decision type; `TriageLoopResult` below is the triage instantiation Stage C already uses.
export type ToolLoopResult<D> =
  | { outcome: 'decision'; decision: D; costCents: number }
  // §2.5 — on ANY bound breach the loop FAILS CLOSED: it produces no card.
  // The loop itself never writes to insight_cards or signal_candidates; the
  // caller (Stage C orchestration, E5.6+) is responsible for moving the
  // candidate to 'triage_failed' and incrementing the tick counter.
  //
  // costCents (Session 28 E5.6) — every outcome carries the loop's actual
  // cumulative cost, mirroring the exact figure the finally-block ai_usage
  // write records. §3.3's reservation is a worst-case placeholder (22¢);
  // the orchestrator reconciles it against THIS number after the call, on
  // every outcome including failure (a failed loop still burns tokens).
  | { outcome: 'failed'; reason: ToolLoopFailureReason; costCents: number }

export type TriageLoopResult = ToolLoopResult<TriageDecision>

// A tool the loop can dispatch. `lib/signals/triage/` supplies the closed
// four-tool inventory (E5.5) — this module has no opinion on what a tool
// does, only on how many times and how long it may run.
export interface TriageTool {
  name: string
  description: string
  inputSchema: Anthropic.Tool.InputSchema
  // ADR 0027 §6.2 (Session 34 K2.3) — was `Promise<unknown>`, under which NO field of any tool result was ever
  // type-checked (how a new field reaches the prompt unwrapped). GuardedJson's only string members are a
  // guarded render or an id, so adding a raw `html_url: string` to a tool result now fails tsc. The runtime
  // twin is assertGuardedToolResult at the dispatch below.
  execute: (input: unknown) => Promise<GuardedJson>
}

// ADR 0027 §3.1 hardcode #6 — the output schema. This parameter is a SECURITY CONTROL, not a refactor
// ([sec-MAJOR-3]): ADR 0021 §7.4 names the ABSENCE of a `status` field in TriageDecisionSchema as the control
// that stops "approved" being a value the model can emit, and whatever schema is passed in INHERITS that duty.
//
// It cannot be enforced by the TYPE alone: in zod 4.3.6 `$strict` and `$strip` are structurally identical
// (`{ out: {}; in: {} }`), so `z.object` type-checks where `z.strictObject` is meant. The enforcement is
// therefore RUNTIME, at loop entry (assertDecisionSchemaIsStrict), backed by the Tier-3 scan
// (AGENCY-LOOP-SCHEMA-STRICT) over every schema passed to the loop.
export type DecisionSchema = z.ZodObject

// A field that reads as the application or verification of anything. Never a value the model may emit.
export const FORBIDDEN_DECISION_FIELDS = ['applied', 'status', 'approved', 'verified'] as const

export function assertDecisionSchemaIsStrict(schema: DecisionSchema): void {
  const catchall = (schema._zod.def as { catchall?: { _zod: { def: { type: string } } } }).catchall
  if (catchall?._zod.def.type !== 'never') {
    throw new Error('runToolLoop: outputSchema must be a z.strictObject — a stripping or loose object lets a smuggled key through')
  }
  const forbidden = Object.keys(schema.shape).filter((k) => (FORBIDDEN_DECISION_FIELDS as readonly string[]).includes(k))
  if (forbidden.length > 0) {
    throw new Error(`runToolLoop: outputSchema must not carry a verdict-shaped field (${forbidden.join(', ')})`)
  }
}

export interface RunToolLoopInput<S extends DecisionSchema = typeof TriageDecisionSchema> {
  context: CustomerContext
  systemPrompt: string
  userMessage: string
  tools: TriageTool[]
  // Every field below defaults to TRIAGE's value, so Stage C passes none of them (ADR 0027 §3.1).
  bounds?: ToolLoopBounds
  promptId?: string
  promptVersion?: number
  // The model actually used — for BOTH the request and calculateCostCents (hardcode #4).
  model?: ModelKey
  // Hardcode #5. A planner run is NOT a post: charging it against postsRemaining would silently burn a trial
  // post per plan (AGENCY-PLANNER-TRIAL-EXEMPT). Default true = triage's existing behaviour.
  enforceTrialQuota?: boolean
  outputSchema?: S
  // Session 34-D D8 (MAJOR-4). OPTIONAL: when present (a uuid), the loop's ONE ai_usage row is inserted under THIS
  // id, so a caller that minted it before the loop can persist the same value elsewhere (the planner's
  // planner_run_id) and join back to the spend. When absent the insert is byte-for-byte what it always was — Stage C
  // triage passes nothing. No FK: the join is by value (ADR 0027 §4 decision table names the FK as the loser).
  usageId?: string
}

// Session 34-D D8 (NIT-4). A tool result that fails the dispatcher's envelope assertion (a string that is neither
// UUID-shaped nor [DATA]-enveloped) is a SECURITY-relevant event, not an ordinary tool error: it means a tool
// tried to hand the model unguarded text. It still fails closed exactly as before (the model receives only
// TOOL_EXECUTION_ERROR_MESSAGE and the call is counted); this class only makes it NAMEABLE so it can be captured
// as such. The message is the assertion's own (a JSON path, never content).
export class ToolResultEnvelopeViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolResultEnvelopeViolation'
  }
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

// Session 28-D, D6 (MAJOR-7 closed) — the per-request timeout was applied
// PER ATTEMPT with no awareness of the loop's own wall-clock ceiling: a turn
// entered at 44.9s could still run 30s + 2s + 30s + 2s + 30s = 94s before
// this function gave up, and orchestrator.ts's single TRIAGE_MAX_WALL_CLOCK_MS
// reservation assumed that could never happen. This marker distinguishes
// "the loop's deadline was reached mid-retry" from a genuine provider error
// or retry-budget exhaustion, so the caller can map it to the SAME
// 'wall_clock_exceeded' reason the top-of-turn check already uses — one
// failure mode, one name, regardless of where in the turn it is detected.
class LoopDeadlineExceededError extends Error {}

// §2.7 — the shared retry pool. Each retryable failure consumes one unit of
// `retryState.remaining`; once exhausted, the failure propagates rather than
// retrying again, and the caller maps that into 'retry_budget_exhausted'.
//
// `deadlineAt` (D6, MAJOR-7) — the loop's own wall-clock ceiling
// (startTime + TRIAGE_MAX_WALL_CLOCK_MS), threaded down so this function can
// enforce it directly rather than trusting TRIAGE_REQUEST_TIMEOUT_MS alone:
//   1. Each attempt's own timeout is clamped to min(TRIAGE_REQUEST_TIMEOUT_MS,
//      remaining loop budget) — a single request can never itself run past
//      the deadline, regardless of how long the provider takes to answer.
//   2. A retry is refused (no sleep, no further attempt) when the remaining
//      budget can no longer fit RETRY_DELAY_MS — retrying anyway would
//      guarantee blowing the deadline for a sleep that could never resolve
//      in time to matter.
// Together, TRIAGE_MAX_WALL_CLOCK_MS becomes a genuine ceiling on THIS
// function's own elapsed time, not merely a value checked between turns.
async function callWithRetryBudget(
  client: AiClientLike,
  params: Anthropic.MessageCreateParamsNonStreaming,
  retryState: { remaining: number },
  deadlineAt: number,
): Promise<Anthropic.Message> {
  const remainingBudgetMs = deadlineAt - Date.now()
  if (remainingBudgetMs <= 0) {
    throw new LoopDeadlineExceededError('Loop wall-clock budget exhausted before this attempt could run')
  }
  const attemptTimeoutMs = Math.min(TRIAGE_REQUEST_TIMEOUT_MS, remainingBudgetMs)

  try {
    return await withTimeout(client.messages.create(params), attemptTimeoutMs)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (isRetryableStatus(status) && retryState.remaining > 0) {
      const remainingAfterAttemptMs = deadlineAt - Date.now()
      if (remainingAfterAttemptMs <= RETRY_DELAY_MS) {
        throw new LoopDeadlineExceededError('Loop wall-clock budget cannot fit another retry attempt')
      }
      retryState.remaining -= 1
      await sleep(RETRY_DELAY_MS)
      return callWithRetryBudget(client, params, retryState, deadlineAt)
    }
    throw err
  }
}

export async function runToolLoop<S extends DecisionSchema = typeof TriageDecisionSchema>(
  input: RunToolLoopInput<S>,
): Promise<ToolLoopResult<z.infer<S>>> {
  const { context, systemPrompt, userMessage, tools } = input
  const bounds = input.bounds ?? TRIAGE_LOOP_BOUNDS
  const promptId = input.promptId ?? TRIAGE_PROMPT_ID
  const promptVersion = input.promptVersion ?? TRIAGE_PROMPT_VERSION
  const modelKey: ModelKey = input.model ?? 'SONNET_4_6'
  const enforceTrialQuota = input.enforceTrialQuota ?? true
  const outputSchema = (input.outputSchema ?? TriageDecisionSchema) as S
  // A programmer error, not a runtime failure outcome: it throws BEFORE any pre-flight or model call.
  assertDecisionSchemaIsStrict(outputSchema)

  // ── Pre-flight, shared with runPrompt ──────────────────────────────────
  // STEP 1: Trial cap (runner.ts:79-86). Triage is not brand-voice
  // inference; it consumes the same posts-remaining ceiling as generation —
  // a business that has exhausted its trial does not get unlimited AI spend
  // through a different feature.
  if (enforceTrialQuota && context.trialState !== null && context.trialState.postsRemaining <= 0) {
    return { outcome: 'failed', reason: 'quota_exceeded', costCents: 0 }
  }

  // STEP 2: Rate limit (runner.ts:88-99). Tagged with its own promptId
  // ('signal-triage') so the count reflects triage calls only, never
  // conflated with actual post-generation volume.
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const { config } = await import('@/lib/config')
  const serviceClient = createServiceRoleClient()
  const recentCount = await countRecentCalls(serviceClient, context.business.id, 60, promptId)
  if (recentCount >= config.server.AI_RATE_LIMIT_POST_GENERATION_PER_MIN) {
    return { outcome: 'failed', reason: 'rate_limited', costCents: 0 }
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
  const retryState = { remaining: bounds.retryBudget }
  // D6 (MAJOR-7) — the same ceiling the top-of-turn check compares against,
  // now also enforced INSIDE callWithRetryBudget so a single turn's retries
  // can never carry the loop past it.
  const deadlineAt = startTime + bounds.maxWallClockMs

  let cumulativeInputTokens = 0
  let cumulativeOutputTokens = 0
  let toolCallsUsed = 0
  let turnsUsed = 0

  // Track usage outcome in plain primitives (runner.ts's own pattern —
  // avoids TS CFA narrowing to never when try/finally joins exception and
  // normal paths).
  let usageSuccess = false
  let usageErrorCode: string | null = null
  // costCents is attached once, after the finally block computes it — every
  // branch below builds the outcome WITHOUT it, never a partially wrong
  // number. (Omit<TriageLoopResult, 'costCents'> does not distribute over
  // the union the way a hand-written one does — Omit forces both arms down
  // to their shared keys only.)
  let result: { outcome: 'decision'; decision: z.infer<S> } | { outcome: 'failed'; reason: ToolLoopFailureReason } | null =
    null
  let costCents = 0

  try {
    while (turnsUsed < bounds.maxTurns) {
      turnsUsed += 1

      if (Date.now() - startTime > bounds.maxWallClockMs) {
        usageErrorCode = 'wall_clock_exceeded'
        result = { outcome: 'failed', reason: 'wall_clock_exceeded' }
        break
      }

      // Tools are withheld once the cap is spent — purely budget-driven,
      // not turn-number-driven. In the real API, once a request omits
      // `tools`, the model cannot return a tool_use block, so this alone is
      // what forces the eventual no-tools decision turn (§2.5); no separate
      // "last turn" special case is needed.
      const offerTools = toolCallsUsed < bounds.maxToolCalls

      const sdkParams: Anthropic.MessageCreateParamsNonStreaming & {
        _sosh?: { promptId: string; input: unknown }
      } = {
        model: MODELS[modelKey].id,
        max_tokens: bounds.maxOutputTokensPerTurn,
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
        _sosh: { promptId, input: { turn: turnsUsed } },
      }

      let response: Anthropic.Message
      try {
        response = await callWithRetryBudget(aiClient, sdkParams, retryState, deadlineAt)
      } catch (err: unknown) {
        // D6 (MAJOR-7) — the deadline can now be exhausted INSIDE
        // callWithRetryBudget (clamped-timeout cutoff or a refused retry);
        // it maps to the SAME reason as the top-of-turn check, not to
        // 'provider_error' or 'retry_budget_exhausted'.
        if (err instanceof LoopDeadlineExceededError) {
          usageErrorCode = 'wall_clock_exceeded'
          result = { outcome: 'failed', reason: 'wall_clock_exceeded' }
          break
        }
        const status = (err as { status?: number }).status
        const reason: ToolLoopFailureReason =
          isRetryableStatus(status) && retryState.remaining <= 0 ? 'retry_budget_exhausted' : 'provider_error'
        usageErrorCode = reason
        result = { outcome: 'failed', reason }
        break
      }

      cumulativeInputTokens +=
        response.usage.input_tokens +
        ((response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0)
      cumulativeOutputTokens += response.usage.output_tokens

      if (cumulativeInputTokens > bounds.maxCumulativeInputTokens) {
        usageErrorCode = 'input_token_cap_exceeded'
        result = { outcome: 'failed', reason: 'input_token_cap_exceeded' }
        break
      }
      // NIT-2 (D6, recorded) — this comparison is STRUCTURALLY UNREACHABLE
      // in production: `max_tokens` above is set to this same
      // TRIAGE_MAX_OUTPUT_TOKENS_PER_TURN value, so the API contractually
      // cannot return more output tokens than that. Kept as defence-in-depth
      // against a future provider contract change (e.g. `max_tokens` ever
      // becoming advisory rather than a hard ceiling), not as a bound this
      // code path can fire on today — the real production signal for a
      // truncated turn is `stop_reason === 'max_tokens'`, below. ADR 0021
      // §11's fixture for this row is therefore synthetic: it manufactures a
      // response whose `usage.output_tokens` exceeds the cap directly,
      // something the real API contract does not allow.
      if (response.usage.output_tokens > bounds.maxOutputTokensPerTurn) {
        usageErrorCode = 'output_token_per_turn_exceeded'
        result = { outcome: 'failed', reason: 'output_token_per_turn_exceeded' }
        break
      }
      if (cumulativeOutputTokens > bounds.maxCumulativeOutputTokens) {
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
          // ADR 0027 §6.3 (K2.3) — the runtime envelope assertion lives HERE, the one point every tool's
          // output passes through: every string is UUID-shaped or [DATA]-enveloped, or it throws into the
          // catch below and the model sees only TOOL_EXECUTION_ERROR_MESSAGE. A new tool can forget the
          // tool boundary; it cannot forget the dispatcher.
          //
          // The assertion runs over the SERIALISED FORM, and that same string is what the model receives
          // (typescript-reviewer, K2.3 finding 4): asserting on the live object and then stringifying it
          // lets a non-enumerable toJSON, a getter or a Proxy make the two diverge. Parsing our own
          // JSON.stringify output removes that whole class — what was asserted IS what is sent. A result
          // that does not serialise (undefined, a cycle, a bigint) throws here and fails closed.
          const serialised = JSON.stringify(toolResult)
          try {
            assertGuardedToolResult(JSON.parse(serialised))
          } catch (envelopeErr: unknown) {
            // NIT-4 (D8): named, so the catch below can tell it from an ordinary tool error. Still throws into
            // that catch — the fail-closed path (model sees the constant message, the call is counted) is unchanged.
            throw new ToolResultEnvelopeViolation(envelopeErr instanceof Error ? envelopeErr.message : 'envelope violation')
          }
          toolCallsUsed += 1
          messages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: serialised }],
          })
        } catch (toolErr: unknown) {
          // security-reviewer (LOW-2): the raw error (DB/Supabase internals
          // once E5.5's tools exist) is logged server-side only. The model
          // sees a generic, constant message — never message text a tool
          // implementation happened to throw.
          console.error('tool-runner: tool execution failed', tool.name, toolErr)
          // NIT-4 (D8): an envelope violation is an operator signal, captured under its own name. No new console
          // line (the one above already covers it). Tags: the consumer's prompt id and the phase — ids and a closed
          // label only; the error message is the assertion's JSON path, never tool output.
          if (toolErr instanceof ToolResultEnvelopeViolation) {
            Sentry.captureException(toolErr, { tags: { prompt_id: promptId, phase: 'tool-result-envelope' } })
          }
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
        const decision = safeParseOrAiError(outputSchema, rawText) as z.infer<S>
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
  } finally {
    // The finally-block ai_usage write (runner.ts:218-239) — ONE record for
    // the whole loop, cumulative across every turn including retries.
    const latencyMs = Date.now() - startTime
    costCents = calculateCostCents(modelKey, cumulativeInputTokens, cumulativeOutputTokens, 0)
    try {
      await recordAiUsage({
        // D8 (MAJOR-4): only when the caller minted one — absent, this object has NO `id` key (triage's shape).
        ...(input.usageId !== undefined ? { id: input.usageId } : {}),
        business_id: context.business.id,
        prompt_id: promptId,
        prompt_version: promptVersion,
        model: MODELS[modelKey].id,
        input_tokens: cumulativeInputTokens,
        output_tokens: cumulativeOutputTokens,
        cost_cents: costCents,
        latency_ms: latencyMs,
        success: usageSuccess,
        error_code: usageErrorCode,
      })
    } catch (usageErr: unknown) {
      console.error('tool-runner: failed to record ai_usage', usageErr)
      // D8 (MAJOR-4): if the caller minted the row's id, a failed write leaves that id DANGLING (the planner has
      // already committed to it as planner_run_id). Make it visible — tagged with the id and phase, and only when
      // an id was supplied, so Stage C triage's path is exactly what it was. A fixed message: never the DB's.
      if (input.usageId !== undefined) {
        Sentry.captureException(new Error('planner ai_usage record failed; the run id has no usage row'), {
          tags: { business_id: context.business.id, run_id: input.usageId, phase: 'planner-usage-record' },
        })
      }
    }
  }

  // result is always set by this point — either inside the try block (a
  // decision, a bound breach, or the max_turns_exceeded fallback) — the
  // function never falls through the try/finally without assigning it.
  return { ...result!, costCents } as ToolLoopResult<z.infer<S>>
}
