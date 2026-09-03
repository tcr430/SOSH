import { describe, it, expect } from 'vitest'
import { allocateReservedShortlist, type AllocatableCandidate } from './allocate-shortlist'

function makeCandidate(id: string, source: 'github' | 'rss', watchedFeedId: string | null = null): AllocatableCandidate {
  return { id, signals: { source, watched_feed_id: watchedFeedId } }
}

describe('allocateReservedShortlist (ADR 0023 §5.3)', () => {
  it('at most 2 rss out of 5, remainder github', () => {
    const pool = [
      makeCandidate('rss-1', 'rss', 'feed-a'),
      makeCandidate('rss-2', 'rss', 'feed-b'),
      makeCandidate('rss-3', 'rss', 'feed-c'),
      makeCandidate('gh-1', 'github'),
      makeCandidate('gh-2', 'github'),
      makeCandidate('gh-3', 'github'),
    ]
    const result = allocateReservedShortlist(pool, 5)
    const rssIds = result.filter((c) => c.signals.source === 'rss').map((c) => c.id)
    const githubIds = result.filter((c) => c.signals.source === 'github').map((c) => c.id)

    expect(rssIds).toHaveLength(2)
    expect(rssIds).toEqual(['rss-1', 'rss-2']) // highest-scored (pool order) rss taken first
    expect(githubIds).toHaveLength(3)
    expect(result).toHaveLength(5)
  })

  it('at most 1 per distinct feed — a second candidate from an already-used feed is skipped, not counted against the 2-slot cap', () => {
    const pool = [
      makeCandidate('rss-1', 'rss', 'feed-a'),
      makeCandidate('rss-1b', 'rss', 'feed-a'), // same feed as rss-1, lower in pool order
      makeCandidate('rss-2', 'rss', 'feed-b'),
      makeCandidate('gh-1', 'github'),
      makeCandidate('gh-2', 'github'),
      makeCandidate('gh-3', 'github'),
    ]
    const result = allocateReservedShortlist(pool, 5)
    const rssIds = result.filter((c) => c.signals.source === 'rss').map((c) => c.id)

    // rss-1b is skipped (same feed as rss-1), rss-2 (a distinct feed) fills
    // the second rss slot instead — the cap is 2 SLOTS, not 2 attempts.
    expect(rssIds).toEqual(['rss-1', 'rss-2'])
    expect(result.map((c) => c.id)).not.toContain('rss-1b')
  })

  it("backfill: rss source EMPTY yields all five slots to github — 'a cap that wastes a slot on an empty source is its own bug'", () => {
    const pool = [
      makeCandidate('gh-1', 'github'),
      makeCandidate('gh-2', 'github'),
      makeCandidate('gh-3', 'github'),
      makeCandidate('gh-4', 'github'),
      makeCandidate('gh-5', 'github'),
      makeCandidate('gh-6', 'github'),
    ]
    const result = allocateReservedShortlist(pool, 5)
    expect(result).toHaveLength(5)
    expect(result.every((c) => c.signals.source === 'github')).toBe(true)
  })

  it('rss has only 1 distinct feed available (of many candidates) — github backfills the freed second rss slot', () => {
    const pool = [
      makeCandidate('rss-1', 'rss', 'feed-a'),
      makeCandidate('rss-2', 'rss', 'feed-a'), // same feed — cannot fill the 2nd rss slot
      makeCandidate('rss-3', 'rss', 'feed-a'),
      makeCandidate('gh-1', 'github'),
      makeCandidate('gh-2', 'github'),
      makeCandidate('gh-3', 'github'),
      makeCandidate('gh-4', 'github'),
    ]
    const result = allocateReservedShortlist(pool, 5)
    const rssIds = result.filter((c) => c.signals.source === 'rss').map((c) => c.id)
    const githubIds = result.filter((c) => c.signals.source === 'github').map((c) => c.id)

    expect(rssIds).toEqual(['rss-1']) // only one distinct feed available
    expect(githubIds).toHaveLength(4) // github takes the freed slot, not just its "normal" 3
    expect(result).toHaveLength(5)
  })

  it('github source EMPTY: rss stays capped at 2 (its fixed share is NOT raised by github underfilling) — total is smaller than shortlistSize', () => {
    const pool = [
      makeCandidate('rss-1', 'rss', 'feed-a'),
      makeCandidate('rss-2', 'rss', 'feed-b'),
      makeCandidate('rss-3', 'rss', 'feed-c'),
      makeCandidate('rss-4', 'rss', 'feed-d'),
    ]
    const result = allocateReservedShortlist(pool, 5)
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.id)).toEqual(['rss-1', 'rss-2'])
  })

  it('both sources short: the shortlist is simply smaller than shortlistSize, not padded or errored', () => {
    const pool = [makeCandidate('rss-1', 'rss', 'feed-a'), makeCandidate('gh-1', 'github')]
    const result = allocateReservedShortlist(pool, 5)
    expect(result).toHaveLength(2)
  })

  it('empty pool returns an empty shortlist', () => {
    expect(allocateReservedShortlist([], 5)).toEqual([])
  })

  it("preserves the pool's own score order in the returned shortlist (a filter, never a re-sort)", () => {
    const pool = [
      makeCandidate('gh-1', 'github'),
      makeCandidate('rss-1', 'rss', 'feed-a'),
      makeCandidate('gh-2', 'github'),
      makeCandidate('rss-2', 'rss', 'feed-b'),
      makeCandidate('gh-3', 'github'),
    ]
    const result = allocateReservedShortlist(pool, 5)
    expect(result.map((c) => c.id)).toEqual(['gh-1', 'rss-1', 'gh-2', 'rss-2', 'gh-3'])
  })

  it('a null watched_feed_id (defensive fallback) is treated as its own singleton bucket, never colliding two feed-less candidates', () => {
    const pool = [
      makeCandidate('rss-null-1', 'rss', null),
      makeCandidate('rss-null-2', 'rss', null),
      makeCandidate('gh-1', 'github'),
      makeCandidate('gh-2', 'github'),
      makeCandidate('gh-3', 'github'),
    ]
    const result = allocateReservedShortlist(pool, 5)
    const rssIds = result.filter((c) => c.signals.source === 'rss').map((c) => c.id)
    // Both null-feed candidates are DISTINCT (keyed by id, not merged),
    // so both count toward the 2-slot cap independently.
    expect(rssIds).toEqual(['rss-null-1', 'rss-null-2'])
  })

  it('a smaller shortlistSize than 5 is respected (the function is not hardcoded to 5)', () => {
    const pool = [
      makeCandidate('rss-1', 'rss', 'feed-a'),
      makeCandidate('rss-2', 'rss', 'feed-b'),
      makeCandidate('gh-1', 'github'),
      makeCandidate('gh-2', 'github'),
    ]
    const result = allocateReservedShortlist(pool, 2)
    expect(result).toHaveLength(2)
    // rss still gets first crack at its (up to 2) slots within the smaller total.
    expect(result.map((c) => c.id)).toEqual(['rss-1', 'rss-2'])
  })
})
