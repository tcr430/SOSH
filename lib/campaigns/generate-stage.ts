import type { CampaignBriefRow, CampaignRow } from '@/lib/db/types'

// ADR 0017 §11 / K2.12 — what the campaign page offers a customer, as a pure function of the two persisted statuses
// (never a component prop), so the rule is testable and the page cannot drift from startGenerationAction.
//
//   draft                            -> 'prepare_brief' (brief creation failed at submit, or has not run; retry it)
//   awaiting_brief + brief approved  -> 'generate'      (the Generate control; startGenerationAction accepts exactly this)
//   awaiting_brief + brief not yet   -> 'review_brief'  (a link to brief review; nothing to generate yet)
//   anything else                    -> 'none'          (active/paused/completed already generated; a 'generated' brief
//                                                        means generation is in flight or has finished)
export type GenerateStage = 'prepare_brief' | 'generate' | 'review_brief' | 'none'

export function generateStage(
  campaignStatus: CampaignRow['status'],
  briefStatus: CampaignBriefRow['status'] | null,
): GenerateStage {
  if (campaignStatus === 'draft') return 'prepare_brief'
  if (campaignStatus !== 'awaiting_brief') return 'none'
  if (briefStatus === 'approved') return 'generate'
  if (briefStatus === 'generated') return 'none'
  return 'review_brief'
}
