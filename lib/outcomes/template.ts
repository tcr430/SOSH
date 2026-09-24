import type { OutcomePatternDimension } from '@/lib/db/memory-performance'

// ADR 0026 §6.4 — the ONE closed template for an outcome pattern's sentence. A pattern is an OBSERVATION,
// never a rule: it never carries a multiplier ("2x") and never an imperative ("use", "always"). Every word
// comes from the fixed vocabularies below; the only inputs are enum values, so no member text can reach the
// sentence, and an out-of-vocabulary value THROWS rather than being interpolated.
//
// The counts ("in 9 of 11 posts (3 campaigns)") are optional here: the worker stores the sentence BEFORE the
// SQL recompute knows them, and retrieval (J2.9) renders them from the row's outcome_wins / outcome_n /
// outcome_distinct_campaigns columns — so the number shown is never a stale copy.

const PLATFORM_LABEL: Record<string, string> = { twitter: 'X', linkedin: 'LinkedIn' }

const ROLE_LABEL: Record<string, string> = {
  anchor_thesis: 'anchor thesis posts',
  founder_perspective: 'founder perspective posts',
  customer_proof: 'customer proof posts',
  objection_response: 'objection response posts',
  conversation_starter: 'conversation starter posts',
  follow_up: 'follow-up posts',
}
const FORMAT_LABEL: Record<string, string> = { single: 'single posts', thread: 'thread posts', carousel: 'carousel posts' }
const LENGTH_LABEL: Record<string, string> = { short: 'short posts', medium: 'medium-length posts', long: 'long posts' }
const CTA_LABEL: Record<string, string> = { true: 'posts with a call to action', false: 'posts without a call to action' }
const ORIGIN_LABEL: Record<string, string> = {
  manual: 'manually briefed posts',
  objective_generated: 'objective-generated posts',
  signal_generated: 'signal-generated posts',
  studio_promoted: 'studio-promoted posts',
}

const SUBJECT: Record<OutcomePatternDimension, Record<string, string>> = {
  role: ROLE_LABEL,
  format: FORMAT_LABEL,
  length_band: LENGTH_LABEL,
  cta: CTA_LABEL,
  origin_mode: ORIGIN_LABEL,
}

export interface OutcomePatternTemplateInput {
  platform: string
  dimension: OutcomePatternDimension
  value: string
  direction: 'above' | 'below'
  // 'rate' on X, 'count' on LinkedIn — decides "usual engagement" vs "usual engagement count".
  basis: 'rate' | 'count'
  counts?: { wins: number; n: number; campaigns: number }
}

export function renderOutcomePattern(input: OutcomePatternTemplateInput): string {
  const platform = PLATFORM_LABEL[input.platform]
  const subject = SUBJECT[input.dimension]?.[input.value]
  if (platform === undefined || subject === undefined) {
    throw new Error(`renderOutcomePattern: out-of-vocabulary cell ${input.platform}/${input.dimension}/${input.value}`)
  }
  const usual = input.basis === 'count' ? "this brand's usual engagement count" : "this brand's usual engagement"
  const verb = input.direction === 'above' ? `beat ${usual}` : `were below ${usual}`
  const tail = input.counts
    ? ` in ${input.counts.wins} of ${input.counts.n} posts (${input.counts.campaigns} ${input.counts.campaigns === 1 ? 'campaign' : 'campaigns'})`
    : ''
  return `On ${platform}, ${subject} ${verb}${tail}.`
}
