import type { SupabaseClient } from '@supabase/supabase-js'
import { formatISO } from 'date-fns'
import type { InsightCardRow, InsightCardInsert, InsightCardUpdate, InsightCardStatus, InsightCardWithProvenance } from './types'
import { getErrorMessage } from './utils'

// ADR 0021 §10.1 (Session 28 E5.3) — the ONLY module that touches
// insight_cards. Every caller (Stage D, the opportunity feed, Server
// Actions) goes through here, never through a direct
// `.from('insight_cards')` elsewhere.

const PENDING_CARDS_DEFAULT_LIMIT = 50

// ADR 0023 §6.5 (Session 30 G1b.8) — the two-hop join both feed queries
// below share, extracted once. `signal_candidates(signals(html_url))` reads
// through the EXISTING FKs (insight_cards.signal_candidate_id ->
// signal_candidates.signal_id -> signals.id) — no new column anywhere.
const PROVENANCE_JOIN_SELECT = '*, signal_candidates(signals(html_url))'

interface RawCardWithJoin extends InsightCardRow {
  signal_candidates: { signals: { html_url: string | null } | null } | null
}

// publisher is DERIVED from the canonical link's hostname, never a stored
// value (see the CardProvenance comment in lib/db/types.ts for why this
// works identically for both sources). A malformed/missing link yields
// null for both fields — never thrown, since a card with no reachable
// provenance must still render, just without it.
function deriveProvenance(canonicalLink: string | null): { publisher: string | null; canonicalLink: string | null } {
  if (!canonicalLink) return { publisher: null, canonicalLink: null }
  try {
    return { publisher: new URL(canonicalLink).hostname, canonicalLink }
  } catch {
    return { publisher: null, canonicalLink: null }
  }
}

function withProvenance(rows: RawCardWithJoin[]): InsightCardWithProvenance[] {
  return rows.map((row) => {
    const { signal_candidates, ...card } = row
    const canonicalLink = signal_candidates?.signals?.html_url ?? null
    return { ...(card as InsightCardRow), provenance: deriveProvenance(canonicalLink) }
  })
}

// §5.7's exact predicate and ORDER BY — matching insight_cards_feed_idx
// (business_id, score DESC, occurred_at DESC, id ASC) INCLUDE (expires_at)
// WHERE status = 'pending' EXACTLY. If this query and that index ever
// disagree, the index is wrong, not this function (E5.1's migration is the
// authority on the index shape). The provenance join adds no predicate and
// no sort key, so it does not affect index-servability (ADR §6.5's own
// argument for why this needed no new index either).
export async function listPendingCardsForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit: number = PENDING_CARDS_DEFAULT_LIMIT,
): Promise<InsightCardWithProvenance[]> {
  const { data, error } = await client
    .from('insight_cards')
    .select(PROVENANCE_JOIN_SELECT)
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .or(`expires_at.is.null,expires_at.gt.${formatISO(new Date())}`)
    .order('score', { ascending: false })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return withProvenance((data as unknown as RawCardWithJoin[]) ?? [])
}

// §9.2 "Expired" state — not in the default feed (listPendingCardsForBusiness
// excludes it), reachable only via an explicit filter. "Expired" is the
// derived predicate status='pending' AND expires_at < now() (§5.5) — never a
// stored status, so this is the SAME table with the inverse time predicate,
// not a new concept.
export async function listExpiredCardsForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit: number = PENDING_CARDS_DEFAULT_LIMIT,
): Promise<InsightCardWithProvenance[]> {
  const { data, error } = await client
    .from('insight_cards')
    .select(PROVENANCE_JOIN_SELECT)
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .lt('expires_at', formatISO(new Date()))
    .order('score', { ascending: false })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return withProvenance((data as unknown as RawCardWithJoin[]) ?? [])
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

export type InsertCardResult =
  | { outcome: 'inserted'; card: InsightCardRow }
  // §4.1/A-5 (Session 28-D, D2) — the fail-closed path, NOT a DB failure: a
  // concurrent re-score's A-4′ reset already moved the candidate off
  // 'triaging'/this exact claim before insert_insight_card_if_claimed ran.
  | { outcome: 'claim_lost' }

// §4.1/A-5 (Session 28-D, D2) — routed through the insert_insight_card_if_claimed
// RPC (20260807120000_insight_card_claimed_insert.sql), NOT a plain
// `.insert()`: PostgREST's insert cannot express "insert only if the parent
// candidate is still 'triaging' under this exact claim," and that
// conditionality is A-4′'s entire point. business_id is no longer a caller
// input at all — the RPC derives it from signal_candidates itself, inside
// the same statement that consumes the claim, so it can never diverge from
// the parent row the way an app-level check could only catch after the
// fact. A card can only ever exist where the claim was live in that one
// statement — the orphan case the old unconditional-insert-then-
// compensating-delete flow depended on is UNREACHABLE, not merely
// compensated for; there is no rollback path here because there is nothing
// to roll back. SERVICE-ROLE: insight_cards has no authenticated INSERT
// policy (§8.1 — Stage D writes service-role), so this acquires its own
// client via the lazy-import pattern (CLAUDE.md) and takes no client
// parameter.
export async function insertCard(
  insert: Omit<InsightCardInsert, 'business_id'>,
  claimedAtIso: string,
): Promise<InsertCardResult> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const { data, error } = await client.rpc('insert_insight_card_if_claimed', {
    p_signal_candidate_id: insert.signal_candidate_id,
    p_claimed_at: claimedAtIso,
    p_observation: insert.observation,
    p_why_it_matters: insert.why_it_matters,
    p_audience: insert.audience,
    p_angle_options: insert.angle_options,
    p_evidence: insert.evidence,
    p_suggested_objective: insert.suggested_objective ?? null,
    p_novelty: insert.novelty,
    p_freshness: insert.freshness,
    p_sensitivity: insert.sensitivity,
    p_confidence: insert.confidence,
    p_rubric_scores: insert.rubric_scores,
    p_score: insert.score,
    p_occurred_at: insert.occurred_at,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as InsightCardRow[] | null) ?? []
  // database-reviewer (Session 28-D, D2): a connection drop AFTER this RPC
  // commits but BEFORE the response reaches us is indistinguishable from a
  // real claim loss — both read back as zero rows. No data-integrity impact
  // (no duplicate, no orphan; the RPC's own claim guard already prevents a
  // retry from re-inserting), purely an operator-legibility caveat on this
  // outcome.
  if (rows.length === 0) return { outcome: 'claim_lost' }
  return { outcome: 'inserted', card: rows[0] }
}

// §6.1 (Session 28 E5.10) — seedCampaignFromCard(cardId) has no business_id
// and no authenticated session, only a card id. SERVICE-ROLE, own client
// (CLAUDE.md lazy-import pattern), takes no client parameter.
export async function getCardById(id: string): Promise<InsightCardRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.from('insight_cards').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as InsightCardRow | null) ?? null
}

// §9.2/§6.4 (Session 28-D, D7, MINOR-7) — the atomic conditional write-back
// seedCampaignFromCard uses to link a card to the campaign it just seeded.
// SERVICE-ROLE, own client (CLAUDE.md lazy-import pattern): campaign_id is
// NOT in the authenticated column-scoped GRANT UPDATE (status,
// dismiss_reason only — 20260807100000_mode3_insight_cards.sql:178),
// deliberately not widened (see the new migration's comment) — this write
// always follows the SAME server-side call that already flipped status via
// the authenticated, RLS-scoped transitionCardStatus above, never a path an
// authenticated PostgREST call reaches directly.
// `.is('campaign_id', null)` is the conditional guard, not a read-then-
// update: idempotent against a retried call (a second attempt matches zero
// rows and silently no-ops, exactly like transitionCardStatus's own
// zero-row arm), and it can never overwrite a campaign_id another call
// already set — the same atomicity property §5's state machine depends on,
// applied here to a different column.
export async function setCardCampaignId(cardId: string, campaignId: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('insight_cards')
    .update({ campaign_id: campaignId })
    .eq('id', cardId)
    .is('campaign_id', null)
  if (error) throw new Error(getErrorMessage(error))
}

// §9.2/§6.4 (Session 28-D, D7 follow-up, database-reviewer MINOR-1) —
// ON DELETE SET NULL only fires on a real row DELETE, and campaigns are
// never hard-deleted by application code (softDeleteCampaignGuarded,
// lib/db/campaigns.ts, is an UPDATE ... SET deleted_at). Without this, a
// card's campaign_id keeps pointing at a soft-deleted, unreachable
// campaign — OpportunityFeed.tsx would render a REAL LINK to a dead page,
// which is worse than the inert fallback D7 replaced (that fallback was at
// least honest about being non-functional). SERVICE-ROLE, own client, for
// the same reason setCardCampaignId is: no authenticated GRANT touches
// campaign_id. Idempotent by construction — nulling an already-NULL column
// on zero or more matched rows is always a no-op, never an error.
export async function clearCampaignReferenceOnCards(campaignId: string): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('insight_cards')
    .update({ campaign_id: null })
    .eq('campaign_id', campaignId)
  if (error) throw new Error(getErrorMessage(error))
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
