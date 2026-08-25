import type { Platform } from '@/lib/db/types'

export type FormatFamily = 'single' | 'thread' | 'carousel'

// ADR 0017 §4.3 — a deterministic Tier-0 lookup, never model-chosen (a
// model-chosen family would be nondeterministic and unverifiable). linkedin/
// facebook/instagram are single-post only — there is no thread concept for a
// caption or a feed post. twitter and threads share the SAME content-volume
// guardrail (their distinctness is in PLATFORM_CONSTRAINTS' TEXT — tone,
// link-penalty — not in this selection rule): fewer than 3 tweets' worth of
// content stays a single post; 3..8 becomes a thread, matching the schema's
// own 3..8 bound (formats/schemas.ts).
//
// `estimatedTweetsWorth` is caller-supplied (B2.6's Stage D orchestration is
// responsible for computing it, e.g. from the brief's planned content
// density for this slot) — this function only encodes the threshold rule.
// B2.4 type-design-analyzer finding (MINOR, accepted as-is): a bare `number`
// admits a negative or NaN value from a buggy caller. The failure direction
// is deliberately safe rather than tightened here — `>= 3` is false for both
// negatives and NaN, so a bad upstream value silently degrades to the
// cheaper, always-valid 'single' family rather than producing an invalid
// state. A caller-side unit/sign bug would be absorbed quietly rather than
// surfaced loudly; revisit with a stricter input type if B2.6 shows this
// happening in practice.
// ADR 0022 §6.3/A-4 (Session 29, F1b.7) — carouselRequested is a THIRD,
// REQUIRED parameter (never optional): with exactly two real callers today
// (generate-native.ts:106, studio-suggestion.ts:142 — Session 29-D, D7
// (NIT-6) corrected these line numbers; both grepped, not assumed) and both
// passing `false`, EVERY call that exists resolves
// byte-identically to before this change, so L-10 holds in its strict form.
// A volume-derived trigger was rejected precisely because it would change
// the result for inputs that already exist — this parameter changes it for
// NO existing input, only for a call that opts in explicitly. Instagram's
// arm is the only one made conditional on it; every other arm (linkedin/
// facebook's unconditional 'single', twitter/threads' volume rule) is
// UNTOUCHED.
export function selectFormatFamily(platform: Platform, estimatedTweetsWorth: number, carouselRequested: boolean): FormatFamily {
  switch (platform) {
    case 'linkedin':
    case 'facebook':
      return 'single'
    case 'instagram':
      return carouselRequested ? 'carousel' : 'single'
    case 'twitter':
    case 'threads':
      return estimatedTweetsWorth >= 3 ? 'thread' : 'single'
  }
}
