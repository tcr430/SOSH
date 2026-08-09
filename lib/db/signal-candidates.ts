import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalCandidateRow, SignalCandidateWithSignal, SignalCandidateInsert } from './types'
import { getErrorMessage } from './utils'

// ADR 0020 §10.1 — the ONLY module that touches signal_candidates. Every
// caller (Stage B's scorer, Session 28's Stage C reader) goes through here,
// never through a direct `.from('signal_candidates')` elsewhere.

const NEW_CANDIDATES_DEFAULT_LIMIT = 50

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
    .select('*, signals(title, body, html_url, occurred_at, author_is_bot, is_prerelease)')
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
  // lib/db/signals.ts's asSignalRow.
  return (data as SignalCandidateWithSignal[]) ?? []
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
