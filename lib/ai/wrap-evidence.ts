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
export async function wrapEvidenceForPrompt(
  client: SupabaseClient,
  businessId: string,
  evidenceIds: string[],
): Promise<RenderedEvidence> {
  if (evidenceIds.length === 0) return '' as RenderedEvidence
  const rows = await getEvidenceMemoryByIds(client, businessId, evidenceIds)
  return rows.map((row) => guard(row.content)).join('\n\n') as RenderedEvidence
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
// returns has already passed through a guard before it leaves the tool" —
// a fixture-based test (tools.test.ts), not a JSON.stringify grep (the
// dispatcher in lib/ai/tool-runner.ts unconditionally JSON.stringifies
// whatever a tool returns, by design — that call site cannot itself
// distinguish guarded from raw content).
export function wrapToolResultForPrompt(rawText: string): string {
  const neutralized = neutralizeWithSentinels(rawText)
  const capped = truncateToolResultField(neutralized)
  // Re-run the [/DATA]-closer pass once more post-truncation — same
  // defense-in-depth as guard() and wrapSignalForPrompt() above.
  const reguarded = capped.replace(/\[\/DATA\]/gi, '[/data-blocked]')
  return `[DATA]\n${reguarded}\n[/DATA]`
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
