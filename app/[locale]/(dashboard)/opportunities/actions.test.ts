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

vi.mock('@/lib/signals/seed', () => ({
  seedCampaignFromCard: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ADR 0030 §6.5 (L2.9) — the dismissal writer's one TS entry point. Mocked here: the writer itself is proven in lib/memory/dismissal.test.ts and Tier 1.
// DISMISSAL_OUTCOME_CLASS is the REAL map (Session 36-D D5): the actions classify an outcome with it, so a stub would hide a wrong class.
vi.mock('@/lib/memory', async () => {
  const { DISMISSAL_OUTCOME_CLASS } = await import('@/lib/memory/dismissal')
  return { recomputeDismissalSignal: vi.fn(), DISMISSAL_OUTCOME_CLASS }
})

import { approveCardAction, dismissCardAction, saveCardAction } from './actions'
import { recomputeDismissalSignal } from '@/lib/memory'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getMemberForUser } from '@/lib/db/business-members'
import { transitionCardStatus } from '@/lib/db/insight-cards'
import { seedCampaignFromCard } from '@/lib/signals/seed'
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
    vi.mocked(seedCampaignFromCard).mockResolvedValue({ campaignId: 'campaign-1', briefId: 'brief-1' })

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

  // D7 (MINOR-7) — the same path that flips status to 'approved' also
  // seeds the campaign + brief and writes campaign_id back.
  it('approveCardAction calls seedCampaignFromCard with the cardId ONLY on a successful transition', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'approved' })
    vi.mocked(seedCampaignFromCard).mockResolvedValue({ campaignId: 'campaign-1', briefId: 'brief-1' })

    await approveCardAction(VALID_CARD_ID)

    expect(seedCampaignFromCard).toHaveBeenCalledWith(VALID_CARD_ID)
    expect(seedCampaignFromCard).toHaveBeenCalledTimes(1)
  })

  it('approveCardAction does NOT call seedCampaignFromCard when the transition loses the race (already_triaged)', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'already_triaged', currentStatus: 'dismissed' })

    await approveCardAction(VALID_CARD_ID)

    expect(seedCampaignFromCard).not.toHaveBeenCalled()
  })

  it('approveCardAction still reports success when seedCampaignFromCard throws — a seeding failure must not mask a real approval as a generic error', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'approved' })
    vi.mocked(seedCampaignFromCard).mockRejectedValue(new Error('AI call failed'))

    const result = await approveCardAction(VALID_CARD_ID)

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

// ─── ADR 0030 §6.5 (Session 36 L2.9) — the three dismissal-signal triggers ────────────────────────────────
// SUBSTRATE-DISMISS-MAPPING (17): the five reasons and NULL -> exactly ONE recompute call, and only on not_relevant.
describe('opportunities/actions.ts — recomputeDismissalSignal triggers (ADR 0030 §6.5)', () => {
  const RECOMPUTE_FAILED = 'opportunities/actions: recomputeDismissalSignal failed'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(recomputeDismissalSignal).mockResolvedValue('upserted')
    vi.mocked(seedCampaignFromCard).mockResolvedValue({ campaignId: 'campaign-1', briefId: 'brief-1' })
  })

  it.each([
    ['not_relevant', 1],
    ['already_covered', 0],
    ['too_sensitive', 0],
    ['wrong_timing', 0],
    ['weak_evidence', 0],
    [undefined, 0],
  ] as const)('dismiss with reason %s -> %i recompute call(s), and the call carries the cardId ONLY', async (reason, calls) => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'dismissed' })

    const result = await dismissCardAction(VALID_CARD_ID, reason)

    expect(result).toEqual({ success: true, outcome: 'ok', currentStatus: 'dismissed' })
    expect(recomputeDismissalSignal).toHaveBeenCalledTimes(calls)
    if (calls) expect(vi.mocked(recomputeDismissalSignal).mock.calls[0]).toEqual([VALID_CARD_ID])
  })

  it('dismiss recomputes only AFTER the transition succeeded (call order)', async () => {
    mockAuthedAuthor()
    const order: string[] = []
    vi.mocked(transitionCardStatus).mockImplementation(async () => {
      order.push('transition')
      return { outcome: 'ok', currentStatus: 'dismissed' }
    })
    vi.mocked(recomputeDismissalSignal).mockImplementation(async () => {
      order.push('recompute')
      return 'upserted'
    })

    await dismissCardAction(VALID_CARD_ID, 'not_relevant')

    expect(order).toEqual(['transition', 'recompute'])
  })

  it('approve recomputes after EVERY success, including the saved -> approved fallback edge', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus)
      .mockResolvedValueOnce({ outcome: 'already_triaged', currentStatus: 'saved' })
      .mockResolvedValueOnce({ outcome: 'ok', currentStatus: 'approved' })

    const result = await approveCardAction(VALID_CARD_ID)

    expect(result.outcome).toBe('ok')
    expect(recomputeDismissalSignal).toHaveBeenCalledTimes(1)
    expect(recomputeDismissalSignal).toHaveBeenCalledWith(VALID_CARD_ID)
  })

  it('approve STILL recomputes when seedCampaignFromCard THROWS (independent of the seeding try/catch)', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'approved' })
    vi.mocked(seedCampaignFromCard).mockRejectedValue(new Error('AI call failed'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await approveCardAction(VALID_CARD_ID)

    expect(result).toEqual({ success: true, outcome: 'ok', currentStatus: 'approved' })
    expect(recomputeDismissalSignal).toHaveBeenCalledTimes(1)
    // the seeding failure is logged by its own catch; the recompute succeeded, so it adds no second line
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('save recomputes after every success', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'saved' })

    const result = await saveCardAction(VALID_CARD_ID)

    expect(result).toEqual({ success: true, outcome: 'ok', currentStatus: 'saved' })
    expect(recomputeDismissalSignal).toHaveBeenCalledTimes(1)
    expect(recomputeDismissalSignal).toHaveBeenCalledWith(VALID_CARD_ID)
  })

  it.each([
    ['approve', () => approveCardAction(VALID_CARD_ID)],
    ['dismiss (not_relevant)', () => dismissCardAction(VALID_CARD_ID, 'not_relevant')],
    ['save', () => saveCardAction(VALID_CARD_ID)],
  ] as const)('%s: an already_triaged outcome NEVER calls the recompute', async (_name, run) => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'already_triaged', currentStatus: 'dismissed' })

    const result = await run()

    expect(result.outcome).toBe('already_triaged')
    expect(recomputeDismissalSignal).not.toHaveBeenCalled()
  })

  it.each([
    ['approve', () => approveCardAction(VALID_CARD_ID)],
    ['dismiss (not_relevant)', () => dismissCardAction(VALID_CARD_ID, 'not_relevant')],
    ['save', () => saveCardAction(VALID_CARD_ID)],
  ] as const)('%s: a transition FAILURE (the store throws) never calls the recompute', async (_name, run) => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockRejectedValue(new Error('db down'))

    const result = await run()

    expect(result).toEqual({ error: 'generic' })
    expect(recomputeDismissalSignal).not.toHaveBeenCalled()
  })

  // §7.3 row 1 (Tier 2 half): the transition is business-scoped, so a card of A dismissed while B is active fails BEFORE the recompute.
  it("dismissing A's card while B is the active business: the transition fails and the recompute is never called", async () => {
    mockAuthedAuthor() // the active business is MOCK_BUSINESS ('biz-456') — the card belongs to another business
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'already_triaged', currentStatus: 'pending' })

    const result = await dismissCardAction(VALID_CARD_ID, 'not_relevant')

    expect(transitionCardStatus).toHaveBeenCalledWith(expect.anything(), MOCK_BUSINESS.id, VALID_CARD_ID, 'pending', expect.anything())
    expect(result.success).toBeUndefined()
    expect(recomputeDismissalSignal).not.toHaveBeenCalled()
  })

  it.each([
    ['approve', () => approveCardAction(VALID_CARD_ID), { success: true, outcome: 'ok', currentStatus: 'approved' }],
    ['dismiss (not_relevant)', () => dismissCardAction(VALID_CARD_ID, 'not_relevant'), { success: true, outcome: 'ok', currentStatus: 'dismissed' }],
    ['save', () => saveCardAction(VALID_CARD_ID), { success: true, outcome: 'ok', currentStatus: 'saved' }],
  ] as const)('%s: a recompute FAILURE returns the success result plus EXACTLY ONE console.error', async (_name, run, expected) => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: expected.currentStatus })
    const boom = new Error('rpc failed')
    vi.mocked(recomputeDismissalSignal).mockRejectedValue(boom)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await run()

    expect(result).toEqual(expected)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(RECOMPUTE_FAILED, VALID_CARD_ID, boom)
    spy.mockRestore()
  })

  it('a recompute failure on approve does not depend on the seeding: seed failing AND recompute failing logs two distinct lines and still succeeds', async () => {
    mockAuthedAuthor()
    vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus: 'approved' })
    vi.mocked(seedCampaignFromCard).mockRejectedValue(new Error('seed failed'))
    vi.mocked(recomputeDismissalSignal).mockRejectedValue(new Error('rpc failed'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await approveCardAction(VALID_CARD_ID)

    expect(result).toEqual({ success: true, outcome: 'ok', currentStatus: 'approved' })
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      'opportunities/actions: seedCampaignFromCard failed after approval',
      RECOMPUTE_FAILED,
    ])
    spy.mockRestore()
  })

  // Session 36-D D5 (MINOR-6): an ANOMALOUS outcome is logged exactly once per caller, with the action name, the card id and the outcome; a DECIDED one never.
  const ANOMALOUS_LINE = 'opportunities/actions: recomputeDismissalSignal anomalous outcome'
  const CALLERS = [
    ['approveCardAction', () => approveCardAction(VALID_CARD_ID), 'approved'],
    ['dismissCardAction', () => dismissCardAction(VALID_CARD_ID, 'not_relevant'), 'dismissed'],
    ['saveCardAction', () => saveCardAction(VALID_CARD_ID), 'saved'],
  ] as const

  describe.each(CALLERS)('%s', (action, run, currentStatus) => {
    it.each(['anomaly_watched_source_foreign', 'retired_anomaly_watched_source_foreign', 'anomaly_watched_id_null', 'noop_card_not_found'] as const)(
      'an anomalous outcome (%s) logs EXACTLY ONE console.error line and the success result is unchanged',
      async (outcome) => {
        mockAuthedAuthor()
        vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus })
        vi.mocked(recomputeDismissalSignal).mockResolvedValue(outcome)
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await run()

        expect(result).toEqual({ success: true, outcome: 'ok', currentStatus })
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy).toHaveBeenCalledWith(ANOMALOUS_LINE, action, VALID_CARD_ID, outcome)
        spy.mockRestore()
      },
    )

    it.each(['upserted', 'updated', 'retired', 'noop_no_row', 'noop_card_state', 'invalid_identifier', 'watched_source_gone', 'noop_unknown_kind'] as const)(
      'a decided outcome (%s) logs NOTHING',
      async (outcome) => {
        mockAuthedAuthor()
        vi.mocked(transitionCardStatus).mockResolvedValue({ outcome: 'ok', currentStatus })
        vi.mocked(recomputeDismissalSignal).mockResolvedValue(outcome)
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await run()

        expect(result).toEqual({ success: true, outcome: 'ok', currentStatus })
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
      },
    )
  })

  it('an invalid or forbidden call never reaches the recompute', async () => {
    mockAuthedAuthor()
    await dismissCardAction('not-a-uuid', 'not_relevant')
    await dismissCardAction(VALID_CARD_ID, 'nope' as never)
    expect(recomputeDismissalSignal).not.toHaveBeenCalled()
  })
})
