'use server'

import { z } from 'zod'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getStudioDraft, persistSuggestions, acceptSuggestion } from '@/lib/db/studio-drafts'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { AiError, type AiErrorCode } from '@/lib/ai/errors'
import { studioSuggestionPrompt } from '@/lib/ai/prompts/studio-suggestion'
import { retrieveStudioPerformancePatterns, retrieveEvidenceMemory } from '@/lib/memory'
import { wrapEvidenceForPrompt } from '@/lib/ai/wrap-evidence'
import { generateNonce, joinStudioMarkers } from '@/lib/studio/markers'
import { verifyStudioResponse, buildCitableContext, toStudioClientDTO, type StudioSuggestionDTO } from '@/lib/studio/verify'
import type { Platform } from '@/lib/db/types'

// ADR 0019 §4/§9/§10 — the two Studio Server Actions. All Anthropic access
// stays in lib/ai/: this file calls runPrompt, never the SDK. L-13: no
// console.* anywhere in this path — diagnostics go to Sentry, redacted and
// bounded, and AiError.message never reaches the client (parsers.ts:26
// embeds Zod's message, which can include received/attacker-influenced
// values).

async function getAuthContext() {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return null
  const business = await getBusinessForUser(client, user.id)
  if (!business) return null
  return { client, business }
}

export type StudioActionErrorCode =
  | 'invalid_input'
  | 'generic'
  | 'not_eligible'
  | 'missing_platform'
  | 'fabricated_citation'
  | AiErrorCode

export type SuggestStudioSuggestionsState =
  | { success: true; suggestions: readonly StudioSuggestionDTO[]; contentHash: string; suggestionsForHash: string }
  | { success: false; error: StudioActionErrorCode }

const suggestSchema = z.object({ draftId: z.string().uuid() })

export async function suggestStudioSuggestions(draftId: string): Promise<SuggestStudioSuggestionsState> {
  const parsedInput = suggestSchema.safeParse({ draftId })
  if (!parsedInput.success) return { success: false, error: 'invalid_input' }

  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'generic' }
  const { client, business } = ctx

  const draft = await getStudioDraft(client, draftId, business.id)
  if (!draft) return { success: false, error: 'not_eligible' }

  // §4.2 — reject a missing platform BEFORE any call: nothing stands in for
  // PLATFORM_CONSTRAINTS, so a family-less draft cannot reach the model.
  if (draft.platform === null) return { success: false, error: 'missing_platform' }
  const platform: Platform = draft.platform

  const aiCtx = await buildCustomerContext(business.id)

  const [governedPatterns, evidenceRows] = await Promise.all([
    retrieveStudioPerformancePatterns(client, business.id, { platform }),
    retrieveEvidenceMemory(client, business.id, { platform }),
  ])
  const evidenceIds = evidenceRows.map((row) => row.id)
  const evidenceRendered = await wrapEvidenceForPrompt(client, business.id, evidenceIds)

  const nonce = generateNonce()

  let output
  try {
    // L-8's Tier-1 ceiling — EXACTLY once. No debounce, no auto re-prompt,
    // no retry-on-parse: the user's retry button IS the retry (§5.4,
    // [sec-MEDIUM-3]).
    output = await runPrompt(studioSuggestionPrompt, aiCtx, {
      draft: draft.content,
      platform,
      nonce,
      governedPatterns,
      evidenceRendered,
    })
  } catch (e) {
    // AiError.code only — NEVER .message (it can embed Zod's received-value
    // text, i.e. attacker-influenced model output).
    if (e instanceof AiError) return { success: false, error: e.code }
    Sentry.captureException(e, { tags: { studio_action: 'suggestStudioSuggestions' } })
    return { success: false, error: 'generic' }
  }

  let joined
  try {
    joined = joinStudioMarkers(output.revision, output.suggestions, draft.content, nonce)
  } catch (e) {
    if (e instanceof AiError) return { success: false, error: e.code }
    Sentry.captureException(e, { tags: { studio_action: 'suggestStudioSuggestions' } })
    return { success: false, error: 'generic' }
  }

  const avoidWords = new Set((aiCtx.brandVoice?.avoid_words ?? []).map((w) => w))
  const citable = buildCitableContext({
    draft: draft.content,
    avoidWords,
    governedPatterns,
    evidence: evidenceRows.map((row) => ({ id: row.id, snippet: row.content })),
  })

  const verification = verifyStudioResponse({ citable, parsed: joined.suggestions.map((s) => s.rationale) })

  if (verification.outcome === 'rejected') {
    Sentry.captureMessage('studio_suggestion_rejected', {
      level: 'warning',
      tags: { fabricated_count: verification.fabricated.length, business_id: business.id },
    })
    // §10.1's implicit save still applies — the draft the model actually
    // saw is persisted even though nothing renders from this call.
    await persistSuggestions(client, draftId, business.id, draft.content, [])
    return { success: false, error: 'fabricated_citation' }
  }

  const dtoSet = verification.set.map((s) => toStudioClientDTO(s))
  const saved = await persistSuggestions(client, draftId, business.id, draft.content, dtoSet)

  return {
    success: true,
    suggestions: dtoSet,
    contentHash: saved.content_hash,
    suggestionsForHash: saved.suggestions_for_hash as string,
  }
}

export type AcceptStudioSuggestionState =
  | { outcome: 'accepted'; content: string }
  | { outcome: 'stale' }
  | { outcome: 'error'; error: StudioActionErrorCode }

const acceptSchema = z.object({
  draftId: z.string().uuid(),
  acceptedContent: z.string().min(1),
  expectedContentHash: z.string().min(1),
  expectedSuggestionsHash: z.string().min(1),
})

export async function acceptStudioSuggestion(
  draftId: string,
  acceptedContent: string,
  expectedContentHash: string,
  expectedSuggestionsHash: string,
): Promise<AcceptStudioSuggestionState> {
  const parsedInput = acceptSchema.safeParse({ draftId, acceptedContent, expectedContentHash, expectedSuggestionsHash })
  if (!parsedInput.success) return { outcome: 'error', error: 'invalid_input' }

  const ctx = await getAuthContext()
  if (!ctx) return { outcome: 'error', error: 'generic' }
  const { client, business } = ctx

  const result = await acceptSuggestion(client, draftId, business.id, acceptedContent, expectedContentHash, expectedSuggestionsHash)
  if (result.outcome === 'stale') return { outcome: 'stale' }
  return { outcome: 'accepted', content: result.draft.content }
}
