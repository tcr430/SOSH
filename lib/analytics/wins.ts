import { assertOneBasis } from './rates'
import type { AnalyticsOutcome } from './types'

// ADR 0031 §2.4 — "{wins} of {n} posts beat your usual engagement", for the SELECTED period and ONE platform only.
//
//   * n counts only rows where beat_baseline IS NOT NULL. A post with no baseline yet is not a loss and is not in n;
//     it is shown separately from the median's n (the median counts every measured post).
//   * Wins are never pooled across platforms or bases: the baselines differ (a 90-day median against the last 20, with
//     LinkedIn's growth bias), so ADR 0031 §2.3 forbids the pool. The absence of a pooling function IS the test.
//   * `log_lift` is not an input and is not read.

export interface WinsResult {
  wins: number
  of: number
  /** How many of the counted rows were compared against the history the customer imported (disclosed beside the count). */
  importSeed: number
}

export function winsOf(outcomes: readonly AnalyticsOutcome[]): WinsResult {
  assertOneBasis(outcomes, 'wins')
  let wins = 0
  let of = 0
  let importSeed = 0
  for (const o of outcomes) {
    if (o.beatBaseline === null) continue
    of += 1
    if (o.beatBaseline) wins += 1
    if (o.baselineSource === 'import_seed') importSeed += 1
  }
  return { wins, of, importSeed }
}

/** One result per platform, ordered by platform: never a total. */
export function winsByPlatform(outcomes: readonly AnalyticsOutcome[]): Array<{ platform: string } & WinsResult> {
  const byPlatform = new Map<string, AnalyticsOutcome[]>()
  for (const o of outcomes) byPlatform.set(o.platform, [...(byPlatform.get(o.platform) ?? []), o])
  return [...byPlatform.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([platform, rows]) => ({ platform, ...winsOf(rows) }))
}
