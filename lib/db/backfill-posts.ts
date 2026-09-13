import type { SocialBackfillPostRow } from './types'
import { getErrorMessage } from './utils'

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
