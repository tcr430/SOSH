import type { Platform } from '@/lib/db/types'
import { neutralize } from '@/lib/ai/wrap-evidence'

// ADR 0026 §6.4 (Session 33 J2.9, L-2) — the ONE renderer of the observed-outcomes block, shared by the three
// prompt sites (post-generation, post-regeneration, native-generation) so the heading, the n/campaigns rule and
// the neutralisation exist in exactly one place.
//
// A pattern is an OBSERVATION, never a rule: n and campaigns are on EVERY line (OUTCOME-CONFIDENCE-RENDERED),
// and nothing per-post — no likes, no impressions — is ever rendered here (build-guide J2.9 item 4).

export type ObservedOutcome = {
  platform: Platform | null
  pattern: string
  wins: number
  n: number
  campaigns: number
}

export const OBSERVED_OUTCOMES_HEADING = '## Observed outcomes for this brand (probabilistic observations, not rules)'

// Splices the counts before the closed template's final full stop: "…usual engagement." ->
// "…usual engagement in 9 of 11 posts (3 campaigns)." The counts come from the SQL-computed columns, so the
// number shown is never a stale copy.
function line(o: ObservedOutcome): string {
  const base = o.pattern.replace(/[.\s]+$/, '')
  const campaigns = `${o.campaigns} ${o.campaigns === 1 ? 'campaign' : 'campaigns'}`
  return `- ${neutralize(base)} in ${o.wins} of ${o.n} posts (${campaigns}).`
}

// Empty or absent -> null: no block at all. `platform` drops lines for another platform (a LinkedIn post is
// never told what happened on X); a null-platform row is cross-platform and is kept.
export function renderObservedOutcomes(observed: readonly ObservedOutcome[] | undefined, platform: Platform): string | null {
  const relevant = (observed ?? []).filter((o) => o.platform === null || o.platform === platform)
  if (relevant.length === 0) return null
  return `${OBSERVED_OUTCOMES_HEADING}\n[DATA]\n${relevant.map(line).join('\n')}\n[/DATA]`
}
