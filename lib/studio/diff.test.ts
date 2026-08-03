import { describe, it, expect } from 'vitest'
import { diffDraft, resolveSpanEdit, type Hunk } from './diff'
import { guardStudioField, StudioGuardError, STUDIO_FIELD_MAX_CHARS } from './guard'

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

// A-6 / BLOCKER-1 (Session 26-D) — silent tail destruction can no longer
// occur because an over-cap draft never reaches diffDraft at all. Before
// this fix, guardStudioField's now-deleted truncateToCap silently sliced an
// over-cap draft for the MODEL's view only; actions.ts still called
// diffDraft(fullRawDraft, strippedShortRevision), which emitted the
// untouched tail as one giant delete hunk that resolveSpanEdit could fold
// into a boundary-adjacent accept, replacing everything from the last
// suggestion's span to the end of the document. guardStudioField now throws
// on that same input instead of truncating it, so the tail-delete hunk this
// test documents is never produced in the real pipeline.
describe('over-cap drafts are refused before a diff is ever computed (ADR §5.4 A-6)', () => {
  it('guardStudioField throws on an over-cap draft — actions.ts never reaches diffDraft for it', () => {
    const overCapDraft = 'x'.repeat(STUDIO_FIELD_MAX_CHARS + 1)
    expect(() => guardStudioField(overCapDraft)).toThrow(StudioGuardError)
  })

  it('sanity check: the tail-delete shape this refusal prevents — IF an over-cap draft were still diffed against a short revision (the old, pre-A-6 shape), it WOULD emit exactly the giant delete hunk that made silent tail destruction possible', () => {
    // Word-tokenized filler (diffWordsWithSpace granularity — real prose, not
    // one giant homogeneous token) sized so the cap boundary lands exactly
    // on a word/space boundary: STUDIO_FIELD_MAX_CHARS (3429) is evenly
    // divisible by 'xy '.length (3), so the prefix below is EXACTLY the cap.
    const prefix = 'xy '.repeat(STUDIO_FIELD_MAX_CHARS / 3) // exactly STUDIO_FIELD_MAX_CHARS chars
    const tail = 'z '.repeat(250) // exactly 500 chars — the untouched remainder
    const fullOriginal = prefix + tail
    const truncatedRevision = prefix // what the old truncateToCap would have shown the model
    const hunks = diffDraft(fullOriginal, truncatedRevision)
    const tailDelete = hunks.find((h) => h.kind === 'delete' && h.originalEnd === fullOriginal.length)
    expect(tailDelete).toBeDefined()
    expect(tailDelete!.value.length).toBe(500)
  })
})

// ADR 0019 §11.1 — resolveSpanEdit maps ONE marker span (in stripped-
// revision coordinates) back to the original-coordinate range to replace,
// so the client can apply exactly one accepted suggestion without touching
// any other pending edit in the same response.
describe('resolveSpanEdit (ADR 0019 §11.1, one-accept-per-set)', () => {
  function apply(original: string, edit: { originalStart: number; originalEnd: number; replacement: string }): string {
    return original.slice(0, edit.originalStart) + edit.replacement + original.slice(edit.originalEnd)
  }

  it('a pure insert (word replaced by a longer phrase): resolves to the insert-only edit', () => {
    const original = 'Hello world'
    const revised = 'Hello brave new world'
    const hunks = diffDraft(original, revised)
    // The insert hunk alone: revised[6,16) = 'brave new '
    const edit = resolveSpanEdit(hunks, { start: 6, end: 16 })
    expect(edit).toEqual({ originalStart: 6, originalEnd: 6, replacement: 'brave new ' })
    expect(apply(original, edit!)).toBe(revised)
  })

  it('a replace (delete+insert at the same point): the boundary-adjacent delete is folded in', () => {
    const original = 'The quick fox jumps'
    const revised = 'The quick fox leaps'
    const hunks = diffDraft(original, revised)
    // Marker wraps only the inserted word 'leaps' at revised[14,19).
    const edit = resolveSpanEdit(hunks, { start: 14, end: 19 })
    expect(edit).toEqual({ originalStart: 14, originalEnd: 19, replacement: 'leaps' })
    expect(apply(original, edit!)).toBe(revised)
  })

  it('two independent edits in one response: resolving span A never pulls in span B\'s hunks', () => {
    const original = 'completely different'
    const revised = 'nothing alike whatsoever'
    const hunks = diffDraft(original, revised)

    // Span A: the first insert, revised[0,7) = 'nothing'.
    const editA = resolveSpanEdit(hunks, { start: 0, end: 7 })
    expect(editA).toEqual({ originalStart: 0, originalEnd: 10, replacement: 'nothing' })
    expect(apply(original, editA!)).toBe('nothing different')

    // Span B: the second insert, revised[8,24) = 'alike whatsoever'. Its
    // left-boundary delete sits at revised[8,8), distinct from span A's.
    const editB = resolveSpanEdit(hunks, { start: 8, end: 24 })
    expect(editB).toEqual({ originalStart: 11, originalEnd: 20, replacement: 'alike whatsoever' })
    expect(apply(original, editB!)).toBe('completely alike whatsoever')
  })

  it('a span outside every hunk\'s range returns null', () => {
    const hunks = diffDraft('identical text here', 'identical text here')
    expect(resolveSpanEdit(hunks, { start: 50, end: 55 })).toBeNull()
  })
})
