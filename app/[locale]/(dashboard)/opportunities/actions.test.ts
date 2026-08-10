import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn(),
}))

vi.mock('@/lib/db/business-members', () => ({
  getMemberForUser: vi.fn(),
}))

vi.mock('@/lib/db/insight-cards', () => ({
  transitionCardStatus: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { approveCardAction, dismissCardAction, saveCardAction } from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { transitionCardStatus } from '@/lib/db/insight-cards'
import type { BusinessRow } from '@/lib/db/types'

const VALID_CARD_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const MOCK_USER = { id: 'user-123' }
const MOCK_BUSINESS: BusinessRow = {
  id: 'biz-456',
  name: 'Acme Corp',
  website: 'https://acme.com',
  owner_id: MOCK_USER.id,
} as BusinessRow

function mockAuthedAuthor() {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
  } as never)
  vi.mocked(getBusinessForUser).mockResolvedValue(MOCK_BUSINESS)
  // Owner path — resolveMemberContext gives approver+admin, which
  // satisfies AUTHOR||isAdmin regardless of member row.
}

describe('opportunities/actions.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a non-UUID cardId before any DB work (Zod-before-anything, L-13)', async () => {
    mockAuthedAuthor()
    const result = await approveCardAction('not-a-uuid')
    expect(result.error).toBe('invalid_input')
    expect(transitionCardStatus).not.toHaveBeenCalled()
  })

  it('approveCardAction transitions pending -> approved atomically', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'approved' })

    const result = await approveCardAction(VALID_CARD_ID)

    expect(transitionCardStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_BUSINESS.id,
      VALID_CARD_ID,
      'pending',
      { status: 'approved' },
    )
    expect(result).toEqual({ success: true, outcome: 'ok', currentStatus: 'approved' })
  })

  it('approveCardAction also accepts a saved card as the expected prior state (saved -> approved, §5.3)', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus)
      .mockResolvedValueOnce({ outcome: 'already_triaged', currentStatus: 'saved' })
    // First attempt against 'pending' misses (card is actually 'saved');
    // the action's fallback attempt against 'saved' succeeds.
    vi.mocked(transitionCardStatus)
      .mockResolvedValueOnce({ outcome: 'ok', currentStatus: 'approved' })

    const result = await approveCardAction(VALID_CARD_ID)
    expect(result.outcome).toBe('ok')
    expect(result.currentStatus).toBe('approved')
  })

  it('lost-the-race: returns the typed already_triaged outcome, never a generic error, when both expected-state attempts miss', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'already_triaged', currentStatus: 'dismissed' })

    const result = await approveCardAction(VALID_CARD_ID)

    expect(result.success).toBeUndefined()
    expect(result.outcome).toBe('already_triaged')
    expect(result.currentStatus).toBe('dismissed')
  })

  it('dismissCardAction accepts an optional reason and passes it through', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'dismissed' })

    const result = await dismissCardAction(VALID_CARD_ID, 'too_sensitive')

    expect(transitionCardStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_BUSINESS.id,
      VALID_CARD_ID,
      'pending',
      { status: 'dismissed', dismiss_reason: 'too_sensitive' },
    )
    expect(result).toEqual({ success: true, outcome: 'ok', currentStatus: 'dismissed' })
  })

  it('dismissCardAction rejects an out-of-enum reason', async () => {
    mockAuthedAuthor()
    const result = await dismissCardAction(VALID_CARD_ID, 'not_a_real_reason' as never)
    expect(result.error).toBe('invalid_input')
    expect(transitionCardStatus).not.toHaveBeenCalled()
  })

  it('saveCardAction clears expires_at (§5.5: saved sets expires_at = NULL, and that is the only thing saved does)', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'saved' })

    await saveCardAction(VALID_CARD_ID)

    expect(transitionCardStatus).toHaveBeenCalledWith(
      expect.anything(),
      MOCK_BUSINESS.id,
      VALID_CARD_ID,
      'pending',
      { status: 'saved', expires_at: null },
    )
  })

  it('capability gate: a member without AUTHOR and not an admin is rejected on approve', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
    } as never)
    vi.mocked(getBusinessForUser).mockResolvedValue({ ...MOCK_BUSINESS, owner_id: 'someone-else' })
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)

    const result = await approveCardAction(VALID_CARD_ID)
    expect(result.error).toBe('forbidden')
    expect(transitionCardStatus).not.toHaveBeenCalled()
  })

  it('capability gate: a member without AUTHOR and not an admin is rejected on dismiss', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
    } as never)
    vi.mocked(getBusinessForUser).mockResolvedValue({ ...MOCK_BUSINESS, owner_id: 'someone-else' })
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)

    const result = await dismissCardAction(VALID_CARD_ID)
    expect(result.error).toBe('forbidden')
    expect(transitionCardStatus).not.toHaveBeenCalled()
  })

  it('capability gate: a member without AUTHOR and not an admin is rejected on save', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
    } as never)
    vi.mocked(getBusinessForUser).mockResolvedValue({ ...MOCK_BUSINESS, owner_id: 'someone-else' })
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'viewer', is_admin: false } as never)

    const result = await saveCardAction(VALID_CARD_ID)
    expect(result.error).toBe('forbidden')
    expect(transitionCardStatus).not.toHaveBeenCalled()
  })

  it('capability gate: an editor role (AUTHOR-capable) is allowed', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER } }) },
    } as never)
    vi.mocked(getBusinessForUser).mockResolvedValue({ ...MOCK_BUSINESS, owner_id: 'someone-else' })
    vi.mocked(getMemberForUser).mockResolvedValue({ role: 'editor', is_admin: false } as never)
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'saved' })

    const result = await saveCardAction(VALID_CARD_ID)
    expect(result.success).toBe(true)
  })
})
