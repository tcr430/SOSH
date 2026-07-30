import { describe, it, expect } from 'vitest'
import { diffDraft, type Hunk } from './diff'

// ADR 0019 §6.3 — STUDIO-DIFF-DETERMINISTIC: for any (original, revised)
// pair, diffDraft returns a structurally identical hunk array on every
// invocation, in any process, under any load. Proved two ways:
//   1. Repeated invocation on the same fixture pairs asserts deep equality.
//   2. A committed corpus of pairs WITH their expected hunk array — this is
//      not just "the function is deterministic against itself," it pins the
//      actual segmentation, so a dependency bump that changes tokenization
//      fails the build instead of silently changing what users see.

type CorpusEntry = { original: string; revised: string; expected: Hunk[] }

// Generated once via a direct call to diffDraft and committed verbatim —
// this IS the corpus, not a re-derivation of it. Recomputing these numbers
// by hand risks the exact off-by-one error this test exists to catch.
const CORPUS: CorpusEntry[] = [
  {
    original: 'The quick fox jumps',
    revised: 'The quick fox leaps',
    expected: [
      { kind: 'equal', value: 'The quick fox ', originalStart: 0, originalEnd: 14, revisedStart: 0, revisedEnd: 14 },
      { kind: 'delete', value: 'jumps', originalStart: 14, originalEnd: 19, revisedStart: 14, revisedEnd: 14 },
      { kind: 'insert', value: 'leaps', originalStart: 19, originalEnd: 19, revisedStart: 14, revisedEnd: 19 },
    ],
  },
  {
    original: 'Hello world',
    revised: 'Hello brave new world',
    expected: [
      { kind: 'equal', value: 'Hello ', originalStart: 0, originalEnd: 6, revisedStart: 0, revisedEnd: 6 },
      { kind: 'insert', value: 'brave new ', originalStart: 6, originalEnd: 6, revisedStart: 6, revisedEnd: 16 },
      { kind: 'equal', value: 'world', originalStart: 6, originalEnd: 11, revisedStart: 16, revisedEnd: 21 },
    ],
  },
  {
    original: 'Hello brave new world',
    revised: 'Hello world',
    expected: [
      { kind: 'equal', value: 'Hello ', originalStart: 0, originalEnd: 6, revisedStart: 0, revisedEnd: 6 },
      { kind: 'delete', value: 'brave new ', originalStart: 6, originalEnd: 16, revisedStart: 6, revisedEnd: 6 },
      { kind: 'equal', value: 'world', originalStart: 16, originalEnd: 21, revisedStart: 6, revisedEnd: 11 },
    ],
  },
  {
    original: 'identical text here',
    revised: 'identical text here',
    expected: [
      { kind: 'equal', value: 'identical text here', originalStart: 0, originalEnd: 19, revisedStart: 0, revisedEnd: 19 },
    ],
  },
  {
    original: 'completely different',
    revised: 'nothing alike whatsoever',
    expected: [
      { kind: 'delete', value: 'completely', originalStart: 0, originalEnd: 10, revisedStart: 0, revisedEnd: 0 },
      { kind: 'insert', value: 'nothing', originalStart: 10, originalEnd: 10, revisedStart: 0, revisedEnd: 7 },
      { kind: 'equal', value: ' ', originalStart: 10, originalEnd: 11, revisedStart: 7, revisedEnd: 8 },
      { kind: 'delete', value: 'different', originalStart: 11, originalEnd: 20, revisedStart: 8, revisedEnd: 8 },
      { kind: 'insert', value: 'alike whatsoever', originalStart: 20, originalEnd: 20, revisedStart: 8, revisedEnd: 24 },
    ],
  },
]

describe('diffDraft (ADR 0019 §6, STUDIO-DIFF-DETERMINISTIC)', () => {
  it.each(CORPUS)('matches the committed expected hunk array: "$original" -> "$revised"', ({ original, revised, expected }) => {
    expect(diffDraft(original, revised)).toEqual(expected)
  })

  it.each(CORPUS)('is deterministic across repeated invocations: "$original" -> "$revised"', ({ original, revised }) => {
    const first = diffDraft(original, revised)
    const second = diffDraft(original, revised)
    const third = diffDraft(original, revised)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('identical strings produce a single equal hunk spanning the whole text', () => {
    const hunks = diffDraft('no change at all', 'no change at all')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].kind).toBe('equal')
    expect(hunks[0].value).toBe('no change at all')
  })

  it('empty original and empty revised produce an empty hunk array', () => {
    expect(diffDraft('', '')).toEqual([])
  })

  it('offsets are internally consistent: concatenating hunk values along the revised side reconstructs the revised string', () => {
    const original = 'Ship the feature by Friday, carefully.'
    const revised = 'Ship this feature carefully, by Monday.'
    const hunks = diffDraft(original, revised)
    const reconstructed = hunks
      .filter((h) => h.kind !== 'delete')
      .map((h) => h.value)
      .join('')
    expect(reconstructed).toBe(revised)

    const reconstructedOriginal = hunks
      .filter((h) => h.kind !== 'insert')
      .map((h) => h.value)
      .join('')
    expect(reconstructedOriginal).toBe(original)
  })

  it('never returns an HTML string or any diff_prettyHtml-shaped output — hunks are structured data only', () => {
    const hunks = diffDraft('<script>alert(1)</script>', 'safe text')
    for (const hunk of hunks) {
      expect(typeof hunk.value).toBe('string')
      expect(hunk).not.toHaveProperty('html')
    }
  })
})
