// ADR 0021 §10.4 (Session 28 E5.8) — deterministic classifier mapping a
// no_card TriageDecision's free-text `reason` into one of insight_cards'
// dismiss_reason enum values, for the eval harness's dismiss-match metric
// ONLY. TriageDecisionSchema (lib/ai/tool-runner.ts) has no dismiss_reason
// field itself — that column is normally set by a human dismissing a card in
// the UI, not by Stage C. Keyword-based and intentionally simple: it exists
// to measure whether the model's stated reasoning lines up with the
// human-labelled corpus category, not to run in production.

export type DismissReason = 'too_sensitive' | 'already_covered' | 'weak_evidence' | 'wrong_timing' | 'not_relevant'

const KEYWORD_RULES: Array<{ reason: DismissReason; patterns: RegExp[] }> = [
  {
    reason: 'too_sensitive',
    patterns: [/security/i, /vulnerabilit/i, /\bcve\b/i, /breach/i, /incident/i, /exposure/i, /exploit/i],
  },
  {
    reason: 'already_covered',
    patterns: [/already (announced|covered|carded)/i, /duplicate of/i, /not a new (story|capability)/i],
  },
  {
    reason: 'wrong_timing',
    patterns: [/too (early|premature)/i, /\bbeta\b/i, /\balpha\b/i, /not yet stable/i, /premature/i],
  },
  {
    reason: 'weak_evidence',
    patterns: [/vague/i, /insufficient detail/i, /unclear/i, /no concrete/i, /not enough evidence/i],
  },
  {
    reason: 'not_relevant',
    patterns: [/no external (customer )?audience/i, /internal[- ](tooling|contributor)/i, /not relevant/i, /community housekeeping/i],
  },
]

// First matching rule wins, in the array order above — the order encodes
// priority for reasons that could plausibly match more than one bucket
// (e.g. a vague security patch reads as both too_sensitive and
// weak_evidence; too_sensitive is checked first because it is the higher-
// stakes miscategorization).
export function classifyDismissReason(reasonText: string): DismissReason {
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(reasonText))) {
      return rule.reason
    }
  }
  return 'not_relevant'
}
