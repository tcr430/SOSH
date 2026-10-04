import { describe, it, expect } from 'vitest'
import * as winsModule from '../wins'
import { winsOf, winsByPlatform } from '../wins'
import { monthOf } from '../period'
import { fixtureRecords } from '../__fixtures__/adapters'
import { BUSINESS_A_ID, EXPECTED } from '../__fixtures__/portfolio'
import type { AnalyticsOutcome } from '../types'

const marchA = (): AnalyticsOutcome[] =>
  fixtureRecords(BUSINESS_A_ID)
    .flatMap((r) => (r.outcome ? [r.outcome] : []))
    .filter((o) => monthOf(o.publishedAt, 'Europe/Lisbon') === '2026-03')

const marchX = () => marchA().filter((o) => o.platform === 'twitter')

describe('winsOf: "{wins} of {n} beat your usual", per platform (ADR 0031 §2.4)', () => {
  it('March, business A, X: 4 of 6 (a_x03..a_x06 won, a_x01 and a_x02 did not, a_x07 has no baseline)', () => {
    expect(winsOf(marchX())).toMatchObject({ wins: 4, of: 6 })
    expect(winsOf(marchX())).toMatchObject(EXPECTED.march.x.wins)
  })

  it('NULL is not a loss: the 7th measured post (beat_baseline NULL) is NOT in n', () => {
    const rows = marchX()
    expect(rows).toHaveLength(7)
    expect(rows.filter((o) => o.beatBaseline === null)).toHaveLength(1)
    expect(winsOf(rows).of).toBe(6)
    expect(winsOf(rows).of).not.toBe(rows.length)
  })

  it('the wins n is shown separately from the median n: 6 against 7', () => {
    expect(winsOf(marchX()).of).not.toBe(marchX().length)
  })

  it('counts the import-seeded baselines so the disclosure can be shown: a_x03 only', () => {
    expect(winsOf(marchX()).importSeed).toBe(EXPECTED.march.x.importSeedRowKeys.length)
    expect(winsOf(marchX()).importSeed).toBe(1)
  })

  it('an empty set is 0 of 0 (never a division, never a made-up share)', () => {
    expect(winsOf([])).toEqual({ wins: 0, of: 0, importSeed: 0 })
  })

  it('a set that mixes platforms or bases THROWS: a win count is never pooled', () => {
    expect(() => winsOf(marchA())).toThrow(/platform/)
    const x = marchX()
    expect(() => winsOf([...x, { ...x[0], basis: 'count' }])).toThrow(/basis/)
  })
})

describe('winsByPlatform: one result per platform, never a total', () => {
  it('X and LinkedIn each get their own count; LinkedIn has no baselines so it is 0 of 0', () => {
    const result = winsByPlatform(marchA())
    expect(result.map((r) => r.platform)).toEqual(['linkedin', 'twitter'])
    expect(result.find((r) => r.platform === 'twitter')).toMatchObject({ wins: 4, of: 6 })
    expect(result.find((r) => r.platform === 'linkedin')).toMatchObject({ wins: 0, of: 0 })
  })

  it('the result has exactly one row per platform: no pooled row', () => {
    expect(winsByPlatform(marchA())).toHaveLength(2)
  })
})

describe('there is no function that pools wins across platforms: its ABSENCE is the test (ADR 0031 §2.3, [mle-3])', () => {
  it('wins.ts exports exactly winsOf and winsByPlatform', () => {
    expect(Object.keys(winsModule).sort()).toEqual(['winsByPlatform', 'winsOf'])
  })
})
