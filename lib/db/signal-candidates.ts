import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalCandidateRow, SignalCandidateWithSignal, SignalCandidateInsert, SignalSource } from './types'
import { getErrorMessage } from './utils'

// ADR 0020 §10.1 — the ONLY module that touches signal_candidates. Every
// caller (Stage B's scorer, Session 28's Stage C reader) goes through here,
// never through a direct `.from('signal_candidates')` elsewhere.

const NEW_CANDIDATES_DEFAULT_LIMIT = 50

// ADR 0023 §5.3 (Session 30 G1b.7) — the shared join-select fragment
// listNewCandidates and the new pool reader below both build on, so the
// column list is written once. listNewCandidates's own exported signature,
// filter, ordering, default bound and join list stay EXACTLY as ADR 0021
// §13.1 promises — this helper only adds columns for the NEW reader's
// callers, never changes what listNewCandidates itself selects.
function signalsJoinSelect(extraColumns: string = ''): string {
  return `*, signals(title, body, html_url, occurred_at, author_is_bot, is_prerelease${extraColumns})`
}

// ADR §13.1 — the EXACT signature the Session 28 contract promises. Do not
// rename this later; ADR 0021 builds against this name.
//
// Filter: business_id + status = 'new'. Order: score DESC, occurred_at DESC,
// id ASC — matches signal_candidates_feed_idx (business_id, score DESC,
// occurred_at DESC, id ASC) WHERE status = 'new' EXACTLY, so the partial
// index serves this query. Bound: explicit limit, default 50.
//
// §13.1's own join list also names `tag_name` from `signals` — that column
// does not exist on `signals` today (E2.1's migration was built verbatim
// from ADR §3.3's column list, which never included it; §5.3/§13.1's
// mentions of it are a drift against §3.3, recorded here rather than
// silently reconciled by inventing a migration in this step). This function
// joins only the columns that actually exist — title, body, html_url,
// occurred_at, author_is_bot. A future correction pass (or Session 28
// itself, when it first needs a distinct release-tag label) should add
// `signals.tag_name text` and extend the select below; until then, the
// join is short exactly that one field.
// Session 28 E5.7 — is_prerelease added to the join. It was ALSO missing
// from §13.1's original list (like tag_name above), just unnoticed until
// Stage D's sensitivity rule (ADR §4.4: "Rule inputs, all deterministic:
// is_prerelease, author_is_bot, and a keyword scan") needed it — the same
// drift-correction shape as the tag_name note, applied to a second field.
export async function listNewCandidates(
  client: SupabaseClient,
  businessId: string,
  limit: number = NEW_CANDIDATES_DEFAULT_LIMIT,
): Promise<SignalCandidateWithSignal[]> {
  const { data, error } = await client
    .from('signal_candidates')
    .select(signalsJoinSelect())
    .eq('business_id', businessId)
    .eq('status', 'new')
    .order('score', { ascending: false })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  // The read boundary that mints UntrustedText out of the joined signals
  // row (see the SignalCandidateWithSignal comment in lib/db/types.ts) —
  // Supabase returns plain JSON with no runtime brand, same as
  // lib/db/signals.ts's asSignalRow. Cast through `unknown`: the select
  // string now comes from signalsJoinSelect() rather than a literal at the
  // call site, so supabase-js's generic overload resolution can no longer
  // infer a row shape from it (GenericStringError) — the same "cast through
  // unknown" idiom lib/signals/score.ts already uses for an analogous
  // shape-widening cast, not a new pattern.
  return (data as unknown as SignalCandidateWithSignal[]) ?? []
}

// ADR 0023 §5.3 (Session 30 G1b.7) — the reserved-split allocation's pool
// read: same filter/ordering as listNewCandidates, a LARGER bound, and
// `signals.source` + `signals.watched_feed_id` added to the join —
// `source` to partition github vs rss, `watched_feed_id` to enforce "at
// most 1 per distinct feed" (the ADR names only `source`; `watched_feed_id`
// is the column the per-feed cap cannot be expressed without, added here
// for the same reason is_prerelease/tag_name were added to the ORIGINAL
// join in past sessions — a drift the join list must actually serve).
//
// NO new column on signal_candidates, NO new index: source is not a sort
// key and never enters signal_candidates_feed_idx — allocation is a filter
// OVER an already-ordered result set, and the existing partial index
// (business_id, score DESC, occurred_at DESC, id ASC) WHERE status='new'
// serves this query exactly as it serves listNewCandidates.
//
// 30 — six times TRIAGE_SHORTLIST_PER_TICK (5): generous headroom so a
// score-order read still surfaces enough github candidates even when a
// high-scoring rss flood occupies much of the pool's top — the exact L-11
// starvation risk this whole allocation rule exists to close.
const CANDIDATE_POOL_DEFAULT_LIMIT = 30

export type SignalCandidateWithSourceAndFeed = SignalCandidateWithSignal & {
  signals: SignalCandidateWithSignal['signals'] & {
    source: SignalSource
    watched_feed_id: string | null
  }
}

export async function listNewCandidatesPoolWithSource(
  client: SupabaseClient,
  businessId: string,
  limit: number = CANDIDATE_POOL_DEFAULT_LIMIT,
): Promise<SignalCandidateWithSourceAndFeed[]> {
  const { data, error } = await client
    .from('signal_candidates')
    .select(signalsJoinSelect(', source, watched_feed_id'))
    .eq('business_id', businessId)
    .eq('status', 'new')
    .order('score', { ascending: false })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as unknown as SignalCandidateWithSourceAndFeed[]) ?? []
}

// ADR 0023 §5.5a (Session 30 G1b.7) — replaces
// listActiveConnectionBusinessIds (lib/db/github-connections.ts, now
// deleted — this was its one production caller) at
// lib/signals/triage/orchestrator.ts:179. That enumeration read
// github_connections alone, so a feed-only business (no GitHub connection
// at all) was NEVER triaged — a real defect this closes, not a
// refactor for its own sake. business_id is the leading column of the
// existing partial index, so this needs no new index either.
//
// PostgREST's fluent query builder has no SELECT DISTINCT — the SQL this
// function's name promises is expressed as a plain filtered read
// (index-servable on the leading business_id column) followed by a
// client-side Set dedupe, which is semantically identical to
// `SELECT DISTINCT business_id FROM signal_candidates WHERE status='new'`
// for a result set this size (ADR's own recorded scale caveat: Postgres
// has no loose index scan, so a real DISTINCT would visit every matching
// row too — fine at current volumes, worth revisiting if candidates-per-
// business grows large).
//
// Named semantics change (recorded here, not left for a Reviewer to find):
// a business whose GitHub connection was deactivated now has its already-
// ingested backlog drained, where today it is stranded. This is ADR 0020
// §8.6's connect-time grandfathering applied consistently — there was no
// plan check in the poller-enumeration path to lose, so this does not
// weaken §8.1's gating seam.
const BUSINESS_ENUMERATION_LIMIT = 5000

export async function listBusinessesWithNewCandidates(
  client: SupabaseClient,
  limit: number = BUSINESS_ENUMERATION_LIMIT,
): Promise<string[]> {
  const { data, error } = await client
    .from('signal_candidates')
    .select('business_id')
    .eq('status', 'new')
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  const ids = new Set((data ?? []).map((row) => (row as { business_id: string }).business_id))
  return Array.from(ids)
}

// §6.4/§6.5 — Stage B's scorer write. UPSERT on UNIQUE(signal_id), the
// arbiter §3.4 exists for: without it, ON CONFLICT (signal_id) has no
// target and every re-score would insert a duplicate row. Service-role —
// the scorer runs inside the same poller tick as the ingestion write,
// never from an authenticated path. Explicit business_id predicate is
// carried on the row itself (§3.5).
//
// Routed through the upsert_signal_candidate RPC
// (20260806090000_signal_candidates_guarded_upsert.sql), NOT a plain
// `.upsert()`: PostgREST's upsert cannot express a conditional
// `ON CONFLICT ... DO UPDATE ... WHERE` clause, and that WHERE
// (status = 'new') is what makes SIGNAL-DEDUP-STABLE-ON-EDIT's guarantee —
// a re-score can never resurrect a candidate a human has dismissed — true
// rather than merely intended (ADR §6.4). A `null` return is that guard's
// no-op signal (the row exists but is no longer 'new'), not an error; the
// caller must treat it as "nothing written," never retry it as a failure.
export async function upsertSignalCandidate(
  insert: SignalCandidateInsert,
): Promise<SignalCandidateRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('upsert_signal_candidate', {
    p_business_id: insert.business_id,
    p_signal_id: insert.signal_id,
    p_score: insert.score,
    p_score_inputs: insert.score_inputs ?? {},
    p_occurred_at: insert.occurred_at,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SignalCandidateRow[] | null) ?? []
  return rows[0] ?? null
}

// ─── Stage C triage state (ADR 0021 §2.5/§2.9/§2.10, Session 28 E5.6) ───────

// §2.9 — the atomic claim, mirroring claimGithubConnectionForPoll's shape
// (lib/db/github-connections.ts:88-101, ADR 0020 §4.2): the WHERE clause
// re-guards the exact window the caller's shortlist read selected against,
// so a candidate claimed by a concurrent tick updates zero rows (returns
// null) rather than being claimed twice.
export async function claimCandidateForTriage(
  client: SupabaseClient,
  id: string,
  claimedAtIso: string,
): Promise<SignalCandidateRow | null> {
  const { data, error } = await client
    .from('signal_candidates')
    .update({ status: 'triaging', triage_claimed_at: claimedAtIso })
    .eq('id', id)
    .eq('status', 'new')
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SignalCandidateRow | null) ?? null
}

// §2.9 — a crashed tick's claim self-heals rather than stranding the row at
// 'triaging' forever (the bug class ADR 0017 already hit once, "BLOCKER-1
// activate-guard stuck rows"). Returns the count reclaimed, index-served by
// signal_candidates_triage_claim_idx (E5.2).
export async function reclaimStaleTriagingCandidates(
  client: SupabaseClient,
  staleBeforeIso: string,
): Promise<number> {
  const { data, error } = await client
    .from('signal_candidates')
    .update({ status: 'new', triage_claimed_at: null })
    .eq('status', 'triaging')
    .lt('triage_claimed_at', staleBeforeIso)
    .select('id')
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).length
}

// §2.5/§0.2 A-4′ — the terminal transition out of 'triaging', conditional on
// the EXACT claim this caller is holding (triage_claimed_at), not merely on
// status='triaging'. Mirrors the "conditional on the claim it is consuming"
// posture Stage D's card insert will also need (§4.1): if a re-score landed
// mid-flight, upsert_signal_candidate has already reset the row to 'new' and
// cleared triage_claimed_at (A-4′), so this WHERE fails to match and the
// caller's own (now-stale) triage verdict is correctly discarded — the
// candidate is re-triaged fresh on a later tick rather than this call
// silently overwriting a newer claim's state.
export async function setCandidateTriageOutcome(
  client: SupabaseClient,
  id: string,
  claimedAtIso: string,
  status: 'no_card' | 'triage_failed' | 'carded',
): Promise<SignalCandidateRow | null> {
  const { data, error } = await client
    .from('signal_candidates')
    .update({ status, triage_claimed_at: null })
    .eq('id', id)
    .eq('status', 'triaging')
    .eq('triage_claimed_at', claimedAtIso)
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SignalCandidateRow | null) ?? null
}

// §2.10 — the Tier-0 age gate. Direct new -> no_card, deterministic, ZERO
// claim and ZERO LLM call: a candidate this old is never worth even
// attempting to triage, so it never enters 'triaging' at all. This is what
// drains ADR 0020 §4.4's 90-day backfill; without it a 20-repo watch list
// takes months to clear at TRIAGE_SHORTLIST_PER_TICK=5/business/day.
// ADR 0021 §9.2 — the opportunities feed's "triage failed" state needs a
// boolean, never the full row set: a bounded existence check
// (limit 1), not a list. Fail-closed must be VISIBLE (L-3) — a candidate
// stuck at 'triage_failed' must never read as "nothing happened".
export async function hasTriageFailedCandidates(
  client: SupabaseClient,
  businessId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('signal_candidates')
    .select('id')
    .eq('business_id', businessId)
    .eq('status', 'triage_failed')
    .limit(1)
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).length > 0
}

export async function ageGateCandidate(
  client: SupabaseClient,
  id: string,
): Promise<SignalCandidateRow | null> {
  const { data, error } = await client
    .from('signal_candidates')
    .update({ status: 'no_card' })
    .eq('id', id)
    .eq('status', 'new')
    .select()
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SignalCandidateRow | null) ?? null
}
