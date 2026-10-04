import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceMemoryRow } from '@/lib/db/types'
import { listSourceDismissalCandidates, recomputeDismissalAudienceSignal, type DismissalOutcome } from '@/lib/db/memory-audience'
import { MEMORY_CANDIDATE_LIMIT } from '@/lib/db/memory-constants'
import { rankAndCap } from './scoring'
import { SOURCE_DISMISSAL_CAP } from './constants'

export type { DismissalOutcome }

// ADR 0030 §6 (Session 36 L2.6) — the dismissal writer's TS half and its ONE reader. This module is the ONLY importer of
// recomputeDismissalAudienceSignal and of listSourceDismissalCandidates (scan-enforced, SUBSTRATE-WRITES-VIA-LIB-MEMORY arm 2 and
// SUBSTRATE-DISMISSAL-SCOPED-CONSUMER).
//
// DETERMINISTIC, NO MODEL (L-7, SUBSTRATE-DISMISS-DETERMINISTIC, SUBSTRATE-NO-MODEL-ON-WRITE): nothing here imports lib/ai or reads a model. A human's
// closed-enum dismissal reason becomes a counted fact through SQL (recompute_dismissal_audience_signal), and this module only forwards a card id.

/**
 * Recompute the dismissal row of the watched source this card came from. Called by the three opportunity Server Actions after a successful
 * transition (dismiss with reason not_relevant may CREATE the row; approve and save only UPDATE an existing one, ADR 0030 §6.5). The caller wraps it in
 * its own try/catch with ONE console.error, as seedCampaignFromCard already is in the same file — a failure never undoes the transition.
 *
 * The input is the card id and nothing else: no client (the db wrapper acquires the service-role client itself), no options, and no field a
 * governance value could travel in (SUBSTRATE-GOVERNANCE-NOT-SUPPLIED). Returns the RPC's outcome text.
 */
export async function recomputeDismissalSignal(cardId: string): Promise<DismissalOutcome> {
  return recomputeDismissalAudienceSignal(cardId)
}

// Session 36-D D5 (MINOR-6): every outcome is either DECIDED (the function did what the card's state asked, or correctly declined to) or ANOMALOUS
// (the chain it relies on is broken, so an operator should see it). The Record is exhaustive over DismissalOutcome, so the compiler refuses a new
// outcome without a class; lib/memory/substrate-scans.test.ts ties the keys to the migration's RETURN literals. The three opportunity actions log
// ONE console.error for an anomalous outcome and nothing for a decided one. D9 copies this table into ADR 0030 §6.5.
export const DISMISSAL_OUTCOME_CLASS: Record<DismissalOutcome, 'decided' | 'anomalous'> = {
  // the card the action had JUST transitioned does not exist: the action's own premise failed
  noop_card_not_found: 'anomalous',
  // a card state that does not teach the gate (pending, or dismissed for another reason): expected, nothing to do
  noop_card_state: 'decided',
  // a github/rss signal with no watched-source id: the exactly-one-parent CHECK should make this impossible
  anomaly_watched_id_null: 'anomalous',
  // a source kind that is neither github nor rss: signals_source_check should make this impossible, and it is a no-op rather than a fault
  noop_unknown_kind: 'decided',
  // an approve or save on a source with no dismissal row: the common, correct outcome
  noop_no_row: 'decided',
  // the identifier failed the regex: the fail-closed path working as designed (a member can write the text it checks)
  invalid_identifier: 'decided',
  retired_invalid_identifier: 'decided',
  // the watched source no longer exists: the function declined to write, the ON DELETE CASCADE chain makes this rare, and it is the caller's no-op
  watched_source_gone: 'decided',
  retired_watched_source_gone: 'decided',
  // the watched source belongs to ANOTHER business: a tenancy fault the identity trigger exists to prevent
  anomaly_watched_source_foreign: 'anomalous',
  retired_anomaly_watched_source_foreign: 'anomalous',
  // the row was hard-deleted after 30 days retired: retention working
  deleted: 'decided',
  // the row was retired because nothing is left to count: the gate working
  retired: 'decided',
  // nothing counted and no row to retire: nothing to do
  noop_nothing_counted: 'decided',
  // the row was written
  upserted: 'decided',
  updated: 'decided',
}

/**
 * The active dismissal notes of one business, ranked by the shared scorer and hard-capped at SOURCE_DISMISSAL_CAP (ADR 0030 §6.8). The one
 * consumer is triage's list_audience_notes tool (L2.9). Dismissal rows are EXCLUDED from every other audience read; this is the only way to
 * see them, and nothing else (bundle, brief, planner, Studio, interview conflicts) may call it.
 */
export async function retrieveSourceDismissals(
  client: SupabaseClient,
  businessId: string,
  limit: number = MEMORY_CANDIDATE_LIMIT,
): Promise<AudienceMemoryRow[]> {
  const candidates = await listSourceDismissalCandidates(client, businessId, limit)
  return rankAndCap(candidates, {}, SOURCE_DISMISSAL_CAP)
}
