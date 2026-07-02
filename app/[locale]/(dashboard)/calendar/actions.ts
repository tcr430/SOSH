'use server'

import { z } from 'zod'
import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
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
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { toUtcIso } from '@/lib/utils'

// ── Return types ──────────────────────────────────────────────────────────────

export type CalendarActionResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_input' | 'too_soon' | 'claimed' | 'not_eligible' | 'generic' }

export type GroupRescheduleResult =
  | { ok: true; moved: number; skipped: number }
  | { ok: false; reason: 'invalid_input' | 'too_soon' | 'mixed' | 'generic' }

// ── Zod schemas ───────────────────────────────────────────────────────────────

const DAY_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/

const reschedulePostSchema = z.object({
  postId: z.string().uuid(),
  targetDayKey: z.string().regex(DAY_KEY_REGEX),
})

const groupRescheduleSchema = z.object({
  campaignId: z.string().uuid(),
  sourceDayKey: z.string().regex(DAY_KEY_REGEX),
  targetDayKey: z.string().regex(DAY_KEY_REGEX),
})

const updateContentSchema = z.object({
  postId: z.string().uuid(),
  content: z.string().min(1).max(5000),
  hashtags: z.array(z.string().max(100)).max(30),
})

const postIdSchema = z.object({ postId: z.string().uuid() })

// ── Shared helpers ────────────────────────────────────────────────────────────

async function getAuthContext() {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return null
  const business = await getBusinessByOwner(client, user.id)
  if (!business) return null
  return { client, business }
}

function revalidateCalendar(): void {
  // Literal /[locale]/... bracket is Next.js 16's pattern for invalidating a
  // dynamic segment across all locale values simultaneously (R11).
  revalidatePath('/[locale]/calendar', 'page')
}

function isTooSoon(targetDayKey: string, tz: string): boolean {
  // Minimum target is TOMORROW in the business timezone (CAL-4 / R6).
  return targetDayKey <= formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
}

// Id-only JSON log lines (ADR 0012 §10) — never content/PII (REDACTED posture).
// Sentry capture (unexpected 'generic' errors only) mirrors this: tags are ids, never content.

function logCalendarEvent(kind: string, ids: Record<string, string | number>): void {
  console.log(JSON.stringify({ kind, ...ids }))
}

function logRescheduleRejected(
  reason: 'too_soon' | 'claimed' | 'mixed' | 'not_eligible' | 'generic',
  ids: Record<string, string>,
): void {
  logCalendarEvent('reschedule_rejected', { reason, ...ids })
}

function dayKeyToUtcRange(dayKey: string, tz: string): { startUtc: string; endUtc: string } {
  // Converts a business-TZ calendar day to a UTC [start, end) range.
  // fromZonedTime treats the string as wall-clock time in tz — never SQL date() (R3).
  const utcStart = fromZonedTime(`${dayKey} 00:00:00`, tz)
  // Compute the next-day key purely in UTC to avoid machine-timezone dependence.
  const [y, mo, d] = dayKey.split('-').map(Number)
  const nextDayKey = toUtcIso(new Date(Date.UTC(y, mo - 1, d + 1))).split('T')[0]
  const utcEnd = fromZonedTime(`${nextDayKey} 00:00:00`, tz)
  return { startUtc: toUtcIso(utcStart), endUtc: toUtcIso(utcEnd) }
}

// ── reschedulePostAction ──────────────────────────────────────────────────────

export async function reschedulePostAction(
  postId: string,
  targetDayKey: string,
): Promise<CalendarActionResult> {
  const parsed = reschedulePostSchema.safeParse({ postId, targetDayKey })
  if (!parsed.success) return { ok: false, reason: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      logRescheduleRejected('generic', { post_id: postId })
      return { ok: false, reason: 'generic' }
    }

    if (isTooSoon(targetDayKey, ctx.business.timezone)) {
      logRescheduleRejected('too_soon', { post_id: postId, business_id: ctx.business.id })
      return { ok: false, reason: 'too_soon' }
    }

    // RLS client: cross-business posts are invisible — implicit IDOR guard.
    const post = await getPostById(ctx.client, postId)
    const newScheduledAtUtc = computeRescheduledInstant(
      post.scheduled_at,
      targetDayKey,
      ctx.business.timezone,
    )

    const result = await reschedulePost(ctx.client, {
      postId,
      businessId: ctx.business.id,  // always server-derived; never a client argument
      newScheduledAtUtc,
    })

    if (!result.updated) {
      logRescheduleRejected('claimed', { post_id: postId, business_id: ctx.business.id })
      return { ok: false, reason: 'claimed' }
    }

    logCalendarEvent('reschedule_post', { post_id: postId, business_id: ctx.business.id })
    revalidateCalendar()
    return { ok: true }
  } catch (err) {
    logRescheduleRejected('generic', { post_id: postId })
    Sentry.captureException(err, { tags: { kind: 'reschedule_rejected', reason: 'generic', post_id: postId } })
    return { ok: false, reason: 'generic' }
  }
}

// ── rescheduleDayGroupAction ──────────────────────────────────────────────────

export async function rescheduleDayGroupAction(
  campaignId: string,
  sourceDayKey: string,
  targetDayKey: string,
): Promise<GroupRescheduleResult> {
  const parsed = groupRescheduleSchema.safeParse({ campaignId, sourceDayKey, targetDayKey })
  if (!parsed.success) return { ok: false, reason: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      logRescheduleRejected('generic', { campaign_id: campaignId })
      return { ok: false, reason: 'generic' }
    }

    if (isTooSoon(targetDayKey, ctx.business.timezone)) {
      logRescheduleRejected('too_soon', { campaign_id: campaignId, business_id: ctx.business.id })
      return { ok: false, reason: 'too_soon' }
    }

    // TZ-correct source-box re-read (R3): convert the day key to a UTC range using
    // the business timezone wall clock — never SQL date() on scheduled_at.
    const { startUtc, endUtc } = dayKeyToUtcRange(sourceDayKey, ctx.business.timezone)
    const { rows } = await listPostsForCalendar(ctx.client, {
      businessId: ctx.business.id,
      rangeStartUtc: startUtc,
      rangeEndUtc: endUtc,
    })

    const boxPosts = rows.filter(r => r.campaign_id === campaignId)
    if (boxPosts.length === 0) {
      logCalendarEvent('reschedule_group', { campaign_id: campaignId, business_id: ctx.business.id, moved: 0, skipped: 0 })
      return { ok: true, moved: 0, skipped: 0 }
    }

    // ALL posts must be movable before moving any — mixed box moves nothing.
    const allMovable = boxPosts.every(r => r.status === 'draft' || r.status === 'approved')
    if (!allMovable) {
      logRescheduleRejected('mixed', { campaign_id: campaignId, business_id: ctx.business.id })
      return { ok: false, reason: 'mixed' }
    }

    // One atomic statement moves every eligible row (20C MAJOR-1 / D-N) —
    // each post keeps its own business-tz time-of-day, so every row gets a
    // different new instant; per-post rows claimed mid-flight by the worker
    // are simply absent from movedIds, not thrown as errors.
    const moves = boxPosts.map(post => ({
      id: post.id,
      newScheduledAtUtc: computeRescheduledInstant(
        post.scheduled_at,
        targetDayKey,
        ctx.business.timezone,
      ),
    }))
    const movedIds = await reschedulePostsBatch(ctx.client, {
      businessId: ctx.business.id,
      moves,
    })
    const moved = movedIds.length
    const skipped = boxPosts.length - moved

    logCalendarEvent('reschedule_group', { campaign_id: campaignId, business_id: ctx.business.id, moved, skipped })
    revalidateCalendar()
    return { ok: true, moved, skipped }
  } catch (err) {
    logRescheduleRejected('generic', { campaign_id: campaignId })
    Sentry.captureException(err, { tags: { kind: 'reschedule_rejected', reason: 'generic', campaign_id: campaignId } })
    return { ok: false, reason: 'generic' }
  }
}

// ── updatePostFromCalendarAction ──────────────────────────────────────────────

export async function updatePostFromCalendarAction(
  postId: string,
  content: string,
  hashtags: string[],
): Promise<CalendarActionResult> {
  const parsed = updateContentSchema.safeParse({ postId, content, hashtags })
  if (!parsed.success) return { ok: false, reason: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) {
      logRescheduleRejected('generic', { post_id: postId })
      return { ok: false, reason: 'generic' }
    }

    const post = await getPostById(ctx.client, postId)

    if (post.status === 'published' || post.status === 'scheduled') {
      logRescheduleRejected('not_eligible', { post_id: postId, business_id: ctx.business.id })
      return { ok: false, reason: 'not_eligible' }
    }

    // Revert-first (CAL-6 / R2): revert approved → draft BEFORE editing.
    // If updatePostContent throws, the post is left as an un-edited draft — safe.
    if (post.status === 'approved') {
      await unapprovePost(ctx.client, postId)
    }

    await updatePostContent(ctx.client, postId, {
      content: parsed.data.content,
      hashtags: parsed.data.hashtags,
    })

    revalidateCalendar()
    return { ok: true }
  } catch (err) {
    logRescheduleRejected('generic', { post_id: postId })
    Sentry.captureException(err, { tags: { kind: 'reschedule_rejected', reason: 'generic', post_id: postId } })
    return { ok: false, reason: 'generic' }
  }
}

// ── approvePostFromCalendarAction ─────────────────────────────────────────────

export async function approvePostFromCalendarAction(
  postId: string,
): Promise<CalendarActionResult> {
  const parsed = postIdSchema.safeParse({ postId })
  if (!parsed.success) return { ok: false, reason: 'invalid_input' }

  try {
    const ctx = await getAuthContext()
    if (!ctx) return { ok: false, reason: 'generic' }

    await approvePost(ctx.client, postId, ctx.business.id)
    revalidateCalendar()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'generic' }
  }
}
