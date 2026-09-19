import type { SocialBackfillPostRow, Platform } from '@/lib/db/types'
import { importPerformanceItem } from '@/lib/memory/import'
import { BACKFILL_PATTERN_MIN_N, BACKFILL_PATTERN_MIN_LIFT, BACKFILL_CONFIDENCE_CEILING } from '../constants'

// ADR 0025 §4.3 (Session 32 I2.10) — "format patterns — deterministic. A
// format with n >= 5 backing posts whose median lift >= 1.25." NO model
// call anywhere in this file.

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ADR §4.3 — confidence = 0.6 * n/(n+5), ceiling 0.6. THE ONLY PLACE this
// formula lives — I2.11's model-derived topic/hook/proof_type patterns
// reuse this exact function, never a re-typed copy of the arithmetic.
export function importedConfidence(n: number): number {
  return Math.min(BACKFILL_CONFIDENCE_CEILING, BACKFILL_CONFIDENCE_CEILING * (n / (n + 5)))
}

export interface FormatPatternCandidate {
  format: string
  n: number
  medianLift: number
  backingPostIds: string[]
  newestPublishedAt: string
}

// Computed over every post carrying a lift (from weighting.ts's
// computeWeightedSubset — NOT restricted to just the top-30 weighted
// subset, since a format needs n >= 5 backing posts to qualify at all,
// which the 30-post subset alone may not contain enough of).
export function computeFormatPatterns(
  posts: readonly SocialBackfillPostRow[],
  lifts: ReadonlyMap<string, number>,
): FormatPatternCandidate[] {
  const byFormat = new Map<string, SocialBackfillPostRow[]>()
  for (const post of posts) {
    if (!lifts.has(post.id)) continue
    const group = byFormat.get(post.format) ?? []
    group.push(post)
    byFormat.set(post.format, group)
  }

  const candidates: FormatPatternCandidate[] = []
  for (const [format, group] of byFormat) {
    if (group.length < BACKFILL_PATTERN_MIN_N) continue
    const groupLifts = group.map((post) => lifts.get(post.id)!)
    const medianLift = median(groupLifts)
    if (medianLift < BACKFILL_PATTERN_MIN_LIFT) continue

    const newest = group.reduce((latest, post) => (post.published_at > latest ? post.published_at : latest), group[0].published_at)
    candidates.push({
      format,
      n: group.length,
      medianLift,
      backingPostIds: group.map((post) => post.platform_post_id),
      newestPublishedAt: newest,
    })
  }
  return candidates
}

// The write side — through lib/memory/import.ts (I2.7), never a direct
// lib/db/memory-* call from this file (MEM-NO-DIRECT-TABLE-ACCESS).
export async function writeFormatPatterns(
  businessId: string,
  runId: string,
  platform: Platform,
  candidates: readonly FormatPatternCandidate[],
): Promise<void> {
  for (const candidate of candidates) {
    await importPerformanceItem({
      businessId,
      runId,
      sourcePostIds: candidate.backingPostIds,
      dimension: 'format',
      pattern: `Posts in ${candidate.format} format perform above your account's baseline`,
      platform,
      confidence: importedConfidence(candidate.n),
      observationCount: candidate.n,
      newestPublishedAt: candidate.newestPublishedAt,
    })
  }
}
