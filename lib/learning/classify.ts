// ADR 0018 §5 — "the section the Reviewer will read hardest." classify() is
// the Tier-0 heuristic classifier: a PURE function (LEARN-CLASSIFY-DETERMINISTIC,
// §4.3) with no clock, no randomness, no network, and NO LLM call
// (LEARN-HEURISTIC-FIRST, §4.2 — an LLM call per approved post is an L-1
// STOP). Its output increments a confidence counter downstream, so
// nondeterminism would make observation_count a random variable and every
// promotion decision unreproducible.

import type { Platform, PostAiOriginalFormat, EvidenceMemoryRow } from '@/lib/db/types'
import type { CoreVoiceRules } from '@/lib/memory/voice'
import { LEARN_LENGTH_DELTA_MIN_PCT } from '@/lib/learning/constants'
import {
  splitThreadSegments,
  lengthDelta,
  hashtagDelta,
  firstUrlSegmentIndex,
  hasCta,
  opensWithNumbering,
  removedSentences,
  hasFactualMarker,
  containsWord,
} from '@/lib/learning/diff'

// ─── Layer 1 (§5.3) — a partitioned return, not a flat tagged array. ────────
//
// There is NO `Signal[]` type anywhere in this codebase. L-6's named footgun
// — a flat list a developer forgets to filter — is structurally gone: there
// is nothing to `.filter()` and forget. `_class` is the PRIMARY discriminant
// ([type-2]); the three Kind vocabularies below share no members and are the
// documented FALLBACK, load-bearing only if a future refactor deletes
// `_class` as "redundant." Neither PreferenceSignal, CorrectionSignal, nor
// InconclusiveSignal may gain an index signature, and `kind` must never be
// widened to `string` — that is the minimum invariant a future PR must not
// break.
//
// Plain interfaces with a literal tag are house style here (VaultSecretId,
// RenderedEvidence, FrozenBrief — [type-3]); a #private-field class was
// considered and rejected for the same reason, recorded rather than silent.

export type PreferenceKind =
  | 'avoid_word_removed'
  | 'length_delta'
  | 'hashtag_delta'
  | 'cta_added'
  | 'cta_removed'
  | 'thread_shortened'
  | 'thread_lengthened'
  | 'link_moved'
  | 'numbering_stripped'

export type CorrectionKind = 'unsourced_claim_removed'

export type InconclusiveKind = 'evidence_cited_claim_removed' | 'avoid_word_added'

export type SignalDetail = Record<string, unknown>

export interface SignalBase {
  readonly postId: string
  readonly platform: Platform
  readonly detail: SignalDetail
}

export interface PreferenceSignal extends SignalBase {
  readonly _class: 'preference'
  readonly kind: PreferenceKind
}

export interface CorrectionSignal extends SignalBase {
  readonly _class: 'correction'
  readonly kind: CorrectionKind
}

export interface InconclusiveSignal extends SignalBase {
  readonly _class: 'inconclusive'
  readonly kind: InconclusiveKind
}

export interface ClassifyResult {
  readonly preferences: readonly PreferenceSignal[]
  readonly corrections: readonly CorrectionSignal[]
  readonly inconclusive: readonly InconclusiveSignal[]
}

// Layer 3's pinned parameter contract (§5.3) — the future promotion job's
// voice-directed writer (C2.6) is typed against exactly this alias. Passing
// `ClassifyResult['corrections']` where this is expected must not compile;
// classify.types.test.ts asserts that with `@ts-expect-error`.
export type VoiceDirectedWriterInput = readonly PreferenceSignal[]

// classify()'s two input shapes are deliberately narrow — not the full
// PostAiOriginalRow / PostEditSignalRow — so this function stays pure and
// has no dependence on row order or on unrelated columns (§4.3).
export interface ClassifyAiOriginal {
  readonly postId: string
  readonly platform: Platform
  readonly format: PostAiOriginalFormat
  readonly renderedContent: string
  readonly hashtags: readonly string[]
  // payload.posts.length for thread format; null for single format. Passed
  // in by the caller rather than derived from `payload: Record<string,
  // unknown>` here, so this module never has to parse that JSONB shape.
  readonly threadPostCount: number | null
}

export interface ClassifyHumanFinal {
  readonly humanContent: string
  readonly humanHashtags: readonly string[]
}

function detail(fields: SignalDetail): SignalDetail {
  return fields
}

// ─── The Tier-0 heuristic classifier ────────────────────────────────────────
//
// `voiceRules` may be null (no brand_voices row yet); `pinnedEvidence` is
// the campaign's frozen, business_id-scoped pinned evidence rows — pass an
// empty array both when no frozen brief exists AND when one exists with an
// empty pinnedEvidence set. Both cases must gate unsourced_claim_removed off
// (LEARN-CORRECTION-REQUIRES-BRIEF, §5.2): absence of evidence is not
// evidence of hallucination.
export function classify(
  aiOriginal: ClassifyAiOriginal,
  humanFinal: ClassifyHumanFinal,
  voiceRules: CoreVoiceRules | null,
  pinnedEvidence: readonly EvidenceMemoryRow[],
): ClassifyResult {
  const preferences: PreferenceSignal[] = []
  const corrections: CorrectionSignal[] = []
  const inconclusive: InconclusiveSignal[] = []

  const base = { postId: aiOriginal.postId, platform: aiOriginal.platform }
  const rendered = aiOriginal.renderedContent
  const human = humanFinal.humanContent
  const avoidWords = voiceRules?.avoid_words ?? []

  // avoid_word_removed (preference)
  for (const word of avoidWords) {
    if (containsWord(rendered, word) && !containsWord(human, word)) {
      preferences.push({
        ...base,
        _class: 'preference',
        kind: 'avoid_word_removed',
        detail: detail({ word }),
      })
    }
  }

  // length_delta (preference)
  const delta = lengthDelta(rendered, human)
  if (Math.abs(delta) >= LEARN_LENGTH_DELTA_MIN_PCT) {
    preferences.push({
      ...base,
      _class: 'preference',
      kind: 'length_delta',
      detail: detail({ delta }),
    })
  }

  // hashtag_delta (preference)
  const hashtags = hashtagDelta(aiOriginal.hashtags, humanFinal.humanHashtags)
  if (hashtags.added.length > 0 || hashtags.removed.length > 0) {
    preferences.push({
      ...base,
      _class: 'preference',
      kind: 'hashtag_delta',
      detail: detail({ added: hashtags.added, removed: hashtags.removed }),
    })
  }

  // cta_added / cta_removed (preference) — emitted on a change of verdict only
  const originalHasCta = hasCta(rendered)
  const humanHasCta = hasCta(human)
  if (originalHasCta && !humanHasCta) {
    preferences.push({ ...base, _class: 'preference', kind: 'cta_removed', detail: detail({}) })
  } else if (!originalHasCta && humanHasCta) {
    preferences.push({ ...base, _class: 'preference', kind: 'cta_added', detail: detail({}) })
  }

  // thread_shortened / thread_lengthened (preference, thread family only)
  if (aiOriginal.threadPostCount !== null) {
    const humanSegmentCount = splitThreadSegments(human).length
    if (humanSegmentCount < aiOriginal.threadPostCount) {
      preferences.push({
        ...base,
        _class: 'preference',
        kind: 'thread_shortened',
        detail: detail({ from: aiOriginal.threadPostCount, to: humanSegmentCount }),
      })
    } else if (humanSegmentCount > aiOriginal.threadPostCount) {
      preferences.push({
        ...base,
        _class: 'preference',
        kind: 'thread_lengthened',
        detail: detail({ from: aiOriginal.threadPostCount, to: humanSegmentCount }),
      })
    }
  }

  // link_moved (preference)
  const originalSegments = splitThreadSegments(rendered)
  const humanSegments = splitThreadSegments(human)
  const originalLinkIndex = firstUrlSegmentIndex(originalSegments)
  const humanLinkIndex = firstUrlSegmentIndex(humanSegments)
  if (originalLinkIndex !== null && humanLinkIndex !== null && originalLinkIndex !== humanLinkIndex) {
    preferences.push({
      ...base,
      _class: 'preference',
      kind: 'link_moved',
      detail: detail({ from: originalLinkIndex, to: humanLinkIndex }),
    })
  }

  // numbering_stripped (preference, thread family only)
  if (aiOriginal.threadPostCount !== null) {
    const originalHasNumbering = originalSegments.some(opensWithNumbering)
    const humanHasNumbering = humanSegments.some(opensWithNumbering)
    if (originalHasNumbering && !humanHasNumbering) {
      preferences.push({
        ...base,
        _class: 'preference',
        kind: 'numbering_stripped',
        detail: detail({}),
      })
    }
  }

  // unsourced_claim_removed (correction) / evidence_cited_claim_removed (inconclusive)
  // LEARN-CORRECTION-REQUIRES-BRIEF: the correction verdict is only reachable
  // when pinnedEvidence is non-empty. An empty pinnedEvidence set — whether
  // because no brief exists or the brief pinned nothing — routes every
  // removed factual claim to inconclusive instead, since there is no
  // evidence corpus to rule the claim "unsourced" against.
  for (const sentence of removedSentences(rendered, human)) {
    if (!hasFactualMarker(sentence)) continue
    if (pinnedEvidence.length === 0) {
      inconclusive.push({
        ...base,
        _class: 'inconclusive',
        kind: 'evidence_cited_claim_removed',
        detail: detail({ sentence, reason: 'no_pinned_evidence' }),
      })
      continue
    }
    const backedByEvidence = pinnedEvidence.some((row) => claimOverlapsEvidence(sentence, row.content))
    if (backedByEvidence) {
      inconclusive.push({
        ...base,
        _class: 'inconclusive',
        kind: 'evidence_cited_claim_removed',
        detail: detail({ sentence, reason: 'evidence_backed' }),
      })
    } else {
      corrections.push({
        ...base,
        _class: 'correction',
        kind: 'unsourced_claim_removed',
        detail: detail({ sentence }),
      })
    }
  }

  // avoid_word_added (inconclusive) — the human added a term on their OWN
  // avoid list; contradicts their stated rule, recorded but never learned from.
  for (const word of avoidWords) {
    if (!containsWord(rendered, word) && containsWord(human, word)) {
      inconclusive.push({
        ...base,
        _class: 'inconclusive',
        kind: 'avoid_word_added',
        detail: detail({ word }),
      })
    }
  }

  return { preferences, corrections, inconclusive }
}

function normalizeForOverlap(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
}

// A removed claim "overlaps" pinned evidence when one normalised text is a
// substring of the other — a grounded claim is typically lifted near-
// verbatim from (or is a close paraphrase embedding) the evidence content.
function claimOverlapsEvidence(sentence: string, evidenceContent: string): boolean {
  const normalizedSentence = normalizeForOverlap(sentence)
  const normalizedEvidence = normalizeForOverlap(evidenceContent)
  if (normalizedSentence.length === 0 || normalizedEvidence.length === 0) return false
  return normalizedEvidence.includes(normalizedSentence) || normalizedSentence.includes(normalizedEvidence)
}
