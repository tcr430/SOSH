import { describe, it, expect } from 'vitest'
import { recencyDecay, scopeMatch, scoreRecord, isEligible, rankAndCap } from './scoring'
import type { MemoryQueryContext } from './scoring'

type TestRecord = {
  id: string
  confidence: number
  recency_at: string
  scope: 'brand' | 'campaign' | 'platform' | 'contact'
  scope_ref: string | null
  status: 'candidate' | 'active' | 'retired'
  expires_at: string | null
}

const NOW = new Date('2026-07-19T00:00:00Z')

function makeRecord(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 'r-1',
    confidence: 0.5,
    recency_at: '2026-07-19T00:00:00Z',
    scope: 'brand',
    scope_ref: null,
    status: 'active',
    expires_at: null,
    ...overrides,
  }
}

describe('recencyDecay', () => {
  it('is 1.0 at zero age', () => {
    expect(recencyDecay('2026-07-19T00:00:00Z', NOW)).toBeCloseTo(1.0, 5)
  })

  it('is 0.5 at exactly the 30-day half-life', () => {
    expect(recencyDecay('2026-06-19T00:00:00Z', NOW)).toBeCloseTo(0.5, 2)
  })

  it('approaches but never reaches 0 for old records', () => {
    const veryOld = recencyDecay('2020-01-01T00:00:00Z', NOW)
    expect(veryOld).toBeGreaterThan(0)
    expect(veryOld).toBeLessThan(0.01)
  })

  it('clamps a future recency_at (negative age) to the zero-age score rather than exceeding 1.0', () => {
    const future = recencyDecay('2026-08-19T00:00:00Z', NOW)
    expect(future).toBeCloseTo(1.0, 5)
  })

  it('throws on an unparseable recency_at rather than silently scoring 0', () => {
    expect(() => recencyDecay('not-a-date', NOW)).toThrow(/invalid recency_at/)
  })
})

describe('scopeMatch', () => {
  const ctx: MemoryQueryContext = { platform: 'linkedin', objective: 'awareness', audience: 'CTOs' }

  it('brand scope always matches fully, regardless of queryContext', () => {
    expect(scopeMatch({ scope: 'brand', scope_ref: null }, {})).toBe(1)
    expect(scopeMatch({ scope: 'brand', scope_ref: null }, ctx)).toBe(1)
  })

  it('contact scope always matches partially (no comparable queryContext field in Track A)', () => {
    expect(scopeMatch({ scope: 'contact', scope_ref: null }, ctx)).toBe(0.5)
  })

  it('platform scope matches fully when scope_ref equals queryContext.platform', () => {
    expect(scopeMatch({ scope: 'platform', scope_ref: 'linkedin' }, ctx)).toBe(1)
  })

  it('platform scope scores zero (not a silent default match) when scope_ref does not match', () => {
    expect(scopeMatch({ scope: 'platform', scope_ref: 'twitter' }, ctx)).toBe(0)
  })

  it('platform scope with no scope_ref is a partial match, not a full or zero match', () => {
    expect(scopeMatch({ scope: 'platform', scope_ref: null }, ctx)).toBe(0.5)
  })

  it('campaign scope matches fully when scope_ref equals queryContext.objective', () => {
    expect(scopeMatch({ scope: 'campaign', scope_ref: 'awareness' }, ctx)).toBe(1)
  })

  it('campaign scope scores zero when scope_ref does not match the objective', () => {
    expect(scopeMatch({ scope: 'campaign', scope_ref: 'lead-gen' }, ctx)).toBe(0)
  })
})

describe('scoreRecord', () => {
  it('combines confidence, recency, and scope using MEMORY_SCORE_WEIGHTS (0.5/0.3/0.2)', () => {
    const record = makeRecord({ confidence: 0.8, recency_at: '2026-07-19T00:00:00Z', scope: 'brand' })
    // conf: 0.5*0.8 = 0.40, rec: 0.3*1.0 = 0.30, scope: 0.2*1 = 0.20 → 0.90
    expect(scoreRecord(record, {}, NOW)).toBeCloseTo(0.9, 5)
  })

  it('a higher-confidence record scores higher than a lower-confidence one at equal recency/scope', () => {
    const low = scoreRecord(makeRecord({ confidence: 0.2 }), {}, NOW)
    const high = scoreRecord(makeRecord({ confidence: 0.9 }), {}, NOW)
    expect(high).toBeGreaterThan(low)
  })
})

describe('isEligible', () => {
  it('excludes candidate-status rows', () => {
    expect(isEligible({ status: 'candidate', expires_at: null }, NOW)).toBe(false)
  })

  it('excludes retired-status rows', () => {
    expect(isEligible({ status: 'retired', expires_at: null }, NOW)).toBe(false)
  })

  it('excludes rows whose expires_at has passed', () => {
    expect(isEligible({ status: 'active', expires_at: '2026-07-01T00:00:00Z' }, NOW)).toBe(false)
  })

  it('excludes a row expiring at exactly `now` (boundary is exclusive, not silently included)', () => {
    expect(isEligible({ status: 'active', expires_at: NOW.toISOString() }, NOW)).toBe(false)
  })

  it('includes an active row with a future expiry', () => {
    expect(isEligible({ status: 'active', expires_at: '2027-01-01T00:00:00Z' }, NOW)).toBe(true)
  })

  it('includes an active row with no expiry at all', () => {
    expect(isEligible({ status: 'active', expires_at: null }, NOW)).toBe(true)
  })
})

describe('rankAndCap — cap validation', () => {
  it('throws on a NaN cap rather than silently returning an empty array', () => {
    expect(() => rankAndCap([makeRecord()], {}, NaN, NOW)).toThrow(/non-negative integer/)
  })

  it('throws on a negative cap rather than silently dropping the wrong end of the ranking', () => {
    expect(() => rankAndCap([makeRecord()], {}, -1, NOW)).toThrow(/non-negative integer/)
  })

  it('throws on a non-integer cap', () => {
    expect(() => rankAndCap([makeRecord()], {}, 2.5, NOW)).toThrow(/non-negative integer/)
  })

  it('a cap of exactly 0 is valid and legitimately returns an empty array (not an error)', () => {
    expect(rankAndCap([makeRecord()], {}, 0, NOW)).toEqual([])
  })
})

describe('rankAndCap', () => {
  it('excludes candidate/retired/expired rows before scoring', () => {
    const candidates: TestRecord[] = [
      makeRecord({ id: 'active', status: 'active' }),
      makeRecord({ id: 'candidate', status: 'candidate' }),
      makeRecord({ id: 'retired', status: 'retired' }),
      makeRecord({ id: 'expired', status: 'active', expires_at: '2026-01-01T00:00:00Z' }),
    ]
    const result = rankAndCap(candidates, {}, 10, NOW)
    expect(result.map(r => r.id)).toEqual(['active'])
  })

  it('TRUNCATES to exactly the cap when fed more candidates than the cap, keeping the highest-scored', () => {
    // Feed 8 candidates with strictly distinct confidence (and thus distinct
    // score, since recency/scope are held equal) into a cap of 5. The result
    // must be exactly 5 long, and must be the 5 HIGHEST-confidence ones —
    // not the first 5, not a random 5, not silently fewer than 5.
    const CAP = 5
    const candidates: TestRecord[] = Array.from({ length: 8 }, (_, i) =>
      makeRecord({ id: `c-${i}`, confidence: (i + 1) / 10 }), // 0.1..0.8
    )
    const result = rankAndCap(candidates, {}, CAP, NOW)

    expect(result).toHaveLength(5)
    expect(result.map(r => r.id)).toEqual(['c-7', 'c-6', 'c-5', 'c-4', 'c-3']) // confidences 0.8..0.4
  })

  it('does not silently return fewer than the cap when enough eligible candidates exist', () => {
    const CAP = 5
    const candidates: TestRecord[] = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ id: `c-${i}`, confidence: (i + 1) / 10 }),
    )
    const result = rankAndCap(candidates, {}, CAP, NOW)
    expect(result).toHaveLength(5)
  })

  it('returns fewer than the cap (never pads) when fewer eligible candidates exist', () => {
    const candidates: TestRecord[] = [makeRecord({ id: 'only-one' })]
    const result = rankAndCap(candidates, {}, 5, NOW)
    expect(result).toHaveLength(1)
  })

  it('breaks a score tie by preferring higher confidence, never silently dropping it', () => {
    // Two records with equal recency and scope but different confidence
    // will normally already differ in score — construct an ARTIFICIAL tie
    // by giving the lower-confidence record a compensating scope match, so
    // the total scores land exactly equal, and prove the tie-break still
    // promotes the higher-confidence record.
    const lowConfHighScope = makeRecord({
      id: 'low-conf-high-scope',
      confidence: 0.4, // 0.5*0.4 = 0.20
      scope: 'platform',
      scope_ref: 'linkedin', // scopeMatch = 1 → 0.2*1 = 0.20
    }) // total (with rec=1.0 → 0.30): 0.20 + 0.30 + 0.20 = 0.70
    const highConfLowScope = makeRecord({
      id: 'high-conf-low-scope',
      confidence: 0.8, // 0.5*0.8 = 0.40
      scope: 'platform',
      scope_ref: 'twitter', // scopeMatch = 0 (mismatch) → 0.2*0 = 0
    }) // total: 0.40 + 0.30 + 0 = 0.70 — same total score as above

    const ctx: MemoryQueryContext = { platform: 'linkedin' }
    // Sanity: the two really do tie on score before the tie-break kicks in.
    expect(scoreRecord(lowConfHighScope, ctx, NOW)).toBeCloseTo(scoreRecord(highConfLowScope, ctx, NOW), 10)

    const result = rankAndCap([lowConfHighScope, highConfLowScope], ctx, 1, NOW)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('high-conf-low-scope')
  })
})
