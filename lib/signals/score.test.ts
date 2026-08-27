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
    kind: 'release',
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

// ADR 0023 §5.1.1 (Session 30 G1b.6) — humanAuthored becomes kind-keyed.
// The other four terms and their ranges are UNTOUCHED — no test in this
// block duplicates the recency/substance/kindWeight/repoWeight assertions
// above, only the term that actually changed.
describe('scoreSignal — kind-keyed humanAuthored (ADR 0023 §5.1.1)', () => {
  it('humanAuthored is 0 for every article, regardless of isBot', () => {
    const botLike = scoreSignal(makeSignal({ kind: 'article', isBot: true }), NOW)
    const humanLike = scoreSignal(makeSignal({ kind: 'article', isBot: false }), NOW)
    expect(botLike.scoreInputs.humanAuthored).toBe(0)
    expect(humanLike.scoreInputs.humanAuthored).toBe(0)
  })

  it('humanAuthored is UNCHANGED for release: 0 when isBot, 5 otherwise', () => {
    const bot = scoreSignal(makeSignal({ kind: 'release', isBot: true }), NOW)
    const human = scoreSignal(makeSignal({ kind: 'release', isBot: false }), NOW)
    expect(bot.scoreInputs.humanAuthored).toBe(0)
    expect(human.scoreInputs.humanAuthored).toBe(5)
  })

  it('kindWeight stays the fixed 15 for BOTH kinds — not tuned per kind', () => {
    const release = scoreSignal(makeSignal({ kind: 'release' }), NOW)
    const article = scoreSignal(makeSignal({ kind: 'article' }), NOW)
    expect(release.scoreInputs.kindWeight).toBe(15)
    expect(article.scoreInputs.kindWeight).toBe(15)
  })

  // ADR §5.1.1 — the 5-point ceiling gap is DELIBERATE and PERMANENT: an
  // article can never outrank an otherwise-identical human-cut release.
  it('ceilings: release maxes at 100, article maxes at 95 — a 5-point gap, always', () => {
    const maxRelease = scoreSignal(
      makeSignal({ kind: 'release', isBot: false, occurredAt: NOW.toISOString(), bodyLen: 1200, repoWeight: 10 }),
      NOW,
    )
    const maxArticle = scoreSignal(
      makeSignal({ kind: 'article', isBot: false, occurredAt: NOW.toISOString(), bodyLen: 1200, repoWeight: 10 }),
      NOW,
    )
    expect(maxRelease.score).toBe(100)
    expect(maxArticle.score).toBe(95)
    expect(maxRelease.score - maxArticle.score).toBe(5)

    // Even a bot-authored release cannot fall below the article ceiling by
    // more than the isBot penalty alone changes — this is not the gap the
    // ADR names permanent (that gap is specifically article-vs-release at
    // otherwise-identical inputs), but confirms isBot and kind are
    // independent levers, not conflated into one.
    const botRelease = scoreSignal(
      makeSignal({ kind: 'release', isBot: true, occurredAt: NOW.toISOString(), bodyLen: 1200, repoWeight: 10 }),
      NOW,
    )
    expect(botRelease.score).toBe(95)
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

  // ADR 0023 §5.1.1 (Session 30 G1b.6) — re-demonstrated across BOTH kinds,
  // not just release (the original fixtureSet above is release-only).
  const mixedKindFixtureSet: ScorableSignal[] = [
    makeSignal({ externalId: 'github:release:1', occurredAt: '2026-07-14T00:00:00Z', bodyLen: 300, isBot: false, kind: 'release' }),
    makeSignal({ externalId: 'rss:article-1', occurredAt: '2026-07-10T00:00:00Z', bodyLen: 1500, isBot: false, kind: 'article' }),
    makeSignal({ externalId: 'github:release:3', occurredAt: '2026-07-14T00:00:00Z', bodyLen: 900, isBot: true, kind: 'release' }),
    makeSignal({ externalId: 'rss:article-2', occurredAt: '2026-06-01T00:00:00Z', bodyLen: 0, isBot: false, kind: 'article' }),
    makeSignal({ externalId: 'rss:article-3', occurredAt: '2026-07-14T00:00:00Z', bodyLen: 300, isBot: true, kind: 'article' }),
  ]

  it('a mixed release+article fixture set scored twice produces an identical ordered result', () => {
    const first = scoreAndSortSignals(mixedKindFixtureSet, NOW)
    const second = scoreAndSortSignals(mixedKindFixtureSet, NOW)
    expect(second).toEqual(first)
  })

  it('a shuffled copy of the mixed release+article fixture set produces the SAME ordered result', () => {
    const original = scoreAndSortSignals(mixedKindFixtureSet, NOW)
    const fromShuffled = scoreAndSortSignals(shuffled(mixedKindFixtureSet), NOW)
    expect(fromShuffled).toEqual(original)
    expect(fromShuffled.map((s) => s.externalId)).toEqual(original.map((s) => s.externalId))
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
