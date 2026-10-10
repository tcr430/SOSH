import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ANALYTICS-EXCLUSION-REASON-FROM-NORMALISER: the reason a post was excluded is recovered by CALLING the existing
// eligibleValue, never by a copy of its rules. The spy keeps the REAL implementation running, so the behaviour
// below is the normaliser's own, and the call arguments are asserted (cerebrum 2026-10-04, 36-D MAJOR-1).
vi.mock('@/lib/outcomes/normalise', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/outcomes/normalise')>()
  return { ...actual, eligibleValue: vi.fn(actual.eligibleValue) }
})

import { eligibleValue } from '@/lib/outcomes/normalise'
import { exclusionReason, countExclusions } from '../exclusions'
import { monthOf } from '../period'
import { fixtureRecords } from '../__fixtures__/adapters'
import { BUSINESS_A_ID, BUSINESS_B_ID, EXPECTED, FIXTURE_NOW, MARCH_REPORT_OUTCOMES_THROUGH } from '../__fixtures__/portfolio'
import type { AnalyticsPostRecord } from '../types'

const post = (publishedAt: string, platform = 'twitter') => ({ postId: 'p1', platform, publishedAt })
const NOW = '2026-04-20T00:00:00Z' // 19 days after the posts below: always past day 9

describe('exclusionReason (ADR 0031 §2.5)', () => {
  it('a post WITH an outcome row has no exclusion reason', () => {
    expect(exclusionReason(post('2026-04-01T09:00:00Z'), { postId: 'p1' }, { likes: 1, comments: 1, shares: 1, impressions: 100 }, NOW)).toBeNull()
  })

  it('younger than maturity + grace (day 9) and no outcome: "not final yet", whatever its metrics say', () => {
    expect(exclusionReason(post('2026-04-18T09:00:00Z'), null, { likes: 3, comments: 1, shares: 0, impressions: 120 }, NOW)).toBe('not_final')
    expect(exclusionReason(post('2026-04-18T09:00:00Z'), null, null, NOW)).toBe('not_final')
  })

  it('the day-9 edge is exact: 9 days to the millisecond is past it, one millisecond short is not', () => {
    const publishedAt = '2026-04-01T09:00:00.000Z'
    expect(exclusionReason(post(publishedAt), null, null, '2026-04-10T08:59:59.999Z')).toBe('not_final')
    expect(exclusionReason(post(publishedAt), null, null, '2026-04-10T09:00:00.000Z')).toBe('no_data_returned')
  })

  it('past day 9, no post_metrics row: "no data returned"', () => {
    expect(exclusionReason(post('2026-04-01T09:00:00Z'), null, null, NOW)).toBe('no_data_returned')
  })

  it('past day 9, a NULL eligible field: "a field was missing" (a null is never read as 0)', () => {
    expect(exclusionReason(post('2026-04-01T09:00:00Z'), null, { likes: 5, comments: null, shares: 1, impressions: 900 }, NOW)).toBe('field_missing')
  })

  it('past day 9, impressions = 0: "zero impressions"', () => {
    expect(exclusionReason(post('2026-04-01T09:00:00Z'), null, { likes: 0, comments: 0, shares: 0, impressions: 0 }, NOW)).toBe('zero_impressions')
  })

  it('past day 9, eligible metrics yet no outcome row: still "no data returned" (counted, never hidden)', () => {
    expect(exclusionReason(post('2026-04-01T09:00:00Z'), null, { likes: 5, comments: 2, shares: 1, impressions: 900 }, NOW)).toBe('no_data_returned')
  })

  it('a platform the normaliser does not support is counted as "no data returned", never dropped', () => {
    expect(exclusionReason(post('2026-04-01T09:00:00Z', 'instagram'), null, { likes: 1, comments: 1, shares: 1, impressions: 10 }, NOW)).toBe('no_data_returned')
  })

  it('a non-finite timestamp THROWS', () => {
    expect(() => exclusionReason(post('garbage'), null, null, NOW)).toThrow(/timestamp/)
    expect(() => exclusionReason(post('2026-04-01T09:00:00Z'), null, null, 'garbage')).toThrow(/timestamp/)
  })
})

describe('exclusionReason CALLS eligibleValue (constraint 37): the same function that decided not to write the outcome', () => {
  it('passes the post platform and the metrics row it was given, once', () => {
    vi.mocked(eligibleValue).mockClear()
    const metrics = { likes: 5, comments: null, shares: 1, impressions: 900 }
    exclusionReason(post('2026-04-01T09:00:00Z', 'twitter'), null, metrics, NOW)
    expect(eligibleValue).toHaveBeenCalledTimes(1)
    expect(eligibleValue).toHaveBeenCalledWith('twitter', metrics)
  })

  it('is not asked when there is nothing to ask: an outcome row, an immature post, a missing metrics row', () => {
    vi.mocked(eligibleValue).mockClear()
    exclusionReason(post('2026-04-01T09:00:00Z'), { postId: 'p1' }, { likes: 1, comments: 1, shares: 1, impressions: 5 }, NOW)
    exclusionReason(post('2026-04-18T09:00:00Z'), null, { likes: 1, comments: 1, shares: 1, impressions: 5 }, NOW)
    exclusionReason(post('2026-04-01T09:00:00Z'), null, null, NOW)
    expect(eligibleValue).not.toHaveBeenCalled()
  })

  it('exclusions.ts imports it from the normaliser and holds no copy of its rules', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/analytics/exclusions.ts'), 'utf8')
    expect(source).toMatch(/import\s*\{[^}]*\beligibleValue\b[^}]*\}\s*from\s*'@\/lib\/outcomes\/normalise'/)
    expect(source).not.toMatch(/impressions\s*===?\s*0/)
    expect(source).not.toMatch(/Number\.isFinite|isCount/)
  })
})

describe('countExclusions: every published post is measured or counted under one reason', () => {
  const marchX = (): AnalyticsPostRecord[] =>
    fixtureRecords(BUSINESS_A_ID).filter((r) => r.post.platform === 'twitter' && monthOf(r.post.publishedAt, 'Europe/Lisbon') === '2026-03')

  it('March, business A, X: 10 published, 7 measured, 3 not included: 1 no data, 1 field missing, 1 zero impressions, 0 not final', () => {
    const c = countExclusions(marchX(), FIXTURE_NOW)
    expect(c).toEqual({ published: 10, measured: 7, noDataReturned: 1, fieldMissing: 1, zeroImpressions: 1, notFinal: 0 })
    expect(c.published).toBe(EXPECTED.march.x.published)
    expect(c.measured).toBe(EXPECTED.march.x.measured)
    expect({ noDataReturned: c.noDataReturned, fieldMissing: c.fieldMissing, zeroImpressions: c.zeroImpressions, notFinal: c.notFinal }).toEqual(EXPECTED.march.x.exclusions)
  })

  it('the arithmetic closes: measured + every reason = published', () => {
    const c = countExclusions(marchX(), FIXTURE_NOW)
    expect(c.measured + c.noDataReturned + c.fieldMissing + c.zeroImpressions + c.notFinal).toBe(c.published)
  })

  it('a measured 0.0% (a_x01) is MEASURED, not excluded: it differs from a NULL field', () => {
    const a = marchX().find((r) => r.outcome?.value === 0)
    expect(a).toBeDefined()
    expect(exclusionReason(a!.post, a!.outcome, a!.metrics, FIXTURE_NOW)).toBeNull()
    const nullField = marchX().find((r) => r.metrics?.comments === null)
    expect(exclusionReason(nullField!.post, nullField!.outcome, nullField!.metrics, FIXTURE_NOW)).toBe('field_missing')
  })

  it('April, business A: 3 published, 1 measured, 2 not final yet (the day-2 posts)', () => {
    const april = fixtureRecords(BUSINESS_A_ID).filter((r) => monthOf(r.post.publishedAt, 'Europe/Lisbon') === '2026-04')
    const c = countExclusions(april, FIXTURE_NOW)
    expect(c).toMatchObject({ published: EXPECTED.april.x.published, measured: EXPECTED.april.x.measured, notFinal: EXPECTED.april.x.exclusions.notFinal })
  })

  it('draft, failed and soft-deleted posts never reach it: the adapter applies the reader filters, and 10 is the whole March X set', () => {
    expect(marchX()).toHaveLength(10)
  })

  it('at the March report instant (06:00 UTC on day 10 of April) the 28 March post is past day 9; a post of 1 April 09:00 is not', () => {
    const records = fixtureRecords(BUSINESS_A_ID)
    const noMetricsRow = records.find((r) => r.post.publishedAt === '2026-03-28T09:00:00Z')!
    expect(exclusionReason(noMetricsRow.post, noMetricsRow.outcome, noMetricsRow.metrics, MARCH_REPORT_OUTCOMES_THROUGH)).toBe('no_data_returned')
    // 1 April 09:00Z + 9 days = 10 April 09:00Z, three hours AFTER the instant the report is generated against.
    expect(exclusionReason({ postId: 'p', platform: 'twitter', publishedAt: '2026-04-01T09:00:00Z' }, null, null, MARCH_REPORT_OUTCOMES_THROUGH)).toBe('not_final')
  })

  it('business B has its own ledger: 2 X posts, both measured', () => {
    const b = fixtureRecords(BUSINESS_B_ID).filter((r) => r.post.platform === 'twitter' && monthOf(r.post.publishedAt, 'America/Sao_Paulo') === '2026-03')
    expect(countExclusions(b, FIXTURE_NOW)).toMatchObject({ published: EXPECTED.businessB.xPublished, measured: EXPECTED.businessB.xMeasured })
  })

  it('an empty list is all zeros', () => {
    expect(countExclusions([], FIXTURE_NOW)).toEqual({ published: 0, measured: 0, noDataReturned: 0, fieldMissing: 0, zeroImpressions: 0, notFinal: 0 })
  })
})
