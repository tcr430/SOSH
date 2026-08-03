'use server'

import { z } from 'zod'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getStudioDraft, persistSuggestions, acceptSuggestion, createStudioDraft, saveStudioDraft } from '@/lib/db/studio-drafts'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { AiError, type AiErrorCode } from '@/lib/ai/errors'
import { studioSuggestionPrompt } from '@/lib/ai/prompts/studio-suggestion'
import { retrieveStudioPerformancePatterns, retrieveEvidenceMemory } from '@/lib/memory'
import { wrapEvidenceForPrompt } from '@/lib/ai/wrap-evidence'
import { guardStudioField, StudioGuardError } from '@/lib/studio/guard'
import { generateNonce, joinStudioMarkers } from '@/lib/studio/markers'
import { verifyStudioResponse, buildCitableContext, toStudioClientDTO, type StudioSuggestionDTO } from '@/lib/studio/verify'
import { diffDraft, resolveSpanEdit, type Hunk, type SpanEdit } from '@/lib/studio/diff'
import type { DraftObservation } from '@/lib/ai/prompts/studio-suggestion'
import type { Platform, StudioDraftRow } from '@/lib/db/types'

const PLATFORM_VALUES = ['linkedin', 'twitter', 'instagram', 'facebook', 'threads'] as const

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
  // A-6 (Session 26-D founder ruling) — guardStudioField refuses a draft
  // over the derived character cap outright rather than silently slicing
  // it (the old truncateToCap() caused BLOCKER-1's silent tail
  // destruction). Distinct from response_truncated, which is the
  // OUTPUT-side truncation code.
  | 'draft_too_long'
  | AiErrorCode

export type SuggestStudioSuggestionsState =
  | {
      success: true
      suggestions: readonly StudioSuggestionDTO[]
      // ADR §7.2/§11.2(9) — redundancy/platformNativeness, whole-draft
      // properties, never span-tied, never acceptable. Rendered visually
      // distinct from the suggestion set, not folded into it.
      draftObservations: readonly DraftObservation[]
      // ADR §6.1 — the serialized hunk array, computed server-side, zero
      // bundle cost. Renders as DiffView's left/right panes.
      hunks: readonly Hunk[]
      // ADR §11.1 — per-suggestion id -> the ORIGINAL-coordinate edit
      // (lib/studio/diff.ts's resolveSpanEdit), so the client can compute
      // "accept THIS ONE suggestion" as a plain string splice against the
      // current editor content, with no second server round-trip and no
      // model-reported offset. Only ids that resolved to a real edit are
      // present — absence means the client must not offer accept for that id.
      edits: Readonly<Record<string, SpanEdit>>
      contentHash: string
      suggestionsForHash: string
    }
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

  // BLOCKER-1 fix (Session 26-D) — guard the draft ONCE, here, and thread
  // this SAME guarded string through the model, joinStudioMarkers's clause
  // (3), buildCitableContext, diffDraft, and persistence. Previously only
  // buildUserMessage guarded the draft (the model's view); every other
  // consumer used raw draft.content, so wherever the guard was not the
  // identity function, the guard's OWN transform manufactured or hid diff
  // hunks that clause (3) exists to require independently.
  let guardedDraft: string
  try {
    guardedDraft = guardStudioField(draft.content)
  } catch (e) {
    if (e instanceof StudioGuardError) return { success: false, error: 'draft_too_long' }
    throw e
  }

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
      draft: guardedDraft,
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
    joined = joinStudioMarkers(output.revision, output.suggestions, guardedDraft, nonce)
  } catch (e) {
    if (e instanceof AiError) return { success: false, error: e.code }
    Sentry.captureException(e, { tags: { studio_action: 'suggestStudioSuggestions' } })
    return { success: false, error: 'generic' }
  }

  const avoidWords = new Set((aiCtx.brandVoice?.avoid_words ?? []).map((w) => w))
  const citable = buildCitableContext({
    draft: guardedDraft,
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
    // saw is persisted even though nothing renders from this call. Persist
    // guardedDraft, not raw draft.content: content_hash must describe the
    // exact bytes the hunks/edits coordinates below correspond to.
    await persistSuggestions(client, draftId, business.id, guardedDraft, [])
    return { success: false, error: 'fabricated_citation' }
  }

  const dtoSet = verification.set.map((s) => toStudioClientDTO(s))
  const saved = await persistSuggestions(client, draftId, business.id, guardedDraft, dtoSet)

  // ADR §11.1 — resolve each rendered suggestion's marker span back to an
  // original-coordinate edit, from the SAME hunk array the diff view
  // renders (no second diff pass, no model-reported offset). Built from
  // joined.suggestions (pre-verification span data), keyed by id, so a
  // suggestion that got demoted to model_judgment during verification still
  // gets its edit — attribution and "can this be accepted" are independent.
  const hunks = diffDraft(guardedDraft, joined.strippedRevision)
  const spanById = new Map(joined.suggestions.map((s) => [s.rationale.id, s.span]))
  const edits: Record<string, SpanEdit> = {}
  for (const suggestion of dtoSet) {
    const span = spanById.get(suggestion.id)
    if (span === undefined) continue
    const edit = resolveSpanEdit(hunks, span)
    if (edit !== null) edits[suggestion.id] = edit
  }

  return {
    success: true,
    suggestions: dtoSet,
    draftObservations: output.draftObservations,
    hunks,
    edits,
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

// ── ADR §3.5/§10.1 — the two writes that bring a studio_draft row into
// existence or persist an explicit edit. Neither is the "suggest" implicit
// save (persistSuggestions, above): these are the user-controlled paths
// the editor calls directly, never on a keystroke timer (L-8).

export type CreateStudioDraftState =
  | { success: true; draftId: string }
  | { success: false; error: StudioActionErrorCode }

const createDraftSchema = z.object({
  content: z.string(),
  platform: z.enum(PLATFORM_VALUES).nullable(),
})

export async function createStudioDraftAction(content: string, platform: Platform | null): Promise<CreateStudioDraftState> {
  const parsedInput = createDraftSchema.safeParse({ content, platform })
  if (!parsedInput.success) return { success: false, error: 'invalid_input' }

  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'generic' }
  const { client, business } = ctx

  let draft: StudioDraftRow
  try {
    draft = await createStudioDraft(client, { business_id: business.id, content: parsedInput.data.content, platform: parsedInput.data.platform })
  } catch (e) {
    Sentry.captureException(e, { tags: { studio_action: 'createStudioDraftAction' } })
    return { success: false, error: 'generic' }
  }

  return { success: true, draftId: draft.id }
}

export type SaveStudioDraftState =
  | { success: true; contentHash: string }
  | { success: false; error: StudioActionErrorCode }

const saveDraftSchema = z.object({
  draftId: z.string().uuid(),
  content: z.string(),
  platform: z.enum(PLATFORM_VALUES).nullable(),
})

export async function saveStudioDraftAction(draftId: string, content: string, platform: Platform | null): Promise<SaveStudioDraftState> {
  const parsedInput = saveDraftSchema.safeParse({ draftId, content, platform })
  if (!parsedInput.success) return { success: false, error: 'invalid_input' }

  const ctx = await getAuthContext()
  if (!ctx) return { success: false, error: 'generic' }
  const { client, business } = ctx

  let draft: StudioDraftRow
  try {
    draft = await saveStudioDraft(client, parsedInput.data.draftId, business.id, parsedInput.data.content, parsedInput.data.platform)
  } catch (e) {
    Sentry.captureException(e, { tags: { studio_action: 'saveStudioDraftAction' } })
    return { success: false, error: 'generic' }
  }

  return { success: true, contentHash: draft.content_hash }
}
