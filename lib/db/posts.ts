import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostRow, PostInsert, PostUpdate, PostStatus } from './types'

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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
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
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error(`Post ${id} not found or not in 'approved' status`)
  return row as PostRow
}

export async function markPostFailed(
  client: SupabaseClient,
  id: string,
): Promise<PostRow> {
  const { data: row, error } = await client
    .from('posts')
    .update({ status: 'failed' })
    .eq('id', id)
    .eq('status', 'scheduled')
    .is('deleted_at', null)
    .select()
    .single()
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error(`Post ${id} not found or not in 'scheduled' status`)
  return row as PostRow
}

export async function skipPost(
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
  if (error) throw new Error((error as { message: string }).message)
  if (!row) throw new Error(`Post ${id} not found or not in a skippable status`)
  return row as PostRow
}

export async function listPostsDue(
  client: SupabaseClient,
): Promise<PostRow[]> {
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('posts')
    .select('*')
    .eq('status', 'approved')
    .lte('scheduled_at', now)
    .is('deleted_at', null)
  if (error) throw new Error((error as { message: string }).message)
  return (data as PostRow[]) ?? []
}
