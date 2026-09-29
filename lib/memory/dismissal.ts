import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceMemoryRow } from '@/lib/db/types'
import { listSourceDismissalCandidates, recomputeDismissalAudienceSignal } from '@/lib/db/memory-audience'
import { MEMORY_CANDIDATE_LIMIT } from '@/lib/db/memory-constants'
import { rankAndCap } from './scoring'
import { SOURCE_DISMISSAL_CAP } from './constants'

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
export async function recomputeDismissalSignal(cardId: string): Promise<string> {
  return recomputeDismissalAudienceSignal(cardId)
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
