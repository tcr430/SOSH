import type { SupabaseClient } from '@supabase/supabase-js'
import { formatISO } from 'date-fns'
import type { WatchedRepoRow, WatchedRepoInsert } from './types'
import { getErrorMessage } from './utils'

// ADR 0020 §10.1 — the ONLY module that touches watched_repos. Every caller
// (the poller, the watch-list Server Actions) goes through here, never
// through a direct `.from('watched_repos')` elsewhere.

// §3.2 — the watch-list cap (SIGNAL-WATCHLIST-BOUNDED), enforced in the
// Server Action, not here — this constant just bounds the list read itself.
const WATCHED_REPOS_LIST_LIMIT = 20

// Watch-list UI — authenticated client, RLS-scoped. Bounded, ORDER BY
// repo_id ASC: index-satisfied by UNIQUE(business_id, repo_id), which leads
// with business_id.
export async function listWatchedReposForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit: number = WATCHED_REPOS_LIST_LIMIT,
): Promise<WatchedRepoRow[]> {
  const { data, error } = await client
    .from('watched_repos')
    .select('*')
    .eq('business_id', businessId)
    .order('repo_id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as WatchedRepoRow[]) ?? []
}

// SIGNAL-WATCHLIST-BOUNDED's count half — the Server Action reads this
// before an insert to enforce the 20-active cap (§3.2: a CHECK constraint
// cannot see sibling rows, so this is the app-layer half of that guardrail).
export async function countActiveWatchedReposForBusiness(
  client: SupabaseClient,
  businessId: string,
): Promise<number> {
  const { count, error } = await client
    .from('watched_repos')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('is_active', true)
  if (error) throw new Error(getErrorMessage(error))
  return count ?? 0
}

// The poller's per-connection repo list. Bounded, service-role, explicit
// business_id predicate (§3.5) even though connection_id already scopes to
// one business, per the service-role scoping rule.
//
// [Session 27-D · D3, MINOR-2] watched_repos_connection_id_idx (connection_id)
// serves the FILTER's leading column ONLY — it is single-column, so
// `is_active` and the `id ASC` sort are NOT index-covered by it. Accepted as
// a full scan of a bounded slice: this is a per-connection list behind a
// 20-row cap (WATCHED_REPOS_LIST_LIMIT / SIGNAL-WATCHLIST-BOUNDED), not an
// unbounded query. Deferred option, not shipped here (a new migration in a
// correction pass needs its own defect, not a wrong comment): widen to
// (connection_id, is_active, id) — record that under ADR 0020 §3.6 (the
// named-index list) if a future session's workload makes the full scan
// worth avoiding.
export async function listActiveWatchedReposForConnection(
  connectionId: string,
  businessId: string,
  limit: number = WATCHED_REPOS_LIST_LIMIT,
): Promise<WatchedRepoRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('watched_repos')
    .select('*')
    .eq('connection_id', connectionId)
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as WatchedRepoRow[]) ?? []
}

// Watch-list "add" — authenticated client, RLS-scoped INSERT policy backs
// this; UNIQUE(business_id, repo_id) is the idempotency arbiter for
// re-adding an already-watched repo.
export async function addWatchedRepo(
  client: SupabaseClient,
  insert: WatchedRepoInsert,
): Promise<WatchedRepoRow> {
  const { data, error } = await client
    .from('watched_repos')
    .insert(insert)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as WatchedRepoRow
}

// §3.5 — "unwatching is is_active = false", never a DELETE (no DELETE
// policy exists on this table). ONE atomic conditional UPDATE (CLAUDE.md),
// tenancy-scoped even though RLS already enforces it — defense in depth.
export async function setWatchedRepoActive(
  client: SupabaseClient,
  id: string,
  businessId: string,
  isActive: boolean,
): Promise<WatchedRepoRow | null> {
  const { data, error } = await client
    .from('watched_repos')
    .update({ is_active: isActive })
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as WatchedRepoRow | null) ?? null
}

// §4.4 — the poller's cursor write, after each conditional GET. Service-role,
// explicit business_id predicate (§3.5).
export async function updateWatchedRepoPollCursor(
  id: string,
  businessId: string,
  etag: string | null,
): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('watched_repos')
    .update({ releases_etag: etag, last_polled_at: formatISO(new Date()) })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) throw new Error(getErrorMessage(error))
}

// §4.5 — 404 (repo deleted or moved out of the installation): deactivate the
// repo specifically, distinct from deactivating the whole connection.
export async function deactivateWatchedRepo(
  id: string,
  businessId: string,
): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('watched_repos')
    .update({ is_active: false })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) throw new Error(getErrorMessage(error))
}
