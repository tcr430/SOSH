import { formatISO, subMinutes } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostRow, PostInsert, PostUpdate, PostStatus, AiGenerationMetadata } from './types'
import { getErrorMessage, toUtcIso } from './utils'

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
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select()
    .single()
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

export async function bulkApproveDraftPosts(
  client: SupabaseClient,
  campaignId: string,
): Promise<number> {
  const { data, error } = await client
    .from('posts')
    .update({ status: 'approved' })
    .eq('campaign_id', campaignId)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select('id')
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
  const now = toUtcIso()
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
