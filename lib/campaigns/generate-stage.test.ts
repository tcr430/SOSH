import { describe, it, expect } from 'vitest'
import { generateStage } from './generate-stage'
import type { CampaignBriefRow, CampaignRow } from '@/lib/db/types'

// ADR 0017 §11 / K2.12. SHARED-FUNCTION CALLERS (ADR 0015): generateStage's one production caller is
// campaigns/[id]/CampaignDetailActions.tsx. The rule must agree with startGenerationAction, which accepts exactly the
// 'generate' stage (asserted in campaigns/[id]/generate-action.test.ts).

const CAMPAIGN_STATUSES: CampaignRow['status'][] = ['draft', 'awaiting_brief', 'active', 'paused', 'completed']
const BRIEF_STATUSES: Array<CampaignBriefRow['status'] | null> = [null, 'draft', 'critiqued', 'approved', 'generated']

describe('generateStage', () => {
  it('offers Generate ONLY for an awaiting_brief campaign whose brief is approved', () => {
    expect(generateStage('awaiting_brief', 'approved')).toBe('generate')
  })

  it.each([null, 'draft', 'critiqued'] as const)('sends an awaiting_brief campaign with brief %s to brief review', (brief) => {
    expect(generateStage('awaiting_brief', brief)).toBe('review_brief')
  })

  it("offers nothing once the brief is 'generated' (generation is in flight or done)", () => {
    expect(generateStage('awaiting_brief', 'generated')).toBe('none')
  })

  it('asks a draft campaign to (re)prepare its brief, whatever the brief says', () => {
    for (const brief of BRIEF_STATUSES) expect(generateStage('draft', brief), String(brief)).toBe('prepare_brief')
  })

  it.each(['active', 'paused', 'completed'] as const)('offers nothing on a %s campaign whatever its brief says', (status) => {
    for (const brief of BRIEF_STATUSES) expect(generateStage(status, brief), `${status}/${brief}`).toBe('none')
  })

  it('is total over every combination and yields Generate for exactly one of them', () => {
    const generating = CAMPAIGN_STATUSES.flatMap((c) => BRIEF_STATUSES.map((b) => [c, b] as const)).filter(
      ([c, b]) => generateStage(c, b) === 'generate',
    )
    expect(generating).toEqual([['awaiting_brief', 'approved']])
  })
})
