import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { briefAssemblyPrompt } from '@/lib/ai/prompts/brief'
import { rubricPrompt, BRIEF_QUALITY_THRESHOLD, type RubricOutput } from '@/lib/ai/prompts/rubric'
import { wrapEvidenceForPrompt, neutralize } from '@/lib/ai/wrap-evidence'
import { retrieveEvidenceMemory, retrieveAudienceMemory, retrieveBrandMemory } from '@/lib/memory'
import { getCampaignById, moveCampaignToAwaitingBrief } from '@/lib/db/campaigns'
import {
  getBriefByCampaign,
  createBrief,
  submitBriefForCritique,
  approveBrief,
} from '@/lib/db/campaign-briefs'
import type { CampaignBriefContent, CampaignBriefRow } from '@/lib/db/types'

// ADR 0017 §5.2 [type-5] — the branded, deeply-readonly FrozenBrief. Produced
// by EXACTLY this one function; a plain CampaignBriefRow cannot be passed
// where a FrozenBrief is required (a caller must go through freezeBrief,
// which enforces the row is actually approved+frozen — you cannot construct
// one by casting a draft). This is the type-layer half of the freeze
// guarantee; the DB-layer half (the frozen_at guard trigger rejecting a
// content UPDATE once frozen) shipped in B2.0.
export type FrozenBrief = Readonly<{
  id: string
  businessId: string
  campaignId: string
  content: Readonly<CampaignBriefContent>
  frozenAt: string
}> & { readonly _brand: 'FrozenBrief' }

function deepFreezeContent(content: CampaignBriefContent): Readonly<CampaignBriefContent> {
  content.pinnedEvidence.forEach((e) => Object.freeze(e))
  Object.freeze(content.pinnedEvidence)
  content.roleSequence.forEach((r) => Object.freeze(r))
  Object.freeze(content.roleSequence)
  return Object.freeze(content)
}

export function freezeBrief(row: CampaignBriefRow): FrozenBrief {
  if (row.status !== 'approved' || row.frozen_at === null) {
    throw new Error(`Cannot freeze brief ${row.id}: not approved (status=${row.status})`)
  }
  return Object.freeze({
    id: row.id,
    businessId: row.business_id,
    campaignId: row.campaign_id,
    content: deepFreezeContent(row.content),
    frozenAt: row.frozen_at,
  }) as FrozenBrief
}

async function serviceClient() {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  return createServiceRoleClient()
}

// ADR 0017 §5.1 (L-10) — memory wires into the brief-assembly INPUT only.
// ctx (CustomerContext, via buildCustomerContext) is used completely
// unchanged, exactly as generate.ts uses it today — evidence/audience/brand
// retrieval feeds the Prompt's separate `input` parameter, never ctx.
//
// Stage A: assemble.
export async function assembleBrief(campaignId: string): Promise<CampaignBriefRow> {
  const client = await serviceClient()

  const campaign = await getCampaignById(client, campaignId)
  if (campaign.status !== 'draft') {
    throw new Error(`Cannot assemble a brief for campaign ${campaignId}: status is ${campaign.status}, expected draft`)
  }
  const existing = await getBriefByCampaign(client, campaignId)
  if (existing) {
    throw new Error(`A brief already exists for campaign ${campaignId}`)
  }

  const queryContext = { objective: campaign.objective }
  const [evidenceRows, audienceRows, brandRows] = await Promise.all([
    retrieveEvidenceMemory(client, campaign.business_id, queryContext),
    retrieveAudienceMemory(client, campaign.business_id, queryContext),
    retrieveBrandMemory(client, campaign.business_id, queryContext),
  ])

  // ADR §9 single choke point — called once per evidence id (B2.3's
  // committed contract returns one joined string, not a per-item map), so
  // each candidate can be labeled with its id for the model to cite.
  // Bounded by EVIDENCE_CAP (lib/memory/constants.ts, currently 5) — a small,
  // acceptable number of extra round-trips versus modifying B2.3's tested API.
  const evidenceCandidates = await Promise.all(
    evidenceRows.map(async (row) => ({
      id: row.id,
      guardedContent: await wrapEvidenceForPrompt(client, campaign.business_id, [row.id]),
    })),
  )

  const ctx = await buildCustomerContext(campaign.business_id, campaign.voice_variation_id)

  const content = await runPrompt(briefAssemblyPrompt, ctx, {
    objective: campaign.objective,
    platforms: campaign.platforms,
    specialInstructions: campaign.special_instructions,
    evidenceCandidates,
    audienceCandidates: audienceRows.map((r) => ({ statement: r.statement, kind: r.kind })),
    brandCandidates: brandRows.map((r) => ({ statement: r.statement, category: r.category })),
  })

  // Session 24-D (MAJOR-1 correction, acceptance-gap close) — the render-time
  // guard (wrapEvidenceForPrompt, above) is defense-in-depth, not the ONLY
  // check: PINNED_EVIDENCE_SCHEMA validates evidenceMemoryId as a non-empty
  // string, not membership in the candidate set the model was actually shown.
  // Reject any id outside that set HERE, at the point untrusted model output
  // is first accepted — before persistence, not just before rendering.
  const candidateIds = new Set(evidenceCandidates.map((c) => c.id))
  const typedContent = content as CampaignBriefContent
  const sanitizedContent: CampaignBriefContent = {
    ...typedContent,
    pinnedEvidence: typedContent.pinnedEvidence.filter((e) => candidateIds.has(e.evidenceMemoryId)),
  }

  const brief = await createBrief(client, campaignId, sanitizedContent)
  await moveCampaignToAwaitingBrief(client, campaignId)
  return brief
}

// Stage B: critique gate. Runs the shared rubric (B2.2) over the brief and
// persists overall_score/critique atomically with the draft->critiqued
// transition. Does NOT decide pass/fail here — that decision (the HARD
// gate) is approveBriefIfQualified's job, reading the persisted score.
export async function critiqueBrief(campaignId: string): Promise<CampaignBriefRow> {
  const client = await serviceClient()

  const brief = await getBriefByCampaign(client, campaignId)
  if (!brief) throw new Error(`No brief exists for campaign ${campaignId}`)
  if (brief.status !== 'draft') {
    throw new Error(`Cannot critique brief ${brief.id}: status is ${brief.status}, expected draft`)
  }

  // ADR §12 caller table's SECOND enumerated evidence-rendering caller — the
  // rubric call also sees brief content and independently applies the guard
  // ([sec-MEDIUM-2]); it is not covered "for free" by assembly's guarding.
  const evidenceBlocks = await Promise.all(
    brief.content.pinnedEvidence.map((e) => wrapEvidenceForPrompt(client, brief.business_id, [e.evidenceMemoryId])),
  )

  const campaign = await getCampaignById(client, campaignId)
  const ctx = await buildCustomerContext(campaign.business_id, campaign.voice_variation_id)

  // B2.5 security-reviewer correction pass (MEDIUM, chained with the
  // audience/brand finding above): narrative/proofPlan are Stage A's OWN
  // model output — zod only validates them as non-empty strings, with no
  // structural defense against an embedded closer/fence/brace the model
  // could echo from an (now-also-guarded) injection attempt upstream.
  // neutralize()'d here, not just rubric.ts's own lighter internal guard,
  // so this second LLM call — which feeds the §6.3 HARD approval gate — gets
  // the same treatment evidence gets, not a weaker one.
  const scored: RubricOutput = await runPrompt(rubricPrompt, ctx, {
    mode: 'brief',
    contentLabel: 'campaign brief narrative and proof plan',
    content: [neutralize(brief.content.narrative), neutralize(brief.content.proofPlan), ...evidenceBlocks].join(
      '\n\n',
    ),
  })

  const updated = await submitBriefForCritique(client, brief.id, {
    overallScore: scored.overall,
    critique: scored as unknown as Record<string, unknown>,
  })
  if (!updated) {
    throw new Error(`submitBriefForCritique guard rejected brief ${brief.id} (status changed concurrently)`)
  }
  return updated
}

export type ApproveBriefResult =
  | { approved: true; brief: FrozenBrief }
  | { approved: false; overallScore: number; critique: Record<string, unknown> | null }

// Stage C: the HARD gate (ADR §6.3, MODE2-CRITIQUE-GATE). The gate is
// enforced IN CODE, before any DB write is attempted — a below-threshold
// brief never even calls approveBrief, rather than relying on a DB guard to
// silently no-op (that would make "refused" and "some other status
// mismatch" indistinguishable to the caller).
export async function approveBriefIfQualified(campaignId: string): Promise<ApproveBriefResult> {
  const client = await serviceClient()

  const brief = await getBriefByCampaign(client, campaignId)
  if (!brief) throw new Error(`No brief exists for campaign ${campaignId}`)
  if (brief.status !== 'critiqued') {
    throw new Error(`Cannot approve brief ${brief.id}: status is ${brief.status}, expected critiqued`)
  }

  const overallScore = brief.overall_score ?? 0
  if (overallScore < BRIEF_QUALITY_THRESHOLD) {
    return { approved: false, overallScore, critique: brief.critique }
  }

  const updated = await approveBrief(client, brief.id)
  if (!updated) {
    throw new Error(`approveBrief guard rejected brief ${brief.id} (status changed concurrently)`)
  }
  return { approved: true, brief: freezeBrief(updated) }
}
