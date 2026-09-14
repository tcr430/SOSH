import type { SocialBackfillPostRow } from '@/lib/db/types'
import { updateBackfillPostLifts } from '@/lib/db/backfill-posts'
import { computeEngagementBaseline, postEngagementValue } from './stats'
import { BACKFILL_WEIGHTED_SUBSET } from './constants'

// ADR 0025 §4.1 step 3 BACKFILL-PERFORMANCE-WEIGHTED (Session 32 I2.10) —
// each post gets lift = engagement / baseline. The weighted subset is the
// top BACKFILL_WEIGHTED_SUBSET (30) posts by lift, ties broken by newer
// publishedAt. If NO post in the run has metrics (the LinkedIn case), the
// subset is the 30 most recent and weighting='unweighted_no_metrics'.

export type BackfillWeighting = 'weighted' | 'unweighted_no_metrics'

export interface WeightedSubsetResult {
  subset: SocialBackfillPostRow[]
  lifts: ReadonlyMap<string, number>
  weighting: BackfillWeighting
}

export function computeWeightedSubset(posts: readonly SocialBackfillPostRow[]): WeightedSubsetResult {
  const { baseline, basis } = computeEngagementBaseline(posts)

  if (basis === 'none' || baseline <= 0) {
    const subset = [...posts]
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .slice(0, BACKFILL_WEIGHTED_SUBSET)
    return { subset, lifts: new Map(), weighting: 'unweighted_no_metrics' }
  }

  const lifts = new Map<string, number>()
  for (const post of posts) {
    const value = postEngagementValue(post, basis)
    if (value !== null) lifts.set(post.id, value / baseline)
  }

  const ranked = posts
    .filter((post) => lifts.has(post.id))
    .sort((a, b) => {
      const diff = lifts.get(b.id)! - lifts.get(a.id)!
      if (diff !== 0) return diff
      return new Date(b.published_at).getTime() - new Date(a.published_at).getTime() // ties: newer first
    })

  return { subset: ranked.slice(0, BACKFILL_WEIGHTED_SUBSET), lifts, weighting: 'weighted' }
}

// The write side — through lib/db/backfill-posts.ts, never a direct
// Supabase call from this file. Only posts with a computable lift are
// written; a post excluded from ranking (no metrics under this run's
// basis) keeps its lift column NULL rather than being written as 0, which
// would falsely claim "measured, and it measured zero."
export async function writeBackfillLifts(runId: string, lifts: ReadonlyMap<string, number>): Promise<number> {
  const entries = Array.from(lifts.entries()).map(([id, lift]) => ({ id, lift }))
  return updateBackfillPostLifts(runId, entries)
}
