import { AiError } from '@/lib/ai/errors'
import type { ThreadOutput, CarouselOutput } from './schemas'

// ADR 0017 §4.2 [type-3] — POLICY, kept separate from the schema. Structural
// bounds (thread length 3..8) are in the zod schema (same failure channel as
// parsing, always-on). This is everything else: a rule that is true of a
// SHAPE-VALID payload but still violates the L-8 thread guardrail — the
// hook opens, the close closes, at least one pull_quote substantiates. Kept
// out of the schema so it can vary independently later (e.g. per-platform)
// without touching the type-safety-critical parse file, and so a policy
// failure produces a DISTINGUISHABLE AiError code ('policy_violation') from
// a shape/parse failure ('invalid_response') — generate-native.ts's
// re-prompt (§4.4) uses this to send a targeted correction rather than a
// generic "try again."
export function validateThreadPolicy(output: ThreadOutput): void {
  const { posts } = output
  const problems: string[] = []

  if (posts[0]?.role !== 'hook') {
    problems.push(`the first post's role must be 'hook' (was '${posts[0]?.role}')`)
  }
  if (posts[posts.length - 1]?.role !== 'close') {
    problems.push(`the last post's role must be 'close' (was '${posts[posts.length - 1]?.role}')`)
  }
  if (!posts.some((p) => p.role === 'pull_quote')) {
    problems.push(`at least one post must have role 'pull_quote'`)
  }

  if (problems.length > 0) {
    throw new AiError('policy_violation', `Thread role sequence violates policy: ${problems.join('; ')}`)
  }
}

// ADR 0022 §6.2 (Session 29, F1b.7) — mirrors validateThreadPolicy's shape
// exactly: structural bounds (slide count) stay in the zod schema; this is
// the SHAPE-VALID-but-still-policy-violating case — first slide isn't a
// cover, or nothing closes the carousel with a call to action. No "last
// slide must be X" rule (unlike thread's close requirement) — the guide
// names only these two.
export function validateCarouselPolicy(output: CarouselOutput): void {
  const { slides } = output
  const problems: string[] = []

  if (slides[0]?.role !== 'cover') {
    problems.push(`the first slide's role must be 'cover' (was '${slides[0]?.role}')`)
  }
  if (!slides.some((s) => s.role === 'cta')) {
    problems.push(`at least one slide must have role 'cta'`)
  }

  if (problems.length > 0) {
    throw new AiError('policy_violation', `Carousel role sequence violates policy: ${problems.join('; ')}`)
  }
}
