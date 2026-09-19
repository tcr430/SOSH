// ADR 0026 §12.3 — OUTCOME-ADR0018-UNCHANGED (constraint 29), build-guide J2.2.
//
// ADR 0018 (diff-based learning capture) is the OTHER pipeline into
// performance_memory. ADR 0026 changes none of it: not lib/learning/, not an ADR
// 0018 migration — not even to add an `export` (founder ruling A-6; ADR 0026
// §4.2). If the outcome loop seems to need such a change, that is a STOP, not an
// edit. This is a PATH check by ADR decision ([test-3b]), chosen over a
// behavioural golden; the unmodified lib/learning/*.test.ts suite is the
// behavioural backstop.
//
// This file is the pure decision logic (unit-tested in
// lib/outcomes/__tests__/adr0018-guard.test.ts). scripts/check-adr0018-unchanged.ts
// runs git and calls it. It imports nothing.

// The commit Session 33 Track J branched from: docs-only, so lib/learning and every
// ADR 0018 migration are exactly as Session 32 closed them. The Reviewer and J2.13
// re-run the script against this BASE.
export const ADR0018_BASE_SHA = '75cae307562b3918e0a1408a81455a90a2284acc'

// Everything ADR 0018 owns, as recorded by J2.0 premise 5b. The directory is
// watched as a whole (source AND tests): a changed lib/learning test is a change.
export const ADR0018_WATCHED_MIGRATIONS: readonly string[] = [
  'supabase/migrations/20260726010000_learning_capture.sql',
  'supabase/migrations/20260726020000_performance_memory_pattern_key.sql',
  'supabase/migrations/20260726030000_performance_memory_promotion.sql',
  'supabase/migrations/20260728190000_narrow_voice_write_trigger_message.sql',
  'supabase/migrations/20260728220000_demote_recomputes_contradictions.sql',
  'supabase/migrations/20260822090000_studio_promote_schema.sql',
  'supabase/migrations/20260822093000_learning_generation_kind_and_pattern_bound.sql',
  'supabase/migrations/20260825190000_post_ai_originals_latest_per_post.sql',
]

export const ADR0018_WATCHED_PATHS: readonly string[] = ['lib/learning/', ...ADR0018_WATCHED_MIGRATIONS]

export interface Adr0018Verdict {
  ok: boolean
  // Repo-relative paths that differ from BASE. Empty when ok.
  offenders: string[]
}

// `changedFiles` is the raw output of `git diff --name-only BASE -- <paths>` plus
// any untracked files under the watched paths, one path per entry. Blank lines are
// ignored; backslashes are normalised so a Windows git cannot hide a path.
export function evaluateAdr0018Diff(changedFiles: readonly string[]): Adr0018Verdict {
  const offenders = [...new Set(changedFiles.map((f) => f.trim().replace(/\\/g, '/')).filter((f) => f.length > 0))].sort()
  return { ok: offenders.length === 0, offenders }
}
