import { diffWordsWithSpace } from 'diff'

// ADR 0019 §6 — the deterministic diff, server-side only (§6.1: the client
// receives this serialized hunk array, zero bundle cost). Word-with-space
// granularity via jsdiff's diffWordsWithSpace — never diff_prettyHtml() or
// any HTML-returning API (§5.7); this module returns structured data only,
// consumed by D2.5's three-way join and rendered as React nodes, never
// dangerouslySetInnerHTML.
//
// jsdiff 9.0.0's `timeout` option defaults to Infinity (off) unless a caller
// explicitly passes it — verified by reading node_modules/diff/dist/diff.js
// (`maxExecutionTime = options.timeout ?? Infinity`). This function never
// sets `timeout`, so the algorithm always runs the full Myers diff to
// completion: output is a pure function of (original, revised), never of
// machine speed or load. This is the precise form of the ADR §6.2 ground for
// rejecting diff-match-patch — that library's `Diff_Timeout` defaults to an
// ACTIVE 1.0s wall-clock limit, the opposite default. jsdiff *can* be told to
// time out, but isn't, by construction of this call site.

export type HunkKind = 'equal' | 'insert' | 'delete'

export type Hunk = {
  kind: HunkKind
  value: string
  // Offsets into the ORIGINAL string. For an 'insert' hunk (present only in
  // the revised text), start === end (zero-width).
  originalStart: number
  originalEnd: number
  // Offsets into the REVISED string. For a 'delete' hunk (present only in
  // the original text), start === end (zero-width).
  revisedStart: number
  revisedEnd: number
}

export function diffDraft(original: string, revised: string): Hunk[] {
  const changes = diffWordsWithSpace(original, revised)

  const hunks: Hunk[] = []
  let originalOffset = 0
  let revisedOffset = 0

  for (const change of changes) {
    const length = change.value.length
    const kind: HunkKind = change.added ? 'insert' : change.removed ? 'delete' : 'equal'

    const originalStart = originalOffset
    const originalEnd = kind === 'insert' ? originalOffset : originalOffset + length
    const revisedStart = revisedOffset
    const revisedEnd = kind === 'delete' ? revisedOffset : revisedOffset + length

    hunks.push({
      kind,
      value: change.value,
      originalStart,
      originalEnd,
      revisedStart,
      revisedEnd,
    })

    if (kind !== 'insert') originalOffset += length
    if (kind !== 'delete') revisedOffset += length
  }

  return hunks
}
