import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { checkSetRedundancy, lexicalOverlap, REDUNDANCY_OVERLAP_THRESHOLD, type RedundancyCandidate } from './consistency'

// ADR 0027 §5.8 half (b) (Session 34 K2.8) — AGENCY-SET-REDUNDANCY-CHECKED (35), Tier 2.
//
// SHARED-FUNCTION CALLERS: checkSetRedundancy has ONE production caller, lib/campaigns/generate.ts (the scan at
// the bottom pins HOW it is called: advisory, never in a failure path). consistency.ts's other two checks
// (checkRoleCoverage, checkLinkPlacement) are unchanged and covered by consistency.test.ts.
//
// Each of the four conditions has its OWN test that varies ONLY that condition — so relaxing any one of them
// (the redden the guide names) turns exactly one test red.

const SAME_TEXT = 'Integrations save engineering teams several hours every single week'
const base = (over: Partial<RedundancyCandidate> = {}): RedundancyCandidate => ({
  order: 0,
  role: 'customer_proof',
  proofType: 'quote',
  citedEvidenceIds: ['ev-1', 'ev-2'],
  text: SAME_TEXT,
  ...over,
})

describe('lexicalOverlap — Jaccard over content words (>= 4 letters)', () => {
  it('is 1 for identical text, 0 for disjoint text, and ignores case, punctuation and short words', () => {
    expect(lexicalOverlap(SAME_TEXT, SAME_TEXT)).toBe(1)
    expect(lexicalOverlap('alpha bravo charlie', 'delta foxtrot golf')).toBe(0)
    expect(lexicalOverlap('Alpha, BRAVO! and the charlie', 'alpha bravo charlie')).toBe(1)
  })

  it('is 0 when either side has no content words (never a divide-by-zero, never a flag)', () => {
    expect(lexicalOverlap('a an the', 'alpha bravo')).toBe(0)
    expect(lexicalOverlap('', '')).toBe(0)
  })

  it('folds NFKC compatibility characters (a fullwidth paraphrase is not a different word)', () => {
    expect(lexicalOverlap('ＡＬＰＨＡ bravo', 'alpha bravo')).toBe(1)
  })
})

describe('checkSetRedundancy — flagged only when ALL four conditions hold', () => {
  it('FLAGS two posts with the same evidence ids, role, proofType and near-identical text', () => {
    const r = checkSetRedundancy([base({ order: 0 }), base({ order: 3 })])
    expect(r.ok).toBe(false)
    expect(r.flags).toEqual([{ orders: [0, 3], overlap: 1 }])
  })

  it('is NOT flagged when ONLY the evidence ids differ', () => {
    expect(checkSetRedundancy([base({ order: 0 }), base({ order: 1, citedEvidenceIds: ['ev-1', 'ev-9'] })]).ok).toBe(true)
    // a subset is a different set too
    expect(checkSetRedundancy([base({ order: 0 }), base({ order: 1, citedEvidenceIds: ['ev-1'] })]).ok).toBe(true)
  })

  it('is NOT flagged when ONLY the role differs', () => {
    expect(checkSetRedundancy([base({ order: 0 }), base({ order: 1, role: 'follow_up' })]).ok).toBe(true)
  })

  it('is NOT flagged when ONLY the proofType differs (including null vs a value)', () => {
    expect(checkSetRedundancy([base({ order: 0 }), base({ order: 1, proofType: 'case_study' })]).ok).toBe(true)
    expect(checkSetRedundancy([base({ order: 0 }), base({ order: 1, proofType: null })]).ok).toBe(true)
  })

  it('is NOT flagged when ONLY the text differs enough (overlap below the threshold)', () => {
    const r = checkSetRedundancy([base({ order: 0 }), base({ order: 1, text: 'Pricing changes arrive next quarter across enterprise plans' })])
    expect(r.ok).toBe(true)
    expect(r.flags).toEqual([])
  })

  it('treats the evidence ids as a SET: order and duplicates do not matter', () => {
    const r = checkSetRedundancy([base({ order: 0, citedEvidenceIds: ['ev-1', 'ev-2'] }), base({ order: 1, citedEvidenceIds: ['ev-2', 'ev-1', 'ev-2'] })])
    expect(r.ok).toBe(false)
  })

  it('two nulls are the same proofType, and two empty evidence sets are the same set', () => {
    const r = checkSetRedundancy([base({ order: 0, proofType: null, citedEvidenceIds: [] }), base({ order: 1, proofType: null, citedEvidenceIds: [] })])
    expect(r.ok).toBe(false)
  })

  describe('the overlap threshold is INCLUSIVE and exact', () => {
    // shared = 3 of a union of 5 -> exactly 0.6
    const AT = ['alpha bravo charlie delta', 'alpha bravo charlie epsilon']
    // shared = 2 of a union of 6 -> 0.333
    const BELOW = ['alpha bravo delta foxtrot', 'alpha bravo epsilon golfer']

    it('the fixtures hit the threshold exactly and fall clearly below it', () => {
      expect(REDUNDANCY_OVERLAP_THRESHOLD).toBe(0.6)
      expect(lexicalOverlap(AT[0], AT[1])).toBeCloseTo(0.6, 10)
      expect(lexicalOverlap(BELOW[0], BELOW[1])).toBeLessThan(0.6)
    })
    it('flags AT the threshold', () => {
      expect(checkSetRedundancy([base({ order: 0, text: AT[0] }), base({ order: 1, text: AT[1] })]).ok).toBe(false)
    })
    it('does not flag below it', () => {
      expect(checkSetRedundancy([base({ order: 0, text: BELOW[0] }), base({ order: 1, text: BELOW[1] })]).ok).toBe(true)
    })
  })

  it('checks every PAIR: three redundant posts yield three flags; a distinct third post adds none', () => {
    const three = checkSetRedundancy([base({ order: 0 }), base({ order: 1 }), base({ order: 2 })])
    expect(three.flags.map((f) => f.orders)).toEqual([[0, 1], [0, 2], [1, 2]])
    const withDistinct = checkSetRedundancy([base({ order: 0 }), base({ order: 1 }), base({ order: 2, role: 'follow_up' })])
    expect(withDistinct.flags.map((f) => f.orders)).toEqual([[0, 1]])
  })

  it('an empty or single-post set is trivially ok', () => {
    expect(checkSetRedundancy([]).ok).toBe(true)
    expect(checkSetRedundancy([base()]).ok).toBe(true)
  })

  it('NEVER mutates a post: frozen inputs are accepted and returned data is fresh', () => {
    const posts = [base({ order: 0, citedEvidenceIds: Object.freeze(['ev-1']) as unknown as string[] }), base({ order: 1, citedEvidenceIds: Object.freeze(['ev-1']) as unknown as string[] })].map((p) => Object.freeze(p))
    Object.freeze(posts)
    const snapshot = JSON.stringify(posts)
    const r = checkSetRedundancy(posts)
    expect(JSON.stringify(posts)).toBe(snapshot)
    expect(r.flags).toHaveLength(1)
  })
})

describe('generate.ts calls the check as ADVISORY: flagged, never blocked, never edited (source scan)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'campaigns', 'generate.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('checkSetRedundancy is imported and called exactly once', () => {
    expect(code).toMatch(/import\s*\{[^}]*\bcheckSetRedundancy\b[^}]*\}\s*from\s*'@\/lib\/campaigns\/consistency'/)
    expect([...code.matchAll(/\bcheckSetRedundancy\s*\(/g)]).toHaveLength(1)
  })

  it('its result is only ever LOGGED — it never feeds a return, a session-status write, or the consistency failure gate', () => {
    const uses = [...code.matchAll(/\bredundancy\b\.?\w*/g)].map((m) => m[0])
    // declaration, the `!redundancy.ok` test, and the `redundancy.flags` log field — nothing else.
    expect(uses.filter((u) => u !== 'redundancy' && u !== 'redundancy.ok' && u !== 'redundancy.flags')).toEqual([])
    expect(code).toMatch(/if \(!redundancy\.ok\) \{\s*console\.log\(/)
    // and it is NOT a term of the existing failure gate
    expect(code).toMatch(/if \(!roleCoverage\.ok \|\| !linkPlacement\.ok\) \{/)
    expect(code).not.toMatch(/roleCoverage\.ok \|\| !linkPlacement\.ok \|\| !redundancy/)
  })

  it('records the redundancy flag under its own structured log kind', () => {
    expect(code).toContain("kind: 'campaign.generate.redundancy_flagged'")
  })
})
