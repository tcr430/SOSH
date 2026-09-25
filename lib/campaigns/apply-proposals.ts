import * as Sentry from '@sentry/nextjs'
import { applyBriefProposalsRpc, type ApplyBriefProposalsRpcResult } from '@/lib/db/campaign-plan-proposals'
import { validateRoleSequence } from '@/lib/campaigns/role-sequence'

// ADR 0027 §5.5/§5.9 (Session 34 K2.8) — the ONE campaigns-layer entry point for ratifying proposals. It exists
// so that EVERY ratified apply routes the roleSequence it produced through the shared schema
// (AGENCY-ROLE-SEQUENCE-ORDER-UNIQUE): a duplicate `order` would make generate.ts's
// `roleSequence.find(r => r.order === g.order)?.angle` resolve the wrong entry's angle — silently, permanently,
// into ai_generation_metadata.rationale and the post_ai_originals row derived from it.
//
// The RPC renumbers `order` from array position, so a duplicate cannot come out of a well-formed brief. This is
// the defence for the case where the brief going IN was already malformed (briefs predate the shared refine):
// the apply then surfaces it instead of blessing it.
//
// HONEST LIMIT: by the time this validates, the RPC has COMMITTED. An 'invalid_result' therefore means "the
// database now holds a brief whose roleSequence fails the shared schema" — a loud, typed, Sentry-reported
// outcome for the caller to show ("re-generate the brief"), not a rollback. The action that calls this
// (K2.10) must treat it as terminal for that brief version and must NOT go on to critique/approve it.
//
// Re-critique after a successful apply is the CALLER's job (the RPC leaves the brief 'draft', ADR §5.5
// [cr-MINOR-2]); this function does not call critiqueBrief.

export type ApplyRatifiedProposalsResult = ApplyBriefProposalsRpcResult | { outcome: 'invalid_result'; message: string }

export async function applyRatifiedProposals(args: {
  businessId: string
  briefId: string
  expectedVersion: number
  userId: string
  proposalIds: string[]
}): Promise<ApplyRatifiedProposalsResult> {
  const result = await applyBriefProposalsRpc(args)
  if (result.outcome !== 'ok') return result

  const validated = validateRoleSequence(result.brief.content.roleSequence)
  if (!validated.ok) {
    // ids and a closed schema message only — never brief content.
    Sentry.captureException(new Error('ratified apply produced an invalid roleSequence'), {
      tags: { business_id: args.businessId, brief_id: args.briefId, phase: 'apply-proposals' },
      extra: { message: validated.message },
    })
    return { outcome: 'invalid_result', message: validated.message }
  }
  return result
}
