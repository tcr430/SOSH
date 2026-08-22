import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerContext } from './context'
import type { CampaignPostRole, Platform } from '@/lib/db/types'
import { AiError } from './errors'
import { runPrompt } from './runner'
import { wrapEvidenceForPrompt } from './wrap-evidence'
import { selectFormatFamily } from './prompts/formats/platform-map'
import { createNativeGenerationPrompt, type NativeGenInput } from './prompts/formats/native-generation-prompt'
import { validateThreadPolicy } from './prompts/formats/policy'
import type { SinglePostOutput, ThreadOutput } from './prompts/formats/schemas'
import { assertNever } from '@/lib/utils'

export interface GenerateNativeContentInput {
  businessId: string
  angle: string
  role: CampaignPostRole
  platform: Platform
  narrative: string
  pinnedEvidenceIds: string[]
  scheduledAt: string
  estimatedTweetsWorth: number
}

// A caught failure is retriable ONLY for these two codes — anything else
// (quota_exceeded, rate_limited, provider_error, rate_limit, timeout, or a
// non-AiError) is NOT a "the model got the shape wrong" failure and must
// propagate immediately, uncorrected. Retrying a rate-limit or quota error
// would just waste the one re-prompt budget on a call guaranteed to fail the
// same way.
function isRetriable(err: unknown): err is AiError {
  return err instanceof AiError && (err.code === 'invalid_response' || err.code === 'policy_violation')
}

function buildCorrectionNote(err: AiError): string {
  if (err.code === 'policy_violation') return err.message
  return 'Your previous response was not valid JSON matching the required structure exactly. Return ONLY the JSON object, no markdown fences, no extra text.'
}

// Two concrete branch functions, not one generic<T> helper: TypeScript does
// not narrow a generic type parameter from a discriminant check on one of
// its instances (checking `result.format === 'thread'` cannot narrow a
// generic T to ThreadOutput the way it narrows a concrete union). Keeping
// single/thread concrete throughout avoids fighting that limitation with a
// cast, at the cost of a few duplicated lines.

async function generateSingle(ctx: CustomerContext, genInput: NativeGenInput): Promise<SinglePostOutput> {
  const prompt = createNativeGenerationPrompt('single')
  try {
    return await runPrompt(prompt, ctx, genInput)
  } catch (firstErr: unknown) {
    if (!isRetriable(firstErr)) throw firstErr
    // Second and FINAL attempt — not wrapped in its own try/catch, so any
    // error here (including a second invalid_response) propagates to the
    // caller unchanged. There is no third call site.
    return await runPrompt(prompt, ctx, { ...genInput, correctionNote: buildCorrectionNote(firstErr) })
  }
}

async function generateThread(ctx: CustomerContext, genInput: NativeGenInput): Promise<ThreadOutput> {
  const prompt = createNativeGenerationPrompt('thread')
  try {
    const result = await runPrompt(prompt, ctx, genInput)
    validateThreadPolicy(result) // throws AiError('policy_violation') into this same try block
    return result
  } catch (firstErr: unknown) {
    if (!isRetriable(firstErr)) throw firstErr
    const result = await runPrompt(prompt, ctx, { ...genInput, correctionNote: buildCorrectionNote(firstErr) })
    validateThreadPolicy(result) // a second policy failure propagates uncaught — ceiling reached
    return result
  }
}

// ADR 0017 §4.4 — the WRAPPER, not the runner. Does the Tier-0 platform→
// family lookup, selects the factory-built Prompt, calls the UNCHANGED
// runPrompt. runner.ts is not edited: no third prompt.id branch, no
// re-prompt loop in the generic runner shared by brand-voice and
// regeneration — format-family concerns stay entirely in this file.
//
// Bounded re-prompt: ceiling = 1 re-prompt, 2 attempts total — two
// SEQUENTIAL, EXPLICIT calls to runPrompt per branch above (not a loop with
// a counter). A second failure after the corrective re-prompt propagates the
// ORIGINAL error type unchanged.
//
// Runner-routing note (same posture as rubric.ts, B2.2): prompt.id
// 'native-generation-single'/'native-generation-thread' now DO match
// isPostGeneration('post-generation') in runner.ts — B2.6 added both ids to
// NATIVE_GENERATION_PROMPT_IDS there (runner.ts:13-22), so the runner skips
// its own per-call step-8 increment for these calls and only the
// orchestrator's single batch increment (generate.ts STEP 11,
// incrementPostsGeneratedBy) counts each generated post. Session 24-D
// (MINOR-3 doc-rot correction) — this comment previously said the double-
// count "will" happen and was "Flagged for B2.6 to resolve; not addressed
// here"; B2.6 landed and fixed it in runner.ts, this file needed no change.
export async function generateNativeContent(
  client: SupabaseClient,
  ctx: CustomerContext,
  input: GenerateNativeContentInput,
): Promise<SinglePostOutput | ThreadOutput> {
  // ADR 0022 §6.3/A-4 (Session 29, F1b.7) — `false`: Mode 2's automatic
  // per-slot pipeline has no carousel consumer yet (lib/campaigns/generate.ts
  // §6.5's extractOpener/joinContent are explicitly OUT OF SCOPE for this
  // step — they narrow on SinglePostOutput | ThreadOutput only, and adding
  // CarouselOutput to THIS function's return type would break them, which
  // is exactly the "already safe" compile error §6.5 says to leave alone).
  // Every call that exists today resolves byte-identically (L-10, A-4).
  const family = selectFormatFamily(input.platform, input.estimatedTweetsWorth, false)
  const renderedEvidence = await wrapEvidenceForPrompt(client, input.businessId, input.pinnedEvidenceIds)

  const genInput: NativeGenInput = {
    angle: input.angle,
    role: input.role,
    platform: input.platform,
    narrative: input.narrative,
    renderedEvidence,
    scheduledAt: input.scheduledAt,
  }

  // ADR 0022 §6.5 (Session 29, F1b.6) — exhaustive switch, not a ternary:
  // `family` is a bare FormatFamily STRING, not a tagged object, so tsc's
  // discriminated-union narrowing does not apply to a ternary here. Adding
  // a third FormatFamily value without adding its case is now a COMPILE
  // ERROR at the assertNever(family) default arm, not a silent fallthrough
  // into generateThread (the accidental safety net this replaces — it only
  // ever failed because validateThreadPolicy happened to crash on the
  // missing posts[0].role, not by design). F1b.7 lands exactly that arm:
  // structurally UNREACHABLE today (selectFormatFamily only returns
  // 'carousel' when carouselRequested is true, and the call above always
  // passes false), so it throws rather than silently returning a
  // CarouselOutput this function's return type does not admit.
  switch (family) {
    case 'single': return generateSingle(ctx, genInput)
    case 'thread': return generateThread(ctx, genInput)
    case 'carousel':
      throw new Error('generateNativeContent: carousel format is not yet reachable through this pipeline (ADR 0022 §6.5) — selectFormatFamily was called with carouselRequested=true unexpectedly.')
    default: return assertNever(family)
  }
}
