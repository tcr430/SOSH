// ADR 0018 §7.2 — the load-bearing detail of the whole track. Both failure
// directions are silent: fragmentation (two observations of the same
// phenomenon land under different keys) means observation_count never
// reaches LEARN_PROMOTION_MIN_OBSERVATIONS and NOTHING EVER PROMOTES while
// the feature appears to work; collision (two DIFFERENT phenomena land
// under the same key) inflates confidence on a merge and promotes something
// observed once. computePatternKey() is therefore derived ONLY from signal
// KIND + DIRECTION + PLATFORM — never from `detail.sentence`/prose, which
// varies between two human editors describing the identical phenomenon.
//
// Embeds platform in the key itself (not just relying on the separate
// `platform` column in performance_memory's partial UNIQUE index,
// 20260726020000_performance_memory_pattern_key.sql:26-28): the
// LEARN-VOICE-WRITE-TRIGGER join (same migration, :98-103) matches
// contributing post_edit_signals on `business_id` + `pattern_key` ALONE, no
// platform column — so pattern_key must disambiguate platform on its own to
// keep that join precise per-platform.

import type { PreferenceSignal } from '@/lib/learning/classify'

// Most PreferenceKind values already bake direction into the kind literal
// itself (cta_added vs cta_removed, thread_shortened vs thread_lengthened,
// etc. are separate kind values). Only length_delta shares one kind across
// both directions (the sign of the delta), so it is the sole kind that
// derives a direction from `detail` rather than from `kind` alone.
function directionFor(signal: PreferenceSignal): string {
  if (signal.kind === 'length_delta') {
    const delta = signal.detail.delta
    return typeof delta === 'number' && delta < 0 ? 'shorter' : 'longer'
  }
  return 'fixed'
}

export function computePatternKey(signal: PreferenceSignal): string {
  return [signal.kind, directionFor(signal), signal.platform].join(':')
}

// The mirror-image key for the kinds that have a natural binary opposite —
// used to recompute a contradiction count (§7.3's `net = observations -
// contradictions`) from post_edit_signals: a contradiction is a processed
// signal for the OPPOSITE phenomenon on the same platform, not a differently
// classified signal for the SAME phenomenon. Kinds with no natural opposite
// (avoid_word_removed, hashtag_delta, link_moved, numbering_stripped) return
// null — there is no phenomenon a single observation of one of these could
// contradict within this fixed taxonomy.
const OPPOSITE_KIND: Partial<Record<PreferenceSignal['kind'], PreferenceSignal['kind']>> = {
  cta_added: 'cta_removed',
  cta_removed: 'cta_added',
  thread_shortened: 'thread_lengthened',
  thread_lengthened: 'thread_shortened',
}

export function computeContradictingPatternKey(signal: PreferenceSignal): string | null {
  if (signal.kind === 'length_delta') {
    const direction = directionFor(signal)
    const opposite = direction === 'shorter' ? 'longer' : 'shorter'
    return ['length_delta', opposite, signal.platform].join(':')
  }
  const opposite = OPPOSITE_KIND[signal.kind]
  if (!opposite) return null
  return [opposite, 'fixed', signal.platform].join(':')
}
