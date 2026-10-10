import {
  FIXTURE_POSTS,
  FIXTURE_POST_METRICS,
  FIXTURE_POST_OUTCOMES,
  FIXTURE_POST_DIMENSIONS,
} from './portfolio'
import type { AnalyticsPostRecord } from '../types'

// Test-side adapter: turns the portfolio fixture's ROWS into the shape the pure aggregation takes. It applies the
// same row filters the O2.4 readers will (status 'published', not soft-deleted, one business) and does NOTHING
// else: no counting, no median, no win share. The expected numbers live in portfolio.ts `EXPECTED` as literals,
// so this adapter can never be its own oracle.
export function fixtureRecords(businessId: string): AnalyticsPostRecord[] {
  const outcomes = new Map(FIXTURE_POST_OUTCOMES.map((o) => [o.post_id, o]))
  const metrics = new Map(FIXTURE_POST_METRICS.map((m) => [m.post_id, m]))
  const dims = new Map(FIXTURE_POST_DIMENSIONS.map((d) => [d.ai_original_id, d]))

  return FIXTURE_POSTS.filter((p) => p.business_id === businessId && p.status === 'published' && p.deleted_at === null).map((p) => {
    const o = outcomes.get(p.id)
    const mt = metrics.get(p.id)
    const d = o?.ai_original_id ? dims.get(o.ai_original_id) : undefined
    const publishedAt = p.published_at as string
    return {
      post: { postId: p.id, platform: p.platform, publishedAt },
      metrics: mt ? { likes: mt.likes, comments: mt.comments, shares: mt.shares, impressions: mt.impressions } : null,
      outcome: o
        ? {
            postId: p.id,
            platform: o.platform,
            basis: o.metric_basis,
            value: o.value,
            publishedAt: o.published_at,
            beatBaseline: o.beat_baseline,
            baselineSource: o.baseline_source,
            lengthBand: o.length_band,
            ctaPresent: o.cta_present,
            hookSurvived: o.hook_survived,
            dimensions: d ? { role: d.role, format: d.format, originMode: d.origin_mode, hookType: d.hook_type } : null,
          }
        : null,
    }
  })
}
