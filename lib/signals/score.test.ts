import { describe, expect, it } from 'vitest'
import { scoreSignal, scoreAndSortSignals, type ScorableSignal } from './score'
import { parseRelease } from './parse-release'
import releaseValidFixture from './__fixtures__/github/release-valid.json'
import releaseEditedFixture from './__fixtures__/github/release-edited.json'

const NOW = new Date('2026-07-15T00:00:00Z')

function makeSignal(overrides: Partial<ScorableSignal> = {}): ScorableSignal {
  return {
    externalId: 'github:release:1',
    occurredAt: '2026-07-15T00:00:00Z',
    bodyLen: 1200,
    isBot: false,
    repoWeight: 10,
    ...overrides,
  }
}

describe('scoreSignal (ADR 0020 §6.1 formula, verbatim)', () => {
  it('scores age 0 days at the recency max (40)', () => {
    const result = scoreSignal(makeSignal({ occurredAt: NOW.toISOString() }), NOW)
    expect(result.scoreInputs.recency).toBe(40)
  })

  it('scores age exactly 14 days at recency 0 (the window boundary)', () => {
    const occurredAt = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const result = scoreSignal(makeSignal({ occurredAt }), NOW)
    expect(result.scoreInputs.recency).toBe(0)
  })

  it('scores age 15 days (past the window) at recency 0, never negative', () => {
    const occurredAt = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString()
    const result = scoreSignal(makeSignal({ occurredAt }), NOW)
    expect(result.scoreInputs.recency).toBe(0)
  })

  it('scores bodyLen 0 at substance 0', () => {
    const result = scoreSignal(makeSignal({ bodyLen: 0 }), NOW)
    expect(result.scoreInputs.substance).toBe(0)
  })

  it('scores bodyLen 1200 (the substance target) at substance max (30)', () => {
    const result = scoreSignal(makeSignal({ bodyLen: 1200 }), NOW)
    expect(result.scoreInputs.substance).toBe(30)
  })

  it('scores bodyLen 5000 (past the target) at substance max (30), never above it', () => {
    const result = scoreSignal(makeSignal({ bodyLen: 5000 }), NOW)
    expect(result.scoreInputs.substance).toBe(30)
  })

  it('scores a bot-authored release DOWN (humanAuthored 0), not filtered out', () => {
    const result = scoreSignal(makeSignal({ isBot: true }), NOW)
    expect(result.scoreInputs.humanAuthored).toBe(0)
    // §6.2 — still a real candidate, still present in the output.
    expect(result.score).toBeGreaterThan(0)
  })

  it('scores a human-authored release with the +5 bonus', () => {
    const result = scoreSignal(makeSignal({ isBot: false }), NOW)
    expect(result.scoreInputs.humanAuthored).toBe(5)
  })

  it('kindWeight is always 15 (one kind in v1, a term not a base)', () => {
    const result = scoreSignal(makeSignal(), NOW)
    expect(result.scoreInputs.kindWeight).toBe(15)
  })

  it('passes watched_repos.weight through unchanged as repoWeight', () => {
    const result = scoreSignal(makeSignal({ repoWeight: 7 }), NOW)
    expect(result.scoreInputs.repoWeight).toBe(7)
  })

  it('sums every term into the total score and persists them all in score_inputs', () => {
    const result = scoreSignal(makeSignal({ occurredAt: NOW.toISOString(), bodyLen: 1200, isBot: false, repoWeight: 10 }), NOW)
    expect(result.score).toBe(40 + 30 + 15 + 10 + 5)
    expect(result.scoreInputs).toEqual({ recency: 40, substance: 30, kindWeight: 15, repoWeight: 10, humanAuthored: 5 })
  })

  it('never reads the system clock — an identical `now` argument always produces an identical score', () => {
    const a = scoreSignal(makeSignal(), new Date('2020-01-01T00:00:00Z'))
    const b = scoreSignal(makeSignal(), new Date('2020-01-01T00:00:00Z'))
    expect(a).toEqual(b)
  })
})

describe('SIGNAL-SCORING-DETERMINISTIC (ADR §6.3)', () => {
  const fixtureSet: ScorableSignal[] = [
    makeSignal({ externalId: 'github:release:1', occurredAt: '2026-07-14T00:00:00Z', bodyLen: 300, isBot: false }),
    makeSignal({ externalId: 'github:release:2', occurredAt: '2026-07-10T00:00:00Z', bodyLen: 1500, isBot: true }),
    makeSignal({ externalId: 'github:release:3', occurredAt: '2026-07-14T00:00:00Z', bodyLen: 900, isBot: false }),
    makeSignal({ externalId: 'github:release:4', occurredAt: '2026-06-01T00:00:00Z', bodyLen: 0, isBot: false }),
    makeSignal({ externalId: 'github:release:5', occurredAt: '2026-07-14T00:00:00Z', bodyLen: 300, isBot: true }),
  ]

  function shuffled<T>(items: T[]): T[] {
    // Fixed permutation, not Math.random() — a flaky shuffle would make a
    // failure irreproducible, defeating the point of this exact test.
    const copy = [...items]
    const out: T[] = []
    while (copy.length) out.push(copy.splice(copy.length - 1 - (out.length % copy.length), 1)[0])
    return out
  }

  it('the same fixture set scored twice produces an identical ordered result', () => {
    const first = scoreAndSortSignals(fixtureSet, NOW)
    const second = scoreAndSortSignals(fixtureSet, NOW)
    expect(second).toEqual(first)
  })

  it('a shuffled copy of the same fixture set produces the SAME ordered result as the original order', () => {
    const original = scoreAndSortSignals(fixtureSet, NOW)
    const fromShuffled = scoreAndSortSignals(shuffled(fixtureSet), NOW)
    expect(fromShuffled).toEqual(original)
    expect(fromShuffled.map((s) => s.externalId)).toEqual(original.map((s) => s.externalId))
  })

  it('ties are broken by the total order: score DESC, occurred_at DESC, external_id ASC', () => {
    const idA = makeSignal({ externalId: 'github:release:zzz', occurredAt: '2026-07-01T00:00:00Z', bodyLen: 500, isBot: false, repoWeight: 10 })
    const idB = makeSignal({ externalId: 'github:release:aaa', occurredAt: '2026-07-01T00:00:00Z', bodyLen: 500, isBot: false, repoWeight: 10 })
    const result = scoreAndSortSignals([idA, idB], NOW)
    expect(result[0].externalId).toBe('github:release:aaa')
    expect(result[1].externalId).toBe('github:release:zzz')
  })
})

describe('SIGNAL-DEDUP-STABLE-ON-EDIT (ADR §6.4, the key half)', () => {
  it('release-edited.json parses to the SAME external_id as release-valid.json despite different title/body/tag', () => {
    const original = releaseValidFixture as { body: unknown[] }
    const validResult = parseRelease(original.body[0])
    const editedResult = parseRelease(releaseEditedFixture)

    expect(validResult.status).toBe('ok')
    expect(editedResult.status).toBe('ok')
    if (validResult.status !== 'ok' || editedResult.status !== 'ok') return

    expect(editedResult.signal.external_id).toBe(validResult.signal.external_id)
    expect(editedResult.signal.title).not.toBe(validResult.signal.title)
    expect(editedResult.signal.body).not.toBe(validResult.signal.body)
  })
})
