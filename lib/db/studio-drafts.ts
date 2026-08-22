import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { formatISO, subMinutes } from 'date-fns'
import type { StudioDraftRow, StudioDraftInsert, Platform } from './types'
import { getErrorMessage } from './utils'

// ADR 0019 §12.5 — the ONLY module that touches studio_drafts. Every caller
// (Server Actions, the pre-chamber route) goes through here, never through a
// direct `.from('studio_drafts')` elsewhere.
//
// Authenticated client only (lib/supabase/server.ts) — service-role NEVER
// appears in this path (L-13): RLS is the tenancy enforcement mechanism for
// every function below, not a defense-in-depth extra.

const STUDIO_DRAFT_LIST_LIMIT = 50

export type AcceptSuggestionResult =
  | { outcome: 'accepted'; draft: StudioDraftRow }
  // ADR §10.2 — a single typed result deliberately collapsing five causes
  // (stale content, superseded suggestion set, wrong id, soft-deleted,
  // RLS-denied) into one signal. Do not try to split this without the
  // SECURITY INVOKER follow-on named in §15.
  | { outcome: 'stale' }

// ADR §10.1 — bounded, matching D2.1's partial index
// (business_id, updated_at DESC, id) WHERE deleted_at IS NULL EXACTLY, so
// the query can be served by an index-only scan.
export async function listStudioDrafts(
  client: SupabaseClient,
  businessId: string,
  limit: number = STUDIO_DRAFT_LIST_LIMIT,
): Promise<StudioDraftRow[]> {
  const { data, error } = await client
    .from('studio_drafts')
    .select('*')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as StudioDraftRow[]) ?? []
}

export async function getStudioDraft(
  client: SupabaseClient,
  id: string,
  businessId: string,
): Promise<StudioDraftRow | null> {
  const { data, error } = await client
    .from('studio_drafts')
    .select('*')
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as StudioDraftRow | null) ?? null
}

export async function createStudioDraft(
  client: SupabaseClient,
  insert: StudioDraftInsert,
): Promise<StudioDraftRow> {
  const { data, error } = await client
    .from('studio_drafts')
    .insert(insert)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as StudioDraftRow
}

// Explicit save (ADR §10.1) — the user-triggered write, distinct from
// persistSuggestions's implicit save at suggest time.
export async function saveStudioDraft(
  client: SupabaseClient,
  id: string,
  businessId: string,
  content: string,
  platform?: Platform | null,
): Promise<StudioDraftRow> {
  const update: { content: string; platform?: Platform | null } = { content }
  if (platform !== undefined) update.platform = platform
  const { data, error } = await client
    .from('studio_drafts')
    .update(update)
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as StudioDraftRow
}

export async function softDeleteStudioDraft(
  client: SupabaseClient,
  id: string,
  businessId: string,
): Promise<void> {
  const { error } = await client
    .from('studio_drafts')
    .update({ deleted_at: formatISO(new Date()) })
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
  if (error) throw new Error(getErrorMessage(error))
}

// A version fingerprint for the SUGGESTIONS set, independent of content_hash
// — this is what makes the regenerate race ([db-MAJOR-6]) detectable at all.
// If suggestions_for_hash merely mirrored content_hash, two regenerate calls
// against UNCHANGED content would write the identical value both times, so a
// client holding the first (now-superseded) set could accept it: the guard
// would silently pass against the wrong set. Hashing the suggestions payload
// itself gives each generation call a distinct fingerprint even when content
// hasn't moved.
function hashSuggestions(suggestions: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(suggestions)).digest('hex')
}

export type PersistSuggestionsResult =
  | { outcome: 'saved'; draft: StudioDraftRow }
  // MAJOR-1 (Session 26-D correction) — mirrors AcceptSuggestionResult's
  // 'stale' arm: zero matched rows means another write landed between the
  // caller's content read and this call (reachable across two tabs/devices
  // on the same draft — a full model round-trip runs in between). A typed
  // result, never a throw, never a silent no-op.
  | { outcome: 'superseded' }

// ADR §10.1's implicit save at suggest time: persists the EXACT content that
// was sent to the model (so content_hash reflects precisely what the
// suggestions were generated against) together with the suggestion set and
// its version fingerprint, in one statement.
//
// MAJOR-1 — ONE atomic conditional UPDATE, guarded by content_hash, mirroring
// acceptSuggestion's guard below. Without it this was a blind last-write-wins
// on the very column acceptSuggestion guards with two .eq()s: a concurrent
// save from another tab/device between the caller's content read and this
// call would be silently overwritten with the stale content this call was
// about to persist.
export async function persistSuggestions(
  client: SupabaseClient,
  id: string,
  businessId: string,
  content: string,
  suggestions: readonly unknown[],
  expectedContentHash: string,
): Promise<PersistSuggestionsResult> {
  const suggestionsForHash = hashSuggestions(suggestions)
  const { data, error } = await client
    .from('studio_drafts')
    .update({ content, suggestions, suggestions_for_hash: suggestionsForHash })
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .eq('content_hash', expectedContentHash)
    .select()
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as StudioDraftRow[] | null) ?? []
  if (rows.length === 0) return { outcome: 'superseded' }
  return { outcome: 'saved', draft: rows[0] }
}

// ADR §10.2 — ONE atomic conditional UPDATE, never read-then-update. BOTH
// guards are required:
//   - content_hash = expectedContentHash: the content-change race (the user
//     edited the draft after suggestions were generated).
//   - suggestions_for_hash = expectedSuggestionsHash: the regenerate race
//     ([db-MAJOR-6]) — suggestions regenerated while content stayed the same
//     still pass the content-hash guard alone.
// The same statement writes the accepted revision AND clears
// suggestions/suggestions_for_hash — leaving a set bound to a hash that no
// longer matches is the same bug one step later.
//
// ⚠️ Callers MUST pass hashes computed over the EXACT STORED BYTES. Any
// trim/whitespace-normalisation/NFKC applied before hashing, while the
// content_hash column hashes raw content, makes every accept return `stale`
// unconditionally — the guard can never match (ADR §2.2's load-bearing
// corollary). Do not "tidy" content on the way to a hash comparison.
export async function acceptSuggestion(
  client: SupabaseClient,
  id: string,
  businessId: string,
  acceptedContent: string,
  expectedContentHash: string,
  expectedSuggestionsHash: string,
): Promise<AcceptSuggestionResult> {
  const { data, error } = await client
    .from('studio_drafts')
    .update({ content: acceptedContent, suggestions: null, suggestions_for_hash: null })
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .eq('content_hash', expectedContentHash)
    .eq('suggestions_for_hash', expectedSuggestionsHash)
    .select()
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as StudioDraftRow[] | null) ?? []
  if (rows.length === 0) return { outcome: 'stale' }
  return { outcome: 'accepted', draft: rows[0] }
}

// ADR 0022 §3.1-§3.4 (Session 29, F1b.3) — the promote-to-campaign claim.
export type ClaimDraftForPromotionResult =
  | { outcome: 'claimed'; draft: StudioDraftRow }
  // §3.3: "silently no-op" is correct for the write-back and WRONG for the
  // claim — the claim's loser has to render something truthful, mirroring
  // transitionCardStatus's already_triaged arm (insight-cards.ts:206-232).
  // Split into two arms (rather than insight-cards's single
  // already_triaged) because the two losing causes are genuinely different
  // states a caller must render differently: a promoted draft has a real
  // campaign to link to; a draft claimed by another in-flight promote does
  // not yet.
  | { outcome: 'already_promoted'; draft: StudioDraftRow }
  | { outcome: 'claimed_by_another'; draft: StudioDraftRow }

// The CLAIM (§3.1, §3.4) — an ATOMIC conditional UPDATE, never
// read-then-update. Guarded on promoted_campaign_id IS NULL (a promoted
// draft can never be re-claimed) AND EITHER promotion_claimed_at IS NULL
// (never claimed) OR it is older than PROMOTE_CLAIM_STALE_MINUTES (§3.4's
// staleness window — reclaims a stranded winner that claimed and then
// crashed before createCampaign or the write-back). .is('deleted_at', null)
// matches every other function in this module.
//
// §3.2: promoted_campaign_id is a real FK — there is no legal value to
// write into it before the campaign row exists, so THIS column, not that
// one, is the gate every concurrent promoter must pass through first.
export async function claimStudioDraftForPromotion(
  client: SupabaseClient,
  id: string,
  businessId: string,
): Promise<ClaimDraftForPromotionResult> {
  // Lazy import (CLAUDE.md pattern): lib/config.ts runs Zod env validation
  // at module load — a top-level import here would crash every test file
  // that imports studio-drafts.ts, even ones with no env vars set.
  const { config } = await import('@/lib/config')
  const staleBefore = formatISO(subMinutes(new Date(), config.server.PROMOTE_CLAIM_STALE_MINUTES))
  const { data, error } = await client
    .from('studio_drafts')
    .update({ promotion_claimed_at: formatISO(new Date()) })
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .is('promoted_campaign_id', null)
    .or(`promotion_claimed_at.is.null,promotion_claimed_at.lt.${staleBefore}`)
    .select()
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as StudioDraftRow[] | null) ?? []
  if (rows.length > 0) return { outcome: 'claimed', draft: rows[0] }

  // Zero rows matched — re-read the draft's REAL current state (§3.3) to
  // tell the two losing causes apart, mirroring transitionCardStatus's own
  // fallback SELECT (insight-cards.ts:224-231).
  const { data: current, error: currentError } = await client
    .from('studio_drafts')
    .select('*')
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .single()
  if (currentError) throw new Error(getErrorMessage(currentError))
  const draft = current as StudioDraftRow
  if (draft.promoted_campaign_id !== null) return { outcome: 'already_promoted', draft }
  return { outcome: 'claimed_by_another', draft }
}

// The WRITE-BACK (§3.1, §3.3) — written back IMMEDIATELY after
// createCampaign, before any later step. Guarded on
// .is('promoted_campaign_id', null), mirroring setCardCampaignId's
// .is('campaign_id', null) pattern (insight-cards.ts:161-170) exactly,
// including its return type: this one MAY silently no-op (a retried call
// matches zero rows and does nothing) because by this point the claim has
// already made the caller's exclusivity certain — there is nothing left for
// a loser to render truthfully.
export async function writeBackPromotedCampaignId(
  client: SupabaseClient,
  draftId: string,
  businessId: string,
  campaignId: string,
): Promise<void> {
  const { error } = await client
    .from('studio_drafts')
    .update({ promoted_campaign_id: campaignId })
    .eq('id', draftId)
    .eq('business_id', businessId)
    .is('promoted_campaign_id', null)
  if (error) throw new Error(getErrorMessage(error))
}

// ADR 0022 §12.1 — mirrors clearCampaignReferenceOnCards
// (insight-cards.ts:172-191) and exists for the identical reason:
// softDeleteCampaignGuarded (lib/db/campaigns.ts:141-155) is an UPDATE
// setting deleted_at, NOT a DELETE, so promoted_campaign_id's
// ON DELETE SET NULL never fires on a soft-delete. Without this, a
// promoted draft would keep pointing at a soft-deleted, unreachable
// campaign forever — the exact bug Session 28-D D7 closed for
// insight_cards.campaign_id, reintroduced fresh. Idempotent by
// construction: nulling an already-NULL column on zero or more matched
// rows is always a no-op, never an error.
//
// Unlike its insight-cards sibling, this function takes an AUTHENTICATED
// client and an explicit businessId rather than acquiring its own
// service-role client: studio_drafts has no column-level GRANT
// restriction the way insight_cards.campaign_id does (no GRANT statement
// narrows authenticated UPDATE on studio_drafts to a column subset), and
// this module's own header comment (ADR 0019 §12.5, L-13) requires RLS,
// not service-role, as the tenancy enforcement mechanism for every
// function here — service-role never appears in this path.
export async function clearPromotedCampaignReferenceOnDrafts(
  client: SupabaseClient,
  businessId: string,
  campaignId: string,
): Promise<void> {
  const { error } = await client
    .from('studio_drafts')
    .update({ promoted_campaign_id: null })
    .eq('business_id', businessId)
    .eq('promoted_campaign_id', campaignId)
  if (error) throw new Error(getErrorMessage(error))
}
