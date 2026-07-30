import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { formatISO } from 'date-fns'
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

// ADR §10.1's implicit save at suggest time: persists the EXACT content that
// was sent to the model (so content_hash reflects precisely what the
// suggestions were generated against) together with the suggestion set and
// its version fingerprint, in one statement.
export async function persistSuggestions(
  client: SupabaseClient,
  id: string,
  businessId: string,
  content: string,
  suggestions: readonly unknown[],
): Promise<StudioDraftRow> {
  const suggestionsForHash = hashSuggestions(suggestions)
  const { data, error } = await client
    .from('studio_drafts')
    .update({ content, suggestions, suggestions_for_hash: suggestionsForHash })
    .eq('id', id)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as StudioDraftRow
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
