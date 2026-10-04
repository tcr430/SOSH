import { describe, it, expect } from 'vitest'
import * as breakdownsModule from '../breakdowns'
import { winShareBreakdown } from '../breakdowns'
import { REPORT_BREAKDOWN_DIMENSIONS, LIVE_ONLY_BREAKDOWN_DIMENSIONS } from '../constants'
import { monthOf } from '../period'
import { fixtureRecords } from '../__fixtures__/adapters'
import { BUSINESS_A_ID, EXPECTED } from '../__fixtures__/portfolio'
import type { AnalyticsOutcome } from '../types'

const marchX = (): AnalyticsOutcome[] =>
  fixtureRecords(BUSINESS_A_ID)
    .flatMap((r) => (r.outcome ? [r.outcome] : []))
    .filter((o) => o.platform === 'twitter' && monthOf(o.publishedAt, 'Europe/Lisbon') === '2026-03')

const valuesOf = (b: ReturnType<typeof winShareBreakdown>) => Object.fromEntries(b.values.map((v) => [v.value, { wins: v.wins, of: v.of }]))

describe('winShareBreakdown: the metric per dimension value is WIN SHARE (ADR 0031 §2.6)', () => {
  it('role, AI-written posts only: founder_perspective 0 of 1, anchor_thesis 2 of 2, customer_proof 2 of 2; covers 5 of 7', () => {
    const b = winShareBreakdown('role', marchX())
    expect(b.population).toBe('ai_only')
    expect(b.coverage).toEqual({ k: 5, n: 7 })
    expect(b.coverage).toEqual({ k: EXPECTED.march.breakdowns.coverage.covers, n: EXPECTED.march.breakdowns.coverage.ofMeasured })
    expect(valuesOf(b)).toEqual(EXPECTED.march.breakdowns.role)
  })

  it('format, AI-written posts only: single 3 of 4, thread 1 of 1', () => {
    const b = winShareBreakdown('format', marchX())
    expect(b.population).toBe('ai_only')
    expect(valuesOf(b)).toEqual({ single: { wins: 3, of: 4 }, thread: { wins: 1, of: 1 } })
  })

  it('origin_mode is a property of the CAMPAIGN: manual 0 of 1, objective_generated 3 of 3, signal_generated 1 of 1', () => {
    const b = winShareBreakdown('origin_mode', marchX())
    expect(b.population).toBe('ai_only')
    expect(valuesOf(b)).toEqual({ manual: { wins: 0, of: 1 }, objective_generated: { wins: 3, of: 3 }, signal_generated: { wins: 1, of: 1 } })
  })

  it('length_band covers ALL measured posts: short 0 of 2, medium 3 of 3, long 1 of 1 (the NULL-baseline post drops out of "of")', () => {
    const b = winShareBreakdown('length_band', marchX())
    expect(b.population).toBe('all_measured')
    expect(b.coverage).toEqual({ k: 7, n: 7 })
    expect(valuesOf(b)).toEqual(EXPECTED.march.breakdowns.lengthBand)
  })

  it('cta_present covers ALL measured posts: true 3 of 3, false 1 of 3', () => {
    const b = winShareBreakdown('cta_present', marchX())
    expect(b.population).toBe('all_measured')
    expect(valuesOf(b)).toEqual(EXPECTED.march.breakdowns.ctaPresent)
  })

  it('every n here is below 10, so each is counts only and provisional: no interval, no bar', () => {
    for (const dimension of ['role', 'format', 'origin_mode', 'length_band', 'cta_present'] as const) {
      const b = winShareBreakdown(dimension, marchX())
      expect(b.presentation, dimension).toBe('counts')
      expect(b.values.every((v) => v.provisional && v.interval === null), dimension).toBe(true)
    }
  })

  it('a NULL length_band or cta_present is unclassified: it is in coverage n, in no bucket, and never "false"', () => {
    const rows = marchX().map((o, i) => (i === 0 ? { ...o, lengthBand: null, ctaPresent: null } : o))
    const length = winShareBreakdown('length_band', rows)
    expect(length.coverage).toEqual({ k: 6, n: 7 })
    expect(valuesOf(length).short).toEqual({ wins: 0, of: 1 })
    const cta = winShareBreakdown('cta_present', rows)
    expect(cta.coverage).toEqual({ k: 6, n: 7 })
    expect(valuesOf(cta).false).toEqual({ wins: 1, of: 2 })
  })

  it('a value whose every post has no baseline (of = 0) is not shown as "0 of 0"', () => {
    const rows = marchX().filter((o) => o.beatBaseline === null)
    expect(rows).toHaveLength(1)
    expect(winShareBreakdown('length_band', rows).values).toEqual([])
  })
})

describe('hook_type: only where the opening survived, only n >= 10 per value, live page only (ADR 0031 §2.6, [mle-6])', () => {
  it('March: three AI posts kept their opening, each value has n = 1, so NOTHING is shown; coverage says 3 of 7', () => {
    const b = winShareBreakdown('hook_type', marchX())
    expect(b.population).toBe('ai_only')
    expect(b.values).toEqual([])
    expect(b.coverage).toEqual({ k: EXPECTED.march.breakdowns.hookTypeSurvivedKeys.length, n: 7 })
  })

  it('a post whose opening did NOT survive (a_x05) never counts toward a hook_type', () => {
    const survived = marchX().filter((o) => o.hookSurvived === true && o.dimensions?.hookType)
    expect(survived).toHaveLength(3)
    expect(marchX().find((o) => o.dimensions?.hookType === 'question' && o.hookSurvived === false)).toBeDefined()
  })

  it('a value reaches the page at exactly 10, and not at 9', () => {
    const mk = (n: number, hookType: string): AnalyticsOutcome[] =>
      Array.from({ length: n }, (_, i) => ({
        ...marchX()[2],
        postId: `${hookType}-${i}`,
        beatBaseline: i % 2 === 0,
        hookSurvived: true,
        dimensions: { role: 'anchor_thesis', format: 'single', originMode: 'manual', hookType },
      }))
    const b = winShareBreakdown('hook_type', [...mk(10, 'question'), ...mk(9, 'story')])
    expect(b.values.map((v) => v.value)).toEqual(['question'])
  })

  it('it is NOT a report dimension, and it is the only live-only one', () => {
    expect(REPORT_BREAKDOWN_DIMENSIONS).not.toContain('hook_type')
    expect([...REPORT_BREAKDOWN_DIMENSIONS].sort()).toEqual(['cta_present', 'format', 'length_band', 'origin_mode', 'role'])
    expect([...LIVE_ONLY_BREAKDOWN_DIMENSIONS]).toEqual(['hook_type'])
  })
})

describe('bars need 10 on EVERY side; the interval appears only then (ADR 0031 §8.1)', () => {
  const rows = (n: number, wins: number, role: string): AnalyticsOutcome[] =>
    Array.from({ length: n }, (_, i) => ({
      ...marchX()[2],
      postId: `${role}-${i}`,
      beatBaseline: i < wins,
      dimensions: { role, format: 'single', originMode: 'manual', hookType: null },
    }))

  it('12 posts (9 won) against 10 posts (5 won): bars, with a Wilson interval each', () => {
    const b = winShareBreakdown('role', [...rows(12, 9, 'anchor_thesis'), ...rows(10, 5, 'customer_proof')])
    expect(b.presentation).toBe('bars')
    const a = b.values.find((v) => v.value === 'anchor_thesis')!
    expect(a).toMatchObject({ wins: 9, of: 12, provisional: false })
    expect(a.interval!.lo).toBeCloseTo(0.4677, 3)
    expect(a.interval!.hi).toBeCloseTo(0.9111, 3)
    const c = b.values.find((v) => v.value === 'customer_proof')!
    expect(c.interval!.lo).toBeCloseTo(0.2366, 3)
    expect(c.interval!.hi).toBeCloseTo(0.7634, 3)
  })

  it('12 posts against 9: ONE thin side makes the whole dimension counts only, and neither side gets an interval', () => {
    const b = winShareBreakdown('role', [...rows(12, 9, 'anchor_thesis'), ...rows(9, 5, 'customer_proof')])
    expect(b.presentation).toBe('counts')
    expect(b.values.every((v) => v.interval === null)).toBe(true)
  })

  it('a single value cannot be compared with anything: counts only', () => {
    expect(winShareBreakdown('role', rows(12, 9, 'anchor_thesis')).presentation).toBe('counts')
  })
})

describe('input discipline', () => {
  it('a set that mixes platforms or bases THROWS: win share is never pooled across them', () => {
    const li = { ...marchX()[0], platform: 'linkedin', basis: 'count' as const }
    expect(() => winShareBreakdown('role', [...marchX(), li])).toThrow(/platform/)
  })

  it('an empty set is an empty breakdown covering 0 of 0', () => {
    const b = winShareBreakdown('role', [])
    expect(b.values).toEqual([])
    expect(b.coverage).toEqual({ k: 0, n: 0 })
  })

  it('win share is never produced as a series: breakdowns.ts exports one function and no per-period or trend helper', () => {
    expect(Object.keys(breakdownsModule)).toEqual(['winShareBreakdown'])
  })
})
