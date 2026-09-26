import { listAudienceMemoryCandidates } from '@/lib/db/memory-audience'
import { listBrandMemoryCandidates } from '@/lib/db/memory-brand'
import { listEvidenceMemoryCandidates } from '@/lib/db/memory-evidence'
import { INTERVIEW_CONFLICT_CONTEXT_PER_TYPE } from '@/lib/interview/constants'
import { rankAndCap } from './scoring'

// ADR 0029 §4.5 (Session 35 M2.8) — the existing records the extraction call is shown, so it can say which new record
// contradicts which old one. From THIS BUSINESS ONLY, ACTIVE rows only (the candidate reads filter status = 'active'),
// scored and hard-capped at 10 PER TYPE by the same rankAndCap every other memory read uses — never an unbounded dump.
// (The barrel readers cap at 5; §4.5 fixes this one at 10, so it caps here with the interview's own constant.)
//
// THE TENANT BOUNDARY IS THIS SET. The extraction intersects a model's `conflictsWith` with the ids returned here, so
// "cross-tenant ids fall out" holds exactly as far as every row below is scoped by `businessId` — each of the three
// candidate reads filters `business_id` explicitly, because this runs under service-role, which bypasses RLS.
//
// NO `client` PARAMETER: it runs in the extraction worker, so it acquires the service-role client itself by lazy import and a
// caller cannot hand it a different one.

export type InterviewConflictRecord = { id: string; type: 'brand' | 'audience' | 'evidence'; text: string }

export async function readInterviewConflictContext(businessId: string, now: Date = new Date()): Promise<InterviewConflictRecord[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const [brand, audience, evidence] = await Promise.all([
    listBrandMemoryCandidates(client, businessId),
    listAudienceMemoryCandidates(client, businessId),
    listEvidenceMemoryCandidates(client, businessId),
  ])
  const cap = INTERVIEW_CONFLICT_CONTEXT_PER_TYPE
  return [
    ...rankAndCap(brand, {}, cap, now).map((r) => ({ id: r.id, type: 'brand' as const, text: r.statement })),
    ...rankAndCap(audience, {}, cap, now).map((r) => ({ id: r.id, type: 'audience' as const, text: r.statement })),
    ...rankAndCap(evidence, {}, cap, now).map((r) => ({ id: r.id, type: 'evidence' as const, text: r.content })),
  ]
}
