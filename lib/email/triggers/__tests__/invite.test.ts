import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: {
    server: { APP_URL: 'https://app.sosh.io' },
    public: { APP_URL: 'https://app.sosh.io' },
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/lib/db/email-suppressions', () => ({
  isEmailSuppressed: vi.fn().mockResolvedValue(false),
}))

const mockInsertEmailOutboxRow = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/email-outbox', () => ({
  insertEmailOutboxRow: mockInsertEmailOutboxRow,
}))

const mockSignInviteToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/members/invite-token', () => ({
  signInviteToken: mockSignInviteToken,
}))

import { enqueueTeamInvite } from '../invite'
import { isEmailSuppressed } from '@/lib/db/email-suppressions'

const OUTBOX_ROW = {
  id: 'row-uuid-1',
  business_id: 'biz-1',
  kind: 'team-invite',
  recipient: 'invitee@example.com',
  locale: 'en',
  props: {},
  status: 'pending',
  dedupe_token: 'invite:member-1:1720000000000',
  created_at: '2026-07-09T00:00:00.000Z',
  updated_at: '2026-07-09T00:00:00.000Z',
  attempts: 0,
  next_attempt_at: null,
  last_error: null,
  provider_message_id: null,
  sent_at: null,
}

const INPUT = {
  memberId: 'member-1',
  businessId: 'biz-1',
  recipientEmail: 'invitee@example.com',
  locale: 'en' as const,
  inviterName: 'Jamie',
  businessName: 'Acme Corp',
  roleLabelKey: 'team_invite.role.viewer',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isEmailSuppressed).mockResolvedValue(false)
  mockInsertEmailOutboxRow.mockResolvedValue({ inserted: true, row: OUTBOX_ROW as never })
  mockSignInviteToken.mockResolvedValue('signed.jwt.token')
})

describe('enqueueTeamInvite', () => {
  it('signs the invite token with memberId + businessId', async () => {
    await enqueueTeamInvite(INPUT)
    expect(mockSignInviteToken).toHaveBeenCalledWith({
      memberId: 'member-1',
      businessId: 'biz-1',
    })
  })

  it('builds acceptUrl as APP_URL/locale/invite/accept?token=<signed token>', async () => {
    await enqueueTeamInvite(INPUT)
    expect(mockInsertEmailOutboxRow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        props: expect.objectContaining({
          acceptUrl: 'https://app.sosh.io/en/invite/accept?token=signed.jwt.token',
        }),
      }),
    )
  })

  it('passes inviterName, businessName, and roleLabelKey through as props', async () => {
    await enqueueTeamInvite(INPUT)
    expect(mockInsertEmailOutboxRow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        props: expect.objectContaining({
          inviterName: 'Jamie',
          businessName: 'Acme Corp',
          roleLabelKey: 'team_invite.role.viewer',
        }),
      }),
    )
  })

  it('dedupe_token is distinct per re-issue: invite:<memberId>:<issuedAtEpoch>', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)

    await enqueueTeamInvite(INPUT)
    expect(mockInsertEmailOutboxRow).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ dedupe_token: 'invite:member-1:1000' }),
    )

    vi.setSystemTime(2000)
    await enqueueTeamInvite(INPUT)
    expect(mockInsertEmailOutboxRow).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ dedupe_token: 'invite:member-1:2000' }),
    )

    vi.useRealTimers()
  })

  it('INV-NO-TOKEN-IN-LOGS: the enqueue log line contains only {kind, email_kind, business_id, locale, outcome} — no token, acceptUrl, or recipient', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await enqueueTeamInvite(INPUT)

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(String(consoleSpy.mock.calls[0][0]))
    expect(Object.keys(logged).sort()).toEqual(
      ['business_id', 'email_kind', 'kind', 'locale', 'outcome'].sort(),
    )
    expect(logged).toEqual({
      kind: 'email.enqueue',
      email_kind: 'team-invite',
      business_id: 'biz-1',
      locale: 'en',
      outcome: 'enqueued',
    })

    const raw = JSON.stringify(logged)
    expect(raw).not.toContain('signed.jwt.token')
    expect(raw).not.toContain('invitee@example.com')
    expect(raw).not.toContain('accept?token=')
  })
})
