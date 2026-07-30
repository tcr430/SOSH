import { neutralizeWithSentinels } from '@/lib/ai/wrap-evidence'

// ADR 0019 §5.5 — Studio's draft guard, in the ADR's EXACT order. The order
// is load-bearing [sec-HIGH-1]: reordering or composing these steps
// differently reopens the variation-selector gap and the NFKC-expansion
// pre-check gap this guard exists to close.
//
// Applies uniformly to the draft AND every other user-supplied field
// Studio's own prompt renders (brand-voice descriptor, target audience,
// keywords, avoid_words) — one guard, one cap, no per-field variants. Does
// NOT duplicate lib/ai/*'s five local sanitizeDataField copies (rubric.ts,
// brief.ts, post-generation.ts, post-regeneration.ts,
// formats/native-generation-prompt.ts) — this is the shared
// neutralizeWithSentinels() implementation, imported, not a sixth copy.

// ── The cap, derived (§5.4) ────────────────────────────────────────────────
//
// cap ≈ (maxTokens − rationale_budget) / expansion. These three inputs are
// deliberately named constants (EVIDENCE_MAX_CHARS is the precedent for "a
// cap exists at all" — wrap-evidence.ts:18) rather than folded into one
// magic number, so a future change to the Studio prompt's token budget
// recomputes the cap instead of silently drifting from it.

// The maxTokens the D2.8 suggestion prompt sets via ADR §4.5's new
// Prompt.maxTokens field. Double DEFAULT_MAX_TOKENS (4096,
// lib/ai/runner.ts:26) — a Studio response must carry the ENTIRE revised
// draft plus markers plus a rationale array inside escaped JSON, not just a
// short structured answer.
export const STUDIO_SUGGEST_MAX_TOKENS = 8192

// Headroom reserved for marker tokens, the rationale array, and
// JSON-escaping/structure overhead within STUDIO_SUGGEST_MAX_TOKENS, leaving
// the remainder for echoing the revised draft itself.
export const STUDIO_RATIONALE_BUDGET_TOKENS = 2000

// §5.4: "≈ 2.5–3× to cover markers, JSON escaping and the model expanding
// prose." The conservative (higher) end of the named range is used
// deliberately — it yields the SMALLER, safer cap.
const STUDIO_CAP_EXPANSION_FACTOR = 3

// The authoritative cap in characters (step 6). Tunable MVP defaults above,
// same posture as BRIEF_QUALITY_THRESHOLD (lib/ai/prompts/rubric.ts:19) —
// the ADR fixes the FORMULA and the security property (a derived cap
// exists), not the exact numbers.
export const STUDIO_FIELD_MAX_CHARS = Math.floor(
  (STUDIO_SUGGEST_MAX_TOKENS - STUDIO_RATIONALE_BUDGET_TOKENS) / STUDIO_CAP_EXPANSION_FACTOR,
)

// Step 1's "generous ceiling" on the RAW string, independent of and much
// larger than STUDIO_FIELD_MAX_CHARS — its only job is to reject grossly
// oversized raw input before spending compute on normalize/strip at all.
// Margined well past the ADR's own cited worst-case single-codepoint NFKC
// expansion ratio (U+FDFA → 18 chars, §5.5 step 1) so it never rejects
// legitimate content the authoritative post-normalization cap would still
// accept.
const STUDIO_RAW_LENGTH_CEILING = STUDIO_FIELD_MAX_CHARS * 25

// The plane-15 Private Use Area marker sentinels (ADR §5.1) — U+F0000 open,
// U+F0001 close. Already covered by \p{Co} in neutralizeWithSentinels's
// strip pass; scanned for explicitly here per step 7's final assertion,
// which must be a scan for SENTINEL CODEPOINTS specifically, not for
// well-formed marker tokens. No 'g' flag: used only for a single .test()
// presence check, never iterated — a global flag here would leak
// lastIndex state across calls on this module-scoped RegExp.
const SENTINEL_PATTERN = /[\u{F0000}\u{F0001}]/u

export class StudioGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioGuardError'
  }
}

function truncateToCap(text: string): string {
  if (text.length <= STUDIO_FIELD_MAX_CHARS) return text
  return text.slice(0, STUDIO_FIELD_MAX_CHARS)
}

// Guards one user-supplied field for rendering into a Studio prompt's
// [DATA] block. Returns the neutralized, capped text — not yet
// [DATA]-wrapped, since each caller owns its own field label (mirroring
// wrap-evidence.ts's guard() vs wrapEvidenceForPrompt() split).
export function guardStudioField(rawText: string): string {
  // Step 1 — length pre-check on the RAW string, before any transform. NFKC
  // expands (U+FDFA → 18 chars), so a cap applied only post-normalization
  // lets a small input become a large one.
  if (rawText.length > STUDIO_RAW_LENGTH_CEILING) {
    throw new StudioGuardError('Studio input exceeds the raw length ceiling')
  }

  // Steps 2–5 — NFKC normalize (first among the transforms), strip
  // Cf/Co/Cs/variation-selectors, then neutralize()'s remaining passes
  // ([/DATA] closer, fences, leading brace).
  const neutralized = neutralizeWithSentinels(rawText)

  // Step 6 — truncate to the authoritative, derived cap.
  const truncated = truncateToCap(neutralized)

  // Step 7 — re-run the strip + remaining passes ONCE post-truncation
  // (truncation can cut a multi-codepoint sequence in half, or expose a new
  // leading brace/fence at the new boundary) WITHOUT re-normalizing — never
  // normalize after stripping, since normalization can produce a character
  // an earlier strip pass already ran past. Then assert zero sentinels
  // remain and throw; do NOT loop-strip — a second stripping pass is
  // loop-until-clean, the exact bug class ADR §5.3 [sec-HIGH-4] names
  // (a well-formed-token strip can reconstruct a syntactically valid token
  // from the leftovers of two adjacent well-formed ones).
  const reguarded = neutralizeWithSentinels(truncated, { skipNormalize: true })
  if (SENTINEL_PATTERN.test(reguarded)) {
    throw new StudioGuardError('Studio input still contains a sentinel codepoint after guarding')
  }

  return reguarded
}
