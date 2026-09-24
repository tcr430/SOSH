import * as Sentry from '@sentry/nextjs'
import type { BoundEvidence } from '@/lib/ai/wrap-evidence'
import type { Claim } from '@/lib/ai/prompts/formats/schemas'
import type { PersistedClaimCheck } from '@/lib/db/types'

// ADR 0027 §4.2-§4.8 (Session 34 K2.9) — post-generation CLAIM VERIFICATION for Mode 2: a DETERMINISTIC,
// NON-LLM check that a claim the draft makes carries a citation traceable to evidence the model was actually
// SHOWN. FLAGGED, NEVER EDITED, NEVER WITHHELD (L-4): this module renders a verdict per claim and touches
// nothing else — it imports no database module and no posts writer (AGENCY-CLAIMS-FLAGGED-NEVER-EDITED).
//
// ── CROSS-REFERENCE — the THREE instantiations of the verify-then-cite shape (founder ruling A-2) ──────────────
// This is the THIRD independent implementation of the pattern. Reality §9 warned a third one "would be the
// failure"; ruling A-2 ratified it (a different mode, a different citable set, a different consumer) but attached
// this obligation: each module names the other two so a future unification session has the map, not an
// archaeology exercise. THE MAP (current paths — lib/campaigns/verify-claims.test.ts asserts all three files
// name the other two, so a rename fires a test):
//   1. lib/studio/verify.ts             — Studio: verifies a suggestion's memory citation against a CitableContext
//                                          bound at send time; HAS a `rejected` arm above FABRICATION_REJECT_THRESHOLD.
//   2. lib/signals/triage/verify.ts     — Mode 3 Stage C: verifies a card's citations against the exact set the
//                                          triage tools returned this call.
//   3. lib/campaigns/verify-claims.ts   — THIS FILE. Mode 2: verifies a draft's claims against the frozen brief's
//                                          pinned evidence, bound at send time (BoundEvidence).
// If you unify them, start from the differences: the citable set (tool-call result vs pinned evidence), the
// consumer (Studio render vs approval gate), and the fact that THIS one has no rejected arm.
//
// ── WHAT THIS PROVES, AND WHAT IT DOES NOT (ADR 0027 §4.6, [sec-MAJOR-6]) ────────────────────────────────────
// VERIFICATION PROVES PROVENANCE, NOT SUPPORT. It proves a cited id WAS IN THE SET SENT TO THE MODEL. It proves
// NOTHING about whether the sentence follows from that evidence (lib/studio/verify.ts:41-50 makes the same
// concession one level down). A founder will read a green tick as an editorial guarantee — so the product
// vocabulary is "CITED", never "verified" or "supported" (i18n/*/agency.json), and the affordance says why.
// The internal outcome name `supported` is the ADR §4.2 table's word for "the id was in the sent set"; it must
// never reach user-facing copy.
//
// ── MATCHING: an exact id intersection against the set sent in THIS call ───────────────────────────────────────
//   supported   = the cited evidenceMemoryId IS IN the set sent in this call
//   unsupported = the claim carries NO evidenceMemoryId
//   fabricated  = the cited id is NOT in the sent set — INCLUDING a cross-tenant id (the sent set is
//                 business-scoped, so a foreign id is simply not a member)
// The sent set is `BoundEvidence.sentIds`, minted by bindEvidenceForPrompt from the SAME fetch that produced the
// prompt text. NEVER A FRESH DB READ: a fresh read is a different transaction and could legitimise a row promoted
// AFTER the prompt was sent — a citation the model provably could not have seen, that nonetheless verifies.
// LOSERS: fuzzy/semantic matching of claim text against evidence text (needs embeddings — out of scope — and its
// false positive is "marked supported by evidence that does not support it", the exact legal failure this exists
// to prevent); model-judged support (a second unverifiable judgment).
//
// NO AGGREGATE THRESHOLD AND NO TUNABLE. Per-claim binary, fixed in the ADR. The bias is toward flagging (a false
// negative publishes an unsupported assertion under the customer's own name; a false positive costs reviewer
// fatigue) and the NARROW claim definition — extraction, in the prompt, asks only for checkable assertions — is
// what keeps the false-positive rate tolerable.

// A brand with a REAL runtime initializer (the Session 31 BLOCKER-1 lesson: an ambient `declare const` throws at
// runtime), non-exported so no other module can mint one. Only a claim whose id was in the sent set can carry it,
// so "cited but not in the sent set" is UNREPRESENTABLE in the type. The brand kills structural forgery, not a
// bare cast — the same honest limit lib/studio/verify.ts records.
const citedBrand: unique symbol = Symbol('verify-claims-cited-evidence')

export type CitedEvidence = {
  // Only ever set from an id that is a member of the SENT SET.
  readonly evidenceMemoryId: string
  readonly [citedBrand]: true
}

// Offsets into the post's own text (UTF-16 code units, [start, end)). Rendering a claim means slicing THE POST,
// so every rendered byte comes from the draft the human already sees — never from the model's `claim.text`
// string (verify.ts:210-212's rule). null = the model's quoted text was not found verbatim in the draft: the
// claim is still flagged, it just cannot be highlighted inline.
export type ClaimSpan = { readonly start: number; readonly end: number }

// No optional source field anywhere: a `supported` check ALWAYS carries its CitedEvidence, and the other two arms
// have no way to carry an id at all, so an unverified id can never ride along to a renderer.
export type ClaimCheck =
  | { readonly outcome: 'supported'; readonly span: ClaimSpan | null; readonly evidence: CitedEvidence }
  | { readonly outcome: 'unsupported'; readonly span: ClaimSpan | null }
  | { readonly outcome: 'fabricated'; readonly span: ClaimSpan | null }

export type ClaimVerification =
  // The draft made no checkable assertion. Nothing to flag, and not the same thing as an unavailable check.
  | { readonly status: 'no_claims' }
  // ADR §4.4 — "no evidence corpus — claims not checked", NEVER "3 unsupported claims". Verifying against an
  // empty store flags everything, which is worse than useless.
  | { readonly status: 'no_corpus' }
  | { readonly status: 'checked'; readonly claims: ReadonlyArray<ClaimCheck> }

// Domain decision fixed in the ADR, NOT a tunable, and NOT a withholding threshold (L-4 forbids withholding
// here): the point above which a high FABRICATION rate among CITING claims is worth an operator's attention —
// the model is not reading the evidence it was given. It only ever emits a Sentry COUNT.
const FABRICATION_ALERT_RATE = 0.5

function locate(content: string, text: string): ClaimSpan | null {
  const start = content.indexOf(text)
  return start === -1 ? null : { start, end: start + text.length }
}

export function verifyClaims(input: {
  claims: ReadonlyArray<Claim> | null | undefined
  // The post's own rendered text — spans index into THIS string.
  content: string
  bound: BoundEvidence
  // True when the business has at least one status='active' evidence row. Supplied by the caller (through
  // lib/memory — MEM-NO-DIRECT-TABLE-ACCESS): this module reads no store.
  hasEvidenceCorpus: boolean
}): ClaimVerification {
  const claims = input.claims ?? []
  if (claims.length === 0) return { status: 'no_claims' }

  // Empty corpus: nothing was sent AND there is nothing in the store to have sent. (If evidence exists but none
  // was pinned, that is NOT this state — every claim really is uncited, and it is truthful to flag it.)
  if (input.bound.sentIds.size === 0 && !input.hasEvidenceCorpus) return { status: 'no_corpus' }

  const checks: ClaimCheck[] = []
  let citing = 0
  let fabricated = 0
  for (const claim of claims) {
    const span = locate(input.content, claim.text)
    const citedId = claim.evidenceMemoryId
    if (citedId === undefined || citedId === null || citedId === '') {
      checks.push({ outcome: 'unsupported', span })
      continue
    }
    citing += 1
    if (input.bound.sentIds.has(citedId)) {
      checks.push({ outcome: 'supported', span, evidence: { evidenceMemoryId: citedId, [citedBrand]: true as const } })
    } else {
      fabricated += 1
      checks.push({ outcome: 'fabricated', span })
    }
  }

  if (citing > 0 && fabricated / citing > FABRICATION_ALERT_RATE) {
    // No console.* (L-13); Sentry only, redacted: a count — no claim text, no draft text, no ids.
    Sentry.captureMessage('campaign_fabricated_citation_rate', {
      level: 'warning',
      tags: { fabricated_citation_count: fabricated, citing_claim_count: citing },
    })
  }

  return { status: 'checked', claims: checks }
}

// The plain-JSON form persisted on the post (ai_generation_metadata.claimCheck) for the approval gate to read.
// Only what the gate needs and nothing model-authored: an outcome, a span into the post's own text, and — for a
// supported claim only — the id taken from the sent set.
export function toPersistedClaimCheck(v: ClaimVerification): PersistedClaimCheck {
  if (v.status !== 'checked') return { status: v.status }
  return {
    status: 'checked',
    claims: v.claims.map((c) =>
      c.outcome === 'supported'
        ? { outcome: c.outcome, span: c.span ? { ...c.span } : null, evidenceMemoryId: c.evidence.evidenceMemoryId }
        : { outcome: c.outcome, span: c.span ? { ...c.span } : null },
    ),
  }
}
