import { describe, it, expect } from 'vitest'
import { createCardCitableContext, verifyBrandClaim, verifyCardCitations } from './verify'

function citableWith(evidenceIds: string[], brandIds: string[]) {
  const citable = createCardCitableContext()
  for (const id of evidenceIds) citable.evidence.set(id, { id, snippet: `snippet for ${id}` })
  for (const id of brandIds) citable.brandClaims.set(id, { id, statement: `statement for ${id}` })
  return citable
}

describe('verifyCardCitations (ADR 0021 §4.6, Session 28 E5.7)', () => {
  it('clean: every cited id was actually returned by the tools', () => {
    const citable = citableWith(['ev-1', 'ev-2'], ['brand-1'])
    const result = verifyCardCitations(['ev-1', 'ev-2'], ['brand-1'], citable)
    expect(result.outcome).toBe('clean')
    if (result.outcome === 'clean') {
      expect(result.verifiedEvidence.map((e) => e.id).sort()).toEqual(['ev-1', 'ev-2'])
    }
  })

  it('partial: a minority fabricated citation is demoted and recorded, never rendered', () => {
    const citable = citableWith(['ev-1', 'ev-2', 'ev-3'], [])
    // 1 of 4 citing claims fabricated (25%) — under the 50% threshold.
    const result = verifyCardCitations(['ev-1', 'ev-2', 'ev-3', 'ev-fabricated'], [], citable)
    expect(result.outcome).toBe('partial')
    if (result.outcome === 'partial') {
      expect(result.fabricatedCount).toBe(1)
      const verifiedIds = result.verifiedEvidence.map((e) => e.id)
      expect(verifiedIds.sort()).toEqual(['ev-1', 'ev-2', 'ev-3'])
      // The fabricated id never appears in the verified set — "a fabricated
      // id never renders."
      expect(verifiedIds).not.toContain('ev-fabricated')
    }
  })

  it('rejected: more than half of citing claims fabricated — nothing renders', () => {
    const citable = citableWith(['ev-1'], [])
    // 2 of 3 citing claims fabricated (67%) — over the 50% threshold.
    const result = verifyCardCitations(['ev-1', 'ev-fake-1', 'ev-fake-2'], [], citable)
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') {
      expect(result.fabricatedCount).toBe(2)
    }
    // The rejected arm carries no verified set at all — not even the one
    // genuinely-verifiable id renders.
    expect('verifiedEvidence' in result).toBe(false)
  })

  it('a fabricated BRAND claim also counts toward the fabrication threshold, even though it is never persisted', () => {
    const citable = citableWith(['ev-1'], ['brand-1'])
    // 1 of 2 citing claims fabricated (50%) — at, not over, the threshold: partial.
    const result = verifyCardCitations(['ev-1'], ['brand-1', 'brand-fabricated'], citable)
    expect(result.outcome).toBe('partial')
  })

  it('claiming zero ids is clean with an empty verified set (no citations to fabricate)', () => {
    const citable = citableWith([], [])
    const result = verifyCardCitations([], [], citable)
    expect(result).toEqual({ outcome: 'clean', verifiedEvidence: [] })
  })

  // ─── verifyBrandClaim — the function ADR §4.6 names explicitly ───────────

  it('verifyBrandClaim returns the row when it was in the citable set', () => {
    const citable = citableWith([], ['brand-1'])
    expect(verifyBrandClaim('brand-1', citable)).toEqual({ id: 'brand-1', statement: 'statement for brand-1' })
  })

  it('verifyBrandClaim returns null for a fabricated (never-returned) id', () => {
    const citable = citableWith([], ['brand-1'])
    expect(verifyBrandClaim('brand-fabricated', citable)).toBeNull()
  })
})
