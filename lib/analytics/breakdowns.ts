import { ANALYTICS_COMPARE_FLOOR, ANALYTICS_HOOK_TYPE_FLOOR, type BreakdownDimension } from './constants'
import { assertOneBasis, wilsonInterval } from './rates'
import type { AnalyticsOutcome } from './types'

// ADR 0031 §2.6 — the Pro breakdowns. The metric per dimension value is WIN SHARE ("{wins} of {n} beat your usual"),
// never a raw rate: win share is already relative to the brand's own baseline, so a breakdown cannot compare raw rates
// across posts with very different reach. It is a per-period description and is NEVER a series: this module exports one
// function and no per-period or trend helper.
//
//   * `role`, `format`, `origin_mode` (post_dimensions) and `hook_type` cover AI-written posts only.
//   * `length_band` and `cta_present` are measured from the published artefact, so they cover ALL measured posts.
//   * `hook_type` counts only where hook_survived = true and a value needs ANALYTICS_HOOK_TYPE_FLOOR posts.
//   * Bars (and a Wilson interval) need ANALYTICS_COMPARE_FLOOR posts on EVERY value of the dimension; with one thin
//     value the whole dimension is counts only, labelled provisional.

export interface BreakdownValue {
  value: string
  wins: number
  of: number
  provisional: boolean
  interval: { lo: number; hi: number } | null
}

export interface Breakdown {
  dimension: BreakdownDimension
  population: 'ai_only' | 'all_measured'
  /** "Covers {k} of {n} measured posts." */
  coverage: { k: number; n: number }
  presentation: 'counts' | 'bars'
  values: BreakdownValue[]
}

function valueOf(dimension: BreakdownDimension, o: AnalyticsOutcome): string | null {
  switch (dimension) {
    case 'role':
      return o.dimensions?.role ?? null
    case 'format':
      return o.dimensions?.format ?? null
    case 'origin_mode':
      return o.dimensions?.originMode ?? null
    case 'hook_type':
      return o.hookSurvived === true ? (o.dimensions?.hookType ?? null) : null
    case 'length_band':
      return o.lengthBand
    case 'cta_present':
      return o.ctaPresent === null ? null : String(o.ctaPresent)
  }
}

export function winShareBreakdown(dimension: BreakdownDimension, outcomes: readonly AnalyticsOutcome[]): Breakdown {
  assertOneBasis(outcomes, 'breakdown')
  const population = dimension === 'length_band' || dimension === 'cta_present' ? 'all_measured' : 'ai_only'

  const groups = new Map<string, { wins: number; of: number }>()
  let classified = 0
  for (const o of outcomes) {
    const value = valueOf(dimension, o)
    if (value === null) continue
    classified += 1
    if (o.beatBaseline === null) continue // no baseline yet: not a loss, not in "of"
    const group = groups.get(value) ?? { wins: 0, of: 0 }
    group.of += 1
    if (o.beatBaseline) group.wins += 1
    groups.set(value, group)
  }

  const shown = [...groups.entries()]
    .filter(([, g]) => dimension !== 'hook_type' || g.of >= ANALYTICS_HOOK_TYPE_FLOOR)
    .sort(([a], [b]) => a.localeCompare(b))
  const presentation = shown.length >= 2 && shown.every(([, g]) => g.of >= ANALYTICS_COMPARE_FLOOR) ? 'bars' : 'counts'

  return {
    dimension,
    population,
    coverage: { k: classified, n: outcomes.length },
    presentation,
    values: shown.map(([value, g]) => ({
      value,
      wins: g.wins,
      of: g.of,
      provisional: presentation === 'counts',
      interval: presentation === 'bars' ? wilsonInterval(g.wins, g.of) : null,
    })),
  }
}
