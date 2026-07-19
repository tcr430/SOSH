import type { SupabaseClient } from '@supabase/supabase-js'
import type { Platform } from '@/lib/db/types'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'
import { MEMORY_CANDIDATE_LIMIT } from '@/lib/db/memory-constants'
import { rankAndCap, type MemoryQueryContext } from './scoring'
import { PERFORMANCE_CAP } from './constants'

// The CustomerContext['recentPostPerformance'] shape (lib/ai/context.ts) —
// this is what B3 rewires context.ts to consume, so the shape must match it
// exactly (MEM-CONTEXT-EQUIVALENT, ADR §6).
export type PerformancePattern = {
  platform: Platform
  topContent: string
  likes: number
  impressions: number
}

// ADR 0016 §3.4 SPECIAL CASE — performance_memory ships EMPTY in Track A;
// Track C's distillation worker is its writer (out of scope here, L-1). So
// this function prefers governed performance_memory rows when Track C has
// populated them, and falls back to the CURRENT post_metrics-derived
// behaviour (context.ts:43,47-60, unchanged logic) while the table is
// empty — this is what keeps B3's rewire behaviour-equivalent: today, this
// always takes the fallback branch and returns exactly what
// buildCustomerContext already computes today, just capped at 3 instead of
// (up to) 10.
export async function retrieveRelevant(
  client: SupabaseClient,
  businessId: string,
  queryContext: MemoryQueryContext,
  limit: number = MEMORY_CANDIDATE_LIMIT,
): Promise<PerformancePattern[]> {
  const governedCandidates = await listPerformanceMemoryCandidates(client, businessId, limit)

  if (governedCandidates.length > 0) {
    // A governed row's platform is nullable (a pattern can be cross-platform
    // or platform-agnostic). PerformancePattern's shape requires a real
    // Platform — silently guessing one (e.g. defaulting null to 'linkedin')
    // would assert a specific platform as fact when the record doesn't
    // claim one, corrupting what reaches the generation prompt. A row this
    // shape genuinely cannot represent is excluded, not guessed at — filtered
    // BEFORE ranking so an unmappable low-value row can't crowd out a
    // mappable one within the cap.
    const mappable = governedCandidates.filter(
      (record): record is typeof record & { platform: NonNullable<typeof record.platform> } =>
        record.platform !== null,
    )
    const ranked = rankAndCap(mappable, queryContext, PERFORMANCE_CAP)
    // A governed pattern ("technical-comparison posts perform well for CTO
    // audiences") is a distilled insight, not a specific post — it has no
    // real per-post like/impression counts. likes/impressions are 0, not
    // omitted, because PerformancePattern's shape (matching CustomerContext)
    // requires numbers; this mapping is Track A's placeholder and is
    // expected to be revisited once Track C (ADR 0018) actually populates
    // this table and a consumer (ADR 0017) needs richer pattern context.
    return ranked.map(record => ({
      platform: record.platform,
      topContent: record.pattern,
      likes: 0,
      impressions: 0,
    }))
  }

  const { listTopPostMetrics } = await import('@/lib/db/post-metrics')
  const { listPostsByIds } = await import('@/lib/db/posts')

  const topMetrics = await listTopPostMetrics(client, businessId, PERFORMANCE_CAP)
  if (topMetrics.length === 0) return []

  const postIds = topMetrics.map(m => m.post_id)
  const posts = await listPostsByIds(client, postIds)
  const postsById = Object.fromEntries(posts.map(p => [p.id, p]))

  return topMetrics
    .filter(m => postsById[m.post_id] !== undefined)
    .map(m => ({
      platform: postsById[m.post_id].platform,
      topContent: postsById[m.post_id].content,
      likes: m.likes ?? 0,
      impressions: m.impressions ?? 0,
    }))
    // Defense-in-depth (L-4): don't rely solely on listTopPostMetrics's
    // limit param honouring PERFORMANCE_CAP — this layer enforces its own
    // output cap regardless of what the DB layer returns.
    .slice(0, PERFORMANCE_CAP)
}
