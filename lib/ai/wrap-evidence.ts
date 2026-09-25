import type { SupabaseClient } from '@supabase/supabase-js'
import { getEvidenceMemoryByIds } from '@/lib/db/memory-evidence'
import type { UntrustedText } from '@/lib/db/types'

// B2.4 type-design-analyzer finding (MINOR) — a bare `string` didn't
// distinguish "output of wrapEvidenceForPrompt (guarded/capped/sanitized)"
// from "any string a caller assembled by hand," even though the ADR treats
// this guard as security-load-bearing (§9, MODE2-EVIDENCE-DATA-GUARDED).
// Branded the same way lib/db/types.ts's VaultSecretId is: only this
// module's own return statement below can produce one, so a prompt that
// requires RenderedEvidence cannot silently accept unguarded evidence text.
export type RenderedEvidence = string & { readonly _brand: 'RenderedEvidence' }

// ADR 0017 §9 [sec-HIGH-1] — hard cap, TRUNCATE not warn. Applied to each
// evidence item's rendered body (after neutralization, before wrapping), so
// the actual bytes reaching the prompt are bounded regardless of how long
// the underlying evidence_memory.content row is. Tunable; the security
// property is that a hard cap exists, not this exact number.
export const EVIDENCE_MAX_CHARS = 2000

const TRUNCATION_SUFFIX = '… [truncated]'

// Zero-width space: invisible to a human reader, but breaks an exact-token
// match on the character sequence that follows it (a fence marker, a JSON
// leading delimiter). Preserves near-identical visual rendering — this is a
// defusal, not a rewrite, so a legitimate human-authored quote still reads
// naturally in review UIs.
const ZWSP = '​'

// B2.3 security-reviewer correction pass (HIGH-1, HIGH-2, MEDIUM-1) — a
// literal ASCII regex on `[/DATA]` is bypassable three ways, and the guard
// must close all three BEFORE the literal-match step, not just the pattern
// it happens to look for:
//   - HIGH-1: an attacker inserts an invisible Unicode format character
//     (ZWSP, ZWNJ, ZWJ, BOM, soft hyphen, ...) inside their own "[/DATA]"
//     (e.g. "[/DA​TA]") — visually identical, regex-invisible. This is
//     the SAME mechanism the guard itself used offensively for the
//     triple-backtick defusal below, which was an internal inconsistency:
//     defending with a technique while not defending against it.
//   - HIGH-2: Unicode bidi-override characters (U+202A-U+202E, U+2066-U+2069)
//     and Tag-block steganography characters (U+E0000-U+E007F) — both also
//     Unicode category Cf (Format) — are hidden-instruction-smuggling
//     primitives entirely outside the three patterns previously neutralized.
//   - MEDIUM-1: full-width/compatibility homoglyphs (e.g. "［／ＤＡＴＡ］")
//     render near-identically to "[/DATA]" but don't byte-match it.
// One combined pre-pass closes all three: NFKC-normalize (canonicalizes
// full-width/compatibility variants back to their ASCII form, closing
// MEDIUM-1) then strip every Unicode category-Cf (Format) character (closes
// HIGH-1 and HIGH-2 in one step, since ZWSP/ZWNJ/ZWJ/BOM/soft-hyphen/bidi-
// overrides/tag-block chars are ALL category Cf). Applied first, so every
// later step (the literal [/DATA] match, the fence/brace defusal) operates
// on already-canonicalized text.
//
// Accepted residual risk, stated not overlooked (matches ADR §9's own
// [sec-LOW-1] posture): true Unicode confusables (e.g. Cyrillic letters that
// merely LOOK like Latin ones, which are genuinely different codepoints, not
// compatibility-decomposable) are not caught by NFKC normalization. Full
// confusables-table detection is out of proportion for this pass; revisit if
// this residual gap is ever observed exploited.
function stripInvisibleFormatChars(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '')
}

// ADR 0017 §9 — this function IS the render-time guard: it neutralizes
// every pattern the security pass ([sec-HIGH-1], [sec-HIGH-2]) flagged as
// capable of confusing either the model's instruction-following or a
// downstream safeParse:
//   1. a [/DATA] closer (case-insensitive) — would let injected text escape
//      the data block and be read as instructions.
//   2. a triple-backtick fence — could induce the model to treat evidence as
//      a code block containing its own (attacker-controlled) JSON payload.
//   3. a LEADING { or [ — could read as the start of the expected JSON
//      output, confusing a safeParse-based consumer downstream.
// B2.5 security-reviewer correction pass (MEDIUM, chained) — exported so
// callers rendering OTHER DB-stored/AI-generated text into a prompt (brief
// assembly's audience/brand candidates and the critique step's own
// narrative/proofPlan, lib/campaigns/brief.ts + lib/ai/prompts/brief.ts) can
// reuse this SAME Unicode-hardened guard instead of a local, ASCII-literal-
// only sanitizeDataField. The finding: those fields had no structural
// guarantee of trustworthiness (a compromised distillation worker, or the
// assembly model itself echoing an injected instruction into its own
// output) but were getting a strictly weaker guard than evidence_memory —
// an inconsistency in the threat model, not a justified design choice.
export function neutralize(rawText: string): string {
  let out = stripInvisibleFormatChars(rawText)
  out = out.replace(/\[\/DATA\]/gi, '[/data-blocked]')
  out = out.replace(/```/g, '`' + ZWSP + '`' + ZWSP + '`')
  const firstNonWhitespace = out.search(/\S/)
  if (firstNonWhitespace !== -1 && (out[firstNonWhitespace] === '{' || out[firstNonWhitespace] === '[')) {
    out = out.slice(0, firstNonWhitespace) + ZWSP + out.slice(firstNonWhitespace)
  }
  return out
}

// ADR 0019 §5.5 [sec-HIGH-1] — a NEW sibling, not a reordering of neutralize()
// by composition at the call site. neutralize() has a FIXED internal order
// (normalize+strip-Cf, THEN the [/DATA]/fence/brace passes) — that order is
// exactly right for evidence/brief text but wrong for Studio's draft guard,
// which needs a WIDER strip class (category Cf/Co/Cs plus variation
// selectors — Mn, not Cf, and therefore invisible to neutralize() today) and
// needs normalize and strip to be independently callable steps, because
// lib/studio/guard.ts's post-truncation re-run must re-strip WITHOUT
// re-normalizing ("never normalize after stripping" — normalization can
// produce a character an earlier strip pass already ran past). neutralize()
// itself is UNCHANGED by this addition; every existing caller (guard(),
// wrapEvidenceForPrompt()) keeps calling it exactly as before.
//
// Strips, as one pass: \p{Cf} (format, as neutralize() does today), \p{Co}
// (private-use — covers the plane-15 marker sentinels U+F0000/U+F0001 as a
// character class, per ADR §5.1), \p{Cs} (lone/unpaired surrogates —
// malformed input), and variation selectors U+FE00–FE0F and the
// supplement-plane block U+E0100–E01EF (Unicode category Mn, NOT Cf — the
// exact gap [sec-HIGH-1] names: an invisible variation selector inside a
// marker token defeats an exact-match regex, and neutralize()'s \p{Cf}-only
// strip misses it entirely).
const STUDIO_STRIP_PATTERN = /[\p{Cf}\p{Co}\p{Cs}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu

export function neutralizeWithSentinels(rawText: string, options?: { skipNormalize?: boolean }): string {
  // NFKC normalize is a SEPARATE, skippable step — lib/studio/guard.ts's
  // post-truncation re-run (ADR §5.5 step 7) must re-strip without
  // re-normalizing, since normalizing already-stripped text can produce a
  // character an earlier strip pass already ran past.
  let out = options?.skipNormalize ? rawText : rawText.normalize('NFKC')
  out = out.replace(STUDIO_STRIP_PATTERN, '')
  out = out.replace(/\[\/DATA\]/gi, '[/data-blocked]')
  out = out.replace(/```/g, '`' + ZWSP + '`' + ZWSP + '`')
  const firstNonWhitespace = out.search(/\S/)
  if (firstNonWhitespace !== -1 && (out[firstNonWhitespace] === '{' || out[firstNonWhitespace] === '[')) {
    out = out.slice(0, firstNonWhitespace) + ZWSP + out.slice(firstNonWhitespace)
  }
  return out
}

function truncate(text: string): string {
  if (text.length <= EVIDENCE_MAX_CHARS) return text
  return text.slice(0, EVIDENCE_MAX_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}

function guard(rawContent: string): string {
  // Neutralize BEFORE truncating: the cap must bound the actual rendered
  // bytes, not the pre-neutralization length (neutralization slightly
  // lengthens content via ZWSP insertion / closer-replacement text).
  const neutralized = neutralize(rawContent)
  const capped = truncate(neutralized)
  // Re-run the [/DATA]-closer pass once more post-truncation: cheap,
  // idempotent, and closes the (extremely unlikely, since our own
  // replacement text "[/data-blocked]" never itself contains a valid
  // "[/DATA]" substring) edge case of a truncation boundary reconstructing
  // one. Defense in depth for the ONE choke point every caller relies on.
  const reguarded = capped.replace(/\[\/DATA\]/gi, '[/data-blocked]')
  return `[DATA]\n${reguarded}\n[/DATA]`
}

// ADR 0017 §9 — the single shared choke point. CITATION-BY-ID: callers pass
// ids pinned in a frozen brief, never inlined text; this function RE-FETCHES
// the rows at render time (never trusts a cached/previously-sanitized copy,
// [sec-HIGH-2]) and includes only status='active' rows (getEvidenceMemoryByIds
// already filters this — a retired id between freeze and generation is
// silently dropped, [db-NIT-2]). Every render caller (brief-assembly, native
// generation ×N, rubric/critique — ADR §12's caller table) MUST route
// through this function; there is no authorized path that renders evidence
// content directly.
//
// `client` must be a service-role client — evidence_memory reads here cross
// the citation-by-id boundary rather than an RLS-scoped SELECT policy.
// Session 24-D (MAJOR-1 correction) — the pinned id set was PREVIOUSLY
// asserted, not enforced, as the sole trust boundary; getEvidenceMemoryByIds
// now also filters by businessId (the campaign's tenant, threaded in by every
// caller below), so a foreign-tenant id renders nothing even if one were ever
// pinned. Defense in depth: citation-by-id AND business_id scoping, not one
// or the other.
// What wrapEvidenceForPrompt renders for zero ids — exported so a test double for a tool that returns
// `{ ids, evidence }` can say "no evidence" without minting its own brand by cast (K2.3).
export const EMPTY_RENDERED_EVIDENCE = '' as RenderedEvidence

export async function wrapEvidenceForPrompt(
  client: SupabaseClient,
  businessId: string,
  evidenceIds: string[],
): Promise<RenderedEvidence> {
  if (evidenceIds.length === 0) return EMPTY_RENDERED_EVIDENCE
  const rows = await getEvidenceMemoryByIds(client, businessId, evidenceIds)
  return rows.map((row) => guard(row.content)).join('\n\n') as RenderedEvidence
}

// ─── The bound evidence set (ADR 0027 §4.2/§4.5, Session 34 K2.9) ───────────
//
// ONE fetch produces BOTH the text the model is shown AND the set of ids it was shown — the CitableContext of
// lib/studio/verify.ts:77-84, "bound at send time". Claim verification (lib/campaigns/verify-claims.ts)
// intersects a cited id with THIS set and never re-reads the database: a fresh read is a different transaction
// and could legitimise a row promoted AFTER the prompt was sent (a citation the model provably could not have
// seen), or race a demotion. Deriving the render and the oracle from the same rows makes that drift
// unrepresentable rather than merely tested.
//
// Every id in `sentIds` came out of getEvidenceMemoryByIds, so it is business-scoped, status='active' and
// not soft-deleted — a cross-tenant id can never be a member.
//
// Non-exported `unique symbol` brand with a REAL runtime initializer (the Session 31 BLOCKER-1 lesson: an
// ambient `declare const` throws at runtime), so an object literal cannot be passed off as a bound set. The
// brand kills structural forgery, not a bare cast — the same honest limit as the tool-result brands above.
const boundEvidenceBrand: unique symbol = Symbol('wrap-evidence-bound-evidence')

export type BoundEvidence = {
  // What goes into the prompt: `Evidence id: <uuid>` then the guarded [DATA] block, per row, so the model has a
  // real id to cite. The id is a database uuid, never model or third-party text.
  readonly rendered: RenderedEvidence
  readonly sentIds: ReadonlySet<string>
  readonly [boundEvidenceBrand]: true
}

export async function bindEvidenceForPrompt(
  client: SupabaseClient,
  businessId: string,
  evidenceIds: string[],
): Promise<BoundEvidence> {
  const rows = evidenceIds.length === 0 ? [] : await getEvidenceMemoryByIds(client, businessId, evidenceIds)
  const rendered = rows.map((row) => `Evidence id: ${row.id}\n${guard(row.content)}`).join('\n\n') as RenderedEvidence
  return Object.freeze({
    rendered,
    sentIds: new Set(rows.map((row) => row.id)),
    [boundEvidenceBrand]: true as const,
  })
}

// ─── Signal text (ADR 0020 §7.3/§7.4) ───────────────────────────────────────

// A DISTINCT brand from RenderedEvidence, deliberately — NOT a reuse.
// RenderedEvidence's guarantee is "re-fetched and tenant-rescoped at render
// time": wrapEvidenceForPrompt above takes IDs and re-queries the rows
// itself (:171-179), re-checking business_id at fetch time. Signal text is
// text ALREADY IN HAND (passed in directly by the caller) — no re-fetch and
// no tenant re-check happens or is possible here. Reusing RenderedEvidence's
// name for this value would bake a FALSE PROVENANCE CLAIM into a type: a
// reader seeing `RenderedEvidence` would reasonably assume the
// re-fetch-and-rescope guarantee applies, and it would not. This is the same
// class of error branding exists to prevent, one level up.
//
// Non-exported `unique symbol` brand key — same rationale as UntrustedText
// (lib/db/types.ts): globally unique by construction, so no other module can
// accidentally produce a structurally-identical type by reusing a string
// literal.
const renderedSignalTextBrand: unique symbol = Symbol('signals-rendered-signal-text')
export type RenderedSignalText = string & { readonly [renderedSignalTextBrand]: true }

// Mirrors EVIDENCE_MAX_CHARS's own value and rationale (a hard hard cap
// exists; the exact number is tunable) — a SEPARATE named constant, not a
// silent reuse of EVIDENCE_MAX_CHARS, since evidence and signal text are
// different content categories governed by the same policy, not the same
// value by coincidence.
export const SIGNAL_MAX_CHARS = 2000

function truncateSignalText(text: string): string {
  if (text.length <= SIGNAL_MAX_CHARS) return text
  return text.slice(0, SIGNAL_MAX_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}

// ─── Tool results (ADR 0021 §7.3, Session 28 E5.5) ──────────────────────────

// Mirrors EVIDENCE_MAX_CHARS/SIGNAL_MAX_CHARS's own cap policy — a hard cap
// exists; the value is a separate named constant, not a coincidental reuse.
export const TOOL_RESULT_MAX_CHARS = 2000

function truncateToolResultField(text: string): string {
  if (text.length <= TOOL_RESULT_MAX_CHARS) return text
  return text.slice(0, TOOL_RESULT_MAX_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}

// ADR 0021 §7.3 — "every other string field of every tool result" (evidence
// keeps going through the EXISTING wrapEvidenceForPrompt above, for its
// citation-by-id + business-scoped-re-fetch guarantee — this is not a
// replacement for that). A SIBLING, not a sixth local sanitizeDataField and
// not a new module: reuses neutralizeWithSentinels(), the same
// Unicode-hardened guard lib/studio/guard.ts and wrapSignalForPrompt() rely
// on. Applied PER FIELD, not per-row-joined — a tool result is a set of
// individually-addressable fields (an audience note's statement, a
// campaign's name/objective), each of which the model may read and quote
// independently, so each is guarded and capped on its own rather than
// concatenated into one block the way wrapEvidenceForPrompt renders a
// citation set.
//
// security-reviewer (E5.4+E5.5+E5.7 pass, HIGH-2): the property this
// function exists to guarantee is "every string field a tool's execute()
// returns has already passed through a guard before it leaves the tool".
//
// Session 34 K2.3 (ADR 0027 §6.2/§6.3, [sec-MINOR-9]) — CORRECTION of the
// comment that stood here, which claimed the dispatcher's JSON.stringify
// "cannot itself distinguish guarded from raw content". That is FALSE: the
// [DATA] envelope IS a distinguishing marker, emitted on every guarded path
// (guard(), this function, wrapSignalForPrompt). The dispatcher therefore
// ENFORCES the property at runtime — assertGuardedToolResult below runs
// before that single JSON.stringify — and the return type is now the
// RenderedToolResult brand, so a raw string cannot be placed where a
// tool-result string is required. Tool-boundary semantics (which field is
// content, which is an id) stay with the tool; enforcement lives at the one
// point every tool's output passes through.
export function wrapToolResultForPrompt(rawText: string): RenderedToolResult {
  const neutralized = neutralizeWithSentinels(rawText)
  const capped = truncateToolResultField(neutralized)
  // Re-run the [/DATA]-closer pass once more post-truncation — same
  // defense-in-depth as guard() and wrapSignalForPrompt() above.
  const reguarded = capped.replace(/\[\/DATA\]/gi, '[/data-blocked]')
  return `[DATA]\n${reguarded}\n[/DATA]` as RenderedToolResult
}

// ─── The tool-result guarantee (ADR 0027 §6.2) ──────────────────────────────
//
// Two more non-exported `unique symbol` brands, minted with REAL runtime
// initializers (never an ambient `declare const` — that throws at runtime, the
// Session 31 BLOCKER-1 lesson). Same pattern as renderedSignalTextBrand above.
//
// HONEST LIMITS, stated where the brand is minted (ADR 0027 §6.2 — do not
// restate this more strongly):
//   1. A branded string is still a `string`: it drops into any template-literal
//      hole with no error.
//   2. A bare `as RenderedToolResult` (or `as ToolResultId`, `as GuardedJson`)
//      cast is compile-legal.
// The brand kills STRUCTURAL FORGERY; it does not kill a cast. The cast is
// closed by the executable scan in lib/campaigns/planner/__tests__/
// source-scans.test.ts (AGENCY-TOOL-RESULT-BRANDED) — without that scan the
// brand is decoration.
const renderedToolResultBrand: unique symbol = Symbol('tool-result-rendered')
export type RenderedToolResult = string & { readonly [renderedToolResultBrand]: true }

const toolResultIdBrand: unique symbol = Symbol('tool-result-id')
export type ToolResultId = string & { readonly [toolResultIdBrand]: true }

// The single UUID-shape pattern: the mint below AND the dispatcher's assertGuardedToolResult both use THIS
// constant (Session 34-D D3, MINOR-5) — never a second regex.
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The ONLY producer of a ToolResultId. It VALIDATES (Session 34-D D3, MINOR-5): a non-UUID throws, so
// `texts.map(toToolResultId)` over post text — a call tsc and the cast scan cannot see — fails at the mint,
// in the tool's own test, rather than only at the dispatcher (assertGuardedToolResult stays as the second,
// unskippable layer).
export function toToolResultId(id: string): ToolResultId {
  if (typeof id !== 'string' || !UUID_SHAPE.test(id)) {
    throw new Error('toToolResultId: refused a value that is not UUID-shaped')
  }
  return id as ToolResultId
}

// What a tool's execute() may return: JSON whose ONLY string members are a guarded render (a tool-result
// field, an evidence block or signal text — every one of them [DATA]-enveloped) or an id. Adding a raw
// `html_url: string` to a tool result no longer type-checks.
export type GuardedJson =
  | null
  | boolean
  | number
  | RenderedToolResult
  | RenderedEvidence
  | RenderedSignalText
  | ToolResultId
  | readonly GuardedJson[]
  | { readonly [key: string]: GuardedJson }

const ENVELOPE_OPEN = '[DATA]\n'
const ENVELOPE_CLOSE = '\n[/DATA]'
const GUARDED_JSON_MAX_DEPTH = 16

// A rendered string is one or more [DATA] blocks joined by a blank line (wrapEvidenceForPrompt joins rows that
// way). Every guard replaces an inner [/DATA] with [/data-blocked], so the FIRST closer in a block is its real
// end — anything after it must be the end of the string or the opening of the next block. The empty string
// (wrapEvidenceForPrompt with no ids) carries nothing.
function isGuardedEnvelope(text: string): boolean {
  if (text === '') return true
  let rest = text
  for (;;) {
    if (!rest.startsWith(ENVELOPE_OPEN)) return false
    const close = rest.indexOf(ENVELOPE_CLOSE, ENVELOPE_OPEN.length - 1)
    if (close === -1) return false
    rest = rest.slice(close + ENVELOPE_CLOSE.length)
    if (rest === '') return true
    if (!rest.startsWith('\n\n')) return false
    rest = rest.slice(2)
  }
}

// ADR 0027 §6.3 — enforcement at the DISPATCHER (lib/ai/tool-runner.ts), over its single JSON.stringify output:
// every string a tool returned is either UUID-shaped or [DATA]-enveloped. The tool boundary is the wrong place
// for enforcement because a new tool can forget to visit it; it cannot forget the dispatcher. The thrown message
// names the PATH of the offending value and never its content, so a violation cannot itself leak text.
//
// HONEST LIMIT (typescript-reviewer, K2.3 finding 2 — do not restate this more strongly): this proves a string
// has the SHAPE of a guard's output, NOT that a guard produced it. Text hand-wrapped as `[DATA]\n…\n[/DATA]` (or
// carrying its own closer followed by a fresh opener) is accepted. Provenance rests on the brands and the cast
// scan, not on this function. It is defence in depth against the accidental raw field — the case it was built for.
//
// Object KEYS are constrained too (finding 1): a key built from data is text the model reads, so it must look like
// an identifier.
const OBJECT_KEY_SHAPE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export function assertGuardedToolResult(value: unknown, path = '$', depth = 0): void {
  if (depth > GUARDED_JSON_MAX_DEPTH) throw new Error(`tool result too deep at ${path}`)
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number in tool result at ${path}`)
    return
  }
  if (typeof value === 'string') {
    if (UUID_SHAPE.test(value) || isGuardedEnvelope(value)) return
    throw new Error(`unguarded string in tool result at ${path}`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertGuardedToolResult(item, `${path}[${i}]`, depth + 1))
    return
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      // The message names the path so far and the key's LENGTH, never the key itself: a raw-text key must not
      // be echoed by its own rejection.
      if (!OBJECT_KEY_SHAPE.test(key)) throw new Error(`non-identifier object key (${key.length} chars) in tool result at ${path}`)
      assertGuardedToolResult(item, `${path}.${key}`, depth + 1)
    }
    return
  }
  throw new Error(`non-JSON value (${typeof value}) in tool result at ${path}`)
}

// ADR 0020 §7.4 — the ONE chokepoint for signal text, alongside
// wrapEvidenceForPrompt in this same module ("one module owning
// prompt-safety, two honest provenance types"). Reuses
// neutralizeWithSentinels() (:117), NOT a sixth local sanitizeDataField —
// five weak copies already exist (brief.ts:13, rubric.ts:9,
// post-generation.ts:7, post-regeneration.ts:8,
// formats/native-generation-prompt.ts:9), documented accepted debt
// (ADR 0018 §15), not a pattern to extend; lib/studio/guard.ts:11 already
// forbids a sixth, and this ADR does not write a seventh.
//
// SINK NARROWING is the load-bearing half (§7.3 Change 2): the parameter
// type is UntrustedText, never `string` — branding the input makes raw text
// loud, but what actually stops the injection path at a known call site is
// every prompt-builder parameter accepting only the safe brand.
//
// THE HONEST LIMIT (stated here, not only in the ADR — reviewers caught
// this exact overclaim TWICE in prior sessions, ADR 0019 §8.4 records
// both): this is "discouraged", NOT "unrepresentable". `string & brand` is
// assignable to any `string` parameter and — decisively — to any
// template-literal hole: `` `Context:\n${signal.body}` `` compiles with NO
// error, brand or no brand. A bare `as RenderedSignalText` cast likewise
// remains compile-legal. That residual is closed by E2.10's executable
// source scans (ADR §11.3 scan #4), not by a stronger type. Do not restate
// this guarantee more strongly than §7.3 does.
export function wrapSignalForPrompt(signal: {
  title: UntrustedText
  body: UntrustedText
}): RenderedSignalText {
  // Neutralize BEFORE truncating — same ordering rationale as guard() above:
  // the cap must bound the actual rendered bytes, not the pre-neutralization
  // length.
  const neutralizedTitle = neutralizeWithSentinels(signal.title)
  const neutralizedBody = neutralizeWithSentinels(signal.body)
  const combined = `${neutralizedTitle}\n\n${neutralizedBody}`
  const capped = truncateSignalText(combined)
  // Re-run the [/DATA]-closer pass once more post-truncation, same defense
  // in depth as guard()'s own re-run.
  const reguarded = capped.replace(/\[\/DATA\]/gi, '[/data-blocked]')
  return `[DATA]\n${reguarded}\n[/DATA]` as RenderedSignalText
}
