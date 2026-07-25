import { AiError } from '@/lib/ai/errors'
import type { ThreadOutput } from './schemas'

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
