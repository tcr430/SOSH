import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/db/campaigns', () => ({
  getCampaignById: vi.fn(),
  moveCampaignToAwaitingBrief: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/db/campaign-briefs', () => ({
  getBriefByCampaign: vi.fn(),
  createBrief: vi.fn(),
  submitBriefForCritique: vi.fn(),
  approveBrief: vi.fn(),
}))

vi.mock('@/lib/ai/context', () => ({
  buildCustomerContext: vi.fn(),
}))

vi.mock('@/lib/ai/runner', () => ({
  runPrompt: vi.fn(),
}))

vi.mock('@/lib/ai/wrap-evidence', () => ({
  wrapEvidenceForPrompt: vi.fn().mockResolvedValue(''),
  neutralize: vi.fn((s: string) => s.replace(/\[\/DATA\]/gi, '[/data-blocked]')),
}))

vi.mock('@/lib/memory', () => ({
  retrieveEvidenceMemory: vi.fn().mockResolvedValue([]),
  retrieveAudienceMemory: vi.fn().mockResolvedValue([]),
  retrieveBrandMemory: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/db/posts', () => ({
  listPostsByCampaign: vi.fn().mockResolvedValue([]),
}))

// ── Imports after mocks ─────────────────────────────────────────────────────

import { assembleBrief, critiqueBrief, approveBriefIfQualified, freezeBrief } from './brief'
import { getCampaignById, moveCampaignToAwaitingBrief } from '@/lib/db/campaigns'
import { getBriefByCampaign, createBrief, submitBriefForCritique, approveBrief } from '@/lib/db/campaign-briefs'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { wrapEvidenceForPrompt, neutralize } from '@/lib/ai/wrap-evidence'
import { retrieveEvidenceMemory, retrieveAudienceMemory, retrieveBrandMemory } from '@/lib/memory'
import { listPostsByCampaign } from '@/lib/db/posts'
import type { CampaignRow, CampaignBriefRow, CampaignBriefContent, EvidenceMemoryRow } from '@/lib/db/types'
import type { CustomerContext } from '@/lib/ai/context'
import type { RubricOutput } from '@/lib/ai/prompts/rubric'

const mockCampaign: CampaignRow = {
  id: 'camp-1',
  business_id: 'biz-1',
  name: 'Q3 Launch',
  objective: 'Drive trial signups',
  special_instructions: null,
  platforms: ['linkedin', 'twitter'],
  frequency: 'weekly',
  posts_per_week: 3,
  start_date: '2026-08-01',
  end_date: null,
  status: 'draft',
  total_posts_planned: 0,
  total_posts_published: 0,
  voice_variation_id: null,
  origin: 'objective_generated',
  deleted_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

const mockContent: CampaignBriefContent = {
  narrative: 'We help B2B SaaS teams post consistently.',
  proofPlan: 'Cite churn-reduction data.',
  pinnedEvidence: [{ evidenceMemoryId: 'ev-1' }],
  roleSequence: [
    { order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the core argument' },
    { order: 1, role: 'customer_proof', platform: 'twitter', angle: 'social proof' },
  ],
}

function makeBrief(overrides: Partial<CampaignBriefRow> = {}): CampaignBriefRow {
  return {
    id: 'brief-1',
    business_id: 'biz-1',
    campaign_id: 'camp-1',
    content: mockContent,
    status: 'draft',
    version: 1,
    overall_score: null,
    critique: null,
    frozen_at: null,
    deleted_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function makeCtx(): CustomerContext {
  return {
    business: { id: 'biz-1', name: 'Acme SaaS', industry: 'Software', description: null, language: 'en', website: null, timezone: 'UTC' },
    brandVoice: null,
    recentCampaigns: [],
    recentPostPerformance: [],
    trialState: null,
  }
}

function makeRubricOutput(overall: number): RubricOutput {
  const dim = { score: overall, note: 'ok' }
  return {
    dimensions: {
      specificity: dim, originality: dim, evidenceSufficiency: dim, audienceRelevance: dim,
      platformNativeness: dim, brandVoiceAlignment: dim, openingStrength: dim, ctaFit: dim,
      unsupportedClaimsRisk: dim, redundancy: dim,
    },
    overall,
    critique: ['Add a stronger opening line.'],
    verdict: overall >= 70 ? 'pass' : 'fail',
  }
}

beforeEach(() => {
  vi.mocked(getCampaignById).mockReset().mockResolvedValue(mockCampaign)
  vi.mocked(moveCampaignToAwaitingBrief).mockReset().mockResolvedValue(mockCampaign)
  vi.mocked(getBriefByCampaign).mockReset()
  vi.mocked(createBrief).mockReset()
  vi.mocked(submitBriefForCritique).mockReset()
  vi.mocked(approveBrief).mockReset()
  vi.mocked(buildCustomerContext).mockReset().mockResolvedValue(makeCtx())
  vi.mocked(runPrompt).mockReset()
  vi.mocked(wrapEvidenceForPrompt).mockReset().mockResolvedValue('' as never)
  vi.mocked(retrieveEvidenceMemory).mockReset().mockResolvedValue([])
  vi.mocked(retrieveAudienceMemory).mockReset().mockResolvedValue([])
  vi.mocked(retrieveBrandMemory).mockReset().mockResolvedValue([])
  vi.mocked(listPostsByCampaign).mockReset().mockResolvedValue([])
})

describe('assembleBrief — Stage A (MODE2-MEMORY-WIRED)', () => {
  it('retrieves evidence/audience/brand memory and feeds it into the assembly prompt input', async () => {
    const evidenceRow = { id: 'ev-1', content: 'A great customer quote' } as EvidenceMemoryRow
    vi.mocked(retrieveEvidenceMemory).mockResolvedValue([evidenceRow])
    vi.mocked(getBriefByCampaign).mockResolvedValue(null)
    vi.mocked(runPrompt).mockResolvedValue(mockContent)
    vi.mocked(createBrief).mockResolvedValue(makeBrief())

    await assembleBrief('camp-1')

    expect(retrieveEvidenceMemory).toHaveBeenCalledWith(expect.anything(), 'biz-1', { objective: 'Drive trial signups' })
    expect(retrieveAudienceMemory).toHaveBeenCalledWith(expect.anything(), 'biz-1', { objective: 'Drive trial signups' })
    expect(retrieveBrandMemory).toHaveBeenCalledWith(expect.anything(), 'biz-1', { objective: 'Drive trial signups' })

    const promptInput = vi.mocked(runPrompt).mock.calls[0][2] as { evidenceCandidates: Array<{ id: string }> }
    expect(promptInput.evidenceCandidates).toEqual([{ id: 'ev-1', guardedContent: '' }])
  })

  it('renders each evidence candidate through wrapEvidenceForPrompt (MODE2-EVIDENCE-DATA-GUARDED)', async () => {
    const evidenceRow = { id: 'ev-1', content: 'quote' } as EvidenceMemoryRow
    vi.mocked(retrieveEvidenceMemory).mockResolvedValue([evidenceRow])
    vi.mocked(getBriefByCampaign).mockResolvedValue(null)
    vi.mocked(runPrompt).mockResolvedValue(mockContent)
    vi.mocked(createBrief).mockResolvedValue(makeBrief())

    await assembleBrief('camp-1')

    expect(wrapEvidenceForPrompt).toHaveBeenCalledWith(expect.anything(), 'biz-1', ['ev-1'])
  })

  it('persists a draft brief and atomically moves the campaign to awaiting_brief', async () => {
    const evidenceRow = { id: 'ev-1', content: 'A great customer quote' } as EvidenceMemoryRow
    vi.mocked(retrieveEvidenceMemory).mockResolvedValue([evidenceRow])
    vi.mocked(getBriefByCampaign).mockResolvedValue(null)
    vi.mocked(runPrompt).mockResolvedValue(mockContent)
    const created = makeBrief()
    vi.mocked(createBrief).mockResolvedValue(created)

    const result = await assembleBrief('camp-1')

    expect(result).toEqual(created)
    expect(createBrief).toHaveBeenCalledWith(expect.anything(), 'camp-1', mockContent)
    expect(moveCampaignToAwaitingBrief).toHaveBeenCalledWith(expect.anything(), 'camp-1')
  })

  it('rejects a pinnedEvidence id the model cited but was never shown as a candidate (MAJOR-1 acceptance-gap close)', async () => {
    const evidenceRow = { id: 'ev-1', content: 'A great customer quote' } as EvidenceMemoryRow
    vi.mocked(retrieveEvidenceMemory).mockResolvedValue([evidenceRow])
    vi.mocked(getBriefByCampaign).mockResolvedValue(null)
    vi.mocked(runPrompt).mockResolvedValue({
      ...mockContent,
      pinnedEvidence: [{ evidenceMemoryId: 'ev-1' }, { evidenceMemoryId: 'ev-999-not-a-candidate' }],
    })
    vi.mocked(createBrief).mockResolvedValue(makeBrief())

    await assembleBrief('camp-1')

    const persisted = vi.mocked(createBrief).mock.calls[0][2] as CampaignBriefContent
    expect(persisted.pinnedEvidence).toEqual([{ evidenceMemoryId: 'ev-1' }])
  })

  it('refuses to assemble when the campaign is not in draft', async () => {
    vi.mocked(getCampaignById).mockResolvedValue({ ...mockCampaign, status: 'awaiting_brief' })
    await expect(assembleBrief('camp-1')).rejects.toThrow(/draft/)
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('refuses to assemble when a brief already exists', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
    await expect(assembleBrief('camp-1')).rejects.toThrow(/already exists/)
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('MODE2-BRIEF-BEFORE-COPY: no posts row exists after Stage A', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(null)
    vi.mocked(runPrompt).mockResolvedValue(mockContent)
    vi.mocked(createBrief).mockResolvedValue(makeBrief())

    await assembleBrief('camp-1')

    const posts = await listPostsByCampaign({} as never, 'camp-1')
    expect(posts).toEqual([])
  })
})

describe('critiqueBrief — Stage B', () => {
  it('renders pinned evidence through wrapEvidenceForPrompt (the SECOND enumerated caller, ADR §12)', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
    vi.mocked(runPrompt).mockResolvedValue(makeRubricOutput(85))
    vi.mocked(submitBriefForCritique).mockResolvedValue(makeBrief({ status: 'critiqued', overall_score: 85 }))

    await critiqueBrief('camp-1')

    expect(wrapEvidenceForPrompt).toHaveBeenCalledWith(expect.anything(), 'biz-1', ['ev-1'])
  })

  it("routes the brief's own narrative and proofPlan through neutralize() before they reach the rubric (B2.5 security-reviewer finding)", async () => {
    // Unit-level: proves the ORCHESTRATION wiring (neutralize is actually
    // called on narrative/proofPlan, not just on evidence). The Unicode/ZWSP
    // defusal CORRECTNESS of neutralize() itself is proven separately in
    // wrap-evidence.test.ts against the real, unmocked implementation — a
    // mocked neutralize here can't exercise that without duplicating those
    // tests against a fake regex.
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
    vi.mocked(runPrompt).mockResolvedValue(makeRubricOutput(85))
    vi.mocked(submitBriefForCritique).mockResolvedValue(makeBrief({ status: 'critiqued', overall_score: 85 }))

    await critiqueBrief('camp-1')

    expect(neutralize).toHaveBeenCalledWith(mockContent.narrative)
    expect(neutralize).toHaveBeenCalledWith(mockContent.proofPlan)
  })

  it('runs the shared rubric in brief mode and persists overall_score + critique atomically', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief())
    const scored = makeRubricOutput(85)
    vi.mocked(runPrompt).mockResolvedValue(scored)
    vi.mocked(submitBriefForCritique).mockResolvedValue(makeBrief({ status: 'critiqued', overall_score: 85 }))

    await critiqueBrief('camp-1')

    const rubricInput = vi.mocked(runPrompt).mock.calls[0][2] as { mode: string }
    expect(rubricInput.mode).toBe('brief')
    expect(submitBriefForCritique).toHaveBeenCalledWith(
      expect.anything(),
      'brief-1',
      expect.objectContaining({ overallScore: 85 }),
    )
  })
})

describe('approveBriefIfQualified — Stage C, the HARD gate (MODE2-CRITIQUE-GATE)', () => {
  it('BELOW threshold: refuses approval, returns the critique, NEVER calls approveBrief', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(
      makeBrief({ status: 'critiqued', overall_score: 69, critique: { note: 'weak' } }),
    )

    const result = await approveBriefIfQualified('camp-1')

    expect(result.approved).toBe(false)
    if (!result.approved) {
      expect(result.overallScore).toBe(69)
      expect(result.critique).toEqual({ note: 'weak' })
    }
    expect(approveBrief).not.toHaveBeenCalled()
  })

  it('AT threshold (exactly 70): allowed — this test reddens if the comparison flips from >= to >', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ status: 'critiqued', overall_score: 70 }))
    vi.mocked(approveBrief).mockResolvedValue(
      makeBrief({ status: 'approved', overall_score: 70, frozen_at: '2026-08-01T01:00:00Z' }),
    )

    const result = await approveBriefIfQualified('camp-1')

    expect(result.approved).toBe(true)
    expect(approveBrief).toHaveBeenCalledWith(expect.anything(), 'brief-1')
  })

  it('ABOVE threshold: allowed, returns a FrozenBrief', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValue(makeBrief({ status: 'critiqued', overall_score: 90 }))
    vi.mocked(approveBrief).mockResolvedValue(
      makeBrief({ status: 'approved', overall_score: 90, frozen_at: '2026-08-01T01:00:00Z' }),
    )

    const result = await approveBriefIfQualified('camp-1')

    expect(result.approved).toBe(true)
    if (result.approved) {
      expect(result.brief.frozenAt).toBe('2026-08-01T01:00:00Z')
    }
  })

  it('69 is refused, 70 is allowed — the exact threshold boundary', async () => {
    vi.mocked(getBriefByCampaign).mockResolvedValueOnce(makeBrief({ status: 'critiqued', overall_score: 69 }))
    const below = await approveBriefIfQualified('camp-1')
    expect(below.approved).toBe(false)

    vi.mocked(getBriefByCampaign).mockResolvedValueOnce(makeBrief({ status: 'critiqued', overall_score: 70 }))
    vi.mocked(approveBrief).mockResolvedValue(makeBrief({ status: 'approved', overall_score: 70, frozen_at: 'x' }))
    const at = await approveBriefIfQualified('camp-1')
    expect(at.approved).toBe(true)
  })
})

describe('freezeBrief — the ONE FrozenBrief producer (ADR §5.2 [type-5])', () => {
  it('produces a FrozenBrief from an approved, frozen row', () => {
    const row = makeBrief({ status: 'approved', frozen_at: '2026-08-01T01:00:00Z' })
    const frozen = freezeBrief(row)
    expect(frozen.id).toBe(row.id)
    expect(frozen.frozenAt).toBe('2026-08-01T01:00:00Z')
  })

  it('the output is actually readonly — mutation throws in strict mode / is a no-op', () => {
    const row = makeBrief({ status: 'approved', frozen_at: '2026-08-01T01:00:00Z' })
    const frozen = freezeBrief(row)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.content)).toBe(true)
    expect(Object.isFrozen(frozen.content.roleSequence)).toBe(true)
  })

  it('throws when given a non-approved row', () => {
    const row = makeBrief({ status: 'critiqued', frozen_at: null })
    expect(() => freezeBrief(row)).toThrow(/not approved/)
  })

  it('throws when given an approved row with no frozen_at (should never happen, but not trusted blindly)', () => {
    const row = makeBrief({ status: 'approved', frozen_at: null })
    expect(() => freezeBrief(row)).toThrow()
  })

  // Session 24-D (MINOR-5 correction) — compile-time proof that
  // FrozenBrief.content is now DEEP-readonly, not just shallow: TS must
  // reject a .push() on roleSequence/pinnedEvidence, matching what
  // Object.freeze already rejects at runtime (the test above). Before this
  // correction, `content: Readonly<CampaignBriefContent>` left the ARRAY
  // properties typed-mutable — this .push() would have typechecked fine
  // even though it threw at runtime. @ts-expect-error itself fails the
  // build if the line it's attached to stops erroring (e.g. the deep-
  // readonly retype is ever accidentally reverted to shallow) — this is a
  // real compile-time assertion, not a runtime one.
  it('TYPE-LEVEL: a mutating call on frozen content is rejected by TypeScript, not just by Object.freeze at runtime', () => {
    const row = makeBrief({ status: 'approved', frozen_at: '2026-08-01T01:00:00Z' })
    const frozen = freezeBrief(row)
    // @ts-expect-error — roleSequence is ReadonlyArray; .push does not exist on it.
    expect(() => frozen.content.roleSequence.push(frozen.content.roleSequence[0])).toThrow()
  })
})
