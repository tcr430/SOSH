import type { SupabaseClient } from '@supabase/supabase-js'
import { formatISO } from 'date-fns'
import type { WatchedFeedRow, WatchedFeedInsert } from './types'
import { getErrorMessage } from './utils'

// ADR 0023 §3.2/§10.1 — the ONLY module that touches watched_feeds. Every
// caller (the poller, the watch-list Server Actions) goes through here,
// never through a direct `.from('watched_feeds')` elsewhere — mirrors
// lib/db/watched-repos.ts's exact convention for the GitHub source.

// The watch-list cap (mirroring SIGNAL-WATCHLIST-BOUNDED) is enforced in
// the Server Action (G1b.9), not here — this constant just bounds the list
// read itself.
const WATCHED_FEEDS_LIST_LIMIT = 20

// [watched-repos.ts:52-61 MINOR-2 precedent, accepted here identically]
// No index on watched_feeds serves an ORDER BY last_fetch_at — the table
// carries no poll-claim index (unlike github_connections_poll_claim_idx).
// Accepted as a full scan of a BOUNDED slice: this is the cross-business
// poller's candidate list behind a limit, not an unbounded query, and
// watched_feeds' expected row count (capped per business, modest business
// count at this stage) makes the scan cheap. Revisit with a dedicated
// (is_active, last_fetch_at) index if a future session's workload makes it
// worth avoiding.
const POLL_CANDIDATE_LIST_LIMIT = 100

function nowIso(): string {
  return formatISO(new Date())
}

// Watch-list UI — authenticated client, RLS-scoped. Bounded, chronological.
export async function listWatchedFeedsForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit: number = WATCHED_FEEDS_LIST_LIMIT,
): Promise<WatchedFeedRow[]> {
  const { data, error } = await client
    .from('watched_feeds')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as WatchedFeedRow[]) ?? []
}

// The watch-list cap's count half — the Server Action reads this before an
// insert to enforce the active-feed cap (G1b.9), the same shape as
// countActiveWatchedReposForBusiness.
export async function countActiveWatchedFeedsForBusiness(
  client: SupabaseClient,
  businessId: string,
): Promise<number> {
  const { count, error } = await client
    .from('watched_feeds')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('is_active', true)
  if (error) throw new Error(getErrorMessage(error))
  return count ?? 0
}

// Watch-list "add" — authenticated client, RLS-scoped INSERT policy backs
// this; UNIQUE(business_id, url_hash) is the idempotency arbiter for
// re-adding an already-watched feed.
export async function addWatchedFeed(
  client: SupabaseClient,
  insert: WatchedFeedInsert,
): Promise<WatchedFeedRow> {
  const { data, error } = await client
    .from('watched_feeds')
    .insert(insert)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as WatchedFeedRow
}

// §7.6 — "unwatching is is_active = false", never a DELETE (no DELETE
// policy exists on this table). ONE atomic conditional UPDATE, tenancy-
// scoped even though RLS already enforces it — defense in depth, mirroring
// setWatchedRepoActive.
export async function setWatchedFeedActive(
  client: SupabaseClient,
  id: string,
  businessId: string,
  isActive: boolean,
): Promise<WatchedFeedRow | null> {
  const { data, error } = await client
    .from('watched_feeds')
    .update({ is_active: isActive })
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as WatchedFeedRow | null) ?? null
}

// §3.4/§9.4 — the poller's candidate list: bounded, ORDER BY last_fetch_at
// ASC NULLS FIRST (poll the least-recently-fetched feeds first, so a large
// backlog cannot starve any one feed forever) + an id tiebreak for
// deterministic ordering across ties, mirroring
// listSignalsForWatchedRepo's own tiebreak precedent. Excludes a feed whose
// rate_limited_until is still in the future — no G1b.5 code path currently
// SETS this column (see rss-orchestrator.ts's own comment on why), but the
// list query honors it symmetrically with github_connections' identical
// exclusion, so a future or manually-set backoff window is respected.
// Service-role: acquires its own client (CLAUDE.md's lazy-import pattern).
export async function listActiveWatchedFeedsReadyForPoll(
  limit: number = POLL_CANDIDATE_LIST_LIMIT,
): Promise<WatchedFeedRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('watched_feeds')
    .select('*')
    .eq('is_active', true)
    .or(`rate_limited_until.is.null,rate_limited_until.lt.${nowIso()}`)
    .order('last_fetch_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as WatchedFeedRow[]) ?? []
}

export interface WatchedFeedPollOutcome {
  status: 'ok' | 'not_modified' | 'error'
  errorCode?: string | null
  etag?: string | null
  // Caller-computed (see rss-orchestrator.ts): 0 on success/not_modified,
  // previous value + 1 on error. NOT an atomic increment — see that file's
  // comment on the accepted concurrency model this relies on.
  consecutiveFailureCount: number
}

// §9.4 clause 1 — the persisted poll-state write, ONE atomic UPDATE per
// feed per tick, mirroring updateWatchedRepoPollCursor's shape. Service-role,
// explicit business_id predicate.
export async function recordWatchedFeedPollOutcome(
  id: string,
  businessId: string,
  outcome: WatchedFeedPollOutcome,
): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('watched_feeds')
    .update({
      last_fetch_at: nowIso(),
      last_fetch_status: outcome.status,
      last_error_code: outcome.errorCode ?? null,
      consecutive_failure_count: outcome.consecutiveFailureCount,
      ...(outcome.etag !== undefined ? { etag: outcome.etag } : {}),
    })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) throw new Error(getErrorMessage(error))
}
