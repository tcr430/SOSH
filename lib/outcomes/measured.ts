import { hasCta } from '@/lib/learning/diff'
import { OUTCOME_LENGTH_BANDS } from './constants'

// ADR 0026 §4.4 — MEASURED dimensions, measured ONCE from the immutable published artefact (posts.content is
// frozen once published: updatePostContent guards status IN ('draft','approved')). This is measurement of the
// exact artefact, NOT inference — the same class as ADR 0018's deterministic deltas. PURE: no I/O, no model call.

export type LengthBand = 'short' | 'medium' | 'long'

// generate.ts joinContent stores a thread as one delimited string in posts.content; this is that delimiter.
export const THREAD_SEGMENT_SEPARATOR = '\n\n---\n\n'

// short is strictly BELOW shortBelow, long strictly ABOVE longAbove, medium the inclusive range between.
// Only X and LinkedIn have bands; any other platform has no length dimension (null).
export function lengthBand(input: { platform: string; content: string; format?: 'single' | 'thread' }): LengthBand | null {
  let key: keyof typeof OUTCOME_LENGTH_BANDS
  let size: number
  if (input.platform === 'twitter') {
    const format = input.format ?? (input.content.includes(THREAD_SEGMENT_SEPARATOR) ? 'thread' : 'single')
    key = format === 'thread' ? 'twitter_thread' : 'twitter_single'
    size = format === 'thread' ? input.content.split(THREAD_SEGMENT_SEPARATOR).length : input.content.length
  } else if (input.platform === 'linkedin') {
    key = 'linkedin'
    size = input.content.length
  } else {
    return null
  }
  const band = OUTCOME_LENGTH_BANDS[key]
  if (size < band.shortBelow) return 'short'
  if (size > band.longAbove) return 'long'
  return 'medium'
}

// ADR 0018's CTA rule function, IMPORTED UNMODIFIED (lib/learning is untouched by ADR 0026).
export function ctaPresent(content: string): boolean {
  return hasCta(content)
}

// The opening sentence of the post (of a thread, its FIRST post), normalised: lower-cased, whitespace
// collapsed, trailing sentence punctuation stripped. A sentence ends at . ! ? followed by whitespace or the end;
// with none, the first line stands in.
export function firstSentence(text: string): string {
  const opening = text.trim().split(THREAD_SEGMENT_SEPARATOR)[0] ?? ''
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(opening)
  const sentence = match ? match[0] : (opening.split('\n')[0] ?? '')
  return sentence.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!?…]+$/u, '').trim()
}

// hook_survived: the normalised first sentence of what was PUBLISHED equals that of the latest snapshot's
// rendered_content. A hook_type whose opening did not survive the human edit describes something that was not
// published, so it is excluded from display. null = no snapshot to compare (a human-written post).
export function hookSurvived(publishedContent: string, snapshotRendered: string | null): boolean | null {
  if (snapshotRendered === null) return null
  return firstSentence(publishedContent) === firstSentence(snapshotRendered)
}
