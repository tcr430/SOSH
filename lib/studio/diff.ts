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

export type SpanEdit = {
  originalStart: number
  originalEnd: number
  replacement: string
}

// ADR 0019 §11.1 — the one-accept-per-set mechanism's coordinate mapping. A
// suggestion's marker span lives in STRIPPED-REVISION coordinates
// (lib/studio/markers.ts's MarkerSpan); accepting ONE suggestion needs the
// equivalent ORIGINAL-coordinate range to replace, plus the exact
// replacement text, derived from the SAME Hunk[] the diff view already
// renders — no second diff pass, no model-reported offset
// (STUDIO-NO-MODEL-OFFSETS). Multi-suggestion composition (N accepted spans
// in one write) is explicitly deferred (§11.1/§15) because accepted spans
// shift each other's offsets; this function only ever resolves ONE span
// against the untouched original, which is why Track D never needs that
// composition rule.
//
// Returns null if no hunk touches the span at all (should not happen for a
// span that has already passed the three-way join's overlap check, but this
// function makes no assumption about its caller).
export function resolveSpanEdit(hunks: readonly Hunk[], span: { start: number; end: number }): SpanEdit | null {
  let originalStart = Infinity
  let originalEnd = -Infinity
  let replacement = ''
  let touched = false

  for (const hunk of hunks) {
    if (hunk.kind === 'delete') {
      // Zero-width in revised coordinates — only relevant when it sits
      // exactly at one of the span's edges (the "replace" shape: a delete
      // immediately followed or preceded by the insert the marker wraps). A
      // delete elsewhere in the document never lands exactly on
      // span.start/span.end and is correctly ignored.
      if (hunk.revisedStart === span.start || hunk.revisedStart === span.end) {
        originalStart = Math.min(originalStart, hunk.originalStart)
        originalEnd = Math.max(originalEnd, hunk.originalEnd)
        touched = true
      }
      continue
    }

    const overlapStart = Math.max(hunk.revisedStart, span.start)
    const overlapEnd = Math.min(hunk.revisedEnd, span.end)
    if (overlapStart >= overlapEnd) continue // no real overlap with this 'equal'/'insert' hunk

    touched = true
    const withinHunkStart = overlapStart - hunk.revisedStart
    const withinHunkEnd = overlapEnd - hunk.revisedStart
    replacement += hunk.value.slice(withinHunkStart, withinHunkEnd)

    if (hunk.kind === 'equal') {
      // 1:1 correspondence within an equal run — map the overlapping
      // portion's original offsets directly.
      originalStart = Math.min(originalStart, hunk.originalStart + withinHunkStart)
      originalEnd = Math.max(originalEnd, hunk.originalStart + withinHunkEnd)
    } else {
      // insert — the whole hunk maps to a single zero-width point in the
      // original, regardless of how much of it the span covers.
      originalStart = Math.min(originalStart, hunk.originalStart)
      originalEnd = Math.max(originalEnd, hunk.originalEnd)
    }
  }

  if (!touched) return null
  return { originalStart, originalEnd, replacement }
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
