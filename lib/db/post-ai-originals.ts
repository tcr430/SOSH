import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostAiOriginalInsert, PostAiOriginalRow } from './types'
import { getErrorMessage } from './utils'

// ADR 0018 §2.6 — named constant, sibling in spirit to lib/memory/constants.ts's
// ADR-constant convention (L-4: no scattered magic numbers). Every writer of
// post_ai_originals (initial generation, regeneration, and any future writer)
// references this one place rather than an inline literal `1`.
export const AI_ORIGINAL_SCHEMA_VERSION = 1

export async function createPostAiOriginal(
  client: SupabaseClient,
  insert: PostAiOriginalInsert,
): Promise<PostAiOriginalRow> {
  const { data, error } = await client.from('post_ai_originals').insert(insert).select().single()
  if (error) throw new Error(getErrorMessage(error))
  return data as PostAiOriginalRow
}

// Bounded, explicit ORDER BY matching UNIQUE (post_id, revision). Returns 0
// when no snapshot exists yet ([db-MAJOR-1] — a manual-origin or otherwise
// snapshot-less post), so callers can uniformly compute next = latest + 1.
//
// [Session 25-D correction, NIT-7] No business_id filter here — tenancy is
// enforced by the CALLER'S CLIENT, not by this function. Safe today because
// the only production caller (regeneratePostAction) passes an RLS-scoped
// `ctx.client` with an already-validated `postId`. A FUTURE caller using a
// service-role client with an attacker-influenced `postId` would NOT be
// tenant-isolated by this function — do not assume it self-enforces.
export async function getLatestRevision(client: SupabaseClient, postId: string): Promise<number> {
  const { data, error } = await client
    .from('post_ai_originals')
    .select('revision')
    .eq('post_id', postId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as { revision: number } | null)?.revision ?? 0
}

// ADR 0018 §9 (C2.8) — the orchestrator's per-signal lookup: a claimed
// post_edit_signals row carries only ai_original_id, never the snapshot
// content itself. Returns null (not an error) when the row is missing —
// §9.4 lists "a missing snapshot row" as a PERMANENT failure the caller
// abandons; this function does not decide that, it just reports absence.
//
// [Session 25-D correction, NIT-7] No business_id filter here — tenancy is
// enforced by the CALLER'S CLIENT, not by this function. Safe today because
// the only production caller is the service-role orchestrator, and the `id`
// it passes is always sourced from a claimed, trusted `post_edit_signals`
// row's `ai_original_id` — never attacker input. A FUTURE caller passing an
// externally-influenced `id` under a service-role client would NOT be
// tenant-isolated by this function — do not assume it self-enforces.
export async function getPostAiOriginalById(
  client: SupabaseClient,
  id: string,
): Promise<PostAiOriginalRow | null> {
  const { data, error } = await client
    .from('post_ai_originals')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as PostAiOriginalRow | null) ?? null
}

// ADR 0022 §10 (Session 29, F1b.9) — the Approvals surface's bulk read: one
// query for every rendered post's latest snapshot instead of N getLatestRevision
// round-trips. Tenancy note mirrors getLatestRevision (:20-29): enforced by
// the CALLER'S CLIENT (the approvals page's RLS-scoped client) — this RPC is
// SECURITY INVOKER (no SECURITY DEFINER), so RLS applies through it exactly
// as it would a plain table read.
//
// Session 29-D, D9 (MINOR-6 correction) — this used to be a single ordered,
// LIST-WIDE-capped SELECT (.limit(postIds.length * 20)). That cap was a
// per-list heuristic, not a per-post one: one post with more than 20
// revisions consumed the whole list's budget, and because the ordering was
// post_id-major, posts sorted AFTER it in that ordering fell off the result
// entirely — their preview silently rendered nothing, no error.
// createNextPostAiOriginalRevision increments on every regeneration, so
// >20 revisions on one post is reachable. Now a DISTINCT ON (post_id) read
// via get_latest_post_ai_originals (20260825190000_post_ai_originals_latest_per_post.sql)
// — every post_id in the list is guaranteed exactly one row (its latest),
// independent of how many revisions any OTHER post has.
export async function listLatestPostAiOriginalsByPostIds(
  client: SupabaseClient,
  postIds: string[],
): Promise<Map<string, PostAiOriginalRow>> {
  if (postIds.length === 0) return new Map()
  const { data, error } = await client.rpc('get_latest_post_ai_originals', { p_post_ids: postIds })
  if (error) throw new Error(getErrorMessage(error))

  const result = new Map<string, PostAiOriginalRow>()
  for (const row of (data ?? []) as PostAiOriginalRow[]) {
    result.set(row.post_id, row)
  }
  return result
}

function isPostgresError(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string'
  )
}

// [db-MINOR-1]: computing the next revision client-side races under
// concurrent regenerations of the same post. A 23505 here means the UNIQUE
// (post_id, revision) constraint did its job — nothing corrupted — so it is
// caught and retried (re-reading the now-updated latest revision), never
// surfaced as an unexplained error. Mirrors the duplicate-detection
// convention CLAUDE.md's webhook-handler section and acceptInvite()
// (lib/db/business-members.ts:187-203) already establish: check error.code
// on the raw Supabase error BEFORE it gets wrapped in a generic Error.
export async function createNextPostAiOriginalRevision(
  client: SupabaseClient,
  insert: Omit<PostAiOriginalInsert, 'revision'>,
  maxAttempts = 3,
): Promise<PostAiOriginalRow> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const latest = await getLatestRevision(client, insert.post_id)
    const { data, error } = await client
      .from('post_ai_originals')
      .insert({ ...insert, revision: latest + 1 })
      .select()
      .single()
    if (!error) return data as PostAiOriginalRow

    lastError = error
    if (isPostgresError(error) && error.code === '23505' && attempt < maxAttempts) continue
    throw new Error(getErrorMessage(error))
  }
  throw new Error(getErrorMessage(lastError))
}
