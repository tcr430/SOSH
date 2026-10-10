import { describe, it, expect } from 'vitest'
import { typicalOf, rangeOf, formatRate, formatPercent, wilsonInterval, aggregateByPlatform } from '../rates'
import { monthOf } from '../period'
import { fixtureRecords } from '../__fixtures__/adapters'
import { BUSINESS_A_ID, BUSINESS_B_ID, EXPECTED } from '../__fixtures__/portfolio'
import type { AnalyticsOutcome } from '../types'

const outcomesOf = (businessId: string, period: string, timezone: string): AnalyticsOutcome[] =>
  fixtureRecords(businessId)
    .flatMap((r) => (r.outcome ? [r.outcome] : []))
    .filter((o) => monthOf(o.publishedAt, timezone) === period)

describe('typicalOf: the median of per-post rates, with its range (ADR 0031 §2.3)', () => {
  it('March, business A, X: the 7-post median is 0.031 and the range is 0 to 0.064 (min-max below 10)', () => {
    const x = outcomesOf(BUSINESS_A_ID, '2026-03', 'Europe/Lisbon').filter((o) => o.platform === 'twitter')
    expect(x).toHaveLength(7)
    const t = typicalOf(x.map((o) => o.value))
    expect(t).toEqual({ n: 7, median: 0.031, range: { kind: 'minmax', lo: 0, hi: 0.064 } })
    expect(t.median).toBe(EXPECTED.march.x.medianRate)
  })

  it('the Lisbon boundary post (0.020, April local) is NOT in March: filing it by UTC would move the median to 0.028', () => {
    const march = outcomesOf(BUSINESS_A_ID, '2026-03', 'Europe/Lisbon').filter((o) => o.platform === 'twitter')
    expect(march.map((o) => o.value)).not.toContain(0.02)
    const byUtc = fixtureRecords(BUSINESS_A_ID)
      .flatMap((r) => (r.outcome ? [r.outcome] : []))
      .filter((o) => o.platform === 'twitter' && monthOf(o.publishedAt, 'UTC') === '2026-03')
    expect(byUtc).toHaveLength(8)
    expect(typicalOf(byUtc.map((o) => o.value)).median).toBeCloseTo(0.028, 10)
  })

  it('a day-2 (immature) post is absent from the median: April has ONE measured X post', () => {
    const april = outcomesOf(BUSINESS_A_ID, '2026-04', 'Europe/Lisbon').filter((o) => o.platform === 'twitter')
    expect(april).toHaveLength(EXPECTED.april.x.measured)
  })

  it('February, n = 5: median 0.03, range 0.022 to 0.044', () => {
    const feb = outcomesOf(BUSINESS_A_ID, '2026-02', 'Europe/Lisbon')
    expect(typicalOf(feb.map((o) => o.value))).toEqual({ n: 5, median: 0.03, range: { kind: 'minmax', lo: 0.022, hi: 0.044 } })
  })

  it('it is the MEDIAN, not the mean: one extreme rate does not drag it', () => {
    const t = typicalOf([0.01, 0.01, 0.01, 0.01, 0.9])
    expect(t.median).toBe(0.01)
    expect(t.median).not.toBeCloseTo((0.01 * 4 + 0.9) / 5, 3)
  })

  it('an even count takes the midpoint', () => {
    expect(typicalOf([0.02, 0.04, 0.06, 0.08]).median).toBeCloseTo(0.05, 12)
  })

  it('an empty list THROWS (the caller applies the floor first; a median of nothing is not 0)', () => {
    expect(() => typicalOf([])).toThrow(/empty/)
  })

  it('a non-finite value THROWS rather than score as zero', () => {
    expect(() => typicalOf([0.1, Number.NaN])).toThrow(/non-finite/)
    expect(() => typicalOf([0.1, Number.POSITIVE_INFINITY])).toThrow(/non-finite/)
  })
})

describe('rangeOf: min-max below 10, interquartile range from 10 (ADR 0031 §2.3)', () => {
  it('n = 9 is min-max', () => {
    expect(rangeOf([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({ kind: 'minmax', lo: 1, hi: 9 })
  })
  it('n = 10 is the IQR (linear interpolation between order statistics): 1..10 gives 3.25 to 7.75', () => {
    expect(rangeOf([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toEqual({ kind: 'iqr', lo: 3.25, hi: 7.75 })
  })
  it('n = 11 is the IQR: 1..11 gives 3.5 to 8.5', () => {
    expect(rangeOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual({ kind: 'iqr', lo: 3.5, hi: 8.5 })
  })
  it('does not mutate its input', () => {
    const v = [3, 1, 2]
    rangeOf(v)
    expect(v).toEqual([3, 1, 2])
  })
})

describe('formatRate: one decimal, two below 1%, 0 is 0.0%, NULL is no number (ADR 0031 §2.3)', () => {
  it.each([
    [0.031, '3.1%'],
    [0.064, '6.4%'],
    [0.018, '1.8%'],
    [0.01, '1.0%'],
    [0.123, '12.3%'],
    [0.0062, '0.62%'],
    [0.0005, '0.05%'],
  ])('%s -> %s', (value, text) => {
    expect(formatRate(value)).toBe(text)
  })

  it('a measured 0 is a real value: "0.0%"', () => {
    expect(formatRate(0)).toBe('0.0%')
  })

  it('NULL (and undefined) is NO NUMBER: never "0.0%"', () => {
    expect(formatRate(null)).toBeNull()
    expect(formatRate(undefined)).toBeNull()
    expect(formatRate(null)).not.toBe(formatRate(0))
  })

  it('a non-finite or negative rate THROWS', () => {
    expect(() => formatRate(Number.NaN)).toThrow(/rate/)
    expect(() => formatRate(-0.1)).toThrow(/rate/)
  })
})

describe('formatPercent (interval bounds, whole percent)', () => {
  it('rounds to a whole number', () => {
    expect(formatPercent(0.2366)).toBe('24%')
    expect(formatPercent(0.7634)).toBe('76%')
  })
})

describe('wilsonInterval (z = OUTCOME_WILSON_Z)', () => {
  it('5 of 10: 0.2366 to 0.7634', () => {
    const w = wilsonInterval(5, 10)
    expect(w.lo).toBeCloseTo(0.2366, 3)
    expect(w.hi).toBeCloseTo(0.7634, 3)
  })
  it('8 of 10: 0.4902 to 0.9433', () => {
    const w = wilsonInterval(8, 10)
    expect(w.lo).toBeCloseTo(0.4902, 3)
    expect(w.hi).toBeCloseTo(0.9433, 3)
  })
  it('0 of 10 and 10 of 10 stay inside [0, 1]', () => {
    expect(wilsonInterval(0, 10).lo).toBeCloseTo(0, 10)
    expect(wilsonInterval(10, 10).hi).toBeLessThanOrEqual(1)
  })
  it('refuses n = 0 and wins > n', () => {
    expect(() => wilsonInterval(0, 0)).toThrow()
    expect(() => wilsonInterval(3, 2)).toThrow()
  })
})

describe('aggregateByPlatform: no number crosses a metric basis (ANALYTICS-BASIS-NEVER-MIXED)', () => {
  const march = outcomesOf(BUSINESS_A_ID, '2026-03', 'Europe/Lisbon')

  it('an X rate set and a LinkedIn count set give TWO results; neither contains the other', () => {
    const groups = aggregateByPlatform(march)
    expect(groups).toHaveLength(2)
    const x = groups.find((g) => g.platform === 'twitter')!
    const li = groups.find((g) => g.platform === 'linkedin')!
    expect(x).toMatchObject({ basis: 'rate', n: 7, median: 0.031 })
    expect(li).toMatchObject({ basis: 'count', n: 3, median: 14, range: { kind: 'minmax', lo: 6, hi: 21 } })
  })

  it('there is no pooled group: no result has n = 10 (7 + 3) and no median mixes 0.031 with 14', () => {
    const groups = aggregateByPlatform(march)
    expect(groups.map((g) => g.n).sort()).toEqual([3, 7])
    expect(groups.every((g) => g.n !== 10)).toBe(true)
  })

  it('the same platform with two bases is still two results (a count is never a rate)', () => {
    const mk = (basis: 'rate' | 'count', value: number): AnalyticsOutcome => ({ ...march[0], platform: 'twitter', basis, value })
    const groups = aggregateByPlatform([mk('rate', 0.1), mk('rate', 0.2), mk('count', 40)])
    expect(groups.map((g) => `${g.platform}/${g.basis}/${g.n}`).sort()).toEqual(['twitter/count/1', 'twitter/rate/2'])
  })

  it('returns groups in a stable order (platform, then basis) so a report is reproducible', () => {
    const a = aggregateByPlatform(march).map((g) => g.platform)
    const b = aggregateByPlatform([...march].reverse()).map((g) => g.platform)
    expect(a).toEqual(b)
  })

  it('business B, March (Sao Paulo): 2 measured X posts and 1 LinkedIn post, each on its own', () => {
    const groups = aggregateByPlatform(outcomesOf(BUSINESS_B_ID, '2026-03', 'America/Sao_Paulo'))
    expect(groups.find((g) => g.platform === 'twitter')?.n).toBe(EXPECTED.businessB.xMeasured)
    expect(groups.find((g) => g.platform === 'linkedin')?.n).toBe(1)
  })
})
