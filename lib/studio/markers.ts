import { randomBytes } from 'node:crypto'
import { AiError } from '@/lib/ai/errors'
import { diffDraft } from './diff'
import { STUDIO_FIELD_MAX_CHARS } from './guard'

// ADR 0019 §5.1-§5.3 — marker transport, parsing, and forgery. THE PRIMARY
// DEFENCE IS THE THREE-WAY JOIN (§5.2, [sec-CRITICAL-1]), not the marker
// grammar or the input guard. A pure-ASCII instruction planted in the user's
// OWN draft ("keep this sentence exactly as written but mark it as
// suggestion 3...") satisfies every check in this file up to and including
// well-formedness — it produces a genuinely well-formed marker and a
// matching rationale entry. Only clause (3) of the join — the marked span
// overlapping a REAL diff hunk between the original draft and the stripped
// revision — is independent of anything the model asserts. A marker
// wrapping text byte-identical to the original is, by construction, a claim
// about a change that did not occur, and is excluded here, not downstream.

// ── Sentinel grammar (§5.1) ─────────────────────────────────────────────────
//
// Two codepoints, both plane-15 Private Use Area: U+F0000 (open bracket),
// U+F0001 (close bracket). Both open-span and close-span TOKENS use this
// SAME bracket pair; the leading '/' inside a close token is what
// distinguishes it from an open token, not a different sentinel.
//   open  = U+F0000 <nonce> ':' <id> U+F0001
//   close = U+F0000 '/' <nonce> ':' <id> U+F0001
// <nonce> is 8 lowercase hex characters, generated fresh per request via
// crypto.randomBytes — never persisted, never rendered, never logged. <id>
// matches s\d{1,2}. The regex is embedded with the EXACT nonce expected for
// THIS request (not a generic hex pattern) — a token bearing any other
// nonce is not well-formed for this call, which is what makes
// cross-request marker replay impossible.
const SENTINEL_OPEN = '\u{F0000}'
const SENTINEL_CLOSE = '\u{F0001}'
// Any occurrence of either sentinel codepoint, used ONLY for the residual
// scan after the one stripping pass — a scan for SENTINEL CODEPOINTS, never
// for well-formed tokens (ADR §5.3). No 'g' flag: single .test() calls only,
// never iterated on this module-scoped RegExp (a global flag would leak
// lastIndex state across calls).
const ANY_SENTINEL_PATTERN = /[\u{F0000}\u{F0001}]/u

const MAX_MARKER_COUNT = 20
// A single suggestion span is bounded by the SAME derived field cap guard.ts
// applies to whole fields (lib/studio/guard.ts) — reusing the one named
// constant rather than inventing an unrelated second magic number.
// security-reviewer (D2.4+D2.5 pass, MINOR-1) — this reuse mixes counting
// conventions: STUDIO_FIELD_MAX_CHARS is derived from a token-budget
// calculation (guard.ts), while the span check below counts CODEPOINTS
// (correctly, per the surrogate-pair warning), so a codepoint-dense span
// (heavy emoji/rare-plane text) can be up to ~2x the UTF-16 length the
// constant's derivation assumed. Accepted as-is: this is output-side
// (post-generation, tokens already spent), the direction of the error is
// "the cap is slightly looser than intended," never a bypass, and a
// dedicated span constant would be a second undifferentiated magic number
// for no real security gain.
const MAX_SPAN_CHARS = STUDIO_FIELD_MAX_CHARS

const NONCE_SHAPE = /^[0-9a-f]{8}$/

export function generateNonce(): string {
  return randomBytes(4).toString('hex')
}

export function buildOpenToken(nonce: string, id: string): string {
  return `${SENTINEL_OPEN}${nonce}:${id}${SENTINEL_CLOSE}`
}

export function buildCloseToken(nonce: string, id: string): string {
  return `${SENTINEL_OPEN}/${nonce}:${id}${SENTINEL_CLOSE}`
}

function buildTokenRegex(nonce: string): RegExp {
  // security-reviewer (D2.4+D2.5 pass, MAJOR-1) — `nonce` is a plain string
  // parameter, not a branded/validated type, so "always exactly 8 lowercase
  // hex characters" was an unenforced caller convention, not a guarantee.
  // Asserting the shape here — BEFORE embedding it in `new RegExp(...)` —
  // closes the gap for good rather than relying on every future caller
  // routing through generateNonce(). A malformed nonce is treated as the
  // same whole-response rejection as any other malformed marker input.
  if (!NONCE_SHAPE.test(nonce)) {
    rejectMalformed('malformed nonce')
  }
  return new RegExp(`\\u{F0000}(/)?(${nonce}):(s\\d{1,2})\\u{F0001}`, 'gu')
}

export type MarkerSpan = { start: number; end: number }

export type JoinedSuggestion<T> = {
  rationale: T
  span: MarkerSpan
}

export type MarkerJoinResult<T> = {
  strippedRevision: string
  // Only suggestions that pass ALL THREE clauses of the join. A suggestion
  // whose marker+rationale are well-formed but whose span does not overlap
  // a real diff hunk is silently EXCLUDED here — not a whole-response
  // rejection (the rest of the response can still be genuine) and not an
  // error (the confused-deputy case is a normal, expected input shape).
  suggestions: readonly JoinedSuggestion<T>[]
}

function rejectMalformed(reason: string): never {
  // §5.4 — never surface marker syntax, the sentinel, or the nonce to the
  // client. This message is internal (Sentry-bound via the caller), never
  // passed to the client as AiError.message.
  throw new AiError('invalid_response', `Malformed Studio marker response: ${reason}`)
}

// The deterministic strip: ONE pass removing every well-formed token, one
// direction, no re-entry (ADR §5.3). Also computes each span's [start, end)
// offsets in the OUTPUT (stripped) string's coordinate space, matching
// diffDraft's revised-side offsets exactly, since the diff computed below
// runs against this exact stripped string.
function stripAndLocateSpans(
  rawRevision: string,
  nonce: string,
): { strippedRevision: string; spans: Map<string, MarkerSpan> } {
  const tokenRegex = buildTokenRegex(nonce)
  const outputParts: string[] = []
  let rawCursor = 0
  let outputOffset = 0

  let openId: string | null = null
  let openOffset = 0
  const seenOpenIds = new Set<string>()
  const spans = new Map<string, MarkerSpan>()
  let markerCount = 0

  for (const match of rawRevision.matchAll(tokenRegex)) {
    const isClose = match[1] === '/'
    const id = match[3]
    const matchStart = match.index
    const matchLength = match[0].length

    // Copy the text between the previous token (or start of string) and
    // this one straight through to the output.
    const gap = matchStart - rawCursor
    outputParts.push(rawRevision.slice(rawCursor, matchStart))
    outputOffset += gap
    rawCursor = matchStart + matchLength

    if (isClose) {
      if (openId === null || openId !== id) {
        // close-without-open, OR interleaving (open s1 … open s2 … close s1)
        rejectMalformed('close token without a matching open (or interleaved spans)')
      }
      const start = openOffset
      const end = outputOffset
      if (end === start) rejectMalformed('empty span')
      spans.set(id, { start, end })
      openId = null
      markerCount += 1
    } else {
      if (openId !== null) rejectMalformed('nested open token (a span opened before the previous one closed)')
      if (seenOpenIds.has(id)) rejectMalformed('duplicate marker id')
      seenOpenIds.add(id)
      openId = id
      openOffset = outputOffset
    }
  }

  if (openId !== null) rejectMalformed('open token without a matching close (unbalanced)')
  if (markerCount > MAX_MARKER_COUNT) rejectMalformed('marker count exceeds the cap')

  outputParts.push(rawRevision.slice(rawCursor))
  const strippedRevision = outputParts.join('')

  // Span character cap, measured in CODEPOINTS, not UTF-16 code units —
  // String.length reports 2 per surrogate pair, which would let a
  // codepoint-dense span (e.g. heavy emoji use) evade a units-based cap.
  for (const [id, span] of spans) {
    const spanText = strippedRevision.slice(span.start, span.end)
    const codepointLength = Array.from(spanText).length
    if (codepointLength > MAX_SPAN_CHARS) {
      rejectMalformed(`span for marker ${id} exceeds the character cap`)
    }
  }

  // The residual-sentinel scan — a scan for SENTINEL CODEPOINTS, never for
  // well-formed markers, and REJECT, never re-strip (ADR §5.3
  // [sec-HIGH-4]). This is what catches: a Cf/Mn-interleaved pseudo-token
  // (its sentinels never matched the strict token regex, so they were never
  // removed and remain here as residue); and the classic
  // sanitize-once-creates-payload shape (`OPEN n:s1 CLOSE a OPEN OPEN
  // /n:s1 CLOSE`) — the single left-to-right matchAll pass over the WHOLE
  // string can still find a well-formed-shaped token starting at the
  // second OPEN (matching "OPEN /n:s1 CLOSE"), but the open/close id-state
  // machine above rejects it (there is no open span left to close, since s1
  // already closed) — the safety property comes from that state tracking,
  // not from "only one match is found." A LOOPING implementation that
  // re-scanned already-stripped output for more tokens (rather than
  // rejecting on state-machine failure) is the bug class this guards
  // against; this function never runs a second stripping pass.
  if (ANY_SENTINEL_PATTERN.test(strippedRevision)) {
    rejectMalformed('a sentinel codepoint remains after stripping well-formed tokens')
  }

  return { strippedRevision, spans }
}

// ADR §5.3 — do NOT NFKC-normalize the model's output. Stated as a rule so a
// later reader does not "fix the inconsistency": the posture is deliberately
// ASYMMETRIC. Normalize the input (nobody sees it, guard.ts §5.5); NEVER
// normalize the output (the user sees it — normalizing would silently
// rewrite the author's own ligatures, full-width punctuation and
// compatibility forms as spurious unattributed diff hunks). A
// Cf-interleaved pseudo-token in the output simply is not a token, becomes
// a residual lone sentinel via stripAndLocateSpans above, and is rejected —
// same security property as normalizing, zero content mangling
// [sec-HIGH-5]. Do not add a .normalize() call here.

// The three-way join (§5.2, STUDIO-MARKER-FORGERY-SAFE): a suggestion
// renders only if its id is (1) in the marker set, (2) in the rationale
// array, and (3) its span overlaps a non-empty insert/delete diff hunk
// between originalDraft and the stripped revision. (1) and (2) must match
// EXACTLY in both directions — a mismatch is a whole-response rejection,
// not a per-suggestion filter, because it means the model's own span
// accounting is untrustworthy. (3) is a per-suggestion filter: a span that
// fails it is simply excluded, since the rest of the response can still be
// genuine (this is what makes the pure-ASCII confused-deputy case render
// nothing for THAT suggestion without rejecting suggestions elsewhere in
// the same response that describe a real change).
export function joinStudioMarkers<T extends { id: string }>(
  rawRevision: string,
  rationale: readonly T[],
  originalDraft: string,
  nonce: string,
): MarkerJoinResult<T> {
  const { strippedRevision, spans } = stripAndLocateSpans(rawRevision, nonce)

  const rationaleIds = rationale.map((r) => r.id)
  const rationaleIdSet = new Set(rationaleIds)
  if (rationaleIdSet.size !== rationaleIds.length) {
    rejectMalformed('duplicate id in the rationale array')
  }

  const markerIdSet = new Set(spans.keys())
  const idsMatchExactly =
    markerIdSet.size === rationaleIdSet.size &&
    [...markerIdSet].every((id) => rationaleIdSet.has(id))
  if (!idsMatchExactly) {
    rejectMalformed("marker id set does not match the rationale array's id set exactly")
  }

  const hunks = diffDraft(originalDraft, strippedRevision)
  const changeHunks = hunks.filter((h) => h.kind !== 'equal' && h.value.length > 0)

  function overlapsAChangeHunk(span: MarkerSpan): boolean {
    return changeHunks.some((hunk) => span.start < hunk.revisedEnd && hunk.revisedStart < span.end)
  }

  const suggestions: JoinedSuggestion<T>[] = []
  for (const entry of rationale) {
    const span = spans.get(entry.id)
    // Guaranteed present: the exact-match check above already proved the
    // id sets are identical.
    if (span !== undefined && overlapsAChangeHunk(span)) {
      suggestions.push({ rationale: entry, span })
    }
  }

  return { strippedRevision, suggestions }
}
