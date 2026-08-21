import * as Sentry from '@sentry/nextjs'
import { containsWord } from '@/lib/learning/diff'
import type { GovernedPerformancePattern } from '@/lib/memory'
import { StudioSpanCategorySchema, type StudioSpanCategory } from './categories'

export { StudioSpanCategorySchema, type StudioSpanCategory }

// ADR 0019 §7/§8 — the type-design core of Track D. §8.4's honest concession
// governs this file: `ecc:type-design-analyzer` recommended a #private-field
// class as the brand container, which the founder REFUSED (A-4) — the class
// concedes it cannot cross the RSC boundary, Studio's citation render IS an
// interactive surface, so enforcement degrades to "chokepoint + source scan"
// on the client half regardless. This file implements the analyzer's own
// stated FALLBACK: a non-exported `unique symbol` brand key. One line, no
// new OOP pattern, still closes the object-literal forgery path a
// string-literal brand leaves wide open, and leaves no grep trace. Do not
// re-propose the class.

// ── the wire: what the model is PERMITTED TO SAY. An unverified claim, and
// its name says so (§8.4(iii)).
//
// rowId is a UUID, NEVER pattern_key [type-§6]: pattern_key never leaves the
// DB layer (retrieveRelevant/retrieveStudioPerformancePatterns map to
// {platform, pattern/topContent, ...} only, never pattern_key —
// lib/memory/performance.ts) and is string|null on the row itself (NULL for
// source='manual'|'import', lib/db/types.ts:684) — keying on it would be
// both unimplementable from what Studio ever sees and non-total over real
// data.
export type ClaimedMemorySource =
  | { kind: 'avoid_word'; word: string }
  | { kind: 'performance_pattern'; rowId: string }
  | { kind: 'evidence'; evidenceId: string }

export type ClaimedSuggestion = {
  id: string
  category: StudioSpanCategory
  // MINOR-3 (Session 26-D correction) — rationale is UNVERIFIED MODEL TEXT.
  // It flows UNMODIFIED into RenderedSuggestion.rationale on all three
  // verifyStudioResponse outcomes below, including the demote-to-
  // model_judgment path — the structured `source` is unfabricable (the
  // brand), but the sentence beside it is free text nothing here checks
  // against CitableContext. Its only guarantees: (a) a Zod length bound
  // (enforced at the schema layer, not here), (b) it renders as an escaped
  // React text node, never dangerouslySetInnerHTML (SuggestionCard.tsx:45),
  // and (c) attribution is carried in a visible marker AND the accessible
  // name (SuggestionCard.tsx:27-33,38), so a reader can always tell
  // "memory-cited" from "model judgment" even though the PROSE itself is
  // unverified either way. Verifying rationale prose against the citable
  // context (e.g. scanning it for avoid-words or row ids that FAILED
  // verification) is DEFERRED — see ADR §15's named follow-on. Bounded,
  // display-only (§5.7).
  rationale: string
  memorySource?: ClaimedMemorySource // OPTIONAL here, and only here
}

// type-design-analyzer (D2.7 pass, NIT-1) — carries the RAW, unverified
// claim content (a claimed rowId/evidenceId/word) out of this module via
// StudioVerification's `partial`/`rejected` arms. Nothing here can enforce
// it, so it's stated instead: callers may use this for Sentry counts and
// internal diagnostics ONLY (as verifyStudioResponse itself does — counts,
// never content), never logged/rendered verbatim, and never surfaced to
// the client (§5.4's "never console.*, never surface model output" rules
// apply here too).
export type FabricatedClaim = {
  id: string
  source: ClaimedMemorySource
}

// ── the citable context: what was actually SENT to the model this call.
// Verification runs against THIS, never a fresh DB read (§8.3) — a fresh
// read is a different transaction and can legitimise a pattern promoted
// AFTER the prompt was sent (a citation the model provably could not have
// seen) or race a demotion.

export type CitableEvidence = { readonly id: string; readonly snippet: string }

export type CitableContext = {
  readonly draft: string
  // ReadonlySet, not the mutable string[] BrandVoiceRow.avoid_words is
  // (§8.1) — the oracle cannot be mutated between send and verify [type-§5].
  readonly avoidWords: ReadonlySet<string>
  readonly governedPatterns: ReadonlyMap<string, GovernedPerformancePattern>
  readonly evidence: ReadonlyMap<string, CitableEvidence>
}

// The ONE place a derived_from_metrics row is structurally refused: this
// parameter type only accepts GovernedPerformancePattern (§8.2), which
// carries no field a fallback row could ever populate (no rowId exists on a
// post_metrics-derived row) — inadmissible by construction, not by a
// runtime check that could be forgotten.
export function buildCitableContext(input: {
  draft: string
  avoidWords: ReadonlySet<string>
  governedPatterns: readonly GovernedPerformancePattern[]
  evidence: readonly CitableEvidence[]
}): CitableContext {
  return {
    draft: input.draft,
    avoidWords: input.avoidWords,
    governedPatterns: new Map(input.governedPatterns.map((p) => [p.rowId, p])),
    evidence: new Map(input.evidence.map((e) => [e.id, e])),
  }
}

// ── the brand key. NOT exported — an object literal outside this module
// cannot name it, so it cannot forge a VerifiedMemorySource by writing the
// property by hand. This is what a string-literal brand (`_brand: 'verified'`)
// does NOT close: any module can write that exact string.
//
// type-design-analyzer (D2.7 pass, BLOCKER-1) — MUST have a real runtime
// initializer. `declare const verified: unique symbol` (no initializer) is
// an AMBIENT declaration: it type-checks because ambient consts are legal
// in expression position, but it emits no JavaScript and creates no runtime
// binding — every oracle's `{ [verified]: true, ... }` literal below would
// throw `ReferenceError: verified is not defined` the instant a
// verification succeeded. `Symbol()` (not `Symbol.for()`) is deliberate:
// a well-known/global symbol would be re-obtainable by name from any other
// module via `Symbol.for('studio-verified')`, reopening the exact forgery
// path this brand exists to close.
const verified: unique symbol = Symbol('studio-verified')

// ── what the UI is allowed to render. No optional source field anywhere —
// "claimed but unverified" is UNREPRESENTABLE, not merely absent by
// convention: the `model_judgment` arm has no `source` key at all, so
// nothing can accidentally read `suggestion.source` off a model-judgment
// suggestion and get `undefined` instead of a type error.
//
// type-design-analyzer (D2.7 pass, MAJOR-1) — residual risk, stated rather
// than overlooked: construction FROM SCRATCH outside this file is
// impossible without a cast (the brand key isn't nameable elsewhere). But
// code that already legitimately HOLDS a VerifiedMemorySource can spread it
// — `{ ...suggestion.source, word: 'attacker text' }` — and the result
// still structurally satisfies this type, because object-spread carries
// symbol-keyed own properties along with it. Cross-KIND forgery fails VIA
// SPREAD (the target arm's required fields aren't present on a different
// kind's source), but same-kind FIELD substitution does not. This is a real
// cost of A-4's refusal (a #private-field class instance would drop
// silently on spread, since private fields aren't own-enumerable) —
// accepted, not hidden: the render path must consume this value immediately
// after verifyStudioResponse returns it, never round-trip it through
// intermediate code that could spread-and-mutate it first.
//
// MINOR-4 (Session 26-D correction) — the "cross-kind forgery still fails"
// sentence above is scoped to the SPREAD vector specifically, not a general
// claim. `unique symbol` is an ordinary runtime Symbol: any code holding a
// VerifiedMemorySource can recover the brand key via
// `Object.getOwnPropertySymbols(value)[0]` and attach it, via bracket
// notation, to a brand-new object literal of ANY kind — no spread, no cast,
// satisfying this type in full generality. NO non-class brand (this one
// included) can prevent symbol reflection; a #private-field class instance
// is no different — its private fields are unreachable via
// getOwnPropertySymbols/getOwnPropertyNames either way, but the class
// itself was refused for other reasons (A-4) and reflection against ITS
// brand mechanism, were one adopted, would face the analogous question
// under a different API surface. This is KNOWINGLY ACCEPTED under A-4: the
// constraint's stated threat model is code that does not cast — well-
// meaning code making a mistake — and reflection via
// getOwnPropertySymbols is not something well-meaning code does by
// accident. Do not "fix" this by proposing a class here; see A-4.
export type VerifiedMemorySource = { readonly [verified]: true } & (
  | { kind: 'avoid_word'; word: string; matchOffset: number }
  | {
      kind: 'performance_pattern'
      rowId: string
      pattern: string
      confidence: number
      observationCount: number
    }
  | { kind: 'evidence'; evidenceId: string; snippet: string }
)

export type RenderedSuggestion = {
  id: string
  category: StudioSpanCategory
  rationale: string
} & (
  | { attribution: 'memory'; source: VerifiedMemorySource }
  | { attribution: 'model_judgment' } // NO source field EXISTS on this arm
)

// ── minted only by the verifier, only from a single bound call value
// (§8.4(ii)): a two-parameter verify(sentContext, response) can be handed a
// mismatched pair, and a phantom type parameter does not save it (TS
// unifies the parameter at a single call site, so the pairing never bites).
// The Studio runner is expected to return ONE value carrying both the
// citable context it sent and the parsed response; the verifier consumes
// exactly that.
export type StudioCall = Readonly<{
  citable: CitableContext
  parsed: readonly ClaimedSuggestion[]
}>

export type StudioVerification =
  | { outcome: 'clean'; set: readonly RenderedSuggestion[] }
  | { outcome: 'partial'; set: readonly RenderedSuggestion[]; fabricated: readonly FabricatedClaim[] }
  // the rejected arm carries NO SET — "ignore the fabrication report" is
  // unreachable rather than merely discouraged (§8.3).
  | { outcome: 'rejected'; fabricated: readonly FabricatedClaim[] }

// Domain decision fixed in the ADR, NOT a runtime tunable (§8.3): more than
// half of the suggestions CARRYING A CLAIM failing verification means the
// model is not reading the context, and every uncited rationale in that
// response is then equally suspect.
const FABRICATION_REJECT_THRESHOLD = 0.5

// ── the three oracles (§8.1). Each returns null on failure — the caller
// decides what null means (demote), never throws, since a failed citation
// is an expected, common outcome, not an error.

// EVERY RENDERED BYTE COMES FROM THE VERIFIED SOURCE, never the model's
// claim string: the word AS SPELLED IN THE LIST, plus the REAL match offset
// recomputed here, not whatever offset (if any) the model claimed.
function verifyAvoidWord(claim: { word: string }, citable: CitableContext): VerifiedMemorySource | null {
  const claimedLower = claim.word.toLowerCase()
  let matchedWord: string | null = null
  for (const w of citable.avoidWords) {
    if (w.toLowerCase() === claimedLower) {
      matchedWord = w
      break
    }
  }
  if (matchedWord === null) return null
  // BOTH conditions required (§8.1): on the list AND actually present in
  // the pre-revision draft. containsWord (lib/learning/diff.ts:134-138) is
  // reused rather than a second implementation.
  if (!containsWord(citable.draft, matchedWord)) return null

  const escaped = matchedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i')
  const match = pattern.exec(citable.draft)
  if (match === null) return null // defensive: containsWord just proved a match exists

  return { [verified]: true, kind: 'avoid_word', word: matchedWord, matchOffset: match.index }
}

// rowId ∈ the SENT governed set (a Map built once at buildCitableContext
// time, from GovernedPerformancePattern values only — see that function's
// comment for why a derived_from_metrics row cannot appear here at all).
function verifyPerformancePattern(claim: { rowId: string }, citable: CitableContext): VerifiedMemorySource | null {
  const row = citable.governedPatterns.get(claim.rowId)
  if (row === undefined) return null
  // Pattern text is itself LLM-authored, untrusted-adjacent text
  // (lib/db/memory-performance.ts:47-56) — rendered as clearly-delimited,
  // length-capped quoted data is the RENDER layer's job (a future
  // <MemoryCitation> component); this verifier's job is only to prove the
  // row was really sent, and pass the row's own fields through unaltered.
  return {
    [verified]: true,
    kind: 'performance_pattern',
    rowId: row.rowId,
    pattern: row.pattern,
    confidence: row.confidence,
    observationCount: row.observationCount,
  }
}

// evidenceId ∈ the ids passed to wrapEvidenceForPrompt (lib/ai/wrap-evidence.ts:132-140).
function verifyEvidence(claim: { evidenceId: string }, citable: CitableContext): VerifiedMemorySource | null {
  const row = citable.evidence.get(claim.evidenceId)
  if (row === undefined) return null
  return { [verified]: true, kind: 'evidence', evidenceId: row.id, snippet: row.snippet }
}

function verifyClaim(source: ClaimedMemorySource, citable: CitableContext): VerifiedMemorySource | null {
  switch (source.kind) {
    case 'avoid_word':
      return verifyAvoidWord(source, citable)
    case 'performance_pattern':
      return verifyPerformancePattern(source, citable)
    case 'evidence':
      return verifyEvidence(source, citable)
    default: {
      // type-design-analyzer (D2.7 pass, MINOR-2) — explicit, self-documenting
      // exhaustiveness: a `never` assignment here fails to compile the moment
      // a fourth ClaimedMemorySource kind is added, rather than relying on
      // "no default + non-void return" alone, which a later well-meaning
      // `default: return null` could silently defeat.
      const exhaustive: never = source
      throw new Error(`Unhandled ClaimedMemorySource kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}

// The verifier mints THE SET, not the source (§8.4(i)) — there is no API
// that accepts a suggestion and a source separately, because a genuine
// token beside a lying sentence would still typecheck if it could
// (a re-bound pair is the hole no brand strength alone fixes).
export function verifyStudioResponse(call: StudioCall): StudioVerification {
  const set: RenderedSuggestion[] = []
  const fabricated: FabricatedClaim[] = []
  let claimingCount = 0

  for (const claim of call.parsed) {
    if (claim.memorySource === undefined) {
      set.push({ id: claim.id, category: claim.category, rationale: claim.rationale, attribution: 'model_judgment' })
      continue
    }

    claimingCount += 1
    const verifiedSource = verifyClaim(claim.memorySource, call.citable)
    if (verifiedSource !== null) {
      set.push({
        id: claim.id,
        category: claim.category,
        rationale: claim.rationale,
        attribution: 'memory',
        source: verifiedSource,
      })
    } else {
      // Failure DEMOTES to model_judgment — never dropped (that punishes
      // the user for the model's error and hides a possibly-useful edit),
      // and the unverified citation is never rendered (§8.3).
      fabricated.push({ id: claim.id, source: claim.memorySource })
      set.push({ id: claim.id, category: claim.category, rationale: claim.rationale, attribution: 'model_judgment' })
    }
  }

  if (claimingCount > 0 && fabricated.length / claimingCount > FABRICATION_REJECT_THRESHOLD) {
    // §8.3 — no console.* (L-13); Sentry only, redacted (a count, no claim
    // content, no rationale text, no draft text).
    Sentry.captureMessage('studio_fabricated_citation_threshold', {
      level: 'warning',
      tags: { fabricated_citation_count: fabricated.length, claiming_count: claimingCount },
    })
    return { outcome: 'rejected', fabricated }
  }
  if (fabricated.length > 0) {
    return { outcome: 'partial', set, fabricated }
  }
  return { outcome: 'clean', set }
}

// ── the RSC boundary crossing (§8.5). The citation renders in a Server
// Component (`<MemoryCitation source={verified} />`, a future component)
// that consumes the branded RenderedSuggestion server-side, so the branded
// value is NEVER serialized. Where interactivity forces a DTO (the
// interactive suggestion card), toStudioClientDTO is the SINGLE producer of
// the DTO's `attribution: 'memory'` arm.
//
// Degradation stated explicitly, not claimed away: the DTO is plain,
// serializable, UN-branded data — from here on, the invariant is
// "single-producer chokepoint + executable source scan"
// (lib/studio/verify.test.ts's three scans), NOT "type-enforced." Claiming
// unrepresentability past this boundary is exactly what serialization has
// already destroyed [type-§1g]; this comment says so rather than claiming
// more, the same discipline as wrap-evidence.ts's own citation-by-id notes.
// A plain Omit<Union, K> does NOT distribute per-arm here: keyof a union
// type is the INTERSECTION of each member's keys, so Omit<VerifiedMemorySource,
// typeof verified> would collapse to just `kind`, losing every arm's own
// fields. A conditional type with a naked type parameter forces
// per-member distribution instead.
type OmitBrand<T> = T extends unknown ? Omit<T, typeof verified> : never

// type-design-analyzer (D2.7 pass, MINOR-3) — the source union is DERIVED
// via OmitBrand<VerifiedMemorySource>, not hand-duplicated: a field added
// to VerifiedMemorySource's arms now shows up here for free (still
// un-branded, since the omit strips the symbol key), instead of a second
// copy that could silently drift from the first — the same
// forcing-function discipline StudioSpanCategorySchema already applies to
// the rubric's keys.
export type StudioSuggestionDTO = {
  id: string
  category: StudioSpanCategory
  rationale: string
} & (
  | { attribution: 'memory'; source: OmitBrand<VerifiedMemorySource> }
  | { attribution: 'model_judgment' }
)

export function toStudioClientDTO(suggestion: RenderedSuggestion): StudioSuggestionDTO {
  if (suggestion.attribution === 'model_judgment') {
    return { id: suggestion.id, category: suggestion.category, rationale: suggestion.rationale, attribution: 'model_judgment' }
  }
  const source = suggestion.source
  switch (source.kind) {
    case 'avoid_word':
      return {
        id: suggestion.id,
        category: suggestion.category,
        rationale: suggestion.rationale,
        attribution: 'memory',
        source: { kind: 'avoid_word', word: source.word, matchOffset: source.matchOffset },
      }
    case 'performance_pattern':
      return {
        id: suggestion.id,
        category: suggestion.category,
        rationale: suggestion.rationale,
        attribution: 'memory',
        source: {
          kind: 'performance_pattern',
          rowId: source.rowId,
          pattern: source.pattern,
          confidence: source.confidence,
          observationCount: source.observationCount,
        },
      }
    case 'evidence':
      return {
        id: suggestion.id,
        category: suggestion.category,
        rationale: suggestion.rationale,
        attribution: 'memory',
        source: { kind: 'evidence', evidenceId: source.evidenceId, snippet: source.snippet },
      }
    default: {
      // MINOR-2, same discipline as verifyClaim's default case above.
      const exhaustive: never = source
      throw new Error(`Unhandled VerifiedMemorySource kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}
