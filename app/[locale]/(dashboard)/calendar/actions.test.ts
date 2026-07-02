import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── All mocks must be declared before any imports ─────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessByOwner: vi.fn(),
}))

vi.mock('@/lib/db/posts', () => ({
  getPostById: vi.fn(),
  approvePost: vi.fn(),
  unapprovePost: vi.fn(),
  updatePostContent: vi.fn(),
  reschedulePost: vi.fn(),
  reschedulePostsBatch: vi.fn(),
  listPostsForCalendar: vi.fn(),
}))

vi.mock('@/lib/calendar/reschedule', () => ({
  computeRescheduledInstant: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  reschedulePostAction,
  rescheduleDayGroupAction,
  updatePostFromCalendarAction,
  approvePostFromCalendarAction,
} from './actions'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import {
  getPostById,
  approvePost,
  unapprovePost,
  updatePostContent,
  reschedulePost,
  reschedulePostsBatch,
  listPostsForCalendar,
} from '@/lib/db/posts'
import { computeRescheduledInstant } from '@/lib/calendar/reschedule'
import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import type { BusinessRow, PostRow } from '@/lib/db/types'
import type { CalendarPostRow } from '@/lib/db/posts'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BIZ_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const POST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CAMPAIGN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const POST_2_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const MOCK_BUSINESS: BusinessRow = {
  id: BIZ_ID,
  name: 'Test Corp',
  website: null,
  industry: null,
  description: null,
  logo_url: null,
  owner_id: USER_ID,
  plan: 'plus',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  language: 'en',
  timezone: 'UTC',
  onboarding_completed: true,
  total_posts_published: 0,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const MOCK_POST: PostRow = {
  id: POST_ID,
  campaign_id: CAMPAIGN_ID,
  business_id: BIZ_ID,
  platform: 'linkedin',
  content: 'Original content',
  hashtags: ['#sosh'],
  media_urls: [],
  scheduled_at: '2026-06-20T10:00:00.000Z',
  published_at: null,
  platform_post_id: null,
  platform_url: null,
  status: 'draft',
  rejection_note: null,
  ai_generation_metadata: {},
  publish_attempts: 0,
  last_publish_attempt_at: null,
  last_publish_error: null,
  deleted_at: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

function makeCalendarRow(overrides: Partial<CalendarPostRow> = {}): CalendarPostRow {
  return {
    id: POST_ID,
    campaign_id: CAMPAIGN_ID,
    campaign_name: 'Test Campaign',
    platform: 'linkedin',
    status: 'draft',
    content: 'Content',
    hashtags: ['#test'],
    scheduled_at: '2026-06-20T10:00:00.000Z',
    published_at: null,
    platform_post_id: null,
    metrics: null,
    ...overrides,
  }
}

function setupAuth(businessOverrides: Partial<BusinessRow> = {}) {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
    },
  }
  vi.mocked(createClient).mockResolvedValue(client as never)
  vi.mocked(getBusinessByOwner).mockResolvedValue({ ...MOCK_BUSINESS, ...businessOverrides })
  return client
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleLogSpy.mockRestore()
})

function loggedKinds(): unknown[] {
  return consoleLogSpy.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string))
}

// ── reschedulePostAction ──────────────────────────────────────────────────────

describe('reschedulePostAction', () => {
  describe('Zod validation', () => {
    it('rejects malformed postId', async () => {
      const result = await reschedulePostAction('not-a-uuid', '2026-06-20')
      expect(result).toEqual({ ok: false, reason: 'invalid_input' })
      expect(createClient).not.toHaveBeenCalled()
    })

    it('rejects malformed targetDayKey', async () => {
      const result = await reschedulePostAction(POST_ID, '20/06/2026')
      expect(result).toEqual({ ok: false, reason: 'invalid_input' })
      expect(createClient).not.toHaveBeenCalled()
    })
  })

  describe('too_soon guard in off-UTC timezone (R6)', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('rejects targetDayKey that is today in business timezone (off-UTC)', async () => {
      // 2026-06-10 01:00 UTC = 2026-06-09 21:00 EDT → today in NYC is June 9
      vi.setSystemTime(new Date('2026-06-10T01:00:00.000Z'))
      setupAuth({ timezone: 'America/New_York' })

      const result = await reschedulePostAction(POST_ID, '2026-06-09')
      expect(result).toEqual({ ok: false, reason: 'too_soon' })
    })

    it('rejects targetDayKey that is yesterday in business timezone', async () => {
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      setupAuth({ timezone: 'America/New_York' })

      const result = await reschedulePostAction(POST_ID, '2026-06-09')
      expect(result).toEqual({ ok: false, reason: 'too_soon' })
    })

    it('allows targetDayKey that is tomorrow in off-UTC business timezone', async () => {
      // 01:00 UTC = 21:00 EDT on June 9 → tomorrow in NYC is June 10
      vi.setSystemTime(new Date('2026-06-10T01:00:00.000Z'))
      setupAuth({ timezone: 'America/New_York' })
      vi.mocked(getPostById).mockResolvedValue(MOCK_POST)
      vi.mocked(computeRescheduledInstant).mockReturnValue('2026-06-10T14:00:00.000Z')
      vi.mocked(reschedulePost).mockResolvedValue({ updated: true })

      // June 10 is tomorrow in NYC even though it is already today in UTC — must allow
      const result = await reschedulePostAction(POST_ID, '2026-06-10')
      expect(result).toEqual({ ok: true })
    })
  })

  describe('IDOR guard: businessId always server-derived', () => {
    it('passes the session-derived businessId to reschedulePost, not a client arg', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      setupAuth({ id: BIZ_ID, timezone: 'UTC' })
      vi.mocked(getPostById).mockResolvedValue(MOCK_POST)
      vi.mocked(computeRescheduledInstant).mockReturnValue('2026-06-11T10:00:00.000Z')
      vi.mocked(reschedulePost).mockResolvedValue({ updated: true })

      await reschedulePostAction(POST_ID, '2026-06-11')

      expect(reschedulePost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ businessId: BIZ_ID }),
      )
      vi.useRealTimers()
    })

    it('returns generic when getPostById throws (RLS blocks cross-business access)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      vi.mocked(getPostById).mockRejectedValue(new Error('Post not found'))

      const result = await reschedulePostAction(POST_ID, '2026-06-11')
      expect(result).toEqual({ ok: false, reason: 'generic' })
      expect(reschedulePost).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe('claimed: reschedulePost returns {updated:false}', () => {
    it('returns reason=claimed without throwing (CAL-5)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      vi.mocked(getPostById).mockResolvedValue(MOCK_POST)
      vi.mocked(computeRescheduledInstant).mockReturnValue('2026-06-11T10:00:00.000Z')
      vi.mocked(reschedulePost).mockResolvedValue({ updated: false })

      const result = await reschedulePostAction(POST_ID, '2026-06-11')
      expect(result).toEqual({ ok: false, reason: 'claimed' })
      expect(revalidatePath).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  it('revalidates calendar path on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
    setupAuth({ timezone: 'UTC' })
    vi.mocked(getPostById).mockResolvedValue(MOCK_POST)
    vi.mocked(computeRescheduledInstant).mockReturnValue('2026-06-11T10:00:00.000Z')
    vi.mocked(reschedulePost).mockResolvedValue({ updated: true })

    await reschedulePostAction(POST_ID, '2026-06-11')
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/calendar', 'page')
    vi.useRealTimers()
  })

  // MINOR-1 (§10 observability): id-only JSON log lines, no content/PII.
  describe('observability (MINOR-1)', () => {
    it('emits reschedule_post with ids only on success', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      setupAuth({ id: BIZ_ID, timezone: 'UTC' })
      vi.mocked(getPostById).mockResolvedValue(MOCK_POST)
      vi.mocked(computeRescheduledInstant).mockReturnValue('2026-06-11T10:00:00.000Z')
      vi.mocked(reschedulePost).mockResolvedValue({ updated: true })

      await reschedulePostAction(POST_ID, '2026-06-11')

      const lines = loggedKinds()
      expect(lines).toContainEqual({ kind: 'reschedule_post', post_id: POST_ID, business_id: BIZ_ID })
      vi.useRealTimers()
    })

    it('emits reschedule_rejected{reason:too_soon} with ids only', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T01:00:00.000Z'))
      setupAuth({ id: BIZ_ID, timezone: 'America/New_York' })

      await reschedulePostAction(POST_ID, '2026-06-09')

      const lines = loggedKinds()
      expect(lines).toContainEqual({
        kind: 'reschedule_rejected',
        reason: 'too_soon',
        post_id: POST_ID,
        business_id: BIZ_ID,
      })
      vi.useRealTimers()
    })

    it('emits reschedule_rejected{reason:claimed} with ids only', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      setupAuth({ id: BIZ_ID, timezone: 'UTC' })
      vi.mocked(getPostById).mockResolvedValue(MOCK_POST)
      vi.mocked(computeRescheduledInstant).mockReturnValue('2026-06-11T10:00:00.000Z')
      vi.mocked(reschedulePost).mockResolvedValue({ updated: false })

      await reschedulePostAction(POST_ID, '2026-06-11')

      const lines = loggedKinds()
      expect(lines).toContainEqual({
        kind: 'reschedule_rejected',
        reason: 'claimed',
        post_id: POST_ID,
        business_id: BIZ_ID,
      })
      vi.useRealTimers()
    })

    it('emits reschedule_rejected{reason:generic} and captures the exception id-only on unexpected error', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      const err = new Error('Post not found')
      vi.mocked(getPostById).mockRejectedValue(err)

      await reschedulePostAction(POST_ID, '2026-06-11')

      const lines = loggedKinds()
      expect(lines).toContainEqual({ kind: 'reschedule_rejected', reason: 'generic', post_id: POST_ID })
      expect(Sentry.captureException).toHaveBeenCalledWith(
        err,
        { tags: { kind: 'reschedule_rejected', reason: 'generic', post_id: POST_ID } },
      )
      vi.useRealTimers()
    })
  })
})

// ── rescheduleDayGroupAction ──────────────────────────────────────────────────

describe('rescheduleDayGroupAction', () => {
  describe('Zod validation', () => {
    it('rejects malformed campaignId', async () => {
      const result = await rescheduleDayGroupAction('bad-id', '2026-06-10', '2026-06-15')
      expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    })

    it('rejects malformed sourceDayKey', async () => {
      const result = await rescheduleDayGroupAction(CAMPAIGN_ID, 'not-a-date', '2026-06-15')
      expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    })
  })

  describe('TZ-correct source-box re-read (R3)', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('converts sourceDayKey to UTC range using the business timezone', async () => {
      // June 8 — clearly before both source and target days
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ timezone: 'America/New_York' })
      vi.mocked(listPostsForCalendar).mockResolvedValue({ rows: [], overflow: false })

      // sourceDayKey '2026-06-10' in EDT (UTC-4):
      //   start: 2026-06-10T00:00 EDT = 2026-06-10T04:00:00.000Z
      //   end:   2026-06-11T00:00 EDT = 2026-06-11T04:00:00.000Z
      await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      expect(listPostsForCalendar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          rangeStartUtc: '2026-06-10T04:00:00.000Z',
          rangeEndUtc: '2026-06-11T04:00:00.000Z',
        }),
      )
    })

    it('uses UTC midnight range for UTC-timezone business', async () => {
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      vi.mocked(listPostsForCalendar).mockResolvedValue({ rows: [], overflow: false })

      await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      expect(listPostsForCalendar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          rangeStartUtc: '2026-06-10T00:00:00.000Z',
          rangeEndUtc: '2026-06-11T00:00:00.000Z',
        }),
      )
    })
  })

  describe('mixed: one non-movable post in the box', () => {
    it('returns mixed and calls reschedulePost zero times', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      vi.mocked(listPostsForCalendar).mockResolvedValue({
        rows: [
          makeCalendarRow({ status: 'draft' }),
          makeCalendarRow({ id: POST_2_ID, status: 'scheduled' }),
        ],
        overflow: false,
      })

      const result = await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      expect(result).toEqual({ ok: false, reason: 'mixed' })
      expect(reschedulePost).not.toHaveBeenCalled()
      expect(reschedulePostsBatch).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe('one atomic rpc call, not a per-post loop (20C MAJOR-1 / D-N)', () => {
    it('calls reschedulePostsBatch exactly once, never reschedulePost, for a multi-row box', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      vi.mocked(listPostsForCalendar).mockResolvedValue({
        rows: [
          makeCalendarRow({ id: POST_ID, status: 'draft', scheduled_at: '2026-06-10T09:00:00.000Z' }),
          makeCalendarRow({ id: POST_2_ID, status: 'approved', scheduled_at: '2026-06-10T11:00:00.000Z' }),
        ],
        overflow: false,
      })
      vi.mocked(computeRescheduledInstant)
        .mockReturnValueOnce('2026-06-15T09:00:00.000Z')
        .mockReturnValueOnce('2026-06-15T11:00:00.000Z')
      vi.mocked(reschedulePostsBatch).mockResolvedValue([POST_ID, POST_2_ID])

      const result = await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      expect(reschedulePostsBatch).toHaveBeenCalledTimes(1)
      expect(reschedulePostsBatch).toHaveBeenCalledWith(
        expect.anything(),
        {
          businessId: BIZ_ID,
          moves: [
            { id: POST_ID, newScheduledAtUtc: '2026-06-15T09:00:00.000Z' },
            { id: POST_2_ID, newScheduledAtUtc: '2026-06-15T11:00:00.000Z' },
          ],
        },
      )
      expect(reschedulePost).not.toHaveBeenCalled()
      expect(result).toEqual({ ok: true, moved: 2, skipped: 0 })
      vi.useRealTimers()
    })
  })

  describe('partial skipped: worker race mid-flight', () => {
    it('counts moved and skipped when the batch rpc returns fewer ids than requested', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      vi.mocked(listPostsForCalendar).mockResolvedValue({
        rows: [
          makeCalendarRow({ id: POST_ID, status: 'draft', scheduled_at: '2026-06-10T09:00:00.000Z' }),
          makeCalendarRow({ id: POST_2_ID, status: 'approved', scheduled_at: '2026-06-10T11:00:00.000Z' }),
        ],
        overflow: false,
      })
      vi.mocked(computeRescheduledInstant)
        .mockReturnValueOnce('2026-06-15T09:00:00.000Z')
        .mockReturnValueOnce('2026-06-15T11:00:00.000Z')
      // Worker claimed POST_2_ID mid-flight (status flipped to 'scheduled') — the
      // RPC's WHERE guard rejects that row, so it's simply absent from the returned ids.
      vi.mocked(reschedulePostsBatch).mockResolvedValue([POST_ID])

      const result = await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      expect(result).toEqual({ ok: true, moved: 1, skipped: 1 })
      expect(revalidatePath).toHaveBeenCalledWith('/[locale]/calendar', 'page')
      vi.useRealTimers()
    })
  })

  it('returns {ok:true, moved:0, skipped:0} when the box is empty', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
    setupAuth({ timezone: 'UTC' })
    vi.mocked(listPostsForCalendar).mockResolvedValue({ rows: [], overflow: false })

    const result = await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')
    expect(result).toEqual({ ok: true, moved: 0, skipped: 0 })
    vi.useRealTimers()
  })

  it('too_soon guard applies to targetDayKey', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'))
    setupAuth({ timezone: 'UTC' })

    const result = await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-08', '2026-06-10')
    expect(result).toEqual({ ok: false, reason: 'too_soon' })
    expect(listPostsForCalendar).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  // MINOR-1 (§10 observability): id-only JSON log lines, no content/PII.
  describe('observability (MINOR-1)', () => {
    it('emits reschedule_group with ids + counts only on success', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ id: BIZ_ID, timezone: 'UTC' })
      vi.mocked(listPostsForCalendar).mockResolvedValue({
        rows: [makeCalendarRow({ id: POST_ID, status: 'draft', scheduled_at: '2026-06-10T09:00:00.000Z' })],
        overflow: false,
      })
      vi.mocked(computeRescheduledInstant).mockReturnValue('2026-06-15T09:00:00.000Z')
      vi.mocked(reschedulePostsBatch).mockResolvedValue([POST_ID])

      await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      const lines = loggedKinds()
      expect(lines).toContainEqual({
        kind: 'reschedule_group',
        campaign_id: CAMPAIGN_ID,
        business_id: BIZ_ID,
        moved: 1,
        skipped: 0,
      })
      vi.useRealTimers()
    })

    it('emits reschedule_rejected{reason:mixed} with ids only', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ id: BIZ_ID, timezone: 'UTC' })
      vi.mocked(listPostsForCalendar).mockResolvedValue({
        rows: [
          makeCalendarRow({ status: 'draft' }),
          makeCalendarRow({ id: POST_2_ID, status: 'scheduled' }),
        ],
        overflow: false,
      })

      await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      const lines = loggedKinds()
      expect(lines).toContainEqual({
        kind: 'reschedule_rejected',
        reason: 'mixed',
        campaign_id: CAMPAIGN_ID,
        business_id: BIZ_ID,
      })
      vi.useRealTimers()
    })

    it('emits reschedule_rejected{reason:generic} and captures the exception id-only on unexpected error', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'))
      setupAuth({ timezone: 'UTC' })
      const err = new Error('DB error')
      vi.mocked(listPostsForCalendar).mockRejectedValue(err)

      await rescheduleDayGroupAction(CAMPAIGN_ID, '2026-06-10', '2026-06-15')

      const lines = loggedKinds()
      expect(lines).toContainEqual({ kind: 'reschedule_rejected', reason: 'generic', campaign_id: CAMPAIGN_ID })
      expect(Sentry.captureException).toHaveBeenCalledWith(
        err,
        { tags: { kind: 'reschedule_rejected', reason: 'generic', campaign_id: CAMPAIGN_ID } },
      )
      vi.useRealTimers()
    })
  })
})

// ── updatePostFromCalendarAction ──────────────────────────────────────────────

describe('updatePostFromCalendarAction', () => {
  describe('Zod validation', () => {
    it('rejects malformed postId', async () => {
      const result = await updatePostFromCalendarAction('bad', 'content', [])
      expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    })

    it('rejects empty content', async () => {
      const result = await updatePostFromCalendarAction(POST_ID, '', [])
      expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    })
  })

  describe('not_eligible: published and scheduled statuses rejected', () => {
    it('rejects published post', async () => {
      setupAuth({ id: BIZ_ID })
      vi.mocked(getPostById).mockResolvedValue({ ...MOCK_POST, status: 'published' })

      const result = await updatePostFromCalendarAction(POST_ID, 'new content', [])
      expect(result).toEqual({ ok: false, reason: 'not_eligible' })
      expect(unapprovePost).not.toHaveBeenCalled()
      expect(updatePostContent).not.toHaveBeenCalled()
    })

    // MINOR-1 (§10 observability): id-only JSON log line, no content/PII.
    it('emits reschedule_rejected{reason:not_eligible} with ids only', async () => {
      setupAuth({ id: BIZ_ID })
      vi.mocked(getPostById).mockResolvedValue({ ...MOCK_POST, status: 'published' })

      await updatePostFromCalendarAction(POST_ID, 'new content', [])

      const lines = loggedKinds()
      expect(lines).toContainEqual({
        kind: 'reschedule_rejected',
        reason: 'not_eligible',
        post_id: POST_ID,
        business_id: BIZ_ID,
      })
    })

    it('rejects scheduled post', async () => {
      setupAuth()
      vi.mocked(getPostById).mockResolvedValue({ ...MOCK_POST, status: 'scheduled' })

      const result = await updatePostFromCalendarAction(POST_ID, 'new content', [])
      expect(result).toEqual({ ok: false, reason: 'not_eligible' })
      expect(unapprovePost).not.toHaveBeenCalled()
    })
  })

  describe('revert-first ordering (CAL-6 / R2)', () => {
    it('calls unapprovePost BEFORE updatePostContent for approved post', async () => {
      setupAuth()
      vi.mocked(getPostById).mockResolvedValue({ ...MOCK_POST, status: 'approved' })

      const callOrder: string[] = []
      vi.mocked(unapprovePost).mockImplementation(async () => {
        callOrder.push('unapprove')
        return { ...MOCK_POST, status: 'draft' }
      })
      vi.mocked(updatePostContent).mockImplementation(async () => {
        callOrder.push('update')
        return { ...MOCK_POST, status: 'draft', content: 'new content' }
      })

      await updatePostFromCalendarAction(POST_ID, 'new content', ['#test'])

      expect(callOrder).toEqual(['unapprove', 'update'])
    })

    it('returns generic when updatePostContent throws after unapprove (post left as safe draft)', async () => {
      setupAuth()
      vi.mocked(getPostById).mockResolvedValue({ ...MOCK_POST, status: 'approved' })
      vi.mocked(unapprovePost).mockResolvedValue({ ...MOCK_POST, status: 'draft' })
      vi.mocked(updatePostContent).mockRejectedValue(new Error('db failure'))

      const result = await updatePostFromCalendarAction(POST_ID, 'new content', ['#test'])

      expect(result).toEqual({ ok: false, reason: 'generic' })
      expect(unapprovePost).toHaveBeenCalledOnce()
      expect(updatePostContent).toHaveBeenCalledOnce()
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  it('updates draft post without calling unapprovePost', async () => {
    setupAuth()
    vi.mocked(getPostById).mockResolvedValue({ ...MOCK_POST, status: 'draft' })
    vi.mocked(updatePostContent).mockResolvedValue({ ...MOCK_POST, content: 'new content' })

    const result = await updatePostFromCalendarAction(POST_ID, 'new content', ['#tag'])

    expect(unapprovePost).not.toHaveBeenCalled()
    expect(updatePostContent).toHaveBeenCalledWith(
      expect.anything(),
      POST_ID,
      { content: 'new content', hashtags: ['#tag'] },
    )
    expect(result).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/calendar', 'page')
  })

  it('unapproves then updates approved post, then revalidates', async () => {
    setupAuth()
    vi.mocked(getPostById).mockResolvedValue({ ...MOCK_POST, status: 'approved' })
    vi.mocked(unapprovePost).mockResolvedValue({ ...MOCK_POST, status: 'draft' })
    vi.mocked(updatePostContent).mockResolvedValue({ ...MOCK_POST, content: 'updated' })

    const result = await updatePostFromCalendarAction(POST_ID, 'updated', [])

    expect(unapprovePost).toHaveBeenCalledWith(expect.anything(), POST_ID)
    expect(updatePostContent).toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/calendar', 'page')
  })
})

// ── approvePostFromCalendarAction ─────────────────────────────────────────────

describe('approvePostFromCalendarAction', () => {
  it('rejects malformed postId', async () => {
    const result = await approvePostFromCalendarAction('not-a-uuid')
    expect(result).toEqual({ ok: false, reason: 'invalid_input' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns generic when unauthenticated', async () => {
    const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }
    vi.mocked(createClient).mockResolvedValue(client as never)

    const result = await approvePostFromCalendarAction(POST_ID)
    expect(result).toEqual({ ok: false, reason: 'generic' })
  })

  it('returns generic when approvePost throws', async () => {
    setupAuth()
    vi.mocked(approvePost).mockRejectedValue(new Error('post not in draft status'))

    const result = await approvePostFromCalendarAction(POST_ID)
    expect(result).toEqual({ ok: false, reason: 'generic' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('approves post and revalidates calendar', async () => {
    setupAuth()
    vi.mocked(approvePost).mockResolvedValue({ ...MOCK_POST, status: 'approved' })

    const result = await approvePostFromCalendarAction(POST_ID)
    expect(result).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/calendar', 'page')
  })

  // MINOR-2: defense-in-depth business_id predicate, matching reschedulePost's posture.
  it('passes the server-derived business_id through to approvePost (MINOR-2)', async () => {
    setupAuth()
    vi.mocked(approvePost).mockResolvedValue({ ...MOCK_POST, status: 'approved' })

    await approvePostFromCalendarAction(POST_ID)
    expect(approvePost).toHaveBeenCalledWith(expect.anything(), POST_ID, BIZ_ID)
  })
})
