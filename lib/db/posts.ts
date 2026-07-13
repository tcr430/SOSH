import { formatISO, subMinutes } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostRow, PostInsert, PostUpdate, PostStatus, Platform, AiGenerationMetadata } from './types'
import type { CalendarPostRow, CalendarPostMetrics } from '@/lib/calendar/types'
import { getErrorMessage } from './utils'
import { toUtcIso } from '@/lib/utils'

// ── Calendar layer (ADR 0012) ─────────────────────────────────────────────────

export const CALENDAR_POST_LIMIT = 5000

// Single source of truth is lib/calendar/types.ts — re-exported here so existing
// `@/lib/db/posts` imports keep working without a second, divergence-prone copy.
export type { CalendarPostRow, CalendarPostMetrics }

type RawCalendarRow = {
  id: string
  campaign_id: string
  platform: Platform
  status: PostStatus
  content: string
  hashtags: string[]
  scheduled_at: string
  published_at: string | null
  platform_post_id: string | null
  // PostgREST returns the FK-joined side as an array even for to-one relationships
  campaigns: Array<{ name: string }>
  post_metrics: CalendarPostMetrics[] | null
}

function mapCalendarRow(raw: RawCalendarRow): CalendarPostRow {
  const arr = raw.post_metrics
  return {
    id: raw.id,
    campaign_id: raw.campaign_id,
    campaign_name: raw.campaigns[0]?.name ?? '',
    platform: raw.platform,
    status: raw.status,
    content: raw.content,
    hashtags: raw.hashtags,
    scheduled_at: raw.scheduled_at,
    published_at: raw.published_at,
    platform_post_id: raw.platform_post_id,
    metrics: arr && arr.length > 0 ? arr[0] : null,
  }
}

export async function listPostsForCalendar(
  client: SupabaseClient,
  opts: {
    businessId: string
    rangeStartUtc: string
    rangeEndUtc: string
    limit?: number
  },
): Promise<{ rows: CalendarPostRow[]; overflow: boolean }> {
  const effectiveLimit = opts.limit ?? CALENDAR_POST_LIMIT
  const { data, error } = await client
    .from('posts')
    .select(`
      id,
      campaign_id,
      platform,
      status,
      content,
      hashtags,
      scheduled_at,
      published_at,
      platform_post_id,
      campaigns!inner(name),
      post_metrics(likes, comments, shares, saves, clicks, reach, impressions, last_synced_at)
    `)
    .eq('business_id', opts.businessId)
    .gte('scheduled_at', opts.rangeStartUtc)
    .lt('scheduled_at', opts.rangeEndUtc)
    .is('deleted_at', null)
    .order('scheduled_at', { ascending: true })
    .limit(effectiveLimit + 1)
  if (error) throw new Error(getErrorMessage(error))

  // client is an untyped SupabaseClient (no Database generic), so PostgREST's
  // joined-select response is `any[]` here — this is the single narrowing cast
  // to the shape that query actually returns (verified against RawCalendarRow's
  // field list above), not a type-safety-defeating `as unknown as`.
  const raw = (data ?? []) as RawCalendarRow[]
  const overflow = raw.length > effectiveLimit
  const rows = (overflow ? raw.slice(0, effectiveLimit) : raw).map(mapCalendarRow)
  return { rows, overflow }
}

// ADR 0014 §9.2 — the Approvals inbox's pending-draft read. Reuses the exact
// same mapping (mapCalendarRow) and status='draft' notion the calendar badge
// uses for "Awaiting approval" — no new query surface that could diverge from
// the calendar's definition of "pending" (C-2/§9.2).
export const APPROVALS_POST_LIMIT = 200

export async function listPendingDraftPosts(
  client: SupabaseClient,
  opts: {
    businessId: string
    campaignId?: string
    platform?: Platform
    limit?: number
  },
): Promise<CalendarPostRow[]> {
  const effectiveLimit = opts.limit ?? APPROVALS_POST_LIMIT
  let query = client
    .from('posts')
    .select(`
      id,
      campaign_id,
      platform,
      status,
      content,
      hashtags,
      scheduled_at,
      published_at,
      platform_post_id,
      campaigns!inner(name),
      post_metrics(likes, comments, shares, saves, clicks, reach, impressions, last_synced_at)
    `)
    .eq('business_id', opts.businessId)
    .eq('status', 'draft')
    .is('deleted_at', null)
  if (opts.campaignId) query = query.eq('campaign_id', opts.campaignId)
  if (opts.platform) query = query.eq('platform', opts.platform)
  const { data, error } = await query
    .order('scheduled_at', { ascending: true })
    .limit(effectiveLimit)
  if (error) throw new Error(getErrorMessage(error))

  const raw = (data ?? []) as RawCalendarRow[]
  return raw.map(mapCalendarRow)
}

// True pending-draft total, unbounded by APPROVALS_POST_LIMIT — lets the
// Approvals inbox tell the approver when drafts are hidden past the cap
// instead of silently truncating (ADR 0014 §9.4 overflow signal).
export async function countPendingDraftPosts(
  client: SupabaseClient,
  businessId: string,
): Promise<number> {
  const { count, error } = await client
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'draft')
    .is('deleted_at', null)
  if (error) throw new Error(getErrorMessage(error))
  return count ?? 0
}

export async function reschedulePost(
  client: SupabaseClient,
  opts: {
    postId: string
    businessId: string
    newScheduledAtUtc: string
  },
): Promise<{ updated: boolean }> {
  const { data, error } = await client
    .from('posts')
    .update({ scheduled_at: opts.newScheduledAtUtc })
    .eq('id', opts.postId)
    .eq('business_id', opts.businessId)
    .in('status', ['draft', 'approved'])
    .is('published_at', null)
    .is('deleted_at', null)
    .select('id')
  if (error) throw new Error(getErrorMessage(error))
  return { updated: ((data as { id: string }[] | null)?.length ?? 0) === 1 }
}

// Moves every post in a group in ONE atomic statement (20C MAJOR-1 / D-N) —
// each post keeps its own business-tz time-of-day, so every row gets a
// different scheduled_at; a plain multi-row .update() can't express that.
// The RPC is SECURITY INVOKER (see migration) so RLS still gates every row —
// this is not a service-role escape hatch.
export async function reschedulePostsBatch(
  client: SupabaseClient,
  opts: {
    businessId: string
    moves: { id: string; newScheduledAtUtc: string }[]
  },
): Promise<string[]> {
  if (opts.moves.length === 0) return []
  const { data, error } = await client.rpc('reschedule_posts_batch', {
    p_business_id: opts.businessId,
    p_moves: opts.moves.map(m => ({ id: m.id, ts: toUtcIso(new Date(m.newScheduledAtUtc)) })),
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as string[] | null) ?? []
}

// Governs only the generic updatePost path. Dedicated functions (unapprovePost,
// unskipPost) bypass this map and use their own atomic WHERE guards.
const VALID_TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  draft: ['approved', 'skipped'],
  approved: ['scheduled', 'skipped'],
  scheduled: ['published', 'failed', 'skipped'],
  published: [],
  failed: [],
  skipped: [],
}

function validateStatusTransition(from: PostStatus, to: PostStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`)
  }
}

export async function listRecentPublishedPostTexts(
  client: SupabaseClient,
  businessId: string,
  limit = 3,
): Promise<string[]> {
  const { data, error } = await client
    .from('posts')
    .select('content')
    .eq('business_id', businessId)
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return ((data as { content: string }[]) ?? []).map(row => row.content)
}

export async function listPostsByCampaign(
  client: SupabaseClient,
  campaignId: string,
  limit = 100,
): Promise<PostRow[]> {
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostRow[]) ?? []
}

export async function getPostById(
  client: SupabaseClient,
  id: string,
): Promise<PostRow> {
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!data) throw new Error(`Post ${id} not found`)
  return data as PostRow
}

export async function createPosts(
  client: SupabaseClient,
  posts: PostInsert[],
): Promise<PostRow[]> {
  const { data, error } = await client
    .from('posts')
    .insert(posts)
    .select()
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostRow[]) ?? []
}

export async function updatePost(
  client: SupabaseClient,
  id: string,
  data: PostUpdate,
): Promise<PostRow> {
  if (data.status !== undefined) {
    const current = await getPostById(client, id)
    validateStatusTransition(current.status, data.status)
  }
  const { data: row, error } = await client
    .from('posts')
    .update(data)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found`)
  return row as PostRow
}

export async function approvePost(
  client: SupabaseClient,
  id: string,
  // Optional belt-and-suspenders tenancy guard (20D-5 / MINOR-2), matching
  // reschedulePost's posture. RLS already scopes rows by business — this is
  // defense-in-depth, not the sole guard — so it stays optional to avoid
  // touching call sites that rely on RLS alone (e.g. campaigns/[id]/posts).
  businessId?: string,
): Promise<PostRow> {
  let query = client
    .from('posts')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('status', 'draft')
    .is('deleted_at', null)
  if (businessId !== undefined) query = query.eq('business_id', businessId)
  const { data: row, error } = await query.select().single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in 'draft' status`)
  return row as PostRow
}

export async function schedulePost(
  client: SupabaseClient,
  id: string,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ status: 'scheduled' })
    .eq('id', id)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in 'approved' status`)
  return row as PostRow
}

export interface MarkPostFailedPayload {
  errorCode: string
  errorDetails: unknown
}

export async function markPostFailed(
  client: SupabaseClient,
  postId: string,
  payload: MarkPostFailedPayload,
): Promise<PostRow> {
  const { data: current, error: readError } = await client
    .from('posts')
    .select('ai_generation_metadata, publish_attempts')
    .eq('id', postId)
    .eq('status', 'scheduled')
    .is('deleted_at', null)
    .single()
  if (readError) throw new Error(getErrorMessage(readError))
  if (!current) throw new Error(`Post ${postId} not found or not in 'scheduled' status`)

  const row = current as Pick<PostRow, 'ai_generation_metadata' | 'publish_attempts'>
  const mergedMetadata = { ...row.ai_generation_metadata, publish_error: payload.errorDetails }

  const { data: updated, error } = await client
    .from('posts')
    .update({
      status: 'failed',
      last_publish_error: payload.errorCode,
      ai_generation_metadata: mergedMetadata,
    })
    .eq('id', postId)
    .eq('status', 'scheduled')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!updated) throw new Error(`Post ${postId} not found or not in 'scheduled' status`)
  return updated as PostRow
}

export async function skipScheduledPost(
  client: SupabaseClient,
  id: string,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ status: 'skipped' })
    .eq('id', id)
    .in('status', ['draft', 'approved', 'scheduled'])
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in a skippable status`)
  return row as PostRow
}

export async function unapprovePost(
  client: SupabaseClient,
  id: string,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ status: 'draft' })
    .eq('id', id)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in 'approved' status`)
  return row as PostRow
}

export async function skipPost(
  client: SupabaseClient,
  id: string,
  rejectionNote: string,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ status: 'skipped', rejection_note: rejectionNote })
    .eq('id', id)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in 'draft' status`)
  return row as PostRow
}

export async function unskipPost(
  client: SupabaseClient,
  id: string,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ status: 'draft', rejection_note: null })
    .eq('id', id)
    .eq('status', 'skipped')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in 'skipped' status`)
  return row as PostRow
}

export interface PostContentPatch {
  content: string
  hashtags: string[]
}

export async function updatePostContent(
  client: SupabaseClient,
  id: string,
  patch: PostContentPatch,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ content: patch.content, hashtags: patch.hashtags })
    .eq('id', id)
    .in('status', ['draft', 'approved'])
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in an editable status`)
  return row as PostRow
}

export interface PostContentAndMetadataPatch {
  content: string
  hashtags: string[]
  metadata: AiGenerationMetadata
}

export async function updatePostContentAndMetadata(
  client: SupabaseClient,
  id: string,
  patch: PostContentAndMetadataPatch,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({
      content: patch.content,
      hashtags: patch.hashtags,
      ai_generation_metadata: patch.metadata as unknown as Record<string, unknown>,
    })
    .eq('id', id)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!row) throw new Error(`Post ${id} not found or not in 'draft' status`)
  return row as PostRow
}

// ADR 0014 Amendment A1 — the platform predicate narrows the SAME update
// statement that was already gated by enforce_post_transition_capability
// (0013 §5); it is not a second query or a new write path (A1's hard
// constraint). Undefined/empty platforms leaves the statement unfiltered,
// preserving the exact prior (campaign-wide) behaviour.
export async function bulkApproveDraftPosts(
  client: SupabaseClient,
  campaignId: string,
  platforms?: Platform[],
): Promise<number> {
  let query = client
    .from('posts')
    .update({ status: 'approved' })
    .eq('campaign_id', campaignId)
    .eq('status', 'draft')
    .is('deleted_at', null)
  if (platforms && platforms.length > 0) query = query.in('platform', platforms)
  const { data, error } = await query.select('id')
  if (error) throw new Error(getErrorMessage(error))
  return (data as { id: string }[] | null)?.length ?? 0
}

export async function getPostSiblingTopics(
  client: SupabaseClient,
  campaignId: string,
  excludePostId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('posts')
    .select('ai_generation_metadata')
    .eq('campaign_id', campaignId)
    .neq('id', excludePostId)
    .is('deleted_at', null)
    .limit(20)
  if (error) throw new Error(getErrorMessage(error))
  if (!data) return []
  return (data as { ai_generation_metadata: Record<string, unknown> | null }[])
    .map(row => (row.ai_generation_metadata as { rationale?: string } | null)?.rationale ?? '')
    .filter(Boolean)
}

export async function listPostsByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<PostRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await client
    .from('posts')
    .select('*')
    .in('id', ids)
    .is('deleted_at', null)
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostRow[]) ?? []
}

export async function listPostsDue(
  client: SupabaseClient,
): Promise<PostRow[]> {
  const now = toUtcIso(new Date())
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('status', 'approved')
    .lte('scheduled_at', now)
    .is('deleted_at', null)
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostRow[]) ?? []
}

// ── Publishing worker helpers (ADR 0005 §11) ─────────────────────────────────

export async function claimPostsForPublishing(
  client: SupabaseClient,
  limit: number,
  now: Date = new Date(),
): Promise<PostRow[]> {
  const { data, error } = await client.rpc('claim_posts_for_publishing', {
    p_now: formatISO(now),
    p_limit: limit,
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostRow[]) ?? []
}

// B18-075: single RPC consolidates the post-publish UPDATE and the
// campaign total_posts_published increment into one atomic round-trip,
// guarded by the RPC's internal WHERE status = 'scheduled'. Zero rows
// returned means the guard rejected the transition — callers must treat
// that as a no-op, not an error.
export async function publishPostComplete(
  client: SupabaseClient,
  postId: string,
  payload: {
    platformPostId: string
    platformUrl: string | null
    publishedAt: Date
  },
): Promise<PostRow | null> {
  const { data, error } = await client.rpc('publish_post_complete', {
    p_post_id: postId,
    p_platform_post_id: payload.platformPostId,
    p_platform_url: payload.platformUrl,
    p_published_at: formatISO(payload.publishedAt),
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data ?? []) as PostRow[]
  return rows[0] ?? null
}

export async function requeueScheduledPost(
  client: SupabaseClient,
  postId: string,
  payload: {
    newScheduledAt: Date
    errorCode: string
    errorDetails: unknown
    incrementAttempts: boolean
  },
): Promise<PostRow> {
  const { data: current, error: readError } = await client
    .from('posts')
    .select('ai_generation_metadata, publish_attempts')
    .eq('id', postId)
    .eq('status', 'scheduled')
    .is('deleted_at', null)
    .single()
  if (readError) throw new Error(getErrorMessage(readError))
  if (!current) throw new Error(`Post ${postId} not found or not in 'scheduled' status`)

  const row = current as Pick<PostRow, 'ai_generation_metadata' | 'publish_attempts'>
  const mergedMetadata = { ...row.ai_generation_metadata, publish_error: payload.errorDetails }

  const updateData: Record<string, unknown> = {
    status: 'approved',
    scheduled_at: formatISO(payload.newScheduledAt),
    last_publish_attempt_at: formatISO(payload.newScheduledAt),
    last_publish_error: payload.errorCode,
    ai_generation_metadata: mergedMetadata,
  }
  if (payload.incrementAttempts) {
    updateData.publish_attempts = row.publish_attempts + 1
  }

  const { data: updated, error } = await client
    .from('posts')
    .update(updateData)
    .eq('id', postId)
    .eq('status', 'scheduled')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  if (!updated) throw new Error(`Post ${postId} not found or not in 'scheduled' status`)
  return updated as PostRow
}

export async function reapStuckScheduledPosts(
  client: SupabaseClient,
  opts: { now: Date; stuckMinutes: number },
): Promise<number> {
  const { config } = await import('@/lib/config')
  const { data, error } = await client.rpc('reap_stuck_scheduled_posts', {
    p_now: formatISO(opts.now),
    p_stuck_minutes: opts.stuckMinutes,
    p_max_attempts: config.server.PUBLISH_MAX_ATTEMPTS,
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as number) ?? 0
}

export async function incrementPublishedCountForCampaign(
  client: SupabaseClient,
  campaignId: string,
): Promise<void> {
  const { error } = await client.rpc('increment_published_count_for_campaign', {
    p_campaign_id: campaignId,
  })
  if (error) throw new Error(getErrorMessage(error))
}

// Returns published posts due for a metrics sync per ADR 0006 §4.
// Left-joins post_metrics so never-synced posts (no metrics row) are included.
// ORDER BY last_synced_at NULLS FIRST. Read-only; takes the caller's client.
export async function listPostsForMetricsSync(
  client: SupabaseClient,
  opts: {
    now: Date
    staleMinutes: number
    maxAgeDays: number
    limit: number
  },
): Promise<PostRow[]> {
  const { data, error } = await client.rpc('list_posts_for_metrics_sync', {
    p_now:          formatISO(opts.now),
    p_stale_before: formatISO(subMinutes(opts.now, opts.staleMinutes)),
    p_max_age_days: opts.maxAgeDays,
    p_limit:        opts.limit,
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostRow[]) ?? []
}
