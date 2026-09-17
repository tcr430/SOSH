import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/db/business-members', () => ({ getMemberForUser: vi.fn() }))
vi.mock('@/lib/db/backfill-runs', () => ({
  getBackfillRunById: vi.fn(),
  ratifyBackfillRun: vi.fn(),
  discardBackfillRun: vi.fn(),
  resumeBackfillRun: vi.fn(),
  transitionBackfillVoiceStatus: vi.fn(),
}))
vi.mock('@/lib/db/social-accounts', () => ({ getSocialAccountById: vi.fn() }))
vi.mock('@/lib/db/brand-voices', () => ({ upsertBrandVoice: vi.fn() }))
vi.mock('@/lib/db/voice', () => ({
  addVariation: vi.fn(),
  VoiceVariationCapError: class VoiceVariationCapError extends Error {
    override name = 'VoiceVariationCapError'
  },
}))

import {
  ratifyBackfillRunAction,
  discardBackfillRunAction,
  retryBackfillRunAction,
  applyBackfillVoiceAction,
  declineBackfillVoiceAction,
} from './backfill-actions'
import { createClient } from '@/lib/supabase/server'
import { getMemberForUser } from '@/lib/db/business-members'
import {
  getBackfillRunById,
  ratifyBackfillRun,
  discardBackfillRun,
  resumeBackfillRun,
  transitionBackfillVoiceStatus,
} from '@/lib/db/backfill-runs'
import { getSocialAccountById } from '@/lib/db/social-accounts'
import { upsertBrandVoice } from '@/lib/db/brand-voices'
import { addVariation, VoiceVariationCapError } from '@/lib/db/voice'
import type { SocialBackfillRunRow, BusinessMemberRow, SocialAccountRow, VaultSecretId } from '@/lib/db/types'

const AXES = {
  formal_casual: 50, expert_peer: 38, serious_playful: 56,
  reserved_warm: 50, calm_energetic: 68, rational_emotional: 58,
  exclusive_inclusive: 50,
}

const baseRun: SocialBackfillRunRow = {
  id: '11111111-1111-4111-8111-111111111111',
  business_id: '22222222-2222-4222-8222-222222222222',
  social_account_id: '33333333-3333-4333-8333-333333333333',
  platform: 'twitter',
  // Session 32-D D8 (MAJOR-1) — apply/decline now require a RATIFIED run
  // with a declared role, so the default fixture is post-ratify. Tests
  // that need the pre-ratify state override status explicitly.
  status: 'ratified',
  partial: false,
  account_role: 'founder',
  weighting: null,
  posts_fetched: 10,
  posts_extracted: 10,
  platform_posts_read: 10,
  spend_cents: 5,
  ceiling_cents: 50,
  passes_done: 3,
  summary: {},
  // Field-name fix (found while implementing D8): the real writer
  // (runVoiceSynthesisPass) spreads BrandVoiceOutput's camelCase
  // `voiceAxes`, never a snake_case `voice_axes` key.
  staged_voice: { voiceAxes: AXES },
  voice_status: 'pending',
  voice_applied_to: null,
  voice_applied_at: null,
  error_code: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  started_at: '2026-09-01T00:00:00Z',
  completed_at: null,
  ratified_at: null,
}

const approverMember: BusinessMemberRow = {
  id: '44444444-4444-4444-8444-444444444444',
  business_id: '22222222-2222-4222-8222-222222222222',
  user_id: 'user-1',
  email: 'a@b.com',
  role: 'approver',
  is_admin: false,
  status: 'active',
  invited_by: null,
  invited_at: '2026-01-01T00:00:00Z',
  accepted_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const account: SocialAccountRow = {
  id: '33333333-3333-4333-8333-333333333333',
  business_id: '22222222-2222-4222-8222-222222222222',
  platform: 'twitter',
  platform_user_id: 'p1',
  platform_username: 'acmefounder',
  platform_display_name: 'Acme Founder',
  vault_access_token_id: 'vault-1' as VaultSecretId,
  vault_refresh_token_id: null,
  token_expires_at: null,
  is_active: true,
  connected_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  scopes_granted: null,
}

function mockAuthedClient(userId: string | null) {
  const client = { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) } }
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>)
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBackfillRunById).mockResolvedValue(baseRun)
  vi.mocked(getMemberForUser).mockResolvedValue(approverMember)
  vi.mocked(getSocialAccountById).mockResolvedValue(account)
})

describe('ratifyBackfillRunAction', () => {
  it('rejects a payload missing account_role', async () => {
    mockAuthedClient('user-1')
    const result = await ratifyBackfillRunAction({
      runId: baseRun.id,
      acceptedIds: [],
      rejectedIds: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('validation')
    expect(ratifyBackfillRun).not.toHaveBeenCalled()
  })

  it('rejects an accepted id array of 81 entries', async () => {
    mockAuthedClient('user-1')
    const ids = Array.from({ length: 81 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
    const result = await ratifyBackfillRunAction({
      runId: baseRun.id,
      acceptedIds: ids,
      rejectedIds: [],
      accountRole: 'brand',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('validation')
  })

  it('ignores a forged p_user_id and derives it from the session', async () => {
    mockAuthedClient('user-1')
    vi.mocked(ratifyBackfillRun).mockResolvedValue({ ...baseRun, status: 'ratified' })
    const payload = {
      runId: baseRun.id,
      acceptedIds: [],
      rejectedIds: [],
      accountRole: 'founder',
      p_user_id: 'attacker-id',
    }
    const result = await ratifyBackfillRunAction(payload)
    expect(result.ok).toBe(true)
    expect(ratifyBackfillRun).toHaveBeenCalledWith('user-1', baseRun.id, [], [], 'founder')
  })

  it('rejects when the caller is not an approver or admin', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getMemberForUser).mockResolvedValue({ ...approverMember, role: 'viewer', is_admin: false })
    const result = await ratifyBackfillRunAction({
      runId: baseRun.id, acceptedIds: [], rejectedIds: [], accountRole: 'founder',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('forbidden')
    expect(ratifyBackfillRun).not.toHaveBeenCalled()
  })
})

describe('discardBackfillRunAction / retryBackfillRunAction', () => {
  it('discards with the server-derived user id', async () => {
    mockAuthedClient('user-1')
    vi.mocked(discardBackfillRun).mockResolvedValue({ ...baseRun, status: 'discarded' })
    const result = await discardBackfillRunAction({ runId: baseRun.id })
    expect(result.ok).toBe(true)
    expect(discardBackfillRun).toHaveBeenCalledWith(baseRun.id, 'user-1')
  })

  it('retries on the same run id via resume_backfill_run, never inserting a new run', async () => {
    mockAuthedClient('user-1')
    vi.mocked(resumeBackfillRun).mockResolvedValue({ ...baseRun, status: 'queued' })
    const result = await retryBackfillRunAction({ runId: baseRun.id })
    expect(result.ok).toBe(true)
    expect(resumeBackfillRun).toHaveBeenCalledWith(baseRun.id)
    expect(resumeBackfillRun).toHaveBeenCalledTimes(1)
  })

  // MINOR-4 (Session 32-D, D3) — discard/retry now require approver/admin,
  // matching ratify's own gate, not any active member.
  it('discard rejects when the caller is not an approver or admin', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getMemberForUser).mockResolvedValue({ ...approverMember, role: 'viewer', is_admin: false })
    const result = await discardBackfillRunAction({ runId: baseRun.id })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('forbidden')
    expect(discardBackfillRun).not.toHaveBeenCalled()
  })

  it('retry rejects when the caller is not an approver or admin', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getMemberForUser).mockResolvedValue({ ...approverMember, role: 'viewer', is_admin: false })
    const result = await retryBackfillRunAction({ runId: baseRun.id })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('forbidden')
    expect(resumeBackfillRun).not.toHaveBeenCalled()
  })
})

describe('applyBackfillVoiceAction', () => {
  it('brand apply rejects 6 offered examples at the Zod boundary (cap is 3)', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, account_role: 'brand' })
    const result = await applyBackfillVoiceAction({
      runId: baseRun.id,
      tone: ['direct'],
      keywords: ['saas'],
      avoidWords: [],
      writingExamples: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('validation')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
  })

  // MAJOR-1 (Session 32-D, D8) — a client-supplied accountRole is REJECTED
  // at the Zod boundary (the schema is .strict()), not silently stripped.
  it('a client-supplied accountRole is rejected at the Zod boundary', async () => {
    mockAuthedClient('user-1')
    const result = await applyBackfillVoiceAction({
      runId: baseRun.id,
      accountRole: 'brand',
      tone: [], keywords: [], avoidWords: [], writingExamples: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('validation')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
    expect(addVariation).not.toHaveBeenCalled()
  })

  // MAJOR-1 — apply refuses on a run that hasn't been ratified yet, even
  // with a perfectly valid payload; no voice writer is ever called.
  it('apply on an awaiting_ratification run is refused — no voice writer called', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, status: 'awaiting_ratification' })
    const result = await applyBackfillVoiceAction({ runId: baseRun.id, tone: [], keywords: [], avoidWords: [], writingExamples: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no_op')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
    expect(addVariation).not.toHaveBeenCalled()
    expect(transitionBackfillVoiceStatus).not.toHaveBeenCalled()
  })

  // MAJOR-1 — a ratified run with no account_role recorded (shouldn't
  // happen given ratify always requires one, but the action must not
  // trust that) also refuses.
  it('apply on a ratified run with a null account_role is refused', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, status: 'ratified', account_role: null })
    const result = await applyBackfillVoiceAction({ runId: baseRun.id, tone: [], keywords: [], avoidWords: [], writingExamples: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no_op')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
    expect(addVariation).not.toHaveBeenCalled()
  })

  it('brand apply writes brand_voices once with exactly 3 examples', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, account_role: 'brand' })
    vi.mocked(transitionBackfillVoiceStatus).mockResolvedValue({ ...baseRun, account_role: 'brand', voice_status: 'applied' })
    const result = await applyBackfillVoiceAction({
      runId: baseRun.id,
      tone: ['direct'],
      keywords: ['saas'],
      avoidWords: [],
      writingExamples: ['a', 'b', 'c'],
    })
    expect(result.ok).toBe(true)
    expect(upsertBrandVoice).toHaveBeenCalledTimes(1)
    expect(upsertBrandVoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ writing_examples: ['a', 'b', 'c'] }),
    )
    expect(transitionBackfillVoiceStatus).toHaveBeenCalledWith(
      baseRun.id, ['pending', 'refused_cap', 'failed'], 'applied', 'brand_voices',
    )
  })

  // MAJOR-1 — a ratified FOUNDER run never calls upsertBrandVoice, even if
  // the (now-ignored) client payload shape looks brand-like.
  it('a ratified founder run never calls upsertBrandVoice', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, account_role: 'founder' })
    vi.mocked(addVariation).mockResolvedValue({
      id: 'var-1', business_id: '22222222-2222-4222-8222-222222222222', name: 'Acme Founder', voice_axes: AXES,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    })
    vi.mocked(transitionBackfillVoiceStatus).mockResolvedValue({ ...baseRun, voice_status: 'applied' })
    const result = await applyBackfillVoiceAction({ runId: baseRun.id, tone: [], keywords: [], avoidWords: [], writingExamples: [] })
    expect(result.ok).toBe(true)
    expect(upsertBrandVoice).not.toHaveBeenCalled()
    expect(addVariation).toHaveBeenCalledTimes(1)
  })

  it('founder apply creates one variation with axes only — no tone/keywords/examples written', async () => {
    mockAuthedClient('user-1')
    vi.mocked(addVariation).mockResolvedValue({
      id: 'var-1', business_id: '22222222-2222-4222-8222-222222222222', name: 'Acme Founder', voice_axes: AXES,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    })
    vi.mocked(transitionBackfillVoiceStatus).mockResolvedValue({ ...baseRun, voice_status: 'applied' })
    const result = await applyBackfillVoiceAction({ runId: baseRun.id, tone: [], keywords: [], avoidWords: [], writingExamples: [] })
    expect(result.ok).toBe(true)
    expect(addVariation).toHaveBeenCalledWith({
      businessId: '22222222-2222-4222-8222-222222222222', name: 'Acme Founder', voiceAxes: AXES,
    })
    const call = vi.mocked(addVariation).mock.calls[0][0]
    expect(call).not.toHaveProperty('tone')
    expect(call).not.toHaveProperty('keywords')
    expect(call).not.toHaveProperty('writingExamples')
    expect(upsertBrandVoice).not.toHaveBeenCalled()
  })

  it('at cap, refuses and keeps staged_voice; after a slot frees, retry applies and nulls it', async () => {
    mockAuthedClient('user-1')
    vi.mocked(addVariation).mockRejectedValueOnce(new VoiceVariationCapError())
    vi.mocked(transitionBackfillVoiceStatus).mockResolvedValueOnce({ ...baseRun, voice_status: 'refused_cap' })
    const refused = await applyBackfillVoiceAction({ runId: baseRun.id, tone: [], keywords: [], avoidWords: [], writingExamples: [] })
    expect(refused.ok).toBe(true)
    expect(transitionBackfillVoiceStatus).toHaveBeenCalledWith(baseRun.id, ['pending'], 'refused_cap')

    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, voice_status: 'refused_cap' })
    vi.mocked(addVariation).mockResolvedValueOnce({
      id: 'var-2', business_id: '22222222-2222-4222-8222-222222222222', name: 'Acme Founder', voice_axes: AXES,
      created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    })
    vi.mocked(transitionBackfillVoiceStatus).mockResolvedValueOnce({ ...baseRun, voice_status: 'applied', staged_voice: null })
    const retried = await applyBackfillVoiceAction({ runId: baseRun.id, tone: [], keywords: [], avoidWords: [], writingExamples: [] })
    expect(retried.ok).toBe(true)
    expect(transitionBackfillVoiceStatus).toHaveBeenCalledWith(
      baseRun.id, ['pending', 'refused_cap', 'failed'], 'applied', 'var-2',
    )
  })

  it('a thrown upsert marks voice_status failed and keeps staged_voice', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, account_role: 'brand' })
    vi.mocked(upsertBrandVoice).mockRejectedValue(new Error('db error'))
    vi.mocked(transitionBackfillVoiceStatus).mockResolvedValue({ ...baseRun, account_role: 'brand', voice_status: 'failed' })
    const result = await applyBackfillVoiceAction({
      runId: baseRun.id, tone: [], keywords: [], avoidWords: [], writingExamples: [],
    })
    expect(result.ok).toBe(true)
    expect(transitionBackfillVoiceStatus).toHaveBeenCalledWith(baseRun.id, ['pending'], 'failed')
  })
})

describe('declineBackfillVoiceAction', () => {
  it('declines and nulls staged_voice via the conditional transition', async () => {
    mockAuthedClient('user-1')
    vi.mocked(transitionBackfillVoiceStatus).mockResolvedValue({ ...baseRun, voice_status: 'declined', staged_voice: null })
    const result = await declineBackfillVoiceAction({ runId: baseRun.id })
    expect(result.ok).toBe(true)
    expect(transitionBackfillVoiceStatus).toHaveBeenCalledWith(
      baseRun.id, ['pending', 'refused_cap', 'failed'], 'declined',
    )
  })

  // MAJOR-1 (Session 32-D, D8) — same ratified/role-declared gate as apply.
  it('decline on an awaiting_ratification run is refused', async () => {
    mockAuthedClient('user-1')
    vi.mocked(getBackfillRunById).mockResolvedValue({ ...baseRun, status: 'awaiting_ratification' })
    const result = await declineBackfillVoiceAction({ runId: baseRun.id })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no_op')
    expect(transitionBackfillVoiceStatus).not.toHaveBeenCalled()
  })
})
