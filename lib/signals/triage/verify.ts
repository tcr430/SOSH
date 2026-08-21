// ADR 0021 §4.6 (Session 28 E5.7) — the render-time citation guard, a
// Stage-C-local ANALOGUE of lib/studio/verify.ts's verify-then-cite
// pattern, NOT an extension of it: `lib/studio/verify.ts`'s
// `ClaimedMemorySource` union has exactly three kinds (avoid_word,
// performance_pattern, evidence) and no `brand_claim` kind, and extending
// Studio's module for a Mode 3 need would widen the blast radius across an
// already-reviewed surface for no reuse benefit — a deliberate duplication
// of SHAPE, not of code ([sec-MEDIUM-2], recorded in the ADR).
//
// Verification runs against the EXACT set Stage C's tools returned THIS
// call (a CardCitableContext, populated as a side effect by
// lib/signals/triage/tools.ts when given one) — never a fresh DB read,
// which is a different transaction and could legitimise a row promoted (or
// demoted) after the prompt was sent.

export interface CardCitableEvidence {
  readonly id: string
  readonly snippet: string
}

export interface CardCitableBrandClaim {
  readonly id: string
  readonly statement: string
}

export interface CardCitableContext {
  readonly evidence: Map<string, CardCitableEvidence>
  readonly brandClaims: Map<string, CardCitableBrandClaim>
}

export function createCardCitableContext(): CardCitableContext {
  return { evidence: new Map(), brandClaims: new Map() }
}

// Domain decision fixed in the ADR, NOT a runtime tunable (§4.6/§8.3,
// mirroring lib/studio/verify.ts's own FABRICATION_REJECT_THRESHOLD): more
// than half of the claims CARRYING A CITATION failing verification means
// the model is not reading the tool results it was given, and every other
// claim in that response is then equally suspect.
const FABRICATION_REJECT_THRESHOLD = 0.5

export interface VerifiedEvidenceCitation {
  readonly id: string
  readonly snippet: string
}

// rowId ∈ the SENT evidence set (populated into the CardCitableContext by
// list_evidence's own execute(), never re-derived here).
export function verifyEvidenceCitation(id: string, citable: CardCitableContext): VerifiedEvidenceCitation | null {
  const row = citable.evidence.get(id)
  if (row === undefined) return null
  return { id: row.id, snippet: row.snippet }
}

// ADR 0021 §4.6 [sec-MEDIUM-2] — the function the ADR names explicitly.
// rowId ∈ the SENT brand-claim set (populated by list_brand_claims's own
// execute()).
export function verifyBrandClaim(id: string, citable: CardCitableContext): CardCitableBrandClaim | null {
  const row = citable.brandClaims.get(id)
  if (row === undefined) return null
  return row
}

export type CardCitationVerification =
  | { outcome: 'clean'; verifiedEvidence: readonly VerifiedEvidenceCitation[] }
  | { outcome: 'partial'; verifiedEvidence: readonly VerifiedEvidenceCitation[]; fabricatedCount: number }
  // the rejected arm carries no verified set — "ignore the fabrication and
  // render anyway" is unreachable rather than merely discouraged (§4.6,
  // §8.3's D-2 doctrine: a degraded card is worse than no card).
  | { outcome: 'rejected'; fabricatedCount: number }

// ADR 0021 §2.8.1 [sec-E5.7-HIGH-3]'s resolution, recorded here since it was
// left open at E5.4: citableBrandIds are verified for their EFFECT on the
// overall clean/partial/rejected signal (a fabricated brand-conflict claim
// is exactly as suspect as a fabricated evidence claim), but — unlike
// evidence — a brand claim id is NEVER itself persisted onto the card.
// insight_cards has no brand-claims column (§4.1), and §4.6's
// clean/partial/rejected framing (reused from ADR 0019 §8.3, which
// describes a RENDERED, distinguishable citation) does not apply to brand
// claims the way it does to evidence: brand claims exist only to gate
// generation — did the model contradict something this business already
// said — never to be cited on the card itself.
export function verifyCardCitations(
  citableEvidenceIds: readonly string[],
  citableBrandIds: readonly string[],
  citable: CardCitableContext,
): CardCitationVerification {
  const verifiedEvidence: VerifiedEvidenceCitation[] = []
  let fabricatedCount = 0
  let claimingCount = 0

  for (const id of citableEvidenceIds) {
    claimingCount += 1
    const verified = verifyEvidenceCitation(id, citable)
    if (verified !== null) verifiedEvidence.push(verified)
    else fabricatedCount += 1
  }

  for (const id of citableBrandIds) {
    claimingCount += 1
    if (verifyBrandClaim(id, citable) === null) fabricatedCount += 1
  }

  if (claimingCount > 0 && fabricatedCount / claimingCount > FABRICATION_REJECT_THRESHOLD) {
    return { outcome: 'rejected', fabricatedCount }
  }
  if (fabricatedCount > 0) {
    return { outcome: 'partial', verifiedEvidence, fabricatedCount }
  }
  return { outcome: 'clean', verifiedEvidence }
}
