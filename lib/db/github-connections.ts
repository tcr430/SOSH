import type { SupabaseClient } from '@supabase/supabase-js'
import { formatISO } from 'date-fns'
import type { GithubConnectionRow, GithubConnectionInsert } from './types'
import { getErrorMessage } from './utils'

// ADR 0020 §10.1 — the ONLY module that touches github_connections. Every
// caller (the poller, the install callback, the settings UI) goes through
// here, never through a direct `.from('github_connections')` elsewhere.

// §4.2 — the claim window: a connection not started, or started more than
// 50 minutes ago (a crashed tick self-heals at the next hourly cadence
// rather than staying claimed forever).
const CLAIM_STALE_MINUTES = 50

// §3.6 — matches github_connections_poll_claim_idx (is_active, last_poll_started_at).
const POLL_CLAIM_LIST_LIMIT = 20

function staleBefore(): string {
  return formatISO(new Date(Date.now() - CLAIM_STALE_MINUTES * 60 * 1000))
}

// [Session 27-D · D5, A-5] Comparison value for the rate_limited_until
// predicate below — date-fns formatISO, per CLAUDE.md's date-handling rule
// (never new Date().toISOString()).
function nowIso(): string {
  return formatISO(new Date())
}

// Settings/watch-list UI — authenticated client, RLS-scoped SELECT-only
// policy. One row per business (UNIQUE(business_id)), so no ORDER BY/limit
// is needed.
export async function getGithubConnectionByBusinessId(
  client: SupabaseClient,
  businessId: string,
): Promise<GithubConnectionRow | null> {
  const { data, error } = await client
    .from('github_connections')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as GithubConnectionRow | null) ?? null
}

// §4.2/§4.6 — the poller's candidate list: bounded, ORDER BY
// last_poll_started_at ASC NULLS FIRST + LIMIT, matching
// github_connections_poll_claim_idx (is_active, last_poll_started_at)
// EXACTLY (L-13 — a service-role caller gets no exception). Service-role:
// acquires its own client via the lazy import pattern (CLAUDE.md); the
// orchestrator calling this never holds an authenticated client for this
// table.
export async function listConnectionsReadyForPoll(
  limit: number = POLL_CLAIM_LIST_LIMIT,
): Promise<GithubConnectionRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('github_connections')
    .select('*')
    .eq('is_active', true)
    .or(`last_poll_started_at.is.null,last_poll_started_at.lt.${staleBefore()}`)
    // [Session 27-D · D5, A-5/MINOR-6] SECOND .or() call, deliberately —
    // supabase-js/PostgREST ANDs separate filter calls together, so this
    // combines with the .or() above as (is_active) AND (poll-stale-or-null)
    // AND (rate-limit-expired-or-none). Excludes a connection whose
    // rate_limited_until is still in the future, so it is not re-claimed
    // and re-minted on the very next tick, guaranteed to 403 again — see
    // recordGithubConnectionRateLimited's comment below for why this
    // changed. Comment-accuracy note (MINOR-2's lesson applied here too):
    // github_connections_poll_claim_idx is (is_active, last_poll_started_at)
    // ONLY — it still serves the is_active filter and the
    // last_poll_started_at ordering exactly as before; rate_limited_until is
    // NOT part of that index, so this predicate is a filter over the
    // (already narrow, ≤20-row) candidate set the index produces, not an
    // index-served scan of its own.
    .or(`rate_limited_until.is.null,rate_limited_until.lt.${nowIso()}`)
    .order('last_poll_started_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as GithubConnectionRow[]) ?? []
}

// §4.2 — the ATOMIC conditional claim (L-11: never read-then-update). The
// WHERE clause re-guards the exact same window listConnectionsReadyForPoll
// selected against, so a connection claimed by a concurrent tick between the
// list and this call updates zero rows (returns null) rather than being
// claimed twice.
export async function claimGithubConnectionForPoll(id: string): Promise<GithubConnectionRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('github_connections')
    .update({ last_poll_started_at: formatISO(new Date()) })
    .eq('id', id)
    .eq('is_active', true)
    .or(`last_poll_started_at.is.null,last_poll_started_at.lt.${staleBefore()}`)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as GithubConnectionRow | null) ?? null
}

// §4.6 — the poller's tick completion stamp. Explicit business_id predicate
// (§3.5) even though `id` alone is unique, per the service-role scoping rule.
export async function completeGithubConnectionPoll(
  id: string,
  businessId: string,
  status: string,
): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('github_connections')
    .update({ last_poll_completed_at: formatISO(new Date()), last_poll_status: status })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) throw new Error(getErrorMessage(error))
}

// §4.5/§2.5 — revocation containment: a 401/404 while minting an
// installation token, or an explicit disconnect, both land here. Atomic
// conditional UPDATE guarded by is_active=true, so a second concurrent call
// (or a call racing a reconnect) is a no-op rather than clobbering a fresh
// is_active=true row.
export async function deactivateGithubConnection(
  businessId: string,
  status: string,
): Promise<GithubConnectionRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('github_connections')
    .update({ is_active: false, last_poll_status: status })
    .eq('business_id', businessId)
    .eq('is_active', true)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as GithubConnectionRow | null) ?? null
}

// §4.5 — 403 rate-limit containment: records the rate_limited_until stamp
// AND completes the claim (last_poll_completed_at + last_poll_status =
// 'rate_limited'), a DISTINCT write from completeGithubConnectionPoll only
// because this path needs the extra rate_limited_until column in the same
// statement. Completing the claim here (rather than leaving
// last_poll_started_at set) means the connection is not stuck "claimed"
// until the 50-minute staleness window lapses — next hour's tick can
// attempt it again immediately (this was previously recorded as harmless: a
// second attempt inside a still-active rate limit just produces another
// 403, counted again).
//
// [Session 27-D · D5, A-5/MINOR-6] That "harmless" framing is the RECORD OF
// THE PRIOR BEHAVIOUR, kept above for history — it changed here.
// rate_limited_until is now a CLAIM PREDICATE, not merely an informational
// stamp: listConnectionsReadyForPoll excludes any connection whose
// rate_limited_until is still in the future. Why it changed: inside a known
// rate limit, the retry is not "harmless" — it is a GUARANTEED 403 (GitHub
// already told us when the window reopens), it burns one of this tick's
// ≤20 claim slots on a call known to fail, and the column existed but did
// nothing with that knowledge until now. NO deactivation (§4.5) — a rate
// limit is still not a revocation; only the claim eligibility changed.
export async function recordGithubConnectionRateLimited(
  businessId: string,
  rateLimitedUntil: string,
): Promise<void> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { error } = await client
    .from('github_connections')
    .update({
      rate_limited_until: rateLimitedUntil,
      last_poll_completed_at: formatISO(new Date()),
      last_poll_status: 'rate_limited',
    })
    .eq('business_id', businessId)
  if (error) throw new Error(getErrorMessage(error))
}

export type UpsertGithubConnectionResult =
  | { status: 'claimed'; connection: GithubConnectionRow }
  // ADR §8.2/§8.3 step 11 — installation_id already belongs to a DIFFERENT
  // business. Never a silent rebind.
  | { status: 'conflict' }

// §8.3 step 11 — the install callback's write, reached only AFTER step 9's
// ownership proof (GET /user/installations) has already established the
// caller can administer this installation. Service-role (§8.5: "the write
// ... runs service-role and bypasses RLS, so the app-layer user_can check
// is the real boundary" — the callback gates BEFORE calling this).
//
// Upsert on UNIQUE(business_id): a business reconnecting (same business,
// possibly a different installation_id — e.g. after uninstalling and
// reinstalling the App) replaces its one row rather than violating that
// constraint. But github_connections ALSO has UNIQUE(installation_id)
// (§3.2's arbiter for "one workspace owns this installation"), and
// Postgres enforces every constraint on the table regardless of which
// column the upsert names as its conflict target — so a genuine collision
// (this installation_id already belongs to a DIFFERENT business_id) still
// raises 23505, not a silent cross-tenant rebind. That 23505 is the actual
// race-safety net; the discriminated return type just makes the common,
// non-race case ("you tried to connect an installation someone else already
// claimed") a typed, user-facing outcome instead of an opaque throw.
export async function upsertGithubConnection(
  insert: GithubConnectionInsert,
): Promise<UpsertGithubConnectionResult> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('github_connections')
    .upsert(insert, { onConflict: 'business_id' })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return { status: 'conflict' }
    throw new Error(getErrorMessage(error))
  }
  return { status: 'claimed', connection: data as GithubConnectionRow }
}
