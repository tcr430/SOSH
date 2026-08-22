import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/studio-drafts', () => ({
  getStudioDraft: vi.fn(),
  persistSuggestions: vi.fn(),
  acceptSuggestion: vi.fn(),
  createStudioDraft: vi.fn(),
  saveStudioDraft: vi.fn(),
}))
vi.mock('@/lib/campaigns/promote', () => ({ promoteDraftToCampaignCore: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn() }))
vi.mock('@/lib/ai/runner', () => ({ runPrompt: vi.fn() }))
vi.mock('@/lib/memory', () => ({
  retrieveStudioPerformancePatterns: vi.fn(),
  retrieveEvidenceMemory: vi.fn(),
}))
// Partial mock: neutralizeWithSentinels runs FOR REAL — guardStudioField
// (BLOCKER-1 fix, Session 26-D) now calls it directly in actions.ts, and a
// full stub here would make every real guardStudioField call throw
// "no export defined." Only wrapEvidenceForPrompt (the evidence-rendering
// side effect, irrelevant to these tests) is mocked.
vi.mock('@/lib/ai/wrap-evidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/wrap-evidence')>()
  return { ...actual, wrapEvidenceForPrompt: vi.fn() }
})
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
// Partial mock: joinStudioMarkers runs FOR REAL (it's the code under test's
// dependency we want exercised end-to-end for the hunks/edits assertions
// below) — only generateNonce is pinned so the test can construct a
// matching marker-wrapped fixture ahead of time.
vi.mock('@/lib/studio/markers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/studio/markers')>()
  return { ...actual, generateNonce: () => 'aaaaaaaa' }
})

import { suggestStudioSuggestions, acceptStudioSuggestion, createStudioDraftAction, saveStudioDraftAction, promoteDraftToCampaign } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getStudioDraft, persistSuggestions, acceptSuggestion, createStudioDraft, saveStudioDraft } from '@/lib/db/studio-drafts'
import { promoteDraftToCampaignCore } from '@/lib/campaigns/promote'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { retrieveStudioPerformancePatterns, retrieveEvidenceMemory } from '@/lib/memory'
import { wrapEvidenceForPrompt } from '@/lib/ai/wrap-evidence'
import { AiError } from '@/lib/ai/errors'
import { buildOpenToken, buildCloseToken } from '@/lib/studio/markers'
import { STUDIO_FIELD_MAX_CHARS } from '@/lib/studio/guard'

const BUSINESS_ID = 'biz-1'
const DRAFT_ID = '11111111-1111-4111-8111-111111111111'
const FAKE_CLIENT: { auth?: { getUser: ReturnType<typeof vi.fn> } } = {}

const draftRow = {
  id: DRAFT_ID,
  business_id: BUSINESS_ID,
  content: 'Our onboarding is slow.',
  platform: 'linkedin' as const,
  content_hash: 'hash1',
  suggestions: null,
  suggestions_for_hash: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mockContext = {
  business: { id: BUSINESS_ID, name: 'Acme', industry: 'SaaS', description: null, language: 'en', website: null, timezone: 'UTC' },
  brandVoice: null,
  recentCampaigns: [],
  recentPostPerformance: [],
  trialState: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  FAKE_CLIENT.auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) }
  vi.mocked(createClient).mockResolvedValue(FAKE_CLIENT as never)
  vi.mocked(getBusinessForUser).mockResolvedValue({ id: BUSINESS_ID } as never)
  vi.mocked(getStudioDraft).mockResolvedValue(draftRow as never)
  vi.mocked(buildCustomerContext).mockResolvedValue(mockContext as never)
  vi.mocked(retrieveStudioPerformancePatterns).mockResolvedValue([])
  vi.mocked(retrieveEvidenceMemory).mockResolvedValue([])
  vi.mocked(wrapEvidenceForPrompt).mockResolvedValue('' as never)
  // MAJOR-1 (Session 26-D correction) — persistSuggestions now returns a
  // discriminated union; default mock resolves the 'saved' arm.
  vi.mocked(persistSuggestions).mockResolvedValue({
    outcome: 'saved',
    draft: { ...draftRow, content_hash: 'hash2', suggestions_for_hash: 'sighash1' },
  } as never)
})

describe('suggestStudioSuggestions', () => {
  it('rejects invalid input (bad uuid) before any auth/DB/AI call', async () => {
    const result = await suggestStudioSuggestions('not-a-uuid')
    expect(result).toEqual({ success: false, error: 'invalid_input' })
    expect(getBusinessForUser).not.toHaveBeenCalled()
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('rejects a draft with no platform BEFORE any runPrompt call (§4.2)', async () => {
    vi.mocked(getStudioDraft).mockResolvedValue({ ...draftRow, platform: null } as never)
    const result = await suggestStudioSuggestions(DRAFT_ID)
    expect(result).toEqual({ success: false, error: 'missing_platform' })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('BLOCKER-1/A-6: an over-cap draft is refused as draft_too_long BEFORE runPrompt is called (STUDIO-ONE-CALL-PER-CLICK sibling property)', async () => {
    vi.mocked(getStudioDraft).mockResolvedValue({ ...draftRow, content: 'x'.repeat(STUDIO_FIELD_MAX_CHARS + 1) } as never)
    const result = await suggestStudioSuggestions(DRAFT_ID)
    expect(result).toEqual({ success: false, error: 'draft_too_long' })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it('calls runPrompt EXACTLY ONCE per action call (L-8 Tier-1 ceiling, STUDIO-ONE-CALL-PER-CLICK)', async () => {
    vi.mocked(runPrompt).mockResolvedValue({ revision: draftRow.content, suggestions: [], draftObservations: [] } as never)
    await suggestStudioSuggestions(DRAFT_ID)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('persists the exact text sent (§10.1 implicit save), even when zero suggestions render, guarded by the pre-call content_hash (MAJOR-1)', async () => {
    vi.mocked(runPrompt).mockResolvedValue({ revision: draftRow.content, suggestions: [], draftObservations: [] } as never)
    await suggestStudioSuggestions(DRAFT_ID)
    expect(persistSuggestions).toHaveBeenCalledWith(FAKE_CLIENT, DRAFT_ID, BUSINESS_ID, draftRow.content, [], draftRow.content_hash)
  })

  it('MAJOR-1: a superseded persist (concurrent save from another tab/device) is mapped to draft_superseded, not silently accepted as success', async () => {
    vi.mocked(runPrompt).mockResolvedValue({ revision: draftRow.content, suggestions: [], draftObservations: [] } as never)
    vi.mocked(persistSuggestions).mockResolvedValue({ outcome: 'superseded' } as never)
    const result = await suggestStudioSuggestions(DRAFT_ID)
    expect(result).toEqual({ success: false, error: 'draft_superseded' })
  })

  it('AiError.message is NEVER returned to the client — only .code', async () => {
    vi.mocked(runPrompt).mockRejectedValue(
      new AiError('invalid_response', 'Zod said: received "fabricated_rowid_123" — SENSITIVE INTERNAL DETAIL'),
    )
    const result = await suggestStudioSuggestions(DRAFT_ID)
    expect(result).toEqual({ success: false, error: 'invalid_response' })
    expect(JSON.stringify(result)).not.toContain('SENSITIVE')
    expect(JSON.stringify(result)).not.toContain('fabricated_rowid_123')
  })

  it('a call that produces zero suggestions is a normal success, not an error', async () => {
    vi.mocked(runPrompt).mockResolvedValue({ revision: draftRow.content, suggestions: [], draftObservations: [] } as never)
    const result = await suggestStudioSuggestions(DRAFT_ID)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.suggestions).toEqual([])
      expect(result.hunks).toEqual([{ kind: 'equal', value: draftRow.content, originalStart: 0, originalEnd: draftRow.content.length, revisedStart: 0, revisedEnd: draftRow.content.length }])
      expect(result.edits).toEqual({})
    }
  })

  it('ADR §11.1: a rendered suggestion gets a resolvable original-coordinate edit reconstructing the revised text', async () => {
    const open = buildOpenToken('aaaaaaaa', 's1')
    const close = buildCloseToken('aaaaaaaa', 's1')
    const revision = `Our onboarding is ${open}instant${close}.`
    vi.mocked(runPrompt).mockResolvedValue({
      revision,
      suggestions: [{ id: 's1', category: 'specificity', rationale: 'more concrete' }],
      draftObservations: [],
    } as never)

    const result = await suggestStudioSuggestions(DRAFT_ID)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.suggestions).toEqual([{ id: 's1', category: 'specificity', rationale: 'more concrete', attribution: 'model_judgment' }])
    const edit = result.edits['s1']
    expect(edit).toBeDefined()
    const reconstructed = draftRow.content.slice(0, edit.originalStart) + edit.replacement + draftRow.content.slice(edit.originalEnd)
    expect(reconstructed).toBe('Our onboarding is instant.')
  })
})

describe('createStudioDraftAction', () => {
  it('rejects invalid input before any auth/DB call', async () => {
    const result = await createStudioDraftAction('hello', 'not-a-platform' as never)
    expect(result).toEqual({ success: false, error: 'invalid_input' })
    expect(getBusinessForUser).not.toHaveBeenCalled()
  })

  it('creates a draft scoped to the caller\'s business and returns its id', async () => {
    vi.mocked(createStudioDraft).mockResolvedValue({ ...draftRow, id: 'new-draft-id', content: 'hello', platform: null } as never)
    const result = await createStudioDraftAction('hello', null)
    expect(result).toEqual({ success: true, draftId: 'new-draft-id' })
    expect(createStudioDraft).toHaveBeenCalledWith(FAKE_CLIENT, { business_id: BUSINESS_ID, content: 'hello', platform: null })
  })
})

describe('saveStudioDraftAction', () => {
  it('rejects invalid input (bad uuid) before any auth/DB call', async () => {
    const result = await saveStudioDraftAction('not-a-uuid', 'hello', null)
    expect(result).toEqual({ success: false, error: 'invalid_input' })
    expect(saveStudioDraft).not.toHaveBeenCalled()
  })

  it('saves content and platform, returning the fresh content_hash', async () => {
    vi.mocked(saveStudioDraft).mockResolvedValue({ ...draftRow, content: 'edited', content_hash: 'hash3' } as never)
    const result = await saveStudioDraftAction(DRAFT_ID, 'edited', 'linkedin')
    expect(result).toEqual({ success: true, contentHash: 'hash3' })
    expect(saveStudioDraft).toHaveBeenCalledWith(FAKE_CLIENT, DRAFT_ID, BUSINESS_ID, 'edited', 'linkedin')
  })
})

describe('acceptStudioSuggestion', () => {
  it('rejects invalid input before any DB call', async () => {
    const result = await acceptStudioSuggestion('not-a-uuid', 'x', 'h1', 'h2')
    expect(result).toEqual({ outcome: 'error', error: 'invalid_input' })
    expect(acceptSuggestion).not.toHaveBeenCalled()
  })

  it("returns the typed stale result from D2.2's guarded accept, unmodified", async () => {
    vi.mocked(acceptSuggestion).mockResolvedValue({ outcome: 'stale' } as never)
    const result = await acceptStudioSuggestion(DRAFT_ID, 'new content', 'h1', 'h2')
    expect(result).toEqual({ outcome: 'stale' })
  })

  it('returns the accepted content on success', async () => {
    vi.mocked(acceptSuggestion).mockResolvedValue({ outcome: 'accepted', draft: { ...draftRow, content: 'accepted content' } } as never)
    const result = await acceptStudioSuggestion(DRAFT_ID, 'accepted content', 'h1', 'h2')
    expect(result).toEqual({ outcome: 'accepted', content: 'accepted content' })
  })
})

// ADR 0022 §2 (Session 29, F1b.4) — PROMOTE-ACTION-VALIDATED's Zod-contract
// half. The core logic (promoteDraftToCampaignCore, lib/campaigns/promote.ts)
// is mocked here: this describe block exercises ONLY the thin wrapper's own
// job — Zod-validate draftId/scheduledAt, resolve auth, delegate, map errors.
describe('promoteDraftToCampaign', () => {
  const SCHEDULED_AT = '2026-09-01T09:00:00.000Z'

  it('rejects an invalid draftId (not a uuid) before any auth/DB call', async () => {
    const result = await promoteDraftToCampaign('not-a-uuid', SCHEDULED_AT)
    expect(result).toEqual({ outcome: 'error', error: 'invalid_input' })
    expect(getBusinessForUser).not.toHaveBeenCalled()
    expect(promoteDraftToCampaignCore).not.toHaveBeenCalled()
  })

  it('rejects an invalid scheduledAt (not a datetime string) before any auth/DB call', async () => {
    const result = await promoteDraftToCampaign(DRAFT_ID, 'not-a-date')
    expect(result).toEqual({ outcome: 'error', error: 'invalid_input' })
    expect(promoteDraftToCampaignCore).not.toHaveBeenCalled()
  })

  it('returns generic on no authenticated user, without calling the core', async () => {
    FAKE_CLIENT.auth = { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) }
    const result = await promoteDraftToCampaign(DRAFT_ID, SCHEDULED_AT)
    expect(result).toEqual({ outcome: 'error', error: 'generic' })
    expect(promoteDraftToCampaignCore).not.toHaveBeenCalled()
  })

  it('delegates to promoteDraftToCampaignCore with the authenticated business id and parsed input', async () => {
    vi.mocked(promoteDraftToCampaignCore).mockResolvedValue({
      outcome: 'promoted',
      campaignId: 'campaign-1',
      briefId: 'brief-1',
      postId: 'post-1',
    })

    const result = await promoteDraftToCampaign(DRAFT_ID, SCHEDULED_AT)

    expect(promoteDraftToCampaignCore).toHaveBeenCalledWith(FAKE_CLIENT, BUSINESS_ID, DRAFT_ID, SCHEDULED_AT)
    expect(result).toEqual({ outcome: 'promoted', campaignId: 'campaign-1', briefId: 'brief-1', postId: 'post-1' })
  })

  it('passes through already_promoted and claimed_by_another unmodified', async () => {
    const draft = { ...draftRow, promoted_campaign_id: 'campaign-existing' }
    vi.mocked(promoteDraftToCampaignCore).mockResolvedValue({ outcome: 'already_promoted', draft } as never)
    const result = await promoteDraftToCampaign(DRAFT_ID, SCHEDULED_AT)
    expect(result).toEqual({ outcome: 'already_promoted', draft })
  })

  it('maps content_too_long to the draft_too_long StudioActionErrorCode', async () => {
    vi.mocked(promoteDraftToCampaignCore).mockResolvedValue({ outcome: 'content_too_long' })
    const result = await promoteDraftToCampaign(DRAFT_ID, SCHEDULED_AT)
    expect(result).toEqual({ outcome: 'error', error: 'draft_too_long' })
  })

  it('maps a core-level error to the generic StudioActionErrorCode', async () => {
    vi.mocked(promoteDraftToCampaignCore).mockResolvedValue({ outcome: 'error' })
    const result = await promoteDraftToCampaign(DRAFT_ID, SCHEDULED_AT)
    expect(result).toEqual({ outcome: 'error', error: 'generic' })
  })
})
