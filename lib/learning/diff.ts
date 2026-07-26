// ADR 0018 §4.1 (LEARN-HEURISTIC-FIRST) — in-repo deterministic deltas only.
// L-13 STOP: adding `diff` / `diff-match-patch` / `jsdiff` / `fast-diff` here
// is not a judgement call. Every function below is a plain, deterministic
// computation over two frozen strings/arrays — never a character-level
// patch. A character-level patch is Mode 1 Studio's job (campaign-modes §1),
// not this background classifier's.

// The thread-join delimiter is a CONTRACT, not a guess: `joinContent()`
// (lib/campaigns/generate.ts:51-56) is the sole writer of posts.content for
// thread-format output and always joins with this exact separator.
export const THREAD_SEGMENT_DELIMITER = '\n\n---\n\n'

export function splitThreadSegments(content: string): readonly string[] {
  return content.split(THREAD_SEGMENT_DELIMITER)
}

// (len(human) - len(original)) / len(original), per §4.2's exact rule.
// Guards div-by-zero for an empty original (never observed in practice —
// posts.content is NOT NULL and non-empty by the generation pipeline — but a
// pure function must not throw or return NaN/Infinity on any input).
export function lengthDelta(original: string, human: string): number {
  if (original.length === 0) return 0
  return (human.length - original.length) / original.length
}

export interface HashtagDelta {
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

export function hashtagDelta(original: readonly string[], human: readonly string[]): HashtagDelta {
  const originalSet = new Set(original)
  const humanSet = new Set(human)
  return {
    added: human.filter((tag) => !originalSet.has(tag)),
    removed: original.filter((tag) => !humanSet.has(tag)),
  }
}

const URL_PATTERN = /https?:\/\/\S+/i

// Segment index of the first outbound URL, or null if none. Used both for
// link_moved (compare original vs human index) and as half of the CTA rule.
export function firstUrlSegmentIndex(segments: readonly string[]): number | null {
  const index = segments.findIndex((segment) => URL_PATTERN.test(segment))
  return index === -1 ? null : index
}

// Fixed, deterministic imperative-opener list (§4.2: "a deterministic CTA
// rule (imperative-opener list ∪ presence of an outbound URL in the final
// segment)"). Matched against the first segment's opening words — a CTA is
// conventionally the post's lead or its closer, and the URL-presence half of
// the rule already covers the closer case.
const IMPERATIVE_CTA_OPENERS = [
  'sign up',
  'try',
  'book',
  'schedule',
  'download',
  'join',
  'get started',
  'learn more',
  'start your',
  'click',
  'register',
  'subscribe',
  'contact us',
  'visit',
] as const

export function hasCta(content: string): boolean {
  const segments = splitThreadSegments(content)
  const opener = (segments[0] ?? '').trim().toLowerCase()
  const opensWithImperative = IMPERATIVE_CTA_OPENERS.some((phrase) => opener.startsWith(phrase))
  const finalSegment = segments.at(-1) ?? content
  const hasOutboundUrlAtEnd = URL_PATTERN.test(finalSegment)
  return opensWithImperative || hasOutboundUrlAtEnd
}

// Thread segments opening with `1/`, `1.`, or `(1/7)`-style markers —
// campaign-modes §1's own named first test case (lines 195-197).
const NUMBERING_PATTERN = /^\s*(\d+[/.)]|\(\d+\/\d+\))/

export function opensWithNumbering(segment: string): boolean {
  return NUMBERING_PATTERN.test(segment)
}

// Sentence-level split on `.!?` + newline, case preserved (factual-marker
// detection below needs original casing for the named-entity heuristic).
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+|\n+/

export function splitSentences(text: string): readonly string[] {
  return text
    .split(SENTENCE_SPLIT_PATTERN)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

function normalizeSentence(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Sentence-level set difference: sentences present in `original` and absent
// from `human`, normalised (case/whitespace-insensitive) for the membership
// check but returned in their ORIGINAL casing — the factual-marker check
// downstream needs case to detect named entities and superlatives.
export function removedSentences(original: string, human: string): readonly string[] {
  const humanNormalized = new Set(splitSentences(human).map(normalizeSentence))
  const seen = new Set<string>()
  const removed: string[] = []
  for (const sentence of splitSentences(original)) {
    const key = normalizeSentence(sentence)
    if (!humanNormalized.has(key) && !seen.has(key)) {
      seen.add(key)
      removed.push(sentence)
    }
  }
  return removed
}

// Numeral, currency/percent symbol, a superlative, or a plausible named
// entity (a Title-Case bigram) — §5.2's "factual marker" test for whether a
// removed sentence is a claim worth checking against pinned evidence at all.
// Case-insensitive: numerals, currency/percent symbols, and superlatives.
const FACTUAL_MARKER_SYMBOLIC_PATTERN = /\d|%|\$|€|£|\b(best|most|first|only|leading|#1)\b/i
// Case-SENSITIVE: a Title-Case bigram (plausible named entity) — must stay
// case-sensitive, or a case-insensitive flag would match any two-word phrase.
const NAMED_ENTITY_PATTERN = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/

export function hasFactualMarker(sentence: string): boolean {
  return FACTUAL_MARKER_SYMBOLIC_PATTERN.test(sentence) || NAMED_ENTITY_PATTERN.test(sentence)
}

export function containsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i')
  return pattern.test(text)
}
