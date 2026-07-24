import type { SupabaseClient } from '@supabase/supabase-js'
import { getEvidenceMemoryByIds } from '@/lib/db/memory-evidence'

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
