import type { SupabaseClient } from '@supabase/supabase-js'
import { formatISO } from 'date-fns'
import type { InsightCardRow, InsightCardInsert, InsightCardUpdate, InsightCardStatus } from './types'
import { getErrorMessage } from './utils'

// ADR 0021 §10.1 (Session 28 E5.3) — the ONLY module that touches
// insight_cards. Every caller (Stage D, the opportunity feed, Server
// Actions) goes through here, never through a direct
// `.from('insight_cards')` elsewhere.

const PENDING_CARDS_DEFAULT_LIMIT = 50

// §5.7's exact predicate and ORDER BY — matching insight_cards_feed_idx
// (business_id, score DESC, occurred_at DESC, id ASC) INCLUDE (expires_at)
// WHERE status = 'pending' EXACTLY. If this query and that index ever
// disagree, the index is wrong, not this function (E5.1's migration is the
// authority on the index shape).
export async function listPendingCardsForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit: number = PENDING_CARDS_DEFAULT_LIMIT,
): Promise<InsightCardRow[]> {
  const { data, error } = await client
    .from('insight_cards')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .or(`expires_at.is.null,expires_at.gt.${formatISO(new Date())}`)
    .order('score', { ascending: false })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as InsightCardRow[]) ?? []
}

export async function getCardForBusiness(
  client: SupabaseClient,
  businessId: string,
  cardId: string,
): Promise<InsightCardRow | null> {
  const { data, error } = await client
    .from('insight_cards')
    .select('*')
    .eq('id', cardId)
    .eq('business_id', businessId)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as InsightCardRow | null) ?? null
}

// §4.1 tenant consistency — the third instance of the established pattern
// (posts↔campaigns; campaign_briefs↔campaigns, lib/db/campaign-briefs.ts:23-26).
// business_id is DERIVED from the parent signal_candidates row, never
// trusted from the caller: the insert always writes the freshly-fetched
// value, and a caller-supplied business_id that disagrees with it is
// rejected outright rather than silently corrected — a mismatch here is a
// bug (or an attack), not a value worth quietly overriding. SERVICE-ROLE:
// insight_cards has no authenticated INSERT policy (§8.1 — Stage D writes
// service-role), so this acquires its own client via the lazy-import
// pattern (CLAUDE.md) and takes no client parameter.
export async function insertCard(insert: InsightCardInsert): Promise<InsightCardRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const { data: candidate, error: candidateError } = await client
    .from('signal_candidates')
    .select('business_id')
    .eq('id', insert.signal_candidate_id)
    .single()
  if (candidateError) throw new Error(getErrorMessage(candidateError))

  if (candidate.business_id !== insert.business_id) {
    throw new Error(
      `insertCard: business_id "${insert.business_id}" does not match parent candidate "${insert.signal_candidate_id}"'s business_id "${candidate.business_id}"`,
    )
  }

  const { data, error } = await client
    .from('insight_cards')
    .insert({ ...insert, business_id: candidate.business_id })
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as InsightCardRow
}

export type TransitionCardStatusResult =
  | { outcome: 'ok'; currentStatus: InsightCardStatus }
  // §5.3's two-admins problem: the second UPDATE of a concurrent pair (or
  // any UPDATE that races an already-triaged card) matches zero rows. The
  // caller re-renders the card's ACTUAL state, never a generic error.
  | { outcome: 'already_triaged'; currentStatus: InsightCardStatus }

// §5.3 — every transition is an atomic conditional UPDATE
// (`.eq('status', expectedStatus)`), never read-then-update. Legality
// (which edges are permitted) is enforced in the DB by
// enforce_insight_card_legal_transition (E5.1); this function enforces
// CONCURRENCY only — the two are different guarantees, per that trigger's
// own comment.
export async function transitionCardStatus(
  client: SupabaseClient,
  businessId: string,
  cardId: string,
  expectedStatus: InsightCardStatus,
  updates: InsightCardUpdate,
): Promise<TransitionCardStatusResult> {
  const { data, error } = await client
    .from('insight_cards')
    .update(updates)
    .eq('id', cardId)
    .eq('business_id', businessId)
    .eq('status', expectedStatus)
    .select('status')
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  if (data) return { outcome: 'ok', currentStatus: data.status as InsightCardStatus }

  const { data: current, error: currentError } = await client
    .from('insight_cards')
    .select('status')
    .eq('id', cardId)
    .eq('business_id', businessId)
    .single()
  if (currentError) throw new Error(getErrorMessage(currentError))
  return { outcome: 'already_triaged', currentStatus: current.status as InsightCardStatus }
}
