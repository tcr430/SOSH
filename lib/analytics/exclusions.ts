import { isValid, parseISO } from 'date-fns'
import { eligibleValue, type OutcomeMetrics } from '@/lib/outcomes/normalise'
import { ANALYTICS_FINAL_AFTER_DAYS } from './constants'
import type { AnalyticsPost, AnalyticsPostRecord } from './types'

// ADR 0031 §2.5 — excluded posts are not random (null fields and zero impressions are likely the weaker posts), so
// the median would be biased upward if they vanished silently. Every published post is therefore MEASURED or
// COUNTED under exactly one reason, from a closed union, derived read-only.
//
// `post_outcomes` stores no exclusion reason, so the reason is recovered by passing the post's `post_metrics` row
// through the EXISTING `eligibleValue`, the very function that decided not to write the outcome. It is called, not
// copied (ANALYTICS-EXCLUSION-REASON-FROM-NORMALISER), so this surface cannot disagree with the extractor.

export type ExclusionReason = 'not_final' | 'no_data_returned' | 'field_missing' | 'zero_impressions'

const DAY_MS = 86_400_000

function at(iso: string): number {
  const t = parseISO(iso)
  if (!isValid(t)) throw new Error(`analytics exclusions: non-finite timestamp ${JSON.stringify(iso)}`)
  return t.getTime()
}

/** The reason a published post is not in the measured set, or null when it IS (an outcome row exists). */
export function exclusionReason(
  post: AnalyticsPost,
  outcome: { postId: string } | null,
  metrics: OutcomeMetrics | null,
  now: string,
): ExclusionReason | null {
  if (outcome !== null) return null
  // Younger than maturity plus grace (day 9) with no outcome row: not final yet, whatever its raw counts say.
  if (at(now) < at(post.publishedAt) + ANALYTICS_FINAL_AFTER_DAYS * DAY_MS) return 'not_final'
  if (metrics === null) return 'no_data_returned'
  const eligible = eligibleValue(post.platform, metrics)
  // Eligible yet no outcome row: the extractor has not written it. Counted, never hidden.
  if (eligible.ok) return 'no_data_returned'
  switch (eligible.reason) {
    case 'null_field':
      return 'field_missing'
    case 'zero_impressions':
      return 'zero_impressions'
    case 'unsupported_platform':
      return 'no_data_returned'
  }
}

export interface ExclusionCounts {
  published: number
  measured: number
  noDataReturned: number
  fieldMissing: number
  zeroImpressions: number
  notFinal: number
}

export function countExclusions(records: readonly AnalyticsPostRecord[], now: string): ExclusionCounts {
  const counts: ExclusionCounts = { published: records.length, measured: 0, noDataReturned: 0, fieldMissing: 0, zeroImpressions: 0, notFinal: 0 }
  for (const r of records) {
    switch (exclusionReason(r.post, r.outcome, r.metrics, now)) {
      case null:
        counts.measured += 1
        break
      case 'not_final':
        counts.notFinal += 1
        break
      case 'no_data_returned':
        counts.noDataReturned += 1
        break
      case 'field_missing':
        counts.fieldMissing += 1
        break
      case 'zero_impressions':
        counts.zeroImpressions += 1
        break
    }
  }
  return counts
}
