import type { SocialBackfillPostRow } from './types'
import { getErrorMessage } from './utils'
import type { RecentPost } from '@/lib/social'

// ADR 0025 §6.4/§9.1 (Session 32 I2.5). social_backfill_posts carries NO
// authenticated policy at all (deny by default) — service-role only, no
// member-facing variant exists or is needed (staged post text is never
// shown directly; the onboarding page reads run-level summary/progress via
// lib/db/backfill-runs.ts's getBackfillRunsForBusiness instead).

// ADR §6.4 — the claim_post_edit_signals idiom (FOR UPDATE SKIP LOCKED):
// two concurrent claims over the same run never return an overlapping row.
// pending -> claimed, bounded by limit, ORDER BY published_at inside the RPC.
export async function claimBackfillPosts(
  runId: string,
  limit: number,
): Promise<SocialBackfillPostRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('claim_backfill_posts', {
    p_run_id: runId,
    p_limit: limit,
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialBackfillPostRow[] | null) ?? []
}

// ADR §2.3/§9.1 (Session 32 I2.8) — over stage_backfill_posts
// (20260914010000_backfill_fetch_phase_rpcs.sql): idempotent, ON CONFLICT
// (social_account_id, platform_post_id) DO NOTHING. Returns the count of
// rows ACTUALLY inserted (never the input length) — the orchestrator's
// 200-post loop-stop bound is counted against this, not against
// pre-dedup page size, so cross-page/cross-tick duplicates never inflate
// it. Empty input is a no-op that skips the round trip entirely.
export async function stageBackfillPosts(
  runId: string,
  businessId: string,
  socialAccountId: string,
  posts: readonly RecentPost[],
): Promise<number> {
  if (posts.length === 0) return 0
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('stage_backfill_posts', {
    p_run_id: runId,
    p_business_id: businessId,
    p_social_account_id: socialAccountId,
    p_posts: posts.map((post) => ({
      platform_post_id: post.platformPostId,
      published_at: post.publishedAt,
      content: post.content,
      url: post.url,
      format: post.format,
      metrics: post.metrics,
    })),
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as number | null) ?? 0
}

// ADR §4.1 (Session 32 I2.10) — every staged post for a run, for the
// deterministic stats/weighting step. service-role only (the table has NO
// authenticated policy at all, deny by default, per 20260913130000).
export async function getStagedPostsForRun(runId: string): Promise<SocialBackfillPostRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('social_backfill_posts')
    .select('*')
    .eq('run_id', runId)
    .order('published_at', { ascending: false })
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialBackfillPostRow[]) ?? []
}

// ADR §4.1 step 3 BACKFILL-PERFORMANCE-WEIGHTED (Session 32 I2.10) — over
// update_backfill_post_lifts: bulk-writes the lift column from a
// {id, lift}[] array, scoped to run_id. Empty input is a no-op.
export async function updateBackfillPostLifts(
  runId: string,
  lifts: ReadonlyArray<{ id: string; lift: number }>,
): Promise<number> {
  if (lifts.length === 0) return 0
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('update_backfill_post_lifts', {
    p_run_id: runId,
    p_lifts: lifts,
  })
  if (error) throw new Error(getErrorMessage(error))
  return (data as number | null) ?? 0
}
