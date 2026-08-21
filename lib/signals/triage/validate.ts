// ADR 0021 §4.5 (Session 28 E5.7) — "a card contains no post copy," made
// testable rather than aspirational. Three layers per the ADR; this module
// is layer 2, the Tier-2 deterministic validator. Layer 1 (shape: ≤3 angle
// options, angle ≤120 chars, rationale ≤240 chars) is enforced by the Zod
// schema in card.ts. Layer 3 (structural: no card column is ever read by
// any publishing path) is a source scan, not this module's job.

export const ANGLE_MAX_CHARS = 120
export const RATIONALE_MAX_CHARS = 240
export const MAX_ANGLE_OPTIONS = 3

export interface CardAngleOption {
  angle: string
  rationale: string
}

export interface CardDraftForValidation {
  observation: string
  whyItMatters: string
  audience: string
  angleOptions: readonly CardAngleOption[]
  suggestedObjective?: string | null
  // The signal's own release URL — the ONE URL a card field may legally
  // contain (§4.5).
  allowedUrl: string | null
}

export type CardValidationResult =
  | { ok: true }
  | { ok: false; reason: 'hashtag' | 'mention' | 'emoji' | 'disallowed_url' | 'newline_in_angle' | 'shape'; field: string }

const HASHTAG_PATTERN = /#\w/
const MENTION_PATTERN = /@\w/
// Extended_Pictographic covers the emoji block plus symbol/dingbat
// variants commonly rendered as emoji — the same class a hashtag/mention
// check exists alongside for the same reason: post-copy affordances, not
// strategy-option prose.
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u
const URL_PATTERN = /https?:\/\/[^\s)"'\]]+/g

function findDisallowedUrl(text: string, allowedUrl: string | null): string | null {
  const matches = text.match(URL_PATTERN)
  if (!matches) return null
  for (const url of matches) {
    if (allowedUrl === null || url !== allowedUrl) return url
  }
  return null
}

function checkField(field: string, text: string, allowedUrl: string | null): CardValidationResult {
  if (HASHTAG_PATTERN.test(text)) return { ok: false, reason: 'hashtag', field }
  if (MENTION_PATTERN.test(text)) return { ok: false, reason: 'mention', field }
  if (EMOJI_PATTERN.test(text)) return { ok: false, reason: 'emoji', field }
  if (findDisallowedUrl(text, allowedUrl) !== null) return { ok: false, reason: 'disallowed_url', field }
  return { ok: true }
}

// §4.5 layer 2 — deterministic, Tier 2. Runs AFTER Zod's shape check
// (card.ts), so angleOptions.length <= 3 and per-field length bounds are
// already guaranteed by the time this runs; this module checks CONTENT.
export function validateCardDraft(draft: CardDraftForValidation): CardValidationResult {
  const scalarFields: Array<[string, string]> = [
    ['observation', draft.observation],
    ['whyItMatters', draft.whyItMatters],
    ['audience', draft.audience],
  ]
  if (draft.suggestedObjective) scalarFields.push(['suggestedObjective', draft.suggestedObjective])

  for (const [field, text] of scalarFields) {
    const result = checkField(field, text, draft.allowedUrl)
    if (!result.ok) return result
  }

  if (draft.angleOptions.length > MAX_ANGLE_OPTIONS) {
    return { ok: false, reason: 'shape', field: 'angleOptions' }
  }

  for (let i = 0; i < draft.angleOptions.length; i++) {
    const option = draft.angleOptions[i]
    const angleField = `angleOptions[${i}].angle`
    const rationaleField = `angleOptions[${i}].rationale`

    if (option.angle.length > ANGLE_MAX_CHARS || option.rationale.length > RATIONALE_MAX_CHARS) {
      return { ok: false, reason: 'shape', field: angleField }
    }
    // A newline inside an ANGLE specifically (§4.5) — an angle is a noun
    // phrase describing an approach, not a multi-line sentence of copy.
    // Rationale is prose and may legitimately wrap.
    if (option.angle.includes('\n')) {
      return { ok: false, reason: 'newline_in_angle', field: angleField }
    }

    const angleCheck = checkField(angleField, option.angle, draft.allowedUrl)
    if (!angleCheck.ok) return angleCheck
    const rationaleCheck = checkField(rationaleField, option.rationale, draft.allowedUrl)
    if (!rationaleCheck.ok) return rationaleCheck
  }

  return { ok: true }
}
