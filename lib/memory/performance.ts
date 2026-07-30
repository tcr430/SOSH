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
  // platform is nullable: a distilled governed pattern can be cross-platform
  // (MINOR-3). null means "across platforms", NOT "unknown" — the prompt
  // renders it as such rather than dropping the row or guessing a platform.
  platform: Platform | null
  topContent: string
  // Optional: a governed pattern is a distilled insight, not a specific post,
  // so it carries no per-post metrics — these are OMITTED for governed rows
  // rather than invented as 0 (MINOR-2). The post_metrics fallback still
  // populates them with real counts.
  likes?: number
  impressions?: number
  // ADR 0019 §8.2 [type-§6a/§6c] — EXPLICIT discriminant, added because the
  // ACCIDENTAL one ('likes' in p) is unsound: likes/impressions are
  // omitted-not-zeroed for governed rows today, so `'likes' in p` currently
  // happens to work as a provenance test, but it is an undeclared invariant
  // — the next person who "fixes" the optionals by defaulting them to 0
  // would silently invert it, making every fallback row look citable. Only
  // 'governed' rows may be offered as a citation (§8.1/§8.2): a
  // derived_from_metrics row means "one of your posts got a lot of likes,"
  // and citing it as "your governed memory says X" is a category lie, not a
  // hallucination.
  provenance: 'governed' | 'derived_from_metrics'
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
    // A governed row's platform is nullable — a distilled pattern can be
    // cross-platform. Such rows are KEPT (MINOR-3), carrying platform: null
    // through to the prompt, which renders them "Across platforms". They are
    // never guessed at (e.g. defaulting null to 'linkedin' would assert a
    // platform the record does not claim), and never dropped (dropping them
    // silently under-filled the cap for cross-platform-only businesses).
    const ranked = rankAndCap(governedCandidates, queryContext, PERFORMANCE_CAP)
    // A governed pattern ("technical-comparison posts perform well for CTO
    // audiences") is a distilled insight, not a specific post — it has no
    // real per-post like/impression counts. likes/impressions are OMITTED
    // (MINOR-2), not invented as 0: a literal "0 likes, 0 impressions" would
    // read to the model as evidence the pattern performs badly, inverting the
    // store's intent once Track C (ADR 0018) populates this table.
    return ranked.map(record => ({
      platform: record.platform,
      topContent: record.pattern,
      provenance: 'governed' as const,
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
      provenance: 'derived_from_metrics' as const,
    }))
    // Defense-in-depth (L-4): don't rely solely on listTopPostMetrics's
    // limit param honouring PERFORMANCE_CAP — this layer enforces its own
    // output cap regardless of what the DB layer returns.
    .slice(0, PERFORMANCE_CAP)
}

// ADR 0019 §8.2 — Studio's OWN governed-only retrieval, through the barrel.
// buildCustomerContext retrieves with an EMPTY MemoryQueryContext
// (lib/ai/context.ts:58/:40-46) since it is business-scoped, not per-post;
// Studio wants platform-relevant patterns AND, unlike buildCustomerContext,
// must NEVER admit a derived_from_metrics row as a citation — offering a
// fallback row as "your governed memory" would be a category lie, not a
// hallucination (§8.2). So this function has NO fallback branch at all: if
// performance_memory ships empty (Track A, ADR 0016 §3.4), it returns [],
// exactly as §8.2 states the launch reality plainly rather than papering
// over it with a fallback that would be uncitable anyway.
//
// Reads ONLY through listPerformanceMemoryCandidates — the ACTIVE-FILTERED
// reader (.eq('status','active') at lib/db/memory-performance.ts:20,
// unexpired at :29) — never through listDistilledPatternsForSummary
// (:66-83), the deliberately UNFILTERED reader the summarizer uses. Routing
// Studio through that one would evaporate the "active" half of L-11 with no
// type-level signal to catch it; this function's implementation is the
// enforcement.
export async function retrieveStudioPerformancePatterns(
  client: SupabaseClient,
  businessId: string,
  queryContext: MemoryQueryContext,
  limit: number = MEMORY_CANDIDATE_LIMIT,
): Promise<PerformancePattern[]> {
  const governedCandidates = await listPerformanceMemoryCandidates(client, businessId, limit)
  const ranked = rankAndCap(governedCandidates, queryContext, PERFORMANCE_CAP)
  return ranked.map(record => ({
    platform: record.platform,
    topContent: record.pattern,
    provenance: 'governed' as const,
  }))
}
