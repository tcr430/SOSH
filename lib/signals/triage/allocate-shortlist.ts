// ADR 0023 §5.3 (Session 30 G1b.7) — the reserved-split partition, pure and
// standalone so it is exhaustively unit-testable without mocking the DB or
// Sentry. Operates on an ALREADY score-ordered pool (listNewCandidatesPool
// WithSource's own ORDER BY) and never re-sorts — only filters.
//
// The rule, verbatim: at most 2 rss, at most 1 PER DISTINCT FEED, remainder
// github, total up to the shortlist size. Backfill is DELIBERATELY
// ONE-DIRECTIONAL: if rss has fewer than its 2-slot share (including the
// empty case), github takes the freed slots — "a cap that wastes a slot on
// an empty source is its own bug." The reverse is NOT true: if github is
// short, rss does NOT grow past 2 to compensate. ADR §5.5a's own language
// calls rss's cap a fixed "2-slot share", never a share that grows — and
// the whole point of the reserved split (§5.3, closing L-11) is preventing
// a high-scoring rss flood from swamping the shortlist, a guarantee that
// would evaporate if rss could expand into github's underfill. When BOTH
// sources are short, the returned shortlist is simply smaller than
// `shortlistSize` — that is the existing, already-accepted behaviour for a
// thin backlog, not new.

export interface AllocatableCandidate {
  id: string
  // Nested, matching the REAL shape listNewCandidatesPoolWithSource returns
  // (source/watched_feed_id are signals-table columns, joined onto
  // signal_candidates exactly like title/body already are — never top-level
  // fields on this type).
  signals: {
    source: 'github' | 'rss'
    watched_feed_id: string | null
  }
}

// A fixed, unconditional ceiling — never raised by github's underfill. See
// this file's header comment for why the backfill direction is asymmetric.
const RSS_MAX_SLOTS = 2

export function allocateReservedShortlist<T extends AllocatableCandidate>(
  poolScoreOrdered: readonly T[],
  shortlistSize: number,
): T[] {
  const selectedIds = new Set<string>()
  const seenFeeds = new Set<string>()
  let rssTaken = 0

  // Pass 1: rss, at most RSS_MAX_SLOTS, at most one per distinct feed —
  // walking the pool in its existing score order, so among eligible rss
  // candidates the highest-scored one per feed wins ties for that feed's
  // single slot.
  for (const candidate of poolScoreOrdered) {
    if (rssTaken >= RSS_MAX_SLOTS) break
    if (candidate.signals.source !== 'rss') continue
    // Defensive fallback only — every real rss row has a non-null
    // watched_feed_id (the exactly-one-parent CHECK guarantees it); a null
    // here would mean "no distinct feed to dedupe against," so treat it as
    // its own singleton bucket rather than silently colliding several
    // feed-less candidates into one slot.
    const feedKey = candidate.signals.watched_feed_id ?? `no-feed:${candidate.id}`
    if (seenFeeds.has(feedKey)) continue
    seenFeeds.add(feedKey)
    selectedIds.add(candidate.id)
    rssTaken++
  }

  // Pass 2: github fills the remainder — shortlistSize minus whatever rss
  // actually took (never more, per the one-directional backfill above).
  const githubSlotsRemaining = Math.max(0, shortlistSize - rssTaken)
  let githubTaken = 0
  for (const candidate of poolScoreOrdered) {
    if (githubTaken >= githubSlotsRemaining) break
    if (candidate.signals.source !== 'github') continue
    selectedIds.add(candidate.id)
    githubTaken++
  }

  // Preserve the pool's own score order in the returned shortlist — a
  // second filter pass over the same array, not a re-sort.
  return poolScoreOrdered.filter((c) => selectedIds.has(c.id))
}
