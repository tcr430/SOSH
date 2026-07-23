import type { CampaignBriefContent } from '@/lib/db/types'
import type { ThreadOutput } from '@/lib/ai/prompts/formats/schemas'

// ADR 0017 §8 — the deterministic consistency pass (Tier 0, free). Two of
// the three shipped checks; nativeness is the rubric's platformNativeness
// dimension (already available via B2.2, scored per-post in generate.ts's
// hook loop / consistency call site, not duplicated here). Cross-set
// redundancy is explicitly DEFERRED behind MODE2-REDUNDANCY-UNDEFER — not
// built in this file, per ADR §8 item 4 and session-24 B2.6's own STOP note.

export interface RoleCoverageResult {
  ok: boolean
  missingOrders: number[]
}

// [type-6] — positional cross-check against the frozen brief's roleSequence.
// Each generated post is tagged with the `order` of the roleSequence entry
// it was generated FROM (assigned before generation, not discovered after —
// see generate.ts), so "coverage" here means every entry that was SUPPOSED
// to produce a post actually did. A pure function, independently testable
// with a deliberately incomplete `generated` set regardless of whether
// generate.ts's own control flow can currently produce that state.
export function checkRoleCoverage(
  generated: Array<{ order: number }>,
  expected: CampaignBriefContent['roleSequence'],
): RoleCoverageResult {
  const generatedOrders = new Set(generated.map((g) => g.order))
  const missingOrders = expected.map((e) => e.order).filter((order) => !generatedOrders.has(order))
  return { ok: missingOrders.length === 0, missingOrders }
}

export interface LinkPlacementResult {
  ok: boolean
  violations: string[]
}

const URL_PATTERN = /https?:\/\/|www\./i

// ADR §8 item 2 — CTA/outbound links never in tweet 1 (suppresses X reach);
// a link belongs in the final tweet or an explicit follow-up reply. Applies
// only to thread-format outputs — there is no "tweet 1" concept for a
// single-post family.
export function checkLinkPlacement(threads: ThreadOutput[]): LinkPlacementResult {
  const violations: string[] = []
  threads.forEach((thread, threadIdx) => {
    const firstPost = thread.posts[0]
    if (firstPost && URL_PATTERN.test(firstPost.text)) {
      violations.push(`thread[${threadIdx}] posts[0] ("${firstPost.text.slice(0, 40)}...") contains a link`)
    }
  })
  return { ok: violations.length === 0, violations }
}
