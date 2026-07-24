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
// 'native-generation-single'/'native-generation-thread' match neither
// isBrandVoice('brand-voice-inference') nor isPostGeneration('post-generation')
// in runner.ts, so each call here increments the trial's posts_generated
// counter individually (runner.ts step 8) — once B2.6's orchestrator ALSO
// does its own batch increment (R-1 pattern), that will double-count.
// Flagged for B2.6 to resolve; not addressed here (out of B2.4 scope).
export async function generateNativeContent(
  client: SupabaseClient,
  ctx: CustomerContext,
  input: GenerateNativeContentInput,
): Promise<SinglePostOutput | ThreadOutput> {
  const family = selectFormatFamily(input.platform, input.estimatedTweetsWorth)
  const renderedEvidence = await wrapEvidenceForPrompt(client, input.businessId, input.pinnedEvidenceIds)

  const genInput: NativeGenInput = {
    angle: input.angle,
    role: input.role,
    platform: input.platform,
    narrative: input.narrative,
    renderedEvidence,
    scheduledAt: input.scheduledAt,
  }

  return family === 'single' ? generateSingle(ctx, genInput) : generateThread(ctx, genInput)
}
