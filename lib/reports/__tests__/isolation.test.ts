import { describe, it, expect, vi } from 'vitest'
import { TenantMismatchError, assertOwned, verifiedReaders } from '../isolation'
import { fixtureReaders } from '../__fixtures__/readers'
import { BUSINESS_A_ID, BUSINESS_B_ID } from '@/lib/analytics/__fixtures__/portfolio'
import type { Readers } from '@/lib/analytics/load'

// ADR 0031 §9.3 (REPORT-RLS-ISOLATED): the worker bypasses RLS, so every row is checked against the loop's business, and
// ONE mismatch throws.
const RANGE = { start: '2026-03-01T00:00:00Z', end: '2026-03-31T23:00:00Z' }
const OUT = { platform: 'twitter', ...RANGE, outcomesThrough: '2026-04-10T06:00:00Z' }
// An ACTIVE outcome pattern of business A, as listPatterns returns it (the row identity is what the wrapper verifies).
const PATTERN_A = { business_id: BUSINESS_A_ID, pattern_key: 'outcome:format:question:above:twitter', platform: 'twitter' as const, pattern: 'Posts with a question opening beat your usual.', wins: 7, n: 10, campaigns: 3 }

describe('assertOwned', () => {
  it('passes rows of the loop business, and an empty list', () => {
    expect(() => assertOwned('a', [{ business_id: 'a' }, { business_id: 'a' }], 'x')).not.toThrow()
    expect(() => assertOwned('a', [], 'x')).not.toThrow()
  })
  it('THROWS on one foreign row among many, naming both businesses', () => {
    const err = (() => { try { assertOwned('a', [{ business_id: 'a' }, { business_id: 'b' }], 'listPublishedPostsInRange') } catch (e) { return e } })()
    expect(err).toBeInstanceOf(TenantMismatchError)
    expect((err as TenantMismatchError).businessId).toBe('a')
    expect((err as TenantMismatchError).foundBusinessId).toBe('b')
    expect((err as Error).message).toMatch(/listPublishedPostsInRange/)
  })
  it('a row WITHOUT a business_id is a mismatch too: every selected shape includes it', () => {
    expect(() => assertOwned('a', [{}], 'x')).toThrow(TenantMismatchError)
    expect(() => assertOwned('a', [{ business_id: null }], 'x')).toThrow(TenantMismatchError)
  })
})

describe('verifiedReaders over the fixture', () => {
  const readers = verifiedReaders(fixtureReaders({ patterns: [PATTERN_A] }), BUSINESS_A_ID)

  it('passes every real read for the loop business', async () => {
    expect((await readers.listPublishedPostsInRange(BUSINESS_A_ID, RANGE)).length).toBe(13)
    expect((await readers.listMonthOutcomes(BUSINESS_A_ID, OUT)).length).toBe(7)
    expect((await readers.getBusinessById(BUSINESS_A_ID)).id).toBe(BUSINESS_A_ID)
    expect(await readers.countPublishedPostsInRange(BUSINESS_A_ID, RANGE)).toBe(13)
    expect(await readers.listPatterns(BUSINESS_A_ID, {})).toEqual([PATTERN_A])
  })

  it('a reader CALLED with another business throws before it reads', async () => {
    const base = fixtureReaders()
    const spy = vi.spyOn(base, 'listPublishedPostsInRange')
    await expect(verifiedReaders(base, BUSINESS_A_ID).listPublishedPostsInRange(BUSINESS_B_ID, RANGE)).rejects.toBeInstanceOf(TenantMismatchError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('listPatterns CALLED with another business throws before it reads (MAJOR-4)', async () => {
    const base = fixtureReaders({ patterns: [PATTERN_A] })
    const spy = vi.spyOn(base, 'listPatterns')
    await expect(verifiedReaders(base, BUSINESS_A_ID).listPatterns(BUSINESS_B_ID, {})).rejects.toBeInstanceOf(TenantMismatchError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('EVERY reader throws on a planted foreign row (never skips it)', async () => {
    const plant = <R extends { business_id?: string }>(rows: R[]) => [...rows, { ...rows[0], business_id: BUSINESS_B_ID }]
    const real = fixtureReaders()
    const [posts, outcomes, labels, metrics, dims, campaigns] = await Promise.all([
      real.listPublishedPostsInRange(BUSINESS_A_ID, RANGE),
      real.listMonthOutcomes(BUSINESS_A_ID, OUT),
      real.listAccountLabels(BUSINESS_A_ID, [(await real.listPublishedPostsInRange(BUSINESS_A_ID, RANGE))[0].social_account_id as string]),
      real.listMetricsForPosts(BUSINESS_A_ID, (await real.listPublishedPostsInRange(BUSINESS_A_ID, RANGE)).map((p) => p.id)),
      real.listDimensionsForAnalytics(BUSINESS_A_ID, (await real.listMonthOutcomes(BUSINESS_A_ID, OUT)).flatMap((o) => (o.ai_original_id ? [o.ai_original_id] : []))),
      real.listCampaigns(BUSINESS_A_ID),
    ])
    const tainted: Readers = {
      ...real,
      listPublishedPostsInRange: async () => plant(posts),
      listMonthOutcomes: async () => plant(outcomes),
      listTrendOutcomes: async () => plant(outcomes),
      listAccountLabels: async () => plant(labels),
      listMetricsForPosts: async () => plant(metrics),
      listDimensionsForAnalytics: async () => plant(dims),
      listCampaigns: async () => plant(campaigns),
      listPatterns: async () => [PATTERN_A, { ...PATTERN_A, business_id: BUSINESS_B_ID }],
      listCompletedRetrospectivesInRange: async () => [{ business_id: BUSINESS_B_ID } as never],
      getBusinessById: async () => ({ id: BUSINESS_B_ID } as never),
    }
    const v = verifiedReaders(tainted, BUSINESS_A_ID)
    for (const [name, call] of Object.entries({
      posts: () => v.listPublishedPostsInRange(BUSINESS_A_ID, RANGE),
      outcomes: () => v.listMonthOutcomes(BUSINESS_A_ID, OUT),
      trend: () => v.listTrendOutcomes(BUSINESS_A_ID, OUT),
      labels: () => v.listAccountLabels(BUSINESS_A_ID, ['x']),
      metrics: () => v.listMetricsForPosts(BUSINESS_A_ID, ['x']),
      dims: () => v.listDimensionsForAnalytics(BUSINESS_A_ID, ['x']),
      campaigns: () => v.listCampaigns(BUSINESS_A_ID),
      retros: () => v.listCompletedRetrospectivesInRange(BUSINESS_A_ID, RANGE),
      business: () => v.getBusinessById(BUSINESS_A_ID),
      patterns: () => v.listPatterns(BUSINESS_A_ID, {}),
    })) {
      await expect(call(), name).rejects.toBeInstanceOf(TenantMismatchError)
    }
  })
})
