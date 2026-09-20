import type { CampaignRetrospectiveRow } from '@/lib/db/types'

// ADR 0026 §8.4 (Session 33 J2.11) — the sentence a human-acknowledged retrospective writes to memory.
// A CLOSED template around two pieces of MEMBER-EDITABLE text (the campaign name and the hypothesis), so its
// caller MUST pass the result through neutralizeWithSentinels before it reaches performance_memory — which
// acknowledgeRetrospective (lib/db/campaign-retrospectives.ts) does inside the wrapper. This file only shapes
// and BOUNDS the text: the column allows 500 characters, and neutralisation can lengthen a string, so the
// pre-neutralisation text is held well under that.
//
// An inconclusive retrospective writes nothing (ADR 0026 §8.4), so it has no pattern text: null.

const NAME_MAX = 50
const PRE_NEUTRALISATION_MAX = 400

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(max - 1, 0))}…`
}

export function buildRetrospectivePattern(
  retro: Pick<CampaignRetrospectiveRow, 'verdict' | 'n' | 'wins' | 'interval_low' | 'interval_high' | 'hypothesis_snapshot'>,
  campaignName: string,
): string | null {
  if (retro.verdict === 'inconclusive') return null
  const name = clip(campaignName, NAME_MAX)
  const result = retro.verdict === 'supported' ? 'supported' : 'not supported'
  const interval =
    retro.interval_low !== null && retro.interval_high !== null
      ? ` (interval ${Number(retro.interval_low).toFixed(2)}–${Number(retro.interval_high).toFixed(2)})`
      : ''
  const tail = `. Result: ${result} — ${retro.wins} of ${retro.n} posts beat this brand's usual engagement${interval}.`
  const head = `Campaign '${name}' tested: '`
  const hypothesisBudget = PRE_NEUTRALISATION_MAX - head.length - `'${tail}`.length
  return `${head}${clip(retro.hypothesis_snapshot, Math.max(hypothesisBudget, 20))}'${tail}`
}
