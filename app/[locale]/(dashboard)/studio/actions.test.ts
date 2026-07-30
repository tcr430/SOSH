import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: vi.fn() }))
vi.mock('@/lib/db/studio-drafts', () => ({
  getStudioDraft: vi.fn(),
  persistSuggestions: vi.fn(),
  acceptSuggestion: vi.fn(),
}))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn() }))
vi.mock('@/lib/ai/runner', () => ({ runPrompt: vi.fn() }))
vi.mock('@/lib/memory', () => ({
  retrieveStudioPerformancePatterns: vi.fn(),
  retrieveEvidenceMemory: vi.fn(),
}))
vi.mock('@/lib/ai/wrap-evidence', () => ({ wrapEvidenceForPrompt: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

import { suggestStudioSuggestions, acceptStudioSuggestion } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getStudioDraft, persistSuggestions, acceptSuggestion } from '@/lib/db/studio-drafts'
import { buildCustomerContext } from '@/lib/ai/context'
import { runPrompt } from '@/lib/ai/runner'
import { retrieveStudioPerformancePatterns, retrieveEvidenceMemory } from '@/lib/memory'
import { wrapEvidenceForPrompt } from '@/lib/ai/wrap-evidence'
import { AiError } from '@/lib/ai/errors'

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
  vi.mocked(persistSuggestions).mockResolvedValue({ ...draftRow, content_hash: 'hash2', suggestions_for_hash: 'sighash1' } as never)
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

  it('calls runPrompt EXACTLY ONCE per action call (L-8 Tier-1 ceiling, STUDIO-ONE-CALL-PER-CLICK)', async () => {
    vi.mocked(runPrompt).mockResolvedValue({ revision: draftRow.content, suggestions: [], draftObservations: [] } as never)
    await suggestStudioSuggestions(DRAFT_ID)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })

  it('persists the exact text sent (§10.1 implicit save), even when zero suggestions render', async () => {
    vi.mocked(runPrompt).mockResolvedValue({ revision: draftRow.content, suggestions: [], draftObservations: [] } as never)
    await suggestStudioSuggestions(DRAFT_ID)
    expect(persistSuggestions).toHaveBeenCalledWith(FAKE_CLIENT, DRAFT_ID, BUSINESS_ID, draftRow.content, [])
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
    if (result.success) expect(result.suggestions).toEqual([])
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
