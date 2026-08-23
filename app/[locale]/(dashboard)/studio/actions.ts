'use server'

import { z } from 'zod'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getStudioDraft, persistSuggestions, acceptSuggestion, createStudioDraft, saveStudioDraft } from '@/lib/db/studio-drafts'
import { promoteDraftToCampaignCore } from '@/lib/campaigns/promote'
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
// console.* anywhere in lib/studio/** or this route/action file — diagnostics
// go to Sentry, redacted and bounded, and AiError.message never reaches the
// client (parsers.ts:26 embeds Zod's message, which can include
// received/attacker-influenced values).
//
// NIT-1 (Session 26-D correction) — the claim above is scoped to
// lib/studio/** and the Studio route/action files, NOT lib/ai/runner.ts as a
// whole: runner.ts:212,237 each carry one console.error (trial-counter and
// ai_usage insert failures respectively). Confirmed pre-existing at this
// range's base (`git show de425283:lib/ai/runner.ts` already had both) —
// not a Session 26 regression — and confirmed to log only DB-helper failure
// messages, never model text, the nonce, or sentinels. Left as-is: removing
// them would be an out-of-scope change to shared AI infrastructure under
// L-1, and CLAUDE.md's one-canonical-structured-JSON-line carve-out already
// covers a worker/route's sole operator-observability line.

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
  // MAJOR-1 (Session 26-D correction) — persistSuggestions's content_hash
  // guard (mirroring acceptSuggestion's) returned 'superseded': another
  // write landed on this draft (a different tab/device) between the initial
  // content read and this call. The generated suggestions describe text
  // that is no longer current and are discarded; the user's newer text is
  // kept untouched.
  | 'draft_superseded'
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
    // exact bytes the hunks/edits coordinates below correspond to. Guarded
    // by draft.content_hash (MAJOR-1) — the hash read alongside
    // draft.content above, before the model round trip.
    const persistedRejected = await persistSuggestions(client, draftId, business.id, guardedDraft, [], draft.content_hash)
    if (persistedRejected.outcome === 'superseded') return { success: false, error: 'draft_superseded' }
    return { success: false, error: 'fabricated_citation' }
  }

  const dtoSet = verification.set.map((s) => toStudioClientDTO(s))
  const persisted = await persistSuggestions(client, draftId, business.id, guardedDraft, dtoSet, draft.content_hash)
  if (persisted.outcome === 'superseded') return { success: false, error: 'draft_superseded' }
  const saved = persisted.draft

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

// ADR 0022 §5.1, §5.4 (Session 29-D, D2/NIT-7) — acceptedContent is written
// verbatim to BOTH studio_drafts.content and studio_drafts.accepted_revision
// (lib/db/studio-drafts.ts's acceptSuggestion, the ONLY write site for
// accepted_revision), which promote.ts:141-142 later copies unmodified into
// post_ai_originals.rendered_content and payload.content. Mirrors the
// existing max(5000) contract for posts.content (calendar/actions.ts:48,
// posts/actions.ts:179, and promote.ts's own PROMOTE_CONTENT_MAX_CHARS
// guard on draft.content) so this is not the one write path with a weaker
// bound. No DB CHECK added: posts.content itself has none either — the
// app-layer Zod bound at this sole write site is the established pattern
// for this class of field, and a CHECK would duplicate it for no added
// safety (accepted_revision has no other producer to defend against).
const acceptSchema = z.object({
  draftId: z.string().uuid(),
  acceptedContent: z.string().min(1).max(5000),
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

// ── ADR 0022 §2 — promote-to-campaign (Session 29, F1b.4) ───────────────────
// Thin wrapper: Zod-validate, resolve the authenticated client, delegate to
// promoteDraftToCampaignCore (lib/campaigns/promote.ts — see that file's
// header comment for why the actual logic lives there, not here).

export type PromoteDraftToCampaignState =
  | { outcome: 'promoted'; campaignId: string; briefId: string; postId: string }
  | { outcome: 'already_promoted'; draft: StudioDraftRow }
  | { outcome: 'claimed_by_another'; draft: StudioDraftRow }
  | { outcome: 'not_eligible' }
  | { outcome: 'error'; error: StudioActionErrorCode }

const promoteDraftSchema = z.object({
  draftId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
})

export async function promoteDraftToCampaign(
  draftId: string,
  scheduledAt: string,
): Promise<PromoteDraftToCampaignState> {
  const parsedInput = promoteDraftSchema.safeParse({ draftId, scheduledAt })
  if (!parsedInput.success) return { outcome: 'error', error: 'invalid_input' }

  const ctx = await getAuthContext()
  if (!ctx) return { outcome: 'error', error: 'generic' }
  const { client, business } = ctx

  const result = await promoteDraftToCampaignCore(client, business.id, parsedInput.data.draftId, parsedInput.data.scheduledAt)
  if (result.outcome === 'content_too_long') return { outcome: 'error', error: 'draft_too_long' }
  if (result.outcome === 'error') return { outcome: 'error', error: 'generic' }
  return result
}
